import test from 'node:test';
import assert from 'node:assert/strict';

let listener;
const resources = { streams: [], contexts: [], nodes: [], fail: false, notices: [], constraints: null };
globalThis.chrome = { runtime: {
  id: 'test',
  onMessage: { addListener: fn => { listener = fn; } },
  sendMessage: async m => { resources.notices.push(m); return { ok: true }; },
} };
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { mediaDevices: {
  async getUserMedia(constraints) {
    resources.constraints = constraints;
    // Match Chrome's parser: legacy mandatory/optional cannot have modern sibling constraints.
    const audio = constraints?.audio;
    if (audio && ('mandatory' in audio || 'optional' in audio) &&
        Object.keys(audio).some(key => !['mandatory', 'optional'].includes(key))) {
      throw new TypeError('Malformed constraint: Cannot use both optional/mandatory and specific or advanced constraints.');
    }
    const track = { readyState: 'live', stopped: false, ended: null,
      stop() { this.stopped = true; this.readyState = 'ended'; },
      addEventListener(type, fn) { if (type === 'ended') this.ended = fn; },
    };
    const stream = { track, getTracks: () => [track], getAudioTracks: () => [track] };
    resources.streams.push(stream); return stream;
  },
} } });
class Source {
  connect(node) { return node; }
  disconnect() { this.disconnected = true; }
}
globalThis.AudioContext = class {
  constructor() {
    this.state = 'suspended'; this.destination = {};
    this.audioWorklet = { addModule: async () => { if (resources.fail) throw new Error('load failed'); } };
    resources.contexts.push(this);
  }
  createMediaStreamSource() { this.source = new Source(); return this.source; }
  async resume() { this.state = 'running'; }
  async close() { this.state = 'closed'; this.onstatechange?.(); }
};
globalThis.AudioWorkletNode = class extends Source {
  constructor() {
    super(); this.port = { onmessage: null, messages: [], postMessage: m => this.port.messages.push(m) };
    resources.nodes.push(this);
  }
};
await import('../extension/offscreen.js');
const command = (type, tabId, extra = {}) => new Promise(resolve => {
  assert.equal(listener({ target: 'offscreen', type, tabId, streamId: 'test', ...extra }, { id: 'test' }, resolve), true);
});

test('tab capture uses a Chrome-compatible constraint format without mixed styles', async () => {
  const result = await command('start', 7, { streamId: 'regression-stream-id' });
  assert.equal(result.ok, true, result.error);
  assert.equal(result.active, true);
  assert.equal(resources.constraints.audio.mandatory.chromeMediaSource, 'tab');
  assert.equal(resources.constraints.audio.mandatory.chromeMediaSourceId, 'regression-stream-id');
  assert.equal(resources.constraints.video, false);
  await command('stop', 7);
});

test('worklet load failure releases captured audio and closes context', async () => {
  resources.fail = true;
  const result = await command('start', 1);
  assert.equal(result.ok, false);
  assert.ok(resources.streams.at(-1).track.stopped);
  assert.equal(resources.contexts.at(-1).state, 'closed');
  assert.equal((await command('status', 1)).active, false);
  resources.fail = false;
});

test('duplicate start is idempotent; settings and stop reach the live pipeline', async () => {
  assert.equal((await command('start', 2)).active, true);
  const count = resources.streams.length;
  await command('start', 2);
  assert.equal(resources.streams.length, count);
  const node = resources.nodes.at(-1);
  await command('settings', 2, { settings: { mode: 'gentle', targetDb: -25 } });
  assert.equal(node.port.messages.at(-1).settings.targetDb, -25);
  node.port.onmessage({ data: { inputDb: -30, outputDb: -20 } });
  assert.equal((await command('status', 2)).levels.outputDb, -20);
  await command('stop', 2);
  assert.ok(node.disconnected);
  assert.ok(resources.streams.at(-1).track.stopped);
  assert.equal(resources.contexts.at(-1).state, 'closed');
  assert.equal((await command('status', 2)).active, false);
});

test('processor failure restores original audio and reports an inactive session', async () => {
  await command('start', 3);
  resources.nodes.at(-1).onprocessorerror();
  const state = await command('status', 3);
  assert.equal(state.active, false);
  assert.match(state.error, /Исходный звук/);
  assert.ok(resources.streams.at(-1).track.stopped);
});

test('ended capture and suspended audio context clean up sessions', async () => {
  await command('start', 4);
  resources.streams.at(-1).track.ended();
  assert.equal((await command('status', 4)).active, false);
  await command('start', 5);
  const context = resources.contexts.at(-1);
  context.state = 'suspended'; context.onstatechange();
  assert.equal((await command('status', 5)).active, false);
  assert.ok(resources.streams.at(-1).track.stopped);
});

test('capture arriving after startup timeout is released instead of muting the tab', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const original = navigator.mediaDevices.getUserMedia;
  let complete;
  navigator.mediaDevices.getUserMedia = () => new Promise(resolve => { complete = resolve; });
  try {
    const pending = command('start', 6);
    await new Promise(setImmediate);
    t.mock.timers.tick(8001);
    const response = await pending;
    assert.equal(response.ok, false);
    assert.match(response.error, /вовремя/);
    const late = await original();
    complete(late);
    await new Promise(setImmediate);
    assert.ok(late.track.stopped);
    assert.equal((await command('status', 6)).active, false);
  } finally {
    navigator.mediaDevices.getUserMedia = original;
    t.mock.timers.reset();
  }
});

test('automatic ownership is available after worker recreation via the session list', async () => {
  assert.equal((await command('start', 8, { automatic: true })).autoOwned, true);
  const list = await command('sessions');
  assert.ok(list.sessions.some(s => s.tabId === 8 && s.autoOwned));
  await command('stop', 8);
  assert.ok(!(await command('sessions')).sessions.some(s => s.tabId === 8));
});

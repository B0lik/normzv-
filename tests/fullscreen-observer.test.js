import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const script = readFileSync(new URL('../extension/fullscreen-observer.js', import.meta.url), 'utf8');
function fixture() {
  const state = { listeners: new Map(), messages: [], exits: 0, fail: false };
  const document = {
    fullscreenElement: null,
    addEventListener(type, callback) {
      const callbacks = state.listeners.get(type) || new Set();
      callbacks.add(callback); state.listeners.set(type, callbacks);
    },
    removeEventListener(type, callback) { state.listeners.get(type)?.delete(callback); },
    exitFullscreen() { state.exits++; return Promise.resolve(); },
  };
  const context = vm.createContext({ document, chrome: { runtime: {
    sendMessage(message) {
      state.messages.push({ ...message });
      return state.fail ? Promise.reject(new Error('Extension context invalidated')) : Promise.resolve({ ok: true });
    },
  } } });
  const install = () => vm.runInContext(script, context);
  const event = (type, value = {}) => {
    for (const callback of state.listeners.get(type) || []) callback(value);
  };
  return { state, document, context, install, event };
}

test('same-button DOM entry/exit is reported once even after repeated injection', () => {
  const { state, document, install, event } = fixture();
  assert.equal(install(), false);
  assert.equal(install(), false);
  document.fullscreenElement = { tagName: 'VIDEO' };
  assert.equal(install(), true);
  event('fullscreenchange');
  document.fullscreenElement = null;
  event('fullscreenchange');
  assert.deepEqual(state.messages.map(message => message.fullscreen), [true, false]);
  assert.equal(state.listeners.get('keydown').size, 1);
  assert.equal(state.exits, 0, 'the player owns its button and normal fullscreen API');
});

test('a fullscreen iframe is observed through its top-document element', () => {
  const { state, document, install, event } = fixture();
  install();
  document.fullscreenElement = { tagName: 'IFRAME' };
  event('fullscreenchange');
  document.fullscreenElement = null;
  event('fullscreenchange');
  assert.deepEqual(state.messages.map(message => message.fullscreen), [true, false]);
});

test('trusted Escape requests both DOM and window exit without cancelling player keys', () => {
  const { state, document, install, event } = fixture();
  install(); document.fullscreenElement = {};
  const escape = { key: 'Escape', isTrusted: true, repeat: false,
    preventDefault() { assert.fail('must preserve player key handling'); },
    stopPropagation() { assert.fail('must preserve player key handling'); } };
  event('keydown', { ...escape, key: 'f' });
  event('keydown', { ...escape, isTrusted: false });
  event('keydown', { ...escape, repeat: true });
  assert.equal(state.messages.length, 0);
  event('keydown', escape);
  assert.equal(state.exits, 1);
  assert.deepEqual(state.messages.map(message => message.fullscreen), [false]);
  document.fullscreenElement = null;
  event('keydown', escape); // DOM already exited but the browser window may still be owned.
  assert.equal(state.exits, 1);
  assert.equal(state.messages.length, 2);
});

test('invalidated extension context detaches old listeners and can be installed again', async () => {
  const { state, context, install, event } = fixture();
  install(); state.fail = true;
  event('fullscreenchange');
  await Promise.resolve(); await Promise.resolve();
  assert.equal(state.listeners.get('fullscreenchange').size, 0);
  assert.equal(state.listeners.get('keydown').size, 0);
  assert.equal(context.__rovnyZvukFullscreenObserver, undefined);
  state.fail = false; install();
  assert.equal(state.listeners.get('fullscreenchange').size, 1);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDomain, sanitizeAutomatic, matchesAutomatic } from '../extension/shared/automatic.js';
import { createController } from '../extension/background.js';

function fixture() {
  const state = {
    local: {}, memory: {}, sessions: new Map(), exists: false, captures: 0, denied: new Set(),
    badges: new Map(),
    window: { id: 4, state: 'normal', focused: true }, windowUpdates: [],
    tabs: new Map([
      [1, { id: 1, url: 'https://www.youtube.com/watch?v=test', audible: true, active: true, windowId: 4 }],
      [2, { id: 2, url: 'https://example.org/video', audible: true, active: false, windowId: 4 }],
    ]),
  };
  const api = {
    runtime: {
      getURL: p => 'chrome-extension://test/' + p,
      getContexts: async () => state.exists ? [{}] : [],
      sendMessage: async m => {
        if (m.type === 'sessions') return { ok: true, sessions: [...state.sessions].map(([tabId, s]) => ({ tabId, ...s })) };
        if (m.type === 'start') state.sessions.set(m.tabId, { autoOwned: m.automatic });
        if (m.type === 'stop') state.sessions.delete(m.tabId);
        return { ok: true, active: state.sessions.has(m.tabId), ...state.sessions.get(m.tabId) };
      },
    },
    tabs: {
      get: async id => { const t = state.tabs.get(id); if (!t) throw new Error('No tab'); return { ...t }; },
      query: async () => [...state.tabs.values()].map(t => ({ ...t })),
    },
    windows: {
      get: async () => ({ ...state.window }),
      update: async (id, value) => { state.windowUpdates.push({ id, ...value }); Object.assign(state.window, value); },
    },
    storage: {
      local: { get: async () => structuredClone(state.local), set: async v => Object.assign(state.local, structuredClone(v)) },
      session: { get: async () => structuredClone(state.memory), set: async v => Object.assign(state.memory, structuredClone(v)) },
    },
    offscreen: { createDocument: async () => { state.exists = true; } },
    tabCapture: { getMediaStreamId: async ({ targetTabId }) => {
      state.captures++;
      if (state.denied.has(targetTabId)) throw new Error('Extension has not been invoked for the current page (see activeTab permission).');
      return 'stream';
    } },
    action: { setBadgeText: async ({ tabId, text }) => state.badges.set(tabId, text), setBadgeBackgroundColor: async () => {} },
  };
  const controller = createController(api);
  const command = (type, tabId = 1, extra = {}) => controller.handle({ type, tabId, ...extra });
  return { state, api, controller, command };
}
const selected = { enabled: true, scope: 'selected', domains: ['youtube.com'] };
const all = { ...selected, scope: 'all' };

test('site input accepts URLs and domains, and rejects non-web/invalid addresses', () => {
  assert.equal(normalizeDomain(' https://WWW.YouTube.com/watch?v=1 '), 'youtube.com');
  assert.equal(normalizeDomain('youtu.be'), 'youtu.be');
  for (const v of ['', 'chrome://extensions', 'javascript:alert(1)', 'https://a@youtube.com', '*.youtube.com', 'bad..com', '-bad.com']) {
    assert.equal(normalizeDomain(v), null, v);
  }
});

test('selected sites include subdomains but never lookalike or service-page URLs', () => {
  for (const url of ['https://youtube.com', 'https://www.youtube.com/watch', 'https://m.youtube.com/watch']) assert.ok(matchesAutomatic(url, selected));
  for (const url of ['https://youtube.com.evil.org', 'https://notyoutube.com', 'https://example.com/?url=youtube.com', 'chrome://extensions']) {
    assert.equal(matchesAutomatic(url, selected), false);
  }
  assert.ok(matchesAutomatic('https://other.com/video', all));
  assert.equal(matchesAutomatic('file:///video.html', all), false);
});

test('policy preserves an empty selection and safely sanitizes saved settings', () => {
  assert.deepEqual(sanitizeAutomatic({ enabled: true, scope: 'selected', domains: [] }).domains, []);
  assert.equal(sanitizeAutomatic({ enabled: 'true' }).enabled, false);
  assert.deepEqual(sanitizeAutomatic({ domains: ['www.youtube.com', 'youtube.com', 'chrome://x'] }).domains, ['youtube.com']);
  assert.equal(sanitizeAutomatic({ domains: Array.from({ length: 70 }, (_, i) => `site${i}.com`) }).domains.length, 50);
});

test('default off never starts capture, and selected mode starts only YouTube', async () => {
  const { state, command } = fixture();
  await command('auto-check', 1, { invoked: true });
  assert.equal(state.captures, 0);
  await command('set-automatic', 1, { automatic: selected });
  assert.deepEqual([...state.sessions.keys()], [1]);
  assert.equal(state.sessions.get(1).autoOwned, true);
  assert.equal((await command('status', 2)).autoStatus.eligible, false);
});

test('all mode handles multiple audible tabs and repeated events without duplicate capture', async () => {
  const { state, command } = fixture();
  await command('set-automatic', 1, { automatic: all });
  await Promise.all([command('auto-check', 1), command('auto-check', 2), command('auto-check', 1)]);
  assert.deepEqual([...state.sessions.keys()].toSorted(), [1, 2]);
  assert.equal(state.captures, 2);
});

test('denied new tab is marked for user activation and does not retry on every event or worker wake', async () => {
  const { state, api, command } = fixture();
  state.denied.add(2);
  await command('set-automatic', 1, { automatic: all });
  assert.equal(state.captures, 2);
  await command('auto-check', 2);
  assert.equal(state.captures, 2);
  const restarted = createController(api);
  await restarted.handle({ type: 'auto-check', tabId: 2 });
  assert.equal(state.captures, 2);
  const status = await command('status', 2);
  assert.equal(status.active, false);
  assert.equal(status.autoStatus.needsActivation, true);
  assert.equal(state.badges.get(2), '!');
  state.denied.delete(2); // Opening the extension supplies Chrome's per-tab invocation grant.
  await command('auto-check', 2, { invoked: true });
  assert.equal(state.sessions.get(2).autoOwned, true);
  assert.equal((await command('status', 2)).autoStatus.error, null);
});

test('manual stop pauses auto across popup opens and worker wake; manual start resumes it', async () => {
  const { state, api, command } = fixture();
  await command('set-automatic', 1, { automatic: selected });
  await command('stop', 1);
  await command('auto-check', 1, { invoked: true });
  const restarted = createController(api);
  await restarted.handle({ type: 'auto-check', tabId: 1 });
  assert.equal(state.sessions.has(1), false);
  assert.equal((await command('status')).autoStatus.paused, true);
  await command('start', 1);
  assert.equal(state.sessions.get(1).autoOwned, false);
  assert.equal((await command('status')).autoStatus.paused, false);
});

test('turning auto off stops automatic sessions and preserves manual sessions', async () => {
  const { state, command } = fixture();
  await command('start', 2);
  await command('set-automatic', 1, { automatic: all });
  await command('set-automatic', 1, { automatic: { ...all, enabled: false } });
  assert.deepEqual([...state.sessions.keys()], [2]);
  assert.equal(state.badges.get(1), '');
  assert.equal(state.badges.get(2), 'ON');
});

test('switching to selected sites stops excluded automatic sessions', async () => {
  const { state, command } = fixture();
  await command('set-automatic', 1, { automatic: all });
  await command('set-automatic', 1, { automatic: selected });
  assert.deepEqual([...state.sessions.keys()], [1]);
  await command('set-automatic', 1, { automatic: { ...selected, domains: [] } });
  assert.equal(state.sessions.size, 0);
});

test('navigation excludes unrelated sites and resets pauses only on website changes', async () => {
  const { state, command } = fixture();
  await command('set-automatic', 1, { automatic: selected });
  state.tabs.get(1).url = 'https://example.net/video';
  await command('auto-check', 1);
  assert.equal(state.sessions.has(1), false);
  state.tabs.get(1).url = 'https://youtube.com/another';
  await command('auto-check', 1);
  await command('stop', 1);
  state.tabs.get(1).url = 'https://youtube.com/yet-another';
  await command('auto-check', 1);
  assert.equal(state.sessions.has(1), false);
  state.tabs.get(1).url = 'https://example.net'; await command('auto-check', 1);
  state.tabs.get(1).url = 'https://youtube.com'; await command('auto-check', 1);
  assert.equal(state.sessions.has(1), true);
});

test('closed tabs release capture and stored per-tab state', async () => {
  const { state, command } = fixture();
  await command('set-automatic', 1, { automatic: selected });
  await command('stop', 1);
  state.tabs.delete(1);
  await command('tab-closed', 1);
  assert.equal(state.memory.automaticTabs[1], undefined);
});

test('a late capture-ended event cannot recreate or stop a live session', async () => {
  const { state, command } = fixture();
  await command('set-automatic', 1, { automatic: selected });
  await command('session-ended', 1);
  assert.equal(state.captures, 1);
  assert.equal(state.sessions.has(1), true);
});

test('fullscreen capture events expand/restore the window without restarting normalizer audio', async () => {
  const { state, command } = fixture();
  await command('start', 1);
  await command('capture-status', 1, { info: { tabId: 1, status: 'active', fullscreen: true } });
  assert.equal(state.window.state, 'fullscreen');
  assert.equal((await command('status', 1)).active, true);
  await command('capture-status', 1, { info: { tabId: 1, status: 'active', fullscreen: false } });
  assert.equal(state.window.state, 'normal');
  assert.equal(state.captures, 1);
  assert.equal(state.sessions.size, 1);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { createController, backgroundMessage } from '../extension/background.js';

function fixture() {
  const state = { exists: false, created: 0, captures: 0, sessions: new Set(), settings: undefined, badges: [], messages: [], fail: false,
    memory: {}, local: {}, injections: [], pageFullscreen: false, window: { id: 4, state: 'maximized', focused: true } };
  const api = {
    scripting: { executeScript: async request => {
      assert.equal(state.sessions.has(request.target.tabId), true, 'attach after audio starts');
      state.injections.push(request);
      return [{ frameId: 0, result: state.pageFullscreen }];
    } },
    windows: {
      get: async () => ({ ...state.window }),
      update: async (id, value) => Object.assign(state.window, value),
    },
    runtime: {
      getURL: path => 'chrome-extension://test/' + path,
      getContexts: async () => state.exists ? [{}] : [],
      sendMessage: async (m) => {
        state.messages.push(m);
        if (m.type === 'start') {
          if (state.fail) return { ok: false, error: 'Simulated worklet failure' };
          state.sessions.add(m.tabId);
        }
        if (m.type === 'stop') state.sessions.delete(m.tabId);
        if (m.type === 'sessions') return { ok: true, sessions: [...state.sessions].map(tabId => ({ tabId, autoOwned: false })) };
        return { ok: true, active: state.sessions.has(m.tabId) };
      },
    },
    tabs: {
      get: async id => ({ id, active: true, windowId: 4, url: state.url || 'https://example.org/watch' }),
      query: async query => query.active ? [{ id: 1 }] : [{ id: 1, title: 'Audible', audible: true }, { id: 2, title: 'Captured', audible: false }],
      update: async id => ({ id, active: true, windowId: 4 }),
    },
    commands: { getAll: async () => [{ name: 'volume-up', shortcut: 'Alt+Up' }] },
    storage: { session: {
      get: async () => structuredClone(state.memory),
      set: async value => Object.assign(state.memory, structuredClone(value)),
    }, local: {
      get: async () => ({ ...structuredClone(state.local), settings: state.settings }),
      set: async value => { Object.assign(state.local, structuredClone(value)); if ('settings' in value) state.settings = value.settings; },
    } },
    offscreen: { createDocument: async () => { state.exists = true; state.created++; } },
    tabCapture: { getMediaStreamId: async () => { state.captures++; return 'stream-' + state.captures; } },
    action: {
      setBadgeText: async value => { state.badges.push(value); },
      setBadgeBackgroundColor: async () => {},
    },
  };
  return { state, api, controller: createController(api) };
}

test('concurrent duplicate starts capture only once; multiple tabs are independent', async () => {
  const { state, controller } = fixture();
  await Promise.all([controller.handle({ type: 'start', tabId: 1 }), controller.handle({ type: 'start', tabId: 1 })]);
  assert.equal(state.captures, 1);
  await controller.handle({ type: 'start', tabId: 2 });
  assert.equal(state.created, 1);
  await controller.handle({ type: 'stop', tabId: 1 });
  assert.equal((await controller.handle({ type: 'status', tabId: 2 })).active, true);
  assert.deepEqual([...state.sessions], [2]);
});

test('worker recreation recovers offscreen sessions without recapturing', async () => {
  const { state, api, controller } = fixture();
  await controller.handle({ type: 'start', tabId: 5 });
  const restarted = createController(api);
  assert.equal((await restarted.handle({ type: 'status', tabId: 5 })).active, true);
  await restarted.handle({ type: 'start', tabId: 5 });
  assert.equal(state.captures, 1);
});

test('failed start does not enable badge or poison subsequent commands', async () => {
  const { state, controller } = fixture();
  state.fail = true;
  await assert.rejects(controller.handle({ type: 'start', tabId: 1 }), /worklet failure/);
  assert.equal(state.badges.length, 0);
  state.fail = false;
  assert.equal((await controller.handle({ type: 'start', tabId: 1 })).active, true);
  assert.equal(state.badges.at(-1).text, 'ON');
});

test('settings are sanitized, persisted and forwarded to running sessions', async () => {
  const { state, controller } = fixture();
  await controller.handle({ type: 'start', tabId: 1 });
  await controller.handle({ type: 'set-settings', settings: { mode: 'balanced', targetDb: -200 } });
  assert.deepEqual(state.settings, { mode: 'balanced', targetDb: -30 });
  assert.equal(state.messages.at(-1).type, 'settings');
});

test('service pages are rejected before capture and stopping absent sessions is safe', async () => {
  const { state, controller } = fixture();
  state.url = 'chrome://extensions';
  await assert.rejects(controller.handle({ type: 'start', tabId: 1 }), /служебных/);
  assert.equal(state.captures, 0);
  await controller.handle({ type: 'stop', tabId: 1 });
  assert.equal(state.badges.at(-1).text, '');
});

test('a late session-ended event cannot clear a new session badge', async () => {
  const { state, controller } = fixture();
  await controller.handle({ type: 'start', tabId: 1 });
  await controller.handle({ type: 'session-ended', tabId: 1 });
  assert.equal(state.badges.at(-1).text, 'ON');
});

test('player exit restores the window after worker restart without restarting audio', async () => {
  const { state, api, controller } = fixture();
  await controller.handle({ type: 'start', tabId: 1 });
  assert.deepEqual(state.injections[0], { target: { tabId: 1 }, files: ['fullscreen-observer.js'] });
  state.pageFullscreen = true;
  await controller.handle({ type: 'player-fullscreen', tabId: 1, fullscreen: true });
  assert.equal(state.window.state, 'fullscreen');
  const restarted = createController(api);
  state.pageFullscreen = false;
  await restarted.handle({ type: 'player-fullscreen', tabId: 1, fullscreen: false });
  await restarted.handle({ type: 'capture-status', info: { tabId: 1, status: 'active', fullscreen: true } });
  assert.equal(state.window.state, 'maximized');
  assert.equal(state.sessions.has(1), true);
  assert.equal(state.captures, 1);
  assert.equal(state.messages.filter(message => message.type === 'stop').length, 0);
  assert.equal(state.badges.at(-1).text, 'ON');
  await restarted.handle({ type: 'auto-check', tabId: 1 });
  assert.equal(state.injections.length, 3, 'navigation/event checks can reattach the observer');
});

test('denied injection or window control cannot fail a successful audio start', async () => {
  for (const failure of ['injection', 'window']) {
    const { state, api, controller } = fixture();
    if (failure === 'injection') api.scripting.executeScript = async () => { throw new Error('No activeTab'); };
    else {
      state.pageFullscreen = true;
      api.windows.update = async () => { throw new Error('Window unavailable'); };
    }
    assert.equal((await controller.handle({ type: 'start', tabId: 1 })).active, true);
    assert.equal(state.badges.at(-1).text, 'ON');
    assert.equal(state.sessions.has(1), true);
  }
});

test('fullscreen messages use the real top-frame sender, never a supplied tab ID', () => {
  const message = { target: 'background', type: 'player-fullscreen', tabId: 99, fullscreen: false };
  const sender = { id: 'test', tab: { id: 1 }, frameId: 0 };
  assert.deepEqual(backgroundMessage(message, sender, 'test'), {
    type: 'player-fullscreen', tabId: 1, fullscreen: false,
  });
  for (const invalid of [{ ...sender, id: 'another' }, { ...sender, frameId: 2 }, { id: 'test' }]) {
    assert.equal(backgroundMessage(message, invalid, 'test'), undefined);
  }
  assert.equal(backgroundMessage({ ...message, fullscreen: 'false' }, sender, 'test'), undefined);
  assert.equal(backgroundMessage({ ...message, type: 'start' }, sender, 'test'), undefined);
  const popup = { target: 'background', type: 'start', tabId: 1 };
  assert.equal(backgroundMessage(popup, { id: 'test' }, 'test'), popup);
});

test('manual controls and shortcuts reach only their tab and never recapture active audio', async () => {
  const { state, controller } = fixture();
  await controller.handle({ type: 'status', tabId: 2 }); // This tab retains its own default.
  await controller.handle({ type: 'shortcut', name: 'volume-up' });
  assert.equal(state.captures, 1);
  assert.equal(state.messages.find(m => m.type === 'start').controls.volumePercent, 110);
  await controller.handle({ type: 'set-audio', tabId: 1, controls: { eqPreset: 'bass', volumePercent: 350 }, activate: true });
  assert.equal((await controller.handle({ type: 'status', tabId: 2 })).controls.volumePercent, 100);
  assert.equal((await controller.handle({ type: 'status', tabId: 2 })).controls.eqPreset, 'default');
  await controller.handle({ type: 'shortcut', name: 'volume-mute' });
  await controller.handle({ type: 'shortcut', name: 'volume-mute' });
  assert.equal((await controller.handle({ type: 'status', tabId: 1 })).controls.volumePercent, 350);
  assert.equal(state.captures, 1);
  const updates = state.messages.filter(m => m.type === 'controls');
  assert.ok(updates.every(m => m.tabId === 1));
  assert.equal(updates.at(-1).controls.muted, false);
});

test('navigation replaces site controls in a running session; theme and tab list work independently', async () => {
  const { state, controller } = fixture();
  await controller.handle({ type: 'set-audio', tabId: 2, controls: { volumePercent: 250 }, activate: true });
  state.url = 'https://different.org/watch';
  // Reading the tab list may observe navigation before its queued URL event.
  const navigated = await controller.handle({ type: 'list-audio-tabs' });
  assert.equal(navigated.tabs.find(tab => tab.id === 2).controls.volumePercent, 100);
  assert.equal(state.messages.filter(m => m.type === 'controls').at(-1).tabId, 2);
  assert.equal(state.messages.filter(m => m.type === 'controls').at(-1).controls.volumePercent, 100);
  await controller.handle({ type: 'auto-check', tabId: 2 });
  assert.equal(state.messages.filter(m => m.type === 'controls').at(-1).controls.volumePercent, 100);
  assert.equal(state.captures, 1);
  await controller.handle({ type: 'set-preferences', preferences: { theme: 'light' } });
  assert.equal((await controller.handle({ type: 'status', tabId: 2 })).preferences.theme, 'light');
  const list = await controller.handle({ type: 'list-audio-tabs' });
  assert.deepEqual(list.tabs.map(tab => tab.id), [1, 2]);
  assert.equal(list.tabs[1].active, true);
  assert.equal((await controller.handle({ type: 'activate-audio-tab', tabId: 2 })).ok, true);
});

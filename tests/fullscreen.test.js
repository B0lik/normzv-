import test from 'node:test';
import assert from 'node:assert/strict';
import { createFullscreenManager } from '../extension/fullscreen.js';

function fixture(initialState = 'normal') {
  const state = { memory: {}, active: true, window: { id: 4, state: initialState, focused: true },
    tab: { id: 10, active: true, windowId: 4 }, updates: [] };
  const api = {
    scripting: { executeScript: async () => state.pageFullscreen === undefined ? [] :
      [{ frameId: 0, result: state.pageFullscreen }] },
    storage: { session: {
      get: async () => structuredClone(state.memory),
      set: async value => Object.assign(state.memory, structuredClone(value)),
    } },
    tabs: { get: async () => ({ ...state.tab }) },
    windows: {
      get: async () => ({ ...state.window }),
      update: async (id, value) => { state.updates.push({ id, ...value }); Object.assign(state.window, value); },
    },
  };
  const manager = createFullscreenManager(api, async () => state.active);
  const event = (fullscreen, status = 'active') => manager.captureChanged({ tabId: 10, fullscreen, status });
  return { state, api, manager, event };
}

test('captured fullscreen expands the browser once and restores normal/maximized state', async () => {
  for (const initial of ['normal', 'maximized']) {
    const { state, event } = fixture(initial);
    await event(true); await event(true);
    assert.equal(state.window.state, 'fullscreen');
    assert.equal(state.updates.length, 1);
    await event(false); await event(false);
    assert.equal(state.window.state, initial);
    assert.equal(state.updates.length, 2);
  }
});

test('fullscreen belongs to the user when the window was already fullscreen', async () => {
  const { state, event } = fixture('fullscreen');
  await event(true); await event(false);
  assert.equal(state.updates.length, 0);
  assert.equal(state.window.state, 'fullscreen');
});

test('background tabs, unfocused windows and inactive audio cannot expand a window', async () => {
  const { state, event } = fixture();
  state.tab.active = false; await event(true);
  state.tab.active = true; state.window.focused = false; await event(true);
  state.window.focused = true; state.active = false; await event(true);
  assert.equal(state.updates.length, 0);
});

test('ownership survives worker sleep; ended capture restores only its owned window', async () => {
  const { state, api, event } = fixture('maximized');
  await event(true);
  const restarted = createFullscreenManager(api, async () => state.active);
  state.active = false;
  await restarted.captureChanged({ tabId: 10, status: 'stopped', fullscreen: false });
  assert.equal(state.window.state, 'maximized');
  assert.equal(Object.keys(state.memory.fullscreenWindows).length, 0);
});

test('a stale stopped event does not exit fullscreen for a new live capture', async () => {
  const { state, event } = fixture();
  await event(true); await event(false, 'stopped');
  assert.equal(state.window.state, 'fullscreen');
  assert.equal(state.updates.length, 1);
});

test('switching tabs restores the window and manual F11 changes relinquish ownership', async () => {
  const { state, manager, event } = fixture();
  await event(true);
  await manager.activated({ tabId: 20, windowId: 4 });
  assert.equal(state.window.state, 'normal');
  await event(true);
  state.window.state = 'maximized';
  await manager.windowChanged(state.window);
  state.window.state = 'fullscreen'; // The user enters fullscreen independently afterwards.
  await manager.stop(10);
  assert.equal(state.window.state, 'fullscreen');
});

test('failed window updates release ownership and do not block capture cleanup', async () => {
  const { state, api, manager, event } = fixture();
  await event(true);
  api.windows.update = async () => { throw new Error('Window closed while updating'); };
  await manager.stop(10);
  assert.equal(Object.keys(state.memory.fullscreenWindows).length, 0);
  state.window.state = 'normal';
  await assert.rejects(event(true), /Window closed/);
  assert.equal(Object.keys(state.memory.fullscreenWindows).length, 0);
  assert.equal(state.active, true);
});

test('the player button or Escape restores the window without a capture exit event', async () => {
  for (const initial of ['normal', 'maximized']) {
    const { state, manager, event } = fixture(initial);
    await event(true);
    await manager.pageChanged(10, false);
    await manager.pageChanged(10, false);
    assert.equal(state.window.state, initial);
    assert.equal(state.updates.length, 2);
    assert.equal(state.active, true);
  }
});

test('a delayed capture fullscreen event cannot reopen a player that has exited', async () => {
  const { state, manager, event } = fixture();
  state.pageFullscreen = true;
  await event(true);
  state.pageFullscreen = false;
  await manager.pageChanged(10, false);
  await event(true); // Chromium delivers a late notification about the previous entry.
  assert.equal(state.window.state, 'normal');
  assert.equal(state.updates.length, 2);
});

test('a delayed bounds event cannot discard ownership of a still-fullscreen window', async () => {
  const { state, manager, event } = fixture('maximized');
  await event(true);
  await manager.windowChanged({ id: 4, state: 'normal' });
  await event(false);
  assert.equal(state.window.state, 'maximized');
  assert.equal(state.updates.length, 2);
});

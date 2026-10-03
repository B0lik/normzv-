import { sanitizeSettings } from './shared/settings.js';
import { createAutomation } from './automatic.js';
import { createFullscreenManager } from './fullscreen.js';

export function backgroundMessage(message, sender, extensionId) {
  if (message?.target !== 'background' || sender.id !== extensionId) return;
  if (message.type === 'player-fullscreen') {
    if (!Number.isInteger(sender.tab?.id) || sender.frameId !== 0 ||
        typeof message.fullscreen !== 'boolean') return;
    // Content messages may only control their own tab, never a supplied tabId.
    return { type: 'player-fullscreen', tabId: sender.tab.id, fullscreen: message.fullscreen };
  }
  // Page observers have no authority to invoke capture/settings/window commands.
  if (sender.tab) return;
  return message;
}

export function createController(api) {
  let creating;
  let queue = Promise.resolve();
  const offscreenUrl = api.runtime.getURL('offscreen.html');

  async function hasOffscreen() {
    const contexts = await api.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT'], documentUrls: [offscreenUrl],
    });
    return contexts.length > 0;
  }

  async function ensureOffscreen() {
    if (creating) return creating;
    if (await hasOffscreen()) return;
    creating = api.offscreen.createDocument({
      url: 'offscreen.html', reasons: ['USER_MEDIA'],
      justification: 'Process captured tab audio locally and play normalized audio to the user.',
    });
    try { await creating; } finally { creating = undefined; }
  }

  async function send(type, data = {}) {
    const response = await api.runtime.sendMessage({ target: 'offscreen', type, ...data });
    if (!response?.ok) throw new Error(response?.error || 'Фоновая обработка не ответила. Попробуйте ещё раз.');
    return response;
  }

  async function badge(tabId, active) {
    await Promise.allSettled([
      api.action.setBadgeText({ tabId, text: typeof active === 'string' ? active : active ? 'ON' : '' }),
      api.action.setBadgeBackgroundColor({ tabId, color: active === '!' ? '#edbf75' : '#5ee2ae' }),
    ]);
  }

  async function status(tabId) {
    const { settings: stored } = await api.storage.local.get('settings');
    const settings = sanitizeSettings(stored);
    if (!await hasOffscreen()) return { ok: true, active: false, settings };
    return { ...await send('status', { tabId }), settings };
  }

  async function run(message) {
    const { type, tabId } = message;
    if (type === 'capture-status') {
      await fullscreen.captureChanged(message.info);
      if (['stopped', 'error'].includes(message.info.status)) return run({ type: 'session-ended', tabId: message.info.tabId });
      return { ok: true };
    }
    if (type === 'tab-activated') {
      await fullscreen.activated(message.info);
      await automation.check(await api.tabs.get(message.info.tabId));
      return { ok: true };
    }
    if (type === 'window-state') { await fullscreen.windowChanged(message.window); return { ok: true }; }
    if (type === 'window-closed') { await fullscreen.forgetWindow(message.windowId); return { ok: true }; }
    if (type === 'set-automatic') return automation.configure(message.automatic, tabId);
    if (type === 'auto-refresh') { await automation.refresh(); return { ok: true }; }
    if (type === 'set-settings') {
      const settings = sanitizeSettings(message.settings);
      await api.storage.local.set({ settings });
      if (await hasOffscreen()) await send('settings', { settings });
      return { ok: true, settings };
    }
    if (!Number.isInteger(tabId) || tabId < 0) throw new Error('Не удалось определить вкладку.');
    if (type === 'player-fullscreen') {
      if ((await status(tabId)).active) await fullscreen.pageChanged(tabId, message.fullscreen);
      return { ok: true };
    }
    if (type === 'status') {
      const tab = await api.tabs.get(tabId);
      return { ...await status(tabId), ...await automation.describe(tab) };
    }
    if (type === 'auto-check') {
      await automation.check(await api.tabs.get(tabId), { invoked: message.invoked === true });
      // Reattach after a same-origin navigation while tab capture continues.
      await fullscreen.watch(tabId);
      return run({ type: 'status', tabId });
    }
    if (type === 'start') {
      const tab = await api.tabs.get(tabId);
      if (!/^https?:\/\//i.test(tab.url || '')) {
        throw new Error('Откройте сайт с видео или аудио. На служебных страницах Chrome обработка недоступна.');
      }
      await ensureOffscreen();
      const current = await status(tabId);
      if (!message.automatic) await automation.resume(tabId);
      if (current.active) { await fullscreen.watch(tabId); return current; }
      // No consumerTabId: the service-worker stream ID is consumed by offscreen (Chrome 116+).
      const streamId = await api.tabCapture.getMediaStreamId({ targetTabId: tabId });
      const result = await send('start', { tabId, streamId, settings: current.settings, automatic: !!message.automatic });
      await fullscreen.watch(tabId);
      await badge(tabId, true);
      return result;
    }
    if (type === 'stop') {
      if (!message.automaticAction) await automation.pause(await api.tabs.get(tabId));
      if (await hasOffscreen()) await send('stop', { tabId });
      await fullscreen.stop(tabId);
      await badge(tabId, false);
      return { ok: true, active: false };
    }
    if (type === 'tab-closed') {
      await run({ type: 'stop', tabId, automaticAction: true });
      await automation.forget(tabId);
      return { ok: true };
    }
    if (type === 'session-ended') {
      // Read the current session so an old event cannot clear a new session's badge.
      const current = await status(tabId);
      await badge(tabId, current.active);
      if (!current.active) {
        await fullscreen.stop(tabId);
        try { await automation.check(await api.tabs.get(tabId)); } catch { /* tab may have closed */ }
      }
      return { ok: true };
    }
    throw new Error('Неизвестная команда.');
  }

  const automation = createAutomation(api, {
    status,
    start: tabId => run({ type: 'start', tabId, automatic: true }),
    stop: tabId => run({ type: 'stop', tabId, automaticAction: true }),
    list: async () => await hasOffscreen() ? (await send('sessions')).sessions : [],
    badge,
  });
  const fullscreen = createFullscreenManager(api, async tabId => (await status(tabId)).active);

  return {
    handle(message) {
      const task = queue.then(() => run(message));
      queue = task.catch(() => {});
      return task;
    },
  };
}

if (globalThis.chrome?.runtime) {
  const controller = createController(chrome);
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const command = backgroundMessage(message, sender, chrome.runtime.id);
    if (!command) return;
    controller.handle(command).then(sendResponse).catch((error) => {
      sendResponse({ ok: false, error: error.message || 'Не удалось выполнить команду.' });
    });
    return true;
  });
  chrome.tabs.onRemoved.addListener((tabId) => {
    controller.handle({ type: 'tab-closed', tabId }).catch(() => {});
  });
  chrome.tabs.onUpdated.addListener((tabId, change) => {
    if ('audible' in change || 'url' in change || change.status === 'complete') {
      controller.handle({ type: 'auto-check', tabId }).catch(() => {});
    }
  });
  chrome.tabs.onActivated.addListener(info => {
    controller.handle({ type: 'tab-activated', info }).catch(() => {});
  });
  chrome.windows.onBoundsChanged.addListener(window => {
    controller.handle({ type: 'window-state', window }).catch(() => {});
  });
  chrome.windows.onRemoved.addListener(windowId => {
    controller.handle({ type: 'window-closed', windowId }).catch(() => {});
  });
  chrome.runtime.onStartup.addListener(() => {
    controller.handle({ type: 'auto-refresh' }).catch(() => {});
  });
  chrome.tabCapture.onStatusChanged.addListener(info => {
    controller.handle({ type: 'capture-status', info }).catch(() => {});
  });
}

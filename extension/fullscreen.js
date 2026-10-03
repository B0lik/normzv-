// Tab capture can turn native video fullscreen into "fullscreen within tab".
// Expand its browser window, keeping audio running and tracking only windows we own.
export function createFullscreenManager(api, isActive) {
  const records = async () => (await api.storage.session.get('fullscreenWindows')).fullscreenWindows || {};
  async function save(windowId, value) {
    const all = await records();
    if (value) all[windowId] = value;
    else delete all[windowId];
    await api.storage.session.set({ fullscreenWindows: all });
  }

  async function restore(windowId, record) {
    // Delete before update so a resulting window event cannot claim a second restore.
    await save(windowId, null);
    let window;
    try { window = await api.windows.get(Number(windowId)); } catch { return; }
    if (window.state === 'fullscreen') {
      // A closing window or a rejected update must never interrupt audio cleanup.
      await api.windows.update(Number(windowId), { state: record.previousState }).catch(() => {});
    }
  }

  async function stop(tabId) {
    for (const [windowId, record] of Object.entries(await records())) {
      if (record.tabId === tabId) await restore(windowId, record);
    }
  }

  async function enter(tabId) {
    if (!await isActive(tabId)) return;
    const tab = await api.tabs.get(tabId);
    if (!tab.active) return;
    let window = await api.windows.get(tab.windowId);
    if (!window.focused) return;
    const owned = (await records())[tab.windowId];
    if (owned?.tabId === tabId) return;
    if (owned) {
      await restore(tab.windowId, owned);
      window = await api.windows.get(tab.windowId);
    }
    // A window already fullscreen belongs to the user; do not restore it later.
    if (!['normal', 'maximized'].includes(window.state)) return;
    await save(tab.windowId, { tabId, previousState: window.state });
    try { await api.windows.update(tab.windowId, { state: 'fullscreen' }); }
    catch (error) { await save(tab.windowId, null); throw error; }
  }

  async function pageChanged(tabId, fullscreen) {
    if (fullscreen) await enter(tabId);
    else await stop(tabId);
  }

  async function readPage(tabId) {
    try {
      // activeTab covers the top document. A fullscreen iframe also makes its
      // ancestor iframe element fullscreen in this document, including cross-origin frames.
      const results = await api.scripting.executeScript({
        target: { tabId }, files: ['fullscreen-observer.js'],
      });
      const value = results.find(result => result.frameId === 0)?.result;
      return typeof value === 'boolean' ? value : undefined;
    } catch {
      // Navigation/revoked activeTab must not break audio. Keep tabCapture as fallback.
      return undefined;
    }
  }

  return {
    stop,
    pageChanged,
    async watch(tabId) {
      if (!await isActive(tabId)) return;
      const value = await readPage(tabId);
      // Window control is supplementary; a denied update must not fail audio start.
      if (value !== undefined) await pageChanged(tabId, value).catch(() => {});
    },
    async captureChanged(info) {
      if (info.status === 'active') {
        // A delayed capture event must not reopen a player after its button exited.
        const value = await readPage(info.tabId);
        await pageChanged(info.tabId, value ?? info.fullscreen);
      } else if (['stopped', 'error'].includes(info.status) && !await isActive(info.tabId)) {
        await stop(info.tabId);
      }
    },
    async activated({ tabId, windowId }) {
      const record = (await records())[windowId];
      if (record && record.tabId !== tabId) await restore(windowId, record);
    },
    async windowChanged(window) {
      // Respect a user leaving fullscreen using F11 or changing window state manually.
      if (window.state && window.state !== 'fullscreen' && (await records())[window.id]) {
        // Bounds events can be queued before our update to fullscreen has completed.
        let current;
        try { current = await api.windows.get(window.id); } catch { return; }
        if (current.state !== 'fullscreen') await save(window.id, null);
      }
    },
    forgetWindow: windowId => save(windowId, null),
  };
}

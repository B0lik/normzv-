import { sanitizeAutomatic, matchesAutomatic, website } from './shared/automatic.js';

// Called inside the background controller's queue. session storage survives worker sleep,
// but tab-specific pauses and denied attempts are discarded when Chrome restarts.
export function createAutomation(api, pipeline) {
  const policy = async () => sanitizeAutomatic((await api.storage.local.get('automatic')).automatic);
  const states = async () => (await api.storage.session.get('automaticTabs')).automaticTabs || {};

  async function remember(tabId, value) {
    const all = await states();
    if (value) all[tabId] = value;
    else delete all[tabId];
    await api.storage.session.set({ automaticTabs: all });
  }

  async function describe(tab) {
    const automatic = await policy();
    const record = (await states())[tab.id];
    const valid = record?.site === website(tab.url) ? record : {};
    const eligible = matchesAutomatic(tab.url, automatic);
    return {
      automatic,
      autoStatus: {
        eligible, paused: eligible && !!valid.paused,
        needsActivation: eligible && !!valid.needsActivation,
        error: eligible ? valid.error || null : null,
      },
    };
  }

  async function check(tab, { invoked = false } = {}) {
    const automatic = await policy();
    let record = (await states())[tab.id];
    const site = website(tab.url);
    if (record && record.site !== site) {
      await remember(tab.id, null); record = null;
    }
    const current = await pipeline.status(tab.id);
    if (!matchesAutomatic(tab.url, automatic)) {
      if (current.active && current.autoOwned) await pipeline.stop(tab.id);
      if (record) await remember(tab.id, null);
      if (!current.active || current.autoOwned) await pipeline.badge(tab.id, false);
      return;
    }
    if (current.active || record?.paused || (!invoked && !tab.audible)) return;
    if (record?.blocked && !invoked) return;
    try {
      await pipeline.start(tab.id);
      await remember(tab.id, null);
    } catch (error) {
      const needsActivation = /not been invoked|activeTab|permission|grant|not.*invoked/i.test(error.message);
      await remember(tab.id, { site, blocked: true, needsActivation, error: error.message });
      await pipeline.badge(tab.id, '!');
    }
  }

  async function refresh() {
    const automatic = await policy();
    for (const session of await pipeline.list()) {
      if (!session.autoOwned) continue;
      let tab;
      try { tab = await api.tabs.get(session.tabId); } catch { /* closed tab */ }
      if (!tab || !matchesAutomatic(tab.url, automatic)) await pipeline.stop(session.tabId);
    }
    // Clear pending markers on sites removed from the policy, including silent tabs.
    const tabs = await api.tabs.query({});
    for (const tab of tabs) {
      if (!matchesAutomatic(tab.url, automatic) || tab.audible) await check(tab);
    }
  }

  return {
    describe, check, refresh,
    async configure(value, currentTabId) {
      const previous = await policy();
      const automatic = sanitizeAutomatic(value);
      await api.storage.local.set({ automatic });
      await refresh();
      if (Number.isInteger(currentTabId)) {
        const tab = await api.tabs.get(currentTabId);
        if (automatic.enabled && !previous.enabled) await remember(tab.id, null);
        await check(tab, { invoked: true });
      }
      return { ok: true, automatic };
    },
    async pause(tab) {
      if (matchesAutomatic(tab.url, await policy())) await remember(tab.id, { site: website(tab.url), paused: true });
    },
    resume: tabId => remember(tabId, null),
    forget: tabId => remember(tabId, null),
  };
}

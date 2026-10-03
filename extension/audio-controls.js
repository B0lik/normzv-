import { website } from './shared/automatic.js';
import { sanitizeAudioControls, sanitizePreferences, rememberedAudio } from './shared/audio-controls.js';

// Called through the worker's serialized queue; session values isolate simultaneous tabs.
export function createAudioControls(api) {
  const preferences = async () => sanitizePreferences((await api.storage.local.get('audioPreferences')).audioPreferences);
  const records = async () => (await api.storage.session.get('audioTabs')).audioTabs || {};
  async function get(tabId) {
    const site = website((await api.tabs.get(tabId)).url);
    const prefs = await preferences();
    const all = await records();
    const changed = !all[tabId] || all[tabId].site !== site;
    const controls = sanitizeAudioControls(changed ? prefs.rememberSites && site ? prefs.sites[site] : {} : all[tabId].controls);
    if (changed) {
      all[tabId] = { site, controls };
      await api.storage.session.set({ audioTabs: all });
    }
    return { controls, site, changed, preferences: { theme: prefs.theme, rememberSites: prefs.rememberSites } };
  }
  async function update(tabId, patch) {
    const state = await get(tabId);
    const controls = sanitizeAudioControls({ ...state.controls, ...patch });
    const all = await records();
    all[tabId] = { site: state.site, controls };
    await api.storage.session.set({ audioTabs: all });
    const prefs = await preferences();
    if (prefs.rememberSites && state.site) {
      delete prefs.sites[state.site];
      prefs.sites[state.site] = rememberedAudio(controls);
      await api.storage.local.set({ audioPreferences: sanitizePreferences(prefs) });
    }
    return { ...state, controls };
  }
  return {
    get, update,
    async configure(value = {}) {
      const prefs = await preferences();
      const next = sanitizePreferences({ ...prefs, theme: value.theme ?? prefs.theme, rememberSites: value.rememberSites ?? prefs.rememberSites });
      await api.storage.local.set({ audioPreferences: next });
      return { theme: next.theme, rememberSites: next.rememberSites };
    },
    async forgetSite(tabId) {
      const state = await get(tabId);
      const prefs = await preferences();
      if (state.site) delete prefs.sites[state.site];
      await api.storage.local.set({ audioPreferences: prefs });
      const all = await records();
      all[tabId] = { site: state.site, controls: sanitizeAudioControls() };
      await api.storage.session.set({ audioTabs: all });
      return { ...state, controls: all[tabId].controls };
    },
    async forgetTab(tabId) {
      const all = await records(); delete all[tabId];
      await api.storage.session.set({ audioTabs: all });
    },
  };
}

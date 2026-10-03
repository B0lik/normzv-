// Development-only popup preview. This file is never packaged in the extension.
// It simulates Chrome messages to exercise the real popup UI in a normal browser.
(() => {
  const policyDefault = { enabled: false, scope: 'selected', domains: ['youtube.com', 'youtu.be'] };
  let saved;
  try { saved = JSON.parse(localStorage.getItem('normzv-popup-preview') || '{}'); } catch { saved = {}; }
  let settings = saved.settings || { mode: 'strong', targetDb: -18 };
  let automatic = saved.automatic || policyDefault;
  const audioDefault = { volumePercent: 100, muted: false, smartVolume: true, eqPreset: 'default', eqBands: Array(10).fill(0) };
  let controls = saved.controls || { ...audioDefault };
  let preferences = saved.preferences || { theme: 'dark', rememberSites: true };
  let active = false;
  let autoOwned = false;
  let paused = false;
  const eligible = () => automatic.enabled && (automatic.scope === 'all' || automatic.domains.includes('youtube.com'));
  const apply = () => {
    if (active && autoOwned && !eligible()) active = false;
    if (!active && eligible() && !paused) { active = true; autoOwned = true; }
  };
  const state = () => ({
    ok: true, active, autoOwned, settings, automatic, controls, preferences,
    autoStatus: { eligible: eligible(), paused, needsActivation: false, error: null },
    levels: active ? { inputDb: -30, outputDb: -20, gainDb: 10, peakDb: -17 } : null,
  });
  window.chrome ||= {};
  window.chrome.tabs = {
    query: async () => [{ id: 1, url: 'https://www.youtube.com/watch?v=preview', title: 'Предпросмотр — YouTube (API Chrome имитируется)' }],
    create: async () => ({ id: 3 }),
  };
  window.chrome.runtime = {
    async sendMessage(m) {
      if (m.type === 'set-settings') settings = m.settings;
      if (m.type === 'set-audio') {
        controls = { ...controls, ...m.controls };
        if (m.activate && !active) { active = true; autoOwned = false; paused = false; }
      }
      if (m.type === 'forget-audio-site') controls = { ...audioDefault };
      if (m.type === 'set-preferences') preferences = { ...preferences, ...m.preferences };
      if (m.type === 'shortcuts') return { ok: true, shortcuts: [
        { name: 'volume-up', shortcut: 'Alt+Up' }, { name: 'volume-down', shortcut: 'Alt+Down' },
        { name: 'volume-mute', shortcut: 'Alt+M' }, { name: 'volume-reset', shortcut: '' },
        { name: '_execute_action', shortcut: 'Alt+Shift+V' },
      ] };
      if (m.type === 'list-audio-tabs') return { ok: true, tabs: [
        { id: 1, title: 'YouTube · текущая вкладка', active, controls },
        { id: 2, title: 'Другой плеер · отдельный уровень', active: false, controls: audioDefault },
      ] };
      if (m.type === 'activate-audio-tab') return { ok: true };
      if (m.type === 'set-automatic') {
        const wasEnabled = automatic.enabled;
        automatic = m.automatic;
        if (!wasEnabled && automatic.enabled) paused = false;
        apply();
      }
      if (m.type === 'auto-check') apply();
      if (m.type === 'start') { active = true; autoOwned = false; paused = false; }
      if (m.type === 'stop') { active = false; paused = eligible(); }
      localStorage.setItem('normzv-popup-preview', JSON.stringify({ settings, automatic, controls, preferences }));
      return state();
    },
  };
})();

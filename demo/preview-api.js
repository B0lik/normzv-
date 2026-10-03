// Development-only popup preview. This file is never packaged in the extension.
// It simulates Chrome messages to exercise the real popup UI in a normal browser.
(() => {
  const policyDefault = { enabled: false, scope: 'selected', domains: ['youtube.com', 'youtu.be'] };
  let saved;
  try { saved = JSON.parse(localStorage.getItem('normzv-popup-preview') || '{}'); } catch { saved = {}; }
  let settings = saved.settings || { mode: 'strong', targetDb: -18 };
  let automatic = saved.automatic || policyDefault;
  let active = false;
  let autoOwned = false;
  let paused = false;
  const eligible = () => automatic.enabled && (automatic.scope === 'all' || automatic.domains.includes('youtube.com'));
  const apply = () => {
    if (active && autoOwned && !eligible()) active = false;
    if (!active && eligible() && !paused) { active = true; autoOwned = true; }
  };
  const state = () => ({
    ok: true, active, autoOwned, settings, automatic,
    autoStatus: { eligible: eligible(), paused, needsActivation: false, error: null },
    levels: active ? { inputDb: -30, outputDb: -20, gainDb: 10, peakDb: -17 } : null,
  });
  window.chrome ||= {};
  window.chrome.tabs = { query: async () => [{ id: 1, url: 'https://www.youtube.com/watch?v=preview', title: 'Предпросмотр — YouTube (API Chrome имитируется)' }] };
  window.chrome.runtime = {
    async sendMessage(m) {
      if (m.type === 'set-settings') settings = m.settings;
      if (m.type === 'set-automatic') {
        const wasEnabled = automatic.enabled;
        automatic = m.automatic;
        if (!wasEnabled && automatic.enabled) paused = false;
        apply();
      }
      if (m.type === 'auto-check') apply();
      if (m.type === 'start') { active = true; autoOwned = false; paused = false; }
      if (m.type === 'stop') { active = false; paused = eligible(); }
      localStorage.setItem('normzv-popup-preview', JSON.stringify({ settings, automatic }));
      return state();
    },
  };
})();

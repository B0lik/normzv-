import { normalizeDomain } from './automatic.js';

export const EQ_FREQUENCIES = Object.freeze([31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000]);
export const EQ_PRESETS = Object.freeze({
  default: Object.freeze([0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
  voice: Object.freeze([-4, -4, -3, -2, 0, 2, 4, 4, 2, 0]),
  bass: Object.freeze([6, 6, 5, 3, 1, 0, 0, 0, 0, 0]),
});
export const DEFAULT_AUDIO = Object.freeze({ volumePercent: 100, muted: false, smartVolume: true, eqPreset: 'default' });
const clamp = (value, min, max, fallback) => Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;

export function sanitizeAudioControls(value) {
  const v = value && typeof value === 'object' ? value : {};
  const preset = Object.hasOwn(EQ_PRESETS, v.eqPreset) || v.eqPreset === 'custom' ? v.eqPreset : 'default';
  return {
    volumePercent: Math.round(clamp(v.volumePercent, 0, 600, 100)),
    muted: v.muted === true,
    smartVolume: v.smartVolume !== false,
    eqPreset: preset,
    eqBands: preset === 'custom' ? EQ_FREQUENCIES.map((_, i) => clamp(v.eqBands?.[i], -12, 12, 0)) : [...EQ_PRESETS[preset]],
  };
}

export function rememberedAudio(value) {
  const { muted, ...audio } = sanitizeAudioControls(value);
  return audio; // Muting a tab must never silently mute a newly opened video tomorrow.
}

export function sanitizePreferences(value) {
  const v = value && typeof value === 'object' ? value : {};
  const sites = Object.fromEntries(Object.entries(v.sites && typeof v.sites === 'object' ? v.sites : {})
    .map(([site, audio]) => [normalizeDomain(site), rememberedAudio(audio)])
    .filter(([site]) => site).slice(-100));
  return { theme: v.theme === 'light' ? 'light' : 'dark', rememberSites: v.rememberSites !== false, sites };
}

export function shortcutAudio(controls, name) {
  const c = sanitizeAudioControls(controls);
  if (name === 'volume-up') return sanitizeAudioControls({ ...c, volumePercent: c.volumePercent + 10, muted: false });
  if (name === 'volume-down') return sanitizeAudioControls({ ...c, volumePercent: c.volumePercent - 10 });
  if (name === 'volume-mute') return { ...c, muted: !c.muted };
  if (name === 'volume-reset') return { ...c, volumePercent: 100, muted: false };
  throw new Error('Неизвестная горячая клавиша.');
}

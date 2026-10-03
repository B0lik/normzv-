export const MODES = Object.freeze({
  gentle: { label: 'Мягко', strength: 0.6, rise: 0.65, fall: 0.04, maxBoostDb: 18 },
  balanced: { label: 'Средне', strength: 0.85, rise: 0.35, fall: 0.025, maxBoostDb: 26 },
  strong: { label: 'Сильно', strength: 1, rise: 0.18, fall: 0.015, maxBoostDb: 30 },
});

export const DEFAULT_SETTINGS = Object.freeze({ mode: 'strong', targetDb: -18 });

export function sanitizeSettings(value = {}) {
  const v = value && typeof value === 'object' ? value : {};
  return {
    mode: Object.hasOwn(MODES, v.mode) ? v.mode : DEFAULT_SETTINGS.mode,
    targetDb: Number.isFinite(v.targetDb)
      ? Math.max(-30, Math.min(-12, v.targetDb)) : DEFAULT_SETTINGS.targetDb,
  };
}

export const dbToGain = (db) => 10 ** (db / 20);
export const gainToDb = (value) => 20 * Math.log10(Math.max(value, 1e-6));

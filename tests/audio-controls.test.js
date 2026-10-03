import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeAudioControls, sanitizePreferences, shortcutAudio, EQ_PRESETS } from '../extension/shared/audio-controls.js';
import { createAudioControls } from '../extension/audio-controls.js';

function fixture() {
  const local = {}, memory = {};
  const urls = new Map([[1, 'https://www.youtube.com/watch'], [2, 'https://youtube.com/other'], [3, 'https://example.org']]);
  const api = { tabs: { get: async id => ({ id, url: urls.get(id) }) }, storage: {
    local: { get: async () => structuredClone(local), set: async v => Object.assign(local, structuredClone(v)) },
    session: { get: async () => structuredClone(memory), set: async v => Object.assign(memory, structuredClone(v)) },
  } };
  return { local, memory, urls, api, audio: createAudioControls(api) };
}

test('audio controls reject unsafe numbers and unknown presets; custom EQ has exactly ten bounded bands', () => {
  const bad = sanitizeAudioControls({ volumePercent: Infinity, muted: 'true', eqPreset: '__proto__' });
  assert.equal(bad.volumePercent, 100); assert.equal(bad.muted, false); assert.equal(bad.eqPreset, 'default');
  assert.equal(sanitizeAudioControls({ volumePercent: 900 }).volumePercent, 600);
  assert.equal(sanitizeAudioControls({ volumePercent: -2 }).volumePercent, 0);
  assert.deepEqual(sanitizeAudioControls({ eqPreset: 'voice' }).eqBands, [...EQ_PRESETS.voice]);
  assert.deepEqual(sanitizeAudioControls({ eqPreset: 'custom', eqBands: [99, -99, NaN] }).eqBands, [12, -12, 0, 0, 0, 0, 0, 0, 0, 0]);
  const value = sanitizeAudioControls(); value.eqBands[0] = 12;
  assert.equal(sanitizeAudioControls().eqBands[0], 0);
});

test('tabs are independent; newly opened site tabs remember sound controls but never mute', async () => {
  const { audio, urls, api } = fixture();
  await audio.get(1); await audio.get(2);
  await audio.update(1, { volumePercent: 250, eqPreset: 'voice', smartVolume: false, muted: true });
  assert.equal((await audio.get(2)).controls.volumePercent, 100);
  urls.set(4, 'https://youtube.com/new');
  const next = (await audio.get(4)).controls;
  assert.equal(next.volumePercent, 250); assert.equal(next.eqPreset, 'voice'); assert.equal(next.smartVolume, false); assert.equal(next.muted, false);
  const restarted = createAudioControls(api);
  assert.equal((await restarted.get(1)).controls.muted, true);
  await restarted.forgetTab(1);
  assert.equal((await restarted.get(1)).controls.muted, false);
});

test('disabled site memory does not save/reuse profiles and forgetting a site resets only its current tab', async () => {
  const { audio, local, urls } = fixture();
  await audio.update(1, { volumePercent: 300, eqPreset: 'bass' });
  await audio.configure({ rememberSites: false, theme: 'light' });
  urls.set(4, 'https://youtube.com');
  assert.equal((await audio.get(4)).controls.volumePercent, 100);
  await audio.update(4, { volumePercent: 400 });
  assert.equal(local.audioPreferences.sites['youtube.com'].volumePercent, 300);
  await audio.configure({ rememberSites: true });
  await audio.forgetSite(1);
  assert.equal((await audio.get(1)).controls.volumePercent, 100);
  assert.equal((await audio.get(4)).controls.volumePercent, 400);
  assert.equal(local.audioPreferences.sites['youtube.com'], undefined);
  assert.equal((await audio.get(1)).preferences.theme, 'light');
});

test('navigation restores destination-site profile and leaves query/video changes alone', async () => {
  const { audio, urls } = fixture();
  await audio.update(1, { volumePercent: 200 });
  await audio.update(3, { volumePercent: 75 });
  urls.set(1, 'https://youtube.com/watch?v=2');
  assert.equal((await audio.get(1)).changed, false);
  urls.set(1, 'https://example.org/movie');
  assert.equal((await audio.get(1)).controls.volumePercent, 75);
  urls.set(1, 'https://youtube.com/watch');
  assert.equal((await audio.get(1)).controls.volumePercent, 200);
});

test('shortcuts clamp levels, mute retains volume, and reset retains EQ and smart-volume choice', () => {
  assert.equal(shortcutAudio({ volumePercent: 600 }, 'volume-up').volumePercent, 600);
  assert.equal(shortcutAudio({ volumePercent: 0 }, 'volume-down').volumePercent, 0);
  const muted = shortcutAudio({ volumePercent: 270, eqPreset: 'voice', smartVolume: false }, 'volume-mute');
  assert.equal(shortcutAudio(muted, 'volume-mute').volumePercent, 270);
  const reset = shortcutAudio(muted, 'volume-reset');
  assert.equal(reset.volumePercent, 100); assert.equal(reset.muted, false); assert.equal(reset.eqPreset, 'voice'); assert.equal(reset.smartVolume, false);
});

test('site profiles are bounded and reject non-web/prototype keys', () => {
  const sites = Object.fromEntries(Array.from({ length: 150 }, (_, i) => [`site${i}.com`, { volumePercent: 600, muted: true }]));
  sites['chrome://extensions'] = {}; sites['__proto__'] = {};
  const prefs = sanitizePreferences({ sites });
  assert.equal(Object.keys(prefs.sites).length, 100);
  assert.equal(prefs.sites['chrome://extensions'], undefined);
  assert.ok(Object.values(prefs.sites).every(profile => !Object.hasOwn(profile, 'muted')));
});

import { DEFAULT_SETTINGS, sanitizeSettings } from './shared/settings.js';
import { sanitizeAutomatic, normalizeDomain, website } from './shared/automatic.js';
import { sanitizeAudioControls, EQ_FREQUENCIES } from './shared/audio-controls.js';

const $ = (id) => document.getElementById(id);
const modes = [...document.querySelectorAll('[data-mode]')];
const descriptions = {
  gentle: 'Сохраняет больше динамики, слегка сглаживая перепады.',
  balanced: 'Заметно выравнивает громкость речи, музыки и видео.',
  strong: 'Максимально сближает тихие и громкие фрагменты.',
};
let tabId;
let active = false;
let busy = false;
let settings = { ...DEFAULT_SETTINGS };
let timer;
let poll;
let automatic = sanitizeAutomatic();
let autoBusy = false;
let currentSite;
let controls = sanitizeAudioControls();
let preferences = { theme: 'dark', rememberSites: true };
let audioTimer;
let audioRevision = 0;
let savedAudioRevision = 0;
let audioQueue = Promise.resolve();
let polling = false;
let lastTabPoll = 0;

function disableAutoControls(disabled) {
  $('auto-toggle').disabled = disabled;
  $('site-input').disabled = disabled;
  $('site-add').disabled = disabled;
  $('site-current').disabled = disabled || !currentSite;
  document.querySelectorAll('[name="auto-scope"], #site-list button').forEach(el => { el.disabled = disabled; });
  $('toggle').disabled = disabled || busy;
  document.querySelectorAll('.audio-control').forEach(el => { el.disabled = disabled; });
}

function renderAutomatic(state) {
  if (state.automatic) automatic = sanitizeAutomatic(state.automatic);
  $('auto-toggle').setAttribute('aria-checked', String(automatic.enabled));
  document.querySelectorAll('[name="auto-scope"]').forEach(el => { el.checked = el.value === automatic.scope; });
  $('site-selection').hidden = automatic.scope !== 'selected';
  const list = $('site-list');
  // Preserve focused delete buttons across telemetry polls if the list has not changed.
  const key = JSON.stringify(automatic.domains);
  if (list.dataset.domains !== key) {
    list.replaceChildren();
    for (const domain of automatic.domains) {
      const item = document.createElement('li');
      const text = document.createElement('span'); text.textContent = domain; text.title = domain;
      const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = '×';
      remove.setAttribute('aria-label', `Удалить ${domain}`);
      remove.addEventListener('click', () => updateAutomatic({ ...automatic, domains: automatic.domains.filter(d => d !== domain) }));
      item.append(text, remove); list.append(item);
    }
    if (!automatic.domains.length) {
      const empty = document.createElement('li'); empty.className = 'empty-sites';
      empty.textContent = 'Добавьте сайт — пока ни один не выбран.'; list.append(empty);
    }
    list.dataset.domains = key;
  }
  const auto = state.autoStatus || {};
  let note = 'Автоподключение выключено.';
  if (automatic.enabled) {
    if (!auto.eligible) note = 'Этот сайт не входит в выбранную область.';
    else if (auto.paused) note = 'Авто приостановлено для вкладки. Кнопка «Включить» возобновит обработку.';
    else if (auto.needsActivation) note = 'Для запуска нажмите значок расширения в этой вкладке.';
    else if (auto.error) note = 'Автоподключение не удалось. Попробуйте включить для вкладки вручную.';
    else if (state.active && state.autoOwned) note = 'Обработка подключена автоматически.';
    else if (state.active) note = 'Эта вкладка включена вручную.';
    else note = 'Авто включено для этого сайта; ожидаем воспроизведения.';
  }
  $('auto-status').textContent = note;
  if (auto.error && !auto.needsActivation) showError(auto.error);
}

async function updateAutomatic(value) {
  if (autoBusy || busy) return;
  autoBusy = true; disableAutoControls(true); showError(null);
  try {
    const response = await send('set-automatic', { automatic: value });
    automatic = sanitizeAutomatic(response.automatic);
    renderState(await send('status'));
  } catch (error) {
    showError(error.message);
    renderAutomatic({ automatic });
  } finally { autoBusy = false; disableAutoControls(false); }
}

function addSite(value) {
  const domain = normalizeDomain(value);
  if (!domain) { showError('Введите домен или адрес сайта, например youtube.com.'); return; }
  if (automatic.domains.length >= 50 && !automatic.domains.includes(domain)) {
    showError('Можно выбрать до 50 сайтов. Удалите ненужный сайт.'); return;
  }
  $('site-input').value = '';
  updateAutomatic({ ...automatic, domains: [...new Set([...automatic.domains, domain])] });
}

$('auto-toggle').addEventListener('click', () => updateAutomatic({ ...automatic, enabled: !automatic.enabled }));
document.querySelectorAll('[name="auto-scope"]').forEach(el => el.addEventListener('change', () => {
  if (el.checked) updateAutomatic({ ...automatic, scope: el.value });
}));
$('site-form').addEventListener('submit', event => { event.preventDefault(); addSite($('site-input').value); });
$('site-current').addEventListener('click', () => addSite(currentSite));

function showError(error) {
  $('error').textContent = error || '';
  $('error').hidden = !error;
}

async function send(type, payload = {}) {
  const response = await chrome.runtime.sendMessage({ target: 'background', type, tabId, ...payload });
  if (!response?.ok) throw new Error(response?.error || 'Нет ответа от расширения. Откройте его снова.');
  return response;
}

function renderSettings() {
  modes.forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.mode === settings.mode)));
  $('mode-description').textContent = descriptions[settings.mode];
  $('volume').value = settings.targetDb;
  $('volume-value').value = `${settings.targetDb} dBFS`;
}

function renderAudio() {
  $('master-volume').value = controls.volumePercent;
  // Telemetry polls must not replace an unfinished number before its change/blur.
  if (document.activeElement !== $('master-number')) $('master-number').value = controls.volumePercent;
  $('mute').setAttribute('aria-pressed', String(controls.muted));
  $('mute').textContent = controls.muted ? 'Вернуть звук' : 'Без звука';
  $('smart-volume').setAttribute('aria-pressed', String(controls.smartVolume));
  $('smart-volume').title = controls.smartVolume ? 'Выравнивание включено. Нажмите, чтобы оставить ручное усиление и EQ.' : 'Выравнивание выключено. Нажмите, чтобы сблизить тихое и громкое.';
  document.querySelectorAll('[data-eq]').forEach(el => el.setAttribute('aria-pressed', String(el.dataset.eq === controls.eqPreset)));
  const descriptions = {
    default: 'Ровная частотная характеристика без усиления отдельных полос.',
    voice: 'Подчёркивает частоты речи, уменьшает гул. Голос от музыки не отделяет.',
    bass: 'Усиливает низкие частоты для более плотной музыки и эффектов.',
    custom: 'Ваши настройки 10 частотных полос.',
  };
  $('eq-state').textContent = { default: 'Без окраски', voice: 'Чётче речь', bass: 'Больше низких', custom: 'Свой профиль' }[controls.eqPreset];
  $('eq-description').textContent = descriptions[controls.eqPreset];
  controls.eqBands.forEach((gain, i) => {
    $('eq-band-' + i).value = gain;
    $('eq-value-' + i).value = `${gain > 0 ? '+' : ''}${gain} dB`;
  });
}

function renderPreferences() {
  document.documentElement.dataset.theme = preferences.theme;
  $('theme-toggle').firstChild.textContent = preferences.theme === 'dark' ? 'Светлая тема' : 'Тёмная тема';
  $('remember-sites').checked = preferences.rememberSites;
  $('memory-description').textContent = currentSite ? `${currentSite}: ${preferences.rememberSites ? 'настройки применятся на новых вкладках этого сайта' : 'используются только настройки текущей вкладки'}.` : 'Память доступна для обычных веб-сайтов.';
  $('forget-site').disabled = !currentSite;
}

function renderState(state) {
  active = state.active;
  if (state.controls && savedAudioRevision === audioRevision) { controls = sanitizeAudioControls(state.controls); renderAudio(); }
  if (state.preferences) { preferences = state.preferences; renderPreferences(); }
  $('status').textContent = active ? controls.muted || controls.volumePercent === 0 ? 'Звук выключен' : controls.smartVolume ? 'Выравнивание включено' : 'Усиление и EQ включены' : 'Обработка выключена';
  $('status').classList.toggle('active', active);
  $('toggle').classList.toggle('active', active);
  $('toggle').textContent = active ? 'Отключить для вкладки' : 'Включить для вкладки';
  const levels = active ? state.levels : null;
  for (const [name, value] of [['input', levels?.inputDb], ['output', levels?.outputDb]]) {
    $(name + '-meter').value = Number.isFinite(value) ? Math.max(-60, value) : -60;
    $(name + '-level').textContent = Number.isFinite(value) && value > -60 ? `${Math.round(value)} dB` : '—';
  }
  $('gain').textContent = levels && levels.inputDb > -60
    ? `Коррекция ${levels.gainDb >= 0 ? '+' : ''}${levels.gainDb.toFixed(1)} dB` : 'Нет сигнала';
  if (state.error) showError(state.error);
  renderAutomatic(state);
}

function changeAudio(patch, immediate = true) {
  controls = sanitizeAudioControls({ ...controls, ...patch });
  audioRevision++;
  renderAudio(); showError(null);
  clearTimeout(audioTimer);
  if (immediate) saveAudio();
  else audioTimer = setTimeout(saveAudio, 120);
}

function saveAudio() {
  clearTimeout(audioTimer);
  const revision = audioRevision;
  const value = { ...controls, eqBands: [...controls.eqBands] };
  const task = audioQueue.then(async () => {
    try {
      const state = await send('set-audio', { controls: value, activate: true });
      savedAudioRevision = revision;
      renderState(state);
    } catch (error) { showError(error.message); }
  });
  audioQueue = task;
  return task;
}

EQ_FREQUENCIES.forEach((frequency, i) => {
  const row = document.createElement('div'); row.className = 'eq-row';
  const label = document.createElement('label'); label.htmlFor = 'eq-band-' + i;
  label.textContent = frequency >= 1000 ? `${frequency / 1000} kHz` : `${frequency} Hz`;
  const slider = document.createElement('input'); slider.type = 'range'; slider.min = -12; slider.max = 12; slider.step = 1;
  slider.id = 'eq-band-' + i; slider.className = 'audio-control'; slider.disabled = true;
  const value = document.createElement('output'); value.id = 'eq-value-' + i; value.htmlFor = slider.id;
  slider.addEventListener('input', () => {
    const bands = [...controls.eqBands]; bands[i] = Number(slider.value);
    changeAudio({ eqPreset: 'custom', eqBands: bands }, false);
  });
  slider.addEventListener('change', saveAudio);
  row.append(label, slider, value); $('eq-bands').append(row);
});
$('master-volume').addEventListener('input', () => changeAudio({ volumePercent: Number($('master-volume').value), muted: false }, false));
$('master-volume').addEventListener('change', saveAudio);
$('master-number').addEventListener('input', () => {
  if ($('master-number').value.trim()) changeAudio({ volumePercent: Number($('master-number').value), muted: false }, false);
});
$('master-number').addEventListener('change', () => {
  if (!$('master-number').value.trim()) { renderAudio(); return; }
  changeAudio({ volumePercent: Number($('master-number').value), muted: false });
});
$('mute').addEventListener('click', () => changeAudio({ muted: !controls.muted }));
$('reset-volume').addEventListener('click', () => changeAudio({ volumePercent: 100, muted: false }));
$('smart-volume').addEventListener('click', () => changeAudio({ smartVolume: !controls.smartVolume }));
document.querySelectorAll('[data-eq]').forEach(el => el.addEventListener('click', () => changeAudio({ eqPreset: el.dataset.eq })));

async function updatePreferences(patch) {
  try {
    preferences = (await send('set-preferences', { preferences: { ...preferences, ...patch } })).preferences;
    renderPreferences();
  } catch (error) { showError(error.message); renderPreferences(); }
}
$('theme-toggle').addEventListener('click', () => updatePreferences({ theme: preferences.theme === 'dark' ? 'light' : 'dark' }));
$('remember-sites').addEventListener('change', () => updatePreferences({ rememberSites: $('remember-sites').checked }));
$('forget-site').addEventListener('click', async () => {
  try {
    clearTimeout(audioTimer); await audioQueue;
    const state = await send('forget-audio-site');
    audioRevision++; savedAudioRevision = audioRevision;
    renderState(state);
  } catch (error) { showError(error.message); }
});

async function loadShortcuts() {
  try {
    const { shortcuts } = await send('shortcuts');
    $('shortcut-list').replaceChildren();
    const names = { 'volume-up': 'Громче на 10%', 'volume-down': 'Тише на 10%', 'volume-mute': 'Mute / вернуть звук', 'volume-reset': 'Вернуть 100%', '_execute_action': 'Открыть расширение' };
    for (const command of shortcuts) {
      const item = document.createElement('li');
      const name = document.createElement('span'); name.textContent = names[command.name] || command.description;
      const key = document.createElement('kbd'); key.textContent = command.shortcut || 'Не назначено';
      item.append(name, key); $('shortcut-list').append(item);
    }
  } catch (error) { showError(error.message); }
}
$('shortcuts-button').addEventListener('click', () => { $('shortcuts-panel').open = true; loadShortcuts(); $('shortcuts-panel').scrollIntoView({ block: 'nearest' }); });
$('configure-shortcuts').addEventListener('click', () => chrome.tabs.create({ url: 'chrome://extensions/shortcuts' }).catch(error => showError(error.message)));

async function refreshTabs() {
  try {
    const { tabs } = await send('list-audio-tabs');
    const list = $('audio-tabs'); const key = JSON.stringify(tabs);
    if (list.dataset.tabs === key) return;
    list.dataset.tabs = key; list.replaceChildren();
    for (const tab of tabs) {
      const row = document.createElement('li'); const button = document.createElement('button');
      button.textContent = `${tab.title} · ${tab.browserMuted || tab.controls.muted ? 'Без звука' : tab.controls.volumePercent + '%'}`;
      button.title = tab.title;
      button.classList.toggle('current-tab', tab.id === tabId);
      button.addEventListener('click', async () => {
        try { await send('activate-audio-tab', { tabId: tab.id }); window.close(); }
        catch (error) { showError(error.message); }
      });
      row.append(button); list.append(row);
    }
    if (!tabs.length) { const item = document.createElement('li'); item.textContent = 'Пока нет звучащих вкладок.'; list.append(item); }
  } catch (error) { showError(error.message); }
}
$('refresh-tabs').addEventListener('click', refreshTabs);

async function saveSettings() {
  clearTimeout(timer);
  try { await send('set-settings', { settings: { ...settings } }); return true; }
  catch (error) { showError('Не удалось сохранить настройки: ' + error.message); return false; }
}

modes.forEach((button) => button.addEventListener('click', () => {
  settings.mode = button.dataset.mode;
  renderSettings();
  saveSettings();
}));
$('volume').addEventListener('input', () => {
  settings.targetDb = Number($('volume').value);
  renderSettings();
  clearTimeout(timer);
  timer = setTimeout(saveSettings, 120);
});
$('volume').addEventListener('change', saveSettings);

$('toggle').addEventListener('click', async () => {
  if (busy || autoBusy) return;
  const wasActive = active;
  busy = true;
  disableAutoControls(true);
  $('toggle').textContent = active ? 'Отключаем…' : 'Включаем…';
  showError(null);
  try {
    clearTimeout(audioTimer);
    if (savedAudioRevision !== audioRevision) await saveAudio();
    await audioQueue;
    if (!await saveSettings()) throw new Error('Не удалось применить настройки. Попробуйте снова.');
    await send(wasActive ? 'stop' : 'start');
    renderState(await send('status'));
  } catch (error) {
    showError(error.message);
    try { renderState(await send('status')); } catch { $('toggle').textContent = 'Попробовать снова'; }
  } finally { busy = false; disableAutoControls(false); }
});

async function init() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error('Откройте вкладку с видео или аудио.');
    tabId = tab.id;
    currentSite = website(tab.url);
    if (currentSite) $('site-current').textContent = `Добавить текущий сайт: ${currentSite}`;
    $('tab-title').textContent = tab.title || 'Текущая вкладка';
    $('tab-title').title = tab.title || '';
    const state = await send('auto-check', { invoked: true });
    settings = sanitizeSettings(state.settings);
    renderSettings();
    renderState(state);
    disableAutoControls(false);
    $('volume').disabled = false;
    modes.forEach((button) => { button.disabled = false; });
    $('theme-toggle').disabled = false;
    $('remember-sites').disabled = false;
    loadShortcuts(); refreshTabs();
    poll = setInterval(async () => {
      if (busy || autoBusy || polling) return;
      polling = true;
      try {
        const state = await send('status'); if (!busy && !autoBusy) renderState(state);
        if (Date.now() - lastTabPoll > 2000) { lastTabPoll = Date.now(); await refreshTabs(); }
      }
      catch (error) { showError(error.message); }
      finally { polling = false; }
    }, 400);
  } catch (error) {
    $('status').textContent = 'Вкладка недоступна';
    $('toggle').textContent = 'Откройте обычный сайт';
    showError(error.message);
  }
}

window.addEventListener('pagehide', () => { clearInterval(poll); clearTimeout(timer); clearTimeout(audioTimer); if (savedAudioRevision !== audioRevision) saveAudio(); });
init();

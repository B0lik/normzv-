import { DEFAULT_SETTINGS, sanitizeSettings } from './shared/settings.js';
import { sanitizeAutomatic, normalizeDomain, website } from './shared/automatic.js';

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

function disableAutoControls(disabled) {
  $('auto-toggle').disabled = disabled;
  $('site-input').disabled = disabled;
  $('site-add').disabled = disabled;
  $('site-current').disabled = disabled || !currentSite;
  document.querySelectorAll('[name="auto-scope"], #site-list button').forEach(el => { el.disabled = disabled; });
  $('toggle').disabled = disabled || busy;
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
  $('volume-value').value = `${Math.round(10 ** ((settings.targetDb + 12) / 20) * 100)}%`;
}

function renderState(state) {
  active = state.active;
  $('status').textContent = active ? 'Выравнивание включено' : 'Обработка выключена';
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
  busy = true;
  disableAutoControls(true);
  $('toggle').textContent = active ? 'Отключаем…' : 'Включаем…';
  showError(null);
  try {
    if (!await saveSettings()) throw new Error('Не удалось применить настройки. Попробуйте снова.');
    await send(active ? 'stop' : 'start');
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
    poll = setInterval(async () => {
      if (busy || autoBusy) return;
      try { const state = await send('status'); if (!busy && !autoBusy) renderState(state); }
      catch (error) { showError(error.message); }
    }, 300);
  } catch (error) {
    $('status').textContent = 'Вкладка недоступна';
    $('toggle').textContent = 'Откройте обычный сайт';
    showError(error.message);
  }
}

window.addEventListener('pagehide', () => { clearInterval(poll); clearTimeout(timer); });
init();

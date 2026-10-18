// Preguntazo — bienvenida y ajustes.

import { ALL_SITES, REMOTE_URL, buildRemoteUrl, formatCode, getSettings, grantedOrigins, hasAllSites, normalizeSettings, removeOrigins, requestOrigins, saveSettings, shortRemote } from './config.js';
import { qrPng, qrSvg } from './lib/qr.js';
import { applyI18n, t } from './lib/i18n.js';

applyI18n();

const $ = (id) => document.getElementById(id);
const sw = (type, extra = {}) => chrome.runtime.sendMessage({ to: 'sw', type, ...extra });
$('version').textContent = chrome.runtime.getManifest().version;

let settings = await getSettings();
let identity = (await sw('session:get'))?.identity || null;

let toastTimer = 0;
function toast(text) {
  const el = $('toast');
  el.textContent = text;
  el.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('on'), 1800);
}

async function save(patch) {
  settings = await saveSettings(patch);
  render();
  toast(t('saved'));
}

const roomUrl = () => (identity?.code ? buildRemoteUrl(settings.remoteUrl || REMOTE_URL, identity.code) : '');

// ---------------------------------------------------------------- sala

let shownUrl = '';
function renderRoom() {
  const url = roomUrl();
  if (url && url !== shownUrl) {
    shownUrl = url;
    $('room-qr').innerHTML = qrSvg(url);
  }
  $('room-code').textContent = formatCode(identity?.code || '');
  $('room-link').textContent = `${shortRemote(settings.remoteUrl || REMOTE_URL)} · ${t('roomCodeHint')}`;
}

$('download-qr').addEventListener('click', async () => {
  const url = roomUrl();
  if (!url) return;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(await qrPng(url));
  a.download = `Preguntazo-QR-${formatCode(identity.code)}.png`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  toast(t('qrDownloaded'));
});

$('copy').addEventListener('click', async () => {
  await navigator.clipboard.writeText(roomUrl()).catch(() => {});
  toast(t('linkCopied'));
});

let newCodeArmed = false;
$('new-code').addEventListener('click', async (e) => {
  if (!newCodeArmed) {
    newCodeArmed = true;
    e.currentTarget.classList.add('danger');
    toast(t('confirmNewCode'));
    setTimeout(() => { newCodeArmed = false; $('new-code').classList.remove('danger'); }, 3000);
    return;
  }
  newCodeArmed = false;
  identity = (await sw('session:reset'))?.identity || identity;
  renderRoom();
  toast(t('newCodeDone'));
});

let titleTimer = 0;
$('title').placeholder = t('talkTitlePlaceholder');
$('title').addEventListener('input', () => {
  clearTimeout(titleTimer);
  titleTimer = setTimeout(() => save({ title: $('title').value.trim() }), 600);
});

// ---------------------------------------------------------------- sitios

async function renderSites() {
  const all = await hasAllSites();
  $('all-sites').checked = all;
  const origins = (await grantedOrigins()).filter((o) => !ALL_SITES.origins.includes(o));
  $('sites').replaceChildren(...origins.map((origin) => {
    const li = document.createElement('li');
    const dot = Object.assign(document.createElement('span'), { className: 'dot' });
    const host = Object.assign(document.createElement('span'), { className: 'host', textContent: origin.replace(/^https?:\/\//, '').replace(/\/\*$/, '') });
    const remove = Object.assign(document.createElement('button'), { className: 'btn small ghost', type: 'button', textContent: t('remove') });
    remove.addEventListener('click', async () => {
      await removeOrigins([origin]);
      renderSites();
    });
    li.append(dot, host, remove);
    return li;
  }));
  $('sites-empty').hidden = all || origins.length > 0;
}

$('all-sites').addEventListener('change', async (e) => {
  if (e.target.checked) {
    if (!(await requestOrigins(ALL_SITES.origins))) e.target.checked = false;
  } else {
    await removeOrigins(ALL_SITES.origins);
  }
  renderSites();
});

chrome.permissions.onAdded.addListener(renderSites);
chrome.permissions.onRemoved.addListener(renderSites);

// ---------------------------------------------------------------- atajos

async function renderShortcuts() {
  const commands = await chrome.commands.getAll();
  const names = { _execute_action: t('cmdOpen'), 'toggle-qr': t('cmdQr'), 'next-question': t('cmdNext'), 'clear-screen': t('cmdClear') };
  $('shortcuts').replaceChildren(...commands.map((c) => {
    const li = document.createElement('li');
    const label = document.createElement('span');
    label.textContent = names[c.name] || c.description;
    const keys = document.createElement('span');
    if (c.shortcut) {
      for (const k of c.shortcut.split('+')) keys.append(Object.assign(document.createElement('kbd'), { textContent: k }));
    } else {
      keys.className = 'muted small';
      keys.textContent = t('noShortcut');
    }
    li.append(label, keys);
    return li;
  }));
}

$('edit-shortcuts').addEventListener('click', () => chrome.tabs.create({ url: 'chrome://extensions/shortcuts' }));

// ---------------------------------------------------------------- ajustes

function bindSeg(id, key) {
  const seg = $(id);
  seg.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-v]');
    if (b) save({ [key]: b.dataset.v });
  });
}
bindSeg('qr-corner', 'qrCorner');
bindSeg('qr-size', 'qrSize');

for (const input of document.querySelectorAll('[data-setting]')) {
  input.addEventListener('change', () => save({ [input.dataset.setting]: input.checked }));
}

$('remote-url').placeholder = REMOTE_URL;
$('remote-url').addEventListener('change', (e) => {
  const v = e.target.value.trim();
  if (v && !/^https?:\/\//.test(v)) {
    toast(t('invalidUrl'));
    return;
  }
  save({ remoteUrl: v });
});
$('remote-url-reset').addEventListener('click', () => save({ remoteUrl: '' }));

$('open-panel').addEventListener('click', () => chrome.tabs.create({ url: chrome.runtime.getURL('panel.html') }));

function render() {
  for (const input of document.querySelectorAll('[data-setting]')) input.checked = !!settings[input.dataset.setting];
  for (const [id, key] of [['qr-corner', 'qrCorner'], ['qr-size', 'qrSize']]) {
    for (const b of $(id).querySelectorAll('button')) b.setAttribute('aria-checked', String(b.dataset.v === settings[key]));
  }
  if (document.activeElement !== $('remote-url')) $('remote-url').value = settings.remoteUrl;
  if (document.activeElement !== $('title')) $('title').value = settings.title;
  renderRoom();
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes.settings) {
    settings = normalizeSettings(changes.settings.newValue);
    render();
  }
  if (area === 'local' && changes.identity) {
    identity = changes.identity.newValue;
    renderRoom();
  }
});

if (location.hash && location.hash !== '#bienvenida') document.querySelector(location.hash)?.scrollIntoView();
render();
renderSites();
renderShortcuts();

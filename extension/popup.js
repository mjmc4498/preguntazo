import { REMOTE_URL, buildRemoteUrl, formatCode, getSettings, normalizeSettings, originPattern, requestOrigins, shortRemote } from './config.js';
import { qrPng, qrSvg } from './lib/qr.js';
import { applyI18n, t } from './lib/i18n.js';

applyI18n();

const $ = (id) => document.getElementById(id);
const sw = (type, extra = {}) => chrome.runtime.sendMessage({ to: 'sw', type, ...extra });
const nf = new Intl.NumberFormat('es');
const compact = new Intl.NumberFormat('es', { notation: 'compact', maximumFractionDigits: 1 });

let settings = await getSettings();
// Abrir el panel abre la sala: el QR queda listo para escanear.
let snap = await sw('session:start');
let renderedUrl = '';
// ?tab=<id>: el panel abierto como página (pruebas y capturas) actúa sobre esa pestaña.
const forcedTab = Number(new URLSearchParams(location.search).get('tab'));
const [tab] = forcedTab ? [await chrome.tabs.get(forcedTab).catch(() => null)] : await chrome.tabs.query({ active: true, currentWindow: true });
const pattern = originPattern(tab?.url);
let siteGranted = pattern ? await chrome.permissions.contains({ origins: [pattern] }) : false;
let pinned = tab?.id != null ? (await sw('overlay:pinned', { tabId: tab.id }))?.pinned === true : false;

// ---------------------------------------------------------------- utilidades

function roomUrl() {
  return snap?.identity?.code ? buildRemoteUrl(settings.remoteUrl || REMOTE_URL, snap.identity.code) : '';
}

let toastTimer = 0;
function toast(text) {
  const el = $('toast');
  el.textContent = text;
  el.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('on'), 2200);
}

function statusView(s) {
  if (!s.active) return ['muted', t('statusStopped')];
  if (s.status === 'error') return ['error', t('statusOffline')];
  if (s.status !== 'ready') return ['warn', t('statusConnecting')];
  if (s.count === 1) return ['ok', t('statusOne')];
  if (s.count > 1) return ['ok', t('statusMany', [nf.format(s.count)])];
  return ['ok', t('statusReady')];
}

// ---------------------------------------------------------------- render

function render() {
  const s = snap?.state || {};
  const [tone, text] = statusView(s);
  $('status').dataset.tone = tone;
  $('status-text').textContent = text;

  $('stopped').hidden = !!s.active;
  $('scan').hidden = !s.active;
  $('live').hidden = !s.active;
  for (const id of ['copy', 'download-qr', 'stop']) $(id).hidden = !s.active;

  const alert = $('alert');
  alert.hidden = !(s.active && s.status === 'error');
  if (!alert.hidden) alert.textContent = s.error === 'network' ? t('errorNetwork') : t('errorGeneric');
  if (!s.active) return;

  // QR y código
  const url = roomUrl();
  if (url && url !== renderedUrl) {
    renderedUrl = url;
    $('qr').innerHTML = qrSvg(url);
  }
  $('qr-card').classList.toggle('loading', s.status !== 'ready');
  $('code').textContent = formatCode(snap.identity?.code || '');
  $('short').textContent = shortRemote(settings.remoteUrl || REMOTE_URL);

  // Números
  $('n-people').textContent = nf.format(s.count || 0);
  const review = settings.moderation && s.pending > 0;
  $('n-questions').textContent = nf.format(review ? s.pending : s.unanswered || 0);
  $('l-questions').textContent = review ? t('statPending') : t('statQuestions');
  $('n-questions').parentElement.classList.toggle('warn', review);
  $('n-reactions').textContent = compact.format(s.reactions || 0);

  // Encuesta en curso
  const poll = s.poll;
  $('poll-mini').hidden = !poll;
  if (poll) {
    $('poll-mini').classList.toggle('closed', poll.state !== 'open');
    $('poll-q').textContent = poll.q;
    $('poll-n').textContent = `${poll.state === 'open' ? t('pollLive') : t('pollClosed')} · ${poll.total === 1 ? t('oneVote') : t('manyVotes', [nf.format(poll.total)])}`;
    $('poll-close').textContent = poll.state === 'open' ? t('pollClose') : t('pollHide');
  }

  // Esta pestaña
  const onThisTab = pinned || (s.overlays || []).some((o) => o.tabId === tab?.id);
  $('site-card').classList.toggle('disabled', !pattern);
  $('pin').disabled = !pattern;
  $('pin').checked = !!pattern && onThisTab;
  let host = '';
  try { host = new URL(tab?.url || '').hostname; } catch {}
  if (tab?.favIconUrl && pattern) {
    $('site-icon').src = tab.favIconUrl;
    $('site-icon').hidden = false;
    $('site-fallback').hidden = true;
  } else {
    $('site-icon').hidden = true;
    $('site-fallback').hidden = false;
    $('site-fallback').textContent = (host || '·').slice(0, 1);
  }
  $('site-sub').textContent = !pattern
    ? t('siteRestricted')
    : onThisTab
      ? t('siteShowing')
      : siteGranted && settings.autoFullscreen
        ? t('siteAuto')
        : t('siteOff');
  $('site-always').hidden = !pattern || siteGranted;
  $('site-always').textContent = t('siteAlways', [host]);

  $('big-qr').setAttribute('aria-pressed', String(!!s.bigQr));
}

// ---------------------------------------------------------------- acciones

async function ensureOverlay() {
  if (!pattern || pinned || (snap.state.overlays || []).some((o) => o.tabId === tab.id)) return;
  const res = await sw('overlay:pin', { tabId: tab.id, on: true });
  if (res?.ok) pinned = true;
}

$('start').addEventListener('click', async () => {
  snap = await sw('session:start');
  render();
});

$('stop').addEventListener('click', async () => {
  snap = await sw('session:stop');
  pinned = false;
  render();
});

$('options').addEventListener('click', () => chrome.runtime.openOptionsPage());

$('pin').addEventListener('change', async (e) => {
  const on = e.target.checked;
  const res = await sw('overlay:pin', { tabId: tab.id, on });
  if (res?.ok) pinned = on;
  else {
    e.target.checked = false;
    toast(t('siteRestricted'));
  }
  render();
});

$('site-always').addEventListener('click', async () => {
  // El diálogo de Chrome debe abrirse directamente desde el clic.
  const granted = await requestOrigins([pattern]);
  if (!granted) return;
  siteGranted = true;
  await sw('site:enabled', { tabId: tab.id });
  toast(t('siteAlwaysDone'));
  render();
});

$('big-qr').addEventListener('click', async () => {
  const on = !snap.state.bigQr;
  if (on) await ensureOverlay();
  await sw('cmd', { op: 'qr:big', on });
});

$('next-q').addEventListener('click', async () => {
  await ensureOverlay();
  const res = await sw('cmd', { op: 'q:next' });
  toast(res?.id ? t('nextShown') : t('noMoreQuestions'));
});

$('clear').addEventListener('click', async () => {
  await sw('cmd', { op: 'spot:clear' });
  toast(t('screenCleared'));
});

$('poll-close').addEventListener('click', async () => {
  const poll = snap.state.poll;
  if (!poll) return;
  await sw('cmd', { op: poll.state === 'open' ? 'poll:close' : 'poll:hide', id: poll.id });
});

$('open-panel').addEventListener('click', async () => {
  const url = chrome.runtime.getURL('panel.html');
  const [existing] = await chrome.tabs.query({ url });
  if (existing) {
    await chrome.tabs.update(existing.id, { active: true });
    await chrome.windows.update(existing.windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url });
  }
  window.close();
});

$('open-screen').addEventListener('click', async () => {
  // Ventana sin pestañas: se arrastra al proyector y se pone en pantalla completa.
  await chrome.windows.create({ url: chrome.runtime.getURL('pantalla.html'), type: 'popup', width: 1280, height: 760 });
  window.close();
});

$('copy').addEventListener('click', async () => {
  const url = roomUrl();
  if (!url) return;
  await navigator.clipboard.writeText(url).catch(() => {});
  toast(t('linkCopied'));
});

$('download-qr').addEventListener('click', async () => {
  const url = roomUrl();
  if (!url) return;
  const blob = await qrPng(url);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `Preguntazo-QR-${formatCode(snap.identity.code)}.png`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  toast(t('qrDownloaded'));
});

// ---------------------------------------------------------------- cambios

chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area === 'session' && changes.state) {
    snap = { ...snap, state: changes.state.newValue };
    if (!snap.state?.active) pinned = false;
    render();
  }
  if (area === 'local' && changes.identity) {
    snap = { ...snap, identity: changes.identity.newValue };
    render();
  }
  if (area === 'sync' && changes.settings) {
    settings = normalizeSettings(changes.settings.newValue);
    render();
  }
});

render();

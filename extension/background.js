// Preguntazo — service worker.
// Coordina la sala (documento offscreen con la conexión WebRTC del público), guarda
// las preguntas y encuestas, muestra la capa de reacciones sobre las diapositivas y
// atiende los atajos de teclado.

import { DEFAULT_SETTINGS, getSettings, grantedOrigins, normalizeSettings, randomCode } from './config.js';

const OFFSCREEN_PATH = 'offscreen.html';
const OVERLAY_SCRIPT = { id: 'preguntazo-overlay', js: ['lib/stage.js', 'content/overlay.js'] };
const EMPTY_STATE = { active: false, status: 'idle', error: null, count: 0, questions: 0, pending: 0, unanswered: 0, poll: null, bigQr: false, spot: null, overlays: [], reactions: 0 };
const SELF = new URL(chrome.runtime.getURL('')).origin;

// ---------------------------------------------------------------- ajustes

let settings = { ...DEFAULT_SETTINGS };
const settingsReady = getSettings().then((s) => { settings = s; });

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes.settings) {
    settings = normalizeSettings(changes.settings.newValue);
    toOffscreen({ type: 'settings', settings });
  }
});

// ---------------------------------------------------------------- estado de la sala

let state = null;

async function loadState() {
  if (!state) {
    const { state: saved } = await chrome.storage.session.get('state');
    state = { ...EMPTY_STATE, ...(saved || {}) };
  }
  return state;
}

async function patchState(patch) {
  await loadState();
  state = { ...state, ...patch };
  await chrome.storage.session.set({ state });
  updateBadge();
  return state;
}

function updateBadge() {
  const s = state || EMPTY_STATE;
  // El número del ícono: preguntas por revisar si se modera; si no, personas conectadas.
  const n = !s.active ? 0 : s.pending || s.count;
  chrome.action.setBadgeText({ text: n ? (n > 999 ? '999+' : String(n)) : '' });
  chrome.action.setBadgeBackgroundColor({ color: s.pending ? '#FF9F0A' : '#AF52DE' });
  chrome.action.setBadgeTextColor?.({ color: '#FFFFFF' });
}

// ---------------------------------------------------------------- código de la sala

let identityPromise = null;

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.identity?.newValue?.code) identityPromise = Promise.resolve(changes.identity.newValue);
});

function getIdentity(regenerate = false) {
  if (regenerate || !identityPromise) {
    identityPromise = (async () => {
      let identity = regenerate ? null : (await chrome.storage.local.get('identity')).identity;
      if (!identity?.code) {
        identity = { code: randomCode(), since: Date.now() };
        await chrome.storage.local.set({ identity });
      }
      return identity;
    })();
  }
  return identityPromise;
}

// ---------------------------------------------------------------- preguntas, encuestas y reacciones

// El documento offscreen tiene la sala en memoria y la envía aquí para guardarla:
// si Chrome se cierra a mitad de la charla, las preguntas siguen ahí al volver.
async function loadRoom() {
  const { room } = await chrome.storage.local.get('room');
  return room || null;
}

async function saveRoom(room) {
  if (room && typeof room === 'object') await chrome.storage.local.set({ room });
}

// ---------------------------------------------------------------- documento offscreen

let creatingOffscreen = null;

async function hasOffscreen() {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN_PATH)],
  });
  return contexts.length > 0;
}

async function ensureOffscreen() {
  if (await hasOffscreen()) return;
  creatingOffscreen ??= chrome.offscreen
    .createDocument({
      url: OFFSCREEN_PATH,
      reasons: ['WEB_RTC'],
      justification: 'Recibir por WebRTC las preguntas, los votos y las reacciones que envía el público desde sus celulares.',
    })
    .finally(() => { creatingOffscreen = null; });
  await creatingOffscreen;
}

async function closeOffscreen(reason) {
  if (!(await hasOffscreen())) return;
  await chrome.runtime.sendMessage({ to: 'offscreen', type: 'stop', reason }).catch(() => {});
  await chrome.offscreen.closeDocument().catch(() => {});
}

async function toOffscreen(msg) {
  if (!(await hasOffscreen())) return null;
  // «to» va al final: los mensajes reenviados desde el panel traen su propio «to: 'sw'».
  return chrome.runtime.sendMessage({ ...msg, to: 'offscreen' }).catch(() => null);
}

// ---------------------------------------------------------------- capa sobre las diapositivas

// Dos formas de mostrar la capa (QR, reacciones, pregunta y encuesta destacadas):
// · En una pestaña concreta: «Mostrar en esta pestaña» en el panel o un atajo de
//   teclado (permiso activeTab, sin pedir acceso a sitios).
// · Sola, al presentar en pantalla completa, en los sitios que el usuario permitió.
let scriptsQueue = Promise.resolve();

function syncContentScripts() {
  scriptsQueue = scriptsQueue.then(async () => {
    const origins = await grantedOrigins();
    const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [OVERLAY_SCRIPT.id] }).catch(() => []);
    if (!origins.length) {
      if (existing.length) await chrome.scripting.unregisterContentScripts({ ids: [OVERLAY_SCRIPT.id] }).catch(() => {});
      return;
    }
    const script = { ...OVERLAY_SCRIPT, matches: origins, runAt: 'document_idle', allFrames: false, persistAcrossSessions: true };
    if (existing.length) await chrome.scripting.updateContentScripts([script]);
    else await chrome.scripting.registerContentScripts([script]);
  }).catch((err) => console.warn('[Preguntazo] scripts', err));
  return scriptsQueue;
}

async function injectInto(tabId) {
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: OVERLAY_SCRIPT.js, injectImmediately: true });
    return true;
  } catch {
    return false;
  }
}

async function injectOpenTabs(origins) {
  if (!origins?.length) return;
  const tabs = await chrome.tabs.query({ url: origins }).catch(() => []);
  for (const tab of tabs) if (tab.id != null) injectInto(tab.id);
}

chrome.permissions.onAdded.addListener(async ({ origins }) => {
  await syncContentScripts();
  injectOpenTabs(origins);
});
chrome.permissions.onRemoved.addListener(() => syncContentScripts());

async function pinnedTabs() {
  const { pinned = [] } = await chrome.storage.session.get('pinned');
  return pinned;
}

async function setPinned(tabId, on) {
  const list = new Set(await pinnedTabs());
  if (on) list.add(tabId);
  else list.delete(tabId);
  await chrome.storage.session.set({ pinned: [...list] });
}

// Muestra u oculta la capa en una pestaña. Requiere activeTab (panel abierto o atajo)
// o acceso al sitio.
async function pinOverlay(tabId, on) {
  if (!Number.isInteger(tabId)) return { ok: false, error: 'tab' };
  await setPinned(tabId, on);
  if (on) {
    await startSession();
    if (!(await injectInto(tabId))) {
      await setPinned(tabId, false);
      return { ok: false, error: 'restricted' };
    }
  }
  await chrome.tabs.sendMessage(tabId, { type: 'overlay:pin', on }).catch(() => {});
  return { ok: true };
}

chrome.tabs.onRemoved.addListener((tabId) => { setPinned(tabId, false); });

// Avisa a las capas abiertas que la sala empezó o terminó.
async function notifyOverlays(active) {
  const tabs = new Set([...(await pinnedTabs()), ...((await loadState()).overlays || []).map((o) => o.tabId)]);
  for (const tabId of tabs) chrome.tabs.sendMessage(tabId, { type: 'overlay:session', active }).catch(() => {});
  if (active) {
    // Las pestañas de los sitios permitidos que ya estaban abiertas.
    const origins = await grantedOrigins();
    if (origins.length) {
      const open = await chrome.tabs.query({ url: origins }).catch(() => []);
      for (const tab of open) chrome.tabs.sendMessage(tab.id, { type: 'overlay:session', active }).catch(() => {});
    }
  }
}

// ---------------------------------------------------------------- sala

async function startSession() {
  await settingsReady;
  const s = await loadState();
  if (!s.active) {
    if (settings.newCodeEachSession) await getIdentity(true);
    await patchState({ ...EMPTY_STATE, active: true, status: 'starting' });
    notifyOverlays(true);
  }
  await ensureOffscreen();
  return snapshot();
}

async function stopSession() {
  await closeOffscreen('stopped');
  await patchState({ ...EMPTY_STATE });
  notifyOverlays(false);
  return snapshot();
}

async function resetCode() {
  await closeOffscreen('revoked');
  await getIdentity(true);
  const s = await loadState();
  await patchState({ count: 0, status: s.active ? 'starting' : 'idle' });
  if (s.active) await ensureOffscreen();
  return snapshot();
}

async function snapshot() {
  return { state: await loadState(), identity: await getIdentity() };
}

// ---------------------------------------------------------------- atajos de teclado

chrome.commands.onCommand.addListener(async (command, tab) => {
  const tabId = tab?.id;
  if (command === 'toggle-qr') {
    // El QR grande se muestra en la pestaña actual (el atajo concede activeTab).
    if (Number.isInteger(tabId)) await pinOverlay(tabId, true);
    await toOffscreen({ type: 'cmd', op: 'qr:big', toggle: true });
  } else if (command === 'next-question') {
    if (Number.isInteger(tabId)) await pinOverlay(tabId, true);
    await toOffscreen({ type: 'cmd', op: 'q:next' });
  } else if (command === 'clear-screen') {
    await toOffscreen({ type: 'cmd', op: 'spot:clear' });
  }
});

// ---------------------------------------------------------------- mensajes

const forward = (msg) => toOffscreen({ ...msg, type: 'cmd' });

// Páginas de la extensión (popup, panel, pantalla, ajustes) y documento offscreen.
const handlers = {
  'session:start': () => startSession(),
  'session:stop': () => stopSession(),
  'session:reset': () => resetCode(),
  'session:get': () => snapshot(),
  cmd: (msg) => forward(msg),
  'overlay:pin': (msg) => pinOverlay(msg.tabId, msg.on === true),
  'overlay:pinned': async (msg) => ({ pinned: (await pinnedTabs()).includes(msg.tabId) }),
  'site:enabled': async (msg) => {
    await syncContentScripts();
    if (Number.isInteger(msg.tabId)) await injectInto(msg.tabId);
    return { ok: true };
  },
  'scripts:sync': () => syncContentScripts(),

  // documento offscreen
  identity: () => getIdentity(),
  'offscreen:ready': async () => { await settingsReady; return { settings, room: await loadRoom() }; },
  status: (msg) => patchState({ status: msg.status, error: msg.error || null }),
  sync: (msg) => patchState({
    count: Number(msg.count) || 0,
    questions: Number(msg.questions) || 0,
    pending: Number(msg.pending) || 0,
    unanswered: Number(msg.unanswered) || 0,
    reactions: Number(msg.reactions) || 0,
    poll: msg.poll || null,
    bigQr: msg.bigQr === true,
    spot: msg.spot || null,
    overlays: Array.isArray(msg.overlays) ? msg.overlays : [],
  }),
  persist: (msg) => saveRoom(msg.room),
};

// Capa sobre las diapositivas (script de contenido).
const contentHandlers = {
  'overlay:hello': async (msg, sender) => {
    await settingsReady;
    const s = await loadState();
    const tabId = sender.tab?.id;
    return { active: s.active, pinned: (await pinnedTabs()).includes(tabId), auto: settings.autoFullscreen };
  },
};

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.to !== 'sw' || sender.id !== chrome.runtime.id) return;
  const trusted = sender.origin === SELF || (sender.url || '').startsWith(`${SELF}/`);
  const handler = trusted ? handlers[msg.type] || contentHandlers[msg.type] : contentHandlers[msg.type];
  if (!handler) return;
  Promise.resolve()
    .then(() => handler(msg, sender))
    .then((res) => sendResponse(res ?? null), (err) => sendResponse({ ok: false, error: String(err?.message || err) }));
  return true;
});

// ---------------------------------------------------------------- ciclo de vida

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  await chrome.storage.session.set({ state: { ...EMPTY_STATE }, pinned: [] });
  state = null;
  updateBadge();
  await syncContentScripts();
  if (reason === 'install') chrome.tabs.create({ url: chrome.runtime.getURL('options.html#bienvenida') });
});

chrome.runtime.onStartup.addListener(async () => {
  await settingsReady;
  syncContentScripts();
  if (settings.autoStart) startSession();
});

loadState().then(updateBadge);

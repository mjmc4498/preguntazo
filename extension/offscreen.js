// Preguntazo — documento offscreen.
// · Mantiene la sala: la conexión WebRTC (PeerJS) con el celular de cada persona del
//   público, y valida y limita cada mensaje que llega.
// · Guarda en memoria las preguntas, los votos, las encuestas y las reacciones (y los
//   envía al service worker para que sobrevivan a un cierre de Chrome).
// · Reparte la sala: a los celulares (cambios agrupados cada 300 ms), al panel del
//   presentador y a la capa que se dibuja sobre las diapositivas.

/* global Peer */

import { FALLBACK_ICE, ICE_ENDPOINT, REMOTE_URL, buildRemoteUrl, formatCode, normalizeSettings, peerIdFor, shortRemote } from './config.js';
import { qrPath } from './lib/qr.js';

const ICE_REFRESH_MS = 3 * 60 * 60 * 1000; // las credenciales duran 4 h
const LIVE_PORT = 'preguntazo-live';
const SELF = new URL(chrome.runtime.getURL('')).origin;
const FLUSH_MS = 300;
const COUNT_MS = 2000;
const PERSIST_MS = 800;
const STALE_MS = 45000;
const LIMIT = {
  question: 280, name: 32, questions: 500, perPerson: 40, askGap: 3000,
  polls: 40, options: 6, option: 80, pollQ: 160, word: 40, conns: 400,
};
const KINDS = ['single', 'multi', 'rating', 'words'];

const audience = new Map(); // conexión → { conn, pid, authed, … }
const people = new Map(); // persona (pid) → { name, since, conns }
const consumers = new Map(); // páginas de la extensión y capas sobre las diapositivas
let identity = null;
let settings = normalizeSettings({});
let iceConfig = FALLBACK_ICE;
let peer = null;
let stopped = false;
let status = 'starting';
let retryTimer = 0;
let retryDelay = 1000;
let consumerSeq = 0;
let qr = { n: 0, d: '' };
let room = emptyRoom();

const toSW = (msg) => chrome.runtime.sendMessage({ to: 'sw', ...msg }).catch(() => null);

function setStatus(next, error = null) {
  status = next;
  toSW({ type: 'status', status: next, error });
  touch('view', 'admin');
}

// ---------------------------------------------------------------- la sala en memoria

function emptyRoom() {
  return { seq: 0, questions: new Map(), polls: [], activePoll: null, spot: null, bigQr: false, totals: {}, reactions: 0, banned: new Set() };
}

function restoreRoom(saved) {
  const r = emptyRoom();
  if (!saved || typeof saved !== 'object') return r;
  r.seq = Number(saved.seq) || 0;
  for (const q of Array.isArray(saved.questions) ? saved.questions : []) {
    if (!q?.id || typeof q.text !== 'string') continue;
    r.questions.set(q.id, { ...q, votes: new Set(Array.isArray(q.votes) ? q.votes : []) });
  }
  for (const p of Array.isArray(saved.polls) ? saved.polls : []) {
    if (!p?.id || !KINDS.includes(p.kind)) continue;
    r.polls.push({ ...p, votes: new Map(Object.entries(p.votes || {})) });
  }
  r.activePoll = r.polls.some((p) => p.id === saved.activePoll) ? saved.activePoll : null;
  r.spot = saved.spot && typeof saved.spot === 'object' ? saved.spot : null;
  r.totals = saved.totals && typeof saved.totals === 'object' ? saved.totals : {};
  r.reactions = Number(saved.reactions) || 0;
  r.banned = new Set(Array.isArray(saved.banned) ? saved.banned : []);
  return r;
}

function serializeRoom() {
  return {
    v: 1,
    seq: room.seq,
    questions: [...room.questions.values()].map((q) => ({ ...q, votes: [...q.votes] })),
    polls: room.polls.map((p) => ({ ...p, votes: Object.fromEntries(p.votes) })),
    activePoll: room.activePoll,
    spot: room.spot,
    totals: room.totals,
    reactions: room.reactions,
    banned: [...room.banned],
  };
}

const nextId = (prefix) => prefix + (++room.seq).toString(36) + Math.random().toString(36).slice(2, 5);

// ---------------------------------------------------------------- envíos agrupados

// Cada cambio marca qué hay que enviar; cada 300 ms sale un solo mensaje por destino.
const dirty = { q: new Set(), del: new Set(), full: false, meta: false, poll: false, view: false, admin: false, sync: false, count: false, persist: false };
let flushTimer = 0;
let countTimer = 0;
let persistTimer = 0;
let lastCount = -1;

function touch(...kinds) {
  for (const k of kinds) dirty[k] = true;
  dirty.sync = true;
  if (kinds.includes('persist')) {
    clearTimeout(persistTimer);
    persistTimer = setTimeout(persist, PERSIST_MS);
  }
  flushTimer ||= setTimeout(flush, FLUSH_MS);
}

function touchQuestion(q, removed = false) {
  if (removed) {
    dirty.q.delete(q.id);
    dirty.del.add(q.id);
  } else {
    dirty.q.add(q.id);
  }
  touch('admin', 'view', 'persist');
}

function persist() {
  clearTimeout(persistTimer);
  return toSW({ type: 'persist', room: serializeRoom() });
}

function flush() {
  flushTimer = 0;
  if (dirty.full) {
    broadcast({ t: 'qs', all: settings.publicQuestions ? publicQuestions() : [] });
  } else if (settings.publicQuestions && (dirty.q.size || dirty.del.size)) {
    const upd = [];
    const del = [...dirty.del];
    for (const id of dirty.q) {
      const q = room.questions.get(id);
      if (q && q.status === 'live') upd.push(pubQ(q));
      else del.push(id);
    }
    broadcast({ t: 'qs', upd, del });
  }
  dirty.q.clear();
  dirty.del.clear();
  dirty.full = false;

  if (dirty.meta) broadcast({ t: 'room', room: meta() });
  if (dirty.poll) broadcastPoll();
  if (dirty.view) {
    const view = overlayView();
    for (const c of consumers.values()) if (c.kind) post(c, { t: 'view', view });
  }
  if (dirty.admin) {
    const admin = adminView();
    for (const c of consumers.values()) if (c.kind === 'panel') post(c, { t: 'admin', admin });
  }
  if (dirty.sync) syncSW();
  dirty.meta = dirty.poll = dirty.view = dirty.admin = dirty.sync = false;
}

// El número de personas conectadas cambia mucho al empezar: se envía cada 2 s.
function scheduleCount() {
  if (countTimer) return;
  countTimer = setTimeout(() => {
    countTimer = 0;
    if (people.size === lastCount) return;
    lastCount = people.size;
    broadcast({ t: 'count', n: people.size });
    touch('view', 'admin');
  }, COUNT_MS);
}

function syncSW() {
  let pending = 0;
  let unanswered = 0;
  for (const q of room.questions.values()) {
    if (q.status === 'pending') pending++;
    else if (q.status === 'live' && !q.answered) unanswered++;
  }
  const p = activePoll();
  toSW({
    type: 'sync',
    count: people.size,
    questions: room.questions.size,
    pending,
    unanswered,
    reactions: room.reactions,
    poll: p ? { id: p.id, q: p.q, state: p.state, total: p.votes.size } : null,
    bigQr: room.bigQr,
    spot: room.spot,
    overlays: [...consumers.values()].filter((c) => c.kind === 'overlay').map(({ tabId, origin, fullscreen }) => ({ tabId, origin, fullscreen: !!fullscreen })),
  });
}

function send(conn, msg) {
  try {
    if (conn?.open) conn.send(msg);
  } catch {}
}

function broadcast(msg) {
  for (const a of audience.values()) if (a.authed) send(a.conn, msg);
}

function post(c, msg) {
  try { c.port.postMessage(msg); } catch {}
}

// ---------------------------------------------------------------- vistas

function remoteBase() {
  return settings.remoteUrl || REMOTE_URL;
}

function roomUrl() {
  return identity ? buildRemoteUrl(remoteBase(), identity.code) : '';
}

function meta() {
  return {
    title: settings.title,
    qOpen: settings.questionsOpen,
    anon: settings.anonymous,
    list: settings.publicQuestions,
    results: settings.resultsLive,
    mod: settings.moderation,
    react: settings.reactionsOn,
    emojis: settings.emojis,
    count: people.size,
  };
}

const pubQ = (q) => ({ id: q.id, text: q.text, name: q.name, votes: q.votes.size, at: q.at, answered: q.answered, pinned: q.pinned });
const mineView = (q) => ({ id: q.id, text: q.text, status: q.status, answered: q.answered, votes: q.votes.size, at: q.at });

function sortedLive() {
  return [...room.questions.values()]
    .filter((q) => q.status === 'live')
    .sort((a, b) => (b.pinned - a.pinned) || (b.votes.size - a.votes.size) || (a.at - b.at));
}

function publicQuestions() {
  return sortedLive().slice(0, 200).map(pubQ);
}

function activePoll() {
  return room.activePoll ? room.polls.find((p) => p.id === room.activePoll) || null : null;
}

function results(p) {
  if (p.kind === 'rating') {
    const dist = [0, 0, 0, 0, 0];
    let sum = 0;
    for (const v of p.votes.values()) { dist[v - 1]++; sum += v; }
    return { dist, avg: p.votes.size ? Math.round((sum / p.votes.size) * 10) / 10 : 0 };
  }
  if (p.kind === 'words') {
    const words = new Map();
    for (const v of p.votes.values()) {
      const key = v.toLocaleLowerCase('es').normalize('NFD').replace(/[̀-ͯ]/g, '');
      const w = words.get(key) || { text: v, n: 0 };
      w.n++;
      words.set(key, w);
    }
    return { words: [...words.values()].sort((a, b) => b.n - a.n).slice(0, 40).map((w) => [w.text, w.n]) };
  }
  const counts = p.options.map(() => 0);
  for (const v of p.votes.values()) for (const i of Array.isArray(v) ? v : [v]) counts[i]++;
  return { counts };
}

function pollBase(p, withResults) {
  return {
    id: p.id,
    q: p.q,
    kind: p.kind,
    options: p.options,
    state: p.state,
    total: p.votes.size,
    results: withResults ? results(p) : null,
  };
}

function broadcastPoll() {
  const p = activePoll();
  if (!p) return broadcast({ t: 'poll', poll: null });
  const base = pollBase(p, settings.resultsLive || p.state === 'closed');
  for (const a of audience.values()) if (a.authed) send(a.conn, { t: 'poll', poll: { ...base, mine: p.votes.get(a.pid) ?? null } });
}

function spotView() {
  const s = room.spot;
  if (s?.kind === 'question') {
    const q = room.questions.get(s.id);
    if (q) return { kind: 'question', ...pubQ(q) };
  } else if (s?.kind === 'poll') {
    const p = room.polls.find((x) => x.id === s.id);
    if (p) return { kind: 'poll', poll: pollBase(p, true) };
  }
  return null;
}

function overlayView() {
  return {
    status,
    live: status === 'ready',
    title: settings.title,
    code: identity?.code || '',
    codeFmt: formatCode(identity?.code || ''),
    url: roomUrl(),
    short: shortRemote(remoteBase()),
    qr,
    badge: settings.qrBadge,
    corner: settings.qrCorner,
    size: settings.qrSize,
    bigQr: room.bigQr,
    react: settings.reactionsOn,
    count: people.size,
    spot: spotView(),
    top: sortedLive().filter((q) => !q.answered).slice(0, 5).map(pubQ),
  };
}

function adminView() {
  return {
    status,
    code: identity?.code || '',
    codeFmt: formatCode(identity?.code || ''),
    url: roomUrl(),
    short: shortRemote(remoteBase()),
    count: people.size,
    people: [...people.entries()].slice(0, 500).map(([pid, p]) => ({ pid, name: p.name, since: p.since, devices: p.conns.size, asked: p.asked || 0 })),
    questions: [...room.questions.values()].map((q) => ({ id: q.id, text: q.text, name: q.name, pid: q.pid, at: q.at, votes: q.votes.size, status: q.status, answered: q.answered, pinned: q.pinned })),
    polls: room.polls.map((p) => ({ ...pollBase(p, true), createdAt: p.createdAt, openedAt: p.openedAt || 0, closedAt: p.closedAt || 0 })),
    activePoll: room.activePoll,
    spot: room.spot,
    bigQr: room.bigQr,
    totals: room.totals,
    reactions: room.reactions,
    overlays: [...consumers.values()].filter((c) => c.kind === 'overlay').map(({ tabId, origin, title }) => ({ tabId, origin, title })),
  };
}

// ---------------------------------------------------------------- conexión con el servidor de señalización

function connect() {
  if (stopped) return;
  clearTimeout(retryTimer);
  setStatus('connecting');
  // debug: 0 — los avisos internos de PeerJS se manejan abajo; si se imprimieran,
  // Chrome los mostraría como errores en la página de Extensiones.
  peer = new Peer(peerIdFor(identity.code), { debug: 0, config: iceConfig });
  const current = peer;

  current.on('open', () => {
    retryDelay = 1000;
    setStatus('ready');
  });
  current.on('connection', onConnection);
  // El público no envía audio ni video.
  current.on('call', (call) => { try { call.close(); } catch {} });
  current.on('disconnected', () => {
    if (stopped || current.destroyed) return;
    scheduleRetry(() => { if (!current.destroyed && current.disconnected) current.reconnect(); });
  });
  current.on('error', (err) => {
    if (stopped) return;
    switch (err.type) {
      case 'unavailable-id':
        // El servidor aún no liberó el identificador de la sesión anterior: se reintenta
        // (destruir el peer abierto cortaría al público).
        setStatus('connecting');
        if (current.destroyed) scheduleRetry(connect);
        else scheduleRetry(() => { if (!current.destroyed && current.disconnected) current.reconnect(); });
        break;
      case 'browser-incompatible':
      case 'invalid-id':
      case 'invalid-key':
      case 'ssl-unavailable':
        setStatus('error', err.type);
        break;
      case 'network':
      case 'server-error':
      case 'socket-error':
      case 'socket-closed':
        setTimeout(() => setStatus('error', 'network'), 0);
        if (current.destroyed) scheduleRetry(connect);
        else scheduleRetry(() => { if (!current.destroyed && current.disconnected) current.reconnect(); });
        break;
      default:
        console.debug('[Preguntazo]', err.type, err.message);
    }
  });
}

function scheduleRetry(fn) {
  clearTimeout(retryTimer);
  retryTimer = setTimeout(fn, retryDelay);
  retryDelay = Math.min(retryDelay * 2, 15000);
}

// ---------------------------------------------------------------- validación

function clean(v, max) {
  return typeof v === 'string'
    ? v.normalize('NFC').replace(/[\u0000-\u0008\u000b-\u001f\u007f​-‏‪-‮⁦-⁩]/g, '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, max)
    : '';
}

function int(v, min, max) {
  const n = Number(v);
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
}

const validPid = (v) => typeof v === 'string' && /^[a-z0-9]{8,32}$/.test(v);

function safeParse(text) {
  try { return JSON.parse(text); } catch { return null; }
}

// ---------------------------------------------------------------- el público

function onConnection(conn) {
  if (audience.size >= LIMIT.conns) {
    conn.on('open', () => { send(conn, { t: 'bye', reason: 'full' }); setTimeout(() => conn.close(), 300); });
    return;
  }
  const a = { id: conn.connectionId, conn, pid: '', authed: false, since: Date.now(), seen: Date.now(), lastAsk: 0, tokens: 15, refill: Date.now() };
  audience.set(a.id, a);
  const authTimer = setTimeout(() => { if (!a.authed) conn.close(); }, 10000);

  conn.on('data', (raw) => {
    const msg = typeof raw === 'string' ? safeParse(raw) : raw;
    if (!msg || typeof msg !== 'object' || typeof msg.t !== 'string') return;
    a.seen = Date.now();
    if (!a.authed) {
      if (msg.t === 'hello' && validPid(msg.pid)) {
        clearTimeout(authTimer);
        join(a, msg);
      } else {
        conn.close();
      }
      return;
    }
    onAudienceMessage(a, msg);
  });

  conn.on('close', () => {
    clearTimeout(authTimer);
    leave(a);
  });
  conn.on('error', () => {});
}

function join(a, msg) {
  if (room.banned.has(msg.pid)) {
    send(a.conn, { t: 'bye', reason: 'kicked' });
    setTimeout(() => a.conn.close(), 300);
    return;
  }
  a.authed = true;
  a.pid = msg.pid;
  let person = people.get(a.pid);
  if (!person) {
    person = { name: '', since: Date.now(), conns: new Set(), asked: 0 };
    people.set(a.pid, person);
  }
  person.conns.add(a);
  const name = clean(msg.name, LIMIT.name);
  if (name) person.name = name;
  person.asked = [...room.questions.values()].filter((q) => q.pid === a.pid).length;

  const p = activePoll();
  send(a.conn, {
    t: 'welcome',
    v: 1,
    now: Date.now(),
    room: meta(),
    qs: settings.publicQuestions ? publicQuestions() : [],
    mine: [...room.questions.values()].filter((q) => q.pid === a.pid).map(mineView),
    voted: [...room.questions.values()].filter((q) => q.votes.has(a.pid)).map((q) => q.id),
    poll: p ? { ...pollBase(p, settings.resultsLive || p.state === 'closed'), mine: p.votes.get(a.pid) ?? null } : null,
    name: person.name,
  });
  scheduleCount();
  touch('admin');
}

function leave(a) {
  if (!audience.delete(a.id) || !a.authed) return;
  const person = people.get(a.pid);
  if (person) {
    person.conns.delete(a);
    if (!person.conns.size) people.delete(a.pid);
  }
  scheduleCount();
  touch('admin');
}

function toAuthor(pid, msg) {
  const person = people.get(pid);
  if (person) for (const a of person.conns) send(a.conn, msg);
}

function onAudienceMessage(a, msg) {
  switch (msg.t) {
    case 'ping':
      send(a.conn, { t: 'pong', ts: Number(msg.ts) || 0 });
      return;
    case 'name': {
      const person = people.get(a.pid);
      if (person) {
        person.name = clean(msg.name, LIMIT.name);
        touch('admin');
      }
      return;
    }
    case 'ask':
      send(a.conn, { t: 'done', what: 'ask', cid: clean(msg.cid, 20), ...ask(a, msg) });
      return;
    case 'up':
      upvote(a, msg);
      return;
    case 'v':
      send(a.conn, { t: 'done', what: 'vote', ...vote(a, msg) });
      return;
    case 'r':
      react(a, msg);
      return;
  }
}

function ask(a, msg) {
  if (!settings.questionsOpen) return { ok: false, error: 'closed' };
  const text = clean(msg.text, LIMIT.question);
  if (text.length < 2) return { ok: false, error: 'empty' };
  const now = Date.now();
  if (now - a.lastAsk < LIMIT.askGap) return { ok: false, error: 'slow' };
  const person = people.get(a.pid);
  if ((person?.asked || 0) >= LIMIT.perPerson) return { ok: false, error: 'limit' };
  if (room.questions.size >= LIMIT.questions) return { ok: false, error: 'full' };
  const anon = msg.anon === true && settings.anonymous;
  if (!anon && !person?.name && !settings.anonymous) return { ok: false, error: 'name' };
  a.lastAsk = now;
  if (person) person.asked = (person.asked || 0) + 1;
  const q = {
    id: nextId('q'),
    text,
    name: anon ? '' : person?.name || '',
    pid: a.pid,
    at: now,
    votes: new Set(),
    status: settings.moderation ? 'pending' : 'live',
    answered: false,
    pinned: false,
  };
  room.questions.set(q.id, q);
  touchQuestion(q);
  if (q.status === 'live' && settings.newQuestionToast) {
    for (const c of consumers.values()) if (c.kind === 'overlay' || c.kind === 'pantalla') post(c, { t: 'toast', text: q.text, name: q.name });
  }
  return { ok: true, q: mineView(q) };
}

function upvote(a, msg) {
  const q = room.questions.get(String(msg.id));
  if (!q || q.status !== 'live' || q.pid === a.pid) return;
  const had = q.votes.has(a.pid);
  if (msg.on === true && !had) q.votes.add(a.pid);
  else if (msg.on === false && had) q.votes.delete(a.pid);
  else return;
  touchQuestion(q);
  if (q.pid) toAuthor(q.pid, { t: 'mine', q: mineView(q) });
}

function cleanChoice(p, c) {
  switch (p.kind) {
    case 'single':
      return int(c, 0, p.options.length - 1);
    case 'multi': {
      if (!Array.isArray(c)) return null;
      const picks = [...new Set(c.map((x) => int(x, 0, p.options.length - 1)))];
      return picks.length && !picks.includes(null) ? picks.sort((x, y) => x - y) : null;
    }
    case 'rating':
      return int(c, 1, 5);
    case 'words': {
      const w = clean(c, LIMIT.word).replace(/\n/g, ' ').replace(/^[\s.,;:!¡?¿"'()-]+|[\s.,;:!¡?¿"'()-]+$/g, '');
      return w.length ? w : null;
    }
  }
  return null;
}

function vote(a, msg) {
  const p = activePoll();
  if (!p || p.id !== msg.id || p.state !== 'open') return { ok: false, error: 'closed' };
  const choice = cleanChoice(p, msg.c);
  if (choice == null) return { ok: false, error: 'invalid' };
  p.votes.set(a.pid, choice);
  touch('poll', 'admin', 'persist');
  if (room.spot?.kind === 'poll' && room.spot.id === p.id) touch('view');
  return { ok: true, id: p.id, mine: choice };
}

// ---------------------------------------------------------------- reacciones

// Cada celular puede enviar hasta 6 reacciones por segundo (ráfagas de 15). Las de todo
// el público se juntan y salen hacia las diapositivas cada 120 ms.
const pendingReactions = new Map();
let reactTimer = 0;

function react(a, msg) {
  if (!settings.reactionsOn) return;
  const idx = int(msg.e, 0, settings.emojis.length - 1);
  const n = int(msg.n, 1, 10);
  if (idx == null || n == null) return;
  const now = Date.now();
  a.tokens = Math.min(15, a.tokens + ((now - a.refill) / 1000) * 6);
  a.refill = now;
  const allowed = Math.min(n, Math.floor(a.tokens));
  if (allowed <= 0) return;
  a.tokens -= allowed;
  const emoji = settings.emojis[idx];
  room.totals[emoji] = (room.totals[emoji] || 0) + allowed;
  room.reactions += allowed;
  queueReaction(emoji, allowed);
  touch('persist');
  throttleAdmin();
}

function queueReaction(emoji, n) {
  pendingReactions.set(emoji, (pendingReactions.get(emoji) || 0) + n);
  reactTimer ||= setTimeout(() => {
    reactTimer = 0;
    const list = [...pendingReactions.entries()];
    pendingReactions.clear();
    for (const c of consumers.values()) if (c.kind === 'overlay' || c.kind === 'pantalla' || c.kind === 'panel') post(c, { t: 'react', list });
  }, 120);
}

let adminThrottle = 0;
function throttleAdmin() {
  adminThrottle ||= setTimeout(() => { adminThrottle = 0; touch('admin'); }, 1000);
}

// ---------------------------------------------------------------- órdenes del presentador

function findQ(id) {
  return room.questions.get(String(id)) || null;
}

function findPoll(id) {
  return room.polls.find((p) => p.id === id) || null;
}

function cleanPoll(raw) {
  const q = clean(raw?.q, LIMIT.pollQ);
  const kind = KINDS.includes(raw?.kind) ? raw.kind : 'single';
  let options = [];
  if (kind === 'single' || kind === 'multi') {
    options = (Array.isArray(raw?.options) ? raw.options : []).map((o) => clean(o, LIMIT.option).replace(/\n/g, ' ')).filter(Boolean).slice(0, LIMIT.options);
    if (options.length < 2) return null;
  }
  if (!q) return null;
  return { q, kind, options };
}

const ok = (extra = {}) => ({ ok: true, ...extra });
const fail = (error) => ({ ok: false, error });

function command(msg) {
  const op = msg.op;
  switch (op) {
    // ---- preguntas
    case 'q:status': {
      const q = findQ(msg.id);
      if (!q || !['live', 'hidden'].includes(msg.status)) return fail('not-found');
      q.status = msg.status;
      if (q.status === 'hidden' && room.spot?.kind === 'question' && room.spot.id === q.id) room.spot = null;
      touchQuestion(q);
      toAuthor(q.pid, { t: 'mine', q: mineView(q) });
      return ok();
    }
    case 'q:answered': {
      const q = findQ(msg.id);
      if (!q) return fail('not-found');
      q.answered = msg.on !== false;
      q.answeredAt = q.answered ? Date.now() : 0;
      touchQuestion(q);
      toAuthor(q.pid, { t: 'mine', q: mineView(q) });
      return ok();
    }
    case 'q:pin': {
      const q = findQ(msg.id);
      if (!q) return fail('not-found');
      q.pinned = msg.on !== false;
      touchQuestion(q);
      return ok();
    }
    case 'q:delete': {
      const q = findQ(msg.id);
      if (!q) return fail('not-found');
      room.questions.delete(q.id);
      if (room.spot?.kind === 'question' && room.spot.id === q.id) room.spot = null;
      const person = people.get(q.pid);
      if (person) person.asked = Math.max(0, (person.asked || 1) - 1);
      touchQuestion(q, true);
      toAuthor(q.pid, { t: 'mine', q: { id: q.id, status: 'deleted' } });
      return ok();
    }
    case 'q:spot': {
      const q = msg.id == null ? null : findQ(msg.id);
      if (!q || (room.spot?.kind === 'question' && room.spot.id === q.id)) room.spot = null;
      else {
        if (q.status !== 'live') {
          q.status = 'live';
          touchQuestion(q);
          toAuthor(q.pid, { t: 'mine', q: mineView(q) });
        }
        room.spot = { kind: 'question', id: q.id };
        room.bigQr = false;
      }
      touch('view', 'admin', 'persist');
      return ok({ id: room.spot?.id || null });
    }
    case 'q:next': {
      // Marca como respondida la pregunta en pantalla y muestra la siguiente más votada.
      const current = room.spot?.kind === 'question' ? findQ(room.spot.id) : null;
      if (current && !current.answered) {
        current.answered = true;
        current.answeredAt = Date.now();
        touchQuestion(current);
        toAuthor(current.pid, { t: 'mine', q: mineView(current) });
      }
      const next = sortedLive().find((q) => !q.answered && q !== current);
      room.spot = next ? { kind: 'question', id: next.id } : null;
      if (next) room.bigQr = false;
      touch('view', 'admin', 'persist');
      return ok({ id: next?.id || null });
    }

    // ---- encuestas
    case 'poll:save': {
      const data = cleanPoll(msg.poll);
      if (!data) return fail('invalid');
      const existing = msg.poll?.id ? findPoll(msg.poll.id) : null;
      if (existing) {
        const changed = existing.kind !== data.kind || existing.options.join('\n') !== data.options.join('\n');
        if (changed && existing.votes.size) return fail('locked');
        Object.assign(existing, data);
      } else {
        if (room.polls.length >= LIMIT.polls) return fail('limit');
        room.polls.push({ id: nextId('p'), ...data, state: 'draft', votes: new Map(), createdAt: Date.now() });
      }
      touch('admin', 'persist', 'poll', 'view');
      return ok({ id: existing?.id || room.polls[room.polls.length - 1].id });
    }
    case 'poll:delete': {
      const p = findPoll(msg.id);
      if (!p) return fail('not-found');
      room.polls = room.polls.filter((x) => x !== p);
      if (room.activePoll === p.id) room.activePoll = null;
      if (room.spot?.kind === 'poll' && room.spot.id === p.id) room.spot = null;
      touch('admin', 'persist', 'poll', 'view');
      return ok();
    }
    case 'poll:open': {
      const p = findPoll(msg.id);
      if (!p) return fail('not-found');
      for (const other of room.polls) {
        if (other !== p && other.state === 'open') {
          other.state = 'closed';
          other.closedAt = Date.now();
        }
      }
      p.state = 'open';
      p.openedAt = Date.now();
      room.activePoll = p.id;
      // Si en pantalla estaba otra encuesta, se cambia por esta.
      if (room.spot?.kind === 'poll') room.spot = { kind: 'poll', id: p.id };
      touch('admin', 'persist', 'poll', 'view');
      return ok();
    }
    case 'poll:close': {
      const p = findPoll(msg.id);
      if (!p) return fail('not-found');
      p.state = 'closed';
      p.closedAt = Date.now();
      touch('admin', 'persist', 'poll', 'view');
      return ok();
    }
    case 'poll:hide': {
      // Quita la encuesta de los celulares (y de la pantalla).
      const p = findPoll(msg.id);
      if (p && p.state === 'open') { p.state = 'closed'; p.closedAt = Date.now(); }
      if (room.activePoll === msg.id) room.activePoll = null;
      if (room.spot?.kind === 'poll' && room.spot.id === msg.id) room.spot = null;
      touch('admin', 'persist', 'poll', 'view');
      return ok();
    }
    case 'poll:reset': {
      const p = findPoll(msg.id);
      if (!p) return fail('not-found');
      p.votes.clear();
      touch('admin', 'persist', 'poll', 'view');
      return ok();
    }
    case 'poll:spot': {
      const p = msg.id == null ? null : findPoll(msg.id);
      if (!p || (room.spot?.kind === 'poll' && room.spot.id === p.id)) room.spot = null;
      else {
        room.spot = { kind: 'poll', id: p.id };
        room.bigQr = false;
      }
      touch('view', 'admin', 'persist');
      return ok({ id: room.spot?.id || null });
    }

    // ---- pantalla
    case 'spot:clear':
      room.spot = null;
      room.bigQr = false;
      touch('view', 'admin', 'persist');
      return ok();
    case 'qr:big':
      room.bigQr = msg.toggle ? !room.bigQr : msg.on === true;
      touch('view', 'admin');
      return ok({ on: room.bigQr });
    case 'react:test': {
      const emojis = settings.emojis;
      for (let i = 0; i < 18; i++) setTimeout(() => queueReaction(emojis[i % emojis.length], 1 + (i % 3)), i * 90);
      return ok();
    }

    // ---- sala
    case 'room:clear': {
      room.questions.clear();
      room.totals = {};
      room.reactions = 0;
      room.spot = null;
      room.bigQr = false;
      room.activePoll = null;
      room.banned.clear();
      for (const p of room.polls) {
        p.votes.clear();
        p.state = 'draft';
        p.openedAt = p.closedAt = 0;
      }
      for (const person of people.values()) person.asked = 0;
      for (const a of audience.values()) if (a.authed) send(a.conn, { t: 'mine', reset: true });
      touch('full', 'admin', 'view', 'poll', 'persist');
      return ok();
    }
    case 'kick': {
      if (!validPid(msg.pid)) return fail('not-found');
      room.banned.add(msg.pid);
      toAuthor(msg.pid, { t: 'bye', reason: 'kicked' });
      const person = people.get(msg.pid);
      if (person) for (const a of person.conns) setTimeout(() => a.conn.close(), 300);
      touch('admin', 'persist');
      return ok();
    }
  }
  return fail('unknown');
}

// ---------------------------------------------------------------- páginas y capas (puertos)

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== LIVE_PORT || port.sender?.id !== chrome.runtime.id) return;
  const url = port.sender.url || '';
  const trusted = url.startsWith(`${SELF}/`);
  let origin = '';
  try { origin = new URL(url).host; } catch {}
  const c = { id: ++consumerSeq, port, kind: null, trusted, tabId: port.sender.tab?.id ?? null, origin, title: port.sender.tab?.title || '', fullscreen: false };
  consumers.set(c.id, c);
  port.onMessage.addListener((msg) => onConsumerMessage(c, msg));
  port.onDisconnect.addListener(() => {
    consumers.delete(c.id);
    touch('admin');
  });
});

function onConsumerMessage(c, msg) {
  if (!msg || typeof msg !== 'object') return;
  if (msg.t === 'hello') {
    const kind = ['overlay', 'pantalla', 'panel'].includes(msg.kind) ? msg.kind : 'overlay';
    if (kind !== 'overlay' && !c.trusted) {
      c.port.disconnect();
      consumers.delete(c.id);
      return;
    }
    c.kind = kind;
    c.fullscreen = msg.fullscreen === true;
    post(c, { t: 'view', view: overlayView() });
    if (kind === 'panel') post(c, { t: 'admin', admin: adminView() });
    touch('admin');
  } else if (msg.t === 'fullscreen') {
    c.fullscreen = msg.on === true;
    touch('admin');
  } else if (msg.t === 'cmd' && c.trusted) {
    post(c, { t: 'ack', rid: msg.rid, ...command(msg) });
  }
}

// ---------------------------------------------------------------- service worker

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.to !== 'offscreen' || sender.id !== chrome.runtime.id) return;
  switch (msg.type) {
    case 'settings': {
      const before = settings;
      settings = normalizeSettings(msg.settings);
      if (before.publicQuestions !== settings.publicQuestions) dirty.full = true;
      if (before.remoteUrl !== settings.remoteUrl) qr = qrPath(roomUrl());
      touch('meta', 'poll', 'view', 'admin');
      sendResponse({ ok: true });
      break;
    }
    case 'cmd':
      sendResponse(command(msg));
      break;
    case 'stop':
      stopped = true;
      clearTimeout(retryTimer);
      broadcast({ t: 'bye', reason: msg.reason || 'stopped' });
      for (const c of consumers.values()) post(c, { t: 'bye' });
      Promise.all([persist(), new Promise((r) => setTimeout(r, 250))]).then(() => {
        try { peer?.destroy(); } catch {}
        sendResponse({ ok: true });
      });
      return true;
  }
});

// Conexiones que dejaron de responder (el celular se apagó o perdió la red).
setInterval(() => {
  const now = Date.now();
  for (const a of audience.values()) if (now - a.seen > STALE_MS) { try { a.conn.close(); } catch {} leave(a); }
}, 15000);

// ---------------------------------------------------------------- retransmisión (TURN)

async function loadIce() {
  if (!ICE_ENDPOINT) return FALLBACK_ICE;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 4000);
  try {
    const res = await fetch(ICE_ENDPOINT, { signal: ctrl.signal, cache: 'no-store' });
    if (!res.ok) throw new Error(String(res.status));
    const data = await res.json();
    if (!Array.isArray(data.iceServers) || !data.iceServers.length) throw new Error('sin servidores');
    return { iceServers: data.iceServers };
  } catch (err) {
    console.debug('[Preguntazo] retransmisión no disponible:', err.message);
    return FALLBACK_ICE;
  } finally {
    clearTimeout(timer);
  }
}

setInterval(async () => {
  iceConfig = await loadIce();
  if (peer && !peer.destroyed) peer.options.config = iceConfig;
}, ICE_REFRESH_MS);

// ---------------------------------------------------------------- inicio

(async () => {
  identity = await toSW({ type: 'identity' });
  if (!identity?.code) {
    setStatus('error', 'identity');
    return;
  }
  const boot = await toSW({ type: 'offscreen:ready' });
  settings = normalizeSettings(boot?.settings);
  room = restoreRoom(boot?.room);
  qr = qrPath(roomUrl());
  touch('view', 'admin');
  iceConfig = await loadIce();
  connect();
})();

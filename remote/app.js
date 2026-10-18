// Preguntazo — página del público.
// Se conecta por WebRTC (PeerJS) con la extensión de Chrome del presentador: envía
// preguntas, votos y reacciones, y recibe las preguntas del resto de la sala y la
// encuesta en curso. Sin cuentas: cada celular tiene un identificador aleatorio que
// solo sirve para recordar sus votos y sus preguntas.

/* global Peer */
(() => {
  'use strict';

  const VERSION = '1.0.0';
  const ID_PREFIX = 'preguntazo-';
  const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

  // Worker de Cloudflare que entrega credenciales temporales de retransmisión (TURN)
  // para redes que bloquean la conexión directa (por ejemplo, el Wi-Fi de un auditorio).
  const ICE_ENDPOINT = 'https://mando-turn.mjmc4498.workers.dev/ice';
  const FALLBACK_ICE = {
    iceServers: [{ urls: 'stun:stun.cloudflare.com:3478' }, { urls: 'stun:stun.l.google.com:19302' }],
  };
  const ICE_REFRESH_MS = 3 * 60 * 60 * 1000;
  const MAX_TEXT = 280;
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const app = $('#app');
  const nf = new Intl.NumberFormat('es');

  // ================================================================ textos

  const TEXT = {
    settings: 'Ajustes', retry: 'Reintentar', done: 'Listo', privacy: 'Privacidad', madeBy: 'Creado por Miguel Mogrovejo',
    haptics: 'Vibración', latency: 'Latencia', roomCode: 'Código de la sala', yourName: 'Tu nombre', leave: 'Salir de esta sala',
    connected: 'Conectado', connecting: 'Conectando…', reconnecting: 'Reconectando…', offline: 'Sin conexión', waiting: 'Esperando la sala…',
    person: '{n} persona', people: '{n} personas',
    tabQuestions: 'Preguntas', tabPoll: 'Encuesta', reactions: 'Reacciones',
    askPlaceholder: 'Escribe tu pregunta…', askAnon: 'Anónima', send: 'Enviar',
    askAs: 'Preguntarás como {name}', askAsAnon: 'Tu pregunta será anónima', askNeedName: 'Toca para escribir tu nombre',
    questionsClosed: 'El presentador cerró las preguntas por ahora. Puedes votar las que ya están.',
    yourQuestions: 'Tus preguntas', audienceQuestions: 'Preguntas del público', sortTop: 'Populares', sortNew: 'Recientes',
    noQuestionsTitle: 'Sé la primera pregunta', noQuestionsBody: 'Escribe arriba lo que quieras preguntar. Las demás personas podrán votarla.',
    anonymous: 'Anónimo', yours: 'Tuya', answered: 'Respondida', pinned: 'Destacada', pending: 'En revisión', notPublished: 'No publicada', published: 'Publicada',
    justNow: 'ahora', minAgo: 'hace {n} min', hourAgo: 'hace {n} h',
    sent: 'Pregunta enviada', sentReview: 'Enviada: el presentador la revisará', approved: 'Tu pregunta ya es visible para todos',
    answeredToast: '¡Respondieron tu pregunta!', hiddenToast: 'El presentador no publicó tu pregunta',
    errClosed: 'Las preguntas están cerradas', errSlow: 'Espera unos segundos antes de enviar otra', errLimit: 'Llegaste al máximo de preguntas',
    errFull: 'La sala ya no recibe más preguntas', errName: 'Escribe tu nombre para preguntar', errEmpty: 'Escribe una pregunta un poco más larga',
    notConnected: 'Sin conexión con la sala', cantVoteOwn: 'No puedes votar tu propia pregunta',
    pollLive: 'Encuesta en vivo', pollClosed: 'Votación cerrada', oneVote: '1 voto', manyVotes: '{n} votos',
    hintSingle: 'Elige una opción.', hintMulti: 'Puedes elegir varias opciones.', hintRating: 'Toca las estrellas para calificar.', hintWords: 'Responde con una palabra o una frase corta.',
    sendVotes: 'Enviar votos', updateVotes: 'Actualizar voto', wordsPlaceholder: 'Tu respuesta', voted: '¡Voto enviado!', change: 'Cambiar',
    yourAnswer: 'Tu respuesta: «{w}»', waitResults: 'Verás los resultados cuando se cierre la votación.',
    newPoll: '¡Nueva encuesta! Vota ahora', voteSent: 'Voto enviado', voteClosed: 'La votación ya cerró', voteFailed: 'No se pudo enviar el voto',
    noPollTitle: 'No hay encuestas abiertas', noPollBody: 'Cuando el presentador abra una encuesta, aparecerá aquí y te avisaremos.',
    joinKicker: 'Te damos la bienvenida a', joinDefaultTitle: 'la charla', joinBody: 'Escribe tu nombre si quieres que aparezca junto a tus preguntas. Puedes dejarlo vacío.',
    joinBodyRequired: 'Escribe tu nombre: aparecerá junto a tus preguntas.', joinBtn: 'Entrar', joinFine: 'Sin cuentas ni apps. Tus preguntas solo se ven en esta sala.',
    namePlaceholder: 'Tu nombre (opcional)', nameRequiredPlaceholder: 'Tu nombre',
    enterTitle: 'Entra a la sala', enterBody: 'Escribe el código que aparece en la pantalla de la charla.', enterBtn: 'Entrar', badCode: 'El código tiene 6 letras y números, por ejemplo K7Q-M4P.',
    otherRoom: 'Entrar a otra sala',
    gateConnectingTitle: 'Conectando…', gateConnectingBody: 'Buscando la sala.',
    gateWaitingTitle: 'Esperando la sala', gateWaitingBody: 'El presentador aún no abrió la sala (o el código no es correcto). Esta página se conectará sola.',
    gateOfflineTitle: 'Sin conexión', gateOfflineBody: 'Revisa la conexión a internet de tu celular. Si el Wi-Fi del lugar falla, prueba con tus datos móviles.',
    gateEndedTitle: 'La sala se cerró', gateEndedBody: 'Gracias por participar. Si vuelve a abrirse, te conectarás solo.',
    gateDeniedTitle: 'Código no válido', gateDeniedBody: 'Este código ya no funciona. Escanea el QR nuevo de la pantalla.',
    gateKickedTitle: 'Desconectado', gateKickedBody: 'El presentador te desconectó de la sala.',
    gateFullTitle: 'La sala está llena', gateFullBody: 'No caben más personas por ahora. Inténtalo en unos minutos.',
    gateUnsupportedTitle: 'Navegador no compatible', gateUnsupportedBody: 'Abre este enlace en Chrome o Safari actualizados.',
  };
  const t = (key, vars) => {
    let s = TEXT[key] ?? key;
    if (vars) for (const [k, v] of Object.entries(vars)) s = s.replace(`{${k}}`, v);
    return s;
  };

  document.documentElement.lang = 'es';
  for (const el of $$('[data-t]')) el.textContent = t(el.dataset.t);
  for (const el of $$('[data-t-aria]')) el.setAttribute('aria-label', t(el.dataset.tAria));
  for (const el of $$('[data-t-ph]')) el.placeholder = t(el.dataset.tPh);
  $('#version').textContent = VERSION;

  // ================================================================ preferencias

  const store = {
    get(key, fallback) {
      try {
        const raw = localStorage.getItem(`preguntazo.${key}`);
        return raw == null ? fallback : JSON.parse(raw);
      } catch { return fallback; }
    },
    set(key, value) {
      try {
        if (value == null) localStorage.removeItem(`preguntazo.${key}`);
        else localStorage.setItem(`preguntazo.${key}`, JSON.stringify(value));
      } catch {}
    },
  };

  const prefs = { haptics: true, ...store.get('prefs', {}) };
  const savePrefs = () => store.set('prefs', prefs);

  function randomId(length) {
    const abc = 'abcdefghijkmnpqrstuvwxyz23456789';
    return Array.from(crypto.getRandomValues(new Uint8Array(length)), (b) => abc[b & 31]).join('');
  }

  let pid = store.get('pid', '');
  if (!/^[a-z0-9]{8,32}$/.test(pid)) {
    pid = randomId(16);
    store.set('pid', pid);
  }
  let name = store.get('name', '');

  // ================================================================ utilidades

  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  // Vibración: navigator.vibrate en Android; en iOS 18+ un interruptor nativo produce un toque háptico.
  const hapticSwitch = (() => {
    if (!isIOS) return null;
    const label = document.createElement('label');
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.setAttribute('switch', '');
    label.append(input);
    label.style.cssText = 'position:fixed;width:1px;height:1px;opacity:0;overflow:hidden;pointer-events:none;left:-10px;top:-10px';
    label.setAttribute('aria-hidden', 'true');
    document.body.append(label);
    return label;
  })();

  function buzz(pattern = 10) {
    if (!prefs.haptics) return;
    if (navigator.vibrate) navigator.vibrate(pattern);
    else if (hapticSwitch) hapticSwitch.click();
  }

  let toastTimer = 0;
  function toast(text, { error = false, accent = false } = {}) {
    const el = $('#toast');
    el.textContent = text;
    el.classList.toggle('error', error);
    el.classList.toggle('accent', accent);
    el.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('on'), error ? 3400 : 2400);
  }

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  const CHECK = '<svg viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"/></svg>';
  const UP = '<svg viewBox="0 0 24 24"><path d="M12 4 4 14h5v6h6v-6h5z"/></svg>';

  function ago(ts) {
    const s = Math.max(0, (Date.now() - clockOffset - ts) / 1000);
    if (s < 50) return t('justNow');
    if (s < 3600) return t('minAgo', { n: Math.round(s / 60) });
    return t('hourAgo', { n: Math.round(s / 3600) });
  }

  // Altura real de la cabecera: las pestañas quedan pegadas justo debajo.
  new ResizeObserver(([entry]) => {
    document.documentElement.style.setProperty('--top-h', `${Math.round(entry.target.getBoundingClientRect().height)}px`);
  }).observe($('.top'));

  // ================================================================ sala

  const query = new URLSearchParams(location.search);
  const demo = query.has('demo');

  function parseCode(raw) {
    const c = String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    return c.length === 6 && [...c].every((ch) => CODE_ALPHABET.includes(ch)) ? c : null;
  }
  const formatCode = (c) => (c ? `${c.slice(0, 3)}-${c.slice(3)}` : '—');

  let code = parseCode(location.hash.slice(1)) || parseCode(query.get('c'));
  if (code) store.set('room', code);
  else code = parseCode(store.get('room', ''));

  let meta = { title: '', qOpen: true, anon: true, list: true, results: true, mod: false, react: true, emojis: ['👏', '❤️', '😂', '🔥', '🤯', '👍'], count: 0 };
  const questions = new Map();
  let voted = new Set();
  let mine = new Map();
  let poll = null;
  let multiDraft = null;
  let wordsEditing = false;
  let view = 'q';
  let sort = 'top';
  let clockOffset = 0;

  const loadMine = () => new Map((store.get(`mine.${code}`, []) || []).map((q) => [q.id, q]));
  const saveMine = () => store.set(`mine.${code}`, [...mine.values()].slice(-60));
  const isJoined = () => !!(store.get('joined', {}) || {})[code];
  function setJoined() {
    const all = store.get('joined', {}) || {};
    all[code] = Date.now();
    store.set('joined', all);
  }
  if (code) mine = loadMine();

  // ================================================================ conexión (PeerJS)

  let peer = null;
  let conn = null;
  let connState = 'connecting';
  let everConnected = false;
  let retryTimer = 0;
  let retryDelay = 1200;
  let pingTimer = 0;

  const GATE = {
    connecting: ['gateConnectingTitle', 'gateConnectingBody', true, false, false],
    waiting: ['gateWaitingTitle', 'gateWaitingBody', true, false, true],
    offline: ['gateOfflineTitle', 'gateOfflineBody', true, true, false],
    ended: ['gateEndedTitle', 'gateEndedBody', true, false, true],
    denied: ['gateDeniedTitle', 'gateDeniedBody', false, false, true],
    kicked: ['gateKickedTitle', 'gateKickedBody', false, false, true],
    full: ['gateFullTitle', 'gateFullBody', false, true, true],
    unsupported: ['gateUnsupportedTitle', 'gateUnsupportedBody', false, false, false],
  };
  const BLOCKING = new Set(['denied', 'kicked', 'unsupported', 'ended', 'full']);

  function setConn(state) {
    connState = state;
    const shown = state === 'connecting' && everConnected ? 'reconnecting' : state;
    app.dataset.conn = shown;
    const labels = { connected: 'connected', connecting: 'connecting', reconnecting: 'reconnecting', waiting: 'waiting', offline: 'offline' };
    $('#status-text').textContent = t(labels[shown] || 'offline');
    const ready = state === 'connected' || (everConnected && !BLOCKING.has(state));
    app.classList.toggle('ready', ready);
    const [title, body, spinner, retry, other] = GATE[state] || GATE.connecting;
    $('#gate-title').textContent = t(title);
    $('#gate-body').textContent = t(body);
    $('#gate-spinner').hidden = !spinner;
    $('#gate-retry').hidden = !retry;
    $('#gate-other').hidden = !other;
    renderCount();
  }

  function scheduleRetry(fn, delay = retryDelay) {
    clearTimeout(retryTimer);
    retryTimer = setTimeout(fn, delay);
    retryDelay = Math.min(retryDelay * 1.5, 6000);
  }

  // Credenciales de retransmisión: si el Worker no responde, se usa la conexión directa.
  let icePromise = null;
  function getIce() {
    if (!icePromise) {
      icePromise = (async () => {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 4000);
        try {
          const res = await fetch(ICE_ENDPOINT, { signal: ctrl.signal, cache: 'no-store' });
          if (!res.ok) throw new Error(String(res.status));
          const data = await res.json();
          if (!Array.isArray(data.iceServers) || !data.iceServers.length) throw new Error('sin servidores');
          setTimeout(() => { icePromise = null; }, ICE_REFRESH_MS);
          return { iceServers: data.iceServers };
        } catch {
          icePromise = null;
          return FALLBACK_ICE;
        } finally {
          clearTimeout(timer);
        }
      })();
    }
    return icePromise;
  }

  let startingPeer = false;
  async function startPeer() {
    if (!code) return;
    if (typeof Peer === 'undefined' || !window.RTCPeerConnection) { setConn('unsupported'); return; }
    if (peer && !peer.destroyed) {
      if (peer.disconnected) peer.reconnect();
      else if (peer.open) openConn();
      return;
    }
    if (startingPeer) return;
    if (!everConnected) setConn('connecting');
    startingPeer = true;
    const config = await getIce();
    startingPeer = false;
    if (peer && !peer.destroyed) return;
    peer = new Peer({ debug: 0, config });
    const current = peer;
    current.on('open', () => { if (current === peer) openConn(); });
    current.on('call', (c) => { try { c.close(); } catch {} });
    current.on('disconnected', () => {
      if (current !== peer || current.destroyed) return;
      scheduleRetry(() => { if (!current.destroyed && current.disconnected) current.reconnect(); });
    });
    current.on('error', (err) => {
      if (current !== peer) return;
      switch (err.type) {
        case 'peer-unavailable':
          if (!BLOCKING.has(connState) || connState === 'ended') setConn(connState === 'ended' ? 'ended' : 'waiting');
          scheduleRetry(openConn, connState === 'ended' ? 4000 : retryDelay);
          break;
        case 'browser-incompatible':
          setConn('unsupported');
          break;
        case 'network':
        case 'server-error':
        case 'socket-error':
        case 'socket-closed':
          if (!conn?.open) setConn('offline');
          scheduleRetry(restartPeer);
          break;
        default:
          scheduleRetry(restartPeer);
      }
    });
  }

  function restartPeer() {
    try { peer?.destroy(); } catch {}
    peer = null;
    startPeer();
  }

  function openConn() {
    clearTimeout(retryTimer);
    if (!code || !peer || peer.destroyed || peer.disconnected || !peer.open) return;
    if (['denied', 'kicked', 'unsupported'].includes(connState)) return;
    if (conn) {
      try { conn.removeAllListeners(); conn.close(); } catch {}
    }
    const c = peer.connect(ID_PREFIX + code.toLowerCase(), { serialization: 'json', reliable: true });
    conn = c;
    if (!BLOCKING.has(connState) && connState !== 'waiting') setConn(everConnected ? 'reconnecting' : 'connecting');
    const timeout = setTimeout(() => {
      if (c === conn && !c.open) {
        try { c.close(); } catch {}
        if (!BLOCKING.has(connState)) setConn('waiting');
        scheduleRetry(openConn);
      }
    }, 8000);
    c.on('open', () => {
      clearTimeout(timeout);
      c.send({ t: 'hello', pid, name, v: 1 });
    });
    c.on('data', (msg) => { if (c === conn) onData(msg); });
    c.on('close', () => {
      clearTimeout(timeout);
      if (c !== conn) return;
      conn = null;
      stopPing();
      if (['denied', 'kicked', 'unsupported'].includes(connState)) return;
      if (connState !== 'ended' && connState !== 'full') setConn('waiting');
      scheduleRetry(openConn, connState === 'ended' || connState === 'full' ? 5000 : retryDelay);
    });
    c.on('error', () => {});
  }

  function closeConn() {
    clearTimeout(retryTimer);
    stopPing();
    if (conn) {
      try { conn.removeAllListeners(); conn.close(); } catch {}
      conn = null;
    }
  }

  function send(msg) {
    if (demo) return true;
    if (!conn?.open) return false;
    try { conn.send(msg); return true; } catch { return false; }
  }

  function startPing() {
    stopPing();
    pingTimer = setInterval(() => send({ t: 'ping', ts: Date.now() }), 5000);
  }
  function stopPing() { clearInterval(pingTimer); }

  // ================================================================ mensajes de la sala

  const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');

  function cleanQ(q) {
    if (!q || typeof q !== 'object' || typeof q.id !== 'string') return null;
    return {
      id: q.id.slice(0, 24),
      text: str(q.text, MAX_TEXT),
      name: str(q.name, 40),
      votes: Math.max(0, Number(q.votes) || 0),
      at: Number(q.at) || 0,
      answered: q.answered === true,
      pinned: q.pinned === true,
    };
  }

  function cleanMine(q) {
    if (!q || typeof q !== 'object' || typeof q.id !== 'string') return null;
    return { id: q.id.slice(0, 24), text: str(q.text, MAX_TEXT), status: str(q.status, 12), answered: q.answered === true, votes: Number(q.votes) || 0, at: Number(q.at) || 0 };
  }

  function cleanMeta(m) {
    if (!m || typeof m !== 'object') return;
    meta = {
      title: str(m.title, 80),
      qOpen: m.qOpen !== false,
      anon: m.anon !== false,
      list: m.list !== false,
      results: m.results !== false,
      mod: m.mod === true,
      react: m.react !== false,
      emojis: Array.isArray(m.emojis) ? m.emojis.filter((e) => typeof e === 'string').map((e) => e.slice(0, 8)).slice(0, 6) : meta.emojis,
      count: Number(m.count) || 0,
    };
  }

  function onData(msg) {
    if (!msg || typeof msg !== 'object') return;
    switch (msg.t) {
      case 'welcome': {
        const first = !everConnected;
        everConnected = true;
        retryDelay = 1200;
        if (typeof msg.now === 'number') clockOffset = Date.now() - msg.now;
        cleanMeta(msg.room);
        questions.clear();
        for (const raw of Array.isArray(msg.qs) ? msg.qs : []) { const q = cleanQ(raw); if (q) questions.set(q.id, q); }
        voted = new Set((Array.isArray(msg.voted) ? msg.voted : []).filter((x) => typeof x === 'string'));
        mine = new Map((Array.isArray(msg.mine) ? msg.mine : []).map(cleanMine).filter(Boolean).map((q) => [q.id, q]));
        saveMine();
        if (!name && typeof msg.name === 'string' && msg.name) {
          name = msg.name.slice(0, 32);
          store.set('name', name);
        }
        setPoll(msg.poll, first);
        setConn('connected');
        startPing();
        renderAll();
        if (!isJoined()) openJoin();
        buzz(15);
        break;
      }
      case 'room':
        cleanMeta(msg.room);
        renderAll();
        break;
      case 'count':
        meta.count = Number(msg.n) || 0;
        renderCount();
        break;
      case 'qs':
        if (Array.isArray(msg.all)) {
          questions.clear();
          for (const raw of msg.all) { const q = cleanQ(raw); if (q) questions.set(q.id, q); }
        }
        for (const raw of Array.isArray(msg.upd) ? msg.upd : []) { const q = cleanQ(raw); if (q) questions.set(q.id, q); }
        for (const id of Array.isArray(msg.del) ? msg.del : []) questions.delete(id);
        renderQuestions();
        renderMine();
        break;
      case 'mine':
        onMine(msg);
        break;
      case 'poll':
        setPoll(msg.poll, false);
        break;
      case 'done':
        if (msg.what === 'ask') onAsked(msg);
        else if (msg.what === 'vote') onVoted(msg);
        break;
      case 'pong':
        $('#latency').textContent = `${Math.max(1, Math.round((Date.now() - msg.ts) / 2))} ms`;
        break;
      case 'bye':
        if (msg.reason === 'revoked') { setConn('denied'); closeConn(); }
        else if (msg.reason === 'kicked') { setConn('kicked'); closeConn(); }
        else if (msg.reason === 'full') setConn('full');
        else setConn('ended');
        break;
    }
  }

  function onMine(msg) {
    if (msg.reset) {
      mine.clear();
      voted.clear();
      saveMine();
      renderAll();
      return;
    }
    const q = cleanMine(msg.q);
    if (!q) return;
    const before = mine.get(q.id);
    if (q.status === 'deleted') mine.delete(q.id);
    else mine.set(q.id, { ...before, ...q, text: q.text || before?.text || '' });
    saveMine();
    if (before && q.status !== 'deleted') {
      if (before.status === 'pending' && q.status === 'live') toast(t('approved'), { accent: true });
      else if (!before.answered && q.answered) { toast(t('answeredToast'), { accent: true }); buzz([20, 60, 20]); }
      else if (before.status !== 'hidden' && q.status === 'hidden') toast(t('hiddenToast'));
    }
    renderMine();
    renderQuestions();
  }

  // ================================================================ cabecera y estado

  function renderCount() {
    const n = meta.count;
    const show = connState === 'connected' && n > 0;
    $('#count').textContent = show ? t(n === 1 ? 'person' : 'people', { n: nf.format(n) }) : '';
    $('#count-sep').hidden = !show;
  }

  function renderMeta() {
    const title = meta.title || 'Preguntazo';
    $('#talk-title').textContent = title;
    document.title = meta.title ? `${meta.title} · Preguntazo` : 'Preguntazo';
    renderCount();
    $('#composer').hidden = !meta.qOpen;
    $('#q-closed').hidden = meta.qOpen;
    $('#public').hidden = !meta.list;
    const canAnon = meta.anon && !!name;
    $('#anon-wrap').hidden = !canAnon;
    const as = $('#as-line');
    as.textContent = name ? t('askAs', { name }) : meta.anon ? t('askAsAnon') : t('askNeedName');
    as.classList.toggle('link', !name);
    $('#room-code').textContent = formatCode(code);
    renderReactions();
  }

  // ================================================================ preguntas

  const qRows = new Map();

  function sortedQuestions() {
    const list = [...questions.values()];
    if (sort === 'new') return list.sort((a, b) => b.at - a.at);
    return list.sort((a, b) => (a.answered - b.answered) || (b.pinned - a.pinned) || (b.votes - a.votes) || (a.at - b.at));
  }

  function qRow(q) {
    let li = qRows.get(q.id);
    if (!li) {
      li = el('li', 'q');
      li.dataset.id = q.id;
      const vote = el('button', 'vote');
      vote.type = 'button';
      vote.innerHTML = `${UP}<span></span>`;
      const body = el('div', 'q-body');
      body.append(el('div', 'q-text'), el('div', 'q-meta'));
      li.append(vote, body);
      qRows.set(q.id, li);
    }
    const own = mine.has(q.id);
    li.classList.toggle('answered', q.answered);
    li.classList.toggle('mine-q', own);
    const vote = li.querySelector('.vote');
    vote.querySelector('span').textContent = nf.format(q.votes);
    vote.setAttribute('aria-pressed', String(voted.has(q.id)));
    vote.setAttribute('aria-label', `${q.votes} votos`);
    vote.disabled = own;
    li.querySelector('.q-text').textContent = q.text;
    const metaEl = li.querySelector('.q-meta');
    metaEl.replaceChildren(el('span', '', q.name || t('anonymous')), el('span', '', '·'), el('span', 'ago', ago(q.at)));
    metaEl.querySelector('.ago').dataset.at = q.at;
    if (own) metaEl.append(el('span', 'tag accent', t('yours')));
    if (q.pinned && !q.answered) metaEl.append(el('span', 'tag', t('pinned')));
    if (q.answered) metaEl.append(el('span', 'tag ok', t('answered')));
    return li;
  }

  function renderQuestions() {
    const list = sortedQuestions();
    const ids = new Set(list.map((q) => q.id));
    for (const [id, li] of qRows) if (!ids.has(id)) { li.remove(); qRows.delete(id); }
    const ul = $('#qlist');
    list.forEach((q, i) => {
      const li = qRow(q);
      if (ul.children[i] !== li) ul.insertBefore(li, ul.children[i] || null);
    });
    $('#q-empty').hidden = list.length > 0;
  }

  function renderMine() {
    // Con la lista pública, aquí solo van las propias que el resto aún no ve.
    const list = [...mine.values()].filter((q) => !meta.list || q.status !== 'live' || !questions.has(q.id)).sort((a, b) => b.at - a.at);
    $('#mine').hidden = !list.length;
    $('#mine-list').replaceChildren(...list.map((q) => {
      const li = el('li', 'q mine-q');
      const body = el('div', 'q-body');
      const metaEl = el('div', 'q-meta');
      if (q.status === 'sending') metaEl.append(el('span', 'tag muted', '…'));
      else if (q.answered) metaEl.append(el('span', 'tag ok', t('answered')));
      else if (q.status === 'pending') metaEl.append(el('span', 'tag warn', t('pending')));
      else if (q.status === 'hidden') metaEl.append(el('span', 'tag muted', t('notPublished')));
      else metaEl.append(el('span', 'tag accent', t('published')));
      if (q.status === 'live') metaEl.append(el('span', '', t('manyVotes', { n: nf.format(q.votes || 0) })));
      body.append(el('div', 'q-text', q.text), metaEl);
      li.append(body);
      return li;
    }));
  }

  $('#qlist').addEventListener('click', (e) => {
    const btn = e.target.closest('.vote');
    const li = e.target.closest('li[data-id]');
    if (!btn || !li) return;
    const q = questions.get(li.dataset.id);
    if (!q) return;
    if (mine.has(q.id)) { toast(t('cantVoteOwn')); return; }
    const on = !voted.has(q.id);
    if (!send({ t: 'up', id: q.id, on })) { toast(t('notConnected'), { error: true }); return; }
    if (on) voted.add(q.id); else voted.delete(q.id);
    q.votes = Math.max(0, q.votes + (on ? 1 : -1));
    buzz(8);
    qRow(q);
    btn.classList.remove('bump');
    void btn.offsetWidth;
    btn.classList.add('bump');
  });

  $('#sort').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-v]');
    if (!b) return;
    sort = b.dataset.v;
    for (const x of $$('#sort button')) x.setAttribute('aria-checked', String(x === b));
    renderQuestions();
  });

  setInterval(() => { for (const s of $$('.q-meta .ago')) s.textContent = ago(Number(s.dataset.at)); }, 30000);

  // ---------- enviar una pregunta

  const textarea = $('#q-text');
  let pendingAsk = null;

  function updateComposer() {
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(180, textarea.scrollHeight)}px`;
    const n = textarea.value.length;
    const counter = $('#counter');
    counter.textContent = n > MAX_TEXT - 60 ? `${MAX_TEXT - n}` : '';
    counter.classList.toggle('warn', n > MAX_TEXT - 20);
    $('#send').disabled = textarea.value.trim().length < 2 || !!pendingAsk;
  }
  textarea.addEventListener('input', updateComposer);

  $('#as-line').addEventListener('click', () => { if (!name) openJoin(true); });

  $('#composer').addEventListener('submit', (e) => {
    e.preventDefault();
    const text = textarea.value.trim();
    if (text.length < 2 || pendingAsk) return;
    if (!meta.anon && !name) { openJoin(true); return; }
    const cid = randomId(8);
    const anon = !name || $('#anon').checked;
    if (!send({ t: 'ask', text, anon, cid })) { toast(t('notConnected'), { error: true }); return; }
    pendingAsk = { cid, text };
    mine.set(`tmp-${cid}`, { id: `tmp-${cid}`, text, status: 'sending', at: Date.now() - clockOffset });
    renderMine();
    updateComposer();
    if (demo) setTimeout(() => onAsked({ cid, ok: true, q: { id: `d${cid}`, text, status: 'live', answered: false, votes: 0, at: Date.now() } }), 400);
  });

  function onAsked(msg) {
    if (!pendingAsk || msg.cid !== pendingAsk.cid) return;
    mine.delete(`tmp-${pendingAsk.cid}`);
    pendingAsk = null;
    if (msg.ok) {
      const q = cleanMine(msg.q);
      if (q) mine.set(q.id, q);
      saveMine();
      textarea.value = '';
      textarea.blur();
      toast(q?.status === 'pending' ? t('sentReview') : t('sent'), { accent: true });
      buzz(18);
    } else {
      const map = { closed: 'errClosed', slow: 'errSlow', limit: 'errLimit', full: 'errFull', name: 'errName', empty: 'errEmpty' };
      toast(t(map[msg.error] || 'notConnected'), { error: true });
      if (msg.error === 'name') openJoin(true);
    }
    updateComposer();
    renderMine();
    renderQuestions();
  }

  // ================================================================ encuesta

  function cleanPoll(p) {
    if (!p || typeof p !== 'object' || typeof p.id !== 'string') return null;
    const kind = ['single', 'multi', 'rating', 'words'].includes(p.kind) ? p.kind : 'single';
    return {
      id: p.id.slice(0, 24),
      q: str(p.q, 200),
      kind,
      options: Array.isArray(p.options) ? p.options.map((o) => str(o, 100)).slice(0, 6) : [],
      state: p.state === 'open' ? 'open' : 'closed',
      total: Number(p.total) || 0,
      results: p.results && typeof p.results === 'object' ? p.results : null,
      mine: p.mine ?? null,
    };
  }

  function setPoll(raw, initial) {
    const next = cleanPoll(raw);
    const isNew = next && next.id !== poll?.id;
    if (isNew) { multiDraft = null; wordsEditing = false; }
    poll = next;
    // Una encuesta recién abierta: se cambia a la pestaña y se avisa.
    const seen = store.get(`poll.${code}`, '');
    if (next && next.state === 'open' && next.mine == null && next.id !== seen) {
      store.set(`poll.${code}`, next.id);
      if (!initial || isNew) {
        showView('poll');
        if (!initial) { toast(t('newPoll'), { accent: true }); buzz([25, 50, 25]); }
      }
    }
    renderPoll();
  }

  function sendVote(c) {
    if (!poll || poll.state !== 'open') return;
    if (!send({ t: 'v', id: poll.id, c })) { toast(t('notConnected'), { error: true }); return; }
    poll.mine = c;
    buzz(14);
    renderPoll();
    if (demo) onVoted({ ok: true, id: poll.id, mine: c });
  }

  function onVoted(msg) {
    if (msg.ok) {
      if (poll && poll.id === msg.id) poll.mine = msg.mine;
      toast(t('voteSent'), { accent: true });
    } else {
      toast(t(msg.error === 'closed' ? 'voteClosed' : 'voteFailed'), { error: true });
    }
    renderPoll();
  }

  function renderPoll() {
    const p = poll;
    $('#poll-badge').hidden = !(p && p.state === 'open' && p.mine == null);
    $('#poll').hidden = !p;
    $('#poll-empty').hidden = !!p;
    if (!p) return;
    const open = p.state === 'open';
    const chip = $('#poll-chip');
    chip.classList.toggle('closed', !open);
    $('#poll-state').textContent = open ? t('pollLive') : t('pollClosed');
    $('#poll-total').textContent = p.total === 1 ? t('oneVote') : t('manyVotes', { n: nf.format(p.total) });
    $('#poll-q').textContent = p.q;
    const hints = { single: 'hintSingle', multi: 'hintMulti', rating: 'hintRating', words: 'hintWords' };
    $('#poll-hint').textContent = open ? t(hints[p.kind]) : '';
    const hasVote = p.mine != null && !(Array.isArray(p.mine) && !p.mine.length);
    const showResults = !!p.results && (hasVote || !open);
    const body = $('#poll-body');
    const foot = $('#poll-foot');
    foot.replaceChildren();

    if (p.kind === 'single' || p.kind === 'multi') {
      const multi = p.kind === 'multi';
      const picked = new Set(multi ? (multiDraft ?? (Array.isArray(p.mine) ? p.mine : [])) : p.mine != null ? [p.mine] : []);
      const counts = p.results?.counts || [];
      const max = Math.max(0, ...counts);
      body.replaceChildren(...p.options.map((label, i) => {
        const b = el('button', `opt${multi ? ' multi' : ''}`);
        b.type = 'button';
        b.dataset.i = String(i);
        b.setAttribute('role', multi ? 'checkbox' : 'radio');
        b.setAttribute('aria-checked', String(picked.has(i)));
        b.disabled = !open;
        const fill = el('div', 'fill');
        const mark = el('span', 'mark');
        mark.innerHTML = CHECK;
        b.append(fill, mark, el('span', 'lbl', label));
        if (showResults) {
          const n = counts[i] || 0;
          const pct = p.total ? Math.round((n / p.total) * 100) : 0;
          requestAnimationFrame(() => { fill.style.width = `${pct}%`; });
          b.classList.toggle('lead', n > 0 && n === max);
          b.append(el('span', 'pct', `${pct}%`));
        }
        return b;
      }));
      if (multi && open) {
        const changed = multiDraft != null && JSON.stringify([...multiDraft].sort()) !== JSON.stringify(Array.isArray(p.mine) ? [...p.mine].sort() : []);
        if (!hasVote || changed) {
          const submit = el('button', 'btn accent small', hasVote ? t('updateVotes') : t('sendVotes'));
          submit.type = 'button';
          submit.dataset.act = 'multi';
          submit.disabled = !picked.size;
          foot.append(submit);
        }
      }
    } else if (p.kind === 'rating') {
      const stars = el('div', 'stars');
      for (let i = 1; i <= 5; i++) {
        const s = el('button', `star${p.mine >= i ? ' on' : ''}`, '★');
        s.type = 'button';
        s.dataset.star = String(i);
        s.disabled = !open;
        s.setAttribute('aria-label', `${i}`);
        stars.append(s);
      }
      const parts = [stars];
      if (showResults) {
        const r = p.results;
        const res = el('div', 'rating-res');
        const avg = el('div', 'avg');
        const full = Math.round(r.avg || 0);
        avg.append(el('b', '', p.total ? nf.format(r.avg) : '—'), el('span', '', '★★★★★'.slice(0, full) + '☆☆☆☆☆'.slice(0, 5 - full)));
        const bars = el('div', 'bars');
        const dist = Array.isArray(r.dist) ? r.dist : [0, 0, 0, 0, 0];
        for (let i = 4; i >= 0; i--) {
          const row = el('div', 'rbar');
          const fill = el('div', 'fill');
          fill.style.width = `${p.total ? Math.round((dist[i] / p.total) * 100) : 0}%`;
          row.append(fill, el('span', '', `${i + 1} ★`), el('span', '', nf.format(dist[i] || 0)));
          bars.append(row);
        }
        res.append(avg, bars);
        parts.push(res);
      }
      body.replaceChildren(...parts);
    } else {
      const parts = [];
      if (open && (!hasVote || wordsEditing)) {
        const form = el('form', 'words-form');
        const input = el('input', 'input');
        input.maxLength = 40;
        input.placeholder = t('wordsPlaceholder');
        input.enterKeyHint = 'send';
        input.value = wordsEditing && typeof p.mine === 'string' ? p.mine : '';
        const go = el('button', 'btn accent small', t('send'));
        go.type = 'submit';
        form.append(input, go);
        form.addEventListener('submit', (e) => {
          e.preventDefault();
          const w = input.value.trim();
          if (!w) return;
          wordsEditing = false;
          input.blur();
          sendVote(w);
        });
        parts.push(form);
      }
      if (showResults) {
        const cloud = el('div', 'cloud');
        const words = Array.isArray(p.results.words) ? p.results.words.slice(0, 30) : [];
        const max = words.length ? words[0][1] : 1;
        const shades = ['#e3a6ff', '#bf5af2', '#f5f5f7', '#d18cff', '#a970ff'];
        words.forEach(([w, n], i) => {
          const s = el('span', '', String(w).slice(0, 40));
          s.style.fontSize = `${15 + (n / max) * 22}px`;
          s.style.color = shades[i % shades.length];
          cloud.append(s);
        });
        parts.push(cloud);
      }
      body.replaceChildren(...parts);
    }

    if (hasVote && open && !(p.kind === 'multi' && foot.children.length) && !(p.kind === 'words' && wordsEditing)) {
      const ok = el('div', 'voted');
      ok.innerHTML = CHECK;
      ok.append(el('span', '', p.kind === 'words' ? t('yourAnswer', { w: String(p.mine) }) : t('voted')));
      if (p.kind === 'words') {
        const change = el('button', '', t('change'));
        change.type = 'button';
        change.dataset.act = 'words-edit';
        ok.append(change);
      }
      foot.append(ok);
      if (!p.results) foot.append(el('p', 'wait-results', t('waitResults')));
    }
  }

  $('#poll').addEventListener('click', (e) => {
    if (!poll) return;
    const opt = e.target.closest('.opt');
    const star = e.target.closest('.star');
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (opt && poll.state === 'open') {
      const i = Number(opt.dataset.i);
      if (poll.kind === 'single') { if (poll.mine !== i) sendVote(i); }
      else {
        const set = new Set(multiDraft ?? (Array.isArray(poll.mine) ? poll.mine : []));
        if (set.has(i)) set.delete(i); else set.add(i);
        multiDraft = [...set].sort((a, b) => a - b);
        buzz(6);
        renderPoll();
      }
    } else if (star && poll.state === 'open') {
      sendVote(Number(star.dataset.star));
    } else if (act === 'multi' && multiDraft?.length) {
      const picks = multiDraft;
      multiDraft = null;
      sendVote(picks);
    } else if (act === 'words-edit') {
      wordsEditing = true;
      renderPoll();
      $('#poll .words-form input')?.focus();
    }
  });

  // ================================================================ pestañas

  function showView(v) {
    view = v;
    for (const b of $$('.tabs button')) b.setAttribute('aria-selected', String(b.dataset.view === v));
    $('#view-q').hidden = v !== 'q';
    $('#view-poll').hidden = v !== 'poll';
    window.scrollTo({ top: 0 });
  }
  $('.tabs').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-view]');
    if (b && b.dataset.view !== view) { showView(b.dataset.view); buzz(5); }
  });

  // ================================================================ reacciones

  let reactionKey = '';
  const pendingReactions = new Map();
  let reactTimer = 0;
  let floats = 0;
  let recent = [];

  function renderReactions() {
    $('#react-bar').hidden = !meta.react || !meta.emojis.length;
    const key = meta.emojis.join('');
    if (key === reactionKey) return;
    reactionKey = key;
    $('#reactions').replaceChildren(...meta.emojis.map((emoji, i) => {
      const b = el('button', 'react', emoji);
      b.type = 'button';
      b.dataset.i = String(i);
      b.setAttribute('aria-label', emoji);
      return b;
    }));
  }

  function floatFrom(btn, emoji) {
    // Como mucho 10 emojis por segundo en la animación local.
    const now = performance.now();
    recent = recent.filter((x) => now - x < 1000);
    if (recent.length >= 10 || floats > 30) return;
    recent.push(now);
    const r = btn.getBoundingClientRect();
    const span = el('span', '', emoji);
    $('#fx').append(span);
    floats++;
    const x = r.left + r.width / 2 - 17;
    const y = r.top - 6;
    const sway = (Math.random() - 0.5) * 70;
    const rise = 220 + Math.random() * 160;
    const scale = 0.9 + Math.random() * 0.6;
    const anim = span.animate([
      { transform: `translate(${x}px, ${y}px) scale(.5)`, opacity: 0 },
      { transform: `translate(${x + sway * 0.3}px, ${y - rise * 0.15}px) scale(${scale})`, opacity: 1, offset: 0.15 },
      { transform: `translate(${x - sway * 0.4}px, ${y - rise * 0.6}px) scale(${scale})`, opacity: 0.9, offset: 0.6 },
      { transform: `translate(${x + sway}px, ${y - rise}px) scale(${scale * 0.9})`, opacity: 0 },
    ], { duration: 1100 + Math.random() * 500, easing: 'cubic-bezier(.25,.6,.35,1)' });
    anim.onfinish = anim.oncancel = () => { span.remove(); floats--; };
  }

  function flushReactions() {
    reactTimer = 0;
    for (const [i, n] of pendingReactions) {
      let left = n;
      while (left > 0) {
        send({ t: 'r', e: i, n: Math.min(left, 10) });
        left -= 10;
      }
    }
    pendingReactions.clear();
  }

  $('#reactions').addEventListener('pointerdown', (e) => {
    const b = e.target.closest('.react');
    if (!b) return;
    e.preventDefault();
    const i = Number(b.dataset.i);
    floatFrom(b, meta.emojis[i]);
    buzz(6);
    pendingReactions.set(i, (pendingReactions.get(i) || 0) + 1);
    reactTimer ||= setTimeout(flushReactions, 220);
  });
  $('#reactions').addEventListener('contextmenu', (e) => e.preventDefault());

  // ================================================================ entrar, bienvenida y ajustes

  function showEnter(message = '') {
    closeConn();
    try { peer?.destroy(); } catch {}
    peer = null;
    $('#enter').hidden = false;
    $('#gate').hidden = true;
    $('#enter-err').hidden = !message;
    $('#enter-err').textContent = message;
    app.classList.remove('ready');
  }

  const codeInput = $('#code-input');
  codeInput.addEventListener('input', () => {
    const raw = codeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, '').split('').filter((c) => CODE_ALPHABET.includes(c)).join('').slice(0, 6);
    codeInput.value = raw.length > 3 ? `${raw.slice(0, 3)}-${raw.slice(3)}` : raw;
  });

  $('#enter-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const next = parseCode(codeInput.value);
    if (!next) {
      $('#enter-err').hidden = false;
      $('#enter-err').textContent = t('badCode');
      return;
    }
    switchRoom(next);
  });

  function switchRoom(next) {
    code = next;
    store.set('room', code);
    history.replaceState(null, '', `${location.pathname}${location.search}#${code}`);
    mine = loadMine();
    questions.clear();
    qRows.clear();
    $('#qlist').replaceChildren();
    poll = null;
    everConnected = false;
    retryDelay = 1200;
    connState = 'connecting';
    $('#enter').hidden = true;
    $('#gate').hidden = false;
    renderAll();
    if (demo) startDemo();
    else startPeer();
  }

  function openJoin(required = false) {
    $('#join').hidden = false;
    $('#join-title').textContent = meta.title || t('joinDefaultTitle');
    const needName = required || !meta.anon;
    $('#join-body').textContent = needName ? t('joinBodyRequired') : t('joinBody');
    const input = $('#name-input');
    input.placeholder = needName ? t('nameRequiredPlaceholder') : t('namePlaceholder');
    input.value = name;
    input.required = needName;
  }

  $('#join-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = $('#name-input');
    const value = input.value.replace(/\s+/g, ' ').trim().slice(0, 32);
    if (input.required && !value) {
      input.focus();
      return;
    }
    setName(value);
    setJoined();
    input.blur();
    $('#join').hidden = true;
    buzz(12);
  });

  function setName(value) {
    name = value;
    store.set('name', name);
    send({ t: 'name', name });
    renderMeta();
  }

  const sheet = $('#settings');
  $('#open-settings').addEventListener('click', () => {
    $('#name-edit').value = name;
    $('#haptics').checked = prefs.haptics;
    $('#room-code').textContent = formatCode(code);
    sheet.showModal();
  });
  sheet.addEventListener('click', (e) => { if (e.target === sheet) sheet.close(); });
  $('#name-edit').addEventListener('change', (e) => setName(e.target.value.replace(/\s+/g, ' ').trim().slice(0, 32)));
  $('#haptics').addEventListener('change', (e) => { prefs.haptics = e.target.checked; savePrefs(); buzz(10); });
  $('#leave').addEventListener('click', () => {
    sheet.close();
    store.set('room', null);
    history.replaceState(null, '', location.pathname + location.search);
    code = null;
    showEnter();
  });

  $('#gate-retry').addEventListener('click', () => {
    retryDelay = 1200;
    if (connState === 'full') setConn('connecting');
    restartPeer();
  });
  $('#gate-other').addEventListener('click', () => showEnter());

  addEventListener('hashchange', () => {
    const next = parseCode(location.hash.slice(1));
    if (next && next !== code) switchRoom(next);
  });

  // Al volver a la página (el celular estuvo bloqueado), se reconecta enseguida.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || demo || !code) return;
    if (!conn?.open && !BLOCKING.has(connState)) {
      retryDelay = 1200;
      if (peer && !peer.destroyed && peer.open) openConn();
      else restartPeer();
    }
  });

  function renderAll() {
    renderMeta();
    renderQuestions();
    renderMine();
    renderPoll();
    updateComposer();
  }

  // ================================================================ demostración (?demo)

  // Vista previa sin computadora, para probar el diseño y hacer capturas:
  //   ?demo                 preguntas          &view=poll         encuesta
  //   &kind=multi|rating|words                 &voted             con voto
  //   &closed               votación cerrada   &join              bienvenida
  //   &enter                pantalla de código &mod               con moderación
  function startDemo() {
    const now = Date.now();
    everConnected = true;
    cleanMeta({ title: query.get('title') || 'IA para todos: del aula a la oficina', qOpen: !query.has('qclosed'), anon: true, list: true, results: true, mod: query.has('mod'), react: true, emojis: ['👏', '❤️', '😂', '🔥', '🤯', '👍'], count: 128 });
    const sample = [
      ['¿Qué herramientas de IA recomiendas para empezar sin saber programar?', 'Lucía', 42, 9, false, true],
      ['¿Cómo evitamos que los estudiantes copien con la IA en los exámenes?', '', 35, 7, false, false],
      ['¿La IA va a reemplazar a los diseñadores gráficos?', 'Diego', 27, 6, false, false],
      ['¿Qué datos de la empresa es seguro compartir con un chatbot?', 'Ana', 19, 4, true, false],
      ['¿Hay cursos gratuitos que recomiendes para el equipo?', '', 11, 2, false, false],
      ['¿Puedes compartir las diapositivas al final?', 'Jorge', 8, 1, false, false],
    ];
    questions.clear();
    sample.forEach(([text, nm, votes, minutes, answered, pinned], i) => questions.set(`d${i}`, { id: `d${i}`, text, name: nm, votes, at: now - minutes * 60000, answered, pinned }));
    voted = new Set(['d0', 'd2']);
    mine = new Map();
    if (query.has('mine') || query.has('mod')) {
      mine.set('m1', { id: 'm1', text: '¿Cómo empiezo a usar IA en una empresa pequeña?', status: query.has('mod') ? 'pending' : 'live', answered: false, votes: 3, at: now - 60000 });
    }
    const kind = ['multi', 'rating', 'words'].includes(query.get('kind')) ? query.get('kind') : 'single';
    const polls = {
      single: { q: '¿Cuánto usas la IA en tu trabajo o estudios?', options: ['Todos los días', 'Algunas veces por semana', 'Casi nunca', 'Nunca'], results: { counts: [46, 38, 21, 7] }, total: 112, mine: 0 },
      multi: { q: '¿Para qué usas la IA? (elige varias)', options: ['Escribir textos', 'Resumir documentos', 'Programar', 'Crear imágenes', 'Estudiar'], results: { counts: [64, 51, 22, 30, 45] }, total: 97, mine: [0, 1, 4] },
      rating: { q: '¿Qué te pareció la charla?', options: [], results: { dist: [1, 2, 9, 34, 61], avg: 4.4 }, total: 107, mine: 5 },
      words: { q: 'En una palabra, ¿qué te llevas de hoy?', options: [], results: { words: [['Curiosidad', 18], ['Herramientas', 14], ['Productividad', 11], ['Ética', 9], ['Inspiración', 8], ['Práctica', 6], ['Futuro', 5], ['Prompts', 5], ['Ideas', 4], ['Aprender', 3], ['Equipo', 3], ['Motivación', 2]] }, total: 88, mine: 'Curiosidad' },
    };
    const pp = polls[kind];
    const votedPoll = query.has('voted') || query.has('closed');
    poll = cleanPoll({ id: `demo-${kind}`, kind, q: pp.q, options: pp.options, state: query.has('closed') ? 'closed' : 'open', total: pp.total, results: pp.results, mine: votedPoll ? pp.mine : null });
    if (!query.has('nopoll')) store.set(`poll.${code}`, poll.id);
    else poll = null;
    if (query.has('noname')) name = '';
    else if (!name) name = 'Carla';
    setConn('connected');
    renderAll();
    showView(query.get('view') === 'poll' ? 'poll' : 'q');
    if (query.has('join')) openJoin();
    if (query.has('ask')) {
      textarea.value = '¿Qué opinas de usar IA para preparar las clases?';
      updateComposer();
    }
    if (query.has('react')) {
      // Unos emojis en el aire para la captura.
      const buttons = $$('.react');
      [0, 1, 3, 0, 2, 1, 0, 3].forEach((i, n) => setTimeout(() => floatFrom(buttons[i], meta.emojis[i]), n * 120));
    }
  }

  // ================================================================ inicio

  if (demo) {
    if (query.has('enter')) showEnter();
    else {
      code ||= 'K7QM4P';
      startDemo();
    }
  } else if (!code) {
    showEnter();
  } else {
    setConn('connecting');
    renderAll();
    startPeer();
  }
})();

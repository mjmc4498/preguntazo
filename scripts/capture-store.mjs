// Capturas reales de Preguntazo para la ficha de la tienda y la presentación.
//
//   npm run serve            (otra terminal)
//   npm run store:capture    → design/store/captures/*.png y presentacion/img/*.png
//
// Usa la extensión real con una sala de ejemplo (preguntas, encuestas y reacciones que
// se cargan como si vinieran de una charla), público simulado con conexiones PeerJS, el
// celular real (página remote/) y una presentación de prueba servida como
// https://charla.example.com (dominio reservado para ejemplos).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import puppeteer from 'puppeteer';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.env.BASE || 'http://localhost:8768';
const SHOTS = path.join(ROOT, 'design', 'store', 'captures');
const PRES = path.join(ROOT, 'presentacion', 'img');
const SLIDES_HTML = fs.readFileSync(path.join(ROOT, 'design', 'demo', 'charla.html'), 'utf8');
fs.mkdirSync(SHOTS, { recursive: true });
fs.mkdirSync(PRES, { recursive: true });

// Fuera del proyecto: un Escritorio sincronizado con iCloud deja copias de conflicto.
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'preguntazo-capturas-'));
const EXT = path.join(TMP, 'extension');
fs.cpSync(path.join(ROOT, 'extension'), EXT, { recursive: true });
const manifestPath = path.join(EXT, 'manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
manifest.host_permissions = ['https://charla.example.com/*'];
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, { timeout = 20000, interval = 200 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try { const v = await fn(); if (v) return v; } catch {}
    await sleep(interval);
  }
  return null;
}

async function save(page, name, opts = {}) {
  const file = path.join(SHOTS, `${name}.png`);
  // Las pestañas en segundo plano no dibujan: se trae al frente antes de capturar.
  await page.bringToFront();
  await sleep(opts.wait ?? 350);
  if (opts.element) await (await page.$(opts.element)).screenshot({ path: file });
  else await page.screenshot({ path: file, clip: opts.clip });
  fs.copyFileSync(file, path.join(PRES, `${name}.png`));
  console.log('  ', path.relative(ROOT, file));
}

// ---------------------------------------------------------------- sala de ejemplo

const now = Date.now();
const fakeVotes = (n, seed) => Array.from({ length: n }, (_, i) => `seed${seed}${String(i).padStart(4, '0')}x`);
const Q = (id, text, name, votes, minutes, extra = {}) => ({ id, text, name, pid: `autor${id}0000x`, at: now - minutes * 60000, votes: fakeVotes(votes, id), status: 'live', answered: false, pinned: false, ...extra });
const pollVotes = (counts, seed) => {
  const out = {};
  let k = 0;
  counts.forEach((n, i) => { for (let j = 0; j < n; j++) out[`voto${seed}${String(k++).padStart(4, '0')}x`] = i; });
  return out;
};
const wordVotes = (pairs) => {
  const out = {};
  let k = 0;
  for (const [w, n] of pairs) for (let j = 0; j < n; j++) out[`palabra${String(k++).padStart(4, '0')}x`] = w;
  return out;
};
const ROOM = {
  v: 1,
  seq: 40,
  questions: [
    Q('q1', '¿Qué herramientas de IA recomiendas para empezar sin saber programar?', 'Lucía', 42, 11, { pinned: true }),
    Q('q2', '¿Cómo evitamos que los estudiantes copien con la IA en los exámenes?', '', 35, 9),
    Q('q3', '¿La IA va a reemplazar a los diseñadores gráficos?', 'Diego', 27, 8),
    Q('q4', '¿Qué datos de la empresa es seguro compartir con un chatbot?', 'Ana', 19, 14, { answered: true }),
    Q('q5', '¿Hay cursos gratuitos que recomiendes para el equipo?', '', 11, 5),
    Q('q6', '¿Puedes compartir las diapositivas al final?', 'Jorge', 8, 3),
    Q('q7', '¿Cómo convenzo a mi jefe de probar estas herramientas?', 'Martín', 0, 1, { status: 'pending' }),
  ],
  polls: [
    { id: 'p1', q: '¿Cuánto usas la IA en tu trabajo o estudios?', kind: 'single', options: ['Todos los días', 'Algunas veces por semana', 'Casi nunca', 'Nunca'], state: 'closed', votes: pollVotes([46, 38, 21, 7], 'a'), createdAt: now - 3600000, openedAt: now - 1800000, closedAt: now - 1500000 },
    { id: 'p2', q: 'En una palabra, ¿qué te llevas de hoy?', kind: 'words', options: [], state: 'open', votes: wordVotes([['Curiosidad', 18], ['Herramientas', 14], ['Productividad', 11], ['Ética', 9], ['Inspiración', 8], ['Práctica', 6], ['Futuro', 5], ['Prompts', 5], ['Ideas', 4], ['Aprender', 3], ['Equipo', 3], ['Motivación', 2]]), createdAt: now - 3000000, openedAt: now - 120000 },
    { id: 'p3', q: '¿Qué te pareció la charla?', kind: 'rating', options: [], state: 'draft', votes: {}, createdAt: now - 2900000 },
    { id: 'p4', q: '¿Para qué usas la IA? (elige varias)', kind: 'multi', options: ['Escribir textos', 'Resumir documentos', 'Programar', 'Crear imágenes', 'Estudiar'], state: 'draft', votes: {}, createdAt: now - 2800000 },
  ],
  activePoll: 'p2',
  spot: null,
  totals: { '👏': 412, '❤️': 268, '😂': 97, '🔥': 185, '🤯': 64, '👍': 233 },
  reactions: 1259,
  banned: [],
};

const browser = await puppeteer.launch({
  headless: true,
  pipe: true,
  userDataDir: path.join(TMP, 'perfil'),
  enableExtensions: [EXT],
  args: ['--window-size=1400,900', '--hide-scrollbars', '--autoplay-policy=no-user-gesture-required'],
  defaultViewport: null,
});
// El público simulado va en otro Chrome (otro proceso, como celulares de verdad).
const audience = await puppeteer.launch({ headless: true, pipe: true });

const IPHONE = { width: 390, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true };
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1';

try {
  const swTarget = await browser.waitForTarget((t) => t.type() === 'service_worker' && t.url().endsWith('/background.js'), { timeout: 15000 });
  const extId = new URL(swTarget.url()).host;
  console.log('Capturas reales:');

  // ---------- bienvenida
  const opts = (await waitFor(async () => (await browser.pages()).find((p) => p.url().includes('options.html')), { timeout: 6000 })) || (await browser.newPage());
  await opts.setViewport({ width: 1280, height: 860, deviceScaleFactor: 2 });
  await opts.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
  await opts.goto(`chrome-extension://${extId}/options.html#bienvenida`);
  const sw = (msg) => opts.evaluate((m) => chrome.runtime.sendMessage({ to: 'sw', ...m }), msg);
  const state = async () => (await opts.evaluate(() => chrome.storage.session.get('state'))).state;
  await opts.evaluate(async (room) => {
    await chrome.storage.local.set({ room, identity: { code: 'K7QM4P', since: Date.now() } });
    await chrome.storage.sync.set({ settings: { title: 'IA para todos', moderation: true, qrCorner: 'br', qrSize: 'm' } });
  }, ROOM);
  await opts.reload();
  await sleep(800);
  await save(opts, 'options');
  await opts.evaluate(() => document.querySelector('#diapositivas').scrollIntoView());
  await save(opts, 'options-ajustes');

  // ---------- presentación con la capa
  const slides = await browser.newPage();
  await slides.setRequestInterception(true);
  slides.on('request', (req) => (req.url().startsWith('https://charla.example.com/') ? req.respond({ status: 200, contentType: 'text/html; charset=utf-8', body: SLIDES_HTML }) : req.continue()));
  await slides.setViewport({ width: 1280, height: 720, deviceScaleFactor: 2 });
  await slides.goto('https://charla.example.com/presentacion');
  const tabId = await opts.evaluate(async () => (await chrome.tabs.query({ url: 'https://charla.example.com/*' }))[0]?.id);
  await sw({ type: 'overlay:pin', tabId, on: true });
  await waitFor(async () => (await state())?.status === 'ready', { timeout: 25000 });
  const { identity } = await sw({ type: 'session:get' });
  const hostId = `preguntazo-${identity.code.toLowerCase()}`;

  // ---------- público simulado (para el contador y las reacciones)
  const ice = await fetch('https://mando-turn.mjmc4498.workers.dev/ice').then((r) => r.json()).catch(() => null);
  const config = ice?.iceServers ? { iceServers: ice.iceServers } : { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
  const crowd = await (await audience.createBrowserContext()).newPage();
  await crowd.goto(`${BASE}/remote/privacy.html`);
  await crowd.addScriptTag({ url: `${BASE}/remote/peerjs.min.js` });
  const CROWD = Number(process.env.PUBLICO) || 46;
  await crowd.evaluate(async (hostId, n, config) => {
    window.people = [];
    await Promise.all(Array.from({ length: n }, (_, i) => new Promise((resolve) => setTimeout(() => {
      const peer = new Peer({ debug: 0, config });
      const p = { peer, conn: null, ok: false };
      window.people.push(p);
      const attempt = () => {
        if (p.ok) return;
        try { p.conn?.close(); } catch {}
        const conn = peer.connect(hostId, { serialization: 'json', reliable: true });
        p.conn = conn;
        setTimeout(() => { if (!conn.open) attempt(); }, 8000);
        conn.on('open', () => conn.send({ t: 'hello', pid: `publico${String(i).padStart(4, '0')}x`, name: '' }));
        conn.on('data', (m) => { if (m.t === 'welcome') { p.ok = true; resolve(); } });
      };
      peer.on('open', attempt);
      peer.on('error', () => {});
      setTimeout(resolve, 40000);
    }, i * 120))));
  }, hostId, CROWD, config);
  const react = (bursts = 3) => crowd.evaluate((bursts) => {
    let k = 0;
    for (let b = 0; b < bursts; b++) {
      setTimeout(() => {
        for (const p of window.people) if (p.ok && Math.random() < 0.35) p.conn.send({ t: 'r', e: [0, 1, 3, 0, 5, 2][k++ % 6], n: 1 + (k % 2) });
      }, b * 260);
    }
  }, bursts);
  await waitFor(async () => (await state())?.count >= CROWD * 0.8, { timeout: 30000 });
  console.log(`   (público simulado: ${(await state())?.count} personas)`);

  // ---------- capa sobre las diapositivas
  await slides.bringToFront();
  await react(4);
  await sleep(1300);
  await save(slides, 'slides-reacciones', { wait: 0 });

  await sw({ type: 'cmd', op: 'q:spot', id: 'q1' });
  await sleep(700);
  await react(2);
  await sleep(900);
  await save(slides, 'slides-pregunta', { wait: 0 });

  await sw({ type: 'cmd', op: 'poll:spot', id: 'p1' });
  await sleep(1200);
  await save(slides, 'slides-encuesta');

  await sw({ type: 'cmd', op: 'poll:spot', id: 'p2' });
  await sleep(1200);
  await save(slides, 'slides-nube');

  await sw({ type: 'cmd', op: 'qr:big', on: true });
  await sleep(1000);
  await save(slides, 'slides-qr-grande');
  await sw({ type: 'cmd', op: 'spot:clear' });

  // Segunda diapositiva, solo con el QR y reacciones
  await slides.keyboard.press('ArrowRight');
  await react(3);
  await sleep(1200);
  await save(slides, 'slides-diapositiva-2', { wait: 0 });
  await slides.keyboard.press('ArrowLeft');

  // ---------- panel (popup)
  const popup = await browser.newPage();
  await popup.setViewport({ width: 360, height: 640, deviceScaleFactor: 2 });
  await popup.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
  await popup.goto(`chrome-extension://${extId}/popup.html?tab=${tabId}`);
  await sleep(1200);
  const h = await popup.evaluate(() => document.documentElement.scrollHeight);
  await popup.setViewport({ width: 360, height: h, deviceScaleFactor: 2 });
  await save(popup, 'popup');
  await popup.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
  await save(popup, 'popup-oscuro');

  // ---------- panel del presentador
  const panel = await browser.newPage();
  await panel.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });
  await panel.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
  await panel.goto(`chrome-extension://${extId}/panel.html#preguntas`);
  await sw({ type: 'cmd', op: 'q:spot', id: 'q2' });
  await sleep(1500);
  await react(2);
  await sleep(700);
  await save(panel, 'panel-preguntas', { wait: 0 });
  await sw({ type: 'cmd', op: 'poll:spot', id: 'p1' });
  await panel.click('[data-tab=encuestas]');
  await sleep(1200);
  await save(panel, 'panel-encuestas');
  await panel.click('[data-tab=reacciones]');
  await sleep(600);
  await save(panel, 'panel-reacciones');
  await sw({ type: 'cmd', op: 'spot:clear' });
  await panel.click('[data-tab=preguntas]');

  // ---------- pantalla completa
  const screen = await browser.newPage();
  await screen.setViewport({ width: 1280, height: 720, deviceScaleFactor: 2 });
  await screen.goto(`chrome-extension://${extId}/pantalla.html`);
  await sleep(1500);
  await screen.evaluate(() => document.body.classList.add('clean'));
  await save(screen, 'pantalla');

  // ---------- celular real
  const phoneCtx = await audience.createBrowserContext();
  const phone = await phoneCtx.newPage();
  await phone.setUserAgent(IPHONE_UA);
  await phone.setViewport(IPHONE);
  await phone.goto(`${BASE}/remote/#${identity.code}`);
  await waitFor(() => phone.$eval('#join', (j) => !j.hidden), { timeout: 25000 });
  await sleep(500);
  await save(phone, 'phone-bienvenida');
  await phone.type('#name-input', 'Carla');
  await phone.click('#join-form button[type=submit]');
  await sleep(600);
  // Vota dos preguntas y deja escrita una nueva.
  await phone.click('#tab-q');
  await sleep(300);
  for (const id of ['q1', 'q3']) await phone.$eval(`#qlist li[data-id="${id}"] .vote`, (b) => b.click()).catch(() => {});
  await sleep(600);
  await phone.evaluate(() => window.scrollTo(0, 0));
  await save(phone, 'phone-preguntas');
  await phone.type('#q-text', '¿Qué opinas de usar IA para preparar las clases?');
  await sleep(300);
  await save(phone, 'phone-escribiendo');
  await phone.click('#send');
  await sleep(1200);
  await save(phone, 'phone-enviada');

  // Encuesta: nube de palabras abierta
  await phone.click('#tab-poll');
  await sleep(500);
  await save(phone, 'phone-encuesta-palabras');
  await phone.type('#poll-body .words-form input', 'Curiosidad');
  await phone.click('#poll-body .words-form button');
  await sleep(1200);
  await save(phone, 'phone-nube');

  // Encuesta de opción única: abrir, votar, ver resultados
  await sw({ type: 'cmd', op: 'poll:reset', id: 'p1' });
  await sw({ type: 'cmd', op: 'poll:open', id: 'p1' });
  await crowd.evaluate(() => {
    const dist = [0, 0, 0, 1, 1, 1, 1, 2, 2, 3];
    window.people.forEach((p, i) => p.ok && i % 5 !== 0 && p.conn.send({ t: 'v', id: 'p1', c: dist[i % dist.length] }));
  });
  await sleep(1200);
  await save(phone, 'phone-encuesta');
  await phone.click('#poll-body .opt[data-i="0"]');
  await sleep(1400);
  await save(phone, 'phone-resultados');

  // Reacciones desde el celular
  await phone.click('#tab-q');
  await sleep(300);
  const buttons = await phone.$$('.react');
  for (const i of [0, 1, 0, 3, 1, 0, 5, 3]) { await buttons[i].tap(); await sleep(70); }
  await sleep(250);
  await save(phone, 'phone-reacciones', { wait: 0 });

  // Logo para la presentación
  fs.copyFileSync(path.join(ROOT, 'remote', 'icon-512.png'), path.join(PRES, 'logo-512.png'));
} finally {
  await audience.close();
  await browser.close();
  fs.rmSync(TMP, { recursive: true, force: true });
}

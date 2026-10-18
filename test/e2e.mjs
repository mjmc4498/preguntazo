// Prueba de punta a punta de Preguntazo: la extensión real, una presentación de prueba
// con la capa encima, el panel del presentador y tres «celulares» (la página real del
// público en contextos separados) conectados por PeerJS. Requiere un servidor local:
//   npm run serve        (otra terminal)
//   npm run test:e2e
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import puppeteer from 'puppeteer';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.env.BASE || 'http://localhost:8768';
const SLIDES_URL = 'https://charla.example.com/presentacion';
const SLIDES_HTML = fs.readFileSync(path.join(ROOT, 'design', 'demo', 'charla.html'), 'utf8');

// La extensión de prueba y el perfil van a la carpeta temporal del sistema: si el
// proyecto está en un Escritorio sincronizado con iCloud, ahí aparecen copias de
// conflicto («_locales 2») que Chrome no acepta. El acceso a la presentación de prueba
// se concede desde el manifiesto (el diálogo de Chrome no se puede pulsar sin ventana).
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'preguntazo-e2e-'));
const EXT = path.join(TMP, 'extension');
fs.cpSync(path.join(ROOT, 'extension'), EXT, { recursive: true });
const manifestPath = path.join(EXT, 'manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
manifest.host_permissions = ['https://charla.example.com/*'];
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(fn, { timeout = 15000, interval = 150 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try { const v = await fn(); if (v) return v; } catch {}
    await sleep(interval);
  }
  return null;
}

const browser = await puppeteer.launch({
  headless: true,
  pipe: true,
  userDataDir: path.join(TMP, 'perfil'),
  enableExtensions: [EXT],
  args: ['--window-size=1400,900', '--hide-scrollbars'],
  defaultViewport: null,
});

const IPHONE = { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1';

try {
  const swTarget = await browser.waitForTarget((t) => t.type() === 'service_worker' && t.url().endsWith('/background.js'), { timeout: 15000 });
  const extId = new URL(swTarget.url()).host;
  check('la extensión carga y su service worker arranca', !!extId);

  // ---------- bienvenida
  const opts = await waitFor(async () => (await browser.pages()).find((p) => p.url().includes('options.html')), { timeout: 8000 });
  check('al instalar se abre la bienvenida', !!opts);
  const ext = opts || (await browser.newPage());
  if (!opts) await ext.goto(`chrome-extension://${extId}/options.html`);
  const sw = (msg) => ext.evaluate((m) => chrome.runtime.sendMessage({ to: 'sw', ...m }), msg);
  const state = async () => (await ext.evaluate(() => chrome.storage.session.get('state'))).state;
  const setSettings = (patch) => ext.evaluate(async (p) => {
    const { settings } = await chrome.storage.sync.get('settings');
    await chrome.storage.sync.set({ settings: { ...(settings || {}), ...p } });
  }, patch);
  await setSettings({ remoteUrl: `${BASE}/remote/`, title: 'IA para todos' });
  check('la bienvenida muestra el QR y el código de la sala', await waitFor(() => ext.$eval('#room-code', (e) => /^[A-Z0-9]{3}-[A-Z0-9]{3}$/.test(e.textContent))));

  // ---------- presentación con la capa encima
  const slides = await browser.newPage();
  await slides.setRequestInterception(true);
  slides.on('request', (req) => {
    if (req.url().startsWith('https://charla.example.com/')) req.respond({ status: 200, contentType: 'text/html; charset=utf-8', body: SLIDES_HTML });
    else req.continue();
  });
  await slides.setViewport({ width: 1280, height: 720 });
  await slides.goto(SLIDES_URL);
  const slidesTab = await ext.evaluate(async (url) => (await chrome.tabs.query({ url: url + '*' }))[0]?.id, 'https://charla.example.com/');
  const pin = await sw({ type: 'overlay:pin', tabId: slidesTab, on: true });
  check('«Mostrar en esta pestaña» inserta la capa en la presentación', pin?.ok === true, JSON.stringify(pin));
  const ready = await waitFor(async () => (await state())?.status === 'ready', { timeout: 20000 });
  check('la sala se abre en el servidor de señalización', !!ready, (await state())?.status);
  const { identity } = await sw({ type: 'session:get' });
  check('el código de la sala tiene 6 caracteres legibles', /^[A-HJ-NP-Z2-9]{6}$/.test(identity?.code || ''), identity?.code);
  const overlay = () => slides.$eval('preguntazo-capa', (h) => ({ ...h.dataset, open: h.matches(':popover-open') })).catch(() => null);
  check('la capa queda en la «top layer» (encima de la pantalla completa)', await waitFor(async () => (await overlay())?.open));

  // ---------- panel del presentador
  const panel = await browser.newPage();
  await panel.setViewport({ width: 1400, height: 900 });
  await panel.goto(`chrome-extension://${extId}/panel.html`);
  check('el panel muestra el código de la sala', await waitFor(() => panel.$eval('#code-chip', (e) => e.textContent.replace('-', '') === e.textContent.replace('-', '') && e.textContent.length === 7)));

  // ---------- público
  const phones = [];
  async function phone(name) {
    const ctx = await browser.createBrowserContext();
    const page = await ctx.newPage();
    await page.setUserAgent(IPHONE_UA);
    await page.setViewport(IPHONE);
    await page.goto(`${BASE}/remote/#${identity.code}`);
    const connected = await waitFor(() => page.$eval('#app', (a) => a.dataset.conn === 'connected'), { timeout: 25000 });
    const joinShown = await waitFor(() => page.$eval('#join', (j) => !j.hidden), { timeout: 5000 });
    if (joinShown) {
      if (name) await page.type('#name-input', name);
      await page.click('#join-form button[type=submit]');
    }
    phones.push(page);
    return { page, connected, joinShown };
  }
  const p1 = await phone('Ana');
  const p2 = await phone('Beto');
  const p3 = await phone('');
  check('tres celulares se conectan con el QR', p1.connected && p2.connected && p3.connected);
  check('el celular da la bienvenida con el nombre de la charla', await p1.page.$eval('#talk-title', (e) => e.textContent === 'IA para todos'));
  check('el panel cuenta 3 personas conectadas', await waitFor(() => panel.$eval('#c-people', (e) => e.textContent === '3'), { timeout: 8000 }));

  // ---------- preguntas
  const QUESTION = '¿Qué herramienta recomiendas para empezar?';
  await p1.page.type('#q-text', QUESTION);
  await p1.page.click('#send');
  check('la pregunta llega al panel', await waitFor(() => panel.$$eval('#qlist .q-text', (els, q) => els.some((e) => e.textContent === q), QUESTION)));
  check('el resto del público ve la pregunta con su autor', await waitFor(() => p2.page.$$eval('#qlist .q', (els) => els.some((e) => e.querySelector('.q-text').textContent.includes('herramienta') && e.querySelector('.q-meta').textContent.includes('Ana')))));
  check('quien pregunta la ve marcada como «Tuya» y no puede votarla', await waitFor(() => p1.page.$eval('#qlist .q', (e) => e.textContent.includes('Tuya') && e.querySelector('.vote').disabled)));
  await p2.page.click('#qlist .vote');
  await p3.page.waitForSelector('#qlist .vote');
  await p3.page.click('#qlist .vote');
  check('dos votos suben la pregunta (panel)', await waitFor(() => panel.$eval('#qlist .q-votes .n', (e) => e.textContent === '2')));
  check('los votos se ven en el resto de celulares', await waitFor(() => p1.page.$eval('#qlist .vote span', (e) => e.textContent === '2')));

  const anon = 'Pregunta anónima de prueba';
  await p2.page.click('#anon');
  await p2.page.type('#q-text', anon);
  await p2.page.click('#send');
  check('una pregunta anónima llega sin nombre', await waitFor(() => panel.$$eval('#qlist .q', (els, text) => els.some((e) => e.querySelector('.q-text').textContent === text && e.querySelector('.q-meta').textContent.includes('Anónimo')), anon)));
  await p2.page.click('#anon');

  // Mostrar la pregunta en pantalla desde el panel
  await panel.$$eval('#qlist .q', (els) => els.find((e) => e.querySelector('.q-text').textContent.includes('herramienta')).querySelector('[data-act=spot]').click());
  check('«Mostrar en pantalla» pone la pregunta sobre la diapositiva', await waitFor(async () => (await overlay())?.spot === 'question'));
  const next = await sw({ type: 'cmd', op: 'q:next' });
  check('«Siguiente pregunta» marca la anterior como respondida y muestra otra', next?.ok && next.id, JSON.stringify(next));
  check('quien preguntó ve su pregunta como respondida', await waitFor(() => p1.page.$$eval('#qlist .q', (els) => els.some((e) => e.textContent.includes('herramienta') && e.textContent.includes('Respondida')))));
  await sw({ type: 'cmd', op: 'spot:clear' });
  check('«Limpiar pantalla» quita lo destacado', await waitFor(async () => (await overlay())?.spot === ''));

  // ---------- encuestas
  await panel.click('[data-tab=encuestas]');
  await panel.type('#poll-q', '¿Cuánto usas la IA?');
  const optionInputs = await panel.$$('#poll-options input');
  await optionInputs[0].type('Mucho');
  await optionInputs[1].type('Poco');
  await panel.click('#save-open');
  check('la encuesta se abre y los celulares cambian a la pestaña Encuesta', await waitFor(() => p2.page.$eval('#view-poll', (v) => !v.hidden)));
  await p1.page.click('#tab-poll').catch(() => {});
  await p1.page.waitForSelector('#poll-body .opt');
  await p1.page.click('#poll-body .opt[data-i="0"]');
  await p2.page.click('#poll-body .opt[data-i="1"]');
  await p3.page.waitForSelector('#poll-body .opt');
  await p3.page.click('#poll-body .opt[data-i="0"]');
  check('el panel recibe los 3 votos', await waitFor(() => panel.$eval('#plist .poll.open .poll-meta', (e) => e.textContent.includes('3 votos'))));
  check('quien votó ve los resultados en vivo (67 %)', await waitFor(() => p1.page.$eval('#poll-body .opt[data-i="0"] .pct', (e) => e.textContent === '67%')));
  await panel.$eval('#plist .poll.open [data-act=spot]', (b) => b.click());
  check('los resultados se muestran sobre la diapositiva', await waitFor(async () => (await overlay())?.spot === 'poll'));
  await panel.$eval('#plist .poll.open [data-act=close]', (b) => b.click());
  check('al cerrar la votación los celulares ven «Votación cerrada»', await waitFor(() => p3.page.$eval('#poll-state', (e) => e.textContent === 'Votación cerrada')));

  // Nube de palabras
  await panel.$$eval('#poll-kind button', (bs) => bs.find((b) => b.dataset.v === 'words').click());
  await panel.type('#poll-q', 'En una palabra, ¿qué te llevas?');
  await panel.click('#save-open');
  for (const [page, word] of [[p1.page, 'Genial'], [p2.page, 'genial'], [p3.page, 'Útil']]) {
    await page.waitForSelector('#poll-body .words-form input', { timeout: 8000 });
    await page.type('#poll-body .words-form input', word);
    await page.click('#poll-body .words-form button');
  }
  check('la nube de palabras agrupa respuestas iguales (Genial ×2)', await waitFor(() => panel.$eval('#plist .poll.open .res-words', (e) => /Genial\s*×2/.test(e.textContent))));

  // ---------- reacciones
  await slides.bringToFront();
  const before = Number((await overlay())?.reactions || 0);
  const btn = await p3.page.$('.react[data-i="0"]');
  for (let i = 0; i < 5; i++) { await btn.tap(); await sleep(60); }
  check('las reacciones flotan sobre la diapositiva', await waitFor(async () => Number((await overlay())?.reactions || 0) >= before + 5), `${(await overlay())?.reactions}`);
  check('el panel suma las reacciones', await waitFor(() => panel.$eval('#c-reactions', (e) => Number(e.textContent) >= 5)));
  // Límite por celular: 60 toques seguidos no pasan todos.
  for (let i = 0; i < 60; i++) await btn.tap();
  await sleep(1500);
  const after = Number((await overlay())?.reactions || 0);
  check('cada celular tiene un límite de reacciones por segundo', after - before < 50, `${after - before} reacciones de 65 toques`);

  // ---------- QR grande y pantalla completa
  await sw({ type: 'cmd', op: 'qr:big', on: true });
  check('el QR grande aparece sobre la diapositiva', await waitFor(async () => (await overlay())?.lobby === '1'));
  await sw({ type: 'cmd', op: 'qr:big', on: false });
  await sw({ type: 'cmd', op: 'spot:clear' });
  const screen = await browser.newPage();
  await screen.goto(`chrome-extension://${extId}/pantalla.html`);
  check('la pantalla completa muestra el QR cuando no hay nada destacado', await waitFor(() => screen.$eval('#stage', (h) => h.dataset.lobby === '1')));
  await screen.close();

  // ---------- moderación
  await panel.click('[data-tab=preguntas]');
  await setSettings({ moderation: true });
  await sleep(500);
  const MOD = 'Pregunta que espera revisión';
  await p2.page.click('#tab-q');
  await sleep(4000); // límite: una pregunta cada 3 s por celular
  await p2.page.type('#q-text', MOD);
  await p2.page.click('#send');
  check('con moderación la pregunta espera en «Por revisar»', await waitFor(() => panel.$eval('#f-pending', (e) => e.textContent === '1')));
  check('quien pregunta la ve «En revisión»', await waitFor(() => p2.page.$eval('#mine-list', (e) => e.textContent.includes('En revisión'))));
  const visibleBefore = await p3.page.$$eval('#qlist .q-text', (els, text) => els.some((e) => e.textContent === text), MOD);
  check('el resto del público aún no la ve', !visibleBefore);
  await panel.$$eval('#qlist .q', (els, text) => els.find((e) => e.querySelector('.q-text').textContent === text).querySelector('[data-act=approve]').click(), MOD);
  check('al aprobarla aparece en todos los celulares', await waitFor(() => p3.page.$$eval('#qlist .q-text', (els, text) => els.some((e) => e.textContent === text), MOD)));
  await setSettings({ moderation: false, questionsOpen: false });
  check('al cerrar las preguntas el celular oculta el formulario', await waitFor(() => p1.page.$eval('#composer', (f) => f.hidden)));
  await setSettings({ questionsOpen: true });

  // ---------- desconectar a una persona
  await panel.click('[data-tab=publico]');
  const kicked = await panel.$$eval('#people li', (els) => {
    const li = els.find((e) => e.querySelector('.person b').textContent === 'Anónimo');
    if (!li) return false;
    const b = li.querySelector('[data-act=kick]');
    b.click();
    b.click();
    return true;
  });
  check('el panel puede desconectar a alguien', kicked && (await waitFor(() => p3.page.$eval('#gate-title', (e) => e.textContent === 'Desconectado'))));

  // ---------- las preguntas sobreviven a cerrar y abrir la sala
  await sw({ type: 'session:stop' });
  check('al cerrar la sala, el celular muestra «La sala se cerró»', await waitFor(() => p1.page.$eval('#gate-title', (e) => e.textContent === 'La sala se cerró')));
  await sw({ type: 'session:start' });
  check('el celular vuelve a entrar solo al reabrir la sala', await waitFor(() => p1.page.$eval('#app', (a) => a.dataset.conn === 'connected'), { timeout: 30000 }));
  check('las preguntas se conservan al reabrir la sala', await waitFor(() => panel.$$eval('#qlist .q', (els) => els.length >= 3), { timeout: 10000 }));

  // ---------- código nuevo
  await sw({ type: 'session:reset' });
  check('con un código nuevo, el código anterior deja de funcionar', await waitFor(() => p1.page.$eval('#gate-title', (e) => e.textContent === 'Código no válido'), { timeout: 10000 }));
} catch (err) {
  check('la prueba terminó sin errores', false, err.stack || String(err));
} finally {
  await browser.close();
  fs.rmSync(TMP, { recursive: true, force: true });
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} comprobaciones correctas`);
process.exit(failed.length ? 1 : 0);

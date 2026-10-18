// Prueba de carga de Preguntazo: una sala real (la extensión) y muchas personas a la vez,
// simuladas con conexiones PeerJS ligeras (sin la interfaz del celular). Mide cuánto
// tardan en entrar, si llegan todos los votos y las reacciones, y la latencia hasta la
// capa sobre las diapositivas.
//   npm run serve                    (otra terminal)
//   npm run test:carga               (60 personas; CARGA=120 npm run test:carga)
//
// Usa el servidor público de señalización de PeerJS: no subas mucho el número.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import puppeteer from 'puppeteer';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.env.BASE || 'http://localhost:8768';
const N = Math.max(5, Math.min(250, Number(process.env.CARGA) || 60));
const PER_PAGE = 30;
const SLIDES_HTML = fs.readFileSync(path.join(ROOT, 'design', 'demo', 'charla.html'), 'utf8');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'preguntazo-carga-'));
const EXT = path.join(TMP, 'extension');
fs.cpSync(path.join(ROOT, 'extension'), EXT, { recursive: true });
const manifestPath = path.join(EXT, 'manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
manifest.host_permissions = ['https://charla.example.com/*'];
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, { timeout = 30000, interval = 250 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try { const v = await fn(); if (v) return v; } catch {}
    await sleep(interval);
  }
  return null;
}
const pct = (arr, p) => {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return Math.round(s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]);
};

const browser = await puppeteer.launch({
  headless: true,
  pipe: true,
  userDataDir: path.join(TMP, 'perfil'),
  enableExtensions: [EXT],
  args: ['--window-size=1400,900'],
  defaultViewport: null,
});

const audience = await puppeteer.launch({ headless: true, pipe: true, args: ['--disable-features=WebRtcHideLocalIpsWithMdns'] });

let ok = true;
try {
  const swTarget = await browser.waitForTarget((t) => t.type() === 'service_worker' && t.url().endsWith('/background.js'), { timeout: 15000 });
  const extId = new URL(swTarget.url()).host;
  const ext = (await waitFor(async () => (await browser.pages()).find((p) => p.url().includes('options.html')), { timeout: 8000 })) || (await browser.newPage());
  if (!ext.url().includes(extId)) await ext.goto(`chrome-extension://${extId}/options.html`);
  const sw = (msg) => ext.evaluate((m) => chrome.runtime.sendMessage({ to: 'sw', ...m }), msg);
  const state = async () => (await ext.evaluate(() => chrome.storage.session.get('state'))).state;

  const slides = await browser.newPage();
  await slides.setRequestInterception(true);
  slides.on('request', (req) => (req.url().startsWith('https://charla.example.com/') ? req.respond({ status: 200, contentType: 'text/html', body: SLIDES_HTML }) : req.continue()));
  await slides.setViewport({ width: 1280, height: 720 });
  await slides.goto('https://charla.example.com/');
  const tabId = await ext.evaluate(async () => (await chrome.tabs.query({ url: 'https://charla.example.com/*' }))[0]?.id);
  await sw({ type: 'overlay:pin', tabId, on: true });
  await waitFor(async () => (await state())?.status === 'ready');
  const { identity } = await sw({ type: 'session:get' });
  const hostId = `preguntazo-${identity.code.toLowerCase()}`;
  console.log(`Sala ${identity.code} · ${N} personas simuladas`);

  // La capa avisa en el DOM cuántas reacciones recibió (data-reactions).
  await slides.evaluate(() => {
    window.__marks = [];
    const host = document.querySelector('preguntazo-capa');
    new MutationObserver(() => window.__marks.push([Date.now(), Number(host.dataset.reactions || 0)])).observe(host, { attributes: true, attributeFilter: ['data-reactions'] });
  });

  // Público: otro Chrome (otro proceso, como los celulares de verdad) con varias páginas
  // de muchas conexiones PeerJS cada una.
  const swarm = [];
  for (let i = 0; i < N; i += PER_PAGE) {
    const ctx = await audience.createBrowserContext();
    const page = await ctx.newPage();
    await page.goto(`${BASE}/remote/privacy.html`);
    await page.addScriptTag({ url: `${BASE}/remote/peerjs.min.js` });
    swarm.push({ page, count: Math.min(PER_PAGE, N - i) });
  }
  const ice = await fetch('https://mando-turn.mjmc4498.workers.dev/ice').then((r) => r.json()).catch(() => null);
  const config = ice?.iceServers ? { iceServers: ice.iceServers } : { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

  const t0 = Date.now();
  await Promise.all(swarm.map(({ page, count }, s) => page.evaluate(async (hostId, count, offset, config, pages) => {
    window.people = [];
    // Igual que la página del celular: si la conexión no abre en 8 s, se reintenta.
    const joinOne = (i) => new Promise((resolve) => {
      const start = performance.now();
      const person = { i, peer: null, conn: null, joinMs: -1, voted: false, stage: 'signaling', err: '', tries: 0 };
      window.people.push(person);
      const fail = setTimeout(() => resolve(person), 45000);
      const peer = new Peer({ debug: 0, config });
      person.peer = peer;
      const attempt = () => {
        if (person.joinMs >= 0) return;
        person.tries++;
        try { person.conn?.close(); } catch {}
        person.stage = 'webrtc';
        const conn = peer.connect(hostId, { serialization: 'json', reliable: true });
        person.conn = conn;
        const retry = setTimeout(() => { if (!conn.open) attempt(); }, 8000);
        conn.on('open', () => { clearTimeout(retry); person.stage = 'hello'; conn.send({ t: 'hello', pid: `carga${String(offset + i).padStart(5, '0')}x`, name: `Persona ${offset + i + 1}` }); });
        conn.on('data', (m) => {
          if (m.t === 'welcome') { person.joinMs = performance.now() - start; clearTimeout(fail); resolve(person); }
          if (m.t === 'done' && m.what === 'vote') person.voted = m.ok;
          if (m.t === 'poll') person.poll = m.poll;
        });
      };
      peer.on('open', attempt);
      peer.on('error', (e) => { person.err = e.type; if (e.type === 'peer-unavailable') setTimeout(attempt, 1500); });
    });
    // Llegan escalonados, como en una sala real: unas 10 personas por segundo en total.
    await Promise.all(Array.from({ length: count }, (_, i) => new Promise((r) => setTimeout(r, (i * pages + offset / 30) * 100)).then(() => joinOne(i))));
    return window.people.filter((p) => p.joinMs >= 0).length;
  }, hostId, count, s * PER_PAGE, config, swarm.length)));
  const joinTotal = Date.now() - t0;

  const joins = (await Promise.all(swarm.map(({ page }) => page.evaluate(() => window.people.map((p) => p.joinMs))))).flat();
  const retried = (await Promise.all(swarm.map(({ page }) => page.evaluate(() => window.people.filter((p) => p.tries > 1).length)))).reduce((a, b) => a + b, 0);
  const joined = joins.filter((x) => x >= 0);
  const stuck = (await Promise.all(swarm.map(({ page }) => page.evaluate(() => window.people.filter((p) => p.joinMs < 0).map((p) => `${p.stage}${p.err ? ':' + p.err : ''}`))))).flat();
  if (stuck.length) {
    const byStage = stuck.reduce((m, k) => ({ ...m, [k]: (m[k] || 0) + 1 }), {});
    console.log('Sin entrar:', JSON.stringify(byStage));
    const order = (await Promise.all(swarm.map(({ page }, s) => page.evaluate((s) => window.people.map((p) => [s * 30 + p.i, p.joinMs >= 0 ? 1 : 0]), s)))).flat().sort((a, b) => a[0] - b[0]);
    if (process.env.DEBUG) console.log('Orden (1=entró):', order.map(([, v]) => v).join(''));
  }
  const count = await waitFor(async () => ((await state())?.count >= joined.length ? (await state()).count : null), { timeout: 10000 });
  console.log(`Entraron ${joined.length}/${N} en ${(joinTotal / 1000).toFixed(1)} s · mediana ${pct(joined, 50)} ms · p95 ${pct(joined, 95)} ms · la extensión cuenta ${count ?? (await state())?.count} · ${retried} reintentaron`);
  if (joined.length < N * 0.95) ok = false;

  // Encuesta: todos votan a la vez.
  const panel = await browser.newPage();
  await panel.goto(`chrome-extension://${extId}/panel.html`);
  const saved = await sw({ type: 'cmd', op: 'poll:save', poll: { q: '¿Te gusta la charla?', kind: 'single', options: ['Sí', 'Mucho', 'Más o menos'] } });
  await sw({ type: 'cmd', op: 'poll:open', id: saved.id });
  await sleep(800);
  const tv = Date.now();
  await Promise.all(swarm.map(({ page }) => page.evaluate((id) => {
    for (const p of window.people) if (p.conn?.open) p.conn.send({ t: 'v', id, c: p.i % 3 });
  }, saved.id)));
  const allVotes = await waitFor(async () => {
    const s = await state();
    return s?.poll?.total >= joined.length ? s.poll.total : null;
  }, { timeout: 20000, interval: 100 });
  console.log(`Votos: ${allVotes ?? (await state())?.poll?.total}/${joined.length} contados en ${Date.now() - tv} ms`);
  if (!allVotes) ok = false;
  const resultsSeen = await waitFor(async () => {
    const seen = await Promise.all(swarm.map(({ page }) => page.evaluate(() => window.people.filter((p) => p.poll?.total >= p.poll?.results?.counts?.reduce?.((a, b) => a + b, 0) && p.poll.total > 0).length)));
    return seen.reduce((a, b) => a + b, 0) >= joined.length * 0.95;
  }, { timeout: 10000 });
  console.log(`Resultados en vivo recibidos por el público: ${resultsSeen ? 'sí' : 'no'}`);

  // Reacciones: una ráfaga de todo el público.
  await slides.bringToFront();
  const before = Number(await slides.$eval('preguntazo-capa', (h) => h.dataset.reactions || 0));
  const tr = Date.now();
  await Promise.all(swarm.map(({ page }) => page.evaluate(() => {
    for (const p of window.people) if (p.conn?.open) p.conn.send({ t: 'r', e: p.i % 6, n: 3 });
  })));
  const expected = joined.length * 3;
  const got = await waitFor(async () => {
    const n = Number(await slides.$eval('preguntazo-capa', (h) => h.dataset.reactions || 0)) - before;
    return n >= expected ? n : null;
  }, { timeout: 10000, interval: 50 });
  const firstMark = await slides.evaluate((t) => window.__marks.find(([ts]) => ts >= t)?.[0], tr);
  console.log(`Reacciones: ${got ?? '<' + expected}/${expected} en la capa · la primera tardó ${firstMark ? firstMark - tr : '?'} ms y todas ${Date.now() - tr} ms`);
  if (!got) ok = false;

  // Preguntas: 20 personas preguntan a la vez.
  const tq = Date.now();
  await swarm[0].page.evaluate(() => {
    window.people.slice(0, 20).forEach((p, i) => p.conn?.open && p.conn.send({ t: 'ask', text: `Pregunta de carga número ${i + 1}`, cid: `c${i}` }));
  });
  const questions = await waitFor(async () => ((await state())?.questions >= 20 ? (await state()).questions : null), { timeout: 10000, interval: 100 });
  console.log(`Preguntas simultáneas: ${questions ?? (await state())?.questions}/20 en ${Date.now() - tq} ms`);
  if (!questions) ok = false;

  for (const { page } of swarm) await page.evaluate(() => window.people.forEach((p) => { try { p.peer.destroy(); } catch {} })).catch(() => {});
  const memory = await ext.evaluate(() => performance.memory?.usedJSHeapSize).catch(() => null);
  if (memory) console.log(`Memoria de la página de ajustes: ${(memory / 1048576).toFixed(1)} MB`);
} catch (err) {
  ok = false;
  console.error(err);
} finally {
  await audience.close();
  await browser.close();
  fs.rmSync(TMP, { recursive: true, force: true });
}
console.log(ok ? '\nCARGA OK' : '\nCARGA CON FALLAS');
process.exit(ok ? 0 : 1);

/* global PreguntazoStage */
import { applyI18n } from './lib/i18n.js';
import { connectLive } from './lib/live.js';

// Pantalla completa de Preguntazo: el QR en grande mientras nadie está destacado, y
// la pregunta o la encuesta en pantalla cuando el presentador la elige. Sirve para el
// proyector (sin diapositivas en Chrome) o para capturar la ventana en OBS.

applyI18n();
const $ = (id) => document.getElementById(id);
const sw = (type, extra = {}) => chrome.runtime.sendMessage({ to: 'sw', type, ...extra });

await sw('session:start');
const stage = new PreguntazoStage($('stage'), { mode: 'screen' });
let view = null;
const live = connectLive('pantalla', {
  onView: (v) => {
    view = v;
    stage.setView(v);
    $('big-qr').setAttribute('aria-pressed', String(!!v.bigQr || !v.spot));
  },
  onReact: (list) => stage.react(list),
  onToast: (text, name) => stage.toast(text, name),
});

$('big-qr').addEventListener('click', () => {
  // Sin nada destacado, el QR ya está en grande: el botón quita lo destacado.
  if (view?.spot) live.cmd('qr:big', { on: !view.bigQr });
  else live.cmd('qr:big', { on: false });
});
$('next-q').addEventListener('click', () => live.cmd('q:next'));
$('clear').addEventListener('click', () => live.cmd('spot:clear'));
$('fullscreen').addEventListener('click', toggleFullscreen);

function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  else document.documentElement.requestFullscreen().catch(() => {});
}

// Teclas: F pantalla completa, H oculta los controles, Q QR, N siguiente pregunta, Esc limpia.
addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const k = e.key.toLowerCase();
  if (k === 'f') toggleFullscreen();
  else if (k === 'h') document.body.classList.toggle('clean');
  else if (k === 'q') $('big-qr').click();
  else if (k === 'n' || k === 'arrowright') live.cmd('q:next');
  else if (k === 'escape' && !document.fullscreenElement) live.cmd('spot:clear');
});

// Los controles y el cursor se ocultan solos tras unos segundos sin mover el mouse.
let idleTimer = 0;
function wake() {
  document.body.classList.remove('idle');
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => document.body.classList.add('idle'), 2600);
}
addEventListener('mousemove', wake);
addEventListener('mousedown', wake);
wake();
setTimeout(() => $('hint').classList.add('gone'), 6000);

// Preguntazo — configuración compartida por el service worker, el documento offscreen,
// el popup, el panel, la pantalla y los ajustes.

// Página que abre el público en su celular (carpeta /remote publicada en GitHub Pages).
// Si la publicas en otra dirección, cámbiala aquí o en Ajustes › Avanzado.
export const REMOTE_URL = 'https://mjmc4498.github.io/preguntazo/';

// Prefijo de los identificadores de sala en el servidor de señalización PeerJS.
// El identificador completo es el prefijo + el código de la sala en minúsculas.
export const ID_PREFIX = 'preguntazo-';

// Código de la sala: 6 caracteres sin los que se confunden (0/O, 1/I/L). Se puede
// escribir a mano en el celular y deja un QR poco denso, legible desde lejos.
export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const CODE_LENGTH = 6;

// Worker de Cloudflare que entrega credenciales temporales del servidor de
// retransmisión (TURN) para redes que bloquean la conexión directa (por ejemplo, el
// Wi-Fi de un auditorio que aísla a los equipos). Preguntazo comparte el Worker de
// Presentazo; la carpeta /cloudflare tiene una copia por si prefieres uno propio.
// Vacío = solo conexión directa.
export const ICE_ENDPOINT = 'https://mando-turn.mjmc4498.workers.dev/ice';

// Servidores públicos para la conexión directa cuando el Worker no responde.
export const FALLBACK_ICE = {
  iceServers: [{ urls: 'stun:stun.cloudflare.com:3478' }, { urls: 'stun:stun.l.google.com:19302' }],
};

// Reacciones que puede enviar el público (se eligen seis en los ajustes).
export const DEFAULT_EMOJIS = ['👏', '❤️', '😂', '🔥', '🤯', '👍'];
export const EMOJI_CHOICES = ['👏', '❤️', '😂', '🔥', '🤯', '👍', '🎉', '😮', '🙌', '💡', '🤔', '😍', '🚀', '💯', '🙏', '👀', '😢', '⭐'];

// Acceso a los sitios: permiso opcional. Se concede por sitio («Mostrar en este sitio»
// en el panel) para que las reacciones aparezcan solas al presentar en pantalla completa.
export const ALL_SITES = { origins: ['https://*/*', 'http://*/*'] };

export const DEFAULT_SETTINGS = {
  remoteUrl: '',
  title: '',
  autoStart: false,
  newCodeEachSession: false,
  // Sobre las diapositivas
  qrBadge: true,
  qrCorner: 'br',
  qrSize: 'm',
  autoFullscreen: true,
  newQuestionToast: false,
  // Público
  questionsOpen: true,
  moderation: false,
  anonymous: true,
  publicQuestions: true,
  resultsLive: true,
  reactionsOn: true,
  emojis: DEFAULT_EMOJIS,
};

export async function getSettings() {
  const { settings } = await chrome.storage.sync.get('settings');
  return normalizeSettings(settings);
}

export async function saveSettings(patch) {
  const next = normalizeSettings({ ...(await getSettings()), ...patch });
  await chrome.storage.sync.set({ settings: next });
  return next;
}

export function normalizeSettings(raw) {
  const s = { ...DEFAULT_SETTINGS, ...(raw || {}) };
  s.title = typeof s.title === 'string' ? s.title.replace(/[\u0000-\u001f]/g, '').slice(0, 80) : '';
  if (!['tl', 'tr', 'bl', 'br'].includes(s.qrCorner)) s.qrCorner = 'br';
  if (!['s', 'm', 'l'].includes(s.qrSize)) s.qrSize = 'm';
  const emojis = Array.isArray(s.emojis) ? s.emojis.filter((e) => EMOJI_CHOICES.includes(e)) : [];
  s.emojis = emojis.length ? [...new Set(emojis)].slice(0, 6) : [...DEFAULT_EMOJIS];
  return s;
}

export function randomCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH * 2));
  let code = '';
  for (const b of bytes) {
    // Se descartan los valores que harían más probable alguna letra.
    if (b >= 248) continue;
    code += CODE_ALPHABET[b % CODE_ALPHABET.length];
    if (code.length === CODE_LENGTH) break;
  }
  return code.length === CODE_LENGTH ? code : randomCode();
}

export const peerIdFor = (code) => ID_PREFIX + String(code).toLowerCase();

// «K7QM4P» → «K7Q-M4P» (más fácil de leer en voz alta y de escribir).
export const formatCode = (code = '') => (code.length === 6 ? `${code.slice(0, 3)}-${code.slice(3)}` : code);

// El código va en el fragmento (#), que nunca llega a un servidor.
export function buildRemoteUrl(base, code) {
  const url = new URL(base || REMOTE_URL);
  url.hash = code;
  return url.toString();
}

// Dirección corta para escribir a mano: «mjmc4498.github.io/preguntazo».
export function shortRemote(base) {
  const url = new URL(base || REMOTE_URL);
  return (url.host + url.pathname).replace(/\/$/, '');
}

// Patrón de permiso de un sitio («https://docs.google.com/*»), o null si Chrome no
// permite extensiones ahí.
export function originPattern(url = '') {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    if (u.hostname === 'chromewebstore.google.com' || (u.hostname === 'chrome.google.com' && u.pathname.startsWith('/webstore'))) return null;
    return `${u.protocol}//${u.hostname}/*`;
  } catch {
    return null;
  }
}

export const hasAllSites = () => chrome.permissions.contains(ALL_SITES);

export async function grantedOrigins() {
  const { origins = [] } = await chrome.permissions.getAll();
  return origins.filter((o) => /^https?:\/\//.test(o));
}

// Chrome solo muestra su diálogo si se llama directamente desde un clic del usuario.
export const requestOrigins = (origins) => chrome.permissions.request({ origins }).catch(() => false);
export const removeOrigins = (origins) => chrome.permissions.remove({ origins }).catch(() => false);

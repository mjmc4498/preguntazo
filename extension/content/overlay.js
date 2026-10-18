// Preguntazo — capa sobre las diapositivas.
// Se inserta en la pestaña de la presentación (con «Mostrar en esta pestaña», con un
// atajo o, en los sitios permitidos, sola al presentar en pantalla completa) y dibuja
// el QR, las reacciones del público y la pregunta o encuesta destacada.
// No lee ni modifica el contenido de la página: solo agrega una capa transparente que
// no recibe clics.

/* global PreguntazoStage */
(() => {
  if (!chrome.runtime?.id) return;
  if (globalThis.__preguntazoOverlay) return;
  globalThis.__preguntazoOverlay = true;

  const LIVE_PORT = 'preguntazo-live';
  const TAG = 'preguntazo-capa';

  // Si la extensión se actualizó, quedan capas de la versión anterior sin conexión.
  for (const old of document.querySelectorAll(TAG)) old.remove();

  let active = false;
  let pinned = false;
  let auto = true;
  let host = null;
  let stage = null;
  let port = null;
  let retryTimer = 0;
  let retries = 0;

  const isFullscreen = () => !!document.fullscreenElement || matchMedia('(display-mode: fullscreen)').matches;
  const shouldShow = () => active && (pinned || (auto && isFullscreen()));

  // ---------------------------------------------------------------- capa

  function build() {
    host = document.createElement(TAG);
    host.setAttribute('popover', 'manual');
    const style = {
      position: 'fixed', inset: '0', width: '100vw', height: '100vh', 'max-width': 'none', 'max-height': 'none',
      margin: '0', padding: '0', border: '0', background: 'transparent', 'pointer-events': 'none',
      'z-index': '2147483647', overflow: 'visible', display: 'block', opacity: '1', visibility: 'visible',
      transform: 'none', filter: 'none', contain: 'strict', 'color-scheme': 'normal',
    };
    for (const [k, v] of Object.entries(style)) host.style.setProperty(k, v, 'important');
    stage = new PreguntazoStage(host, { mode: 'overlay' });
    // Evita que un estilo global ::backdrop de la página oscurezca la pantalla.
    const guard = document.createElement('style');
    guard.textContent = `${TAG}::backdrop{display:none!important}`;
    host.appendChild(guard);
  }

  // Lleva la capa a la «top layer»: queda por encima incluso de una presentación en
  // pantalla completa (el elemento en pantalla completa también vive ahí).
  function raise() {
    if (!host?.isConnected) return;
    try {
      if (host.matches(':popover-open')) host.hidePopover();
      host.showPopover();
    } catch {
      const fs = document.fullscreenElement;
      const parent = fs && fs.tagName !== 'IFRAME' && fs.tagName !== 'VIDEO' ? fs : document.documentElement;
      if (host.parentNode !== parent) parent.appendChild(host);
    }
  }

  function show() {
    if (!host) build();
    if (!host.isConnected) document.documentElement.appendChild(host);
    raise();
    connect();
  }

  function hide() {
    disconnect();
    if (host?.isConnected) {
      try { host.hidePopover(); } catch {}
      host.remove();
    }
  }

  function update() {
    if (shouldShow()) show();
    else hide();
  }

  // ---------------------------------------------------------------- conexión con la sala

  function connect() {
    if (port) return;
    clearTimeout(retryTimer);
    try {
      port = chrome.runtime.connect({ name: LIVE_PORT });
    } catch {
      // La extensión se actualizó o se quitó: esta capa ya no sirve.
      hide();
      return;
    }
    const current = port;
    current.onMessage.addListener((m) => {
      retries = 0;
      if (m.t === 'view') stage.setView(m.view);
      else if (m.t === 'react') stage.react(m.list);
      else if (m.t === 'toast') stage.toast(m.text, m.name);
      else if (m.t === 'bye') { active = false; update(); }
    });
    current.onDisconnect.addListener(() => {
      void chrome.runtime.lastError;
      if (port !== current) return;
      port = null;
      // La sala se está iniciando (o se reinició): se vuelve a intentar unos segundos.
      if (shouldShow() && retries < 20) retryTimer = setTimeout(connect, Math.min(500 * ++retries, 3000));
    });
    current.postMessage({ t: 'hello', kind: 'overlay', fullscreen: isFullscreen() });
  }

  function disconnect() {
    clearTimeout(retryTimer);
    if (!port) return;
    const p = port;
    port = null;
    try { p.disconnect(); } catch {}
  }

  // ---------------------------------------------------------------- eventos

  document.addEventListener('fullscreenchange', () => {
    update();
    raise();
    try { port?.postMessage({ t: 'fullscreen', on: isFullscreen() }); } catch {}
  }, true);
  matchMedia('(display-mode: fullscreen)').addEventListener('change', update);
  // Algunas presentaciones abren diálogos en la «top layer»: la capa vuelve arriba.
  addEventListener('resize', () => raise());

  chrome.runtime.onMessage.addListener((m, sender) => {
    if (sender.id !== chrome.runtime.id || !m) return;
    if (m.type === 'overlay:pin') {
      pinned = m.on === true;
      if (pinned) active = true;
      update();
    } else if (m.type === 'overlay:session') {
      active = m.active === true;
      update();
    }
  });

  chrome.runtime.sendMessage({ to: 'sw', type: 'overlay:hello' }).then((res) => {
    if (!res) return;
    active = res.active === true;
    pinned = pinned || res.pinned === true;
    auto = res.auto !== false;
    update();
  }).catch(() => {});
})();

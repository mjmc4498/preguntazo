// Preguntazo — conexión de las páginas de la extensión (panel y pantalla) con la sala.
// Abre un puerto con el documento offscreen; si la sala se reinicia, se reconecta sola.

const LIVE_PORT = 'preguntazo-live';

export function connectLive(kind, handlers = {}) {
  let port = null;
  let closed = false;
  let timer = 0;
  let rid = 0;
  const waiting = new Map();

  function open() {
    if (closed) return;
    port = chrome.runtime.connect({ name: LIVE_PORT });
    const current = port;
    current.onMessage.addListener((m) => {
      if (m.t === 'ack') {
        waiting.get(m.rid)?.(m);
        waiting.delete(m.rid);
      } else if (m.t === 'view') handlers.onView?.(m.view);
      else if (m.t === 'admin') handlers.onAdmin?.(m.admin);
      else if (m.t === 'react') handlers.onReact?.(m.list);
      else if (m.t === 'toast') handlers.onToast?.(m.text, m.name);
      else if (m.t === 'bye') handlers.onBye?.();
    });
    current.onDisconnect.addListener(() => {
      void chrome.runtime.lastError;
      if (port !== current) return;
      port = null;
      for (const resolve of waiting.values()) resolve({ ok: false, error: 'disconnected' });
      waiting.clear();
      handlers.onDisconnect?.();
      clearTimeout(timer);
      timer = setTimeout(open, 800);
    });
    current.postMessage({ t: 'hello', kind });
  }

  open();

  return {
    cmd(op, data = {}) {
      if (!port) return Promise.resolve({ ok: false, error: 'disconnected' });
      const id = ++rid;
      return new Promise((resolve) => {
        waiting.set(id, resolve);
        try {
          port.postMessage({ t: 'cmd', rid: id, op, ...data });
        } catch {
          waiting.delete(id);
          resolve({ ok: false, error: 'disconnected' });
        }
      });
    },
    reconnect() {
      if (!port) { clearTimeout(timer); open(); }
    },
    close() {
      closed = true;
      clearTimeout(timer);
      try { port?.disconnect(); } catch {}
    },
  };
}

// Preguntazo — escenario: lo que ve la sala.
// Dibuja dentro de un shadow root (aislado de los estilos de la página):
//   · reacciones (emojis que suben y se desvanecen),
//   · el QR para participar (en una esquina o en grande),
//   · la pregunta o la encuesta destacada, y avisos discretos.
// Lo usan la capa sobre las diapositivas (content/overlay.js), la pantalla completa
// (pantalla.html) y la vista previa del panel. Todo se mide en unidades del contenedor
// (cqmin): se ve igual en un proyector 4K que en una miniatura.

(() => {
  if (globalThis.PreguntazoStage) return;

  const msg = (key, subs) => {
    try { return chrome.i18n.getMessage(key, subs) || key; } catch { return key; }
  };
  const nf = new Intl.NumberFormat('es');
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const MAX_FX = 80;

  const CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; }
    .stage {
      position: absolute; inset: 0; overflow: hidden; pointer-events: none;
      container-type: size;
      font: 500 16px/1.3 -apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      letter-spacing: -.01em; color: #f5f5f7; -webkit-font-smoothing: antialiased;
      --v: #bf5af2; --v2: #e3a6ff; --v3: #9b30e8;
      --glass: rgba(16, 16, 20, .88);
      --line: rgba(255, 255, 255, .1);
    }
    .stage.screen {
      background: radial-gradient(70cqw 60cqh at 85% 110%, rgba(191, 90, 242, .22), transparent 70%),
                  radial-gradient(50cqw 40cqh at 0% -10%, rgba(191, 90, 242, .10), transparent 70%), #0b0b0c;
    }
    [hidden] { display: none !important; }
    .emoji { font-family: "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif; }

    /* ---------- reacciones */
    /* Por detrás de las tarjetas y del QR: el texto destacado siempre se lee. */
    .fx { position: absolute; inset: 0; overflow: hidden; z-index: 2; }
    .fx span {
      position: absolute; bottom: -12cqmin; left: 0;
      font-size: 7cqmin; line-height: 1;
      filter: drop-shadow(0 .6cqmin 1.2cqmin rgba(0, 0, 0, .35));
      will-change: transform, opacity;
    }

    /* ---------- QR en la esquina */
    .badge {
      position: absolute; z-index: 3; display: flex; flex-direction: column; align-items: center; gap: .9cqmin;
      padding: 1.4cqmin 1.4cqmin 1.2cqmin; border-radius: 2.4cqmin; background: #fff; color: #0b0b0c;
      box-shadow: 0 1.6cqmin 4cqmin -1cqmin rgba(0, 0, 0, .45), 0 0 0 .25cqmin rgba(191, 90, 242, .55);
      transition: opacity .35s ease, transform .35s cubic-bezier(.3, .7, .4, 1);
    }
    .badge.off { opacity: 0; transform: scale(.9); }
    .badge svg { display: block; width: var(--qr); height: var(--qr); }
    .stage.qr-s { --qr: 13cqmin; } .stage.qr-m { --qr: 18cqmin; } .stage.qr-l { --qr: 25cqmin; }
    .badge.tl { top: 3cqmin; left: 3cqmin; transform-origin: top left; }
    .badge.tr { top: 3cqmin; right: 3cqmin; transform-origin: top right; }
    .badge.bl { bottom: 3cqmin; left: 3cqmin; transform-origin: bottom left; }
    .badge.br { bottom: 3cqmin; right: 3cqmin; transform-origin: bottom right; }
    .badge .b-label { font-size: calc(var(--qr) * .085); font-weight: 650; letter-spacing: -.01em; white-space: nowrap; }
    .badge .b-code {
      font-size: calc(var(--qr) * .1); font-weight: 750; letter-spacing: .06em; color: #fff;
      background: linear-gradient(135deg, var(--v), var(--v3)); padding: .35cqmin 1.1cqmin; border-radius: 99px;
    }

    /* ---------- QR en grande (para invitar a participar) */
    .lobby {
      position: absolute; inset: 0; z-index: 4; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4cqmin;
      background: rgba(6, 6, 8, .72); backdrop-filter: blur(1.2cqmin);
      transition: opacity .4s ease;
    }
    .screen .lobby { background: transparent; backdrop-filter: none; }
    .lobby.off { opacity: 0; }
    .lobby-card {
      display: flex; align-items: center; gap: 5cqmin; padding: 4cqmin; border-radius: 4cqmin;
      background: var(--glass); box-shadow: 0 0 0 .2cqmin var(--line), 0 4cqmin 10cqmin -3cqmin rgba(0, 0, 0, .6);
      max-width: 92cqw;
    }
    .lobby-qr { flex: none; padding: 2cqmin; border-radius: 2.6cqmin; background: #fff; box-shadow: 0 0 6cqmin rgba(191, 90, 242, .35); }
    .lobby-qr svg { display: block; width: 46cqmin; height: 46cqmin; }
    .lobby-text { display: flex; flex-direction: column; gap: 1.6cqmin; min-width: 0; max-width: 56cqmin; }
    .kicker { font-size: 2.3cqmin; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; color: var(--v2); }
    .lobby h1 { margin: 0; font-size: 6cqmin; line-height: 1.02; letter-spacing: -.04em; font-weight: 760; }
    .lobby p { margin: 0; font-size: 2.6cqmin; line-height: 1.35; color: #a1a1a6; }
    .lobby p b { color: #f5f5f7; font-weight: 650; }
    .lobby .code {
      align-self: flex-start; font-size: 6.4cqmin; font-weight: 780; letter-spacing: .08em; line-height: 1;
      padding: 1.4cqmin 2.6cqmin; border-radius: 2cqmin; background: linear-gradient(135deg, var(--v), var(--v3)); color: #fff;
      box-shadow: 0 1.6cqmin 4cqmin -1cqmin rgba(155, 48, 232, .6);
    }
    .count { display: inline-flex; align-items: center; gap: 1cqmin; font-size: 2.4cqmin; color: #a1a1a6; }
    .count i { width: 1.2cqmin; height: 1.2cqmin; border-radius: 50%; background: #34c759; box-shadow: 0 0 0 .6cqmin rgba(52, 199, 89, .2); }
    .top { display: flex; flex-direction: column; gap: 1.2cqmin; width: min(130cqmin, 92cqw); }
    .top-row {
      display: flex; align-items: center; gap: 2cqmin; padding: 1.6cqmin 2.2cqmin; border-radius: 2cqmin;
      background: rgba(255, 255, 255, .05); box-shadow: 0 0 0 .15cqmin var(--line);
      font-size: 2.6cqmin; line-height: 1.25;
    }
    .top-row .votes { flex: none; min-width: 7cqmin; font-weight: 750; color: var(--v2); }
    .top-row .txt { flex: 1; min-width: 0; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }

    /* ---------- tarjetas destacadas */
    .card {
      position: absolute; z-index: 4; border-radius: 3cqmin; background: var(--glass); backdrop-filter: blur(2cqmin);
      box-shadow: 0 0 0 .2cqmin var(--line), 0 3cqmin 8cqmin -2cqmin rgba(0, 0, 0, .65);
      transition: opacity .4s ease, transform .45s cubic-bezier(.3, .7, .4, 1);
    }
    .card.off { opacity: 0; transform: translateY(4cqmin) scale(.98); }
    .card-head { display: flex; align-items: center; justify-content: space-between; gap: 2cqmin; }
    .chip {
      display: inline-flex; align-items: center; gap: .9cqmin; height: 4.2cqmin; padding: 0 1.6cqmin; border-radius: 99px;
      background: rgba(191, 90, 242, .16); color: var(--v2); font-size: 2cqmin; font-weight: 700; letter-spacing: .02em; white-space: nowrap;
    }
    .chip i { width: 1.1cqmin; height: 1.1cqmin; border-radius: 50%; background: var(--v); box-shadow: 0 0 0 .5cqmin rgba(191, 90, 242, .25); }
    .chip.closed { background: rgba(255, 255, 255, .08); color: #a1a1a6; }
    .chip.closed i { background: #8e8e93; box-shadow: none; }

    .spot-q { left: 50%; bottom: 5cqmin; width: min(150cqmin, 86cqw); margin-left: max(-75cqmin, -43cqw); padding: 3cqmin 3.6cqmin; }
    .spot-q.off { transform: translateY(6cqmin); }
    /* Con el QR en una esquina de abajo, la pregunta le deja espacio. */
    .stage.badge-br .spot-q { left: 4cqmin; right: calc(var(--qr) + 9cqmin); width: auto; margin-left: 0; }
    .stage.badge-bl .spot-q { left: calc(var(--qr) + 9cqmin); right: 4cqmin; width: auto; margin-left: 0; }
    .spot-q .text { margin-top: 1.8cqmin; font-size: 4.6cqmin; line-height: 1.18; font-weight: 650; letter-spacing: -.025em; overflow-wrap: anywhere; }
    .spot-q.long .text { font-size: 3.5cqmin; }
    .spot-q.xlong .text { font-size: 2.9cqmin; }
    .spot-q .who { margin-top: 1.6cqmin; font-size: 2.3cqmin; color: #a1a1a6; }
    .spot-q .votes { font-size: 2.4cqmin; font-weight: 700; color: #f5f5f7; white-space: nowrap; }
    .spot-q .votes b { color: var(--v2); }
    .spot-q.answered .chip { background: rgba(52, 199, 89, .16); color: #6fe08d; }
    .spot-q.answered .chip i { background: #34c759; box-shadow: none; }

    .spot-poll { top: 50%; left: 50%; width: min(120cqmin, 84cqw); transform: translate(-50%, -50%); padding: 3.4cqmin 3.8cqmin; }
    .spot-poll.off { transform: translate(-50%, -46%) scale(.98); }
    .spot-poll h2 { margin: 2cqmin 0 2.6cqmin; font-size: 4.4cqmin; line-height: 1.12; letter-spacing: -.03em; font-weight: 720; overflow-wrap: anywhere; }
    .total { font-size: 2.2cqmin; color: #a1a1a6; white-space: nowrap; }
    .bars { display: flex; flex-direction: column; gap: 1.6cqmin; }
    .bar { position: relative; display: flex; align-items: center; gap: 2cqmin; height: 6.4cqmin; padding: 0 2.2cqmin; border-radius: 1.6cqmin; background: rgba(255, 255, 255, .06); overflow: hidden; font-size: 2.6cqmin; }
    .bar .fill { position: absolute; inset: 0 auto 0 0; width: 0; border-radius: inherit; background: rgba(191, 90, 242, .32); transition: width .6s cubic-bezier(.3, .7, .4, 1); }
    .bar.lead .fill { background: linear-gradient(90deg, var(--v3), var(--v)); }
    .bar .lbl, .bar .pct { position: relative; }
    .bar .lbl { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
    .bar .pct { flex: none; font-weight: 750; font-variant-numeric: tabular-nums; }
    .bar .pct small { margin-left: 1cqmin; font-size: .8em; font-weight: 500; color: rgba(245, 245, 247, .65); }
    .rating { display: flex; align-items: center; gap: 4cqmin; }
    .rating .avg { flex: none; text-align: center; }
    .rating .avg b { display: block; font-size: 12cqmin; line-height: 1; font-weight: 780; letter-spacing: -.04em; }
    .rating .avg span { font-size: 3.2cqmin; letter-spacing: .3cqmin; color: #ffd60a; }
    .rating .bars { flex: 1; }
    .rating .bar { height: 4.6cqmin; font-size: 2.2cqmin; }
    .cloud { display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: 1cqmin 2.4cqmin; min-height: 22cqmin; padding: 1cqmin 0; }
    .cloud span { line-height: 1.05; font-weight: 720; letter-spacing: -.03em; transition: font-size .5s ease; }
    .empty { padding: 3cqmin 0; text-align: center; font-size: 2.6cqmin; color: #8e8e93; }

    /* ---------- aviso de pregunta nueva */
    .toast {
      position: absolute; z-index: 6; top: 3cqmin; left: 50%; max-width: 70cqw; display: flex; align-items: center; gap: 1.4cqmin;
      padding: 1.4cqmin 2.4cqmin; border-radius: 99px; background: var(--glass); box-shadow: 0 0 0 .2cqmin var(--line);
      font-size: 2.2cqmin; transform: translate(-50%, -2cqmin); opacity: 0; transition: opacity .3s ease, transform .3s ease;
    }
    .toast.on { opacity: 1; transform: translate(-50%, 0); }
    .toast i { flex: none; width: 1.2cqmin; height: 1.2cqmin; border-radius: 50%; background: var(--v); }
    .toast span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  `;

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function qrNode(qr) {
    const n = qr?.n || 21;
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', `-2 -2 ${n + 4} ${n + 4}`);
    svg.setAttribute('shape-rendering', 'crispEdges');
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('fill', '#0b0b0c');
    path.setAttribute('d', qr?.d || '');
    svg.append(path);
    return svg;
  }

  const plural = (n, one, many) => `${nf.format(n)} ${n === 1 ? one : many}`;

  class PreguntazoStage {
    constructor(host, { mode = 'overlay' } = {}) {
      this.mode = mode;
      this.view = null;
      this.fx = 0;
      this.toastTimer = 0;
      this.qrKey = '';
      this.host = host;
      this.root = host.attachShadow({ mode: 'closed' });
      const style = el('style');
      style.textContent = CSS;
      const stage = el('div', `stage ${mode}`);
      stage.innerHTML = `
        <div class="lobby off" hidden>
          <div class="lobby-card">
            <div class="lobby-qr"></div>
            <div class="lobby-text">
              <div class="kicker"></div>
              <h1></h1>
              <p class="hint"></p>
              <div class="code"></div>
              <div class="count"><i></i><span></span></div>
            </div>
          </div>
          <div class="top" hidden></div>
        </div>
        <div class="badge off" hidden><div class="b-qr"></div><span class="b-label"></span><span class="b-code"></span></div>
        <div class="card spot-q off" hidden>
          <div class="card-head"><span class="chip"><i></i><span class="q-kicker"></span></span><span class="votes"></span></div>
          <div class="text"></div>
          <div class="who"></div>
        </div>
        <div class="card spot-poll off" hidden>
          <div class="card-head"><span class="chip"><i></i><span class="p-kicker"></span></span><span class="total"></span></div>
          <h2></h2>
          <div class="p-body"></div>
        </div>
        <div class="toast"><i></i><span></span></div>
        <div class="fx"></div>`;
      this.root.append(style, stage);
      const $ = (s) => stage.querySelector(s);
      this.el = {
        stage,
        lobby: $('.lobby'), lobbyQr: $('.lobby-qr'), kicker: $('.lobby .kicker'), lobbyTitle: $('.lobby h1'), hint: $('.lobby .hint'),
        code: $('.lobby .code'), count: $('.lobby .count span'), top: $('.top'),
        badge: $('.badge'), badgeQr: $('.b-qr'), badgeLabel: $('.b-label'), badgeCode: $('.b-code'),
        q: $('.spot-q'), qKicker: $('.q-kicker'), qVotes: $('.spot-q .votes'), qText: $('.spot-q .text'), qWho: $('.spot-q .who'),
        poll: $('.spot-poll'), pKicker: $('.p-kicker'), pTotal: $('.spot-poll .total'), pTitle: $('.spot-poll h2'), pBody: $('.p-body'),
        toast: $('.toast'), toastText: $('.toast span'), fxLayer: $('.fx'),
      };
    }

    // ---------------------------------------------------------- vista

    setView(view) {
      this.view = view;
      if (!view) return;
      const e = this.el;
      const qrKey = `${view.qr?.n}:${view.qr?.d?.length}:${view.url}`;
      if (qrKey !== this.qrKey) {
        this.qrKey = qrKey;
        e.lobbyQr.replaceChildren(qrNode(view.qr));
        e.badgeQr.replaceChildren(qrNode(view.qr));
      }
      const spot = view.spot;
      const lobbyOn = view.bigQr || (this.mode === 'screen' && !spot);
      // Estado visible también fuera del shadow root (lo leen las pruebas automáticas).
      this.host.dataset.spot = spot?.kind || '';
      this.host.dataset.lobby = lobbyOn ? '1' : '';

      // QR en grande
      e.kicker.textContent = view.title || msg('stageJoin');
      e.lobbyTitle.textContent = msg('stageScan');
      e.hint.replaceChildren(document.createTextNode(msg('stageOrGo') + ' '), el('b', '', view.short), document.createTextNode(' ' + msg('stageWithCode')));
      e.code.textContent = view.codeFmt;
      e.count.textContent = view.count ? plural(view.count, msg('stagePerson'), msg('stagePeople')) : msg('stageWaiting');
      const showTop = this.mode === 'screen' && !view.bigQr && view.top?.length;
      e.top.hidden = !showTop;
      if (showTop) {
        e.top.replaceChildren(...view.top.slice(0, 3).map((q) => {
          const row = el('div', 'top-row');
          row.append(el('span', 'votes', `▲ ${nf.format(q.votes)}`), el('span', 'txt', q.text));
          return row;
        }));
      }
      this.toggle(e.lobby, lobbyOn);

      // QR en la esquina
      const corner = view.corner || 'br';
      const badgeOn = !lobbyOn && (view.badge || (this.mode === 'screen' && !!spot)) && !!view.code;
      e.badge.className = `badge ${corner}${e.badge.classList.contains('off') ? ' off' : ''}`;
      e.badgeLabel.textContent = msg('stageBadge');
      e.badgeCode.textContent = view.codeFmt;
      e.stage.className = `stage ${this.mode} qr-${view.size || 'm'}${badgeOn ? ` badge-${corner}` : ''}`;
      this.toggle(e.badge, badgeOn);

      // Pregunta destacada
      const isQ = spot?.kind === 'question';
      if (isQ) {
        e.q.classList.toggle('long', spot.text.length > 120 && spot.text.length <= 200);
        e.q.classList.toggle('xlong', spot.text.length > 200);
        e.q.classList.toggle('answered', !!spot.answered);
        e.qKicker.textContent = spot.answered ? msg('stageAnswered') : msg('stageQuestion');
        e.qVotes.replaceChildren(el('b', '', `▲ ${nf.format(spot.votes)}`), document.createTextNode(' ' + (spot.votes === 1 ? msg('stageVote') : msg('stageVotes'))));
        e.qText.textContent = spot.text;
        e.qWho.textContent = spot.name ? `— ${spot.name}` : `— ${msg('stageAnon')}`;
      }
      this.toggle(e.q, isQ && !view.bigQr);

      // Encuesta destacada
      const isPoll = spot?.kind === 'poll';
      if (isPoll) this.renderPoll(spot.poll);
      this.toggle(e.poll, isPoll && !view.bigQr);
    }

    toggle(node, on) {
      clearTimeout(node._t);
      if (on) {
        node.hidden = false;
        // Un cuadro después, para que la transición de entrada se vea.
        requestAnimationFrame(() => requestAnimationFrame(() => node.classList.remove('off')));
      } else if (!node.hidden) {
        node.classList.add('off');
        node._t = setTimeout(() => { node.hidden = true; }, 450);
      }
    }

    renderPoll(p) {
      const e = this.el;
      e.pKicker.textContent = p.state === 'open' ? msg('stagePollLive') : msg('stagePollClosed');
      e.poll.querySelector('.chip').classList.toggle('closed', p.state !== 'open');
      e.pTotal.textContent = plural(p.total, msg('stageVote'), msg('stageVotes'));
      e.pTitle.textContent = p.q;
      const r = p.results || {};
      const key = `${p.id}:${p.kind}`;
      if (e.pBody.dataset.key !== key) {
        e.pBody.dataset.key = key;
        e.pBody.replaceChildren();
      }
      if (p.kind === 'words') {
        const words = r.words || [];
        if (!words.length) return e.pBody.replaceChildren(el('div', 'empty', msg('stageNoAnswers')));
        const max = words[0][1];
        const cloud = el('div', 'cloud');
        const shades = ['#e3a6ff', '#bf5af2', '#f5f5f7', '#d18cff', '#a970ff'];
        words.slice(0, 30).forEach(([text, n], i) => {
          const s = el('span', '', text);
          s.style.fontSize = `${2.6 + (n / max) * 6.4}cqmin`;
          s.style.color = shades[i % shades.length];
          s.style.opacity = String(0.55 + (n / max) * 0.45);
          cloud.append(s);
        });
        e.pBody.replaceChildren(cloud);
        return;
      }
      if (p.kind === 'rating') {
        const dist = r.dist || [0, 0, 0, 0, 0];
        let wrap = e.pBody.querySelector('.rating');
        if (!wrap) {
          wrap = el('div', 'rating');
          const avg = el('div', 'avg');
          avg.append(el('b'), el('span'));
          wrap.append(avg, this.barsNode(['5 ★', '4 ★', '3 ★', '2 ★', '1 ★']));
          e.pBody.replaceChildren(wrap);
        }
        wrap.querySelector('.avg b').textContent = p.total ? nf.format(r.avg || 0) : '—';
        const full = Math.round(r.avg || 0);
        wrap.querySelector('.avg span').textContent = '★★★★★'.slice(0, full) + '☆☆☆☆☆'.slice(0, 5 - full);
        this.updateBars(wrap.querySelector('.bars'), [...dist].reverse(), p.total);
        return;
      }
      let bars = e.pBody.querySelector('.bars');
      if (!bars || bars.children.length !== p.options.length) {
        bars = this.barsNode(p.options);
        e.pBody.replaceChildren(bars);
      }
      p.options.forEach((o, i) => { bars.children[i].querySelector('.lbl').textContent = o; });
      // En «varias respuestas» el porcentaje es sobre las personas que votaron.
      this.updateBars(bars, r.counts || p.options.map(() => 0), p.total);
    }

    barsNode(labels) {
      const bars = el('div', 'bars');
      for (const label of labels) {
        const row = el('div', 'bar');
        row.append(el('div', 'fill'), el('span', 'lbl', label), el('span', 'pct'));
        bars.append(row);
      }
      return bars;
    }

    updateBars(bars, counts, total) {
      const max = Math.max(...counts);
      counts.forEach((n, i) => {
        const row = bars.children[i];
        if (!row) return;
        const pct = total ? Math.round((n / total) * 100) : 0;
        row.classList.toggle('lead', n > 0 && n === max);
        row.querySelector('.fill').style.width = `${pct}%`;
        const label = row.querySelector('.pct');
        label.replaceChildren(document.createTextNode(`${pct}%`), el('small', '', nf.format(n)));
      });
    }

    // ---------------------------------------------------------- reacciones

    react(list) {
      if (!Array.isArray(list) || (this.view && this.view.react === false)) return;
      this.host.dataset.reactions = String((Number(this.host.dataset.reactions) || 0) + list.reduce((n, [, c]) => n + (Number(c) || 0), 0));
      if (document.hidden) return;
      let delay = 0;
      for (const [emoji, count] of list) {
        // Con mucho público se muestran menos emojis, más grandes: se entiende igual.
        const shown = Math.min(count, 6);
        for (let i = 0; i < shown; i++) {
          setTimeout(() => this.float(emoji, count > 6 ? 1.25 : 1), delay);
          delay += 55;
        }
      }
    }

    float(emoji, boost = 1) {
      if (this.fx >= MAX_FX) return;
      const layer = this.el.fxLayer;
      const w = layer.clientWidth || innerWidth;
      const h = layer.clientHeight || innerHeight;
      const span = el('span', 'emoji', emoji);
      const x = w * (0.06 + Math.random() * 0.88);
      const sway = (Math.random() - 0.5) * w * 0.08;
      const rise = h * (0.55 + Math.random() * 0.35);
      const scale = (0.75 + Math.random() * 0.6) * boost;
      const rot = (Math.random() - 0.5) * 40;
      const duration = 2600 + Math.random() * 1600;
      layer.append(span);
      this.fx++;
      const anim = span.animate([
        { transform: `translate(${x}px, 0) scale(${scale * 0.4}) rotate(0deg)`, opacity: 0 },
        { transform: `translate(${x + sway * 0.3}px, ${-rise * 0.12}px) scale(${scale}) rotate(${rot * 0.3}deg)`, opacity: 1, offset: 0.12 },
        { transform: `translate(${x - sway * 0.5}px, ${-rise * 0.55}px) scale(${scale}) rotate(${-rot * 0.4}deg)`, opacity: 0.95, offset: 0.55 },
        { transform: `translate(${x + sway}px, ${-rise}px) scale(${scale * 0.9}) rotate(${rot}deg)`, opacity: 0 },
      ], { duration, easing: 'cubic-bezier(.25,.6,.35,1)' });
      anim.onfinish = anim.oncancel = () => { span.remove(); this.fx--; };
    }

    // ---------------------------------------------------------- avisos

    toast(text, name) {
      const e = this.el;
      e.toastText.textContent = `${msg('stageNewQuestion')}${name ? ` (${name})` : ''}: ${text}`;
      e.toast.classList.add('on');
      clearTimeout(this.toastTimer);
      this.toastTimer = setTimeout(() => e.toast.classList.remove('on'), 4200);
    }
  }

  globalThis.PreguntazoStage = PreguntazoStage;
})();

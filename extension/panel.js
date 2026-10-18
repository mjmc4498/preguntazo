/* global PreguntazoStage */
import { EMOJI_CHOICES, formatCode, getSettings, normalizeSettings, saveSettings } from './config.js';
import { qrPng, qrSvg } from './lib/qr.js';
import { applyI18n, t } from './lib/i18n.js';
import { connectLive } from './lib/live.js';

applyI18n();

const $ = (id) => document.getElementById(id);
const sw = (type, extra = {}) => chrome.runtime.sendMessage({ to: 'sw', type, ...extra });
const nf = new Intl.NumberFormat('es');
const compact = new Intl.NumberFormat('es', { notation: 'compact', maximumFractionDigits: 1 });
const rtf = new Intl.RelativeTimeFormat('es', { numeric: 'auto' });

let settings = await getSettings();
let snap = await sw('session:start');
let admin = null;
let view = null;
let tab = ['preguntas', 'encuestas', 'reacciones', 'publico'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'preguntas';
let filter = 'all';
let sort = 'top';
let search = '';
let editing = null;
let kind = 'single';
let shareUrl = '';

const stage = new PreguntazoStage($('preview-stage'), { mode: 'overlay' });
const live = connectLive('panel', {
  onView: (v) => { view = v; stage.setView(v); renderAside(); },
  onAdmin: (a) => { admin = a; renderAll(); },
  onReact: (list) => stage.react(list),
  onDisconnect: () => renderStatus(),
});

// ---------------------------------------------------------------- utilidades

let toastTimer = 0;
function toast(text) {
  const el = $('toast');
  el.textContent = text;
  el.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('on'), 2400);
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

const ICONS = {
  check: '<path d="M20 6 9 17l-5-5"/>',
  pin: '<path d="M12 17v5M9 10.8V4h6v6.8l2.5 2.7V16h-11v-2.5z"/>',
  hide: '<path d="M9.9 4.2A10.4 10.4 0 0 1 12 4c7 0 10 7 10 7a13.2 13.2 0 0 1-1.7 2.7M6.6 6.6A13.5 13.5 0 0 0 2 11s3 7 10 7a9.7 9.7 0 0 0 5.4-1.6M2 2l20 20M14.1 14.1a3 3 0 1 1-4.2-4.2"/>',
  show: '<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6"/>',
  edit: '<path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  screen: '<rect x="2" y="4" width="20" height="14" rx="2"/><path d="M8 21h8M12 18v3"/>',
};

function iconBtn(act, icon, title, extraCls = '') {
  const b = el('button', `btn icon ${extraCls}`.trim());
  b.type = 'button';
  b.dataset.act = act;
  b.title = title;
  b.setAttribute('aria-label', title);
  b.innerHTML = `<svg viewBox="0 0 24 24">${ICONS[icon]}</svg>`;
  return b;
}

function ago(ts) {
  const s = Math.round((ts - Date.now()) / 1000);
  if (s > -45) return t('justNow');
  if (s > -3600) return rtf.format(Math.round(s / 60), 'minute');
  if (s > -86400) return rtf.format(Math.round(s / 3600), 'hour');
  return new Date(ts).toLocaleDateString('es');
}

const norm = (s) => String(s || '').toLocaleLowerCase('es').normalize('NFD').replace(/[̀-ͯ]/g, '');

// Acciones que borran algo: el primer clic pide confirmación y el segundo la ejecuta.
const armed = new WeakMap();
function confirmClick(btn, label) {
  if (armed.get(btn)) {
    armed.delete(btn);
    btn.classList.remove('confirm');
    return true;
  }
  armed.set(btn, true);
  btn.classList.add('confirm');
  const prev = btn.title;
  btn.title = label || t('confirmAgain');
  toast(label || t('confirmAgain'));
  setTimeout(() => { armed.delete(btn); btn.classList.remove('confirm'); btn.title = prev; }, 3000);
  return false;
}

function bindSeg(seg, onPick) {
  seg.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-v]');
    if (!b) return;
    setSeg(seg, b.dataset.v);
    onPick(b.dataset.v);
  });
}

function setSeg(seg, value) {
  for (const b of seg.querySelectorAll('button[data-v]')) b.setAttribute('aria-checked', String(b.dataset.v === value));
}

function download(text, name, type = 'text/csv;charset=utf-8') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

const csv = (rows) => '﻿' + rows.map((r) => r.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
const stamp = () => new Date().toISOString().slice(0, 16).replace('T', '_').replace(':', '-');

async function run(op, data, okText) {
  const res = await live.cmd(op, data);
  if (!res.ok) toast(res.error === 'locked' ? t('pollLocked') : t('cmdFailed'));
  else if (okText) toast(okText);
  return res;
}

// ---------------------------------------------------------------- pestañas

function showTab(name) {
  tab = name;
  for (const b of document.querySelectorAll('.tabs button')) b.setAttribute('aria-selected', String(b.dataset.tab === name));
  for (const s of document.querySelectorAll('.tab')) s.hidden = s.id !== `tab-${name}`;
  history.replaceState(null, '', `#${name}`);
}
document.querySelector('.tabs').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-tab]');
  if (b) showTab(b.dataset.tab);
});
showTab(tab);

// ---------------------------------------------------------------- ajustes rápidos

function renderSettings() {
  for (const input of document.querySelectorAll('[data-setting]')) input.checked = !!settings[input.dataset.setting];
  setSeg($('qr-corner'), settings.qrCorner);
  setSeg($('qr-size'), settings.qrSize);
  if (document.activeElement !== $('title')) $('title').value = settings.title;
  renderEmojis();
}

for (const input of document.querySelectorAll('[data-setting]')) {
  input.addEventListener('change', () => saveSettings({ [input.dataset.setting]: input.checked }));
}
bindSeg($('qr-corner'), (v) => saveSettings({ qrCorner: v }));
bindSeg($('qr-size'), (v) => saveSettings({ qrSize: v }));

$('title').placeholder = t('talkTitlePlaceholder');
let titleTimer = 0;
$('title').addEventListener('input', () => {
  clearTimeout(titleTimer);
  titleTimer = setTimeout(() => saveSettings({ title: $('title').value.trim() }), 500);
});
$('title').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('title').blur(); });

// ---------------------------------------------------------------- estado

function renderStatus() {
  const s = snap?.state || {};
  let tone = 'muted';
  let text = t('statusStopped');
  if (s.active) {
    if (s.status === 'error') { tone = 'error'; text = t('statusOffline'); }
    else if (s.status !== 'ready') { tone = 'warn'; text = t('statusConnecting'); }
    else if (s.count === 1) { tone = 'ok'; text = t('statusOne'); }
    else if (s.count > 1) { tone = 'ok'; text = t('statusMany', [nf.format(s.count)]); }
    else { tone = 'ok'; text = t('statusReady'); }
  }
  $('status').dataset.tone = tone;
  $('status-text').textContent = text;
  $('code-chip').textContent = formatCode(snap?.identity?.code || '');
}

// ---------------------------------------------------------------- preguntas

function qCounts(list) {
  const c = { all: 0, pending: 0, open: 0, answered: 0, hidden: 0 };
  for (const q of list) {
    if (q.status === 'hidden') { c.hidden++; continue; }
    c.all++;
    if (q.status === 'pending') c.pending++;
    else if (q.answered) c.answered++;
    else c.open++;
  }
  return c;
}

function visibleQuestions() {
  const words = norm(search).split(/\s+/).filter(Boolean);
  const list = admin.questions.filter((q) => {
    if (filter === 'all' && q.status === 'hidden') return false;
    if (filter === 'pending' && q.status !== 'pending') return false;
    if (filter === 'open' && (q.status !== 'live' || q.answered)) return false;
    if (filter === 'answered' && (!q.answered || q.status === 'hidden')) return false;
    if (filter === 'hidden' && q.status !== 'hidden') return false;
    if (words.length) {
      const hay = norm(`${q.text} ${q.name}`);
      return words.every((w) => hay.includes(w));
    }
    return true;
  });
  if (sort === 'new') return list.sort((a, b) => b.at - a.at);
  const rank = (q) => (q.status === 'pending' ? 0 : q.answered ? 3 : q.pinned ? 1 : 2);
  return list.sort((a, b) => (rank(a) - rank(b)) || (b.votes - a.votes) || (a.at - b.at));
}

const rows = new Map();

function questionRow(q) {
  let li = rows.get(q.id);
  if (!li) {
    li = el('li', 'q');
    li.dataset.id = q.id;
    const votes = el('div', 'q-votes');
    votes.append(el('span', 'n'), el('small'));
    const body = el('div', 'q-body');
    body.append(el('div', 'q-text'), el('div', 'q-meta'));
    li.append(votes, body, el('div', 'q-actions'));
    rows.set(q.id, li);
  }
  const spot = admin.spot?.kind === 'question' && admin.spot.id === q.id;
  li.className = `q${q.status === 'pending' ? ' pending' : ''}${spot ? ' spot' : ''}${q.answered ? ' answered' : ''}${q.status === 'hidden' ? ' hidden-q' : ''}`;
  li.querySelector('.q-votes .n').textContent = nf.format(q.votes);
  li.querySelector('.q-votes small').textContent = q.votes === 1 ? t('voteOne') : t('voteMany');
  li.querySelector('.q-text').textContent = q.text;

  const meta = li.querySelector('.q-meta');
  meta.replaceChildren(el('span', '', q.name || t('anonymous')), el('span', '', '·'), el('span', 'ago', ago(q.at)));
  meta.lastChild.dataset.at = q.at;
  if (q.status === 'pending') meta.append(el('span', 'tag warn', t('tagPending')));
  if (spot) meta.append(el('span', 'tag accent', t('tagOnScreen')));
  if (q.pinned) meta.append(el('span', 'tag', t('tagPinned')));
  if (q.answered) meta.append(el('span', 'tag ok', t('tagAnswered')));
  if (q.status === 'hidden') meta.append(el('span', 'tag', t('tagHidden')));

  const actions = li.querySelector('.q-actions');
  const items = [];
  if (q.status === 'pending') {
    const approve = el('button', 'btn approve', t('approve'));
    approve.type = 'button';
    approve.dataset.act = 'approve';
    items.push(approve);
  }
  const spotBtn = el('button', 'btn spot-btn', spot ? t('onScreenNow') : t('showOnScreen'));
  spotBtn.type = 'button';
  spotBtn.dataset.act = 'spot';
  spotBtn.setAttribute('aria-pressed', String(spot));
  items.push(spotBtn);
  const answered = iconBtn('answered', 'check', q.answered ? t('markOpen') : t('markAnswered'));
  answered.setAttribute('aria-pressed', String(q.answered));
  const pin = iconBtn('pin', 'pin', q.pinned ? t('unpin') : t('pin'));
  pin.setAttribute('aria-pressed', String(q.pinned));
  items.push(answered, pin);
  items.push(q.status === 'hidden' ? iconBtn('show', 'show', t('unhide')) : iconBtn('hide', 'hide', t('hide')));
  items.push(iconBtn('delete', 'trash', t('delete'), 'danger'));
  actions.replaceChildren(...items);
  return li;
}

function renderQuestions() {
  const c = qCounts(admin.questions);
  for (const k of Object.keys(c)) $(`f-${k}`).textContent = c[k] ? nf.format(c[k]) : '';
  const cq = $('c-questions');
  cq.textContent = c.pending ? nf.format(c.pending) : c.open ? nf.format(c.open) : '';
  cq.classList.toggle('warn', c.pending > 0);

  const list = visibleQuestions();
  const ids = new Set(list.map((q) => q.id));
  for (const [id, li] of rows) if (!ids.has(id)) { li.remove(); if (!admin.questions.some((q) => q.id === id)) rows.delete(id); }
  const ul = $('qlist');
  list.forEach((q, i) => {
    const li = questionRow(q);
    if (ul.children[i] !== li) ul.insertBefore(li, ul.children[i] || null);
  });

  const empty = !list.length;
  $('q-empty').hidden = !empty;
  if (empty) {
    const none = !admin.questions.length;
    $('q-empty-title').textContent = none ? t('qEmptyTitle') : t('qNoMatchTitle');
    $('q-empty-body').textContent = none ? (settings.questionsOpen ? t('qEmptyBody') : t('qClosedBody')) : t('qNoMatchBody');
  }
}

$('qlist').addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-act]');
  const li = e.target.closest('li[data-id]');
  if (!btn || !li) return;
  const id = li.dataset.id;
  const q = admin.questions.find((x) => x.id === id);
  if (!q) return;
  switch (btn.dataset.act) {
    case 'approve': return run('q:status', { id, status: 'live' });
    case 'spot': return run('q:spot', { id });
    case 'answered': return run('q:answered', { id, on: !q.answered });
    case 'pin': return run('q:pin', { id, on: !q.pinned });
    case 'hide': return run('q:status', { id, status: 'hidden' });
    case 'show': return run('q:status', { id, status: 'live' });
    case 'delete': if (confirmClick(btn, t('confirmDelete'))) return run('q:delete', { id });
  }
});

bindSeg($('q-filter'), (v) => { filter = v; renderQuestions(); });
bindSeg($('q-sort'), (v) => { sort = v; renderQuestions(); });
$('q-search').placeholder = t('searchPlaceholder');
$('q-search').addEventListener('input', () => { search = $('q-search').value; renderQuestions(); });

$('export-q').addEventListener('click', () => {
  if (!admin?.questions.length) return toast(t('nothingToExport'));
  const status = { live: t('csvLive'), pending: t('tagPending'), hidden: t('tagHidden') };
  const rowsCsv = [[t('csvQuestion'), t('csvAuthor'), t('csvVotes'), t('csvStatus'), t('csvAnswered'), t('csvDate')]];
  for (const q of [...admin.questions].sort((a, b) => b.votes - a.votes)) {
    rowsCsv.push([q.text, q.name || t('anonymous'), q.votes, status[q.status] || q.status, q.answered ? t('yes') : t('no'), new Date(q.at).toLocaleString('es')]);
  }
  download(csv(rowsCsv), `Preguntazo-preguntas-${stamp()}.csv`);
});

// Las horas relativas («hace 3 min») se actualizan solas.
setInterval(() => {
  for (const span of document.querySelectorAll('.q-meta .ago')) span.textContent = ago(Number(span.dataset.at));
}, 30000);

// ---------------------------------------------------------------- encuestas

const KIND_LABEL = { single: 'kindSingle', multi: 'kindMulti', rating: 'kindRating', words: 'kindWords' };
const TEMPLATES = [
  { label: 'tplYesNo', q: '', kind: 'single', options: ['Sí', 'No'] },
  { label: 'tplYesNoMaybe', q: '', kind: 'single', options: ['Sí', 'No', 'Tal vez'] },
  { label: 'tplKnowledge', q: '¿Cuánto sabes del tema de hoy?', kind: 'single', options: ['Nada', 'Algo', 'Bastante', 'Mucho'] },
  { label: 'tplRating', q: '¿Qué te pareció la charla?', kind: 'rating', options: [] },
  { label: 'tplOneWord', q: 'En una palabra, ¿qué te llevas de hoy?', kind: 'words', options: [] },
  { label: 'tplWhere', q: '¿Desde dónde nos acompañas?', kind: 'words', options: [] },
];

function optionRow(value = '') {
  const li = el('li');
  const input = el('input', 'input');
  input.maxLength = 80;
  input.value = value;
  const remove = iconBtn('remove-option', 'trash', t('removeOption'));
  li.append(el('span', 'num'), input, remove);
  return li;
}

function renumber() {
  const items = [...$('poll-options').children];
  items.forEach((li, i) => {
    li.querySelector('.num').textContent = String(i + 1);
    li.querySelector('input').placeholder = t('optionN', [String(i + 1)]);
    li.querySelector('button').disabled = items.length <= 2;
  });
  $('add-option').hidden = items.length >= 6 || !(kind === 'single' || kind === 'multi');
}

function setKind(k) {
  kind = k;
  setSeg($('poll-kind'), k);
  const choice = k === 'single' || k === 'multi';
  $('poll-options').hidden = !choice;
  $('kind-hint').textContent = t(`hint_${k}`);
  if (choice && $('poll-options').children.length < 2) {
    while ($('poll-options').children.length < 2) $('poll-options').append(optionRow());
  }
  renumber();
}

function fillEditor(p) {
  editing = p?.id || null;
  $('poll-q').value = p?.q || '';
  $('poll-options').replaceChildren(...(p?.options?.length ? p.options : ['', '']).map((o) => optionRow(o)));
  setKind(p?.kind || 'single');
  $('editor-title').textContent = editing ? t('editPoll') : t('newPoll');
  $('editor-cancel').hidden = !editing;
  $('save-open').hidden = !!editing && admin?.polls.find((x) => x.id === editing)?.state === 'open';
  $('editor-error').hidden = true;
}

$('poll-q').placeholder = t('pollQuestionPlaceholder');
bindSeg($('poll-kind'), (v) => setKind(v));
$('add-option').addEventListener('click', () => {
  $('poll-options').append(optionRow());
  renumber();
  $('poll-options').lastChild.querySelector('input').focus();
});
$('poll-options').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-act="remove-option"]');
  if (b && $('poll-options').children.length > 2) {
    b.closest('li').remove();
    renumber();
  }
});
$('poll-options').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.matches('input')) {
    e.preventDefault();
    const li = e.target.closest('li');
    if (li.nextElementSibling) li.nextElementSibling.querySelector('input').focus();
    else if ($('poll-options').children.length < 6) $('add-option').click();
  }
});
$('editor-cancel').addEventListener('click', () => fillEditor(null));

for (const tpl of TEMPLATES) {
  const b = el('button', '', t(tpl.label));
  b.type = 'button';
  b.addEventListener('click', () => {
    const typed = $('poll-q').value.trim();
    fillEditor({ id: editing, q: tpl.q || typed, kind: tpl.kind, options: tpl.options });
    $('poll-q').focus();
  });
  $('templates').append(b);
}

async function savePoll(andOpen) {
  const q = $('poll-q').value.trim();
  const options = [...$('poll-options').querySelectorAll('input')].map((i) => i.value.trim()).filter(Boolean);
  const err = !q ? t('errNoQuestion') : (kind === 'single' || kind === 'multi') && options.length < 2 ? t('errTwoOptions') : '';
  $('editor-error').hidden = !err;
  $('editor-error').textContent = err;
  if (err) return;
  const res = await run('poll:save', { poll: { id: editing, q, kind, options } });
  if (!res.ok) return;
  if (andOpen) await run('poll:open', { id: res.id }, t('pollOpened'));
  else toast(editing ? t('pollUpdated') : t('pollSaved'));
  fillEditor(null);
}

$('editor').addEventListener('submit', (e) => { e.preventDefault(); savePoll(false); });
$('save-open').addEventListener('click', () => savePoll(true));

function resultsNode(p) {
  const wrap = el('div', 'res');
  const r = p.results || {};
  if (p.kind === 'rating') {
    const avg = el('div', 'res-avg');
    const full = Math.round(r.avg || 0);
    avg.append(el('b', '', p.total ? nf.format(r.avg) : '—'), el('span', 'stars', '★★★★★'.slice(0, full) + '☆☆☆☆☆'.slice(0, 5 - full)));
    wrap.append(avg);
    const dist = r.dist || [0, 0, 0, 0, 0];
    [4, 3, 2, 1, 0].forEach((i) => wrap.append(resRow(`${i + 1} ★`, dist[i], p.total, Math.max(...dist))));
  } else if (p.kind === 'words') {
    const words = el('div', 'res-words');
    for (const [w, n] of (r.words || []).slice(0, 24)) {
      const s = el('span', '', w);
      s.append(el('small', '', `×${n}`));
      words.append(s);
    }
    if (!words.children.length) words.append(el('span', 'muted', t('noAnswersYet')));
    wrap.append(words);
  } else {
    const counts = r.counts || p.options.map(() => 0);
    const max = Math.max(...counts);
    p.options.forEach((o, i) => wrap.append(resRow(o, counts[i], p.total, max)));
  }
  return wrap;
}

function resRow(label, n, total, max) {
  const row = el('div', `res-row${n && n === max ? ' lead' : ''}`);
  const pct = total ? Math.round((n / total) * 100) : 0;
  const fill = el('div', 'fill');
  fill.style.width = `${pct}%`;
  row.append(fill, el('span', 'lbl', label), el('span', 'pct', `${pct}% · ${nf.format(n)}`));
  return row;
}

function pollCard(p) {
  const li = el('li', `poll${p.state === 'open' ? ' open' : ''}`);
  li.dataset.id = p.id;
  const onPhones = admin.activePoll === p.id;
  const onScreen = admin.spot?.kind === 'poll' && admin.spot.id === p.id;

  const head = el('div', 'poll-head');
  const info = el('div');
  info.append(el('h3', '', p.q));
  const meta = el('div', 'poll-meta');
  const stateTag = p.state === 'open' ? el('span', 'tag accent', t('pollStateOpen')) : p.state === 'closed' ? el('span', 'tag', t('pollStateClosed')) : el('span', 'tag', t('pollStateDraft'));
  meta.append(stateTag, el('span', '', t(KIND_LABEL[p.kind])), el('span', '', '·'), el('span', '', p.total === 1 ? t('oneVote') : t('manyVotes', [nf.format(p.total)])));
  if (onPhones && p.state !== 'draft') meta.append(el('span', 'tag ok', t('tagOnPhones')));
  if (onScreen) meta.append(el('span', 'tag accent', t('tagOnScreen')));
  info.append(meta);
  const tools = el('div', 'poll-actions');
  tools.append(iconBtn('edit', 'edit', t('editPoll')), iconBtn('duplicate', 'copy', t('duplicate')), iconBtn('delete', 'trash', t('delete')));
  head.append(info, tools);
  li.append(head);
  if (p.state !== 'draft' || p.total) li.append(resultsNode(p));

  const actions = el('div', 'poll-actions');
  const btn = (act, label, cls = '', pressed) => {
    const b = el('button', `btn ${cls}`.trim(), label);
    b.type = 'button';
    b.dataset.act = act;
    if (pressed != null) b.setAttribute('aria-pressed', String(pressed));
    actions.append(b);
  };
  if (p.state === 'open') btn('close', t('pollClose'));
  else btn('open', p.state === 'closed' ? t('pollReopen') : t('pollOpen'), 'accent');
  if (p.state !== 'draft') btn('spot', onScreen ? t('onScreenNow') : t('showOnScreen'), '', onScreen);
  if (onPhones && p.state === 'closed') btn('hide', t('pollHide'));
  if (p.total) btn('reset', t('pollReset'), 'ghost');
  li.append(actions);
  return li;
}

function renderPolls() {
  const polls = [...admin.polls].sort((a, b) => ((b.state === 'open') - (a.state === 'open')) || (b.createdAt - a.createdAt));
  $('plist').replaceChildren(...polls.map(pollCard));
  $('p-empty').hidden = polls.length > 0;
  const openPoll = admin.polls.find((p) => p.state === 'open');
  $('c-polls').textContent = openPoll ? t('liveShort') : '';
  $('c-polls').classList.toggle('live', !!openPoll);
}

$('plist').addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-act]');
  const li = e.target.closest('li[data-id]');
  if (!btn || !li) return;
  const p = admin.polls.find((x) => x.id === li.dataset.id);
  if (!p) return;
  switch (btn.dataset.act) {
    case 'open': return run('poll:open', { id: p.id }, t('pollOpened'));
    case 'close': return run('poll:close', { id: p.id }, t('pollClosedToast'));
    case 'spot': return run('poll:spot', { id: p.id });
    case 'hide': return run('poll:hide', { id: p.id });
    case 'reset': if (confirmClick(btn, t('confirmReset'))) return run('poll:reset', { id: p.id }); return;
    case 'edit':
      fillEditor(p);
      $('poll-q').focus();
      return;
    case 'duplicate': return run('poll:save', { poll: { q: p.q, kind: p.kind, options: p.options } }, t('pollSaved'));
    case 'delete': if (confirmClick(btn, t('confirmDelete'))) return run('poll:delete', { id: p.id });
  }
});

$('export-p').addEventListener('click', () => {
  if (!admin?.polls.length) return toast(t('nothingToExport'));
  const out = [[t('csvPoll'), t('csvType'), t('csvOption'), t('csvVotes'), t('csvPercent')]];
  for (const p of admin.polls) {
    const r = p.results || {};
    const pct = (n) => (p.total ? `${Math.round((n / p.total) * 100)}%` : '0%');
    if (p.kind === 'rating') {
      (r.dist || []).forEach((n, i) => out.push([p.q, t(KIND_LABEL[p.kind]), `${i + 1} ★`, n, pct(n)]));
      out.push([p.q, t(KIND_LABEL[p.kind]), t('csvAverage'), r.avg || 0, '']);
    } else if (p.kind === 'words') {
      for (const [w, n] of r.words || []) out.push([p.q, t(KIND_LABEL[p.kind]), w, n, pct(n)]);
    } else {
      p.options.forEach((o, i) => out.push([p.q, t(KIND_LABEL[p.kind]), o, (r.counts || [])[i] || 0, pct((r.counts || [])[i] || 0)]));
    }
  }
  download(csv(out), `Preguntazo-encuestas-${stamp()}.csv`);
});

// ---------------------------------------------------------------- reacciones

function renderEmojis() {
  const grid = $('emoji-grid');
  if (!grid.children.length) {
    for (const e of EMOJI_CHOICES) {
      const b = el('button', 'emoji', e);
      b.type = 'button';
      b.dataset.e = e;
      grid.append(b);
    }
  }
  for (const b of grid.children) {
    const i = settings.emojis.indexOf(b.dataset.e);
    b.setAttribute('aria-pressed', String(i >= 0));
    b.dataset.order = i >= 0 ? String(i + 1) : '';
  }
}

$('emoji-grid').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-e]');
  if (!b) return;
  const list = [...settings.emojis];
  const i = list.indexOf(b.dataset.e);
  if (i >= 0) {
    if (list.length <= 1) return toast(t('emojiMin'));
    list.splice(i, 1);
  } else {
    if (list.length >= 6) return toast(t('emojiMax'));
    list.push(b.dataset.e);
  }
  saveSettings({ emojis: list });
});

function renderTotals() {
  const totals = admin.totals || {};
  const keys = [...new Set([...settings.emojis, ...Object.keys(totals)])];
  const items = keys.map((e) => {
    const box = el('div', 'total');
    box.append(el('span', 'emoji', e), el('b', '', compact.format(totals[e] || 0)));
    return box;
  });
  const sum = el('div', 'total sum');
  sum.append(el('span', 'muted', t('totalReactions')), el('b', '', nf.format(admin.reactions || 0)));
  $('totals').replaceChildren(...items, sum);
  $('c-reactions').textContent = admin.reactions ? compact.format(admin.reactions) : '';
}

$('test-react').addEventListener('click', () => run('react:test'));

// ---------------------------------------------------------------- público

function renderPeople() {
  const people = [...admin.people].sort((a, b) => a.since - b.since);
  $('people-title').textContent = people.length === 1 ? t('peopleOne') : t('peopleMany', [nf.format(people.length)]);
  $('c-people').textContent = people.length ? nf.format(people.length) : '';
  $('people-empty').hidden = people.length > 0;
  $('people').replaceChildren(...people.map((p) => {
    const li = el('li');
    li.dataset.pid = p.pid;
    const name = p.name || t('anonymous');
    const info = el('div', 'person');
    const extra = [t('connectedAgo', [ago(p.since)])];
    if (p.asked) extra.push(p.asked === 1 ? t('askedOne') : t('askedMany', [String(p.asked)]));
    if (p.devices > 1) extra.push(t('devicesN', [String(p.devices)]));
    info.append(el('b', '', name), el('span', '', extra.join(' · ')));
    const kick = el('button', 'btn small ghost', t('kick'));
    kick.type = 'button';
    kick.dataset.act = 'kick';
    li.append(el('span', 'avatar', p.name ? p.name.slice(0, 1).toUpperCase() : '?'), info, kick);
    return li;
  }));
}

$('people').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-act="kick"]');
  const li = e.target.closest('li[data-pid]');
  if (btn && li && confirmClick(btn, t('confirmKick'))) run('kick', { pid: li.dataset.pid }, t('kicked'));
});

$('new-code').addEventListener('click', async (e) => {
  if (!confirmClick(e.currentTarget, t('confirmNewCode'))) return;
  snap = await sw('session:reset');
  live.reconnect();
  toast(t('newCodeDone'));
  renderStatus();
});

$('clear-room').addEventListener('click', (e) => {
  if (confirmClick(e.currentTarget, t('confirmClearRoom'))) run('room:clear', {}, t('roomCleared'));
});

// ---------------------------------------------------------------- columna lateral

function renderAside() {
  if (!view) return;
  $('big-qr').setAttribute('aria-pressed', String(!!view.bigQr));
  if (view.url && view.url !== shareUrl) {
    shareUrl = view.url;
    $('share-qr').innerHTML = qrSvg(view.url);
  }
  $('share-code').textContent = view.codeFmt;
  $('share-short').textContent = view.short;
}

function renderWhere() {
  const overlays = admin?.overlays || [];
  const where = $('where');
  if (overlays.length) {
    const hosts = [...new Set(overlays.map((o) => o.origin))].join(', ');
    where.replaceChildren(document.createTextNode(t('whereOn') + ' '), el('b', '', hosts));
  } else {
    where.textContent = t('whereNone');
  }
}

$('big-qr').addEventListener('click', () => run('qr:big', { on: !view?.bigQr }));
$('next-q').addEventListener('click', async () => {
  const res = await run('q:next');
  if (res.ok) toast(res.id ? t('nextShown') : t('noMoreQuestions'));
});
$('clear').addEventListener('click', () => run('spot:clear', {}, t('screenCleared')));
$('open-screen').addEventListener('click', () => {
  chrome.windows.create({ url: chrome.runtime.getURL('pantalla.html'), type: 'popup', width: 1280, height: 760 });
});
$('options').addEventListener('click', () => chrome.runtime.openOptionsPage());
$('copy').addEventListener('click', async () => {
  if (!view?.url) return;
  await navigator.clipboard.writeText(view.url).catch(() => {});
  toast(t('linkCopied'));
});
$('download-qr').addEventListener('click', async () => {
  if (!view?.url) return;
  const blob = await qrPng(view.url);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `Preguntazo-QR-${view.codeFmt}.png`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  toast(t('qrDownloaded'));
});

// ---------------------------------------------------------------- todo junto

function renderAll() {
  if (!admin) return;
  renderQuestions();
  renderPolls();
  renderTotals();
  renderPeople();
  renderWhere();
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'session' && changes.state) {
    snap = { ...snap, state: changes.state.newValue };
    renderStatus();
  }
  if (area === 'local' && changes.identity) {
    snap = { ...snap, identity: changes.identity.newValue };
    renderStatus();
  }
  if (area === 'sync' && changes.settings) {
    settings = normalizeSettings(changes.settings.newValue);
    renderSettings();
    renderAll();
  }
});

// Si la sala se detuvo desde el popup, volver a esta pestaña la reabre.
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState === 'visible' && !snap?.state?.active) {
    snap = await sw('session:start');
    live.reconnect();
    renderStatus();
  }
});

fillEditor(null);
renderSettings();
renderStatus();

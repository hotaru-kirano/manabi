import { posLabel, miscLabel } from './tags.js';
import * as store from './store.js';

const $ = (id) => document.getElementById(id);
const input = $('q'), clearBtn = $('clear'), micBtn = $('mic'), drawBtn = $('draw'), results = $('results');
const statusEl = $('status'), progressEl = $('progress');

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const ja = (s) => `<span lang="ja">${esc(s)}</span>`;
const coarsePointer = matchMedia('(pointer: coarse)').matches;

// ---------- Search plumbing ----------

// On the very first visit, wait (briefly) for the service worker to take control before the dictionary
// download starts, so that download lands in the offline cache instead of being fetched twice.
async function serviceWorkerReady() {
  const ok = 'serviceWorker' in navigator && (location.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(location.hostname));
  if (!ok) return;
  const registered = navigator.serviceWorker.register('sw.js').catch(() => {});
  if (navigator.serviceWorker.controller) return;
  await registered;
  await Promise.race([
    new Promise((resolve) => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true })),
    new Promise((resolve) => setTimeout(resolve, 3000)),
  ]);
}

let worker = null;
let queued = null; // latest search typed before the worker exists
let ready = false;
let extras = {}; // which optional data has loaded: { handwriting, examples }
let seq = 0;
let voice = null; // { alternatives: string[] } while showing a spoken query
let commitTimer = 0;
const shown = new Map(); // entry id -> entry, for the cards currently on screen

serviceWorkerReady().then(() => {
  worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = onWorkerMessage;
  if (queued) worker.postMessage(queued);
});

function onWorkerMessage({ data }) {
  if (data.type === 'progress') {
    progressEl.hidden = false;
    progressEl.firstElementChild.style.width = `${Math.min(100, (data.loaded / data.total) * 100)}%`;
    if (!statusEl.classList.contains('error')) setStatus('Getting the dictionary ready…');
  } else if (data.type === 'ready') {
    ready = true;
    progressEl.hidden = true;
    setStatus('');
    $('dict-version').textContent = `· ${data.meta.entries.toLocaleString()} entries · ${data.meta.version}`;
    navigator.storage?.persist?.().catch(() => {});
    if (!input.value.trim()) renderHome();
  } else if (data.type === 'extras') {
    extras = data;
    if (!pad.hidden) recognize();
    // Cards opened before the examples arrived get them now.
    results.querySelectorAll('.entry.open').forEach((el) => worker.postMessage({ type: 'detail', id: Number(el.dataset.id) }));
  } else if (data.type === 'results') {
    if (data.seq === seq) renderResults(data.result);
  } else if (data.type === 'detail') {
    renderDetail(data);
  } else if (data.type === 'candidates') {
    if (data.seq === padSeq) renderCandidates(data.chars);
  } else if (data.type === 'error') {
    progressEl.hidden = true;
    setStatus(`Could not load the dictionary (${data.message}). Check your connection and reload.`, true);
  }
}

function setStatus(text, isError = false) {
  statusEl.textContent = text;
  statusEl.hidden = !text;
  statusEl.classList.toggle('error', isError);
}

let toastTimer = 0;
function toast(text) {
  const el = $('toast');
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 1800);
}

/**
 * Run a search for what is in the box.
 * navigate: this is a jump (tapped a word, a kanji, a recent lookup) rather than typing,
 * so the previous search stays reachable with the Back button.
 */
function search(query, { fromVoice = false, navigate = false, fromHistory = false } = {}) {
  if (!fromVoice) voice = null;
  clearBtn.hidden = !query;
  seq++;
  clearTimeout(commitTimer);
  if (!fromHistory) {
    const url = new URL(location.href);
    if (query.trim()) url.searchParams.set('q', query); else url.searchParams.delete('q');
    url.searchParams.delete('voice');
    if (navigate && url.href !== location.href) history.pushState(null, '', url); else history.replaceState(null, '', url);
  }
  if (!query.trim()) { renderHome(); return; }
  const message = { type: 'search', seq, query, opts: { homophones: !!voice } };
  if (worker) worker.postMessage(message); else queued = message;
  if (navigate) commitTimer = setTimeout(() => remember(query), 300);
  else commitTimer = setTimeout(() => remember(query), 2000);
}

function setQuery(text, opts) {
  input.value = text;
  search(text, opts);
}

addEventListener('popstate', () => {
  setQuery(new URLSearchParams(location.search).get('q') || '', { fromHistory: true });
});

function remember(query) {
  if (results.querySelector('.entry, .kanji-card')) store.addRecent(query);
}

// ---------- Rendering ----------

const ICON = {
  speaker: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4zM16.5 8.5a5 5 0 0 1 0 7"/></svg>',
  star: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.8z"/></svg>',
  chevron: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>',
};
const canSpeak = 'speechSynthesis' in window;
const SHOWN_SENSES = 3;

function entryHtml(e, open = false) {
  const usuallyKana = /\buk\b/.test(e.s[0][2]) || !e.k.length;
  const word = usuallyKana ? e.r[0] : e.k[0];
  const sub = usuallyKana ? (e.k[0] ? `【${e.k[0]}】` : '') : e.r[0];
  const others = [...e.k, ...e.r].filter((f) => f !== word && f !== (usuallyKana ? e.k[0] : e.r[0]));

  let lastPos = null;
  const senses = e.s.map(([pos, glosses, misc, info], i) => {
    const posHtml = pos !== lastPos && pos ? `<span class="pos">${esc(posLabel(pos))}</span>` : '';
    lastPos = pos;
    const notes = [miscLabel((misc || '').split(',').filter((m) => m !== 'uk').join(',')), info].filter(Boolean).join(' · ');
    return `<li${i >= SHOWN_SENSES ? ' class="extra"' : ''}>${posHtml}${esc(glosses.join('; '))}${notes ? ` <span class="note">(${esc(notes)})</span>` : ''}</li>`;
  }).join('');
  const extra = e.s.length - SHOWN_SENSES;
  const isSaved = store.isSaved(e.seq);

  return `<article class="entry${open ? ' open' : ''}" data-id="${e.id}">
    <div class="head">
      <span class="word" lang="ja">${esc(word)}</span>
      ${sub ? `<span class="reading" lang="ja">${esc(sub)}</span>` : ''}
      ${e.score >= 100 ? '<span class="badge">common</span>' : ''}
      <span class="head-btns">
        ${canSpeak ? `<button class="say" type="button" data-say="${esc(e.r[0])}" aria-label="Play pronunciation">${ICON.speaker}</button>` : ''}
        <button class="save" type="button" data-save aria-pressed="${isSaved}" aria-label="${isSaved ? 'Remove from saved words' : 'Save word'}">${ICON.star}</button>
      </span>
    </div>
    ${e.via ? `<div class="via">${ja(e.via)} · ${esc(e.why)}</div>` : ''}
    <ol class="senses">${senses}</ol>
    <div class="detail">
      ${others.length ? `<div class="forms">Also written ${others.map(ja).join('、')}</div>` : ''}
      <div class="detail-more"></div>
    </div>
    <div class="expander" aria-hidden="true">${extra > 0 ? `<span class="more-count">${extra} more meaning${extra > 1 ? 's' : ''} · </span>` : ''}<span class="expander-label"></span>${ICON.chevron}</div>
  </article>`;
}

const GRADES = { 8: 'secondary school', 9: 'name kanji', 10: 'name kanji' };
function kanjiHtml(k, { link = true } = {}) {
  const facts = [
    `${k.strokes} strokes`,
    k.grade ? (GRADES[k.grade] || `grade ${k.grade}`) : '',
    k.freq ? `#${k.freq} most used` : '',
  ].filter(Boolean).join(' · ');
  const readings = [
    k.on.length ? `<span class="rd"><i>on</i> ${ja(k.on.join('、'))}</span>` : '',
    k.kun.length ? `<span class="rd"><i>kun</i> ${ja(k.kun.slice(0, 6).join('、'))}</span>` : '',
  ].join('');
  const glyph = link
    ? `<button class="kanji-glyph" type="button" data-q="${esc(k.ch)}" lang="ja" aria-label="Look up ${esc(k.ch)}">${esc(k.ch)}</button>`
    : `<span class="kanji-glyph" lang="ja">${esc(k.ch)}</span>`;
  return `<div class="kanji-row">${glyph}<div>
    <div class="kanji-meaning">${esc(k.meanings.slice(0, 5).join(', ') || '—')}</div>
    <div class="kanji-readings">${readings}</div>
    <div class="kanji-facts">${esc(facts)}</div>
  </div></div>`;
}

function renderDetail({ id, examples, kanji }) {
  const el = results.querySelector(`.entry[data-id="${id}"] .detail-more`);
  if (!el) return;
  let html = '';
  if (examples.length) {
    html += `<h3>Examples</h3>${examples.map(([jp, en]) => `<p class="example"><span lang="ja">${esc(jp)}</span><span class="en">${esc(en)}</span></p>`).join('')}`;
  }
  if (kanji.length) html += `<h3>Kanji</h3>${kanji.map((k) => kanjiHtml(k)).join('')}`;
  const e = shown.get(id);
  if (e) html += `<div class="actions"><button type="button" class="link-btn" data-copy="${esc(e.k[0] || e.r[0])}">Copy word</button></div>`;
  el.innerHTML = html;
}

function openEntry(el, open = !el.classList.contains('open')) {
  el.classList.toggle('open', open);
  if (open && worker) worker.postMessage({ type: 'detail', id: Number(el.dataset.id) });
}

function groupLabel(g) {
  switch (g.type) {
    case 'homophone': return `<h2 class="group-label">Sounds the same · ${ja(g.label)}</h2>`;
    case 'english': return '<h2 class="group-label">English matches</h2>';
    case 'prefix': return '<h2 class="group-label">Starts with</h2>';
    case 'contains': return '<h2 class="group-label">Contains</h2>';
    case 'pattern': return '<h2 class="group-label">Matches the pattern</h2>';
    case 'segment': return `<div class="chips"><button class="chip" type="button" data-q="${esc(g.label)}" lang="ja">${esc(g.label)}</button></div>`;
    default: return '';
  }
}

function voiceChips() {
  if (!voice || voice.alternatives.length < 2) return '';
  const chips = voice.alternatives.map((a) =>
    `<button class="chip${a === input.value ? ' on' : ''}" type="button" data-q="${esc(a)}" data-voice lang="ja">${esc(a)}</button>`).join('');
  return `<h2 class="group-label">Heard</h2><div class="chips">${chips}</div>`;
}

function renderResults({ query, groups, kanji }) {
  shown.clear();
  let html = voiceChips();
  if (kanji) html += `<section class="kanji-card">${kanjiHtml(kanji, { link: false })}</section>`;
  if (!groups.length && !kanji) {
    html += `<div class="empty"><p>No matches for “${esc(query)}”.</p>
      <p>Try the dictionary form, kana, or an English word. Can’t read a kanji? Tap the pen and draw it.</p></div>`;
  }
  // One clear answer: open it straight away.
  const single = groups[0]?.type === 'exact' && groups[0].entries.length === 1 ? groups[0].entries[0].id : -1;
  for (const g of groups) {
    html += groupLabel(g);
    for (const e of g.entries) { shown.set(e.id, e); html += entryHtml(e, e.id === single); }
  }
  results.innerHTML = html;
  if (single >= 0 && worker) worker.postMessage({ type: 'detail', id: single });
  window.scrollTo(0, 0);
}

// ---------- Home: recent lookups and saved words ----------

let homeTab = localStorage.getItem('manabi.tab') === 'saved' ? 'saved' : 'recent';

function renderHome() {
  shown.clear();
  const recent = store.recent();
  const saved = store.saved();
  if (!recent.length && !saved.length) {
    results.innerHTML = `<div class="empty">
        <h1>Look up a Japanese word</h1>
        <p>${ready ? 'Type it, draw it or say it. Results appear as you go.' : 'Getting the dictionary ready — you can start typing.'}</p>
        <ul class="hints">
          <li><b>食べました</b><span>conjugated forms work</span></li>
          <li><b>たべる · taberu</b><span>kana or romaji</span></li>
          <li><b>to eat</b><span>English</span></li>
          <li><b>✎</b><span>draw a kanji you can’t read</span></li>
          <li><b>食?る · *物</b><span>? and * stand for unknown characters</span></li>
          <li><b>猫が魚を食べた</b><span>whole phrases are split up</span></li>
        </ul>
      </div>`;
    return;
  }
  const tabs = `<div class="tabs" role="tablist">
      <button type="button" role="tab" data-tab="recent" aria-selected="${homeTab === 'recent'}">Recent</button>
      <button type="button" role="tab" data-tab="saved" aria-selected="${homeTab === 'saved'}">Saved${saved.length ? ` · ${saved.length}` : ''}</button>
    </div>`;
  let body;
  if (homeTab === 'recent') {
    body = recent.length
      ? `<div class="chips">${recent.map((r) => `<button class="chip" type="button" data-q="${esc(r.q)}" lang="ja">${esc(r.q)}${r.n > 1 ? `<small>×${r.n}</small>` : ''}</button>`).join('')}</div>
         <p class="home-actions"><button class="link-btn" type="button" data-clear-recent>Clear recent</button></p>`
      : '<p class="home-note">Words you look up appear here.</p>';
  } else {
    body = saved.length
      ? `<ul class="saved">${saved.map((s) => `<li>
            <button type="button" class="saved-word" data-q="${esc(s.w)}">
              <span class="saved-head"><span lang="ja">${esc(s.w)}</span>${s.r ? `<small lang="ja">${esc(s.r)}</small>` : ''}</span>
              <span class="saved-gloss">${esc(s.g)}</span>
            </button>
            <button type="button" class="icon-btn" data-unsave="${s.seq}" aria-label="Remove ${esc(s.w)}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
          </li>`).join('')}</ul>
         <p class="home-actions">
           <button class="link-btn" type="button" data-export>Export for Anki (.tsv)</button>
           <button class="link-btn" type="button" data-copy-list>Copy list</button>
         </p>`
      : '<p class="home-note">Tap the star on a word to keep it here. Saved words can be exported to Anki.</p>';
  }
  results.innerHTML = tabs + body;
}

async function exportSaved() {
  const name = `manabi-words-${new Date().toISOString().slice(0, 10)}.tsv`;
  const file = new File([store.savedAsTsv()], name, { type: 'text/tab-separated-values' });
  if (coarsePointer && navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file] }); return; } catch (err) { if (err.name === 'AbortError') return; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}

async function copyText(text, done) {
  try { await navigator.clipboard.writeText(text); toast(done); } catch { toast('Could not copy'); }
}

// ---------- Typing ----------

input.addEventListener('input', () => search(input.value));
input.addEventListener('focus', () => { if (coarsePointer) closePad(); }); // the keyboard would cover the pad
$('form').addEventListener('submit', (e) => {
  e.preventDefault();
  remember(input.value);
  input.blur(); // hide the on-screen keyboard so results are visible
});
clearBtn.addEventListener('click', () => { setQuery(''); if (pad.hidden) input.focus(); });
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { if (!pad.hidden) closePad(); else { setQuery(''); input.focus(); } }
  else if (e.key === '/' && document.activeElement !== input) { e.preventDefault(); input.focus(); input.select(); }
});

// Coming back to the app (book in one hand): the next thing typed replaces the old word.
let hiddenAt = 0;
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { hiddenAt = Date.now(); return; }
  if (Date.now() - hiddenAt > 15_000 && pad.hidden) { input.focus(); input.select(); }
});

results.addEventListener('click', (e) => {
  const t = e.target.closest('button');
  if (!t) {
    // Tapping a card (not a button, not while selecting text) opens or closes it.
    const card = e.target.closest('.entry');
    if (card && !e.target.closest('a') && !String(getSelection()).trim()) openEntry(card);
    return;
  }
  const d = t.dataset;
  if (d.q !== undefined) {
    if (d.voice === undefined) voice = null;
    setQuery(d.q, { fromVoice: !!voice, navigate: true });
  } else if (d.save !== undefined) {
    const entry = shown.get(Number(t.closest('.entry').dataset.id));
    const on = store.toggleSaved(entry);
    t.setAttribute('aria-pressed', on);
    t.setAttribute('aria-label', on ? 'Remove from saved words' : 'Save word');
    toast(on ? 'Saved' : 'Removed');
  } else if (d.say !== undefined) {
    const u = new SpeechSynthesisUtterance(d.say);
    u.lang = 'ja-JP';
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  } else if (d.copy !== undefined) {
    copyText(d.copy, 'Copied');
  } else if (d.tab !== undefined) {
    homeTab = d.tab;
    try { localStorage.setItem('manabi.tab', homeTab); } catch { /* ignore */ }
    renderHome();
  } else if (d.unsave !== undefined) {
    store.removeSaved(Number(d.unsave));
    renderHome();
  } else if (d.export !== undefined) {
    exportSaved();
  } else if (d.copyList !== undefined) {
    copyText(store.savedAsTsv(), 'List copied');
  } else if (d.clearRecent !== undefined) {
    store.clearRecent();
    renderHome();
  }
});

// ---------- Drawing ----------

const pad = $('pad'), canvas = $('canvas'), cands = $('cands');
const ctx = canvas.getContext('2d');
let strokes = []; // [[x, y], ...] per stroke, in CSS pixels
let drawing = null;
let padSeq = 0;

function openPad() {
  input.blur();
  pad.hidden = false;
  document.body.classList.add('pad-open');
  drawBtn.setAttribute('aria-pressed', 'true');
  const size = canvas.clientWidth, dpr = devicePixelRatio || 1;
  canvas.width = canvas.height = Math.round(size * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  strokes = [];
  redraw();
  renderCandidates([]);
}

function closePad() {
  if (pad.hidden) return;
  pad.hidden = true;
  document.body.classList.remove('pad-open');
  drawBtn.setAttribute('aria-pressed', 'false');
}

function redraw() {
  const size = canvas.clientWidth;
  const style = getComputedStyle(canvas);
  ctx.clearRect(0, 0, size, size);
  ctx.strokeStyle = style.getPropertyValue('--line');
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 6]);
  ctx.beginPath();
  ctx.moveTo(size / 2, 8); ctx.lineTo(size / 2, size - 8);
  ctx.moveTo(8, size / 2); ctx.lineTo(size - 8, size / 2);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.strokeStyle = style.getPropertyValue('--text');
  ctx.lineWidth = Math.max(4, size / 45);
  ctx.lineCap = ctx.lineJoin = 'round';
  for (const s of strokes) {
    ctx.beginPath();
    ctx.moveTo(s[0][0], s[0][1]);
    for (const [x, y] of s) ctx.lineTo(x, y);
    if (s.length === 1) ctx.lineTo(s[0][0] + 0.1, s[0][1]);
    ctx.stroke();
  }
}

function recognize() {
  padSeq++;
  if (!strokes.length) { renderCandidates([]); return; }
  worker?.postMessage({ type: 'recognize', seq: padSeq, strokes });
}

function renderCandidates(chars) {
  if (!strokes.length) cands.innerHTML = '<span class="cands-hint">Draw the kanji, one at a time — stroke order doesn’t have to be perfect.</span>';
  else if (!extras.handwriting) cands.innerHTML = '<span class="cands-hint">Loading handwriting data…</span>';
  else if (!chars.length) cands.innerHTML = '<span class="cands-hint">No match yet — keep drawing.</span>';
  else cands.innerHTML = chars.map((c) => `<button type="button" class="cand" data-char="${esc(c)}" lang="ja">${esc(c)}</button>`).join('');
}

const point = (e) => {
  const r = canvas.getBoundingClientRect();
  return [e.clientX - r.left, e.clientY - r.top];
};
canvas.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  canvas.setPointerCapture(e.pointerId);
  drawing = [point(e)];
  strokes.push(drawing);
  redraw();
});
canvas.addEventListener('pointermove', (e) => {
  if (!drawing) return;
  for (const ev of e.getCoalescedEvents?.() ?? [e]) drawing.push(point(ev));
  redraw();
});
const endStroke = () => { if (drawing) { drawing = null; recognize(); } };
canvas.addEventListener('pointerup', endStroke);
canvas.addEventListener('pointercancel', endStroke);

cands.addEventListener('click', (e) => {
  const c = e.target.closest('.cand');
  if (!c) return;
  strokes = [];
  redraw();
  renderCandidates([]);
  setQuery(input.value + c.dataset.char, { navigate: true });
});
drawBtn.addEventListener('click', () => (pad.hidden ? openPad() : closePad()));
$('pad-undo').addEventListener('click', () => { strokes.pop(); redraw(); recognize(); });
$('pad-clear').addEventListener('click', () => { strokes = []; redraw(); recognize(); });
$('pad-back').addEventListener('click', () => setQuery([...input.value].slice(0, -1).join('')));
$('pad-close').addEventListener('click', closePad);

// ---------- Speaking ----------
// Uses the browser's built-in recognition for now; the engine behind this button is still to be decided.

const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;

const SPEECH_ERRORS = {
  'not-allowed': 'Microphone access is blocked. Allow it in your browser settings to look words up by voice.',
  'service-not-allowed': 'Speech recognition is not allowed on this device.',
  'no-speech': 'Didn’t catch that — tap the mic and try again.',
  'audio-capture': 'No microphone found.',
  network: 'Speech recognition needs an internet connection.',
};

function startListening() {
  if (recognition) { recognition.stop(); return; }
  const rec = new Recognition();
  rec.lang = 'ja-JP';
  rec.interimResults = true;
  rec.maxAlternatives = 5;
  let heard = false;
  const tidy = (s) => s.replace(/[。、？！?!\s]+$/u, '').trim();

  rec.onstart = () => {
    micBtn.setAttribute('aria-pressed', 'true');
    micBtn.setAttribute('aria-label', 'Stop listening');
    setStatus('Listening… say the word in Japanese');
  };
  rec.onresult = (event) => {
    let text = '';
    let alternatives = [];
    for (const res of event.results) {
      text += res[0].transcript;
      if (res.isFinal) alternatives = [...res].map((a) => tidy(a.transcript)).filter(Boolean);
    }
    text = tidy(text);
    if (!text) return;
    heard = true;
    voice = { alternatives: [...new Set(alternatives)] };
    setQuery(text, { fromVoice: true });
  };
  rec.onerror = (event) => {
    if (event.error === 'aborted') return;
    setStatus(SPEECH_ERRORS[event.error] || `Speech recognition failed (${event.error}).`, true);
  };
  rec.onend = () => {
    recognition = null;
    micBtn.setAttribute('aria-pressed', 'false');
    micBtn.setAttribute('aria-label', 'Speak a word');
    if (!statusEl.classList.contains('error')) setStatus(heard || ready ? '' : 'Getting the dictionary ready…');
    if (heard) remember(input.value);
  };

  recognition = rec;
  input.blur();
  closePad();
  setStatus('');
  try { rec.start(); } catch { recognition = null; }
}

if (Recognition) {
  micBtn.hidden = false;
  micBtn.addEventListener('click', startListening);
}

// ---------- Startup ----------

const params = new URLSearchParams(location.search);
const initial = params.get('q') || '';
if (initial) setQuery(initial); else renderHome();
if (params.has('voice') && Recognition) startListening();

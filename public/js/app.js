import { posLabel, miscLabel } from './tags.js';

const $ = (id) => document.getElementById(id);
const input = $('q'), clearBtn = $('clear'), micBtn = $('mic'), results = $('results');
const statusEl = $('status'), progressEl = $('progress');

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const ja = (s) => `<span lang="ja">${esc(s)}</span>`;

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
let seq = 0;
let voice = null; // { alternatives: string[] } while showing a spoken query
let commitTimer = 0;

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
  } else if (data.type === 'results') {
    if (data.seq === seq) renderResults(data.result);
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

function search(query, { fromVoice = false } = {}) {
  if (!fromVoice) voice = null;
  clearBtn.hidden = !query;
  seq++;
  clearTimeout(commitTimer);
  const url = new URL(location.href);
  if (query.trim()) url.searchParams.set('q', query); else url.searchParams.delete('q');
  url.searchParams.delete('voice');
  history.replaceState(null, '', url);
  if (!query.trim()) { renderHome(); return; }
  const message = { type: 'search', seq, query, opts: { homophones: !!voice } };
  if (worker) worker.postMessage(message); else queued = message;
  commitTimer = setTimeout(() => remember(query), 1500);
}

function setQuery(text, opts) {
  input.value = text;
  search(text, opts);
}

// ---------- Rendering ----------

const SPEAKER = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4zM16.5 8.5a5 5 0 0 1 0 7"/></svg>';
const canSpeak = 'speechSynthesis' in window;
const SHOWN_SENSES = 4;

function entryHtml(e) {
  const usuallyKana = /\buk\b/.test(e.s[0][2]) || !e.k.length;
  const word = usuallyKana ? e.r[0] : e.k[0];
  const sub = usuallyKana ? (e.k[0] ? `【${e.k[0]}】` : '') : e.r[0];
  const others = [...e.k, ...e.r].filter((f) => f !== word && f !== (usuallyKana ? e.k[0] : e.r[0]));

  let lastPos = null;
  const senses = e.s.map(([pos, glosses, misc, info], i) => {
    const posHtml = pos !== lastPos && pos ? `<span class="pos">${esc(posLabel(pos))}</span>` : '';
    lastPos = pos;
    const notes = [miscLabel((misc || '').split(',').filter((m) => m !== 'uk').join(',')), info].filter(Boolean).join(' · ');
    return `<li${i >= SHOWN_SENSES ? ' hidden' : ''}>${posHtml}${esc(glosses.join('; '))}${notes ? ` <span class="note">(${esc(notes)})</span>` : ''}</li>`;
  }).join('');
  const extra = e.s.length - SHOWN_SENSES;

  return `<article class="entry">
    <div class="head">
      <span class="word" lang="ja">${esc(word)}</span>
      ${sub ? `<span class="reading" lang="ja">${esc(sub)}</span>` : ''}
      ${e.score >= 100 ? '<span class="badge">common</span>' : ''}
      ${canSpeak ? `<button class="say" type="button" data-say="${esc(e.r[0])}" aria-label="Play pronunciation">${SPEAKER}</button>` : ''}
    </div>
    ${e.via ? `<div class="via">${ja(e.via)} · ${esc(e.why)}</div>` : ''}
    <ol class="senses">${senses}</ol>
    ${extra > 0 ? `<button class="more-btn" type="button" data-more>${extra} more meaning${extra > 1 ? 's' : ''}</button>` : ''}
    ${others.length ? `<div class="forms">Also ${others.map(ja).join('、')}</div>` : ''}
  </article>`;
}

function groupLabel(g) {
  switch (g.type) {
    case 'homophone': return `<h2 class="group-label">Sounds the same · ${ja(g.label)}</h2>`;
    case 'english': return '<h2 class="group-label">English matches</h2>';
    case 'prefix': return '<h2 class="group-label">Starts with</h2>';
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

function renderResults({ query, groups }) {
  let html = voiceChips();
  if (!groups.length) {
    html += `<div class="empty"><p>No matches for “${esc(query)}”.</p><p>Try the dictionary form, kana, or an English word.</p></div>`;
  }
  for (const g of groups) html += groupLabel(g) + g.entries.map(entryHtml).join('');
  results.innerHTML = html;
  window.scrollTo(0, 0);
}

function renderHome() {
  const recent = loadRecent();
  const chips = recent.map((r) => `<button class="chip" type="button" data-q="${esc(r)}" lang="ja">${esc(r)}</button>`).join('');
  results.innerHTML = recent.length
    ? `<h2 class="group-label">Recent</h2><div class="chips">${chips}</div>
       <p style="margin:14px 4px 0"><button class="link-btn" type="button" data-clear-recent>Clear recent</button></p>`
    : `<div class="empty">
        <h1>Type or speak a Japanese word</h1>
        <p>${ready ? 'Results appear as you type.' : 'Getting the dictionary ready — you can start typing.'}</p>
        <ul class="hints">
          <li><b>食べました</b><span>conjugated forms work</span></li>
          <li><b>たべる · タベル</b><span>kana</span></li>
          <li><b>taberu</b><span>romaji</span></li>
          <li><b>to eat</b><span>English</span></li>
          <li><b>猫が魚を食べた</b><span>whole phrases are split up</span></li>
        </ul>
      </div>`;
}

// ---------- Recent lookups ----------

const RECENT_KEY = 'manabi.recent';
function loadRecent() {
  try { return JSON.parse(localStorage.getItem(RECENT_KEY)) || []; } catch { return []; }
}
function remember(query) {
  const q = query.trim();
  if (!q || !results.querySelector('.entry')) return;
  // While typing たべ -> たべる only the longest version is worth keeping.
  const list = loadRecent().filter((r) => r !== q && !q.startsWith(r));
  list.unshift(q);
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, 24))); } catch { /* private mode */ }
}

// ---------- Typing ----------

input.addEventListener('input', () => search(input.value));
$('form').addEventListener('submit', (e) => {
  e.preventDefault();
  remember(input.value);
  input.blur(); // hide the on-screen keyboard so results are visible
});
clearBtn.addEventListener('click', () => { setQuery(''); input.focus(); });
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { setQuery(''); input.focus(); }
  else if (e.key === '/' && document.activeElement !== input) { e.preventDefault(); input.focus(); input.select(); }
});

results.addEventListener('click', (e) => {
  const t = e.target.closest('button');
  if (!t) return;
  if (t.dataset.q !== undefined) {
    if (t.dataset.voice === undefined) voice = null;
    setQuery(t.dataset.q, { fromVoice: !!voice });
    remember(t.dataset.q);
  } else if (t.dataset.more !== undefined) {
    t.previousElementSibling.querySelectorAll('li[hidden]').forEach((li) => { li.hidden = false; });
    t.remove();
  } else if (t.dataset.say !== undefined) {
    const u = new SpeechSynthesisUtterance(t.dataset.say);
    u.lang = 'ja-JP';
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  } else if (t.dataset.clearRecent !== undefined) {
    localStorage.removeItem(RECENT_KEY);
    renderHome();
  }
});

// ---------- Speaking ----------

const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;

const SPEECH_ERRORS = {
  'not-allowed': 'Microphone access is blocked. Allow it in your browser settings to look words up by voice.',
  'service-not-allowed': 'Speech recognition is not allowed on this device.',
  'no-speech': 'Didn’t catch that — tap the mic and try again.',
  'audio-capture': 'No microphone found.',
  network: 'Speech recognition needs an internet connection.',
};

function stopListening() {
  recognition?.stop();
}

function startListening() {
  if (recognition) { stopListening(); return; }
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


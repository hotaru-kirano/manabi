// Loads the dictionary files and answers search / detail / handwriting requests off the main thread.
import { Dictionary } from './search.js';
import { Recognizer } from './handwriting.js';

let dict = null;
let recognizer = null;
let pending = null; // latest search that arrived before the dictionary was ready

async function fetchText(url, onBytes) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  if (!res.body) return res.text();
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
    onBytes?.(value.byteLength);
  }
  return text + decoder.decode();
}

async function load() {
  const t0 = performance.now();
  const meta = await (await fetch(new URL('../data/meta.json', import.meta.url))).json();
  const file = (name) => new URL(`../data/${name}?v=${meta.version}`, import.meta.url);

  // Core: needed before the first search.
  const names = ['entries.txt', 'index.txt', 'english.txt'];
  const total = names.reduce((n, f) => n + meta.files[f], 0);
  let loaded = 0, lastPost = 0;
  const onBytes = (n) => {
    loaded += n;
    const now = performance.now();
    if (now - lastPost > 100) { lastPost = now; postMessage({ type: 'progress', loaded, total }); }
  };
  const [entries, index, english] = await Promise.all(names.map((f) => fetchText(file(f), onBytes)));
  dict = new Dictionary({ entries, index, english });
  postMessage({ type: 'ready', meta, ms: Math.round(performance.now() - t0) });
  if (pending) { run(pending); pending = null; }

  // Extras: kanji details, example sentences, handwriting templates. Searching already works without them.
  dict.setKanji(await fetchText(file('kanji.txt')));
  recognizer = new Recognizer(await fetchText(file('strokes.txt')));
  postMessage({ type: 'extras', handwriting: true });
  dict.setExamples(await fetchText(file('examples.txt')));
  postMessage({ type: 'extras', handwriting: true, examples: true });
}

function run({ seq, query, opts }) {
  const t0 = performance.now();
  const result = dict.search(query, opts);
  postMessage({ type: 'results', seq, result, ms: performance.now() - t0 });
}

onmessage = ({ data }) => {
  if (data.type === 'search') {
    if (dict) run(data); else pending = data;
  } else if (data.type === 'detail') {
    if (dict) postMessage({ type: 'detail', ...dict.detail(data.id) });
  } else if (data.type === 'recognize') {
    postMessage({ type: 'candidates', seq: data.seq, chars: recognizer ? recognizer.recognize(data.strokes) : [] });
  }
};

load().catch((err) => postMessage({ type: 'error', message: String(err.message || err) }));

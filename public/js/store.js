// Things remembered on this device: recent lookups and saved words (localStorage).

const RECENT_KEY = 'manabi.recent';
const SAVED_KEY = 'manabi.saved';

function read(key) {
  try { return JSON.parse(localStorage.getItem(key)) || []; } catch { return []; }
}
function write(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode / full */ }
}

/** Recent lookups: [{ q, n (times looked up), t (last time, ms) }], newest first. */
export function recent() {
  return read(RECENT_KEY).map((r) => (typeof r === 'string' ? { q: r, n: 1, t: 0 } : r));
}

export function addRecent(query, now = Date.now()) {
  const q = query.trim();
  if (!q) return;
  let list = recent();
  const same = list.find((r) => r.q === q);
  // Looking the same word up again later counts; re-running it within a minute does not.
  const n = same ? same.n + (now - same.t > 60_000 ? 1 : 0) : 1;
  // While typing たべ -> たべる only the longest version is worth keeping.
  list = list.filter((r) => r.q !== q && !(q.startsWith(r.q) && now - r.t < 15_000));
  list.unshift({ q, n, t: now });
  write(RECENT_KEY, list.slice(0, 60));
}

export function clearRecent() { write(RECENT_KEY, []); }

/** Saved words: [{ seq (JMdict id), w, r, g (meanings), t }], newest first. */
export function saved() { return read(SAVED_KEY); }
export function isSaved(seq) { return saved().some((s) => s.seq === seq); }

export function toggleSaved(entry) {
  const list = saved();
  const i = list.findIndex((s) => s.seq === entry.seq);
  if (i >= 0) { list.splice(i, 1); write(SAVED_KEY, list); return false; }
  list.unshift({
    seq: entry.seq,
    w: entry.k[0] || entry.r[0],
    r: entry.k[0] ? entry.r[0] : '',
    g: entry.s.map((s) => s[1].join(', ')).join('; '),
    t: Date.now(),
  });
  write(SAVED_KEY, list);
  return true;
}

export function removeSaved(seq) { write(SAVED_KEY, saved().filter((s) => s.seq !== seq)); }

/** Tab-separated word / reading / meanings — imports directly into Anki or a spreadsheet. */
export function savedAsTsv() {
  const clean = (s) => String(s).replace(/[\t\n]/g, ' ');
  return saved().map((s) => [s.w, s.r, s.g].map(clean).join('\t')).join('\n') + '\n';
}

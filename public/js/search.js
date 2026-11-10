// In-memory dictionary search. Runs in a Web Worker in the app and directly in Node for tests.

import { normalize, hasJapanese, hasLatin, romajiToKana } from './kana.js';
import { deinflect, posMask, VS, VSN } from './deinflect.js';

export const STOPWORDS = new Set(['to', 'a', 'an', 'the', 'of', 'or', 'and', 'in', 'on', 'at', 'for', 'be', 'is', 'as', 'by', 'e', 'g', 'etc', 's']);

export function tokenizeEnglish(text) {
  return text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split(/[^a-z0-9]+/).filter(Boolean);
}

/** First index in sorted `arr` with arr[i] >= key. */
function lowerBound(arr, key) {
  let lo = 0, hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (arr[mid] < key) lo = mid + 1; else hi = mid;
  }
  return lo;
}

function splitPairs(text) {
  const keys = [], vals = [];
  let pos = 0;
  while (pos < text.length) {
    let end = text.indexOf('\n', pos);
    if (end === -1) end = text.length;
    const tab = text.indexOf('\t', pos);
    keys.push(text.slice(pos, tab));
    vals.push(text.slice(tab + 1, end));
    pos = end + 1;
  }
  return [keys, vals];
}

function cleanGloss(g) {
  g = g.toLowerCase();
  for (let prev = ''; prev !== g;) { prev = g; g = g.replace(/\s*\([^()]*\)/g, ''); } // nested parentheses
  return g.replace(/^to /, '').trim();
}

const KANJI = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff々]/;
const KANA_ONLY = /^[\u3040-\u309fー]+$/;

export class Dictionary {
  /** @param {{entries: string, index: string, english: string}} data raw text of the three data files */
  constructor({ entries, index, english }) {
    this.lines = entries.split('\n');
    this.scores = new Uint8Array(this.lines.length);
    for (let i = 0; i < this.lines.length; i++) this.scores[i] = parseInt(this.lines[i], 10);
    [this.keys, this.keyIds] = splitPairs(index);
    [this.words, this.wordIds] = splitPairs(english);
    this.kanji = new Map(); // kanji -> raw json, see setKanji
    this.examples = new Map(); // entry id -> raw json, see setExamples
  }

  /** Optional extras, loaded after the core dictionary. Both are "<key>\t<json>" lines. */
  setKanji(text) { const [keys, vals] = splitPairs(text); keys.forEach((k, i) => this.kanji.set(k, vals[i])); }
  setExamples(text) { const [keys, vals] = splitPairs(text); keys.forEach((k, i) => this.examples.set(Number(k), vals[i])); }

  kanjiInfo(ch) {
    const raw = this.kanji.get(ch);
    if (!raw) return null;
    const [strokes, grade, jlpt, freq, on, kun, meanings] = JSON.parse(raw);
    return { ch, strokes, grade, jlpt, freq, on, kun, meanings };
  }

  /** Everything shown when an entry is opened: example sentences and its kanji, in order of appearance. */
  detail(id) {
    const e = this.entry(id);
    const chars = [...new Set([...(e.k[0] || '')])];
    return {
      id,
      examples: this.examples.has(id) ? JSON.parse(this.examples.get(id)) : [],
      kanji: chars.map((c) => this.kanjiInfo(c)).filter(Boolean),
    };
  }

  /** Rank ids (Map id -> matched key length) by frequency, then shortest match. */
  ranked(best, limit) {
    const { scores } = this;
    return [...best.entries()]
      .sort((a, b) => scores[b[0]] - scores[a[0]] || a[1] - b[1] || a[0] - b[0])
      .slice(0, limit)
      .map(([id]) => this.entry(id));
  }

  /** Headwords/readings matching `test`, most common first. */
  scan(test, limit) {
    const best = new Map();
    for (let i = 0; i < this.keys.length; i++) {
      const key = this.keys[i];
      if (!test(key)) continue;
      for (const s of this.keyIds[i].split(' ')) {
        const id = Number(s);
        const prev = best.get(id);
        if (prev === undefined || key.length < prev) best.set(id, key.length);
      }
    }
    return this.ranked(best, limit);
  }

  /** Wildcard search: ? = exactly one character, * = any number of characters. */
  pattern(query, limit) {
    const source = query.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\?/g, '.').replace(/\*+/g, '.*');
    const re = new RegExp(`^${source}$`, 'u');
    return this.scan((key) => re.test(key), limit);
  }

  entry(id) {
    const line = this.lines[id];
    const [k, r, s, seq] = JSON.parse(line.slice(line.indexOf('\t') + 1));
    return { id, seq, k, r, s, score: this.scores[id] };
  }

  /** Entry ids whose headword or reading is exactly `key` (already normalized). */
  exact(key) {
    const i = lowerBound(this.keys, key);
    return this.keys[i] === key ? this.keyIds[i].split(' ').map(Number) : [];
  }

  /** Exact matches for `term`, including dictionary forms of inflected input. Best first. */
  lookup(term) {
    const found = new Map();
    for (const cand of deinflect(term)) {
      const tries = [[cand.term, cand.type]];
      // 勉強した -> 勉強する -> 勉強 (noun that takes する)
      if (cand.type & VS && cand.term.length > 2 && cand.term.endsWith('する')) tries.push([cand.term.slice(0, -2), VSN]);
      for (const [t, type] of tries) {
        for (const id of this.exact(t)) {
          if (found.has(id)) continue;
          const e = this.entry(id);
          if (type !== 0 && !(posMask(e.s) & type)) continue;
          if (type !== 0) { e.via = t; e.why = cand.reasons.join(', '); }
          found.set(id, e);
        }
      }
    }
    // For kana input, words normally written in kana (particles, する, ある ...) beat rare kanji readings.
    const kana = KANA_ONLY.test(term);
    const rank = (e) => e.score + (kana ? (!e.k.length ? 60 : /\buk\b/.test(e.s[0][2]) ? 30 : 0) : 0);
    return [...found.values()].sort((a, b) => (a.via ? 1 : 0) - (b.via ? 1 : 0) || rank(b) - rank(a) || a.id - b.id);
  }

  /** Entries with a headword/reading starting with `key`, most common first. */
  prefix(key, limit) {
    const lo = lowerBound(this.keys, key);
    const best = new Map(); // id -> shortest matching key length
    for (let i = lo; i < this.keys.length && this.keys[i].startsWith(key); i++) {
      const len = this.keys[i].length;
      if (len === key.length) continue; // exact matches are reported separately
      for (const s of this.keyIds[i].split(' ')) {
        const id = Number(s);
        const prev = best.get(id);
        if (prev === undefined || len < prev) best.set(id, len);
      }
    }
    return this.ranked(best, limit);
  }

  postings(i) {
    let prev = 0;
    return this.wordIds[i].split(' ').map((d) => (prev += parseInt(d, 36)));
  }

  /** Entries whose English glosses contain every word of `query` (last word may be a prefix). */
  english(query, limit) {
    const tokens = tokenizeEnglish(query).filter((t) => !STOPWORDS.has(t));
    if (!tokens.length) return [];
    let ids = null;
    tokens.forEach((tok, n) => {
      const set = new Set();
      const start = lowerBound(this.words, tok);
      if (n === tokens.length - 1) {
        for (let i = start, c = 0; i < this.words.length && c < 300 && this.words[i].startsWith(tok); i++, c++) {
          for (const id of this.postings(i)) if (!ids || ids.has(id)) set.add(id);
        }
      } else if (this.words[start] === tok) {
        for (const id of this.postings(start)) if (!ids || ids.has(id)) set.add(id);
      }
      ids = set;
    });
    const { scores } = this;
    let cands = [...ids];
    if (cands.length > 4000) cands = cands.sort((a, b) => scores[b] - scores[a]).slice(0, 4000);
    const q = cleanGloss(tokens.join(' '));
    const qRaw = cleanGloss(query);
    const ranked = cands.map((id) => {
      const e = this.entry(id);
      let best = 0;
      e.s.forEach((sense, si) => sense[1].forEach((gloss, gi) => {
        const g = cleanGloss(gloss);
        let m = 100;
        if (g === q || g === qRaw) m = Math.max(500, 1000 - 60 * si - 15 * gi);
        else if (g.startsWith(q + ' ') || g.endsWith(' ' + q) || g.includes(' ' + q + ' ')) m = Math.max(150, 300 - 20 * si - 5 * gi);
        if (m > best) best = m;
      }));
      return [best + e.score, e];
    });
    return ranked.sort((a, b) => b[0] - a[0] || a[1].id - b[1].id).slice(0, limit).map((x) => x[1]);
  }

  /** Greedy longest-match split of a phrase into dictionary words. */
  segment(text) {
    const tokens = [];
    let i = 0;
    while (i < text.length) {
      let hit = null;
      if (hasJapanese(text[i])) {
        for (let len = Math.min(12, text.length - i); len >= 1 && !hit; len--) {
          const sub = text.slice(i, i + len);
          const entries = this.lookup(sub);
          if (entries.length) hit = { text: sub, entries };
        }
      }
      if (hit) { tokens.push(hit); i += hit.text.length; } else i++;
    }
    return tokens;
  }

  /**
   * Main entry point. Returns { query, groups: [{ type, label?, entries }] }.
   * Group types: exact, homophone, english, prefix, segment, contains, pattern.
   * A single-kanji query also gets `kanji` (see kanjiInfo).
   */
  search(query, { limit = 40, homophones = false } = {}) {
    const q = normalize(query);
    const groups = [];
    const seen = new Set();
    const push = (type, entries, label) => {
      const fresh = entries.filter((e) => !seen.has(e.id));
      for (const e of fresh) seen.add(e.id);
      if (fresh.length) groups.push({ type, label, entries: fresh });
      return fresh.length;
    };
    if (!q) return { query, groups };
    const result = { query, groups };

    if (/[?*]/.test(q) && hasJapanese(q)) {
      push('pattern', this.pattern(q.replace(/\s/g, ''), limit));
      return result;
    }
    if ([...q].length === 1 && this.kanji.has(q)) result.kanji = this.kanjiInfo(q);

    const latinOnly = hasLatin(q) && !hasJapanese(q);
    let jp = q, typing = false;
    if (hasLatin(q)) {
      const r = romajiToKana(q);
      jp = r && r.kana ? r.kana : null;
      typing = !!(r && r.rest);
    }
    jp = jp && jp.replace(/[\s、。！？!?「」『』（）()・,.]/g, '');

    let exact = 0;
    if (jp && !typing) {
      const entries = this.lookup(jp);
      exact = push('exact', entries.slice(0, limit));
      if (homophones && entries.length) {
        // Speech recognition picks one spelling; offer the other words that sound the same.
        const same = [];
        for (const r of entries[0].r.slice(0, 2)) same.push(...this.exact(normalize(r)).map((id) => this.entry(id)));
        push('homophone', same.sort((a, b) => b.score - a.score).slice(0, 12), entries[0].r[0]);
      }
    }
    const english = latinOnly ? push('english', this.english(q, limit)) : 0;
    if (jp && !exact && !typing && !latinOnly && jp.length >= 2) {
      const tokens = this.segment(jp);
      if (tokens.length > 1 || (tokens.length === 1 && tokens[0].text.length >= 2)) {
        for (const t of tokens) push('segment', t.entries.slice(0, 2), t.text);
      }
    }
    // "dog" is not half-typed romaji for ど…; only guess that when there is no English match.
    if (jp && !(typing && english)) push('prefix', this.prefix(jp, limit));
    // Kanji can sit anywhere in a compound (the second half of a word you could not read).
    if (jp && KANJI.test(jp) && jp.length <= 4 && seen.size < limit) {
      push('contains', this.scan((key) => key.includes(jp) && !key.startsWith(jp), limit - seen.size));
    }
    return result;
  }
}

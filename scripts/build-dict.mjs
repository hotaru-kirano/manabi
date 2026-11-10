#!/usr/bin/env node
// Downloads JMdict (English) from EDRDG and compiles it into the compact files the app loads:
//   public/data/entries.txt  one entry per line: "<score>\t<json>"   (line number = entry id)
//   public/data/index.txt    sorted "<normalized headword/reading>\t<ids>"
//   public/data/english.txt  sorted "<gloss word>\t<delta-encoded base36 ids>"
//   public/data/meta.json    version + sizes
//
// Usage: node scripts/build-dict.mjs [path/to/JMdict_e.gz]

import { createReadStream, createWriteStream, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { createGunzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalize } from '../public/js/kana.js';
import { STOPWORDS, tokenizeEnglish } from '../public/js/search.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'public', 'data');
const CACHE = join(ROOT, '.cache', 'JMdict_e.gz');
const SOURCES = [
  'https://www.edrdg.org/pub/Nihongo/JMdict_e.gz',
  'http://ftp.edrdg.org/pub/Nihongo/JMdict_e.gz',
];

async function download() {
  mkdirSync(dirname(CACHE), { recursive: true });
  let lastErr;
  for (const url of SOURCES) {
    try {
      console.log(`Downloading ${url}`);
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await pipeline(Readable.fromWeb(res.body), createWriteStream(CACHE));
      return CACHE;
    } catch (err) {
      lastErr = err;
      console.warn(`  failed: ${err.message}`);
    }
  }
  throw lastErr;
}

const unescapeXml = (s) =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

/** Frequency score from JMdict priority tags. >= 100 means "common". */
function priScore(pris) {
  let s = 0;
  for (const p of pris) {
    if (/^(news|ichi|spec|gai)1$/.test(p)) s = Math.max(s, 100);
    else if (/^(news|ichi|spec|gai)2$/.test(p)) s = Math.max(s, 20);
  }
  // nfXX = frequency band in newspapers (01 is the top 500 words); ichi1 = basic vocabulary list.
  let nf = pris.includes('ichi1') ? 40 : 0;
  for (const p of pris) if (p.startsWith('nf')) nf = Math.max(nf, 50 - Number(p.slice(2)));
  return s + nf;
}

async function main() {
  let src = process.argv[2];
  if (!src) src = existsSync(CACHE) ? CACHE : await download();
  console.log(`Parsing ${src}`);

  const rl = createInterface({ input: createReadStream(src).pipe(createGunzip()), crlfDelay: Infinity });

  const lines = []; // entries.txt
  const index = new Map(); // normalized key -> id[]
  const english = new Map(); // token -> id[]
  let version = '';

  let e = null; // current entry
  let el = null; // current k_ele / r_ele
  let sense = null;
  let lastPos = [];

  const addKey = (key, id) => {
    key = normalize(key);
    if (!key) return;
    const arr = index.get(key);
    if (!arr) index.set(key, [id]);
    else if (arr[arr.length - 1] !== id) arr.push(id);
  };

  const finish = () => {
    const id = lines.length;
    const hidden = (x) => x.inf.includes('sK') || x.inf.includes('sk');
    const k = e.k.filter((x) => !hidden(x)).map((x) => x.t);
    const r = e.r.filter((x) => !hidden(x)).map((x) => x.t);
    const score = Math.max(0, ...e.k.map((x) => priScore(x.pri)), ...e.r.map((x) => priScore(x.pri)));
    const senses = e.s.map((s) => {
      const row = [s.pos.join(','), s.gloss, [...s.misc, ...s.field, ...s.dial].join(',')];
      if (s.inf.length) row.push(s.inf.join('; '));
      return row;
    });
    lines.push(`${score}\t${JSON.stringify([k, r, senses])}`);
    for (const x of e.k) addKey(x.t, id);
    for (const x of e.r) addKey(x.t, id);
    const seen = new Set();
    for (const s of e.s) for (const g of s.gloss) for (const t of tokenizeEnglish(g)) {
      if (STOPWORDS.has(t) || seen.has(t)) continue;
      seen.add(t);
      const arr = english.get(t);
      if (arr) arr.push(id); else english.set(t, [id]);
    }
  };

  for await (const line of rl) {
    if (!e) {
      if (line === '<entry>') { e = { k: [], r: [], s: [] }; lastPos = []; }
      else if (!version) { const m = line.match(/JMdict created: (\d{4}-\d{2}-\d{2})/); if (m) version = m[1]; }
      continue;
    }
    if (line === '</entry>') { finish(); e = null; continue; }
    if (line === '<k_ele>') { el = { t: '', pri: [], inf: [] }; e.k.push(el); continue; }
    if (line === '<r_ele>') { el = { t: '', pri: [], inf: [] }; e.r.push(el); continue; }
    if (line === '<sense>') { sense = { pos: [], gloss: [], misc: [], field: [], dial: [], inf: [] }; continue; }
    if (line === '</sense>') {
      if (sense.pos.length) lastPos = sense.pos; else sense.pos = lastPos;
      if (sense.gloss.length) e.s.push(sense);
      sense = null;
      continue;
    }
    const m = line.match(/^<(\w+)[^>]*>(.*)<\/\1>$/);
    if (!m) continue;
    const [, tag, raw] = m;
    const entity = () => raw.replace(/^&|;$/g, '');
    switch (tag) {
      case 'keb': case 'reb': el.t = unescapeXml(raw); break;
      case 'ke_pri': case 're_pri': el.pri.push(raw); break;
      case 'ke_inf': case 're_inf': el.inf.push(entity()); break;
      case 'pos': sense.pos.push(entity()); break;
      case 'misc': sense.misc.push(entity()); break;
      case 'field': sense.field.push(entity()); break;
      case 'dial': sense.dial.push(entity()); break;
      case 's_inf': sense.inf.push(unescapeXml(raw)); break;
      case 'gloss': sense.gloss.push(unescapeXml(raw)); break;
    }
  }

  mkdirSync(OUT, { recursive: true });
  const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0); // UTF-16 code unit order, same as the client's binary search
  const files = {};
  const write = (name, text) => {
    writeFileSync(join(OUT, name), text);
    files[name] = statSync(join(OUT, name)).size;
    console.log(`  ${name}: ${(files[name] / 1e6).toFixed(1)} MB`);
  };

  write('entries.txt', lines.join('\n'));
  write('index.txt', [...index.keys()].sort(cmp).map((k) => `${k}\t${index.get(k).join(' ')}`).join('\n'));
  write('english.txt', [...english.keys()].sort(cmp).map((t) => {
    let prev = 0;
    const deltas = english.get(t).map((id) => { const d = id - prev; prev = id; return d.toString(36); });
    return `${t}\t${deltas.join(' ')}`;
  }).join('\n'));

  version ||= new Date().toISOString().slice(0, 10);
  writeFileSync(join(OUT, 'meta.json'), JSON.stringify({ version, entries: lines.length, files }, null, 2) + '\n');
  console.log(`Done: ${lines.length} entries, ${index.size} keys, ${english.size} English words (JMdict ${version})`);
}

main().catch((err) => { console.error(err); process.exit(1); });

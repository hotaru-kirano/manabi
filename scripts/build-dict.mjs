#!/usr/bin/env node
// Downloads the source data and compiles it into the compact files the app loads:
//   public/data/entries.txt   one entry per line: "<score>\t<json>"   (line number = entry id)
//   public/data/index.txt     sorted "<normalized headword/reading>\t<ids>"
//   public/data/english.txt   sorted "<gloss word>\t<delta-encoded base36 ids>"
//   public/data/examples.txt  "<entry id>\t<json [[japanese, english], ...]>"
//   public/data/kanji.txt     "<kanji>\t<json [strokes, grade, jlpt, freq, on[], kun[], meanings[]]>"
//   public/data/strokes.txt   "<kanji>\t<handwriting template>" (see public/js/handwriting.js)
//   public/data/meta.json     version + sizes
//
// Sources (downloaded once into .cache/): JMdict with examples and KANJIDIC2 from EDRDG, KanjiVG stroke data.
// Usage: node scripts/build-dict.mjs

import { createReadStream, createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { createGunzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalize } from '../public/js/kana.js';
import { STOPWORDS, tokenizeEnglish } from '../public/js/search.js';
import { encodeTemplate } from '../public/js/handwriting.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'public', 'data');
const CACHE = join(ROOT, '.cache');
const SOURCES = {
  'JMdict_e_examp.gz': ['https://www.edrdg.org/pub/Nihongo/JMdict_e_examp.gz', 'http://ftp.edrdg.org/pub/Nihongo/JMdict_e_examp.gz'],
  'kanjidic2.xml.gz': ['https://www.edrdg.org/kanjidic/kanjidic2.xml.gz', 'http://ftp.edrdg.org/pub/Nihongo/kanjidic2.xml.gz'],
  // The KanjiVG SVG files (https://kanjivg.tagaini.net), as redistributed in this npm package.
  'kanjivg.tgz': ['https://registry.npmjs.org/kanjivg-js/-/kanjivg-js-1.1.5.tgz'],
};
const EXAMPLES_PER_ENTRY = 3;

async function source(name) {
  const file = join(CACHE, name);
  if (existsSync(file)) return file;
  mkdirSync(CACHE, { recursive: true });
  let lastErr;
  for (const url of SOURCES[name]) {
    try {
      console.log(`Downloading ${url}`);
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await pipeline(Readable.fromWeb(res.body), createWriteStream(file + '.part'));
      renameSync(file + '.part', file);
      return file;
    } catch (err) {
      lastErr = err;
      console.warn(`  failed: ${err.message}`);
    }
  }
  throw lastErr;
}

const gunzipLines = (file) => createInterface({ input: createReadStream(file).pipe(createGunzip()), crlfDelay: Infinity });

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

/** KANJIDIC2 -> Map(kanji -> [strokes, grade, jlpt, freq, on[], kun[], meanings[]]) */
async function parseKanjidic(file) {
  const kanji = new Map();
  let c = null;
  for await (const line of gunzipLines(file)) {
    if (line === '<character>') { c = { strokes: 0, grade: 0, jlpt: 0, freq: 0, on: [], kun: [], meanings: [] }; continue; }
    if (!c) continue;
    if (line === '</character>') {
      if (c.meanings.length || c.on.length || c.kun.length) {
        kanji.set(c.literal, [c.strokes, c.grade, c.jlpt, c.freq, c.on, c.kun, c.meanings]);
      }
      c = null;
      continue;
    }
    const m = line.match(/^<(\w+)([^>]*)>(.*)<\/\1>$/);
    if (!m) continue;
    const [, tag, attrs, text] = m;
    if (tag === 'literal') c.literal = text;
    else if (tag === 'stroke_count') c.strokes ||= Number(text);
    else if (tag === 'grade') c.grade = Number(text);
    else if (tag === 'jlpt') c.jlpt = Number(text);
    else if (tag === 'freq') c.freq = Number(text);
    else if (tag === 'reading' && attrs.includes('"ja_on"')) c.on.push(text);
    else if (tag === 'reading' && attrs.includes('"ja_kun"')) c.kun.push(text);
    else if (tag === 'meaning' && !attrs.includes('m_lang')) c.meanings.push(unescapeXml(text));
  }
  return kanji;
}

/** Flatten an SVG path (the subset KanjiVG uses: M/m, C/c, S/s, plus L/l) into a polyline. */
function flattenPath(d) {
  const tokens = d.match(/[a-zA-Z]|-?\d*\.?\d+(?:e-?\d+)?/g);
  const pts = [];
  let i = 0, cmd = '', x = 0, y = 0, cx = 0, cy = 0; // (cx, cy): last cubic control point
  const num = () => Number(tokens[i++]);
  const curve = (x1, y1, x2, y2, x3, y3) => {
    for (let k = 1; k <= 12; k++) {
      const t = k / 12, u = 1 - t;
      pts.push([
        u * u * u * x + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3,
        u * u * u * y + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3,
      ]);
    }
    cx = x2; cy = y2; x = x3; y = y3;
  };
  while (i < tokens.length) {
    if (/[a-zA-Z]/.test(tokens[i])) cmd = tokens[i++];
    const rel = cmd === cmd.toLowerCase();
    const bx = rel ? x : 0, by = rel ? y : 0;
    switch (cmd.toUpperCase()) {
      case 'M': x = bx + num(); y = by + num(); cx = x; cy = y; pts.push([x, y]); cmd = rel ? 'l' : 'L'; break;
      case 'L': x = bx + num(); y = by + num(); cx = x; cy = y; pts.push([x, y]); break;
      case 'C': curve(bx + num(), by + num(), bx + num(), by + num(), bx + num(), by + num()); break;
      case 'S': curve(2 * x - cx, 2 * y - cy, bx + num(), by + num(), bx + num(), by + num()); break;
      default: throw new Error(`Unsupported path command ${cmd} in ${d}`);
    }
  }
  return pts;
}

/** KanjiVG -> lines "<kanji>\t<prior><template>" for every kanji we have dictionary data for. */
function buildStrokes(tgz, kanji) {
  const dir = join(CACHE, 'kanjivg');
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
    execFileSync('tar', ['xzf', tgz, '-C', dir, '--strip-components=2', 'package/kanji']);
  }
  const lines = [];
  for (const file of readdirSync(dir).sort()) {
    const m = file.match(/^([0-9a-f]{5})\.svg$/); // skip variants such as 098df-Kaisho.svg
    if (!m) continue;
    const ch = String.fromCodePoint(parseInt(m[1], 16));
    const info = kanji.get(ch);
    if (!info) continue;
    const paths = [...readFileSync(join(dir, file), 'utf8').matchAll(/<path[^>]*\sd="([^"]+)"/g)].map((p) => flattenPath(p[1]));
    if (!paths.length) continue;
    // Prior: 0 = one of the 2,500 most used kanji ... 5 = rare.
    const [, grade, , freq] = info;
    const prior = freq ? (freq <= 1200 ? 0 : 1) : grade && grade <= 8 ? 2 : grade ? 3 : 5;
    lines.push(`${ch}\t${prior}${encodeTemplate(paths)}`);
  }
  return lines;
}

async function main() {
  const [jmdictFile, kanjidicFile, kanjivgFile] = [await source('JMdict_e_examp.gz'), await source('kanjidic2.xml.gz'), await source('kanjivg.tgz')];
  console.log('Parsing JMdict');

  const rl = gunzipLines(jmdictFile);
  const examples = []; // "<id>\t<json>"

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
    lines.push(`${score}\t${JSON.stringify([k, r, senses, e.seq])}`);
    if (e.ex.length) examples.push(`${id}\t${JSON.stringify(e.ex.slice(0, EXAMPLES_PER_ENTRY))}`);
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
      if (line === '<entry>') { e = { seq: 0, k: [], r: [], s: [], ex: [] }; lastPos = []; }
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
    const m = line.match(/^<(\w+)([^>]*)>(.*)<\/\1>$/);
    if (!m) continue;
    const [, tag, attrs, raw] = m;
    const entity = () => raw.replace(/^&|;$/g, '');
    switch (tag) {
      case 'ent_seq': e.seq = Number(raw); break;
      case 'ex_sent':
        if (attrs.includes('"jpn"')) e.ex.push([unescapeXml(raw), '']);
        else if (e.ex.length) e.ex[e.ex.length - 1][1] = unescapeXml(raw);
        break;
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

  write('examples.txt', examples.join('\n'));

  console.log('Parsing KANJIDIC2 and KanjiVG');
  const kanji = await parseKanjidic(kanjidicFile);
  write('kanji.txt', [...kanji].map(([ch, info]) => `${ch}\t${JSON.stringify(info)}`).join('\n'));
  const strokes = buildStrokes(kanjivgFile, kanji);
  write('strokes.txt', strokes.join('\n'));

  version ||= new Date().toISOString().slice(0, 10);
  writeFileSync(join(OUT, 'meta.json'), JSON.stringify({ version, entries: lines.length, files }, null, 2) + '\n');
  console.log(`Done: ${lines.length} entries, ${examples.length} with examples, ${kanji.size} kanji, ${strokes.length} handwriting templates (JMdict ${version})`);
}

main().catch((err) => { console.error(err); process.exit(1); });

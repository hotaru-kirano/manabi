import test from 'node:test';
import assert from 'node:assert/strict';
import { normalize, romajiToKana } from '../public/js/kana.js';
import { deinflect } from '../public/js/deinflect.js';
import { Dictionary } from '../public/js/search.js';

// A tiny dictionary in the same format scripts/build-dict.mjs produces.
const ENTRIES = [
  [140, [['食べる'], ['たべる'], [['v1,vt', ['to eat'], '']]]],
  [130, [['飲む'], ['のむ'], [['v5m,vt', ['to drink'], '']]]],
  [149, [['高い'], ['たかい'], [['adj-i', ['high', 'tall'], '']]]],
  [120, [['勉強'], ['べんきょう'], [['n,vs,vt', ['study'], '']]]],
  [149, [['行く'], ['いく'], [['v5k-s,vi', ['to go'], '']]]],
  [149, [['来る'], ['くる'], [['vk,vi', ['to come'], '']]]],
  [135, [['公園'], ['こうえん'], [['n', ['(public) park'], '']]]],
  [120, [['講演'], ['こうえん'], [['n,vs', ['lecture'], '']]]],
  [140, [['猫'], ['ねこ'], [['n', ['cat (esp. the domestic cat, Felis catus)'], '']]]],
  [100, [[], ['が'], [['prt', ['indicates the subject of a sentence'], '']]]],
  [0, [['食べ物'], ['たべもの'], [['n', ['food'], '']]]],
  [0, [[], ['キャット'], [['n', ['cat'], '']]]],
];
const index = new Map();
const english = new Map();
ENTRIES.forEach(([, [k, r, s]], id) => {
  for (const f of [...k, ...r]) index.set(normalize(f), [...(index.get(normalize(f)) || []), id]);
  for (const w of new Set(s.flatMap((x) => x[1]).join(' ').toLowerCase().split(/[^a-z]+/).filter(Boolean))) {
    english.set(w, [...(english.get(w) || []), id]);
  }
});
const sorted = (m) => [...m.keys()].sort();
const dict = new Dictionary({
  entries: ENTRIES.map(([score, e]) => `${score}\t${JSON.stringify(e)}`).join('\n'),
  index: sorted(index).map((k) => `${k}\t${index.get(k).join(' ')}`).join('\n'),
  english: sorted(english).map((w) => {
    let prev = 0;
    return `${w}\t${english.get(w).map((id) => { const d = id - prev; prev = id; return d.toString(36); }).join(' ')}`;
  }).join('\n'),
});
const words = (q, opts) => dict.search(q, opts).groups.map((g) => [g.type, g.entries.map((e) => e.k[0] || e.r[0])]);

test('normalize folds katakana and full-width latin', () => {
  assert.equal(normalize('タベル'), 'たべる');
  assert.equal(normalize(' ＡＢｃ '), 'abc');
});

test('romaji conversion', () => {
  assert.deepEqual(romajiToKana('taberu'), { kana: 'たべる', rest: '' });
  assert.deepEqual(romajiToKana('gakkou'), { kana: 'がっこう', rest: '' });
  assert.deepEqual(romajiToKana('shinbun'), { kana: 'しんぶん', rest: '' });
  assert.deepEqual(romajiToKana("kon'ya"), { kana: 'こんや', rest: '' });
  assert.deepEqual(romajiToKana('matcha'), { kana: 'まっちゃ', rest: '' });
  assert.deepEqual(romajiToKana('tab'), { kana: 'た', rest: 'b' });
  assert.deepEqual(romajiToKana('たべr'), { kana: 'たべ', rest: 'r' });
  assert.equal(romajiToKana('cat'), null);
});

test('deinflect proposes dictionary forms', () => {
  const has = (from, to) => assert.ok(deinflect(from).some((c) => c.term === to), `${from} -> ${to}`);
  has('食べませんでした', '食べる');
  has('飲んでいる', '飲む');
  has('書いちゃった', '書く');
  has('高くなかった', '高い');
  has('読ませられた', '読む');
  has('行った', '行く');
  has('した', 'する');
  has('こない', 'くる');
});

test('exact and inflected lookups', () => {
  assert.deepEqual(words('食べる')[0], ['exact', ['食べる']]);
  assert.deepEqual(words('食べました')[0], ['exact', ['食べる']]);
  assert.deepEqual(words('飲んでいます')[0], ['exact', ['飲む']]);
  assert.deepEqual(words('高くない')[0], ['exact', ['高い']]);
  assert.deepEqual(words('勉強しました')[0], ['exact', ['勉強']]);
  assert.deepEqual(words('行った')[0], ['exact', ['行く']]);
  assert.deepEqual(words('来ない')[0], ['exact', ['来る']]);
  assert.equal(dict.search('食べました').groups[0].entries[0].why, 'polite past');
});

test('inflection must fit the word class', () => {
  // 高い is an adjective, so verb endings must not resolve to it; 猫 is a noun and never inflects.
  assert.deepEqual(dict.lookup('高います'), []);
  assert.deepEqual(dict.lookup('猫った'), []);
});

test('kana, katakana and romaji input', () => {
  assert.deepEqual(words('ネコ')[0], ['exact', ['猫']]);
  assert.deepEqual(words('neko')[0], ['exact', ['猫']]);
  assert.deepEqual(words('tabe'), [['prefix', ['食べる', '食べ物']]]);
});

test('english search ranks exact glosses and common words first', () => {
  assert.deepEqual(words('cat'), [['english', ['猫', 'キャット']]]);
  assert.deepEqual(words('to eat'), [['english', ['食べる']]]);
  assert.deepEqual(words('lect'), [['english', ['講演']]]);
});

test('phrases are split into words', () => {
  assert.deepEqual(words('猫が食べた'), [['segment', ['猫']], ['segment', ['が']], ['segment', ['食べる']]]);
});

test('spoken queries also list homophones', () => {
  assert.deepEqual(words('講演', { homophones: true }), [['exact', ['講演']], ['homophone', ['公園']]]);
  assert.deepEqual(words('講演'), [['exact', ['講演']]]);
});

test('wildcards and words containing a kanji', () => {
  assert.deepEqual(words('食?る'), [['pattern', ['食べる']]]);
  assert.deepEqual(words('*物'), [['pattern', ['食べ物']]]);
  assert.deepEqual(words('物'), [['contains', ['食べ物']]]);
});

test('kanji details and examples', () => {
  dict.setKanji('食\t[9,2,4,328,["ショク"],["た.べる"],["eat","food"]]');
  dict.setExamples('0\t[["何を食べますか。","What will you eat?"]]');
  assert.equal(dict.search('食').kanji.meanings[0], 'eat');
  const d = dict.detail(0);
  assert.deepEqual(d.kanji.map((k) => k.ch), ['食']);
  assert.equal(d.examples[0][1], 'What will you eat?');
});

// Rule-based deinflection: 食べませんでした -> 食べる, 飲んでいる -> 飲む, 高くなかった -> 高い ...
// Each rule strips an inflected ending and says what word class the result must be.
// Candidates are only suggestions; search.js checks them against real dictionary entries.

export const V1 = 1, V5 = 2, VS = 4, VK = 8, ADJ = 16, TE = 32, VSN = 64;

/** rules: [from, to, inMask, outMask, name]. inMask = class of the inflected form itself (0 = terminal form). */
const RULES = [];
const add = (from, to, inMask, outMask, name) => RULES.push([from, to, inMask, outMask, name]);

const POLITE = [
  ['ます', 'polite'], ['ません', 'polite negative'], ['ました', 'polite past'],
  ['ませんでした', 'polite past negative'], ['ましょう', 'polite volitional'], ['まして', 'polite te-form'],
];
// Attach to the masu-stem (食べ-, 飲み-).
const STEM = [
  ...POLITE.map(([s, n]) => [s, 0, n]),
  ['たい', ADJ, 'want to'], ['たがる', V5, 'wants to'], ['ながら', 0, 'while'], ['すぎる', V1, 'too much'],
  ['過ぎる', V1, 'too much'], ['そう', 0, 'looks like'], ['なさい', 0, 'command'], ['な', 0, 'command'],
  ['やすい', ADJ, 'easy to'], ['にくい', ADJ, 'hard to'], ['方', 0, 'way of'], ['かた', 0, 'way of'],
];
// Attach to the negative stem (食べ-, 飲ま-).
const NEG = [
  ['ない', ADJ, 'negative'], ['ず', 0, 'negative'], ['ずに', 0, 'without'], ['ぬ', 0, 'negative'],
  ['ん', 0, 'negative'], ['ないで', 0, 'without'], ['なきゃ', 0, 'must'], ['なくちゃ', 0, 'must'],
];
const TA = [['て', TE, 'te-form'], ['た', 0, 'past'], ['たら', 0, 'if/when'], ['たり', 0, 'and so on']];
const voiced = (s) => s.replace('て', 'で').replace('た', 'だ');

// Ichidan verbs (and kanji 来る, which conjugates the same way on paper).
const ICHI = V1 | VK;
for (const [s, m, n] of STEM) add(s, 'る', m, ICHI, n);
for (const [s, m, n] of NEG) add(s, 'る', m, ICHI, n);
for (const [s, m, n] of TA) add(s, 'る', m, ICHI, n);
add('られる', 'る', V1, ICHI, 'passive/potential');
add('れる', 'る', V1, ICHI, 'potential');
add('させる', 'る', V1, ICHI, 'causative');
add('よう', 'る', 0, ICHI, 'volitional');
add('ろ', 'る', 0, V1, 'imperative');
add('よ', 'る', 0, V1, 'imperative');
add('れば', 'る', 0, ICHI, 'conditional');

// Godan verbs: [dictionary ending, a, i, e, o, te]
const GODAN = [
  ['う', 'わ', 'い', 'え', 'お', 'って'], ['く', 'か', 'き', 'け', 'こ', 'いて'], ['ぐ', 'が', 'ぎ', 'げ', 'ご', 'いで'],
  ['す', 'さ', 'し', 'せ', 'そ', 'して'], ['つ', 'た', 'ち', 'て', 'と', 'って'], ['ぬ', 'な', 'に', 'ね', 'の', 'んで'],
  ['ぶ', 'ば', 'び', 'べ', 'ぼ', 'んで'], ['む', 'ま', 'み', 'め', 'も', 'んで'], ['る', 'ら', 'り', 'れ', 'ろ', 'って'],
];
for (const [u, a, i, e, o, te] of GODAN) {
  for (const [s, m, n] of STEM) add(i + s, u, m, V5, n);
  for (const [s, m, n] of NEG) add(a + s, u, m, V5, n);
  const stem = te.slice(0, -1);
  const isDe = te.endsWith('で');
  for (const [s, m, n] of TA) add(stem + (isDe ? voiced(s) : s), u, m, V5, n);
  add(a + 'れる', u, V1, V5, 'passive');
  add(a + 'せる', u, V1, V5, 'causative');
  add(a + 'される', u, V1, V5, 'causative passive');
  add(e + 'る', u, V1, V5, 'potential');
  add(e + 'ば', u, 0, V5, 'conditional');
  add(e, u, 0, V5, 'imperative');
  add(o + 'う', u, 0, V5, 'volitional');
  add(i, u, 0, V5, 'stem');
}
// 行く is irregular in the te-form.
for (const iku of ['い', '行']) for (const [s, m, n] of TA) add(iku + 'っ' + s, iku + 'く', m, V5, n);
// Honorific verbs: いらっしゃいます, くださいます, ございます.
for (const [s, n] of POLITE) {
  add('しゃい' + s, 'しゃる', 0, V5, n);
  add('さい' + s, 'さる', 0, V5, n);
  add('ござい' + s, 'ござる', 0, V5, n);
}

// する (also covers 勉強する-style nouns, see search.js).
for (const [s, m, n] of STEM) add('し' + s, 'する', m, VS, n);
for (const [s, m, n] of TA) add('し' + s, 'する', m, VS, n);
add('しない', 'する', ADJ, VS, 'negative');
add('せず', 'する', 0, VS, 'negative');
add('せずに', 'する', 0, VS, 'without');
add('される', 'する', V1, VS, 'passive');
add('させる', 'する', V1, VS, 'causative');
add('できる', 'する', V1, VS, 'potential');
add('しよう', 'する', 0, VS, 'volitional');
add('すれば', 'する', 0, VS, 'conditional');
add('しろ', 'する', 0, VS, 'imperative');
add('せよ', 'する', 0, VS, 'imperative');
add('し', 'する', 0, VS, 'stem');

// くる in kana.
for (const [s, m, n] of STEM) add('き' + s, 'くる', m, VK, n);
for (const [s, m, n] of TA) add('き' + s, 'くる', m, VK, n);
add('こない', 'くる', ADJ, VK, 'negative');
add('こず', 'くる', 0, VK, 'negative');
add('こられる', 'くる', V1, VK, 'passive/potential');
add('これる', 'くる', V1, VK, 'potential');
add('こさせる', 'くる', V1, VK, 'causative');
add('こよう', 'くる', 0, VK, 'volitional');
add('くれば', 'くる', 0, VK, 'conditional');
add('こい', 'くる', 0, VK, 'imperative');

// i-adjectives (also the ない / たい forms of verbs).
add('くない', 'い', ADJ, ADJ, 'negative');
add('かった', 'い', 0, ADJ, 'past');
add('くて', 'い', 0, ADJ, 'te-form');
add('く', 'い', 0, ADJ, 'adverbial');
add('ければ', 'い', 0, ADJ, 'conditional');
add('かったら', 'い', 0, ADJ, 'if/when');
add('かったり', 'い', 0, ADJ, 'and so on');
add('さ', 'い', 0, ADJ, '-ness');
add('そう', 'い', 0, ADJ, 'looks like');
add('すぎる', 'い', V1, ADJ, 'too much');
add('過ぎる', 'い', V1, ADJ, 'too much');
add('くなる', 'い', V5, ADJ, 'become');
add('くありません', 'い', 0, ADJ, 'polite negative');

// Things that follow the te-form: 食べている, 飲んでしまう, 見てください ...
const TE_AUX = [
  ['いる', V1, 'progressive'], ['る', V1, 'progressive'], ['おる', V5, 'progressive'], ['しまう', V5, 'completely'],
  ['ください', 0, 'please'], ['下さい', 0, 'please'], ['おく', V5, 'in advance'], ['みる', V1, 'try'],
  ['いく', V5, 'go on'], ['くる', VK, 'come to'], ['ある', V5, 'resulting state'], ['ほしい', ADJ, 'want someone to'],
  ['欲しい', ADJ, 'want someone to'], ['くれる', V1, 'for me'], ['もらう', V5, 'have someone'], ['あげる', V1, 'for someone'],
  ['も', 0, 'even if'], ['は', 0, 'te-form + は'], ['から', 0, 'after'],
];
for (const t of ['て', 'で']) for (const [s, m, n] of TE_AUX) add(t + s, t, m, TE, n);
add('ちゃう', 'て', V5, TE, 'completely');
add('じゃう', 'で', V5, TE, 'completely');
add('とく', 'て', V5, TE, 'in advance');
add('どく', 'で', V5, TE, 'in advance');

// Group rules by their final character for quick lookup.
const BY_LAST = new Map();
for (const r of RULES) {
  const c = r[0][r[0].length - 1];
  if (!BY_LAST.has(c)) BY_LAST.set(c, []);
  BY_LAST.get(c).push(r);
}

/**
 * Returns candidate dictionary forms: [{ term, type, reasons }].
 * The first candidate is always the input itself (type 0 = no constraint).
 */
export function deinflect(source) {
  const out = [{ term: source, type: 0, reasons: [] }];
  const seen = new Map([[source, 0]]);
  for (let i = 0; i < out.length && out.length < 200; i++) {
    const { term, type, reasons } = out[i];
    if (reasons.length >= 5) continue;
    const rules = BY_LAST.get(term[term.length - 1]);
    if (!rules) continue;
    for (const [from, to, inMask, outMask, name] of rules) {
      if (type !== 0 && !(type & inMask)) continue;
      // A bare ending is not a word, except whole irregular forms (した -> する, きた -> くる, 行った -> 行く).
      if (term.length < from.length + (to.length >= 2 ? 0 : 1) || !term.endsWith(from)) continue;
      const next = term.slice(0, term.length - from.length) + to;
      const prev = seen.get(next);
      if (prev !== undefined && (prev | outMask) === prev) continue;
      seen.set(next, (prev || 0) | outMask);
      out.push({ term: next, type: outMask, reasons: [name, ...reasons] });
    }
  }
  return out;
}

/** Word-class mask of a dictionary entry, from its JMdict part-of-speech codes. */
export function posMask(senses) {
  let mask = 0;
  for (const s of senses) {
    for (const p of s[0].split(',')) {
      if (p.startsWith('v1')) mask |= V1;
      else if (p.startsWith('v5') || p.startsWith('v4')) mask |= V5;
      else if (p === 'vk') mask |= VK;
      else if (p === 'vs-i' || p === 'vs-s') mask |= VS;
      else if (p === 'vs') mask |= VSN;
      else if (p === 'adj-i' || p === 'adj-ix' || p === 'aux-adj') mask |= ADJ;
    }
  }
  return mask;
}

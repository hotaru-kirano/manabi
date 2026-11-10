// Kana / romaji helpers shared by the build script, the search worker and tests.

/** Katakana -> hiragana, full-width ASCII -> half-width, lowercase. Used for every index key and query. */
export function normalize(str) {
  let out = '';
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    if (c >= 0x30a1 && c <= 0x30f6) out += String.fromCharCode(c - 0x60); // ァ-ヶ
    else if (c >= 0xff01 && c <= 0xff5e) out += String.fromCharCode(c - 0xfee0); // full-width ASCII
    else if (c === 0x3000) out += ' ';
    else out += str[i];
  }
  return out.toLowerCase().trim();
}

const JAPANESE_RE = /[぀-ヿ㐀-䶿一-鿿豈-﫿々〆]/;
export const hasJapanese = (s) => JAPANESE_RE.test(s);
export const hasLatin = (s) => /[a-z]/i.test(s);

const ROMAJI = {
  a: 'あ', i: 'い', u: 'う', e: 'え', o: 'お',
  ka: 'か', ki: 'き', ku: 'く', ke: 'け', ko: 'こ',
  ga: 'が', gi: 'ぎ', gu: 'ぐ', ge: 'げ', go: 'ご',
  sa: 'さ', shi: 'し', si: 'し', su: 'す', se: 'せ', so: 'そ',
  za: 'ざ', ji: 'じ', zi: 'じ', zu: 'ず', ze: 'ぜ', zo: 'ぞ',
  ta: 'た', chi: 'ち', ti: 'ち', tsu: 'つ', tu: 'つ', te: 'て', to: 'と',
  da: 'だ', di: 'ぢ', du: 'づ', dzu: 'づ', de: 'で', do: 'ど',
  na: 'な', ni: 'に', nu: 'ぬ', ne: 'ね', no: 'の',
  ha: 'は', hi: 'ひ', fu: 'ふ', hu: 'ふ', he: 'へ', ho: 'ほ',
  ba: 'ば', bi: 'び', bu: 'ぶ', be: 'べ', bo: 'ぼ',
  pa: 'ぱ', pi: 'ぴ', pu: 'ぷ', pe: 'ぺ', po: 'ぽ',
  ma: 'ま', mi: 'み', mu: 'む', me: 'め', mo: 'も',
  ya: 'や', yu: 'ゆ', yo: 'よ',
  ra: 'ら', ri: 'り', ru: 'る', re: 'れ', ro: 'ろ',
  wa: 'わ', wi: 'うぃ', we: 'うぇ', wo: 'を',
  kya: 'きゃ', kyu: 'きゅ', kyo: 'きょ', gya: 'ぎゃ', gyu: 'ぎゅ', gyo: 'ぎょ',
  sha: 'しゃ', shu: 'しゅ', she: 'しぇ', sho: 'しょ', sya: 'しゃ', syu: 'しゅ', syo: 'しょ',
  ja: 'じゃ', ju: 'じゅ', je: 'じぇ', jo: 'じょ', jya: 'じゃ', jyu: 'じゅ', jyo: 'じょ',
  zya: 'じゃ', zyu: 'じゅ', zyo: 'じょ',
  cha: 'ちゃ', chu: 'ちゅ', che: 'ちぇ', cho: 'ちょ', tya: 'ちゃ', tyu: 'ちゅ', tyo: 'ちょ',
  nya: 'にゃ', nyu: 'にゅ', nyo: 'にょ', hya: 'ひゃ', hyu: 'ひゅ', hyo: 'ひょ',
  bya: 'びゃ', byu: 'びゅ', byo: 'びょ', pya: 'ぴゃ', pyu: 'ぴゅ', pyo: 'ぴょ',
  mya: 'みゃ', myu: 'みゅ', myo: 'みょ', rya: 'りゃ', ryu: 'りゅ', ryo: 'りょ',
  fa: 'ふぁ', fi: 'ふぃ', fe: 'ふぇ', fo: 'ふぉ',
  va: 'ゔぁ', vi: 'ゔぃ', vu: 'ゔ', ve: 'ゔぇ', vo: 'ゔぉ',
  thi: 'てぃ', dhi: 'でぃ', tsa: 'つぁ', tsi: 'つぃ', tse: 'つぇ', tso: 'つぉ',
  xa: 'ぁ', xi: 'ぃ', xu: 'ぅ', xe: 'ぇ', xo: 'ぉ', xtu: 'っ', xtsu: 'っ', xya: 'ゃ', xyu: 'ゅ', xyo: 'ょ',
  la: 'ぁ', li: 'ぃ', lu: 'ぅ', le: 'ぇ', lo: 'ぉ', ltu: 'っ', lya: 'ゃ', lyu: 'ゅ', lyo: 'ょ',
  '-': 'ー',
};
const MACRON = { 'ā': 'aa', 'ī': 'ii', 'ū': 'uu', 'ē': 'ee', 'ō': 'ou', 'â': 'aa', 'î': 'ii', 'û': 'uu', 'ê': 'ee', 'ô': 'ou' };

/**
 * Convert romaji runs inside `input` (already normalized) to hiragana.
 * Returns { kana, rest } where `rest` is a trailing unfinished consonant cluster
 * (what you see mid-typing, e.g. "tab" -> { kana: "た", rest: "b" }).
 * Returns null when the latin text is not valid romaji.
 */
export function romajiToKana(input) {
  const s = input.replace(/[āīūēōâîûêô]/g, (m) => MACRON[m]);
  let out = '';
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (!/[a-z'-]/.test(ch)) {
      if (ch === ' ') { i++; continue; }
      out += ch; i++; continue;
    }
    if (ch === "'") { i++; continue; }
    const next = s[i + 1];
    // Doubled consonant -> small tsu (but "nn" is ん).
    if (next === ch && /[bcdfghjkmpqrstvwyz]/.test(ch)) { out += 'っ'; i++; continue; }
    if (ch === 't' && next === 'c' && s[i + 2] === 'h') { out += 'っ'; i++; continue; }
    let matched = false;
    for (let len = 4; len >= 1; len--) {
      const kana = ROMAJI[s.substr(i, len)];
      if (kana && s.length - i >= len) { out += kana; i += len; matched = true; break; }
    }
    if (matched) continue;
    if (ch === 'n' || ch === 'm') {
      if (ch === 'n' && (next === 'n' || next === "'")) { out += 'ん'; i += 2; continue; }
      if (next === undefined && ch === 'n') { out += 'ん'; i++; continue; }
      if (next !== undefined && /[bcdfghjkmpqrstvwz]/.test(next) && (ch === 'n' || /[bmp]/.test(next))) {
        out += 'ん'; i++; continue;
      }
    }
    // Unconvertible: fine only if it is a short trailing consonant cluster (still typing).
    const rest = s.slice(i);
    if (rest.length <= 2 && /^[bcdfghjkmpqrstvwyz]+$/.test(rest)) return { kana: out, rest };
    return null;
  }
  return { kana: out, rest: '' };
}

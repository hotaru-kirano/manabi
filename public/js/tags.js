// Readable names for the JMdict codes we show. Unknown codes are displayed as-is.
export const POS = {
  n: 'noun', pn: 'pronoun', 'n-pref': 'noun prefix', 'n-suf': 'noun suffix', 'n-pr': 'proper noun',
  'adj-i': 'i-adjective', 'adj-ix': 'i-adjective (いい)', 'adj-na': 'na-adjective', 'adj-no': 'no-adjective',
  'adj-pn': 'pre-noun adjectival', 'adj-t': 'taru-adjective', 'adj-f': 'noun modifier', 'aux-adj': 'auxiliary adjective',
  adv: 'adverb', 'adv-to': 'adverb with と', aux: 'auxiliary', 'aux-v': 'auxiliary verb', conj: 'conjunction',
  cop: 'copula', ctr: 'counter', exp: 'expression', int: 'interjection', num: 'numeric', pref: 'prefix',
  prt: 'particle', suf: 'suffix', unc: 'unclassified',
  v1: 'ichidan verb', 'v1-s': 'ichidan verb (くれる)', vk: 'kuru verb', vs: 'suru verb', 'vs-i': 'suru verb',
  'vs-s': 'suru verb (special)', 'vs-c': 'su verb', vz: 'zuru verb', vi: 'intransitive', vt: 'transitive',
  v5u: 'godan verb', 'v5u-s': 'godan verb (special)', v5k: 'godan verb', 'v5k-s': 'godan verb (行く)', v5g: 'godan verb',
  v5s: 'godan verb', v5t: 'godan verb', v5n: 'godan verb', v5b: 'godan verb', v5m: 'godan verb', v5r: 'godan verb',
  'v5r-i': 'godan verb (irregular)', v5aru: 'godan verb (-aru)', v5uru: 'godan verb (うる)',
};

export const MISC = {
  uk: 'usually kana', abbr: 'abbreviation', arch: 'archaic', col: 'colloquial', derog: 'derogatory', fam: 'familiar',
  fem: 'feminine', hon: 'honorific', hum: 'humble', id: 'idiom', male: 'masculine', obs: 'obsolete', obsc: 'obscure',
  'on-mim': 'onomatopoeia', pol: 'polite', rare: 'rare', sl: 'slang', vulg: 'vulgar', sens: 'sensitive', poet: 'poetic',
  yoji: 'four-character idiom', 'net-sl': 'internet slang', dated: 'dated', form: 'formal', chn: "children's language",
  joc: 'humorous', proverb: 'proverb', hist: 'historical', comp: 'computing', med: 'medicine', math: 'mathematics',
  food: 'food', ling: 'linguistics', gramm: 'grammar', law: 'law', Buddh: 'Buddhism', sports: 'sports', music: 'music',
  ksb: 'Kansai dialect', ktb: 'Kanto dialect', osb: 'Osaka dialect', kyb: 'Kyoto dialect',
};

const label = (map, codes) => {
  const out = [];
  for (const c of codes.split(',')) {
    if (!c) continue;
    const name = map[c] || c;
    if (!out.includes(name)) out.push(name);
  }
  return out.join(', ');
};
export const posLabel = (codes) => label(POS, codes);
export const miscLabel = (codes) => label(MISC, codes);

# Manabi 学び

A fast Japanese word lookup app. Open it, type or say a word, read the answer.

Built for reading: you hit a word in a book, you want it answered in a couple of seconds, and you want
to find it again later.

**Finding the word**

- **Type** — kanji, kana, romaji (`taberu`) or English (`to eat`). Results update on every keystroke.
- **Draw** — for kanji you can't read. Tap the pen, draw the character, pick it from the candidates.
  Stroke order doesn't have to be right.
- **Speak** — tap the mic and say the word. Spoken lookups also list the other words that sound the
  same (公園 / 講演 / 後援). This currently uses the browser's built-in recognition; the engine is still
  to be decided.
- **Wildcards** — `食?る` or `*物` when you only know part of a word; searching a kanji also lists words
  that contain it.
- **Conjugated forms** resolve to the dictionary form (食べませんでした → 食べる), and whole phrases are
  split into words (猫が魚を食べた).

**Understanding it**

- Tap a result for all meanings, example sentences and a breakdown of each kanji (meaning, on/kun
  readings, strokes, school grade, frequency). Tap a kanji to look it up; Back returns to the word.
- A speaker button reads the word aloud.

**Keeping it**

- Star a word to save it. The saved list exports as a `.tsv` (word, reading, meanings) that Anki imports.
- Recent lookups are kept, with a count for words you keep looking up.

**Offline** — it is a PWA: install it to the home screen and the dictionary (~17 MB download, once) is
stored on the device. Only voice input needs a connection.

Data: [JMdict](https://www.edrdg.org/jmdict/j_jmdict.html) (~219,000 entries, with example sentences),
[KANJIDIC2](https://www.edrdg.org/wiki/index.php/KANJIDIC_Project) and
[KanjiVG](https://kanjivg.tagaini.net) stroke shapes. Everything runs in the browser; there is no server.

## Run it

Needs Node 20+. There are no npm dependencies.

```sh
npm run build:dict   # downloads the source data and writes public/data/ (not committed)
npm run dev          # http://localhost:5173
npm test
```

Voice input uses the browser's Web Speech API: Chrome (desktop and Android), Edge and Safari (iOS/macOS)
support it; Firefox does not, so the mic button is hidden there. It requires HTTPS or localhost.

## Deploy

`public/` is a plain static site once `npm run build:dict` has run, so any static host works.

`.github/workflows/deploy.yml` builds the dictionary and publishes to GitHub Pages on every push to `main`
(and monthly, to pick up JMdict updates). Enable it once under **Settings → Pages → Source: GitHub Actions**.

## How it works

| File | Role |
| --- | --- |
| `scripts/build-dict.mjs` | Compiles JMdict, KANJIDIC2 and KanjiVG into compact text files: entries, a sorted headword/reading index, an English word index, examples, kanji details and handwriting templates |
| `public/js/search.js` | The search engine: binary search over the index, ranking, phrase splitting |
| `public/js/deinflect.js` | Conjugation rules (inflected form → dictionary form) |
| `public/js/kana.js` | Katakana/width folding and romaji → kana |
| `public/js/handwriting.js` | Kanji handwriting recognition by stroke matching |
| `public/js/worker.js` | Loads the data and runs searches and recognition off the main thread |
| `public/js/store.js` | Recent lookups and saved words (kept in the browser's local storage) |
| `public/js/app.js` | UI: results, details, draw pad, voice input, saved list |
| `public/sw.js` | Offline caching |

`public/icons/*.png` are generated from `icon.svg` by `scripts/make-icons.mjs` (needs Playwright; only
rerun if the icon changes).

## Licences of the data

- JMdict and KANJIDIC2 are the property of the [Electronic Dictionary Research and Development Group](https://www.edrdg.org/)
  and are used in conformance with the Group's [licence](https://www.edrdg.org/edrdg/licence.html) (CC BY-SA 4.0).
- Example sentences come from the [Tatoeba](https://tatoeba.org) project (CC BY 2.0 FR), via JMdict.
- Handwriting templates are derived from [KanjiVG](https://kanjivg.tagaini.net), © Ulrich Apel (CC BY-SA 3.0).

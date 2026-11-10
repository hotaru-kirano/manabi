# Manabi 学び

A fast Japanese word lookup app. Open it, type or say a word, read the answer.

- **Type** — kanji, kana, romaji (`taberu`) or English (`to eat`). Results update on every keystroke.
- **Speak** — tap the mic and say the word, e.g. while reading a book. Because speech recognition has to
  guess the spelling, spoken lookups also list the other words that sound the same (公園 / 講演 / 後援).
- **Conjugated forms** resolve to the dictionary form (食べませんでした → 食べる), and whole phrases are split
  into words (猫が魚を食べた).
- **Offline** — it is a PWA: install it to the home screen and the dictionary (~14 MB download, once)
  is stored on the device. Only voice input needs a connection, since the browser does the recognition.

The dictionary is [JMdict](https://www.edrdg.org/jmdict/j_jmdict.html) (~219,000 entries). Everything runs in
the browser; there is no server.

## Run it

Needs Node 20+. There are no npm dependencies.

```sh
npm run build:dict   # downloads JMdict and writes public/data/ (not committed)
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
| `scripts/build-dict.mjs` | Compiles JMdict XML into three text files: entries, a sorted headword/reading index, and an English word index |
| `public/js/search.js` | The search engine: binary search over the index, ranking, phrase splitting |
| `public/js/deinflect.js` | Conjugation rules (inflected form → dictionary form) |
| `public/js/kana.js` | Katakana/width folding and romaji → kana |
| `public/js/worker.js` | Loads the data and runs searches off the main thread |
| `public/js/app.js` | UI, voice input, recent lookups |
| `public/sw.js` | Offline caching |

`public/icons/*.png` are generated from `icon.svg` by `scripts/make-icons.mjs` (needs Playwright; only
rerun if the icon changes).

## Licence of the data

JMdict is the property of the [Electronic Dictionary Research and Development Group](https://www.edrdg.org/)
and is used in conformance with the Group's [licence](https://www.edrdg.org/edrdg/licence.html) (CC BY-SA 4.0).

// Offline support.
//  - App shell: stale-while-revalidate (instant start, updates apply on the next launch).
//  - Dictionary files (data/*.txt?v=<version>): cache-first; a new version replaces the old one.
const SHELL = 'manabi-shell-v1';
const DATA = 'manabi-data-v1';
const SHELL_FILES = [
  './', 'styles.css', 'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png',
  'js/app.js', 'js/worker.js', 'js/search.js', 'js/kana.js', 'js/deinflect.js', 'js/tags.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL).then((c) => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) if (name !== SHELL && name !== DATA) await caches.delete(name);
    await self.clients.claim();
  })());
});

async function dictionaryFile(request) {
  const cache = await caches.open(DATA);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok) {
    const copy = res.clone();
    const path = new URL(request.url).pathname;
    // Not awaited by the page: store the new version, then drop older versions of the same file.
    (async () => {
      await cache.put(request, copy);
      for (const key of await cache.keys()) {
        if (key.url !== request.url && new URL(key.url).pathname === path) await cache.delete(key);
      }
    })().catch(() => {});
  }
  return res;
}

async function shellFile(event) {
  const cache = await caches.open(SHELL);
  const isPage = event.request.mode === 'navigate';
  const hit = await cache.match(isPage ? './' : event.request, { ignoreSearch: isPage });
  const refresh = fetch(event.request).then((res) => {
    if (res.ok) cache.put(isPage ? './' : event.request, res.clone());
    return res;
  });
  if (!hit) return refresh;
  event.waitUntil(refresh.catch(() => {}));
  return hit;
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== location.origin) return;
  if (/\/data\/[^/]+\.txt$/.test(url.pathname)) event.respondWith(dictionaryFile(event.request));
  else event.respondWith(shellFile(event));
});

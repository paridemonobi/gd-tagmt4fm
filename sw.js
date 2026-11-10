/* Gaudio web: service worker. Mette in cache tutti i file della pagina
 * (anche gaudio.data, i suoni e i progetti di fabbrica) per l'uso offline
 * quando la pagina e' servita in https. La versione (impronta dei file,
 * scritta da tools/build_web.sh) cambia a ogni build: la cache vecchia si
 * butta. */
var VER = 'gaudio-a486f9d15828';
var FILES = ['./', 'index.html', 'mpk.js', 'audio.js', 'gaudio.js', 'gaudio.wasm', 'gaudio.data',
             'manifest.webmanifest', 'icon-180.png', 'icon-192.png', 'icon-512.png',
             'JetBrainsMonoNL-Medium.ttf'];
self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(VER).then(function (c) { return c.addAll(FILES); })
    .then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (ks) {
    return Promise.all(ks.filter(function (k) { return k !== VER; })
      .map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
self.addEventListener('fetch', function (e) {
  if (e.request.method !== 'GET') return;
  e.respondWith(caches.open(VER).then(function (c) {
    return c.match(e.request, { ignoreSearch: true }).then(function (r) {
      return r || fetch(e.request).then(function (resp) {
        if (resp.ok && new URL(e.request.url).origin === location.origin)
          c.put(e.request, resp.clone());
        return resp;
      });
    });
  }));
});

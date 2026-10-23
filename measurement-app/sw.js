/* Cache name carries the build, so deploying a new one clears the old cache.
   The page itself is fetched network-first: a stale build is worse than a slow
   one, and we have already been bitten by that.

   Nothing that is not a success is ever stored. An earlier version of this
   file cached whatever came back, so a single 403 from the edge could be kept
   and handed out afterwards, which is exactly what happened on 23 Sep 2026.
   A response already in the cache from that version is ignored and refetched. */
const CACHE = 'gidc-4.1';   // 1.9, Michael Sparaco in the sheet's rep list
const SHELL = ['./', './index.html', './icon-192.png', './icon-512.png',
               './apple-touch-icon.png', './manifest.webmanifest'];

const keepable = res => res && res.ok && res.status === 200 && res.type !== 'opaque';

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

function store(req, res){
  if(!keepable(res)) return res;                         // never keep an error
  const copy = res.clone();
  caches.open(CACHE).then(c => c.put(req, copy));
  return res;
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if(req.method !== 'GET') return;                       // never cache writes
  const url = new URL(req.url);
  if(url.origin !== location.origin) return;             // Supabase always goes to the network

  const isPage = req.mode === 'navigate' || url.pathname.endsWith('.html') ||
                 url.pathname === '/' || url.pathname === '';
  if(isPage){
    e.respondWith(
      fetch(req).then(res => store(req, res))
        .catch(() => caches.match(req).then(r =>
          (keepable(r) ? r : null) || caches.match('./index.html')))
    );
    return;
  }
  e.respondWith(caches.match(req).then(r =>
    (keepable(r) ? r : null) || fetch(req).then(res => store(req, res))));
});

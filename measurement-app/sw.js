/* Cache name carries the build, so deploying a new one clears the old cache.
   The page itself is fetched network-first: a stale build is worse than a slow
   one, and we have already been bitten by that.

   Nothing that is not a success is ever stored. An earlier version of this
   file cached whatever came back, so a single 403 from the edge could be kept
   and handed out afterwards, which is exactly what happened on 23 Sep 2026.
   A response already in the cache from that version is ignored and refetched. */
const CACHE = 'gidc-6.2';   // 2.20, compact customer box, Add door on review
const SHELL = ['./', './index.html', './hyperformula-3.0.1.min.js', './icon-192.png', './icon-512.png',
               './apple-touch-icon.png', './manifest.webmanifest',
               './docs/handle-hardware-selection.pdf', './docs/bypass-door-overlap-guide.pdf',
               './docs/bifold-door-fit-guide.pdf', './docs/handle-hardware-selection.png',
               './docs/bypass-door-overlap-guide.png', './docs/bifold-door-fit-guide.png',
               './pdf-lib-1.17.1.min.js',
               './docs/doors/1-lite-clear.jpg',
               './docs/doors/1-lite-double-sided-mirror.jpg',
               './docs/doors/1-lite-laundry.jpg',
               './docs/doors/1-lite-mirror.jpg',
               './docs/doors/1-lite-pantry.jpg',
               './docs/doors/1-lite-privacy-glass.jpg',
               './docs/doors/1-lite-rain.jpg',
               './docs/doors/1-lite-reed.jpg',
               './docs/doors/1-panel-shaker.jpg',
               './docs/doors/10-lite-clear.jpg',
               './docs/doors/15-lite-clear-glass.jpg',
               './docs/doors/2-panel-arch.jpg',
               './docs/doors/2-panel-raised.jpg',
               './docs/doors/2-panel-roman.jpg',
               './docs/doors/2-panel-shaker.jpg',
               './docs/doors/3-lite-clear-glass.jpg',
               './docs/doors/3-lite-privacy.jpg',
               './docs/doors/3-panel-equal-shaker.jpg',
               './docs/doors/3-panel-shaker.jpg',
               './docs/doors/4-lite-clear-glass.jpg',
               './docs/doors/4-lite-privacy-glass.jpg',
               './docs/doors/4-panel-shaker.jpg',
               './docs/doors/5-lite-clear-glass.jpg',
               './docs/doors/5-lite-privacy-glass.jpg',
               './docs/doors/5-panel-shaker.jpg',
               './docs/doors/aberdeen-beveled.jpg',
               './docs/doors/alki-modern.jpg',
               './docs/doors/ballard-modern.jpg',
               './docs/doors/benton-raised.jpg',
               './docs/doors/berkley.jpg',
               './docs/doors/birkdale-beveled.jpg',
               './docs/doors/bonneville-raised.jpg',
               './docs/doors/carrara-raised.jpg',
               './docs/doors/cheyenne-raised.jpg',
               './docs/doors/colonist-raised.jpg',
               './docs/doors/columbia-raised.jpg',
               './docs/doors/conmore-beveled.jpg',
               './docs/doors/craftsman-iii-beveled.jpg',
               './docs/doors/denman-modern.jpg',
               './docs/doors/fairview-modern.jpg',
               './docs/doors/flush-white.jpg',
               './docs/doors/gdl-awamori.jpg',
               './docs/doors/gdl-economy-glass.jpg',
               './docs/doors/gdl-glissade-bifold.jpg',
               './docs/doors/gdl-glissade-square.jpg',
               './docs/doors/gdl-glissade-swept.jpg',
               './docs/doors/gdl-malai.jpg',
               './docs/doors/gdl-midori.jpg',
               './docs/doors/gdl-select.jpg',
               './docs/doors/gdl-soba.jpg',
               './docs/doors/granville-modern.jpg',
               './docs/doors/kingston-raised.jpg',
               './docs/doors/laurelhurst-modern.jpg',
               './docs/doors/lincoln-park.jpg',
               './docs/doors/livingston.jpg',
               './docs/doors/logan.jpg',
               './docs/doors/lopez-raised.jpg',
               './docs/doors/madison-beveled.jpg',
               './docs/doors/melrose.jpg',
               './docs/doors/mercer-beveled.jpg',
               './docs/doors/monroe-beveled.jpg',
               './docs/doors/montlake-modern.jpg',
               './docs/doors/plantation-louver.jpg',
               './docs/doors/ravenna-modern.jpg',
               './docs/doors/riverside.jpg',
               './docs/doors/robson-modern.jpg',
               './docs/doors/rockport-raised.jpg',
               './docs/doors/rosario-raised.jpg',
               './docs/doors/santa-fe-raised.jpg',
               './docs/doors/vanair-ventilated.jpg',
               './docs/doors/whitman-beveled.jpg',
               './docs/doors/winslow.jpg',
               './docs/doors/winthrop-beveled.jpg',
               './docs/doors/yarrow-beveled.jpg'];

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

/* Cache name carries the build, so deploying a new one clears the old cache.
   The page itself is fetched network-first: a stale build is worse than a slow
   one, and we have already been bitten by that.

   Nothing that is not a success is ever stored. An earlier version of this
   file cached whatever came back, so a single 403 from the edge could be kept
   and handed out afterwards, which is exactly what happened on 23 Sep 2026.
   A response already in the cache from that version is ignored and refetched. */
const CACHE = 'gidc-10.2';  // 2.57, quotes: options and revisions, change orders, opening has required, Add note
const SHELL = ['./', './index.html', './hyperformula-3.0.1.min.js', './icon-192.png', './icon-512.png',
               './apple-touch-icon.png', './manifest.webmanifest',
               './handle-hardware-selection.pdf', './bypass-door-overlap-guide.pdf',
               './bifold-door-fit-guide.pdf', './handle-hardware-selection.png',
               './condo-installation-agreement.pdf', './condo-installation-agreement.png',
               './bypass-door-overlap-guide.png', './bifold-door-fit-guide.png',
               './pdf-lib-1.17.1.min.js', './pdfjs-3.11.174.min.js', './pdfjs-worker-3.11.174.min.js',
               './1-lite-clear.jpg',
               './1-lite-double-sided-mirror.jpg',
               './1-lite-laundry.jpg',
               './1-lite-mirror.jpg',
               './1-lite-pantry.jpg',
               './1-lite-privacy-glass.jpg',
               './1-lite-rain.jpg',
               './1-lite-reed.jpg',
               './1-panel-shaker.jpg',
               './10-lite-clear.jpg',
               './15-lite-clear-glass.jpg',
               './2-panel-arch.jpg',
               './2-panel-raised.jpg',
               './2-panel-roman.jpg',
               './2-panel-shaker.jpg',
               './3-lite-clear-glass.jpg',
               './3-lite-privacy.jpg',
               './3-panel-equal-shaker.jpg',
               './3-panel-shaker.jpg',
               './4-lite-clear-glass.jpg',
               './4-lite-privacy-glass.jpg',
               './4-panel-shaker.jpg',
               './5-lite-clear-glass.jpg',
               './5-lite-privacy-glass.jpg',
               './5-panel-shaker.jpg',
               './aberdeen-beveled.jpg',
               './alki-modern.jpg',
               './ballard-modern.jpg',
               './benton-raised.jpg',
               './berkley.jpg',
               './birkdale-beveled.jpg',
               './bonneville-raised.jpg',
               './carrara-raised.jpg',
               './cheyenne-raised.jpg',
               './colonist-raised.jpg',
               './columbia-raised.jpg',
               './conmore-beveled.jpg',
               './craftsman-iii-beveled.jpg',
               './denman-modern.jpg',
               './fairview-modern.jpg',
               './flush-white.jpg',
               './gdl-awamori.jpg',
               './gdl-economy-glass.jpg',
               './gdl-glissade-bifold.jpg',
               './gdl-glissade-square.jpg',
               './gdl-glissade-swept.jpg',
               './gdl-malai.jpg',
               './gdl-midori.jpg',
               './gdl-select.jpg',
               './gdl-soba.jpg',
               './granville-modern.jpg',
               './kingston-raised.jpg',
               './laurelhurst-modern.jpg',
               './lincoln-park.jpg',
               './livingston.jpg',
               './logan.jpg',
               './lopez-raised.jpg',
               './madison-beveled.jpg',
               './melrose.jpg',
               './mercer-beveled.jpg',
               './monroe-beveled.jpg',
               './montlake-modern.jpg',
               './plantation-louver.jpg',
               './ravenna-modern.jpg',
               './riverside.jpg',
               './robson-modern.jpg',
               './rockport-raised.jpg',
               './rosario-raised.jpg',
               './santa-fe-raised.jpg',
               './vanair-ventilated.jpg',
               './whitman-beveled.jpg',
               './winslow.jpg',
               './winthrop-beveled.jpg',
               './yarrow-beveled.jpg'];

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

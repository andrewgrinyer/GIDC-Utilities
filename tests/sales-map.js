// Clicks through the Sales Map on the tools site against a fake Supabase.
// Nothing leaves the machine: map tiles are refused, so the map is grey.
// The customers are made up, scattered around three made up showroom
// positions near the real ones.
//
//   node tests/sales-map.js            (SHOTS=/some/dir to save screenshots)
//
// Prints each check, then ERRORS: [] when no page threw and FAILED: []
// when every check held.

const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const path = require('path'), fs = require('fs'), http = require('http');
const ROOT = path.join(__dirname, '..');
const SHOTS = process.env.SHOTS || '';
function serve(dir, port){ return new Promise(ok => http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]); if(p.endsWith('/')) p += 'index.html';
  const f = path.join(dir, p);
  if(!fs.existsSync(f)){ r.statusCode = 404; return r.end('nf'); }
  r.setHeader('Content-Type', f.endsWith('.js') ? 'text/javascript' : f.endsWith('.css') ? 'text/css' : 'text/html');
  r.end(fs.readFileSync(f));
}).listen(port, ok)); }

const ROOMS = [
  {name:'Cambridge', address:'1177 Franklin Blvd, Cambridge, ON', lat:43.400, lng:-80.300, sort:10},
  {name:'Mississauga', address:'2225 Dundas St E, Mississauga, ON', lat:43.610, lng:-79.600, sort:20},
  {name:'Burlington', address:'18 Plains Road W, Burlington, ON', lat:43.315, lng:-79.855, sort:30}
];
// a repeatable scatter
let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const iso = d => d.toISOString().slice(0, 10);
const TODAY = new Date();
const CUST = [];
for(let i = 1; i <= 1400; i++){
  const room = ROOMS[i % 3];
  const far = rnd() * 0.6;                       // up to about 60 km
  const ang = rnd() * Math.PI * 2;
  const created = new Date(TODAY.getTime() - Math.floor(rnd() * 700) * 86400000);
  const kind = ['red', 'yellow', 'green', 'purple', 'blue', 'showonly'][Math.floor(rnd() * 6)];
  const plus = n => iso(new Date(created.getTime() + n * 86400000));
  CUST.push({
    estimate_id: 9000 + i, order_no: /green|purple|blue/.test(kind) ? String(5000 + i) : null,
    name: 'Test ' + i, rep: i % 7 === 0 ? null : ['Nick', 'Michael', 'Peter'][i % 3], address: i + ' Sample St', city: room.name, postal: null,
    created_on: iso(created),
    measure_on: /red|yellow|green|purple/.test(kind) ? plus(5) : null,
    showroom_on: /yellow|green|blue|showonly/.test(kind) ? plus(9) : null,
    sold_on: /green|purple|blue/.test(kind) ? plus(14) : null,
    lat: i % 50 === 0 ? null : room.lat + far * Math.sin(ang) * 0.7,
    lng: i % 50 === 0 ? null : room.lng + far * Math.cos(ang),
    placed_by: i % 50 === 0 ? null : (i % 17 === 0 ? 'postal' : 'address'),
    _kind: kind
  });
}
let ROLE = 'admin', OLD_DB = false;
async function mock(page){
  await page.route('https://tile.openstreetmap.org/**', r => r.abort());
  await page.route('https://baakegbtuygtldksmant.supabase.co/**', async route => {
    const req = route.request(), u = new URL(req.url()), p = u.pathname;
    const j = (b, s) => route.fulfill({status:s || 200, contentType:'application/json', body:JSON.stringify(b)});
    if(p === '/rest/v1/profiles') return j([{id:'a1', name:'Andrew', role:ROLE, active:true, email_verified_at:'2026-10-24'}]);
    const off = +(u.searchParams.get('offset') || 0), lim = Math.min(+(u.searchParams.get('limit') || 1000), 1000);
    if(p === '/rest/v1/sales_map_customers' && OLD_DB && /rep/.test(u.searchParams.get('select')))
      return j({message:'column sales_map_customers.rep does not exist'}, 400);
    if(p === '/rest/v1/sales_map_customers')
      return j(CUST.map(c => { const o = Object.assign({}, c); delete o._kind; return o; }).slice(off, off + lim));
    if(p === '/rest/v1/sales_map_showrooms') return j(ROOMS.slice(off, off + lim));
    if(p === '/rest/v1/sales_map_runs') return j([{ran_at:'2026-11-26T03:17:00Z', counts:{waiting:12}}]);
    return j([]);
  });
}
const failed = [];
const check = (ok, what) => { console.log((ok ? 'ok   ' : 'FAIL ') + what); if(!ok) failed.push(what); };

(async () => {
  await serve(ROOT + '/tools-site', 8731);
  const b = await chromium.launch();
  const errs = [];
  async function open(role, viewport){
    ROLE = role;
    const page = await b.newPage({viewport: viewport || {width:1280, height:1000}});
    page.on('pageerror', e => errs.push(e.message));
    await mock(page);
    await page.goto('http://localhost:8731/');
    await page.evaluate(() => localStorage.setItem('gidc:session', JSON.stringify({access_token:'x', refresh_token:'y', user:{id:'a1', email:'a@g.ca'}})));
    await page.goto('http://localhost:8731/salesmap/');
    return page;
  }

  let page = await open('admin');
  await page.waitForFunction(() => document.querySelectorAll('#rates tr').length > 2);
  const landing = await page.evaluate(() => fetch('/').then(r => r.text()));
  check(/Sales Map/.test(landing) && /\.\/salesmap\//.test(landing) && /who:\s*'admin'/.test(landing.split('Sales Map')[1] || ''),
        'landing page has a Sales Map tile for admins');
  check(/Tools 3\.8/.test(landing), 'landing page says Tools 3.8');

  // what should be there in the last 12 months
  const from = await page.$eval('#from', e => e.value);
  const want = {red:0, yellow:0, green:0, purple:0, blue:0};
  CUST.forEach(c => { if(c.created_on >= from && c._kind !== 'showonly') want[c._kind]++; });
  const legend = await page.$$eval('.legend label', ls => ls.map(l => l.innerText.replace(/\s+/g, ' ').trim()));
  console.log('     legend: ' + legend.join(' | '));
  const n = k => +((legend.find(l => l.toLowerCase().indexOf(k) === 0) || '').match(/(\d+)$/) || [0, -1])[1];
  check(n('in home visit only') === want.red, 'red count matches (' + want.red + ')');
  check(n('in home, then showroom, not') === want.yellow, 'yellow count matches (' + want.yellow + ')');
  check(n('in home, then showroom, sold') === want.green, 'green count matches (' + want.green + ')');
  check(n('sold without') === want.purple, 'purple count matches (' + want.purple + ')');
  check(n('sold in showroom') === want.blue, 'blue count matches (' + want.blue + ')');
  check(!/orange/i.test(legend.join(' ')), 'no orange in the legend');
  check(legend.some(l => /Showroom$/.test(l)), 'legend shows the showroom building');

  const rooms = await page.$$eval('.room-icon', e => e.length);
  check(rooms >= 3, 'three showroom buildings on the map (' + rooms + ' icons incl. legend)');
  const total = await page.$eval('#rates tr.total', e => e.innerText.replace(/\s+/g, ' '));
  const all = Object.values(want).reduce((a, b) => a + b, 0);
  const sold = want.green + want.purple + want.blue;
  console.log('     total row: ' + total);
  check(total.indexOf('All ' + all + ' ') === 0, 'table total counts every coloured customer in the dates (' + all + ')');
  check(total.indexOf(Math.round(100 * sold / all) + '%') > 0, 'close rate is sold out of all');
  const head = await page.$eval('#rates tr', e => e.innerText);
  check(/0 to 5 km/.test(await page.$eval('#rates', e => e.innerText)) && /Over 50 km/.test(await page.$eval('#rates', e => e.innerText)),
        'distance rings run from 0 to 5 km up to over 50 km');
  check(/No distance/.test(await page.$eval('#rates', e => e.innerText)), 'customers not placed count under No distance');
  check(/could not be put on the map/.test(await page.$eval('#mapnote', e => e.innerText)), 'map says how many could not be placed');
  check(!/[‐-―-]/.test(await page.$eval('.wrap', e => e.innerText.replace(/\d{4}-\d{2}-\d{2}/g, ''))), 'no hyphens or dashes in the words on the page');

  // a colour can be switched off
  await page.click('.legend input[data-k="red"]');
  const total2 = await page.$eval('#rates tr.total', e => e.innerText.replace(/\s+/g, ' '));
  check(total2.indexOf('All ' + (all - want.red) + ' ') === 0, 'unticking red takes red out of the table');
  await page.click('.legend input[data-k="red"]');

  // date filter: everything
  await page.click('button[data-q="all"]');
  const legendAll = await page.$$eval('.legend label', ls => ls.map(l => l.innerText.replace(/\s+/g, ' ').trim()));
  const everyRed = CUST.filter(c => c._kind === 'red').length;
  check(+(legendAll[0].match(/(\d+)$/) || [0, 0])[1] === everyRed, 'Everything shows every red (' + everyRed + ')');

  // nearest showroom filter
  await page.selectOption('#room', 'Burlington');
  const tb = await page.$eval('#rates tr.total', e => e.innerText.replace(/\s+/g, ' '));
  check(+tb.split(' ')[1] < all * 1.5 && +tb.split(' ')[1] > 0, 'Burlington only is a smaller set (' + tb.split(' ')[1] + ')');

  // measurement salesperson
  await page.selectOption('#room', '');
  const reps = await page.$$eval('#rep option', o => o.map(x => x.textContent));
  check(reps.join(',') === 'Everybody,Michael,Nick,Peter,No salesperson', 'salesperson list: ' + reps.join(', '));
  await page.selectOption('#rep', 'Nick');
  const nick = CUST.filter(c => c.rep === 'Nick' && c._kind !== 'showonly').length;
  const tn = await page.$eval('#rates tr.total', e => e.innerText.replace(/\s+/g, ' '));
  check(tn.indexOf('All ' + nick + ' ') === 0, 'Nick only counts his customers (' + nick + ')');
  await page.selectOption('#rep', '(none)');
  const none = CUST.filter(c => !c.rep && c._kind !== 'showonly').length;
  const t0 = await page.$eval('#rates tr.total', e => e.innerText.replace(/\s+/g, ' '));
  check(t0.indexOf('All ' + none + ' ') === 0, 'No salesperson counts those without one (' + none + ')');
  await page.selectOption('#rep', '');

  // zoom
  const z0 = await page.evaluate(() => document.querySelector('.leaflet-control-zoom-in') != null);
  check(z0, 'zoom buttons are there');

  // a popup
  await page.selectOption('#room', '');
  if(SHOTS) await page.screenshot({path: SHOTS + '/sales-map.png', fullPage: true});
  // click a showroom marker (the map's own markers are the last three .room-icon)
  await page.locator('.leaflet-marker-icon.room-icon').first().click();
  check(/showroom/.test(await page.$eval('.leaflet-popup-content', e => e.innerText)), 'clicking a building names the showroom');
  await page.close();

  // a database without the 1.1 SQL still opens the map
  OLD_DB = true;
  page = await open('admin');
  await page.waitForFunction(() => document.querySelectorAll('#rates tr').length > 2);
  check(/^All \d+/.test(await page.$eval('#rates tr.total', e => e.innerText.replace(/\s+/g, ' '))), 'map opens before the 1.1 SQL is run');
  await page.close();
  OLD_DB = false;

  // phone
  page = await open('admin', {width:390, height:844});
  await page.waitForFunction(() => document.querySelectorAll('#rates tr').length > 2);
  const wide = await page.evaluate(() => document.documentElement.scrollWidth);
  check(wide <= 390, 'no sideways scroll on a phone (' + wide + ')');
  if(SHOTS) await page.screenshot({path: SHOTS + '/sales-map-phone.png', fullPage: true});
  await page.close();

  // not an admin
  for(const role of ['user', 'sales', 'manufacturing']){
    page = await open(role);
    await page.waitForTimeout(500);
    const held = await page.evaluate(() => !!document.getElementById('gidc-hold') && !document.querySelector('.leaflet-container'));
    check(held, role + ' is turned away');
    const tile = await page.evaluate(() => fetch('/').then(r => r.text()));
    await page.close();
  }

  await b.close();
  console.log('ERRORS:', JSON.stringify(errs));
  console.log('FAILED:', JSON.stringify(failed));
  process.exit(failed.length || errs.length ? 1 : 0);
})();

// Hide shipped orders on the dealer portal orders list, against a fake
// Supabase. Nothing leaves the machine.
//
//   node tests/hide-shipped.js
//   (or PLAYWRIGHT=/path/to/playwright node tests/hide-shipped.js)
//
// Turns the switch on, reloads to show the browser remembers it, picks the
// Shipped chip to show it still lists shipped orders, signs out and in to
// show the switch survives, and empties the list to read what it says.
// Ends with ERRORS: [] when no page threw. SHOT=file.png saves a picture.

const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const path = require('path'), fs = require('fs'), http = require('http');
const ROOT = path.join(__dirname, '..');
http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]); if(p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, 'dealer-portal', p);
  if(!fs.existsSync(f)){ r.statusCode = 404; return r.end('nf'); }
  r.setHeader('Content-Type', 'text/html'); r.end(fs.readFileSync(f));
}).listen(8716);
const o = (id, status, ref) => ({id, dealer_id:'D1', order_ref:ref, customer_name:ref, status,
  door_count:2, panel_count:0, created_at:'2026-11-0' + id.slice(1), files:[], form:{rows:[]}});
let ORDERS = [o('o1','submitted','Smith'), o('o2','shipped','Jones'), o('o3','shipped','Brown'),
              o('o4','in_production','Lee'), o('o5','draft','Wong')];
const ME = {id:'a1', name:'Admin', role:'admin', active:true, email_verified_at:'2026-10-01'};
(async () => {
  const b = await chromium.launch();
  const page = await b.newPage(); await page.setViewportSize({width:1400, height:900});
  const errs = []; page.on('pageerror', e => errs.push(e.message)); page.on('dialog', d => d.accept());
  await page.route('https://baakegbtuygtldksmant.supabase.co/**', async route => {
    const u = new URL(route.request().url());
    const j = x => route.fulfill({status:200, contentType:'application/json', body:JSON.stringify(x)});
    if(u.pathname === '/rest/v1/profiles') return j([ME]);
    if(u.pathname === '/rest/v1/dealers') return j([{id:'D1', name:'South Florida', slug:'SF', active:true}]);
    if(u.pathname === '/rest/v1/dealer_orders') return j(ORDERS);
    if(u.pathname === '/auth/v1/user') return j({id:ME.id});
    return j([]);
  });
  const signIn = async () => {
    await page.evaluate(id => localStorage.setItem('gidc:session', JSON.stringify(
      {access_token:'x', refresh_token:'y', user:{id, email:'a@gidc.ca'}})), ME.id);
    await page.goto('http://localhost:8716/');
    await page.waitForSelector('tr[data-open]');
  };
  const rows = () => page.$$eval('tr[data-open]', x => x.map(r => r.dataset.open).join(' '));
  const sw = () => page.$eval('button[data-hideshipped]', x => x.innerText + (x.classList.contains('on') ? ' (on)' : ''));
  const count = () => page.evaluate(() => [...document.querySelectorAll('.filterbar .muted')].map(x => x.innerText).join(' | '));

  await page.goto('http://localhost:8716/'); await signIn();
  console.log('build:', await page.evaluate(() => BUILD));
  console.log('start:', await rows(), '/', await sw());
  await page.click('button[data-hideshipped]');
  console.log('hidden:', await rows(), '/', await sw(), '/', await count());
  if(process.env.SHOT) await page.screenshot({path:process.env.SHOT});
  await page.reload(); await page.waitForSelector('tr[data-open]');
  console.log('after reload:', await rows(), '/', await sw());
  await page.click('button[data-filter="shipped"]');
  console.log('Shipped chip:', await rows());
  await page.click('button[data-filter="all"]');
  console.log('back to All:', await rows());
  await page.evaluate(() => { clearPersonal(); });
  await signIn();
  console.log('after sign out and in:', await rows(), '/', await sw());

  ORDERS = ORDERS.filter(x => x.status === 'shipped');
  await page.reload(); await page.waitForSelector('button[data-hideshipped]');
  console.log('all shipped:', await page.$eval('.empty', x => x.innerText.replace(/\s+/g, ' ')));
  await page.click('.empty button[data-hideshipped]');
  console.log('after Show shipped:', await rows(), '/', await sw());

  console.log('ERRORS:', errs);
  await b.close(); process.exit(0);
})();

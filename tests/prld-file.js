// The PRLD file on a dealer order, against a fake Supabase.
// Nothing leaves the machine.
//
//   node tests/prld-file.js
//   (or PLAYWRIGHT=/path/to/playwright node tests/prld-file.js)
//
// A draft with a Proliner .xml cannot be submitted until its .prld is added.
// Adds one through the PRLD file button, submits, and prints what went up to
// storage and onto the order. A draft with no .xml is not held up. Ends with
// ERRORS: [] when no page threw.

const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const path = require('path'), fs = require('fs'), http = require('http'), os = require('os');
const ROOT = path.join(__dirname, '..');
http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]); if(p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, 'dealer-portal', p);
  if(!fs.existsSync(f)){ r.statusCode = 404; return r.end('nf'); }
  r.setHeader('Content-Type', 'text/html'); r.end(fs.readFileSync(f));
}).listen(8715);
const calls = [];
const row = (id, extra) => Object.assign({id, location:'Hall', qty:1, productType:'1.375 Hollow',
  doorType:'Bypass', doorStyle:'Columbia', width:'30', height:'80', paintColour:'', pinStop:'', jambW:''}, extra || {});
const XML = {name:'Smith.xml', path:'D1/aaa/Smith.xml', kind:'proliner', size:900, at:'2026-11-08T10:00:00Z'};
const ORDERS = [
  {id:'o1', dealer_id:'D1', order_ref:'WITH XML', customer_name:'SFDC', status:'draft', door_count:1, panel_count:0,
   created_at:'2026-11-08', files:[XML], form:{sources:{xml:'Smith.xml'}, rows:[row('r1')]}},
  {id:'o2', dealer_id:'D1', order_ref:'NO XML', customer_name:'SFDC', status:'draft', door_count:1, panel_count:0,
   created_at:'2026-11-07', files:[], form:{rows:[row('r2')]}},
];
const ME = {id:'d1', name:'Dealer', role:'dealer', dealer_role:'dealer', dealer_id:'D1', active:true, email_verified_at:'2026-10-01'};
const PRLD = path.join(os.tmpdir(), 'Smith.prld');
fs.writeFileSync(PRLD, 'PROLINER PROJECT not read by the portal');
(async () => {
  const b = await chromium.launch();
  const page = await b.newPage(); await page.setViewportSize({width:1600, height:1000});
  const errs = []; page.on('pageerror', e => errs.push(e.message)); page.on('dialog', d => d.accept());
  await page.route('https://baakegbtuygtldksmant.supabase.co/**', async route => {
    const req = route.request(), u = new URL(req.url()), m = req.method();
    calls.push(m + ' ' + u.pathname + (m === 'PATCH' ? ' ' + req.postData() : ''));
    const j = (x, s=200) => route.fulfill({status:s, contentType:'application/json', body:JSON.stringify(x)});
    if(u.pathname === '/rest/v1/profiles') return j([ME]);
    if(u.pathname === '/rest/v1/dealers') return j([{id:'D1', name:'South Florida', slug:'SOUTHFLORIDA', active:true}]);
    if(u.pathname === '/rest/v1/dealer_orders' && m === 'GET'){
      const id = /id=eq\.(\w+)/.exec(u.search);
      return j(id ? ORDERS.filter(o => o.id === id[1]) : ORDERS);
    }
    if(u.pathname === '/rest/v1/dealer_orders' && m === 'PATCH'){
      const id = /id=eq\.(\w+)/.exec(u.search)[1];
      return j([Object.assign({}, ORDERS.find(o => o.id === id), JSON.parse(req.postData()))]);
    }
    if(u.pathname.startsWith('/storage/v1/object/order-files/') && m === 'POST') return j({Key:'ok'});
    if(u.pathname === '/functions/v1/send-order') return j({ok:true, to:['order@grinyer.ca'], attached:[]});
    if(u.pathname === '/auth/v1/user') return j({id:ME.id});
    return j([]);
  });
  await page.goto('http://localhost:8715/');
  await page.evaluate(id => localStorage.setItem('gidc:session', JSON.stringify({access_token:'x', refresh_token:'y', user:{id, email:'d@sf.com'}})), ME.id);
  await page.goto('http://localhost:8715/');
  await page.waitForSelector('tr[data-open="o1"]');
  console.log('build:', await page.evaluate(() => BUILD));

  await page.click('tr[data-open="o1"]');
  await page.waitForSelector('button[data-submit="1"]');
  const sub = () => page.$eval('button[data-submit="1"]', x => x.disabled ? 'disabled: ' + x.title : 'enabled');
  console.log('with xml, no prld, submit is', await sub());
  console.log('warning:', await page.evaluate(() => [...document.querySelectorAll('.note.warn b')].map(x => x.innerText)));

  await page.click('button[data-import="prld"]');
  await page.waitForSelector('#dzf3', {state:'attached'});
  console.log('asked for:', await page.$eval('#ask .dz b', x => x.innerText));
  await page.setInputFiles('#dzf3', PRLD);
  await page.waitForTimeout(300);
  console.log('after adding the prld, submit is', await sub());
  console.log('files on screen:', await page.$$eval('.files .file', x => x.map(f => f.innerText.replace(/\s+/g, ' ').trim())));

  await page.click('button[data-submit="1"]');
  await page.waitForTimeout(800);
  console.log('uploaded:', calls.filter(c => c.startsWith('POST /storage')).map(c => c.split('/').pop()));
  const patch = calls.filter(c => c.startsWith('PATCH /rest/v1/dealer_orders')).pop() || '';
  const saved = JSON.parse(patch.slice(patch.indexOf(' {') + 1) || '{}');
  console.log('files on the order:', (saved.files || []).map(f => f.kind + ' ' + f.name));
  console.log('send-order called:', calls.some(c => c.includes('/functions/v1/send-order')));

  // an order with no xml is not asked for a prld
  await page.goto('http://localhost:8715/');
  await page.waitForSelector('tr[data-open="o2"]');
  await page.click('tr[data-open="o2"]');
  await page.waitForSelector('button[data-submit="1"]');
  console.log('no xml, submit is', await sub());

  console.log('ERRORS:', errs);
  await b.close(); process.exit(0);
})();

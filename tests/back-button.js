// Back goes to the page you were on (portal 2.22), against the same fake
// Supabase as split-order.js. Nothing leaves the machine.
//
//   node tests/back-button.js
//
// Orders list filtered and scrolled, open an order, Back: the list with the
// filter and the scroll. Pallets, packing list, browser back: pallets,
// again: the list. Order, browser back and forward. Ends with ERRORS: [].

const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const path = require('path'), fs = require('fs'), http = require('http');
const ROOT = path.join(__dirname, '..');
http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]); if(p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, 'dealer-portal', p);
  if(!fs.existsSync(f)){ r.statusCode = 404; return r.end('nf'); }
  r.setHeader('Content-Type', 'text/html'); r.end(fs.readFileSync(f));
}).listen(8722);

const row = (id, opening, location, doorType, style, w, h) =>
  ({id, opening, location, doorType, style, width:w, height:h, paintColour:'Pearly', core:'Hollow'});
let ORDERS = [
  {id:'c1', dealer_id:'D1', order_ref:'SFD CORTES 88', customer_name:'SFDC', status:'in_production',
   access_order_no:'4273', access_order_id:4275, door_count:6, panel_count:6, paint_colour:'Pearly',
   created_at:'2026-11-10T14:00:00Z', submitted_at:'2026-11-10T14:00:00Z', emailed_at:'2026-11-10T14:01:00Z',
   files:[{kind:'proliner', name:'cortes.xml', path:'D1/aa/cortes.xml', at:'2026-11-10T14:00:00Z'},
          {kind:'prld', name:'cortes.prld', path:'D1/aa/cortes.prld', at:'2026-11-10T14:00:00Z'},
          {kind:'orderform', name:'SFD - Cortes.xlsx', path:'D1/aa/f.xlsx', at:'2026-11-10T14:00:00Z'}],
   form:{rows:[row('r1','1','Hall closet','Double Bifold','4 Panel True Shaker','48','80'),
               row('r2','','Bedroom 1','Single Swing','4 Panel True Shaker','30','80'),
               row('r3','3','Pantry','Single Swing','Kingston','24','80'),
               row('r4','4','Laundry','Bypass','Kingston','60','80')], custom:{}, sources:{xml:'cortes.xml'}}},
  {id:'s1', dealer_id:'D1', order_ref:'SFD ABRAHAM 6938', customer_name:'SFDA', status:'shipped',
   access_order_no:'4973', access_order_id:4975, door_count:2, panel_count:0, created_at:'2026-11-01T14:00:00Z',
   est_ship_date:'2026-11-20', files:[], form:{rows:[row('s1a','1','Den','Single Swing','Kingston','30','80'),
   row('s1b','2','Den','Single Swing','Kingston','30','80')]}},
  {id:'i1', dealer_id:'D1', order_ref:'SFD MORTON 14', customer_name:'SFDM', status:'ready_to_ship',
   access_order_no:'5101', access_order_id:5103, door_count:2, panel_count:0, created_at:'2026-11-05T14:00:00Z',
   est_ship_date:'2026-11-26', files:[], form:{rows:[row('m1','1','Office','Single Swing','Kingston','30','80'),
   row('m2','2','Hall','Single Swing','Kingston','28','80')]}}];
ORDERS.push({id:'l1', dealer_id:'D1', order_ref:'SFD LEE 22', customer_name:'SFDL', status:'ready_to_ship',
   access_order_no:'5120', access_order_id:5122, door_count:2, panel_count:0, created_at:'2026-11-06T14:00:00Z',
   pallet_name:'SFD 3', est_ship_date:'2026-11-27', files:[], form:{rows:[row('l1a','1','Office','Single Swing','Kingston','30','80'),
   row('l1b','2','Hall','Single Swing','Kingston','28','80')]}});
const PALLETS = [{id:'P3', name:'SFD 3', dealer:'South Florida', built_on:'2026-11-20'}];
const PALLET_ORDERS = [{order_id:'l1', pallet_id:'P3', position:1}];
const CUSTOMS = [{id:'cu3', pallet_id:'P3', pallet_name:'SFD 3', order_ids:['l1','x9'], fields:{invNo:'SFD 3'},
  total:2400, created_at:'2026-11-21T15:00:00Z', voided_at:null}];
let MAIL_OK = true;
const INVOICES = [{id:'v1', order_id:'i1', pallet_id:'P1', invoice_no:'1043', voided_at:null}];
let ME = {id:'a1', name:'Admin', role:'admin', active:true, email_verified_at:'2026-10-01'};
const calls = [];

function splitOrder(b){
  const o = ORDERS.find(x => x.id === b.p_order);
  if(!o) return [400, {message:'That order is not there any more.'}];
  if(ME.role !== 'admin') return [400, {message:'Only Grinyer can split an order.'}];
  if(PALLET_ORDERS.some(x => x.order_id === o.id)) return [400, {message:'This order is on a pallet. Take it off the pallet first, then split it.'}];
  if(o.status === 'shipped') return [400, {message:'This order has shipped, so it cannot be split.'}];
  if(INVOICES.some(v => v.order_id === o.id && !v.voided_at))
    return [400, {message:'This order has been invoiced. Void its invoice on the pallet first, then split it.'}];
  const root = o.split_of || o.id, base = o.order_ref.replace(/\s+Part\s+\d+\s*$/i, '');
  const part = Math.max(1, ...ORDERS.filter(x => x.id === root || x.split_of === root).map(x => x.split_part || 1)) + 1;
  const L = b.p_leaves || {}, pick = k => ['qty','leaves','width'].reduce((a, f) => (k[f] !== undefined ? (a[f] = k[f], a) : a), {});
  const rows = o.form.rows.map((r, i) => r.opening ? r : Object.assign({}, r, {opening: String(i + 1)}));
  const keep = rows.filter(x => !b.p_rows.includes(x.id)).map(x => L[x.id] ? Object.assign({}, x, pick(L[x.id].keep)) : x);
  const move = rows.filter(x => b.p_rows.includes(x.id) || L[x.id])
    .map(x => L[x.id] ? Object.assign({}, x, pick(L[x.id].move), {id: x.id + '-p' + part}) : x);
  if(!move.length || !keep.length) return [400, {message:'bad ticks'}];
  const n = Object.assign(JSON.parse(JSON.stringify(o)), {id:'n' + part, order_ref:base + ' Part ' + part,
    form:Object.assign({}, o.form, {rows:move, split:{of:root, part}}), files:[], est_ship_date:null,
    access_order_id:null, access_order_no:null, pallet_name:null, split_of:root, split_part:part,
    door_count:b.p_move.door_count, panel_count:b.p_move.panel_count, created_at:'2026-11-23T23:30:00Z'});
  Object.assign(o, {order_ref:base + ' Part ' + (o.split_part || 1), split_part:o.split_part || 1,
    form:Object.assign({}, o.form, {rows:keep}), door_count:b.p_keep.door_count, panel_count:b.p_keep.panel_count});
  ORDERS.push(n);
  return [200, {id:n.id, order_ref:n.order_ref, part, kept_ref:o.order_ref, moved:move.length, kept:keep.length}];
}

(async () => {
  const b = await chromium.launch();
  const page = await b.newPage(); await page.setViewportSize({width:1400, height:950});
  const errs = []; page.on('pageerror', e => errs.push(e.message)); page.on('dialog', d => d.accept());
  await page.route('https://baakegbtuygtldksmant.supabase.co/**', async route => {
    const req = route.request(), u = new URL(req.url()), m = req.method();
    const j = (x, s=200) => route.fulfill({status:s, contentType:'application/json', body:JSON.stringify(x)});
    if(!/profiles|dealers$|auth/.test(u.pathname)) calls.push(m + ' ' + u.pathname + (u.search ? ' ' + decodeURIComponent(u.search) : ''));
    if(u.pathname === '/rest/v1/profiles') return j([ME]);
    if(u.pathname === '/rest/v1/dealers') return j([{id:'D1', name:'South Florida', slug:'SOUTHFLORIDA', active:true}]);
    if(u.pathname === '/rest/v1/dealer_orders' && m === 'GET'){
      const id = (u.searchParams.get('id') || '').replace(/^eq\./, '');
      const inList = /^in\.\((.*)\)$/.exec(id);
      if(inList) return j(ORDERS.filter(o => inList[1].split(',').includes(o.id)));
      const mine = ME.role === 'admin' ? ORDERS : ORDERS.filter(o => o.dealer_id === ME.dealer_id);
      return j(id ? mine.filter(o => o.id === id) : mine.slice().sort((a, b) => b.created_at < a.created_at ? -1 : 1));
    }
    if(u.pathname === '/rest/v1/dealer_orders' && m === 'PATCH'){
      const id = u.searchParams.get('id').replace(/^eq\./, ''), o = ORDERS.find(x => x.id === id);
      Object.assign(o, JSON.parse(req.postData())); calls.push('  patched ' + id + ' ' + req.postData());
      return j([o]);
    }
    if(u.pathname === '/rest/v1/rpc/gidc_split_order'){
      calls.push('  split ' + req.postData());
      const [s, x] = splitOrder(JSON.parse(req.postData())); return j(x, s);
    }
    if(u.pathname === '/rest/v1/dealer_invoices' && m === 'PATCH'){
      const id = u.searchParams.get('id').replace(/^eq\./, ''), v = INVOICES.find(x => x.id === id);
      Object.assign(v, JSON.parse(req.postData())); calls.push('  invoice voided ' + id);
      return j([v]);
    }
    if(u.pathname === '/rest/v1/dealer_invoices')
      return j(INVOICES.filter(v => !v.voided_at && ('eq.' + v.order_id) === u.searchParams.get('order_id')));
    if(u.pathname === '/rest/v1/pallet_customs_docs') return j(ME.role === 'admin' ? CUSTOMS : []);
    if(u.pathname === '/rest/v1/pallet_orders' && m === 'DELETE'){
      const id = u.searchParams.get('order_id').replace(/^eq\./, '');
      const i = PALLET_ORDERS.findIndex(x => x.order_id === id), gone = PALLET_ORDERS.splice(i, 1)[0];
      CUSTOMS.filter(c => c.pallet_id === gone.pallet_id && !c.voided_at && c.order_ids.includes(id))
        .forEach(c => { c.voided_at = '2026-11-23T23:40:00Z'; });
      return route.fulfill({status:204, body:''});
    }
    if(u.pathname === '/functions/v1/customs-void-alert'){
      calls.push('  alert ' + req.postData());
      return MAIL_OK ? j({ok:true, sent:1}) : j({error:'Resend refused it'}, 502);
    }
    if(u.pathname === '/rest/v1/pallet_totals') return j(ME.role === 'admin' ? PALLETS : []);
    if(u.pathname === '/rest/v1/pallet_orders') return j(ME.role === 'admin' ? PALLET_ORDERS : []);
    if(u.pathname.startsWith('/storage/v1/object/sign/')) return j({signedURL:'/object/sign/x?token=t'});
    if(u.pathname.startsWith('/storage/v1/object/sign')) return j({});
    if(u.pathname.startsWith('/storage/v1/object/order-files/') && m === 'POST') return j({Key:'ok'});
    if(u.pathname === '/auth/v1/user') return j({id:ME.id});
    return j([]);
  });
  await page.route('https://baakegbtuygtldksmant.supabase.co/storage/v1/object/sign/x**',
    route => route.fulfill({status:200, contentType:'text/xml', body:'<xml>measurements</xml>'}));
  const signIn = async () => {
    await page.goto('http://localhost:8722/');
    await page.evaluate(id => localStorage.setItem('gidc:session', JSON.stringify(
      {access_token:'x', refresh_token:'y', user:{id, email:'a@gidc.ca'}})), ME.id);
    await page.goto('http://localhost:8722/');
    await page.waitForSelector('tr[data-open]');
  };
  const shot = async name => { if(process.env.SHOTS) await page.screenshot({path:path.join(process.env.SHOTS, name), fullPage:false}); };
  const list = () => page.$$eval('tr[data-open]', x => x.map(r => r.cells[r.querySelector('.tickcol') ? 1 : 0].innerText.trim() + ' / ' +
    r.cells[r.cells.length - 2].innerText.replace(/\s+/g, ' ').trim()).join('\n  '));
  const open = async id => { await page.click('tr[data-open="' + id + '"] td:nth-child(2)'); await page.waitForSelector('#app .cards'); };

  const where = () => page.evaluate(() => state.view + (state.order ? ':' + state.order.order_ref : '') +
    (state.view === 'packing' ? ':' + state.packing.pallet.name : '') + ' depth ' + ((history.state && history.state.gidc) || {}).depth);
  const settle = () => page.waitForTimeout(300);

  await signIn();
  console.log('build:', await page.evaluate(() => BUILD));
  console.log('start:', await where());
  // a filter on the list and a scroll down
  await page.evaluate(() => { state.q = 'SFD'; });
  await page.setViewportSize({width: 1200, height: 300});
  await page.evaluate(() => window.scrollTo(0, 120)); await settle();
  const y0 = await page.evaluate(() => window.scrollY);
  await page.$eval('tr[data-open="c1"] td:nth-child(2)', x => x.click()); await page.waitForSelector('#app .cards');
  console.log('opened:', await where(), '/ bar button:', await page.$eval('.barback', x => x.innerText));
  await page.click('.barback'); await page.waitForSelector('tr[data-open]'); await settle();
  console.log('Back button:', await where(), '/ scroll back to', y0, ':', await page.evaluate(() => window.scrollY));

  console.log('-- pallets, packing list, browser back twice');
  await page.click('[data-pallets]'); await settle();
  console.log('pallets:', await where());
  await page.evaluate(() => openPacking('P3')); await settle();
  console.log('toast:', await page.$eval('#toast', x => x.innerText));
  await page.waitForFunction(() => state.view === 'packing');
  console.log('packing:', await where());
  await page.goBack(); await settle();
  console.log('browser back:', await where());
  await page.goBack(); await settle();
  console.log('browser back:', await where());
  await page.goForward(); await settle();
  console.log('browser forward:', await where());
  console.log('-- Back to pallets from the packing list goes back, not forward');
  await page.evaluate(() => openPacking('P3')); await page.waitForFunction(() => state.view === 'packing');
  await page.click('[data-pallets]'); await settle();
  console.log('Back to pallets:', await where());
  await page.click('[data-back]'); await settle();
  console.log('All orders:', await where());
  console.log('-- order, browser back, forward');
  await open('i1');
  await page.goBack(); await settle(); console.log('browser back:', await where());
  await page.goForward(); await settle(); await page.waitForFunction(() => state.view === 'order');
  console.log('browser forward:', await where());
  console.log('door numbers on the order after forward:', await page.evaluate(() => state.order.form.rows.map(r => r.opening).join(',')));
  console.log('ERRORS:', errs);
  await b.close(); process.exit(0);
})();

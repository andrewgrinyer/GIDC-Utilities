// Splitting an order into parts on the dealer portal, against a fake
// Supabase whose gidc_split_order does what sql/dealer-split-order.sql
// does. Nothing leaves the machine.
//
//   node tests/split-order.js
//   (or PLAYWRIGHT=/path/to/playwright node tests/split-order.js)
//
// An administrator opens the Cortes order (four openings, linked to Access
// job 4273), splits off the pantry and the laundry, and the list shows
// Part 1 and Part 2 with the red manual ship date line on Part 2 only.
// Then: the Proliner files copied, a shipped order with no button, an
// invoiced order refused, a dealer who sees both parts and never the red
// line. Ends with ERRORS: [] when no page threw. SHOTS=dir saves pictures.

const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const path = require('path'), fs = require('fs'), http = require('http');
const ROOT = path.join(__dirname, '..');
http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]); if(p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, 'dealer-portal', p);
  if(!fs.existsSync(f)){ r.statusCode = 404; return r.end('nf'); }
  r.setHeader('Content-Type', 'text/html'); r.end(fs.readFileSync(f));
}).listen(8721);

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
    await page.goto('http://localhost:8721/');
    await page.evaluate(id => localStorage.setItem('gidc:session', JSON.stringify(
      {access_token:'x', refresh_token:'y', user:{id, email:'a@gidc.ca'}})), ME.id);
    await page.goto('http://localhost:8721/');
    await page.waitForSelector('tr[data-open]');
  };
  const shot = async name => { if(process.env.SHOTS) await page.screenshot({path:path.join(process.env.SHOTS, name), fullPage:false}); };
  const list = () => page.$$eval('tr[data-open]', x => x.map(r => r.cells[r.querySelector('.tickcol') ? 1 : 0].innerText.trim() + ' / ' +
    r.cells[r.cells.length - 2].innerText.replace(/\s+/g, ' ').trim()).join('\n  '));
  const open = async id => { await page.click('tr[data-open="' + id + '"] td:nth-child(2)'); await page.waitForSelector('#app .cards'); };

  await signIn();
  console.log('build:', await page.evaluate(() => BUILD));
  await open('s1');
  console.log('shipped order has a split button:', !!(await page.$('[data-splitask]')));
  await page.click('[data-back]').catch(() => page.evaluate(() => { state.view = 'list'; render(); }));
  await page.waitForSelector('tr[data-open]');

  await open('c1');
  console.log('Cortes has a split button:', !!(await page.$('[data-splitask]')));
  await page.click('[data-splitask]'); await page.waitForSelector('[data-splitpick]');
  const goOff = () => page.$eval('[data-split="go"]', x => x.disabled + ' ' + (x.title || ''));
  console.log('nothing ticked, button:', await goOff());
  await page.click('label:has([data-splitpick="r3"])'); await page.click('label:has([data-splitpick="r4"])');
  console.log('panel:', (await page.$eval('.redo-card', x => x.innerText)).replace(/\s+/g, ' '));
  console.log('two ticked, button:', await goOff());
  await shot('split-panel.png');
  await page.click('[data-split="go"]');
  await page.waitForSelector('.noticebar');
  console.log('notice:', await page.$eval('.noticebar', x => x.innerText.replace(/\s+/g, ' ')));
  console.log('Part 1 openings now:', await page.evaluate(() => state.order.form.rows.map(r => r.opening).join(',')),
              '/ red line on Part 1:', !!(await page.$('.manual-ship')));
  const p2 = ORDERS.find(o => o.order_ref.endsWith('Part 2'));
  console.log('Part 2 files:', p2.files.map(f => f.kind + ':' + f.name).join(', '));
  await page.evaluate(() => { state.view = 'list'; state.notice = null; render(); });
  await page.waitForSelector('tr[data-open]');
  console.log('list (name / ship):\n  ' + await list());
  await shot('split-list-admin.png');
  await open(p2.id);
  console.log('Part 2 admin panel red line:', await page.$eval('.manual-ship', x => x.innerText + ' ' + getComputedStyle(x).color).catch(() => 'none'));
  await shot('split-part2-admin.png');

  console.log('-- Part 2 linked to its own Access job: the red line goes');
  p2.access_order_id = 7103; p2.access_order_no = '7101';
  await page.evaluate(() => { state.view = 'list'; render(); }); await page.reload(); await page.waitForSelector('tr[data-open]');
  console.log('red lines on the list:', (await page.$$('.manual-ship')).length);
  p2.access_order_id = null; p2.access_order_no = null;

  console.log('Part 1 door numbers:', ORDERS.find(o => o.id === 'c1').form.rows.map(r => r.opening).join(','),
              '/ Part 2:', p2.form.rows.map(r => r.opening).join(','));

  console.log('-- inside an opening: Shah, typed by hand. Door 1 whole, 2A of a double swing, 3 c/d of a double bifold');
  ORDERS.push({id:'h1', dealer_id:'D1', order_ref:'SFD SHAH 7', customer_name:'SFDS', status:'doors_ordered',
    door_count:7, panel_count:9, created_at:'2026-11-07T14:00:00Z', files:[], form:{rows:[
      Object.assign(row('h1a','','Front entry','Single Swing','Kingston','32','80'), {qty:1}),
      Object.assign(row('h1b','','Living room','Double Swing AST','Kingston','30','80'), {qty:2}),
      Object.assign(row('h1c','','Hall closet','Double Bifold','Kingston','72','80'), {qty:2}),
      Object.assign(row('h1d','','Bedroom closet','Bypass','Kingston','60','80'), {qty:2})]}});
  await page.evaluate(() => { state.view = 'list'; render(); }); await page.reload(); await page.waitForSelector('tr[data-open]');
  await open('h1'); await page.click('[data-splitask]'); await page.waitForSelector('[data-splitpick]');
  console.log('lines:', (await page.$$eval('.redo-card .split-n', x => x.map(e => e.innerText))).join(' | '));
  await page.click('label:has([data-splitpick="h1a"])');
  await page.click('label:has([data-splitleaf="h1b|0"])');
  await page.click('label:has([data-splitleaf="h1c|1"])');
  console.log('count:', await page.$eval('.redo-card .muted', x => x.innerText));
  await shot('split-inside-opening.png');
  await page.click('[data-split="go"]'); await page.waitForSelector('.noticebar');
  const show = o => o.form.rows.map(r => r.opening + (r.leaves ? '[' + r.leaves.join(',') + ']' : '') + ' q' + (r.qty || 1) + ' w' + r.width).join('  ');
  const h2 = ORDERS.find(o => o.order_ref === 'SFD SHAH 7 Part 2');
  console.log('Part 1:', show(ORDERS.find(o => o.id === 'h1')));
  console.log('Part 2:', show(h2));
  console.log('Part 1 grid door numbers:', (await page.$$eval('#app table tbody tr td.mono', x => x.map(e => e.innerText))).join(' '));
  console.log('Part 1 red checks:', JSON.stringify(await page.evaluate(() => state.order.form.rows.map(r => r.opening + (r.leaves || '') + ': ' + checks(r).flags.filter(f => f.bad).map(f => f.text).join('; ')))));
  const pk = await page.evaluate(id => packPanels(state.order.form.rows[1], state.order, 1).map(p => p.openLabel).join(',') + ' / ' +
    packPanels(state.order.form.rows[2], state.order, 2).map(p => p.openLabel + ' ' + p.width).join(','), 'h1');
  console.log('packing labels on Part 1:', pk);

  console.log('-- an invoiced order');
  await page.reload(); await page.waitForSelector('tr[data-open]');
  await open('i1'); await page.click('[data-splitask]'); await page.waitForSelector('[data-splitpick]');
  await page.click('label:has([data-splitpick="m2"])');
  console.log('invoiced, button:', await goOff(), '/', await page.$eval('.redo-card', x => x.innerText.match(/This order has QuickBooks invoice[^.]*\./)[0]));
  await page.click('[data-splitvoid="ask"]');
  await shot('split-void-invoice.png');
  await page.click('[data-splitvoid="yes"]');
  await page.waitForFunction(() => !document.querySelector('[data-splitvoid]'));
  console.log('after void, button:', await goOff(), ' ticks kept:', await page.$$eval('[data-splitpick]:checked', x => x.length));
  console.log('void toast:', await page.$eval('#toast', x => x.innerText).catch(() => '(no toast)'));
  console.log('calls:', calls.filter(c => /invoice voided|alert/.test(c)).slice(-2).join(' | '));
  await page.click('[data-split="no"]');

  console.log('-- an order on a pallet');
  await page.reload(); await page.waitForSelector('tr[data-open]');
  await open('l1'); await page.click('[data-splitask]'); await page.waitForSelector('[data-splitpick]');
  await page.click('label:has([data-splitpick="l1b"])');
  console.log('on a pallet, button:', await goOff(), '/', await page.$eval('.redo-card', x => x.innerText.match(/This order is on pallet[^]*?include this order\./)[0].replace(/\s+/g, ' ')));
  await shot('split-on-pallet.png');
  await page.click('[data-split="no"]');

  console.log('-- taking Lee off pallet SFD 3, whose commercial invoice covers it');
  await page.evaluate(() => { state.view = 'list'; render(); });
  await page.click('[data-pallets]'); await page.waitForSelector('[data-palopen="P3"]');
  console.log('pallet chip before:', await page.$eval('[data-palopen="P3"] .nm', x => x.innerText.replace(/\s+/g, ' ')));
  await page.click('[data-palopen="P3"]'); await page.click('[data-palrm="l1"]');
  await page.waitForSelector('.sure-big');
  console.log('warning:', (await page.$eval('.sure-big', x => x.innerText)).replace(/\s+/g, ' '));
  await shot('void-warning.png');
  await page.click('[data-sure="yes"]');
  await page.waitForSelector('.noticebar');
  console.log('after:', await page.$eval('.noticebar', x => x.innerText.replace(/\s+/g, ' ')));
  console.log('pallet chip after:', await page.$eval('[data-palopen="P3"] .nm', x => x.innerText.replace(/\s+/g, ' ')));
  await shot('void-done.png');
  console.log('-- the same when the email will not send');
  MAIL_OK = false; PALLET_ORDERS.push({order_id:'l1', pallet_id:'P3', position:1}); CUSTOMS[0].voided_at = null;
  await page.reload(); await page.waitForSelector('tr[data-open]');
  await page.click('[data-pallets]'); await page.click('[data-palopen="P3"]'); await page.click('[data-palrm="l1"]');
  await page.waitForSelector('.sure-big'); await page.click('[data-sure="yes"]'); await page.waitForSelector('.noticebar');
  console.log('after:', await page.$eval('.noticebar', x => x.innerText.replace(/\s+/g, ' ')));
  console.log('-- an order whose pallet papers do not include it gets the ordinary question');
  CUSTOMS[0].voided_at = null; CUSTOMS[0].order_ids = ['x9']; PALLET_ORDERS.push({order_id:'l1', pallet_id:'P3', position:1});
  await page.reload(); await page.waitForSelector('tr[data-open]');
  await page.click('[data-pallets]'); await page.click('[data-palopen="P3"]'); await page.click('[data-palrm="l1"]');
  await page.waitForSelector('.sure-card');
  console.log('big:', !!(await page.$('.sure-big')), '/', (await page.$eval('.sure-card', x => x.innerText)).replace(/\s+/g, ' '));
  await page.click('[data-sure="no"]');

  console.log('-- a dealer');
  ME = {id:'d1', name:'Dealer', role:'dealer', dealer_id:'D1', active:true, email_verified_at:'2026-10-01'};
  await page.evaluate(() => { try{ clearPersonal(); }catch(e){} });
  await signIn();
  console.log('dealer list (name / ship):\n  ' + await list());
  console.log('red lines a dealer sees:', (await page.$$('.manual-ship')).length,
              '/ text in page:', (await page.content()).includes('manual entry') ? 'only in the script' : 'no');
  await open(p2.id);
  console.log('dealer on Part 2: split button', !!(await page.$('[data-splitask]')), '/ red line', !!(await page.$('.manual-ship')));
  await shot('split-list-dealer.png');

  console.log('calls:\n  ' + calls.filter(c => /split|patched|alert|DELETE/.test(c)).join('\n  '));
  console.log('ERRORS:', errs);
  await b.close(); process.exit(0);
})();

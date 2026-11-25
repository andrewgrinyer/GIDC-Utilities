// Portal 2.24: moving doors between the parts of a split order, against a
// fake Supabase whose gidc_move_split_doors does what
// sql/dealer-split-move.sql does. Nothing leaves the machine.
//
//   node tests/split-move.js       (SHOTS=dir saves pictures)
//
// Benech in three parts plus a shipped Part 4. 6A goes from Part 2 back to
// Part 1 and joins 6P again, Part 3's last door goes back to Part 1 and
// Part 3 is deleted, Part 1 cannot be emptied, an invoiced or palleted
// part cannot take doors, a shipped part is not offered, a dealer sees no
// button. Door numbers are printed before and after. Ends with ERRORS: [].

const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const path = require('path'), fs = require('fs'), http = require('http');
const ROOT = path.join(__dirname, '..');
http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]); if(p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, 'dealer-portal', p);
  if(!fs.existsSync(f)){ r.statusCode = 404; return r.end('nf'); }
  r.setHeader('Content-Type', 'text/html'); r.end(fs.readFileSync(f));
}).listen(8723);

const row = (id, opening, location, doorType, w, extra) =>
  Object.assign({id, opening, location, doorType, style:'Kingston', width:w, height:'80', paintColour:'Pearly'}, extra || {});
const part = (id, n, status, rows, more) => Object.assign({id, dealer_id:'D1', order_ref:'SFD BENECH 41 Part ' + n,
  customer_name:'SFDB', status, split_of: n === 1 ? null : 'p1', split_part:n, door_count:0, panel_count:0,
  created_at:'2026-11-2' + n + 'T14:00:00Z', files: n === 3 ? [{kind:'proliner', name:'b.xml', path:'D1/p3/b.xml'}] : [],
  form:{rows, lastDoorNo:9}}, more || {});
let ORDERS = [
  part('p1', 1, 'in_production', [row('b1','1','Hall','Single Swing','30'), row('b2','2','Bed 1','Single Swing','30'),
    row('b6','6','Living','Double Swing AST','30', {qty:1, leaves:['P']}),
    row('b7','7','Closet','Double Bifold','36', {qty:1, leaves:['a/b']})], {access_order_id:4275, access_order_no:'4273'}),
  part('p2', 2, 'doors_ordered', [row('b4','4','Bath','Single Swing','28'),
    row('b6-p2','6','Living','Double Swing AST','30', {qty:1, leaves:['A']})]),
  part('p3', 3, 'doors_ordered', [row('b7-p3','7','Closet','Double Bifold','36', {qty:1, leaves:['c/d']})]),
  part('p4', 4, 'shipped', [row('b9','9','Garage','Single Swing','32')])];
const PALLET_ORDERS = [];
const INVOICES = [];
let ME = {id:'a1', name:'Admin', role:'admin', active:true, email_verified_at:'2026-10-01'};
const calls = [];

/* what sql/dealer-split-move.sql does, in short */
function moveDoors(b){
  const f = ORDERS.find(x => x.id === b.p_from), t = ORDERS.find(x => x.id === b.p_to);
  if(ME.role !== 'admin') return [400, {message:'Only Grinyer can move doors between parts.'}];
  for(const o of [f, t]){
    if(o.status === 'shipped') return [400, {message:o.order_ref + ' has shipped, so no doors can move on or off it.'}];
    if(PALLET_ORDERS.some(x => x.order_id === o.id)) return [400, {message:o.order_ref + ' is on a pallet. Take it off the pallet first, then move the doors.'}];
    if(INVOICES.some(v => v.order_id === o.id && !v.voided_at)) return [400, {message:o.order_ref + ' has been invoiced. Void its invoice first, then move the doors.'}];
  }
  const L = b.p_leaves || {}, pick = k => ['qty','leaves','width'].reduce((a, x) => (k[x] !== undefined ? (a[x] = k[x], a) : a), {});
  const keep = f.form.rows.filter(x => !b.p_rows.includes(x.id)).map(x => L[x.id] ? Object.assign({}, x, pick(L[x.id].keep)) : x);
  const move = f.form.rows.filter(x => b.p_rows.includes(x.id) || L[x.id])
    .map(x => L[x.id] ? Object.assign({}, x, pick(L[x.id].move), {id: x.id + '-p' + t.split_part}) : x);
  if(!keep.length && !f.split_of) return [400, {message:'Part 1 keeps at least one door, because the other parts hang from it.'}];
  const base = id => id.replace(/(-p\d+)+$/, ''), out = t.form.rows.slice();
  for(const m of move){
    const i = out.findIndex(r => r.opening === m.opening && base(r.id) === base(m.id) && Array.isArray(r.leaves) && Array.isArray(m.leaves));
    if(i < 0){ out.push(m); continue; }
    const r = Object.assign({}, out[i], {qty:(+out[i].qty || 1) + (+m.qty || 1), leaves:out[i].leaves.concat(m.leaves).sort()});
    if((b.p_shared || []).includes(m.id) || (b.p_shared || []).includes(m.id.replace(/-p\d+$/, ''))) r.width = String(+out[i].width + +m.width);
    out[i] = r;
  }
  out.sort((a, c) => (+a.opening) - (+c.opening));
  t.form = Object.assign({}, t.form, {rows:out}); t.door_count = b.p_to_counts.door_count;
  let gone = false;
  if(!keep.length){ ORDERS = ORDERS.filter(x => x !== f); gone = true; }
  else { f.form = Object.assign({}, f.form, {rows:keep}); f.door_count = b.p_from_counts.door_count; }
  return [200, {from_ref:f.order_ref, to_ref:t.order_ref, to_id:t.id, moved:move.length, kept:keep.length, deleted:gone}];
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
      return j(id ? mine.filter(o => o.id === id) : mine.slice().sort((a, c) => c.created_at < a.created_at ? -1 : 1));
    }
    if(u.pathname === '/rest/v1/rpc/gidc_move_split_doors'){
      calls.push('  move ' + req.postData());
      const [s, x] = moveDoors(JSON.parse(req.postData())); return j(x, s);
    }
    if(u.pathname === '/rest/v1/dealer_invoices' && m === 'PATCH'){
      const id = u.searchParams.get('id').replace(/^eq\./, ''), v = INVOICES.find(x => x.id === id);
      Object.assign(v, JSON.parse(req.postData())); calls.push('  invoice voided ' + id);
      return j([v]);
    }
    if(u.pathname === '/rest/v1/dealer_invoices')
      return j(INVOICES.filter(v => !v.voided_at && ('eq.' + v.order_id) === u.searchParams.get('order_id')));
    if(u.pathname === '/functions/v1/customs-void-alert'){ calls.push('  alert ' + req.postData()); return j({ok:true, sent:1}); }
    if(u.pathname === '/rest/v1/pallet_totals') return j(ME.role === 'admin' ? [{id:'P3', name:'SFD 3', dealer:'South Florida'}] : []);
    if(u.pathname === '/rest/v1/pallet_orders') return j(ME.role === 'admin' ? PALLET_ORDERS : []);
    if(u.pathname.startsWith('/storage/v1/object/order-files/') && m === 'DELETE'){ calls.push('  file removed ' + u.pathname); return j({}); }
    if(u.pathname === '/auth/v1/user') return j({id:ME.id});
    return j([]);
  });
  const signIn = async () => {
    await page.goto('http://localhost:8723/');
    await page.evaluate(id => localStorage.setItem('gidc:session', JSON.stringify(
      {access_token:'x', refresh_token:'y', user:{id, email:'a@gidc.ca'}})), ME.id);
    await page.goto('http://localhost:8723/');
    await page.waitForSelector('tr[data-open]');
  };
  const shot = async name => { if(process.env.SHOTS) await page.screenshot({path:path.join(process.env.SHOTS, name), fullPage:false}); };
  const open = async id => { await page.click('tr[data-open="' + id + '"] td:nth-child(2)'); await page.waitForSelector('#app .cards'); };
  const toList = async () => { await page.evaluate(() => { state.view = 'list'; state.notice = null; render(); }); await page.waitForSelector('tr[data-open]'); };
  const goOff = () => page.$eval('[data-split="go"]', x => (x.disabled ? 'disabled ' + x.title : 'ready') + ' / "' + x.innerText + '"');
  const show = () => ORDERS.map(o => o.order_ref.replace('SFD BENECH 41 ', '') + ': ' +
    o.form.rows.map(r => r.opening + (r.leaves ? r.leaves.join('') : '') + (r.doorType === 'Double Bifold' ? ' w' + r.width : '')).join(' ')).join('  |  ');

  await signIn();
  console.log('build:', await page.evaluate(() => BUILD));
  console.log('before:', show());

  console.log('-- Part 2: 6A goes back to Part 1');
  await open('p2');
  console.log('button:', await page.$eval('[data-splitask]', x => x.innerText));
  await page.click('[data-splitask]'); await page.waitForSelector('[data-splitpick]');
  console.log('choices:', (await page.$eval('.split-to', x => x.innerText)).replace(/\s+/g, ' '),
              '/ shipped Part 4 disabled:', await page.$eval('[data-splitto="p4"]', x => x.disabled));
  await page.click('label:has([data-splitto="p1"])');
  await page.click('label:has([data-splitpick="b6-p2"])');
  console.log('panel:', (await page.$eval('.redo-card', x => x.innerText)).replace(/\s+/g, ' '));
  console.log('go:', await goOff());
  await shot('move-panel.png');
  await page.click('[data-split="go"]'); await page.waitForSelector('.noticebar');
  console.log('notice:', await page.$eval('.noticebar', x => x.innerText.replace(/\s+/g, ' ')));
  console.log('after:', show());

  console.log('-- Part 1: every door ticked, to Part 2');
  await toList(); await open('p1');
  await page.click('[data-splitask]'); await page.waitForSelector('[data-splitpick]');
  await page.click('label:has([data-splitto="p2"])');
  for(const id of ['b1','b2','b6','b7']) await page.click('label:has([data-splitpick="' + id + '"])');
  console.log('go:', await goOff());
  await page.click('[data-split="no"]');

  console.log('-- Part 2 is invoiced and Part 3 is on a pallet: neither takes doors');
  INVOICES.push({id:'v9', order_id:'p2', invoice_no:'1050', voided_at:null});
  PALLET_ORDERS.push({order_id:'p3', pallet_id:'P3', position:1});
  await page.reload(); await page.waitForSelector('#app');
  await toList(); await open('p1');
  await page.click('[data-splitask]'); await page.waitForSelector('[data-splitpick]');
  await page.click('label:has([data-splitpick="b1"])');
  await page.click('label:has([data-splitto="p3"])');
  console.log('to Part 3:', await goOff(), '/', (await page.$eval('.redo-card', x => x.innerText.match(/Part 3 is on pallet[^]*?include it\./)[0])).replace(/\s+/g, ' '));
  await page.click('label:has([data-splitto="p2"])');
  console.log('to Part 2:', await goOff(), '/', (await page.$eval('.redo-card', x => x.innerText.match(/Part 2 has QuickBooks invoice[^.]*\./)[0])));
  await page.click('[data-splitvoid="ask"]'); await page.click('[data-splitvoid="yes"]');
  await page.waitForFunction(() => !document.querySelector('[data-splitvoid]'));
  console.log('after voiding 1050:', await goOff(), '/', calls.filter(c => /invoice voided|alert/.test(c)).join(' | '));
  await page.click('[data-split="no"]');
  PALLET_ORDERS.length = 0;

  console.log('-- Part 3 has one opening: its last door goes back to Part 1, Part 3 is deleted');
  await page.reload(); await page.waitForSelector('#app');
  await toList(); await open('p3');
  await page.click('[data-splitask]'); await page.waitForSelector('[data-splitpick]');
  console.log('picked by itself:', await page.$eval('[data-splitto]:checked', x => x.dataset.splitto),
              '/ new part offered:', !(await page.$eval('[data-splitto="new"]', x => x.disabled)));
  await page.click('label:has([data-splitpick="b7-p3"])');
  console.log('warning:', await page.$eval('.redo-card', x => (x.innerText.match(/Every door is ticked[^.]*\./) || ['none'])[0]));
  await shot('move-last-door.png');
  await page.click('[data-split="go"]'); await page.waitForSelector('.noticebar');
  console.log('notice:', await page.$eval('.noticebar', x => x.innerText.replace(/\s+/g, ' ')));
  console.log('now open:', await page.evaluate(() => state.order.order_ref));
  console.log('after:', show());
  await page.goBack(); await page.waitForTimeout(400);
  console.log('Back goes to:', await page.evaluate(() => state.view === 'order' ? state.order.order_ref : state.view));
  console.log('files removed:', calls.filter(c => /file removed/.test(c)).join(' | ') || 'none');

  console.log('-- a dealer');
  ME = {id:'d1', name:'Dealer', role:'dealer', dealer_id:'D1', active:true, email_verified_at:'2026-10-01'};
  await page.evaluate(() => { try{ clearPersonal(); }catch(e){} });
  await signIn(); await open('p2');
  console.log('dealer on Part 2: button', !!(await page.$('[data-splitask]')));

  console.log('calls:\n  ' + calls.filter(c => /move |voided|alert/.test(c)).join('\n  '));
  console.log('ERRORS:', errs);
  await b.close(); process.exit(0);
})();

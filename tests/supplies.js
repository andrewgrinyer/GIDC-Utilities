// Clicks through Order Supplies (the menu and Shop Supplies) on the tools
// site against a fake Supabase, with the clock held at Friday 20 November
// 2026. Nothing leaves the machine.
//
//   node tests/supplies.js            (SHOTS=/some/dir to save screenshots)
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
  r.setHeader('Content-Type', f.endsWith('.js') ? 'text/javascript' : 'text/html'); r.end(fs.readFileSync(f));
}).listen(port, ok)); }

const PULLED = '2026-11-20T15:57:00Z';
const S = (id, no, job, uses, day, cuts, amount) =>
  ({access_order_id:id, uses, order_no:no, job, need_on:day, amount:String(amount != null ? amount : cuts.reduce((a, b) => a + b, 0)),
    cuts, pulled_at:PULLED});
const SCHED = [
  S(5069, '5067', 'Aris',   'pine',          '2026-11-19', [72, 4, 4]),
  S(5070, '5068', 'Cortes', 'rerail',        '2026-11-24', [33, 33, 30, 30, 30]),
  S(5071, '5069', 'Hill',   'valance_small', '2026-11-25', [70, 70, 70]),
  S(5071, '5069', 'Hill',   'pine',          '2026-11-25', [70, 70, 70]),
  S(5071, '5069', 'Hill',   'doors',         '2026-11-25', [], 6),
  S(5072, '5070', 'Big',    'valance_large', '2026-12-10', [100]),
  Object.assign(S(5073, '5071', 'Swing', 'hinge', '2026-11-26', [], 12), {spec:'size=3.5; corner=1/4 radius; finish=Satin Nickel'}),
  Object.assign(S(5073, '5071', 'Swing', 'hinge', '2026-11-26', [], 4), {spec:'size=4; corner=square; finish=Black'}),
  Object.assign(S(5074, '5072', 'Slide', 'track', '2026-11-27', [], 2), {spec:'length=60'}),
  Object.assign(S(5074, '5072', 'Slide', 'finger_pull', '2026-11-27', [], 4), {spec:'shape=round; finish=Satin Nickel'}),
];
const DOORS = [{id:'d1', style:'Shaker', width_in:30, height_in:80, core:'Hollow', qty:2, unit_value:'85.00'},
               {id:'d2', style:'Flat', width_in:24, height_in:null, core:null, qty:1, unit_value:null}];
const PAINT = [{name:'Primer', kind:'primer', doors_per_pail:50, warn_gallons:'10', price_per_gallon:'40.0000', sort:0},
               {name:'Extra White', kind:'stock', doors_per_pail:35, warn_gallons:'5', price_per_gallon:null, sort:10},
               {name:'Custom', kind:'custom', doors_per_pail:35, warn_gallons:null, price_per_gallon:null, sort:90}];
let CATS, SUPPLIERS, ITEMS, COUNTS, ORDERS, PALLETS, AHEAD, n = 0, ROLE = 'manufacturing', MAIL_OK = true;
const posted = [];
function reset(){
  CATS = [{code:'shop', name:'Shop Supplies', po_prefix:'SHP', copy_to:'ashley@grinyer.ca', sort:10},
          {code:'painting', name:'Painting Supplies', po_prefix:'PNT', copy_to:'ashley@grinyer.ca', sort:5},
          {code:'hardware', name:'Hardware', po_prefix:'HDW', copy_to:'ashley@grinyer.ca', sort:15},
          {code:'sanding', name:'Sanding Supplies', po_prefix:'SND', copy_to:'ashley@grinyer.ca', sort:20},
          {code:'install', name:'Install Supplies', po_prefix:'INST', copy_to:'ashley@grinyer.ca', sort:30},
          {code:'packaging', name:'Packaging Materials', po_prefix:'PKG', copy_to:'ashley@grinyer.ca', sort:40}];
  SUPPLIERS = [{id:'s1', name:'Lumber Yard', email:'orders@lumber.ca', note:null},
               {id:'s2', name:'Valance Co', email:null, note:null}];
  const I = (id, name, uses, per, warn, std, sup, sitem, sort) =>
    ({id, category:'shop', shop_name:name, supplier_item:sitem || null, supplier_id:sup, unit:'piece', uses, per_unit:per == null ? null : String(per),
      waste_pct:uses ? '10.0' : '0.0', warn_qty:String(warn), standard_order:String(std), sort});
  ITEMS = [I('i1', "Pine 3.5 x .75 x 16' Primed", 'pine', 192, 10, 20, 's1', '1x4 primed 16ft', 10),
           I('i2', "ReRail 1 1/8 x 1 1/8 Pine x 12'", 'rerail', 144, 5, 10, 's1', null, 20),
           I('i3', 'Small Valance', 'valance_small', 192, 4, 6, 's2', null, 30),
           I('i4', 'Large Valance', 'valance_large', 192, 2, 4, 's2', null, 40),
           I('i5', 'Oversize Valance', null, null, 1, 2, null, null, 50)];
  const H = (id, name, uses, spec, per, unit, sup, sort) =>
    ({id, category:'hardware', shop_name:name, supplier_item:null, supplier_id:sup, unit, uses, spec, per_unit:String(per),
      waste_pct:'0.0', warn_qty:'0', standard_order:'0', sort});
  ITEMS.push(H('h1', 'Hinge 3.5" 1/4 radius Satin Nickel', 'hinge', 'size=3.5; corner=1/4 radius; finish=Satin Nickel', 1, 'hinge', 's3', 101),
             H('h2', 'Hinge 4" square Black', 'hinge', 'size=4; corner=square; finish=Black', 1, 'hinge', 's3', 102),
             H('h3', 'Hinge 3" square Chrome', 'hinge', 'size=3; corner=square; finish=Chrome', 1, 'hinge', 's3', 103),
             H('h4', 'Bypass track 60"', 'track', 'length=60', 1, 'track', 's1', 202),
             H('h5', 'Finger pull round Satin Nickel', 'finger_pull', 'shape=round; finish=Satin Nickel', 2, 'pair', 's3', 401));
  SUPPLIERS.push({id:'s3', name:'Onward', email:null, note:'Orders through the Onward portal. POs go to Ashley to place.'});
  // Packaging Materials (Andrew, 27 November), as supplies.sql seeds it
  SUPPLIERS.push({id:'s4', name:'Uline', email:null, note:'Ashley places these orders.'},
                 {id:'s5', name:'Grand River Pallets', email:null, note:'Ashley places these orders.'});
  const K = (id, name, sitem, unit, uses, per, step, pack, std, sup, sort, price) =>
    ({id, category:'packaging', shop_name:name, supplier_item:sitem, supplier_id:sup, unit, uses, spec:'', per_unit:per == null ? null : String(per),
      waste_pct:'0.0', warn_qty:'0', standard_order:std == null ? null : String(std), order_step:step == null ? null : String(step),
      pack_name:pack, price:price == null ? null : String(price), sort});
  ITEMS.push(K('k1', 'Shipping pallet 99 x 40', '99" x 40" new block pallet, solid top', 'pallet', 'pallet', 1, null, null, null, 's5', 10),
             K('k2', 'Door foam', 'S-1098 Foam roll', 'roll', 'door_foam', 15000, 2, 'bundle', 2, 's4', 20, 182),
             K('k3', 'Corner protectors', 'S-14337 Heavy duty edge protectors', 'piece', 'pallet', 4, 30, 'carton', 30, 's4', 30, 4.27),
             K('k4', 'Strap guards', 'S-765 Strap guards', 'piece', 'pallet', 10, 1000, 'carton', 1000, 's4', 40, 0.147),
             K('k5', 'No Stack cones', 'S-22361 No Stack pallet cones', 'piece', 'pallet', 2, 50, 'bundle', 50, 's4', 50),
             K('k6', 'Stretch wrap', 'S-2187 Stretch wrap', 'roll', 'pallet', 0.1333, 4, 'case', 4, 's4', 60),
             K('k7', 'Packing tape', 'S-200 Uline industrial tape', 'roll', 'pallet', 0.303, 36, 'case', 36, 's4', 70));
  COUNTS = [{id:'c1', item_id:'i1', qty:'30.00', counted_on:'2026-11-17', created_at:'2026-11-17T22:00:00Z', created_by:'Nick'},
            {id:'c2', item_id:'i2', qty:'3.00', counted_on:'2026-11-18', created_at:'2026-11-18T22:00:00Z', created_by:'Nick'},
            {id:'c3', item_id:'i3', qty:'5.00', counted_on:'2026-11-18', created_at:'2026-11-18T22:00:00Z', created_by:'Nick'},
            {id:'c4', item_id:'i5', qty:'0.00', counted_on:'2026-11-18', created_at:'2026-11-18T22:00:00Z', created_by:'Nick'},
            {id:'c5', item_id:'k3', qty:'20.00', counted_on:'2026-11-10', created_at:'2026-11-10T22:00:00Z', created_by:'Nick'},
            {id:'c6', item_id:'k2', qty:'2.00', counted_on:'2026-11-10', created_at:'2026-11-10T22:00:00Z', created_by:'Nick'}];
  // pallets from the dealer portal: two since the counts, one long before
  PALLETS = [{pallet_id:'p0', name:'Old', day:'2026-10-01', doors:5, foam_in:500},
             {pallet_id:'p1', name:'SFD 1', day:'2026-11-12', doors:10, foam_in:9200},
             {pallet_id:'p2', name:'Chicago 3', day:'2026-11-18', doors:6, foam_in:5800}];
  // dealer orders not on a pallet yet, by Access Packaging Date: Pittsburgh
  // has 22 doors overdue (one pallet today) and 3 more on Dec 10 (under 20,
  // still one more pallet); South Florida 50 on Nov 30 (two pallets, 45 most)
  AHEAD = [{dealer_id:'d1', pack_on:'2026-11-18', orders:1, doors:22, foam_in:2024},
           {dealer_id:'d2', pack_on:'2026-11-30', orders:2, doors:50, foam_in:4600},
           {dealer_id:'d1', pack_on:'2026-12-10', orders:1, doors:3, foam_in:276}];
  ORDERS = [{id:'00000000-0000-0000-0000-00000000000a', category:'shop', po_no:'SHP00001', supplier_id:'s1', supplier_name:'Lumber Yard',
             needed_by:null, note:null, status:'requested', requested_at:'2026-11-18T15:00:00Z', requested_by:'Andrew',
             sent_to:'orders@lumber.ca', copied_to:'ashley@grinyer.ca', emailed_at:'2026-11-18T15:00:01Z', received_on:null,
             supply_order_lines:[{id:'l1', item_id:'i1', shop_name:"Pine 3.5 x .75 x 16' Primed", supplier_item:'1x4 primed 16ft', unit:'piece', qty:'20.00'}]}];
}
const eqv = (u, k) => decodeURIComponent((u.searchParams.get(k) || '').replace(/^eq\./, ''));
async function mock(page){
  await page.route('https://baakegbtuygtldksmant.supabase.co/**', async route => {
    const req = route.request(), u = new URL(req.url()), p = u.pathname, m = req.method();
    const j = (b, s) => route.fulfill({status:s || 200, contentType:'application/json', body:JSON.stringify(b)});
    const body = req.postData() ? JSON.parse(req.postData()) : {};
    const wantRows = /return=representation/.test(req.headers()['prefer'] || '');
    const jw = (b, st) => wantRows ? j(b, st) : route.fulfill({status: st === 201 ? 201 : 204, body: ''});
    const ok = ROLE === 'admin' || ROLE === 'manufacturing';
    if(p === '/auth/v1/token') return j({access_token:'x2', refresh_token:'y2', user:{id:'a1', email:'a@g.ca'}});
    if(p === '/rest/v1/profiles') return j([{id:'a1', name:'Nick', role:ROLE, active:true, email_verified_at:'2026-10-24'}]);
    if(p === '/auth/v1/user') return j({id:'a1'});
    if(!ok && p.startsWith('/rest/v1/supply')) return j([]);
    if(p === '/rest/v1/supply_categories'){
      if(m === 'PATCH'){ const c = CATS.find(x => x.code === eqv(u, 'code')); c.copy_to = body.copy_to; posted.push(['copy', body]); return jw([c]); }
      if(!u.searchParams.get('code')) return j(CATS.slice().sort((a, b) => a.sort - b.sort));
      return j(CATS.filter(c => c.code === eqv(u, 'code')));
    }
    // the Inventory Value screen reads doors itself and paint through the paint page
    if(p === '/rest/v1/door_inventory') return j(DOORS);
    if(p === '/rest/v1/paint_colours') return j(PAINT);
    if(p === '/rest/v1/paint_counts') return j([{id:'pc1', colour:'Primer', gallons:'20.00', counted_on:'2026-11-19', created_at:'2026-11-19T22:00:00Z', created_by:'Nick'}]);
    if(p.startsWith('/rest/v1/paint_')) return j([]);
    if(p === '/rest/v1/supply_suppliers'){
      if(m === 'POST'){
        if(SUPPLIERS.some(s => s.name.toLowerCase() === body.name.toLowerCase())) return j({message:'duplicate key value violates unique constraint "supply_suppliers_same_name"'}, 409);
        const row = Object.assign({id:'s' + (++n + 10)}, body); SUPPLIERS.push(row); posted.push(['supplier', body]); return jw([row], 201);
      }
      if(m === 'PATCH'){ const s = SUPPLIERS.find(x => x.id === eqv(u, 'id')); Object.assign(s, body); posted.push(['supplieredit', body]); return jw([s]); }
      if(m === 'DELETE'){ const i = SUPPLIERS.findIndex(x => x.id === eqv(u, 'id')); const gone = SUPPLIERS.splice(i, 1);
        ITEMS.forEach(it => { if(it.supplier_id === gone[0].id) it.supplier_id = null; }); return jw(gone); }
      return j(SUPPLIERS);
    }
    if(p === '/rest/v1/supply_items'){
      if(m === 'POST'){ const row = Object.assign({id:'i' + (++n + 10)}, body); ITEMS.push(row); posted.push(['item', body]); return jw([row], 201); }
      if(m === 'PATCH'){ const it = ITEMS.find(x => x.id === eqv(u, 'id')); Object.assign(it, body); posted.push(['itemedit', body]); return jw([it]); }
      if(m === 'DELETE'){ const i = ITEMS.findIndex(x => x.id === eqv(u, 'id')); const gone = ITEMS.splice(i, 1);
        COUNTS = COUNTS.filter(c => c.item_id !== gone[0].id); posted.push(['itemgone', gone[0].id]); return jw(gone); }
      return j(ITEMS.filter(it => it.category === eqv(u, 'category')));
    }
    if(p === '/rest/v1/supply_counts'){
      if(m === 'POST'){ const row = Object.assign({id:'n' + (++n), created_at:'2026-11-20T16:00:00Z', created_by:'Nick'}, body); COUNTS.unshift(row); posted.push(['count', body]); return jw([row], 201); }
      if(m === 'DELETE'){ const i = COUNTS.findIndex(x => x.id === eqv(u, 'id')); return jw(COUNTS.splice(i, 1)); }
      return j(COUNTS);
    }
    if(p === '/rest/v1/rpc/supply_pallet_use'){ posted.push(['pallets', body]); return j(PALLETS); }
    if(p === '/rest/v1/rpc/supply_pallet_ahead'){ posted.push(['ahead', body]); return j(AHEAD); }
    if(p === '/rest/v1/supply_receipts'){
      const lineOf = id => { for(const o of ORDERS) for(const l of (o.supply_order_lines || [])) if(l.id === id) return [o, l]; return []; };
      if(m === 'POST'){
        const [o, l] = lineOf(body.line_id); l.supply_receipts = l.supply_receipts || [];
        const got = l.supply_receipts.reduce((a, r) => a + Number(r.qty), 0);
        if(body.qty > Number(l.qty) - got) return j({message:'Only ' + (Number(l.qty) - got) + ' of ' + l.shop_name + ' is still to come on ' + o.po_no + '.'}, 400);
        const r = {id:'r' + (++n), line_id:l.id, qty:String(body.qty), received_on:body.received_on};
        l.supply_receipts.push(r); posted.push(['receipt', body]);
        if(o.supply_order_lines.every(x => (x.supply_receipts || []).reduce((a, y) => a + Number(y.qty), 0) >= Number(x.qty))){ o.status = 'received'; o.received_on = body.received_on; }
        return jw([r], 201);
      }
      if(m === 'DELETE'){
        const id = eqv(u, 'id'); let gone = [];
        for(const o of ORDERS) for(const l of (o.supply_order_lines || [])){
          const i = (l.supply_receipts || []).findIndex(r => r.id === id);
          if(i >= 0){ gone = l.supply_receipts.splice(i, 1); if(o.status === 'received') { o.status = 'requested'; o.received_on = null; } posted.push(['unreceipt', id]); }
        }
        return jw(gone);
      }
    }
    if(p === '/rest/v1/supply_schedule') return j(+(u.searchParams.get('offset') || 0) ? [] : SCHED);
    if(p === '/rest/v1/supply_orders'){
      if(m === 'PATCH'){
        const o = ORDERS.find(x => x.id === eqv(u, 'id'));
        o.status = body.status;
        if(body.status === 'received'){
          o.received_on = body.received_on || '2026-11-20';
          // as the database does: what is still to come arrives that day
          (o.supply_order_lines || []).forEach(l => { l.supply_receipts = l.supply_receipts || [];
            const got = l.supply_receipts.reduce((a, r) => a + Number(r.qty), 0);
            if(Number(l.qty) > got) l.supply_receipts.push({id:'r' + (++n), qty:String(Number(l.qty) - got), received_on:o.received_on}); });
        }
        posted.push(['status', o.po_no, body]); return jw([o]);
      }
      return j(ORDERS);
    }
    if(p === '/rest/v1/rpc/supply_place_order'){
      posted.push(['place', body]);
      const sup = SUPPLIERS.find(s => s.id === body.p_supplier) || null;
      const po = 'SHP' + String(ORDERS.length + 1).padStart(5, '0');
      const o = {id:'00000000-0000-0000-0000-0000000000' + String(++n).padStart(2, '0'), category:body.p_category, po_no:po,
                 supplier_id:body.p_supplier, supplier_name:sup ? sup.name : null, needed_by:body.p_needed_by, note:body.p_note,
                 status:'requested', requested_at:'2026-11-20T16:00:00Z', requested_by:'Nick', emailed_at:null, received_on:null,
                 supply_order_lines: body.p_lines.map(l => { const it = ITEMS.find(x => x.id === l.item_id);
                   return {id:'l' + (++n), item_id:it.id, shop_name:it.shop_name, supplier_item:it.supplier_item, unit:it.unit, qty:String(l.qty)}; })};
      ORDERS.unshift(o);
      const out = Object.assign({}, o); delete out.supply_order_lines;
      return j(out);
    }
    if(p === '/functions/v1/supply-order'){
      posted.push(['email', body]);
      if(!MAIL_OK) return j({error:'The order is saved but the email would not send. Send it to the supplier directly.'}, 502);
      const o = ORDERS.find(x => x.id === body.id), sup = SUPPLIERS.find(s => s.id === o.supplier_id);
      o.emailed_at = '2026-11-20T16:00:05Z';
      o.sent_to = sup && sup.email ? sup.email : 'ashley@grinyer.ca'; o.copied_to = sup && sup.email ? 'ashley@grinyer.ca' : null;
      return j({ok:true});
    }
    return j([]);
  });
}

const failed = [];
const check = (ok, what) => { console.log((ok ? 'ok   ' : 'FAIL ') + what); if(!ok) failed.push(what); };
const text = (page, sel) => page.$eval(sel, e => e.innerText.replace(/\s+/g, ' '));
const card = (page, name) => page.$$eval('.sc', (cs, nm) => (cs.find(c => c.querySelector('.nm').innerText.trim().startsWith(nm)) || {innerText:''}).innerText.replace(/\s+/g, ' '), name);

(async () => {
  await serve(ROOT + '/tools-site', 8726);
  const b = await chromium.launch();
  const errs = [];
  async function open(role, where, viewport){
    ROLE = role;
    const page = await b.newPage({viewport: viewport || {width:1280, height:900}});
    page.on('pageerror', e => errs.push(e.message));
    await page.clock.setFixedTime(new Date('2026-11-20T11:00:00'));
    await mock(page);
    await page.goto('http://localhost:8726/');
    await page.evaluate(() => localStorage.setItem('gidc:session', JSON.stringify({access_token:'x', refresh_token:'y', user:{id:'a1', email:'a@g.ca'}})));
    await page.goto('http://localhost:8726' + where);
    if((role === 'manufacturing' || role === 'admin') && /order/.test(where))
      await page.waitForFunction(() => !/Loading/.test(document.getElementById('stock').innerText));
    else await page.waitForTimeout(600);
    return page;
  }
  reset();

  // the tools page and the menu
  let page = await open('manufacturing', '/');
  await page.waitForSelector('#grid .tile');
  const tiles = await page.$$eval('#grid .tile b', bs => bs.map(x => x.textContent));
  check(tiles.includes('Order Supplies') && !tiles.includes('Paint'), 'the tools page shows Order Supplies, and Paint has moved under it (' + tiles.join(', ') + ')');
  await page.click('text=Order Supplies'); await page.waitForTimeout(500);
  const menu = await page.$$eval('.tile', ts => ts.map(t => t.querySelector('b').textContent + ' ' + t.getAttribute('href')));
  check(menu.join('|') === 'Paint /paint/|Painting Supplies ./order/?c=painting|Shop Supplies ./order/?c=shop|Hardware ./order/?c=hardware|Sanding Supplies ./order/?c=sanding|Packaging Materials ./order/?c=packaging|Install Supplies ./order/?c=install',
    'the menu: Paint, Painting, Shop, Hardware, Sanding, Packaging, Install (' + menu.join(', ') + ')');
  check(/PO PD.*PO PNT.*PO SHP.*PO HDW.*PO SND.*PO PKG.*PO INST/.test(await text(page, '.grid')), 'each says its PO prefix');
  if(SHOTS) await page.screenshot({path: SHOTS + '/supplies-menu.png'});
  await page.close();
  page = await open('admin', '/');
  await page.waitForSelector('#grid .tile');
  const heads = await page.$$eval('#grid h2.grp', hs => hs.map(h => h.textContent));
  const first = await page.$eval('#grid > *', e => e.textContent);
  const gone = await page.$$eval('#grid .tile b', bs => bs.map(x => x.textContent));
  check(heads.join('|') === 'Sales|Shop|Installation|Accounting' && /Company Dashboard/.test(first),
    'the tools screen is grouped: the dashboard first, then Sales, Shop, Installation, Accounting (' + heads.join(', ') + ')');
  check(!gone.some(n => /Summary Estimate|Proliner|Packing Sequencer|Export Documents/.test(n)), 'the four tools now in the portal are gone (' + gone.join(', ') + ')');
  if(SHOTS) await page.screenshot({path: SHOTS + '/tools-grouped.png', fullPage: true});
  await page.close();
  page = await open('installer', '/');
  await page.waitForSelector('#grid .tile');
  check(!(await page.$$eval('#grid .tile b', bs => bs.map(x => x.textContent))).includes('Order Supplies'), 'an installer does not see Order Supplies');
  await page.close();

  // Shop Supplies
  page = await open('manufacturing', '/supplies/order/?c=shop');
  check(await text(page, '#title') === 'Shop Supplies' && /\(SHP\)/.test(await text(page, '#lede')), 'Shop Supplies, with its PO prefix');
  check(/last updated Fri, Nov 20/.test(await text(page, '#fresh')), 'says when the jobs last came from Access');

  let c = await card(page, 'Pine');
  check(/1x4 primed 16ft · Lumber Yard/.test(c), 'the card shows the shop name, then the supplier’s name small (' + c + ')');
  check(/28\.9 pieces in stock/.test(c) && /Counted 30 pieces on Nov 17, less 1\.1 used since/.test(c),
    'Pine: 30 counted, Aris’s bump stops yesterday took one piece plus 10% (' + c + ')');
  check(/Next 2 weeks 2\.2 \(1 job\)/.test(c) && /On order 20/.test(c) && /OK/.test(c),
    'Pine: three 70" valance backers fit two 16 foot pieces, 2.2 with waste; 20 on order (' + c + ')');
  c = await card(page, 'ReRail');
  check(/3 pieces in stock/.test(c) && /Next 2 weeks 2\.2/.test(c) && /Left after 2 weeks 0\.8/.test(c) && /Below minimum/.test(c) && /Minimum on hand 5 pieces/.test(c) && /Suggest ordering 10 pieces/.test(c),
    'Rerail: five door widths fit two 12 foot pieces, low, suggests the standard order of 10 (' + c + ')');
  c = await card(page, 'Small Valance');
  check(/Next 2 weeks 2\.2/.test(c) && /Below minimum/.test(c) && /Suggest ordering 6 pieces/.test(c),
    'Small valance: three 70" valances, never pieced, two lengths, low (' + c + ')');
  c = await card(page, 'Large Valance');
  check(/Not counted yet/.test(c) && /Next 2 weeks 0/.test(c), 'Large valance: not counted, its job is past the two weeks (' + c + ')');
  c = await card(page, 'Oversize Valance');
  check(/not in Access/.test(c) && /Below minimum/.test(c) && /Suggest ordering 2 pieces/.test(c), 'Oversize valance: counted only, low at 0, suggests 2 (' + c + ')');

  // coming up
  let s = await text(page, '#sched');
  check(/Tue Nov 24 · 2\.2 · ·/.test(s) && /Wed Nov 25 2\.2 · 2\.2 ·/.test(s), 'Coming up: rerail on Tuesday, pine and small valances on Wednesday (' + s + ')');
  check(/Four weeks 2\.2 2\.2 2\.2 1\.1/.test(s), 'four weeks totals, the large valance on Dec 10 included');
  await page.click('#showjobs');
  check(/#5069 Hill: valance small 70", 70", 70"; pine 70", 70", 70"; 6 doors/.test(await text(page, '#sched')), 'Show jobs lists each job’s cuts');

  // ordering
  await page.click('#fillsuggest');
  check(await page.inputValue('[data-qty="i2"]') === '10' && await page.inputValue('[data-qty="i3"]') === '6' &&
        await page.inputValue('[data-qty="i5"]') === '2' && await page.inputValue('[data-qty="i1"]') === '',
    'Fill suggested fills rerail 10, small valance 6, oversize 2, and leaves pine');
  await page.fill('[data-qty="i1"]', '15');
  let g = await text(page, '#groups');
  check(/SHP PO for Lumber Yard, to orders@lumber\.ca: 15 pieces Pine.*10 pieces ReRail/.test(g) &&
        /SHP PO for Valance Co, to ashley@grinyer\.ca only \(no supplier email\): 6 pieces Small Valance/.test(g) &&
        /SHP PO for no supplier, to ashley@grinyer\.ca only/.test(g), 'one PO per supplier, and where each goes (' + g + ')');
  check(await text(page, '#o-send') === 'Send 3 orders' && /3 POs, 4 items/.test(await text(page, '#o-total')), 'the button says three orders');
  await page.fill('#o-by', '2026-11-27'); await page.fill('#o-note', 'Deliver to the back door');
  if(SHOTS) await page.screenshot({path: SHOTS + '/supplies-shop.png', fullPage: true});
  await page.click('#o-send'); await page.waitForTimeout(800);
  const placed = posted.filter(x => x[0] === 'place').map(x => x[1]);
  check(placed.length === 3 && placed[0].p_supplier === 's1' && placed[0].p_lines.length === 2 && placed[0].p_lines[0].qty === 15 &&
        placed[1].p_supplier === 's2' && placed[2].p_supplier === null && placed.every(x => x.p_needed_by === '2026-11-27' && x.p_note === 'Deliver to the back door'),
    'three POs placed, the right lines on each, needed by and the note on all');
  check(posted.filter(x => x[0] === 'email').length === 3, 'and each emailed through supply-order');
  check(/Sent SHP00002, SHP00003, SHP00004, with ashley@grinyer\.ca copied/.test(await text(page, '#msg')), 'says what went (' + await text(page, '#msg') + ')');
  let o = await text(page, '#orders');
  check(/SHP00002 Lumber Yard 15 pieces Pine.*10 pieces ReRail.*Needed by Fri Nov 27\. Asked by Nick Nov 20\. Emailed to orders@lumber\.ca, copy ashley@grinyer\.ca/.test(o),
    'the orders list shows the PO, its lines and where it went (' + o + ')');
  check(await page.inputValue('[data-qty="i2"]') === '' && await page.inputValue('#o-note') === '', 'the order form is cleared');
  c = await card(page, 'ReRail');
  check(/On order 10/.test(c) && /OK/.test(c), 'Rerail now counts what is on order (' + c + ')');

  // received
  await page.click('[data-received="00000000-0000-0000-0000-00000000000a"]'); await page.waitForTimeout(300);
  c = await card(page, 'Pine');
  check(/48\.9 pieces in stock/.test(c) && /plus 20 received/.test(c) && /On order 15/.test(c), 'Received adds the 20 pieces of pine (' + c + ')');
  check(/SHP00001: the rest received, and added to stock/.test(await text(page, '#msg')), 'and says so (' + await text(page, '#msg') + ')');
  // part of a PO: 5 of the 15 pine on SHP00002
  const pineLine = ORDERS.find(x => x.po_no === 'SHP00002').supply_order_lines.find(l => /^Pine/.test(l.shop_name)).id;
  check(await page.inputValue('[data-recvqty="' + pineLine + '"]') === '15', 'each line offers what is still to come');
  await page.fill('[data-recvqty="' + pineLine + '"]', '5');
  await page.click('[data-recvline="' + pineLine + '"]'); await page.waitForTimeout(300);
  o = await text(page, '#orders');
  check(/Part received/.test(o) && /5 in Nov 20/.test(o) && /10 to come/.test(o), 'a part delivery shows on the PO, which stays on order (' + o.slice(0, 300) + ')');
  c = await card(page, 'Pine');
  check(/plus 25 received/.test(c) && /On order 10/.test(c), 'stock takes the 5, on order is the 10 still to come (' + c + ')');
  await page.fill('[data-recvqty="' + pineLine + '"]', '11');
  await page.click('[data-recvline="' + pineLine + '"]'); await page.waitForTimeout(300);
  check(/Only 10 of Pine/.test(await text(page, '#msg')), 'more than is still to come is refused (' + await text(page, '#msg') + ')');
  await page.click('[data-unreceive]'); await page.waitForTimeout(300);
  c = await card(page, 'Pine');
  check(/On order 15/.test(c) && /plus 20 received/.test(c) && /Taken back/.test(await text(page, '#msg')), 'a delivery typed wrong can be taken back (' + c + ')');

  // a failed email
  MAIL_OK = false;
  await page.click('[data-add="i4"]');
  check(await page.inputValue('[data-qty="i4"]') === '4', 'Add to order puts in the standard order');
  await page.click('#o-send'); await page.waitForTimeout(500);
  check(/SHP00005 saved, but the email did not go/.test(await text(page, '#msg')) && /Email not sent/.test(await text(page, '#orders')), 'a failed email keeps the PO and says so');
  MAIL_OK = true;
  await page.click('[data-resend]'); await page.waitForTimeout(400);
  check(!(await page.$('[data-resend]')), 'Send email sends it');

  // counts
  await page.click('[data-count="i4"]');
  await page.fill('#c-qty', '3'); await page.click('#c-save'); await page.waitForTimeout(300);
  c = await card(page, 'Large Valance');
  check(/3 pieces in stock/.test(c) && /Counted 3 pieces on Nov 20/.test(c), 'a count sets the stock (' + c + ')');

  // suppliers and items
  await page.click('#settings summary');
  await page.click('#newsupplier');
  await page.fill('#u-name', 'Install Depot'); await page.fill('#u-email', 'bad address'); await page.click('#u-save');
  check(/does not look right/.test(await text(page, '#msg')), 'a bad email is refused');
  await page.fill('#u-email', 'po@depot.ca; sales@depot.ca'); await page.click('#u-save'); await page.waitForTimeout(300);
  check(posted.some(x => x[0] === 'supplier' && x[1].email === 'po@depot.ca, sales@depot.ca'), 'New supplier saves, two addresses');
  await page.click('[data-supedit="s2"]'); await page.fill('#u-email', 'sales@valance.ca'); await page.click('#u-save'); await page.waitForTimeout(300);
  check(/Valance Co sales@valance\.ca/.test(await text(page, '#setbody')), 'a supplier’s email can be added later');

  await page.click('#newitem');
  await page.fill('#i-name', 'Glue'); await page.fill('#i-sitem', 'Titebond III 4L'); await page.selectOption('#i-sup', 's1');
  await page.fill('#i-unit', 'jug'); await page.fill('#i-warn', '1'); await page.fill('#i-std', '2');
  await page.click('#i-save'); await page.waitForTimeout(300);
  const ni = posted.filter(x => x[0] === 'item').pop();
  check(ni && ni[1].category === 'shop' && ni[1].supplier_id === 's1' && ni[1].uses === null && ni[1].unit === 'jug' && ni[1].standard_order === 2,
    'New item saves, not predicted, on this list');
  c = await card(page, 'Glue');
  check(/Titebond III 4L · Lumber Yard/.test(c) && /\? jugs in stock/.test(c), 'and shows with its supplier (' + c + ')');
  // a piece is one at a time, a length or packs of
  await page.click('[data-edit="' + ITEMS.find(x => x.shop_name === 'Glue').id + '"]');
  check(!(await page.isVisible('#i-how')) && await page.isVisible('#i-step'), 'a unit other than piece has no piece choice');
  await page.fill('#i-unit', 'piece');
  check(await page.inputValue('#i-how') === 'one' && !(await page.isVisible('#i-step')) && !(await page.isVisible('#i-len')), 'a piece one at a time hides packs and length');
  await page.selectOption('#i-how', 'packs');
  check(await page.isVisible('#i-step') && !(await page.isVisible('#i-len')), 'packs of shows the pack');
  await page.selectOption('#i-how', 'length');
  check(await page.isVisible('#i-len') && await page.isVisible('#i-step'), 'a length asks the length, packs stay for bundles');
  await page.click('#i-save');
  check(/Type the length of one piece/.test(await text(page, '#msg')), 'a length needs the length');
  await page.fill('#i-len', '192'); await page.click('#i-save'); await page.waitForTimeout(300);
  check(posted.some(x => x[0] === 'itemedit' && x[1].per_unit === 192 && x[1].uses === null && x[1].unit === 'piece'), 'the length saves on a counted only piece');
  c = await card(page, 'Glue');
  check(/Length 16 ft a piece/.test(c), 'the card shows the length (' + c + ')');
  check(/16 ft lengths/.test(await text(page, '#ord')), 'and the order form says so (' + (await text(page, '#ord')).slice(0, 200) + ')');
  await page.click('[data-edit="' + ITEMS.find(x => x.shop_name === 'Glue').id + '"]');
  check(await page.inputValue('#i-how') === 'length' && await page.inputValue('#i-len') === '192', 'Edit opens on the length');
  await page.fill('#i-unit', 'jug'); await page.click('#i-save'); await page.waitForTimeout(300);
  check(posted.filter(x => x[0] === 'itemedit').pop()[1].per_unit === null, 'back to a jug drops the length');
  await page.click('[data-edit="i2"]');
  await page.selectOption('#i-uses', '');
  check(await page.$eval('#i-perwrap', e => e.classList.contains('hide')), 'not predicted hides the piece length');
  await page.selectOption('#i-uses', 'rerail'); await page.fill('#i-per', ''); await page.click('#i-save');
  check(/length of one piece/.test(await text(page, '#msg')), 'a predicted item needs its piece length');
  await page.fill('#i-per', '96'); await page.fill('#i-waste', '15'); await page.click('#i-save'); await page.waitForTimeout(300);
  check(posted.some(x => x[0] === 'itemedit' && x[1].per_unit === 96 && x[1].waste_pct === 15), 'Edit saves a new length and waste');
  await page.click('[data-edit="i5"]'); await page.click('[data-remove="i5"]');
  check(/Take Oversize Valance off the list/.test(await text(page, '#stock')), 'Remove asks first');
  await page.click('[data-removeyes="i5"]'); await page.waitForTimeout(400);
  check(!/Oversize Valance/.test(await text(page, '#stock')) && posted.some(x => x[0] === 'itemgone' && x[1] === 'i5'), 'Yes removes it');

  await page.fill('#s-copy', 'ashley@grinyer.ca, buyer@grinyer.ca'); await page.click('#s-savecopy'); await page.waitForTimeout(300);
  check(posted.some(x => x[0] === 'copy' && x[1].copy_to === 'ashley@grinyer.ca, buyer@grinyer.ca') &&
        /ashley@grinyer\.ca, buyer@grinyer\.ca copied/.test(await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '))),
    'who is copied can be changed');
  await page.close();

  // Hardware: grouped, matched by spec, searchable, Onward POs go to Ashley only
  page = await open('admin', '/supplies/order/?c=hardware');
  check(await text(page, '#title') === 'Hardware' && /\(HDW\)/.test(await text(page, '#lede')), 'Hardware opens, with its PO prefix');
  const grps = await page.$$eval('#stock h3.grp', hs => hs.map(h => h.textContent));
  check(grps.length >= 3, 'the stock is grouped by kind (' + grps.join(', ') + ')');
  c = await card(page, 'Hinge 3.5"');
  check(/Next 2 weeks 12/.test(c), 'the 3.5" Satin Nickel hinge counts only its own spec (' + c + ')');
  c = await card(page, 'Hinge 4"');
  check(/Next 2 weeks 4/.test(c), 'the 4" Black hinge counts its 4 (' + c + ')');
  c = await card(page, 'Finger pull round');
  check(/Next 2 weeks 2/.test(c), 'four round pulls are two pairs (' + c + ')');
  await page.fill('#find', 'black');
  let cards = await page.$$eval('#stock .sc', cs => cs.length);
  check(cards === 1 && /1 of 5 items/.test(await text(page, '#findn')), 'search "black" leaves one card (' + cards + ')');
  check(await page.$$eval('#ord tbody tr', rs => rs.length) === 1, 'and one row in the order table');
  await page.fill('#find', 'hinge chrome');
  check(/Hinge 3" square Chrome/.test(await text(page, '#stock')) && await page.$$eval('#stock .sc', cs => cs.length) === 1, 'every word must match');
  await page.fill('#find', 'onward');
  check(await page.$$eval('#stock .sc', cs => cs.length) === 4, 'search finds by supplier too');
  await page.fill('#find', 'zzz');
  check(/No item matches/.test(await text(page, '#stock')), 'says when nothing matches');
  await page.fill('#find', '');
  check(await page.$$eval('#stock .sc', cs => cs.length) === 5, 'clearing the search shows everything again');
  await page.fill('[data-qty="h3"]', '10');
  await page.fill('#find', 'track');
  check(await page.$$eval('#ord tbody tr', rs => rs.length) === 2, 'an item already picked stays in the order table under a search');
  check(/HDW PO for Onward, to ashley@grinyer\.ca only/.test(await text(page, '#groups')), 'an Onward PO goes to Ashley only (' + await text(page, '#groups') + ')');
  if(SHOTS) await page.screenshot({path: SHOTS + '/supplies-hardware.png', fullPage: true});
  await page.close();

  // the other lists use the same page
  page = await open('admin', '/supplies/order/?c=painting');
  check(await text(page, '#title') === 'Painting Supplies' && /\(PNT\)/.test(await text(page, '#lede')) && /goes to Ashley/.test(await text(page, '#lede')),
    'Painting Supplies opens, PNT, every order to Ashley');
  await page.close();
  page = await open('admin', '/supplies/order/?c=sanding');
  check(await text(page, '#title') === 'Sanding Supplies' && /\(SND\)/.test(await text(page, '#lede')) &&
        /Press New item/.test(await text(page, '#stock')) && await page.$eval('#sched-wrap', e => e.classList.contains('hide')),
    'Sanding Supplies opens empty, ready for items, with no schedule');
  await page.close();
  page = await open('sales', '/supplies/order/?c=shop');
  check(/Not one of yours/.test(await page.evaluate(() => document.body.innerText)), 'sales is turned away');
  await page.close();

  // Packaging Materials: taken down by the pallets in the dealer portal
  page = await open('admin', '/supplies/order/?c=packaging');
  check(await text(page, '#title') === 'Packaging Materials' && /\(PKG\)/.test(await text(page, '#lede')) && /goes to Ashley/.test(await text(page, '#lede')),
    'Packaging Materials opens, PKG, every order to Ashley');
  check(posted.some(x => x[0] === 'pallets' && x[1].p_from === '2025-10-16'), 'it reads the pallets from the dealer portal');
  check(/Taken down by the pallets packed in the dealer portal/.test(await text(page, '#fresh')), 'and says where the numbers come from');
  c = await card(page, 'Corner protectors');
  check(/12 pieces in stock/.test(c) && /less 8 used since/.test(c),
    'corner protectors: 20 counted Nov 10, two pallets since at 4 each (' + c + ')');
  check(/Next 2 weeks 12 \(3 pallets, 72 doors to pack\)/.test(c),
    'the next two weeks come from the Packaging Dates: 22 doors today is one pallet, 50 on Nov 30 is two, 12 corners (' + c + ')');
  check(posted.some(x => x[0] === 'ahead' && x[1].p_to === '2026-12-17'), 'it reads the orders waiting for a pallet, four weeks ahead');
  const ah = await text(page, '#ahead');
  check(/Fri Nov 20 1 22 1 168\.7/.test(ah) && /Mon Nov 30 2 50 2 383\.3/.test(ah) && /Thu Dec 10 1 3 1 \(under 20 so far\) 23/.test(ah) && /Four weeks 4 75 4 575/.test(ah),
    'Waiting for a pallet: by Packaging Date, the overdue one as today, doors, pallets and foam (' + ah + ')');
  check(/Comes in carton of 30 pieces/.test(c) && /Price \$4\.27 a piece/.test(c) && /Stock value \$51\.24/.test(c),
    'the pack, the price of one piece and the stock value, 12 at 4.27 (' + c + ')');
  c = await card(page, 'Door foam');
  // 9200 + 5800 inches used = 15000 = one roll
  check(/1 roll in stock/.test(c) && /less 1 used since/.test(c), 'foam: 2 rolls counted, 15,000 inches of foam used, one roll left (' + c + ')');
  c = await card(page, 'Strap guards');
  check(/Price \$0\.147 a piece/.test(c), 'a price under a dollar keeps its places (' + c + ')');
  c = await card(page, 'Shipping pallet');
  check(/Not counted yet/.test(c) && /Next 2 weeks 3 \(3 pallets/.test(c) && /Price not set/.test(c), 'pallets: not counted, three in the next two weeks, no price yet (' + c + ')');
  c = await card(page, 'Packing tape');
  check(/Next 2 weeks 0\.9 \(3 pallets/.test(c) && /case of 36 rolls/.test(c), 'tape: 50 ft of a 165 ft roll a pallet, three pallets, cases of 36 (' + c + ')');
  check(!(await page.$eval('#pal-wrap', e => e.classList.contains('hide'))) &&
        /Wed Nov 18 Chicago 3 6 483\.3/.test(await text(page, '#pals')) && /Four weeks 2 pallets 16 1,?250/.test(await text(page, '#pals')),
    'Pallets packed lists the last four weeks with doors and feet of foam (' + await text(page, '#pals') + ')');
  check(await page.$eval('#sched-wrap', e => e.classList.contains('hide')), 'there is no Access schedule on this list');
  // a low item suggests whole packs
  await page.click('[data-edit="k3"]');
  check(await page.inputValue('#i-step') === '30' && await page.inputValue('#i-pack') === 'carton' && await page.inputValue('#i-price') === '4.27' &&
        /Price for one piece/i.test(await text(page, '#panel')),
    'the item form shows the pack and the price');
  await page.fill('#i-warn', '40'); await page.fill('#i-price', '$1,150.5'); await page.click('#i-save'); await page.waitForTimeout(300);
  check(posted.some(x => x[0] === 'itemedit' && x[1].price === 1150.5 && x[1].order_step === 30 && x[1].pack_name === 'carton' && x[1].warn_qty === 40),
    'Edit saves the price, typed with a dollar sign and a comma');
  c = await card(page, 'Corner protectors');
  check(/Suggest ordering 60 pieces \(2 cartons\)/.test(c), 'below the minimum, it suggests whole cartons: none left after two weeks, 40 to reach 40, so 60 (' + c + ')');
  await page.click('#lowonly');
  let lo = await text(page, '#stock');
  check(/Corner protectors/.test(lo) && !/Shipping pallet/.test(lo) && /of 7 items/.test(await text(page, '#findn')), 'Low or running out leaves out what is fine or not counted (' + lo.slice(0, 200) + ')');
  check(!/Shipping pallet/.test(await text(page, '#ord')), 'and the order form follows it');
  await page.click('#lowonly');
  check(/Shipping pallet/.test(await text(page, '#stock')), 'pressed again shows every item');
  await page.click('[data-edit="k6"]');
  await page.fill('#i-per', '200/1500'); await page.click('#i-save'); await page.waitForTimeout(300);
  check(posted.some(x => x[0] === 'itemedit' && x[1].per_unit === 0.1333), 'a part of a roll can be typed as 200/1500');
  await page.click('[data-edit="k4"]');
  await page.fill('#i-step', '0'); await page.click('#i-save');
  check(/Packs of should be a number above 0/.test(await text(page, '#msg')), 'a pack of 0 is refused');
  await page.click('[data-close]');
  await page.click('[data-add="k5"]');
  check(await page.inputValue('[data-qty="k5"]') === '50', 'Add to order puts in a bundle of 50 cones');
  check(/PKG PO for Uline, to ashley@grinyer\.ca only/.test(await text(page, '#groups')), 'a Uline PO goes to Ashley only (' + await text(page, '#groups') + ')');
  if(SHOTS) await page.screenshot({path: SHOTS + '/supplies-packaging.png', fullPage: true});
  await page.close();
  page = await open('admin', '/supplies/order/?c=packaging', {width:390, height:844});
  const wideP = await page.evaluate(() => document.documentElement.scrollWidth);
  check(wideP <= 390, 'Packaging: no sideways page scroll on a phone (' + wideP + ')');
  if(SHOTS) await page.screenshot({path: SHOTS + '/supplies-packaging-phone.png', fullPage: true});
  await page.close();

  // Inventory Value: doors, paint and every supplies list, on hand times price
  reset();
  page = await open('admin', '/value/');
  await page.waitForFunction(() => /As of/.test(document.getElementById('status').innerText), null, {timeout: 40000});
  const tl = await text(page, '#tiles');
  check(/Everything \$1,203\.24/i.test(tl) && /Door Inventory \$170\.00/i.test(tl) && /Paint \$800\.00/i.test(tl) && /Packaging Materials \$233\.24/i.test(tl),
    'the totals: 2 doors at 85, 20 gal primer at 40, 12 corner protectors at 4.27 and 1 roll of foam at 182 (' + tl + ')');
  const ls = await text(page, '#lists');
  check(/Flat 24 ?No price/.test(ls) && /Extra White ?Not counted/.test(ls) && /Corner protectors 12 pieces \$4\.27 \$51\.24/.test(ls),
    'flags a door with no value and paint never counted, and shows each line (' + ls.slice(0, 300) + ')');
  check(/4 items have stock but no price/.test(await text(page, '#status')), 'the status says what has no price (' + await text(page, '#status') + ')');
  check(await page.$$eval('#frames iframe', f => f.length) === 0, 'the hidden pages are closed once they answer');
  const dl = page.waitForEvent('download');
  await page.click('#csv');
  const csvPath = await (await dl).path();
  const csvText = fs.readFileSync(csvPath, 'utf8');
  check(/^List,Item,On hand,Unit,Price of one,Value/.test(csvText) && /Door Inventory,Shaker 30 x 80 Hollow,2,door,85,170/.test(csvText),
    'Download for a spreadsheet writes every line (' + csvText.split('\n').slice(0, 3).join(' | ') + ')');
  if(SHOTS) await page.screenshot({path: SHOTS + '/inventory-value.png', fullPage: true});
  await page.close();
  page = await open('manufacturing', '/value/');
  check(/Not one of yours/.test(await page.evaluate(() => document.body.innerText)), 'the shop is turned away from Inventory Value');
  await page.close();

  // phone width
  page = await open('manufacturing', '/supplies/order/?c=shop', {width:390, height:844});
  const wide = await page.evaluate(() => document.documentElement.scrollWidth);
  check(wide <= 390, 'no sideways page scroll on a phone (' + wide + ')');
  if(SHOTS) await page.screenshot({path: SHOTS + '/supplies-phone.png', fullPage: true});
  await page.close();

  await b.close();
  console.log('ERRORS:', JSON.stringify(errs));
  console.log('FAILED:', JSON.stringify(failed));
  process.exit(failed.length || errs.length ? 1 : 0);
})();

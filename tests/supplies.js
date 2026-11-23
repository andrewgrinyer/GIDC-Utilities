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
let CATS, SUPPLIERS, ITEMS, COUNTS, ORDERS, n = 0, ROLE = 'manufacturing', MAIL_OK = true;
const posted = [];
function reset(){
  CATS = [{code:'shop', name:'Shop Supplies', po_prefix:'SHP', copy_to:'ashley@grinyer.ca', sort:10},
          {code:'painting', name:'Painting Supplies', po_prefix:'PNT', copy_to:'ashley@grinyer.ca', sort:5},
          {code:'hardware', name:'Hardware', po_prefix:'HDW', copy_to:'ashley@grinyer.ca', sort:15},
          {code:'sanding', name:'Sanding Supplies', po_prefix:'SND', copy_to:'ashley@grinyer.ca', sort:20},
          {code:'install', name:'Install Supplies', po_prefix:'INST', copy_to:'ashley@grinyer.ca', sort:30}];
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
  COUNTS = [{id:'c1', item_id:'i1', qty:'30.00', counted_on:'2026-11-17', created_at:'2026-11-17T22:00:00Z', created_by:'Nick'},
            {id:'c2', item_id:'i2', qty:'3.00', counted_on:'2026-11-18', created_at:'2026-11-18T22:00:00Z', created_by:'Nick'},
            {id:'c3', item_id:'i3', qty:'5.00', counted_on:'2026-11-18', created_at:'2026-11-18T22:00:00Z', created_by:'Nick'},
            {id:'c4', item_id:'i5', qty:'0.00', counted_on:'2026-11-18', created_at:'2026-11-18T22:00:00Z', created_by:'Nick'}];
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
      return j(CATS.filter(c => c.code === eqv(u, 'code')));
    }
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
    if(p === '/rest/v1/supply_schedule') return j(+(u.searchParams.get('offset') || 0) ? [] : SCHED);
    if(p === '/rest/v1/supply_orders'){
      if(m === 'PATCH'){
        const o = ORDERS.find(x => x.id === eqv(u, 'id'));
        o.status = body.status; if(body.status === 'received') o.received_on = '2026-11-20';
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
  check(menu.join('|') === 'Paint /paint/|Painting Supplies ./order/?c=painting|Shop Supplies ./order/?c=shop|Hardware ./order/?c=hardware|Sanding Supplies ./order/?c=sanding|Install Supplies ./order/?c=install',
    'the menu: Paint, Painting, Shop, Hardware, Sanding, Install (' + menu.join(', ') + ')');
  check(/PO PD.*PO PNT.*PO SHP.*PO HDW.*PO SND.*PO INST/.test(await text(page, '.grid')), 'each says its PO prefix');
  if(SHOTS) await page.screenshot({path: SHOTS + '/supplies-menu.png'});
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
  check(/SHP00001 received, and added to stock/.test(await text(page, '#msg')), 'and says so');

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

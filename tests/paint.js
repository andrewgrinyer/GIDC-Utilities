// Clicks through the Paint tool on the tools site against a fake Supabase,
// with the clock held at Thursday 19 November 2026. Nothing leaves the
// machine.
//
//   node tests/paint.js            (SHOTS=/some/dir to save screenshots)
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

const COLOURS = [
  {name:'Primer', kind:'primer', doors_per_pail:50, warn_gallons:'10.00', sort:0},
  {name:'Extra White', kind:'stock', doors_per_pail:35, warn_gallons:'5.00', sort:10},
  {name:'Pure White', kind:'stock', doors_per_pail:35, warn_gallons:'5.00', sort:20},
  {name:'Alabaster', kind:'stock', doors_per_pail:35, warn_gallons:'5.00', sort:30},
  {name:'Pearly', kind:'stock', doors_per_pail:35, warn_gallons:'5.00', sort:40},
  {name:'Chantilly Lace', kind:'stock', doors_per_pail:35, warn_gallons:'5.00', sort:50},
  {name:'Custom', kind:'custom', doors_per_pail:35, warn_gallons:null, sort:90},
  {name:'Oxford White', kind:'other', doors_per_pail:35, warn_gallons:null, sort:200},
];
const L = (id, no, job, colour, kind, doors, prime, paint) =>
  ({access_order_id:id, order_no:no, job, colour_raw:colour || '', colour, kind, doors:String(doors), prime_on:prime, paint_on:paint,
    pulled_at:'2026-11-19T14:47:00Z'});
const LINES = [
  L(5069, '5067', 'Aris', 'Chantilly Lace', 'stock', 14, '2026-11-17', '2026-11-18'),
  L(5070, '5068', 'Cortes', 'Extra White', 'stock', 35, '2026-11-23', '2026-11-24'),
  L(5071, '5069', 'SFD Abraham', 'Hale Navy', 'custom', 5, '2026-11-24', '2026-11-25'),
  L(5072, '5070', 'Old job', 'Primer only', 'primer_only', 3, '2026-11-20', null),
  L(5073, '5071', 'No colour', null, 'none', 2, '2026-11-26', '2026-11-27'),
  L(5074, '5072', 'Big job', 'Pearly', 'stock', 70, '2026-11-30', '2026-12-01'),
  L(5075, '5073', 'Oxley', 'Oxford White', 'other', 7, null, '2026-11-30'),
];
const nrm = x => String(x || '').toLowerCase().replace(/[^a-z0-9]/g, '');
let COUNTS, ORDERS, n = 0, ROLE = 'manufacturing', MAIL_OK = true, EXPIRED = false;
const calls = [], posted = [];
function reset(){
  COUNTS = [{id:'c1', colour:'Chantilly Lace', gallons:'10.00', counted_on:'2026-11-16', created_at:'2026-11-16T22:00:00Z', created_by:'Nick'},
            {id:'c2', colour:'Extra White', gallons:'4.00', counted_on:'2026-11-18', created_at:'2026-11-18T22:00:00Z', created_by:'Nick'},
            {id:'c3', colour:'Primer', gallons:'20.00', counted_on:'2026-11-18', created_at:'2026-11-18T22:00:00Z', created_by:'Nick'},
            {id:'c4', colour:'Oxford White', gallons:'3.00', counted_on:'2026-11-18', created_at:'2026-11-18T22:00:00Z', created_by:'Nick'}];
  ORDERS = [{id:'00000000-0000-0000-0000-00000000000a', colour:'Pearly', custom:false, pails_5:2, pails_1:0, gallons:'10.00', for_job:null, needed_by:null,
             note:null, status:'requested', requested_at:'2026-11-17T15:00:00Z', requested_by:'Andrew', emailed_at:'2026-11-17T15:00:01Z', received_on:null}];
}
async function mock(page){
  await page.route('https://baakegbtuygtldksmant.supabase.co/**', async route => {
    const req = route.request(), u = new URL(req.url()), p = u.pathname, m = req.method();
    calls.push(m + ' ' + p + u.search);
    const j = (b, s) => route.fulfill({status:s || 200, contentType:'application/json', body:JSON.stringify(b)});
    const body = req.postData() ? JSON.parse(req.postData()) : {};
    if(p === '/auth/v1/token') return j({access_token:'x2', refresh_token:'y2', user:{id:'a1', email:'a@g.ca'}});
    // A sign in older than an hour: the first save is refused with 401,
    // as Supabase does, and the page has to renew and send it again.
    if(EXPIRED && m !== 'GET'){ EXPIRED = false; return j({message:'JWT expired'}, 401); }
    // Like PostgREST: a write sends the rows back only when asked to.
    const wantRows = /return=representation/.test(req.headers()['prefer'] || '');
    const jw = (b, st) => wantRows ? j(b, st) : route.fulfill({status: st === 201 ? 201 : 204, body: ''});
    if(p === '/rest/v1/profiles') return j([{id:'a1', name:'Nick', role:ROLE, active:true, email_verified_at:'2026-10-24'}]);
    if(p === '/auth/v1/user') return j({id:'a1'});
    if(p === '/rest/v1/paint_colours'){
      if(m === 'PATCH'){ const nm = decodeURIComponent(u.searchParams.get('name').replace('eq.', ''));
        const c = COLOURS.find(x => x.name === nm); Object.assign(c, body); posted.push(['colour', nm, body]); return jw([c]); }
      if(m === 'POST'){
        if(COLOURS.some(c => nrm(c.name) === nrm(body.name))) return j({message:'duplicate key value violates unique constraint "paint_colours_same_name"'}, 409);
        const c = {name: body.name, kind: 'other', doors_per_pail: 35, warn_gallons: null, sort: 200};
        COLOURS.push(c); posted.push(['newcolour', body]); return jw([c], 201);
      }
      if(m === 'DELETE'){
        const nm = decodeURIComponent(u.searchParams.get('name').replace('eq.', ''));
        const i = COLOURS.findIndex(x => x.name === nm && x.kind === 'other'); if(i < 0) return jw([]);
        COUNTS = COUNTS.filter(x => x.colour !== nm); posted.push(['removed', nm]); return jw(COLOURS.splice(i, 1));
      }
      return j(COLOURS);
    }
    if(p === '/rest/v1/paint_schedule_lines') return j(+(u.searchParams.get('offset') || 0) ? [] : LINES);
    if(p === '/rest/v1/paint_counts'){
      if(m === 'POST'){ const row = Object.assign({id:'n' + (++n), created_at:'2026-11-19T16:00:00Z', created_by:'Nick'}, body); COUNTS.unshift(row); posted.push(['count', body]); return jw([row], 201); }
      if(m === 'DELETE'){ const id = u.searchParams.get('id').replace('eq.', ''); const i = COUNTS.findIndex(x => x.id === id); return jw(COUNTS.splice(i, 1)); }
      return j(COUNTS);
    }
    if(p === '/rest/v1/paint_orders'){
      if(m === 'POST'){
        const id = '00000000-0000-0000-0000-0000000000' + String(++n).padStart(2, '0');
        if(body.custom && !(body.for_job || '').trim()) return j({message:'new row violates check constraint "paint_orders_customer_ok"'}, 400);
        const po = 'PD' + String(ORDERS.length + 1).padStart(5, '0');
        // as the database does: a custom colour goes on the Other colours list
        let shelf = body.colour;
        if(body.custom){
          const hit = COLOURS.find(c => (c.kind === 'other' || c.kind === 'stock') && nrm(body.colour).includes(nrm(c.name)));
          if(hit) shelf = hit.name; else COLOURS.push({name: body.colour, kind: 'other', doors_per_pail: 35, warn_gallons: null, sort: 200});
        }
        const row = Object.assign({id, po_no: po, stock_colour: shelf, status:'requested', requested_at:'2026-11-19T16:00:00Z', requested_by:'Nick', emailed_at:null, received_on:null},
          body, {gallons: String(body.pails_5 * 5 + body.pails_1)});
        ORDERS.unshift(row); posted.push(['order', body]); return jw([row], 201);
      }
      if(m === 'PATCH'){
        const id = u.searchParams.get('id').replace('eq.', ''); const o = ORDERS.find(x => x.id === id);
        Object.assign(o, body); if(body.status === 'received') o.received_on = '2026-11-19';
        posted.push(['status', id, body]); return jw([o]);
      }
      return j(ORDERS);
    }
    if(p === '/functions/v1/paint-order'){
      posted.push(['email', body]);
      if(!MAIL_OK) return j({error:'The order is saved but the email would not send. Tell Ashley directly.'}, 502);
      const sent = ORDERS.find(o => o.id === body.id); if(sent) sent.emailed_at = '2026-11-19T16:00:05Z';   // stamped, as the function does
      return j({ok:true, to:['ashley@grinyer.ca']});
    }
    return j([]);
  });
}

const failed = [];
const check = (ok, what) => { console.log((ok ? 'ok   ' : 'FAIL ') + what); if(!ok) failed.push(what); };
const text = (page, sel) => page.$eval(sel, e => e.innerText.replace(/\s+/g, ' '));
const card = (page, name) => page.$$eval('.sc', (cs, nm) => (cs.find(c => c.querySelector('.nm').innerText.trim().startsWith(nm)) || {innerText:''}).innerText.replace(/\s+/g, ' '), name);

(async () => {
  await serve(ROOT + '/tools-site', 8725);
  const b = await chromium.launch();
  const errs = [];
  async function open(role, viewport){
    ROLE = role;
    const page = await b.newPage({viewport: viewport || {width:1280, height:900}});
    page.on('pageerror', e => errs.push(e.message));
    await page.clock.setFixedTime(new Date('2026-11-19T11:00:00'));
    await mock(page);
    await page.goto('http://localhost:8725/');
    await page.evaluate(() => localStorage.setItem('gidc:session', JSON.stringify({access_token:'x', refresh_token:'y', user:{id:'a1', email:'a@g.ca'}})));
    await page.goto('http://localhost:8725/paint/');
    if(role === 'manufacturing' || role === 'admin')
      await page.waitForFunction(() => !/Loading/.test(document.getElementById('stock').innerText));
    else await page.waitForTimeout(500);
    return page;
  }
  reset();

  let page = await open('manufacturing');
  const landing = await page.evaluate(() => fetch('/').then(r => r.text()));
  const menu = await page.evaluate(() => fetch('/supplies/').then(r => r.text()));
  check(/name: 'Order Supplies'/.test(landing) && /\.\/supplies\//.test(landing) && /who:\s*'shop'/.test(landing.split("name: 'Order Supplies'")[1]) &&
        /href="\/paint\/"/.test(menu), 'landing page has an Order Supplies tile for the shop, and Paint is under it');
  check(/last updated Thu, Nov 19/.test(await text(page, '#fresh')), 'says when the schedule last came from Access');

  // stock
  let c = await card(page, 'Chantilly Lace');
  check(/8\.0 gal in stock/.test(c) && /Counted 10\.0 gal on Nov 16, less 2\.0 used since/.test(c) && /OK/.test(c),
    'Chantilly Lace: 10 counted less 14 doors painted yesterday is 8.0 (' + c + ')');
  c = await card(page, 'Extra White');
  check(/4\.0 gal in stock/.test(c) && /Next 2 weeks 5\.0 gal \(35 doors\)/.test(c) && /Runs short Tue Nov 24/.test(c) && /Suggest ordering 2 x 5 gal/.test(c),
    'Extra White: 4 on hand, 35 doors next week need 5.0, runs short Tue Nov 24, suggests 2 x 5 (' + c + ')');
  c = await card(page, 'Primer');
  check(/20\.0 gal in stock/.test(c) && /Next 2 weeks 11\.5 gal \(115 doors\)/.test(c) && /Below minimum/.test(c) && /Minimum on hand/.test(c) && /Suggest ordering 1 x 5 gal/.test(c),
    'Primer: every door in the next two weeks, primer only included, 115 doors 11.5 gal, low (' + c + ')');
  c = await card(page, 'Pearly');
  check(/\? gal in stock/.test(c) && /Not counted yet/.test(c) && /On order 10\.0 gal/.test(c), 'Pearly: not counted yet, 10 on order');

  // custom colours
  let cu = await text(page, '#custom');
  check(/Hale Navy #5069 SFD Abraham, 5 doors, painted Wed Nov 25\. Needs 0\.7 gal: 1 x 1 gal/.test(cu) && /Not ordered/.test(cu),
    'Hale Navy shows the job, the day, 0.7 gal, 1 x 1 gal, not ordered (' + cu + ')');
  check(/No colour typed yet #5071 No colour, 2 doors, painted Fri Nov 27/.test(cu), 'a line with no colour is flagged');
  check(!/Old job/.test(cu), 'primer only is not a custom colour');

  // the schedule, this week
  let s = await text(page, '#sched');
  check(/Mon Nov 16 to Sun Nov 22/.test(await text(page, '#rangetxt')), 'opens on this week, Monday to Sunday');
  check(/Tue Nov 17 14 1\.4 gal/.test(s) && /Wed Nov 18 · · · · · 14 2\.0 gal/.test(s) && /Fri Nov 20 3 0\.3 gal/.test(s),
    'this week: primer Tuesday, Chantilly Lace Wednesday, primer only Friday (' + s + ')');
  check(!/Sat Nov 21/.test(s), 'an empty weekend day is left out');
  await page.click('#next');
  s = await text(page, '#sched');
  check(/Mon Nov 23 35 3\.5 gal/.test(s) && /Tue Nov 24 5 0\.5 gal 35 5\.0 gal/.test(s) && /Wed Nov 25 .*Hale Navy: 5 \(0\.7 gal\) 5/.test(s) &&
        /Fri Nov 27 .*No colour yet: 2/.test(s), 'next week by day (' + s + ')');
  check(/Total 42 4\.2 gal 35 5\.0 gal/.test(s), 'next week totals: 42 doors primed, 35 Extra White');
  await page.click('#showjobs');
  s = await text(page, '#sched');
  check(/#5068 Cortes: Primer 35/.test(s) && /#5068 Cortes: Extra White 35/.test(s), 'Show jobs lists each job under its day');
  await page.click('[data-mode="month"]');
  check(/Sun Nov 1 to Mon Nov 30/.test(await text(page, '#rangetxt')), 'Month is the whole of November');
  s = await text(page, '#sched');
  check(/Mon Nov 30 70 7\.0 gal/.test(s) && !/Dec 1/.test(s), 'the month stops at the 30th');
  await page.click('#next');
  check(/Tue Dec 1/.test(await text(page, '#sched')) && /Pearly/.test(await text(page, '#sched')), 'next month shows the Pearly job on Dec 1');
  await page.click('[data-mode="custom"]');
  await page.fill('#from', '2026-11-24'); await page.fill('#to', '2026-11-25'); await page.dispatchEvent('#to', 'change');
  check(/Tue Nov 24 to Wed Nov 25/.test(await text(page, '#rangetxt')) && !/Nov 23/.test(await text(page, '#sched')), 'Pick dates shows just those days');
  await page.click('[data-mode="week"]');

  // printing
  await page.emulateMedia({media:'print'});
  check(await page.$eval('#stock', e => getComputedStyle(e.closest('.noprint')).display === 'none') &&
        await page.$eval('#printhead', e => getComputedStyle(e).display !== 'none') &&
        /Paint schedule, Mon Nov 23 to Nov 29, 2026/.test(await text(page, '#printhead')),
    'printing shows only the schedule, with a heading');
  if(SHOTS) await page.pdf({path: SHOTS + '/paint-print.pdf', landscape: true});
  await page.emulateMedia({media:'screen'});
  await page.click('#showjobs');

  // order Extra White
  await page.click('[data-order="Extra White"]');
  check(await page.inputValue('#o-5') === '2', 'Order opens with the suggested 2 x 5 gal');
  await page.fill('#o-1', '1');
  check(/Total 11 gallons/.test(await text(page, '#o-total')), 'the form adds up 2 x 5 and 1 x 1 to 11 gallons');
  await page.fill('#o-note', 'Satin');
  await page.click('#o-save'); await page.waitForTimeout(250);
  const o = posted.find(x => x[0] === 'order');
  check(o && o[1].colour === 'Extra White' && o[1].pails_5 === 2 && o[1].pails_1 === 1 && o[1].custom === false && o[1].note === 'Satin', 'the order is filed');
  check(posted.some(x => x[0] === 'email'), 'then emailed through paint-order');
  check(/^PO PD00002: Extra White, 11\.0 gal, sent to Ashley/.test(await text(page, '#msg')), 'says it went to Ashley, with its PO number');
  check(/PD00002 Extra White, 2 x 5 gal and 1 x 1 gal/.test(await text(page, '#orders')), 'the order list shows the PO number');
  check(/Customer \(optional\)/.test(await page.evaluate(() => document.body.innerText)) === false, 'form closed after sending');
  c = await card(page, 'Extra White');
  check(/On order 11\.0 gal/.test(c) && /Left after 2 weeks 10\.0 gal/.test(c) && /OK/.test(c), 'Extra White now counts what is on order (' + c + ')');
  if(SHOTS) await page.screenshot({path: SHOTS + '/paint-screen.png', fullPage: true});

  // received
  const newId = ORDERS[0].id;
  await page.click('[data-received="' + newId + '"]'); await page.waitForTimeout(200);
  c = await card(page, 'Extra White');
  check(/15\.0 gal in stock/.test(c) && /plus 11\.0 received/.test(c) && /On order none/.test(c), 'Received adds 11 gallons to stock (' + c + ')');

  // a custom colour order, prefilled from the job
  await page.click('[data-corder="Hale Navy"]');
  check(await page.inputValue('#o-1') === '1' && await page.inputValue('#o-5') === '0' && await page.inputValue('#o-job') === '#5069 SFD Abraham' &&
        await page.inputValue('#o-by') === '2026-11-23', 'custom Order is prefilled: 1 x 1 gal, the job, needed two days ahead');
  await page.fill('#o-job', '');
  await page.click('#o-save'); await page.waitForTimeout(150);
  check(/A custom colour needs the customer/.test(await text(page, '#msg')), 'a custom colour with no customer is refused');
  await page.fill('#o-job', '#5069 SFD Abraham');
  await page.click('#o-save'); await page.waitForTimeout(250);
  const co = posted.filter(x => x[0] === 'order').pop();
  check(co[1].custom === true && co[1].colour === 'Hale Navy' && co[1].needed_by === '2026-11-23', 'custom order filed as custom');
  check(/Ordered PD00003, 1\.0 gal/.test(await text(page, '#custom')), 'the custom colour now says Ordered, with its PO');

  // a failed email keeps the order and offers to send again
  MAIL_OK = false;
  await page.click('[data-order="Alabaster"]');
  check(/Customer \(optional\)/.test(await page.$eval('#panel', e => e.textContent)), 'a stocked colour says the customer is optional');
  await page.click('#o-save'); await page.waitForTimeout(250);
  check(/The order is saved, but the email to Ashley did not go/.test(await text(page, '#msg')), 'a failed email says the order is saved');
  check(!!(await page.$('[data-resend]')) && /Email not sent/.test(await text(page, '#orders')), 'and offers Send email on it');
  MAIL_OK = true;
  await page.click('[data-resend]'); await page.waitForTimeout(250);
  check(!(await page.$('[data-resend]')), 'Send email clears it once it goes');

  // an hour old sign in: the save is refused once, renewed, and goes in
  EXPIRED = true;
  await page.click('[data-count="Alabaster"]');
  await page.fill('#c-gal', '6'); await page.click('#c-save'); await page.waitForTimeout(250);
  c = await card(page, 'Alabaster');
  check(/6\.0 gal in stock/.test(c) && !/would not allow/.test(await text(page, '#msg')),
    'after the sign in runs out, a count still saves without a permission error (' + await text(page, '#msg') + ')');
  EXPIRED = true;
  await page.click('[data-received="00000000-0000-0000-0000-00000000000a"]'); await page.waitForTimeout(250);
  check(/Pearly received/.test(await text(page, '#msg')), 'and so does Received');

  // count
  await page.click('[data-count="Pearly"]');
  await page.fill('#c-gal', '7.5'); await page.click('#c-save'); await page.waitForTimeout(200);
  c = await card(page, 'Pearly');
  check(/7\.5 gal in stock/.test(c) && /Counted 7\.5 gal on Nov 19/.test(c), 'a count sets the stock (' + c + ')');
  await page.click('[data-count="Pearly"]'); await page.fill('#c-gal', ''); await page.click('#c-save');
  check(/how many gallons/.test(await text(page, '#msg')), 'a blank count is refused');
  await page.click('[data-close]');

  // other colours in stock
  c = await card(page, 'Oxford White');
  check(/3\.0 gal in stock/.test(c) && /Next 2 weeks 1\.0 gal \(7 doors\)/.test(c) && /Used up/.test(c),
    'Oxford White is in its own section: 3 counted, 7 doors on the schedule need 1.0 (' + c + ')');
  check(await page.$eval('#others', e => /Oxford White/.test(e.innerText)) && await page.$eval('#stock', e => !/Oxford White/.test(e.innerText)),
    'other colours are not mixed in with the five');
  check(/Oxford White #5073 Oxley, 7 doors, painted Mon Nov 30.*From stock, 3\.0 gal on hand/.test(await text(page, '#custom')),
    'a job in Oxford White draws on the shelf instead of asking for an order');
  check(await page.$eval('#others', e => /Hale Navy/.test(e.innerText)), 'the custom Hale Navy ordered earlier is now on the Other colours list');
  c = await card(page, 'Hale Navy');
  check(/On order 1\.0 gal/.test(c), 'Hale Navy shows 1 gallon on order (' + c + ')');

  await page.click('#newcolour');
  await page.fill('#n-name', 'Sea Salt SW 6204'); await page.fill('#n-gal', '2'); await page.click('#n-save'); await page.waitForTimeout(400);
  c = await card(page, 'Sea Salt SW 6204');
  check(/2\.0 gal in stock/.test(c), 'New paint colour adds Sea Salt with 2 gallons (' + c + ')');
  await page.click('#newcolour'); await page.fill('#n-name', 'oxford white'); await page.click('#n-save');
  check(/already on the list/.test(await text(page, '#msg')), 'the same colour twice is refused');
  await page.click('[data-close]');

  await page.click('[data-remove="Sea Salt SW 6204"]');
  check(/Remove Sea Salt SW 6204 and its counts for good/.test(await text(page, '#others')), 'Used up asks first');
  await page.click('[data-removeyes="Sea Salt SW 6204"]'); await page.waitForTimeout(400);
  check(!/Sea Salt/.test(await text(page, '#others')) && posted.some(x => x[0] === 'removed' && x[1] === 'Sea Salt SW 6204'), 'Yes removes it');

  const hn = ORDERS.find(o => o.colour === 'Hale Navy');
  await page.click('[data-received="' + hn.id + '"]'); await page.waitForTimeout(250);
  c = await card(page, 'Hale Navy');
  check(/1\.0 gal in stock/.test(c) && /Received 1\.0 gal/.test(c), 'Hale Navy received: 1 gallon on the shelf (' + c + ')');

  await page.click('[data-xorder="Oxford White"]'); await page.fill('#o-job', 'Oxley'); await page.click('#o-save'); await page.waitForTimeout(400);
  const ox = posted.filter(x => x[0] === 'order').pop();
  check(ox[1].colour === 'Oxford White' && ox[1].custom === true, 'Order on an other colour orders that colour');
  if(SHOTS) await page.screenshot({path: SHOTS + '/paint-others.png', fullPage: true});

  // settings
  await page.click('#settings summary');
  await page.fill('[data-warn="Primer"]', '5'); await page.click('#savecov'); await page.waitForTimeout(300);
  check(posted.some(x => x[0] === 'colour' && x[1] === 'Primer' && x[2].warn_gallons === 5), 'warning level saves');
  check(!posted.some(x => x[0] === 'colour' && 'price_per_gallon' in x[2]), 'no price is sent while none is typed');
  await page.fill('[data-price="Extra White"]', '$62.5'); await page.click('#savecov'); await page.waitForTimeout(300);
  check(posted.some(x => x[0] === 'colour' && x[1] === 'Extra White' && x[2].price_per_gallon === 62.5), 'a price a gallon saves (Andrew, 27 November)');
  check(await page.$$eval('[data-price]', es => es.length) >= 6 && !(await page.$('[data-price="Custom"]')), 'every colour on the shelf has a price box, Custom does not');
  c = await card(page, 'Primer');
  check(/OK/.test(c), 'primer is OK once the warning is 5 (' + c + ')');
  await page.close();

  // who may open it
  page = await open('admin');
  check(/gal in stock/.test(await text(page, '#stock')), 'an administrator opens it');
  await page.close();
  page = await open('sales');
  check(/Not one of yours/.test(await page.evaluate(() => document.body.innerText)), 'sales is turned away');
  await page.close();

  // phone width
  page = await open('manufacturing', {width:390, height:844});
  const wide = await page.evaluate(() => document.documentElement.scrollWidth);
  check(wide <= 390, 'no sideways page scroll on a phone (' + wide + ')');
  if(SHOTS) await page.screenshot({path: SHOTS + '/paint-phone.png', fullPage: true});
  await page.close();

  await b.close();
  console.log('ERRORS:', JSON.stringify(errs));
  console.log('FAILED:', JSON.stringify(failed));
  process.exit(errs.length || failed.length ? 1 : 0);
})();

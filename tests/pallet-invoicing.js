// Invoicing a pallet from the dealer portal, against a fake Supabase.
// Nothing leaves the machine.
//
//   node tests/pallet-invoicing.js
//   (or PLAYWRIGHT=/path/to/playwright node tests/pallet-invoicing.js)
//
// Marks a pallet ready to ship, opens Invoice, shows a redo has to be
// answered before going on, sets it to no charge, checks every invoice
// line is in Grinyer's names (a South Florida word stored on an old line
// is turned back into ours, and one with no match blocks the file until
// it is reworded), makes the file and reads it back. Then shows the
// invoiced order cannot be billed twice. Ends with ERRORS: [] when no
// page threw. SHOT=prefix saves pictures of both steps.

const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const path = require('path'), fs = require('fs'), http = require('http');
const ROOT = path.join(__dirname, '..');
http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]); if(p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, 'dealer-portal', p);
  if(!fs.existsSync(f)){ r.statusCode = 404; return r.end('nf'); }
  r.setHeader('Content-Type', 'text/html'); r.end(fs.readFileSync(f));
}).listen(8717);

const row = (id, style, type, product, qty, h, extra) => Object.assign({id, location:'Bed ' + id,
  qty, productType:product, doorType:type, doorStyle:style, height:h, width:30, paintColour:'Extra White',
  reRail:'NO', reStile:'NO'}, extra || {});
const order = (id, ref, rows, extra) => Object.assign({id, dealer_id:'D1', order_ref:ref, customer_name:'SFD',
  status:'in_production', door_count:rows.reduce((s, r) => s + r.qty, 0), panel_count:0,
  created_at:'2026-11-20', files:[], pallet_name:'SFD 7', form:{rows}}, extra || {});
const ORDERS = [
  order('o1', 'Cortes', [
    row('a', 'Kingston', 'Single Swing', '1.375 Hollow', 2, 80),
    row('b', '4 Panel True Shaker', 'Double Swing AST', '1.375 Solid', 2, 80, {reRail:'YES'})]),
  order('o2', 'Aris', [row('c', 'Kingston', 'Single Swing', '1.375 Hollow', 1, 80)],
        {redo_of:'o9', redo_seq:1, redo_reason:'shipping_damage'}),
  /* an older line still carrying South Florida's own words */
  order('o3', 'Baker', [row('d', 'SHAKER (TRUE), 4-PANEL', 'SINGLE SWING', '1.375 Solid', 1, 84)]),
  /* and one carrying a word nobody has mapped */
  order('o4', 'Diaz', [row('e', 'FLORIDA SPECIAL', 'Single Swing', '1.375 Hollow', 1, 80)])
];
const PRICES = [
  {style:'Kingston', size_key:"6'8|Hollow", price:150}, {style:'Kingston', size_key:"6'8|Solid", price:190},
  {style:'4 panel equal shaker', size_key:"6'8|Solid", price:300}, {style:'4 panel equal shaker', size_key:"7/0|Solid", price:320}];
const ALIAS = [{order_style:'4 Panel True Shaker', price_style:'4 panel equal shaker'}];
const EXTRAS = [{key:'reRail', amount:20}, {key:'reStile', amount:75}, {key:'astragal', amount:50},
  {key:'tAstragal', amount:80}, {key:'customPaintOrder', amount:200}, {key:'customPaintPerDoor', amount:20}];
const NAMES = [{field:'doorStyle', our_name:'4 Panel True Shaker', their_name:'SHAKER (TRUE), 4-PANEL'},
               {field:'doorType', our_name:'Single Swing', their_name:'SINGLE SWING'}];
const QBO = ['GMD-Wholesale:Kingston HC', 'GMD-Wholesale:Kingston SC', 'GMD-Wholesale:Kingston Bi Fold',
  'GMD-Wholesale:4 Panel Shaker S & R', 'GMD Doors:Rerail', 'GMD Doors:Astragal', 'GMD-Wholesale:Discount'];
let PALLET = {id:'P1', name:'SFD 7', dealer_id:'D1', dealer:'South Florida', built_on:'2026-11-22',
  doors:7, max_rows:40, ready_at:null};
let INVOICES = [{id:'old', order_id:'zz', invoice_no:'1042', charge:'charge', created_at:'2026-11-01', voided_at:null}];
let POSTED = null, SETTINGS = null, MAP = null;
const ME = {id:'a1', name:'Admin', role:'admin', active:true, email_verified_at:'2026-10-01'};

(async () => {
  const b = await chromium.launch();
  const page = await b.newPage({acceptDownloads:true}); await page.setViewportSize({width:1400, height:1000});
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.route('https://baakegbtuygtldksmant.supabase.co/**', async route => {
    const q = route.request(), u = new URL(q.url()), m = q.method();
    const j = (x, st) => route.fulfill({status:st || 200, contentType:'application/json', body:JSON.stringify(x)});
    const body = () => JSON.parse(q.postData() || 'null');
    switch(u.pathname){
      case '/auth/v1/user': return j({id:ME.id});
      case '/rest/v1/profiles': return j([ME]);
      case '/rest/v1/dealers': return j([{id:'D1', name:'South Florida', slug:'SOUTHFLORIDA', active:true}]);
      case '/rest/v1/dealer_orders': return j(ORDERS);
      case '/rest/v1/wholesale_prices': return j(PRICES);
      case '/rest/v1/wholesale_extras': return j(EXTRAS);
      case '/rest/v1/wholesale_style_alias': return j(ALIAS);
      /* the signed in admin is Grinyer's, so the page's own names are empty;
         the invoice screen asks for the pallet dealer's */
      case '/rest/v1/dealer_door_names': return j(u.search.includes('D1') ? NAMES : []);
      case '/rest/v1/pallet_totals': return j([PALLET]);
      case '/rest/v1/pallet_orders': return j(ORDERS.map((o, i) => ({order_id:o.id, pallet_id:'P1', position:i})));
      case '/rest/v1/pallets':
        if(m === 'PATCH'){ Object.assign(PALLET, body()); return j([PALLET]); }
        return j([{id:'P1', ready_at:PALLET.ready_at}]);
      case '/rest/v1/qbo_items': return j(QBO.map(name => ({name})));
      case '/rest/v1/qbo_item_map': if(m === 'POST'){ MAP = body(); return j([]); } return j([]);
      case '/rest/v1/invoice_settings': if(m === 'POST'){ SETTINGS = body(); return j([]); } return j([]);
      case '/rest/v1/dealer_invoices':
        if(m === 'POST'){
          POSTED = body();
          const made = POSTED.map((x, i) => Object.assign({id:'n' + i, created_at:'2026-11-23', voided_at:null}, x));
          INVOICES = INVOICES.concat(made); return j(made, 201);
        }
        if(u.search.includes('pallet_id=eq')) return j(INVOICES.filter(x => x.pallet_id === 'P1'));
        return j(INVOICES);
    }
    return j([]);
  });
  await page.goto('http://localhost:8717/');
  await page.evaluate(id => localStorage.setItem('gidc:session', JSON.stringify(
    {access_token:'x', refresh_token:'y', user:{id, email:'a@gidc.ca'}})), ME.id);
  await page.goto('http://localhost:8717/'); await page.waitForSelector('tr[data-open]');
  console.log('build:', await page.evaluate(() => BUILD));

  await page.click('button[data-pallets]');
  await page.click('[data-palopen="P1"]');
  const btns = () => page.$$eval('.pal-card button', x => x.map(b => b.innerText).join(' | '));
  console.log('pallet buttons, not ready:', await btns());
  await page.click('button[data-palready="P1"]');
  await page.waitForSelector('button[data-invopen]');
  console.log('pallet buttons, ready:', await btns());
  console.log('chips:', await page.$eval('.pal-h .nm', x => x.innerText));

  await page.click('button[data-invopen="P1"]');
  await page.waitForSelector('.inv-pick');
  const pickState = () => page.$$eval('.inv-pick tbody tr', rs => rs.map(r =>
    r.querySelector('b').innerText + '=' + ((r.querySelector('.inv-seg button.on') || {}).innerText || 'none')).join(', '));
  console.log('step 1:', await pickState());
  console.log('Next disabled while the redo is unanswered:', await page.$eval('button[data-invstep="2"]', x => x.disabled),
              '/', await page.$eval('.inv-pick tr.ask .inv-q', x => x.innerText));
  console.log('customer guessed:', await page.$eval('input[data-invf="qbo_customer"]', x => x.value),
              '/ first number:', await page.$eval('input[data-invf="firstNo"]', x => x.value));
  await page.click('button[data-invpick="o2"][data-v="no_charge"]');
  console.log('reason prefilled:', await page.$eval('input[data-invreason="o2"]', x => x.value));
  console.log('Next now:', await page.$eval('button[data-invstep="2"]', x => x.innerText + (x.disabled ? ' (disabled)' : '')));
  if(process.env.SHOT) await page.screenshot({path:process.env.SHOT + '-1.png', fullPage:true});

  await page.click('button[data-invstep="2"]');
  await page.waitForSelector('.inv-card');
  const cards = () => page.$$eval('.inv-card', cs => cs.map(c =>
    c.querySelector('.inv-h b').innerText + ' ' + c.querySelector('.inv-tot').innerText + '\n    ' +
    [...c.querySelectorAll('tbody tr')].map(r => {
      const v = [...r.querySelectorAll('input')].map(i => i.value);
      return v.join(' ; ') + (r.classList.contains('miss') ? '  [NEEDS PRICE]' : '') +
        ([...r.querySelectorAll('.inv-warn,.inv-note')].map(n => '  {' + n.innerText + '}').join(''));
    }).join('\n    ')).join('\n  '));
  console.log('step 2:\n  ' + await cards());
  console.log('make disabled:', await page.$eval('button[data-invmake]', x => x.disabled),
              '/', await page.$eval('.inv-foot', x => x.innerText.replace(/\s+/g, ' ')));
  if(process.env.SHOT) await page.screenshot({path:process.env.SHOT + '-2.png', fullPage:true});

  /* put the unmapped line into our words and price it */
  const diaz = await page.$$eval('.inv-card', cs => cs.findIndex(c => c.innerText.includes('Diaz')));
  const desc = (await page.$$('.inv-card'))[diaz];
  await (await desc.$('input[data-k="desc"]')).fill('Kingston · Single Swing · 6/8 · Hollow');
  await (await desc.$('input[data-k="desc"]')).dispatchEvent('change');
  await (await (await page.$$('.inv-card'))[diaz].$('input[data-k="rate"]')).fill('150');
  await (await (await page.$$('.inv-card'))[diaz].$('input[data-k="rate"]')).dispatchEvent('change');
  /* the item is typed and Make pressed straight after, with no other click
     in between, which is the order a person does it in */
  await (await (await page.$$('.inv-card'))[diaz].$('input[data-k="item"]')).fill('GMD-Wholesale:Kingston HC');
  console.log('after fixing Diaz, make disabled:', await page.$eval('button[data-invmake]', x => x.disabled));

  await page.click('button[data-invmake]');
  await page.waitForSelector('#sure .sure-card');
  console.log('confirm:', await page.$eval('#sure', x => x.innerText.replace(/\s+/g, ' ')));
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#sure [data-sure="yes"]')]);
  const csv = fs.readFileSync(await dl.path(), 'utf8');
  console.log('file:', dl.suggestedFilename());
  console.log(csv.replace(/^﻿/, ''));
  console.log('recorded:', POSTED.map(x => x.invoice_no + ' ' + x.charge + ' ' + x.total + (x.reason ? ' (' + x.reason + ')' : '')).join(', '));
  console.log('settings saved:', JSON.stringify(SETTINGS));
  console.log('items remembered:', JSON.stringify(MAP));
  const sfdWords = /SHAKER \(TRUE\)|SINGLE SWING|FLORIDA SPECIAL/;
  console.log('any South Florida word in the file:', sfdWords.test(csv));

  await page.waitForSelector('.pal-card');
  console.log('pallet after:', await page.$eval('.pal-h .nm', x => x.innerText), '/', await btns());
  const [dl2] = await Promise.all([page.waitForEvent('download'), page.click('button[data-invagain="P1"]')]);
  console.log('file again matches:', fs.readFileSync(await dl2.path(), 'utf8') === csv);

  console.log('ERRORS:', errs);
  await b.close(); process.exit(0);
})();

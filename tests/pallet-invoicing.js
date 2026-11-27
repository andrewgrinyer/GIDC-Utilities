// Invoicing a pallet from the dealer portal, against a fake Supabase.
// Nothing leaves the machine.
//
//   node tests/pallet-invoicing.js
//   (or PLAYWRIGHT=/path/to/playwright node tests/pallet-invoicing.js)
//
// Opens Invoice pallet straight away (no ready mark, any status), shows a redo has to be
// answered before going on, sets it to no charge, checks every invoice
// line is in Grinyer's names (a South Florida word stored on an old line
// is turned back into ours, and one with no match blocks the file until
// it is reworded), makes one CSV per order in a zip and reads them back. Then shows the
// invoiced order cannot be billed twice. Makes the customs papers with the
// export documents app's rules and reads them, takes an order off to see the
// warning, adds one to see the staff only chip on its line, and signs in
// as a dealer to see none of it. Ends with ERRORS: [] when no
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
    row('a', 'Kingston', 'Single Swing', '1.375 Hollow', 2, 80, {reStile:'YES', reRail:'YES'}),
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
  doors:7, max_rows:40};
let INVOICES = [{id:'old', order_id:'zz', invoice_no:'1042', charge:'charge', created_at:'2026-11-01', voided_at:null}];
let POSTED = null, SETTINGS = null, MAP = null, CUSTOMS = [], ADDED = null;
let ONPAL = ['o1', 'o2', 'o3', 'o4'];
/* one more order, not on the pallet yet */
ORDERS.push(order('o5', 'Evans', [row('f', 'Kingston', 'Single Swing', '1.375 Hollow', 1, 80)], {pallet_name:null}));
const DEALER = {id:'d9', name:'Dealer', role:'dealer', dealer_role:'dealer', dealer_id:'D1', active:true, email_verified_at:'2026-10-01'};

const ME = {id:'a1', name:'Admin', role:'admin', active:true, email_verified_at:'2026-10-01'};
let WHO = ME;

(async () => {
  const b = await chromium.launch();
  const page = await b.newPage({acceptDownloads:true}); await page.setViewportSize({width:1400, height:1000});
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.route('https://baakegbtuygtldksmant.supabase.co/**', async route => {
    const q = route.request(), u = new URL(q.url()), m = q.method();
    const j = (x, st) => route.fulfill({status:st || 200, contentType:'application/json', body:JSON.stringify(x)});
    const body = () => JSON.parse(q.postData() || 'null');
    switch(u.pathname){
      case '/auth/v1/user': return j({id:WHO.id});
      case '/rest/v1/profiles': return j([WHO]);
      case '/rest/v1/dealers': return j([{id:'D1', name:'South Florida', slug:'SOUTHFLORIDA', active:true}]);
      case '/rest/v1/dealer_orders':
        if(u.search.includes('id=in.')) return j(ORDERS.filter(o => ONPAL.indexOf(o.id) !== -1));
        return j(ORDERS);
      case '/rest/v1/wholesale_prices': return j(PRICES);
      case '/rest/v1/wholesale_extras': return j(EXTRAS);
      case '/rest/v1/wholesale_style_alias': return j(ALIAS);
      /* the signed in admin is Grinyer's, so the page's own names are empty;
         the invoice screen asks for the pallet dealer's */
      case '/rest/v1/dealer_door_names': return j(u.search.includes('D1') ? NAMES : []);
      case '/rest/v1/pallet_totals': return j([PALLET]);
      case '/rest/v1/pallet_orders':
        if(WHO !== ME) return j([]);
        if(m === 'DELETE'){ const id = u.search.match(/order_id=eq\.(\w+)/)[1]; ONPAL = ONPAL.filter(x => x !== id);
          ORDERS.find(o => o.id === id).pallet_name = null; return j([]); }
        if(m === 'POST'){ body().forEach(x => { ONPAL.push(x.order_id); ORDERS.find(o => o.id === x.order_id).pallet_name = 'SFD 7'; }); return j([], 201); }
        return j(ONPAL.map((id, i) => ({order_id:id, pallet_id:'P1', position:i})));
      case '/rest/v1/pallet_customs_docs':
        if(WHO !== ME) return j({message:'permission denied'}, 401);
        if(m === 'POST'){ CUSTOMS.unshift(Object.assign({id:'c' + CUSTOMS.length, created_at:'2026-11-23T17:50:00Z'}, body())); return j([], 201); }
        if(u.search.includes('id=eq')) return j(CUSTOMS.filter(c => u.search.includes('id=eq.' + c.id)));
        return j(CUSTOMS.map(c => Object.assign({}, c, {html: undefined})));
      case '/rest/v1/qbo_items': if(m === 'POST'){ ADDED = body(); return j([], 201); } return j(QBO.map(name => ({name})));
      case '/rest/v1/qbo_item_map': if(m === 'POST'){ MAP = body(); return j([]); }
        return j([{key:'extra:tariff', item:'GMD-Wholesale:Tariff'}]);   // an old pick, as Andrew's database has
      case '/rest/v1/invoice_settings': if(m === 'POST'){ SETTINGS = body(); return j([]); } return j([]);
      case '/rest/v1/dealer_invoices':
        if(WHO !== ME) return j({message:'permission denied'}, 401);
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
  console.log('pallet buttons:', await btns());
  /* statuses all over the place: the button does not care */
  ORDERS[1].status = 'draft'; ORDERS[2].status = 'shipped';

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
  console.log('ship to with only a name is red:', await page.$eval('textarea[data-invc="shipTo"]', x => x.classList.contains('red')));
  await page.fill('textarea[data-invc="shipTo"]', 'South Florida Doors & Closets\n2372 Some Rd\nMiami, FL 33101');
  await page.fill('input[data-invc="grossWt"]', '940');
  await page.fill('input[data-invc="waybill"]', 'BOL 5521');
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
  /* the item picker: a click shows the whole list, typing narrows it, a
     click on one sets it, and a name not on the list can be added */
  const item = async () => (await page.$$('.inv-card'))[diaz].$('input[data-k="item"]');
  await (await item()).click();
  console.log('picker on click:', await page.$$eval('.qbo-pop .qbo-opt', x => x.length), 'items shown, add offered:',
              !!(await page.$('.qbo-pop .qbo-add')));
  await (await item()).fill('kingston hc');
  console.log('picker after typing "kingston hc":', await page.$$eval('.qbo-pop .qbo-opt', x => x.map(o => o.innerText).join(', ')));
  await page.click('.qbo-pop .qbo-opt');
  console.log('picked:', await (await item()).inputValue(), '/ amber:', await (await item()).evaluate(x => x.classList.contains('amber')));
  await (await item()).click();
  await (await item()).fill('GMD Doors:Flat Slab');
  await page.click('.qbo-pop .qbo-add');
  await page.waitForTimeout(200);
  console.log('added to list:', JSON.stringify(ADDED), '/ now', await (await item()).inputValue(), 'amber:',
              await (await item()).evaluate(x => x.classList.contains('amber')));
  /* the item is typed and Make pressed straight after, with no other click
     in between, which is the order a person does it in */
  await (await (await page.$$('.inv-card'))[diaz].$('input[data-k="item"]')).fill('GMD-Wholesale:Kingston HC');
  console.log('after fixing Diaz, make disabled:', await page.$eval('button[data-invmake]', x => x.disabled));

  await page.click('button[data-invmake]');
  await page.waitForSelector('#sure .sure-card');
  console.log('confirm:', await page.$eval('#sure', x => x.innerText.replace(/\s+/g, ' ')));
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#sure [data-sure="yes"]')]);
  const unzip = f => require('child_process').execFileSync('unzip', ['-o', '-qq', f, '-d', f + '.d']) &&
    fs.readdirSync(f + '.d').sort().map(n => '--- ' + n + '\n' + fs.readFileSync(path.join(f + '.d', n), 'utf8').replace(/^\ufeff/, '')).join('\n');
  const zipPath = await dl.path();
  const csv = unzip(zipPath);
  console.log('file:', dl.suggestedFilename());
  console.log(csv);
  console.log('recorded:', POSTED.map(x => x.invoice_no + ' ' + x.charge + ' ' + x.total + (x.reason ? ' (' + x.reason + ')' : '')).join(', '));
  console.log('settings saved:', JSON.stringify(SETTINGS));
  console.log('items remembered:', JSON.stringify(MAP));
  const sfdWords = /SHAKER \(TRUE\)|SINGLE SWING|FLORIDA SPECIAL/;
  console.log('any South Florida word in the file:', sfdWords.test(csv));

  await page.waitForSelector('.pal-card');
  console.log('pallet after:', await page.$eval('.pal-h .nm', x => x.innerText), '/', await btns());
  /* invoices made before 2.14 are stored with the old tariff item and a
     negative discount; the files drawn from them must still be right */
  INVOICES.forEach(inv => (inv.lines || []).forEach(l => {
    if(/^Tariff/.test(l.desc)) l.item = (inv.invoice_no % 2) ? 'GMD-Wholesale:Tariff' : 'GMD-Wholesale-Tariff';
    if(/^Discount/.test(l.desc)){ l.rate = -l.rate; l.amount = -l.amount; }
  }));
  const [dl2] = await Promise.all([page.waitForEvent('download'), page.click('button[data-invagain="P1"]')]);
  console.log('files again:', dl2.suggestedFilename(), unzip(await dl2.path()) === csv);

  console.log('toast:', await page.$eval('#toast', x => x.innerText));
  /* every order invoiced: the screen still opens, so one can be voided */
  await page.click('button[data-invopen="P1"]');
  await page.waitForSelector('button[data-invvoid]');
  console.log('Invoices screen when all are invoiced, Void buttons:', (await page.$$('button[data-invvoid]')).length);
  /* back on step 1 the weights are the ones the papers were made with, and
     can be changed and the papers made again */
  console.log('weight shown again:', await page.inputValue('input[data-invc="grossWt"]'));
  await page.fill('input[data-invc="grossWt"]', '955');
  await page.click('button[data-invcus]');
  await page.waitForTimeout(400);
  console.log('papers made again:', CUSTOMS.length, 'weight', CUSTOMS[0].fields.grossWt, '/',
              await page.$eval('#toast', x => x.innerText));
  CUSTOMS.shift();   // the rest of the test reads the first set
  await page.evaluate(() => { state.customs = null; state.inv = null; return loadCustoms().then(c => { state.customs = c; render(); }); });
  await page.waitForSelector('.pal-card');
  /* the customs papers */
  console.log('customs kept:', CUSTOMS.length, 'orders', JSON.stringify(CUSTOMS[0].order_ids), 'total', CUSTOMS[0].total,
              'fields', JSON.stringify(CUSTOMS[0].fields));
  const html = CUSTOMS[0].html;
  fs.writeFileSync('/tmp/gidc-customs.html', html);
  const txt = html.replace(/<style[\s\S]*?<\/style>/g, '').replace(/data:image[^"]+/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  console.log('papers say:', ['Proforma Invoice', 'PLANT AND PLANT PRODUCT DECLARATION', 'Toxic Substance Control Act',
    '4418.29.8030', '4418.29.8060', 'BOL 5521', 'Miami'].map(w => w + '=' + txt.includes(w)).join(' '));
  /* the broker, 27 November: one declaration line per invoice line */
  const ciLines = (html.match(/<table class="gridbox ci-items">[\s\S]*?<\/tbody>/g) || [])
    .join('').split('<tr><td>').length - 1;
  const laLines = (html.match(/Line \d+ Facing/g) || []).length;
  console.log('declaration lines match invoice lines:', laLines, 'of', ciLines, laLines === ciLines);
  console.log('papers total line:', (txt.match(/Total USD [\d,.]+/) || [''])[0], '/ South Florida words:', sfdWords.test(txt));
  console.log('pallet card:', await page.$eval('.pal-h .nm', x => x.innerText), '/', await btns());
  const [tab] = await Promise.all([page.context().waitForEvent('page'), page.click('button[data-cusprint]')]);
  await tab.waitForLoadState(); await tab.waitForSelector('.sheet');
  console.log('print tab:', await tab.title(), '/', (await tab.$$('.sheet')).length, 'sheets');
  if(process.env.SHOT) await tab.screenshot({path:process.env.SHOT + '-3.png'});
  await tab.close();
  const [dl3] = await Promise.all([page.waitForEvent('download'), page.click('button[data-cusdl]')]);
  console.log('download:', dl3.suggestedFilename(), fs.readFileSync(await dl3.path(), 'utf8') === html);

  /* take Baker off: the papers include it */
  await page.click('button[data-palrm="o3"]');
  await page.waitForSelector('#sure .sure-card');
  console.log('taking off says:', await page.$eval('#sure .hint', x => x.innerText));
  await page.click('#sure [data-sure="yes"]');
  await page.waitForTimeout(300);
  console.log('after taking off:', await page.$eval('.pal-h .nm', x => x.innerText), '/',
              await page.$eval('.pal-card .note.bad', x => x.innerText.replace(/\s+/g, ' ')));

  /* add Evans to the invoiced pallet from the order list */
  await page.click('button[data-back]'); await page.waitForSelector('input[data-tick="o5"]');
  await page.click('input[data-tick="o5"]');
  await page.click('button[data-addpallet]');
  await page.waitForSelector('#sure .sure-card');
  await page.click('#sure [data-sure="P1"]');
  await page.waitForTimeout(400);
  console.log('adding says:', await page.$eval('#toast', x => x.innerText));
  await page.click('button[data-back]'); await page.waitForSelector('tr[data-open="o5"]');
  const line = id => page.$eval('tr[data-open="' + id + '"]', x => [...x.querySelectorAll('.chip.pal, .chip.on_hold')].map(c => c.innerText).join(' + '));
  console.log('Evans line (staff):', await line('o5'));
  console.log('Cortes line (staff):', await line('o1'));
  if(process.env.SHOT) await page.screenshot({path:process.env.SHOT + '-4.png'});

  /* the same list as the dealer */
  WHO = DEALER; const asked = [];
  page.on('request', q => { if(/dealer_invoices|pallet_customs_docs/.test(q.url())) asked.push(q.url()); });
  await page.evaluate(() => { clearPersonal(); localStorage.setItem('gidc:session', JSON.stringify(
    {access_token:'x', refresh_token:'y', user:{id:'d9', email:'d@x.ca'}})); });
  await page.goto('http://localhost:8717/'); await page.waitForSelector('tr[data-open="o5"]');
  console.log('Evans line (dealer):', await line('o5') || '(no chips)', '/ asked for invoices or papers:', asked.length);

  console.log('ERRORS:', errs);
  await b.close(); process.exit(0);
})();

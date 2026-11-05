// A custom door style on a dealer order, against a fake Supabase.
// Nothing leaves the machine.
//
//   node tests/custom-door-style.js
//   (or PLAYWRIGHT=/path/to/playwright node tests/custom-door-style.js)
//
// Opens a draft as a dealer, types a custom style name, saves it, and
// prints what the grid showed, what was saved, and what the packing list,
// the order form and a locked order say. Ends with ERRORS: [] when no
// page threw.

const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const path = require('path'), fs = require('fs'), http = require('http');
const ROOT = path.join(__dirname, '..');
http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]); if(p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, 'dealer-portal', p);
  if(!fs.existsSync(f)){ r.statusCode = 404; return r.end('nf'); }
  r.setHeader('Content-Type', 'text/html'); r.end(fs.readFileSync(f));
}).listen(8714);
const calls = [];
const row = (id, style, extra) => Object.assign({id, location:'Hall', qty:1, productType:'1.375 Hollow',
  doorType:'Single Swing', doorStyle:style, width:'30', height:'80', paintColour:'', pinStop:'', jambW:''}, extra || {});
const ORDERS = [
  {id:'o3', dealer_id:'D1', order_ref:'SFD DRAFT 1', customer_name:'SFDC', status:'draft', door_count:3, panel_count:0,
   created_at:'2026-11-05', form:{rows:[row('r1','Custom'), row('r2','Custom',{customStyle:'Barn Plank'}), row('r3','Columbia')]}},
  {id:'o4', dealer_id:'D1', order_ref:'SFD SENT 2', customer_name:'SFDC', status:'submitted', door_count:1, panel_count:0,
   created_at:'2026-11-04', form:{rows:[row('s1','Custom',{customStyle:'Pantry Reed Special', pinStop:'Pin'})]}},
];
const ME = {id:'d1', name:'Dealer', role:'dealer', dealer_role:'dealer', dealer_id:'D1', active:true, email_verified_at:'2026-10-01'};
(async () => {
  const b = await chromium.launch();
  const page = await b.newPage(); await page.setViewportSize({width:1600, height:1000});
  const errs = []; page.on('pageerror', e => errs.push(e.message)); page.on('dialog', d => d.accept());
  await page.route('https://baakegbtuygtldksmant.supabase.co/**', async route => {
    const req = route.request(), u = new URL(req.url()), m = req.method();
    calls.push(m + ' ' + u.pathname + u.search + (req.postData() ? ' ' + req.postData() : ''));
    const j = (x, s=200) => route.fulfill({status:s, contentType:'application/json', body:JSON.stringify(x)});
    if(u.pathname === '/rest/v1/profiles') return j([ME]);
    if(u.pathname === '/rest/v1/dealers') return j([{id:'D1', name:'South Florida', slug:'SOUTHFLORIDA', active:true}]);
    if(u.pathname === '/rest/v1/dealer_orders' && m === 'GET'){
      const id = /id=eq\.(\w+)/.exec(u.search);
      return j(id ? ORDERS.filter(o => o.id === id[1]) : ORDERS);
    }
    if(u.pathname === '/rest/v1/dealer_orders' && m === 'PATCH'){
      const body = JSON.parse(req.postData()); return j([Object.assign({}, ORDERS[0], body)]);
    }
    if(u.pathname === '/auth/v1/user') return j({id:ME.id});
    return j([]);
  });
  await page.goto('http://localhost:8714/');
  await page.evaluate(id => localStorage.setItem('gidc:session', JSON.stringify({access_token:'x', refresh_token:'y', user:{id, email:'d@sf.com'}})), ME.id);
  await page.goto('http://localhost:8714/');
  await page.waitForSelector('tr[data-open="o3"]');
  console.log('build:', await page.evaluate(() => BUILD));
  console.log('Custom on the list:', await page.evaluate(() => LISTS.doorStyle.slice(-2).join(', ')));

  await page.click('tr[data-open="o3"]');
  await page.waitForSelector('input.cstyle');
  console.log('name boxes:', await page.$$eval('input.cstyle', x => x.map(i => (i.dataset.r) + '=' + JSON.stringify(i.value) + (i.classList.contains('need') ? ' (needs a name)' : ''))));
  console.log('r1 checks:', await page.evaluate(() => checks(state.order.form.rows[0]).flags.map(f => (f.bad ? 'RED ' : 'AMBER ') + f.text)));
  console.log('r2 checks:', await page.evaluate(() => checks(state.order.form.rows[1]).flags.map(f => (f.bad ? 'RED ' : 'AMBER ') + f.text)));

  await page.fill('input.cstyle[data-r="r1"]', 'Walnut Slab');
  await page.press('input.cstyle[data-r="r1"]', 'Tab');
  await page.waitForTimeout(200);
  console.log('r1 after typing:', await page.evaluate(() => styleOf(state.order.form.rows[0])));
  console.log('r1 checks now:', await page.evaluate(() => checks(state.order.form.rows[0]).flags.filter(f => f.bad).length + ' red'));

  await page.click('button[data-save="1"]');
  await page.waitForTimeout(400);
  const patch = calls.filter(c => c.startsWith('PATCH /rest/v1/dealer_orders')).pop() || '';
  const saved = JSON.parse(patch.slice(patch.indexOf(' {') + 1) || '{}');
  console.log('saved rows:', ((saved.form || {}).rows || []).map(r => r.id + ' ' + r.doorStyle + (r.customStyle ? ' / ' + r.customStyle : '')));

  console.log('packing list:', await page.evaluate(() => state.order.form.rows.map((r, i) => packPanels(r, state.order, i)[0].style)));

  console.log('order form column F:', await page.evaluate(() => {
    const rows = '<sheetData>' + [9,10,11].map(n => '<row r="' + n + '"><c r="F' + n + '"/></row>').join('') + '</sheetData>';
    const out = fillSheet('<worksheet>' + rows + '</worksheet>', state.order);
    return [...out.matchAll(/<c r="F\d+"[^>]*>(.*?)<\/c>/g)].map(m => m[1].replace(/<[^>]+>/g, ''));
  }));
  if(process.env.SHOT){ await page.fill('input.cstyle[data-r="r2"]', ''); await page.press('input.cstyle[data-r="r2"]', 'Tab'); await page.waitForTimeout(200); await (await page.$('table.lines')).screenshot({path: process.env.SHOT + '.edit.png'}); await page.fill('input.cstyle[data-r="r2"]', 'Barn Plank'); await page.press('input.cstyle[data-r="r2"]', 'Tab'); }

  // picking a listed style takes the box away and the name with it
  await page.fill('input.combo-in[data-r="r1"][data-k="doorStyle"]', 'Columbia');
  await page.press('input.combo-in[data-r="r1"][data-k="doorStyle"]', 'Tab');
  await page.waitForTimeout(200);
  console.log('r1 back to Columbia:', await page.evaluate(() => JSON.stringify(state.order.form.rows[0].customStyle)), 'boxes left:', await page.$$eval('input.cstyle', x => x.length));

  // a submitted order reads it, and a custom pantry asks for pin or stop
  await page.goto('http://localhost:8714/');
  await page.waitForSelector('tr[data-open="o4"]');
  await page.click('tr[data-open="o4"]');
  await page.waitForTimeout(400);
  console.log('locked grid says:', await page.evaluate(() => [...document.querySelectorAll('table.lines td')].map(t => t.innerText.trim()).filter(t => /Custom/.test(t))));
  console.log('pantry asks pin or stop:', await page.evaluate(() => needsPinStop(state.order.form.rows[0])));

  await page.screenshot({path: process.env.SHOT || '/dev/null'}).catch(() => {});
  console.log('ERRORS:', errs);
  await b.close(); process.exit(0);
})();

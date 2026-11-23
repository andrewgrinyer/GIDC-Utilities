// Door numbers are locked in place on the dealer portal (2.21.3), against a
// fake Supabase. Nothing leaves the machine.
//
//   node tests/door-numbers.js
//
// An order of three doors typed by hand with no saved numbers: delete door
// 2 and the others keep 1 and 3; add a door and it is 4; save and every
// door carries its number; delete 4 and add again and it is 5, never 4.
// Ends with ERRORS: [] when no page threw.
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const path = require('path'), fs = require('fs'), http = require('http');
const ROOT = path.join(__dirname, '..');
http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]); if(p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, 'dealer-portal', p);
  if(!fs.existsSync(f)){ r.statusCode = 404; return r.end('nf'); }
  r.setHeader('Content-Type', 'text/html'); r.end(fs.readFileSync(f));
}).listen(8723);
const row = (id, location) => ({id, opening:'', location, doorType:'Single Swing', doorStyle:'Kingston', qty:1,
  width:'30', height:'80', productType:'1-3/8 HC', paintColour:'Pearly'});
const ORDERS = [{id:'o1', dealer_id:'D1', order_ref:'SFD NGUYEN 18', customer_name:'SFDN', status:'under_review',
  door_count:3, panel_count:3, created_at:'2026-11-20T14:00:00Z', files:[],
  form:{rows:[row('a','Front entry'), row('b','Powder'), row('c','Office')]}}];
const ME = {id:'a1', name:'Admin', role:'admin', active:true, email_verified_at:'2026-10-01'};
const saved = [];
(async () => {
  const b = await chromium.launch();
  const page = await b.newPage(); await page.setViewportSize({width:1400, height:900});
  const errs = []; page.on('pageerror', e => errs.push(e.message)); page.on('dialog', d => d.accept());
  await page.route('https://baakegbtuygtldksmant.supabase.co/**', async route => {
    const req = route.request(), u = new URL(req.url()), m = req.method();
    const j = x => route.fulfill({status:200, contentType:'application/json', body:JSON.stringify(x)});
    if(u.pathname === '/rest/v1/profiles') return j([ME]);
    if(u.pathname === '/rest/v1/dealers') return j([{id:'D1', name:'South Florida', slug:'SOUTHFLORIDA', active:true}]);
    if(u.pathname === '/rest/v1/dealer_orders' && m === 'GET'){
      const id = (u.searchParams.get('id') || '').replace(/^eq\./, '');
      return j(id ? ORDERS.filter(o => o.id === id) : ORDERS);
    }
    if(u.pathname === '/rest/v1/dealer_orders' && m === 'PATCH'){
      const body = JSON.parse(req.postData()); saved.push(body);
      Object.assign(ORDERS[0], body); return j([ORDERS[0]]);
    }
    if(u.pathname === '/auth/v1/user') return j({id:ME.id});
    return j([]);
  });
  await page.goto('http://localhost:8723/');
  await page.evaluate(id => localStorage.setItem('gidc:session', JSON.stringify({access_token:'x', refresh_token:'y', user:{id, email:'a@gidc.ca'}})), ME.id);
  await page.goto('http://localhost:8723/'); await page.waitForSelector('tr[data-open]');
  console.log('build:', await page.evaluate(() => BUILD));
  await page.click('tr[data-open="o1"] td:nth-child(2)'); await page.waitForSelector('[data-addrow]');
  const rm = async id => { await page.click('[data-rm="' + id + '"]');
    if(await page.$('#sure [data-sure="yes"]')) await page.click('#sure [data-sure="yes"]'); await page.waitForTimeout(200); };
  const nums = () => page.evaluate(() => state.order.form.rows.map(r => r.opening + ' ' + r.location).join(' | '));
  console.log('opened:', await nums());
  await rm('b');
  console.log('door 2 deleted:', await nums());
  await page.click('[data-addrow]');
  console.log('a door added:', await nums());
  await page.click('[data-adminsave]').catch(async () => { await page.click('[data-save]'); });
  await page.waitForTimeout(500);
  const last = saved[saved.length - 1];
  console.log('saved:', last ? last.form.rows.map(r => r.opening).join(',') + ' lastDoorNo ' + last.form.lastDoorNo : 'nothing saved');
  const newId = await page.evaluate(() => state.order.form.rows[2].id);
  await rm(newId);
  await page.click('[data-addrow]');
  console.log('door 4 deleted, one added:', await nums());
  console.log('grid numbers:', (await page.$$eval('#app table tbody tr td.mono', x => x.map(e => e.innerText).filter(t => /^\d+$/.test(t)))).join(','));
  console.log('packing labels:', await page.evaluate(() => state.order.form.rows.map((r, i) => packPanels(r, state.order, i)[0].openLabel).join(',')));
  console.log('ERRORS:', errs);
  await b.close(); process.exit(0);
})();

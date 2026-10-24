// The Access order number on the portal's order list, against a fake
// Supabase. Nothing leaves the machine.
//
//   node tests/order-number.js
//   (or PLAYWRIGHT=/path/to/playwright node tests/order-number.js)
//
// Prints the list's headings and rows for an administrator and a dealer,
// what saving a number sent and said, then ERRORS: [] when no page threw.

const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const path = require('path'), fs = require('fs'), http = require('http');
const ROOT = path.join(__dirname, '..');
http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]); if(p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, 'dealer-portal', p);
  if(!fs.existsSync(f)){ r.statusCode = 404; return r.end('nf'); }
  r.setHeader('Content-Type', 'text/html'); r.end(fs.readFileSync(f));
}).listen(8713);
const calls = [];
const ORDERS = [
  {id:'o1', dealer_id:'D1', order_ref:'SFD ARIS 12', customer_name:'SFDC', status:'in_production', door_count:3, panel_count:0, created_at:'2026-10-01', access_order_no:'5067'},
  {id:'o2', dealer_id:'D1', order_ref:'SFD NEWJOB 5', customer_name:'SFDC', status:'under_review', door_count:2, panel_count:0, created_at:'2026-10-02', access_order_no:null},
];
async function run(b, me, act){
  const page = await b.newPage(); await page.setViewportSize({width:1400, height:900});
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.route('https://baakegbtuygtldksmant.supabase.co/**', async route => {
    const req = route.request(), u = new URL(req.url()), m = req.method();
    calls.push(m + ' ' + u.pathname + (req.postData() ? ' ' + req.postData() : ''));
    const j = (x, s=200) => route.fulfill({status:s, contentType:'application/json', body:JSON.stringify(x)});
    if(u.pathname === '/rest/v1/profiles') return j([me]);
    if(u.pathname === '/rest/v1/dealers') return j([{id:'D1', name:'South Florida', slug:'SOUTHFLORIDA', active:true}]);
    if(u.pathname === '/rest/v1/dealer_orders' && m === 'GET') return j(ORDERS);
    if(u.pathname === '/rest/v1/rpc/gidc_set_access_order_no'){
      const p = JSON.parse(req.postData());
      if(p.p_no === '5067') return j({message:'Access job 5067 is already on SFD ARIS 12. Take it off that one first.'}, 400);
      return j({linked:true, order_no:p.p_no, order_id:Number(p.p_no)+2, last_name:'Newjob', street_number:'5'});
    }
    if(u.pathname === '/auth/v1/user') return j({id:me.id});
    return j([]);
  });
  await page.goto('http://localhost:8713/');
  await page.evaluate(id => localStorage.setItem('gidc:session', JSON.stringify({access_token:'x', refresh_token:'y', user:{id, email:'a@g.ca'}})), me.id);
  await page.goto('http://localhost:8713/');
  await page.waitForSelector('table thead');
  console.log(me.name, 'headings:', await page.$$eval('table thead th', t => t.map(x => x.innerText.trim()).filter(Boolean).join(' | ')));
  console.log(me.name, 'rows:', await page.$$eval('table tbody tr', r => r.map(x =>
    [...x.children].map(td => td.querySelector('input:not([type=checkbox]),select') ? '[' + td.querySelector('input,select').value + ']' : td.innerText.trim()).join(' | '))));
  if(act) await act(page);
  console.log(me.name, 'ERRORS:', errs);
  await page.close();
}
(async () => {
  const b = await chromium.launch();
  await run(b, {id:'a1', name:'Admin', role:'admin', dealer_role:null, active:true, email_verified_at:'2026-10-01'}, async page => {
    await page.fill('input[data-oaccno="o2"]', '7001'); await page.press('input[data-oaccno="o2"]', 'Enter');
    await page.waitForTimeout(400);
    console.log('toast:', await page.evaluate(() => (document.querySelector('.toast') || {}).innerText));
    await page.fill('input[data-oaccno="o2"]', '5067'); await page.press('input[data-oaccno="o2"]', 'Enter');
    await page.waitForTimeout(400);
    console.log('notice:', await page.evaluate(() => (document.querySelector('.note') || {}).innerText));
    console.log('box now:', await page.inputValue('input[data-oaccno="o2"]'));
  });
  await run(b, {id:'d1', name:'Dealer', role:'dealer', dealer_role:'dealer', dealer_id:'D1', active:true, email_verified_at:'2026-10-01'});
  console.log(calls.filter(c => c.includes('rpc/gidc_set')).join('\n'));
  await b.close(); process.exit(0);
})();

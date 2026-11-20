// Measurement app 2.65: search and filter the job list (customer, address,
// phone, email, quote number; Kind doors / closets / closets only), on a phone.
//
//   node tests/job-search.js
//
// Prints PASS or FAIL per check and exits 1 on any failure.
//

const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const path = require('path'), fs = require('fs'), http = require('http');
const DIR = path.join(__dirname, '..', 'measurement-app');

const server = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]); if(p === '/') p = '/index.html';
  const f = path.join(DIR, p);
  if(!f.startsWith(DIR) || !fs.existsSync(f)){ r.statusCode = 404; return r.end('nf'); }
  let body = fs.readFileSync(f);
  if(p === '/index.html') body = body.toString('utf8')
    .replace("supabaseUrl: 'https://baakegbtuygtldksmant.supabase.co'", "supabaseUrl: ''");
  r.setHeader('Content-Type', p.endsWith('.js') ? 'text/javascript' : p.endsWith('.pdf') ? 'application/pdf' :
    p.endsWith('.png') ? 'image/png' : p.endsWith('.jpg') ? 'image/jpeg' : 'text/html');
  r.end(body);
});

let fails = 0;
const check = (name, ok, got) => {
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : '  got: ' + JSON.stringify(got).slice(0, 500)));
  if(!ok) fails++;
};
(async () => {
  await new Promise(ok => server.listen(0, ok));
  const url = 'http://127.0.0.1:' + server.address().port + '/';
  const { devices } = require(process.env.PLAYWRIGHT || 'playwright');
  const browser = await chromium.launch();
  const page = await (await browser.newContext(devices['iPhone 13'])).newPage();
  const errors = []; page.on('pageerror', e => errors.push(String(e)));
  await page.goto(url); await page.waitForTimeout(300);
  await page.evaluate(() => {
    state.me = {name:'admin', role:'admin'};
    const now = Date.now();
    state.jobs = [
      {id:'j1', customer:'Smith', address:'12 Oak St', city:'Cambridge', phone:'(905) 555-0100', email:'s@x.ca', rep:'Andrew', status:'active', openings:3, closets:0, updated:now},
      {id:'j2', customer:'Patel', address:'4 Elm Ave', city:'Guelph', phone:'519 555 2222', email:'patel@y.ca', quoteNo:'Q7788', rep:'Bob', status:'closed', openings:0, closets:2, updated:now},
      {id:'j3', customer:'Nguyen', address:'9 Pine Rd', city:'Cambridge', phone:'', email:'', rep:'Bob', status:'active', openings:2, closets:1, updated:now}];
    state.job = null; state.view = 'jobs'; render();
  });
  const names = () => page.evaluate(() => [...document.querySelectorAll('#joblist .jobrow b')].map(b => b.firstChild.textContent.trim()));
  check('all three listed', (await names()).length === 3);
  check('filters are put away on a phone, search is not', await page.evaluate(() =>
    getComputedStyle(document.querySelector('.filterbar')).display === 'none' && !!document.querySelector('[data-jq]').offsetParent));
  const q = page.locator('[data-jq]');
  await q.fill('cambridge');
  check('search by city', JSON.stringify(await names()) === JSON.stringify(['Smith', 'Nguyen']), await names());
  check('the box keeps the keyboard while typing', await page.evaluate(() => document.activeElement && document.activeElement.dataset.jq !== undefined));
  await q.fill('5550100');
  check('search by phone digits', JSON.stringify(await names()) === '["Smith"]', await names());
  await q.fill('q7788');
  check('search by quote number', JSON.stringify(await names()) === '["Patel"]', await names());
  await q.fill('elm guelph');
  check('two words both have to match', JSON.stringify(await names()) === '["Patel"]', await names());
  check('count shows 1 of 3', await page.locator('#jobcount').textContent() === '1 of 3');
  await page.click('[data-cl="jqclear"]');
  check('clear search brings all back', (await names()).length === 3);
  await page.click('[data-cl="jfopen"]');
  check('Filters opens the filters', await page.evaluate(() => getComputedStyle(document.querySelector('.filterbar')).display !== 'none'));
  await page.selectOption('[data-jf="kind"]', 'closetsonly');
  check('Kind closets only', JSON.stringify(await names()) === '["Patel"]', await names());
  await page.selectOption('[data-jf="kind"]', 'closets');
  check('Kind has closets', (await names()).length === 2);
  await page.selectOption('[data-jf="status"]', 'active');
  check('status filter on top', JSON.stringify(await names()) === '["Nguyen"]', await names());
  check('Filters button shows 2 set', /2/.test(await page.locator('[data-cl="jfopen"]').textContent()));
  check('no sideways scroll', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await page.click('[data-jfclear]');
  check('Clear brings all back', (await names()).length === 3);
  check('no page errors', errors.length === 0, errors);
  if(!fails) console.log('ALL PASSED');
  await browser.close(); server.close();
  process.exit(fails ? 1 : 0);
})();

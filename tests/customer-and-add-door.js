// Measurement app 2.20: a tighter customer box, and Add door on the review.
//
//   node tests/customer-and-add-door.js
//   (or PLAYWRIGHT=/path/to/playwright node tests/customer-and-add-door.js)
//
// Serves measurement-app/ with Supabase switched off. Checks that the
// customer box is a grid that fits in a third of a tablet screen, that a job
// opened with a customer and doors shows the customer as one line until Edit,
// and that Add door on the review adds a door line, with Install YES, that
// can be filled in and priced without leaving the review.

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
  r.setHeader('Content-Type', p.endsWith('.js') ? 'text/javascript' : 'text/html');
  r.end(body);
});

let fails = 0;
const check = (name, ok, got) => {
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : '  got: ' + JSON.stringify(got).slice(0, 400)));
  if(!ok) fails++;
};

(async () => {
  await new Promise(ok => server.listen(0, ok));
  const url = 'http://127.0.0.1:' + server.address().port + '/';
  const browser = await chromium.launch();
  const page = await browser.newPage({viewport:{width:1180, height:820}});
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(url);
  await page.waitForTimeout(300);

  // a brand new job: the customer box is open, as a grid
  await page.evaluate(() => { state.me = {name:'admin', role:'admin'}; });
  await page.evaluate(() => { const j = newJob(); j.customer = ''; state.job = j; state.view = 'job';
    state.custOpen = true; render(); });
  const box = await page.$eval('.jobcard', el => el.getBoundingClientRect().height);
  check('tablet: the customer box takes under 40% of the screen', box < 820 * 0.4, box);
  const cols = await page.$eval('.jobcard .card-body', el => getComputedStyle(el).gridTemplateColumns.split(' ').length);
  check('tablet: the customer box is a grid', cols >= 6, cols);
  const opt = await page.$$eval('.jobcard label', l => l.filter(x => /optional/.test(x.textContent)).length);
  check('no "optional" on every label', opt === 0, opt);

  // a job opened with a customer and doors: one line until Edit
  await page.evaluate(() => {
    const j = newJob(); j.customer = 'Line Test'; j.address = '1 King St'; j.city = 'Cambridge';
    state.job = j; state.view = 'job'; state.custOpen = !(j.customer && j.openings.length); render(); });
  const line = await page.$eval('.custline', el => [el.textContent, el.getBoundingClientRect().height]);
  check('opened job: customer is one line', /Line Test/.test(line[0]) && /1 King St, Cambridge/.test(line[0]) && line[1] < 80, line);
  await page.click('[data-custopen="1"]');
  check('Edit customer opens the box', await page.$('.jobcard input[data-j="customer"]') !== null, null);
  await page.click('[data-custopen="0"]');
  check('Fold away folds it again', await page.$('.custline') !== null, null);

  // phone: two columns
  await page.setViewportSize({width:390, height:844});
  await page.click('[data-custopen="1"]');
  const pc = await page.$eval('.jobcard .card-body', el => getComputedStyle(el).gridTemplateColumns.split(' ').length);
  check('phone: the customer box is two columns', pc === 2, pc);
  await page.setViewportSize({width:1180, height:820});

  // the review: Add door
  await page.evaluate(() => {
    const j = state.job; j.docType = 'Estimate - Cash Web Pricing';
    const op = j.openings[0]; op.location = 'Foyer 1'; op.width = '32'; op.height = 80;
    Object.assign(op.options[0].v, {doorType:'Single Swing', productType:'1.375 Hollow', doorStyle:'Columbia'});
    applyQtyRule(op); render(); });
  await page.click('[data-review]');
  await page.waitForFunction(() => state.reviewReady, null, {timeout:15000});
  const before = await page.$$eval('table.rv-two tbody tr.rv-l1', t => t.length);
  await page.click('[data-revaddop]');
  await page.waitForTimeout(200);
  const after = await page.$$eval('table.rv-two tbody tr.rv-l1', t => t.length);
  check('Add door adds a door line to the review', after === before + 1, [before, after]);
  check('the review stays open', await page.evaluate(() => state.view) === 'review', null);
  const nd = await page.evaluate(() => { const op = state.job.openings[state.job.openings.length - 1];
    return [op.number, op.options[0].v.install, state.job.openings.length]; });
  check('the new door is opening 2 with Install YES', nd[0] === 2 && nd[1] === 'YES' && nd[2] === 2, nd);

  // fill it in on the review and it prices
  const last = 'table.rv-two tbody tr.rv-l1 >> nth=-1';
  for(const [k, v] of [['location', 'Den'], ['doorType', 'Single Swing'], ['productType', '1.375 Hollow'], ['doorStyle', 'Columbia']])
    { await page.locator(last).locator('[data-rv="' + k + '"]').selectOption(v); await page.waitForTimeout(150); }
  const w = page.locator(last).locator('[data-rv="width"]');
  if(await w.evaluate(el => el.tagName) === 'SELECT') await w.selectOption('30'); else { await w.fill('30'); await w.dispatchEvent('change'); }
  await page.waitForTimeout(150);
  const hgt = page.locator(last).locator('[data-rv="height"]');
  if(await hgt.evaluate(el => el.tagName) === 'SELECT') await hgt.selectOption({index:1}); else { await hgt.fill('80'); await hgt.dispatchEvent('change'); }
  await page.waitForTimeout(300);
  const filled = await page.evaluate(() => { const op = state.job.openings[1];
    return [op.location, op.width, String(op.height), op.options[0].v.doorStyle, cv('R' + PAGE_ROWS[1])]; });
  check('the new line fills in and gets a price', filled[0] === 'Den' && filled[1] === '30' && filled[3] === 'Columbia' &&
        typeof filled[4] === 'number' && filled[4] > 0, filled);

  check('no page errors', errors.length === 0, errors);
  await browser.close(); server.close();
  console.log(fails ? fails + ' FAILED' : 'ALL PASSED');
  process.exit(fails ? 1 : 0);
})();

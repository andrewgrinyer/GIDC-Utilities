// Measurement app 2.1: quantity follows the door type.
//
//   node tests/quantity-rules.js
//   (or PLAYWRIGHT=/path/to/playwright node tests/quantity-rules.js)
//
// Serves measurement-app/index.html with Supabase switched off, so nothing
// leaves the machine, then taps through one opening per rule and checks the
// stored quantity, what the screen says, and whether the workbook can be
// written. Prints PASS or FAIL per check and exits 1 on any failure.

const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const path = require('path'), fs = require('fs'), http = require('http');
const APP = path.join(__dirname, '..', 'measurement-app', 'index.html');

const html = fs.readFileSync(APP, 'utf8')
  .replace("supabaseUrl: 'https://baakegbtuygtldksmant.supabase.co'", "supabaseUrl: ''");
const server = http.createServer((q, r) => { r.setHeader('Content-Type', 'text/html'); r.end(html); });

let fails = 0;
const check = (name, ok, got) => {
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : '  got: ' + JSON.stringify(got)));
  if(!ok) fails++;
};

(async () => {
  await new Promise(ok => server.listen(0, ok));
  const url = 'http://127.0.0.1:' + server.address().port + '/';
  const browser = await chromium.launch();
  const page = await browser.newPage({viewport:{width:420, height:900}});
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(url); await page.evaluate(() => { const nj = newJob; window.newJob = () => { const j = nj(); delete j.sizing; j.openings.forEach(o => { delete o.openW; delete o.openH; }); return j; }; }); /* 2.31: these jobs are entered the old way */
  await page.waitForTimeout(300);

  // a job with one opening, open on screen, as a rep would have it
  await page.evaluate(() => {
    state.me = {name:'admin', role:'admin'};
    state.job = newJob(); state.job.customer = 'Test';
    state.view = 'job';
    state.openOpening = state.job.openings[0].id;
    render();
  });
  const op = () => page.evaluate(() => {
    const o = state.job.openings[0];
    return {qty:o.qty, width:o.width, miss:missing(state.job), text:document.body.innerText};
  });
  const tapType = t => page.click('[data-dtype="' + t + '"]');
  const tapWidth = w => page.click('[data-osize="width"][data-val="' + w + '"]');
  // 2.3: sizes are typed on the number pad
  const padType = async (f, digits) => {
    await page.click('[data-padof="' + f + '"]'); await page.click('#pad [data-pk="manual"]');
    if(Array.isArray(digits)) await page.click('#pad [data-pk="C"]');
    for(const k of Array.isArray(digits) ? digits : String(digits)) await page.click('#pad [data-pk="' + k + '"]');
    await page.click('#pad [data-pk="done"]');
    await page.waitForTimeout(100);
  };
  const pickProduct = p => page.click('[data-chip="productType"][data-val="' + p + '"]');
  const reset = () => page.evaluate(() => {
    state.job.openings = [newOpening(1)];
    state.openOpening = state.job.openings[0].id; render();
  });

  // single swing
  await tapType('Single Swing'); await pickProduct('1.375 Hollow');
  let s = await op();
  check('single swing sets quantity 1', s.qty === 1, s.qty);
  check('single swing quantity cannot be typed', !(await page.$('input[data-f="qty"]')), 'input shown');
  check('single swing can be written', s.miss.length === 0, s.miss);

  // double swing
  await reset(); await tapType('Double Swing AST'); await pickProduct('1.375 Hollow');
  s = await op();
  check('double swing sets quantity 2', s.qty === 2, s.qty);

  // bifold
  await reset(); await tapType('Bifold'); await pickProduct('1.375 Hollow');
  s = await op();
  check('bifold with no width offers 1 or 2', s.text.includes('A bifold is 1 or 2'), s.text);
  await tapWidth(36); s = await op();
  check('bifold 36 is quantity 1', s.qty === 1, s.qty);
  await tapWidth(48); s = await op();
  check('bifold 48 is quantity 2', s.qty === 2, s.qty);
  await tapWidth(72); s = await op();
  check('bifold 72 is quantity 2', s.qty === 2 && s.miss.length === 0, s);
  check('bifold width list stops at 72',
        !(await page.$('[data-osize="width"][data-val="76"]')) &&
        !!(await page.$('[data-osize="width"][data-val="72"]')), 'chips');
  // 2.29: up to 72 1/2 is allowed, and 36 1/2 is still one door
  await padType('width', ['7', '2', 'f4']); s = await op();
  check('bifold 72 1/2 is allowed, quantity 2', String(s.width) === '72.5' && s.qty === 2 && s.miss.length === 0, s);
  await padType('width', ['3', '6', 'f4']); s = await op();
  check('bifold 36 1/2 is quantity 1', s.qty === 1, s);
  await padType('width', ['3', '6', 'f5']); s = await op();
  check('bifold over 36 1/2 is quantity 2', s.qty === 2, s);
  await padType('width', ['7', '2', 'f4']);
  await padType('width', 80);
  s = await op();
  check('typing 80 on a bifold is refused', String(s.width) === '72.5', s.width);
  check('and the pad stays up to fix it', !!(await page.$('#pad')), 'pad closed');
  await page.click('#pad [data-pk="cancel"]');
  // a wide opening that becomes a bifold afterwards is blocked, not lost
  await reset(); await tapType('Pocket'); await pickProduct('1.375 Hollow');
  await padType('width', 80);
  await page.evaluate(() => { state.job.openings[0].options[0].v.doorType = 'Bifold'; render(); });
  s = await op();
  check('bifold over 72 blocks the workbook',
        s.miss.some(m => m.includes('not available')) && s.text.includes('not available'), s.miss);

  // bypass
  await reset(); await tapType('Bypass'); await pickProduct('1.375 Hollow');
  s = await op();
  check('bypass starts with no quantity', s.qty === '', s.qty);
  check('bypass blocks until picked', s.miss.some(m => m.includes('pick the quantity')), s.miss);
  const choices = await page.$$eval('[data-pickqty]', b => b.map(x => x.dataset.pickqty));
  check('bypass offers 2, 3 and 4', choices.join() === '2,3,4', choices);
  await page.click('[data-pickqty="3"]'); s = await op();
  check('bypass 3 picked', s.qty === 3 && s.miss.length === 0, s);

  // glass under 24
  await reset(); await tapType('Single Swing'); await pickProduct('1.375 Glass');
  await tapWidth(22); s = await op();
  check('glass at 22 warns', s.text.includes('Glass door under 24'), s.text);
  check('glass warning does not block', s.miss.length === 0, s.miss);
  await tapWidth(24); s = await op();
  check('glass at 24 does not warn', !s.text.includes('Glass door under 24'), 'warned');
  await reset(); await tapType('Single Swing'); await pickProduct('1.375 Hollow');
  await page.evaluate(() => { state.job.openings[0].options[0].v.doorStyle = '1 Lite Clear'; render(); });
  await tapWidth(20); s = await op();
  check('lite style at 20 warns', s.text.includes('Glass door under 24'), s.text);

  // other types are typed in freely, as before
  await reset(); await tapType('Barn'); s = await op();
  check('barn keeps the typed quantity box', !!(await page.$('input[data-f="qty"]')) && s.qty === 1, s.qty);

  check('no page errors', errors.length === 0, errors);
  await browser.close(); server.close();
  console.log(fails ? fails + ' FAILED' : 'ALL PASSED');
  process.exit(fails ? 1 : 0);
})();

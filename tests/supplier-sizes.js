// Measurement app 2.4: the supplier size check on the review screen.
//
//   node tests/supplier-sizes.js
//   (or PLAYWRIGHT=/path/to/playwright node tests/supplier-sizes.js)
//
// Each case is one door as a rep would enter it and what Andrew's supplier
// reference (17 Nov 2026) says about it. Then the review screen is opened
// to check the column and the list show it. Exits 1 on any failure.

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
  r.setHeader('Content-Type', p.endsWith('.js') ? 'text/javascript' : 'text/html'); r.end(body);
});

// [what, door type, product, style, width, height, qty, expected status, words in the reason]
const CASES = [
  ['Lynden panel 32 x 80', 'Single Swing', '1.375 Hollow', 'Columbia', 32, 80, 1, 'ok'],
  ['Lynden panel 38 wide', 'Single Swing', '1.375 Hollow', 'Columbia', 38, 80, 1, 'so', 'wider than the widest'],
  ['Lynden panel 20 at 8 foot orders 2\'0"', 'Single Swing', '1.375 Solid', 'Benton', 20, 96, 1, 'check', 'depends on the style'],
  ['Lynden panel at a 90 range orders 8 foot', 'Single Swing', '1.375 Hollow', 'Kingston', 30, 90, 1, 'check', 'depends on the style'],
  ['Lynden panel 12 wide: cut down', 'Single Swing', '1.375 Hollow', 'Lopez', 12, 80, 1, 'check', 'Cut down'],
  ['Lynden double swing 60: leaves 30', 'Double Swing AST', '1.375 Hollow', 'Lopez', 60, 80, 2, 'ok'],
  ['Lynden double swing 76: leaves 38', 'Double Swing AST', '1.375 Hollow', 'Lopez', 76, 80, 2, 'so', 'Each leaf'],
  ['Lynden bifold 48 at 6\'8"', 'Bifold', '1.375 Hollow', 'Kingston', 48, 80, 2, 'ok'],
  ['Lynden bifold at 7\'0"', 'Bifold', '1.375 Hollow', 'Kingston', 30, 84, 1, 'so', '6\'8" only'],
  ['Masonite 36 x 80', 'Single Swing', '1.375 Hollow', 'Riverside', 36, 80, 1, 'ok'],
  ['Masonite 40 wide', 'Single Swing', '1.375 Hollow', 'Riverside', 40, 80, 1, 'so'],
  ['Masonite 7\'0" select style', 'Single Swing', '1.375 Hollow', 'Livingston', 30, 84, 1, 'ok'],
  ['Masonite 7\'0" other style', 'Single Swing', '1.375 Hollow', 'Cheyenne', 30, 84, 1, 'so', 'not offered at 7\'0"'],
  ['Masonite 8\'0" hollow', 'Single Swing', '1.375 Hollow', 'Winslow', 30, 96, 1, 'so', 'solid core'],
  ['Masonite 8\'0" solid', 'Single Swing', '1.375 Solid', 'Winslow', 30, 96, 1, 'check', 'select styles'],
  ['Masonite bifold 48', 'Bifold', '1.375 Hollow', 'Cheyenne', 48, 80, 2, 'so'],
  ['Masonite 1 3/4"', 'Single Swing', '1.75 Thick', 'Berkley', 30, 80, 1, 'check', '1 3/4'],
  ['Flush 46 wide', 'Single Swing', '1.375 Hollow', 'Flush', 46, 80, 1, 'ok'],
  ['Flush 50 wide', 'Single Swing', '1.375 Hollow', 'Flush', 50, 80, 1, 'so', '4\'0"'],
  ['Fineline 40 wide', 'Single Swing', '1.375 Solid', 'Flat Slab', 40, 80, 1, 'check', 'select profiles'],
  ['Trimlite shaker solid 30 x 84', 'Single Swing', '1.375 Solid', '2 Panel True Shaker', 30, 84, 1, 'ok'],
  ['Trimlite shaker hollow', 'Single Swing', '1.375 Hollow', '2 Panel True Shaker', 30, 80, 1, 'so', 'solid core only'],
  ['Trimlite shaker 1 3/4"', 'Single Swing', '1.75 Thick', '5 Panel True Shaker', 30, 80, 1, 'so', '1 3/8'],
  ['1 lite glass 30 x 80', 'Single Swing', '1.375 Glass', '1 Lite Clear', 30, 80, 1, 'ok'],
  ['1 lite glass at 8\'0"', 'Single Swing', '1.375 Glass', '1 Lite Clear', 30, 96, 1, 'so', 'not stocked at 8\'0"'],
  ['1 lite glass 16 wide: not cut down', 'Single Swing', '1.375 Glass', '1 Lite Clear', 16, 80, 1, 'so', 'not cut down'],
  ['5 lite 18', 'Single Swing', '1.375 Glass', '5 Lite Clear', 18, 80, 1, 'ok'],
  ['5 lite 24', 'Single Swing', '1.375 Glass', '5 Lite Clear', 24, 80, 1, 'so'],
  ['10 lite 28', 'Single Swing', '1.375 Glass', '10 Lite Clear', 28, 80, 1, 'ok'],
  ['10 lite 34: 15 lite is usual', 'Single Swing', '1.375 Glass', '10 Lite Clear', 34, 80, 1, 'check', '15 lite is the usual'],
  ['10 lite at 7\'0"', 'Single Swing', '1.375 Glass', '10 Lite Clear', 28, 84, 1, 'ok'],
  ['15 lite 32', 'Single Swing', '1.375 Glass', '15 Lite Clear', 32, 80, 1, 'ok'],
  ['15 lite 28: 10 lite is usual', 'Single Swing', '1.375 Glass', '15 Lite Clear', 28, 80, 1, 'check', '10 lite is the usual'],
  ['15 lite at 7\'0"', 'Single Swing', '1.375 Glass', '15 Lite Clear', 32, 84, 1, 'so', 'not stocked at 7\'0"'],
  ['15 lite pair 64: leaves 32', 'Double Swing AST', '1.375 Glass', '15 Lite Clear', 64, 80, 2, 'ok'],
  ['10 lite pair 48', 'Double Swing Dummy', '1.375 Glass', '10 Lite Clear', 48, 80, 2, 'ok'],
  ['bypass 60 in 2: leaves 30', 'Bypass', '1.375 Hollow', 'Columbia', 60, 80, 2, 'ok'],
  ['bypass 96 in 2: leaves 48', 'Bypass', '1.375 Hollow', 'Columbia', 96, 80, 2, 'so'],
  ['bypass 96 in 3: leaves 32', 'Bypass', '1.375 Hollow', 'Columbia', 96, 80, 3, 'ok'],
  ['Jeld-Wen style not checked', 'Single Swing', '1.375 Hollow', 'Monroe Smooth', 30, 80, 1, 'none'],
  ['GDL not checked', 'GDL ByPass', 'GDL', 'Glissade Square Style 1', 60, 80, 2, 'none'],
  ['no size yet', 'Single Swing', '1.375 Hollow', 'Columbia', '', 80, 1, 'none'],
  ['taller than 8 foot', 'Single Swing', '1.375 Solid', 'Columbia', 30, 100, 1, 'so', 'Taller'],
];

let fails = 0;
const check = (name, ok, got) => {
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : '  got: ' + JSON.stringify(got)));
  if(!ok) fails++;
};

(async () => {
  await new Promise(ok => server.listen(0, ok));
  const url = 'http://127.0.0.1:' + server.address().port + '/';
  const browser = await chromium.launch();
  const page = await browser.newPage({viewport:{width:1280, height:900}});
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(url); await page.waitForTimeout(300);

  const got = await page.evaluate(cases => cases.map(([what, type, prod, style, w, h, q]) => {
    const op = newOpening(1); op.width = String(w); op.height = h; op.qty = q;
    Object.assign(op.options[0].v, {doorType:type, productType:prod, doorStyle:style});
    return sizeCheck(op, op.options[0]);
  }), CASES);
  CASES.forEach((c, i) => {
    const r = got[i], words = c[8];
    check(c[0] + ' -> ' + c[7], r.status === c[7] && (!words || r.why.join(' ').includes(words)), r);
  });

  // on the review screen
  await page.evaluate(cases => {
    state.me = {name:'admin', role:'admin'};
    const j = newJob(); j.customer = 'Sizes'; j.openings = [];
    [cases[0], cases[1], cases[13], cases[39]].forEach(([what, type, prod, style, w, h, q], i) => {
      const op = newOpening(i + 1); op.location = 'Den'; op.width = String(w); op.height = h; op.qty = q;
      Object.assign(op.options[0].v, {doorType:type, productType:prod, doorStyle:style});
      j.openings.push(op);
    });
    state.job = j; state.view = 'job'; render();
  }, CASES);
  await page.click('[data-review]');
  await page.waitForFunction(() => state.reviewReady, null, {timeout:15000});
  const cells = await page.$$eval('td.rv-size b', t => t.map(x => x.textContent));
  check('review: a Supplier size column, one per line', cells.join('|') === 'Stock|Special order|Special order|Not checked', cells);
  const list = await page.textContent('.rv-sizes');
  check('review: the list says which openings and why',
        list.includes('Opening 2 · Special order') && list.includes('Opening 3 · Special order') &&
        list.includes('solid core') && list.includes('1 line is not checked'), list);
  const dock = await page.textContent('#dock');
  check('review: the dock counts the special orders', dock.includes('2 special order'), dock);
  const tint = await page.$$eval('.rv-scroll tbody tr', t => t.map(x => x.classList.contains('rv-stop')));
  check('review: special order rows are tinted', tint.join() === 'false,true,true,false', tint);
  await page.screenshot({path: process.env.SHOT || '/dev/null', fullPage:true}).catch(() => {});

  check('no page errors', errors.length === 0, errors);
  await browser.close(); server.close();
  console.log(fails ? fails + ' FAILED' : 'ALL PASSED');
  process.exit(fails ? 1 : 0);
})();

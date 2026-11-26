// Measurement app 2.69: tapping the door style box on a GDL door no longer unticks the door.
// Len Gardiner, 25 Nov 2026: a GDL ByPass would not go to Review order ("none ticked").
//
//   node tests/gdl-style-tick.js
//   (or PLAYWRIGHT=/path/to/playwright node tests/gdl-style-tick.js)
//
// Prints PASS or FAIL per check and exits 1 on any failure.

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
  const browser = await chromium.launch();
  const page = await browser.newPage({viewport:{width:1280, height:900}});
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(url); await page.waitForTimeout(300);
  await page.evaluate(() => {
    state.me = {name:'admin', role:'admin'};
    const j = newJob(); j.customer = 'Len Test'; j.inHome = false; j.openings = [];
    const op = newOpening(1, null, j);
    Object.assign(op, {location:'Foyer 1', existingType:'GDL ByPass', openW:'36', openH:'78', cond:'Drywall', qty:2});
    Object.assign(op.options[0].v, {doorType:'GDL ByPass', productType:'GDL'});
    applyQtyRule(op); j.openings.push(op);
    state.job = j; state.view = 'job'; state.openOpening = op.id; state.editOption = op.options[0].id; render();
  });
  const style = '.opt-edit input[data-v="doorStyle"]';
  check('a GDL door has a style box limited to GDL styles', await page.$eval(style, e => !!e.dataset.only));
  await page.click(style); await page.waitForTimeout(150);
  const after = await page.evaluate(() => ({inc: state.job.openings[0].options.map(o => o.include),
    head: document.querySelector('.card.door .card-head span').textContent, dock: document.querySelector('#dock .count').textContent}));
  check('tapping the style box keeps the door ticked', after.inc.every(Boolean), after);
  check('the opening does not say none ticked', !/none ticked/.test(after.head), after.head);
  check('the dock does not ask to pick the door type', !/pick the door type/.test(after.dock), after.dock);
  // pick a style from the list, then Review order opens with one line
  const first = await page.evaluate(() => gdlStyles('GDL ByPass')[0]);
  await page.fill(style, first); await page.keyboard.press('Enter'); await page.waitForTimeout(150);
  await page.click('body', {position:{x:5, y:5}}); await page.waitForTimeout(150);
  const v = await page.evaluate(() => ({inc: state.job.openings[0].options[0].include, style: state.job.openings[0].options[0].v.doorStyle, n: included(state.job)}));
  check('picking a GDL style keeps the door ticked', v.inc && v.n === 1, v);
  check('Review order is not greyed', await page.$eval('[data-review]', b => !b.disabled), 'disabled');
  await page.click('[data-review]');
  await page.waitForFunction(() => state.reviewReady, null, {timeout:15000});
  check('Review order opens', await page.evaluate(() => state.view === 'review' && document.querySelectorAll('table.rv-two tbody tr.rv-l1').length === 1), 'not open');
  // Quote this still picks one option out of two
  await page.evaluate(() => { state.view = 'job'; document.body.classList.remove('reviewing');
    const op = state.job.openings[0], o2 = newOption({}); o2.v.doorType = 'GDL ByPass'; o2.v.productType = 'GDL'; op.options.push(o2); render(); });
  await page.click('[data-only]:not(input)'); await page.waitForTimeout(150);
  check('Quote this still leaves just that option ticked', await page.evaluate(() => state.job.openings[0].options.map(o => o.include).join()) === 'true,false', 'wrong ticks');
  check('no page errors', errors.length === 0, errors);
  await browser.close(); server.close();
  console.log(fails ? fails + ' FAILED' : 'ALL PASSED');
  process.exit(fails ? 1 : 0);
})();

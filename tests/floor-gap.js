// Measurement app 2.55: estimated floor gap under swing doors (opening height
// less door height, at least 1/2"), on the card and on the review.
//
//   node tests/floor-gap.js
//   (or PLAYWRIGHT=/path/to/playwright node tests/floor-gap.js)
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
  await page.goto(url); await page.waitForTimeout(300);
  page.on('pageerror', e => errors.push(e.message));
  const r = await page.evaluate(() => {
    state.me = {name:'admin', role:'admin'};
    const j = newJob(); j.customer = 'Gap Test'; j.inHome = false; j.openings = [];
    const add = (type, W, H, cond, extra) => {
      const op = newOpening(j.openings.length + 1, null, j);
      Object.assign(op, {location:'Foyer 1', existingType:type, openW:String(W), openH:String(H), cond}, extra || {});
      Object.assign(op.options[0].v, {doorType:type, productType:'1.375 Hollow', doorStyle:'Kingston', install:'YES', paintColour:'STD White',
        handleType:type === 'Bifold' ? 'Bifold Knob' : 'Passage'});
      applyQtyRule(op); j.openings.push(op); return op;
    };
    const a = add('Single Swing', 30.25, 81, 'Jamb');          // 80 uncut: 1"
    const b = add('Single Swing', 30.25, 80.5, 'Jamb');        // 80 cut to 79 13/32: gap 1 3/32 ~ 1 1/8
    const c = add('Single Swing', 30.25, 82, 'Jamb');          // 80 uncut (gap up to 1 1/4)? or 84 cut
    const d = add('Single Swing', 30.25, 81, 'Jamb', {doorH:'80.75'}); // typed: 1/4, shown as the 1/2 minimum
    const e = add('Bifold', 30, 81, 'Jamb');                   // not a swing: no note
    const f = add('Single Swing', 32, 82, 'Rough Opening', {jambW:'4.625', swingDir:'LI'}); // we do the jamb: 1/2" (Andrew)
    state.job = j; state.view = 'job'; state.openOpening = a.id; render();
    const card = (document.querySelector('.card.is-open .gap-note') || {}).textContent || '';
    return {gaps:j.openings.map(op => floorGap(op, op.options[0])), plans:j.openings.map(op => { const P = openPlan(op, op.options[0]); return P && [P.finH, P.blankH]; }), card};
  });
  check('80 door uncut in an 81 opening: 1"', r.gaps[0] === 1, r);
  check('gap is opening less door height, to the eighth', r.gaps[1] === Math.max(0.5, Math.round((80.5 - r.plans[1][0]) * 8) / 8), r);
  check('82 opening: opening less the door worked out', r.gaps[2] === Math.max(0.5, Math.round((82 - r.plans[2][0]) * 8) / 8), r);
  check('typed door height leaving 1/4: shown as the 1/2 minimum', r.gaps[3] === 0.5, r);
  check('bifold: no floor gap note', r.gaps[4] === null, r);
  check('rough opening (we do the jamb): 1/2"', r.gaps[5] === 0.5, r);
  check('the opening card shows it', r.card === 'Estimated floor gap 1"', r.card);
  const rv = await page.evaluate(async () => { await openReview();
    return [...document.querySelectorAll('.rv-gap')].map(e => e.textContent); });
  check('the review shows it under the height, swing doors only', rv.length === 5 && rv[0] === 'floor gap 1"' && rv[3] === 'floor gap 1/2"' && rv[4] === 'floor gap 1/2"', rv);
  // 2.55: the reviewed order question comes first on Print, Sign and Send Estimate
  const btns = await page.evaluate(() => [...document.querySelectorAll('#dock button')].map(b => b.textContent));
  check('buttons say Send Estimate', btns.includes('Send Estimate'), btns);
  for(const sel of ['[data-revprint]', '[data-sign]', '[data-quote]']){
    await page.click(sel); await page.waitForTimeout(150);
    const t = await page.locator('#sure').innerText().catch(() => '');
    check(sel + ' asks whether the order was fully reviewed', /fully reviewed/.test(t) && /responsible for any errors or omissions/.test(t), t);
    await page.click('#sure [data-sure="no"]'); await page.waitForTimeout(100);
  }
  check('Cancel leaves nothing open', await page.locator('.signpad').count() === 0);
  check('no page errors', !errors.length, errors);
  await browser.close(); server.close();
  console.log(fails ? fails + ' FAILED' : 'ALL PASSED');
  process.exit(fails ? 1 : 0);
})();

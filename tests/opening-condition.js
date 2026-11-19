// Measurement app 2.41: what the opening has (Jamb, Drywall, Rough Opening).
//
//   node tests/opening-condition.js
//
// A jamb with a non swing door there now and a swing door going in charges
// router and stop; a swing for a swing needs nothing. A rough opening (and
// drywall) asks for the jamb width, 4 5/8, 6 5/8 or typed, which goes on the
// door's line, and the workbook waits for it. Prints PASS or FAIL per check.

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
  const page = await browser.newPage({viewport:{width:390, height:900}});
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(url); await page.waitForTimeout(300);
  const setup = (now, to) => page.evaluate(([now, to]) => {
    state.me = {name:'admin', role:'admin'}; state.job = newJob(); state.job.customer = 'Cond';
    const op = state.job.openings[0]; op.existingType = now; op.openW = '30'; op.openH = '80.5';
    Object.assign(op.options[0].v, {doorType:to, productType:'1.375 Hollow', doorStyle:'Kingston'}); op.options[0].include = true;
    state.view = 'job'; state.openOpening = op.id; render();
  }, [now, to]);
  const v = () => page.evaluate(() => { const op = state.job.openings[0], o = op.options[0];
    return {rs:o.v.routerStop, jamb:o.v.jamb, cond:op.cond, miss:missing(state.job).join('|'),
            note:(document.querySelector('.cond-note') || {}).textContent || ''}; });

  await setup('Bifold', 'Single Swing');
  check('the card has Jamb, Drywall, Rough Opening', (await page.$$eval('[data-cond]', b => b.map(x => x.textContent))).join() ===
        'Jamb,Drywall,Rough Opening', null);
  await page.click('[data-cond="Jamb"]'); await page.waitForTimeout(100);
  let r = await v();
  check('jamb, bifold now, swing going in: router and stop YES', r.rs === 'YES' && /router and stop/i.test(r.note), r);
  await page.evaluate(() => { state.job.openings[0].existingType = 'Single Swing'; render(); });
  r = await v();
  check('swing for a swing: nothing added (router and stop back off)', r.rs === '' && !r.note, r);
  await page.click('[data-cond="Rough Opening"]'); await page.waitForTimeout(100);
  r = await v();
  check('rough opening asks for the jamb before the workbook', /jamb width \(rough opening\)/.test(r.miss), r);
  await page.click('[data-jambpick="4.625"]'); await page.waitForTimeout(100);
  r = await v();
  check('4 5/8 goes on the line', r.jamb === 4.625 && !/jamb width/.test(r.miss), r);
  await page.click('[data-padof="jambW"]');
  check('Other opens the number pad', !!(await page.$('#pad .pad-keys')), null);
  for(const k of ['C', '7', 'f2']) await page.click('#pad [data-pk="' + k + '"]');
  await page.click('#pad [data-pk="done"]'); await page.waitForTimeout(100);
  r = await v();
  check('a typed jamb (7 1/4) goes on the line', r.jamb === 7.25, r);
  await page.click('[data-cond="Drywall"]'); await page.waitForTimeout(100);
  r = await v();
  check('drywall keeps the jamb', r.jamb === 7.25, r);
  await page.click('[data-cond="Drywall"]'); await page.waitForTimeout(100);
  r = await v();
  check('no condition: the jamb set by the rule comes off', r.jamb === '' && r.cond === '', r);

  check('no page errors', !errors.length, errors);
  await browser.close(); server.close();
  console.log(fails ? fails + ' FAILED' : 'ALL PASSED');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

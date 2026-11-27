// Measurement app 2.68: Back goes to the screen before (Andrew, 24 Nov),
// the on screen Back buttons and the phone or browser back alike.
//
//   node tests/back-button.js
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
const where = page => page.evaluate(() => state.view + (state.job ? ':' + (state.job.customer || '') : ''));
(async () => {
  await new Promise(ok => server.listen(0, ok));
  const url = 'http://127.0.0.1:' + server.address().port + '/';
  const browser = await chromium.launch();
  const { devices } = require(process.env.PLAYWRIGHT || 'playwright');
  const ctx = await browser.newContext(devices['iPhone 13']);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto('about:blank');
  await page.goto(url); await page.waitForTimeout(300);
  // two saved jobs, as on a phone with this device only mode
  await page.evaluate(async () => {
    state.me = {name:'admin', role:'admin'};
    for(const n of ['Ann Lee', 'Bob Roy']){
      const j = newJob(); j.customer = n; j.address = '1 Main St';
      Object.assign(j.openings[0], {location:'Foyer 1', existingType:'Single Swing', openW:'32', openH:'80', cond:'Jamb'});
      Object.assign(j.openings[0].options[0].v, {doorType:'Single Swing', productType:'1.375 Hollow', doorStyle:'Kingston', install:'YES'});
      await saveJob(j);
    }
    state.jobs = await loadIndex(); state.view = 'jobs'; render();
  });
  const id = name => page.evaluate(n => state.jobs.find(j => j.customer === n).id, name);
  const tap = async sel => { await page.click(sel); await page.waitForTimeout(250); };

  await tap('[data-open="' + await id('Ann Lee') + '"]');
  check('a job opens from the list', await where(page) === 'job:Ann Lee', await where(page));
  await tap('.cl-switch [data-cl="closets"]');
  check('its closets open', await where(page) === 'closets:Ann Lee', await where(page));
  await tap('.cl-switch [data-cl="doors"]');
  await tap('[data-review]'); await page.waitForTimeout(1500);
  check('then its review', await where(page) === 'review:Ann Lee', await where(page));

  await page.goBack(); await page.waitForTimeout(500);
  check('phone back from the review goes to the doors screen it came from', await where(page) === 'job:Ann Lee', await where(page));
  await page.goBack(); await page.waitForTimeout(500);
  check('back again goes to the closets screen before that', await where(page) === 'closets:Ann Lee', await where(page));
  await page.goBack(); await page.waitForTimeout(500);
  check('back again goes to the doors screen', await where(page) === 'job:Ann Lee', await where(page));
  await page.goBack(); await page.waitForTimeout(500);
  check('and back again to the job list, not out of the app', await where(page) === 'jobs' && !!(await page.$('#joblist')), await where(page));
  await page.goForward(); await page.waitForTimeout(800);
  check('forward opens the job again', await where(page) === 'job:Ann Lee', await where(page));

  // the on screen Back buttons step back the same way
  await tap('[data-review]'); await page.waitForTimeout(1500);
  await tap('[data-revback]');
  check('Back on the review goes to the job', await where(page) === 'job:Ann Lee', await where(page));
  await tap('.cl-switch [data-cl="closets"]');
  await tap('[data-clback]');
  check('Back on closets goes to the screen before it', await where(page) === 'job:Ann Lee', await where(page));
  if(await page.$('[data-custopen="1"]')) await tap('[data-custopen="1"]');
  await page.fill('[data-j="phone"]', '519 555 0101'); await page.dispatchEvent('[data-j="phone"]', 'change');
  await tap('[data-back]'); await page.waitForTimeout(400);
  check('Back on the job goes to the list', await where(page) === 'jobs', await where(page));
  check('and the change made on the job was saved', await page.evaluate(async id => (await loadJob(id)).phone, await id('Ann Lee')) === '519 555 0101');

  // a second job, then back through both
  await tap('[data-open="' + await id('Bob Roy') + '"]');
  await page.goBack(); await page.waitForTimeout(500);
  check('back from the second job goes to the list', await where(page) === 'jobs', await where(page));
  await page.goForward(); await page.waitForTimeout(800);
  check('forward goes to the second job, not the first', await where(page) === 'job:Bob Roy', await where(page));
  await tap('[data-back]');
  check('screen Back from it goes to the list', await where(page) === 'jobs', await where(page));
  await page.goBack(); await page.waitForTimeout(600);
  check('the list is the first screen, so phone back from it leaves the app', page.url() === 'about:blank', page.url());
  check('no page errors', errors.length === 0, errors);
  console.log(fails ? fails + ' FAILED' : 'ALL PASSED');
  await browser.close(); server.close(); process.exit(fails ? 1 : 0);
})();

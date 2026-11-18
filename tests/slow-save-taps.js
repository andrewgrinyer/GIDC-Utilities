// Measurement app 2.30: door type chips "stick" on a slow or failing
// connection. Every tap used to save to Supabase first and redraw after, so
// a slow save left the chip unchanged (a second tap then counted as a double
// tap) and a failed save never redrew at all.
//
//   node tests/slow-save-taps.js
//
// Serves measurement-app/ with the Supabase address pointed at this test
// server, which answers job saves slowly (1.5 s), or with an error, and
// records the order saves arrive in.

const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const path = require('path'), fs = require('fs'), http = require('http');
const DIR = path.join(__dirname, '..', 'measurement-app');
const TYPES = {'.js':'text/javascript', '.png':'image/png', '.jpg':'image/jpeg', '.pdf':'application/pdf'};
let fails = 0;
const check = (name, ok, got) => {
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : '  got: ' + String(JSON.stringify(got)).slice(0, 400)));
  if(!ok) fails++;
};
const db = {delay:1500, fail:false, saves:[]};
let origin = '';
const body = q => new Promise(ok => { let b = ''; q.on('data', c => b += c); q.on('end', () => ok(b)); });
const server = http.createServer(async (q, r) => {
  const u = decodeURIComponent(q.url.split('?')[0]);
  const send = (code, obj) => { r.writeHead(code, {'Content-Type':'application/json'}); r.end(JSON.stringify(obj)); };
  if(u === '/rest/v1/jobs' && q.method === 'POST'){
    const row = JSON.parse(await body(q));
    const types = row.data.openings[0].options.map(o => o.v.doorType).join(',');
    await new Promise(ok => setTimeout(ok, db.delay));
    if(db.fail) return send(503, {error:'down'});
    db.saves.push(types); return send(201, []);
  }
  if(u.startsWith('/rest/') || u.startsWith('/auth/') || u.startsWith('/functions/')) return send(200, []);
  const p = u === '/' ? '/index.html' : u, f = path.join(DIR, p);
  if(!f.startsWith(DIR) || !fs.existsSync(f)){ r.statusCode = 404; return r.end('nf'); }
  let out = fs.readFileSync(f);
  if(p === '/index.html') out = out.toString('utf8').replace("supabaseUrl: 'https://baakegbtuygtldksmant.supabase.co'", "supabaseUrl: '" + origin + "'");
  r.setHeader('Content-Type', TYPES[path.extname(p)] || 'text/html'); r.end(out);
});

(async () => {
  await new Promise(ok => server.listen(0, ok));
  origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch();
  const page = await browser.newPage({viewport:{width:820, height:1180}, hasTouch:true});
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(origin + '/'); await page.waitForTimeout(400);
  await page.evaluate(() => {
    state.me = {name:'Sam Rep', role:'sales'};
    state.job = newJob(); state.job.customer = 'Slow';
    state.view = 'job'; state.openOpening = state.job.openings[0].id;
    state.editOption = state.job.openings[0].options[0].id; render();
  });
  const on = t => page.evaluate(t => (document.querySelector('[data-dtype="' + t + '"]').className || '').split(' ').includes('on'), t);
  const types = () => page.evaluate(() => state.job.openings[0].options.map(o => o.v.doorType));

  // 1. a slow save: the chip changes at once
  await page.click('[data-dtype="Bifold"]'); await page.waitForTimeout(150);
  check('slow connection: the tapped chip lights at once', await on('Bifold'), await types());
  await page.waitForTimeout(500);       // past the double tap window, save still on its way
  await page.click('[data-dtype="Bifold"]'); await page.waitForTimeout(150);
  check('tapping it again clears it at once, while the first save is still going', !(await on('Bifold')), await types());
  await page.click('[data-dtype="Bypass"]'); await page.waitForTimeout(600);
  await page.click('[data-dtype="Single Swing"]'); await page.waitForTimeout(150);
  check('switching type follows each tap', await on('Single Swing') && !(await on('Bypass')), await types());
  await page.waitForTimeout(7000);
  check('saves land one at a time in the order tapped, the last one last',
    db.saves.length === 4 && db.saves[db.saves.length - 1] === 'Single Swing', db.saves);

  // 2. a failing save: the screen still follows the taps, and says it did not save
  db.fail = true; db.delay = 300;
  await page.click('[data-dtype="Pocket"]'); await page.waitForTimeout(150);
  check('failed save: the chip still changes', await on('Pocket'), await types());
  await page.waitForTimeout(600);
  const toast = await page.evaluate(() => (document.querySelector('.toast') || {}).textContent || '');
  check('and it says it was not saved', /Not saved/.test(toast), toast);
  await page.click('[data-dtype="Pocket"]'); await page.waitForTimeout(150);
  check('the chip can still be tapped off after a failed save', !(await on('Pocket')), await types());
  db.fail = false;
  await page.click('[data-dtype="Bifold"]'); await page.waitForTimeout(1200);
  check('once the connection is back the next save carries the whole job', db.saves[db.saves.length - 1] === 'Bifold', db.saves);

  check('no page errors', errors.length === 0, errors);
  await browser.close(); server.close();
  console.log(fails ? fails + ' FAILED' : 'ALL PASSED');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

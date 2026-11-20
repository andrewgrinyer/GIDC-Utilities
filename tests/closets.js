// Measurement app 2.64: closet organizer measurements (Doors | Closets),
// three standard drawings, Draw your own with straight and angled walls,
// sizes on the big number pad, windows and obstructions, notes, print.
//
//   node tests/closets.js
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
  const { devices } = require(process.env.PLAYWRIGHT || 'playwright');
  const ctx = await browser.newContext(devices['iPhone 13']);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(url); await page.waitForTimeout(300);
  await page.evaluate(() => {
    state.me = {name:'admin', role:'admin'};
    const j = newJob(); j.customer = 'Closet Test'; j.address = '1 Main St'; j.city = 'Cambridge'; j.openings = [];
    state.job = j; state.view = 'job'; render();
  });
  // 2.64.3: New job starts with no door; Add a closet or Add a door opening
  await page.evaluate(() => { state.job = null; state.view = 'jobs'; render(); });
  await page.click('[data-new]');
  check('New job starts with no door', await page.evaluate(() => state.job.openings.length === 0 && /Start with a door or a closet/.test(document.getElementById('app').textContent)));
  await page.click('.cl-start [data-cl="newcloset"]');
  check('Add a closet goes to the closet screen with one closet open', await page.evaluate(() =>
    state.view === 'closets' && state.job.closets.length === 1 && state.closetOpen === state.job.closets[0].id && state.job.openings.length === 0));
  await page.evaluate(() => { state.job = null; state.view = 'jobs'; render(); });
  await page.click('[data-new]');
  await page.click('.cl-start [data-addop]');
  check('Add a door opening adds opening 1 and opens it', await page.evaluate(() =>
    state.job.openings.length === 1 && state.openOpening === state.job.openings[0].id && !!document.querySelector('.card.door.is-open')));
  // 2.64.2: a closets only job. The new job's empty opening comes off with the first closet
  await page.evaluate(() => { state.job = newJob(); state.job.customer = 'Closets Only'; state.view = 'job'; render(); });
  check('a new job starts with one empty opening', await page.evaluate(() => state.job.openings.length === 1 && blankOpening(state.job.openings[0])));
  await page.click('.cl-switch [data-cl="closets"]'); await page.click('[data-cl="add"]');
  check('first closet takes the empty opening off', await page.evaluate(() => state.job.openings.length === 0 && state.job.closets.length === 1));
  await page.click('.cl-switch [data-cl="doors"]');
  check('doors screen says closets only, nothing asks for a door', await page.evaluate(() =>
    /closets only/i.test(document.getElementById('app').textContent) && /Closets only/.test(document.getElementById('dock').textContent) &&
    !/Opening 1/.test(document.getElementById('dock').textContent) && missing(state.job).every(m => !/^Opening/.test(m))));
  check('job list row says closets only', await page.evaluate(() => jobCounts({openings:0, closets:2}) === '2 closets (closets only)' &&
    jobCounts({openings:3, closets:1}) === '3 openings \u00b7 1 closet' && jobCounts({openings:0}) === '0 openings'));
  await page.evaluate(() => { const j = newJob(); j.openings[0].location = 'Foyer 1'; state.job = j; state.view = 'closets'; render(); });
  await page.click('[data-cl="add"]');
  check('an opening with anything on it stays', await page.evaluate(() => state.job.openings.length === 1));
  await page.evaluate(() => {
    const j = newJob(); j.customer = 'Closet Test'; j.address = '1 Main St'; j.city = 'Cambridge'; j.openings = [];
    state.job = j; state.view = 'job'; render();
  });
  const keys = async s => { for(const k of s){ await page.click('#pad [data-pk="' + k + '"]'); } };
  check('the job screen has the Doors | Closets switch', await page.locator('.cl-switch [data-cl="closets"]').count() === 1);
  await page.click('.cl-switch [data-cl="closets"]');
  check('Closets screen opens', await page.evaluate(() => state.view === 'closets'));
  await page.click('[data-cl="add"]');
  check('a closet is added and opened', await page.evaluate(() => state.job.closets.length === 1 && state.closetOpen === state.job.closets[0].id));
  check('four drawing choices', await page.locator('.cl-shape').count() === 4);
  // location from the same list as the doors
  const loc = await page.evaluate(() => LISTS.location[0]);
  const locIn = page.locator('[data-clloc]');
  if(await locIn.evaluate(e => e.tagName) === 'SELECT') await locIn.selectOption(loc);
  else { await locIn.fill(loc); await locIn.dispatchEvent('change'); }
  check('location saved from the door list', await page.evaluate(l => state.job.closets[0].location === l, loc), loc);
  // reach in: A to E then ceiling, Done moves on
  await page.click('[data-cl="shape"][data-k="reach"]');
  check('reach in has walls A to E', await page.locator('.cl-dims .cl-dim').count() === 6);
  await page.click('.cl-dims [data-k="A"]');
  check('the big number pad opens, not the size picker', await page.locator('#pad .pad-keys').count() === 1 && await page.locator('#pad .pick-card').count() === 0);
  await keys(['2','4','f4','done']);
  check('A saved 24 1/2 and the pad moved on to B', await page.evaluate(() => state.job.closets[0].dims.A === '24.5' && pad && pad.key === 'B'));
  for(const v of ['30','96','30','24']) { await keys([...v, 'done']); }
  await keys(['9','6','done']);
  const c0 = await page.evaluate(() => state.job.closets[0]);
  check('every wall and the ceiling in', c0.dims.E === '24' && c0.ceiling === '96' && !await page.evaluate(() => !!pad), c0);
  // a window on wall C
  await page.click('[data-cl="madd"]');
  await page.locator('[data-clmark="wall"]').selectOption('C');
  await page.click('.cl-mdims [data-k$=":from"]'); await keys(['1','2','done']);
  await page.click('.cl-mdims [data-k$=":size"]'); await keys(['3','6','done']);
  const mk = await page.evaluate(() => state.job.closets[0].marks[0]);
  check('window on wall C, 12 from the corner, 36 wide', mk.wall === 'C' && mk.from === '12' && mk.size === '36', mk);
  // notes
  await page.fill('[data-clnote]', 'Baseboard 4", remove old shelf');
  await page.locator('[data-clnote]').dispatchEvent('change');
  check('notes saved', await page.evaluate(() => state.job.closets[0].note === 'Baseboard 4", remove old shelf'));
  // walk in has a door size
  await page.click('[data-cl="add"]');
  await page.click('.cl-card.is-open [data-cl="shape"][data-k="walk"]');
  check('walk in asks for the door opening', await page.locator('.cl-card.is-open .cl-dims [data-k="Door"]').count() === 1);
  // draw your own: straight, then angled
  await page.click('[data-cl="add"]');
  await page.click('.cl-card.is-open [data-cl="shape"][data-k="custom"]');
  const tap = async (gx, gy) => {
    const p = await page.evaluate(([gx, gy]) => { const s = document.querySelector('svg[data-cl="grid"]'); const m = s.getScreenCTM();
      const pt = s.createSVGPoint(); pt.x = gx * CL_U; pt.y = gy * CL_U; const q = pt.matrixTransform(m); return [q.x, q.y]; }, [gx, gy]);
    await page.mouse.click(p[0], p[1]); await page.waitForTimeout(30);
  };
  await tap(2, 8); await tap(2, 2); await tap(9, 2.3); await tap(12, 2);
  let pts = await page.evaluate(() => state.job.closets[2].pts);
  check('straight walls: a tap off line snaps straight and the same direction makes the wall longer', JSON.stringify(pts) === '[[2,8],[2,2],[12,2]]', pts);
  await page.click('[data-cl="free"]');
  await tap(14, 5);
  pts = await page.evaluate(() => state.job.closets[2].pts);
  check('angled walls: the line goes to the dot tapped', JSON.stringify(pts[3]) === '[14,5]', pts);
  // drag a finger: a wobbly U from scratch on a fourth closet, straight walls
  await page.click('[data-cl="add"]');
  await page.click('.cl-card.is-open [data-cl="shape"][data-k="custom"]');
  const gp = (gx, gy) => page.evaluate(([gx, gy]) => { const s = document.querySelector('svg[data-cl="grid"]'); const m = s.getScreenCTM();
      const pt = s.createSVGPoint(); pt.x = gx * CL_U; pt.y = gy * CL_U; const q = pt.matrixTransform(m); return [q.x, q.y]; }, [gx, gy]);
  const drag = async path => { await page.evaluate(() => document.querySelector('svg[data-cl="grid"]').scrollIntoView({block:'center'})); let p = await gp(...path[0]); await page.mouse.move(...p); await page.mouse.down();
    for(const q of path.slice(1)){ p = await gp(...q); await page.mouse.move(...p, {steps:12}); } await page.mouse.up(); await page.waitForTimeout(50); };
  await drag([[3,10],[3.2,6],[2.9,3],[8,3.2],[13,2.9],[13.1,7],[12.9,10]]);
  let dp = await page.evaluate(() => state.job.closets[3].pts);
  check('a dragged U becomes three straight walls', JSON.stringify(dp) === '[[3,10],[3,3],[13,3],[13,10]]', dp);
  await drag([[13,10],[11,10]]);
  dp = await page.evaluate(() => state.job.closets[3].pts);
  check('a second drag carries on from the end', JSON.stringify(dp[4]) === '[11,10]', dp);
  await page.click('.cl-card.is-open [data-cl="undo"]');
  await page.click('.cl-card.is-open [data-cl="free"]');
  await drag([[13,10],[10,12]]);
  dp = await page.evaluate(() => state.job.closets[3].pts);
  check('angled walls drag to the dot', JSON.stringify(dp[4]) === '[10,12]', dp);
  await page.click('.cl-card.is-open [data-cl="rm"]'); await page.click('[data-sure="yes"]');
  await page.click('.cl-card:nth-of-type(3) [data-cl="toggle"]').catch(() => {});
  await page.evaluate(() => { state.closetOpen = state.job.closets[2].id; render(); });
  await page.click('[data-cl="drawn"]');
  check('Done drawing opens the pad on wall A', await page.evaluate(() => pad && pad.key === 'A'));
  await page.click('#pad [data-pk="cancel"]');
  check('three walls, three sizes plus ceiling', await page.locator('.cl-card.is-open .cl-dims .cl-dim').count() === 4);
  // fits the iPhone: no sideways scroll
  check('no sideways scroll on iPhone', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
    await page.evaluate(() => [document.documentElement.scrollWidth, innerWidth]));
  if(process.env.SHOT_DIR) await page.screenshot({path: process.env.SHOT_DIR + '/closets-phone.png'});
  // back to doors and the print sheet
  await page.emulateMedia({media:'print'});
  check('print shows the Closet Measurements sheet with every drawn closet', await page.evaluate(() =>
    getComputedStyle(document.querySelector('.cl-print')).display === 'block' && document.querySelectorAll('.clp-one').length === 3));
  await page.emulateMedia({media:'screen'});
  await page.click('.cl-switch [data-cl="doors"]');
  check('back on the doors', await page.evaluate(() => state.view === 'job' && !document.querySelector('.cl-print')));
  check('no page errors', errors.length === 0, errors);
  if(!fails) console.log('ALL PASSED');
  await browser.close(); server.close();
  process.exit(fails ? 1 : 0);
})();

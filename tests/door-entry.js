// Measurement app 2.3: door type taps, the number pad, the tablet layout.
//
//   node tests/door-entry.js
//   (or PLAYWRIGHT=/path/to/playwright node tests/door-entry.js)
//
// Serves measurement-app/index.html with Supabase switched off, so nothing
// leaves the machine. Prints PASS or FAIL per check and exits 1 on any failure.

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

async function fresh(page, inHome){
  await page.evaluate(ih => {
    state.me = {name:'admin', role:'admin'};
    state.job = newJob(); state.job.customer = 'Entry'; state.job.inHome = ih;
    state.job.openings[0].location = 'Bed 2 Clst';
    state.view = 'job'; state.openOpening = state.job.openings[0].id;
    state.editOption = state.job.openings[0].options[0].id; render();
  }, inHome);
}
const op = page => page.evaluate(() => { const o = state.job.openings[0];
  return {now:o.existingType, types:o.options.map(x => x.v.doorType), width:o.width, height:o.height,
          qty:o.qty, reRail:o.options[0].v.reRail}; });
const chipClass = (page, t) => page.getAttribute('[data-dtype="' + t + '"]', 'class');
const tap = async (page, t) => { await page.click('[data-dtype="' + t + '"]'); await page.waitForTimeout(500); };
const dbl = async (page, t) => {
  await page.click('[data-dtype="' + t + '"]'); await page.waitForTimeout(120);
  await page.click('[data-dtype="' + t + '"]'); await page.waitForTimeout(500);
};

(async () => {
  await new Promise(ok => server.listen(0, ok));
  const url = 'http://127.0.0.1:' + server.address().port + '/';
  const browser = await chromium.launch();
  const page = await browser.newPage({viewport:{width:390, height:844}, hasTouch:true});
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(url); await page.waitForTimeout(300);

  // ---- door type taps ----
  await fresh(page, true);
  await tap(page, 'Bifold');
  let s = await op(page);
  check('tap picks the door to quote', s.types.join() === 'Bifold' && s.now === '', s);
  check('picked chip is filled', /\bon\b/.test(await chipClass(page, 'Bifold')), await chipClass(page, 'Bifold'));
  await tap(page, 'Bifold');
  s = await op(page);
  check('tap again clears it', s.types.join() === '' && s.now === '', s);
  check('and the chip is not left lit', !/\b(on|now)\b/.test(await chipClass(page, 'Bifold')), await chipClass(page, 'Bifold'));
  await tap(page, 'Bifold'); await tap(page, 'Bypass');
  s = await op(page);
  check('tap a different type switches to it, no second line', s.types.join() === 'Bypass', s);
  check('the old one goes dark', !/\bon\b/.test(await chipClass(page, 'Bifold')), await chipClass(page, 'Bifold'));
  await dbl(page, 'Single Swing');
  s = await op(page);
  check('double tap marks the door there now', s.now === 'Single Swing', s);
  check('double tap does not change the quoted door', s.types.join() === 'Bypass', s);
  check('now chip shows the NOW badge', /\bnow\b/.test(await chipClass(page, 'Single Swing')) &&
        (await page.textContent('[data-dtype="Single Swing"]')).includes('now'), await chipClass(page, 'Single Swing'));
  await dbl(page, 'Single Swing');
  s = await op(page);
  check('double tap again clears the now door', s.now === '' && s.types.join() === 'Bypass', s);
  await fresh(page, true);
  await dbl(page, 'Single Swing');
  s = await op(page);
  check('double tap on an empty opening quotes like for like', s.now === 'Single Swing' && s.types.join() === 'Single Swing', s);
  check('a chip both now and quoted shows both', /\bon\b/.test(await chipClass(page, 'Single Swing')) &&
        /\bnow\b/.test(await chipClass(page, 'Single Swing')), await chipClass(page, 'Single Swing'));
  await tap(page, 'Pocket');
  s = await op(page);
  check('then a tap on another type quotes that, now stays', s.now === 'Single Swing' && s.types.join() === 'Pocket', s);
  const lines = await page.evaluate(() => missing(state.job).filter(m => /door types ticked/.test(m)).length);
  check('never two lines on one opening from taps', lines === 0, lines);
  // office mode: Add another option, then a tap fills the new one
  await fresh(page, false);
  await tap(page, 'Single Swing');
  await page.click('[data-addopt]'); await page.waitForTimeout(200);
  await page.evaluate(() => { const o = state.job.openings[0]; state.editOption = o.options[1].id; render(); });
  await tap(page, 'Pocket');
  s = await op(page);
  check('office: a tap fills the option being edited', s.types.join() === 'Single Swing,Pocket', s);

  // ---- the number pad ----
  await fresh(page, true);
  await tap(page, 'Single Swing');
  await page.click('[data-padof="width"]');
  check('tapping Other width opens the pad', !!(await page.$('#pad .pad-keys')), 'no pad');
  const box = await page.$eval('#pad .pad-card', e => { const r = e.getBoundingClientRect(); return [r.width, r.height]; });
  check('the pad fills most of the phone screen', box[0] > 350 && box[1] > 700, box);
  for(const k of ['3', '2', 'f4']) await page.click('#pad [data-pk="' + k + '"]');
  check('pad shows 32 1/2', (await page.textContent('.pad-show')).startsWith('32 1/2'), await page.textContent('.pad-show'));
  await page.click('#pad [data-pk="done"]'); await page.waitForTimeout(150);
  s = await op(page);
  check('Done stores 32.5', s.width === '32.5' && !(await page.$('#pad')), s);
  check('the box shows 32 1/2"', (await page.textContent('[data-padof="width"]')).includes('32 1/2"'), await page.textContent('[data-padof="width"]'));
  await page.click('[data-padof="width"]');
  await page.click('#pad [data-pk="9"]'); await page.click('#pad [data-pk="cancel"]'); await page.waitForTimeout(100);
  s = await op(page);
  check('Cancel leaves the width alone', s.width === '32.5', s);
  await page.click('[data-padof="height"]');
  await page.keyboard.type('82'); await page.keyboard.press('Enter'); await page.waitForTimeout(150);
  s = await op(page);
  check('keyboard works on the pad too', s.height === '82', s);
  await page.click('[data-osize="height"][data-val="81-83"]'); await page.waitForTimeout(150);
  s = await op(page);
  check('a range still sets re-rail', s.reRail === 'YES', s);
  await page.click('[data-padof="height"]');
  for(const k of ['8', '0']) await page.click('#pad [data-pk="' + k + '"]');
  await page.click('#pad [data-pk="done"]'); await page.waitForTimeout(150);
  s = await op(page);
  check('a typed height after a range lets go of re-rail', s.height === '80' && s.reRail === '', s);
  check('sizeText reads eighths', await page.evaluate(() =>
    [sizeText('30.125'), sizeText('30.75'), sizeText('0.5'), sizeText('36')].join('|')) === '30 1/8|30 3/4|1/2|36', 'sizeText');

  // ---- phone order is unchanged ----
  await fresh(page, true);
  const order = await page.evaluate(() => ['.o-loc','.o-qty','.o-type','.o-w','.o-h','.o-prod']
    .map(s => Math.round(document.querySelector(s).getBoundingClientRect().top)));
  check('phone: location, quantity, type, width, height, product type, top to bottom',
        order.every((y, i) => i === 0 || y > order[i - 1]), order);

  // ---- tablet held sideways ----
  const tab = await browser.newPage({viewport:{width:1180, height:820}, hasTouch:true});
  tab.on('pageerror', e => errors.push(e.message));
  await tab.goto(url); await tab.waitForTimeout(300);
  await fresh(tab, true);
  const lay = await tab.evaluate(() => {
    const r = s => document.querySelector(s).getBoundingClientRect();
    return {left:r('.op-left').left, right:r('.op-right').left, typeTop:r('.o-type').top, wTop:r('.o-w').top,
            wrap:r('#app').width, chip:r('.chip').height};
  });
  check('tablet: door on the left, size on the right', lay.right > lay.left + 300 && lay.wTop < lay.typeTop + 50, lay);
  check('tablet: page uses the screen width', lay.wrap > 1000, lay.wrap);
  check('tablet: bigger chips', lay.chip >= 56, lay.chip);
  if(process.env.SHOT){
    await tab.click('[data-dtype="Bifold"]'); await tab.waitForTimeout(500);
    await tab.click('[data-chip="productType"][data-val="1.375 Hollow"]');
    await tab.click('[data-osize="width"][data-val="48"]'); await tab.click('[data-osize="height"][data-val="80"]');
    await tab.evaluate(() => document.getElementById('op-' + state.job.openings[0].id).scrollIntoView());
    await tab.evaluate(() => window.scrollBy(0, -120)); await tab.waitForTimeout(200);
    await tab.screenshot({path: process.env.SHOT});
    await fresh(tab, true);
  }
  await tab.click('[data-padof="width"]');
  const tb = await tab.$eval('#pad .pad-card', e => { const r = e.getBoundingClientRect(); return [r.width, r.height]; });
  check('tablet: pad is tall and centred', tb[1] > 700 && tb[0] >= 500, tb);
  if(process.env.PADSHOT){
    for(const k of ['2','9','f6']) await tab.click('#pad [data-pk="' + k + '"]');
    await tab.screenshot({path: process.env.PADSHOT});
  }

  check('no page errors', errors.length === 0, errors);
  await browser.close(); server.close();
  console.log(fails ? fails + ' FAILED' : 'ALL PASSED');
  process.exit(fails ? 1 : 0);
})();

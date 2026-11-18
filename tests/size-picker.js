// Measurement app 2.36: sizes are picked. Phone: inches 12 to 72 (heights
// 60 to 108), then the eighths with Back. Tablet: both at once. Manual
// entry opens the number pad.
//
//   node tests/size-picker.js

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
  const errors = [];
  const start = async vp => {
    const page = await browser.newPage({viewport:vp});
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(url); await page.waitForTimeout(300);
    await page.evaluate(() => { state.me = {name:'admin', role:'admin'}; state.job = newJob(); state.job.customer = 'Pick';
      state.view = 'job'; state.openOpening = state.job.openings[0].id;
      state.job.openings[0].options[0].v.doorType = 'Single Swing'; render(); });
    return page;
  };
  const op = page => page.evaluate(() => ({w:state.job.openings[0].openW, h:state.job.openings[0].openH}));

  // phone
  const page = await start({width:390, height:844});
  await page.click('[data-padof="openW"]');
  const whole = await page.$$eval('#pad .pk-whole button', b => b.map(x => x.textContent));
  check('phone: inches 12 to 72, no eighths yet', whole.length === 61 && whole[0] === '12' && whole[60] === '72' &&
        !(await page.$('#pad .pk-fr')), whole.length);
  await page.click('#pad [data-pk="w60"]');
  const fr = await page.$$eval('#pad .pk-fr button', b => b.map(x => x.textContent));
  check('phone: then the eighths for 60', fr.length === 8 && fr[2] === '60 1/4"' && !(await page.$('#pad .pk-whole')), fr);
  await page.click('#pad [data-pk="pback"]');
  check('phone: Back goes to the inches', !!(await page.$('#pad .pk-whole')), null);
  await page.click('#pad [data-pk="w60"]'); await page.click('#pad [data-pk="pf2"]'); await page.waitForTimeout(150);
  check('phone: 60 then 1/4 stores 60.25 and closes', (await op(page)).w === '60.25' && !(await page.$('#pad')), await op(page));
  await page.click('[data-padof="openH"]');
  const hs = await page.$$eval('#pad .pk-whole button', b => b.map(x => x.textContent));
  check('phone: heights 60 to 108', hs.length === 49 && hs[0] === '60' && hs[48] === '108', hs.length);
  await page.click('#pad [data-pk="w81"]'); await page.click('#pad [data-pk="pf0"]'); await page.waitForTimeout(150);
  check('phone: 81 exact stores 81', (await op(page)).h === '81', await op(page));
  await page.click('[data-padof="openW"]'); await page.click('#pad [data-pk="manual"]');
  check('Manual entry opens the number pad', !!(await page.$('#pad .pad-keys')), null);
  for(const k of ['C', '1', '4', '4']) await page.click('#pad [data-pk="' + k + '"]');
  await page.click('#pad [data-pk="done"]'); await page.waitForTimeout(150);
  check('the number pad still takes any size', (await op(page)).w === '144', await op(page));
  await page.close();

  // tablet
  const tab = await start({width:1024, height:768});
  await tab.click('[data-padof="openW"]');
  check('tablet: inches and eighths together', !!(await tab.$('#pad .pk-whole')) && !!(await tab.$('#pad .pk-fr')), null);
  check('tablet: Done waits for the inches', await tab.$eval('#pad [data-pk="done"]', b => b.disabled), null);
  await tab.click('#pad [data-pk="w30"]'); await tab.waitForTimeout(50);
  check('tablet: picking the inches does not close it', !!(await tab.$('#pad .pk-fr')) && (await op(tab)).w === '', await op(tab));
  await tab.click('#pad [data-pk="pf3"]'); await tab.waitForTimeout(150);
  check('tablet: 30 then 3/8 stores 30.375', (await op(tab)).w === '30.375' && !(await tab.$('#pad')), await op(tab));
  await tab.click('[data-padof="openH"]'); await tab.click('#pad [data-pk="w80"]'); await tab.click('#pad [data-pk="done"]');
  await tab.waitForTimeout(150);
  check('tablet: 80 and Done stores 80', (await op(tab)).h === '80', await op(tab));
  if(process.env.SHOTS){ await tab.click('[data-padof="openW"]'); await tab.click('#pad [data-pk="w32"]');
    await tab.screenshot({path:path.join(process.env.SHOTS, 'pick-tablet.png')}); }
  await tab.close();

  check('no page errors', !errors.length, errors);
  await browser.close(); server.close();
  console.log(fails ? fails + ' FAILED' : 'ALL PASSED');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

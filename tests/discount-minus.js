// Measurement app 2.75 (Andrew, 26 Nov): a special materials line can be a
// discount. The phone's number keypad has no minus, so the price box has a
// minus button. On a phone sized touch screen: tap minus in an empty box,
// type 100, leave the box: the price is -100. Tap minus again: 100, again:
// -100. The downloaded workbook, recalculated in LibreOffice, has J55 -100,
// L55 -100 and Materials and Rework (U47) 100 lower than without it.
//
//   node tests/discount-minus.js        needs soffice and python3 with openpyxl
const { chromium, devices } = require(process.env.PLAYWRIGHT || 'playwright');
const path = require('path'), fs = require('fs'), http = require('http'), os = require('os');
const { execFileSync } = require('child_process');
const DIR = path.join(__dirname, '..', 'measurement-app');
const server = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]); if(p === '/') p = '/index.html';
  const f = path.join(DIR, p);
  if(!f.startsWith(DIR) || !fs.existsSync(f)){ r.statusCode = 404; return r.end('nf'); }
  let body = fs.readFileSync(f);
  if(p === '/index.html') body = body.toString('utf8').replace("supabaseUrl: 'https://baakegbtuygtldksmant.supabase.co'", "supabaseUrl: ''");
  r.setHeader('Content-Type', p.endsWith('.js') ? 'text/javascript' : 'text/html'); r.end(body);
});
let fails = 0;
const check = (name, ok, got) => { console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : '  got: ' + String(JSON.stringify(got)).slice(0, 400))); if(!ok) fails++; };
const READ = `
import sys, json, openpyxl
ws = openpyxl.load_workbook(sys.argv[1], data_only=True)['Pricing Sheet']
print(json.dumps([ws['F55'].value, ws['J55'].value, ws['K55'].value, ws['L55'].value, ws['U47'].value, ws['U54'].value]))`;

(async () => {
  await new Promise(ok => server.listen(0, ok));
  const browser = await chromium.launch();
  const ctx = await browser.newContext({...devices['iPhone 13'], acceptDownloads:true});
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('http://127.0.0.1:' + server.address().port + '/'); await page.waitForTimeout(300);
  check('money shows a minus before the dollar sign', await page.evaluate(() => money(-100)) === '-$100.00');
  check('cleanMoney keeps a leading minus only', await page.evaluate(() =>
    [cleanMoney('-1,250.5'), cleanMoney('12-3'), cleanMoney('-'), cleanMoney('−75'), cleanMoney('1.2.3')].join('|')) === '-1250.5|123||-75|1.23');

  await page.evaluate(() => {
    state.me = {name:'tester', role:'admin'};
    const j = newJob(); Object.assign(j, {customer:'Jane Sample', docType:'Sales Contract - Cash Web Pricing'}); j.openings = [];
    const op = newOpening(1, null, j);
    Object.assign(op, {location:'Den', existingType:'Single Swing', openW:'32', openH:'80', cond:'Jamb'});
    Object.assign(op.options[0].v, {doorType:'Single Swing', productType:'1.375 Hollow', doorStyle:'Columbia',
      handleType:'Passage', handleStyle:'R - Georgian Standard', hwColour:'Matte Black', paintColour:'STD White', install:'YES'});
    applyQtyRule(op); j.openings.push(op);
    j.materials[0] = {desc:'Discount', price:'', qty:'1'};
    state.job = j; state.view = 'job'; render();
  });

  // a recalculated workbook before the discount
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'disc-'));
  fs.writeFileSync(path.join(tmp, 'read.py'), READ);
  const prof = path.join(tmp, 'lo'); fs.mkdirSync(path.join(prof, 'user'), {recursive:true});
  fs.writeFileSync(path.join(prof, 'user', 'registrymodifications.xcu'), '<?xml version="1.0" encoding="UTF-8"?>' +
    '<oor:items xmlns:oor="http://openoffice.org/2001/registry" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
    '<item oor:path="/org.openoffice.Office.Calc/Formula/Load"><prop oor:name="OOXMLRecalcMode" oor:op="fuse"><value>0</value></prop></item></oor:items>');
  const book = async name => {
    const [dl] = await Promise.all([page.waitForEvent('download'), page.evaluate(() => download(state.job))]);
    const f = path.join(tmp, name + '.xlsx'); await dl.saveAs(f);
    const out = path.join(tmp, name); fs.mkdirSync(out);
    execFileSync('soffice', ['-env:UserInstallation=file://' + prof, '--headless', '--convert-to', 'xlsx', '--outdir', out, f], {stdio:'ignore'});
    return JSON.parse(execFileSync('python3', ['-I', '-W', 'ignore', path.join(tmp, 'read.py'), path.join(out, name + '.xlsx')]).toString());
  };
  const before = await book('before');

  // on the review, by touch
  await page.tap('[data-review]');
  await page.waitForFunction(() => state.reviewReady, null, {timeout:30000}); await page.waitForTimeout(300);
  const box = 'input[data-rvmat="0:price"]', btn = box + ' + [data-neg]';
  check('the review price box has a minus button', await page.locator(btn).count() === 1);
  await page.locator(btn).scrollIntoViewIfNeeded();
  await page.tap(btn);
  check('minus in an empty box puts in a minus and keeps the box focused', await page.inputValue(box) === '-' &&
    await page.evaluate(b => document.activeElement === document.querySelector(b), box));
  await page.keyboard.type('100');
  await page.evaluate(() => document.activeElement.blur()); await page.waitForTimeout(400);
  check('the price is saved as -100', await page.evaluate(() => state.job.materials[0].price) === '-100', await page.evaluate(() => state.job.materials[0]));
  await page.tap(btn); await page.waitForTimeout(400);
  check('minus again makes it 100', await page.evaluate(() => state.job.materials[0].price) === '100');
  await page.tap(btn); await page.waitForTimeout(400);
  check('and again -100', await page.evaluate(() => state.job.materials[0].price) === '-100');
  check('the review box shows -100', await page.inputValue(box) === '-100');

  const after = await book('after');
  check('workbook line 55 is Discount, price -100, qty 1, total -100', after[0] === 'Discount' && after[1] === -100 && after[2] === 1 && after[3] === -100, after);
  check('Materials and Rework is 100 lower', Math.abs((before[4] || 0) - 100 - after[4]) < 0.001, [before, after]);
  check('the grand total went down', after[5] < before[5], [before[5], after[5]]);
  await page.screenshot({path: path.join(tmp, 'discount-minus-phone.png')});
  check('no page errors', errors.length === 0, errors);
  console.log(fails ? fails + ' FAILED' : 'ALL PASSED');
  await browser.close(); server.close(); process.exit(fails ? 1 : 0);
})();

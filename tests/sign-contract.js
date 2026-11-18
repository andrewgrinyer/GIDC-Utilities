// Measurement app 2.23: typed prices, the double door handle fix, and the
// customer signing the contract on screen.
//
//   node tests/sign-contract.js
//   (or PLAYWRIGHT=/path/to/playwright node tests/sign-contract.js)
//
// Serves measurement-app/ with Supabase switched off. Checks that the
// workbook's double door handle multiplier is 1 (quantity already counts the
// two doors), that a typed Door MSRP and Handle Cost replace the price list
// on the review and in the totals, that the Sign button is only for the price
// roles and refuses a line with no price, that signing walks through every
// field (8 initials, the contract, terms, door page and each form), and that
// the signed PDF has the order, terms, doors and forms pages.

const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const path = require('path'), fs = require('fs'), http = require('http');
const DIR = path.join(__dirname, '..', 'measurement-app');

const TYPES = {'.js':'text/javascript', '.png':'image/png', '.jpg':'image/jpeg', '.pdf':'application/pdf'};
const server = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]); if(p === '/') p = '/index.html';
  const f = path.join(DIR, p);
  if(!f.startsWith(DIR) || !fs.existsSync(f)){ r.statusCode = 404; return r.end('nf'); }
  let body = fs.readFileSync(f);
  if(p === '/index.html') body = body.toString('utf8')
    .replace("supabaseUrl: 'https://baakegbtuygtldksmant.supabase.co'", "supabaseUrl: ''");
  r.setHeader('Content-Type', TYPES[path.extname(p)] || 'text/html');
  r.end(body);
});

let fails = 0;
const check = (name, ok, got) => {
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : '  got: ' + String(JSON.stringify(got)).slice(0, 400)));
  if(!ok) fails++;
};

(async () => {
  await new Promise(ok => server.listen(0, ok));
  const url = 'http://127.0.0.1:' + server.address().port + '/';
  const browser = await chromium.launch();
  const page = await browser.newPage({viewport:{width:1280, height:900}});
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(url); await page.evaluate(() => { const nj = newJob; window.newJob = () => { const j = nj(); delete j.sizing; j.openings.forEach(o => { delete o.openW; delete o.openH; }); return j; }; }); /* 2.31: these jobs are entered the old way */
  await page.waitForTimeout(300);

  const setup = async (role, extra) => page.evaluate(([role, extra]) => {
    state.me = {name:'tester', role};
    const j = newJob(); Object.assign(j, {customer:'Jane Sample', address:'12 Main St', city:'Cambridge',
      phone:'519 555 1234', email:'jane@example.com', salesRep:'Sam Rep', leadTime:'8-10 Weeks',
      docType:'Sales Contract - Cash Web Pricing'}); j.openings = [];
    const add = (loc, type, prod, style, w, v) => { const op = newOpening(j.openings.length + 1);
      op.location = loc; op.existingType = type; op.width = String(w); op.height = 80;
      Object.assign(op.options[0].v, {doorType:type, productType:prod, doorStyle:style, jamb:'', routerStop:'NO',
        reStile:'NO', install:'YES', paintColour:'STD White'}, v || {});
      applyQtyRule(op); j.openings.push(op); return op; };
    add('Den', 'Double Swing Dummy', '1.375 Hollow', 'Columbia', 48,
        {handleType:'Dummy', handleStyle:'C - Georgian Standard', hwColour:'Matte Black'});
    add('Master Clst', 'Bifold', '1.375 Hollow', 'Kingston', 48, {handleType:'Bifold Knob'});
    if(extra === 'so') add('Hall', 'Single Swing', '1.375 Hollow', 'Columbia', 42, {handleType:'Passage'});
    state.job = j; state.view = 'job'; render();
  }, [role, extra]);
  const review = async () => {
    await page.click('[data-review]');
    await page.waitForFunction(() => state.reviewReady, null, {timeout:30000});
    await page.waitForTimeout(200);
  };

  // 1. the workbook: double door handle multiplier is 1
  await setup('admin'); await review();
  const mult = await page.evaluate(() => { const hf = calc.hf, s = hf.getSheetId('Pricing Data');
    return [46, 47, 48].map(r => hf.getCellValue({sheet:s, row:r, col:4})); });
  check('double door handle multiplier (Pricing Data E47:E49) is 1', mult.every(v => v === 1), mult);
  const den = await page.evaluate(() => cv('U' + PAGE_ROWS[0]));
  check('a double Georgian dummy pair is two dummies ($186), not four', den === 186, den);

  // 2. typed Door MSRP and Handle Cost
  const before = await page.evaluate(() => ({t:cv('T' + PAGE_ROWS[1]), tot:cv('U54')}));
  await page.fill('input[data-rvprice="msrpTyped"] >> nth=1', '300');
  await page.locator('input[data-rvprice="msrpTyped"] >> nth=1').dispatchEvent('change');
  await page.waitForTimeout(400);
  const after = await page.evaluate(() => ({r:cv('R' + PAGE_ROWS[1]), t:cv('T' + PAGE_ROWS[1]), tot:cv('U54'),
    saved:state.job.openings[1].options[0].v.msrpTyped}));
  check('typed Door MSRP goes into the workbook', after.r === 300 && after.saved === '300', after);
  check('typed Door MSRP changes the door total and grand total', after.t !== before.t && after.tot !== before.tot, [before, after]);
  await page.fill('input[data-rvprice="handleTyped"] >> nth=0', '150');
  await page.locator('input[data-rvprice="handleTyped"] >> nth=0').dispatchEvent('change');
  await page.waitForTimeout(400);
  const hand = await page.evaluate(() => cv('U' + PAGE_ROWS[0]));
  check('typed Handle Cost replaces the price list handle', hand === 150, hand);
  await page.fill('input[data-rvprice="handleTyped"] >> nth=0', '');
  await page.locator('input[data-rvprice="handleTyped"] >> nth=0').dispatchEvent('change');
  await page.waitForTimeout(400);
  check('clearing Handle Cost goes back to the price list', await page.evaluate(() => cv('U' + PAGE_ROWS[0])) === 186);

  // 3. the Sign button: price roles only
  check('admin sees Sign', await page.locator('[data-sign]').count() === 1);
  await setup('manufacturing'); await review();
  check('manufacturing has no Sign button', await page.locator('[data-sign]').count() === 0);

  // 4. a special order line with no price cannot be signed until a price is typed
  await setup('sales', 'so'); await review();
  const so = await page.evaluate(() => prices0(state.job));
  check('a line with no price blocks signing', so === true, so);
  await page.click('[data-sign]'); await page.waitForTimeout(200);
  check('no signing pad opens while a line has no price', await page.locator('.signpad').count() === 0);
  await page.fill('input[data-rvprice="msrpTyped"] >> nth=2', '400');
  await page.locator('input[data-rvprice="msrpTyped"] >> nth=2').dispatchEvent('change');
  await page.waitForTimeout(400);
  check('typing the S/O price lets it be signed', await page.evaluate(() => prices0(state.job)) === false);

  // 5. sign every field with the mouse, as on a track pad
  await page.click('[data-sign]'); await page.waitForTimeout(200);
  check('the signing pad asks for the name first', await page.inputValue('#sp-name') === 'Jane Sample');
  await page.click('[data-sp="start"]');
  const fields = await page.evaluate(() => signFields(state.job).map(f => f.id));
  // 2.32: the S/O line (typed price) adds the special order initial after the contract
  check('fields: 8 initials, special order initial, contract, terms, doors and each form',
    fields.filter(f => /^ini-\d/.test(f)).length === 8 && fields[1] === 'ini-so' && ['contract', 'terms', 'doors'].every(f => fields.includes(f)) &&
    fields.includes('form-bifold'), fields);
  // Next on an empty pad does not move on
  const head0 = await page.locator('.signpad').innerText();
  await page.click('[data-sp="next"]'); await page.waitForTimeout(100);
  check('an empty field cannot be skipped', await page.locator('.signpad').innerText() === head0);
  const seen = {};
  for(let k = 0; k < fields.length; k++){
    const c = await page.$('.signpad canvas'); if(!c) break;
    // 2.27: the page being signed shows above the pad, its place marked
    const id = fields[k], look = k === 0 || id === 'ini-2' || id === 'ini-3' || id === 'contract' || id === 'doors' || id.startsWith('form-');
    if(look){
      await page.waitForSelector('.sp-spot.on', {timeout:20000}).catch(() => {});
      seen[id] = await page.evaluate(() => { const s = document.querySelector('.sp-spot.on'), d = document.querySelector('.sp-doc');
        if(!s) return null; const r = s.getBoundingClientRect(), b = d.getBoundingClientRect();
        return {pages:document.querySelectorAll('.sp-page img').length, inView:r.top >= b.top - 2 && r.bottom <= b.bottom + 2,
                done:document.querySelectorAll('.sp-spot.done').length}; });
    }
    const b = await c.boundingBox();
    await page.mouse.move(b.x + b.width * .2, b.y + b.height * .6); await page.mouse.down();
    for(let i = 1; i <= 12; i++) await page.mouse.move(b.x + b.width * (.2 + i * .05), b.y + b.height * (.6 - .25 * Math.sin(i / 2)));
    await page.mouse.up();
    if(look){
      seen[id].live = await page.evaluate(() => (document.querySelector('.sp-spot.on path') || {getAttribute(){return ''}}).getAttribute('d').length);
      if(process.env.SHOT) await page.screenshot({path:process.env.SHOT.replace('.png', '-' + id + '.png')});
    }
    await page.click('[data-sp="next"]'); await page.waitForTimeout(60);
  }
  const lookIds = Object.keys(seen);
  check('each step shows its page with the place marked and in view',
    lookIds.length >= 4 && lookIds.every(i => seen[i] && seen[i].pages >= 1 && seen[i].inView), seen);
  check('what is drawn on the pad shows on the page', lookIds.every(i => seen[i] && seen[i].live > 20), seen);
  check('the second initial shows the first one already in its place', seen['ini-3'] && seen['ini-3'].done >= 1, seen);
  check('the contract step shows every order page', seen.contract && seen.contract.pages >= 1, seen);
  await page.waitForTimeout(2500);
  const s = await page.evaluate(() => ({ok:signedOk(state.job), n:Object.keys(state.job.signed.marks).length,
    name:state.job.signed.name, banner:!!document.querySelector('.rv-signed')}));
  check('every field signed and saved on the job', s.ok && s.n === fields.length && s.name === 'Jane Sample', s);
  check('the review says it is signed', s.banner, s);

  // 6. the signed PDF
  const pdf = await page.evaluate(async () => { const b = await contractPdf(state.job);
    const d = await PDFLib.PDFDocument.load(b);
    return {n:d.getPageCount(), sizes:d.getPages().map(p => [Math.round(p.getWidth()), Math.round(p.getHeight())])}; });
  const forms = await page.evaluate(() => jobDocs(state.job).length);
  check('signed PDF: order, terms, door page and each form', pdf.n >= 3 + forms &&
    pdf.sizes[0][0] === 792 && pdf.sizes[pdf.n - 1][0] === 612, pdf);

  // 6b. the pricing summary boxes are on the PDF, as on the review
  const bytes = await page.evaluate(async () => Array.from(await contractPdf(state.job)));
  const tmp = path.join(require('os').tmpdir(), 'sign-contract-test.pdf');
  fs.writeFileSync(tmp, Buffer.from(bytes));
  let txt = '';
  try{ txt = require('child_process').execFileSync('pdftotext', ['-f', '1', '-l', '2', tmp, '-']).toString(); }catch(e){ txt = null; }
  if(txt === null) console.log('SKIP pricing boxes on the PDF (no pdftotext here)');
  else check('PDF has all four pricing boxes', ['INSTALLATION', 'SPECIAL MATERIALS AND REWORK', 'HARDWARE', 'ORDER TOTAL',
    'Grand Total', 'Astragal'].every(w => txt.includes(w)), txt.slice(0, 600));

  // 7. a change after signing shows the warning and drops the marks
  await page.fill('input[data-rvprice="msrpTyped"] >> nth=2', '450');
  await page.locator('input[data-rvprice="msrpTyped"] >> nth=2').dispatchEvent('change');
  await page.waitForTimeout(500);
  const stale = await page.evaluate(() => ({ok:signedOk(state.job), text:document.body.innerText.includes('has changed since')}));
  check('a changed order is no longer shown as signed', !stale.ok && stale.text, stale);

  // 8. printed, the terms are one page
  await page.emulateMedia({media:'print'});
  const terms = await page.evaluate(() => { const t = document.querySelector('.print-terms');
    return t ? t.scrollHeight / 96 : 0; });
  check('terms fit on one letter page (under 10.5 inches)', terms > 0 && terms < 10.5, terms);

  check('no page errors', errors.length === 0, errors);
  await browser.close(); server.close();
  console.log(fails ? fails + ' FAILED' : 'ALL PASSED');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

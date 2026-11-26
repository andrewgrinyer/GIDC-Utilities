// Measurement app 2.2: the review screen and its prices.
//
//   node tests/review-pricing.js
//   (or PLAYWRIGHT=/path/to/playwright node tests/review-pricing.js)
//
// Serves measurement-app/ with Supabase switched off, so nothing leaves the
// machine. Checks that:
//   1. the review screen opens and prices every door line;
//   2. every formula on the contract sheet in the review agrees with the
//      same sheet read back out of the workbook the app downloads, so the
//      screen and the file cannot disagree;
//   3. a change made on the review screen is saved to the job and moves the
//      price;
//   4. a role outside the price list (manufacturing) sees no money at all.
// Prints PASS or FAIL per check and exits 1 on any failure.
//
// How the calculator itself was checked against a spreadsheet: four random
// jobs were downloaded, recalculated in full by LibreOffice, and all 380
// formula cells on the contract sheet agreed with the calculator (17 Nov 2026).

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
  r.setHeader('Content-Type', p.endsWith('.js') ? 'text/javascript' : 'text/html');
  r.end(body);
});

let fails = 0;
const check = (name, ok, got) => {
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : '  got: ' + JSON.stringify(got).slice(0, 400)));
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

  // a job a rep could really have measured
  await page.evaluate(() => {
    state.me = {name:'admin', role:'admin'};
    const j = newJob(); j.customer = 'Review Test'; j.city = 'Cambridge';
    j.docType = 'Estimate - Cash Web Pricing'; j.openings = [];
    const add = (loc, type, prod, style, w, h, extra) => {
      const op = newOpening(j.openings.length + 1); op.location = loc; op.existingType = type;
      op.width = String(w); op.height = h;
      Object.assign(op.options[0].v, {doorType:type, productType:prod, doorStyle:style,
        jamb:'', routerStop:'NO', reStile:'NO', install:'YES', paintColour:'STD White'}, extra || {});
      applyQtyRule(op); j.openings.push(op); return op;
    };
    add('Foyer 1', 'Single Swing', '1.375 Hollow', 'Columbia', 32, 80,
        {handleType:'Passage', handleStyle:'R -Latitude Standard', hwColour:'Matte Black'});
    add('Master Clst 1', 'Bifold', '1.375 Hollow', 'Kingston', 48, 80, {handleType:'Bifold Knob'});
    add('Bed 2 Clst', 'Bypass', '1.375 Solid', 'Lopez', 60, 80, {handleType:'Finger Pull Round'}).qty = 2;
    add('Den', 'Double Swing AST', '1.375 Glass', '1 Lite Clear', 48, '81-83',
        {handleType:'Passage/Dummy', handleStyle:'R -Latitude Standard', hwColour:'Chrome'});
    add('Pantry', 'Single Swing', '1.375 Glass', '1 Lite Clear', 22, 80, {handleType:'Privacy',
        handleStyle:'R -Latitude Standard', hwColour:'Matte Black'});
    j.materials[0] = {desc:'Casing', price:'45.5', qty:'3'};
    state.job = j; state.view = 'job'; render();
  });

  // 0. the download is unchanged by moving fillSheet onto sheetInputs
  const oldFill = fs.readFileSync(process.env.OLD_FILL || '/dev/null', 'utf8');
  if(oldFill){
    const same = await page.evaluate(src => {
      eval(src + ';window.__old = oldFillSheet;');
      const { unzipSync, strFromU8 } = fflate;
      const xml = strFromU8(unzipSync(templateBytes())['xl/worksheets/sheet3.xml']);
      return window.__old(xml, state.job) === fillSheet(xml, state.job);
    }, oldFill);
    check('download identical to 2.1 for the same job', same, same);
  }

  // 1. open the review
  await page.click('[data-review]');
  await page.waitForSelector('table.rv tbody tr', {timeout:15000});
  await page.waitForFunction(() => state.reviewReady, null, {timeout:15000});
  const rows = await page.$$eval('.rv-scroll table.rv tbody tr.rv-l1', t => t.length);
  check('review shows one row per door line', rows === 5, rows);
  const heads = await page.$$eval('.rv-scroll table.rv thead th', t => t.map(x => x.textContent));
  check('review has the contract columns, prices included',
        heads.includes('Door MSRP') && heads.includes('Door Total') && heads.includes('Install'), heads);
  const prices = await page.evaluate(() => PAGE_ROWS.slice(0, 5).map(r => [cv('R' + r), cv('T' + r)]));
  check('every door line has a price', prices.every(([r, t]) => typeof r === 'number' && r > 0 && typeof t === 'number'), prices);
  const total = await page.evaluate(() => cv('U54'));
  check('grand total is a number above zero', typeof total === 'number' && total > 0, total);
  const dock = await page.textContent('#dock');
  check('dock shows the grand total', dock.includes('Grand total $'), dock);

  // 2. the review agrees with the workbook it would download, on every formula cell
  const cmp = await page.evaluate(() => {
    const { unzipSync, strToU8, strFromU8 } = fflate;
    const zip = unzipSync(templateBytes());
    zip['xl/worksheets/sheet3.xml'] = strToU8(fillSheet(strFromU8(zip['xl/worksheets/sheet3.xml']), state.job));
    const files = {}; Object.keys(zip).forEach(k => { if(/\.(xml|rels)$/.test(k)) files[k] = strFromU8(zip[k]); });
    const sheets = {}; readWorkbook(files).forEach(s => sheets[s.name] = s.cells);
    const hf2 = HyperFormula.buildFromSheets(sheets, {licenseKey:'gpl-v3'});
    const s2 = hf2.getSheetId('Pricing Sheet');
    const f = calc.hf.getSheetFormulas(calc.sid); let n = 0; const bad = [];
    f.forEach((row, r) => row.forEach((x, c) => { if(!x) return; n++;
      const a = calc.hf.getCellValue({sheet:calc.sid, row:r, col:c});
      const b = hf2.getCellValue({sheet:s2, row:r, col:c});
      const norm = v => (v && typeof v === 'object') ? v.value : v;
      if(JSON.stringify(norm(a)) !== JSON.stringify(norm(b))) bad.push([r + 1, c + 1, norm(a), norm(b)]);
    }));
    return {n, bad};
  });
  check('review matches the downloaded workbook on all ' + cmp.n + ' formula cells', cmp.n > 300 && cmp.bad.length === 0, cmp.bad.slice(0, 5));

  // 3. a change on the review is saved and reprices
  const before = await page.evaluate(() => cv('T9'));
  const opId = await page.evaluate(() => state.job.openings[0].id);
  await page.selectOption('select[data-rv="productType"][data-op="' + opId + '"]', '1.375 Solid');
  await page.waitForTimeout(200);
  const after = await page.evaluate(() => [cv('T9'), state.job.openings[0].options[0].v.productType]);
  check('changing product type on the review saves it', after[1] === '1.375 Solid', after);
  check('and moves the price', typeof after[0] === 'number' && after[0] !== before, [before, after[0]]);
  await page.selectOption('select[data-rvjob="docType"]', 'Estimate - Financing');
  await page.waitForTimeout(200);
  const fin = await page.evaluate(() => [state.job.docType, cv('U54')]);
  check('changing the document reprices the total', fin[0] === 'Estimate - Financing' && fin[1] !== total, [fin, total]);
  // quantity rules still hold on the review
  const bifoldId = await page.evaluate(() => state.job.openings[1].id);
  // 2.63: the width is changed on the measurement screen only; the review shows it read only
  check('width is read only on the review', await page.locator('[data-rv="width"][data-op="' + bifoldId + '"]').count() === 0, null);
  await page.evaluate(id => { const op = state.job.openings.find(x => x.id === id); setOpeningSize(op, 'width', '30'); calcJob(state.job); render(); }, bifoldId);
  await page.waitForTimeout(200);
  const bq = await page.evaluate(() => [state.job.openings[1].qty, cv('C10')]);
  check('bifold narrowed to 30 becomes quantity 1 on the review', bq[0] === 1 && bq[1] === 1, bq);
  const bw = await page.evaluate(id => { const op = state.job.openings.find(x => x.id === id); setOpeningSize(op, 'width', '80'); return op.width; }, bifoldId);
  check('bifold over 72 refused', String(bw) === '30', bw);
  const glass = await page.$$eval('tr.rv-l1.rv-glass', t => t.length);
  check('narrow glass line is marked', glass === 1, glass);          // the pantry, glass at 22
  const glassMarked = await page.evaluate(() => narrowGlass(state.job.openings[4]));
  check('pantry lite door at 22 counts as narrow glass', glassMarked, glassMarked);

  await page.screenshot({path: process.env.SHOT || '/dev/null', fullPage:true}).catch(() => {});

  // a door the price list has no price for: S/O, and the total says why it is missing
  await page.evaluate(() => { state.job.openings[0].options[0].v.doorStyle = 'Riverside';
    state.job.openings[0].options[0].v.doorType = 'Bifold'; applyQtyRule(state.job.openings[0]);
    calcJob(state.job); render(); });
  const so = await page.evaluate(() => [cv('R9'), document.querySelector('#dock').textContent,
                                        document.querySelector('#app').textContent.includes('special order')]);
  check('unpriced door shows S/O and explains the missing total',
        so[0] === 'S/O' && /no grand total/i.test(so[1]) && so[2], so);
  await page.evaluate(() => { state.job.openings[0].options[0].v.doorStyle = 'Columbia';
    state.job.openings[0].options[0].v.doorType = 'Single Swing'; applyQtyRule(state.job.openings[0]);
    calcJob(state.job); render(); });

  // 2.6: Andrew's 10 lite and 15 lite glass prices (Pricing MSRP rows 20 and 21)
  const litePrice = (style, w, h) => page.evaluate(([style, w, h]) => {
    const op = state.job.openings[0], v = op.options[0].v;
    Object.assign(v, {doorStyle:style, doorType:'Single Swing', productType:'1.375 Glass'});
    op.width = w; op.height = h; applyQtyRule(op); calcJob(state.job); render();
    return cv('R9'); }, [style, w, h]);
  const lites = [await litePrice('15 Lite Clear', 32, 80), await litePrice('10 Lite Clear', 28, 80),
                 await litePrice('15 Lite Clear', 32, 84), await litePrice('10 Lite Clear', 28, 84)];
  check('15 lite 6/8 is $255, 10 lite 6/8 $225, 15 lite 7/0 $708, 10 lite 7/0 not priced',
        lites[0] === 255 && lites[1] === 225 && lites[2] === 708 && lites[3] === 'S/O', lites);
  // 2.10: a size the supplier size check calls special order gets no price
  const rain = [await litePrice('1 Lite Rain', 30, 80), await litePrice('1 Lite Rain', 40, 80)];
  const rainTotal = await page.evaluate(() => [cv('T9'), cv('U54'), document.querySelector('#dock').textContent]);
  check('1 Lite Rain at 30 has a price, at 40 (special order size) it is S/O',
        typeof rain[0] === 'number' && rain[0] > 0 && rain[1] === 'S/O', rain);
  check('and the total stops, as for any S/O door',
        typeof rainTotal[1] !== 'number' && rainTotal[2].toLowerCase().includes('no grand total'), rainTotal);
  const xml = await page.evaluate(() => { const { unzipSync, strFromU8 } = fflate;
    return fillSheet(strFromU8(unzipSync(templateBytes())['xl/worksheets/sheet3.xml']), state.job); });
  const r9 = (xml.match(/<c r="R9"[^>]*>[\s\S]*?<\/c>/) || [''])[0], r10 = (xml.match(/<c r="R10"[^>]*>[\s\S]*?<\/c>/) || [''])[0];
  check('the downloaded workbook says S/O on that line too, other lines keep the formula',
        r9.includes('>S/O<') && !r9.includes('<f>') && r10.includes('<f>'), [r9.slice(0, 120), r10.slice(0, 60)]);
  const back = await litePrice('1 Lite Rain', 30, 80);
  check('back to 30 wide, the price comes back', typeof back === 'number' && back === rain[0], back);
  const keep = await litePrice('15 Lite Clear', 32, 84);
  check('15 lite at 7\'0" keeps its $708 special order price', keep === 708, keep);
  await page.evaluate(() => { const op = state.job.openings[0], v = op.options[0].v;
    Object.assign(v, {doorStyle:'Columbia', productType:'1.375 Hollow'}); calcJob(state.job); render(); });

  // 2.12: the boxes Andrew sets by hand: service fee and disposal quantities, Items 1 to 3
  const boxSet = async (sel, val) => { await page.fill(sel, String(val)); await page.press(sel, 'Tab'); await page.waitForTimeout(200); };
  const autoDisp = await page.evaluate(() => cv('K47'));
  await boxSet('input[data-rvfee="disposalQty"]', 0);
  let bx = await page.evaluate(() => [cv('K47'), cv('L47'), state.job.fees.disposalQty]);
  check('disposal quantity can be removed (0)', bx[0] === 0 && bx[1] === 0 && bx[2] === 0, bx);
  await boxSet('input[data-rvfee="disposalQty"]', '');
  bx = await page.evaluate(() => cv('K47'));
  check('blank puts disposal back to the sheet\'s own count', bx === autoDisp && autoDisp > 0, [bx, autoDisp]);
  await boxSet('input[data-rvfee="serviceQty"]', 1);
  bx = await page.evaluate(() => cv('C47'));
  check('service fee quantity can be set', bx === 1, bx);
  await boxSet('input[data-rvmat="1:desc"]', 'Shims');
  await boxSet('input[data-rvmat="1:price"]', 12.5);
  await boxSet('input[data-rvmat="1:qty"]', 4);
  bx = await page.evaluate(() => [cv('F56'), cv('L56'), state.job.materials[1]]);
  check('Item 2 name, price and quantity can be set and total', bx[0] === 'Shims' && bx[1] === 50, bx);
  const fx = await page.evaluate(() => { const { unzipSync, strFromU8 } = fflate;
    return fillSheet(strFromU8(unzipSync(templateBytes())['xl/worksheets/sheet3.xml']), state.job); });
  const c47 = (fx.match(/<c r="C47"[^>]*>[\s\S]*?<\/c>/) || [''])[0], k47 = (fx.match(/<c r="K47"[^>]*>[\s\S]*?<\/c>/) || [''])[0];
  check('the workbook gets the set service fee and keeps the disposal formula',
        c47.includes('<v>1</v>') && k47.includes('<f>'), [c47, k47.slice(0, 60)]);
  await page.evaluate(() => { state.job.fees = {}; state.job.materials[1] = {desc:'', price:'', qty:''}; calcJob(state.job); render(); });

  // 4. no money for a role outside the price list
  await page.evaluate(() => { state.me.role = 'manufacturing'; render(); });
  const h2 = await page.$$eval('.rv-scroll table.rv thead th', t => t.map(x => x.textContent));
  // the printed terms quote fees ($500 rescheduling): those are policy, not prices
  const txt = await page.evaluate(() => { const a = document.querySelector('#app').cloneNode(true);
    a.querySelectorAll('.print-terms').forEach(x => x.remove()); return a.textContent; }) + await page.textContent('#dock');
  check('manufacturing sees no price columns', !h2.includes('Door MSRP') && !h2.includes('Door Total'), h2);
  check('manufacturing sees no dollar amounts', !txt.includes('$') && !txt.includes('Order Total'),
        txt.slice(Math.max(0, txt.indexOf('$') - 80), txt.indexOf('$') + 40));

  // back to the job
  await page.click('[data-revback]');
  const view = await page.evaluate(() => state.view);
  check('Back returns to the job', view === 'job', view);

  check('no page errors', errors.length === 0, errors);
  await browser.close(); server.close();
  console.log(fails ? fails + ' FAILED' : 'ALL PASSED');
  process.exit(fails ? 1 : 0);
})();

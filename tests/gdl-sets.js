// Measurement app 2.61: GDL is priced per set (door count from the price list, quantity 1
// in the workbook, special case flag on an override) and the third track on Glissade bypass.
//
//   node tests/gdl-sets.js
//   (or PLAYWRIGHT=/path/to/playwright node tests/gdl-sets.js)
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
  await page.evaluate(() => getCalc());
  const r = await page.evaluate(() => {
    state.me = {name:'admin', role:'admin'};
    const j = newJob(); j.customer = 'Set Test'; j.address = '1 Main St'; j.city = 'Cambridge'; j.inHome = false; j.openings = [];
    const add = (type, W, style) => {
      const op = newOpening(j.openings.length + 1, null, j);
      Object.assign(op, {location:'Master Clst 1', existingType:type, openW:String(W), openH:'80.5', cond:'Jamb'});
      Object.assign(op.options[0].v, {doorType:type, productType:'GDL', doorStyle:style, install:'YES', frameColour:'White', insertColour:'Frosted Glass'});
      applyQtyRule(op); j.openings.push(op); return op;
    };
    const a = add('GDL ByPass', 60, 'Glissade Square Style 3');
    const b = add('GDL ByPass', 96, 'Glissade Swept Style 2');
    const c = add('GDL BiFold', 48, 'Glissade Bifold Style 4');
    const d = add('GDL ByPass', 60, 'Malai');
    state.job = j; state.view = 'job'; state.openOpening = b.id; calcJob(j); render();
    const out = {qty:j.openings.map(op => op.qty), rules:j.openings.map(op => { const x = qtyRule(op); return x.fixed || x.choices; }),
      miss:missing(j).filter(x => /quantity/.test(x)), C9:cv('C9'), R9:cv('R9'), S9:cv('S9'), T9:cv('T9'),
      label:(document.querySelector('.card.is-open .field label') || {}).textContent, chips:[...document.querySelectorAll('.card.is-open [data-pickqty]')].map(e => e.dataset.pickqty)};
    return out;
  });
  check('door count from the price list: 60 bypass 2, 96 asked, 48 bifold 4, wood 60 is 2', r.qty[0] === 2 && r.qty[1] === '' && r.qty[2] === 4 && r.qty[3] === 2, r.qty);
  check('96 bypass offers 2 or 3', JSON.stringify(r.rules[1]) === '[2,3]' && JSON.stringify(r.chips) === '["2","3"]', r);
  check('the count is asked for where the width allows two', r.miss.some(x => /Opening 2/.test(x)), r.miss);
  check('the workbook gets quantity 1 and prices one set', r.C9 === 1 && r.R9 === 1322 && r.S9 === 1322 && r.T9 === 1322, r);

  // pick 3 on the 96, then override the 60 to 3 (special case)
  await page.click('.card.is-open [data-pickqty="3"]');
  await page.evaluate(() => { state.openOpening = state.job.openings[0].id; render(); });
  await page.click('.card.is-open [data-qtyover]');
  await page.click('.card.is-open [data-pickqty="3"]');
  const o = await page.evaluate(() => { const [a, b] = state.job.openings; calcJob(state.job);
    return {a:a.qty, b:b.qty, over:!!a.qtyOverride, special:specialText(a), bSpecial:specialText(b), C9:cv('C9'), T9:cv('T9'),
      hint:(document.querySelector('.card.is-open .gdl-hint') || {}).textContent, back:!!document.querySelector('.card.is-open [data-qtyauto]')}; });
  check('96 bypass set to 3 from the price list choices, no flag', o.b === 3 && o.bSpecial === '', o);
  check('override: 3 doors on the 60, flagged special case', o.a === 3 && o.over && /SPECIAL CASE: 3 doors .*price list: 2/.test(o.special) && o.back, o);
  check('override still prices one set', o.C9 === 1 && o.T9 === 1322, o);

  // third track: Glissade Square and Swept bypass only
  const t = await page.evaluate(() => { const j = state.job, [a, b, c, d] = j.openings;
    state.editOption = null; state.openOpening = a.id; j.inHome = true; render();
    const chipA = !!document.querySelector('.card.is-open [data-track3]');
    state.openOpening = c.id; render(); const chipC = !!document.querySelector('.card.is-open [data-track3]');
    state.openOpening = d.id; render(); const chipD = !!document.querySelector('.card.is-open [data-track3]');
    state.openOpening = a.id; j.inHome = false; render();
    return {chipA, chipC, chipD, can:[a, b, c, d].map(op => canThirdTrack(op.options[0], op))}; });
  check('third track offered on a 3 door Glissade Square or Swept bypass only', t.chipA && !t.chipC && !t.chipD && t.can.join() === 'true,true,false,false', t);
  await page.evaluate(() => { state.job.inHome = true; render(); });
  await page.click('.card.is-open [data-track3]');
  const tr = await page.evaluate(() => { const j = state.job; j.inHome = false; calcJob(j); render();
    return {on:j.openings[0].options[0].v.thirdTrack, AJ9:cv('AJ9'), R9:cv('R9'), S9:cv('S9'), T9:cv('T9'), words:gdlWords(j.openings[0].options[0]).track,
      fp:signFp(j)}; });
  const ft = 5 * (33.33 + 7.98);
  check('third track: 60" is 5 feet of single top and bottom track', tr.on === true && Math.abs(tr.AJ9 - ft) < 0.01, tr);
  check('third track added to the door price, MSRP unchanged', tr.R9 === 1322 && Math.abs(tr.S9 - (1322 + ft)) < 0.01 && Math.abs(tr.T9 - tr.S9) < 0.01, tr);
  check('third track named on the contract line', tr.words === 'Third track', tr.words);
  const rvt = await page.evaluate(async () => { await openReview(); await new Promise(r => { const w = () => state.reviewReady ? r() : setTimeout(w, 50); w(); });
    const sel = document.querySelector('tr.rv-l2 select[data-rv="thirdTrack"]'); return sel && sel.value; });
  check('review: third track shown as YES on the Glissade bypass', rvt === 'YES', rvt);
  await page.evaluate(() => { state.view = 'job'; state.reviewReady = false; document.body.classList.remove('reviewing'); render(); });

  // the downloaded workbook carries the same: quantity 1, S = R + AJ
  const x = await page.evaluate(() => { const { unzipSync, strFromU8 } = getZipLib();
    const xml = fillSheet(strFromU8(unzipSync(templateBytes())['xl/worksheets/sheet3.xml']), state.job);
    const cell = ref => (xml.match(new RegExp('<c r="' + ref + '"[^>]*>.*?</c>')) || [''])[0];
    return {C9:cell('C9'), S9:cell('S9'), AJ9:cell('AJ9'), S10:cell('S10')}; });
  check('file: quantity 1 on the GDL line', /<v>1<\/v>/.test(x.C9), x.C9);
  check('file: S9 adds the track (AJ9)', /R9\+N\(\$AJ9\)/.test(x.S9) && /206\.55/.test(x.AJ9) && !/&amp;quot;/.test(x.S9), [x.S9.slice(0, 200), x.AJ9]);
  const os = require('os'), tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gdlsets-'));
  const xb = await page.evaluate(() => { const { unzipSync, zipSync, strToU8, strFromU8 } = getZipLib();
    const z = unzipSync(templateBytes()); z['xl/worksheets/sheet3.xml'] = strToU8(fillSheet(strFromU8(z['xl/worksheets/sheet3.xml']), state.job));
    return Array.from(zipSync(z, {level:6})); });
  fs.writeFileSync(path.join(tmp, 'w.xlsx'), Buffer.from(xb));
  try{
    const cp = require('child_process');
    cp.execFileSync('soffice', ['--headless', '--convert-to', 'csv:Text - txt - csv (StarCalc):44,34,76,1,,0,false,true,false,false,false,3', '--outdir', tmp, path.join(tmp, 'w.xlsx')], {timeout:120000, stdio:'ignore'});
    const csv = fs.readdirSync(tmp).filter(f => /\.csv$/.test(f)).map(f => fs.readFileSync(path.join(tmp, f), 'utf8')).find(t => /Door MSRP|Opening Height/i.test(t)) || '';
    const row9 = (csv.split('\n')[8] || '');
    check('LibreOffice: the file prices the set plus the track', row9.indexOf('1528.55') >= 0 || row9.indexOf('1,528.55') >= 0, row9.slice(0, 300));
  }catch(e){ console.log('SKIP LibreOffice check: ' + e.message.slice(0, 80)); }

  // the special case flag on the review, printed, and on the contract
  await page.evaluate(() => openReview());
  await page.waitForFunction(() => state.reviewReady);
  const rv = await page.evaluate(() => ({sp:[...document.querySelectorAll('.rv-special')].map(e => e.textContent),
    qtyOpts:[...document.querySelector('tr.rv-l1 select[data-rv="qty"]').options].map(o => o.textContent).slice(0, 4)}));
  check('review: special case shown on the overridden door only', rv.sp.length === 1 && /SPECIAL CASE: 3 doors/.test(rv.sp[0]), rv);
  check('review: the count list marks counts off the price list', rv.qtyOpts.join() === '1 (special),2,3 (special),4 (special)', rv.qtyOpts);
  await page.emulateMedia({media:'print'});
  const pr = await page.evaluate(() => [...document.querySelectorAll('.rv-special')].filter(e => getComputedStyle(e).display !== 'none' && e.getBoundingClientRect().height > 0).length);
  check('printed order shows the special case', pr === 1, pr);
  await page.emulateMedia({media:'screen'});
  const bytes = await page.evaluate(async () => Array.from(await contractPdf(state.job, {blank:true})));
  fs.writeFileSync(path.join(tmp, 'c.pdf'), Buffer.from(bytes));
  let txt = '';
  try{ txt = require('child_process').execFileSync('pdftotext', ['-raw', path.join(tmp, 'c.pdf'), '-']).toString(); }catch(e){ txt = 'no pdftotext'; }
  check('contract PDF carries the special case flag and the third track', /SPECIAL CASE: 3 doors/.test(txt) && /Third track/.test(txt), txt.slice(600, 2200));
  // choosing back to the price list count clears the flag
  await page.evaluate(() => { const op = state.job.openings[0]; reviewChange({value:'2'}, {rv:'qty', op:op.id, o:op.options[0].id}); });
  await page.waitForTimeout(100);
  check('picking the price list count on the review clears the flag', await page.evaluate(() => !state.job.openings[0].qtyOverride && !specialText(state.job.openings[0])));
  // 2.62, Andrew 20 Nov: a third track only on a set of 3 doors
  const two = await page.evaluate(() => { const op = state.job.openings[0]; calcJob(state.job);
    return {qty:op.qty, track:!!op.options[0].v.thirdTrack, AJ9:cv('AJ9'), can:canThirdTrack(op.options[0], op)}; });
  check('a 2 door set loses the third track and its cost', two.qty === 2 && !two.track && !two.AJ9 && !two.can, two);
  // a plain door keeps its own quantity in the workbook
  const plain = await page.evaluate(() => { const j = state.job, op = j.openings[3];
    Object.assign(op.options[0].v, {productType:'1.375 Hollow', doorStyle:'Kingston'}); op.qty = 2; calcJob(j);
    return {doorType:op.options[0].v.doorType, C:cv('C12'), over:op.qtyOverride}; });
  check('a door that leaves GDL goes back to its own quantity', plain.doorType === 'Bypass' && plain.C === 2 && !plain.over, plain);

  check('no page errors', !errors.length, errors);
  await browser.close(); server.close();
  console.log(fails ? fails + ' FAILED' : 'ALL PASSED');
  process.exit(fails ? 1 : 0);
})();

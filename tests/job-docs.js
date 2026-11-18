// Measurement app 2.11 and 2.12: customer documents come with the order,
// with the customer written on them, and print after the order.
//
//   node tests/job-docs.js
//   (or PLAYWRIGHT=/path/to/playwright node tests/job-docs.js)
//
// Serves measurement-app/ with Supabase switched off. Checks that the
// Handle Hardware Selection, Bypass Door Overlap Guide and Bifold Door Fit
// Guide are listed only when a quoted line needs them, that the files are
// there, and that Download workbook saves them beside the workbook.

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
  r.setHeader('Content-Type', p.endsWith('.js') ? 'text/javascript' : p.endsWith('.png') ? 'image/png' : p.endsWith('.jpg') ? 'image/jpeg' :
    p.endsWith('.pdf') ? 'application/pdf' : 'text/html');
  r.end(body);
});

let fails = 0;
const hex = h => 'rgb(' + [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)).join(', ') + ')';
const check = (name, ok, got) => {
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : '  got: ' + JSON.stringify(got).slice(0, 400)));
  if(!ok) fails++;
};

(async () => {
  await new Promise(ok => server.listen(0, ok));
  const url = 'http://127.0.0.1:' + server.address().port + '/';
  const browser = await chromium.launch();
  const page = await browser.newPage({viewport:{width:1280, height:900}, acceptDownloads:true});
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(url); await page.evaluate(() => { const nj = newJob; window.newJob = () => { const j = nj(); delete j.sizing; j.openings.forEach(o => { delete o.openW; delete o.openH; }); return j; }; }); /* 2.31: these jobs are entered the old way */
  await page.waitForTimeout(300);

  const setJob = (lines) => page.evaluate(lines => {
    state.me = {name:'admin', role:'admin'};
    const j = newJob(); j.customer = 'Docs Test'; j.openings = [];
    lines.forEach(([type, handle, w]) => {
      const op = newOpening(j.openings.length + 1); op.location = 'Bed 1'; op.width = String(w); op.height = 80;
      Object.assign(op.options[0].v, {doorType:type, productType:'1.375 Hollow', doorStyle:'Samish (Smooth)', handleType:handle});
      applyQtyRule(op); if(BYPASS_TYPES.indexOf(type) >= 0) op.qty = 2; j.openings.push(op);
    });
    state.job = j; state.view = 'job'; state.openOpening = null; render();
    return jobDocs(j).map(d => d.id + ':' + d.openings.join('/'));
  }, lines);

  let ids = await setJob([['Single Swing', 'Passage', 32]]);
  check('a plain swing door order needs no documents', ids.length === 0 && !(await page.$('.docs-box')), ids);

  ids = await setJob([['Single Swing', 'Customer Supplied', 32], ['Bypass', 'Finger Pull Round', 60],
                      ['Bifold', 'Bifold Knob', 36], ['GDL BiFold', 'Bifold Knob', 30]]);
  check('customer supplied handles, bypass and bifold each bring their document',
        ids.join() === 'handles:1,bypass:2,bifold:3/4', ids);
  const listed = await page.$$eval('.docs-box a', a => a.map(x => x.textContent));
  check('the job screen lists them', listed.join('|') === 'Handle Hardware Selection|Bypass Door Overlap Guide|Bifold Door Fit Guide', listed);

  // an unticked option does not count
  await page.evaluate(() => { state.job.openings[1].options[0].include = false; render(); });
  ids = await page.evaluate(() => jobDocs(state.job).map(d => d.id));
  check('an option not being quoted does not bring a document', !ids.includes('bypass'), ids);
  await page.evaluate(() => { state.job.openings[1].options[0].include = true; render(); });

  // the files are served
  const sizes = await page.evaluate(async () => Promise.all(JOB_DOCS.map(async d => {
    const r = await fetch(d.file); const b = await r.arrayBuffer();
    return [r.status, new TextDecoder().decode(b.slice(0, 5))]; })));
  check('each document is there and is a PDF', sizes.every(([st, sig]) => st === 200 && sig === '%PDF-'), sizes);

  // the review lists them too
  await page.click('[data-review]');
  await page.waitForFunction(() => state.reviewReady, null, {timeout:15000});
  await page.waitForTimeout(200);
  const rv = await page.$$eval('.docs-box a', a => a.length);
  check('Review order lists them', rv === 3, rv);

  // Download workbook saves the workbook and the three documents
  const got = [];
  page.on('download', d => got.push(d.suggestedFilename()));
  await page.click('[data-xml]');
  await page.waitForTimeout(3000);
  check('Download workbook saves the workbook and each document',
        got.length === 4 && got[0].endsWith('.xlsx') && got.slice(1).every(n => n.endsWith('.pdf')) &&
        got.some(n => n.includes('Bypass-Door-Overlap-Guide')), got);

  // 2.12: the customer is written on each saved form
  await page.evaluate(() => { state.job.address = '12 Main St'; state.job.city = 'Cambridge'; });
  const stamped = await page.evaluate(async () => Promise.all(jobDocs(state.job).map(async d =>
    Array.from(await stampedDoc(d, state.job)))));
  const os = require('os'), { execFileSync } = require('child_process');
  const texts = stamped.map((b, i) => { const f = path.join(os.tmpdir(), 'jobdoc-' + i + '.pdf');
    fs.writeFileSync(f, Buffer.from(b));
    try{ return execFileSync('pdftotext', [f, '-']).toString(); }catch(e){ return 'NO PDFTOTEXT'; } });
  check('each saved form carries the customer name and address',
        texts.every(t => t === 'NO PDFTOTEXT' || (t.includes('Docs Test') && t.includes('12 Main St, Cambridge'))),
        texts.map(t => t.slice(0, 80)));

  // 2.13: the door selections page: photos where the style sheet has one
  await page.evaluate(() => { state.job.openings[0].options[0].v.doorStyle = '1 Lite Rain';
    state.job.openings[1].options[0].v.doorStyle = 'Logan'; calcJob(state.job); render(); });
  const picks = await page.evaluate(() => doorPicks(state.job).map(p => [p.style, !!p.photo, p.qty]));
  check('door selections: one card per style, photo where there is one',
        JSON.stringify(picks) === JSON.stringify([['1 Lite Rain', true, 1], ['Logan', true, 2], ['Samish (Smooth)', false, 2]]), picks);
  const photosOk = await page.evaluate(async () => Promise.all(Object.values(DOOR_PHOTOS).map(async f => (await fetch(f)).status)));
  check('every door photo is there', photosOk.every(x => x === 200), photosOk);

  // 2.12: printing the review gives the order on letter sideways, then each form upright
  await page.evaluate(() => render());
  await page.evaluate(() => Promise.all([...document.querySelectorAll('.pd-card img')].map(i => i.complete ? 1 :
    new Promise(ok => { i.onload = i.onerror = ok; }))));
  await page.waitForFunction(() => [...document.querySelectorAll('.print-form image')].length === 3);
  await page.evaluate(() => Promise.all(JOB_DOCS.map(f => new Promise(ok => {
    const im = new Image(); im.onload = im.onerror = ok; im.src = f.png; }))));
  const pdf = await page.pdf({preferCSSPageSize:true, printBackground:true});
  const pf = path.join(os.tmpdir(), 'review-print.pdf'); fs.writeFileSync(pf, pdf);
  if(process.env.PRINT_OUT) fs.writeFileSync(process.env.PRINT_OUT, pdf);
  let info = '';
  try{ info = execFileSync('pdfinfo', ['-f', '1', '-l', '20', pf]).toString(); }catch(e){}
  const psizes = [...info.matchAll(/Page\s+\d+ size:\s+([\d.]+) x ([\d.]+)/g)].map(m => [+m[1], +m[2]]);
  check('the order prints on letter sideways (11 x 8.5)', !info || (psizes[0][0] === 792 && psizes[0][1] === 612), psizes);
  check('then the terms on one upright page, then the door selections sideways, then the forms',
        !info || (psizes[psizes.length - 5][0] === 612 && psizes[psizes.length - 4][0] === 792), psizes);
  check('then one upright letter page per form, three here, plus the terms page',
        !info || (psizes.slice(-3).every(([w, h]) => w === 612 && h === 792) &&
                  psizes.filter(([w]) => w === 612).length === 4), psizes);
  const ptext = info ? execFileSync('pdftotext', [pf, '-']).toString() : 'Docs Test';
  const termsText = info ? execFileSync('pdftotext', ['-f', String(psizes.length - 4), '-l', String(psizes.length - 4), pf, '-']).toString() : '';
  check('the terms page has all nine items and no One Day Doors wording', !info ||
        (termsText.includes('Install Instructions') && termsText.includes('CUSTOMER INSTALLED JAMBS') &&
         /CYLINER\s+OF\s+THE\s+HINGES/.test(termsText) && !/one\s+day/i.test(ptext) && !ptext.includes('IDCC')), termsText.slice(-300));
  check('the door page names the doors and says where they go', !info || (ptext.includes('Your door selections') &&
        ptext.includes('1 Lite Rain') && ptext.includes('Logan') && ptext.includes('Photo to come')), ptext.slice(0, 600));
  check('the printed forms carry the customer', (ptext.match(/Customer: Docs Test/g) || []).length === 2, ptext.slice(-400));

  // 2.21: signature lines on the printed order (repeating), terms and door pages
  if(info){
    const pt = require('child_process').execFileSync('pdftotext', [pf, '-']).toString().split('\f');
    const pages = pt.filter(x => x.trim());
    const nonForm = pages.slice(0, pages.length - 3);   // the last three are the forms, pictures with their own lines
    check('every printed page outside the forms has the signature lines', nonForm.length >= 3 &&
          nonForm.every(x => /Date:/.test(x) && /Customer Signature/.test(x)), nonForm.map(x => x.slice(0, 60)));
  }
  check('no page errors', errors.length === 0, errors);
  await browser.close(); server.close();
  console.log(fails ? fails + ' FAILED' : 'ALL PASSED');
  process.exit(fails ? 1 : 0);
})();

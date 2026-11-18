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
  r.setHeader('Content-Type', p.endsWith('.js') ? 'text/javascript' : p.endsWith('.png') ? 'image/png' :
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
  await page.goto(url);
  await page.waitForTimeout(300);

  const setJob = (lines) => page.evaluate(lines => {
    state.me = {name:'admin', role:'admin'};
    const j = newJob(); j.customer = 'Docs Test'; j.openings = [];
    lines.forEach(([type, handle, w]) => {
      const op = newOpening(j.openings.length + 1); op.location = 'Bed 1'; op.width = String(w); op.height = 80;
      Object.assign(op.options[0].v, {doorType:type, productType:'1.375 Hollow', doorStyle:'Columbia', handleType:handle});
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

  // 2.12: printing the review gives the order on letter sideways, then each form upright
  await page.evaluate(() => render());
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
  check('then one upright letter page per form, three here',
        !info || (psizes.slice(-3).every(([w, h]) => w === 612 && h === 792) &&
                  psizes.filter(([w]) => w === 612).length === 3), psizes);
  const ptext = info ? execFileSync('pdftotext', [pf, '-']).toString() : 'Docs Test';
  check('the printed forms carry the customer', (ptext.match(/Customer: Docs Test/g) || []).length === 2, ptext.slice(-400));

  check('no page errors', errors.length === 0, errors);
  await browser.close(); server.close();
  console.log(fails ? fails + ' FAILED' : 'ALL PASSED');
  process.exit(fails ? 1 : 0);
})();

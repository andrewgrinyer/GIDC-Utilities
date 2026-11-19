// Measurement app 2.52: swing direction on a rough opening, the condo form,
// and the Door Jamb Take-Off Work Sheet with the hinge rules.
//
//   node tests/jamb-sheet.js
//   (or PLAYWRIGHT=/path/to/playwright node tests/jamb-sheet.js)
//   PDF=/path/out.pdf also writes the contract PDF it builds.
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
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(url); await page.waitForTimeout(300);

  await page.evaluate(() => {
    state.me = {name:'admin', role:'admin'};
    const j = newJob(); j.customer = 'Jamb Test'; j.address = '1 Main St'; j.city = 'Cambridge'; j.phone = '519 555 0100';
    j.docType = 'Sales Contract - Cash Web Pricing'; j.inHome = false; j.openings = [];
    const add = (loc, now, type, prod, W, H, cond, extra) => {
      const op = newOpening(j.openings.length + 1, null, j);
      Object.assign(op, {location:loc, existingType:now, openW:String(W), openH:String(H), cond}, extra || {});
      Object.assign(op.options[0].v, {doorType:type, productType:prod, doorStyle:'Kingston', install:'YES', paintColour:'STD White',
        handleType:type === 'Bifold' ? 'Bifold Knob' : 'Passage'});
      applyQtyRule(op); j.openings.push(op); return op;
    };
    add('Foyer 1', 'Single Swing', 'Single Swing', '1.375 Hollow', 32, 82, 'Rough Opening', {jambW:'4.625'});
    add('Den', 'Double Swing AST', 'Double Swing AST', '1.375 Solid', 62, 82, 'Rough Opening', {jambW:'5.25', swingDir:'RO', hingeMatch:true});
    add('Bed 2 Clst', 'Bifold', 'Bifold', '1.375 Hollow', 48, 80.5, 'Jamb');
    add('Office', 'Single Swing', 'Single Swing', '1.75 Thick', 34, 98, 'Rough Opening', {jambW:'6.625', swingDir:'LI'});
    state.job = j; state.view = 'job'; state.openOpening = j.openings[0].id; render();
  });

  // the swing buttons under Rough Opening
  const ui = await page.evaluate(() => ({btns:[...document.querySelectorAll('.card.is-open [data-swingdir]')].map(b => b.textContent),
    miss:missing(state.job).filter(m => /swing direction/.test(m))}));
  check('rough opening shows the four swing buttons', ui.btns.join() === 'Left out,Left in,Right in,Right out', ui);
  check('a swing door in a rough opening needs its swing', ui.miss.length === 1 && /Opening 1/.test(ui.miss[0]), ui);
  await page.click('.card.is-open [data-swingdir="LI"]'); await page.waitForTimeout(150);
  const picked = await page.evaluate(() => [state.job.openings[0].swingDir, missing(state.job).filter(m => /swing direction/.test(m)).length,
    document.querySelector('.card.is-open [data-swingdir="LI"]').classList.contains('on')]);
  check('tapping Left in sets it', picked[0] === 'LI' && picked[1] === 0 && picked[2], picked);

  // the condo tick
  await page.evaluate(() => { state.custOpen = true; render(); });
  await page.check('[data-jcondo]'); await page.waitForTimeout(150);
  const condo = await page.evaluate(() => [state.job.condo, jobDocs(state.job).map(d => d.id)]);
  check('the condo tick adds the condo form', condo[0] === true && condo[1].includes('condo'), condo);

  // the rows and the hinges
  const rows = await page.evaluate(() => jambRows(state.job).map(r => ({n:r.n, dir:r.dir, jamb:jambText(r.jamb), w:r.w, h:r.h,
    size:r.hinge && r.hinge.size, qty:r.hinge && r.hinge.qty, each:r.hinge && r.hinge.each, match:r.match})));
  check('only openings that need a jamb are on the sheet', rows.map(r => r.n).join() === '1,2,4', rows);
  check('hollow 80: 2 hinges, 3" x 1/4" radius', rows[0].qty === 2 && rows[0].size === '3" x 1/4" radius' && rows[0].jamb === '4 5/8"', rows[0]);
  check('solid double 80: 3 each door, 6 in all, custom jamb', rows[1].each === 3 && rows[1].qty === 6 && rows[1].jamb === 'Custom 5 1/4"' && rows[1].match, rows[1]);
  check('1 3/4 thick 96: 4 hinges, 3 1/2"', rows[2].each === 4 && rows[2].size === '3 1/2"', rows[2]);
  check('door sizes on the sheet', rows[0].w === 30 && rows[0].h === 80, rows[0]);

  // signing covers the sheet and the condo form
  const sf = await page.evaluate(() => signFields(state.job).map(f => f.id));
  check('signing has the jamb sheet and the condo form', sf.includes('jambs') && sf.includes('form-condo'), sf);

  // the printed sheet on the review
  await page.click('[data-review]');
  await page.waitForFunction(() => state.reviewReady, null, {timeout:15000});
  await page.waitForTimeout(200);
  const pr = await page.evaluate(() => { const p = document.querySelector('.print-jambs');
    return p ? {rows:[...p.querySelectorAll('td.pj-n')].map(t => t.textContent), match:(p.querySelector('.pj-match') || {}).textContent || '',
      icons:p.querySelectorAll('.pj-ic').length, detail:!!p.querySelector('.pj-detail'), sig:!!p.querySelector('.print-sig')} : null; });
  check('the review prints the take-off sheet', pr && pr.rows.join() === '1,2,4' && pr.icons === 3 && pr.detail && pr.sig, pr);
  check('matching hinges puts the large note on the sheet', pr && /CONFIRM EXISTING HINGE SIZE AND RADIUS PRIOR TO STARTING WORK/.test(pr.match), pr);
  const forms = await page.evaluate(() => [...document.querySelectorAll('.print-forms image')].map(i => i.getAttribute('href')));
  check('the condo form prints with the order', forms.includes('condo-installation-agreement.png'), forms);

  // the contract PDF has the sheet and the form
  const pdf = await page.evaluate(async () => { const b = await contractPdf(state.job, {blank:true});
    const n = (await PDFLib.PDFDocument.load(b)).getPageCount();
    let s = ''; const u = new Uint8Array(b); for(let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]); return [btoa(s), n]; });
  const buf = Buffer.from(pdf[0], 'base64'), pages = pdf[1];
  if(process.env.PDF) fs.writeFileSync(process.env.PDF, buf);
  check('the contract PDF builds with the extra pages', buf.length > 10000 && pages >= 6, {bytes:buf.length, pages});

  check('no page errors', !errors.length, errors);
  await browser.close(); server.close();
  console.log(fails ? fails + ' FAILED' : 'ALL PASSED');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

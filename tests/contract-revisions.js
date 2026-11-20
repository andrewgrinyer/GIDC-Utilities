// Measurement app 2.28: a signed order that changes is signed again as a
// 2.57: a contract signed again is now called a Change Order (Change Order 001...).
// revision (Rev 001, Rev 002...), and the contract it replaces is kept,
// marked superseded.
//
//   node tests/contract-revisions.js
//   (or PLAYWRIGHT=/path/to/playwright node tests/contract-revisions.js)
//
// Serves measurement-app/ with Supabase switched off. Signs in person, changes
// a price, signs again: Rev 001, the first one in job.contracts marked
// superseded by Rev 001, the PDF titled Rev 001 with the note on every page,
// the review listing the earlier contract. Then Rev 002. Also stamps a PDF
// SUPERSEDED (the copy the app stores beside the original), and checks the
// customer's page of a link works out the same revision.


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

// 2.55: Print, Sign, Send to Sign and Send Estimate ask first whether the order was fully reviewed
const reviewed = async p => { if(await p.locator('#sure .reviewed').count()){ await p.click('#sure .reviewed'); await p.waitForTimeout(200); } };
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
  const signAll = async () => {
    await page.click('[data-sp="start"]');
    for(let k = 0; k < 40; k++){
      const c = await page.$('.signpad canvas'); if(!c) break;
      const b = await c.boundingBox();
      await page.mouse.move(b.x + b.width * .2, b.y + b.height * .6); await page.mouse.down();
      for(let i = 1; i <= 10; i++) await page.mouse.move(b.x + b.width * (.2 + i * .05), b.y + b.height * (.6 - .25 * Math.sin(i / 2)));
      await page.mouse.up();
      await page.click('[data-sp="next"]'); await page.waitForTimeout(40);
    }
    await page.waitForTimeout(2500);
  };
  const pdfText = async () => {
    const bytes = await page.evaluate(async () => Array.from(await contractPdf(state.job)));
    const tmp = path.join(require('os').tmpdir(), 'contract-rev-test.pdf');
    fs.writeFileSync(tmp, Buffer.from(bytes));
    try{ return require('child_process').execFileSync('pdftotext', ['-raw', tmp, '-'])  /* 2.57: -raw, the longer stamp line interleaved with a form's own text */.toString(); }catch(e){ return null; }
  };
  const changePrice = async v => {
    await page.fill('input[data-rvprice="msrpTyped"] >> nth=1', v);
    await page.locator('input[data-rvprice="msrpTyped"] >> nth=1').dispatchEvent('change');
    await page.waitForTimeout(500);
  };

  // 1. the first signing: no revision number
  await setup('sales'); await review();
  await page.click('[data-sign]'); await page.waitForTimeout(200); await reviewed(page);
  await signAll();
  let j = await page.evaluate(() => ({rev:state.job.signed.rev, ok:signedOk(state.job), n:(state.job.contracts || []).length,
    name:contractName(state.job)}));
  check('first signing is the original: rev 0, nothing superseded', j.ok && j.rev === 0 && j.n === 0, j);
  let txt = await pdfText();
  if(txt !== null) check('the original PDF has no revision on it', !/Rev 0\d\d/.test(txt), txt.slice(0, 200));

  // 2. the order changes: the review says the next one is Rev 001
  await changePrice('333');
  const warn = await page.locator('.warn.stop').innerText().catch(() => '');
  check('a changed order says the next contract is Rev 001 and the signed one is kept',
    /Change Order 001/.test(warn) && /superseded/.test(warn), warn);
  const firstAt = await page.evaluate(() => state.job.signed.at);

  // 3. signing again asks, then makes Rev 001
  await page.click('[data-sign]'); await page.waitForTimeout(200); await reviewed(page);
  const ask = await page.locator('#sure').innerText();
  check('signing again asks to sign Rev 001', /Sign Change Order 001/.test(ask) && /superseded/.test(ask), ask);
  await page.click('[data-sure="yes"]'); await page.waitForTimeout(200);
  await signAll();
  j = await page.evaluate(() => ({rev:state.job.signed.rev, ok:signedOk(state.job), cs:state.job.contracts, name:contractName(state.job),
    hist:(document.querySelector('.rv-history') || {}).innerText || '', banner:(document.querySelector('.rv-signed') || {}).innerText || ''}));
  check('the new contract is Rev 001 and signed', j.ok && j.rev === 1, j);
  check('the first contract is kept, superseded by Rev 001', j.cs && j.cs.length === 1 && j.cs[0].rev === 0 &&
    j.cs[0].supersededBy === 1 && j.cs[0].at === firstAt && !!j.cs[0].supersededAt, j.cs);
  check('the file name carries Rev 001', /Change Order 001/.test(j.name), j.name);
  check('the review lists the earlier contract as superseded', /Original/.test(j.hist) && /Superseded/.test(j.hist) && /Change Order 001/.test(j.hist), j.hist);
  check('the review says Signed (Rev 001)', /Change Order 001/.test(j.banner), j.banner);
  txt = await pdfText();
  if(txt !== null){
    check('the PDF is titled Rev 001', /Change Order 001/.test(txt), txt.slice(0, 300));
    const notes = (txt.match(/Replaces the contract signed/g) || []).length;
    const pages = (txt.match(/\f/g) || []).length;
    check('every page says which contract it replaces (' + notes + ' of ' + pages + ' pages)', notes >= pages - 1 && notes >= 4, notes);
  }

  // 4. and again: Rev 002, two kept
  await changePrice('344');
  await page.click('[data-sign]'); await page.waitForTimeout(200); await reviewed(page);
  check('the next one asks for Rev 002', /Change Order 002/.test(await page.locator('#sure').innerText()));
  await page.click('[data-sure="yes"]'); await page.waitForTimeout(200);
  await signAll();
  j = await page.evaluate(() => ({rev:state.job.signed.rev, cs:state.job.contracts.map(c => [c.rev, c.supersededBy])}));
  check('Rev 002, with the original and Rev 001 both kept', j.rev === 2 && JSON.stringify(j.cs) === '[[0,1],[1,2]]', j);
  // signing Rev 002 again unchanged is still a new revision
  await page.click('[data-sign]'); await page.waitForTimeout(200); await reviewed(page);
  check('signing an unchanged order again would be Rev 003', /Change Order 003/.test(await page.locator('#sure').innerText()));
  await page.click('[data-sure="no"]'); await page.waitForTimeout(200);

  // 5. the stored copy stamped SUPERSEDED
  const stamped = await page.evaluate(async () => Array.from(await stampPdf(await contractPdf(state.job),
    {supersededBy:3, supersededAt:'2026-11-19T12:00:00.000Z'})));
  const tmp = path.join(require('os').tmpdir(), 'contract-rev-stamped.pdf');
  fs.writeFileSync(tmp, Buffer.from(stamped));
  let st = null; try{ st = require('child_process').execFileSync('pdftotext', ['-raw', tmp, '-'])  /* 2.57: -raw, the longer stamp line interleaved with a form's own text */.toString(); }catch(e){}
  if(st !== null){
    const n = (st.match(/SUPERSEDED by Change Order 003 on November 19, 2026/g) || []).length, pages = (st.match(/\f/g) || []).length;
    check('the superseded copy says so across the top of every page (' + n + ' of ' + pages + ')', n === pages && n >= 4, st.slice(0, 300));
    // the big diagonal word is drawn too (rotated text does not come out of pdftotext; SHOT=... renders page 1)
  }
  if(process.env.SHOT){ try{ require('child_process').execFileSync('pdftoppm', ['-r', '60', '-png', '-f', '1', '-l', '1', tmp, process.env.SHOT]); }catch(e){} }

  // 6. the customer's page of a link: the job as sent was signed, so it is Rev 003 there too
  const remote = await page.evaluate(() => { const snap = JSON.parse(JSON.stringify(state.job));
    const fake = {id:'req-9', signedAt:'2026-11-20T15:00:00.000Z', name:'Jane Sample'};
    const rev = nextRev(snap);
    if(snap.signed && snap.signed.at) supersede(snap, rev);
    snap.signed = {at:fake.signedAt, name:fake.name, where:'remote', request:fake.id, rev, marks:{}};
    snap.signed.fp = signFp(snap);
    return {rev, label:revOf(snap), last:snap.contracts.slice(-1)[0].supersededBy, note:revNote(snap)}; });
  check('a link signed after Rev 002 is Rev 003, and Rev 002 is superseded', remote.rev === 3 && remote.label === 3 && remote.last === 3 &&
    /Change Order 003\. Replaces the contract signed/.test(remote.note), remote);

  check('no page errors', errors.length === 0, errors);
  await browser.close(); server.close();
  console.log(fails ? fails + ' FAILED' : 'ALL PASSED');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

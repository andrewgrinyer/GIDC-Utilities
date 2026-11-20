// Measurement app 2.57: one measurement, several quotes: options side by side,
// numbered revisions locked when sent, the signed option supersedes the rest.
//
//   node tests/quotes.js
//   (or PLAYWRIGHT=/path/to/playwright node tests/quotes.js)
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
  const page = await browser.newPage({viewport:{width:1280, height:900}, acceptDownloads:true});
  const errors = [];
  await page.goto(url); await page.waitForTimeout(300);
  await page.evaluate(() => {
    state.me = {name:'admin', role:'admin'};
    const j = newJob(); Object.assign(j, {customer:'Quote Test', address:'1 Main St', city:'Cambridge', phone:'519 555 0100', salesRep:'Andrew Grinyer',
      leadTime:'8-10 Weeks', docType:'Sales Contract - Cash Web Pricing'}); j.inHome = false; j.openings = [];
    const add = (type, W, H) => {
      const op = newOpening(j.openings.length + 1, null, j);
      Object.assign(op, {location:'Foyer 1', existingType:type, openW:String(W), openH:String(H), cond:'Jamb'});
      Object.assign(op.options[0].v, {doorType:type, productType:'1.375 Hollow', doorStyle:'Kingston', install:'YES', paintColour:'STD White', handleType:'Passage'});
      applyQtyRule(op); j.openings.push(op); return op;
    };
    add('Single Swing', 30.25, 81); add('Single Swing', 28.25, 81);
    state.job = j; state.view = 'job'; render();
  });
  const reviewed = async () => { if(await page.locator('#sure .reviewed').count()){ await page.click('#sure .reviewed'); await page.waitForTimeout(150); } };
  const info = () => page.evaluate(() => ({ref:quoteRef(state.job), bar:(document.querySelector('.qbar') || {}).textContent || '',
    revs:Object.fromEntries(Object.entries(ensureQuotes(state.job).opts).map(([k, o]) => [k, o.revs.map(r => [r.rev, (r.events || []).map(e => e.kind).join('+')])])),
    style:state.job.openings[0].options[0].v.doorStyle, active:activeOpt(state.job)}));

  await page.click('[data-review]'); await page.waitForFunction(() => state.reviewReady, null, {timeout:30000});
  let q = await info();
  check('a new job is Rev 1, not sent yet, and the quote bar shows it', /^Q\w+ Rev 1$/.test(q.ref) && /Not sent yet/.test(q.bar), q);

  // the estimate goes out: Rev 1 is locked as sent
  await page.click('[data-quote]'); await page.waitForTimeout(150); await reviewed();
  const [dl] = await Promise.all([page.waitForEvent('download', {timeout:30000}), page.click('#sure [data-sure="yes"]')]);
  await page.waitForTimeout(300);
  q = await info();
  check('sending the estimate locks Rev 1', JSON.stringify(q.revs.A) === '[[1,"estimate"]]' && / Rev 1$/.test(q.ref) && /Same as estimate sent/.test(q.bar), q);

  // a change after sending is Rev 2
  await page.evaluate(() => { state.job.openings[0].options[0].v.doorStyle = 'Logan'; calcJob(state.job); render(); });
  q = await info();
  check('a change after sending is Rev 2', / Rev 2$/.test(q.ref) && /Changed since Rev 1/.test(q.bar), q);

  // Rev 1's estimate is made again from its own choices, and the job is left as it was
  await page.click('[data-toggle="qhist"]'); await page.waitForTimeout(100);
  const [d1] = await Promise.all([page.waitForEvent('download', {timeout:30000}), page.click('[data-qpdf="A:1"]')]);
  const p1 = path.join(require('os').tmpdir(), 'quote-rev1.pdf'); await d1.saveAs(p1);
  let t1 = ''; try{ t1 = require('child_process').execFileSync('pdftotext', ['-raw', p1, '-']).toString(); }catch(e){ t1 = 'no pdftotext'; }
  q = await info();
  check('Rev 1 estimate PDF says Rev 1', /Q\w+ Rev 1/.test(t1), t1.slice(0, 400));
  check('making it leaves the live quote at Rev 2 with its change', q.style === 'Logan' && / Rev 2$/.test(q.ref), q);

  // Revise quote locks Rev 2 and starts Rev 3
  await page.click('[data-qrevise]'); await page.waitForTimeout(150); await page.click('#sure [data-sure="yes"]'); await page.waitForTimeout(150);
  q = await info();
  check('Revise quote locks Rev 2 and starts Rev 3', JSON.stringify(q.revs.A) === '[[1,"estimate"],[2,"revised"]]' && / Rev 3$/.test(q.ref), q);

  // + Option: B starts as a copy, changes stay in B
  await page.click('[data-qnew]'); await page.waitForTimeout(200);
  q = await info();
  check('+ Option makes Option B, a copy at Rev 1', q.active === 'B' && / Option B Rev 1$/.test(q.ref) && q.style === 'Logan', q);
  await page.evaluate(() => { state.job.openings[0].options[0].v.doorStyle = 'Rosario'; calcJob(state.job); render(); });
  await page.click('[data-qopt="A"]'); await page.waitForTimeout(200);
  q = await info();
  check('switching to Option A brings back its own choices', q.active === 'A' && q.style === 'Logan' && / Option A Rev 3$/.test(q.ref), q);
  await page.click('[data-qopt="B"]'); await page.waitForTimeout(200);
  q = await info();
  check('and Option B keeps its own', q.active === 'B' && q.style === 'Rosario', q);
  const pdfB = await page.evaluate(async () => Array.from(await contractPdf(state.job, {quote:true, blank:true})));
  const pb = path.join(require('os').tmpdir(), 'quote-b.pdf'); fs.writeFileSync(pb, Buffer.from(pdfB));
  let tb = ''; try{ tb = require('child_process').execFileSync('pdftotext', ['-raw', pb, '-']).toString(); }catch(e){}
  check('the estimate carries the quote number, option and revision', /Q\w+ Option B Rev 1/.test(tb), tb.slice(0, 300));

  // B is signed: it is the contract, A is superseded
  await page.evaluate(() => { const j = state.job;
    j.signed = {at:new Date().toISOString(), name:'Jane', fp:signFp(j), opt:activeOpt(j), qrev:quoteRev(j), rev:0, marks:{}};
    markSigned(j); render(); });
  q = await info();
  const sup = await page.evaluate(() => [!!ensureQuotes(state.job).opts.A.superseded, signedOk(state.job), /Option A <i>superseded/.test(document.querySelector('.qopts').innerHTML)]);
  check('signing Option B locks it as the contract and supersedes Option A', JSON.stringify(q.revs.B) === '[[1,"contract"]]' && sup[0] && sup[1] && sup[2], [q, sup]);
  await page.click('[data-qopt="A"]'); await page.waitForTimeout(200);
  const onA = await page.evaluate(() => [signedOk(state.job), (document.querySelector('.warn.stop') || {}).textContent || '']);
  check('on Option A the review says Option B was signed', !onA[0] && /Option B was signed/.test(onA[1]) && /Change Order 001/.test(onA[1]), onA);
  await page.click('[data-xml]'); await page.waitForTimeout(150);
  check('downloading Option A warns it is not the signed option', /not the signed option/.test(await page.locator('#sure').innerText()));
  await page.click('#sure [data-sure="no"]');

  // the measurement stays put: a size changed under one option is the same under the other
  await page.evaluate(() => { state.job.openings[1].openW = '30.25'; switchOpt(state.job, 'B'); });
  check('openings are shared by every option', await page.evaluate(() => state.job.openings[1].openW) === '30.25');

  // 2.57: what the opening has is required, like its size
  const miss = await page.evaluate(() => { delete state.job.openings[1].cond; return missing(state.job); });
  check('opening has is required', miss.some(m => /Opening 2: opening has/.test(m)), miss);
  await page.evaluate(() => { state.view = 'job'; document.body.classList.remove('reviewing'); state.openOpening = state.job.openings[1].id; render(); });
  const req = await page.evaluate(() => [...document.querySelectorAll('.card.is-open .field .req')].map(e => e.closest('.field').querySelector('label').textContent));
  check('it is marked needed on the opening', req.some(t => /^Opening has/.test(t)), req);
  check('the opening has an Add note button', await page.locator('.card.is-open [data-opnoteadd]').innerText() === '+ Add note');

  check('no page errors', !errors.length, errors);
  await browser.close(); server.close();
  console.log(fails ? fails + ' FAILED' : 'ALL PASSED');
  process.exit(fails ? 1 : 0);
})();

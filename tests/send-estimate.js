// Measurement app 2.35: Send estimate on the review builds the Summary
// Estimate (category totals from the workbook's Order Total box) as a one
// page PDF in the contract style.
//
//   node tests/send-estimate.js
//
// Serves measurement-app/ with Supabase switched off. Prints PASS or FAIL per
// check and exits 1 on any failure.

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
  await page.goto(url); await page.waitForTimeout(300);
  await page.evaluate(() => {
    state.me = {name:'tester', role:'admin'};
    const j = newJob(); delete j.sizing;
    Object.assign(j, {customer:'Jane Sample', address:'12 Main St', city:'Cambridge', phone:'519 555 1234',
      email:'jane@example.com', salesRep:'Sam Rep', leadTime:'8 to 10 weeks', docType:'Estimate - Cash Web Pricing'}); j.openings = [];
    const add = (loc, type, style, w, extra) => { const op = newOpening(j.openings.length + 1);
      op.location = loc; op.existingType = type; op.width = String(w); op.height = 80;
      Object.assign(op.options[0].v, {doorType:type, productType:'1.375 Hollow', doorStyle:style, jamb:'',
        routerStop:'NO', reStile:'NO', install:'YES', paintColour:'STD White'}, extra || {});
      applyQtyRule(op); j.openings.push(op); return op; };
    add('Den', 'Single Swing', 'Columbia', 32, {handleType:'Passage', handleStyle:'R -Latitude Standard', hwColour:'Matte Black'});
    add('Master Clst', 'Bifold', 'Kingston', 48, {handleType:'Bifold Knob'});
    state.job = j; state.view = 'job'; render();
  });
  await page.click('[data-review]');
  await page.waitForFunction(() => state.reviewReady, null, {timeout:30000});
  await page.waitForTimeout(200);
  check('the review has Send estimate', await page.$('[data-quote]') !== null, null);

  const Q = await page.evaluate(() => { const q = quoteFigures(state.job); return {q, grand:cv('U54')}; });
  const sum = Q.q.cats.reduce((a, c) => a + c.amount, 0);
  const sub = Q.q.sums.find(r => r.label === 'Subtotal').amount;
  check('categories are the workbook totals and add up to the subtotal', Q.q.cats.length >= 3 &&
        Math.abs(sum - sub) < 0.02 && Q.q.cats[0].label === 'Doors', Q.q);
  check('the estimate total is the workbook grand total', Math.abs(Q.q.grand - Q.grand) < 0.01, Q);

  const bytes = await page.evaluate(async () => Array.from(await contractPdf(state.job, {quote:true, blank:true})));
  const tmp = path.join(require('os').tmpdir(), 'send-estimate-' + process.pid + '.pdf');
  fs.writeFileSync(tmp, Buffer.from(bytes));
  let txt = null, pages = null;
  try{ txt = require('child_process').execFileSync('pdftotext', ['-layout', tmp, '-']).toString();
       pages = (require('child_process').execFileSync('pdfinfo', [tmp]).toString().match(/Pages:\s+(\d+)/) || [])[1]; }catch(e){}
  if(txt === null) console.log('SKIP estimate text (no pdftotext here)');
  else {
    check('one page', pages === '1', pages);
    check('titled Estimate, for the customer', /Estimate/.test(txt) && /Jane Sample/.test(txt) && /Valid until/i.test(txt), txt.slice(0, 500));
    check('category lines, no door lines', /Doors/.test(txt) && /Installation/.test(txt) && !/Columbia/.test(txt), txt);
    check('total and deposit', txt.includes(Q.q.sums.find(r => r.grand).label) && /deposit/i.test(txt), txt);
  }
  if(process.env.SHOTS) fs.copyFileSync(tmp, path.join(process.env.SHOTS, 'estimate.pdf'));
  fs.unlinkSync(tmp);

  check('no page errors', !errors.length, errors);
  await browser.close(); server.close();
  console.log(fails ? fails + ' FAILED' : 'ALL PASSED');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

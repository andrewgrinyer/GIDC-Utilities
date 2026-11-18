// Measurement app 2.32: a size marked Check is confirmed before signing, and
// special order items show in red on the contract with their own initial.
//
//   node tests/size-confirm.js
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
  const errors = [], toasts = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(url); await page.waitForTimeout(300);
  await page.evaluate(() => { const t = window.toast; window.toast = m => { (window.__t = window.__t || []).push(m); return t(m); }; });

  await page.evaluate(() => {
    state.me = {name:'tester', role:'admin'};
    const j = newJob(); delete j.sizing;
    Object.assign(j, {customer:'Jane Sample', address:'12 Main St', city:'Cambridge', phone:'519 555 1234',
      email:'jane@example.com', salesRep:'Sam Rep', docType:'Sales Contract - Cash Web Pricing'}); j.openings = [];
    const add = (loc, style, w, h) => { const op = newOpening(j.openings.length + 1);
      op.location = loc; op.existingType = 'Single Swing'; op.width = String(w); op.height = h;
      Object.assign(op.options[0].v, {doorType:'Single Swing', productType:'1.375 Hollow', doorStyle:style, jamb:'',
        routerStop:'NO', reStile:'NO', install:'YES', paintColour:'STD White', handleType:'Passage'});
      applyQtyRule(op); j.openings.push(op); return op; };
    add('Den', 'Columbia', 32, 80);          // stock
    add('Hall', 'Kingston', 20, 96);         // 8 foot Lynden: Check
    state.job = j; state.view = 'job'; render();
  });
  await page.click('[data-review]');
  await page.waitForFunction(() => state.reviewReady, null, {timeout:30000});
  await page.waitForTimeout(200);

  const st = () => page.evaluate(() => state.job.openings.map(op => sizeCheck(op, op.options[0]).status));
  check('the 8 foot Kingston is marked Check', (await st()).join() === 'ok,check', await st());
  check('the review offers Confirmed stock and Special order', await page.$$eval('[data-sizeok]', b => b.length) === 2, null);
  check('signing waits for the confirmation', (await page.evaluate(() => sizeUnconfirmed(state.job))).join() === '2', null);
  await page.evaluate(() => { window.__t = []; signContract(state.job); });
  await page.waitForTimeout(200);
  const t1 = await page.evaluate(() => window.__t.join('|'));
  check('Sign says to confirm opening 2 first', /Confirm the supplier size on opening 2/.test(t1), t1);

  await page.click('[data-sizeok="stock"]'); await page.waitForTimeout(300);
  const ok1 = await page.evaluate(() => { const op = state.job.openings[1], z = sizeCheck(op, op.options[0]);
    return {z, list:document.querySelector('.rv-sizes').textContent, by:op.options[0].sizeOk}; });
  check('Confirmed stock makes it stock, with who and when', ok1.z.status === 'ok' && ok1.z.confirmed &&
        /Confirmed stock by tester/.test(ok1.list) && ok1.by.as === 'stock', ok1);
  check('nothing left to confirm', (await page.evaluate(() => sizeUnconfirmed(state.job))).length === 0, null);
  const back = await page.evaluate(() => { const op = state.job.openings[1]; op.width = '22';
    const a = sizeCheck(op, op.options[0]).status; op.width = '20'; return [a, sizeCheck(op, op.options[0]).status]; });
  check('changing the size undoes the confirmation', back.join() === 'check,ok', back);

  await page.click('[data-sizeok=""]'); await page.waitForTimeout(300);
  await page.click('[data-sizeok="so"]'); await page.waitForTimeout(300);
  const so = await page.evaluate(() => { const op = state.job.openings[1];
    return {s:sizeCheck(op, op.options[0]).status, r:cv('R' + PAGE_ROWS[1]), list:specialOrders(state.job),
            fields:signFields(state.job).map(f => f.id)}; });
  check('Special order makes it special order, with no price', so.s === 'so' && so.r === 'S/O', so);
  check('special order list names the opening', so.list.length === 1 && /Opening 2 \(Hall\): Kingston/.test(so.list[0].text), so.list);
  check('the customer initials the special order items', so.fields[1] === 'ini-so', so.fields);

  // the contract: an Ordered column and the special order box with its initial
  await page.evaluate(() => { state.job.openings[1].options[0].v.msrpTyped = '300'; calcJob(state.job); });
  const pdf = await page.evaluate(async () => { const spots = {}; const b = await contractPdf(state.job, {blank:true, spots});
    return {bytes:Array.from(b), spot:spots['ini-so'] || null}; });
  check('the special order initial has its place on the order page', pdf.spot && pdf.spot.p === 0, pdf.spot);
  const tmp = path.join(require('os').tmpdir(), 'size-confirm-' + process.pid + '.pdf');
  fs.writeFileSync(tmp, Buffer.from(pdf.bytes));
  let txt = null;
  try{ txt = require('child_process').execFileSync('pdftotext', ['-f', '1', '-l', '1', '-layout', tmp, '-']).toString(); }catch(e){}
  if(txt === null) console.log('SKIP contract text (no pdftotext here)');
  else {
    check('the order has an Ordered column with the stock size', /ORDERED/.test(txt) && /2'8" x 6'8"/.test(txt), txt.slice(0, 600));
    check('the special order box says they cannot be returned', /SPECIAL ORDER ITEMS/.test(txt) &&
          /cannot be returned or refunded/.test(txt) && /Opening 2 \(Hall\)/.test(txt), txt.slice(0, 1500));
  }
  if(process.env.SHOTS){ fs.copyFileSync(tmp, path.join(process.env.SHOTS, 'size-confirm.pdf'));
    await page.screenshot({path:path.join(process.env.SHOTS, 'size-confirm-review.png'), fullPage:true}); }
  fs.unlinkSync(tmp);

  check('no page errors', !errors.length, errors);
  await browser.close(); server.close();
  console.log(fails ? fails + ' FAILED' : 'ALL PASSED');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

// Measurement app 2.70: the closet order on the contract (2.71: without the app's drawings).
//
//   node tests/closet-contract.js
//   (or PLAYWRIGHT=/path/to/playwright node tests/closet-contract.js)
//
// iPhone sized screen, Supabase switched off (the design PDF is kept on the
// device). A closets only job: price, tear out choice and the
// design PDF on the Closets screen; Review order from the Closets dock; the
// price lands in U46 (Organizer) and the tax is worked on it; signing walks
// the closet field and the closet forms; the signed PDF has the closet page,
// every design page and the forms. Then a job with doors and closets, the
// paint choice, a condo job, and the printed review.

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
const reviewed = async p => { if(await p.locator('#sure .reviewed').count()){ await p.click('#sure .reviewed'); await p.waitForTimeout(200); } };
let fails = 0;
const check = (name, ok, got) => {
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : '  got: ' + String(JSON.stringify(got)).slice(0, 500)));
  if(!ok) fails++;
};
const pdfText = bytes => {
  const tmp = path.join(require('os').tmpdir(), 'closet-contract-test.pdf');
  fs.writeFileSync(tmp, Buffer.from(bytes));
  try{ return require('child_process').execFileSync('pdftotext', ['-layout', tmp, '-']).toString(); }catch(e){ return null; }
};

(async () => {
  await new Promise(ok => server.listen(0, ok));
  const url = 'http://127.0.0.1:' + server.address().port + '/';
  const browser = await chromium.launch();
  const page = await browser.newPage({viewport:{width:390, height:844}, hasTouch:true, isMobile:true, deviceScaleFactor:1});
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(url); await page.waitForTimeout(400);

  // a two page "closet design" made here, so no real customer file is needed
  const design = Buffer.from(await page.evaluate(async () => {
    await loadScript(PDFLIB_SRC);
    const d = await PDFLib.PDFDocument.create(), f = await d.embedFont(PDFLib.StandardFonts.Helvetica);
    [1, 2].forEach(n => { const p = d.addPage([792, 612]); p.drawText('Test closet design page ' + n, {x:60, y:500, size:24, font:f}); });
    return Array.from(await d.save());
  }));

  const setup = async (withDoors) => page.evaluate(withDoors => {
    state.me = {name:'tester', role:'sales'};
    const j = newJob(); Object.assign(j, {customer:'Cara Closet', address:'5 Elm St', city:'Cambridge',
      phone:'519 555 0000', email:'cara@example.com', salesRep:'Sam Rep', leadTime:'8-10 Weeks',
      docType:'Sales Contract - Cash Web Pricing'}); j.openings = [];
    if(withDoors){ const op = newOpening(1); op.location = 'Den'; op.existingType = 'Bifold'; op.width = '30'; op.height = 80;
      Object.assign(op.options[0].v, {doorType:'Bifold', productType:'1.375 Hollow', doorStyle:'Kingston', jamb:'', routerStop:'NO',
        reStile:'NO', install:'YES', paintColour:'STD White', handleType:'Bifold Knob'});
      applyQtyRule(op); j.openings.push(op); }
    state.job = j; state.view = 'closets'; render();
  }, withDoors);
  const addCloset = async () => {
    await page.click('[data-cl="add"]'); await page.waitForTimeout(150);
    await page.click('.cl-card.is-open [data-cl="shape"][data-k="reach"]'); await page.waitForTimeout(150);
    await page.evaluate(() => { const c = state.job.closets[state.job.closets.length - 1];
      c.location = 'Master Bedroom'; clSegs(c).forEach((g, i) => c.dims[g.k] = String(24 + i * 12)); c.ceiling = '96'; c.note = 'Bulkhead over the door';
      clMarks(c).push({id:uid(), type:'Window', wall:'C', from:'12', size:'30'}); render(); });
  };

  // 1. closets only job: the closet order on the Closets screen
  await setup(false); await addCloset();
  check('the closet order card shows on the Closets screen', await page.locator('.cl-order [data-clprice]').count() === 1);
  // 2.77, Andrew 27 Nov: no closet options on the closet any more (the design PDF has them)
  check('no closet options on the closet', await page.locator('.cl-det, [data-cldet], [data-cl="det"]').count() === 0);
  const miss0 = await page.evaluate(() => missing(state.job).filter(m => /^Closets/.test(m)));
  check('signing waits for the price, tear out and design', miss0.length === 3, miss0);
  await page.fill('[data-clprice]', '$4,250.50'); await page.locator('[data-clprice]').dispatchEvent('change'); await page.waitForTimeout(150);
  await page.click('[data-cl="tear"][data-v="patch"]'); await page.waitForTimeout(150);
  await page.setInputFiles('[data-clfile]', {name:'Cara closets.pdf', mimeType:'application/pdf', buffer:design});
  await page.waitForFunction(() => state.job.closetFile, null, {timeout:10000});
  const cf = await page.evaluate(() => ({f:state.job.closetFile, price:clPriceNum(state.job), tear:state.job.closetTearOut,
    miss:missing(state.job), text:document.querySelector('.cl-order').innerText}));
  check('the design PDF is on the job (2 pages)', cf.f.pages === 2 && cf.f.name === 'Cara closets.pdf' && /2 pages/.test(cf.text), cf);
  check('price and tear out saved, nothing missing', cf.price === 4250.5 && cf.tear === 'patch' && cf.miss.length === 0, cf);
  check('the card names the forms signed with it', /Closet Installation Details/.test(cf.text), cf.text);
  if(process.env.SHOT) await page.screenshot({path:process.env.SHOT, fullPage:true});

  // 2. Review order from the Closets dock; the price is the Organizer line
  check('the Closets dock has Review order', await page.locator('#dock [data-review]').count() === 1);
  await page.click('#dock [data-review]');
  await page.waitForFunction(() => state.reviewReady, null, {timeout:30000}); await page.waitForTimeout(300);
  const tot = await page.evaluate(() => ({q:cv('Q46'), u46:cv('U46'), sub:cv('U51'), tax:cv('U52'), grand:cv('U54'),
    sign:!document.querySelector('[data-sign]').disabled, send:!!document.querySelector('[data-quote]') && !document.querySelector('[data-quote]').disabled,
    box:document.querySelector('.cl-rv') && document.querySelector('.cl-rv').innerText}));
  check('U46 Organizer is the closet price', tot.u46 === 4250.5 && /organi[sz]er/i.test(String(tot.q)), tot);
  check('subtotal and tax include it', Math.abs(tot.sub - 4250.5) < 0.01 && Math.abs(tot.tax - 4250.5 * 0.13) < 0.02, tot);
  check('Sign and Send Estimate work with no doors', tot.sign && tot.send, tot);
  check('the review shows the closets box', /1 closet/.test(tot.box || '') && /Rough Patch/.test(tot.box || ''), tot.box);
  const fields = await page.evaluate(() => signFields(state.job).map(f => f.id));
  check('fields: contract, terms, closets, the drawings initial and the rough patch form', ['contract', 'terms', 'closets', 'ini-design', 'form-closetpatch'].every(f => fields.includes(f)) &&
    !fields.includes('doors') && !fields.includes('form-closetpaint'), fields);

  // 3. sign in person
  await page.click('[data-sign]'); await page.waitForTimeout(200); await reviewed(page);
  await page.click('[data-sp="start"]');
  let seenCloset = null, designSeen = null;
  for(let k = 0; k < fields.length; k++){
    const c = await page.$('.signpad canvas');
    if(!c && await page.$('.signpad .sp-read')){ await page.click('[data-sp="next"]'); await page.waitForTimeout(40); continue; }   // 2.72: a term to read
    if(!c) break;
    if(fields[k] === 'ini-design'){        // 2.79: every drawing page on screen, one initial
      await page.waitForSelector('.sp-spot.on', {timeout:20000}).catch(() => {});
      designSeen = await page.evaluate(() => ({pages:document.querySelectorAll('.sp-page img').length, top:document.querySelector('.sp-doc').scrollTop}));
    }
    if(fields[k] === 'closets' || fields[k] === 'form-closetpatch'){
      await page.waitForSelector('.sp-spot.on', {timeout:20000}).catch(() => {});
      const v = await page.evaluate(() => document.querySelectorAll('.sp-page img').length);
      seenCloset = (seenCloset || 0) + (v ? 1 : 0);
    }
    const b = await c.boundingBox();
    await page.mouse.move(b.x + b.width * .2, b.y + b.height * .6); await page.mouse.down();
    for(let i = 1; i <= 10; i++) await page.mouse.move(b.x + b.width * (.2 + i * .05), b.y + b.height * (.6 - .25 * Math.sin(i / 2)));
    await page.mouse.up();
    await page.click('[data-sp="next"]'); await page.waitForTimeout(60);
  }
  check('the closet page and the closet form show while signing', seenCloset === 2, seenCloset);
  check('the drawings initial shows both design pages, from the top', designSeen && designSeen.pages === 2 && designSeen.top === 0, designSeen);
  await page.waitForTimeout(2500);
  const s = await page.evaluate(() => ({ok:signedOk(state.job), n:Object.keys(state.job.signed.marks).length}));
  check('every field signed', s.ok && s.n === fields.filter(f => !/^read-/.test(f)).length, s);

  // 4. the signed PDF
  const info = await page.evaluate(async () => { const b = await contractPdf(state.job); const d = await PDFLib.PDFDocument.load(b);
    return {bytes:Array.from(b), n:d.getPageCount(), forms:jobDocs(state.job).length}; });
  check('PDF: order, terms, closet page, 2 design pages, form', info.n === 1 + 1 + 1 + 2 + info.forms && info.forms === 1, info.n);
  const txt = pdfText(info.bytes);
  if(txt === null) console.log('SKIP PDF text (no pdftotext here)');
  else {
    check('PDF has the closet page with the order and details', ['Closet Organizers', 'Master Bedroom', 'No Charge Tear Out and Rough Patch',
      '4,250.50'].every(w => txt.includes(w)), txt.slice(0, 1500));
    // 2.71, Andrew: the app's drawings, sizes, marks and notes are sales reference only
    check('PDF leaves out the measurement drawing, sizes, marks and notes', !['Ceiling height', 'Sizes:', 'Window on wall C', 'Bulkhead over the door']
      .some(w => txt.includes(w)), txt.slice(0, 1500));
    check('the initial box is on every design page', (txt.match(/Customer initial/g) || []).length === 2, (txt.match(/Customer initial/g) || []).length);
    check('PDF has both design pages', txt.includes('Test closet design page 1') && txt.includes('Test closet design page 2') && txt.includes('Closet design, page 2 of 2'));
    check('PDF order page says closets only', txt.includes('CLOSET ORGANIZERS ONLY'));
  }

  // 5. a change to a closet after signing needs a new signature
  await page.evaluate(() => { state.job.closets[0].dims.A = '50'; });
  check('changing a closet size unsigns the order', await page.evaluate(() => !signedOk(state.job)));

  // 6. doors and closets, paint choice, condo; 2.72: the design dropped on the screen
  await setup(true); await addCloset();
  await page.evaluate(() => { state.job.closetPrice = '1000'; state.job.closetTearOut = 'paint'; state.job.condo = true; render(); });
  await page.evaluate(bytes => { const dt = new DataTransfer();
    dt.items.add(new File([new Uint8Array(bytes)], 'dropped design.pdf', {type:'application/pdf'}));
    const at = document.querySelector('.cl-card');
    at.dispatchEvent(new DragEvent('dragover', {dataTransfer:dt, bubbles:true, cancelable:true}));
    window.__lit = document.querySelector('.cl-order').classList.contains('cl-dropping');
    at.dispatchEvent(new DragEvent('drop', {dataTransfer:dt, bubbles:true, cancelable:true})); }, Array.from(design));
  await page.waitForFunction(() => state.job.closetFile, null, {timeout:10000}).catch(() => {});
  const drop = await page.evaluate(() => ({lit:window.__lit, f:state.job.closetFile && state.job.closetFile.name}));
  check('a PDF dragged onto the Closets screen is the closet design', drop.lit && drop.f === 'dropped design.pdf', drop);
  await page.click('#dock [data-review]');
  await page.waitForFunction(() => state.reviewReady, null, {timeout:30000}); await page.waitForTimeout(300);
  const mix = await page.evaluate(() => ({f:signFields(state.job).map(f => f.id), u46:cv('U46'), door:cv('T' + PAGE_ROWS[0]), sub:cv('U51'),
    docs:jobDocs(state.job).map(d => d.id)}));
  check('doors and closets: both on the order', mix.f.includes('doors') && mix.f.includes('closets') && mix.u46 === 1000 && mix.sub > 1000, mix);
  check('paint choice signs the paint form; condo adds both condo forms', mix.docs.includes('closetpaint') && !mix.docs.includes('closetpatch') &&
    mix.docs.includes('condo') && mix.docs.includes('condocloset'), mix.docs);
  const mixPdf = await page.evaluate(async () => (await PDFLib.PDFDocument.load(await contractPdf(state.job, {blank:true}))).getPageCount());
  check('mixed PDF: order, terms, doors, closets, 2 design, 3 forms', mixPdf >= 1 + 1 + 1 + 1 + 2 + 3, mixPdf);

  // 7. printed: the closet page and the design pages are in the print
  await page.evaluate(() => { const d = document.querySelector('[data-revprint]'); d.click(); });
  await page.waitForTimeout(300); await reviewed(page);
  await page.waitForFunction(() => document.querySelector('.print-designs') && document.querySelector('.print-designs').dataset.done, null, {timeout:15000}).catch(() => {});
  await page.emulateMedia({media:'print'});
  const pr = await page.evaluate(() => ({cl:getComputedStyle(document.querySelector('.cl-order-print')).display,
    imgs:document.querySelectorAll('.print-design img').length, sig:!!document.querySelector('.cl-order-print .print-sig'),
    svg:document.querySelectorAll('.cl-order-print svg.cl-svg').length}));
  check('the printed order has no measurement drawings', pr.svg === 0, pr);
  check('print has the closet page with a signature line and both design pages', pr.cl === 'block' && pr.imgs === 2 && pr.sig, pr);
  await page.emulateMedia({media:'screen'});

  // 8. closets only: Download workbook is on, and the job screen has Review order
  await setup(false); await addCloset();
  await page.evaluate(() => { state.view = 'job'; render(); });
  check('closets only job screen offers Review order', await page.locator('#dock [data-review]').count() === 1);

  check('no page errors', errors.length === 0, errors);
  await browser.close(); server.close();
  console.log(fails ? fails + ' FAILED' : 'ALL PASSED');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

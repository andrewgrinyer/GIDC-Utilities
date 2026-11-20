// Measurement app 2.59 and 2.60: the GDL line, install Yes/No (Free on GDL). Frame and insert colours, bypass or bifold only,
// frame and insert on the review, the contract and the door selections, not in the workbook.
//
//   node tests/gdl.js
//   (or PLAYWRIGHT=/path/to/playwright node tests/gdl.js)
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
  const r = await page.evaluate(() => {
    state.me = {name:'admin', role:'admin'};
    const j = newJob(); j.customer = 'GDL Test'; j.address = '1 Main St'; j.city = 'Cambridge'; j.inHome = false; j.openings = [];
    j.defaults = {paintColour:'STD White'};
    const add = (type, W, H, v) => {
      const op = newOpening(j.openings.length + 1, null, j);
      Object.assign(op, {location:'Master Clst 1', existingType:type, openW:String(W), openH:String(H), cond:'Jamb'});
      Object.assign(op.options[0].v, {doorType:type, productType:'1.375 Hollow', doorStyle:'Kingston', install:'YES',
        paintColour:'STD White', handleType:'Finger Pull Round', hwColour:'Chrome', routerStop:'YES', reStile:'YES'}, v || {});
      applyQtyRule(op); j.openings.push(op); return op;
    };
    const a = add('Bypass', 60, 80.5, {productType:'GDL', doorStyle:'Glissade Square Style 3'});   // product set to GDL
    const b = add('GDL BiFold', 30, 80.5, {doorStyle:'Kingston'});                                  // GDL type picked
    const c = add('Single Swing', 30, 80.5, {productType:'GDL', doorStyle:'Malai'});                // not allowed
    state.job = j; state.view = 'job'; state.openOpening = a.id; render();
    const A = a.options[0].v, B = b.options[0].v;
    const out = {a:{...A}, b:{...B}, c:{...c.options[0].v}};
    out.miss = missing(j).filter(x => /GDL/.test(x));
    out.aluFrames = frameChoices(a.options[0]); out.woodFrames = frameChoices(c.options[0]);
    out.bypassStyles = gdlStyles('GDL ByPass'); out.bifoldStyles = gdlStyles('GDL BiFold');
    state.editOption = a.options[0].id; render();
    out.editFrame = document.querySelectorAll('.opt-edit [data-chip="frameColour"]').length;
    out.editPaint = document.querySelectorAll('.opt-edit .s-colour, .opt-edit .s-hardware').length;
    state.editOption = null; j.inHome = true; render();
    out.cardFrame = document.querySelectorAll('.card.is-open [data-chip="frameColour"]').length;
    out.dim = [...document.querySelectorAll('.card.is-open [data-dtype].dim')].map(e => e.dataset.dtype);
    return out;
  });
  check('Bypass on a GDL door becomes GDL ByPass', r.a.doorType === 'GDL ByPass', r.a);
  check('picking GDL BiFold makes the product GDL', r.b.productType === 'GDL' && r.b.doorType === 'GDL BiFold', r.b);
  check('router, re-rail, re-stile, handle, finish and paint are emptied on GDL',
    ['a', 'b', 'c'].every(k => ['routerStop', 'reRail', 'reStile', 'handleType', 'handleStyle', 'hwColour', 'paintColour'].every(f => !r[k][f])), r);
  check('a non GDL style is cleared on a GDL door, a GDL one kept', r.b.doorStyle === '' && r.a.doorStyle === 'Glissade Square Style 3' && r.c.doorStyle === 'Malai', r);
  check('Glissade frames Black, White, Silver', JSON.stringify(r.aluFrames) === '["Black","White","Silver"]', r.aluFrames);
  check('wood frames White, Black, Chocolate, Grey, Espresso', JSON.stringify(r.woodFrames) === '["White","Black","Chocolate","Grey","Espresso"]', r.woodFrames);
  check('GDL ByPass styles have no Glissade Bifold', !r.bypassStyles.some(s => /Glissade Bifold/.test(s)) && r.bypassStyles.includes('Glissade Swept Style 9') && r.bypassStyles.includes('Malai'), r.bypassStyles);
  check('GDL BiFold styles are Glissade Bifold and wood', r.bifoldStyles.every(s => /Glissade Bifold/.test(s) || !/Glissade/.test(s)) && r.bifoldStyles.includes('Soba'), r.bifoldStyles);
  check('missing: frame and insert on each, and swing is not GDL', r.miss.filter(x => /frame colour/.test(x)).length === 3 &&
    r.miss.filter(x => /insert colour/.test(x)).length === 3 && r.miss.some(x => /Opening 3: GDL is bypass or bifold only/.test(x)), r.miss);
  check('the Edit screen shows the frame chips, no paint or hardware', r.editFrame === 3 && r.editPaint === 0, r);
  check('the in-home card shows the frame chips (Glissade: 3)', r.cardFrame === 3, r.cardFrame);
  check('other door types dimmed on a GDL opening', r.dim.includes('Single Swing') && !r.dim.includes('Bifold') && !r.dim.includes('GDL ByPass'), r.dim);

  // pick frame and insert on the card
  await page.click('.card.is-open [data-chip="frameColour"][data-val="Black"]');
  await page.click('.card.is-open [data-chip="insertColour"][data-val="White Lacobel"]');
  await page.evaluate(() => { state.job.inHome = false; render(); });
  const fp0 = await page.evaluate(() => signFp(state.job));
  const s = await page.evaluate(() => {
    const j = state.job, [a, b, c] = j.openings;
    Object.assign(b.options[0].v, {doorStyle:'Glissade Bifold Style 2', frameColour:'Silver', insertColour:'Frosted Glass'});
    Object.assign(c.options[0].v, {doorType:'GDL ByPass', frameColour:'Chocolate', insertColour:'Clear Mirror'});
    c.qty = 2;
    render();
    const ins = sheetInputs(j), row = (r) => Object.fromEntries(ins.filter(x => new RegExp('^[A-Z]+' + r + '$').test(x[0])));
    return {a:{...a.options[0].v}, miss:missing(j), r9:row(9), picks:doorPicks(j), fp:signFp(j),
      sheet:JSON.stringify(ins), xml:buildXML(j)};
  });
  check('frame and insert set from the card', s.a.frameColour === 'Black' && s.a.insertColour === 'White Lacobel', s.a);
  check('nothing missing once frame and insert are in', !s.miss.some(x => /GDL/.test(x)), s.miss);
  check('the workbook line has GDL ByPass and no handle, paint or re-rail', s.r9.E9 === 'GDL ByPass' && !s.r9.N9 && !s.r9.Q9 && !s.r9.K9 && !s.r9.I9, s.r9);
  check('frame and insert are not in the workbook or the XML', !/Lacobel|Frosted|Chocolate/.test(s.sheet) && !/Lacobel|Frosted|Chocolate|Frame/.test(s.xml), s.xml.slice(0, 600));
  check('door picks carry frame and insert, with the style photo', s.picks.length === 3 && s.picks[0].sub === 'Frame: Black, Insert: White Lacobel' &&
    s.picks[0].photo === 'glissade-style-3.jpg' && s.picks[1].photo === 'glissade-bifold-style-2.jpg' &&
    s.picks[0].edge.photo === 'glissade-edge-square.jpg' && s.picks[1].edge.name === 'Inspira frame edge' && !s.picks[2].edge, s.picks);
  check('frame and insert are part of what is signed', s.fp !== fp0);
  const photo = await page.evaluate(async () => (await fetch('glissade-style-3.jpg')).status);
  check('the Glissade style photo is there', photo === 200, photo);

  // the review: frame and insert where the handle goes, N/A for the rest
  await page.evaluate(() => openReview());
  await page.waitForFunction(() => state.reviewReady);
  const rv = await page.evaluate(() => {
    const l2 = [...document.querySelectorAll('tr.rv-l2')][0];
    return {frame:[...l2.querySelectorAll('select[data-rv="frameColour"] option')].map(o => o.value).filter(Boolean),
      frameVal:l2.querySelector('select[data-rv="frameColour"]').value, insertVal:l2.querySelector('select[data-rv="insertColour"]').value,
      caps:[...l2.querySelectorAll('.gdl-cap')].map(e => e.textContent), na:[...l2.querySelectorAll('.rv-fixed')].filter(e => e.textContent === 'N/A').length,
      types:[...document.querySelectorAll('tr.rv-l1')][0].querySelectorAll('select[data-rv="doorType"] option').length,
      msrp:cv('R9'), woodFrames:[...[...document.querySelectorAll('tr.rv-l2')][2].querySelectorAll('select[data-rv="frameColour"] option')].map(o => o.value).filter(Boolean)};
  });
  check('review: frame select with the Glissade colours, set to Black', JSON.stringify(rv.frame) === '["Black","White","Silver"]' && rv.frameVal === 'Black', rv);
  check('review: insert select set', rv.insertVal === 'White Lacobel', rv);
  check('review: Frame, Insert and (Glissade bypass) Third track captions, N/A on the rest', rv.caps.join() === 'Frame,Insert,Third track' && rv.na === 4, rv);
  check('review: door type only GDL ByPass or GDL BiFold', rv.types === 3, rv.types);
  check('review: wood door offers the wood frames', rv.woodFrames.length === 5 && rv.woodFrames.includes('Espresso'), rv.woodFrames);
  check('the GDL door is priced by the workbook', typeof rv.msrp === 'number' && rv.msrp > 0, rv.msrp);
  await page.selectOption('tr.rv-l2 >> nth=0 >> select[data-rv="frameColour"]', 'Silver');
  check('frame changed on the review', await page.evaluate(() => state.job.openings[0].options[0].v.frameColour) === 'Silver');

  // the contract PDF and the signing page
  const bytes = await page.evaluate(async () => Array.from(await contractPdf(state.job, {blank:true})));
  const os = require('os'), tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gdl-'));
  fs.writeFileSync(path.join(tmp, 'c.pdf'), Buffer.from(bytes));
  let txt = '';
  try{ txt = require('child_process').execFileSync('pdftotext', ['-raw', path.join(tmp, 'c.pdf'), '-']).toString(); }catch(e){ txt = 'no pdftotext'; }
  check('contract PDF has frame and insert', /Frame: Silver/.test(txt) && /Insert: White Lacobel/.test(txt) && /Frame: Chocolate/.test(txt), txt.slice(0, 1500));
  check('door selections page names frame and insert', /Frame: Silver, Insert: White Lacobel/.test(txt.replace(/\s+/g, ' ')), txt.slice(-1500));
  if(process.env.PDF) fs.writeFileSync(process.env.PDF, Buffer.from(bytes));

  // 2.60: install is Yes or No, Free only on GDL
  const ins = await page.evaluate(() => {
    const [a, b] = state.job.openings; a.options[0].v.install = 'FREE'; b.options[0].v.install = '';
    const plain = newOpening(4, null, state.job); Object.assign(plain.options[0].v, {doorType:'Single Swing', productType:'1.375 Hollow', install:'FREE'});
    state.job.openings.push(plain); render();
    const sel = [...document.querySelectorAll('select[data-rv="install"]')].map(x => [...x.options].map(o => o.value).filter(Boolean).join());
    const out = {a:a.options[0].v.install, b:b.options[0].v.install, plain:plain.options[0].v.install, sel};
    state.job.openings.pop(); render(); return out;
  });
  check('install: Free stays on GDL, blank becomes YES, Free on a plain door becomes YES', ins.a === 'FREE' && ins.b === 'YES' && ins.plain === 'YES', ins);
  check('install: review offers YES,NO,FREE on GDL and YES,NO on others', ins.sel[0] === 'YES,NO,FREE' && ins.sel[3] === 'YES,NO', ins.sel);
  const edges = await page.evaluate(async () => Promise.all(['glissade-edge-square.jpg', 'glissade-edge-swept.jpg', 'glissade-edge-bifold.jpg', 'glissade-bifold-style-9.jpg'].map(async f => (await fetch(f)).status)));
  check('edge close ups and bifold pictures are there', edges.every(x => x === 200), edges);

  // back to a plain door: Bypass again, paint default back, frame and insert gone
  const back = await page.evaluate(() => {
    const o = state.job.openings[0].options[0];
    o.v.productType = '1.375 Hollow'; o.v.doorStyle = ''; calcJob(state.job);
    return {...o.v};
  });
  check('leaving GDL: Bypass, default paint back, no frame or insert', back.doorType === 'Bypass' && back.paintColour === 'STD White' &&
    !('frameColour' in back) && !('insertColour' in back) && back.handleType === '', back);
  const back2 = await page.evaluate(() => {
    const o = state.job.openings[1].options[0];
    o.v.productType = '1.375 Solid'; calcJob(state.job);
    return {...o.v};
  });
  check('leaving GDL with a Glissade style clears the style, bifold gets its knob', back2.doorType === 'Bifold' && back2.doorStyle === '' && back2.handleType === 'Bifold Knob', back2);

  check('no page errors', !errors.length, errors);
  await browser.close(); server.close();
  console.log(fails ? fails + ' FAILED' : 'ALL PASSED');
  process.exit(fails ? 1 : 0);
})();

// Measurement app 2.76 (Andrew, 26 Nov): Mix Door Types on a bypass of 2, 3
// or 4 doors and on a GDL bypass. A tick opens a style for each location A to
// D (and a glass insert on GDL). A bypass prices each location on its own and
// the Door MSRP is their average; a GDL set keeps its price. The workbook
// keeps its layout: Door Style is Custom - See Notes (Access style 111) and
// Door MSRP the worked out price. Checked here by touch on the review, in a
// LibreOffice recalculated workbook (every other cell the same as without the
// mix) and in the contract PDF.
//
//   node tests/mix-door-types.js        needs soffice, pdftotext and python3 with openpyxl
const { chromium, devices } = require(process.env.PLAYWRIGHT || 'playwright');
const path = require('path'), fs = require('fs'), http = require('http'), os = require('os');
const { execFileSync } = require('child_process');
const DIR = path.join(__dirname, '..', 'measurement-app');
const server = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]); if(p === '/') p = '/index.html';
  const f = path.join(DIR, p);
  if(!f.startsWith(DIR) || !fs.existsSync(f)){ r.statusCode = 404; return r.end('nf'); }
  let body = fs.readFileSync(f);
  if(p === '/index.html') body = body.toString('utf8').replace("supabaseUrl: 'https://baakegbtuygtldksmant.supabase.co'", "supabaseUrl: ''");
  r.setHeader('Content-Type', p.endsWith('.js') ? 'text/javascript' : p.endsWith('.pdf') ? 'application/pdf' :
    p.endsWith('.png') ? 'image/png' : p.endsWith('.jpg') ? 'image/jpeg' : 'text/html'); r.end(body);
});
let fails = 0;
const check = (name, ok, got) => { console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : '  got: ' + String(JSON.stringify(got)).slice(0, 600))); if(!ok) fails++; };
const READ = `
import sys, json, openpyxl
wb = openpyxl.load_workbook(sys.argv[1], data_only=True)
out = {}
for sn, rows, cols in [('Pricing Sheet', list(range(9, 12)) + list(range(46, 55)), range(1, 39)), ('UploadTemplate', range(37, 40), range(1, 34))]:
    ws = wb[sn]
    for r in rows:
        for c in cols:
            v = ws.cell(r, c).value
            out[sn + '!' + ws.cell(r, c).coordinate] = v
print(json.dumps(out, default=str))`;

(async () => {
  await new Promise(ok => server.listen(0, ok));
  const browser = await chromium.launch();
  const ctx = await browser.newContext({...devices['iPhone 13'], acceptDownloads:true});
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('http://127.0.0.1:' + server.address().port + '/'); await page.waitForTimeout(300);

  // a 3 door bypass, a 2 door GDL bypass and a swing door
  await page.evaluate(() => {
    state.me = {name:'tester', role:'admin'};
    const j = newJob(); Object.assign(j, {customer:'Mix Sample', docType:'Sales Contract - Cash Web Pricing', inHome:false}); j.openings = [];
    const add = (type, W, v, qty) => {
      const op = newOpening(j.openings.length + 1, null, j);
      Object.assign(op, {location:'Master Bed', existingType:type, openW:String(W), openH:'80', cond:'Jamb'});
      Object.assign(op.options[0].v, {doorType:type, install:'YES'}, v);
      if(qty) op.qty = qty; applyQtyRule(op); j.openings.push(op); return op;
    };
    add('Bypass', 72, {productType:'1.375 Hollow', doorStyle:'Columbia', paintColour:'STD White', handleType:'Finger Pull Round', hwColour:'Matte Black'}, 3);
    add('GDL ByPass', 60, {productType:'GDL', doorStyle:'Glissade Square Style 3', frameColour:'White', insertColour:'Frosted Glass'});
    add('Single Swing', 32, {productType:'1.375 Hollow', doorStyle:'Columbia', handleType:'Passage', handleStyle:'R - Georgian Standard', hwColour:'Matte Black', paintColour:'STD White'});
    state.job = j; state.view = 'job'; render();
  });

  // workbook helpers
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mix-'));
  fs.writeFileSync(path.join(tmp, 'read.py'), READ);
  const prof = path.join(tmp, 'lo'); fs.mkdirSync(path.join(prof, 'user'), {recursive:true});
  fs.writeFileSync(path.join(prof, 'user', 'registrymodifications.xcu'), '<?xml version="1.0" encoding="UTF-8"?>' +
    '<oor:items xmlns:oor="http://openoffice.org/2001/registry" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
    '<item oor:path="/org.openoffice.Office.Calc/Formula/Load"><prop oor:name="OOXMLRecalcMode" oor:op="fuse"><value>0</value></prop></item></oor:items>');
  const book = async name => {
    const [dl] = await Promise.all([page.waitForEvent('download'), page.evaluate(() => download(state.job))]);
    const f = path.join(tmp, name + '.xlsx'); await dl.saveAs(f);
    const out = path.join(tmp, name); fs.mkdirSync(out);
    execFileSync('soffice', ['-env:UserInstallation=file://' + prof, '--headless', '--convert-to', 'xlsx', '--outdir', out, f], {stdio:'ignore'});
    return JSON.parse(execFileSync('python3', ['-I', '-W', 'ignore', path.join(tmp, 'read.py'), path.join(out, name + '.xlsx')]).toString());
  };
  const before = await book('before');

  // single style prices, for the average
  const one = await page.evaluate(async () => { await getCalc();
    const o = state.job.openings[0].options[0], out = {};
    for(const s of ['Columbia', 'Livingston']){ o.v.doorStyle = s; calcJob(state.job); out[s] = cv('R9'); }
    o.v.doorStyle = 'Columbia'; calcJob(state.job); out.gdl = cv('R10'); return out; });
  check('the price list prices Columbia and Livingston differently', typeof one.Columbia === 'number' && typeof one.Livingston === 'number' && one.Columbia !== one.Livingston, one);

  // the Edit screen: the tick is on a bypass, not on the swing door
  const ed = await page.evaluate(() => { const j = state.job, r = {};
    state.editOption = j.openings[0].options[0].id; state.openOpening = j.openings[0].id; render();
    r.bypass = !!document.querySelector('input[data-mix="on"][data-o="' + j.openings[0].options[0].id + '"]');
    r.styleCombo = !!document.querySelector('.opt-edit [data-v="doorStyle"]');
    state.editOption = j.openings[2].options[0].id; state.openOpening = j.openings[2].id; render();
    r.swing = !!document.querySelector('input[data-mix="on"]');
    state.editOption = null; render(); return r; });
  check('Edit screen: Mix Door Types tick on the bypass, none on a swing door', ed.bypass && !ed.swing && ed.styleCombo, ed);

  // on the review, by touch
  await page.tap('[data-review]');
  await page.waitForFunction(() => state.reviewReady, null, {timeout:30000}); await page.waitForTimeout(300);
  const tick = n => 'input[data-mix="on"][data-op="' + n + '"]';
  const ids = await page.evaluate(() => state.job.openings.map(op => op.id));
  check('review: the tick shows on the two bypass doors only', await page.locator('input[data-mix="on"]').count() === 2);
  await page.locator(tick(ids[0])).scrollIntoViewIfNeeded(); await page.tap(tick(ids[0])); await page.waitForTimeout(400);
  const st0 = await page.evaluate(() => state.job.openings[0].options[0].v);
  check('ticked: three locations, each starting as the door\'s style', st0.mixTypes && st0.mix.length === 3 && st0.mix.every(m => m.style === 'Columbia'), st0);
  const sel = (n, k) => 'select[data-mix="' + k + '"][data-op="' + n + '"]';
  await page.selectOption(sel(ids[0], 'style:1'), 'Livingston'); await page.waitForTimeout(400);
  const r1 = await page.evaluate(() => ({R:cv('R9'), S:cv('S9'), T:cv('T9'), C:cv('C9'), F:cv('F9'), cache:mixCache[state.job.openings[0].options[0].id],
    shown:[...document.querySelectorAll('.mix-p')].map(e => e.textContent), cell:document.querySelector('tr.rv-l1 .rv-fixed') && document.querySelector('tr.rv-l1 .rv-fixed').textContent}));
  const avg = Math.round((2 * one.Columbia + one.Livingston) / 3 * 100) / 100;
  check('Door MSRP is the average of A Columbia, B Livingston, C Columbia', r1.R === avg && r1.F === 'Custom - See Notes', [r1, avg]);
  check('Door Total carries it forward (price x 3)', Math.abs(r1.T - r1.S * 3) < 0.005 && r1.C === 3, r1);
  check('each location shows its own price on the review', r1.shown.length === 3 && r1.shown[1] === await page.evaluate(v => money(v), one.Livingston) && r1.shown[0] === await page.evaluate(v => money(v), one.Columbia), r1.shown);

  // GDL: style and insert per location, price unchanged
  await page.locator(tick(ids[1])).scrollIntoViewIfNeeded(); await page.tap(tick(ids[1])); await page.waitForTimeout(400);
  const gOpts = await page.evaluate(n => [...document.querySelectorAll('select[data-mix="style:1"][data-op="' + n + '"] option')].map(o => o.value).filter(Boolean), ids[1]);
  check('GDL location B offers Glissade Square styles only', gOpts.length === 9 && gOpts.every(x => /^Glissade Square Style/.test(x)), gOpts);
  await page.selectOption(sel(ids[1], 'style:1'), 'Glissade Square Style 5');
  await page.waitForTimeout(300);
  await page.selectOption(sel(ids[1], 'insert:1'), 'White Lacobel'); await page.waitForTimeout(400);
  const g = await page.evaluate(() => ({v:state.job.openings[1].options[0].v, R:cv('R10'), F:cv('F10'), C:cv('C10'), prices:document.querySelectorAll('tr.rv-l3 .mix-p').length}));
  check('GDL: A Style 3 Frosted Glass, B Style 5 White Lacobel', g.v.mix.length === 2 && g.v.mix[0].style === 'Glissade Square Style 3' && g.v.mix[0].insert === 'Frosted Glass' &&
    g.v.mix[1].style === 'Glissade Square Style 5' && g.v.mix[1].insert === 'White Lacobel', g.v);
  check('GDL: set price unchanged, quantity 1, style Custom', g.R === one.gdl && g.C === 1 && g.F === 'Custom - See Notes', [g.R, one.gdl, g.C, g.F]);
  check('nothing missing on the order', await page.evaluate(() => missing(state.job).length) === 0, await page.evaluate(() => missing(state.job)));
  check('the note under the doors names each location', await page.evaluate(() => [lineNote(state.job.openings[0]), lineNote(state.job.openings[1])]).then(x =>
    x[0] === 'Mix Door Types: A Columbia; B Livingston; C Columbia.  No middle door finger pulls.' && x[1] === 'Mix Door Types: A Glissade Square Style 3, Frosted Glass; B Glissade Square Style 5, White Lacobel.'),
    await page.evaluate(() => [lineNote(state.job.openings[0]), lineNote(state.job.openings[1])]));
  await page.locator('tr.rv-l3 .mix-f').first().scrollIntoViewIfNeeded();
  await page.screenshot({path: path.join(tmp, 'mix-review-phone.png')});
  if(process.env.SHOT) fs.copyFileSync(path.join(tmp, 'mix-review-phone.png'), process.env.SHOT);

  // the workbook
  const after = await book('after');
  check('workbook: Door Style Custom - See Notes on both bypass lines', after['Pricing Sheet!F9'] === 'Custom - See Notes' && after['Pricing Sheet!F10'] === 'Custom - See Notes', [after['Pricing Sheet!F9'], after['Pricing Sheet!F10']]);
  check('workbook: Door MSRP the average on the bypass, the set price on the GDL', after['Pricing Sheet!R9'] === avg && after['Pricing Sheet!R10'] === one.gdl, [after['Pricing Sheet!R9'], after['Pricing Sheet!R10']]);
  check('workbook: Door Total = price x 3, as the review', Math.abs(after['Pricing Sheet!T9'] - r1.T) < 0.005, [after['Pricing Sheet!T9'], r1.T]);
  check('UploadTemplate: door style 111 (Custom - See Notes) for Access', after['UploadTemplate!Q37'] === 111 && after['UploadTemplate!Q38'] === 111, [after['UploadTemplate!Q37'], after['UploadTemplate!Q38']]);
  const diff = Object.keys(before).filter(k => JSON.stringify(before[k]) !== JSON.stringify(after[k]));
  // allowed: style and price cells of the two lines, their sums, and what Access reads off the style (style id, product type, model, paint id)
  const allowed = /^Pricing Sheet!(F9|F10|R9|S9|T9|[A-Z]+4[6-9]|[A-Z]+5[0-4])$|^UploadTemplate!(Q|R|S|AF)3[78]$|^UploadTemplate![HN]38$/;
  check('workbook: Factory Finishing as before (Standard on the bypass, none on the GDL set)', after['Pricing Sheet!G9'] === 'Standard' && after['Pricing Sheet!G10'] === 'NO' &&
    after['Pricing Sheet!U49'] === before['Pricing Sheet!U49'], [after['Pricing Sheet!G9'], after['Pricing Sheet!G10'], before['Pricing Sheet!U49'], after['Pricing Sheet!U49']]);
  check('every other cell of the workbook is as it was', diff.every(k => allowed.test(k)), diff.filter(k => !allowed.test(k)).map(k => [k, before[k], after[k]]));
  console.log('  changed cells: ' + diff.map(k => k + ' ' + JSON.stringify(before[k]) + '>' + JSON.stringify(after[k])).join(', '));

  // the contract PDF
  const bytes = await page.evaluate(async () => Array.from(await contractPdf(state.job, {blank:true})));
  fs.writeFileSync(path.join(tmp, 'c.pdf'), Buffer.from(bytes));
  if(process.env.PDF) fs.writeFileSync(process.env.PDF, Buffer.from(bytes));
  let txt = ''; try{ txt = execFileSync('pdftotext', ['-layout', path.join(tmp, 'c.pdf'), '-']).toString(); }catch(e){ txt = 'no pdftotext'; }
  check('contract PDF: style column says Mix Door Types and the locations are listed',
    /Mix Door Types: A Columbia; B Livingston; C Columbia\./.test(txt) && /Mix Door Types: A Glissade Square Style 3, Frosted Glass; B Glissade Square Style 5,/.test(txt.replace(/\s+/g, ' ')) &&
    (txt.match(/Mix Door Types/g) || []).length >= 4, txt.split('\n').filter(l => /Mix|Columbia|Glissade/.test(l)));

  // the door selections page has each style
  const picks = await page.evaluate(() => doorPicks(state.job).map(p => [p.style, p.qty, p.sub, p.where.join('|')]));
  check('door selections: Columbia (bypass A and C, swing), Livingston (B), both Glissade styles with their inserts',
    picks.some(p => p[0] === 'Livingston' && p[1] === 1 && /Master Bed B/.test(p[3])) && picks.some(p => p[0] === 'Glissade Square Style 5' && /White Lacobel/.test(p[2])) &&
    picks.some(p => p[0] === 'Glissade Square Style 3' && /Frosted Glass/.test(p[2])), picks);

  // what is signed changes with a location; a missing location style is asked for
  const fp = await page.evaluate(() => { const a = signFp(state.job); const m = state.job.openings[0].options[0].v.mix; m[2].style = 'Livingston';
    const b = signFp(state.job); m[2].style = ''; const miss = missing(state.job); m[2].style = 'Columbia'; return {a, b, miss}; });
  check('changing a location changes what is signed', fp.a !== fp.b, fp);
  check('a location with no style is on the missing list', fp.miss.indexOf('Opening 1: Mix Door Types, style for location C') >= 0, fp.miss);

  // a typed Door MSRP still wins
  const typed = await page.evaluate(() => { const o = state.job.openings[0].options[0]; o.v.msrpTyped = '500'; calcJob(state.job);
    const r = cv('R9'); o.v.msrpTyped = ''; calcJob(state.job); return [r, cv('R9')]; });
  check('a typed Door MSRP wins over the average, clearing it brings the average back', typed[0] === 500 && typed[1] === avg, typed);

  // untick: back to one style, the workbook as before
  await page.locator(tick(ids[0])).scrollIntoViewIfNeeded(); await page.tap(tick(ids[0])); await page.waitForTimeout(400);
  await page.locator(tick(ids[1])).scrollIntoViewIfNeeded(); await page.tap(tick(ids[1])); await page.waitForTimeout(400);
  const off = await page.evaluate(() => ({v0:state.job.openings[0].options[0].v, R:cv('R9'), F:cv('F9'), F10:cv('F10')}));
  check('unticked: the mix goes, the door keeps location A\'s style and its own price', !off.v0.mixTypes && !off.v0.mix && off.v0.doorStyle === 'Columbia' && off.R === one.Columbia && off.F === 'Columbia' && off.F10 === 'Glissade Square Style 3', off);
  const back = await book('back');
  const diff2 = Object.keys(before).filter(k => JSON.stringify(before[k]) !== JSON.stringify(back[k]));
  check('unticked workbook is the same as before', diff2.length === 0, diff2.map(k => [k, before[k], back[k]]));

  // double middle door finger pulls: three door bypass only, default none
  const pf = await page.evaluate(() => ({n:document.querySelectorAll('input[data-pull]').length, note:lineNote(state.job.openings[0])}));
  check('finger pull tick on the 3 door bypass only (not GDL), default No middle door finger pulls', pf.n === 1 && pf.note === 'No middle door finger pulls.', pf);
  const fpA = await page.evaluate(() => signFp(state.job));
  const hw0 = await page.evaluate(() => [cv('O49'), cv('P49'), cv('U54')]);
  await page.locator('input[data-pull]').scrollIntoViewIfNeeded(); await page.tap('input[data-pull]'); await page.waitForTimeout(400);
  const pf2 = await page.evaluate(() => ({v:state.job.openings[0].options[0].v.midPulls, note:lineNote(state.job.openings[0]), fp:signFp(state.job), R:cv('R9'), O:cv('O49'), P:cv('P49'), U:cv('U9')}));
  check('ticked (round pulls): note says 4 more round, signing changes, door price unchanged', pf2.v === true && pf2.note === 'Install double middle door finger pulls (4 more round).' && pf2.fp !== fpA && pf2.R === one.Columbia, pf2);
  check('review: Finger Pull line 3 > 7, $75 > $175', hw0[0] === 3 && hw0[1] === 75 && pf2.O === 7 && pf2.P === 175 && pf2.U === 75, [hw0, pf2.O, pf2.P]);
  const pb = await page.evaluate(async () => Array.from(await contractPdf(state.job, {blank:true})));
  fs.writeFileSync(path.join(tmp, 'p.pdf'), Buffer.from(pb));
  check('contract PDF says Install double middle door finger pulls', /Install double middle door finger pulls \(4 more round\)/.test(execFileSync('pdftotext', [path.join(tmp, 'p.pdf'), '-']).toString()));
  const pulled = await book('pulled');
  check('workbook: Finger Pull 7, $175, AK9 4', pulled['Pricing Sheet!O49'] === 7 && pulled['Pricing Sheet!P49'] === 175 && pulled['Pricing Sheet!AK9'] === 4, [pulled['Pricing Sheet!O49'], pulled['Pricing Sheet!P49'], pulled['Pricing Sheet!AK9']]);
  const pd = Object.keys(before).filter(k => JSON.stringify(before[k]) !== JSON.stringify(pulled[k]));
  check('workbook: only the pull cells, the Hardware total and the sums under it move', pd.every(k => /^Pricing Sheet!(AK9|O49|P49|U5[0-4])$/.test(k)) && Math.abs(pulled['Pricing Sheet!U50'] - before['Pricing Sheet!U50'] - 100) < 0.001,
    pd.map(k => [k, before[k], pulled[k]]));
  // square pulls: 2 more round and 2 more square at the list prices
  const sq = await page.evaluate(() => { const o = state.job.openings[0].options[0]; const was = o.v.handleType; o.v.handleType = 'Finger Pull Square'; calcJob(state.job);
    const r = {base:cv('U9'), O:cv('O49'), P:cv('P49'), note:lineNote(state.job.openings[0])}; return r; });
  check('square pulls: 3 square + 2 round + 2 square = 7, $120 + $50 + $80', sq.base === 120 && sq.O === 7 && sq.P === 250 && /2 more round, 2 more square/.test(sq.note), sq);
  const sqb = await book('square');
  check('workbook square: AK9 2, AL9 2, Finger Pull $250', sqb['Pricing Sheet!AK9'] === 2 && sqb['Pricing Sheet!AL9'] === 2 && sqb['Pricing Sheet!P49'] === 250 && sqb['Pricing Sheet!O49'] === 7,
    [sqb['Pricing Sheet!AK9'], sqb['Pricing Sheet!AL9'], sqb['Pricing Sheet!O49'], sqb['Pricing Sheet!P49']]);
  await page.evaluate(() => { const o = state.job.openings[0].options[0]; o.v.handleType = 'Finger Pull Round'; delete o.v.midPulls; calcJob(state.job); });
  check('unticked: Finger Pull back to 3, $75', await page.evaluate(() => [cv('O49'), cv('P49')]).then(v => v[0] === 3 && v[1] === 75));
  const p2 = await page.evaluate(() => { const op = state.job.openings[0]; op.qty = 2; const a = canMidPull(op, op.options[0]); op.qty = 3; return a; });
  check('no finger pull tick on a 2 door bypass', p2 === false);

  // a 2 door bypass can mix, a 5 door cannot (A to D)
  const q = await page.evaluate(() => { const op = state.job.openings[0], o = op.options[0]; op.qty = 2; const a = canMix(op, o); op.qty = 5; const b = canMix(op, o); op.qty = 3; return [a, b]; });
  check('2 doors can mix, more than 4 cannot', q[0] && !q[1], q);
  check('no page errors', errors.length === 0, errors);
  console.log(fails ? fails + ' FAILED' : 'ALL PASSED');
  await browser.close(); server.close(); process.exit(fails ? 1 : 0);
})();

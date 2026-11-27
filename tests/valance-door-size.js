// Measurement app 2.78 (Andrew, 27 Nov):
//  1. the size of the door to be ordered can be changed on the review (the same
//     each door width and height as the measurement screen, on the size picker);
//  2. a bypass (plain or GDL) has an Oversized Valance Build Down tick that puts
//     Oversized Bulk Head, qty 1 at $150, on the next empty Special Materials and
//     Rework line, and attaches the build down form with Andrew's photo.
// Checked by touch on an iPhone sized review, in a LibreOffice recalculated
// workbook (every other cell as before) and in the contract PDF.
//
//   node tests/valance-door-size.js        needs soffice, pdftotext and python3 with openpyxl
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
for sn, rows, cols in [('Pricing Sheet', list(range(9, 12)) + list(range(46, 58)), range(1, 41)), ('UploadTemplate', range(37, 40), range(1, 34))]:
    ws = wb[sn]
    for r in rows:
        for c in cols:
            out[sn + '!' + ws.cell(r, c).coordinate] = ws.cell(r, c).value
print(json.dumps(out, default=str))`;

(async () => {
  await new Promise(ok => server.listen(0, ok));
  const browser = await chromium.launch();
  const ctx = await browser.newContext({...devices['iPhone 13'], acceptDownloads:true});
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('http://127.0.0.1:' + server.address().port + '/'); await page.waitForTimeout(300);

  // a 3 door bypass (88 ceiling), a GDL bypass and a swing door
  await page.evaluate(() => {
    state.me = {name:'tester', role:'admin'};
    const j = newJob(); Object.assign(j, {customer:'Valance Sample', address:'1 Test St', docType:'Sales Contract - Cash Web Pricing', inHome:false}); j.openings = [];
    const add = (type, W, H, v, qty) => {
      const op = newOpening(j.openings.length + 1, null, j);
      Object.assign(op, {location:'Master Bed', existingType:type, openW:String(W), openH:String(H), cond:'Jamb'});
      Object.assign(op.options[0].v, {doorType:type, install:'YES'}, v);
      if(qty) op.qty = qty; applyQtyRule(op); j.openings.push(op); return op;
    };
    add('Bypass', 96, 86.5, {productType:'1.375 Hollow', doorStyle:'Columbia', paintColour:'STD White', handleType:'Finger Pull Round', hwColour:'Matte Black'}, 3);
    add('GDL ByPass', 60, 88, {productType:'GDL', doorStyle:'Glissade Square Style 3', frameColour:'White', insertColour:'Frosted Glass'});
    add('Single Swing', 32, 81, {productType:'1.375 Hollow', doorStyle:'Columbia', handleType:'Passage', handleStyle:'R - Georgian Standard', hwColour:'Matte Black', paintColour:'STD White'});
    state.job = j; state.view = 'job'; render();
  });

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'val-'));
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
  const pdfText = async name => { const b = await page.evaluate(async () => { await getCalc(); calcJob(state.job); return Array.from(await contractPdf(state.job, {blank:true})); });
    const f = path.join(tmp, name + '.pdf'); fs.writeFileSync(f, Buffer.from(b)); if(process.env.PDF && name === 'valance') fs.writeFileSync(process.env.PDF, Buffer.from(b));
    return execFileSync('pdftotext', ['-layout', f, '-']).toString(); };
  const txt0 = await pdfText('before');

  // the Edit screen: the tick is on both bypass doors, not on the swing door
  const ed = await page.evaluate(() => { const j = state.job, r = {};
    const at = i => { state.editOption = j.openings[i].options[0].id; state.openOpening = j.openings[i].id; render();
      return !!document.querySelector('input[data-valance][data-o="' + j.openings[i].options[0].id + '"]'); };
    r.bypass = at(0); r.gdl = at(1); r.swing = at(2); state.editOption = null; render(); return r; });
  check('Edit screen: Oversized Valance Build Down on the bypass and the GDL bypass, not the swing door', ed.bypass && ed.gdl && !ed.swing, ed);

  await page.tap('[data-review]');
  await page.waitForFunction(() => state.reviewReady, null, {timeout:30000}); await page.waitForTimeout(300);
  const ids = await page.evaluate(() => state.job.openings.map(op => op.id));
  check('review: the tick shows on the two bypass doors only', await page.locator('input[data-valance]').count() === 2);
  const base = await page.evaluate(() => ({L55:cv('L55'), F55:cv('F55'), U:cv('U57') }));

  // 1. tick on the 3 door bypass
  const tick = n => 'input[data-valance][data-op="' + n + '"]';
  await page.locator(tick(ids[0])).scrollIntoViewIfNeeded(); await page.tap(tick(ids[0])); await page.waitForTimeout(400);
  const t1 = await page.evaluate(() => ({mats:state.job.materials, F:cv('F55'), J:cv('J55'), K:cv('K55'), L:cv('L55'),
    docs:jobDocs(state.job).map(d => d.id + ':' + d.openings.join('|')), note:lineNote(state.job.openings[0]),
    box:[...document.querySelectorAll('input[data-rvmat]')].map(i => i.value).slice(0, 3)}));
  check('ticked: Oversized Bulk Head, $150, qty 1 on the first special materials line', t1.mats[0].desc === 'Oversized Bulk Head' && t1.mats[0].price === '150' && t1.mats[0].qty === '1' &&
    t1.F === 'Oversized Bulk Head' && t1.J === 150 && t1.K === 1 && t1.L === 150, t1);
  check('the review box shows it', t1.box[0] === 'Oversized Bulk Head', t1.box);
  check('the build down form goes with the order for opening 1', t1.docs.indexOf('valance:1') >= 0, t1.docs);
  check('the note under the door says so', /Oversized Valance Build Down/.test(t1.note), t1.note);
  await page.locator(tick(ids[0])).scrollIntoViewIfNeeded();
  await page.screenshot({path:path.join(tmp, 'valance-review.png')});
  if(process.env.SHOT) fs.copyFileSync(path.join(tmp, 'valance-review.png'), process.env.SHOT);

  const vb = await book('valance');
  check('workbook: F55 Oversized Bulk Head, J55 150, K55 1, L55 150', vb['Pricing Sheet!F55'] === 'Oversized Bulk Head' && vb['Pricing Sheet!J55'] === 150 && vb['Pricing Sheet!K55'] === 1 && vb['Pricing Sheet!L55'] === 150,
    ['F55', 'J55', 'K55', 'L55'].map(k => vb['Pricing Sheet!' + k]));
  const d1 = Object.keys(before).filter(k => JSON.stringify(before[k]) !== JSON.stringify(vb[k]));
  check('workbook: only the special materials line and the totals under it move', d1.every(k => /^Pricing Sheet!([FJKL]55|[A-Z]+5[0-7]|[A-Z]+4[6-9])$/.test(k)) &&
    Math.abs(vb['Pricing Sheet!U51'] - before['Pricing Sheet!U51'] - 150) < 0.001, d1.map(k => [k, before[k], vb[k]]));
  const txt1 = await pdfText('valance');
  check('contract PDF: has the Oversized Valance Build Down form and the line', /Oversized Valance Build Down/.test(txt1) && /Oversized Bulk Head/.test(txt1) &&
    /Reference photo: a three door bypass/.test(txt1) && !/Reference photo/.test(txt0), txt1.split('\n').filter(l => /Valance|Bulk/.test(l)));
  const page2 = await page.evaluate(() => { const d = jobDocs(state.job).find(x => x.id === 'valance'); return docPage(d, state.job); });
  check('printed order: the form page with the customer on it', /oversized-valance-build-down\.png/.test(page2) && /Valance Sample/.test(page2), page2.slice(0, 200));

  // a second bypass ticked: the same line, qty 2
  await page.locator(tick(ids[1])).scrollIntoViewIfNeeded(); await page.tap(tick(ids[1])); await page.waitForTimeout(400);
  const t2 = await page.evaluate(() => ({mats:state.job.materials.map(m => m.desc + '/' + m.qty), K:cv('K55'), L:cv('L55')}));
  check('both bypass doors ticked: one line, qty 2, $300', t2.mats[0] === 'Oversized Bulk Head/2' && t2.mats[1] === '/' && t2.K === 2 && t2.L === 300, t2);
  await page.locator(tick(ids[1])).scrollIntoViewIfNeeded(); await page.tap(tick(ids[1])); await page.waitForTimeout(400);
  check('one unticked: back to qty 1', await page.evaluate(() => state.job.materials[0].qty) === '1');

  // the rep can still change the line, a changed price stays
  await page.evaluate(() => { state.job.materials[0].price = '175'; calcJob(state.job); render(); });
  check('a price changed by hand stays', await page.evaluate(() => cv('L55')) === 175);

  // untick: the line comes off, the workbook as before
  await page.locator(tick(ids[0])).scrollIntoViewIfNeeded(); await page.tap(tick(ids[0])); await page.waitForTimeout(400);
  const off = await page.evaluate(() => ({mats:state.job.materials, docs:jobDocs(state.job).map(d => d.id)}));
  check('unticked: the line and the form come off', off.mats.every(m => !m.desc && !m.price && !m.qty && !m.auto) && off.docs.indexOf('valance') < 0, off);
  const back = await book('back');
  const d2 = Object.keys(before).filter(k => JSON.stringify(before[k]) !== JSON.stringify(back[k]));
  check('unticked workbook is the same as before', d2.length === 0, d2.map(k => [k, before[k], back[k]]));

  // the line goes on the NEXT empty line; with none empty it is asked for
  const nx = await page.evaluate(() => { const j = state.job, o = j.openings[0].options[0];
    j.materials[0] = {desc:'Casing', price:'40', qty:'2'}; o.v.valance = true; calcJob(j);
    const r = {second:j.materials[1].desc, F56:cv('F56')};
    j.materials[1] = {desc:'', price:'', qty:''}; delete o.v.valance; calcJob(j);
    j.materials[1] = {desc:'Stop', price:'10', qty:'1'}; j.materials[2] = {desc:'Shims', price:'5', qty:'1'};
    o.v.valance = true; calcJob(j); render();
    r.full = missing(j).filter(x => /Valance/.test(x)); r.hint = !!document.querySelector('.val-f .warn-t');
    j.materials[2] = {desc:'', price:'', qty:''}; calcJob(j); r.third = j.materials[2].desc; r.after = missing(j).filter(x => /Valance/.test(x));
    delete o.v.valance; j.materials = [{desc:'',price:'',qty:''},{desc:'',price:'',qty:''},{desc:'',price:'',qty:''}]; calcJob(j); render(); return r; });
  check('with line 1 used it goes on line 2', nx.second === 'Oversized Bulk Head' && nx.F56 === 'Oversized Bulk Head', nx);
  check('with all three used it is on the missing list and the tick says so; clearing one puts it there', nx.full.length === 1 && nx.hint && nx.third === 'Oversized Bulk Head' && nx.after.length === 0, nx);
  // 2.81, Andrew: only 83 to 91 high; above 91 a 96 door as normal
  const rng = await page.evaluate(() => { const op = state.job.openings[0], o = op.options[0], was = op.openH, r = {};
    for(const h of ['82.875', '83', '88', '91', '91.125', '94']){ op.openH = h; r[h] = canValance(op, o); }
    op.openH = was; return r; });
  check('the tick is offered from 83" to 91" only', !rng['82.875'] && rng['83'] && rng['88'] && rng['91'] && !rng['91.125'] && !rng['94'], rng);
  const lock = await page.evaluate(() => { const j = state.job, op = j.openings[0], o = op.options[0], g = j.openings[1].options[0], r = {};
    op.openH = '88'; calcJob(j); r.before = [openPlan(op, o).blankH, cv('J9')];
    o.v.valance = true; op.doorH = '96'; calcJob(j); render();
    const P = openPlan(op, o); r.on = [P.blankH, P.finH, P.reRail, cv('J9'), op.height, j.materials[0].desc];
    r.tick = !!document.querySelector('input[data-valance][data-op="' + op.id + '"]');
    r.locked = !document.querySelector('[data-padof="doorH"][data-op="' + op.id + '"]') && [...document.querySelectorAll('tr.rv-l1 .rv-note')].some(e => e.textContent === 'bulk head');
    g.v.valance = true; calcJob(j); r.gdl = cv('J10');
    op.openH = '94'; calcJob(j); render(); r.over = [openPlan(op, o).blankH, cv('J9'), j.materials[0].qty, !!document.querySelector('input[data-valance][data-op="' + op.id + '"]')];
    op.openH = '86.5'; delete op.doorH; delete o.v.valance; delete g.v.valance; calcJob(j); render(); r.back = cv('J9'); return r; });
  check('88" opening: 96" door normally (Columbia has no 90)', lock.before[0] === 96 && lock.before[1] === 96, lock.before);
  check('ticked: 84" door uncut, no re-rail, a typed 96 is not used, Oversized Bulk Head on', lock.on[0] === 84 && lock.on[1] === 84 && lock.on[2] === false && lock.on[3] === 84 && lock.on[4] === 84 && lock.on[5] === 'Oversized Bulk Head', lock.on);
  check('review: the height says bulk head, no button to change it', lock.tick && lock.locked, lock);
  check('GDL set ticked goes on the line 84" high', lock.gdl === 84, lock.gdl);
  check('94" opening: no tick, 96" door, the bulk head line only counts the GDL set (qty 1)', lock.over[0] === 96 && lock.over[1] === 96 && lock.over[2] === '1' && !lock.over[3], lock.over);
  check('back to the 86.5" opening as before', lock.back === 84, lock.back);
  // the real workbook and the phone, for an 88" opening ticked
  await page.evaluate(() => { const j = state.job, op = j.openings[0]; op.openH = '88'; op.options[0].v.valance = true; calcJob(j); render(); });
  await page.waitForTimeout(300);
  const wb88 = await book('b88');
  check('workbook, 88" opening ticked: bypass line 84 high, Oversized Bulk Head 1 x $150', wb88['Pricing Sheet!J9'] === 84 && wb88['Pricing Sheet!F55'] === 'Oversized Bulk Head' &&
    wb88['Pricing Sheet!J55'] === 150 && wb88['Pricing Sheet!K55'] === 1 && wb88['UploadTemplate!W37'] === 84, ['J9', 'F55', 'J55', 'K55'].map(k => wb88['Pricing Sheet!' + k]).concat(wb88['UploadTemplate!W37']));
  await page.evaluate(() => { const j = state.job, op = j.openings[0]; op.openH = '86.5'; delete op.options[0].v.valance; calcJob(j); render(); });
  // signing changes with the tick
  const fp = await page.evaluate(() => { const o = state.job.openings[0].options[0]; const a = signFp(state.job); o.v.valance = true; calcJob(state.job);
    const b = signFp(state.job); delete o.v.valance; calcJob(state.job); return a !== b; });
  check('ticking it changes what is signed', fp);

  // 2.82, Andrew: no door size button on the review; the ticks on one line
  const rv = await page.evaluate(() => ({doorBtns:document.querySelectorAll('.rv-door, [data-padof="doorW"], [data-padof="doorH"]').length,
    tops:[...document.querySelectorAll('tr.rv-l3')][0] ? [...[...document.querySelectorAll('tr.rv-l3')][0].querySelectorAll('.rv-ticks .mix-tick')].map(l => Math.round(l.getBoundingClientRect().top)) : []}));
  check('review: no door size buttons', rv.doorBtns === 0, rv);
  check('review: the three ticks of the 3 door bypass on one line', rv.tops.length === 3 && new Set(rv.tops).size === 1, rv.tops);
  if(process.env.SHOT2){ await page.evaluate(() => { const j = state.job, op = j.openings[0]; op.openH = '88'; op.options[0].v.valance = true; calcJob(j); render(); });
    await page.waitForTimeout(300); const r = page.locator('tr.rv-l3 .rv-ticks').first(); await r.evaluate(e => e.scrollIntoView({block:'center'}));
    await page.screenshot({path:process.env.SHOT2});
    await page.evaluate(() => { const j = state.job, op = j.openings[0]; op.openH = '86.5'; delete op.options[0].v.valance; calcJob(j); render(); }); }
  const ms = await page.evaluate(() => { const v = state.view; state.view = 'job'; state.openOpening = state.job.openings[2].id; render();
    const r = {boxes:document.querySelectorAll('[data-padof="doorW"], [data-padof="doorH"]').length, line:(document.querySelector('.door-sz-ro') || {}).textContent};
    state.view = v; render(); return r; });
  check('measurement screen: no manual door size boxes, the door on one line', ms.boxes === 0 && /Door 32" x 80"/.test(ms.line || ''), ms);
  // a size typed on an older version still goes to the workbook until reset
  await page.evaluate(() => { const op = state.job.openings[2]; setOpeningSize(op, 'doorW', '28'); setOpeningSize(op, 'doorH', '78'); calcJob(state.job); render(); });
  const sb = await book('size');
  check('workbook: a door size from the measurement screen still goes on the line (28 x 78)', sb['Pricing Sheet!L11'] === 28 && sb['Pricing Sheet!J11'] === 78, [sb['Pricing Sheet!L11'], sb['Pricing Sheet!J11']]);
  await page.evaluate(() => { const op = state.job.openings[2]; delete op.doorW; delete op.doorH; calcJob(state.job); render(); });
  const ab = await book('auto');
  const d4 = Object.keys(before).filter(k => JSON.stringify(before[k]) !== JSON.stringify(ab[k]));
  check('workbook back to as before', d4.length === 0, d4.map(k => [k, before[k], ab[k]]));
  check('no page errors', errors.length === 0, errors);
  console.log(fails ? fails + ' FAILED' : 'ALL PASSED');
  await browser.close(); server.close(); process.exit(fails ? 1 : 0);
})();

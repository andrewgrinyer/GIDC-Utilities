// Portal 2.23 Opening columns: proof that nothing saved or sent to Access
// changes. Builds offline copies of 2.22 (from git, the last commit that
// says 2.22) and 2.23 (this working copy) with tests/offline/build.py, then
// does the same things in both and compares:
//   1. the sample order (every door type) saved as it stands
//   2. a pivot's size typed: into Door Width on 2.22, into Opening Width on 2.23
//   3. the order form spreadsheet for Access downloaded from each, cell by cell
//   4. that spreadsheet imported back as a new order on each, rows compared
// Ends with SAME or DIFFERENT for each, and ERRORS: [] when no page threw.
//
//   node tests/opening-columns.js            (REF=<git ref> to change the old one)
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const { execSync } = require('child_process');
const fs = require('fs'), path = require('path'), os = require('os');
const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'gidc-open-'));
const ref = process.env.REF || execSync('git log -1 --format=%H -S "Dealer portal 2.22 ·" -- dealer-portal/version.txt', {cwd: ROOT}).toString().trim();
fs.writeFileSync(path.join(TMP, 'old.html'), execSync('git show ' + ref + ':dealer-portal/index.html', {cwd: ROOT, maxBuffer: 1 << 28}));
const build = (src, label, out) => execSync(['python3', path.join(ROOT, 'tests/offline/build.py'), src, JSON.stringify(label), out].join(' '));
build(path.join(TMP, 'old.html'), 'old', path.join(TMP, 'off-old.html'));
build(path.join(ROOT, 'dealer-portal/index.html'), 'new', path.join(TMP, 'off-new.html'));

function sheetCells(file){
  const dir = file + '.d'; fs.mkdirSync(dir);
  execSync('unzip -q -o ' + JSON.stringify(file) + ' -d ' + JSON.stringify(dir));
  const out = {};
  const walk = d => fs.readdirSync(d).forEach(f => {
    const p = path.join(d, f);
    if(fs.statSync(p).isDirectory()) return walk(p);
    if(/docProps/.test(p)) return;               // the time it was made
    out[path.relative(dir, p)] = fs.readFileSync(p, 'utf8');
  });
  walk(dir); return out;
}

(async () => {
  const b = await chromium.launch();
  const errs = [], R = {};
  for (const v of ['old', 'new']) {
    const page = await b.newPage({viewport: {width: 1500, height: 950}, acceptDownloads: true});
    page.on('pageerror', e => errs.push(v + ': ' + e.message)); page.on('dialog', d => d.accept());
    await page.goto('file://' + path.join(TMP, 'off-' + v + '.html'));
    await page.waitForSelector('tr[data-open]');
    const r = R[v] = {build: await page.evaluate(() => BUILD)};
    await page.$eval('tr[data-open="sample-draft"] td:nth-child(2)', x => x.click());
    await page.waitForSelector('table.lines');
    const save = async () => { await page.evaluate(() => { window.OFFLINE_SAVED = []; });
      await page.click('[data-adminsave]'); await page.waitForFunction(() => (window.OFFLINE_SAVED || []).length);
      return page.evaluate(() => window.OFFLINE_SAVED[window.OFFLINE_SAVED.length - 1].body); };
    r.saved = await save();
    // 2. the pivot on line 7: the box the dealer types the size into
    const box = v === 'old' ? 'input[data-r="s7"][data-k="width"]' : 'input[data-r="s7"][data-k="width"]';
    const col = await page.$eval(box, el => el.closest('td').cellIndex);
    const head = await page.$eval('table.lines thead tr.sub', (tr, i) => tr.cells[i].innerText, col);
    r.typedIn = head;
    await page.fill(box, '30.25'); await page.press(box, 'Tab');
    r.savedAfterTyping = await save();
    r.restileAfterTyping = await page.evaluate(() => state.order.form.rows.find(x => x.id === 's7').reStile);
    // 3. the spreadsheet for Access
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-xlsx]')]);
    r.xlsx = path.join(TMP, v + '-' + dl.suggestedFilename()); await dl.saveAs(r.xlsx);
    r.cells = sheetCells(r.xlsx);
    // 4. that spreadsheet imported into a new order
    await page.click('[data-back]'); await page.waitForSelector('tr[data-open]');
    await page.click('[data-new]'); await page.waitForSelector('[data-import="sheet"]');
    await page.click('[data-import="sheet"]');
    await page.waitForSelector('input[type=file][accept=".xlsx"]', {state: 'attached'});
    await page.setInputFiles('input[type=file][accept=".xlsx"]', R.old.xlsx);   // both import the file 2.22 made
    await page.waitForFunction(() => state.order && state.order.form.rows.length > 0, null, {timeout: 15000});
    await page.waitForTimeout(500);
    r.imported = await page.evaluate(() => state.order.form.rows.map(x => { const y = Object.assign({}, x); delete y.id; return y; }));
    if(v === 'new') await page.screenshot({path: path.join(TMP, 'imported-new.png')});
    await page.close();
  }
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const strip = s => { const t = JSON.parse(JSON.stringify(s)); delete t.updated_at; return t; };
  console.log('old:', R.old.build, ' new:', R.new.build);
  console.log('1. sample order saved:', same(strip(R.old.saved), strip(R.new.saved)) ? 'SAME' : 'DIFFERENT');
  console.log('2. pivot typed into', JSON.stringify(R.old.typedIn), 'on old and', JSON.stringify(R.new.typedIn), 'on new; saved:',
    same(strip(R.old.savedAfterTyping), strip(R.new.savedAfterTyping)) ? 'SAME' : 'DIFFERENT',
    '; re stile', R.old.restileAfterTyping, '/', R.new.restileAfterTyping);
  const files = Array.from(new Set(Object.keys(R.old.cells).concat(Object.keys(R.new.cells))));
  const diff = files.filter(f => R.old.cells[f] !== R.new.cells[f]);
  console.log('3. order form for Access:', files.length, 'parts compared,', diff.length ? 'DIFFERENT: ' + diff.join(', ') : 'SAME');
  console.log('4. spreadsheet imported:', R.old.imported.length, 'lines,', same(R.old.imported, R.new.imported) ? 'SAME' : 'DIFFERENT');
  if(!same(R.old.imported, R.new.imported)) console.log(JSON.stringify(R.old.imported[0]), '\n', JSON.stringify(R.new.imported[0]));
  console.log('files in', TMP);
  console.log('ERRORS:', errs);
  await b.close(); process.exit(0);
})();

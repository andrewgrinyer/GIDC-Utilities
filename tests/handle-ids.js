// Measurement app 2.68: every handle style the app offers turns into the
// right Access numbers in a real downloaded workbook (Andrew, 24 Nov: a
// contract came into Access as Alexandria Century, not Latitude Collins).
// Builds jobs of 26 lines, downloads each workbook, has LibreOffice
// recalculate it, and reads UploadTemplate rows 37 onward (the ID rows the
// Access import reads): DoorHandleID, DoorTrimStyleID, DoorHandleStyleID.
// The expected numbers come from the handle's own name, checked against
// the template's Data sheet once per handle (Latitude 1, Collins 2, ...).
//
//   node tests/handle-ids.js        needs soffice and python3 with openpyxl
const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const path = require('path'), fs = require('fs'), http = require('http'), os = require('os');
const { execFileSync } = require('child_process');
const DIR = path.join(__dirname, '..', 'measurement-app');
const server = http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]); if(p === '/') p = '/index.html';
  const f = path.join(DIR, p);
  if(!f.startsWith(DIR) || !fs.existsSync(f)){ r.statusCode = 404; return r.end('nf'); }
  let body = fs.readFileSync(f);
  if(p === '/index.html') body = body.toString('utf8').replace("supabaseUrl: 'https://baakegbtuygtldksmant.supabase.co'", "supabaseUrl: ''");
  r.setHeader('Content-Type', p.endsWith('.js') ? 'text/javascript' : 'text/html'); r.end(body);
});
let fails = 0;
const check = (name, ok, got) => { console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : '  got: ' + String(JSON.stringify(got)).slice(0, 1500))); if(!ok) fails++; };
const READ = `
import sys, json, openpyxl
wb = openpyxl.load_workbook(sys.argv[1], data_only=True); u = wb['UploadTemplate']
print(json.dumps([[u['AB%d' % r].value, u['AC%d' % r].value, u['AD%d' % r].value, u['AB%d' % (r - 33)].value] for r in range(37, 63)]))`;

// the numbers each handle and trim name must get (from the Data sheet's own
// columns, where every handle and every trim keeps one number)
const HANDLE = {Latitude:1, Lattitude:1, Broadway:2, Bowery:3, Hobson:4, Accent:5, Bell:6, Georgian:7, Orbit:8, Plymouth:9,
  Siena:10, Manhattan:11, Whitney:12, Alexandria:13, Northbrook:15, Andover:16, Dempsey:17, Eller:18, Merano:0};
const TRIM = {Standard:1, Collins:2, Upland:3, Camelot:4, Alden:5, Kinsler:7, Rosewood:8, Century:9};
const expect = n => { const m = n.match(/^([RC])\s*-\s*(\S+)\s+(\S+)$/); return m && [HANDLE[m[2]], TRIM[m[3]], m[1] === 'R' ? 1 : 2]; };

(async () => {
  await new Promise(ok => server.listen(0, ok));
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('http://127.0.0.1:' + server.address().port + '/'); await page.waitForTimeout(300);
  const styles = await page.evaluate(() => LISTS.handleStyle.filter(n => n !== 'N/A'));
  check('the app offers 153 handle styles', styles.length === 153, styles.length);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'handles-'));
  fs.writeFileSync(path.join(tmp, 'read.py'), READ);
  // LibreOffice keeps Excel's saved results unless told to recalculate on load
  const prof = path.join(tmp, 'lo'); fs.mkdirSync(path.join(prof, 'user'), {recursive:true});
  fs.writeFileSync(path.join(prof, 'user', 'registrymodifications.xcu'), '<?xml version="1.0" encoding="UTF-8"?>' +
    '<oor:items xmlns:oor="http://openoffice.org/2001/registry" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
    '<item oor:path="/org.openoffice.Office.Calc/Formula/Load"><prop oor:name="OOXMLRecalcMode" oor:op="fuse"><value>0</value></prop></item>' +
    '<item oor:path="/org.openoffice.Office.Calc/Formula/Load"><prop oor:name="ODFRecalcMode" oor:op="fuse"><value>0</value></prop></item></oor:items>');
  const wrong = [];
  for(let b = 0; b * 26 < styles.length; b++){
    const batch = styles.slice(b * 26, b * 26 + 26);
    await page.evaluate(batch => {
      state.me = {name:'admin', role:'admin'};
      const j = newJob(); j.customer = 'Handle Test'; j.openings = []; j.inHome = false;
      batch.forEach((h, i) => {
        const op = newOpening(i + 1, null, j);
        Object.assign(op, {location:'Office', existingType:'Double Swing Dummy', openW:'64', openH:'96', cond:'Jamb'});
        Object.assign(op.options[0].v, {doorType:'Double Swing Dummy', productType:'1.375 Glass', doorStyle:'1 Lite Clear',
          handleType:'Dummy', handleStyle:h, hwColour:'Chrome', paintColour:'Alabaster', install:'YES'});
        applyQtyRule(op); j.openings.push(op);
      });
      state.job = j; state.view = 'job';
    }, batch);
    const [dl] = await Promise.all([page.waitForEvent('download'), page.evaluate(() => download(state.job))]);
    const f = path.join(tmp, 'b' + b + '.xlsx'); await dl.saveAs(f);
    const out = path.join(tmp, 'calc' + b); fs.mkdirSync(out);
    execFileSync('soffice', ['-env:UserInstallation=file://' + prof, '--headless', '--convert-to', 'xlsx', '--outdir', out, f], {stdio:'ignore'});
    const rows = JSON.parse(execFileSync('python3', ['-I', '-W', 'ignore', path.join(tmp, 'read.py'), path.join(out, 'b' + b + '.xlsx')]).toString());
    batch.forEach((h, i) => {
      const [hid, tid, sid, text] = rows[i], e = expect(h);
      if(text !== h || !e || hid !== e[0] || tid !== e[1] || sid !== e[2]) wrong.push({h, text, got:[hid, tid, sid], want:e});
    });
  }
  check('every handle style goes to Access with its own handle, trim and style numbers', wrong.length === 0, wrong);
  check('C - Lattitude Collins is Latitude 1, Collins 2, Schlage Custom 2', !wrong.some(w => w.h === 'C - Lattitude Collins'));
  check('no page errors', errors.length === 0, errors);
  console.log(fails ? fails + ' FAILED' : 'ALL PASSED');
  await browser.close(); server.close(); process.exit(fails ? 1 : 0);
})();

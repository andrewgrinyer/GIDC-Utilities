// Measurement app 2.25: the Schlage handle photos on the door selections page.
//
//   node tests/handle-photos.js
//   (or PLAYWRIGHT=/path/to/playwright node tests/handle-photos.js)
//
// Checks that every handle style and finish on the lists has a photo file,
// that a job's handles show under its doors (grouped by style and finish,
// with where each goes), that a finish Schlage does not make says so, that
// handle types with no Schlage handle (bifold knob, customer supplied) are
// left off, and that the page still prints on one sheet with up to 8 door
// styles and 5 handles. Also that the signed PDF's door page has them.

const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const path = require('path'), fs = require('fs'), http = require('http'), os = require('os');
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
const pdftext = file => { try{ return require('child_process').execFileSync('pdftotext', ['-layout', file, '-']).toString(); }catch(e){ return null; } };

(async () => {
  await new Promise(ok => server.listen(0, ok));
  const url = 'http://127.0.0.1:' + server.address().port + '/';
  const browser = await chromium.launch();
  const page = await browser.newPage({viewport:{width:1280, height:900}});
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(url); await page.waitForTimeout(300);

  // every style and finish has a photo on disk
  const all = await page.evaluate(() => {
    const out = [];
    LISTS.handleStyle.filter(s => s !== 'N/A').forEach(s => LISTS.hwColour.filter(c => c !== 'N/A').forEach(c => {
      const e = HANDLE_PHOTOS[s]; out.push([s, c, e && e.f[c] ? e.f[c][0] : null]); }));
    return out;
  });
  const gaps = all.filter(([s, c, f]) => !f || !fs.existsSync(path.join(DIR, 'docs', 'handles', f + '.jpg')));
  check('every handle style and finish has a photo file (' + all.length + ')', gaps.length === 0, gaps.slice(0, 5));

  const setup = (doors) => page.evaluate(doors => {
    state.me = {name:'tester', role:'admin'};
    const j = newJob(); Object.assign(j, {customer:'Jane Sample', address:'12 Main St', city:'Cambridge', phone:'519 555 1234',
      email:'jane@example.com', salesRep:'Sam Rep', leadTime:'8-10 Weeks', docType:'Sales Contract - Cash Web Pricing'}); j.openings = [];
    doors.forEach(([loc, type, style, ht, hs, col]) => { const op = newOpening(j.openings.length + 1);
      op.location = loc; op.existingType = type; op.width = '32'; op.height = 80;
      Object.assign(op.options[0].v, {doorType:type, productType:'1.375 Hollow', doorStyle:style, jamb:'', routerStop:'NO',
        reStile:'NO', install:'YES', paintColour:'STD White', handleType:ht, handleStyle:hs, hwColour:col});
      applyQtyRule(op); j.openings.push(op); });
    state.job = j; state.view = 'job'; render();
  }, doors);

  await setup([
    ['Foyer', 'Single Swing', 'Columbia', 'Passage', 'R -Latitude Standard', 'Matte Black'],
    ['Bath', 'Single Swing', 'Columbia', 'Privacy', 'R -Latitude Standard', 'Matte Black'],
    ['Den', 'Single Swing', 'Kingston', 'Passage', 'C - Hobson Collins', 'Satin Brass'],
    ['Closet', 'Bifold', 'Kingston', 'Bifold Knob', 'N/A', 'Matte Black'],
    ['Office', 'Single Swing', 'Lopez', 'Customer Supplied', 'R - Bell Standard', 'Chrome'],
    ['Pantry', 'Single Swing', 'Lopez', 'Passage', 'R - Bell Standard', 'Matte Black'],
  ]);
  const hp = await page.evaluate(() => handlePicks(state.job));
  check('handles grouped by style and finish, bifold knob and customer supplied left off', hp.length === 3 &&
    hp[0].title === 'Latitude lever' && hp[0].where.length === 2 && hp[1].title === 'Hobson knob' && hp[1].line === 'Schlage Custom', hp);
  check('a finish Schlage does not make says what the photo shows', /^Not made in Matte Black, photo shows /.test(hp[2].note), hp[2]);
  await page.click('[data-review]'); await page.waitForFunction(() => state.reviewReady, null, {timeout:30000});
  await page.emulateMedia({media:'print'});
  await page.evaluate(async () => Promise.all([...document.images].map(i => i.complete ? 0 : new Promise(r => { i.onload = i.onerror = r; }))));
  const shown = await page.evaluate(() => [...document.querySelectorAll('.print-doors .ph-card img')].map(i => [i.getAttribute('src'), i.naturalWidth]));
  check('the door page shows the 3 handle photos', shown.length === 3 && shown.every(s => s[1] > 0), shown);
  check('the page title names the handles', await page.evaluate(() => document.querySelector('.print-doors h2').textContent) === 'Your door and handle selections');

  // 8 door styles and 5 handles still fit one sheet
  await page.emulateMedia({media:'screen'});
  const styles = ['Columbia', 'Kingston', 'Lopez', 'Bonneville', 'Rosario', 'Mercer', 'Whitman', 'Riverside'];
  const hs = [['R - Georgian Camelot', 'Satin Nickel'], ['R - Accent Century', 'Chrome'], ['C - Alexandria Rosewood', 'Aged Bronze'],
              ['R - Plymouth Collins', 'Bright Brass'], ['C - Whitney Kinsler', 'Matte Black']];
  await setup(styles.map((s, i) => ['Room ' + (i + 1), 'Single Swing', s, 'Passage', hs[i % 5][0], hs[i % 5][1]]));
  await page.click('[data-review]'); await page.waitForFunction(() => state.reviewReady, null, {timeout:30000});
  await page.emulateMedia({media:'print'});
  await page.evaluate(async () => Promise.all([...document.images].map(i => i.complete ? 0 : new Promise(r => { i.onload = i.onerror = r; }))));
  const tmp = path.join(os.tmpdir(), 'handle-photos-print.pdf');
  await page.pdf({path:tmp, preferCSSPageSize:true, printBackground:true});
  const txt = pdftext(tmp);
  if(txt === null) console.log('SKIP one sheet check (no pdftotext here)');
  else { const pages = txt.split('\f'), i = pages.findIndex(p => p.includes('door and handle selections'));
    check('8 door styles and 5 handles print on one sheet with the signature line', i >= 0 &&
      pages[i].includes('Whitney lever') && pages[i].includes('Riverside') && pages[i].includes('Customer Signature'), pages[i] && pages[i].slice(0, 300)); }

  // the signed PDF's door page
  const bytes = await page.evaluate(async () => Array.from(await contractPdf(state.job)));
  const tmp2 = path.join(os.tmpdir(), 'handle-photos-contract.pdf');
  fs.writeFileSync(tmp2, Buffer.from(bytes));
  const t2 = pdftext(tmp2);
  if(t2 !== null) check('the signed PDF door page lists the handles', /door and handle selections/.test(t2) &&
    ['Georgian knob', 'Accent lever', 'Alexandria knob', 'Plymouth knob', 'Whitney lever'].every(w => t2.includes(w)), t2.slice(0, 500));

  check('no page errors', errors.length === 0, errors);
  await browser.close(); server.close();
  console.log(fails ? fails + ' FAILED' : 'ALL PASSED');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

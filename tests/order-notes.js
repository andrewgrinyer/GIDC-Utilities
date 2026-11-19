// Measurement app 2.56: notes for each door and for the whole order, printed
// on the contract in small red print.
//
//   node tests/order-notes.js
//   (or PLAYWRIGHT=/path/to/playwright node tests/order-notes.js)
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
  await page.evaluate(() => {
    state.me = {name:'admin', role:'admin'};
    const j = newJob(); j.customer = 'Note Test'; j.address = '1 Main St'; j.city = 'Cambridge'; j.inHome = false; j.openings = [];
    const add = (type, W, H) => {
      const op = newOpening(j.openings.length + 1, null, j);
      Object.assign(op, {location:'Foyer 1', existingType:type, openW:String(W), openH:String(H), cond:'Jamb'});
      Object.assign(op.options[0].v, {doorType:type, productType:'1.375 Hollow', doorStyle:'Kingston', install:'YES', paintColour:'STD White', handleType:'Passage'});
      applyQtyRule(op); j.openings.push(op); return op;
    };
    add('Single Swing', 30.25, 81); add('Single Swing', 28.25, 81);
    state.job = j; state.view = 'job'; state.openOpening = j.openings[0].id; render();
  });
  // the door note on the opening card
  const fp0 = await page.evaluate(() => signFp(state.job));
  check('an opening with no note shows + Note for this door', await page.locator('.card.is-open [data-opnoteadd]').count() === 1);
  await page.click('.card.is-open [data-opnoteadd]'); await page.waitForTimeout(100);
  check('the note box opens with the cursor in it', await page.evaluate(() => document.activeElement && document.activeElement.dataset.opnote === state.job.openings[0].id));
  await page.fill('.card.is-open textarea[data-opnote]', 'Keep the existing stop');
  await page.locator('.card.is-open textarea[data-opnote]').dispatchEvent('change');
  await page.fill('textarea[data-jobnote]', 'Call before arriving\nPark on the street');
  await page.locator('textarea[data-jobnote]').dispatchEvent('change');
  const st = await page.evaluate(() => ({a:state.job.openings[0].note, b:state.job.openings[1].note || '', j:state.job.note, fp:signFp(state.job)}));
  check('door note saved on the opening', st.a === 'Keep the existing stop' && st.b === '', st);
  check('order note saved on the job', st.j === 'Call before arriving\nPark on the street', st);
  check('a note changes what is signed', st.fp !== fp0, [fp0, st.fp]);

  // the review: a note row per door, the order note under the doors
  await page.evaluate(() => openReview());
  await page.waitForFunction(() => state.reviewReady);
  const rv = await page.evaluate(() => ({rows:[...document.querySelectorAll('tr.rv-l3')].map(r => [r.className.includes('empty'), r.querySelector('textarea').value]),
    order:document.querySelector('.rv-notes textarea').value}));
  check('review shows the door notes, empty rows marked empty', rv.rows.length === 2 && !rv.rows[0][0] && rv.rows[0][1] === 'Keep the existing stop' && rv.rows[1][0], rv);
  check('review shows the order note', rv.order === st.j, rv);
  // typed on the review too
  await page.fill('tr.rv-l3 >> nth=1 >> textarea', 'Customer to paint');
  await page.locator('tr.rv-l3 >> nth=1 >> textarea').dispatchEvent('change');
  check('door note typed on the review', await page.evaluate(() => state.job.openings[1].note) === 'Customer to paint');

  // printed: red text, no boxes
  await page.emulateMedia({media:'print'});
  const pr = await page.evaluate(() => ({shown:[...document.querySelectorAll('.note-print')].filter(e => getComputedStyle(e).display !== 'none').map(e => [e.textContent, getComputedStyle(e).color]),
    boxes:[...document.querySelectorAll('.note-in')].filter(e => getComputedStyle(e).display !== 'none').length}));
  check('print shows the notes in red and hides the boxes', pr.boxes === 0 && pr.shown.length === 3 &&
    pr.shown.every(x => x[1] === 'rgb(181, 18, 27)') && pr.shown[0][0] === 'Note: Keep the existing stop' && /^Order notes: Call before arriving/.test(pr.shown[2][0]), pr);
  // 2.58: a door with no note keeps its number block level with its own two lines when printed
  await page.evaluate(() => { state.job.openings[0].note = ''; render(); });
  const al = await page.evaluate(() => [...document.querySelectorAll('table.rv-two tbody tr.rv-l1')].map(r => {
    const n = r.querySelector('td.rv-n').getBoundingClientRect(), l2 = r.nextElementSibling.getBoundingClientRect(), l3 = r.nextElementSibling.nextElementSibling.getBoundingClientRect();
    return [Math.round(n.top - r.getBoundingClientRect().top), Math.round(n.bottom - Math.max(l2.bottom, l3.bottom))]; }));
  check('printed number blocks line up with their own door, note or not', al.length === 2 && al.every(x => Math.abs(x[0]) <= 1 && Math.abs(x[1]) <= 1), al);
  if(process.env.PRINT) await page.pdf({path:process.env.PRINT, landscape:true, format:'Letter', printBackground:true});
  await page.evaluate(() => { state.job.openings[0].note = 'Keep the existing stop'; render(); });
  await page.emulateMedia({media:'screen'});

  // the contract PDF carries them
  const bytes = await page.evaluate(async () => Array.from(await contractPdf(state.job, {blank:true})));
  const os = require('os'), tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'notes-'));
  fs.writeFileSync(path.join(tmp, 'c.pdf'), Buffer.from(bytes));
  let txt = '';
  try{ txt = require('child_process').execFileSync('pdftotext', ['-f', '1', '-l', '1', path.join(tmp, 'c.pdf'), '-']).toString(); }catch(e){ txt = 'no pdftotext'; }
  check('contract PDF has each door note and the order note', /Note: Keep the existing stop/.test(txt) && /Note: Customer to paint/.test(txt) &&
    /Order notes: Call before arriving/.test(txt) && /Park on the street/.test(txt), txt.slice(0, 1500));
  if(process.env.PDF) fs.writeFileSync(process.env.PDF, Buffer.from(bytes));

  check('no page errors', !errors.length, errors);
  await browser.close(); server.close();
  console.log(fails ? fails + ' FAILED' : 'ALL PASSED');
  process.exit(fails ? 1 : 0);
})();

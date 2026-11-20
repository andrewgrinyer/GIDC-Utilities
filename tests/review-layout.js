// Measurement app 2.8: the review shows each door on two lines.
//
//   node tests/review-layout.js
//   (or PLAYWRIGHT=/path/to/playwright node tests/review-layout.js)
//   SHOTS=/some/dir saves a screenshot per screen width.
//
// Serves measurement-app/ with Supabase switched off. Checks that each door
// is two table rows, that the door table does not scroll sideways on a
// laptop or a tablet held sideways, that doors alternate shading so the two
// lines read as one door, and that special order doors keep their red tint.

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
  r.setHeader('Content-Type', p.endsWith('.js') ? 'text/javascript' : 'text/html');
  r.end(body);
});

let fails = 0;
const hex = h => 'rgb(' + [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)).join(', ') + ')';
const check = (name, ok, got) => {
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : '  got: ' + JSON.stringify(got).slice(0, 400)));
  if(!ok) fails++;
};

(async () => {
  await new Promise(ok => server.listen(0, ok));
  const url = 'http://127.0.0.1:' + server.address().port + '/';
  const browser = await chromium.launch();
  const page = await browser.newPage({viewport:{width:1280, height:900}, deviceScaleFactor:1});
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(url); await page.evaluate(() => { const nj = newJob; window.newJob = () => { const j = nj(); delete j.sizing; j.openings.forEach(o => { delete o.openW; delete o.openH; }); return j; }; }); /* 2.31: these jobs are entered the old way */
  await page.waitForTimeout(300);

  // a job a rep could really have measured
  await page.evaluate(() => {
    state.me = {name:'admin', role:'admin'};
    const j = newJob(); j.customer = 'Review Test'; j.city = 'Cambridge';
    j.docType = 'Estimate - Cash Web Pricing'; j.openings = [];
    const add = (loc, type, prod, style, w, h, extra) => {
      const op = newOpening(j.openings.length + 1); op.location = loc; op.existingType = type;
      op.width = String(w); op.height = h;
      Object.assign(op.options[0].v, {doorType:type, productType:prod, doorStyle:style,
        jamb:'', routerStop:'NO', reStile:'NO', install:'YES', paintColour:'STD White'}, extra || {});
      applyQtyRule(op); j.openings.push(op); return op;
    };
    add('Foyer 1', 'Single Swing', '1.375 Hollow', 'Columbia', 32, 80,
        {handleType:'Passage', handleStyle:'R -Latitude Standard', hwColour:'Matte Black'});
    add('Master Clst 1', 'Bifold', '1.375 Hollow', 'Kingston', 48, 80, {handleType:'Bifold Knob'});
    add('Bed 2 Clst', 'Bypass', '1.375 Solid', 'Lopez', 60, 80, {handleType:'Finger Pull Round'}).qty = 2;
    add('Den', 'Double Swing AST', '1.375 Glass', '1 Lite Clear', 48, '81-83',
        {handleType:'Passage/Dummy', handleStyle:'R -Latitude Standard', hwColour:'Chrome'});
    add('Pantry', 'Single Swing', '1.375 Glass', '1 Lite Clear', 22, 80, {handleType:'Privacy',
        handleStyle:'R -Latitude Standard', hwColour:'Matte Black'});
    j.materials[0] = {desc:'Casing', price:'45.5', qty:'3'};
    state.job = j; state.view = 'job'; render();
  });

  await page.click('[data-review]');
  await page.waitForFunction(() => state.reviewReady, null, {timeout:15000});
  await page.waitForTimeout(200);
  const n = await page.evaluate(() => [document.querySelectorAll('table.rv-two tbody tr.rv-l1').length,
                                       document.querySelectorAll('table.rv-two tbody tr.rv-l2').length]);
  check('each door is two rows', n[0] === 5 && n[1] === 5, n);
  // 2.56: a third row per door holds its note, under the number cell like the second
  const cols = await page.evaluate(() => [...document.querySelectorAll('table.rv-two tbody tr')].map(t =>
    [...t.children].reduce((a, c) => a + (c.colSpan || 1), 0) + (t.classList.contains('rv-l2') || t.classList.contains('rv-l3') ? 1 : 0)));
  check('both lines fill the same width', new Set(cols).size === 1, cols);
  const alt = await page.$$eval('table.rv-two tr.rv-l1', t => t.map(x => getComputedStyle(x.children[1]).backgroundColor));
  check('next doors have different colours', alt.slice(0, 4).every((c, i) => i === 0 || c !== alt[i - 1]), alt);
  const pair = await page.$$eval('table.rv-two tbody tr:not(.rv-l3)', t => t.slice(0, 4).map(x =>
    getComputedStyle(x.children[x.classList.contains('rv-l1') ? 1 : 0]).backgroundColor));
  check('a door\'s two lines share one shade', pair[0] === pair[1] && pair[2] === pair[3] && pair[1] !== pair[2], pair);
  const heads = await page.$$eval('table.rv-two thead th', t => t.map(x => x.textContent));
  check('every contract column is still on the page', ['Location','Door Style','Supplier size','Width','Height',
    'Door MSRP','Door Total','Jamb Instl','Paint Colour','Handle Cost','Install'].every(k => heads.includes(k)), heads);

  for(const [w, hgt, name] of [[1280, 800, 'laptop'], [1180, 820, 'tablet sideways'], [1024, 768, 'small tablet sideways']]){
    await page.setViewportSize({width:w, height:hgt}); await page.waitForTimeout(200);
    const sc = await page.$eval('.rv-scroll', e => [e.scrollWidth, e.clientWidth]);
    check('no sideways scroll on a ' + name + ' (' + w + ' wide)', sc[0] <= sc[1] + 1, sc);
    if(process.env.SHOTS) await page.screenshot({path: path.join(process.env.SHOTS, 'review-' + w + '.png'), fullPage:true});
  }

  // a special order door stays red on both of its lines
  await page.evaluate(() => { const v = state.job.openings[1].options[0].v; v.doorStyle = '1 Panel True Shaker';
    v.productType = '1.75 Thick'; calcJob(state.job); render(); });
  await page.waitForTimeout(200);
  const red = await page.$$eval('table.rv-two tbody tr:not(.rv-l3)', t => t.slice(0, 4).map(x =>
    [x.classList.contains('rv-stop'), getComputedStyle(x.children[x.classList.contains('rv-l1') ? 1 : 0]).backgroundColor]));
  check('special order door is tinted on both lines, over the shading',
        red[2][0] && red[3][0] && red[2][1] === red[3][1] && red[2][1] !== red[0][1], red);

  // no prices: the lines still match up
  await page.evaluate(() => { state.me.role = 'manufacturing'; render(); });
  const cols2 = await page.evaluate(() => [...document.querySelectorAll('table.rv-two tbody tr:not(.rv-l3)')].map(t =>
    [...t.children].reduce((a, c) => a + (c.colSpan || 1), 0) + (t.classList.contains('rv-l2') ? 1 : 0)));
  check('without prices both lines still fill the same width', new Set(cols2).size === 1, cols2);

  // the door entry screen wears the same colour as the review
  await page.evaluate(() => { state.me.role = 'admin'; state.view = 'job'; document.body.classList.remove('reviewing');
    state.openOpening = state.job.openings[2].id; render(); });
  await page.waitForTimeout(200);
  const same = await page.evaluate(() => [getComputedStyle(document.querySelector('#op-' + state.job.openings[2].id + ' .card-head')).backgroundColor,
    getComputedStyle(document.querySelector('#op-' + state.job.openings[2].id + ' .card-head .n')).backgroundColor,
    doorColour(state.job.openings[2])]);
  check('door entry card uses the door colour', same[1] === hex(same[2][0]) && same[0] === hex(same[2][1]), same);

  // a tablet held sideways: one opening fits between the header and the buttons
  for(const [w, hgt] of [[1180, 820], [1366, 1024]]){
    await page.setViewportSize({width:w, height:hgt}); await page.waitForTimeout(200);
    const fit = await page.evaluate(() => { const c = document.querySelector('.card.is-open');
      const head = document.querySelector('header').getBoundingClientRect().height;
      const dock = document.querySelector('#dock').getBoundingClientRect().height;
      return [Math.round(c.getBoundingClientRect().height), Math.round(innerHeight - head - dock)]; });
    check('one opening fits a ' + w + ' x ' + hgt + ' tablet sideways', fit[0] <= fit[1], fit);
  }

  check('no page errors', errors.length === 0, errors);
  await browser.close(); server.close();
  console.log(fails ? fails + ' FAILED' : 'ALL PASSED');
  process.exit(fails ? 1 : 0);
})();

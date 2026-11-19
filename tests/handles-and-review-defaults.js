// Measurement app 2.45: handle choices by door type, the measurement screen
// tidied (Opening has first, no jamb section, no special materials card),
// the door there now under Door Type on the review, and Select defaults on
// the review overwriting every door after a warning.
//
//   node tests/handles-and-review-defaults.js
//   (or PLAYWRIGHT=/path/to/playwright node tests/handles-and-review-defaults.js)
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
  r.setHeader('Content-Type', p.endsWith('.js') ? 'text/javascript' : 'text/html');
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
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(url); await page.waitForTimeout(300);

  // the handle lists, by door type
  const rules = await page.evaluate(() => {
    const job = {openings:[]};
    const pick = (type, handle) => { const op = newOpening(1); Object.assign(op.options[0].v, {doorType:type, handleType:handle});
      job.openings = [op]; syncHandles(job); return op.options[0].v.handleType; };
    return {
      bifold:pick('Bifold', ''), premium:pick('Premium Bifold', 'Passage'), barn:pick('Barn', 'Pocket'),
      bypassKeep:pick('Bypass', 'Finger Pull Square'), bypassBad:pick('Bypass', 'Passage'),
      swingKeep:pick('Single Swing', 'Keyed'), swingBad:pick('Single Swing', 'Bifold Knob'),
      pocketKeep:pick('Pocket', 'Customer Supplied'), pocketBad:pick('Pocket', 'Privacy'),
      dblPair:pick('Double Swing AST', 'Passage/Dummy'), singlePair:pick('Single Swing', 'Passage/Dummy'),
      pivot:pick('Single Pivot', 'Passage'),
      lists:{bypass:handleChoices('Bypass'), swing:handleChoices('Single Swing'), pocket:handleChoices('Pocket')}
    };
  });
  check('bifold types get a bifold knob by themselves', rules.bifold === 'Bifold Knob' && rules.premium === 'Bifold Knob', rules);
  check('barn gets the barn door handle', rules.barn === 'Barn Door', rules);
  check('bypass: round, square or customer supplied only', rules.bypassKeep === 'Finger Pull Square' && rules.bypassBad === '' &&
        rules.lists.bypass.join() === 'Finger Pull Round,Finger Pull Square,Customer Supplied', rules);
  check('swing: customer supplied, dummy, passage, privacy, keyed', rules.swingKeep === 'Keyed' && rules.swingBad === '' &&
        rules.singlePair === '' && rules.lists.swing.join() === 'Customer Supplied,Dummy,Passage,Privacy,Keyed', rules);
  check('a double swing keeps the pair handles', rules.dblPair === 'Passage/Dummy', rules);
  check('pocket: pocket or customer supplied', rules.pocketKeep === 'Customer Supplied' && rules.pocketBad === '' &&
        rules.lists.pocket.join() === 'Pocket,Customer Supplied', rules);
  check('pivot keeps the full list', rules.pivot === 'Passage', rules);

  // 2.50: an opening always has a door there now
  const nowMiss = await page.evaluate(() => { const j = newJob(); const op = j.openings[0];
    Object.assign(op, {openW:'30', openH:'80.5'}); op.options[0].v.doorType = 'Single Swing';
    const a = missing(j).some(m => /door there now/.test(m)); op.existingType = 'Bifold';
    return [a, missing(j).some(m => /door there now/.test(m))]; });
  check('2.50: the door there now is needed', nowMiss[0] && !nowMiss[1], nowMiss);

  // the measurement screen
  await page.evaluate(() => {
    state.me = {name:'admin', role:'admin'};
    const j = newJob(); j.customer = 'Handle Test'; j.inHome = false;
    const op = j.openings[0]; Object.assign(op, {location:'Foyer 1', existingType:'Bifold', cond:'Jamb', openW:'30', openH:'80.5'});
    Object.assign(op.options[0].v, {doorType:'Single Swing', productType:'1.375 Hollow', doorStyle:'Kingston',
      handleType:'Passage', install:'YES', paintColour:'STD White'});
    applyQtyRule(op);
    const op2 = newOpening(2, null, j); Object.assign(op2, {location:'Bed 2 Clst', existingType:'Bifold', cond:'Jamb', openW:'48', openH:'81.5', qty:2});
    Object.assign(op2.options[0].v, {doorType:'Bifold', productType:'1.375 Hollow', doorStyle:'Kingston', install:'YES', paintColour:'STD White'});
    j.openings.push(op2);
    state.job = j; state.view = 'job'; state.openOpening = op.id; state.editOption = op.options[0].id; render();
  });
  const screen = await page.evaluate(() => ({
    first:document.querySelector('.card.door .card-body').firstElementChild.className,
    left:document.querySelector('.card.door .op-left').firstElementChild.className,
    cards:[...document.querySelectorAll('.card-head b')].map(x => x.textContent),
    sects:[...document.querySelectorAll('.opt-edit .sect-head b')].map(x => x.textContent),
    handles:[...document.querySelectorAll('.opt-edit select[data-v="handleType"] option')].map(x => x.textContent).filter(Boolean),
    knob:state.job.openings[1].options[0].v.handleType}));
  check('2.47: Location on top, Opening has first under it', /o-loc o-top/.test(screen.first) && screen.left === 'o-c', screen);
  check('no jamb and machining section while measuring', screen.sects.indexOf('Jamb and machining') < 0 && screen.sects.includes('Hardware'), screen);
  check('no special materials card while measuring', !screen.cards.some(c => /Special materials/i.test(c)), screen);
  check('the handle list on a swing is its five', screen.handles.join() === 'Customer Supplied,Dummy,Passage,Privacy,Keyed', screen);
  check('the bifold got its knob', screen.knob === 'Bifold Knob', screen);
  await page.evaluate(() => { state.job.inHome = true; state.editOption = null; render(); });
  const home = await page.evaluate(() => [document.querySelector('.card.door .card-body').firstElementChild.className,
    document.querySelector('.card.door .op-left').firstElementChild.className]);
  check('the same with In-Home Measurement on', /o-loc o-top/.test(home[0]) && home[1] === 'o-c', home);
  await page.evaluate(() => { state.job.inHome = false; render(); });

  // the review
  await page.click('[data-review]');
  await page.waitForFunction(() => state.reviewReady, null, {timeout:15000});
  await page.waitForTimeout(200);
  const rv = await page.evaluate(() => {
    const sel = document.querySelector('select[data-rv="doorType"]'), now = sel.parentNode.querySelector('.rv-now');
    return {now:now && now.textContent, colour:now && getComputedStyle(now).color,
      handles:[...document.querySelectorAll('select[data-rv="handleType"]')].map(s => [...s.options].map(o => o.textContent).filter(Boolean).join()),
      mats:document.querySelectorAll('[data-rvmat]').length};
  });
  check('the door there now shows in red under Door Type', rv.now === 'Now: Bifold' && /^rgb\((1[5-9]\d|2\d\d), [0-5]?\d, [0-5]?\d\)/.test(rv.colour), rv);
  check('the review handle lists follow the door type', rv.handles[0] === 'Customer Supplied,Dummy,Passage,Privacy,Keyed' &&
        rv.handles[1] === 'Bifold Knob', rv);
  check('special materials can be typed on the review', rv.mats >= 9, rv);

  await page.click('[data-toggle="rvdefaults"]'); await page.waitForTimeout(150);
  check('Select defaults opens on the review', await page.$('.rv-defs select[data-def="paintColour"]') !== null, null);
  const paint = await page.evaluate(() => LISTS.paintColour.find(x => x !== 'STD White'));
  await page.selectOption('.rv-defs select[data-def="paintColour"]', paint); await page.waitForTimeout(150);
  await page.click('[data-rvapplydef]'); await page.waitForTimeout(150);
  const warn = await page.evaluate(() => document.querySelector('#sure').textContent);
  check('applying warns that it overwrites', /Overwrite every door/.test(warn) && /already entered/.test(warn), warn);
  await page.click('[data-sure="no"]'); await page.waitForTimeout(100);
  const kept = await page.evaluate(() => state.job.openings.map(op => op.options[0].v.paintColour));
  check('Cancel changes nothing', kept.every(x => x === 'STD White'), kept);
  await page.click('[data-rvapplydef]'); await page.waitForTimeout(150);
  await page.click('[data-sure="yes"]'); await page.waitForTimeout(300);
  const after = await page.evaluate(() => state.job.openings.map(op => op.options[0].v.paintColour));
  check('Overwrite all sets every door', after.every(x => x === paint), {after, paint});

  // 2.46: switching a door to bifold blanks its handle style and the price follows
  await page.evaluate(() => { const o = state.job.openings[0].options[0];
    Object.assign(o.v, {handleStyle:'R -Latitude Standard', hwColour:'Matte Black', handleTyped:'99'}); calcJob(state.job); render(); });
  await page.waitForTimeout(300);
  const before = await page.evaluate(() => cv('U' + PAGE_ROWS[0]));
  await page.selectOption('select[data-rv="doorType"][data-op="' + await page.evaluate(() => state.job.openings[0].id) + '"]', 'Bifold');
  await page.waitForTimeout(500);
  const sw = await page.evaluate(() => { const o = state.job.openings[0].options[0];
    const cell = document.querySelectorAll('tr.rv-l2')[0].querySelector('.rv-fixed[title*="handle style"]');
    return {style:o.v.handleStyle, typed:o.v.handleTyped, type:o.v.handleType, u:cv('U' + PAGE_ROWS[0]), shown:!!cell}; });
  check('switched to bifold: handle style blank, typed handle price gone, bifold knob', sw.style === '' && sw.typed === '' &&
        sw.type === 'Bifold Knob' && sw.shown, sw);
  check('the hardware price follows the bifold knob', before === 99 && sw.u !== 99 && typeof sw.u === 'number', {before, u:sw.u});
  await page.evaluate(() => { state.job.openings[0].options[0].v.handleTyped = '12'; render(); });
  const keep = await page.evaluate(() => { render(); return state.job.openings[0].options[0].v.handleTyped; });
  check('a price typed on the bifold afterwards stays', keep === '12', keep);

  check('no page errors', !errors.length, errors);
  await browser.close(); server.close();
  console.log(fails ? fails + ' FAILED' : 'ALL PASSED');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

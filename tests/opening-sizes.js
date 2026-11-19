// Measurement app 2.31: doors worked out from the door opening.
//
//   node tests/opening-sizes.js
//   (or PLAYWRIGHT=/path/to/playwright node tests/opening-sizes.js)
//
// Serves measurement-app/index.html with Supabase switched off and checks
// the door, re-rail, re-stile and workbook size each opening gives, the
// supplier limits (special order when nothing fits), that older jobs keep
// what was typed, and that a new job's card asks for the opening.
// Prints PASS or FAIL per check and exits 1 on any failure.

const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const path = require('path'), fs = require('fs'), http = require('http');
const APP = path.join(__dirname, '..', 'measurement-app', 'index.html');

const html = fs.readFileSync(APP, 'utf8')
  .replace("supabaseUrl: 'https://baakegbtuygtldksmant.supabase.co'", "supabaseUrl: ''");
const server = http.createServer((q, r) => { r.setHeader('Content-Type', 'text/html'); r.end(html); });

let fails = 0;
const check = (name, ok, got) => {
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : '  got: ' + JSON.stringify(got)));
  if(!ok) fails++;
};

// [what, type, product, style, openW, openH, qty, expect]
// expect: {blankW, blankH, per, reRail, reStile, exportW, exportH} or {so:'words'}
const CASES = [
  ['swing, close fit: no rework', 'Single Swing', '1.375 Hollow', 'Kingston', 30.125, 80.5, 1,
    {blankW:30, blankH:80, reRail:false, reStile:false, exportW:30, exportH:80}],
  ['swing 30 1/4 x 81: a 30 x 80, uncut (0.400 over is allowed; floor gap under 1 1/4)', 'Single Swing', '1.375 Hollow', 'Kingston', 30.25, 81, 1,
    {blankW:30, blankH:80, reRail:false, reStile:false, exportW:30, exportH:80}],
  ['swing 30.4 wide still takes a 30', 'Single Swing', '1.375 Hollow', 'Kingston', 30.4, 80.5, 1, {blankW:30}],
  ['swing 30.45 wide goes to a 32', 'Single Swing', '1.375 Hollow', 'Kingston', 30.45, 80.5, 1, {blankW:32, reStile:true}],
  ['double 60.6 still takes two 30s', 'Double Swing AST', '1.375 Hollow', 'Kingston', 60.6, 80.5, 2, {blankW:30, per:2}],
  ['double 60.65 goes to two 32s', 'Double Swing AST', '1.375 Hollow', 'Kingston', 60.65, 80.5, 2, {blankW:32, per:2}],
  ['swing, wide and tall: up a size, re-rail and re-stile', 'Single Swing', '1.375 Hollow', 'Kingston', 30.5, 82, 1,
    {blankW:32, blankH:84, reRail:true, reStile:true, exportW:32, exportH:84}],
  ['swing, solid core: never reworked', 'Single Swing', '1.375 Solid', 'Kingston', 30.5, 82, 1,
    {blankW:32, blankH:84, reRail:false, reStile:false}],
  ['swing, shaker: Trimlite widths, never reworked', 'Single Swing', '1.375 Solid', '1 Panel True Shaker', 26.75, 80.5, 1,
    {blankW:28, blankH:80, reRail:false, reStile:false}],
  ['swing, Trimlite has no 20: goes up to 24', 'Single Swing', '1.375 Solid', '1 Panel True Shaker', 20.25, 80.5, 1,
    {blankW:24, blankH:80}],
  ['double swing 60 1/4 x 81: 2 doors 30 x 80, each door on the workbook', 'Double Swing AST', '1.375 Hollow', 'Kingston', 60.25, 81, 2,
    {blankW:30, blankH:80, per:2, exportW:30, exportH:80}],
  ['swing too wide for one door: special order', 'Single Swing', '1.375 Hollow', 'Kingston', 40, 80.5, 1,
    {so:'wide enough'}],
  ['swing taller than 8 foot: special order', 'Single Swing', '1.375 Hollow', 'Kingston', 30, 98, 1,
    {so:'tall enough'}],
  ['bifold pair: 24 units, opening width on the workbook', 'Bifold', '1.375 Hollow', 'Kingston', 48.5, 81.5, 2,
    {blankW:24, blankH:80, per:2, reStile:false, exportW:48.5, exportH:80}],
  ['bifold single unit 30', 'Bifold', '1.375 Hollow', 'Kingston', 30.5, 81.5, 1,
    {blankW:30, blankH:80, per:1, exportW:30.5}],
  ['pocket 30 1/4: no deduction, up to a 32, not re-stiled', 'Pocket', '1.375 Hollow', 'Kingston', 30.25, 80.5, 1,
    {blankW:32, blankH:80, reStile:false, exportW:32, exportH:80}],
  ['barn 30 1/4 x 81: up to a 32 x 84, the door on the workbook, not re-stiled', 'Barn', '1.375 Hollow', 'Kingston', 30.25, 81, 1,
    {blankW:32, blankH:84, reStile:false, exportW:32, exportH:84}],
  ['pocket 30 x 80 1/2: a 30 x 80', 'Pocket', '1.375 Hollow', 'Kingston', 30, 80.5, 1, {blankW:30, blankH:80}],
  ['pocket 30 x 81: height not upsized, a 30 x 80', 'Pocket', '1.375 Hollow', 'Kingston', 30, 81, 1, {blankW:30, blankH:80, reRail:false}],
  ['bypass 96 on 3 panels: each 32', 'Bypass', '1.375 Hollow', 'Kingston', 96, 82.5, 3,
    {blankW:32, blankH:80, per:3, reStile:false, exportW:96, exportH:80}],
  ['bypass 96 on 2 panels: over 36 each', 'Bypass', '1.375 Hollow', 'Kingston', 96, 82.5, 2,
    {so:'Use 3 panels'}],
  ['bypass 150: over the 144 most', 'Bypass', '1.375 Hollow', 'Kingston', 150, 82.5, 4,
    {so:'up to 144'}],
  ['4 lite is Trimlite: no 22, goes up to 24', 'Single Swing', '1.375 Glass', '4 Lite Clear', 22.25, 80.5, 1,
    {blankW:24, blankH:80, reStile:false}],
  // 2.43, Andrew: rough opening = door at least 1 3/4 narrower and 1 1/2 shorter
  ['rough 32 x 82: a 30 x 80, uncut', 'Single Swing', '1.375 Hollow', 'Kingston', 32, 82, 1,
    {blankW:30, blankH:80, reRail:false, reStile:false, exportW:30, exportH:80}, 'Rough Opening'],
  ['rough 33 wide: still a 30 (a 32 would leave under 1 3/4)', 'Single Swing', '1.375 Hollow', 'Kingston', 33, 82, 1,
    {blankW:30, reStile:false}, 'Rough Opening'],
  ['rough 34 x 86: a 32 x 84', 'Single Swing', '1.375 Hollow', 'Kingston', 34, 86, 1,
    {blankW:32, blankH:84, reRail:false, exportW:32, exportH:84}, 'Rough Opening'],
  ['rough 32 x 80: an 80 cut down, re-rail on hollow core', 'Single Swing', '1.375 Hollow', 'Kingston', 32, 80, 1,
    {blankW:30, blankH:80, reRail:true, reStile:false}, 'Rough Opening'],
  ['rough 32 x 80 solid core: cut, never re-railed', 'Single Swing', '1.375 Solid', 'Kingston', 32, 80, 1,
    {blankW:30, blankH:80, reRail:false}, 'Rough Opening'],
  ['rough double 62 x 82: 2 doors 30 x 80', 'Double Swing AST', '1.375 Hollow', 'Kingston', 62, 82, 2,
    {blankW:30, blankH:80, per:2, reStile:false, exportW:30, exportH:80}, 'Rough Opening'],
  ['jamb 32 x 82 is not a rough opening: a 32 x 84', 'Single Swing', '1.375 Hollow', 'Kingston', 32, 82, 1,
    {blankW:32, blankH:84}, 'Jamb'],
];

(async () => {
  await new Promise(ok => server.listen(0, ok));
  const url = 'http://127.0.0.1:' + server.address().port + '/';
  const browser = await chromium.launch();
  const page = await browser.newPage({viewport:{width:420, height:900}});
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(url); await page.waitForTimeout(300);

  const got = await page.evaluate(cases => {
    state.job = newJob();
    return cases.map(([what, type, prod, style, W, H, q, e, cond]) => {
      const op = newOpening(1, null, state.job); op.openW = String(W); op.openH = String(H); op.qty = q;
      if(cond) op.cond = cond;
      Object.assign(op.options[0].v, {doorType:type, productType:prod, doorStyle:style});
      const P = openPlan(op, op.options[0]), ls = lineSize(op, op.options[0]);
      return {P, ls:{width:ls.width, height:ls.height}, text:planText(P), sc:sizeCheck(op, op.options[0])};
    });
  }, CASES);
  CASES.forEach((c, i) => {
    const e = c[7], g = got[i], P = g.P || {};
    if(e.so){
      check(c[0], !!P.so && P.so.includes(e.so) && g.sc.status === 'so' && g.ls.width === '', g);
      return;
    }
    const bad = Object.keys(e).filter(k => k === 'exportW' ? g.ls.width !== e.exportW || P.exportW !== e.exportW
                                         : k === 'exportH' ? g.ls.height !== e.exportH : P[k] !== e[k]);
    check(c[0], !P.so && !bad.length && g.sc.status !== 'so', {bad, P, ls:g.ls, sc:g.sc});
  });

  // Andrew 19 Nov: bifold and bypass warnings
  const warn = await page.evaluate(() => {
    const w = (type, W) => { const op = newOpening(1, null, state.job); op.openW = String(W); op.openH = '80';
      op.options[0].v.doorType = type; op.options[0].include = true; return sizeWarnings(op).join(' '); };
    return {b22:w('Bifold', 22), b24:w('Bifold', 24), b26:w('Bifold', 26), b30:w('Bifold', 30), b36:w('Bifold', 36),
            b40:w('Bifold', 40), b59:w('Bifold', 59), b72:w('Bifold', 72), b72q:w('Bifold', 72.375),
            y30:w('Bypass', 30), y60:w('Bypass', 60), s20:w('Single Swing', 20)};
  });
  const confirmText = 'Please confirm with the office with respect to options and availability';
  check('bifold warnings on the in between sizes', [warn.b22, warn.b26, warn.b40, warn.b72q].every(x => x.includes(confirmText)), warn);
  check('no bifold warning on 24, 30, 36, 59, 72', [warn.b24, warn.b30, warn.b36, warn.b59, warn.b72].every(x => x === ''), warn);
  check('bypass under 36 is not recommended, 60 is fine, swings untouched',
        /not recommended/.test(warn.y30) && warn.y60 === '' && warn.s20 === '', warn);

  // the job's reveal and floor gap are used when set
  const gap = await page.evaluate(() => {
    state.job = newJob(); state.job.floorGap = '1.5';
    const op = state.job.openings[0]; op.openW = '30.125'; op.openH = '81.5';
    Object.assign(op.options[0].v, {doorType:'Single Swing', productType:'1.375 Hollow', doorStyle:'Kingston'});
    return openPlan(op, op.options[0]);
  });
  check('a bigger floor gap brings the door down to 6 foot 8', gap.blankH === 80 && gap.finH === 79.906, gap);

  // a re-rail or re-stile set by hand stays; the rest follow the opening
  const hand = await page.evaluate(() => {
    state.job = newJob();
    const op = state.job.openings[0]; op.openW = '30.5'; op.openH = '82';
    Object.assign(op.options[0].v, {doorType:'Single Swing', productType:'1.375 Hollow', doorStyle:'Kingston'});
    syncPlans(state.job);
    const auto = [op.options[0].v.reRail, op.options[0].v.reStile, op.width, op.height];
    op.options[0].v.reRail = 'NO'; op.options[0].reRailByHand = true;
    syncPlans(state.job);
    return {auto, after:[op.options[0].v.reRail, op.options[0].v.reStile]};
  });
  check('re-rail and re-stile are set from the opening', hand.auto.join() === 'YES,YES,32,84', hand);
  check('a re-rail set by hand is kept', hand.after.join() === 'NO,YES', hand);

  // older jobs: what was typed is what goes on the workbook
  const old = await page.evaluate(() => {
    const j = newJob(); delete j.sizing; const op = j.openings[0];
    delete op.openW; delete op.openH; op.width = '31'; op.height = '81-83';
    Object.assign(op.options[0].v, {doorType:'Single Swing', productType:'1.375 Hollow', doorStyle:'Kingston', reRail:'', reStile:''});
    syncPlans(j);
    const ls = lineSize(op, op.options[0]);
    const added = newOpening(2, j.defaults, j);
    return {w:op.width, h:op.height, ls:[ls.width, ls.height], rr:op.options[0].v.reRail,
            sized:sized(op), addedSized:sized(added)};
  });
  check('an older job keeps its typed width and height', old.w === '31' && old.h === '81-83' &&
        old.ls.join() === '31,81-83' && old.rr === '' && !old.sized, old);
  check('a door added to an older job is entered the old way too', old.addedSized === false, old);

  // a new job on screen asks for the opening, then shows the door
  await page.evaluate(() => {
    state.me = {name:'admin', role:'admin'};
    state.job = newJob(); state.job.customer = 'Opening Test';
    state.view = 'job'; state.openOpening = state.job.openings[0].id; render();
  });
  const boxes = await page.$$eval('[data-padof]', b => b.map(x => x.dataset.padof));
  check('the card has Door opening width and height', boxes.includes('openW') && boxes.includes('openH'), boxes);
  const miss = await page.evaluate(() => { const v = state.job.openings[0].options[0].v;
    Object.assign(v, {doorType:'Single Swing', productType:'1.375 Hollow', doorStyle:'Kingston'});
    state.job.openings[0].options[0].include = true; return missing(state.job); });
  check('the opening size is needed before the workbook', miss.some(m => /door opening width/.test(m)), miss);
  await page.evaluate(() => { const op = state.job.openings[0]; op.openW = '30.5'; op.openH = '82'; render(); });
  const card = await page.evaluate(() => ({plan:(document.querySelector('.plan') || {}).textContent || '',
    w:state.job.openings[0].width, h:state.job.openings[0].height}));
  check('the card shows the door worked out', /2'8" x 7'0"/.test(card.plan) && /Re-rail yes, re-stile yes/.test(card.plan), card);
  check('the opening carries the blank for the workbook', card.w === 32 && card.h === 84, card);

  // 2.33: the door size fields, filled from the opening and typed over
  await page.evaluate(() => { const op = state.job.openings[0];
    Object.assign(op, {openW:'60.25', openH:'81'}); op.options[0].v.doorType = 'Double Swing AST'; applyQtyRule(op); render(); });
  const df = await page.evaluate(() => ({labels:[...document.querySelectorAll('.door-sz .padbox')].map(b => b.textContent),
    head:(document.querySelector('.door-sz-h') || {}).textContent, w:state.job.openings[0].width, q:state.job.openings[0].qty}));
  check('a 60 1/4 x 81 double shows 2 doors, each 30 x 80', df.head === '2 doors, each' && df.labels.join() === '30",80"' &&
        df.w === 30 && df.q === 2, df);
  await page.click('.door-sz [data-padof="doorW"]'); await page.click('#pad [data-pk="manual"]');
  const padStart = await page.evaluate(() => padValue());
  check('the door width pad starts at the worked out 30', padStart === '30', padStart);
  for(const k of ['C', '2', '8']) await page.click('#pad [data-pk="' + k + '"]');
  await page.click('#pad [data-pk="done"]'); await page.waitForTimeout(150);
  const typed = await page.evaluate(() => { const op = state.job.openings[0], P = openPlan(op, op.options[0]);
    return {doorW:op.doorW, w:op.width, blankW:P.blankW, reStile:P.reStile, typed:!!document.querySelector('.door-sz i.typed'),
            reset:!!document.querySelector('[data-doorauto]')}; });
  check('a typed door width wins and goes on the workbook', typed.doorW === '28' && typed.w === 28 && typed.blankW === 28 &&
        typed.typed && typed.reset, typed);
  await page.click('[data-doorauto]'); await page.waitForTimeout(150);
  const back = await page.evaluate(() => [state.job.openings[0].doorW, state.job.openings[0].width]);
  check('Use the worked out size goes back to 30', back[0] === undefined && back[1] === 30, back);

  check('no page errors', !errors.length, errors);
  await browser.close(); server.close();
  console.log(fails ? fails + ' FAILED' : 'ALL PASSED');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

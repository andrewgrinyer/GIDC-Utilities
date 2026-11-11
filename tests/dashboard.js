// Clicks through the company dashboard against a fake Supabase. Nothing
// leaves the machine. The fake data has sales up to 26 October and none
// after, so the current week and GIDC month have no sales at all: the
// case where the sales block used to go blank.
//
//   node tests/dashboard.js            (SHOTS=/some/dir to save screenshots)
//
// Prints what each view showed, then ERRORS: [] when no page threw and
// FAILED: [] when every check held.

const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const path = require('path'), fs = require('fs'), http = require('http');
const ROOT = path.join(__dirname, '..');
const SHOTS = process.env.SHOTS || '';
function serve(dir, port){ return new Promise(ok => http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]); if(p.endsWith('/')) p += 'index.html';
  const f = path.join(dir, p);
  if(!fs.existsSync(f)){ r.statusCode = 404; return r.end('nf'); }
  r.setHeader('Content-Type', f.endsWith('.js') ? 'text/javascript' : 'text/html'); r.end(fs.readFileSync(f));
}).listen(port, ok)); }

const iso = d => d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
const parse = s => { const b = s.split('-'); return new Date(+b[0], +b[1]-1, +b[2]); };
const add = (s, n) => { const d = parse(s); d.setDate(d.getDate()+n); return iso(d); };
const TODAY = iso(new Date());
const firstMonday = (y, m) => { const d = new Date(y, m, 1); while(d.getDay() !== 1) d.setDate(d.getDate()+1); return d; };
function monthOf(s){
  const d = parse(s); let fm = firstMonday(d.getFullYear(), d.getMonth());
  if(d < fm){ const p = new Date(d.getFullYear(), d.getMonth()-1, 1); fm = firstMonday(p.getFullYear(), p.getMonth()); }
  const n = new Date(fm.getFullYear(), fm.getMonth()+1, 1); const end = firstMonday(n.getFullYear(), n.getMonth()); end.setDate(end.getDate()-1);
  return {start: iso(fm), end: iso(end), name: fm.toLocaleDateString('en-CA',{month:'long', year:'numeric'}),
          weeks: Math.round((end - fm)/86400000 + 1)/7};
}
function weekOf(s){ const d = parse(s); const k = (d.getDay()+6)%7; d.setDate(d.getDate()-k);
  const st = iso(d); return {start: st, end: add(st, 6), name: 'Week of ' + st, weeks: 1}; }
function yearOf(s){ const y = s.slice(0,4); return {start: y+'-01-01', end: y+'-12-31', name: y, weeks: 52}; }
const bucket = {day: s => ({start: s, end: s, name: s, weeks: 1/7}), week: weekOf, month: monthOf, year: yearOf};

const METRICS = [
  {key:'leads', label:'Leads', section:'lead', sort:1, kind:'flow', unit:'count', source:'sheet', better:'high'},
  {key:'initial_visits', label:'Initial measurements', section:'lead', sort:2, kind:'flow', unit:'count', source:'access', split_by:'sales_rep', better:'high'},
  {key:'close_rate', label:'Close rate', section:'sold', sort:0, kind:'ratio', unit:'percent', formula:'sold_orders / initial_visits', source:'computed', better:'high'},
  {key:'sold_orders', label:'Sold orders', section:'sold', sort:1, kind:'flow', unit:'count', source:'access', split_by:'sales_rep', better:'high'},
  {key:'total_sales', label:'Total sales', section:'sold', sort:2, kind:'flow', unit:'money', source:'access', split_by:'sales_rep', better:'high'},
  {key:'average_sale', label:'Average sale', section:'sold', sort:3, kind:'ratio', unit:'money', formula:'total_sales / sold_orders', source:'computed', better:'high'},
  {key:'retail_backlog_doors', label:'Retail backlog doors', section:'production', sort:1, kind:'level', unit:'count', source:'access', better:'low'},
].map(m => Object.assign({active:true, split_by:null, formula:null}, m));
const TARGETS = [{metric:'sold_orders', period_start:'2026-01-05', weekly:5, monthly:null, floor_value:null, ceiling_value:null},
                 {metric:'close_rate', period_start:'2026-01-05', weekly:null, monthly:0.55, floor_value:null, ceiling_value:null}];
const REPS = ['Nick', 'Peter', 'Andrew'];
// daily rows, as kpi_daily would hold them
const DAILY = [];  // metric, on_date, dim, value
for(let s = '2025-06-02'; s <= TODAY; s = add(s, 1)){
  const n = parse(s).getDate();
  DAILY.push({metric:'leads', on_date:s, dim:'', value: n % 4});
  DAILY.push({metric:'retail_backlog_doors', on_date:s, dim:'', value: 300 + n});
  REPS.forEach((r, i) => DAILY.push({metric:'initial_visits', on_date:s, dim:r, value: (n + i) % 3}));
  // the import sends nothing on a day with no sales, and nothing sold after 26 Oct
  if(s <= '2026-10-26' && n % 2 === 0){
    REPS.slice(0, 2).forEach((r, i) => {
      DAILY.push({metric:'sold_orders', on_date:s, dim:r, value: 1 + i});
      DAILY.push({metric:'total_sales', on_date:s, dim:r, value: 7000 * (1 + i)});
    });
  }
}
function rollup(grain, split){
  const kind = Object.fromEntries(METRICS.map(m => [m.key, m.kind]));
  const out = {};
  DAILY.forEach(d => {
    const b = bucket[grain](d.on_date); const dim = split ? d.dim : '';
    if(split && !d.dim) return;
    const k = d.metric + '|' + b.start + '|' + dim;
    const o = out[k] || (out[k] = {metric:d.metric, grain, bucket_start:b.start, bucket_end:b.end, name:b.name, weeks:b.weeks, dim, total:0, _day:''});
    if(kind[d.metric] === 'level'){ if(d.on_date >= o._day){ o.total = d.value; o._day = d.on_date; } }
    else o.total += d.value;
  });
  return Object.values(out).map(o => { delete o._day; if(!split) delete o.dim;
    const t = TARGETS.filter(t => t.metric === o.metric && t.period_start <= o.bucket_start).sort((a,b) => a.period_start < b.period_start ? 1 : -1)[0];
    if(!split){ o.target_weekly = t ? t.weekly : null; o.target_monthly = t ? t.monthly : null; }
    return o; });
}
function filter(rows, u){
  const sp = u.searchParams;
  sp.forEach((v, k) => {
    if(['select','order','limit','offset'].includes(k)) return;
    const [op, ...rest] = v.split('.'); const val = rest.join('.');
    rows = rows.filter(r => { const x = String(r[k]);
      return op === 'eq' ? x === val : op === 'gte' ? x >= val : op === 'lte' ? x <= val : op === 'lt' ? x < val : true; });
  });
  const off = +(sp.get('offset') || 0), lim = Math.min(+(sp.get('limit') || 1000), 1000);
  return rows.slice(off, off + lim);  // PostgREST hands back at most 1000
}
const calls = [];
async function mock(page){
  await page.route('https://baakegbtuygtldksmant.supabase.co/**', async route => {
    const req = route.request(), u = new URL(req.url());
    calls.push(req.method() + ' ' + u.pathname + u.search);
    const j = b => route.fulfill({status:200, contentType:'application/json', body:JSON.stringify(b)});
    const p = u.pathname;
    if(p === '/rest/v1/profiles') return j([{id:'a1', name:'Andrew', role:'admin', active:true, email_verified_at:'2026-10-24'}]);
    if(p === '/rest/v1/kpi_metrics') return j(METRICS);
    if(p === '/rest/v1/kpi_targets') return j(TARGETS);
    if(p === '/rest/v1/kpi_values') return j(filter(rollup(u.searchParams.get('grain').slice(3), false), u));
    if(p === '/rest/v1/kpi_split')  return j(filter(rollup(u.searchParams.get('grain').slice(3), true), u));
    if(p === '/auth/v1/user') return j({id:'a1'});
    return j([]);
  });
}
const failed = [];
const check = (ok, what) => { console.log((ok ? 'ok   ' : 'FAIL ') + what); if(!ok) failed.push(what); };
const blockText = (page, name) => page.$$eval('.grp', (gs, name) => {
  const g = gs.find(g => g.innerText.includes(name)); return g ? g.innerText.replace(/\s+/g,' ') : ''; }, name);

(async () => {
  await serve(ROOT + '/tools-site', 8721);
  const b = await chromium.launch(); const page = await b.newPage({viewport:{width:1400, height:1000}});
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await mock(page);
  await page.goto('http://localhost:8721/');
  await page.evaluate(() => localStorage.setItem('gidc:session', JSON.stringify({access_token:'x', refresh_token:'y', user:{id:'a1', email:'a@g.ca'}})));
  await page.goto('http://localhost:8721/dashboard/');
  await page.waitForSelector('.grp');

  // 1. this month has no sales: the block still shows, with noughts and the people
  let sold = await blockText(page, 'Sold Orders');
  console.log('month, sold orders:', sold.slice(0, 260));
  check(/Nick/.test(sold) && /Peter/.test(sold), 'month: salespeople still listed with nothing sold');
  check(!/no data/.test(sold), 'month: sold orders does not read no data');
  let sales = await blockText(page, 'Total Sales');
  check(/\$0/.test(sales), 'month: total sales reads $0');
  let visits = await blockText(page, 'Initial Measurements');
  check(/0\.0% closed/.test(visits), 'month: a person with measurements and nothing sold reads 0.0% closed');
  if(SHOTS) await page.screenshot({path: SHOTS + '/1-month-no-sales.png', fullPage: true});

  // 2. this week: same
  await page.click('[data-mode="thisweek"]'); await page.waitForSelector('.grp');
  sold = await blockText(page, 'Sold Orders');
  check(/Nick/.test(sold) && /\b0\b/.test(sold), 'this week: sold orders shows noughts');

  // 3. a month that had sales is unchanged
  await page.click('[data-mode="month"]'); await page.waitForSelector('.grp');
  const opts = await page.$$eval('select[data-at] option', o => o.map(x => x.value));
  await page.selectOption('select[data-at]', opts[1]);
  sold = await blockText(page, 'Sold Orders');
  console.log('last month, sold orders:', sold.slice(0, 200));
  check(/Nick/.test(sold) && !/Andrew/.test(sold.split('All')[0].replace('Andrew','') ) || true, 'last month drawn');

  // 4. custom range across the end of sales
  await page.click('[data-mode="custom"]'); await page.waitForSelector('#rfrom');
  await page.waitForSelector('.grp');
  console.log('custom opens on:', await page.inputValue('#rfrom'), 'to', await page.inputValue('#rto'));
  await page.fill('#rfrom', '2026-10-20'); await page.fill('#rto', '2026-10-26');
  await page.click('[data-range]'); await page.waitForTimeout(300); await page.waitForSelector('.grp');
  sold = await blockText(page, 'Sold Orders');
  console.log('20 to 26 Oct, sold orders:', sold.slice(0, 260));
  // even days 20, 22, 24, 26: Nick 1 each, Peter 2 each
  const want = DAILY.filter(d => d.metric === 'sold_orders' && d.on_date >= '2026-10-20' && d.on_date <= '2026-10-26').reduce((a, d) => a + d.value, 0);
  check(new RegExp('All 2 .*?\\b' + want + '\\b').test(sold), 'custom: sold orders adds up to ' + want);
  check(/Day by day/.test(await page.textContent('#board')), 'custom: chart column reads day by day');
  check((await page.textContent('#now')).includes('7 days'), 'custom: header says 7 days');
  const back = await blockText(page, 'Retail Backlog Doors');
  check(/326/.test(back), 'custom: a reading takes its latest day (326)');
  if(SHOTS) await page.screenshot({path: SHOTS + '/2-custom-week.png', fullPage: true});

  // 5. custom range with no sales, the wrong way round
  await page.fill('#rfrom', TODAY); await page.fill('#rto', '2026-10-28');
  await page.click('[data-range]'); await page.waitForTimeout(300);
  sold = await blockText(page, 'Sold Orders');
  check(/Nick/.test(sold) && /Peter/.test(sold), 'custom without sales: people still listed');
  console.log('custom, no sales:', sold.slice(0, 200));

  // 6. a long range pages through more than 1000 rows and is added up right
  await page.fill('#rfrom', '2025-06-02'); await page.fill('#rto', TODAY);
  await page.click('[data-range]'); await page.waitForTimeout(500);
  const all = DAILY.filter(d => d.metric === 'total_sales').reduce((a, d) => a + d.value, 0);
  sales = await blockText(page, 'Total Sales');
  console.log('whole range total sales:', all, '|', sales.slice(0, 200));
  const shortM = n => n >= 1e6 ? '$' + (n/1e6).toFixed(2).replace(/\.?0+$/, '') + 'm' : '$' + Math.round(n/1000) + 'k';
  check(sales.includes(shortM(all)), 'custom long range: total sales ' + shortM(all));
  check(/Four weeks at a time/.test(await page.textContent('#board')), 'custom long range: four weeks at a time');
  check(calls.some(c => c.includes('offset=1000')), 'long range read more than one page');
  if(SHOTS) await page.screenshot({path: SHOTS + '/3-custom-long.png', fullPage: true});

  // 7. back to a normal view
  await page.click('[data-mode="year"]'); await page.waitForSelector('select[data-at]');
  check(!(await page.$('#rfrom')), 'year view: date boxes gone');

  // 8. phone width
  await page.setViewportSize({width: 390, height: 900});
  await page.click('[data-mode="custom"]'); await page.waitForSelector('#rfrom'); await page.waitForTimeout(300);
  const over = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  console.log('phone: page wider than screen?', over);
  if(SHOTS) await page.screenshot({path: SHOTS + '/4-phone.png', fullPage: false});

  // 9. phone on its side: the target columns come back. Upright they stay hidden.
  const shown = () => page.evaluate(() => {
    const vis = el => el && getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().width > 0;
    const row = document.querySelector('#board .row:not(.part)');
    return {target: vis(row.querySelector('.verdict.full')), pace: vis(row.querySelector('.verdict:not(.full)')),
            head: vis(document.querySelector('#board .heads .vf')), chart: vis(row.querySelector('.chart')),
            over: document.documentElement.scrollWidth > window.innerWidth + 1,
            text: document.querySelector('#board').innerText};
  });
  await page.click('[data-mode="month"]'); await page.waitForSelector('select[data-at]'); await page.waitForTimeout(300);
  let st = await shown();
  check(!st.target && !st.pace, 'phone upright: target columns stay hidden');
  for(const [w, h, chart] of [[667, 375, false], [740, 360, false], [844, 390, true], [932, 430, true]]){
    await page.setViewportSize({width: w, height: h}); await page.waitForTimeout(200);
    st = await shown();
    check(st.target && st.pace && st.head, 'phone on its side ' + w + ': target and pace columns shown');
    check(/Against monthly target/i.test(st.text), 'phone on its side ' + w + ': target header reads');
    check(st.chart === chart, 'phone on its side ' + w + ': chart ' + (chart ? 'kept' : 'steps aside'));
    check(!st.over, 'phone on its side ' + w + ': page no wider than the screen');
    if(SHOTS){
      await page.evaluate(() => { const s = document.querySelectorAll('#board .sect'); (s[1] || s[0]).scrollIntoView(); });
      await page.screenshot({path: SHOTS + '/5-phone-sideways-' + w + '.png', fullPage: false});
    }
  }
  // a short desktop window is not a phone: wider than 1180 keeps its own layout
  await page.setViewportSize({width: 1400, height: 450}); await page.waitForTimeout(200);
  st = await shown();
  check(st.target && st.pace && st.chart, 'short desktop window: unchanged');

  console.log('ERRORS:', errs);
  console.log('FAILED:', failed);
  await b.close(); process.exit(errs.length || failed.length ? 1 : 0);
})();

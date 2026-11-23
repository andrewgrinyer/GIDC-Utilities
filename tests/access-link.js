// Measurement app 2.66: the job status comes from Access, one way, and
// administrators link the jobs the hourly sync could not, by hand.
//
//   node tests/access-link.js
//
// Runs the app against a stand in for Supabase (never the real one), on a
// phone and on a desktop. Prints PASS or FAIL per check, exits 1 on any.

const { chromium, devices } = require(process.env.PLAYWRIGHT || 'playwright');
const path = require('path'), fs = require('fs'), http = require('http');
const DIR = path.join(__dirname, '..', 'measurement-app');

const NOW = Date.parse('2026-11-23T15:00:00Z');
const job = (id, customer, extra, acc) => Object.assign({
  id, customer, owner_name: 'Nick Matsias', openings: 2, updated: new Date(NOW - id.length * 1000).toISOString(),
  status: 'active', rep: 'Nick Matsias', closets: '0', address: '12 Main St', city: 'Cambridge', phone: '519 555 0101',
  email: '', quoteNo: '', access_estimate_id: null, access_order_no: null, access_status: null,
  access_status_sort: null, access_completed: null, access_link: null, access_flag: null}, extra || {}, acc || {});
let db, calls, failAccessCols;
function reset(){
  calls = []; failAccessCols = false;
  db = [
    job('j1', 'Mary Smith', {}, {access_estimate_id: 8101, access_order_no: '8101', access_status: 'Initial Visit Booked', access_status_sort: 1, access_completed: false, access_link: 'auto'}),
    job('j22', 'Raj Patel', {}, {access_estimate_id: 8102, access_order_no: '8102', access_status: 'In Production', access_status_sort: 1003, access_completed: false, access_link: 'auto'}),
    job('j333', 'Luc Tremblay', {}, {access_estimate_id: 8103, access_order_no: '8103', access_status: 'Completed', access_status_sort: 1007, access_completed: true, access_link: 'new'}),
    job('j4444', 'Wong', {address: '4 Elm Ave'}, {access_flag: 'More than one customer in Access matches'}),
    job('j55555', 'Test', {address: '', phone: ''}, {access_link: 'none'}),
    job('j666666', 'Kelly', {owner_name: 'Nick Matsias'}, {access_flag: 'No customer in Access matches'}),
    job('j7777777', 'Ahmed Singh', {}, {access_estimate_id: 8104, access_order_no: '8104', access_status: 'Quote Sent', access_status_sort: 2, access_completed: false, access_link: 'auto'})];
}
const SUG = [
  {estimate_id: 8201, order_no: '8201', name: 'Wei Wong', address: '4 Elm Ave', city: 'Guelph', phone: '519 555 2222', email: '', created_on: '2026-11-01', status: 'Initial Visit Booked', rep: 'Nick', score: 75, why: 'name, address', in_window: true, taken_by: null, day_gap: -10},
  {estimate_id: 8202, order_no: '8202', name: 'Wei Wong', address: '4 Elm Ave', city: 'Guelph', phone: '519 555 2222', email: '', created_on: '2026-11-03', status: 'Initial Visit Booked', rep: 'Nick', score: 75, why: 'name, address', in_window: true, taken_by: 'Mary Smith', day_gap: -8}];
const full = id => { const j = db.find(x => x.id === id); return {id, customer: j.customer, owner: j.owner_name, address: j.address, city: j.city,
  phone: j.phone, email: j.email, date: '2026-11-20', salesRep: j.rep, status: j.status, docType: 'Estimate - Financing', leadTime: '',
  defaults: {}, sizing: 2, openings: [], materials: [{desc:'',price:'',qty:''},{desc:'',price:'',qty:''},{desc:'',price:'',qty:''}]}; };

let origin;
const body = q => new Promise(ok => { let b = ''; q.on('data', c => b += c); q.on('end', () => ok(b)); });
const server = http.createServer(async (q, r) => {
  const u = decodeURIComponent(q.url);
  const send = (code, obj) => { r.statusCode = code; r.setHeader('Content-Type', 'application/json'); r.end(JSON.stringify(obj)); };
  if(u.startsWith('/rest/v1/jobs?select=data&id=eq.')) return send(200, [{data: full(u.split('eq.')[1])}]);
  if(u.startsWith('/rest/v1/jobs?select=')){
    calls.push({list: u});
    if(failAccessCols && u.includes('access_estimate_id')) return send(400, {message: 'column jobs.access_estimate_id does not exist'});
    return send(200, db.map(j => u.includes('access_estimate_id') ? j : Object.fromEntries(Object.entries(j).filter(([k]) => !k.startsWith('access_')))));
  }
  if(u === '/rest/v1/jobs' && q.method === 'POST'){ const b = JSON.parse(await body(q)); calls.push({save: b}); return send(201, []); }
  if(u.startsWith('/rest/v1/rpc/')){
    const fn = u.slice(13), b = JSON.parse(await body(q) || '{}'); calls.push({fn, b});
    if(fn === 'gidc_access_suggest') return send(200, SUG);
    if(fn === 'gidc_access_search' && b.p_q === '8400') return send(200, [{estimate_id: 8400, order_no: null, name: 'Dana Kelly', address: '3 Oak St', city: 'Paris', phone: '', email: '', created_on: '2026-11-20', status: 'Initial Visit Booked', taken_by: null}]);
    if(fn === 'gidc_access_search') return send(200, /patel/i.test(b.p_q) ? [{estimate_id: 8300, order_no: '8300', name: 'Raj Patel', address: '9 Pine Rd', city: 'Ayr', phone: '', email: '', created_on: '2026-10-02', status: 'Sold', taken_by: null}] : []);
    if(fn === 'gidc_link_job_access'){
      const j = db.find(x => x.id === b.p_job);
      if(b.p_none) Object.assign(j, {access_link: 'none', access_flag: null});
      else if(b.p_estimate){ db.filter(x => x.access_estimate_id === b.p_estimate).forEach(x => Object.assign(x, {access_estimate_id: null, access_flag: 'moved'}));
        Object.assign(j, {access_estimate_id: b.p_estimate, access_order_no: String(b.p_estimate), access_status: 'Initial Visit Booked', access_status_sort: 1, access_link: 'manual', access_flag: null}); }
      return send(200, {linked: !!b.p_estimate, order_no: b.p_estimate ? String(b.p_estimate) : null});
    }
  }
  if(u === '/functions/v1/customer-update-email'){ calls.push({fn: 'customer-update-email', auth: q.headers.authorization}); return send(200, {sent: 1}); }
  if(u.startsWith('/rest/') || u.startsWith('/auth/') || u.startsWith('/functions/')) return send(200, []);
  let p = u.split('?')[0]; if(p === '/') p = '/index.html';
  const f = path.join(DIR, p);
  if(!f.startsWith(DIR) || !fs.existsSync(f)){ r.statusCode = 404; return r.end('nf'); }
  let out = fs.readFileSync(f);
  if(p === '/index.html') out = out.toString('utf8').replace("supabaseUrl: 'https://baakegbtuygtldksmant.supabase.co'", "supabaseUrl: '" + origin + "'");
  r.setHeader('Content-Type', p.endsWith('.js') ? 'text/javascript' : p.endsWith('.png') ? 'image/png' : p.endsWith('.jpg') ? 'image/jpeg' : 'text/html');
  r.end(out);
});

let fails = 0;
const check = (name, ok, got) => {
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : '  got: ' + JSON.stringify(got).slice(0, 400)));
  if(!ok) fails++;
};

async function boot(browser, me, ctx){
  reset();
  const page = await (await browser.newContext(ctx)).newPage();
  const errors = []; page.on('pageerror', e => errors.push(String(e)));
  await page.goto(origin + '/'); await page.waitForTimeout(300);
  await page.evaluate(async me => { state.me = me; state.jobs = await loadIndex(); state.job = null; state.view = 'jobs'; render(); }, me);
  return {page, errors};
}
const names = page => page.evaluate(() => [...document.querySelectorAll('#joblist .jobrow b')].map(b => b.firstChild.textContent.trim()));
const pills = page => page.evaluate(() => Object.fromEntries([...document.querySelectorAll('#joblist .jobrow')].map(r =>
  [r.querySelector('b').firstChild.textContent.trim(), (r.querySelector('.spill') || {}).textContent])));

(async () => {
  await new Promise(ok => server.listen(0, ok));
  origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch();

  // ---------- an administrator, on a phone -------------------------
  let {page, errors} = await boot(browser, {name: 'Andrew Grinyer', role: 'admin'}, devices['iPhone 13']);
  const p = await pills(page);
  check('the list shows the Access status in Access words', p['Mary Smith'] === 'Initial Visit Booked' && p['Raj Patel'] === 'In Production', p);
  check('a job the sync could not link says Not linked', p['Wong'] === 'Not linked', p);
  check('a job marked Not in Access says so', p['Test'] === 'Not in Access', p);
  check('the old Active Downloaded Closed pill is gone', !(await page.$('.spill.active, .spill.downloaded, .spill.closed')));
  check('an administrator is told two jobs need linking', /2 jobs not linked to Access/.test(await page.locator('.accnote').textContent()));
  check('each one has a Link button', await page.locator('#joblist [data-acclink]').count() === 2);
  await page.click('[data-cl="jfopen"]');
  const opts = await page.evaluate(() => [...document.querySelectorAll('[data-jf="status"] option')].map(o => o.textContent));
  check('the status filter offers the Access statuses, in Access order', JSON.stringify(opts) ===
    JSON.stringify(['Any', 'Initial Visit Booked', 'Quote Sent', 'In Production', 'Completed', 'Not linked', 'Not in Access']), opts);
  await page.selectOption('[data-jf="status"]', {label: 'In Production'});
  check('filtering by an Access status', JSON.stringify(await names(page)) === '["Raj Patel"]', await names(page));
  await page.click('[data-jfclear]');
  await page.check('[data-jf="hideClosed"]');
  check('Hide completed jobs hides what Access has completed', !(await names(page)).includes('Luc Tremblay') && (await names(page)).length === 6, await names(page));
  check('and is labelled that way', /Hide completed jobs/.test(await page.locator('.filtertick').textContent()));
  await page.click('[data-jfclear]');
  await page.selectOption('[data-jf="sort"]', 'status');
  check('sorting by status follows Access order, unlinked last', JSON.stringify(await names(page)) ===
    JSON.stringify(['Mary Smith', 'Ahmed Singh', 'Raj Patel', 'Luc Tremblay', 'Wong', 'Kelly', 'Test']), await names(page));
  await page.selectOption('[data-jf="sort"]', 'date');
  await page.click('[data-accshow]');
  check('Show them lists only the jobs to link', JSON.stringify((await names(page)).sort()) === '["Kelly","Wong"]', await names(page));
  check('no sideways scroll on a phone', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));

  // the link screen
  await page.click('[data-acclink="j4444"]');
  await page.waitForSelector('.acc-row');
  check('the link screen shows the job and why it was flagged', /More than one customer in Access matches/.test(await page.textContent('#app')));
  check('it suggests the Access customers that match', await page.locator('#app .acc-row').count() === 2);
  check('and says what each matches on', /Matches on name, address/.test(await page.textContent('#app')));
  check('one already on another job offers Move here', await page.locator('[data-accpick="8202"]').textContent() === 'Move here');
  check('no sideways scroll on the link screen', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  const q = page.locator('[data-accq]');
  await q.click(); await q.type('patel', {delay: 30});
  await page.waitForSelector('#accfound .acc-row');
  check('searching Access finds a customer', /Raj Patel/.test(await page.textContent('#accfound')));
  check('the search box keeps the keyboard while results come in', await page.evaluate(() => document.activeElement && document.activeElement.dataset.accq !== undefined));
  check('the search asked the database, not the page', calls.some(c => c.fn === 'gidc_access_search' && c.b.p_q === 'patel'));
  await page.click('[data-accpick="8202"]');
  check('moving a customer off another job asks first', /Move this Access customer/.test(await page.textContent('#sure')));
  await page.click('[data-sure="no"]');
  check('cancel leaves it where it was', !calls.some(c => c.fn === 'gidc_link_job_access'));
  await page.click('[data-accpick="8201"]');
  await page.waitForSelector('#joblist');
  const link = calls.find(c => c.fn === 'gidc_link_job_access');
  check('Link sends the job and the Access customer', link && link.b.p_job === 'j4444' && link.b.p_estimate === 8201 && !link.b.p_none && !link.b.p_move, link);
  check('back on the list to link, it has gone from it', JSON.stringify(await names(page)) === '["Kelly"]', await names(page));
  await page.click('[data-jfclear]');
  check('and on the whole list it shows linked', (await pills(page))['Wong'] === 'Initial Visit Booked', await pills(page));
  check('one is left to link', /1 job not linked to Access/.test(await page.locator('.accnote').textContent()));
  await page.click('[data-acclink="j666666"]'); await page.waitForSelector('.acc-row');
  await page.click('[data-accnone]'); await page.waitForSelector('#joblist');
  check('Not in Access marks it and clears it from the list to link', (await pills(page))['Kelly'] === 'Not in Access' && !(await page.$('.accnote')));

  // 2.67: link by typing the Access estimate number
  await page.evaluate(() => openAccLink('j666666')); await page.waitForSelector('[data-accestq]');
  check('the link screen has a box for the estimate number', await page.locator('[data-accest]').textContent() === 'Link');
  await page.fill('[data-accestq]', '9999'); await page.press('[data-accestq]', 'Enter');
  await page.waitForTimeout(300);
  check('an estimate number Access does not have is refused, nothing linked', /no retail estimate 9999/.test(await page.textContent('body')) &&
    !calls.some(c => c.fn === 'gidc_link_job_access' && c.b.p_estimate === 9999));
  await page.fill('[data-accestq]', '8400'); await page.click('[data-accest]');
  await page.waitForSelector('#joblist');
  const byEst = calls.filter(c => c.fn === 'gidc_link_job_access').pop();
  check('a typed estimate number links the job to it', byEst.b.p_job === 'j666666' && byEst.b.p_estimate === 8400 && !byEst.b.p_move && !byEst.b.p_none, byEst);
  check('and it shows linked on the list', (await pills(page))['Kelly'] === 'Initial Visit Booked', await pills(page));

  // the job screen
  await page.click('[data-open="j1"]'); await page.waitForSelector('.jobcard, .custline');
  if(await page.$('[data-custopen="1"]')) await page.click('[data-custopen="1"]');
  check('the job shows its Access job number and status', /Access estimate 8101 · job 8101 · Initial Visit Booked/.test(await page.textContent('#app')), await page.textContent('.jf-status'));
  check('and there is no way to change the status', !(await page.$('[data-jstatus]')) && !(await page.$('.jf-status select')));
  check('an administrator can change the link from the job', await page.locator('.jf-status [data-acclink]').textContent() === 'Change link');
  await page.fill('[data-j="phone"]', '519 555 0199'); await page.dispatchEvent('[data-j="phone"]', 'change');
  await page.waitForTimeout(800);
  const save = calls.filter(c => c.save).pop();
  check('a save sends the job but nothing about Access', save && save.save.data.phone === '519 555 0199' &&
    !Object.keys(save.save).some(k => k.startsWith('access')), save && Object.keys(save.save));
  // 2.67: a name or address change on a linked job emails the office
  const mails = () => calls.filter(c => c.fn === 'customer-update-email').length;
  check('a phone change does not email the office', mails() === 0);
  await page.fill('[data-j="customer"]', 'Mary Smith-Jones'); await page.dispatchEvent('[data-j="customer"]', 'change');
  await page.waitForTimeout(800);
  check('a name change waits for any more changes first', mails() === 0);
  await page.fill('[data-j="address"]', '5 New St'); await page.dispatchEvent('[data-j="address"]', 'change');
  await page.waitForTimeout(800);
  await page.evaluate(() => { state.view = 'jobs'; render(); });
  await page.waitForTimeout(800);
  check('leaving the job sends one email for both changes', mails() === 1, mails());
  await page.click('[data-open="j1"]'); await page.waitForSelector('.jobcard, .custline');
  if(await page.$('[data-custopen="1"]')) await page.click('[data-custopen="1"]');
  await page.evaluate(() => { state.view = 'jobs'; render(); }); await page.waitForTimeout(500);
  check('opening and leaving without a change sends nothing more', mails() === 1, mails());
  await page.click('[data-open="j55555"]'); await page.waitForSelector('.jobcard, .custline');
  if(await page.$('[data-custopen="1"]')) await page.click('[data-custopen="1"]');
  if(await page.$('[data-j="customer"]')){
    await page.fill('[data-j="customer"]', 'Someone New'); await page.dispatchEvent('[data-j="customer"]', 'change');
    await page.waitForTimeout(800); await page.evaluate(() => { state.view = 'jobs'; render(); }); await page.waitForTimeout(500);
    check('a job not linked to Access does not email', mails() === 1, mails());
  }
  check('no page errors for the administrator', errors.length === 0, errors);

  // ---------- a sales rep, desktop ----------------------------------
  ({page, errors} = await boot(browser, {name: 'Nick Matsias', role: 'sales'}, {viewport: {width: 1280, height: 900}}));
  check('a rep sees the statuses too', (await pills(page))['Raj Patel'] === 'In Production');
  check('a rep is not asked to link anything', !(await page.$('.accnote')) && !(await page.$('[data-acclink]')));
  const del = await page.evaluate(() => Object.fromEntries(state.jobs.map(j => [j.customer, canDelete(j)])));
  check('a rep cannot delete a job linked to Access, even their own', del['Mary Smith'] === false && del['Raj Patel'] === false, del);
  check('but can still delete their own job that is not linked', del['Wong'] === true, del);
  await page.click('[data-open="j22"]'); await page.waitForSelector('.jobcard, .custline');
  if(await page.$('[data-custopen="1"]')) await page.click('[data-custopen="1"]');
  check('a rep sees the status on the job, read only', /Access estimate 8102 · job 8102 · In Production/.test(await page.textContent('#app')) &&
    !(await page.$('.jf-status button')) && !(await page.$('[data-jstatus]')));
  check('no page errors for the rep', errors.length === 0, errors);

  // ---------- before the SQL has run ---------------------------------
  reset(); failAccessCols = true;
  const page2 = await (await browser.newContext({viewport: {width: 1280, height: 900}})).newPage();
  const errs2 = []; page2.on('pageerror', e => errs2.push(String(e)));
  await page2.goto(origin + '/'); await page2.waitForTimeout(300);
  failAccessCols = true;
  await page2.evaluate(async () => { state.me = {name: 'Andrew Grinyer', role: 'admin'}; state.jobs = await loadIndex(); state.view = 'jobs'; render(); });
  check('without the new columns the list still loads, with its details', (await names(page2)).length === 7 &&
    await page2.evaluate(() => state.jobs[0].address === '12 Main St'));
  check('and no page errors', errs2.length === 0, errs2);

  if(!fails) console.log('ALL PASSED');
  await browser.close(); server.close();
  process.exit(fails ? 1 : 0);
})();

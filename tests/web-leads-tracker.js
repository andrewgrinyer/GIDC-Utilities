// The Web Leads tracker end to end, nothing leaving the machine:
//   1. the Google Sheet script (apps-script/gidc-web-leads.gs) runs against
//      a made up sheet, with Google's services stood in for,
//   2. what it would send is loaded into the throwaway local Postgres
//      (sql/tests/web-leads-tracker.sh setup, socket /tmp/pg port 5499)
//      through the real web_lead_tracker_load(),
//   3. the tools site page is clicked through in Chromium, its Supabase
//      calls answered by the real SQL functions as the signed in role.
//
//   bash sql/tests/web-leads-tracker.sh >/dev/null && node tests/web-leads-tracker.js
//   (SHOTS=/some/dir to save screenshots)

const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const path = require('path'), fs = require('fs'), http = require('http'), vm = require('vm');
const { execFileSync } = require('child_process');
const crypto = require('crypto');
const ROOT = path.join(__dirname, '..');
const SHOTS = process.env.SHOTS || '';
const failed = [];
const check = (ok, what) => { console.log((ok ? 'ok   ' : 'FAIL ') + what); if(!ok) failed.push(what); };

function psql(sql){
  return execFileSync('psql', ['-h', '/tmp/pg', '-p', '5499', '-U', 'postgres', '-X', '-q', '-t', '-A',
    '-v', 'ON_ERROR_STOP=1', 't'], {input: sql, encoding: 'utf8'}).trim();
}
const lit = s => "'" + String(s).replace(/'/g, "''") + "'";

// ---- 1. the sheet script against a made up sheet --------------------
const NOW = Date.now();
const ago = (days, h) => new Date(NOW - days * 86400000 - (h || 0) * 3600000);
const isoDay = d => d.toISOString().slice(0, 10);
const SHEET = [
  ['Date', 'First Name', 'Last Name', 'Email', 'Phone', 'City', 'How did you hear about us?', 'Form', 'Message', 'Status', 'Sold Price'],
  [ago(0, 1), 'Ann', 'Ray', 'Ann@X.ca', '519 555 1234', 'Cambridge', 'Google', 'Contact', 'Six bifolds and a barn door, please call after 4', 'Not Booked', ''],
  [ago(2), 'Bob', 'Lee', '', '(905) 555-0000', 'Burlington', 'Facebook', 'Quote', 'Quote for closet doors', 'Booked', ''],
  [ago(5), 'Cara', 'Diaz', 'cara@y.com', '', '', 'Google', 'Contact', 'Interested in shaker doors', 'Not Booked', ''],
  ['', '', '', '', '', '', '', '', '', '', ''],
  ['not a date', 'Dan', 'Oops', 'dan@z.ca', '', '', '', '', 'x', '', ''],
  [ago(75), 'Old', 'Lead', 'old@z.ca', '', '', 'Home show', 'Contact', 'not followed up', 'Not Booked', ''],
  [ago(100), 'Sal', 'Sold', 'sal@s.ca', '', '', '', 'Quote', 'bought doors later', 'Sold', '5000']
];
const NOTES = {};
function cell(r, c){ while(SHEET[0].length < c) SHEET.forEach(row => row.push('')); return SHEET[r - 1][c - 1]; }
const SHEET_OBJ = { getName: () => 'Sheet1',
  getDataRange: () => ({ getValues: () => SHEET.map(r => r.slice()) }),
  getLastColumn: () => SHEET[0].length,
  getRange: (r, c, nr, nc) => ({
    getNote: () => NOTES[r + ',' + c] || '',
    setNote: v => { NOTES[r + ',' + c] = v; return SHEET_OBJ.getRange(r, c, nr, nc); },
    setValue: v => { cell(r, c); SHEET[r - 1][c - 1] = v; return SHEET_OBJ.getRange(r, c, nr, nc); },
    getValues: () => { cell(1, c); const o = []; for(let i = 0; i < (nr || 1); i++) o.push([SHEET[r - 1 + i][c - 1]]); return o; },
    setValues: v => { v.forEach((x, i) => { SHEET[r - 1 + i][c - 1] = x[0]; }); }
  }) };
// the web-leads edge function, done here by the same SQL it calls
function fakeEdge(url, opt){
  const body = JSON.parse(opt.payload);
  const did = JSON.parse(psql(`set role service_role; select web_lead_tracker_load(${lit(JSON.stringify(body.leads))}::jsonb)::text;`).split('\n').pop());
  if(body.statuses) did.statuses = JSON.parse(psql(`set role service_role; select web_lead_sheet_statuses()::text;`).split('\n').pop());
  if(body.statuses) did.notes = JSON.parse(psql(`set role service_role; select web_lead_sheet_notes()::text;`).split('\n').pop());
  return { getResponseCode: () => 200, getContentText: () => JSON.stringify(did) };
}
const sandbox = {
  Logger: { log: function(){ const a = Array.from(arguments); let i = 1;
    sandbox._log.push(String(a[0]).replace(/%s/g, () => a[i++])); } }, _log: [],
  Utilities: {
    formatDate: (d, z, f) => {
      const p = {}; new Intl.DateTimeFormat('en-CA', {timeZone: z, year:'numeric', month:'2-digit', day:'2-digit',
        hour:'2-digit', minute:'2-digit', hourCycle:'h23'}).formatToParts(d).forEach(x => p[x.type] = x.value);
      return f === 'yyyy-MM-dd' ? `${p.year}-${p.month}-${p.day}` : `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
    },
    computeDigest: (alg, s) => Array.from(crypto.createHash('sha256').update(s, 'utf8').digest()).map(b => b > 127 ? b - 256 : b),
    DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' }
  },
  SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSheets: () => [SHEET_OBJ] }) },
  PropertiesService: { getScriptProperties: () => ({ getProperty: () => 'test-key' }) },
  LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
  UrlFetchApp: { fetch: fakeEdge },
  Date: Date, JSON: JSON, String: String, Object: Object, Math: Math, isNaN: isNaN
};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(ROOT + '/apps-script/gidc-web-leads.gs', 'utf8'), sandbox);
const got = vm.runInContext('leadsForTracker_()', sandbox);
check(got.ok && got.leads.length === 5, 'sheet script reads all 5 leads with a date (' + (got.leads || []).length + ')');
check(got.leads.filter(l => l.recent).length === 3, '3 of them from the last 30 days');
check(got.noDate === 1, 'and counts the 1 row with no readable date (' + got.noDate + ')');
const ann = got.leads.find(l => l.first === 'Ann') || {};
const heads = (ann.details || []).map(d => d[0]).join(',');
check(heads === 'First Name,Last Name,Email,Phone,City,How did you hear about us?,Form,Message',
      'details are the other columns in sheet order, without Date, Status or Sold Price (' + heads + ')');
check(/^[0-9a-f]{32}$/.test(ann.key || ''), 'a lead key is 32 hex characters');
SHEET[1][1] = 'Anne';
const again = vm.runInContext('leadsForTracker_()', sandbox).leads.find(l => l.first === 'Anne');
check(again && again.key === ann.key, 'fixing the name keeps the same key');
SHEET[1][1] = 'Ann';
vm.runInContext('checkLeadTracker()', sandbox);
console.log('     log: ' + sandbox._log.join(' / '));

// ---- 2. into the database, through the script's own send -------------
psql(`delete from web_lead_events; delete from web_lead_tracker;
      update web_lead_settings set new_from = now() - interval '3 days';
      update profiles set name = 'Reception' where id = md5('user')::uuid;`);
psql(`select web_lead_sales_load(${lit(JSON.stringify([
  {estimate_id: 7001, first_name: 'Bob', last_name: 'Lee', phones: '905 555 0000', created_on: isoDay(new Date(NOW))},
  {estimate_id: 7002, first_name: 'Zed', last_name: 'Other', emails: 'zed@q.ca', created_on: '2026-11-01', sold_on: '2026-11-20', price: '4321'},
  {estimate_id: 7003, first_name: 'Sal', last_name: 'Sold', emails: 'SAL@s.ca', created_on: isoDay(ago(95)), sold_on: isoDay(ago(90)), price: '5000'}
]))}::jsonb, null);`);
sandbox._log.length = 0;
vm.runInContext('sendLeadsToTracker()', sandbox);
check(psql('select count(*) from web_lead_tracker') === '3', 'the five minute send loads the 3 recent leads');
check(psql(`select string_agg(first_name || ' ' || status, ', ' order by received_at desc) from web_lead_tracker`) === 'Ann NEW LEAD, Bob NEW LEAD, Cara NEW-ISH',
      'a lead from before the tracker started (Cara, 5 days) is NEW-ISH, newer ones NEW LEAD');
vm.runInContext('sendAllLeadsToTracker()', sandbox);
console.log('     log: ' + sandbox._log.join(' / '));
check(psql('select count(*) from web_lead_tracker') === '5', 'sending everything imports the old ones too');
check(psql(`select status || ' ' || coalesce(estimate_id::text, '') from web_lead_tracker where first_name = 'Sal'`) === 'Sold 7003',
      'a 100 day old lead that sold in Access is Sold and linked to 7003');
check(psql(`select status || ' ' || status_by from web_lead_tracker where first_name = 'Old'`) === 'Lead No Response - Dead Automatic',
      'a 75 day old lead that did not sell is Lead No Response - Dead, set automatically (over 30 days)');
const lsCol = SHEET[0].indexOf('Lead Status');
check(lsCol === 11 && NOTES['1,12'], 'Lead Status column added at the end, marked as the script\'s');
const ls = SHEET.slice(1).map(r => r[lsCol]);
check(ls.join('|') === 'NEW LEAD|NEW LEAD|NEW-ISH|||Lead No Response - Dead|Sold', 'Lead Status filled for every lead row: ' + ls.join('|'));
check(SHEET[1][9] === 'Not Booked', 'the Sold/Booked Status column is left alone');
// a second send does not see Lead Status as a detail
const again2 = vm.runInContext('leadsForTracker_()', sandbox).leads.find(l => l.first === 'Ann');
check(!again2.details.some(d => d[0] === 'Lead Status'), 'Lead Status is not sent back as a detail');

// ---- 3. the page ------------------------------------------------------
function serve(dir, port){ return new Promise(ok => http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]); if(p.endsWith('/')) p += 'index.html';
  const f = path.join(dir, p);
  if(!fs.existsSync(f)){ r.statusCode = 404; return r.end('nf'); }
  r.setHeader('Content-Type', f.endsWith('.js') ? 'text/javascript' : 'text/html');
  r.end(fs.readFileSync(f));
}).listen(port, ok)); }

let ROLE = 'user';
const IDS = {admin: 'admin', user: 'user', sales: 'sales', manufacturing: 'manufacturing'};
async function mock(page){
  await page.route('https://baakegbtuygtldksmant.supabase.co/**', async route => {
    const req = route.request(), u = new URL(req.url()), p = u.pathname;
    const j = (b, s) => route.fulfill({status: s || 200, contentType: 'application/json', body: JSON.stringify(b)});
    if(p === '/rest/v1/profiles') return j([{id: 'a1', name: ROLE === 'user' ? 'Reception' : 'Andrew', role: ROLE, active: true, email_verified_at: '2026-10-24'}]);
    const m = p.match(/^\/rest\/v1\/rpc\/(web_[a-z_]+)$/);
    if(m){
      const args = JSON.parse(req.postData() || '{}');
      const named = Object.keys(args).map(k => `${k} => ${args[k] === null ? 'null' : lit(args[k])}`).join(', ');
      try{
        const out = psql(`select set_config('request.jwt.claim.sub', md5(${lit(IDS[ROLE])})::text, false);
          set role authenticated; select ${m[1]}(${named})::text;`).split('\n').pop();
        return j(JSON.parse(out));
      }catch(e){
        const msg = (String(e.stderr || e.message).match(/ERROR:\s+(.*)/) || [0, 'error'])[1];
        return j({message: msg}, /tracker is for/.test(msg) ? 403 : 400);
      }
    }
    return j([]);
  });
}

(async () => {
  await serve(ROOT + '/tools-site', 8732);
  const b = await chromium.launch();
  const errs = [];
  async function open(role, viewport){
    ROLE = role;
    const page = await b.newPage({viewport: viewport || {width: 1280, height: 1000}});
    page.on('pageerror', e => errs.push(e.message));
    await mock(page);
    await page.goto('http://localhost:8732/');
    await page.evaluate(() => localStorage.setItem('gidc:session', JSON.stringify({access_token: 'x', refresh_token: 'y', user: {id: 'a1', email: 'a@g.ca'}})));
    await page.goto('http://localhost:8732/webleads/');
    return page;
  }

  let page = await open('user');
  await page.waitForSelector('.lead');
  const landing = await page.evaluate(() => fetch('/').then(r => r.text()));
  check(/name: 'Web Leads'/.test(landing) && /\.\/webleads\//.test(landing), 'landing page has a Web Leads tile');
  check(/Tools 3\.9/.test(landing), 'landing page says Tools 3.9');
  const names = await page.$$eval('.lead .who b', e => e.map(x => x.textContent));
  check(names.join(',') === 'Ann Ray,Bob Lee,Cara Diaz,Old Lead', 'newest first: ' + names.join(', '));
  check(await page.$$eval('.lead.new', e => e.length) === 2, 'the two new ones show as NEW LEAD');
  check(/^\(2\)/.test(await page.title()), 'the tab title counts the new leads (' + await page.title() + ')');
  const stOpts = await page.$$eval('#fstatus option', e => e.map(x => x.textContent));
  check(stOpts.length === 15 && stOpts.indexOf('NEW LEAD (2)') === 2 && stOpts.indexOf('NEW-ISH (1)') === 3 &&
        stOpts.indexOf('Contacted - Not booked (wrong type of work) (0)') > 0 && stOpts.indexOf('Contacted - Not booked (0)') > 0 &&
        stOpts.indexOf('Lead No Response - Dead (1)') > 0 && stOpts.indexOf('Sold (0)') > 0 && stOpts[1] === 'Still to follow up (3)',
        'status filter: every status, still to follow up, then the ten statuses with counts (' + stOpts.join(' | ') + ')');
  const hearOpts = await page.$$eval('#fhear option', e => e.map(x => x.textContent));
  check(hearOpts.join('|') === 'Any|Facebook (1)|Google (2)|Home show (1)', 'How did you hear about us filter: ' + hearOpts.join(' | '));
  const formOpts = await page.$$eval('#fform option', e => e.map(x => x.textContent));
  check(formOpts.join('|') === 'Any|Contact (3)|Quote (1)', 'Form filter: ' + formOpts.join(' | '));
  const opts = await page.$$eval('.lead select option', e => e.slice(0, 13).map(x => x.textContent));
  check(opts.join('|') === 'NEW LEAD|NEW-ISH|Initial Measure booked|In home estimate booked|Bringing Measurements booked|First Call No Answer|Second Call No Answer|Contact Email Sent|Contact Text Message Sent|Contacted - Not booked (wrong type of work)|Contacted - Not booked|Lead No Response - Dead|Sold',
        'status list in the order Andrew gave');
  check(/Six bifolds/.test(await page.$eval('.lead', e => e.innerText)), 'the customer message shows on the card');
  check(await page.$eval('.lead a[href^="tel:"]', e => e.getAttribute('href')) === 'tel:5195551234', 'phone is a tap to call link');
  const bob = page.locator('.lead', {hasText: 'Bob Lee'});
  const bobText = (await bob.innerText()).replace(/\s+/g, ' ');
  check(/Access may have this one: estimate 7001/.test(bobText) && /same phone/.test(bobText),
        'Bob gets Access estimate 7001 suggested, by phone');
  if(SHOTS) await page.screenshot({path: SHOTS + '/web-leads.png', fullPage: true});

  // status
  await page.locator('.lead', {hasText: 'Ann Ray'}).locator('select').selectOption('First Call No Answer');
  await page.waitForFunction(() => /Set by Reception/.test(document.querySelector('.lead').innerText));
  check(psql(`select status || ' ' || status_by from web_lead_tracker where first_name = 'Ann'`) === 'First Call No Answer Reception',
        'a status change is saved with who set it');
  check(/^\(1\)/.test(await page.title()), 'one new lead left');
  vm.runInContext('sendLeadsToTracker()', sandbox);
  check(SHEET[1][SHEET[0].indexOf('Lead Status')] === 'First Call No Answer', 'the next send puts the new status in the sheet');

  // note
  const annCard = () => page.locator('.lead', {hasText: 'Ann Ray'});
  await annCard().locator('button[data-toggle]').click();
  await annCard().locator('textarea').fill('Left a voicemail, try again Friday');
  await annCard().locator('button[data-addnote]').click();
  await page.waitForFunction(() => /Left a voicemail/.test((document.querySelector('.lead .lastnote') || {}).innerText || ''));
  const hist = await annCard().locator('.hist li').allInnerTexts();
  check(hist.length === 2 && /Left a voicemail/.test(hist[0]) && /Status set to First Call No Answer/.test(hist[1]),
        'history shows the note and the status change, newest first');
  check(/Cambridge/.test(await annCard().locator('dl.det').innerText()), 'everything the sheet had shows when opened');
  vm.runInContext('sendLeadsToTracker()', sandbox);
  const nCol = SHEET[0].indexOf('Lead Notes');
  const lines = String(SHEET[1][nCol]).split('\n');
  check(nCol === SHEET[0].indexOf('Lead Status') + 1 && lines.length === 2 &&
        /^\d+ \w{3} \d{4} \d+:\d\d [ap]m, Reception: Left a voicemail, try again Friday$/.test(lines[0]) &&
        /^\d+ \w{3} \d{4} \d+:\d\d [ap]m, Reception: Status set to First Call No Answer$/.test(lines[1]),
        'Lead Notes in the sheet has the note and the status change, with who and when, newest first (' + lines.join(' / ') + ')');
  check(SHEET[7][nCol] === '', 'the tracker\'s own automatic marks stay out of the sheet (Sal)');
  if(SHOTS) await page.screenshot({path: SHOTS + '/web-leads-open.png', fullPage: true});

  // link a suggestion, then a typed number
  await bob.locator('button[data-linkguess]').click();
  await page.waitForFunction(() => [...document.querySelectorAll('.lead')].some(l => /Linked to Access estimate 7001/.test(l.innerText.replace(/\s+/g, ' '))));
  check(psql(`select estimate_id from web_lead_tracker where first_name = 'Bob'`) === '7001', 'Link it stores estimate 7001');
  const cara = page.locator('.lead', {hasText: 'Cara Diaz'});
  check(/Not linked to Access/.test(await cara.innerText()), 'Cara has no suggestion');
  await cara.locator('input[data-estbox]').fill('9999');
  await cara.locator('button[data-linktyped]').click();
  await page.waitForFunction(() => [...document.querySelectorAll('.lead')].some(l => /estimate 9999.*not in the hourly copy/.test(l.innerText.replace(/\s+/g, ' '))));
  check(true, 'a typed number not in the Access copy links and says so');
  await cara.locator('button[data-unlink]').click();
  await page.waitForFunction(() => [...document.querySelectorAll('.lead')].some(l => /Cara Diaz/.test(l.innerText.replace(/\s+/g, ' ')) && /Not linked/.test(l.innerText.replace(/\s+/g, ' '))));
  check(psql(`select coalesce(estimate_id::text, 'none') from web_lead_tracker where first_name = 'Cara'`) === 'none', 'Take the link off clears it');

  // filters and search
  await page.selectOption('#fstatus', 'NEW LEAD');
  check((await page.$$eval('.lead .who b', e => e.map(x => x.textContent))).join(',') === 'Bob Lee', 'Status filter NEW LEAD shows only new ones');
  await page.selectOption('#fstatus', '');
  await page.selectOption('#fhear', 'Google');
  check((await page.$$eval('.lead .who b', e => e.map(x => x.textContent))).join(',') === 'Ann Ray,Cara Diaz', 'How did you hear filter: Google');
  await page.selectOption('#fhear', '');
  await page.selectOption('#fform', 'Quote');
  check((await page.$$eval('.lead .who b', e => e.map(x => x.textContent))).join(',') === 'Bob Lee', 'Form filter: Quote');
  await page.selectOption('#fform', '');
  await page.selectOption('#since', '');
  await page.waitForFunction(() => /Sal Sold/.test(document.getElementById('list').innerText));
  const sal = (await page.locator('.lead', {hasText: 'Sal Sold'}).innerText()).replace(/\s+/g, ' ');
  check(/Set automatically/.test(sal) && /Linked to Access estimate 7003/.test(sal), 'Everything shows old Sal as Sold, set automatically, linked');
  await page.selectOption('#since', '90');
  await page.waitForFunction(() => !/Sal Sold/.test(document.getElementById('list').innerText));
  await page.fill('#q', 'voicemail');
  check((await page.$$eval('.lead .who b', e => e.map(x => x.textContent))).join(',') === 'Ann Ray', 'search finds a lead by its note');
  await page.fill('#q', '555-0000');
  check((await page.$$eval('.lead .who b', e => e.map(x => x.textContent))).join(',') === 'Bob Lee', 'search finds a lead by phone');
  await page.fill('#q', '');

  // a new lead arriving while the page is open
  psql(`set role service_role; select web_lead_tracker_load(${lit(JSON.stringify([{key: 'ffffffffffffffffffffffffffffffff',
    received_at: new Date().toISOString(), day: new Date().toISOString().slice(0, 10), first: 'Eve', last: 'New', email: 'eve@n.ca',
    details: [['Message', 'Just now']]}]))}::jsonb);`);
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await page.waitForFunction(() => /Eve New/.test(document.querySelector('.lead .who b').textContent));
  check(true, 'a new lead appears at the top without reloading');
  check(/The sheet last sent/.test(await page.$eval('#foot', e => e.innerText)), 'the foot says when the sheet last sent');
  const words = await page.$eval('.wrap', e => e.innerText.replace(/Lead No Response - Dead|Contacted - Not booked/g, ''));
  check(!/[‐-―]| - /.test(words), 'no dashes in the words on the page, apart from the status Andrew named');
  await page.close();

  // phone width
  page = await open('user', {width: 390, height: 844});
  await page.waitForSelector('.lead');
  const wide = await page.evaluate(() => document.documentElement.scrollWidth);
  check(wide <= 390, 'no sideways scroll on a phone (' + wide + ')');
  if(SHOTS) await page.screenshot({path: SHOTS + '/web-leads-phone.png', fullPage: true});
  await page.close();

  page = await open('admin');
  await page.waitForSelector('.lead');
  check(true, 'an administrator can open it');
  await page.close();

  for(const role of ['sales', 'manufacturing']){
    page = await open(role);
    await page.waitForTimeout(600);
    check(await page.evaluate(() => !!document.getElementById('gidc-hold') && !document.querySelector('.lead')), role + ' is turned away');
    await page.close();
  }

  await b.close();
  console.log('ERRORS:', JSON.stringify(errs));
  console.log('FAILED:', JSON.stringify(failed));
  process.exit(failed.length || errs.length ? 1 : 0);
})();

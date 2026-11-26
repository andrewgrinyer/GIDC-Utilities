// Runs the Google Sheet script's Sold or Unsold part against a pretend
// sheet, with its question answered by the real web_leads_match() in a
// throwaway local Postgres (socket /tmp/pg, port 5499, sql/web-leads-sold.sql
// already run). Never points at Supabase or Google.
//
//   node tests/web-leads-sold.js
const fs = require('fs');
const vm = require('vm');
const { execFileSync } = require('child_process');
const psql = (sql) => execFileSync('psql', ['-h', '/tmp/pg', '-p', '5499', '-U', 'postgres', '-X', '-q', '-t', '-A',
  '-v', 'ON_ERROR_STOP=1', '-c', sql], { encoding: 'utf8' }).trim();
const lit = (s) => "'" + String(s).replace(/'/g, "''") + "'";

psql(`select web_lead_sales_load(${lit(JSON.stringify([
  { estimate_id: 1, first_name: 'John', last_name: 'Smith', emails: 'john@x.ca', phones: '519 555 1111', sold_on: '2026-03-01', price: 8000.5 },
  { estimate_id: 2, first_name: 'Mary', last_name: 'Lee', emails: '', phones: '905-555-2222', sold_on: '2026-05-01', price: 4000 },
  { estimate_id: 3, first_name: 'Ann', last_name: 'Ray', emails: '', phones: '', sold_on: '2026-06-01', price: 3000 },
]))}, '{}')`);

const D = (s) => new Date(s + 'T15:00:00Z');
function makeSheet(rows) {
  const notes = rows[0].map(() => '');
  const fmt = {};
  const width = () => Math.max(...rows.map((r) => r.length));
  const cell = (r, c) => (rows[r] && rows[r][c] !== undefined ? rows[r][c] : '');
  const range = (r0, c0, nr, nc) => ({
    getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => cell(r0 - 1 + i, c0 - 1 + j))),
    setValues(v) { v.forEach((row, i) => row.forEach((x, j) => { (rows[r0 - 1 + i] ||= [])[c0 - 1 + j] = x; })); return this; },
    setValue(x) { (rows[r0 - 1] ||= [])[c0 - 1] = x; return this; },
    getNotes: () => [Array.from({ length: nc }, (_, j) => notes[c0 - 1 + j] || '')],
    setNote(n) { notes[c0 - 1] = n; return this; },
    setNumberFormat(f) { fmt[c0] = f; return this; },
  });
  return {
    rows, notes, fmt,
    getName: () => 'Form Responses 1',
    getDataRange: () => range(1, 1, rows.length, width()),
    getRange: (r, c, nr = 1, nc = 1) => range(r, c, nr, nc),
    getLastColumn: () => width(),
  };
}
const sheet = makeSheet([
  ['Timestamp', 'Name', 'Email', 'Phone Number', 'Tell us about your project'],
  [D('2026-02-01'), 'J S', 'JOHN@x.ca', '', 'call 416 555 0000'],
  [D('2026-04-01'), 'Mary', 'm@z.com', '(905) 555-2222', ''],
  [D('2026-05-15'), 'Ray Ann', '', '', ''],
  [D('2026-07-01'), 'John Smith', 'john@x.ca', '', ''],
  ['', '', '', '', ''],
]);
const log = [];
const ctx = {
  Logger: { log: (f, ...a) => log.push(String(f).replace(/%s/g, () => a.shift())) },
  PropertiesService: { getScriptProperties: () => ({ getProperty: () => 'k' }) },
  SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSheets: () => [sheet] }) },
  LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
  Utilities: { formatDate: (d) => d.toISOString().slice(0, 10) },
  UrlFetchApp: { fetch: (url, o) => {
    const body = JSON.parse(o.payload);
    const results = JSON.parse(psql(`select web_leads_match(${lit(JSON.stringify(body.leads))})`));
    const text = JSON.stringify({ results, sales_sent_at: new Date().toISOString(), sales_loaded: 3 });
    return { getResponseCode: () => 200, getContentText: () => text };
  } },
};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(__dirname + '/../apps-script/gidc-web-leads.gs', 'utf8'), ctx);

let fails = 0;
const eq = (what, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++;
  console.log((ok ? 'ok   ' : 'FAIL ') + what + (ok ? '' : `  got ${JSON.stringify(got)} want ${JSON.stringify(want)}`));
};

ctx.checkSoldStatus();
eq('check writes nothing', sheet.rows[0].length, 5);
ctx.markSoldNow();
eq('headers added at the end', sheet.rows[0], ['Timestamp', 'Name', 'Email', 'Phone Number', 'Tell us about your project', 'Status', 'Sold Price']);
eq('status', sheet.rows.slice(1).map((r) => r[5]), ['Sold', 'Sold', 'Sold', 'Unsold', '']);
eq('price', sheet.rows.slice(1).map((r) => r[6]), [8000.5, 4000, 3000, '', '']);
eq('existing columns untouched', sheet.rows[1].slice(0, 5).slice(1), ['J S', 'JOHN@x.ca', '', 'call 416 555 0000']);
eq('message column not read as a phone', log.some((l) => /phone "Phone Number", name/.test(l)), true);
const before = log.length;
ctx.markSoldNow();
eq('second run changes nothing', log.slice(before).some((l) => l === 'Wrote 0 changed row(s).'), true);
eq('second run adds no columns', sheet.rows[0].length, 7);

// a Status column somebody else made is left alone
const other = makeSheet([['Timestamp', 'Email', 'Status'], [D('2026-02-01'), 'john@x.ca', 'called back']]);
ctx.SpreadsheetApp.getActiveSpreadsheet = () => ({ getSheets: () => [other] });
ctx.markSoldNow();
eq('foreign Status column untouched', other.rows[1][2], 'called back');
eq('and said so', log.some((l) => /did not make/.test(l)), true);

console.log(log.join('\n'));
process.exit(fails ? 1 : 0);

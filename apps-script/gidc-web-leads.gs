/**
 * GIDC · web submissions, from the sheet to the dashboard
 * ---------------------------------------------------------------------
 *
 * This lives inside the Google Sheet the website form writes to. Once a
 * night it counts how many rows arrived on each of the last few days and
 * sends those counts, and nothing else, to the dashboard.
 *
 * What the nightly count sends is a date and a number per day. No name,
 * no email, no phone number, no message. The sheet is not published and
 * nothing outside Google is given access to it.
 *
 * NOT BOOKED, BOOKED OR SOLD (Andrew, 26 November 2026)
 * Every hour it also marks each lead Not Booked (not in Access at all),
 * Booked (in Access, not sold) or Sold, with the Sold
 * Price, in two columns it adds at the end: Status and Sold Price.
 * Leads are matched to Access by email first, then phone, then name,
 * and only a sale on or after the day the lead came in counts. To ask,
 * it sends each row's number, date, email, phone and name to GIDC's own
 * Supabase (the web-leads function), which answers Not Booked, Booked,
 * or Sold with the price, and keeps nothing it was sent. The estimates
 * and sales come from
 * the office server every hour. The two columns are rewritten each
 * hour, so anything typed into them by hand is replaced. No other
 * column is ever written to. See SOLD OR UNSOLD, PUTTING IT IN, below.
 *
 * THE WEB LEADS TRACKER (Andrew, 26 November 2026)
 * Every five minutes it also sends the leads from the last 30 days to
 * the Web Leads page on the tools site, where the receptionist sets
 * each one's status and writes notes. Each lead goes with every column
 * of its row, so the page shows what the customer wrote. These are
 * kept in GIDC's own Supabase (web_lead_tracker); a lead already there
 * keeps its status and notes. When it is turned on it sends every lead
 * in the sheet once, old ones too.
 * It then writes each lead's tracker status into a Lead Status column it
 * adds at the end of the sheet, every five minutes. Typing in that
 * column is replaced; change the status on the Web Leads page instead.
 * See THE TRACKER, PUTTING IT IN, below.
 *
 * ---------------------------------------------------------------------
 * PUTTING IT IN, ONCE
 *
 *  1. Open the sheet. Extensions, then Apps Script. A tab opens with an
 *     empty Code.gs. Delete what is in it and paste all of this in.
 *
 *  2. Save, with the disk icon or Ctrl S.
 *
 *  3. Put the import key in, where it is not part of the code. In the
 *     left bar: Project Settings, the cog. Scroll to Script Properties,
 *     Add script property.
 *         Property:  KPI_KEY
 *         Value:     the same long random string that is in
 *                    GIDC_KPI_KEY on the server and KPI_IMPORT_KEY in
 *                    Supabase.
 *     Save script properties.
 *
 *  4. Back in the editor, choose "checkWhatItWouldSend" from the
 *     function list at the top and press Run. The first run asks for
 *     permission: it wants to read this spreadsheet and to reach the
 *     internet. Allow it. Google will warn that the app is not
 *     verified; that is because you wrote it rather than installed it.
 *     Advanced, then go to the project.
 *
 *     The log at the bottom shows what it found and sends nothing. Check
 *     the counts look like your Monday and your Saturday.
 *
 *  5. When they do, choose "turnItOn" and press Run. That sets it to
 *     run every night between one and two. You only do this once; if you
 *     run it twice it clears the old timer first rather than ending up
 *     with two.
 *
 *  6. Tell me it is on, with the date, and I will set the same date as
 *     the switch on the server so Access stops counting these as well.
 *
 * ---------------------------------------------------------------------
 * SOLD OR UNSOLD, PUTTING IT IN (once the server sync has sent once)
 *
 *  1. Replace all of the code with this new copy and save, as above.
 *     KPI_KEY is already in Script Properties, so nothing to add.
 *
 *  2. Choose "checkSoldStatus" and press Run. Allow it if asked. It
 *     writes nothing. The log says which columns it read the email,
 *     phone and name from, and how many leads would be Sold, Booked and
 *     Not Booked.
 *
 *  3. When that looks right, choose "turnOnSoldStatus" and press Run.
 *     It adds the Status and Sold Price columns, fills them in now, and
 *     then every hour. Running it twice is harmless.
 *     "turnOffSoldStatus" stops it; the columns keep what they had.
 *
 * ---------------------------------------------------------------------
 * THE TRACKER, PUTTING IT IN (once web-leads-tracker.sql has been run
 * and the web-leads function deployed again)
 *
 *  1. Replace all of the code with this new copy and save, as above.
 *
 *  2. Choose "checkLeadTracker" and press Run. Allow it if asked. It
 *     sends nothing. The log says which columns it read and how many
 *     leads from the last 30 days it would send.
 *
 *  3. Choose "turnOnLeadTracker" and press Run. It sends every lead in
 *     the sheet now, old ones too, adds the Lead Status column, and then
 *     sends the last 30 days every five minutes. Running it twice is
 *     harmless. "turnOffLeadTracker" stops it; the tracker keeps what it
 *     has. "sendAllLeadsToTracker" sends the whole sheet again by hand.
 *
 * ---------------------------------------------------------------------
 * IF THE SHEET CHANGES
 *
 * If the form gains or loses columns this keeps working: it looks for
 * the date column by name and falls back to the first column that holds
 * dates. If it ever cannot find one it says so in the log and sends
 * nothing rather than sending a wrong number.
 */

// ---- the few things worth changing ----------------------------------
var SETTINGS = {
  // Which tab the form writes to. Leave it empty for the first tab,
  // which is what a form normally writes to.
  tabName: '',

  // The column holding when the submission arrived. It looks for a
  // header matching one of these, in order. If none match it uses the
  // first column whose cells are dates.
  dateHeaders: ['Timestamp', 'Date', 'Submitted', 'Date Submitted', 'Created'],

  // How many days back to recount every night. Two weeks, so a
  // submission that lands late, or a day the run was missed, still gets
  // picked up without anyone doing anything.
  daysBack: 14,

  // Where it goes. The publishable key is meant to be public; the one
  // that matters is KPI_KEY, which is in Script Properties and not here.
  url: 'https://baakegbtuygtldksmant.supabase.co',
  anon: 'sb_publishable_CSwwslH9Jt60-WK2fEJORw_k-R9n8Vj',

  // The line it feeds on the dashboard.
  metric: 'web_leads',

  // Toronto, so a submission at eleven at night counts as that day
  // rather than the next one.
  zone: 'America/Toronto',

  // SOLD OR UNSOLD. The two columns it adds at the end of the tab.
  statusHeader: 'Status',
  priceHeader: 'Sold Price',
  // Which columns hold the email, phone and name, found by their
  // headers. Every column whose header matches is read.
  emailLike: /e-?mail/i,
  phoneLike: /phone|cell|mobile|^tel\b/i,
  firstLike: /^first|first ?name/i,
  lastLike: /^last|last ?name|surname/i,
  nameLike: /name/i,
  // a name column that is not the person's name
  notNameLike: /first|last|sur|company|business|user|file/i,
  // the edge function that answers Not Booked, Booked or Sold
  matchFunction: 'web-leads',

  // THE TRACKER. How many days of leads go to the Web Leads page each
  // time. A lead older than this that is already there stays there.
  trackDaysBack: 30,
  // the column it adds at the end with each lead's tracker status
  leadStatusHeader: 'Lead Status'
};

// =====================================================================
//  THE THREE THINGS YOU RUN BY HAND
// =====================================================================

/** Shows what it would send, and sends nothing. Safe to run any time. */
function checkWhatItWouldSend() {
  var counted = countTheDays_();
  if (!counted.ok) { Logger.log(counted.why); return; }
  Logger.log('Reading the "%s" tab, column "%s".', counted.tab, counted.column);
  Logger.log('%s rows looked at, %s of them in the last %s days.',
             counted.rowsSeen, counted.rowsCounted, SETTINGS.daysBack);
  Logger.log('');
  counted.rows.forEach(function (r) {
    Logger.log('   %s   %s', r.date, r.value);
  });
  Logger.log('');
  Logger.log('Nothing was sent. Run turnItOn when these look right.');
}

/** Sets the nightly timer. Run once. Running it again is harmless. */
function turnItOn() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'sendLastFortnight') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('sendLastFortnight').timeBased().atHour(1).everyDays(1).create();
  Logger.log('On. It will run every night between one and two.');
  Logger.log('Tell Andrew to set the switch date on the server to today.');
}

/** Stops it. The dashboard keeps whatever was already sent. */
function turnItOff() {
  var n = 0;
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'sendLastFortnight') { ScriptApp.deleteTrigger(t); n++; }
  });
  Logger.log(n ? 'Off.' : 'It was not on.');
}

// =====================================================================
//  WHAT THE TIMER RUNS
// =====================================================================
function sendLastFortnight() {
  var key = PropertiesService.getScriptProperties().getProperty('KPI_KEY');
  if (!key) {
    Logger.log('No KPI_KEY in Script Properties, so nothing was sent.');
    return;
  }

  var counted = countTheDays_();
  if (!counted.ok) { Logger.log(counted.why); return; }
  if (!counted.rows.length) { Logger.log('No days to send.'); return; }

  var body = {
    rows: counted.rows.map(function (r) {
      return { metric: SETTINGS.metric, date: r.date, value: r.value };
    }),
    source: 'sheet',
    // The wholesale rebuild belongs to the server's nightly job. Asking
    // for it here would have the sheet rebuilding numbers it knows
    // nothing about, every night, for no reason.
    refresh_portal: false
  };

  var res = UrlFetchApp.fetch(SETTINGS.url + '/functions/v1/kpi-import', {
    method: 'post',
    contentType: 'application/json',
    headers: {
      apikey: SETTINGS.anon,
      Authorization: 'Bearer ' + SETTINGS.anon,
      'x-gidc-key': key
    },
    payload: JSON.stringify(body),
    muteHttpExceptions: true
  });

  var code = res.getResponseCode();
  var said = res.getContentText();
  if (code >= 200 && code < 300) {
    Logger.log('Sent %s day(s). %s', counted.rows.length, said);
  } else {
    // Said out loud rather than thrown, so the failure is in the log
    // with its reason instead of as a stack trace in an email.
    Logger.log('The dashboard would not take it. It answered %s: %s', code, said);
  }
}

// =====================================================================
//  THE COUNTING
// =====================================================================
function countTheDays_() {
  var book = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = SETTINGS.tabName ? book.getSheetByName(SETTINGS.tabName) : book.getSheets()[0];
  if (!sheet) {
    return { ok: false, why: 'There is no tab called "' + SETTINGS.tabName + '".' };
  }

  var values = sheet.getDataRange().getValues();
  if (values.length < 2) {
    return { ok: false, why: 'That tab has no rows in it yet.' };
  }

  var headers = values[0].map(function (h) { return String(h).trim(); });
  var col = -1;
  for (var i = 0; i < SETTINGS.dateHeaders.length && col < 0; i++) {
    var want = SETTINGS.dateHeaders[i].toLowerCase();
    for (var c = 0; c < headers.length; c++) {
      if (headers[c].toLowerCase() === want) { col = c; break; }
    }
  }
  // No header matched, so look for a column that actually holds dates.
  if (col < 0) {
    for (var c2 = 0; c2 < headers.length && col < 0; c2++) {
      for (var r2 = 1; r2 < Math.min(values.length, 20); r2++) {
        if (values[r2][c2] instanceof Date) { col = c2; break; }
      }
    }
  }
  if (col < 0) {
    return { ok: false, why: 'No column in that tab holds dates, so there is ' +
                             'nothing to count by. Nothing was sent.' };
  }

  // The window. Today is included: a run at one in the morning is
  // counting yesterday, and a run by hand at noon should still show what
  // has come in so far today.
  var today = new Date();
  var first = new Date(today.getTime() - SETTINGS.daysBack * 86400000);
  var firstDay = dayOf_(first);
  var lastDay = dayOf_(today);

  // Every day in the window starts at nought rather than being absent.
  // A quiet day is a fact worth storing: it is the difference between
  // nobody filling the form in and nobody having looked.
  var tally = {};
  for (var d = 0; d <= SETTINGS.daysBack; d++) {
    tally[dayOf_(new Date(first.getTime() + d * 86400000))] = 0;
  }

  var counted = 0;
  for (var r = 1; r < values.length; r++) {
    var when = values[r][col];
    if (!(when instanceof Date)) {
      // A text date still counts if it can be read as one.
      if (!when && when !== 0) continue;
      var parsed = new Date(when);
      if (isNaN(parsed.getTime())) continue;
      when = parsed;
    }
    var day = dayOf_(when);
    if (day < firstDay || day > lastDay) continue;
    tally[day] = (tally[day] || 0) + 1;
    counted++;
  }

  var rows = Object.keys(tally).sort().map(function (day) {
    return { date: day, value: tally[day] };
  });

  return { ok: true, rows: rows, column: headers[col] || ('column ' + (col + 1)),
           tab: sheet.getName(), rowsSeen: values.length - 1, rowsCounted: counted };
}

/** A date as the dashboard wants it, in Toronto time rather than UTC. */
function dayOf_(when) {
  return Utilities.formatDate(when, SETTINGS.zone, 'yyyy-MM-dd');
}


// =====================================================================
//  SOLD OR UNSOLD (Andrew, 26 November 2026)
// =====================================================================

/** Shows what it would mark, and writes nothing. Safe to run any time. */
function checkSoldStatus() {
  var got = soldStatus_(false);
  if (!got.ok) { Logger.log(got.why); return; }
  Logger.log('Nothing was written. Run turnOnSoldStatus when these look right.');
}

/** Marks every lead now. The hourly timer runs this. */
function markSoldNow() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) { Logger.log('Already running.'); return; }
  try {
    var got = soldStatus_(true);
    if (!got.ok) Logger.log(got.why);
  } finally {
    lock.releaseLock();
  }
}

/** Sets the hourly timer and marks the leads once now. Run once. */
function turnOnSoldStatus() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'markSoldNow') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('markSoldNow').timeBased().everyHours(1).create();
  Logger.log('On. Status and Sold Price will be filled in every hour.');
  markSoldNow();
}

/** Stops it. The two columns keep what they had. */
function turnOffSoldStatus() {
  var n = 0;
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'markSoldNow') { ScriptApp.deleteTrigger(t); n++; }
  });
  Logger.log(n ? 'Off.' : 'It was not on.');
}

var OUR_NOTE_ = 'Filled in every hour from Access by the GIDC script ' +
                '(Extensions, Apps Script). Typing here is replaced.';

function soldStatus_(write) {
  var key = PropertiesService.getScriptProperties().getProperty('KPI_KEY');
  if (!key) return { ok: false, why: 'No KPI_KEY in Script Properties, so it cannot ask. Nothing was written.' };

  var book = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = SETTINGS.tabName ? book.getSheetByName(SETTINGS.tabName) : book.getSheets()[0];
  if (!sheet) return { ok: false, why: 'There is no tab called "' + SETTINGS.tabName + '".' };
  var values = sheet.getDataRange().getValues();
  if (values.length < 2) return { ok: false, why: 'That tab has no rows in it yet.' };
  var headers = values[0].map(function (h) { return String(h).trim(); });

  // our two columns: found by header, and only if this script made them
  var notes = sheet.getRange(1, 1, 1, headers.length).getNotes()[0];
  function ours(title) {
    for (var c = 0; c < headers.length; c++) {
      if (headers[c].toLowerCase() === title.toLowerCase()) {
        return notes[c] === OUR_NOTE_ ? { col: c } : { col: c, notOurs: true };
      }
    }
    return { col: -1 };
  }
  var st = ours(SETTINGS.statusHeader), pr = ours(SETTINGS.priceHeader);
  if (st.notOurs || pr.notOurs) {
    return { ok: false, why: 'There is already a column called "' +
      (st.notOurs ? SETTINGS.statusHeader : SETTINGS.priceHeader) +
      '" that this script did not make, so it has left the sheet alone. Change statusHeader or priceHeader in SETTINGS to another name.' };
  }

  // where the email, phone and name are, leaving out our own two columns
  var cols = { email: [], phone: [], first: [], last: [], name: [] };
  headers.forEach(function (h, c) {
    if (!h || c === st.col || c === pr.col) return;
    if (SETTINGS.emailLike.test(h)) cols.email.push(c);
    else if (SETTINGS.phoneLike.test(h)) cols.phone.push(c);
    else if (SETTINGS.firstLike.test(h)) cols.first.push(c);
    else if (SETTINGS.lastLike.test(h)) cols.last.push(c);
    else if (SETTINGS.nameLike.test(h) && !SETTINGS.notNameLike.test(h)) cols.name.push(c);
  });
  var dateCol = findDateColumn_(headers, values);
  function names(list) { return list.length ? list.map(function (c) { return '"' + headers[c] + '"'; }).join(', ') : 'none'; }
  Logger.log('Reading the "%s" tab. Date %s, email %s, phone %s, name %s, first name %s, last name %s.',
             sheet.getName(), dateCol < 0 ? 'none' : '"' + headers[dateCol] + '"',
             names(cols.email), names(cols.phone), names(cols.name), names(cols.first), names(cols.last));
  if (!cols.email.length && !cols.phone.length && !cols.name.length && !cols.first.length) {
    return { ok: false, why: 'No email, phone or name column found, so there is nothing to match on. Nothing was written.' };
  }

  function joined(row, list) {
    return list.map(function (c) { return String(row[c] == null ? '' : row[c]).trim(); })
               .filter(function (v) { return v; }).join('; ');
  }
  var leads = [];
  for (var r = 1; r < values.length; r++) {
    var row = values[r];
    var blank = row.every(function (v, c) { return c === st.col || c === pr.col || v === '' || v === null; });
    if (blank) continue;
    var when = dateCol < 0 ? null : row[dateCol];
    if (when && !(when instanceof Date)) { var p = new Date(when); when = isNaN(p.getTime()) ? null : p; }
    leads.push({ row: r + 1, day: when ? dayOf_(when) : null,
                 email: joined(row, cols.email), phone: joined(row, cols.phone),
                 name: joined(row, cols.name), first: joined(row, cols.first), last: joined(row, cols.last) });
  }
  if (!leads.length) return { ok: false, why: 'No leads in that tab yet.' };

  var res = UrlFetchApp.fetch(SETTINGS.url + '/functions/v1/' + SETTINGS.matchFunction, {
    method: 'post', contentType: 'application/json',
    headers: { apikey: SETTINGS.anon, Authorization: 'Bearer ' + SETTINGS.anon, 'x-gidc-key': key },
    payload: JSON.stringify({ action: 'match', leads: leads }),
    muteHttpExceptions: true
  });
  if (res.getResponseCode() < 200 || res.getResponseCode() >= 300) {
    return { ok: false, why: 'Supabase would not answer. It said ' + res.getResponseCode() + ': ' +
                             res.getContentText() + ' Nothing was written.' };
  }
  var said = JSON.parse(res.getContentText());
  if (!said.sales_sent_at) {
    return { ok: false, why: 'The office server has not sent the sold jobs yet, so every lead would look ' +
                             'Not Booked. Nothing was written. Run the server sync first.' };
  }
  var hoursOld = (Date.now() - new Date(said.sales_sent_at).getTime()) / 3600000;
  Logger.log('The sold jobs list came from the office server %s (%s sold jobs).',
             Utilities.formatDate(new Date(said.sales_sent_at), SETTINGS.zone, 'yyyy-MM-dd HH:mm'), said.sales_loaded);
  if (hoursOld > 26) Logger.log('That is over a day old. Check the "GIDC web leads sync" task on the server.');

  var byRow = {}, tally = { Sold: {}, Booked: {}, 'Not Booked': 0 };
  (said.results || []).forEach(function (x) {
    byRow[x.row] = x;
    if (x.status === 'Not Booked') tally['Not Booked']++;
    else { var t = tally[x.status] || (tally[x.status] = {}); t[x.by] = (t[x.by] || 0) + 1; }
  });
  function how(t) {
    var e = t.email || 0, p = t.phone || 0, n = t.name || 0;
    return (e + p + n) + ' (by email ' + e + ', by phone ' + p + ', by name ' + n + ')';
  }
  Logger.log('%s leads: Sold %s, Booked %s, Not Booked %s.', leads.length,
             how(tally.Sold), how(tally.Booked), tally['Not Booked']);

  // how near the rest came, so a rule that misses sales shows up here
  var noEmail = 0, noContact = 0, noDay = 0, sb = [0, 0, 0, 0], mb = [0, 0, 0, 0], sbRows = [];
  leads.forEach(function (l) {
    if (!l.email) noEmail++;
    if (!l.email && !l.phone) noContact++;
  });
  function band(d) { return d <= 14 ? 0 : d <= 90 ? 1 : d <= 365 ? 2 : 3; }
  (said.results || []).forEach(function (x) {
    if (x.no_day) noDay++;
    if (x.sold_before != null) { sb[band(x.sold_before)]++; if (sbRows.length < 15) sbRows.push(x.row); }
    if (x.made_before != null) mb[band(x.made_before)]++;
  });
  Logger.log('Leads with no email: %s. With no email and no phone: %s. With no date the script could read: %s.',
             noEmail, noContact, noDay);
  Logger.log('Not Sold, but the same email or phone SOLD BEFORE the lead date: within 2 weeks %s, ' +
             '2 weeks to 3 months %s, 3 to 12 months %s, over a year %s. First rows: %s',
             sb[0], sb[1], sb[2], sb[3], sbRows.join(', ') || 'none');
  Logger.log('Not Booked, but the same email or phone had an estimate BEFORE that: 2 weeks to 3 months %s, ' +
             '3 to 12 months %s, over a year %s.', mb[1], mb[2], mb[3]);
  if (!write) return { ok: true };

  // add our two columns at the end if they are not there yet
  var last = sheet.getLastColumn();
  if (st.col < 0) { last++; sheet.getRange(1, last).setValue(SETTINGS.statusHeader).setNote(OUR_NOTE_); st.col = last - 1; }
  if (pr.col < 0) { last++; sheet.getRange(1, last).setValue(SETTINGS.priceHeader).setNote(OUR_NOTE_); pr.col = last - 1; }

  var n = values.length - 1;
  var stRange = sheet.getRange(2, st.col + 1, n, 1), prRange = sheet.getRange(2, pr.col + 1, n, 1);
  var stNow = stRange.getValues(), prNow = prRange.getValues();
  var stNew = [], prNew = [], changed = 0;
  for (var i = 0; i < n; i++) {
    var x = byRow[i + 2];
    var s = x ? x.status : stNow[i][0];
    var pv = x ? (x.status === 'Sold' && x.price != null ? Number(x.price) : '') : prNow[i][0];
    if (String(s) !== String(stNow[i][0]) || String(pv) !== String(prNow[i][0])) changed++;
    stNew.push([s]); prNew.push([pv]);
  }
  if (changed) {
    stRange.setValues(stNew);
    prRange.setValues(prNew).setNumberFormat('$#,##0.00');
  }
  Logger.log('Wrote %s changed row(s).', changed);
  return { ok: true };
}

/** The column holding when the submission arrived, as countTheDays_ finds it. */
function findDateColumn_(headers, values) {
  for (var i = 0; i < SETTINGS.dateHeaders.length; i++) {
    var want = SETTINGS.dateHeaders[i].toLowerCase();
    for (var c = 0; c < headers.length; c++) if (headers[c].toLowerCase() === want) return c;
  }
  for (var c2 = 0; c2 < headers.length; c2++) {
    for (var r = 1; r < Math.min(values.length, 20); r++) if (values[r][c2] instanceof Date) return c2;
  }
  return -1;
}


// =====================================================================
//  THE WEB LEADS TRACKER (Andrew, 26 November 2026)
// =====================================================================

var OUR_TRACK_NOTE_ = 'The status on the Web Leads page (tools site), copied here every five ' +
                      'minutes by the GIDC script. Typing here is replaced; change it on the page.';

/** Shows what it would send to the tracker, and sends nothing. */
function checkLeadTracker() {
  var got = leadsForTracker_();
  if (!got.ok) { Logger.log(got.why); return; }
  var recent = got.leads.filter(function (l) { return l.recent; }).length;
  Logger.log('%s leads in the sheet (%s from the last %s days). %s rows with no date are left out.',
             got.leads.length, recent, SETTINGS.trackDaysBack, got.noDate);
  if (got.leads.length) {
    var l = got.leads[got.leads.length - 1];
    Logger.log('The newest came in %s with these columns filled: %s.',
               l.received_at, l.details.map(function (d) { return d[0]; }).join(', ') || 'none');
  }
  Logger.log('Nothing was sent. Run turnOnLeadTracker when this looks right.');
}

/** Sends the last 30 days and fills Lead Status. The five minute timer runs this. */
function sendLeadsToTracker() { sendToTracker_(false); }

/** Sends every lead in the sheet, old ones too, in batches. */
function sendAllLeadsToTracker() { sendToTracker_(true); }

/** Sends every lead once, then sets the five minute timer. Run once. */
function turnOnLeadTracker() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'sendLeadsToTracker') ScriptApp.deleteTrigger(t);
  });
  sendAllLeadsToTracker();
  ScriptApp.newTrigger('sendLeadsToTracker').timeBased().everyMinutes(5).create();
  Logger.log('On. New leads go to the Web Leads page every five minutes.');
}

/** Stops it. The tracker keeps what it has, and Lead Status keeps its last values. */
function turnOffLeadTracker() {
  var n = 0;
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'sendLeadsToTracker') { ScriptApp.deleteTrigger(t); n++; }
  });
  Logger.log(n ? 'Off.' : 'It was not on.');
}

function sendToTracker_(all) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) { Logger.log('Already running.'); return; }
  try {
    var key = PropertiesService.getScriptProperties().getProperty('KPI_KEY');
    if (!key) { Logger.log('No KPI_KEY in Script Properties, so nothing was sent.'); return; }
    var got = leadsForTracker_();
    if (!got.ok) { Logger.log(got.why); return; }
    var send = got.leads.filter(function (l) { return all || l.recent; });
    // batches, so the whole sheet never goes in one enormous call; the
    // last one asks for every lead's status back
    var size = 500, statuses = null, added = 0;
    for (var i = 0; i === 0 || i < send.length; i += size) {
      var batch = send.slice(i, i + size).map(function (l) {
        return { key: l.key, received_at: l.received_at, day: l.day, row: l.row, email: l.email,
                 phone: l.phone, name: l.name, first: l.first, last: l.last, details: l.details };
      });
      var lastOne = i + size >= send.length;
      var res = UrlFetchApp.fetch(SETTINGS.url + '/functions/v1/' + SETTINGS.matchFunction, {
        method: 'post', contentType: 'application/json',
        headers: { apikey: SETTINGS.anon, Authorization: 'Bearer ' + SETTINGS.anon, 'x-gidc-key': key },
        payload: JSON.stringify({ action: 'track', leads: batch, statuses: lastOne }),
        muteHttpExceptions: true
      });
      var code = res.getResponseCode();
      if (code < 200 || code >= 300) {
        Logger.log('The tracker would not take them. It answered %s: %s', code, res.getContentText());
        return;
      }
      var said = JSON.parse(res.getContentText());
      added += said.added || 0;
      if (lastOne) statuses = said.statuses || null;
    }
    Logger.log('Sent %s lead(s) to the tracker, %s new.', send.length, added);
    if (statuses) writeLeadStatus_(got, statuses);
  } finally {
    lock.releaseLock();
  }
}

/** Fills the Lead Status column, adding it at the end the first time. */
function writeLeadStatus_(got, statuses) {
  var sheet = got.sheet, headers = got.headers;
  var col = -1;
  for (var c = 0; c < headers.length; c++) {
    if (headers[c].toLowerCase() === SETTINGS.leadStatusHeader.toLowerCase()) { col = c; break; }
  }
  if (col >= 0 && sheet.getRange(1, col + 1).getNote() !== OUR_TRACK_NOTE_) {
    Logger.log('There is already a column called "%s" that this script did not make, so Lead Status was not written. ' +
               'Change leadStatusHeader in SETTINGS to another name.', SETTINGS.leadStatusHeader);
    return;
  }
  if (col < 0) {
    col = sheet.getLastColumn();
    sheet.getRange(1, col + 1).setValue(SETTINGS.leadStatusHeader).setNote(OUR_TRACK_NOTE_);
  }
  var n = got.rowCount;
  if (n < 1) return;
  var range = sheet.getRange(2, col + 1, n, 1);
  var now = range.getValues(), next = [], changed = 0;
  var byRow = {};
  got.leads.forEach(function (l) { byRow[l.row] = statuses[l.key] || ''; });
  for (var i = 0; i < n; i++) {
    var v = byRow.hasOwnProperty(i + 2) ? byRow[i + 2] : now[i][0];
    if (String(v) !== String(now[i][0])) changed++;
    next.push([v]);
  }
  if (changed) range.setValues(next);
  Logger.log('Lead Status: %s row(s) changed.', changed);
}

/** A lead's key: the moment it came in and its email, else its phone,
    so sorting the sheet or fixing a typo in a name keeps the same lead. */
function leadKey_(when, email, phone) {
  var who = String(email || '').toLowerCase().replace(/\s+/g, '') ||
            String(phone || '').replace(/\D/g, '').slice(-10);
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,
                                      when.toISOString().slice(0, 19) + '|' + who,
                                      Utilities.Charset.UTF_8);
  return bytes.map(function (b) { return ('0' + (b & 255).toString(16)).slice(-2); }).join('').slice(0, 32);
}

/** Every lead in the sheet with a date, oldest first; recent marks the last 30 days. */
function leadsForTracker_() {
  var book = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = SETTINGS.tabName ? book.getSheetByName(SETTINGS.tabName) : book.getSheets()[0];
  if (!sheet) return { ok: false, why: 'There is no tab called "' + SETTINGS.tabName + '".' };
  var values = sheet.getDataRange().getValues();
  if (values.length < 2) return { ok: false, why: 'That tab has no rows in it yet.' };
  var headers = values[0].map(function (h) { return String(h).trim(); });
  var dateCol = findDateColumn_(headers, values);
  if (dateCol < 0) return { ok: false, why: 'No column in that tab holds dates, so no lead can be told apart. Nothing was sent.' };

  // the columns this script adds itself are left out
  var skip = {};
  [SETTINGS.statusHeader, SETTINGS.priceHeader, SETTINGS.leadStatusHeader].forEach(function (t) {
    headers.forEach(function (h, c) { if (h.toLowerCase() === t.toLowerCase()) skip[c] = true; });
  });
  var cols = { email: [], phone: [], first: [], last: [], name: [] };
  headers.forEach(function (h, c) {
    if (!h || skip[c]) return;
    if (SETTINGS.emailLike.test(h)) cols.email.push(c);
    else if (SETTINGS.phoneLike.test(h)) cols.phone.push(c);
    else if (SETTINGS.firstLike.test(h)) cols.first.push(c);
    else if (SETTINGS.lastLike.test(h)) cols.last.push(c);
    else if (SETTINGS.nameLike.test(h) && !SETTINGS.notNameLike.test(h)) cols.name.push(c);
  });
  function joined(row, list) {
    return list.map(function (c) { return String(row[c] == null ? '' : row[c]).trim(); })
               .filter(function (v) { return v; }).join('; ');
  }
  function shown(v) {
    if (v instanceof Date) return Utilities.formatDate(v, SETTINGS.zone, 'yyyy-MM-dd HH:mm');
    return String(v == null ? '' : v).trim();
  }

  var since = new Date(Date.now() - SETTINGS.trackDaysBack * 86400000);
  var leads = [], noDate = 0;
  for (var r = 1; r < values.length; r++) {
    var row = values[r];
    var when = row[dateCol];
    if (when && !(when instanceof Date)) { var p = new Date(when); when = isNaN(p.getTime()) ? null : p; }
    if (!when) {
      if (row.some(function (v, c) { return !skip[c] && v !== '' && v !== null; })) noDate++;
      continue;
    }
    var email = joined(row, cols.email), phone = joined(row, cols.phone);
    // in the sheet's own column order, as [header, value] pairs
    var details = [];
    headers.forEach(function (h, c) {
      if (skip[c] || c === dateCol) return;
      var v = shown(row[c]);
      if (v) details.push([h || ('Column ' + (c + 1)), v]);
    });
    leads.push({ key: leadKey_(when, email, phone), received_at: when.toISOString(),
                 day: dayOf_(when), row: r + 1, recent: when >= since, email: email, phone: phone,
                 name: joined(row, cols.name), first: joined(row, cols.first), last: joined(row, cols.last),
                 details: details });
  }
  leads.sort(function (a, b) { return a.received_at < b.received_at ? -1 : 1; });
  return { ok: true, leads: leads, noDate: noDate, sheet: sheet, headers: headers, rowCount: values.length - 1 };
}

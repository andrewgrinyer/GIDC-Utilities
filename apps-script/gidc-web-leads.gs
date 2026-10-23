/**
 * GIDC · web submissions, from the sheet to the dashboard
 * ---------------------------------------------------------------------
 *
 * This lives inside the Google Sheet the website form writes to. Once a
 * night it counts how many rows arrived on each of the last few days and
 * sends those counts, and nothing else, to the dashboard.
 *
 * What leaves the sheet is a date and a number per day. No name, no
 * email, no phone number, no message. The sheet is not published and
 * nothing outside Google is given access to it.
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
  zone: 'America/Toronto'
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

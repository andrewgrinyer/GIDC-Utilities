# GIDC backup, 23 October 2026

Read `CONTEXT.md` first. It explains how the systems work and why, which
is the part that is not in any of the code.

## What is in here

```
CONTEXT.md             how it all works, and the decisions behind it
MISSING.md             what is NOT in here and where to get it
powershell/            21 scripts that run on the office server
apps-script/           the script inside the Google Sheet
sql/                   the database changes that are current
tools-html/            7 standalone HTML tools
```

## powershell/

Run on `SVR-GDDC` against the Access back end. All read only except
`gidc-kpi-import.ps1`, `gidc-dealer-sync.ps1` and
`gidc-backfill-dailylog.ps1`, and those three take `-WhatIf`.

- `gidc-kpi-import.ps1` is the hourly job that feeds the dashboard.
- `gidc-schedule-hourly.ps1` sets it to run.
- `gidc-dealer-sync.ps1` matches portal orders to Access jobs.
- `gidc-backfill-dailylog.ps1` sends the booked history. **Not run yet.**
  Run it with `-WhatIf` first; it refuses to send anything unless the
  log's columns agree with a live count.
- `gidc-explore*.ps1` are one off questions, kept because each one
  documents what was asked and what came back. `gidc-explore10.ps1` is
  the one that found the daily log.
- `gidc-schema.ps1` and `gidc-lookups.ps1` dump the Access structure.

## sql/

Run in the Supabase SQL editor, in this order. Each is safe to run twice.

1. `security-tighten.sql` — closes the three holes found on 21 October.
   **Run this first and soon.** It is independent of the rest.
2. `two-sided-access.sql` — splits one role into team access and dealer
   access, so a person can have either or both. Migrates existing
   dealers across. Nobody's access changes.
3. `email-verification.sql` — adds the verification record and the
   switch. Refuses to run before step 2. Changes nobody's access until
   you turn the switch on.

`security-audit.sql` is read only and can be run any time. It reports
what is actually exposed rather than what anybody remembers writing.

## tools-html/

Standalone single file tools. Each one opens in a browser and needs
nothing. Several of these are also deployed inside the tools site; these
copies are the versions that were sent at the time and may be behind.

## Before trusting this archive

Check `MISSING.md`. Several important things are not in here.

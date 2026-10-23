# Dealer order statuses and ship dates from Access

How it is meant to work, why it may not be, and how to put the Access
order number live. Written 23 October 2026.

## The path

1. `powershell/gidc-dealer-sync.ps1` on SVR-GDDC reads the dealer orders
   out of Access (tags SFD, CIN, CDC, PIT) with their status and
   Packaging Date.
2. It posts them to the `dealer-sync` edge function with `GIDC_KPI_KEY`.
3. The function replaces `access_dealer_orders` and runs
   `gidc_sync_dealer_orders()`, which moves statuses and sets the
   estimated ship date from the packaging date.

## Why it is probably not moving

**Nothing schedules it.** `gidc-schedule-hourly.ps1` makes one task, "GIDC
KPI import", and that task runs `gidc-kpi-import.ps1` only. No script in
the repo ever made a task for the dealer sync, so unless one was made by
hand in Task Scheduler, statuses only moved when somebody ran the script
in a window. That is the first thing to check, and the most likely
answer.

Other things that would stop it, in the order worth checking:

* `GIDC_KPI_KEY` set for the user only, not the machine. A scheduled task
  does not see it, and the script stops with "No key".
* `dealer-sync` not deployed, or deployed with Verify JWT on. The script
  sends the publishable key as the bearer, which is not a JWT, so with
  verification on the gateway answers 401 before the function runs.
* `KPI_IMPORT_KEY` missing in Supabase secrets, which the function
  reports as "No import key is set up yet".
* The orders are there but do not match: tag, surname and street number
  have to agree, and Pittsburgh is PIT in Access but PITT in the portal.
  `dealer_orders_unmatched` counts these.
* The order is still a draft in the portal. The sync never moves a draft.

## What to run to find out (both read only)

* On SVR-GDDC: `powershell -ExecutionPolicy Bypass -File "C:\GIDC\gidc-dealer-sync-check.ps1"`
  says whether a task runs the sync, its last result, whether the key is
  visible to a task, and the last lines of `C:\GIDC\logs\dealer-sync.log`.
* In the Supabase SQL editor: `sql/dealer-sync-check.sql` says when the
  server last got anything through, how many jobs per tag, how many
  portal orders are linked, and prints the sync function's code. That
  code is not in the repo yet, and should be.
* In Supabase, Edge Functions, dealer-sync, Logs: a line per step for
  every run, or nothing at all if it is never called.

## Fixing the schedule

As administrator on SVR-GDDC, with `gidc-schedule-dealer-sync.ps1` beside
`gidc-dealer-sync.ps1` in `C:\GIDC`:

    powershell -ExecutionPolicy Bypass -File "C:\GIDC\gidc-schedule-dealer-sync.ps1"

It makes "GIDC dealer sync" at 37 minutes past every hour, as the account
you give it (the same one the KPI task uses), and runs it once to prove
it. This changes live statuses, which is what the sync is for.

## The Access order number

The job number off the Access screen (OrderNo), shown on the portal's
order list between Customer and Dealer ID. Administrators type it there;
dealers see it. It is never the OrderID, which sits two along and which
the database works out from the number.

When the number is set, the sync follows it before it tries the name. A
number for a job Access has not sent yet is kept and links the hour it
appears. Emptying the box unlinks the order, and the sync goes back to
matching it by name. Linking or unlinking inside the order keeps the
number in step.

To put it live, in this order:

1. Run `sql/dealer-order-number.sql` in the Supabase SQL editor.
2. Deploy `supabase/functions/dealer-sync/index.ts` over the existing
   dealer-sync (Edge Functions, dealer-sync, Code, paste, Deploy). Until
   step 1 has run the new steps are skipped with a line in its log, so
   the order of 1 and 2 does not break anything.
3. Upload the dealer portal 1.99.1 to Cloudflare Pages, the same way
   1.99 went up. It is the live 1.99 with the packing list fix and this
   column, and nothing from the login change, so it can go up now.

When the login change (PR #1, portal 2.0) goes out, the Order # column
has to be carried into 2.0 first, or uploading 2.0 would take it away.

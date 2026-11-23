# Measurement app jobs linked to Access

Written 23 November 2026, for measurement app 2.66, and 2.67 (link by typing the Access estimate number; the estimate number shows on every linked job).

## What Andrew asked for

* New customers in Access load into the measurement app by themselves.
* Every job has a link to its Access customer, like a dealer order does.
* The jobs already in the app (23 November and earlier) are linked once
  where they can be, and the rest are flagged for linking by hand.
* The status comes one way from Access, in Access's own status names.
  Changing the status in the app is gone.
* New customers start coming in from 24 November. Changed the same
  evening, after the first send: every customer at Initial Visit Booked
  whose visit date (Estimates.MeasureDate) is today or later gets a job,
  unless a job already has them or a flagged job might.

## The path

1. `powershell/gidc-measurement-sync.ps1` on SVR-GDDC, hourly at :27 as
   the task "GIDC measurement sync", reads Estimates (left joined to
   Orders on OrderID) for the last three years, leaves out the dealer
   tags (SFD, CIN, CDC, PIT) and sale type 4 (Deal Doors), and posts
   them to the `measurement-sync` edge function with `GIDC_KPI_KEY`.
2. The function replaces `access_customers` and runs
   `gidc_sync_measurement_jobs()` (in `sql/measurement-access-link.sql`):
   statuses first, then matching the unlinked jobs, then making jobs for
   new Access customers created on or after
   `access_job_settings.new_jobs_from` (24 November 2026).
3. The app reads `jobs.access_*` with the job list.

## Decisions

* The link is the EstimateID (`jobs.access_estimate_id`), because the
  estimate is the customer record from the first call. The OrderNo is
  kept beside it for the screen. Never the OrderID.
* The status shown is the estimate status until Access has a SalesDate
  and an order status, then the order status
  (`gidc_acc_status()`, one function to change).
* Matching: the whole name (first and surname) adds 40 when the job has
  nothing else typed, 20 when it has a phone, email or street number
  (added after the first send: reps often type only the name). Two
  equally strong matches near the job's date are flagged unless they
  share a phone or street number. Email 50, phone 50, surname in the job name 30, street number
  and street 40 (number alone 15), city 5. 70 or more counts. The Access
  customer must be created between 180 days before and 45 days after the
  job's date. Two such matches within 14 days of each other, a match
  already on another job, or only an old match: flagged with the reason.
* A job the sync made and somebody deleted is never made again
  (`access_jobs_made`).
* A rep can no longer delete a job linked to Access; an administrator can.
* "Hide closed jobs" became "Hide completed jobs": Orders.CompletedDate.
* The old Active / Downloaded / Closed is still kept inside the job for
  the delete rule only. It is not shown and cannot be set.
* Linking by hand, searching the Access list and seeing suggestions all
  go through `can_link_access_jobs()`, administrators for now.

## Not verified yet

* Which Estimates columns hold the address, city, phone and email. Nothing
  here had read them before. The script picks them by name and the TRY
  says which it picked.
* That every Estimates row has an OrderID with an OrderNo before it is
  sold. The TRY counts it.
* The real status names and SortOrder, which the TRY prints.

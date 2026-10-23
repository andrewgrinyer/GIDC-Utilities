# What is not in this archive

> **Update 23 Oct 2026, after the move to GitHub.** Now in the repo:
> `tools-site/` (gidc-tools-2.9.zip), `dealer-portal/` (dealer-portal-1.99.zip)
> and `measurement-app/` (measurement-app-1.9.zip, 16 Oct 2026). Still
> missing: none of the four edge functions (`create-dealer-user`, `kpi-import`, `send-goback` and `send-order` recovered 23 Oct); `portal.src.html` and `build.py`, the
> older SQL, and the test suites.

Being straight about the gaps, because a backup you trust wrongly is
worse than one you know the shape of.

My scratch workspace was reclaimed between 21 and 23 October. It is
temporary by design and there is no setting that makes it permanent. The
files below existed only there, so this archive cannot contain them. None
of this affects anything deployed: the sites and the database are running
and unchanged.

## The web applications, all of them

| what | where to get it |
|---|---|
| the dealer portal | `dealer-portal-1.99.zip`, sent 20 October. Holds the built `index.html`. |
| the tools site, all ten tools | `gidc-tools-2.9.zip`, sent 20 October. Holds the landing page, `gate.js`, `guard.js` and the dashboard. |
| the measurement app | nowhere but the live site. Save the page from `measurement.gidc.ca`. |

`portal.src.html`, the commented source the portal is built from, and
`build.py` that builds it, existed only in the workspace. The built
`index.html` in that zip is the same content with the version stamped in,
so work can continue from it, but the separation of source and build is
gone and would need rebuilding.

## The edge functions

**Update 23 Oct 2026:** `create-dealer-user` is now recovered, in
`supabase/functions/create-dealer-user/index.ts`. `kpi-import` is also
recovered (23 Oct), in `supabase/functions/kpi-import/index.ts`. `send-goback` is also
recovered (23 Oct), in `supabase/functions/send-goback/index.ts`. `send-order` (called
`send-order-function` below) is also recovered (23 Oct), in
`supabase/functions/send-order/index.ts`. None remain.
`dealer-sync` (new, 23 Oct) is also in the repo, in
`supabase/functions/dealer-sync/index.ts`.

Every edge function now has its source in this repo. If one is ever
changed in the Supabase editor directly, copy it back here the same day,
or this goes stale again.

## The older SQL

About forty files from September and early October, covering the original
portal setup, the pricing tables, the pallets, the go backs, the door
name aliases and the Access sync. All of them have been run, so what they
built is in the database and the database is the real record. The files
themselves are in this conversation as downloads if any are needed again.

The three in `sql/` are the ones that matter now: two of them have not
been applied yet.

## The test suites

About twenty Playwright suites and a dozen SQL ones, several hundred
checks between them, covering the search box, the pricing, the astragal
rules, the pallets, the reopen notes, the reorder flow, the measurement
mismatch warnings, the access link, the read only dashboard and the trend
lines. These existed only in the workspace.

That is the loss that matters most and is least visible. The features
still work; what is gone is the ability to prove a future change has not
broken them without writing the tests again.

## How to not be here again

Link a GitHub account at **claude.ai/customize/connectors**. GitHub is
reachable from this workspace; the account simply is not connected. Once
it is, all of this goes into a private repository, gets cloned back at the
start of any session, and carries its own history so a change that breaks
something can be read back line by line.

That is the fix. Everything else is a zip that goes stale.

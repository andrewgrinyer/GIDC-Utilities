// Supabase Edge Function: kpi-import
//
// The door the nightly PowerShell job pushes numbers through.
//
// WHY THIS EXISTS RATHER THAN THE SERVER WRITING STRAIGHT TO THE DATABASE
//
// Writing to kpi_daily directly would mean a key on a file server that can
// read and write the whole database: every order, every customer, every
// price. This function takes one long random secret instead, and the only
// thing that secret can do is put numbers into the dashboard. If it ever
// leaks, the worst anyone can do is make the graphs wrong.
//
// It also means the server never needs a Supabase login, never has to
// refresh a token, and never holds anything that expires.
//
// Deploy:  Supabase dashboard, Edge Functions, Deploy a new function, Via
//          Editor, named exactly kpi-import. Paste this in and deploy.
//
// Secrets it reads, set under Edge Functions, Secrets:
//   KPI_IMPORT_KEY   required. A long random string you generate. In
//                    PowerShell: -join ((48..57)+(65..90)+(97..122) |
//                    Get-Random -Count 48 | % {[char]$_})
//
// WHAT IT ACCEPTS
//   POST, with these headers:
//     apikey:        the publishable key (public, carries no rights here)
//     Authorization: Bearer <the same publishable key>
//     x-gidc-key:    the secret above
//   and this body:
//     { "rows": [ {"metric":"sold_orders","date":"2026-10-13","value":42,
//                  "dim":"Peter"},      // dim optional: who it belongs to
//                 ... ],
//       "source": "access",          // optional, recorded against each row
//       "refresh_portal": true }     // optional, default true
//
// The publishable key is there only because Supabase's gateway wants a
// token before it will route the request. It is already public in every
// page on the site and grants nothing. The x-gidc-key header is what
// actually authorises the write.
//
// WHAT IT DOES
//   Checks the secret, checks every row, writes them all or none, then
//   refreshes the two wholesale numbers out of dealer_orders. It replaces
//   a day that is already there rather than adding a second one, so the
//   same night can be imported twice with no harm, and a correction in
//   Access lands by running it again.

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-gidc-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });

const DEADLINE_MS = 25000;

async function call(what: string, url: string, init: RequestInit, ms = DEADLINE_MS) {
  const started = Date.now();
  const stop = new AbortController();
  const timer = setTimeout(() => stop.abort(), ms);
  try {
    const r = await fetch(url, { ...init, signal: stop.signal });
    console.log(`${what}: ${r.status} in ${Date.now() - started}ms`);
    return r;
  } catch (e) {
    const how = (e as Error)?.name === "AbortError"
      ? `gave up after ${ms}ms`
      : `failed: ${(e as Error)?.message ?? e}`;
    console.log(`${what}: ${how} (${Date.now() - started}ms)`);
    throw new Error(`${what} ${how}`);
  } finally {
    clearTimeout(timer);
  }
}

/* Compared character by character to the end whether or not it matches, so
   the time taken says nothing about how much of the secret was right. */
function sameSecret(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MAX_ROWS = 5000;

type Row = { metric?: string; date?: string; value?: number | string | null;
              dim?: string | null };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const t0 = Date.now();
  try {
    const url = Deno.env.get("SUPABASE_URL") ?? "";
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const secret = Deno.env.get("KPI_IMPORT_KEY") ?? "";

    if (!url || !service) {
      console.log("missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
      return json({ error: "This function cannot see its own environment. " +
        "Those are set by Supabase, so it may need deploying again." }, 500);
    }
    if (!secret)
      return json({ error: "No import key is set up yet. Add KPI_IMPORT_KEY " +
        "under Edge Functions, Secrets." }, 400);

    const given = req.headers.get("x-gidc-key") ?? "";
    if (!given || !sameSecret(given, secret)) {
      console.log("refused: wrong or missing x-gidc-key");
      return json({ error: "Not allowed" }, 401);
    }

    let body: { rows?: Row[]; source?: string; refresh_portal?: boolean };
    try { body = await req.json(); } catch { return json({ error: "Bad request" }, 400); }

    const rows = Array.isArray(body.rows) ? body.rows : [];
    if (!rows.length) return json({ error: "No rows" }, 400);
    if (rows.length > MAX_ROWS)
      return json({ error: `Too many rows in one go. Send at most ${MAX_ROWS} ` +
        `and split a backfill across several calls.` }, 413);

    const source = String(body.source ?? "access").slice(0, 40);
    const asAdmin = { apikey: service, Authorization: `Bearer ${service}`,
                      "Content-Type": "application/json" };

    // Which metrics exist, so a typo in a metric name is caught here with a
    // sentence rather than landing as a foreign key error nobody can read.
    const mres = await call("read the metric list",
      `${url}/rest/v1/kpi_metrics?select=key`, { headers: asAdmin });
    if (!mres.ok) return json({ error: "Could not read the metric list" }, 502);
    const known = new Set(((await mres.json()) as { key: string }[]).map((m) => m.key));

    // Every row is checked before any of them is written: a half imported
    // night is worse than one that did not run.
    const clean: { metric: string; on_date: string; dim: string; value: number;
                   source: string; entered_by: string }[] = [];
    const refused: string[] = [];
    let lo = "9999-12-31", hi = "0000-01-01";

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i] ?? {};
      const metric = String(r.metric ?? "").trim();
      const date = String(r.date ?? "").trim();
      const raw = r.value;

      if (!known.has(metric)) { refused.push(`row ${i + 1}: no metric called "${metric}"`); continue; }
      if (!DAY.test(date))    { refused.push(`row ${i + 1}: "${date}" is not a date like 2026-10-13`); continue; }
      if (raw === null || raw === undefined || raw === "") {
        refused.push(`row ${i + 1}: ${metric} on ${date} has no value`); continue;
      }
      const value = Number(raw);
      if (!isFinite(value)) { refused.push(`row ${i + 1}: ${metric} on ${date} is not a number`); continue; }

      // dim is what the number is broken down by: a salesperson for the
      // two that are split, empty for everything else. Empty rather than
      // absent, so a row sent without one still lands on the same key.
      const dim = String(r.dim ?? "").trim().slice(0, 80);
      clean.push({ metric, on_date: date, dim, value, source, entered_by: "import" });
      if (date < lo) lo = date;
      if (date > hi) hi = date;
    }

    if (refused.length) {
      console.log(`refused ${refused.length} of ${rows.length}: ${refused.slice(0, 5).join("; ")}`);
      return json({ error: "Nothing was written. Some rows do not make sense.",
                    refused: refused.slice(0, 40),
                    refused_count: refused.length }, 400);
    }

    // merge-duplicates makes a day that is already there get replaced
    // rather than collide, so running the same night twice is harmless and
    // a correction in Access lands by running it again.
    const wres = await call(`write ${clean.length} rows`,
      `${url}/rest/v1/kpi_daily?on_conflict=metric,on_date,dim`, {
        method: "POST",
        headers: { ...asAdmin, Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify(clean),
      });
    if (!wres.ok) {
      const said = await wres.text().catch(() => "");
      console.log("the write was refused: " + said.slice(0, 400));
      return json({ error: "The database would not take the numbers",
                    detail: said.slice(0, 300) }, 502);
    }

    // The two wholesale numbers are already in this database, so they are
    // rebuilt here rather than carried across the internet from a server
    // that would only be reading them back from the same place.
    let portal: number | string = "skipped";
    if (body.refresh_portal !== false) {
      const pres = await call("refresh the wholesale numbers",
        `${url}/rest/v1/rpc/kpi_refresh_portal`, {
          method: "POST", headers: asAdmin,
          body: JSON.stringify({ from_day: lo, to_day: hi }),
        });
      portal = pres.ok ? ((await pres.json().catch(() => 0)) as number) : "failed";
      if (!pres.ok) console.log("the wholesale refresh did not run: " + pres.status);
    }

    // Andrew, 15 October: incoming leads is first time callers plus web
    // submissions, the two lines printed above it. Whenever either half
    // arrives the total is rebuilt for the days that moved, so the three
    // lines can never disagree with each other. Only the days that
    // moved, not the whole batch: a backfill sends years at a time and
    // there is no sense rewriting a total nothing changed under.
    let leads: number | string = "skipped";
    const halves = clean.filter(r => r.metric === "phone_leads_new" ||
                                     r.metric === "web_leads");
    if (halves.length) {
      let llo = halves[0].on_date, lhi = halves[0].on_date;
      for (const r of halves) {
        if (r.on_date < llo) llo = r.on_date;
        if (r.on_date > lhi) lhi = r.on_date;
      }
      const lres = await call("rebuild the incoming leads total",
        `${url}/rest/v1/rpc/kpi_refresh_leads`, {
          method: "POST", headers: asAdmin,
          body: JSON.stringify({ from_day: llo, to_day: lhi }),
        });
      leads = lres.ok ? ((await lres.json().catch(() => 0)) as number) : "failed";
      // Not fatal. The halves are in and correct; only the line that adds
      // them up is stale, and the next run puts it right.
      if (!lres.ok) console.log("the leads total was not rebuilt: " + lres.status);
    }

    console.log(`wrote ${clean.length} rows for ${lo} to ${hi} in ${Date.now() - t0}ms`);
    return json({ ok: true, written: clean.length, from: lo, to: hi,
                  wholesale_days: portal, lead_days: leads });
  } catch (e) {
    console.log("fell over: " + ((e as Error)?.message ?? e));
    return json({ error: (e as Error)?.message ?? "Something went wrong" }, 500);
  }
});

// Supabase Edge Function: web-leads
//
// Marks the web leads in the Google Sheet Not Booked, Booked or Sold,
// with the sold price (Andrew, 26 November 2026). Two callers, one secret:
//
//   the office server (gidc-web-leads-sync.ps1, hourly) sends every
//   retail estimate from Access, sold or not (sold_on empty):
//     { "action": "load",
//       "sales": [ { "estimate_id": 9123, "first_name": "Ann", "last_name": "Ray",
//                    "emails": "a@b.ca; c@d.com", "phones": "519 555 1234 cell",
//                    "created_on": "2026-01-05", "sold_on": "2026-01-20",
//                    "price": 8123.45 } ],
//       "counts": { ... what the script read ... } }
//
//   the script in the Google Sheet (apps-script/gidc-web-leads.gs, hourly)
//   asks about its leads, and is answered one line per lead:
//     { "action": "match",
//       "leads": [ { "row": 2, "day": "2026-01-05", "email": "...",
//                    "phone": "...", "name": "...", "first": "...", "last": "..." } ] }
//     -> { "results": [ { "row": 2, "status": "Sold", "price": 8123.45,
//                         "sold_on": "2026-01-20", "by": "email" } ],
//          "sales_sent_at": "...", "sales_loaded": 1388 }
//   Nothing the sheet sends for a match is kept. The rules are in
//   web_leads_match(), sql/web-leads-sold.sql.
//
//   the same script (sendLeadsToTracker, every five minutes) sends the
//   last 30 days of leads to the Web Leads tracker on the tools site
//   (Andrew, 26 November 2026). These ARE kept, in web_lead_tracker,
//   so the receptionist can call them back:
//     { "action": "track",
//       "leads": [ { "key": "9f2c...", "received_at": "2026-11-26T14:03:00.000Z",
//                    "day": "2026-11-26", "row": 3512, "first": "Ann", "last": "Ray",
//                    "name": "", "email": "...", "phone": "...",
//                    "details": [ ["City", "..."], ["Message", "..."] ] } ] }
//   details are every other column of the row, in the sheet's order.
//     -> { "sent": 41, "added": 2 }
//   With "statuses": true it also answers every lead's status in the
//   tracker, { "statuses": { "9f2c...": "NEW LEAD", ... } }, which the
//   sheet writes into its Lead Status column, and every lead's notes,
//   { "notes": { "9f2c...": "26 Nov 2026, Reception: left a voicemail" } },
//   for its Lead Notes column. Leads more than two months
//   old that nobody has touched are marked Sold or Lead No Response - Dead
//   by the load itself (web_lead_age_out).
//   A lead already there keeps its status, notes and Access link; only
//   the sheet's own details are refreshed. Rules in
//   web_lead_tracker_load(), sql/web-leads-tracker.sql.
//
// Deploy:  Supabase dashboard, Edge Functions, Deploy a new function, Via
//          Editor, named exactly web-leads. Paste this in and deploy. Turn
//          Verify JWT off for it, like sales-map-sync: both callers sign in
//          with the import key, not as a person. Needs sql/web-leads-sold.sql
//          for load and match, and sql/web-leads-tracker.sql for track.
//
// Secrets it reads, under Edge Functions, Secrets:
//   KPI_IMPORT_KEY   the same one the KPI import, the syncs and the sheet's
//                    nightly count already use. Nothing new to add.
//
// Headers on every call:
//   apikey:        the publishable key (public, carries no rights here)
//   Authorization: Bearer <the same publishable key>
//   x-gidc-key:    the secret above

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
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MAX_SALES = 60000;
const MAX_LEADS = 30000;
const MAX_TRACK = 5000;
const KEY = /^[0-9a-f]{16,64}$/;

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

function sameSecret(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const day = (v: unknown) => v == null || v === "" ? null : String(v).slice(0, 10);
const text = (v: unknown, n: number) => v == null ? null : (String(v).trim().slice(0, n) || null);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  try {
    const url = Deno.env.get("SUPABASE_URL") ?? "";
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const secret = Deno.env.get("KPI_IMPORT_KEY") ?? "";
    if (!url || !service)
      return json({ error: "This function cannot see its own environment. " +
        "Those are set by Supabase, so it may need deploying again." }, 500);
    if (!secret)
      return json({ error: "No import key is set up yet. Add KPI_IMPORT_KEY " +
        "under Edge Functions, Secrets." }, 400);

    const given = req.headers.get("x-gidc-key") ?? "";
    if (!given || !sameSecret(given, secret)) {
      console.log("refused: wrong or missing x-gidc-key");
      return json({ error: "Not allowed" }, 401);
    }

    let body: { action?: string; sales?: Record<string, unknown>[];
                leads?: Record<string, unknown>[]; counts?: unknown };
    try { body = await req.json(); } catch { return json({ error: "Bad request" }, 400); }

    const asAdmin = { apikey: service, Authorization: `Bearer ${service}`,
                      "Content-Type": "application/json" };

    // ---- the server's hourly load -----------------------------------
    if (body.action === "load") {
      if (!Array.isArray(body.sales)) return json({ error: "No sales" }, 400);
      if (body.sales.length > MAX_SALES)
        return json({ error: `Too many sales in one go. Send at most ${MAX_SALES}.` }, 413);
      const rows: Record<string, unknown>[] = [];
      const dropped: string[] = [];
      for (const s of body.sales) {
        const id = Number(s.estimate_id);
        if (!Number.isInteger(id) || id <= 0) { dropped.push(`estimate_id ${s.estimate_id}`); continue; }
        const sold = day(s.sold_on), made = day(s.created_on);
        if ((sold && !DAY.test(sold)) || (made && !DAY.test(made)) || (!sold && !made)) {
          dropped.push(`estimate ${id}: no date that makes sense`); continue;
        }
        const price = s.price == null || s.price === "" ? null : Number(s.price);
        rows.push({
          estimate_id: id,
          first_name: text(s.first_name, 80),
          last_name: text(s.last_name, 80),
          emails: text(s.emails, 400),
          phones: text(s.phones, 400),
          created_on: made,
          sold_on: sold,
          price: price != null && Number.isFinite(price) ? price : null,
        });
      }
      const counts = body.counts && typeof body.counts === "object" ? body.counts : null;
      const ran = await call("load", `${url}/rest/v1/rpc/web_lead_sales_load`,
        { method: "POST", headers: asAdmin, body: JSON.stringify({ p_rows: rows, p_counts: counts }) });
      if (!ran.ok) return json({ error: "The sales would not load", detail: await ran.text() }, 500);
      const did = await ran.json();
      return json({ sent: body.sales.length, dropped: dropped.length ? dropped.slice(0, 50) : undefined, ...did });
    }

    // ---- the sheet's question ---------------------------------------
    if (body.action === "match") {
      if (!Array.isArray(body.leads)) return json({ error: "No leads" }, 400);
      if (body.leads.length > MAX_LEADS)
        return json({ error: `Too many leads in one go. Send at most ${MAX_LEADS}.` }, 413);
      const leads = body.leads.map((l) => ({
        row: Number(l.row),
        day: day(l.day),
        email: text(l.email, 400),
        phone: text(l.phone, 400),
        name: text(l.name, 200),
        first: text(l.first, 100),
        last: text(l.last, 100),
      })).filter((l) => Number.isInteger(l.row) && l.row > 0);

      const ran = await call("match", `${url}/rest/v1/rpc/web_leads_match`,
        { method: "POST", headers: asAdmin, body: JSON.stringify({ p_leads: leads }) });
      if (!ran.ok) return json({ error: "Could not check the leads", detail: await ran.text() }, 500);
      const results = await ran.json();

      // when Access last sent, so the sheet can say if the list is stale
      let sentAt: string | null = null, loaded: number | null = null;
      const last = await call("last run",
        `${url}/rest/v1/web_lead_sales_runs?id=eq.1&select=sent_at,loaded`, { headers: asAdmin });
      if (last.ok) {
        const r = await last.json();
        if (Array.isArray(r) && r[0]) { sentAt = r[0].sent_at; loaded = r[0].loaded; }
      }
      return json({ results, sales_sent_at: sentAt, sales_loaded: loaded });
    }

    // ---- the sheet's new leads, for the tracker ---------------------
    if (body.action === "track") {
      if (!Array.isArray(body.leads)) return json({ error: "No leads" }, 400);
      if (body.leads.length > MAX_TRACK)
        return json({ error: `Too many leads in one go. Send at most ${MAX_TRACK}.` }, 413);
      const leads: Record<string, unknown>[] = [];
      let dropped = 0;
      for (const l of body.leads) {
        const key = String(l.key ?? "");
        if (!KEY.test(key)) { dropped++; continue; }
        const rcv = l.received_at == null ? null : new Date(String(l.received_at));
        const details: [string, string][] = [];
        if (Array.isArray(l.details)) {
          for (const pair of (l.details as unknown[]).slice(0, 60)) {
            if (!Array.isArray(pair)) continue;
            const t = text(pair[1], 4000);
            if (t) details.push([String(pair[0] ?? "").slice(0, 80), t]);
          }
        }
        const d = day(l.day);
        leads.push({
          key,
          received_at: rcv && !isNaN(rcv.getTime()) ? rcv.toISOString() : null,
          day: d && DAY.test(d) ? d : null,
          row: Number.isInteger(Number(l.row)) ? Number(l.row) : null,
          first: text(l.first, 100),
          last: text(l.last, 100),
          name: text(l.name, 200),
          email: text(l.email, 400),
          phone: text(l.phone, 400),
          details,
        });
      }
      const ran = await call("track", `${url}/rest/v1/rpc/web_lead_tracker_load`,
        { method: "POST", headers: asAdmin, body: JSON.stringify({ p_leads: leads }) });
      if (!ran.ok) return json({ error: "The leads would not load into the tracker", detail: await ran.text() }, 500);
      const did = await ran.json();
      let statuses: unknown = undefined, notes: unknown = undefined;
      if ((body as { statuses?: boolean }).statuses === true) {
        const st = await call("statuses", `${url}/rest/v1/rpc/web_lead_sheet_statuses`,
          { method: "POST", headers: asAdmin, body: "{}" });
        if (st.ok) statuses = await st.json();
        const nt = await call("notes", `${url}/rest/v1/rpc/web_lead_sheet_notes`,
          { method: "POST", headers: asAdmin, body: "{}" });
        if (nt.ok) notes = await nt.json();
      }
      return json({ ...did, dropped: dropped || undefined, statuses, notes });
    }

    return json({ error: "Say which: action load, match or track" }, 400);
  } catch (e) {
    console.log("failed:", (e as Error)?.message ?? e);
    return json({ error: (e as Error)?.message ?? "Something went wrong" }, 500);
  }
});

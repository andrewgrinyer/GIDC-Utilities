// Supabase Edge Function: sales-map-sync
//
// The door the hourly PowerShell job (gidc-sales-map-sync.ps1) pushes the
// Sales Map through: every retail customer from the Estimates side of
// Access, with the in home visit, showroom and sale dates, and where the
// address sits on the map. Sibling of supplies-sync, built the same way:
// one secret, plain HTTP, no imports.
//
// Deploy:  Supabase dashboard, Edge Functions, Deploy a new function, Via
//          Editor, named exactly sales-map-sync. Paste this in and deploy.
//          Turn Verify JWT off for it, like supplies-sync: the server signs
//          in with the import key, not as a person. Needs sql/sales-map.sql.
//
// Secrets it reads, under Edge Functions, Secrets:
//   KPI_IMPORT_KEY   the same one the KPI import, dealer sync and supplies
//                    sync already use. Nothing new to add.
//
// WHAT IT ACCEPTS
//   POST, with these headers:
//     apikey:        the publishable key (public, carries no rights here)
//     Authorization: Bearer <the same publishable key>
//     x-gidc-key:    the secret above
//   and this body:
//     { "customers": [ { "estimate_id": 9123, "order_no": "5067",
//                        "name": "Aris", "address": "1 Main St",
//                        "city": "Cambridge", "postal": "N1R 1A1",
//                        "created_on": "2026-01-05", "measure_on": "2026-01-10",
//                        "showroom_on": null, "sold_on": "2026-01-20",
//                        "lat": 43.39, "lng": -80.31, "placed_by": "address" } ],
//       "showrooms": [ { "name": "Cambridge", "lat": 43.4, "lng": -80.3 } ],
//       "counts": { ... what the script read, shown on the page ... } }
//
// WHAT IT DOES
//   Checks every customer, then hands the lot to sales_map_load() in one
//   call, which replaces every customer, all or nothing.

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

const MAX_ROWS = 60000;

const day = (v: unknown) => v == null || v === "" ? null : String(v).slice(0, 10);
const text = (v: unknown, n: number) => v == null ? null : (String(v).trim().slice(0, n) || null);
const num = (v: unknown) => v == null || v === "" ? null : Number(v);

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

    let body: { customers?: Record<string, unknown>[]; showrooms?: Record<string, unknown>[];
                counts?: unknown };
    try { body = await req.json(); } catch { return json({ error: "Bad request" }, 400); }
    if (!Array.isArray(body.customers)) return json({ error: "No customers" }, 400);
    if (body.customers.length > MAX_ROWS)
      return json({ error: `Too many customers in one go. Send at most ${MAX_ROWS}.` }, 413);

    /* A customer that does not make sense is dropped and named by estimate
       number, never guessed at. A place that does not make sense is
       dropped on its own, so the customer still counts, just off the map. */
    const rows: Record<string, unknown>[] = [];
    const dropped: string[] = [];
    for (const c of body.customers) {
      const id = Number(c.estimate_id);
      if (!Number.isInteger(id) || id <= 0) { dropped.push(`estimate_id ${c.estimate_id}`); continue; }
      const created = day(c.created_on);
      if (!created || !DAY.test(created)) { dropped.push(`estimate ${id}: no estimate date`); continue; }
      const dates: Record<string, string | null> = {};
      let bad = false;
      for (const k of ["measure_on", "showroom_on", "sold_on"]) {
        const d = day(c[k]);
        if (d && !DAY.test(d)) bad = true;
        dates[k] = d;
      }
      if (bad) { dropped.push(`estimate ${id}: a date`); continue; }
      let lat = num(c.lat), lng = num(c.lng);
      let placed = text(c.placed_by, 20);
      if (lat == null || lng == null || !Number.isFinite(lat) || !Number.isFinite(lng) ||
          Math.abs(lat) > 90 || Math.abs(lng) > 180 ||
          (placed !== "address" && placed !== "postal")) {
        lat = null; lng = null; placed = null;
      }
      rows.push({
        estimate_id: id,
        order_no: text(c.order_no, 40),
        name: text(c.name, 120),
        address: text(c.address, 200),
        city: text(c.city, 80),
        postal: text(c.postal, 12),
        created_on: created, ...dates,
        lat, lng, placed_by: placed,
      });
    }
    const showrooms = (Array.isArray(body.showrooms) ? body.showrooms : [])
      .map((s) => ({ name: text(s.name, 60), lat: num(s.lat), lng: num(s.lng) }))
      .filter((s) => s.name && s.lat != null && s.lng != null &&
        Number.isFinite(s.lat) && Number.isFinite(s.lng) &&
        Math.abs(s.lat) <= 90 && Math.abs(s.lng) <= 180);
    const counts = body.counts && typeof body.counts === "object" ? body.counts : null;

    const asAdmin = { apikey: service, Authorization: `Bearer ${service}`,
                      "Content-Type": "application/json" };
    const ran = await call("load", `${url}/rest/v1/rpc/sales_map_load`,
      { method: "POST", headers: asAdmin,
        body: JSON.stringify({ p_rows: rows, p_showrooms: showrooms, p_counts: counts }) });
    if (!ran.ok)
      return json({ error: "The map would not load", detail: await ran.text() }, 500);
    const did = await ran.json();

    return json({
      sent: body.customers.length,
      loaded: rows.length,
      showrooms: showrooms.length,
      dropped: dropped.length ? dropped.slice(0, 50) : undefined,
      ...did,
    });
  } catch (e) {
    console.log("failed:", (e as Error)?.message ?? e);
    return json({ error: (e as Error)?.message ?? "Something went wrong" }, 500);
  }
});

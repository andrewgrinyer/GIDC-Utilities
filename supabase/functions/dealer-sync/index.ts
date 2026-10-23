// Supabase Edge Function: dealer-sync
//
// The door the hourly PowerShell job pushes dealer order statuses and
// packaging dates through. Sibling of kpi-import, built the same way and
// on purpose: one secret, one place to read it, nothing new to manage.
//
// Deploy:  Supabase dashboard, Edge Functions, Deploy a new function, Via
//          Editor, named exactly dealer-sync. Paste this in and deploy.
//
// Secrets it reads, under Edge Functions, Secrets:
//   KPI_IMPORT_KEY   the same one the KPI import already uses. No new
//                    secret: the server would only have to hold two.
//
// WHAT IT ACCEPTS
//   POST, with these headers:
//     apikey:        the publishable key (public, carries no rights here)
//     Authorization: Bearer <the same publishable key>
//     x-gidc-key:    the secret above
//   and this body:
//     { "orders": [ { "order_id": 4975, "order_no": "4973",
//                     "tag": "SFD", "last_name": "Abraham",
//                     "street_number": "6938", "order_status_id": 5,
//                     "packed_on": "2026-10-21" }, ... ] }
//
// WHAT IT DOES
//   Replaces the whole staging table with what it was sent, then runs
//   gidc_sync_dealer_orders(), which is where every decision about what
//   may move actually lives. This function holds no rules of its own, so
//   changing the status mapping is a line of SQL and never a redeploy.
//
// WHAT IT CANNOT DO
//   Move an order the portal has as a draft, or move anything on a key
//   that fits more than one order. Both of those are refused by the SQL
//   rather than by this function.

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
const MAX_ORDERS = 5000;
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

/* Compared character by character to the end whether or not it matches, so
   the time taken says nothing about how much of the secret was right. */
function sameSecret(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

type Incoming = {
  order_id?: number | string;
  order_no?: string | null;
  tag?: string;
  last_name?: string;
  street_number?: string | null;
  order_status_id?: number | string | null;
  packed_on?: string | null;
};

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

    let body: { orders?: Incoming[] };
    try { body = await req.json(); } catch { return json({ error: "Bad request" }, 400); }

    const incoming = Array.isArray(body.orders) ? body.orders : [];
    if (!incoming.length) return json({ error: "No orders" }, 400);
    if (incoming.length > MAX_ORDERS)
      return json({ error: `Too many orders in one go. Send at most ${MAX_ORDERS}.` }, 413);

    /* Checked here rather than trusted, because the staging table is the
       only thing standing between a typo on the server and a wrong status
       on a live order. A row that does not make sense is dropped and
       counted, never guessed at. */
    const rows: Record<string, unknown>[] = [];
    const dropped: string[] = [];
    for (const o of incoming) {
      const id = Number(o.order_id);
      if (!Number.isInteger(id) || id <= 0) { dropped.push(`order_id ${o.order_id}`); continue; }
      const tag = String(o.tag ?? "").trim().toUpperCase();
      const last = String(o.last_name ?? "").trim();
      if (!tag || !last) { dropped.push(`order ${id}: no tag or no surname`); continue; }
      const packed = o.packed_on == null ? null : String(o.packed_on).slice(0, 10);
      if (packed !== null && !DAY.test(packed)) { dropped.push(`order ${id}: date ${o.packed_on}`); continue; }
      const status = o.order_status_id == null ? null : Number(o.order_status_id);
      if (status !== null && !Number.isInteger(status)) { dropped.push(`order ${id}: status ${o.order_status_id}`); continue; }
      rows.push({
        order_id: id,
        order_no: o.order_no == null ? null : String(o.order_no).slice(0, 40),
        tag: tag.slice(0, 10),
        last_name: last.slice(0, 120),
        street_number: o.street_number == null ? null : String(o.street_number).replace(/\D/g, "").slice(0, 20),
        order_status_id: status,
        packed_on: packed,
        pulled_at: new Date().toISOString(),
      });
    }
    if (!rows.length)
      return json({ error: "Nothing in that was usable", dropped }, 400);

    const asAdmin = { apikey: service, Authorization: `Bearer ${service}`,
                      "Content-Type": "application/json" };

    /* The whole table is replaced rather than merged. An order that has
       left Access, or left the dealer tags, should stop being considered,
       and the surest way to mean that is for it not to be there. */
    const wipe = await call("clear staging",
      `${url}/rest/v1/access_dealer_orders?order_id=gt.0`,
      { method: "DELETE", headers: { ...asAdmin, Prefer: "return=minimal" } });
    if (!wipe.ok)
      return json({ error: "Could not clear the staging table", detail: await wipe.text() }, 500);

    const put = await call("stage orders",
      `${url}/rest/v1/access_dealer_orders`,
      { method: "POST", headers: { ...asAdmin, Prefer: "return=minimal" },
        body: JSON.stringify(rows) });
    if (!put.ok)
      return json({ error: "Could not write the staging table", detail: await put.text() }, 500);

    /* and the rules, which live in SQL */
    const ran = await call("sync", `${url}/rest/v1/rpc/gidc_sync_dealer_orders`,
      { method: "POST", headers: asAdmin, body: "{}" });
    if (!ran.ok)
      return json({ error: "The sync itself failed", detail: await ran.text() }, 500);
    const changes = await ran.json();

    const left = await call("unmatched",
      `${url}/rest/v1/dealer_orders_unmatched?select=order_ref`,
      { headers: { ...asAdmin, Prefer: "count=exact", Range: "0-0" } });
    let unmatched: number | null = null;
    if (left.ok) {
      const range = left.headers.get("content-range") ?? "";
      const n = Number(range.split("/")[1]);
      if (Number.isFinite(n)) unmatched = n;
    }

    return json({
      staged: rows.length,
      dropped: dropped.length ? dropped : undefined,
      matched: Array.isArray(changes) ? changes.length : 0,
      changed: Array.isArray(changes) ? changes.length : 0,
      changes,
      unmatched,
    });
  } catch (e) {
    console.log("failed:", (e as Error)?.message ?? e);
    return json({ error: (e as Error)?.message ?? "Something went wrong" }, 500);
  }
});

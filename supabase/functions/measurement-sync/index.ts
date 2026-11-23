// Supabase Edge Function: measurement-sync
//
// The door the hourly PowerShell job on the office server pushes the
// retail customers in Access through, for the measurement app. Sibling of
// dealer-sync, built the same way: one secret, nothing new to manage.
//
// Deploy:  Supabase dashboard, Edge Functions, Deploy a new function, Via
//          Editor, named exactly measurement-sync. Paste this in, and turn
//          Verify JWT OFF (the server sends the publishable key, which is
//          not a JWT). Deploy.
//
// Secrets it reads, under Edge Functions, Secrets:
//   KPI_IMPORT_KEY   the same one the KPI import and the dealer sync use.
//
// WHAT IT ACCEPTS
//   POST, with headers apikey and Authorization (the publishable key) and
//   x-gidc-key (the secret above), and this body:
//     { "preview": false,
//       "customers": [ { "estimate_id": 8123, "order_id": 8125,
//         "order_no": "8123", "first_name": "Mary", "last_name": "Smith",
//         "address": "12 Main St", "city": "Cambridge",
//         "phone": "5195551234", "phone2": null, "email": "m@x.ca",
//         "rep": "Nick", "created_on": "2026-11-24",
//         "measure_on": null, "sold_on": null, "completed_on": null,
//         "estimate_status_id": 1, "estimate_status": "Initial Visit Booked",
//         "estimate_status_sort": 1, "order_status_id": null,
//         "order_status": null, "order_status_sort": null,
//         "sale_type_id": 2 }, ... ] }
//
// WHAT IT DOES
//   Replaces the staging table access_customers with what it was sent,
//   then runs gidc_sync_measurement_jobs(), where every rule lives (see
//   sql/measurement-access-link.sql). With "preview": true the Access list
//   is still copied up, but the function works everything out and then
//   undoes it, so no job changes and the answer says what would have.

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

const DEADLINE_MS = 60000;
const MAX_ROWS = 30000;
const CHUNK = 1000;
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

const text = (v: unknown, max: number) => {
  if (v == null) return null;
  const s = String(v).trim();
  return s ? s.slice(0, max) : null;
};
const int = (v: unknown) => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isInteger(n) ? n : NaN;
};
const day = (v: unknown) => {
  if (v == null || v === "") return null;
  const s = String(v).slice(0, 10);
  return DAY.test(s) ? s : "bad";
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

    let body: { customers?: Record<string, unknown>[]; preview?: boolean };
    try { body = await req.json(); } catch { return json({ error: "Bad request" }, 400); }
    const incoming = Array.isArray(body.customers) ? body.customers : [];
    const preview = body.preview === true;
    if (!incoming.length) return json({ error: "No customers" }, 400);
    if (incoming.length > MAX_ROWS)
      return json({ error: `Too many customers in one go. Send at most ${MAX_ROWS}.` }, 413);

    /* Checked here rather than trusted. A row that does not make sense is
       dropped and counted, never guessed at. */
    const rows: Record<string, unknown>[] = [];
    const dropped: string[] = [];
    const seen = new Set<number>();
    const now = new Date().toISOString();
    for (const c of incoming) {
      const id = int(c.estimate_id);
      if (!id || Number.isNaN(id) || id <= 0) { dropped.push(`estimate_id ${c.estimate_id}`); continue; }
      if (seen.has(id)) { dropped.push(`estimate ${id}: sent twice`); continue; }
      const nums = ["order_id", "estimate_status_id", "estimate_status_sort", "order_status_id",
                    "order_status_sort", "sale_type_id"].map((k) => [k, int(c[k])] as const);
      const badNum = nums.find(([, v]) => Number.isNaN(v));
      if (badNum) { dropped.push(`estimate ${id}: ${badNum[0]} ${c[badNum[0]]}`); continue; }
      const days = ["created_on", "measure_on", "sold_on", "completed_on"].map((k) => [k, day(c[k])] as const);
      const badDay = days.find(([, v]) => v === "bad");
      if (badDay) { dropped.push(`estimate ${id}: ${badDay[0]} ${c[badDay[0]]}`); continue; }
      seen.add(id);
      rows.push({
        estimate_id: id,
        ...Object.fromEntries(nums), ...Object.fromEntries(days),
        order_no: text(c.order_no, 40),
        first_name: text(c.first_name, 120), last_name: text(c.last_name, 120),
        address: text(c.address, 200), city: text(c.city, 80),
        // PhoneNumbers and EmailAddresses in Access hold lists, so room for several
        phone: text(c.phone, 300), phone2: text(c.phone2, 300),
        email: text(c.email, 500), rep: text(c.rep, 120),
        estimate_status: text(c.estimate_status, 80), order_status: text(c.order_status, 80),
        pulled_at: now,
      });
    }
    if (!rows.length) return json({ error: "Nothing in that was usable", dropped }, 400);

    const asAdmin = { apikey: service, Authorization: `Bearer ${service}`,
                      "Content-Type": "application/json" };

    /* The whole list is replaced rather than merged: a customer who has
       left Access should stop being offered for linking. */
    const wipe = await call("clear staging",
      `${url}/rest/v1/access_customers?estimate_id=gt.0`,
      { method: "DELETE", headers: { ...asAdmin, Prefer: "return=minimal" } });
    if (!wipe.ok) {
      const t = await wipe.text();
      if (wipe.status === 404 || /access_customers/.test(t))
        return json({ error: "Supabase does not have the Access customer list yet. " +
          "Run measurement-access-link.sql in the SQL editor first.", detail: t }, 500);
      return json({ error: "Could not clear the staging table", detail: t }, 500);
    }
    for (let i = 0; i < rows.length; i += CHUNK) {
      const put = await call(`stage ${i + 1} to ${Math.min(i + CHUNK, rows.length)}`,
        `${url}/rest/v1/access_customers`,
        { method: "POST", headers: { ...asAdmin, Prefer: "return=minimal" },
          body: JSON.stringify(rows.slice(i, i + CHUNK)) });
      if (!put.ok)
        return json({ error: "Could not write the staging table", detail: await put.text() }, 500);
    }

    const ran = await call(preview ? "sync preview" : "sync",
      `${url}/rest/v1/rpc/gidc_sync_measurement_jobs`,
      { method: "POST", headers: asAdmin, body: JSON.stringify({ p_apply: !preview }) });
    if (!ran.ok)
      return json({ error: "The sync itself failed", detail: await ran.text() }, 500);
    const result = await ran.json();

    return json({ staged: rows.length, dropped: dropped.length ? dropped : undefined, ...result });
  } catch (e) {
    console.log("failed:", (e as Error)?.message ?? e);
    return json({ error: (e as Error)?.message ?? "Something went wrong" }, 500);
  }
});

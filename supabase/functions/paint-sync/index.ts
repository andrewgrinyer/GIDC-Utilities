// Supabase Edge Function: paint-sync
//
// The door the hourly PowerShell job (gidc-paint-sync.ps1) pushes the
// paint schedule through: per Access order and colour, how many doors,
// and the Scheduled Prime Date and Scheduled Paint Date. Sibling of
// dealer-sync, built the same way: one secret, plain HTTP, no imports.
//
// Deploy:  Supabase dashboard, Edge Functions, Deploy a new function, Via
//          Editor, named exactly paint-sync. Paste this in and deploy.
//          Needs sql/paint.sql run first.
//
// Secrets it reads, under Edge Functions, Secrets:
//   KPI_IMPORT_KEY   the same one the KPI import and the dealer sync
//                    already use. Nothing new to add.
//
// WHAT IT ACCEPTS
//   POST, with these headers:
//     apikey:        the publishable key (public, carries no rights here)
//     Authorization: Bearer <the same publishable key>
//     x-gidc-key:    the secret above
//   and this body:
//     { "keep_before": "2026-11-05",
//       "lines": [ { "order_id": 5069, "order_no": "5067", "job": "Aris",
//                    "colour": "Chantilly Lace", "doors": 12,
//                    "prime_on": "2026-11-23", "paint_on": "2026-11-24" } ] }
//
// WHAT IT DOES
//   Checks every line, then hands the lot to paint_schedule_load() in one
//   call, which replaces every day from keep_before on and every order it
//   was sent, all or nothing. Days before keep_before stay as they were,
//   so the paint used on them is not forgotten once a job is finished.
//   An empty list is allowed: it means nothing is scheduled.

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
const MAX_LINES = 20000;
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

type Incoming = {
  order_id?: number | string;
  order_no?: string | null;
  job?: string | null;
  colour?: string | null;
  doors?: number | string;
  prime_on?: string | null;
  paint_on?: string | null;
};

const day = (v: unknown) => v == null || v === "" ? null : String(v).slice(0, 10);

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

    let body: { keep_before?: string; lines?: Incoming[] };
    try { body = await req.json(); } catch { return json({ error: "Bad request" }, 400); }

    const keep = day(body.keep_before);
    if (!keep || !DAY.test(keep)) return json({ error: "keep_before must be a date" }, 400);
    if (!Array.isArray(body.lines)) return json({ error: "No lines" }, 400);
    if (body.lines.length > MAX_LINES)
      return json({ error: `Too many lines in one go. Send at most ${MAX_LINES}.` }, 413);

    /* A line that does not make sense is dropped and named, never guessed
       at, so a typo in Access shows up in the server log by order number. */
    const rows: Record<string, unknown>[] = [];
    const dropped: string[] = [];
    for (const l of body.lines) {
      const id = Number(l.order_id);
      if (!Number.isInteger(id) || id <= 0) { dropped.push(`order_id ${l.order_id}`); continue; }
      const doors = Number(l.doors);
      if (!Number.isFinite(doors) || doors < 0 || doors >= 10000) { dropped.push(`order ${id}: doors ${l.doors}`); continue; }
      const prime = day(l.prime_on), paint = day(l.paint_on);
      if ((prime && !DAY.test(prime)) || (paint && !DAY.test(paint))) { dropped.push(`order ${id}: a date`); continue; }
      if (!prime && !paint) { dropped.push(`order ${id}: no dates`); continue; }
      rows.push({
        order_id: id,
        order_no: l.order_no == null ? null : String(l.order_no).slice(0, 40),
        job: l.job == null ? null : String(l.job).trim().slice(0, 120),
        colour: String(l.colour ?? "").trim().slice(0, 120),
        doors,
        prime_on: prime,
        paint_on: paint,
      });
    }

    const asAdmin = { apikey: service, Authorization: `Bearer ${service}`,
                      "Content-Type": "application/json" };
    const ran = await call("load", `${url}/rest/v1/rpc/paint_schedule_load`,
      { method: "POST", headers: asAdmin,
        body: JSON.stringify({ p_rows: rows, p_keep_before: keep }) });
    if (!ran.ok)
      return json({ error: "The schedule would not load", detail: await ran.text() }, 500);
    const did = await ran.json();

    return json({
      sent: body.lines.length,
      loaded: rows.length,
      dropped: dropped.length ? dropped : undefined,
      ...did,
    });
  } catch (e) {
    console.log("failed:", (e as Error)?.message ?? e);
    return json({ error: (e as Error)?.message ?? "Something went wrong" }, 500);
  }
});

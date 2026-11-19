// Supabase Edge Function: paint-order
//
// Emails a paint order request to Ashley (ashley@grinyer.ca), from the
// Paint tool on the tools site. Andrew, 19 November: ordering sends a
// request to Ashley for now, and that may change later, which is why the
// address is a setting and not written into the page.
//
// Built like send-goback, on purpose. The page files the order first and
// then calls this, so a failed email still leaves the request on record.
// This function never creates anything: it reads a row that is already
// there, AS THE CALLER, sends it, and stamps when it went. A row the
// caller may not see is a row that is not there, so nobody outside the
// shop and administrators can send one.
//
// Deploy:  Supabase dashboard, Edge Functions, Deploy a new function, Via
//          Editor, named exactly paint-order. Paste this in and deploy.
//          Needs sql/paint.sql run first.
//
// Secrets it reads, under Edge Functions, Secrets:
//   RESEND_API_KEY      required. Already set: the order and go back
//                       emails use it, and secrets are shared.
//   PAINT_EMAIL_FROM    optional, falls back to ORDER_EMAIL_FROM, then
//                       to Resend's test address
//   PAINT_EMAIL_TO      optional, defaults to ashley@grinyer.ca, commas
//                       for several. Change this to send orders elsewhere.
//
// No imports, for the same reason as the others: plain HTTP with a
// deadline on every call.

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });

const DEADLINE_MS = 20000;

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

const esc = (v: unknown) =>
  String(v ?? "").replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));

const when = (v: unknown) => {
  const d = v ? new Date(String(v)) : new Date();
  if (isNaN(d.getTime())) return "";
  return d.toLocaleString("en-CA", {
    timeZone: "America/Toronto",
    year: "numeric", month: "short", day: "numeric",
    hour: "numeric", minute: "2-digit",
  });
};

/* A date with no time, read as the day it names wherever this runs. */
const dayName = (v: unknown) => {
  const s = String(v ?? "");
  if (!/^\d{4}-\d{2}-\d{2}/.test(s)) return "";
  const [y, m, d] = s.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-CA", {
    timeZone: "UTC", weekday: "long", month: "long", day: "numeric", year: "numeric",
  });
};

type Order = {
  id: string;
  colour: string;
  custom: boolean;
  pails_5: number;
  pails_1: number;
  gallons: number | string;
  for_job: string | null;
  needed_by: string | null;
  note: string | null;
  requested_by: string | null;
  requested_at: string | null;
  emailed_at: string | null;
  status: string;
};

function pails(o: Order) {
  const bits: string[] = [];
  if (o.pails_5) bits.push(`${o.pails_5} x 5 gallon pail${o.pails_5 === 1 ? "" : "s"}`);
  if (o.pails_1) bits.push(`${o.pails_1} x 1 gallon pail${o.pails_1 === 1 ? "" : "s"}`);
  return bits.join(" and ");
}

function emailFor(o: Order) {
  const what = o.colour + (o.custom ? " (custom colour)" : "");
  const gallons = Number(o.gallons);
  const subject = `PAINT ORDER ${o.colour.toUpperCase()}, ${gallons} GALLON${gallons === 1 ? "" : "S"}` +
    (o.for_job ? `, ${o.for_job.toUpperCase()}` : "");

  const row = (label: string, value: string) => value
    ? `<tr><td style="padding:7px 14px 7px 0;color:#6E6E76;font-size:13px;` +
      `vertical-align:top;white-space:nowrap">${esc(label)}</td>` +
      `<td style="padding:7px 0;font-size:15px;color:#17171A">${value}</td></tr>`
    : "";

  const html =
    `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,` +
    `Helvetica,Arial,sans-serif;max-width:620px;margin:0 auto;padding:4px 0">` +
      `<div style="border:3px solid #C80000;border-radius:6px;padding:22px 24px">` +
        `<h1 style="font-size:21px;margin:0 0 2px;color:#17171A">Paint order request</h1>` +
        `<p style="margin:0 0 20px;color:#6E6E76;font-size:13px">` +
          `Asked for by ${esc(o.requested_by || "the shop")}${o.requested_at ? " on " + esc(when(o.requested_at)) : ""}` +
        `</p>` +
        `<table style="border-collapse:collapse;width:100%">` +
          row("Colour", `<b>${esc(what)}</b>`) +
          row("Order", esc(pails(o))) +
          row("Total", `${esc(gallons)} gallon${gallons === 1 ? "" : "s"}`) +
          row("For job", esc(o.for_job ?? "")) +
          row("Needed by", esc(dayName(o.needed_by))) +
          row("Note", esc(o.note ?? "").replace(/\r?\n/g, "<br>")) +
        `</table>` +
      `</div>` +
      `<p style="color:#8E8E99;font-size:12px;margin:14px 2px 0">` +
        `Sent from the Paint tool on the Grinyer tools site. When it arrives, ` +
        `mark it received there so the stock goes up.</p>` +
    `</div>`;

  const text = [
    "PAINT ORDER REQUEST",
    "",
    `Colour:     ${what}`,
    `Order:      ${pails(o)}`,
    `Total:      ${gallons} gallons`,
    o.for_job ? `For job:    ${o.for_job}` : "",
    o.needed_by ? `Needed by:  ${dayName(o.needed_by)}` : "",
    o.note ? `Note:       ${o.note}` : "",
    "",
    `Asked for by ${o.requested_by || "the shop"}${o.requested_at ? " on " + when(o.requested_at) : ""}`,
  ].filter((l, i, a) => l !== "" || a[i - 1] !== "").join("\n");

  return { subject, html, text };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  try {
    const url = Deno.env.get("SUPABASE_URL") ?? "";
    const anon = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const resendKey = Deno.env.get("RESEND_API_KEY") ?? "";

    const absent = [["SUPABASE_URL", url], ["SUPABASE_ANON_KEY", anon],
                    ["SUPABASE_SERVICE_ROLE_KEY", service]]
      .filter(([, v]) => !v).map(([k]) => k);
    if (absent.length)
      return json({ error: "This function cannot see " + absent.join(" or ") +
        ". Those are set by Supabase itself, so the function may need deploying again." }, 500);
    if (!resendKey)
      return json({ error: "No sending account is set up yet. Add RESEND_API_KEY in Supabase." }, 400);

    const auth = req.headers.get("Authorization") ?? "";
    if (!auth) return json({ error: "Not signed in" }, 401);

    let body: { id?: string };
    try { body = await req.json(); } catch { return json({ error: "Bad request" }, 400); }
    const id = String(body.id ?? "").trim();
    if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ error: "Which order?" }, 400);

    const asCaller = { apikey: anon, Authorization: auth };
    const asAdmin  = { apikey: service, Authorization: `Bearer ${service}` };

    const got = await call("read the order",
      `${url}/rest/v1/paint_orders?select=*&id=eq.${id}`, { headers: asCaller });
    const rows = got.ok ? await got.json().catch(() => []) : [];
    if (!got.ok || !rows.length)
      return json({ error: "That order is not there, or is not yours to send" }, 404);
    const o = rows[0] as Order;

    if (o.emailed_at) return json({ ok: true, already: true });
    if (o.status !== "requested") return json({ error: "That order is no longer open" }, 409);

    const from = Deno.env.get("PAINT_EMAIL_FROM")
      ?? Deno.env.get("ORDER_EMAIL_FROM")
      ?? "onboarding@resend.dev";
    const to = (Deno.env.get("PAINT_EMAIL_TO") ?? "ashley@grinyer.ca")
      .split(",").map((s) => s.trim()).filter(Boolean);

    const mail = emailFor(o);
    console.log(`sending "${mail.subject}" to ${to.join(", ")}`);
    const sent = await call("resend", "https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to, subject: mail.subject, html: mail.html, text: mail.text }),
    });
    if (!sent.ok) {
      console.log("resend refused it: " + (await sent.text().catch(() => "")).slice(0, 400));
      return json({ error: "The order is saved but the email would not send. " +
        "Tell Ashley directly." }, 502);
    }

    await call("stamp it as sent",
      `${url}/rest/v1/paint_orders?id=eq.${id}`,
      { method: "PATCH", headers: { ...asAdmin, "Content-Type": "application/json" },
        body: JSON.stringify({ emailed_at: new Date().toISOString() }) })
      .catch(() => { /* the email went, which is what matters */ });

    return json({ ok: true, to });
  } catch (e) {
    console.log("fell over: " + ((e as Error)?.message ?? e));
    return json({ error: (e as Error)?.message ?? "Something went wrong" }, 500);
  }
});

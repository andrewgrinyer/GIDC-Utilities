// Supabase Edge Function: supply-order
//
// Emails a supplies purchase order (Shop, Sanding or Install Supplies) to
// the supplier, with the purchasing manager copied. Andrew, 20 November:
// items ordered together from one supplier go on one PO, emailed to that
// supplier, and Ashley is copied on every order.
//
// Built like paint-order, on purpose. The page makes the order first
// (supply_place_order in sql/supplies.sql) and then calls this, so a
// failed email still leaves the order on record with its PO number. This
// function never creates anything: it reads an order that is already
// there, AS THE CALLER, sends it, and stamps when and where it went. An
// order the caller may not see is an order that is not there.
//
// Where it goes, all set on the page, never in code:
//   to        the supplier's email (Settings, Suppliers)
//   copied    the list's "copy every order to" (Ashley to start with)
//   reply to  the same, so the supplier's answer reaches purchasing
// With no supplier email it goes to the copied address alone, so an
// order for an item with no supplier yet still reaches purchasing.
//
// Deploy:  Supabase dashboard, Edge Functions, Deploy a new function, Via
//          Editor, named exactly supply-order. Paste this in and deploy.
//          Leave Verify JWT on. Needs sql/supplies.sql run first.
//
// Secrets it reads, under Edge Functions, Secrets:
//   RESEND_API_KEY      required. Already set: the other emails use it.
//   SUPPLY_EMAIL_FROM   optional, falls back to ORDER_EMAIL_FROM, then
//                       to Resend's test address
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

const addresses = (v: unknown) =>
  String(v ?? "").split(",").map((s) => s.trim()).filter((s) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s));

type Line = { shop_name: string; supplier_item: string | null; unit: string; qty: number | string };
type Order = {
  id: string;
  po_no: string;
  status: string;
  needed_by: string | null;
  note: string | null;
  requested_by: string | null;
  requested_at: string | null;
  emailed_at: string | null;
  supplier_name: string | null;
  supply_order_lines: Line[];
  supply_categories: { name: string; copy_to: string | null } | null;
  supply_suppliers: { name: string; email: string | null } | null;
};

const qtyText = (l: Line) => {
  const n = Number(l.qty);
  const unit = String(l.unit || "piece");
  return `${n} ${n === 1 ? unit : unit.replace(/(s|x|ch|sh)$/, "$1e").replace(/y$/, "ie") + "s"}`;
};

function emailFor(o: Order) {
  const cat = o.supply_categories?.name ?? "Supplies";
  const subject = `PURCHASE ORDER ${o.po_no} FROM GRINYER` +
    (o.needed_by ? `, NEEDED BY ${dayName(o.needed_by).toUpperCase()}` : "");
  const lines = o.supply_order_lines ?? [];

  const rows = lines.map((l) =>
    `<tr><td style="padding:8px 12px 8px 0;border-bottom:1px solid #EFEFF2;font-size:15px;color:#17171A">` +
      `<b>${esc(l.supplier_item || l.shop_name)}</b>` +
      (l.supplier_item ? `<div style="font-size:12px;color:#6E6E76">Our name: ${esc(l.shop_name)}</div>` : "") +
    `</td><td style="padding:8px 0;border-bottom:1px solid #EFEFF2;font-size:15px;text-align:right;white-space:nowrap">` +
      `${esc(qtyText(l))}</td></tr>`).join("");

  const html =
    `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,` +
    `Helvetica,Arial,sans-serif;max-width:620px;margin:0 auto;padding:4px 0">` +
      `<div style="border:3px solid #C80000;border-radius:6px;padding:22px 24px">` +
        `<h1 style="font-size:21px;margin:0 0 2px;color:#17171A">Purchase order ${esc(o.po_no)}</h1>` +
        `<p style="margin:0 0 18px;color:#6E6E76;font-size:13px">` +
          `Grinyer, ${esc(cat)}, ${esc(when(o.requested_at))}` +
          (o.supplier_name ? `, for ${esc(o.supplier_name)}` : "") +
        `</p>` +
        `<table style="border-collapse:collapse;width:100%">` +
          `<tr><th style="text-align:left;font-size:12px;color:#6E6E76;padding:0 0 6px;font-weight:600">Item</th>` +
          `<th style="text-align:right;font-size:12px;color:#6E6E76;padding:0 0 6px;font-weight:600">Quantity</th></tr>` +
          rows +
        `</table>` +
        (o.needed_by ? `<p style="margin:16px 0 0;font-size:15px"><b>Needed by</b> ${esc(dayName(o.needed_by))}</p>` : "") +
        (o.note ? `<p style="margin:10px 0 0;font-size:15px"><b>Note</b> ${esc(o.note).replace(/\r?\n/g, "<br>")}</p>` : "") +
        `<p style="margin:16px 0 0;font-size:13px;color:#6E6E76">Please quote PO ${esc(o.po_no)} on the invoice and packing slip, ` +
          `and reply to this email with any question.</p>` +
      `</div>` +
      `<p style="color:#8E8E99;font-size:12px;margin:14px 2px 0">` +
        `Sent from the Grinyer tools site by ${esc(o.requested_by || "the shop")}.</p>` +
    `</div>`;

  const text = [
    `PURCHASE ORDER ${o.po_no}`,
    `Grinyer, ${cat}, ${when(o.requested_at)}`,
    "",
    ...lines.map((l) => `${qtyText(l)}  ${l.supplier_item || l.shop_name}` +
      (l.supplier_item ? `  (our name: ${l.shop_name})` : "")),
    "",
    o.needed_by ? `Needed by: ${dayName(o.needed_by)}` : "",
    o.note ? `Note: ${o.note}` : "",
    "",
    `Please quote PO ${o.po_no} on the invoice and packing slip.`,
    `Sent by ${o.requested_by || "the shop"}`,
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
      `${url}/rest/v1/supply_orders?select=*,supply_order_lines(*),` +
      `supply_categories(name,copy_to),supply_suppliers(name,email)&id=eq.${id}`,
      { headers: asCaller });
    const rows = got.ok ? await got.json().catch(() => []) : [];
    if (!got.ok || !rows.length)
      return json({ error: "That order is not there, or is not yours to send" }, 404);
    const o = rows[0] as Order;

    if (o.emailed_at) return json({ ok: true, already: true });
    if (o.status !== "requested") return json({ error: "That order is no longer open" }, 409);
    if (!o.supply_order_lines?.length) return json({ error: "That order has nothing on it" }, 409);

    const copy = addresses(o.supply_categories?.copy_to);
    let to = addresses(o.supply_suppliers?.email);
    let cc = copy.filter((a) => !to.some((t) => t.toLowerCase() === a.toLowerCase()));
    if (!to.length) { to = copy; cc = []; }
    if (!to.length)
      return json({ error: "There is no address to send it to. Add the supplier's email, " +
        "or who every order is copied to, under Settings." }, 400);

    const from = Deno.env.get("SUPPLY_EMAIL_FROM")
      ?? Deno.env.get("ORDER_EMAIL_FROM")
      ?? "onboarding@resend.dev";

    const mail = emailFor(o);
    console.log(`sending "${mail.subject}" to ${to.join(", ")}${cc.length ? ", copy " + cc.join(", ") : ""}`);
    const sent = await call("resend", "https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from, to, cc: cc.length ? cc : undefined,
        reply_to: copy.length ? copy : undefined,
        subject: mail.subject, html: mail.html, text: mail.text,
      }),
    });
    if (!sent.ok) {
      console.log("resend refused it: " + (await sent.text().catch(() => "")).slice(0, 400));
      return json({ error: "The order is saved but the email would not send. " +
        "Send it to the supplier directly." }, 502);
    }

    await call("stamp it as sent",
      `${url}/rest/v1/supply_orders?id=eq.${id}`,
      { method: "PATCH", headers: { ...asAdmin, "Content-Type": "application/json" },
        body: JSON.stringify({ emailed_at: new Date().toISOString(),
                               sent_to: to.join(", "), copied_to: cc.join(", ") || null }) })
      .catch(() => { /* the email went, which is what matters */ });

    return json({ ok: true, to, cc });
  } catch (e) {
    console.log("fell over: " + ((e as Error)?.message ?? e));
    return json({ error: (e as Error)?.message ?? "Something went wrong" }, 500);
  }
});

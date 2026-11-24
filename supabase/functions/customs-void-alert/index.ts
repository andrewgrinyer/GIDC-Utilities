// Supabase Edge Function: customs-void-alert
//
// Andrew, 23 November: when an order whose pallet already has a completed
// commercial invoice (the customs papers) is taken off that pallet, email
// ashley@grinyer.ca and accounting@grinyer.ca that an order with a
// completed commercial invoice has been modified.
//
// The database writes the record first, in customs_void_alerts, as the
// papers are voided (sql/dealer-split-order.sql). The portal then calls
// this with the order id. It reads the unsent alerts for that order AS THE
// CALLER, so only somebody allowed to read them can have them sent, sends
// one email per alert, and stamps emailed_at. An alert already sent is
// never sent twice.
//
// Deploy:  Supabase dashboard, Edge Functions, Deploy a new function, Via
//          Editor, named exactly customs-void-alert. Paste this in and
//          deploy. Leave Verify JWT on: the portal sends the signed in
//          person's token.
//
// Secrets it reads, under Edge Functions, Secrets:
//   RESEND_API_KEY        already set for the order emails
//   CUSTOMS_ALERT_TO      optional, defaults to
//                         ashley@grinyer.ca,accounting@grinyer.ca
//   CUSTOMS_ALERT_FROM    optional, falls back to ORDER_EMAIL_FROM
//
// 2.21.4, Andrew: voiding an order's QuickBooks invoice in the portal
// emails them too, so the invoice is changed in QuickBooks. Those alerts
// have kind 'invoice' and their own wording.
//
// No imports, on purpose, the same as send-goback.

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

/* Nothing is ever shown as empty. A blank line is ambiguous:
   it could mean there is nothing, or that nobody filled it in. */
const orDash = (v: unknown) => {
  const s = String(v ?? "").trim();
  return s ? esc(s) : "&mdash;";
};

const when = (v: unknown) => {
  const d = v ? new Date(String(v)) : new Date();
  if (isNaN(d.getTime())) return "";
  /* Written in Toronto time, because that is where the office reads it. */
  return d.toLocaleString("en-CA", {
    timeZone: "America/Toronto",
    year: "numeric", month: "short", day: "numeric",
    hour: "numeric", minute: "2-digit",
  });
};

type Alert = {
  id: string; kind?: string | null; order_id: string | null; order_ref: string | null;
  pallet_name: string | null; papers_made_at: string | null;
  ci_no: string | null; qbo_invoice_no: string | null;
  changed_by_name: string | null; changed_at: string | null;
  emailed_at: string | null;
};

const row = (label: string, value: string) =>
  `<tr><td style="padding:7px 14px 7px 0;color:#6E6E76;font-size:13px;` +
  `vertical-align:top;white-space:nowrap">${esc(label)}</td>` +
  `<td style="padding:7px 0;font-size:15px;color:#17171A">${value}</td></tr>`;

function invoiceEmailFor(a: Alert) {
  const html =
    `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,` +
    `Helvetica,Arial,sans-serif;max-width:620px;margin:0 auto;padding:4px 0">` +
      `<div style="border:3px solid #C80000;border-radius:6px;padding:22px 24px">` +
        `<h1 style="font-size:21px;margin:0 0 6px;color:#C80000">` +
          `A QuickBooks invoice has been voided in the dealer portal</h1>` +
        `<p style="margin:0 0 18px;color:#17171A;font-size:15px">` +
          `The invoice below needs to be changed or voided in QuickBooks as well. ` +
          `The order can now be changed or split, and invoiced again.</p>` +
        `<table style="border-collapse:collapse;width:100%">` +
          row("Order", `<b>${orDash(a.order_ref)}</b>`) +
          row("QuickBooks invoice", `<b>${orDash(a.qbo_invoice_no)}</b>` +
              (a.papers_made_at ? ", made " + esc(when(a.papers_made_at)) : "")) +
          row("Pallet", orDash(a.pallet_name)) +
          row("Voided by", orDash(a.changed_by_name)) +
          row("When", esc(when(a.changed_at))) +
        `</table>` +
      `</div>` +
      `<p style="color:#8E8E99;font-size:12px;margin:14px 2px 0">` +
        `Sent by the Grinyer dealer portal. Replying to this email changes nothing.</p>` +
    `</div>`;
  const subject = `QuickBooks invoice ${a.qbo_invoice_no ?? ""} voided: ${a.order_ref ?? "an order"}, change it in QuickBooks`
    .replace(/\s+/g, " ");
  const text = [
    "A QUICKBOOKS INVOICE HAS BEEN VOIDED IN THE DEALER PORTAL",
    "",
    "The invoice below needs to be changed or voided in QuickBooks as well.",
    "The order can now be changed or split, and invoiced again.",
    "",
    `Order:               ${a.order_ref ?? ""}`,
    `QuickBooks invoice:  ${a.qbo_invoice_no ?? ""}${a.papers_made_at ? ", made " + when(a.papers_made_at) : ""}`,
    `Pallet:              ${a.pallet_name ?? ""}`,
    `Voided by:           ${a.changed_by_name ?? ""}`,
    `When:                ${when(a.changed_at)}`,
  ].join("\n");
  return { subject, html, text };
}

function emailFor(a: Alert) {
  if (a.kind === "invoice") return invoiceEmailFor(a);
  const html =
    `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,` +
    `Helvetica,Arial,sans-serif;max-width:620px;margin:0 auto;padding:4px 0">` +
      `<div style="border:3px solid #C80000;border-radius:6px;padding:22px 24px">` +
        `<h1 style="font-size:21px;margin:0 0 6px;color:#C80000">` +
          `An order with a completed commercial invoice has been modified</h1>` +
        `<p style="margin:0 0 18px;color:#17171A;font-size:15px">` +
          `It was taken off its pallet in the dealer portal. That voids the pallet's ` +
          `commercial invoice and packing list. They have to be made again before ` +
          `the pallet ships.</p>` +
        `<table style="border-collapse:collapse;width:100%">` +
          row("Order", `<b>${orDash(a.order_ref)}</b>`) +
          row("Pallet", orDash(a.pallet_name)) +
          row("Commercial invoice", orDash(a.ci_no) +
              (a.papers_made_at ? ", made " + esc(when(a.papers_made_at)) : "")) +
          row("QuickBooks invoice for this order", a.qbo_invoice_no
              ? esc(a.qbo_invoice_no) + " (still live)" : "None") +
          row("Changed by", orDash(a.changed_by_name)) +
          row("When", esc(when(a.changed_at))) +
        `</table>` +
      `</div>` +
      `<p style="color:#8E8E99;font-size:12px;margin:14px 2px 0">` +
        `Sent by the Grinyer dealer portal. Replying to this email changes nothing.</p>` +
    `</div>`;
  const subject = `Commercial invoice voided: ${a.order_ref ?? "an order"} off pallet ${a.pallet_name ?? ""}`.trim();
  const text = [
    "AN ORDER WITH A COMPLETED COMMERCIAL INVOICE HAS BEEN MODIFIED",
    "",
    "It was taken off its pallet in the dealer portal. That voids the pallet's",
    "commercial invoice and packing list. They have to be made again before the pallet ships.",
    "",
    `Order:               ${a.order_ref ?? ""}`,
    `Pallet:              ${a.pallet_name ?? ""}`,
    `Commercial invoice:  ${a.ci_no ?? ""}${a.papers_made_at ? ", made " + when(a.papers_made_at) : ""}`,
    `QuickBooks invoice:  ${a.qbo_invoice_no ? a.qbo_invoice_no + " (still live)" : "None"}`,
    `Changed by:          ${a.changed_by_name ?? ""}`,
    `When:                ${when(a.changed_at)}`,
  ].join("\n");
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
    if (!url || !anon || !service)
      return json({ error: "This function cannot see its own environment. Deploy it again." }, 500);
    if (!resendKey)
      return json({ error: "No sending account is set up yet. Add RESEND_API_KEY in Supabase." }, 400);

    const auth = req.headers.get("Authorization") ?? "";
    if (!auth) return json({ error: "Not signed in" }, 401);

    let body: { order_id?: string };
    try { body = await req.json(); } catch { return json({ error: "Bad request" }, 400); }
    const orderId = String(body.order_id ?? "").trim();
    if (!/^[0-9a-f-]{36}$/i.test(orderId)) return json({ error: "Which order?" }, 400);

    const asCaller = { apikey: anon, Authorization: auth };
    const asAdmin = { apikey: service, Authorization: `Bearer ${service}`,
                      "Content-Type": "application/json" };

    const got = await call("read the alerts",
      `${url}/rest/v1/customs_void_alerts?select=*&emailed_at=is.null&order_id=eq.${orderId}`,
      { headers: asCaller });
    if (!got.ok) return json({ error: "Could not read the alerts", detail: await got.text() }, 500);
    const alerts = (await got.json()) as Alert[];
    if (!alerts.length) return json({ ok: true, sent: 0 });

    const from = Deno.env.get("CUSTOMS_ALERT_FROM") ?? Deno.env.get("ORDER_EMAIL_FROM")
      ?? "onboarding@resend.dev";
    const to = (Deno.env.get("CUSTOMS_ALERT_TO") ?? "ashley@grinyer.ca,accounting@grinyer.ca")
      .split(",").map((s) => s.trim()).filter(Boolean);

    let sent = 0;
    const failed: string[] = [];
    for (const a of alerts) {
      const mail = emailFor(a);
      const r = await call("resend", "https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from, to, subject: mail.subject, html: mail.html, text: mail.text }),
      });
      const patch = r.ok
        ? { emailed_at: new Date().toISOString(), email_error: null }
        : { email_error: (await r.text().catch(() => "")).slice(0, 400) || `status ${r.status}` };
      if (r.ok) sent++; else failed.push(a.id);
      await call("stamp it", `${url}/rest/v1/customs_void_alerts?id=eq.${a.id}`,
        { method: "PATCH", headers: asAdmin, body: JSON.stringify(patch) }).catch(() => {});
    }
    if (failed.length)
      return json({ error: "It is voided but the email to " + to.join(" and ") +
        " would not send. Tell them directly.", sent }, 502);
    return json({ ok: true, sent, to });
  } catch (e) {
    console.log("fell over: " + ((e as Error)?.message ?? e));
    return json({ error: (e as Error)?.message ?? "Something went wrong" }, 500);
  }
});

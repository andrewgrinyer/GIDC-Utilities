// Supabase Edge Function: customer-update-email   (measurement app 2.67)
//
// When a salesperson changes the customer name or address on a job that
// is linked to Access, the office has to make the same change in Access.
// The database records each change (sql/customer-profile-update.sql) and
// this function emails what is waiting to the office, subject
// "Customer Profile Update Required", with the update in the body.
//
// Who calls it:
//   * the measurement app, about a minute after the change, or when the
//     person leaves the job. It sends a signed in person's token.
//   * the measurement-sync function every hour, with the x-gidc-key
//     header, so anything left over still goes.
// Either way it only sends what is already recorded. A caller cannot put
// anything in the email.
//
// Deploy: Supabase dashboard, Edge Functions, Deploy a new function, Via
//         Editor, named exactly customer-update-email. Paste this in.
//         Then in its settings turn Verify JWT OFF (it checks the caller
//         itself, the same as account-link and measurement-sync).
//
// Secrets it reads (Edge Functions, Secrets). Nothing new to add:
//   RESEND_API_KEY              already set for the order emails
//   KPI_IMPORT_KEY              already set for the server scripts
//   CUSTOMER_UPDATE_EMAIL_TO    optional, defaults to info@grinyer.ca
//   CUSTOMER_UPDATE_EMAIL_FROM  optional, falls back to ORDER_EMAIL_FROM
//
// No imports, on purpose (see send-goback).

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-gidc-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

async function call(what: string, url: string, init: RequestInit, ms = 20000) {
  const started = Date.now();
  const stop = new AbortController();
  const timer = setTimeout(() => stop.abort(), ms);
  try {
    const r = await fetch(url, { ...init, signal: stop.signal });
    console.log(`${what}: ${r.status} in ${Date.now() - started}ms`);
    return r;
  } catch (e) {
    throw new Error(`${what} ${(e as Error)?.name === "AbortError" ? `gave up after ${ms}ms` : (e as Error)?.message}`);
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

const esc = (v: unknown) =>
  String(v ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
const show = (v: unknown) => String(v ?? "").trim() || "(blank)";
const when = (v: unknown) => {
  const d = new Date(String(v ?? ""));
  return isNaN(d.getTime()) ? "" : d.toLocaleString("en-CA", {
    timeZone: "America/Toronto", year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
};

export type Update = {
  id: number; job_id: string; estimate_id: number | null; order_no: string | null; status: string | null;
  old_customer: string; old_address: string; old_city: string;
  new_customer: string; new_address: string; new_city: string;
  phone: string | null; email: string | null; rep: string | null;
  changed_by: string | null; first_at: string; changed_at: string;
};

export const SUBJECT = "Customer Profile Update Required";

export function emailFor(u: Update) {
  const rows: [string, string, string][] = [
    ["Customer name", u.old_customer, u.new_customer],
    ["Address", u.old_address, u.new_address],
    ["City", u.old_city, u.new_city],
  ];
  const changed = rows.filter(([, a, b]) => String(a ?? "").trim() !== String(b ?? "").trim());
  const access = "Access estimate " + (u.estimate_id ?? "?") + (u.order_no ? ", job " + u.order_no : "");
  const by = show(u.changed_by) + ", " + when(u.changed_at);
  const text = [
    "A customer's details were changed in the measurement app. Please make the same change in Access.",
    "",
    access,
    "Customer: " + show(u.new_customer),
    "Changed by: " + by,
    "",
    ...changed.map(([k, a, b]) => k + "\n  Was: " + show(a) + "\n  Now: " + show(b)),
    "",
    "For reference",
    "Phone: " + show(u.phone),
    "Email: " + show(u.email),
    "Sales representative: " + show(u.rep),
    "Status in Access: " + show(u.status),
  ].join("\n");
  const td = 'style="padding:6px 10px;border:1px solid #ddd;vertical-align:top"';
  const html =
    `<p>A customer's details were changed in the measurement app. Please make the same change in Access.</p>` +
    `<p><b>${esc(access)}</b><br>Customer: ${esc(show(u.new_customer))}<br>Changed by: ${esc(by)}</p>` +
    `<table style="border-collapse:collapse;font:14px Arial,sans-serif">` +
    `<tr><th ${td}></th><th ${td} align="left">Was</th><th ${td} align="left">Now</th></tr>` +
    changed.map(([k, a, b]) => `<tr><td ${td}><b>${esc(k)}</b></td><td ${td}>${esc(show(a))}</td><td ${td}><b>${esc(show(b))}</b></td></tr>`).join("") +
    `</table>` +
    `<p style="color:#555">For reference<br>Phone: ${esc(show(u.phone))}<br>Email: ${esc(show(u.email))}<br>` +
    `Sales representative: ${esc(show(u.rep))}<br>Status in Access: ${esc(show(u.status))}</p>`;
  return { subject: SUBJECT, text, html };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  try {
    const url = Deno.env.get("SUPABASE_URL") ?? "";
    const anon = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const secret = Deno.env.get("KPI_IMPORT_KEY") ?? "";
    const resendKey = Deno.env.get("RESEND_API_KEY") ?? "";
    if (!url || !service) return json({ error: "This function cannot see its own environment. Deploy it again." }, 500);
    if (!resendKey) return json({ error: "No sending account is set up yet. Add RESEND_API_KEY in Supabase." }, 400);

    // the server with its key, or any signed in person
    const given = req.headers.get("x-gidc-key") ?? "";
    let allowed = !!secret && !!given && sameSecret(given, secret);
    if (!allowed) {
      const auth = req.headers.get("Authorization") ?? "";
      if (!auth) return json({ error: "Not signed in" }, 401);
      const me = await call("who is calling", `${url}/auth/v1/user`, { headers: { apikey: anon || service, Authorization: auth } });
      const user = me.ok ? await me.json().catch(() => null) : null;
      allowed = !!user?.id;
    }
    if (!allowed) return json({ error: "Not signed in" }, 401);

    const asAdmin = { apikey: service, Authorization: `Bearer ${service}`, "Content-Type": "application/json" };
    const got = await call("claim", `${url}/rest/v1/rpc/gidc_claim_profile_updates`, { method: "POST", headers: asAdmin, body: "{}" });
    if (!got.ok) {
      const t = await got.text();
      return json({ error: "Supabase does not have the profile update list yet. Run customer-profile-update.sql.", detail: t }, 500);
    }
    const list = (await got.json()) as Update[];
    const to = (Deno.env.get("CUSTOMER_UPDATE_EMAIL_TO") ?? "info@grinyer.ca").split(",").map((s) => s.trim()).filter(Boolean);
    const from = Deno.env.get("CUSTOMER_UPDATE_EMAIL_FROM") ?? Deno.env.get("ORDER_EMAIL_FROM") ?? "onboarding@resend.dev";

    let sent = 0;
    const failed: string[] = [];
    for (const u of list) {
      const mail = emailFor(u);
      let ok = false, why = "";
      try {
        const r = await call(`send ${u.id}`, "https://api.resend.com/emails", {
          method: "POST",
          headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ from, to, subject: mail.subject, text: mail.text, html: mail.html }),
        });
        ok = r.ok;
        if (!ok) why = (await r.text().catch(() => "")).slice(0, 400);
      } catch (e) { why = (e as Error)?.message ?? String(e); }
      await call(`mark ${u.id}`, `${url}/rest/v1/rpc/gidc_profile_update_done`, {
        method: "POST", headers: asAdmin, body: JSON.stringify({ p_id: u.id, p_ok: ok, p_error: ok ? null : why }) });
      if (ok) sent++; else failed.push(`${u.new_customer || u.job_id}: ${why}`);
    }
    return json({ sent, failed: failed.length ? failed : undefined });
  } catch (e) {
    console.log("fell over: " + ((e as Error)?.message ?? e));
    return json({ error: (e as Error)?.message ?? "Something went wrong" }, 500);
  }
});

// Supabase Edge Function: send-contract
//
// Emails a signed contract (the PDF the measurement app made at signing) to
// the customer and to the sales associate who is signed in, as one email with
// the PDF attached.
//
// The app saves the signed job first and then calls this, so the signature is
// never lost to a failed email: the PDF is also saved on the device, and the
// Email again button on the review screen retries.
//
// It reads the job AS THE CALLER. If the job is not theirs to see, the
// database does not return it and nothing is sent. Only the roles that may see
// prices (admin, user, sales) may send, the same allowlist the app uses.
// The customer address comes from the saved job, never from the request, so
// the function cannot be used to mail a PDF to anyone it likes.
//
// Deploy:  Supabase dashboard, Edge Functions, Deploy a new function, Via
//          Editor, named exactly send-contract. Paste this in and deploy.
//          Leave "Verify JWT" on: only signed in people may call it.
//
// Secrets it reads (Edge Functions, Secrets). Nothing new to add if the
// dealer order emails already work:
//   RESEND_API_KEY        required
//   CONTRACT_EMAIL_FROM   optional, falls back to ORDER_EMAIL_FROM, then to
//                         Resend's test address
//   CONTRACT_EMAIL_BCC    optional, commas for several (an office copy)
//
// No imports, on purpose, like the other functions: plain HTTP with a
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

const DEADLINE_MS = 25000;
const PRICE_ROLES = ["admin", "user", "sales"];
const MAX_PDF_BYTES = 25 * 1024 * 1024;

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

const EMAIL = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/;

const when = (v: unknown) => {
  const d = v ? new Date(String(v)) : new Date();
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-CA", {
    timeZone: "America/Toronto", year: "numeric", month: "long", day: "numeric",
  });
};

/* the file name is the app's suggestion, cleaned so it is always a plain .pdf */
const fileName = (v: unknown) => {
  const s = String(v ?? "").replace(/[^\w .()&,'-]+/g, " ").replace(/\s+/g, " ").trim()
    .slice(0, 120);
  return (s || "Grinyer contract").replace(/\.pdf$/i, "") + ".pdf";
};

type Job = {
  customer?: string; email?: string; address?: string; city?: string;
  salesRep?: string;
  signed?: { at?: string; name?: string };
};

function emailFor(j: Job, repName: string) {
  const who = String(j.customer ?? "").trim() || "Customer";
  const subject = `Your Grinyer contract, signed ${when(j.signed?.at)}`;
  const html =
    `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,` +
    `Helvetica,Arial,sans-serif;max-width:600px;margin:0 auto;color:#2A2A2A">` +
      `<div style="border-top:4px solid #B5121B;padding:20px 4px 6px">` +
        `<p style="font-size:15px;margin:0 0 14px">Hello ${esc(who)},</p>` +
        `<p style="font-size:15px;line-height:1.5;margin:0 0 14px">Thank you for ` +
        `choosing Grinyer Interior Doors &amp; Closets. Your signed contract is ` +
        `attached as a PDF: the order, the install instructions and terms, your ` +
        `door selections and any guides for your doors.</p>` +
        `<p style="font-size:15px;line-height:1.5;margin:0 0 14px">Signed by ` +
        `${esc(j.signed?.name || who)} on ${esc(when(j.signed?.at))}` +
        `${repName ? ` with ${esc(repName)}` : ""}.</p>` +
        `<p style="font-size:15px;line-height:1.5;margin:0 0 14px">If anything ` +
        `on it is not right, reply to this email or call us at 877 566 4052 ` +
        `within 24 hours, before we order your materials.</p>` +
      `</div>` +
      `<p style="color:#6B6B6B;font-size:12px;border-top:1px solid #C8C8C8;` +
      `padding-top:10px;margin:18px 0 0">Grinyer Interior Doors &amp; Closets, ` +
      `1177 Franklin Blvd, Cambridge, ON. info@grinyer.ca, 877 566 4052</p>` +
    `</div>`;
  const text = [
    `Hello ${who},`, "",
    "Thank you for choosing Grinyer Interior Doors & Closets. Your signed " +
    "contract is attached as a PDF.", "",
    `Signed by ${j.signed?.name || who} on ${when(j.signed?.at)}` +
      (repName ? ` with ${repName}` : "") + ".", "",
    "If anything on it is not right, reply to this email or call us at " +
    "877 566 4052 within 24 hours, before we order your materials.", "",
    "Grinyer Interior Doors & Closets, 1177 Franklin Blvd, Cambridge, ON",
  ].join("\n");
  return { subject, html, text };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const t0 = Date.now();
  try {
    const url = Deno.env.get("SUPABASE_URL") ?? "";
    const anon = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const resendKey = Deno.env.get("RESEND_API_KEY") ?? "";
    if (!url || !anon)
      return json({ error: "This function cannot see SUPABASE_URL or SUPABASE_ANON_KEY. " +
        "Those are set by Supabase itself, so the function may need deploying again." }, 500);
    if (!resendKey)
      return json({ error: "No sending account is set up yet. Add RESEND_API_KEY in Supabase." }, 400);

    const auth = req.headers.get("Authorization") ?? "";
    if (!auth) return json({ error: "Not signed in" }, 401);
    const asCaller = { apikey: anon, Authorization: auth };

    let body: { id?: string; filename?: string; pdf?: string };
    try { body = await req.json(); } catch { return json({ error: "Bad request" }, 400); }
    const id = String(body.id ?? "").trim();
    const pdf = String(body.pdf ?? "").replace(/\s+/g, "");
    if (!id) return json({ error: "Which job?" }, 400);
    if (!pdf || !/^[A-Za-z0-9+/]+=*$/.test(pdf))
      return json({ error: "The contract PDF did not come through" }, 400);
    if (pdf.length * 0.75 > MAX_PDF_BYTES)
      return json({ error: "The contract PDF is too large to email" }, 413);
    if (!atob(pdf.slice(0, 8)).startsWith("%PDF"))
      return json({ error: "That is not a PDF" }, 400);

    // who is calling, and may they send contracts (roles are an allowlist)
    const me = await call("who is calling", `${url}/auth/v1/user`, { headers: asCaller });
    const user = me.ok ? await me.json().catch(() => null) : null;
    if (!user?.id) return json({ error: "Not signed in" }, 401);
    const pr = await call("their role",
      `${url}/rest/v1/profiles?select=name,role&id=eq.${encodeURIComponent(user.id)}`,
      { headers: asCaller });
    const prof = (pr.ok ? await pr.json().catch(() => []) : [])[0] ?? {};
    if (!PRICE_ROLES.includes(String(prof.role ?? "")))
      return json({ error: "Your login cannot send contracts" }, 403);

    // the job, read as the caller: a job they may not see is not there
    const got = await call("read the job",
      `${url}/rest/v1/jobs?select=id,customer,data&id=eq.${encodeURIComponent(id)}`,
      { headers: asCaller });
    const rows = got.ok ? await got.json().catch(() => []) : [];
    if (!got.ok || !rows.length)
      return json({ error: "That job is not saved online yet, or is not yours to send" }, 404);
    const job = (rows[0].data ?? {}) as Job;
    if (!job.signed?.at)
      return json({ error: "The online copy of this job is not signed yet. Use Email it on the review screen in a moment." }, 409);

    const customer = String(job.email ?? "").trim();
    if (!EMAIL.test(customer))
      return json({ error: "The customer email on this job does not look right" }, 400);
    const rep = String(user.email ?? "").trim();
    const to = [customer, ...(EMAIL.test(rep) && rep.toLowerCase() !== customer.toLowerCase() ? [rep] : [])];
    const bcc = (Deno.env.get("CONTRACT_EMAIL_BCC") ?? "")
      .split(",").map((s) => s.trim()).filter((s) => EMAIL.test(s));

    const from = Deno.env.get("CONTRACT_EMAIL_FROM")
      ?? Deno.env.get("ORDER_EMAIL_FROM")
      ?? "onboarding@resend.dev";
    const mail = emailFor(job, String(prof.name ?? job.salesRep ?? "").trim());
    console.log(`sending "${mail.subject}" for job ${id} to ${to.length} addresses`);

    const sent = await call("resend", "https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from, to, ...(bcc.length ? { bcc } : {}),
        ...(EMAIL.test(rep) ? { reply_to: rep } : {}),
        subject: mail.subject, html: mail.html, text: mail.text,
        attachments: [{ filename: fileName(body.filename), content: pdf }],
      }),
    });
    if (!sent.ok) {
      const said = await sent.text().catch(() => "");
      console.log("resend refused it: " + said.slice(0, 400));
      return json({ error: "The contract is signed and saved but the email would not send. " +
        "Use Email it on the review screen, or send the saved PDF yourself." }, 502);
    }

    // 2.26: keep a copy in the private signed-contracts store too, when the
    // store exists (sql/remote-sign.sql). A failure here never fails the send.
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    if (service) {
      const at = String(job.signed?.at ?? new Date().toISOString()).slice(0, 19).replace(/[:T]/g, "-");
      const path = `in-person/${encodeURIComponent(id)}/${at}-${fileName(body.filename).replace(/\s+/g, "-")}`;
      await call("store a copy", `${url}/storage/v1/object/signed-contracts/${path}`, {
        method: "POST", body: Uint8Array.from(atob(pdf), (c) => c.charCodeAt(0)) as BodyInit,
        headers: { apikey: service, Authorization: `Bearer ${service}`, "Content-Type": "application/pdf", "x-upsert": "true" },
      }).catch(() => null);
    }

    console.log(`done in ${Date.now() - t0}ms`);
    return json({ ok: true, to });
  } catch (e) {
    console.log("fell over: " + ((e as Error)?.message ?? e));
    return json({ error: (e as Error)?.message ?? "Something went wrong" }, 500);
  }
});

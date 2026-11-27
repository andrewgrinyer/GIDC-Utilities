// Supabase Edge Function: remote-sign
//
// Measurement app 2.26. A sales associate sends the customer a link; the
// customer opens it on their own phone, tablet or computer, reads the order
// and signs every field, exactly as they would in person. The signed
// contract is stamped with the time (the server's clock, not the device's)
// and the customer's IP address and browser, saved in Supabase (private
// store signed-contracts), and emailed to the customer and the associate.
//
// One function, five actions, chosen by body.action:
//   send    associate (signed in, role admin/user/sales): emails the link.
//           Any earlier unsigned link for the same job stops working.
//   status  associate: the latest request for a job, and a download link
//           for its signed PDF once there is one.
//   cancel  associate: stops an unsigned link working.
//   open    customer (link secret): the order as it was sent.
//   sign    customer: records the signatures, the time and the IP.
//           Returns the stamp the page prints on the contract.
//   finish  customer: the page sends the finished PDF; it is stored,
//           written onto the job, and emailed to both.
//   pdf        associate (2.28): a short lived download link for any stored
//              contract of the job, by its store path or its request id.
//   supersede  associate (2.28): stores the copy of an earlier contract
//              stamped SUPERSEDED (the page stamps it) beside the original,
//              which is never changed, and records it on the request.
//   design-up  associate (2.70): stores the job's closet design PDF at
//              designs/<job>/<random>.pdf and returns its path.
//   design     associate (2.70): a short lived download link for a closet
//              design of the job (designs/<job>/ only).
//   closet     customer (2.70): a short lived download link for the closet
//              design on the order as it was sent.
//
// 2.28 revisions: a job signed before and signed again is the next revision
// (Rev 001, Rev 002...). On finish the contract it replaces moves to
// job.contracts, marked superseded, with where its PDF is stored.
//
// Deploy: Supabase dashboard, Edge Functions, Deploy a new function, Via
// Editor, named exactly remote-sign. Paste this in and deploy. Then open the
// function's Details and turn OFF "Verify JWT": the customer has no login.
// The function checks the associate's login itself.
//
// Needs sql/remote-sign.sql run first (the sign_requests table and the
// signed-contracts store). Secrets: RESEND_API_KEY (already set), optional
// CONTRACT_EMAIL_FROM (falls back to ORDER_EMAIL_FROM), CONTRACT_EMAIL_BCC,
// SIGN_PAGE_URL (defaults to https://measurement.gidc.ca/).
//
// The link secret is 32 random bytes, sent once in the email and never
// stored: the table keeps only its SHA-256. The secret rides after the # in
// the link, so it never reaches a server log.
//
// No imports, on purpose, like the other functions.

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status, headers: { ...CORS, "Content-Type": "application/json" },
  });

const DEADLINE_MS = 25000;
const PRICE_ROLES = ["admin", "user", "sales"];   // who may send: an allowlist
const MAX_PDF_BYTES = 25 * 1024 * 1024;
const BUCKET = "signed-contracts";
const EMAIL = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/;

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
      ? `gave up after ${ms}ms` : `failed: ${(e as Error)?.message ?? e}`;
    console.log(`${what}: ${how}`);
    throw new Error(`${what} ${how}`);
  } finally {
    clearTimeout(timer);
  }
}

const esc = (v: unknown) =>
  String(v ?? "").replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));

const day = (v: unknown) => {
  const d = new Date(String(v ?? ""));
  return isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-CA", {
    timeZone: "America/Toronto", year: "numeric", month: "long", day: "numeric" });
};

const hex = (buf: ArrayBuffer) =>
  [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
const sha256 = async (data: string | Uint8Array) =>
  hex(await crypto.subtle.digest("SHA-256",
    (typeof data === "string" ? new TextEncoder().encode(data) : data) as BufferSource));
const newSecret = () => {
  const b = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const b64ToBytes = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/* 2.28: the revision a contract signed now would be, from the job as sent
   (the same rule as nextRev in the app): none signed yet 0, then 1, 2... */
type Signed = { at?: string; rev?: number; request?: string; path?: string; name?: string;
                where?: string; ip?: string; fp?: string };
type Contract = Signed & { supersededAt?: string; supersededBy?: number };
const nextRev = (j: { signed?: Signed; contracts?: Contract[] } | null) => {
  const r = (j?.contracts ?? []).map((c) => Number(c?.rev ?? 0) || 0);
  if (j?.signed?.at) r.push(Number(j.signed.rev ?? 0) || 0);
  return r.length ? Math.max(...r) + 1 : 0;
};
const revLabel = (r: number) => "Change Order " + String(r).padStart(3, "0");   // 2.57: a contract signed again after a change

/* where the customer's request came from: Supabase puts the caller first in
   x-forwarded-for; cf-connecting-ip when Cloudflare is in front */
const ipOf = (req: Request) =>
  (req.headers.get("cf-connecting-ip") ??
   (req.headers.get("x-forwarded-for") ?? "").split(",")[0] ??
   req.headers.get("x-real-ip") ?? "").trim() || "unknown";

type Row = {
  id: string; job_id: string; job: Record<string, unknown>; fp: string | null;
  customer_name: string | null; sent_to: string; sent_by: string | null;
  sent_by_name: string | null; sent_by_email: string | null; sent_at: string;
  expires_at: string; opened_at: string | null; status: string;
  signer_name: string | null; signed: Record<string, unknown> | null;
  signed_at: string | null; signer_ip: string | null; signer_agent: string | null;
  pdf_path: string | null; pdf_sha256: string | null; emailed_at: string | null;
  emailed_to: string[] | null;
};

/* what the customer's page and the associate's banner get to see */
const publicStamp = (r: Row) => ({
  id: r.id, status: r.status, sentAt: r.sent_at, sentTo: r.sent_to,
  sentBy: r.sent_by_name, sentByEmail: r.sent_by_email, expiresAt: r.expires_at,
  openedAt: r.opened_at, signedAt: r.signed_at, ip: r.signer_ip,
  agent: r.signer_agent, name: r.signer_name, emailedAt: r.emailed_at,
  emailedTo: r.emailed_to ?? [],
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  try {
    const url = Deno.env.get("SUPABASE_URL") ?? "";
    const anon = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const resendKey = Deno.env.get("RESEND_API_KEY") ?? "";
    if (!url || !anon || !service)
      return json({ error: "This function cannot see its Supabase settings. Deploy it again." }, 500);
    const admin = { apikey: service, Authorization: `Bearer ${service}` };
    const from = Deno.env.get("CONTRACT_EMAIL_FROM") ?? Deno.env.get("ORDER_EMAIL_FROM") ?? "onboarding@resend.dev";
    const bcc = (Deno.env.get("CONTRACT_EMAIL_BCC") ?? "").split(",").map((s) => s.trim()).filter((s) => EMAIL.test(s));
    const pageUrl = (Deno.env.get("SIGN_PAGE_URL") ?? "https://measurement.gidc.ca/").replace(/#.*$/, "");

    let body: Record<string, unknown>;
    try { body = await req.json(); } catch { return json({ error: "Bad request" }, 400); }
    const action = String(body.action ?? "");

    const rest = (what: string, path: string, init: RequestInit = {}) =>
      call(what, `${url}/rest/v1/${path}`, {
        ...init, headers: { ...admin, "Content-Type": "application/json", ...(init.headers ?? {}) } });
    const patch = (id: string, fields: Record<string, unknown>) =>
      rest("update the request", `sign_requests?id=eq.${id}`, {
        method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify(fields) })
        .then(async (r) => { if (!r.ok) throw new Error("Could not save: " + (await r.text()).slice(0, 200));
                             return ((await r.json()) as Row[])[0]; });
    const sendMail = async (msg: Record<string, unknown>) => {
      if (!resendKey) throw new Error("No sending account is set up yet. Add RESEND_API_KEY in Supabase.");
      const r = await call("resend", "https://api.resend.com/emails", {
        method: "POST", headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from, ...(bcc.length ? { bcc } : {}), ...msg }) });
      if (!r.ok) { console.log("resend refused: " + (await r.text()).slice(0, 300)); throw new Error("The email would not send"); }
    };

    /* ---------------- the associate's actions ---------------- */
    // 2.70: a short lived download link for a file in the store
    const signedUrl = async (p: string) => {
      const r = await call("download link", `${url}/storage/v1/object/sign/${BUCKET}/${p}`, {
        method: "POST", headers: { ...admin, "Content-Type": "application/json" }, body: JSON.stringify({ expiresIn: 900 }) });
      const j = r.ok ? await r.json().catch(() => ({})) : {};
      return j.signedURL ? `${url}/storage/v1${j.signedURL}` : "";
    };
    // 2.70: a closet design of this job only: designs/<job>/<name>.pdf
    const designPath = (p: string, jobId: string) => {
      const parts = String(p ?? "").split("/");
      return parts.length === 3 && parts[0] === "designs" && (parts[1] === jobId || parts[1] === encodeURIComponent(jobId)) &&
        /^[A-Za-z0-9_-]+\.pdf$/.test(parts[2]) ? parts.join("/") : "";
    };

    if (["send", "status", "cancel", "pdf", "supersede", "design-up", "design"].includes(action)) {
      const auth = req.headers.get("Authorization") ?? "";
      if (!auth) return json({ error: "Not signed in" }, 401);
      const asCaller = { apikey: anon, Authorization: auth };
      const me = await call("who is calling", `${url}/auth/v1/user`, { headers: asCaller });
      const user = me.ok ? await me.json().catch(() => null) : null;
      if (!user?.id) return json({ error: "Not signed in" }, 401);
      const pr = await call("their role", `${url}/rest/v1/profiles?select=name,role&id=eq.${encodeURIComponent(user.id)}`,
        { headers: asCaller });
      const prof = (pr.ok ? await pr.json().catch(() => []) : [])[0] ?? {};
      if (!PRICE_ROLES.includes(String(prof.role ?? "")))
        return json({ error: "Your login cannot send contracts to sign" }, 403);

      const jobId = String(body.id ?? "").trim();
      if (!jobId) return json({ error: "Which job?" }, 400);
      // the job, read as the caller: a job they may not see is not there
      const got = await call("read the job", `${url}/rest/v1/jobs?select=id,customer,data&id=eq.${encodeURIComponent(jobId)}`,
        { headers: asCaller });
      const rows = got.ok ? await got.json().catch(() => []) : [];
      if (!rows.length) return json({ error: "That job is not saved online yet, or is not yours" }, 404);
      const job = (rows[0].data ?? {}) as Record<string, unknown>;

      const latestR = await rest("latest request", `sign_requests?job_id=eq.${encodeURIComponent(jobId)}&order=sent_at.desc&limit=1`);
      const latest = ((latestR.ok ? await latestR.json() : []) as Row[])[0];

      if (action === "status") {
        if (!latest) return json({ ok: true, request: null });
        let pdfUrl = "";
        if (latest.pdf_path) {
          const r = await call("download link", `${url}/storage/v1/object/sign/${BUCKET}/${latest.pdf_path}`, {
            method: "POST", headers: { ...admin, "Content-Type": "application/json" }, body: JSON.stringify({ expiresIn: 600 }) });
          const j = r.ok ? await r.json().catch(() => ({})) : {};
          if (j.signedURL) pdfUrl = `${url}/storage/v1${j.signedURL}`;
        }
        return json({ ok: true, request: publicStamp(latest), pdfUrl });
      }
      /* 2.28: a stored contract of this job only: remote/<job>/x.pdf or in-person/<job>/x.pdf */
      const storedPath = async (): Promise<string> => {
        const p = String(body.path ?? "");
        const parts = p.split("/");
        if (parts.length === 3 && ["remote", "in-person"].includes(parts[0]) &&
            (parts[1] === jobId || parts[1] === encodeURIComponent(jobId)) &&
            /^[^/]+\.pdf$/.test(parts[2]) && !p.includes("..")) return p;
        const reqId = String(body.request ?? "");
        if (!/^[0-9a-f-]{36}$/i.test(reqId)) return "";
        const r = await rest("the request's PDF", `sign_requests?select=pdf_path&id=eq.${reqId}&job_id=eq.${encodeURIComponent(jobId)}`);
        return String(((r.ok ? await r.json() : []) as { pdf_path: string | null }[])[0]?.pdf_path ?? "");
      };
      if (action === "pdf") {
        const p = await storedPath();
        if (!p) return json({ error: "There is no stored copy of that contract" }, 404);
        const r = await call("download link", `${url}/storage/v1/object/sign/${BUCKET}/${p}`, {
          method: "POST", headers: { ...admin, "Content-Type": "application/json" }, body: JSON.stringify({ expiresIn: 600 }) });
        const j = r.ok ? await r.json().catch(() => ({})) : {};
        if (!j.signedURL) return json({ error: "That PDF is not in the store" }, 404);
        return json({ ok: true, path: p, url: `${url}/storage/v1${j.signedURL}` });
      }
      if (action === "supersede") {
        const p = await storedPath();
        if (!p || /-SUPERSEDED\.pdf$/.test(p)) return json({ error: "Which stored contract?" }, 400);
        const pdf = String(body.pdf ?? "").replace(/\s+/g, "");
        if (!pdf || !/^[A-Za-z0-9+/]+=*$/.test(pdf) || pdf.length * 0.75 > MAX_PDF_BYTES)
          return json({ error: "The PDF did not come through" }, 400);
        const bytes = b64ToBytes(pdf);
        if (new TextDecoder().decode(bytes.slice(0, 4)) !== "%PDF") return json({ error: "That is not a PDF" }, 400);
        const to = p.replace(/\.pdf$/, "-SUPERSEDED.pdf");      // the original stays as it was signed
        const up = await call("store the superseded copy", `${url}/storage/v1/object/${BUCKET}/${to}`, {
          method: "POST", headers: { ...admin, "Content-Type": "application/pdf", "x-upsert": "true" }, body: bytes as BodyInit });
        if (!up.ok) return json({ error: "The superseded copy could not be stored: " + (await up.text()).slice(0, 160) }, 502);
        // on the request too, when it was signed by link (columns from sql/remote-sign.sql, 2.28)
        await rest("mark the request superseded", `sign_requests?pdf_path=eq.${encodeURIComponent(p)}`, {
          method: "PATCH", body: JSON.stringify({ superseded_at: String(body.supersededAt ?? "") || new Date().toISOString(),
            superseded_by_rev: Number(body.rev ?? 0) || null, superseded_pdf_path: to }) }).catch(() => null);
        return json({ ok: true, path: to });
      }
      /* 2.70: the closet design PDF, one per job */
      if (action === "design-up") {
        const pdf = String(body.pdf ?? "").replace(/\s+/g, "");
        if (!pdf || !/^[A-Za-z0-9+/]+=*$/.test(pdf) || pdf.length * 0.75 > MAX_PDF_BYTES)
          return json({ error: "The design PDF did not come through (25 MB at most)" }, 400);
        const bytes = b64ToBytes(pdf);
        if (new TextDecoder().decode(bytes.slice(0, 4)) !== "%PDF") return json({ error: "That is not a PDF" }, 400);
        const to = `designs/${encodeURIComponent(jobId)}/${newSecret().slice(0, 24)}.pdf`;
        const up = await call("store the design", `${url}/storage/v1/object/${BUCKET}/${to}`, {
          method: "POST", headers: { ...admin, "Content-Type": "application/pdf", "x-upsert": "true" }, body: bytes as BodyInit });
        if (!up.ok) return json({ error: "The design could not be stored: " + (await up.text()).slice(0, 160) }, 502);
        return json({ ok: true, path: to });
      }
      if (action === "design") {
        const p = designPath(String(body.path ?? ""), jobId);
        const link = p ? await signedUrl(p) : "";
        if (!link) return json({ error: "That closet design is not in the store" }, 404);
        return json({ ok: true, url: link });
      }
      if (action === "cancel") {
        if (!latest || latest.status !== "sent") return json({ error: "There is no unsigned link to stop" }, 409);
        return json({ ok: true, request: publicStamp(await patch(latest.id, { status: "cancelled" })) });
      }

      // send
      if (latest && ["signed", "done"].includes(latest.status) && !body.again)
        return json({ error: "This job was signed on " + day(latest.signed_at) + ". Sending it again makes " +
          revLabel(nextRev(job as { signed?: Signed; contracts?: Contract[] })) + "; the signed one is kept, marked superseded.",
          already: true }, 409);
      const to = String(job.email ?? "").trim();
      if (!EMAIL.test(to)) return json({ error: "The customer email on this job does not look right" }, 400);
      if (latest && latest.status === "sent") await patch(latest.id, { status: "cancelled" });
      const secret = newSecret();
      const ins = await rest("save the request", "sign_requests", {
        method: "POST", headers: { Prefer: "return=representation" },
        body: JSON.stringify({
          token_hash: await sha256(secret), job_id: jobId, job, fp: String(body.fp ?? "") || null,
          customer_name: String(job.customer ?? ""), sent_to: to, sent_by: user.id,
          sent_by_name: String(prof.name ?? job.salesRep ?? ""), sent_by_email: user.email ?? null,
        }) });
      if (!ins.ok) return json({ error: "Could not save the request. Has sql/remote-sign.sql been run? " +
        (await ins.text()).slice(0, 160) }, 500);
      const row = ((await ins.json()) as Row[])[0];
      const link = `${pageUrl}#sign=${secret}`;
      const who = String(job.customer ?? "").trim() || "there";
      const rep = row.sent_by_name || "your Grinyer sales associate";
      try {
        await sendMail({
          to: [to], ...(EMAIL.test(String(user.email ?? "")) ? { reply_to: user.email } : {}),
          subject: "Your Grinyer contract is ready to sign",
          html: `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:600px;margin:0 auto;color:#2A2A2A">` +
            `<div style="border-top:4px solid #B5121B;padding:20px 4px 6px">` +
            `<p style="font-size:15px;margin:0 0 14px">Hello ${esc(who)},</p>` +
            `<p style="font-size:15px;line-height:1.5;margin:0 0 14px">${esc(rep)} has sent your Grinyer Interior ` +
            `Doors &amp; Closets contract for you to review and sign. It takes a few minutes on a phone, tablet or computer.</p>` +
            `<p style="margin:22px 0"><a href="${esc(link)}" style="background:#B5121B;color:#fff;text-decoration:none;` +
            `padding:12px 22px;border-radius:6px;font-weight:600;font-size:15px">Review and sign</a></p>` +
            `<p style="font-size:13px;line-height:1.5;color:#6B6B6B;margin:0 0 10px">This link is just for you and ` +
            `works until ${esc(day(row.expires_at))}. When you sign, a copy of the signed contract is emailed to you.</p>` +
            `<p style="font-size:13px;line-height:1.5;color:#6B6B6B;margin:0">Questions? Reply to this email or call 877 566 4052.</p>` +
            `</div><p style="color:#6B6B6B;font-size:12px;border-top:1px solid #C8C8C8;padding-top:10px;margin:18px 0 0">` +
            `Grinyer Interior Doors &amp; Closets, 1177 Franklin Blvd, Cambridge, ON</p></div>`,
          text: `Hello ${who},\n\n${rep} has sent your Grinyer Interior Doors & Closets contract for you to review and sign.\n\n` +
            `Review and sign: ${link}\n\nThis link is just for you and works until ${day(row.expires_at)}. ` +
            `When you sign, a copy of the signed contract is emailed to you.\n\nQuestions? Call 877 566 4052.`,
        });
      } catch (e) {
        await patch(row.id, { status: "cancelled" }).catch(() => {});
        return json({ error: (e as Error).message + ". Nothing was sent." }, 502);
      }
      return json({ ok: true, request: publicStamp(row) });
    }

    /* ---------------- the customer's actions ---------------- */
    if (!["open", "sign", "finish", "closet"].includes(action)) return json({ error: "Unknown action" }, 400);
    const secret = String(body.token ?? "");
    if (!/^[A-Za-z0-9_-]{40,60}$/.test(secret)) return json({ error: "This link is not complete. Open it again from the email." }, 400);
    const found = await rest("find the request", `sign_requests?token_hash=eq.${await sha256(secret)}&limit=1`);
    const r = ((found.ok ? await found.json() : []) as Row[])[0];
    if (!r || r.status === "cancelled")
      return json({ error: "This link no longer works. Ask your Grinyer sales associate to send a new one.", gone: true }, 404);
    if (r.status === "sent" && new Date(r.expires_at).getTime() < Date.now())
      return json({ error: "This link has expired. Ask your Grinyer sales associate to send a new one.", gone: true }, 410);

    if (action === "open") {
      const row = r.opened_at ? r : await patch(r.id, { opened_at: new Date().toISOString() });
      return json({ ok: true, request: publicStamp(row), job: row.status === "sent" ? row.job : null,
        signedJob: row.status !== "sent" ? row.job : null, fp: row.fp,
        // signed but the PDF never arrived: the page finishes it from these
        signed: row.status === "signed" ? row.signed : null });
    }

    // 2.70: the closet design on the order as it was sent
    if (action === "closet") {
      const f = ((r.job as { closetFile?: { path?: string } })?.closetFile ?? {}) as { path?: string };
      const p = designPath(String(f.path ?? ""), r.job_id);
      const link = p ? await signedUrl(p) : "";
      if (!link) return json({ error: "The closet design is not in the store" }, 404);
      return json({ ok: true, url: link });
    }

    if (action === "sign") {
      if (r.status !== "sent")      // already signed: hand back the same stamp, never new strokes
        return json({ ok: true, request: publicStamp(r), already: true });
      const s = (body.signed ?? {}) as { name?: string; marks?: Record<string, unknown> };
      const marks = s.marks ?? {};
      if (!s.name || !String(s.name).trim() || !Object.keys(marks).length || JSON.stringify(marks).length > 2_000_000)
        return json({ error: "The signatures did not come through. Try again." }, 400);
      const row = await patch(r.id, {
        status: "signed", signer_name: String(s.name).trim().slice(0, 120), signed: s,
        signed_at: new Date().toISOString(), signer_ip: ipOf(req),
        signer_agent: (req.headers.get("user-agent") ?? "").slice(0, 300),
      });
      return json({ ok: true, request: publicStamp(row) });
    }

    // finish: store the PDF, write the signatures onto the job, email both
    if (r.status === "done") return json({ ok: true, request: publicStamp(r), already: true });
    if (r.status !== "signed") return json({ error: "Sign first" }, 409);
    const pdf = String(body.pdf ?? "").replace(/\s+/g, "");
    if (!pdf || !/^[A-Za-z0-9+/]+=*$/.test(pdf) || pdf.length * 0.75 > MAX_PDF_BYTES)
      return json({ error: "The contract PDF did not come through" }, 400);
    const bytes = b64ToBytes(pdf);
    if (new TextDecoder().decode(bytes.slice(0, 4)) !== "%PDF") return json({ error: "That is not a PDF" }, 400);

    const safeName = String(r.customer_name || "customer").replace(/[^\w -]+/g, "").trim().replace(/\s+/g, "-").slice(0, 60) || "customer";
    const path = `remote/${r.job_id}/${r.signed_at!.slice(0, 19).replace(/[:T]/g, "-")}-${safeName}.pdf`;
    const up = await call("store the PDF", `${url}/storage/v1/object/${BUCKET}/${path}`, {
      method: "POST", headers: { ...admin, "Content-Type": "application/pdf", "x-upsert": "true" }, body: bytes as BodyInit });
    if (!up.ok) return json({ error: "The signed contract could not be stored: " + (await up.text()).slice(0, 160) }, 502);
    let row = await patch(r.id, { pdf_path: path, pdf_sha256: await sha256(bytes) });

    // 2.28: the revision, worked out from the order as sent, as the page did
    const rev = nextRev(r.job as { signed?: Signed; contracts?: Contract[] });
    let replaced: Signed | null = null;

    // the signatures onto the job itself, so the associate's app shows it signed
    try {
      const jr = await rest("read the job", `jobs?select=data&id=eq.${encodeURIComponent(r.job_id)}`);
      const jd = ((jr.ok ? await jr.json() : []) as { data: Record<string, unknown> }[])[0];
      if (jd) {
        const s = (r.signed ?? {}) as Record<string, unknown>;
        // the contract signed before is kept, marked superseded by this one
        const old = (jd.data.signed ?? null) as Signed | null;
        let contracts = (jd.data.contracts ?? []) as Contract[];
        if (old?.at && old.request !== r.id) {
          let oldPath = old.path ?? "";
          if (!oldPath && old.request) {
            const q = await rest("the old request's PDF", `sign_requests?select=pdf_path&id=eq.${encodeURIComponent(old.request)}`);
            oldPath = String(((q.ok ? await q.json() : []) as { pdf_path: string | null }[])[0]?.pdf_path ?? "");
          }
          replaced = old;
          contracts = contracts.concat([{ rev: old.rev ?? 0, at: old.at, name: old.name ?? "", where: old.where ?? "in person",
            ip: old.ip ?? "", request: old.request ?? "", path: oldPath, fp: old.fp ?? "",
            supersededAt: r.signed_at ?? new Date().toISOString(), supersededBy: rev }]);
        }
        const data = { ...jd.data, contracts,
          signed: { ...s, at: r.signed_at, name: r.signer_name, where: "remote", fp: r.fp ?? s.fp,
                    ip: r.signer_ip, agent: r.signer_agent, request: r.id, rev, path },
          remoteSign: { ...publicStamp(row), status: "done" } };
        await rest("write it onto the job", `jobs?id=eq.${encodeURIComponent(r.job_id)}`, {
          method: "PATCH", body: JSON.stringify({ data, updated: new Date().toISOString() }) });
      }
    } catch (e) { console.log("job not updated: " + (e as Error).message); }

    // 2.32: special order items are named in the email too
    const sd = (r.job as { specialOrder?: unknown })?.specialOrder;
    const so: string[] = Array.isArray(sd) ? sd.map((x: unknown) => String(x)).slice(0, 30) : [];
    const to = [r.sent_to, ...(r.sent_by_email && EMAIL.test(r.sent_by_email) &&
      r.sent_by_email.toLowerCase() !== r.sent_to.toLowerCase() ? [r.sent_by_email] : [])];
    let emailed: string[] = [];
    try {
      await sendMail({
        to, ...(r.sent_by_email ? { reply_to: r.sent_by_email } : {}),
        subject: `Your Grinyer contract${rev ? " " + revLabel(rev) : ""}, signed ${day(r.signed_at)}`,
        html: `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:600px;margin:0 auto;color:#2A2A2A">` +
          `<div style="border-top:4px solid #B5121B;padding:20px 4px 6px">` +
          `<p style="font-size:15px;margin:0 0 14px">Hello ${esc(r.customer_name || "")},</p>` +
          `<p style="font-size:15px;line-height:1.5;margin:0 0 14px">Thank you. Your signed Grinyer contract is attached. ` +
          `Signed electronically by ${esc(r.signer_name)} on ${esc(day(r.signed_at))}.` +
          (rev ? ` This is ${revLabel(rev)}${replaced?.at ? `, and replaces the contract signed ${esc(day(replaced.at))}, which is now superseded` : ""}.` : "") +
          `</p>` +
          (so.length ? `<p style="font-size:15px;line-height:1.5;margin:0 0 14px;color:#B5121B"><b>Special order items:</b> ` +
            `${so.map(esc).join("<br>")}<br><b>Special order items are made for this order and cannot be returned or refunded.</b></p>` : "") +
          `<p style="font-size:15px;line-height:1.5;margin:0 0 14px">If anything on it is not right, reply to this email or ` +
          `call 877 566 4052 within 24 hours, before we order your materials.</p></div>` +
          `<p style="color:#6B6B6B;font-size:12px;border-top:1px solid #C8C8C8;padding-top:10px;margin:18px 0 0">` +
          `Grinyer Interior Doors &amp; Closets, 1177 Franklin Blvd, Cambridge, ON</p></div>`,
        text: `Thank you. Your signed Grinyer contract is attached. Signed electronically by ${r.signer_name} on ${day(r.signed_at)}.` +
          (rev ? ` This is ${revLabel(rev)}${replaced?.at ? `, and replaces the contract signed ${day(replaced.at)}, which is now superseded` : ""}.` : "") +
          (so.length ? `\n\nSpecial order items: ${so.join("; ")}. Special order items are made for this order and cannot be returned or refunded.` : ""),
        attachments: [{ filename: path.split("/").pop(), content: pdf }],
      });
      emailed = to;
    } catch (e) { console.log("final email: " + (e as Error).message); }
    row = await patch(r.id, { status: "done", ...(emailed.length ? { emailed_at: new Date().toISOString(), emailed_to: emailed } : {}) });
    return json({ ok: true, request: publicStamp(row), emailed });
  } catch (e) {
    console.log("fell over: " + ((e as Error)?.message ?? e));
    return json({ error: (e as Error)?.message ?? "Something went wrong" }, 500);
  }
});

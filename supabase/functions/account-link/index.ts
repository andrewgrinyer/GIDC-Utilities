// Supabase Edge Function: account-link
//
// The three things a person does with a link sent to their own mailbox,
// none of which need an administrator.
//
//   {action:"forgot",  email}   Not signed in. Sends a link to set a new
//                               password, if that address has a login. Says
//                               the same thing either way, so this cannot be
//                               used to find out who has a login.
//   {action:"resend"}           Signed in. Sends this person a link that
//                               proves their address, for the banner.
//   {action:"confirm"}          Signed in BY FOLLOWING A LINK. Records that
//                               this person proved their address. The only
//                               thing anywhere that sets email_verified_at.
//
// Why confirm can be trusted: the token the page sends carries how the
// session was started. A session started by a password says "password". One
// started by a link from an email says "otp", "invite", "recovery" or
// "magiclink", and only somebody who could read that mailbox can start one.
// So confirm refuses a password session, and refuses one older than half an
// hour, because the claim stays on the session for as long as it lives.
//
// Deploy:  Supabase dashboard, Edge Functions, Deploy a new function, Via
//          Editor, named exactly account-link. Paste this in and deploy.
//          Then open its Details and turn OFF "Enforce JWT verification".
//          forgot is used by somebody who is not signed in, so there is no
//          token to verify; the two actions that need one check it here.
//
// Secrets it reads, set under Edge Functions, Secrets:
//   RESEND_API_KEY      required. Already set for the order emails.
//   LOGIN_EMAIL_FROM    optional, falls back to ORDER_EMAIL_FROM, then to
//                       Resend's test address
//   ACCOUNT_PAGE_URL    optional, defaults to https://dealers.gidc.ca/account
//
// No imports, on purpose, the same as send-goback: plain HTTP with a
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
// One link per address per this long. Stops a stranger filling somebody's
// inbox by pressing forgot over and over.
const GAP_MS = 2 * 60 * 1000;
// How recently a session must have been started by a link for confirm.
const FRESH_MS = 30 * 60 * 1000;
const LINK_METHODS = ["otp", "magiclink", "invite", "recovery", "email/signup", "email_change"];

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
  String(v ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

// The letter itself. Kept plain: a button, the same link written out in
// case the button is stripped, and one line on what to do if it was not
// expected.
function letter(kind: "reset" | "verify", name: string, link: string) {
  const hi = name ? `Hello ${name},` : "Hello,";
  const subject = kind === "reset"
    ? "Set a new password for your Grinyer login"
    : "Confirm your email address for Grinyer";
  const lead = kind === "reset"
    ? "Somebody asked to set a new password for your Grinyer login. If that was you, " +
      "press the button and choose one."
    : "Please confirm this is your email address. Press the button and that is all: " +
      "nothing else changes and you will not be asked for a password.";
  const button = kind === "reset" ? "Set my password" : "Confirm my address";
  const after = kind === "reset"
    ? "If you did not ask for this, ignore this email. Your password stays as it is."
    : "If you do not have a Grinyer login, ignore this email.";
  const html =
    `<div style="font:15px/1.5 -apple-system,Segoe UI,Arial,sans-serif;color:#24262B;max-width:520px">` +
    `<p>${esc(hi)}</p><p>${esc(lead)}</p>` +
    `<p style="margin:26px 0"><a href="${esc(link)}" style="background:#24262B;color:#fff;` +
    `padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600">${esc(button)}</a></p>` +
    `<p style="color:#6E6E76;font-size:13px">The link works once and runs out after a while. ` +
    `If the button does nothing, copy this into your browser:<br>` +
    `<span style="word-break:break-all">${esc(link)}</span></p>` +
    `<p style="color:#6E6E76;font-size:13px">${esc(after)}</p>` +
    `<p>Grinyer</p></div>`;
  const text = [hi, "", lead, "", link, "", after, "", "Grinyer"].join("\n");
  return { subject, html, text };
}

// Reads the claims out of a token that Supabase has already said is good.
// Not a check of the signature: getUser did that a moment before.
function claims(token: string): Record<string, unknown> {
  try {
    const part = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(part + "=".repeat((4 - part.length % 4) % 4)));
  } catch {
    return {};
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  try {
    const url = Deno.env.get("SUPABASE_URL") ?? "";
    const anon = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const resendKey = Deno.env.get("RESEND_API_KEY") ?? "";
    const page = Deno.env.get("ACCOUNT_PAGE_URL") ?? "https://dealers.gidc.ca/account";
    const from = Deno.env.get("LOGIN_EMAIL_FROM")
      ?? Deno.env.get("ORDER_EMAIL_FROM")
      ?? "onboarding@resend.dev";
    if (!url || !anon || !service)
      return json({ error: "This function cannot see its Supabase settings. Deploy it again." }, 500);

    const asAdmin = { apikey: service, Authorization: `Bearer ${service}`,
                      "Content-Type": "application/json" };

    let body: Record<string, string>;
    try { body = await req.json(); } catch { return json({ error: "Bad request" }, 400); }
    const action = String(body.action ?? "");

    // Who is signed in, if anybody. Asked of Supabase, never taken from the
    // request, so a made up token gets nowhere.
    const auth = req.headers.get("Authorization") ?? "";
    const token = auth.replace(/^Bearer\s+/i, "");
    async function signedIn() {
      if (!token) return null;
      const r = await call("who is this", `${url}/auth/v1/user`,
        { headers: { apikey: anon, Authorization: `Bearer ${token}` } });
      if (!r.ok) return null;
      const u = await r.json().catch(() => null);
      return u && u.id ? u as { id: string; email: string } : null;
    }

    // Sends one link to one address, at most once every GAP_MS. The time of
    // the last one is kept on the login itself, where nobody but this kind
    // of function can write.
    async function sendLink(kind: "reset" | "verify", id: string, email: string, name: string) {
      if (!resendKey) throw new Error("No sending account is set up yet. Add RESEND_API_KEY in Supabase.");
      const got = await call("read the login", `${url}/auth/v1/admin/users/${id}`, { headers: asAdmin });
      const u = got.ok ? await got.json().catch(() => ({})) : {};
      const meta = (u.app_metadata ?? {}) as Record<string, unknown>;
      const last = Date.parse(String(meta.link_sent_at ?? ""));
      if (isFinite(last) && Date.now() - last < GAP_MS) return "throttled";

      const made = await call("make the link", `${url}/auth/v1/admin/generate_link`, {
        method: "POST", headers: asAdmin,
        body: JSON.stringify({ type: kind === "reset" ? "recovery" : "magiclink", email }),
      });
      const link = await made.json().catch(() => ({}));
      const hashed = link.hashed_token ?? link.properties?.hashed_token;
      const vtype = link.verification_type ?? link.properties?.verification_type
        ?? (kind === "reset" ? "recovery" : "magiclink");
      if (!made.ok || !hashed) throw new Error("Supabase would not make a link for that login");

      const href = `${page}?k=${encodeURIComponent(vtype)}&t=${encodeURIComponent(hashed)}`;
      const mail = letter(kind, name, href);
      const sent = await call("resend", "https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from, to: [email], subject: mail.subject, html: mail.html, text: mail.text }),
      });
      if (!sent.ok) {
        console.log("resend refused it: " + (await sent.text().catch(() => "")).slice(0, 400));
        throw new Error("The email would not send");
      }
      await call("note when it went", `${url}/auth/v1/admin/users/${id}`, {
        method: "PUT", headers: asAdmin,
        body: JSON.stringify({ app_metadata: { ...meta, link_sent_at: new Date().toISOString() } }),
      }).catch(() => {});
      return "sent";
    }

    // ------------------------------------------------------------ forgot
    if (action === "forgot") {
      const email = String(body.email ?? "").trim().toLowerCase();
      const same = { ok: true, said:
        "If that address has a Grinyer login, a link to set a new password is on its way. " +
        "It can take a minute or two." };
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))
        return json({ error: "That is not an email address" }, 400);
      // ilike so an address stored with capitals is still found, with the
      // two characters ilike treats as wildcards taken literally.
      const like = email.replace(/[\\%_]/g, (c) => "\\" + c);
      const r = await call("find the login",
        `${url}/rest/v1/profiles?select=id,name,email&email=ilike.${encodeURIComponent(like)}`,
        { headers: asAdmin });
      const rows = r.ok ? await r.json().catch(() => []) : [];
      if (!rows.length) return json(same);
      try { await sendLink("reset", rows[0].id, email, rows[0].name ?? ""); }
      catch (e) { console.log("forgot: " + (e as Error).message); }
      return json(same);
    }

    const me = await signedIn();
    if (!me) return json({ error: "Not signed in" }, 401);

    // ------------------------------------------------------------ resend
    if (action === "resend") {
      const r = await call("read the profile",
        `${url}/rest/v1/profiles?select=name,email&id=eq.${me.id}`, { headers: asAdmin });
      const p = (r.ok ? await r.json().catch(() => []) : [])[0] ?? {};
      const how = await sendLink("verify", me.id, me.email, p.name ?? "");
      return json({ ok: true, throttled: how === "throttled",
        said: how === "throttled"
          ? "One was sent in the last couple of minutes. Check your inbox and your junk folder."
          : `A link is on its way to ${me.email}.` });
    }

    // ----------------------------------------------------------- confirm
    if (action === "confirm") {
      const c = claims(token);
      const amr = Array.isArray(c.amr) ? c.amr as { method?: string; timestamp?: number }[] : [];
      const viaLink = amr.find((a) =>
        LINK_METHODS.includes(String(a.method)) &&
        Date.now() - Number(a.timestamp ?? 0) * 1000 < FRESH_MS);
      if (!viaLink)
        return json({ error: "This only works straight after following a link from your email" }, 403);

      // The address proven is the one the link went to, which is the
      // login's. The profile is only stamped while it says the same.
      const r = await call("stamp it",
        `${url}/rest/v1/profiles?id=eq.${me.id}&email=ilike.` +
          encodeURIComponent(String(me.email).replace(/[\\%_]/g, (c) => "\\" + c)),
        { method: "PATCH", headers: { ...asAdmin, Prefer: "return=representation" },
          body: JSON.stringify({ email_verified_at: new Date().toISOString() }) });
      if (!r.ok) {
        const said = await r.text().catch(() => "");
        // Before email-verification.sql has run there is no column to stamp.
        // The person did nothing wrong, so they are not told off for it.
        if (/email_verified_at/.test(said)) return json({ ok: true, recorded: false });
        return json({ error: "Could not record that" }, 500);
      }
      const rows = await r.json().catch(() => []);
      // PATCH that matches nothing is a 200 with an empty list, not an error.
      return json({ ok: true, recorded: rows.length > 0 });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    console.log("failed: " + ((e as Error)?.message ?? e));
    return json({ error: (e as Error)?.message ?? "Something went wrong" }, 500);
  }
});

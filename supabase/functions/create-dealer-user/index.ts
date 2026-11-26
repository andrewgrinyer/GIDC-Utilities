// Supabase Edge Function: create-dealer-user
//
// Makes a login, changes its name or address, sends it a link, or removes
// it. All of these need a key that can administer accounts, and that key
// must never sit in a web page, so they live here instead. The browser only
// ever sends the signed in administrator's own token, and this function asks
// the database whether that person really is an administrator rather than
// taking their word for it.
//
// Nobody chooses anybody else's password (decided 21 October 2026). A new
// login gets an invitation by email and the person sets their own, which
// proves the address in the same act. A forgotten password gets a link the
// same way. There is no longer an action that sets a password.
//
// Deploy:  supabase functions deploy create-dealer-user
// Or paste this whole file into the Supabase editor over the earlier version.
// SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are already
// there. RESEND_API_KEY is already set for the order emails. Optional:
// LOGIN_EMAIL_FROM (falls back to ORDER_EMAIL_FROM) and ACCOUNT_PAGE_URL
// (defaults to https://dealers.gidc.ca/account).
//
// Needs two-sided-access.sql to have run: a login is written with role for
// the team side and dealer_role for the dealer side.
//
// Body:
//   {action:"create", name, email, role, dealer_role, dealer_id}  (the default)
//   {action:"update", id, name, email}
//   {action:"reset",  id}          send a link to set a password
//   {action:"verify", id}          send a link that proves the address
//   {action:"verify", all:true}    the same, to everybody not yet proven
//   {action:"delete", id}

import { createClient } from "jsr:@supabase/supabase-js@2";

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

const TEAM = ["admin", "user", "sales", "manufacturing", "installer"];
const DEALER = ["dealer", "dealer_admin"];

const esc = (v: unknown) =>
  String(v ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

// The same letters account-link sends, plus the invitation. Written out in
// both functions because each is pasted into the Supabase editor on its own
// and cannot import from the other.
function letter(kind: "invite" | "welcome" | "reset" | "verify", name: string, link: string) {
  const hi = name ? `Hello ${name},` : "Hello,";
  const t = {
    invite: ["Your Grinyer login",
      "Grinyer has made you a login. Press the button to choose your password and you are in.",
      "Choose my password", "If you were not expecting this, ignore this email."],
    welcome: ["Your Grinyer login",
      "Here is a fresh link to choose the password for your Grinyer login.",
      "Choose my password", "If you were not expecting this, ignore this email."],
    reset: ["Set a new password for your Grinyer login",
      "Grinyer has sent you a link to set a new password. Press the button and choose one.",
      "Set my password", "If you did not ask for this, ignore this email. Your password stays as it is."],
    verify: ["Confirm your email address for Grinyer",
      "Please confirm this is your email address. Press the button and that is all: " +
        "nothing else changes and you will not be asked for a password.",
      "Confirm my address", "If you do not have a Grinyer login, ignore this email."],
  }[kind];
  const [subject, lead, button, after] = t;
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  // 1. who is asking
  const auth = req.headers.get("Authorization") ?? "";
  if (!auth) return json({ error: "Not signed in" }, 401);

  const caller = createClient(url, anon, { global: { headers: { Authorization: auth } } });
  const { data: who, error: whoErr } = await caller.auth.getUser();
  if (whoErr || !who?.user) return json({ error: "Not signed in" }, 401);

  // Asked of the database's own rule, so a stood down or unverified
  // administrator is refused here exactly as everywhere else.
  const { data: isAdmin } = await caller.rpc("is_admin");
  if (isAdmin !== true)
    return json({ error: "Only a Grinyer administrator can change logins" }, 403);

  // 2. what they asked for
  let body: Record<string, string>;
  try { body = await req.json(); } catch { return json({ error: "Bad request" }, 400); }

  const action = String(body.action ?? "create");
  const admin = createClient(url, service, { auth: { persistSession: false } });

  const resendKey = Deno.env.get("RESEND_API_KEY") ?? "";
  const page = Deno.env.get("ACCOUNT_PAGE_URL") ?? "https://dealers.gidc.ca/account";
  const from = Deno.env.get("LOGIN_EMAIL_FROM")
    ?? Deno.env.get("ORDER_EMAIL_FROM")
    ?? "onboarding@resend.dev";

  // Makes a one time link. The link opens the account page with a token the
  // page trades for a session, rather than signing anybody in on the spot,
  // so a mail scanner that opens every link cannot use it up.
  async function makeLink(kind: "invite" | "welcome" | "reset" | "verify",
                          email: string, data?: Record<string, string>) {
    const type = kind === "invite" ? "invite" : kind === "verify" ? "magiclink" : "recovery";
    const { data: made, error } = await admin.auth.admin.generateLink(
      // deno-lint-ignore no-explicit-any
      { type, email, options: data ? { data } : undefined } as any);
    if (error || !made?.properties?.hashed_token)
      throw new Error(error?.message ?? "Supabase would not make a link");
    const p = made.properties;
    const href = `${page}?k=${encodeURIComponent(p.verification_type ?? type)}` +
                 `&t=${encodeURIComponent(p.hashed_token)}`;
    return { user: made.user, href };
  }
  async function sendLink(kind: "invite" | "welcome" | "reset" | "verify",
                          email: string, name: string, href: string) {
    const mail = letter(kind, name, href);
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [email], subject: mail.subject, html: mail.html, text: mail.text }),
    });
    if (!r.ok) {
      console.log("resend refused it: " + (await r.text().catch(() => "")).slice(0, 400));
      throw new Error("The email would not send");
    }
  }
  async function mailLink(kind: "welcome" | "reset" | "verify", email: string, name: string) {
    const { href } = await makeLink(kind, email);
    await sendLink(kind, email, name, href);
  }
  // Every action below sends an email, so there is no point starting one
  // that cannot finish.
  if (!resendKey && action !== "delete")
    return json({ error: "No sending account is set up yet. Add RESEND_API_KEY in Supabase." }, 400);

  // ------------------------------------------------------------------- reset
  // A link to choose a password. Somebody who has never signed in gets the
  // welcome wording, because for them it is the invitation, again.
  if (action === "reset") {
    const id = String(body.id ?? "").trim();
    if (!id) return json({ error: "Which login?" }, 400);
    const { data: got, error } = await admin.auth.admin.getUserById(id);
    if (error || !got?.user?.email) return json({ error: "That login is not there" }, 404);
    const { data: prof } = await admin.from("profiles").select("name").eq("id", id).single();
    try {
      await mailLink(got.user.last_sign_in_at ? "reset" : "welcome",
                     got.user.email, prof?.name ?? "");
    } catch (e) { return json({ error: (e as Error).message }, 502); }
    return json({ ok: true, id, action, email: got.user.email });
  }

  // ------------------------------------------------------------------ verify
  // A link that proves the address and does nothing else. To one login, or
  // to everybody with some access who has not proven theirs yet. Paced,
  // because the sending account accepts only a few a second.
  if (action === "verify") {
    let q = admin.from("profiles").select("id, name, email, role, dealer_role, email_verified_at");
    if (String(body.all ?? "") === "true") {
      q = q.is("email_verified_at", null);
    } else {
      const id = String(body.id ?? "").trim();
      if (!id) return json({ error: "Which login?" }, 400);
      q = q.eq("id", id);
    }
    const { data: rows, error } = await q;
    if (error) return json({ error: /email_verified_at/.test(error.message)
      ? "Run email-verification.sql first" : error.message }, 400);
    const sent: string[] = [], failed: string[] = [];
    for (const r of (rows ?? []).filter((r) => r.email && (r.role || r.dealer_role))) {
      try { await mailLink("verify", r.email, r.name ?? ""); sent.push(r.email); }
      catch (e) { console.log(`verify ${r.id}: ${(e as Error).message}`); failed.push(r.email); }
      await new Promise((ok) => setTimeout(ok, 600));
    }
    return json({ ok: failed.length === 0, action, sent: sent.length, failed });
  }

  // ------------------------------------------------------------------ delete
  if (action === "delete") {
    const id = String(body.id ?? "").trim();
    if (!id) return json({ error: "Which login?" }, 400);
    // Nobody removes themselves. It is the one mistake with no way back:
    // the last administrator could lock everyone out of the portal.
    if (id === who.user.id)
      return json({ error: "You cannot remove your own login" }, 400);

    const { data: them } = await admin
      .from("profiles").select("name, email, role").eq("id", id).single();

    // Refuse to remove the last administrator, for the same reason.
    if (them?.role === "admin") {
      const { count } = await admin
        .from("profiles").select("id", { count: "exact", head: true }).eq("role", "admin");
      if ((count ?? 0) <= 1)
        return json({ error: "That is the only administrator left, so it cannot be removed" }, 400);
    }

    // The profile first, in case the two are not tied together by the
    // database. If they are, this is simply done twice, which is harmless.
    await admin.from("profiles").delete().eq("id", id);
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error) return json({ error: "Could not remove that login: " + error.message }, 400);

    // Their orders are not touched. An order belongs to the dealer, not to
    // the person who typed it, so the history stays intact.
    return json({ ok: true, id, action, name: them?.name ?? null, email: them?.email ?? null });
  }

  // ------------------------------------------------------------------ update
  //
  // Andrew, 19 October: an edit button for a login's name and details.
  //
  // The name lives on the profile and nowhere else, so that half is easy.
  // The email is the thing they sign in with, so it lives on the login as
  // well as on the profile, and the two must never disagree: a list
  // showing an address that cannot sign in is worse than no edit at all.
  // So the login is changed first and the profile only afterwards, and a
  // profile that will not follow puts the login back.
  if (action === "update") {
    const id = String(body.id ?? "").trim();
    const name = String(body.name ?? "").trim();
    const email = String(body.email ?? "").trim().toLowerCase();
    if (!id) return json({ error: "Which login?" }, 400);
    if (name.length < 2) return json({ error: "Give the person a name" }, 400);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))
      return json({ error: "That is not an email address" }, 400);

    const { data: before } = await admin
      .from("profiles").select("name, email").eq("id", id).single();
    const was = String(before?.email ?? "").toLowerCase();

    if (email !== was) {
      const { error: mailErr } = await admin.auth.admin.updateUserById(id, {
        email,
        email_confirm: true,       // an address set here is taken as confirmed,
                                   // the same as one set when the login is made
      });
      if (mailErr) {
        const m = mailErr.message ?? "";
        return json({ error: /already|registered/i.test(m)
          ? "There is already a login with that address"
          : "Could not change that address: " + m }, 400);
      }
    }

    // A new address has not been proven by anybody, so the old proof does
    // not carry over to it.
    const change: Record<string, unknown> = { name, email };
    if (email !== was) change.email_verified_at = null;
    let { error: profErr } = await admin.from("profiles").update(change).eq("id", id);
    if (profErr && /email_verified_at/.test(profErr.message ?? "")) {
      // before email-verification.sql has run there is nothing to clear
      ({ error: profErr } = await admin.from("profiles").update({ name, email }).eq("id", id));
    }
    if (profErr) {
      // put the address back, so the two sides still agree
      if (email !== was && was)
        await admin.auth.admin.updateUserById(id, { email: was, email_confirm: true });
      return json({ error: "Could not save that: " + profErr.message }, 400);
    }

    let verify_sent = false;
    if (email !== was) {
      try { await mailLink("verify", email, name); verify_sent = true; }
      catch (e) { console.log("verify after change: " + (e as Error).message); }
    }
    return json({ ok: true, id, action, name, email,
                  email_changed: email !== was, verify_sent });
  }

  // ------------------------------------------------------------------ create
  // Either side may be empty, not both: a login with no access at all is a
  // login nobody needs.
  const email = String(body.email ?? "").trim().toLowerCase();
  const name = String(body.name ?? "").trim();
  const role = String(body.role ?? "").trim() || null;
  const dealer_role = String(body.dealer_role ?? "").trim() || null;
  const dealer_id = String(body.dealer_id ?? "").trim() || null;

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: "That is not an email address" }, 400);
  if (name.length < 2) return json({ error: "Give the person a name" }, 400);
  if (role && !TEAM.includes(role)) return json({ error: "Unknown team access" }, 400);
  if (dealer_role && !DEALER.includes(dealer_role)) return json({ error: "Unknown dealer access" }, 400);
  if (!role && !dealer_role) return json({ error: "Give them team access, dealer access, or both" }, 400);
  if (dealer_role && !dealer_id) return json({ error: "Choose which dealer this login is for" }, 400);

  // The invitation makes the login, with no password, and the trigger makes
  // its profile with no access. Access is written next, and the email goes
  // last, so nobody is ever sent a link to a login that was then removed.
  let made;
  try {
    made = await makeLink("invite", email, { name });
  } catch (e) {
    const m = (e as Error).message ?? "Could not create that login";
    return json({ error: /already/i.test(m) ? "There is already a login with that address" : m }, 400);
  }
  const newId = made.user?.id;
  if (!newId) return json({ error: "Supabase did not say which login it made" }, 400);

  const { error: linkErr } = await admin
    .from("profiles")
    .update({ name, email, role, dealer_role, dealer_id: dealer_role ? dealer_id : null })
    .eq("id", newId);

  if (linkErr) {
    // do not leave a login behind that nobody can use
    await admin.auth.admin.deleteUser(newId);
    return json({ error: "Could not give that login its access, so it was removed: " +
                         linkErr.message }, 400);
  }

  try { await sendLink("invite", email, name, made.href); }
  catch (e) {
    // The login is right, only the email failed. Send again will retry it.
    return json({ ok: true, id: newId, email, name, role, dealer_role, dealer_id,
                  warning: "The login is made but the invitation would not send. " +
                           "Press Send link on their row to try again." });
  }

  return json({ ok: true, id: newId, email, name, role, dealer_role, dealer_id });
});

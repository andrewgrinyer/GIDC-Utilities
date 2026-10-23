// Supabase Edge Function: create-dealer-user
//
// Makes a login, changes its name or address, changes a password, or removes
// a login. All three need a key
// that can administer accounts, and that key must never sit in a web page, so
// they live here instead. The browser only ever sends the signed in
// administrator's own token, and this function asks the database whether that
// person really is an administrator rather than taking their word for it.
//
// Deploy:  supabase functions deploy create-dealer-user
// Or paste this whole file into the Supabase editor over the earlier version.
// Nothing to configure. SUPABASE_URL, SUPABASE_ANON_KEY and
// SUPABASE_SERVICE_ROLE_KEY are already there.
//
// Body:
//   {action:"create", name, email, password, role, dealer_id}   (the default)
//   {action:"update",   id, name, email}
//   {action:"password", id, password}
//   {action:"delete",   id}

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

const PW_MIN = 10;

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

  const { data: me } = await caller
    .from("profiles").select("role").eq("id", who.user.id).single();
  if (!me || me.role !== "admin")
    return json({ error: "Only a Grinyer administrator can change logins" }, 403);

  // 2. what they asked for
  let body: Record<string, string>;
  try { body = await req.json(); } catch { return json({ error: "Bad request" }, 400); }

  const action = String(body.action ?? "create");
  const admin = createClient(url, service, { auth: { persistSession: false } });

  // ---------------------------------------------------------------- password
  if (action === "password") {
    const id = String(body.id ?? "").trim();
    const password = String(body.password ?? "");
    if (!id) return json({ error: "Which login?" }, 400);
    if (password.length < PW_MIN)
      return json({ error: `The password has to be at least ${PW_MIN} characters` }, 400);

    const { error } = await admin.auth.admin.updateUserById(id, { password });
    if (error) return json({ error: "Could not change that password: " + error.message }, 400);
    return json({ ok: true, id, action });
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

    const { error: profErr } = await admin
      .from("profiles").update({ name, email }).eq("id", id);
    if (profErr) {
      // put the address back, so the two sides still agree
      if (email !== was && was)
        await admin.auth.admin.updateUserById(id, { email: was, email_confirm: true });
      return json({ error: "Could not save that: " + profErr.message }, 400);
    }

    return json({ ok: true, id, action, name, email,
                  email_changed: email !== was });
  }

  // ------------------------------------------------------------------ create
  const email = String(body.email ?? "").trim().toLowerCase();
  const name = String(body.name ?? "").trim();
  const password = String(body.password ?? "");
  const role = String(body.role ?? "dealer");
  const dealer_id = String(body.dealer_id ?? "").trim() || null;

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: "That is not an email address" }, 400);
  if (name.length < 2) return json({ error: "Give the person a name" }, 400);
  if (password.length < PW_MIN)
    return json({ error: `The password has to be at least ${PW_MIN} characters` }, 400);
  if (!["dealer", "user", "admin"].includes(role)) return json({ error: "Unknown role" }, 400);
  if (role === "dealer" && !dealer_id) return json({ error: "Choose which dealer this login is for" }, 400);

  const { data: made, error: makeErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,           // they sign in straight away, no email round trip
    user_metadata: { name },
  });
  if (makeErr || !made?.user) {
    const m = makeErr?.message ?? "Could not create that login";
    return json({ error: /already/i.test(m) ? "There is already a login with that address" : m }, 400);
  }

  // point it at the dealer. The trigger has already made the profile row.
  const { error: linkErr } = await admin
    .from("profiles")
    .update({ name, email, role, dealer_id: role === "dealer" ? dealer_id : null })
    .eq("id", made.user.id);

  if (linkErr) {
    // do not leave a login behind that nobody can use
    await admin.auth.admin.deleteUser(made.user.id);
    return json({ error: "Made the login but could not link it, so it was removed: " + linkErr.message }, 400);
  }

  return json({ ok: true, id: made.user.id, email, name, role, dealer_id });
});

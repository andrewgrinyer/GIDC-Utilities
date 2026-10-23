// Supabase Edge Function: send-goback
//
// Emails a go back to goback@grinyer.ca, in the shape of the paper form it
// replaces, with the subject GO BACK CUSTOMER NAME.
//
// The page files the record first and then calls this. That order is
// deliberate: if the email fails the go back still exists and can be chased,
// whereas a lost email with no record leaves no trace at all. So this
// function never creates anything. It reads a row that is already there,
// sends it, and stamps when it went.
//
// It reads the row AS THE CALLER, not as an administrator. If the row is not
// theirs to see, the database simply does not return it and there is nothing
// to send. That is what stops one person emailing out somebody else's go
// back by guessing an id.
//
// Deploy:  Supabase dashboard, Edge Functions, Deploy a new function, Via
//          Editor, named exactly send-goback. Paste this in and deploy.
//
// Secrets it reads, set under Edge Functions, Secrets:
//   RESEND_API_KEY      required, from resend.com. Already set if the dealer
//                       order emails are working: secrets are shared across
//                       the project, so there is nothing new to add.
//   GOBACK_EMAIL_FROM   optional, falls back to ORDER_EMAIL_FROM, then to
//                       Resend's test address
//   GOBACK_EMAIL_TO     optional, defaults to goback@grinyer.ca, commas for
//                       several
//
// No imports, on purpose. The first version of the order function imported
// the Supabase client library and hung on startup in the field. Plain HTTP
// with a deadline on every call does the same job and says in the log how
// long each step took.

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

/* Nothing is ever shown as empty. A blank line on a go back is ambiguous:
   it could mean nothing was held back, or that nobody filled it in. */
const orDash = (v: unknown) => {
  const s = String(v ?? "").trim();
  return s ? esc(s) : "&mdash;";
};

const money = (v: unknown) => {
  if (v === null || v === undefined || v === "") return "&mdash;";
  const n = Number(v);
  if (!isFinite(n)) return esc(v);
  return "$" + n.toFixed(2);
};

const yesNo = (v: unknown) =>
  v === true ? "Yes" : v === false ? "No" : "Not answered";

/* Long text keeps the line breaks the installer typed. On a phone, on site,
   people write in lines, and running it together loses the sense of it. */
const lines = (v: unknown) => {
  const s = String(v ?? "").trim();
  if (!s) return "&mdash;";
  return esc(s).replace(/\r?\n/g, "<br>");
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

type GoBack = {
  id: string;
  customer_name: string;
  installer_names: string[] | null;
  amount_held: number | string | null;
  photos_in_cam: boolean | null;
  reason: string | null;
  reason_other: string | null;
  cause: string | null;
  materials: string | null;
  filed_by_name: string | null;
  created_at: string | null;
};

function emailFor(g: GoBack) {
  const cause = g.reason === "Other" && g.reason_other
    ? `Other: ${g.reason_other}`
    : g.reason;

  const row = (label: string, value: string) =>
    `<tr><td style="padding:7px 14px 7px 0;color:#6E6E76;font-size:13px;` +
    `vertical-align:top;white-space:nowrap">${esc(label)}</td>` +
    `<td style="padding:7px 0;font-size:15px;color:#17171A">${value}</td></tr>`;

  const block = (title: string, value: string) =>
    `<h3 style="font-size:13px;text-transform:uppercase;letter-spacing:.06em;` +
    `color:#6E6E76;margin:22px 0 6px;font-weight:600">${esc(title)}</h3>` +
    `<div style="font-size:15px;line-height:1.5;color:#17171A">${value}</div>`;

  const html =
    `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,` +
    `Helvetica,Arial,sans-serif;max-width:620px;margin:0 auto;padding:4px 0">` +
      `<div style="border:3px solid #C80000;border-radius:6px;padding:22px 24px">` +
        `<h1 style="font-size:21px;margin:0 0 2px;color:#17171A">Go Back Required</h1>` +
        `<p style="margin:0 0 20px;color:#6E6E76;font-size:13px">` +
          `Filed by ${orDash(g.filed_by_name)}${g.created_at ? " on " + esc(when(g.created_at)) : ""}` +
        `</p>` +
        `<table style="border-collapse:collapse;width:100%">` +
          row("Customer", `<b>${orDash(g.customer_name)}</b>`) +
          row("Installers on site",
              (g.installer_names ?? []).length
                ? esc((g.installer_names ?? []).join(", ")) : "&mdash;") +
          row("Amount held back", money(g.amount_held)) +
          row("Photos in Company Cam", esc(yesNo(g.photos_in_cam))) +
          row("Cause", orDash(cause)) +
        `</table>` +
        block("What happened", lines(g.cause)) +
        block("New materials required", lines(g.materials)) +
      `</div>` +
      `<p style="color:#8E8E99;font-size:12px;margin:14px 2px 0">` +
        `Filed on the Grinyer tools site. This is the record; replying to this ` +
        `email does not change it.</p>` +
    `</div>`;

  /* The old paper form said: Email Title: GO BACK "Customer Name", for
     example GO BACK SMITH 112. Kept word for word, so the office can go on
     searching their mail the way they always have. */
  const subject = `GO BACK ${String(g.customer_name ?? "").toUpperCase()}`.trim();

  const text = [
    "GO BACK REQUIRED",
    "",
    `Customer:              ${g.customer_name ?? ""}`,
    `Installers on site:    ${(g.installer_names ?? []).join(", ")}`,
    `Amount held back:      ${g.amount_held ?? ""}`,
    `Photos in Company Cam: ${yesNo(g.photos_in_cam)}`,
    `Cause:                 ${cause ?? ""}`,
    "",
    "WHAT HAPPENED",
    String(g.cause ?? ""),
    "",
    "NEW MATERIALS REQUIRED",
    String(g.materials ?? ""),
    "",
    `Filed by ${g.filed_by_name ?? ""}${g.created_at ? " on " + when(g.created_at) : ""}`,
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
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const resendKey = Deno.env.get("RESEND_API_KEY") ?? "";

    const absent = [["SUPABASE_URL", url], ["SUPABASE_ANON_KEY", anon],
                    ["SUPABASE_SERVICE_ROLE_KEY", service]]
      .filter(([, v]) => !v).map(([k]) => k);
    if (absent.length) {
      console.log("missing from the environment: " + absent.join(", "));
      return json({ error: "This function cannot see " + absent.join(" or ") +
        ". Those are set by Supabase itself, so the function may need deploying again." }, 500);
    }
    if (!resendKey)
      return json({ error: "No sending account is set up yet. Add RESEND_API_KEY in Supabase." }, 400);

    const auth = req.headers.get("Authorization") ?? "";
    if (!auth) return json({ error: "Not signed in" }, 401);

    let body: { id?: string };
    try { body = await req.json(); } catch { return json({ error: "Bad request" }, 400); }
    const id = String(body.id ?? "").trim();
    if (!id) return json({ error: "Which go back?" }, 400);

    const asCaller = { apikey: anon, Authorization: auth };
    const asAdmin  = { apikey: service, Authorization: `Bearer ${service}` };

    // Read it as the caller. A row they may not see is a row that is not
    // there, so there is nothing to send and nothing to leak.
    const got = await call("read the go back",
      `${url}/rest/v1/go_backs?select=*&id=eq.${encodeURIComponent(id)}`,
      { headers: asCaller });
    const rows = got.ok ? await got.json().catch(() => []) : [];
    if (!got.ok || !rows.length)
      return json({ error: "That go back is not there, or is not yours to send" }, 404);

    const g = rows[0] as GoBack;

    // Already gone. Say so rather than sending it twice, in case the page
    // was reloaded or the tap was a double tap.
    if ((g as unknown as { emailed_at?: string }).emailed_at) {
      console.log(`go back ${id} was already emailed, nothing sent`);
      return json({ ok: true, already: true });
    }

    const from = Deno.env.get("GOBACK_EMAIL_FROM")
      ?? Deno.env.get("ORDER_EMAIL_FROM")
      ?? "onboarding@resend.dev";
    const to = (Deno.env.get("GOBACK_EMAIL_TO") ?? "goback@grinyer.ca")
      .split(",").map((s) => s.trim()).filter(Boolean);

    const mail = emailFor(g);
    console.log(`sending "${mail.subject}" to ${to.join(", ")}`);

    const sent = await call("resend", "https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to, subject: mail.subject,
                             html: mail.html, text: mail.text }),
    });

    if (!sent.ok) {
      const said = await sent.text().catch(() => "");
      console.log("resend refused it: " + said.slice(0, 400));
      // The record is already filed, so this is a partial failure, not a
      // lost go back. The page tells the installer exactly that.
      return json({ error: "The go back is filed but the email would not send. " +
        "Tell the office directly." }, 502);
    }

    // Stamp it as an administrator: an installer may not update the row, and
    // should not be able to, which is the whole point of the record.
    await call("stamp it as sent",
      `${url}/rest/v1/go_backs?id=eq.${encodeURIComponent(id)}`,
      { method: "PATCH", headers: { ...asAdmin, "Content-Type": "application/json" },
        body: JSON.stringify({ emailed_at: new Date().toISOString() }) })
      .catch(() => { /* the email went, which is what matters */ });

    console.log(`done in ${Date.now() - t0}ms`);
    return json({ ok: true });
  } catch (e) {
    console.log("fell over: " + ((e as Error)?.message ?? e));
    return json({ error: (e as Error)?.message ?? "Something went wrong" }, 500);
  }
});

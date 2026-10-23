// Supabase Edge Function: send-order
//
// Emails an order to Grinyer with the order form attached, along with
// whatever the dealer dropped in: the Proliner file and the sales contract.
//
// The sending key never leaves Supabase. The browser sends only the signed
// in person's own token and the workbook it just built, and this function
// decides for itself whether they are allowed to send that order, by asking
// the database as them rather than taking their word for it.
//
// Deploy:  supabase functions deploy send-order
//
// Secrets it reads, set under Edge Functions, Secrets:
//   RESEND_API_KEY     required, from resend.com
//   ORDER_EMAIL_FROM   optional, defaults to Resend's test address
//   ORDER_EMAIL_TO     optional, defaults to order@grinyer.ca, commas for several
//
// ---------------------------------------------------------------------------
// 1 Oct 2026. The first version of this imported the Supabase client library
// and let every call run without a deadline. In the field it hung: the
// preflight answered, the POST sat there, and after 160 seconds the gateway
// gave up with a 504. Nothing was logged, so there was no way to tell which
// call had stopped, and the portal could only say it had not been reached.
//
// So this version does two things differently. It talks to Supabase over
// plain HTTP rather than through the client library, which removes the import
// and with it a whole class of things that can stall on startup. And every
// call it makes has a deadline and says in the log how long it took, so a
// slow step is named rather than guessed at. If anything does run out of
// time, it answers with that fact instead of sitting there until the gateway
// kills it, because an answer the dealer can read is worth more than a
// perfect email nobody gets.
// ---------------------------------------------------------------------------

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

/* Every outbound call gets a deadline and leaves a line in the log saying
   what it was and how long it took. A step that is slow now names itself. */
const DEADLINE_MS = 20000;
const RESEND_DEADLINE_MS = 45000;      // it is carrying the attachments

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

/* Big files break String.fromCharCode(...bytes), so walk them in slices. */
function b64(bytes: Uint8Array): string {
  let s = "";
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step)
    s += String.fromCharCode(...bytes.subarray(i, i + step));
  return btoa(s);
}

/* WHAT EVERY FIGURE IS WORTH
 *
 * One sentence, used on both emails and on the portal's own totals, so a
 * dealer is never told two different things about the same number. The order
 * form that travels with these emails carries figures of its own, so this
 * goes on the email whether or not a total is shown. */
const PRICE_NOTE = "Estimate only, in US dollars. Final pricing to be confirmed, " +
  "and exclusive of any discounts, taxes, tariffs or duty.";

const esc = (v: unknown) =>
  String(v ?? "").replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const t0 = Date.now();
  try {
    const url = Deno.env.get("SUPABASE_URL") ?? "";
    const anon = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const resendKey = Deno.env.get("RESEND_API_KEY") ?? "";

    /* Said plainly and separately, because "it did not work" is no use to
       somebody looking at a list of secrets wondering which one is wrong. */
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

    /* The request is a few hundred bytes: the order to send, and nothing
       else. It used to carry the whole order form workbook, and reading that
       body is where this function hung. Nothing in here waits on the browser
       for anything larger than a name. The old shape is still accepted so an
       older page does not break. */
    let body: { order_id?: string; workbook?: { name?: string; b64?: string };
                reopen?: { reason?: string } };
    try { body = await req.json(); } catch { return json({ error: "Bad request" }, 400); }
    console.log(`read the request in ${Date.now() - t0}ms, ` +
      `${(body.workbook?.b64?.length ?? 0) ? "with an inline workbook (old page)" : "no inline workbook"}`);

    const orderId = String(body.order_id ?? "").trim();
    if (!orderId) return json({ error: "Which order?" }, 400);

    const asCaller = { apikey: anon, Authorization: auth };
    const asAdmin  = { apikey: service, Authorization: `Bearer ${service}` };

    // 1. Ask the database as the caller. If they cannot read the order, the
    //    row simply is not there for them, and there is nothing to send.
    const me = await call("who is calling", `${url}/auth/v1/user`, { headers: asCaller });
    if (!me.ok) return json({ error: "Not signed in" }, 401);
    const caller = await me.json().catch(() => ({}));

    const ordRes = await call("read the order",
      `${url}/rest/v1/dealer_orders?select=*&id=eq.${encodeURIComponent(orderId)}`,
      { headers: asCaller });
    const orders = ordRes.ok ? await ordRes.json().catch(() => []) : [];
    const order = Array.isArray(orders) ? orders[0] : null;
    if (!order) return json({ error: "That order is not yours to send" }, 403);

    const dlrRes = await call("read the dealer",
      `${url}/rest/v1/dealers?select=name,email&id=eq.${encodeURIComponent(order.dealer_id)}`,
      { headers: asAdmin });
    const dealers = dlrRes.ok ? await dlrRes.json().catch(() => []) : [];
    const dealer = Array.isArray(dealers) ? dealers[0] : null;

    /* ASKING FOR A SUBMITTED ORDER BACK
     *
     * A submitted order is read only to the dealer, enforced by the database
     * rather than by the screen, so a dealer who spots a mistake afterwards
     * can do nothing about it themselves. This is how they ask.
     *
     * Short, with no attachments: Grinyer already has the order and the files,
     * and what they need is the order number and the sentence saying what is
     * wrong. It goes to the order address and copies whoever asked, so the
     * dealer has their own record of having asked. */
    if (body.reopen) {
      const why = String(body.reopen.reason ?? "").trim();
      const fromAddr = Deno.env.get("ORDER_EMAIL_FROM") ?? "onboarding@resend.dev";
      const toAddr = (Deno.env.get("ORDER_EMAIL_TO") ?? "order@grinyer.ca")
        .split(",").map((s) => s.trim()).filter(Boolean);
      const who = dealer?.name || "A dealer";
      const ref = order.order_ref || order.id;
      const subj = `Please reopen the order for ${ref}` +
        (order.customer_name ? ` (dealer ID ${order.customer_name})` : "") + `, ${who}`;
      /* Only the rows that have something in them. An empty cell beside a
         label reads as a broken email rather than as a blank field. */
      const facts: [string, string][] = ([
        ["Customer", String(order.order_ref ?? "")],
        ["Dealer ID", String(order.customer_name ?? "")],
        ["Status", String(order.status ?? "")],
        ["Doors", order.door_count ? String(order.door_count) : ""],
        ["Submitted", String(order.submitted_at ?? "").slice(0, 10)],
        ["Asked by", String(caller?.email ?? "")],
      ] as [string, string][]).filter(([, v]) => v);
      const line = (order.customer_name ? `, dealer ID ${esc(order.customer_name)},` : "");
      const note = `
        <div style="font-family:Helvetica,Arial,sans-serif;font-size:14px;color:#1C1C1F">
          <p><b>${esc(who)}</b> is asking for the order for <b>${esc(String(ref))}</b>${line} to be moved back to a draft so they can correct it.</p>
          ${why
            ? `<p style="margin:14px 0;padding:11px 13px;background:#F4F6F9;
                 border-radius:8px"><b>What needs changing:</b><br>${esc(why)}</p>`
            : `<p style="color:#6E6E76">They did not say what needs changing.</p>`}
          <p>The order is still exactly as it was submitted and nothing on it has
             changed. It stays locked to them until somebody sets its status back
             to Draft in the portal.</p>
          <table style="font-size:13px;color:#4A4A52;border-collapse:collapse">
            ${facts.map(([k, v]) =>
              `<tr><td style="padding:2px 12px 2px 0">${esc(k)}</td><td><b>${esc(v)}</b></td></tr>`
            ).join("")}
          </table>
        </div>`;
      const copyTo = [...new Set([dealer?.email, caller?.email]
        .map((x) => String(x ?? "").trim()).filter(Boolean))]
        .filter((a) => !toAddr.includes(a));
      const r = await call("resend, the reopen request",
        "https://api.resend.com/emails", {
          method: "POST",
          headers: { Authorization: `Bearer ${resendKey}`,
                     "Content-Type": "application/json" },
          body: JSON.stringify({ from: fromAddr, to: toAddr, cc: copyTo.length ? copyTo : undefined,
                                 subject: subj, html: note,
                                 reply_to: caller?.email || dealer?.email || undefined }),
        });
      if (!r.ok) {
        const t = await r.text();
        console.log("resend refused the reopen request: " + t.slice(0, 400));
        return json({ error: "The request was not emailed: " + t.slice(0, 400) }, 400);
      }
      const rr = await r.json().catch(() => ({}));
      console.log(`reopen request for ${ref} sent in ${Date.now() - t0}ms`);
      return json({ ok: true, id: rr?.id ?? null, to: toAddr, cc: copyTo, reopen: true });
    }

    // 2. Gather the attachments: the workbook the portal just built, then
    //    everything kept with the order. A file that will not come is named
    //    in the email rather than quietly left out.
    const attachments: { filename: string; content: string }[] = [];
    if (body.workbook?.b64 && body.workbook?.name)
      attachments.push({ filename: body.workbook.name, content: body.workbook.b64 });

    /* The order form first, because it is the thing being ordered. Then the
       dealer's own files. */
    const ORDER_OF_KINDS = ["orderform", "proliner", "contract"];

    /* THE SAME FILE DROPPED IN TWICE
     *
     * Both copies are kept with the order, because the first is the
     * measurer's own record of what was on site that day. Only the newest of
     * each kind is attached, though: a corrected Proliner file is uploaded
     * precisely because the earlier one was wrong, and a shop that cut to the
     * wrong attachment would be cutting doors nobody can use. The older ones
     * are named in the email so it is clear they exist. */
    const all = Array.isArray(order.files) ? order.files : [];
    const newestOfKind: Record<string, any> = {};
    for (const f of all) {
      if (!f?.path) continue;
      const k = f.kind ?? f.path;
      const prev = newestOfKind[k];
      if (!prev || (Date.parse(f.at ?? 0) || 0) >= (Date.parse(prev.at ?? 0) || 0))
        newestOfKind[k] = f;
    }
    const kept = Object.values(newestOfKind).sort((a: any, b: any) => {
      const ai = ORDER_OF_KINDS.indexOf(a.kind), bi = ORDER_OF_KINDS.indexOf(b.kind);
      return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
    });
    const replaced = all.filter((f: any) =>
      f?.path && !kept.some((k: any) => k.path === f.path));
    if (replaced.length)
      console.log("not attaching, replaced by newer: " +
        replaced.map((f: any) => f.name ?? f.path).join(", "));

    const missing: string[] = [];
    for (const f of kept as any[]) {
      if (!f?.path) continue;
      try {
        const got = await call(`fetch ${f.name ?? f.path}`,
          `${url}/storage/v1/object/order-files/${encodeURI(String(f.path))}`,
          { headers: asAdmin });
        if (!got.ok) { missing.push(f.name ?? f.path); continue; }
        /* two attachments with one name is a muddle for whoever opens the
           email, so a repeat gets a number before its extension */
        let filename = f.name ?? String(f.path).split("/").pop()!;
        if (attachments.some((a) => a.filename === filename)) {
          const dot = filename.lastIndexOf(".");
          const stem = dot > 0 ? filename.slice(0, dot) : filename;
          const ext = dot > 0 ? filename.slice(dot) : "";
          let n = 2;
          while (attachments.some((a) => a.filename === `${stem} (${n})${ext}`)) n++;
          filename = `${stem} (${n})${ext}`;
        }
        attachments.push({
          filename,
          content: b64(new Uint8Array(await got.arrayBuffer())),
        });
      } catch {
        missing.push(f.name ?? f.path);   // one slow file must not stop the email
      }
    }

    // 3. Say it plainly. Whoever opens this should not have to open the
    //    attachment to know what arrived.
    const ref = order.order_ref || order.customer_name || orderId.slice(0, 8);
    const subject = `Dealer order: ${dealer?.name ?? "Dealer"} - ${ref}`;
    const line = (k: string, v: unknown) =>
      v ? `<tr><td style="padding:2px 14px 2px 0;color:#6E6E76">${esc(k)}</td>` +
          `<td style="padding:2px 0"><b>${esc(v)}</b></td></tr>` : "";
    /* $2,985.73 rather than $2985.73. A price with no thousands separator
       reads as a smaller number at a glance, which is the wrong direction for
       a figure somebody is about to agree to. */
    const money = (n: unknown) =>
      "$" + Number(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

    const html =
      `<div style="font:14px/1.5 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#17171A">` +
      `<p>An order has come in through the dealer portal.</p>` +
      `<table style="border-collapse:collapse;font-size:14px">` +
      line("Dealer", dealer?.name) +
      /* Andrew, 7 Oct: order_ref is the customer and customer_name is the
         dealer's own ID for the job, so the two labels are the other way
         round from the column names. The stored names are left alone. */
      line("Customer", order.order_ref) +
      line("Dealer ID", order.customer_name) +
      line("Address", [order.customer_addr, order.customer_city].filter(Boolean).join(", ")) +
      line("Doors", order.door_count) +
      line("Panels", order.panel_count) +
      line("Paint", order.paint_colour) +
      line("Wholesale total (USD)", order.order_total ? money(order.order_total) : "") +
      `</table>` +
      `<p style="color:#6E6E76">${esc(PRICE_NOTE)}</p>` +
      (attachments.length ? "" :
        `<p style="color:#9A4A12">Nothing could be attached to this email. ` +
        `The order form is on the order in the portal.</p>`) +
      `<p>${attachments.length} attachment${attachments.length === 1 ? "" : "s"}: ` +
      esc(attachments.map((a) => a.filename).join(", ")) + `.</p>` +
      (replaced.length
        ? `<p style="color:#6E6E76">An earlier ${esc(replaced.map((f: any) =>
            f.name ?? f.path).join(", "))} was uploaded and then replaced. ` +
          `It is kept with the order in the portal but is not attached here.</p>` : "") +
      (missing.length
        ? `<p style="color:#9A4A12">Could not attach: ${esc(missing.join(", "))}.</p>` : "") +
      `</div>`;

    const from = Deno.env.get("ORDER_EMAIL_FROM") ?? "onboarding@resend.dev";
    const to = (Deno.env.get("ORDER_EMAIL_TO") ?? "order@grinyer.ca")
      .split(",").map((s) => s.trim()).filter(Boolean);

    const payload = JSON.stringify({
      from, to, subject, html,
      reply_to: dealer?.email || undefined,
      attachments,
    });
    console.log(`sending to resend: ${Math.round(payload.length / 1024)}KB, ` +
      `${attachments.length} attachment(s), from ${from}, to ${to.join(", ")}`);

    const sent = await call("resend", "https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
      body: payload,
    }, RESEND_DEADLINE_MS);

    if (!sent.ok) {
      const t = await sent.text();
      // Resend's own words are more useful than anything I could invent here.
      console.log("resend refused it: " + t.slice(0, 400));
      return json({ error: "The email was refused: " + t.slice(0, 400) }, 400);
    }

    const res = await sent.json().catch(() => ({}));

    /* THE DEALER GETS THEIR OWN COPY
     *
     * Not a forward of Grinyer's email, which is written for whoever picks the
     * order up in the shop. This one is a receipt: what was ordered, the order
     * form as it was sent, and who to reply to. It goes to the dealer's own
     * address and to whoever pressed Submit, which are often not the same
     * person.
     *
     * It is sent after Grinyer's copy and never allowed to hold it up. An
     * order that reached Grinyer but failed to reach the dealer is a nuisance;
     * the other way round would be a lost order. */
    const dealerTo = [...new Set([dealer?.email, caller?.email]
      .map((x) => String(x ?? "").trim()).filter(Boolean))]
      .filter((a) => !to.includes(a));
    let dealerSent = false;
    if (dealerTo.length) {
      const form = attachments.find((a) => /\.xlsx$/i.test(a.filename));
      const mine =
        `<div style="font:14px/1.5 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#17171A">` +
        `<p>Thank you. Your order has reached Grinyer and is now under review.</p>` +
        `<table style="border-collapse:collapse;font-size:14px">` +
        line("Customer", order.order_ref) +
        line("Dealer ID", order.customer_name) +
        line("Doors", order.door_count) +
        line("Panels", order.panel_count) +
        line("Paint", order.paint_colour) +
        line("Wholesale total (USD)", order.order_total ? money(order.order_total) : "") +
        `</table>` +
        `<p style="margin:14px 0;padding:10px 12px;background:#FBF3E8;border:1px solid #E9D4BC;` +
        `border-radius:8px;color:#8A5A1E;font-weight:600">${esc(PRICE_NOTE)}</p>` +
        (form ? `<p>Your order form is attached as ${esc(form.filename)}.</p>`
              : `<p>The order form is on the order in the portal.</p>`) +
        `<p style="color:#6E6E76">You can follow this order in the dealer portal. ` +
        `A submitted order can only be changed by Grinyer, so if something needs ` +
        `changing, please reply to this email.</p>` +
        `</div>`;
      try {
        const copy = await call("resend, the dealer's copy", "https://api.resend.com/emails", {
          method: "POST",
          headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            from, to: dealerTo,
            subject: `Your order with Grinyer: ${ref}`,
            html: mine,
            reply_to: to[0],
            attachments: form ? [form] : [],
          }),
        }, RESEND_DEADLINE_MS);
        dealerSent = copy.ok;
        if (!copy.ok) console.log("the dealer's copy was refused: " +
          (await copy.text()).slice(0, 300));
      } catch (e) {
        console.log("the dealer's copy did not go: " + ((e as Error)?.message ?? e));
      }
    } else {
      console.log("no address to send the dealer's copy to");
    }

    await call("mark it emailed",
      `${url}/rest/v1/dealer_orders?id=eq.${encodeURIComponent(orderId)}`,
      { method: "PATCH",
        headers: { ...asAdmin, "Content-Type": "application/json", Prefer: "return=minimal" },
        body: JSON.stringify({ emailed_at: new Date().toISOString(), email_to: to.join(", ") }) });

    console.log(`done in ${Date.now() - t0}ms`);
    return json({ ok: true, id: res?.id ?? null, to,
                  dealer_to: dealerSent ? dealerTo : [],
                  dealer_wanted: dealerTo,
                  attached: attachments.map((a) => a.filename), missing });
  } catch (e) {
    /* Anything that went wrong on the way comes back as an answer rather than
       as silence. The dealer sees this text in the portal. */
    const why = (e as Error)?.message ?? String(e);
    console.log(`stopped after ${Date.now() - t0}ms: ${why}`);
    return json({ error: why }, 502);
  }
});

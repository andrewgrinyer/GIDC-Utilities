/* OFFLINE TEST ONLY. Never part of the live portal.
 *
 * Put in front of the dealer portal by tests/offline/build.py, so the page
 * opens straight from a file on a PC with no Supabase and no Cloudflare.
 * Every call the portal makes to Supabase is answered here, in memory, from
 * the sample orders below. Saving, importing a spreadsheet and Proliner
 * files and downloading the order form all work; nothing leaves the PC and
 * everything is gone when the page is closed or reloaded. */
(function(){
  var BASE = "https://baakegbtuygtldksmant.supabase.co";
  var ME = {id: "off-admin", name: "Offline test", email: "offline@test", role: "admin",
            active: true, email_verified_at: "2026-10-01T00:00:00Z"};
  var DEALER = {id: "D1", name: "Sample Dealer", slug: "SAMPLE", active: true};
  var ORDERS = JSON.parse(JSON.stringify(window.OFFLINE_SAMPLES || []));
  var FILES = {};
  var n = 0;
  try{
    localStorage.setItem("gidc:session", JSON.stringify(
      {access_token: "offline", refresh_token: "offline", user: {id: ME.id, email: ME.email}}));
  }catch(e){}
  var real = window.fetch ? window.fetch.bind(window) : null;
  function reply(body, status){
    return Promise.resolve(new Response(body == null ? "" : JSON.stringify(body),
      {status: status || 200, headers: {"Content-Type": "application/json"}}));
  }
  function eqv(v){ return String(v || "").replace(/^eq\./, ""); }
  window.fetch = function(input, opts){
    var url = typeof input === "string" ? input : input.url;
    opts = opts || {};
    var m = (opts.method || "GET").toUpperCase();
    if(url.indexOf(BASE) !== 0){
      /* version.txt and anything else from the site: not here, which the
         portal already takes in its stride */
      return Promise.resolve(new Response("", {status: 404}));
    }
    var u = new URL(url), p = u.pathname, q = u.searchParams;
    var body = null;
    try{ body = opts.body && typeof opts.body === "string" ? JSON.parse(opts.body) : null; }catch(e){}
    if(p === "/auth/v1/user") return reply({id: ME.id, email: ME.email});
    if(p.indexOf("/auth/") === 0) return reply({access_token: "offline", refresh_token: "offline", user: {id: ME.id}});
    if(p === "/rest/v1/profiles") return reply([ME]);
    if(p === "/rest/v1/dealers") return reply([DEALER]);
    if(p === "/rest/v1/dealer_orders"){
      var id = eqv(q.get("id"));
      if(m === "GET"){
        var inl = /^in\.\((.*)\)$/.exec(q.get("id") || "");
        if(inl) return reply(ORDERS.filter(function(o){ return inl[1].split(",").indexOf(o.id) !== -1; }));
        return reply(id ? ORDERS.filter(function(o){ return o.id === id; })
                        : ORDERS.slice().sort(function(a, b){ return a.created_at < b.created_at ? 1 : -1; }));
      }
      if(m === "POST"){
        var rows = Array.isArray(body) ? body : [body];
        var made = rows.map(function(r){
          var o = Object.assign({id: "off-" + (++n) + "-" + Date.now(), dealer_id: DEALER.id,
            created_at: new Date().toISOString(), files: []}, r);
          ORDERS.push(o); return o;
        });
        return reply(made, 201);
      }
      if(m === "PATCH"){
        var o = ORDERS.filter(function(x){ return x.id === id; })[0];
        if(!o) return reply([]);
        Object.assign(o, body || {});
        window.OFFLINE_SAVED = window.OFFLINE_SAVED || [];
        window.OFFLINE_SAVED.push({id: id, body: JSON.parse(JSON.stringify(body || {}))});
        return reply([o]);
      }
      if(m === "DELETE"){
        ORDERS = ORDERS.filter(function(x){ return x.id !== id; });
        return Promise.resolve(new Response("", {status: 204}));
      }
    }
    if(p.indexOf("/storage/v1/object/sign/") === 0)
      return reply({signedURL: "/object/offline/" + p.slice("/storage/v1/object/sign/".length)});
    if(p.indexOf("/storage/v1/object/offline/") === 0){
      var key = decodeURIComponent(p.slice("/storage/v1/object/offline/order-files/".length));
      var f = FILES[key];
      return Promise.resolve(f ? new Response(f) : new Response("", {status: 404}));
    }
    if(p.indexOf("/storage/v1/object/order-files/") === 0){
      var k = decodeURIComponent(p.slice("/storage/v1/object/order-files/".length));
      if(m === "POST" || m === "PUT"){ FILES[k] = opts.body; return reply({Key: "order-files/" + k}); }
      if(m === "DELETE"){ delete FILES[k]; return reply({}); }
    }
    if(p.indexOf("/functions/v1/") === 0)
      return reply({error: "Offline test: nothing is emailed."}, 503);
    return reply(m === "GET" ? [] : {});
  };
  document.addEventListener("DOMContentLoaded", function(){
    var b = document.createElement("div");
    b.textContent = "OFFLINE TEST " + (window.OFFLINE_LABEL || "") +
      ". Sample orders only. Nothing here reaches the live portal, and it all resets when you reload.";
    b.style.cssText = "position:fixed;left:0;right:0;bottom:0;z-index:99999;background:#7A1F1F;color:#fff;" +
      "font:600 13px/1.4 system-ui,sans-serif;padding:6px 12px;text-align:center;pointer-events:none";
    document.body.appendChild(b);
  });
})();

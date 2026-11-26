/* GIDC tools sign in.
   Same Supabase accounts as the measurement app. Everything on this site is one
   origin, so signing in on the landing page unlocks every tool beside it.

   Be clear-eyed about what this is: these are static pages with no server, so
   the gate keeps the tools tidy and out of casual reach. It is not a lock.
   Cloudflare Access is what actually refuses to serve the page. */
(function(){
  var CONFIG = {
    supabaseUrl: 'https://baakegbtuygtldksmant.supabase.co',
    supabaseAnonKey: 'sb_publishable_CSwwslH9Jt60-WK2fEJORw_k-R9n8Vj'
  };
  var SESSION = 'gidc:session';          // same key the measurement app uses
  var session = null;

  function load(){ try{ var v=localStorage.getItem(SESSION); session=v?JSON.parse(v):null; }
                   catch(e){ session=null; } return session; }
  function save(s){ session=s; try{ s?localStorage.setItem(SESSION,JSON.stringify(s))
                                     :localStorage.removeItem(SESSION); }catch(e){} }

  function signIn(email, password){
    return fetch(CONFIG.supabaseUrl+'/auth/v1/token?grant_type=password',{
      method:'POST',headers:{apikey:CONFIG.supabaseAnonKey,'Content-Type':'application/json'},
      body:JSON.stringify({email:email,password:password})})
      .then(function(r){ return r.json().catch(function(){return{};})
        .then(function(j){
          if(!r.ok) throw new Error(j.error_description||j.msg||'Those details were not recognised');
          save({access_token:j.access_token, refresh_token:j.refresh_token, user:j.user});
          return j; }); });
  }
  function refresh(){
    if(!session || !session.refresh_token) return Promise.resolve(false);
    return fetch(CONFIG.supabaseUrl+'/auth/v1/token?grant_type=refresh_token',{
      method:'POST',headers:{apikey:CONFIG.supabaseAnonKey,'Content-Type':'application/json'},
      body:JSON.stringify({refresh_token:session.refresh_token})})
      .then(function(r){ if(!r.ok) return false;
        return r.json().then(function(j){
          save({access_token:j.access_token, refresh_token:j.refresh_token, user:j.user});
          return true; }); })
      .catch(function(){ return false; });
  }
  /* Ask the database who this is. A token that no longer works is thrown away,
     so a stale session cannot leave someone looking signed in but broken. */
  /* What is asked for, newest shape first. Each column arrived with a SQL
     file, and asking for one that is not there yet is a 400, which would lock
     the whole team out of the site over a column, so the ask drops back one
     step at a time to what has always been there.
       dealer_role         two-sided-access.sql
       email_verified_at   email-verification.sql
       active              the installer roles */
  var ASK = ['id,name,role,dealer_role,active,email_verified_at',
             'id,name,role,dealer_role,active', 'id,name,role,active', 'id,name,role'];
  function whoami(step){
    if(!session || !session.user) return Promise.resolve(null);
    step = step || 0;
    var cols = ASK[step];
    var url = CONFIG.supabaseUrl+'/rest/v1/profiles?select='+cols+'&id=eq.'+session.user.id;
    var hdr = {apikey:CONFIG.supabaseAnonKey, Authorization:'Bearer '+session.access_token};
    return fetch(url,{headers:hdr}).then(function(r){
      if(r.status===401) return refresh().then(function(ok){ return ok ? whoami(step) : null; });
      if(!r.ok) return step + 1 < ASK.length ? whoami(step + 1) : null;
      return r.json().then(function(rows){
        /* No profile row used to mean a sales representative, so any login at
           all became one. A login with no profile is now nobody, and isStaff
           below turns it away. */
        var me = rows.length ? rows[0]
               : {id: session.user.id, name: session.user.email, role:null};
        /* Someone stood down keeps their login and their history but stops
           getting in. Treated as no role at all, so every check below refuses
           without any of them needing to know about it. */
        if(me.active === false){ me.role = null; me.dealer_role = null; }
        /* Remember the role, so the offline path below has a real one to go on
           rather than inventing a generous default. */
        if(session){ session.role = me.role; save(session); }
        return me; });
    }).catch(function(){
      // offline: go on the role last seen, rather than locking someone out of
      // a tool that needs no connection anyway. No role ever seen, no entry.
      return session.user
        ? {id: session.user.id, name: session.user.email, role: session.role || null, offline:true}
        : null;
    });
  }

  /* ---- confirming an email address ----
     A login whose address has not been proven gets a banner on every page,
     with a button that emails them the link again. Before
     email-verification.sql has run there is no such field, so no banner.
     Once Andrew turns the switch on, the database shows an unconfirmed
     login nothing at all, and the banner says so plainly, because an empty
     page with no reason is the worst thing to be shown. */
  function verifyBanner(me){
    if(!me || me.offline || !('email_verified_at' in me) || me.email_verified_at) return;
    if(document.getElementById('gidc-verify')) return;
    var b = document.createElement('div');
    b.id = 'gidc-verify';
    b.style.cssText = 'position:sticky;top:0;z-index:2147483646;display:flex;flex-wrap:wrap;' +
      'gap:10px;align-items:center;padding:10px 16px;background:#FBF1E7;color:#9A4A12;' +
      'border-bottom:1px solid #EBD3BC;font:14px/1.4 -apple-system,BlinkMacSystemFont,' +
      '"Segoe UI",Roboto,Helvetica,Arial,sans-serif';
    function draw(required, said){
      b.innerHTML = '<span style="flex:1;min-width:240px"><b>Please confirm your email address.</b> ' +
        (required ? 'Until you do, nothing will load for you. '
                  : 'It takes one press of a button in an email we send you. ') +
        (said ? '<b>' + said + '</b>' : '') + '</span>' +
        '<button id="gidc-verify-go" style="font:inherit;font-weight:600;padding:6px 12px;' +
        'border-radius:8px;border:1px solid #9A4A12;background:#fff;color:#9A4A12;cursor:pointer">' +
        'Email me the link</button>';
      document.getElementById('gidc-verify-go').onclick = function(){
        this.disabled = true; this.textContent = 'Sending';
        api('/functions/v1/account-link', {method:'POST', headers:headers(true),
                                           body: JSON.stringify({action:'resend'})})
          .then(function(r){ return r.json().catch(function(){ return {}; }); })
          .then(function(j){ draw(required, String(j.said || j.error || 'Sent.')
            .replace(/[&<>"]/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; })); })
          .catch(function(){ draw(required, 'Could not send it. Try again in a minute.'); });
      };
    }
    document.body.insertBefore(b, document.body.firstChild);
    draw(false, '');
    api('/rest/v1/app_settings?select=value&key=eq.require_verified_email', {headers:headers()})
      .then(function(r){ return r.ok ? r.json() : []; })
      .then(function(rows){ if(rows.length && rows[0].value === 'true') draw(true, ''); })
      .catch(function(){});
  }

  /* ---- who this site is for ----
     The tools site, the measurement app and the dealer portal all sign in
     against the same Supabase project: one set of logins, four front ends.
     So a dealer's login is a real login here, and that was all this gate
     ever asked for, which let a dealer reach every tool, the wholesale price
     list among them.

     Every list below is the roles that ARE allowed, never the ones that are
     not, so a role invented later cannot wander in because nobody remembered
     to exclude it. The same rule is written again in the database, which is
     what actually refuses; these lists only decide what a page shows.

     admin          everything
     user           Grinyer staff not yet put in a group
     sales          the showroom and the road
     manufacturing  the shop
     installer      on site, and nothing else: the go back form only */
  var STAFF = ['admin', 'user', 'sales', 'manufacturing'];
  function roleOf(me){ return me ? String(me.role || '') : ''; }
  function isStaff(me){ return STAFF.indexOf(roleOf(me)) !== -1; }
  function isInstaller(me){ return roleOf(me) === 'installer'; }

  /* Who may open a given tool. A tool says which roles it is for, as a list
     or as one of the words below, and anything that says nothing is staff
     only, so a tool added later is closed until somebody opens it rather
     than open until somebody closes it. */
  var GROUPS = {
    staff:     STAFF,
    team:      STAFF.concat(['installer']),   // everyone who works here
    admin:     ['admin'],
    shop:      ['admin', 'manufacturing'],
    sales:     ['admin', 'sales'],
    installer: ['admin', 'installer']
  };
  function mayOpen(me, who){
    var allowed = typeof who === 'string' ? (GROUPS[who] || GROUPS.staff)
                : (who && who.length)     ? who
                : GROUPS.staff;
    return allowed.indexOf(roleOf(me)) !== -1;
  }

  /* Anything on this site that needs to talk to Supabase as the signed in
     person goes through here, so the key and the token live in one place. */
  function headers(json){
    var h = {apikey: CONFIG.supabaseAnonKey};
    if(session && session.access_token) h.Authorization = 'Bearer ' + session.access_token;
    if(json) h['Content-Type'] = 'application/json';
    return h;
  }
  function api(path, opts){
    opts = opts || {};
    opts.headers = opts.headers || headers(!!opts.body);
    return fetch(CONFIG.supabaseUrl + path, opts).then(function(r){
      if(r.status !== 401) return r;
      return refresh().then(function(ok){
        if(!ok) return r;
        opts.headers = headers(!!opts.body);
        return fetch(CONFIG.supabaseUrl + path, opts);
      });
    });
  }

  window.GIDCAuth = {
    load:load, save:save, signIn:signIn, whoami:whoami,
    isStaff:isStaff, isInstaller:isInstaller, mayOpen:mayOpen, GROUPS:GROUPS,
    verifyBanner:verifyBanner,
    /* Why somebody signed in is not let in, in words they can act on. */
    whyNot:function(me){
      return me && me.dealer_role ? window.GIDCAuth.NOT_STAFF
           : (me && me.role === 'dealer' || me && me.role === 'dealer_admin')
             ? window.GIDCAuth.NOT_STAFF          // before two-sided-access.sql
           : 'That login is not set up for this site. Ask an administrator.';
    },
    FORGOT_URL: 'https://dealers.gidc.ca/account',
    NOT_STAFF:
      'That login belongs to a dealer account, which is for the ordering ' +
      'portal at dealers.gidc.ca. This site is for the Grinyer team.',
    NOT_YOURS:
      'This tool is not one of yours. If you think it should be, ask an ' +
      'administrator.',
    headers:headers, api:api,
    signOut:function(){ save(null); },
    user:function(){ return session && session.user ? session.user : null; }
  };
})();

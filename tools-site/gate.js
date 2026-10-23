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
  function whoami(cols){
    if(!session || !session.user) return Promise.resolve(null);
    /* active arrived with the installer roles. Asked for before that SQL has
       been run it is a 400, which would lock the whole team out of the site
       over a column, so the ask drops back to what has always been there. */
    cols = cols || 'name,role,active';
    var url = CONFIG.supabaseUrl+'/rest/v1/profiles?select='+cols+'&id=eq.'+session.user.id;
    var hdr = {apikey:CONFIG.supabaseAnonKey, Authorization:'Bearer '+session.access_token};
    return fetch(url,{headers:hdr}).then(function(r){
      if(r.status===401) return refresh().then(function(ok){ return ok ? whoami(cols) : null; });
      if(!r.ok) return cols === 'name,role' ? null : whoami('name,role');
      return r.json().then(function(rows){
        /* No profile row used to mean a sales representative, so any login at
           all became one. A login with no profile is now nobody, and isStaff
           below turns it away. */
        var me = rows.length ? rows[0] : {name: session.user.email, role:null};
        /* Someone stood down keeps their login and their history but stops
           getting in. Treated as no role at all, so every check below refuses
           without any of them needing to know about it. */
        if(me.active === false) me.role = null;
        /* Remember the role, so the offline path below has a real one to go on
           rather than inventing a generous default. */
        if(session){ session.role = me.role; save(session); }
        return me; });
    }).catch(function(){
      // offline: go on the role last seen, rather than locking someone out of
      // a tool that needs no connection anyway. No role ever seen, no entry.
      return session.user
        ? {name: session.user.email, role: session.role || null, offline:true}
        : null;
    });
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

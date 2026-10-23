/* Dropped into each tool. Holds the page back until a session is present, then
   shows a slim bar saying who is signed in with a way back to the tools list. */
(function(){
  var css = document.createElement('style');
  css.textContent =
    '#gidc-hold{position:fixed;inset:0;z-index:2147483647;background:#F6F6F7;' +
      'display:grid;place-items:center;font:15px/1.5 -apple-system,BlinkMacSystemFont,' +
      '"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:#6E6E76;text-align:center;padding:24px}' +
    '#gidc-hold a{color:#C80000;font-weight:600}' +
    '#gidc-bar{position:sticky;top:0;z-index:2147483646;display:flex;align-items:center;gap:12px;' +
      'padding:7px 14px;background:#fff;border-bottom:1px solid #E2E2E6;' +
      'font:13px/1.3 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:#6E6E76}' +
    '#gidc-bar a{color:#C80000;text-decoration:none;font-weight:600}' +
    '#gidc-bar a:hover{text-decoration:underline}' +
    '#gidc-bar .who{margin-left:auto}';
  document.head.appendChild(css);

  var hold = document.createElement('div');
  hold.id = 'gidc-hold';
  hold.innerHTML = '<div>Checking your sign in…</div>';
  function showHold(){ if(!hold.parentNode) document.body.appendChild(hold); }
  function dropHold(){ if(hold.parentNode) hold.parentNode.removeChild(hold); }

  function bar(name){
    var b = document.createElement('div');
    b.id = 'gidc-bar';
    b.innerHTML = '<a href="/">← All tools</a>' +
      '<span class="who">' + String(name||'').replace(/[&<>"]/g, function(c){
        return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }) + '</span>';
    document.body.insertBefore(b, document.body.firstChild);
  }

  function start(){
    showHold();
    if(!window.GIDCAuth){ dropHold(); return; }   // gate missing: never block the tool
    GIDCAuth.load();
    GIDCAuth.whoami().then(function(me){
      /* Being a real login is not enough. Every one of these tools is the
         Grinyer team's, and one of them is the wholesale price list, so a
         dealer login is turned away here as well as on the tools page.

         Which group a tool is for is set by the page itself, as
         window.GIDC_TOOL = {who:'shop'} before this script runs. A page that
         says nothing is staff only, so a tool added later is closed until
         somebody opens it rather than the other way round. */
      var who = (window.GIDC_TOOL && window.GIDC_TOOL.who) || 'staff';
      if(GIDCAuth.mayOpen ? GIDCAuth.mayOpen(me, who)
                          : (GIDCAuth.isStaff ? GIDCAuth.isStaff(me) : !!me)){
        dropHold(); bar(me.name); return;
      }
      /* Signed in, works here, but this one is not theirs. Their session
         stays: they are not in the wrong building, just the wrong room. */
      if(GIDCAuth.isStaff && (GIDCAuth.isStaff(me) || GIDCAuth.isInstaller(me))){
        hold.innerHTML = '<div><b style="color:#17171A;font-size:17px">Not one of yours</b>' +
          '<p>' + GIDCAuth.NOT_YOURS + '</p>' +
          '<p><a href="/">Back to your tools</a></p></div>';
        return;
      }
      if(me && me.role){
        GIDCAuth.signOut();
        hold.innerHTML = '<div><b style="color:#17171A;font-size:17px">Not this way</b>' +
          '<p>' + GIDCAuth.NOT_STAFF + '</p>' +
          '<p><a href="https://dealers.gidc.ca">Open the dealer portal</a></p></div>';
        return;
      }
      hold.innerHTML = '<div><b style="color:#17171A;font-size:17px">Please sign in</b>' +
        '<p>This tool is part of the GIDC tools site.<br>' +
        'Sign in on the tools page and it will open.</p>' +
        '<p><a href="/">Go to the tools page</a></p></div>';
    });
  }
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();

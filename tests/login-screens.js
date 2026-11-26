// Clicks through the login screens against a fake Supabase: the tools site
// People and logins screen, the confirm your address banner, the account
// page an emailed link opens, and the portal's sign in. Nothing leaves the
// machine; every request to Supabase is answered here.
//
//   node tests/login-screens.js
//   (or PLAYWRIGHT=/path/to/playwright node tests/login-screens.js)
//
// Prints what each screen said and every write it attempted, then ERRORS: []
// when no page threw.

const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const path = require('path'), fs = require('fs'), http = require('http');
const ROOT = path.join(__dirname, '..');
function serve(dir, port){ return new Promise(ok => http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]); if(p.endsWith('/')) p += 'index.html';
  if(p === '/account') p = '/account.html';
  const f = path.join(dir, p);
  if(!fs.existsSync(f)){ r.statusCode = 404; return r.end('nf'); }
  r.setHeader('Content-Type', f.endsWith('.js') ? 'text/javascript' : 'text/html'); r.end(fs.readFileSync(f));
}).listen(port, ok)); }
const calls = [];
const ME = {id:'a1', name:'Andrew', role:'admin', dealer_role:null, active:true, email_verified_at:null};
const ROWS = [
  {id:'a1', name:'Andrew', email:'a@g.ca', role:'admin', dealer_role:null, dealer_id:null, active:true, email_verified:false, email_verified_at:null},
  {id:'u2', name:'Sam Staff', email:'s@g.ca', role:'user', dealer_role:null, dealer_id:null, active:true, email_verified:true},
  {id:'d3', name:'Dee Dealer', email:'d@sf.com', role:null, dealer_role:'dealer', dealer_id:'D1', dealer_name:'South Florida', active:true, email_verified:false},
];
async function mock(page){
  await page.route('https://baakegbtuygtldksmant.supabase.co/**', async route => {
    const req = route.request(), u = new URL(req.url()), m = req.method();
    calls.push(m + ' ' + u.pathname + u.search + (req.postData() ? ' ' + req.postData() : ''));
    const j = (b, s=200) => route.fulfill({status:s, contentType:'application/json', body:JSON.stringify(b)});
    if(u.pathname === '/rest/v1/profiles' && m === 'GET'){
      if(u.search.includes('dealer_role')) return j([ME]);
      return j([ME]);
    }
    if(u.pathname === '/rest/v1/portal_users') return j(ROWS);
    if(u.pathname === '/rest/v1/dealers') return j([{id:'D1', name:'South Florida', active:true},{id:'D2', name:'Columbus', active:true}]);
    if(u.pathname === '/rest/v1/app_settings' && m === 'GET') return j([{value:'false'}]);
    if(u.pathname === '/rest/v1/profiles' && m === 'PATCH') return j([{id:'x'}]);
    if(u.pathname === '/functions/v1/create-dealer-user') return j({ok:true, sent:2, failed:[]});
    if(u.pathname === '/functions/v1/account-link') return j({ok:true, said:'A link is on its way.', recorded:true});
    if(u.pathname === '/auth/v1/verify') return j({access_token:'AT', refresh_token:'RT', user:{id:'d3'}});
    if(u.pathname === '/auth/v1/user') return j({id:'d3'});
    return j([]);
  });
}
(async () => {
  await serve(ROOT + '/tools-site', 8711); await serve(ROOT + '/dealer-portal', 8712);
  const b = await chromium.launch(); const page = await b.newPage();
  const errs = []; page.on('pageerror', e => errs.push(e.message)); page.on('dialog', d => d.accept());
  await mock(page);
  await page.goto('http://localhost:8711/');
  await page.evaluate(() => localStorage.setItem('gidc:session', JSON.stringify({access_token:'x', refresh_token:'y', user:{id:'a1', email:'a@g.ca'}})));
  await page.goto('http://localhost:8711/');
  await page.waitForSelector('#gidc-verify');
  console.log('banner:', (await page.textContent('#gidc-verify')).slice(0, 80));
  await page.click('#si-people');
  await page.waitForSelector('#people table');
  console.log('verify bar:', (await page.textContent('#people .verify')).replace(/\s+/g,' '));
  console.log('rows:', await page.$$eval('#people tbody tr', r => r.map(x => x.innerText.replace(/\s+/g,' ').slice(0, 110))));
  // give Sam dealer access: needs a dealer first
  await page.setViewportSize({width:1280,height:900}); 
  await page.selectOption('select[data-dealerrole="u2"]', 'dealer_admin');
  await page.waitForSelector('select[data-dealerof="u2"]');
  console.log('msg:', await page.textContent('#nu-msg'));
  await page.selectOption('select[data-dealerof="u2"]', 'D2');
  await page.waitForTimeout(300);
  // add a login
  await page.fill('#nu-name', 'New Person'); await page.fill('#nu-email', 'n@x.com');
  await page.selectOption('#nu-team', ''); await page.selectOption('#nu-dealerrole', 'dealer');
  await page.click('[data-add]'); await page.waitForTimeout(200);
  console.log('msg no dealer:', await page.textContent('#nu-msg'));
  await page.selectOption('#nu-dealer', 'D1'); await page.click('[data-add]'); await page.waitForTimeout(300);
  console.log('msg:', await page.textContent('#nu-msg'));
  await page.click('[data-reset="d3"]'); await page.waitForTimeout(300);
  console.log('msg:', await page.textContent('#nu-msg'));
  await page.click('[data-verifyall]'); await page.waitForTimeout(300);
  console.log('msg:', await page.textContent('#nu-msg'));
  await page.click('#gidc-verify-go'); await page.waitForTimeout(300);
  console.log('banner after:', (await page.textContent('#gidc-verify')).slice(0, 120));
  console.log('turn on button present (self not verified):', !!(await page.$('[data-require="1"]')));
  // account page
  const p2 = await b.newPage(); p2.on('pageerror', e => errs.push('acct ' + e.message)); await mock(p2);
  await p2.goto('http://localhost:8712/account?k=invite&t=abc');
  console.log('url after load:', p2.url());
  await p2.fill('#p1', 'short'); await p2.fill('#p2', 'short'); await p2.click('#go');
  console.log('short:', await p2.textContent('#msg'));
  await p2.fill('#p1', 'a long enough pass'); await p2.fill('#p2', 'a long enough pass'); await p2.click('#go');
  await p2.waitForSelector('a.go');
  console.log('done:', (await p2.textContent('#box')).replace(/\s+/g,' '));
  console.log('session saved:', await p2.evaluate(() => !!localStorage.getItem('gidc:session')));
  await p2.goto('http://localhost:8712/account'); await p2.fill('#fe', 'z@z.com'); await p2.click('#fgo'); await p2.waitForTimeout(300);
  console.log('forgot:', await p2.textContent('#fmsg'));
  const p3 = await b.newPage(); p3.on('pageerror', e => errs.push('portal ' + e.message)); await mock(p3);
  await p3.goto('http://localhost:8712/'); await p3.waitForTimeout(800);
  console.log('portal signin forgot link:', !!(await p3.$('a[href="/account"]')));
  console.log('ERRORS:', errs);
  console.log(calls.filter(c => !c.startsWith('GET')).join('\n'));
  await b.close(); process.exit(0);
})();

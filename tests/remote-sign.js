// Measurement app 2.26: sending the contract to the customer to sign on
// their own device.
//
//   node tests/remote-sign.js
//   (or PLAYWRIGHT=/path/to/playwright node tests/remote-sign.js)
//
// Serves measurement-app/ with the Supabase address pointed at this test
// server, which stands in for the jobs table and the remote-sign edge
// function (never the real Supabase). Walks the whole thing: the associate
// sends, the customer opens the link with no login, reads the order with its
// prices, signs every field, and the finished PDF comes back stamped with the
// server's time and the IP address, with a signing record page. Also a dead
// link, and a signing whose PDF never arrived being finished on reopening.

const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const path = require('path'), fs = require('fs'), http = require('http'), os = require('os');
const DIR = path.join(__dirname, '..', 'measurement-app');
const TYPES = {'.js':'text/javascript', '.png':'image/png', '.jpg':'image/jpeg', '.pdf':'application/pdf'};
let fails = 0;
const check = (name, ok, got) => {
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : '  got: ' + String(JSON.stringify(got)).slice(0, 400)));
  if(!ok) fails++;
};
const pdftext = file => { try{ return require('child_process').execFileSync('pdftotext', [file, '-']).toString(); }catch(e){ return null; } };

// the stand in for Supabase
const db = {jobs:{}, req:null, calls:[]};
const TOKEN = 'T'.repeat(43);
const SIGNED_AT = '2026-11-18T15:30:05.000Z';
let origin = '';
const body = q => new Promise(ok => { let b = ''; q.on('data', c => b += c); q.on('end', () => ok(b)); });
const server = http.createServer(async (q, r) => {
  const u = decodeURIComponent(q.url.split('?')[0]);
  const send = (code, obj) => { r.writeHead(code, {'Content-Type':'application/json'}); r.end(JSON.stringify(obj)); };
  if(u === '/rest/v1/jobs' && q.method === 'POST'){ const row = JSON.parse(await body(q)); db.jobs[row.id] = row; return send(201, []); }
  if(u === '/rest/v1/jobs'){ const m = /id=eq\.([^&]+)/.exec(q.url);
    return send(200, m ? [db.jobs[decodeURIComponent(m[1])]].filter(Boolean) : Object.values(db.jobs).map(j => ({...j, data:undefined}))); }
  if(u === '/functions/v1/remote-sign'){
    const b = JSON.parse(await body(q)); db.calls.push(b.action);
    if(b.action === 'send'){ const job = db.jobs[b.id].data;
      db.req = {id:'req-1', status:'sent', sentAt:'2026-11-18T15:00:00.000Z', sentTo:job.email, sentBy:'Sam Rep', sentByEmail:'sam@grinyer.ca',
        expiresAt:'2026-12-18T15:00:00.000Z', openedAt:null, job, fp:b.fp};
      return send(200, {ok:true, request:db.req}); }
    if(b.action === 'status') return send(200, {ok:true, request:db.req});
    if(b.token !== TOKEN || !db.req || db.req.status === 'cancelled') return send(404, {error:'This link no longer works.', gone:true});
    if(b.action === 'open'){ db.req.openedAt = db.req.openedAt || '2026-11-18T15:20:00.000Z';
      return send(200, {ok:true, request:db.req, job:db.req.status === 'sent' ? db.req.job : null,
        signedJob:db.req.status !== 'sent' ? db.req.job : null, signed:db.req.status === 'signed' ? db.req.signed : null}); }
    if(b.action === 'sign'){ Object.assign(db.req, {status:'signed', signed:b.signed, name:b.signed.name, signedAt:SIGNED_AT,
        ip:'203.0.113.7', agent:'Test Browser 1.0'}); return send(200, {ok:true, request:db.req}); }
    if(b.action === 'finish'){ if(db.failFinish){ db.failFinish = false; return send(502, {error:'The email would not send'}); }
      db.pdf = Buffer.from(b.pdf, 'base64'); db.req.status = 'done'; db.req.emailedTo = [db.req.sentTo, 'sam@grinyer.ca'];
      return send(200, {ok:true, request:db.req, emailed:db.req.emailedTo}); }
  }
  if(u.startsWith('/rest/') || u.startsWith('/auth/') || u.startsWith('/functions/')) return send(200, []);
  let p = u === '/' ? '/index.html' : u;
  const f = path.join(DIR, p);
  if(!f.startsWith(DIR) || !fs.existsSync(f)){ r.statusCode = 404; return r.end('nf'); }
  let out = fs.readFileSync(f);
  if(p === '/index.html') out = out.toString('utf8').replace("supabaseUrl: 'https://baakegbtuygtldksmant.supabase.co'", "supabaseUrl: '" + origin + "'");
  r.setHeader('Content-Type', TYPES[path.extname(p)] || 'text/html'); r.end(out);
});

(async () => {
  await new Promise(ok => server.listen(0, ok));
  origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch();
  const errors = [];

  // 1. the associate sends it
  const rep = await browser.newPage({viewport:{width:1280, height:900}});
  rep.on('pageerror', e => errors.push('rep: ' + e.message));
  await rep.goto(origin + '/'); await rep.evaluate(() => { const nj = newJob; window.newJob = () => { const j = nj(); delete j.sizing; j.openings.forEach(o => { delete o.openW; delete o.openH; }); return j; }; }); /* 2.31: these jobs are entered the old way */ await rep.waitForTimeout(400);
  await rep.evaluate(() => {
    state.me = {name:'Sam Rep', role:'sales'};
    const j = newJob(); Object.assign(j, {customer:'Jane Sample', address:'12 Main St', city:'Cambridge', phone:'519 555 1234',
      email:'jane@example.com', salesRep:'Sam Rep', leadTime:'8-10 Weeks', docType:'Sales Contract - Cash Web Pricing'}); j.openings = [];
    [['Foyer', 'Single Swing', 'Columbia', 'Passage', 'R -Latitude Standard', 'Matte Black'],
     ['Closet', 'Bifold', 'Kingston', 'Bifold Knob', 'N/A', 'Matte Black']].forEach(([loc, type, style, ht, hs, col]) => {
      const op = newOpening(j.openings.length + 1); op.location = loc; op.existingType = type; op.width = type === 'Bifold' ? '30' : '32'; op.height = 80; /* 2.49: a 32 bifold opening is special order */
      Object.assign(op.options[0].v, {doorType:type, productType:'1.375 Hollow', doorStyle:style, jamb:'', routerStop:'NO', reStile:'NO',
        install:'YES', paintColour:'STD White', handleType:ht, handleStyle:hs, hwColour:col}); applyQtyRule(op); j.openings.push(op); });
    state.job = j; state.view = 'job'; render();
  });
  await rep.click('[data-review]'); await rep.waitForFunction(() => state.reviewReady, null, {timeout:30000});
  check('the associate has Send to sign', await rep.locator('[data-sendsign]').count() === 1);
  await rep.click('[data-sendsign]'); await rep.waitForTimeout(200);
  await rep.click('[data-sure="yes"]'); await rep.waitForTimeout(800);
  check('send goes to the function with the job and its fingerprint', db.req && db.req.job.customer === 'Jane Sample' && !!db.req.fp, db.req && db.req.fp);
  check('the review says it was sent and not opened', /Sent to sign to jane@example.com.*not opened yet/.test(await rep.locator('.rv-remote').innerText()));

  // 2. a dead link says so
  const cust = await browser.newPage({viewport:{width:390, height:844}, isMobile:true, hasTouch:true});
  cust.on('pageerror', e => errors.push('customer: ' + e.message));
  await cust.goto(origin + '/#sign=' + 'X'.repeat(43)); await cust.waitForTimeout(800);
  check('a dead link says it cannot be used', /This link cannot be used/.test(await cust.locator('#app').innerText()));

  // 3. the customer opens the real link: no login, the order with prices
  await cust.goto(origin + '/#sign=' + TOKEN); await cust.reload();
  await cust.waitForFunction(() => state.remote && state.remote.phase === 'ready', null, {timeout:30000});
  if(process.env.SHOT) await cust.screenshot({path:process.env.SHOT, fullPage:true});
  const page = await cust.locator('#app').innerText();
  check('the customer sees their order with prices, no sign in', /Hello Jane Sample/.test(page) && /Columbia/.test(page) &&
    /\$\d/.test(page) && !(await cust.locator('#su-u, [data-signin]').count()), page.slice(0, 300));
  check('the customer cannot change anything on it', await cust.locator('#app input, #app select').count() === 0);
  check('the page shows the handle they picked', await cust.locator('.rs-handle').count() === 1);
  check('the opening was recorded', !!db.req.openedAt);

  // 4. sign every field, then the PDF comes back
  db.failFinish = true;                 // the first finish fails: the page must offer Try again
  await cust.click('[data-rssign]'); await cust.waitForTimeout(200);
  await cust.click('[data-sp="start"]');
  for(let k = 0; k < 30; k++){
    const c = await cust.$('.signpad canvas'); if(!c) break;
    const b = await c.boundingBox();
    await cust.mouse.move(b.x + b.width * .2, b.y + b.height * .6); await cust.mouse.down();
    for(let i = 1; i <= 12; i++) await cust.mouse.move(b.x + b.width * (.2 + i * .05), b.y + b.height * (.6 - .25 * Math.sin(i / 2)));
    await cust.mouse.up(); await cust.click('[data-sp="next"]'); await cust.waitForTimeout(60);
  }
  await cust.waitForFunction(() => ['retry', 'done'].includes(state.remote.phase), null, {timeout:30000});
  check('a failed finish keeps the signatures and offers Try again', await cust.locator('[data-rsretry]').count() === 1);
  await cust.click('[data-rsretry]');
  await cust.waitForFunction(() => state.remote.phase === 'done', null, {timeout:30000});
  check('the done page thanks them and says a copy was emailed', /your contract is signed[\s\S]*emailed to jane@example.com/i.test(await cust.locator('#app').innerText()));
  check('the signatures carry the server time, not the device time', await cust.evaluate(t =>
    Object.values(state.job.signed.marks).every(m => m.at === t) && state.job.signed.at === t, SIGNED_AT));
  const tmp = path.join(os.tmpdir(), 'remote-sign-test.pdf'); fs.writeFileSync(tmp, db.pdf || Buffer.alloc(0));
  const txt = pdftext(tmp);
  if(txt === null) console.log('SKIP PDF text checks (no pdftotext here)');
  else {
    check('the PDF has the signing record page', /Electronic signing record/.test(txt) && /203\.0\.113\.7/.test(txt) && /Test Browser 1\.0/.test(txt), txt.slice(-600));
    check('every signature line is stamped with the time and IP', (txt.match(/Signed electronically .*IP 203\.0\.113\.7/g) || []).length >= 3, txt.length);
    check('the record names who sent it and to whom', /Sam Rep/.test(txt) && /jane@example\.com/.test(txt));
  }

  // 5. reopening the link after signing shows it signed, nothing to sign again
  await cust.reload(); await cust.waitForFunction(() => state.remote && state.remote.phase === 'done', null, {timeout:30000});
  check('reopening a signed link shows it signed with no Sign button', await cust.locator('[data-rssign]').count() === 0);

  // 6. a signing whose PDF never arrived is finished when the link is opened again
  db.req.status = 'signed'; db.pdf = null;
  await cust.reload(); await cust.waitForFunction(() => state.remote && state.remote.phase === 'done', null, {timeout:30000});
  check('signed but unfinished: reopening finishes and stores the PDF', !!db.pdf && db.req.status === 'done');

  check('no page errors', errors.length === 0, errors);
  await browser.close(); server.close();
  console.log(fails ? fails + ' FAILED' : 'ALL PASSED');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

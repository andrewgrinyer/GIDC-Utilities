// Clicks through Door Inventory on the tools site against a fake Supabase.
// Nothing leaves the machine.
//
//   node tests/inventory.js            (SHOTS=/some/dir to save screenshots)
//
// Prints each check, then ERRORS: [] when no page threw and FAILED: []
// when every check held.

const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const path = require('path'), fs = require('fs'), http = require('http');
const ROOT = path.join(__dirname, '..');
const SHOTS = process.env.SHOTS || '';
function serve(dir, port){ return new Promise(ok => http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]); if(p.endsWith('/')) p += 'index.html';
  const f = path.join(dir, p);
  if(!fs.existsSync(f)){ r.statusCode = 404; return r.end('nf'); }
  r.setHeader('Content-Type', f.endsWith('.js') ? 'text/javascript' : 'text/html'); r.end(fs.readFileSync(f));
}).listen(port, ok)); }

const PRICES = [
  {style:'Clear 1-Lite', size_key:"6'8|Solid", price:359.31},
  {style:'Clear 1-Lite', size_key:"6'8|Hollow", price:null},
  {style:'Columbia', size_key:"6'8|Hollow", price:212.77},
  {style:'Columbia', size_key:"6'8|Solid", price:303.84},
  {style:'Columbia', size_key:"6'8|Bifold", price:226.71},
  {style:'Columbia', size_key:"6'8|1.75", price:368.01},
];
const ALIAS = [{order_style:'Samish (Smooth)', price_style:'Columbia'}];
let ROLE = 'admin', STOCK, n = 0;
const calls = [];
async function mock(page){
  await page.route('https://baakegbtuygtldksmant.supabase.co/**', async route => {
    const req = route.request(), u = new URL(req.url()), p = u.pathname, m = req.method();
    calls.push(m + ' ' + p + u.search);
    const j = (b, s) => route.fulfill({status:s || 200, contentType:'application/json', body:JSON.stringify(b)});
    if(p === '/rest/v1/profiles') return j([{id:'a1', name:'Andrew', role:ROLE, active:true, email_verified_at:'2026-10-24'}]);
    if(p === '/auth/v1/user') return j({id:'a1'});
    if(p === '/rest/v1/wholesale_prices') return j(ROLE === 'installer' ? [] : PRICES);
    if(p === '/rest/v1/wholesale_style_alias') return j(ALIAS);
    if(p === '/rest/v1/door_inventory'){
      const id = (u.searchParams.get('id') || '').replace('eq.', '');
      if(m === 'GET') return j(STOCK);
      const body = req.postData() ? JSON.parse(req.postData()) : {};
      if(m === 'POST'){ const row = Object.assign({id:'n' + (++n), notes:null, updated_by:'Andrew'}, body); STOCK.push(row); return j([row], 201); }
      const i = STOCK.findIndex(d => d.id === id);
      if(i < 0) return j([]);
      if(m === 'PATCH'){ Object.assign(STOCK[i], body, {updated_by:'Andrew'}); return j([STOCK[i]]); }
      if(m === 'DELETE'){ const gone = STOCK.splice(i, 1); return j(gone); }
    }
    return j([]);
  });
}
const failed = [];
const check = (ok, what) => { console.log((ok ? 'ok   ' : 'FAIL ') + what); if(!ok) failed.push(what); };
const listText = page => page.$eval('#list', e => e.innerText.replace(/\s+/g, ' '));
const msgText = page => page.$eval('#msg', e => e.innerText);

(async () => {
  await serve(ROOT + '/tools-site', 8724);
  const b = await chromium.launch();
  const errs = [];
  async function open(role, viewport){
    ROLE = role;
    const page = await b.newPage({viewport: viewport || {width:1200, height:900}});
    page.on('pageerror', e => errs.push(e.message));
    await mock(page);
    await page.goto('http://localhost:8724/');
    await page.evaluate(() => localStorage.setItem('gidc:session', JSON.stringify({access_token:'x', refresh_token:'y', user:{id:'a1', email:'a@g.ca'}})));
    await page.goto('http://localhost:8724/inventory/');
    await page.waitForFunction(() => !/Loading/.test(document.getElementById('list').innerText));
    return page;
  }
  STOCK = [{id:'s1', style:'Columbia', width_in:'30.000', height_in:'80.000', core:'Hollow', qty:2, notes:'Rack A', updated_by:'Nick'},
           {id:'s2', style:'Clear 1-Lite', width_in:'29.500', height_in:'80.000', core:'Solid', qty:0, notes:null}];

  // the tile is on the landing page
  let page = await open('admin');
  const tile = await page.evaluate(() => fetch('/').then(r => r.text()));
  check(/Door Inventory/.test(tile) && /\.\/inventory\//.test(tile), 'landing page has the Door Inventory tile');

  let t = await listText(page);
  check(/Columbia/.test(t) && /30 x 80/.test(t) && /Rack A/.test(t), 'lists a door with its size and notes');
  check(!/Clear 1-Lite/.test(t), 'a line with none left is hidden by default');
  await page.click('#showzero');
  check(/29 1\/2 x 80/.test(await listText(page)), 'Show none left shows it, with the size as 29 1/2');
  await page.click('#showzero');

  // cores come from the price list for the style picked
  const cores = async () => page.$$eval('#f-core option', o => o.map(x => x.value).join(','));
  await page.fill('#f-style', 'Clear 1-Lite');
  check(await cores() === 'Solid', 'Clear 1-Lite offers Solid only, as the price list sells it');
  await page.fill('#f-style', 'samish smooth');
  check(await cores() === 'Hollow,Solid,Bifold,1.75', 'the portal name Samish (Smooth) offers Columbia\'s four cores, through the alias');
  const opts = await page.$$eval('#styles option', o => o.map(x => x.value).join(','));
  check(opts === 'Clear 1-Lite,Columbia', 'style suggestions are the price list styles');

  // adding through the alias saves under the price list name
  await page.selectOption('#f-core', 'Bifold');
  await page.fill('#f-w', '29 1/2'); await page.fill('#f-h', '80'); await page.fill('#f-qty', '3');
  await page.fill('#f-notes', 'Back wall');
  await page.click('#f-save');
  await page.waitForTimeout(200);
  const added = STOCK.find(d => d.core === 'Bifold');
  check(added && added.style === 'Columbia' && added.width_in === 29.5 && added.qty === 3,
    'Samish (Smooth) is saved as Columbia, 29.5 wide, 3 of them');
  check(/Added Columbia 29 1\/2 x 80/.test(await msgText(page)), 'says what was added');

  // the same door again is refused, a style not on the list is refused
  await page.fill('#f-style', 'Columbia'); await page.selectOption('#f-core', 'Hollow');
  await page.fill('#f-w', '30'); await page.fill('#f-h', '80'); await page.click('#f-save');
  check(/already on the list/.test(await msgText(page)), 'the same door twice is refused');
  await page.fill('#f-style', 'Made Up Style'); await page.click('#f-save');
  check(/not on the price list/.test(await msgText(page)), 'a style not on the price list is refused');
  await page.fill('#f-style', 'Columbia'); await page.fill('#f-w', 'thirty'); await page.click('#f-save');
  check(/width should be inches/.test(await msgText(page)), 'a width that is not inches is refused');

  // plus and minus
  await page.click('[data-inc="s1"]'); await page.waitForTimeout(150);
  check(STOCK.find(d => d.id === 's1').qty === 3, '+ takes the count to 3');
  await page.click('[data-dec="s1"]'); await page.waitForTimeout(150);
  check(STOCK.find(d => d.id === 's1').qty === 2, 'minus takes it back to 2');

  // edit
  await page.click('[data-edit="s1"]');
  check(await page.inputValue('#f-style') === 'Columbia' && await page.inputValue('#f-core') === 'Hollow', 'Edit fills the form');
  await page.fill('#f-notes', 'Rack C'); await page.click('#f-save'); await page.waitForTimeout(150);
  check(STOCK.find(d => d.id === 's1').notes === 'Rack C', 'Edit saves the notes');

  // remove asks first
  await page.click('[data-del="s1"]');
  check(/for good/.test(await listText(page)), 'Remove asks first');
  if(SHOTS) await page.screenshot({path: SHOTS + '/inventory-admin.png', fullPage: true});
  await page.click('[data-delyes="s1"]'); await page.waitForTimeout(150);
  check(!STOCK.find(d => d.id === 's1'), 'Yes removes it');
  await page.close();

  // an installer reads only, and the page does not ask for the price list
  calls.length = 0;
  page = await open('installer');
  check(await page.$eval('#addcard', e => e.classList.contains('hide')), 'an installer gets no add form');
  check(!(await page.$('[data-inc]')) && !(await page.$('[data-del]')), 'an installer gets no + or Remove');
  check(!calls.some(c => /wholesale_prices/.test(c)), 'the page does not ask for prices for an installer');
  await page.close();

  // phone width
  page = await open('admin', {width:390, height:844});
  const wide = await page.evaluate(() => document.documentElement.scrollWidth);
  check(wide <= 390, 'no sideways scroll on a phone (' + wide + ')');
  if(SHOTS) await page.screenshot({path: SHOTS + '/inventory-phone.png', fullPage: true});
  await page.close();

  await b.close();
  console.log('ERRORS:', JSON.stringify(errs));
  console.log('FAILED:', JSON.stringify(failed));
  process.exit(errs.length || failed.length ? 1 : 0);
})();

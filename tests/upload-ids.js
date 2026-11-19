// The ids the Access import reads, for a few lines whose names do not match
// the template's tables word for word. Nothing leaves the machine.
//
//   node tests/upload-ids.js
//
// Builds the order form in the page and prints the upload block (row 37 on)
// for each line: DoorTypeID, DoorStyleID, DoorProductTypeID, DoorPaintColourID.

const { chromium } = require(process.env.PLAYWRIGHT || 'playwright');
const path = require('path'), fs = require('fs'), http = require('http');
const html = fs.readFileSync(path.join(__dirname, '..', 'dealer-portal', 'index.html'), 'utf8');
const server = http.createServer((q, r) => {
  const p = q.url.split('?')[0];
  if(p === '/version.txt'){ r.setHeader('Content-Type', 'text/plain');
    return r.end(fs.readFileSync(path.join(__dirname, '..', 'dealer-portal', 'version.txt'))); }
  r.setHeader('Content-Type', 'text/html'); r.end(html);
}).listen(8716);
const row = (style, extra) => Object.assign({location:'PRIMARY', qty:2, productType:'1.375 Stile and Rail',
  doorType:'Double Swing AST', doorStyle:style, width:'28', height:'80', paintColour:'Extra White',
  reRail:'NO', reStile:'NO'}, extra || {});
const ORDER = {id:'o1', dealer_id:'D1', customer_name:'SFD', status:'submitted', created_at:'2026-11-19',
  form:{rows:[row('4 Panel True Shaker'), row('Mercer', {doorType:'Single Pre-Hung', productType:'1.375 Hollow', jambW:'4 9/16'}),
              row('2 Panel True Shaker', {paintColour:'Pearly White', doorType:'Single Swing'})]}};
(async () => {
  const b = await chromium.launch();
  const page = await b.newPage();
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.route('https://*.supabase.co/**', r => r.fulfill({status:200, contentType:'application/json', body:'[]'}));
  await page.goto('http://localhost:8716/');
  /* the page can reload itself once while it starts, so wait for it to settle */
  let out = null;
  for(let tries = 0; tries < 5 && !out; tries++){
    await page.waitForLoadState("networkidle");
    out = await page.evaluate(o => {
    const wb = workbookBytes(o);
    const zip = fflate.unzipSync(wb.bytes);
    const strs = sharedStrings(zip);
    const v = sheetValues(zip, /xl\/worksheets\/sheet1\.xml$/, strs);
    const res = {build: BUILD};
    for(let r = 37; r < 37 + o.form.rows.length; r++)
      res[r] = ['B','C','E','I','Q','R','T','U','AF','AG'].map(c => c + '=' + v[c + r]).join(' ');
    res.top = ['B4','C4','Q4'].map(c => c + '=' + v[c]).join(' ');
    return res;
  }, ORDER).catch(e => { console.log("retry:", e.message.split("\n")[0]); return null; });
  }
  console.log(out);
  console.log('ERRORS:', errs);
  await b.close(); server.close();
})();

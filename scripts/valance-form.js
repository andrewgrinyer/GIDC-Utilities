// Builds the Oversized Valance Build Down form the measurement app attaches
// to an order and has signed (2.78, Andrew 27 Nov), in the same look as the
// closet forms (scripts/closet-forms.js):
//   oversized-valance-build-down.pdf
// Usage: node scripts/valance-form.js scripts/valance-form <out dir>
// The assets dir holds logo.txt (the data:image/png URI of .brand img in measurement-app/index.html)
// and valance.jpg (Andrew's photo: a 3 door bypass with the valance built down above it).
// Then: pdftoppm -r 150 -png -singlefile oversized-valance-build-down.pdf oversized-valance-build-down
// The signature and date positions it logs go into JOB_DOCS in index.html (sign x, y, dx).
const { chromium } = require('playwright'); const fs = require('fs');
const S = process.argv[2], OUT = process.argv[3];
const logo = fs.readFileSync(S + '/logo.txt', 'utf8').trim();
const img = n => 'data:image/jpeg;base64,' + fs.readFileSync(S + '/' + n + '.jpg').toString('base64');
const CSS = `
@page{size:letter;margin:0}
*{box-sizing:border-box}
body{margin:0;font-family:Helvetica,Arial,sans-serif;color:#2A2A2A;font-size:10.2pt;line-height:1.38}
.page{width:8.5in;height:11in;padding:0.5in 0.6in 0.45in;position:relative}
.lh{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:1.5px solid #2A2A2A;padding-bottom:8px}
.lh img{height:52px}
.lh .addr{text-align:right;font-size:8.5pt;color:#6B6B6B;line-height:1.35}
.kick{margin:14px 0 2px;font-size:8pt;letter-spacing:.14em;text-transform:uppercase;color:#B5121B;font-weight:700}
h1{margin:0 0 2px;font-size:21pt;color:#2A2A2A;font-weight:700;font-family:Georgia,'Times New Roman',serif;max-width:4.6in}
.lead{margin:0 0 12px;color:#6B6B6B;font-size:10.5pt;max-width:4.8in}
.photo{border-radius:6px;overflow:hidden;background:#F2F2F2;padding:8px}
.photo img{display:block;height:4.9in;width:auto;margin:0 auto;border-radius:4px}
.photo p{margin:6px 2px 0;font-size:8.5pt;color:#6B6B6B}
.panel{background:#F2F2F2;border-left:3px solid #B5121B;padding:9px 12px;margin:12px 0 0}
.panel p{margin:0 0 6px}.panel p:last-child{margin:0}
.ack{margin:12px 0 0;background:#F2F2F2;border-radius:6px;padding:10px 14px 12px}
.ack .kick{margin:0 0 4px}
.ack ul{margin:0;padding-left:16px;font-size:9.2pt}
.ack li{margin:0 0 4px}
.ack li::marker{color:#B5121B}
.sig{display:flex;gap:22px;margin-top:14px}
.sig div{font-size:8.5pt;color:#6B6B6B}
.sig .ln{border-top:0.8px solid #2A2A2A;padding-top:3px}
.foot{position:absolute;left:0.6in;right:0.6in;bottom:0.4in;border-top:0.6px solid #C8C8C8;padding-top:5px;text-align:center;font-size:7pt;color:#6B6B6B}
.foot b{color:#B5121B}
`;
const page = `<!doctype html><html><head><meta charset="utf-8"><style>${CSS}</style></head><body><div class="page">
<div class="lh"><img src="${logo}"><div class="addr">1177 Franklin Blvd<br>Cambridge, ON<br>877 566 4052</div></div>
<div class="kick">Bypass doors</div><h1>Oversized Valance Build Down</h1>
<p class="lead">How the wall above your bypass doors is finished when the opening is taller than the doors.</p>
<div class="photo"><img src="${img('valance')}"><p>Reference photo: a three door bypass with the valance built down above the doors.</p></div>
<div class="panel"><p>The valance (bulkhead) above the bypass doors is <b>built down</b> to meet the top of the doors, as in the photo.</p>
<p>This lets standard 84" doors be used where the ceiling is higher, for example an 88" to 91" ceiling.</p></div>
<div class="ack"><div class="kick">Customer acknowledgement</div><ul>
<li>The valance above the bypass doors on this order is built down to the doors, as shown in the reference photo.</li>
<li>It is charged on this order as Oversized Bulk Head.</li>
</ul>
<div class="sig"><div style="flex:1"><div style="height:20px"></div><div class="ln" id="sign">Customer signature</div></div>
<div style="width:2.1in"><div style="height:20px"></div><div class="ln" id="date">Date</div></div></div></div>
<div class="foot">For more information, contact <b>Grinyer Interior Doors &amp; Closets</b> &nbsp;|&nbsp; info@grinyer.ca &nbsp;|&nbsp; 877 566 4052</div>
</div></body></html>`;

(async () => {
  const b = await chromium.launch();
  const name = 'oversized-valance-build-down';
  const p = await b.newPage({viewport:{width:816, height:1056}});
  await p.setContent(page); await p.waitForTimeout(300);
  const pos = await p.evaluate(() => Object.fromEntries(['sign', 'date'].map(id => {
    const r = document.getElementById(id).getBoundingClientRect();
    return [id, {x:+(r.left * 0.75).toFixed(1), y:+(r.top * 0.75).toFixed(1)}]; })));
  const over = await p.evaluate(() => document.querySelector('.page').scrollHeight);
  console.log(name, JSON.stringify(pos), 'pageh', over, over > 1056 ? 'OVERFLOW' : 'ok');
  await p.pdf({path:OUT + '/' + name + '.pdf', format:'Letter', printBackground:true, margin:{top:0,right:0,bottom:0,left:0}});
  await b.close();
})();

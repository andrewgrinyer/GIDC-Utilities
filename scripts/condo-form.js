// Builds measurement-app/condo-installation-agreement.pdf (2.52) from Andrew's condo form,
// in the print colours. Usage: node scripts/condo-form.js <dir with logo.txt> <out path without .pdf>
// logo.txt is the data:image/png URI of the logo in measurement-app/index.html (.brand img).
// Then: pdftoppm -r 150 -png -singlefile <out>.pdf <out>  (the PNG the app prints).
// Signature and stamp positions in index.html (JOB_DOCS condo, docStamps 'condo') come from the ids it logs.
const { chromium } = require('playwright'); const fs = require('fs');
const S = process.argv[2], OUT = process.argv[3];
const logo = fs.readFileSync(S + '/logo.txt', 'utf8').trim();
const line = w => '<span class="ln" style="width:' + w + 'px"></span>';
const html = `<!doctype html><html><head><meta charset="utf-8"><style>
@page{size:letter;margin:0}
*{box-sizing:border-box}
body{margin:0;font-family:Helvetica,Arial,sans-serif;color:#2A2A2A;font-size:10.6pt;line-height:1.42}
.page{width:8.5in;height:11in;padding:0.55in 0.65in 0.5in;position:relative}
.lh{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:1.5px solid #2A2A2A;padding-bottom:8px}
.lh img{height:52px}
.lh .addr{text-align:right;font-size:8.5pt;color:#6B6B6B;line-height:1.35}
.kick{margin:16px 0 2px;font-size:8pt;letter-spacing:.14em;text-transform:uppercase;color:#B5121B;font-weight:700;font-variant:small-caps}
h1{margin:0 0 10px;font-size:19pt;color:#2A2A2A;font-weight:700}
p{margin:0 0 8px}
ol{margin:6px 0 0;padding-left:20px}
li{margin:0 0 7px}
li::marker{color:#B5121B;font-weight:700}
.sub{margin:4px 0 0 0;padding-left:16px;list-style:lower-alpha}
.sub li{margin:0 0 6px}
b{color:#2A2A2A}
.red{color:#B5121B}
.ln{display:inline-block;border-bottom:0.8px solid #2A2A2A;height:14px;vertical-align:bottom;margin-left:4px}
.panel{background:#F2F2F2;border-left:3px solid #B5121B;padding:9px 12px;margin:10px 0 0}
.row{display:flex;gap:22px;align-items:flex-end;margin:10px 0 0}
.fees{display:flex;gap:40px;margin-top:4px}
.foot{position:absolute;left:0.65in;right:0.65in;bottom:0.42in;border-top:0.6px solid #C8C8C8;padding-top:5px;text-align:center;font-size:7pt;color:#6B6B6B}
.foot b{color:#B5121B}
</style></head><body><div class="page">
<div class="lh"><img src="${logo}"><div class="addr">1177 Franklin Blvd<br>Cambridge, ON<br>877 566 4052</div></div>
<div class="kick">Condominium installation</div>
<h1>Condominium Installation Details &amp; Agreement</h1>
<p>Dear Customer, as I'm sure you can imagine working in a Condo Building adds an extra level of difficulty to our installers' jobs. We do not charge extra for condo installations but ask for your assistance to ensure things run smoothly. Many buildings have different policies and restrictions and as such we need to set forth everyone's expectations and requirements before commencing work. Outlined below is the list of minimum requirements we need the Condo owner to organize prior to our arrival. Please review the list and make arrangements with your building's Superintendent. If our crew's arrival at your condo and the items have not been arranged, we will reschedule your installation. A revisit fee will be charged.</p>
<ol>
<li>We must ensure the installation day <b>does not</b> occur on <b>garbage day</b>.</li>
<li>You must book the <b>SERVICE ELEVATOR</b> for the duration of the installation. Our teams must make many trips back and forth from your unit to their trucks and as such will require the Service Elevator for the entire install. If there are restricted hours they must be noted below. Failure to do so will result in wait time charges. Refer to the fee schedule below.
<ol class="sub"><li>Service Elevator: Start Time ${line(130)} &nbsp; End Time: ${line(130)}</li>
<li>Restricted Hours and Reason: ${line(300)}</li></ol></li>
<li><b>Parking</b> within a reasonable distance of the Service Elevator must be provided for our trucks. Our trucks are over 96" tall and will not fit in underground parking lots. Therefore, the loading dock is most often the appropriate location. Your installation crew will call you 10 minutes prior to their arrival and request you meet them outside to assist them into the prearranged parking location. Please remember our crews have not been to your building before, so you are the expert. If parking is not provided or we are told to park in a space where we receive a parking ticket, you the customer are responsible to pay the fine. The Installers cannot be expected to move their trucks during the installation. Truck/parking moves will be charged at the wait time charges.</li>
<li><b>Contact Information for day of installation</b>
<div class="row"><span>Name:</span><span class="ln" id="c-name" style="width:250px"></span><span>Phone Number:</span><span class="ln" id="c-phone" style="width:150px"></span></div></li>
<li><b>Superintendent</b> Contact Information and Acknowledgement of Requirements
<div class="row"><span>Name:</span><span class="ln" style="width:190px"></span><span>Signature:</span><span class="ln" style="width:220px"></span></div></li>
<li><b>Customer Acknowledgement</b> of <b>Requirements</b> and <b>Fees</b>
<div class="row"><span>Name:</span><span class="ln" id="cu-name" style="width:190px"></span><span>Signature:</span><span class="ln" id="cu-sign" style="width:220px"></span></div>
<div class="row"><span>Date:</span><span class="ln" id="cu-date" style="width:150px"></span></div></li>
</ol>
<div class="panel"><b>Schedule of Additional Fees</b>
<div class="fees"><span><span class="red">i)</span> Wait time $250/hr</span><span><span class="red">ii)</span> Revisit fee $850/revisit</span></div></div>
<div class="foot">For more information, contact <b>Grinyer Interior Doors &amp; Closets</b> &nbsp;|&nbsp; info@grinyer.ca &nbsp;|&nbsp; 877 566 4052</div>
</div></body></html>`;
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({viewport:{width:816, height:1056}});
  await p.setContent(html); await p.waitForTimeout(300);
  const pos = await p.evaluate(() => Object.fromEntries(['c-name','c-phone','cu-name','cu-sign','cu-date'].map(id => {
    const r = document.getElementById(id).getBoundingClientRect(); return [id, {x:+(r.left*0.75).toFixed(1), y:+(r.bottom*0.75).toFixed(1), w:+(r.width*0.75).toFixed(1)}]; })));
  const over = await p.evaluate(() => document.querySelector('.page').scrollHeight);
  console.log(JSON.stringify(pos), 'pageh', over);
  await p.pdf({path:OUT + '.pdf', format:'Letter', printBackground:true, margin:{top:0,right:0,bottom:0,left:0}});
  await b.close();
})();

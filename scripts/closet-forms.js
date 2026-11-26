// Builds the closet forms the measurement app prints and has signed (2.70):
//   closet-installation-details-patch.pdf  (No Charge Tear Out and Rough Patch, with the rough patch photo)
//   closet-installation-details-paint.pdf  (Customer to Tear Out and Paint Prior to Install)
//   condo-closet-wall-spaces.pdf           (Condominium Closet Installation, Standard Wall Spaces)
// Usage: node scripts/closet-forms.js <assets dir> <out dir>
// The assets dir holds logo.txt (the data:image/png URI of .brand img in measurement-app/index.html)
// and the photos in scripts/closet-forms/ (backing, notch, holes, rods, patch, condo-gap .jpg).
// Then for each: pdftoppm -r 150 -png -singlefile <name>.pdf <name>  (the PNG the app prints).
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
.lead{margin:0 0 10px;color:#6B6B6B;font-size:10.5pt;max-width:4.8in}
.cards{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.card{display:flex;gap:10px;background:#F2F2F2;border-radius:6px;padding:8px;align-items:flex-start}
.card img{width:112px;height:128px;object-fit:cover;border-radius:4px;flex:none}
.card h3{margin:2px 0 4px;font-size:11pt;color:#B5121B}
.card p{margin:0;font-size:8.8pt;line-height:1.33}
.choice{margin:12px 0 0;border:1.5px solid #B5121B;border-radius:6px;padding:9px 11px;display:flex;gap:12px;align-items:flex-start}
.choice img{width:170px;height:120px;object-fit:cover;border-radius:4px;flex:none}
.choice h3{margin:0 0 4px;font-size:11.5pt}
.choice p{margin:0 0 5px;font-size:9.4pt}
.tick{display:inline-block;width:12px;height:12px;border:1.4px solid #2A2A2A;margin-right:6px;vertical-align:-1px;position:relative}
.tick.on::after{content:'';position:absolute;left:3px;top:0px;width:4px;height:8px;border:solid #B5121B;border-width:0 2px 2px 0;transform:rotate(45deg)}
.off{color:#8A8A8A}
.ack{margin:12px 0 0;background:#F2F2F2;border-radius:6px;padding:10px 14px 12px}
.ack .kick{margin:0 0 4px}
.ack ul{margin:0;padding-left:16px;columns:2;column-gap:22px;font-size:9pt}
.ack li{margin:0 0 4px;break-inside:avoid}
.ack li::marker{color:#B5121B}
.sig{display:flex;gap:22px;margin-top:14px}
.sig div{font-size:8.5pt;color:#6B6B6B}
.sig .ln{border-top:0.8px solid #2A2A2A;padding-top:3px}
.foot{position:absolute;left:0.6in;right:0.6in;bottom:0.4in;border-top:0.6px solid #C8C8C8;padding-top:5px;text-align:center;font-size:7pt;color:#6B6B6B}
.foot b{color:#B5121B}
.gap{display:flex;gap:18px;align-items:flex-start;margin-top:8px}
.gap img{width:3.7in;border-radius:4px;flex:none}
.gap p{margin:0 0 9px}
.panel{background:#F2F2F2;border-left:3px solid #B5121B;padding:9px 12px;margin:12px 0 0}
`;
const head = (kick, title, lead) => `<div class="lh"><img src="${logo}"><div class="addr">1177 Franklin Blvd<br>Cambridge, ON<br>877 566 4052</div></div>
<div class="kick">${kick}</div><h1>${title}</h1><p class="lead">${lead}</p>`;
const foot = `<div class="foot">For more information, contact <b>Grinyer Interior Doors &amp; Closets</b> &nbsp;|&nbsp; info@grinyer.ca &nbsp;|&nbsp; 877 566 4052</div>`;
const sig = `<div class="sig"><div style="flex:1"><div style="height:20px"></div><div class="ln" id="sign">Customer signature</div></div>
<div style="width:2.1in"><div style="height:20px"></div><div class="ln" id="date">Date</div></div></div>`;

const cards = `<div class="cards">
<div class="card"><img src="${img('backing')}"><div><h3>No Backing</h3><p>Our organizers are open backed. Your closet wall shows behind the shelves and hanging areas, as in the photo. A back panel is only included where your design shows one.</p></div></div>
<div class="card"><img src="${img('notch')}"><div><h3>Baseboard Notch</h3><p>The uprights are notched at the bottom so they step over your baseboard and sit tight to the wall. Your baseboards stay in place. All systems come notched unless special ordered without it.</p></div></div>
<div class="card"><img src="${img('holes')}"><div><h3>Adjustment Holes</h3><p>Every upright has rows of holes so shelves can be moved later. The holes are standard in the closet industry and cannot be covered or filled after installation.</p></div></div>
<div class="card"><img src="${img('rods')}"><div><h3>Round Chrome Closet Rods</h3><p>Hanging areas use round chrome closet rods held by chrome end supports at each upright, as shown.</p></div></div>
</div>`;
const ack = `<div class="ack"><div class="kick">Customer acknowledgement</div><ul>
<li>The organizer has no back panel unless the design shows one.</li>
<li>Uprights are notched over the baseboard.</li>
<li>Adjustment holes show on the uprights and cannot be covered.</li>
<li>Hanging rods are round chrome.</li>
<li>Organizers are installed straight and level. Where a wall is out of plumb or wavy a small space may show, which a finish carpenter can trim.</li>
<li>Demolition, patching and painting are only included as ticked above.</li>
<li>Drawer fronts are drilled with 2 holes at 96 mm for the handles.</li>
<li>All closet materials are special order and cannot be returned.</li>
</ul>${sig}</div>`;

const patchChoice = `<div class="choice"><img src="${img('patch')}"><div>
<h3><span class="tick on"></span>No Charge Tear Out and Rough Patch</h3>
<p>Our crew removes the existing closet shelving and rods at no charge and fills the holes they leave with a rough patch.</p>
<p><b>A rough patch is not sanded or painted.</b> It looks like the photo. Painting the closet afterwards is up to you.</p>
<p class="off"><span class="tick"></span>Customer to Tear Out and Paint Prior to Install</p></div></div>`;
const paintChoice = `<div class="choice"><div>
<h3><span class="tick on"></span>Customer to Tear Out and Paint Prior to Install</h3>
<p>You remove the existing closet shelving and rods, patch the walls and finish any painting <b>before installation day</b>. Our crew installs into the empty, finished closet.</p>
<p>If the closet is not cleared when we arrive, the installation may have to be rescheduled.</p>
<p class="off"><span class="tick"></span>No Charge Tear Out and Rough Patch</p></div></div>`;

const closetPage = choice => `<!doctype html><html><head><meta charset="utf-8"><style>${CSS}</style></head><body><div class="page">
${head('Closet organizers', 'Closet Installation Details', 'How your Grinyer closet organizer is built, and what to expect on installation day.')}
${cards}${choice}${ack}${foot}</div></body></html>`;

const condoPage = `<!doctype html><html><head><meta charset="utf-8"><style>${CSS}</style></head><body><div class="page">
${head('Condominium installation', 'Condominium Closet Installation: Standard Wall Spaces', 'How closet organizers are fitted in a condominium.')}
<div class="gap"><img src="${img('condo-gap')}"><div>
<p>Grinyer Interior Doors &amp; Closets has all closet organizers <b>custom cut in the factory</b> for condominium installations. This is done to help mitigate the increased installation time when working in condominiums.</p>
<p>As you can imagine, the increased distance from your unit to our trucks makes condo installs much more time consuming. GIDC does not charge extra for working in a condo building, but we do make some small changes to the designs. The graphic shows the changes.</p>
<p>The closet systems are installed <b>between the baseboards</b>. This leaves a small space, about <b>1" (25 mm)</b>, on either side of the organizer system. This eliminates the need for cutting on site and saves you money.</p>
</div></div>
<div class="panel">The 1" spaces at each side are normal for a condominium installation and are not a defect.</div>
<div class="ack" style="margin-top:16px"><div class="kick">Reviewed and approved</div>
<p style="margin:0;font-size:9.4pt">I have reviewed the standard wall spaces for a condominium closet installation and approve them for my order.</p>${sig}</div>
${foot}</div></body></html>`;

(async () => {
  const b = await chromium.launch();
  for(const [name, html] of [['closet-installation-details-patch', closetPage(patchChoice)],
                             ['closet-installation-details-paint', closetPage(paintChoice)],
                             ['condo-closet-wall-spaces', condoPage]]){
    const p = await b.newPage({viewport:{width:816, height:1056}});
    await p.setContent(html); await p.waitForTimeout(300);
    const pos = await p.evaluate(() => Object.fromEntries(['sign', 'date'].map(id => {
      const r = document.getElementById(id).getBoundingClientRect();
      return [id, {x:+(r.left * 0.75).toFixed(1), y:+(r.top * 0.75).toFixed(1)}]; })));
    const over = await p.evaluate(() => document.querySelector('.page').scrollHeight);
    console.log(name, JSON.stringify(pos), 'pageh', over, over > 1056 ? 'OVERFLOW' : 'ok');
    await p.pdf({path:OUT + '/' + name + '.pdf', format:'Letter', printBackground:true, margin:{top:0,right:0,bottom:0,left:0}});
    await p.close();
  }
  await b.close();
})();

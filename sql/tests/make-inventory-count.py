# Makes sql/door-inventory-count-2026-11-12.sql from GIDC_Door_Inventory.xlsx.
# python3 -I sql/tests/make-inventory-count.py GIDC_Door_Inventory.xlsx tools-site/wholesale/index.html OUT.sql report.json
# (copy sql/tests/inventory-count-head.sql to OUT.sql.head first; it is the top of the file)
import openpyxl, re, json, sys
src, pl_html, out_sql, out_report = sys.argv[1:5]
pn = lambda s: re.sub(r'[^a-z0-9]', '', str(s or '').lower())
# the price list as the wholesale tool carries it (REV002)
html = open(pl_html).read()
m = re.search(r'const EMBEDDED_PL = (\{.*?\});\n', html)
PL = json.loads(m.group(1))
NAME, CORES = {}, {}
for k, v in PL['styles'].items():
    if re.search(r'shipping|re ?rail|double stile|astragal|paint|c ?match', v['name'], re.I): continue
    cores = {kk.split('|')[1] for kk, p in v['prices'].items() if isinstance(p, (int, float)) and p > 0}
    NAME[pn(v['name'])] = v['name']
    if cores: CORES[pn(v['name'])] = cores
# sheet name -> price list name, only where the reading is clear
MAP = {'1 Side Mirror': '1-sided Mirror', 'Demen': 'Deman', 'Rasio?': 'Rasario'}
wb = openpyxl.load_workbook(src, data_only=True); ws = wb.active
rows = []
for r in ws.iter_rows(min_row=5, max_row=ws.max_row):
    v = [c.value for c in r]
    if not isinstance(v[0], int): continue
    yellow = bool(r[0].fill and r[0].fill.fill_type and r[0].fill.fgColor.rgb == 'FFFFF2CC')
    n, w, h, size, style, core, thick, qty, note, sheet = v
    style = str(style).strip()
    checks, said = [], []
    if note: checks.append(str(note).strip().rstrip('.'))
    mapped = MAP.get(style) or NAME.get(pn(style))
    if mapped and pn(mapped) != pn(style): said.append('Sheet says ' + style)
    if not mapped:
        # Andrew, 12 Nov: a style the price list does not have is Other,
        # with its name in the notes
        said.insert(0, 'Style: ' + style.rstrip('?').strip())
        mapped = 'Other'
    k = pn(mapped)
    if thick and '3/4' in str(thick): core = '1.75'
    how = ''
    if not core and k in CORES and 'Hollow' not in CORES[k] and h is not None:
        core = 'Solid'; said.append('core from the price list, which only sells it solid')
    if core and k in CORES and core not in CORES[k]:
        checks.append('Price list does not sell this style in ' + core)
    rows.append(dict(n=n, sheet=sheet, style=mapped, w=w, h=h, core=core or None, qty=qty or 0,
                     checks=checks, said=said, yellow=yellow, onlist=k in CORES, orig=style))
# the same door twice is one line with a bigger count
merged = {}
for r in rows:
    key = (pn(r['style']) + (r['orig'] if r['style'] == 'Other' else ''), r['w'], r['h'], r['core'])
    if key in merged:
        m0 = merged[key]; m0['qty'] += r['qty']; m0['also'].append(r['n'])
        m0['checks'] += [c for c in r['checks'] if c not in m0['checks']]
        m0['said'] += [c for c in r['said'] if c not in m0['said']]
    else:
        r['also'] = []; merged[key] = r
lines = list(merged.values())
def q(s): return 'null' if s is None else "'" + str(s).replace("'", "''") + "'"
def num(x): return 'null' if x is None else repr(float(x)).rstrip('0').rstrip('.')
vals = []
for r in lines:
    src_txt = 'spreadsheet line %s' % r['n'] + ''.join(' and line %s' % a for a in r['also']) + ' (%s)' % r['sheet']
    lead = [x for x in r['said'] if x.startswith('Style: ')]
    rest = [x for x in r['said'] if not x.startswith('Style: ')]
    notes = (lead[0] + '. ' if lead else '') + \
            ('Check: ' + '. '.join(r['checks']) + '. ' if r['checks'] else '') + \
            'Count of 12 Nov 2026, ' + src_txt + (''.join('. ' + x[0].upper() + x[1:] for x in rest)) + '.'
    vals.append("  (md5('gidc count 2026-11-12 line %d')::uuid, %s, %s, %s, %s, %d, %s)" %
                (r['n'], q(r['style']), num(r['w']), num(r['h']), q(r['core']), r['qty'], q(notes)))
open(out_sql, 'w').write(open(out_sql + '.head').read() + ',\n'.join(vals) + "\non conflict (id) do update\n   set style = excluded.style, width_in = excluded.width_in, height_in = excluded.height_in,\n       core = excluded.core, qty = excluded.qty, notes = excluded.notes\n where public.door_inventory.updated_by is null;\n\n" +
  "select count(*) as lines, sum(qty) as doors,\n       count(*) filter (where notes like '%Check:%') as to_check\n  from public.door_inventory\n where id in (select md5('gidc count 2026-11-12 line ' || n)::uuid from generate_series(1, 200) n);\n")
rep = {'lines': len(lines), 'doors': sum(r['qty'] for r in lines), 'sheet_doors': sum(r['qty'] for r in rows),
       'merged': [(r['n'], r['also'], r['style']) for r in lines if r['also']],
       'check': [(r['n'], r['orig'], r['style'], r['w'], r['h'], r['core'], r['checks']) for r in lines if r['checks']],
       'renamed': [(r['n'], r['orig'], r['style'], r['said']) for r in lines if r['said']],
       'no_core': [(r['n'], r['style']) for r in lines if not r['core']],
       'no_height': [(r['n'], r['style'], r['w']) for r in lines if r['h'] is None]}
json.dump(rep, open(out_report, 'w'), indent=1)

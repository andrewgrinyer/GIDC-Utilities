"""
GIDC handle check: reads office contract workbooks and says whether the
handle numbers each one sends to Access match the handle picked.

Read only. It never changes a workbook. Run it with the .bat beside it, or:
    py check_handles.py "C:\\path\\to\\folder"
With no folder given it asks for one. Every .xlsx and .xlsm under that folder
(including subfolders) is checked. A report is saved as
handle-check-report.csv in the chosen folder and opened when done.

How Access gets the handle: on the hidden UploadTemplate sheet, rows 4 to 29
hold the handle name typed on the Pricing Sheet (column AB), and rows 37 to
62 hold the numbers Access imports: DoorHandleID (AB), DoorTrimStyleID (AC)
and DoorHandleStyleID (AD). Those numbers come from a lookup of the name in
the Data sheet, columns P to V. The right numbers follow from the name itself
("C - Northbrook Upland" is Northbrook 15, Upland 3, Custom 2), so this
script compares the two.
"""
import csv, os, re, sys, datetime, warnings

warnings.filterwarnings("ignore")
try:
    import openpyxl
except ImportError:
    print("openpyxl is missing. Run:  py -m pip install openpyxl")
    try:
        input("Press Enter to close")
    except EOFError:
        pass
    sys.exit(1)

# "Handle table" counts names whose numbers are wrong, and names with no
# numbers beside them at all (Access gets 0 for those).
# Access numbers (checked against Access's own lookup lists, 24 Nov 2026)
HANDLE = {"latitude": 1, "lattitude": 1, "broadway": 2, "bowery": 3, "hobson": 4, "accent": 5,
          "bell": 6, "georgian": 7, "orbit": 8, "plymouth": 9, "siena": 10, "manhattan": 11,
          "whitney": 12, "alexandria": 13, "northbrook": 15, "andover": 16, "dempsey": 17,
          "eller": 18, "merano": None}   # Merano: no Access number known (workbooks send 0)
TRIM = {"standard": 1, "collins": 2, "upland": 3, "camelot": 4, "alden": 5, "kinsler": 7,
        "rosewood": 8, "century": 9}
NAME = re.compile(r"^\s*([RC])\s*-\s*(\S+)\s+(\S+)\s*$", re.I)


def expected(name):
    """(handle, trim, style) the name should send, or None if it is not a Schlage name."""
    m = NAME.match(str(name or ""))
    if not m:
        return None
    h, t = m.group(2).lower(), m.group(3).lower()
    if h not in HANDLE or t not in TRIM or HANDLE[h] is None:
        return None
    return (HANDLE[h], TRIM[t], 1 if m.group(1).upper() == "R" else 2)


def num(v):
    if v is None or v == "":
        return None
    try:
        return int(float(v))
    except (TypeError, ValueError):
        return v


def check_workbook(path):
    """Returns dict: status, version, customer, table_wrong, table_total, lines (list of dicts)."""
    out = {"file": path, "status": "OK", "version": "", "customer": "", "note": "",
           "table_wrong": 0, "table_empty": 0, "table_total": 0, "lines": []}
    try:
        wb = openpyxl.load_workbook(path, data_only=True, read_only=True)
    except Exception as e:
        out["status"], out["note"] = "COULD NOT OPEN", str(e)[:120]
        return out
    names = wb.sheetnames
    if "UploadTemplate" not in names or "Data" not in names:
        out["status"], out["note"] = "NOT A CONTRACT", "no UploadTemplate or Data sheet"
        wb.close(); return out
    if "Pricing Data" in names:
        for row in wb["Pricing Data"].iter_rows(min_row=1, max_row=1, values_only=True):
            out["version"] = next((str(v) for v in row if v and "version" in str(v).lower()), "")

    # Data sheet lookup table, P to V (columns 16 to 22)
    table = []
    for row in wb["Data"].iter_rows(min_row=1, max_col=22, values_only=True):
        row = list(row) + [None] * (22 - len(row))
        table.append(row[15:22])
    lookup = {}
    for r in table:
        key = str(r[0]).strip().lower() if r[0] is not None else ""
        if key and key not in lookup:            # VLOOKUP takes the first match, any case
            lookup[key] = r
        exp = expected(r[0])
        if exp is not None:
            out["table_total"] += 1
            got = (num(r[2]), num(r[4]), num(r[6]))
            if got in ((None, None, None), (0, 0, 0)):
                out["table_empty"] += 1
            elif got != exp:
                out["table_wrong"] += 1

    up = {}
    for i, row in enumerate(wb["UploadTemplate"].iter_rows(min_row=1, max_row=62, max_col=33, values_only=True), 1):
        up[i] = list(row) + [None] * (33 - len(row))
    out["customer"] = str(up.get(4, [None] * 33)[32] or "")
    wb.close()

    AB, AC, AD = 27, 28, 29                      # zero based columns AB, AC, AD
    for n in range(26):
        name = up[4 + n][AB]
        ids = up[37 + n]
        if name in (None, "", 0, "0") or str(name).strip().upper() == "N/A":
            continue
        opening = up[4 + n][1]
        sent = (num(ids[AB]), num(ids[AC]), num(ids[AD]))
        if sent == (None, None, None):           # never calculated: work it out like Excel would
            r = lookup.get(str(name).strip().lower())
            sent = (num(r[2]), num(r[4]), num(r[6])) if r else (0, 0, 0)
        exp = expected(name)
        if re.search(r"merano", str(name), re.I):
            result = "CHECK BY HAND: Access has no Merano handle number, it got %s" % (sent,)
        elif exp is None:
            result = "CANNOT CHECK (name not a Schlage handle)" if sent != (0, 0, 0) else "OK (no handle numbers)"
        elif sent == exp:
            result = "OK"
        elif sent == (0, 0, 0):
            result = "WRONG: name has no numbers, Access got 0"
        else:
            result = "WRONG"
        out["lines"].append({"opening": opening, "handle": str(name), "sent": sent, "should": exp, "result": result})

    bad = [l for l in out["lines"] if l["result"].startswith("WRONG")]
    if bad:
        out["status"] = "PROBLEM"
    elif out["table_wrong"] or out["table_empty"]:
        out["status"] = "RISK"
        out["note"] = "handles picked are fine, but the Data table is wrong or empty for other handles"
    elif any(l["result"].startswith(("CANNOT", "CHECK")) for l in out["lines"]):
        out["status"] = "CHECK BY HAND"
    return out


def label(ids):
    if ids is None:
        return ""
    hn = {v: k.title() for k, v in HANDLE.items() if k != "lattitude"}
    tn = {v: k.title() for k, v in TRIM.items()}
    h, t, s = ids
    return "%s %s %s (%s, %s, %s)" % ({1: "R", 2: "C"}.get(s, "?"), hn.get(h, "?"), tn.get(t, "?"), h, t, s)


def pause():
    try:
        input("\nPress Enter to close")
    except EOFError:
        pass


def write_report(path, rows):
    with open(path, "w", newline="", encoding="utf-8-sig") as f:
        w = csv.writer(f)
        w.writerow(["Status", "File", "Saved", "Customer", "Workbook version", "Handle table",
                    "Opening", "Handle picked", "Access got", "Should be", "Note"])
        w.writerows(rows)


def main():
    folder = sys.argv[1] if len(sys.argv) > 1 else ""
    if not folder:
        try:
            import tkinter, tkinter.filedialog
            root = tkinter.Tk(); root.withdraw()
            folder = tkinter.filedialog.askdirectory(title="Pick the folder with the contract workbooks")
        except Exception:
            folder = input("Folder with the contract workbooks: ").strip('" ')
    if not folder or not os.path.isdir(folder):
        print("No folder picked."); pause(); return

    files = []
    for d, _, fs in os.walk(folder):
        for f in fs:
            if f.lower().endswith((".xlsx", ".xlsm")) and not f.startswith("~$"):
                files.append(os.path.join(d, f))
    files.sort()
    print("Checking %d workbooks in %s\n" % (len(files), folder))

    report = os.path.join(folder, "handle-check-report.csv")
    counts = {}
    rows = []
    for i, p in enumerate(files, 1):
        r = check_workbook(p)
        counts[r["status"]] = counts.get(r["status"], 0) + 1
        saved = datetime.datetime.fromtimestamp(os.path.getmtime(p)).strftime("%Y-%m-%d")
        rel = os.path.relpath(p, folder)
        if r["status"] in ("PROBLEM", "RISK", "CHECK BY HAND", "COULD NOT OPEN"):
            print("%-14s %s  %s" % (r["status"], rel, r["customer"]))
        base = [r["status"], rel, saved, r["customer"], r["version"],
                "%d of %d names wrong, %d with no numbers" % (r["table_wrong"], r["table_total"], r["table_empty"]) if r["table_total"] else ""]
        bad = [l for l in r["lines"] if not l["result"].startswith("OK")]
        if bad:
            for l in bad:
                print("               opening %s: %s sent %s, should be %s" % (l["opening"], l["handle"], label(l["sent"]), label(l["should"])))
                rows.append(base + [l["opening"], l["handle"], label(l["sent"]), label(l["should"]), l["result"]])
        else:
            rows.append(base + ["", "", "", "", r["note"]])
        if i % 50 == 0:
            print("  ... %d of %d" % (i, len(files)))

    order = {"PROBLEM": 0, "RISK": 1, "CHECK BY HAND": 2, "COULD NOT OPEN": 3, "OK": 4, "NOT A CONTRACT": 5}
    rows.sort(key=lambda x: (order.get(x[0], 9), x[1]))
    try:
        write_report(report, rows)
    except PermissionError:           # report open in Excel, or a read only share
        report = os.path.join(os.path.expanduser("~"), "Desktop", "handle-check-report.csv")
        write_report(report, rows)

    print("\nDone. " + ", ".join("%s %d" % (k, v) for k, v in sorted(counts.items(), key=lambda kv: order.get(kv[0], 9))))
    print("PROBLEM = Access got the wrong handle. RISK = this file's handle table is wrong, the handles picked happen to be fine.")
    print("Report: " + report)
    try:
        os.startfile(report)
    except Exception:
        pass
    pause()


if __name__ == "__main__":
    main()

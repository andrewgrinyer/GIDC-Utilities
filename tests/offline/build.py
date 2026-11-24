#!/usr/bin/env python3
"""Build an offline test copy of the dealer portal: one .html file that opens
straight from a PC with no Supabase and no Cloudflare. OFFLINE TEST ONLY.

  python3 tests/offline/build.py <portal index.html> <label> <out.html>
"""
import json, sys, pathlib
src, label, out = sys.argv[1], sys.argv[2], sys.argv[3]
here = pathlib.Path(__file__).parent
page = pathlib.Path(src).read_text(encoding="utf-8")
samples = json.loads((here / "samples.json").read_text(encoding="utf-8"))
fake = (here / "fake-supabase.js").read_text(encoding="utf-8")
inject = ("<script>window.OFFLINE_LABEL=" + json.dumps(label) + ";window.OFFLINE_SAMPLES=" +
          json.dumps(samples).replace("</", "<\\/") + ";</script>\n<script>" + fake + "</script>\n")
anchor = "<meta charset=\"utf-8\">"
i = page.index(anchor) + len(anchor)
pathlib.Path(out).write_text(page[:i] + "\n" + inject + page[i:], encoding="utf-8")
print("wrote", out)

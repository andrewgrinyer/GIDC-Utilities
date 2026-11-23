#!/usr/bin/env python3
"""TEST ONLY. The checks for measurement-link.sh. Talks to the local test
database only (socket /tmp/pg, port 5499)."""
import json, subprocess, sys

EXP = json.load(open(sys.argv[1]))
fails = 0


def sql(q, who=None, ok=True):
    pre = ""
    if who:
        pre = ("set role authenticated; select set_config('request.jwt.claim.sub', md5('%s')::uuid::text, false);" % who)
    r = subprocess.run(["psql", "-h", "/tmp/pg", "-p", "5499", "-U", "postgres", "-X", "-q", "-t", "-A",
                        "-v", "ON_ERROR_STOP=1", "t", "-c", pre + q] if not pre else
                       ["psql", "-h", "/tmp/pg", "-p", "5499", "-U", "postgres", "-X", "-q", "-t", "-A",
                        "-v", "ON_ERROR_STOP=1", "t"], input=(pre + q) if pre else None,
                       capture_output=True, text=True)
    if ok and r.returncode:
        raise SystemExit("SQL failed: " + q[:200] + "\n" + r.stderr)
    out = [l for l in r.stdout.strip().split("\n") if l.strip()]
    return (out[-1] if out else "") if r.returncode == 0 else ("ERROR " + r.stderr.strip())


def check(name, good, got=""):
    global fails
    print(("PASS " if good else "FAIL ") + name + ("" if good else "  got: " + str(got)[:600]))
    if not good:
        fails += 1


def links():
    rows = sql("select coalesce(json_object_agg(id, json_build_object('e', access_estimate_id, 'flag', access_flag, "
               "'link', access_link, 'status', access_status)), '{}') from jobs")
    return json.loads(rows)


before = sql("select md5(string_agg(j::text, ',' order by id)) from jobs j")

# ---- the preview changes nothing ----------------------------------
pv = json.loads(sql("select gidc_sync_measurement_jobs(false)"))
check("preview says it is a preview", pv.get("preview") is True, pv.keys())
check("preview changed no job", sql("select md5(string_agg(j::text, ',' order by id)) from jobs j") == before)
check("preview made no job", sql("select count(*) from access_jobs_made") == "0")
print("     preview: %d linked, %d flagged, %d made, of %d jobs and %d Access customers" % (
    pv["linked_count"], pv["flagged_count"], pv["made_count"], pv["jobs_total"], pv["access_customers"]))

# ---- the real run --------------------------------------------------
res = json.loads(sql("select gidc_sync_measurement_jobs(true)"))
check("the run did what the preview said", (res["linked_count"], res["flagged_count"], res["made_count"]) ==
      (pv["linked_count"], pv["flagged_count"], pv["made_count"]), res)
L = links()
wrong, missed, falsely = [], [], []
for jid, e in EXP["jobs"].items():
    got = L[jid]["e"]
    if e["want"] is None and got is not None:
        falsely.append((jid, e["why"], got))
    elif e["want"] is not None and got is None:
        missed.append((jid, e["why"], L[jid]["flag"]))
    elif e["want"] is not None and got != e["want"]:
        wrong.append((jid, e["why"], got, e["want"]))
check("no job linked to the wrong Access customer", not wrong, wrong)
check("no job linked that should be left for a person", not falsely, falsely)
check("every job with one clear match was linked", not missed, missed)
flag_kinds = {}
for jid, e in EXP["jobs"].items():
    if e["want"] is None:
        flag_kinds.setdefault(e["why"], set()).add(L[jid]["flag"])
print("     flag reasons by kind: " + json.dumps({k: sorted(v, key=str) for k, v in flag_kinds.items()}))
check("every unlinked old job is flagged with a reason",
      all(L[j]["flag"] for j, e in EXP["jobs"].items() if e["want"] is None))
check("the second job for the same customer says who has it",
      any("already linked to" in (L[j]["flag"] or "") for j, e in EXP["jobs"].items() if e["why"] == "second of two"))
check("linked jobs carry the Access status", all(L[j]["status"] for j, e in EXP["jobs"].items() if e["want"]))

# ---- new customers from 24 November ---------------------------------
made = sql("select json_agg(access_estimate_id order by access_estimate_id) from jobs where access_link = 'new'")
check("the six new Access customers became jobs", json.loads(made) == sorted(EXP["new"]), made)
check("a wholesale customer did not", sql("select count(*) from jobs where access_estimate_id = %d" % EXP["wholesale"]) == "0")
nj = json.loads(sql("select data from jobs where access_link = 'new' order by access_estimate_id limit 1"))
check("a new job gets one email address, not the Access list", all("@" in e and " " not in e and ";" not in e for e in
      json.loads(sql("select json_agg(data->>'email') from jobs where access_link = 'new' and data->>'email' <> ''")) or ["x@y"]))
check("a new job has the shape the app makes", all(k in nj for k in
      ["id", "owner", "created", "updated", "defaults", "sizing", "openings", "materials", "customer", "address",
       "city", "phone", "email", "date", "salesRep", "leadTime", "docType", "status"]) and nj["openings"] == []
      and nj["sizing"] == 2 and len(nj["materials"]) == 3, nj)
reps = sql("select json_agg(owner_name order by access_estimate_id) from jobs where access_link = 'new'")
check("the rep comes over as the app's name for them", json.loads(reps) ==
      ["Nick Matsias", "Michael Sparaco", "Andrew", "", "Nick Matsias", "Michael Sparaco"], reps)

# ---- a second run changes nothing ----------------------------------
again = json.loads(sql("select gidc_sync_measurement_jobs(true)"))
check("the next hour links nothing new and makes nothing twice",
      again["linked_count"] == 0 and again["made_count"] == 0 and again["statuses_changed"] == 0, again)

# ---- status, one way ------------------------------------------------
eid = json.loads(made)[0]
sql("update access_customers set sold_on = '2026-11-30', order_status = 'In Production', order_status_sort = 3 "
    "where estimate_id = %d" % eid)
st = json.loads(sql("select gidc_sync_measurement_jobs(true)"))
check("a status changed in Access moves the job", st["statuses_changed"] == 1 and
      sql("select access_status from jobs where access_estimate_id = %d" % eid) == "In Production", st)
jid = sql("select id from jobs where access_estimate_id = %d" % eid)

# ---- the app's own save leaves the link alone -----------------------
sql("insert into jobs(id, owner_name, customer, openings, data, updated) "
    "select id, owner_name, customer, 3, data || '{\"status\":\"closed\"}', now() from jobs where id = '%s' "
    "on conflict (id) do update set owner_name = excluded.owner_name, customer = excluded.customer, "
    "openings = excluded.openings, data = excluded.data, updated = excluded.updated" % jid, who="sales")
check("a rep saving the job keeps its Access link and status",
      sql("select access_estimate_id || ' ' || access_status from jobs where id = '%s'" % jid) == "%d In Production" % eid)
r = sql("update jobs set access_status = 'Completed' where id = '%s'" % jid, who="sales", ok=False)
check("a rep cannot set the status", r.startswith("ERROR"), r)
r = sql("update jobs set access_status = 'Completed' where id = '%s'" % jid, who="admin", ok=False)
check("nor can an administrator, it comes from Access", r.startswith("ERROR"), r)
r = sql("update jobs set access_estimate_id = null where id = '%s'" % jid, who="sales", ok=False)
check("a rep cannot unlink by writing the column", r.startswith("ERROR"), r)
sql("insert into jobs(id, owner_name, customer, data, access_estimate_id, access_status) "
    "values ('fresh1', 'Nick Matsias', 'Fresh', '{}', 99999, 'Sold')", who="sales")
check("a job made on a phone cannot bring a link with it",
      sql("select coalesce(access_estimate_id::text, 'none') || coalesce(access_status, '') from jobs where id = 'fresh1'") == "none")

# ---- linking by hand ------------------------------------------------
flagged = sql("select id from jobs where access_flag like 'More than one%' order by id limit 1")
for who in ["sales", "user", "installer", "dealer", "dadmin"]:
    r = sql("select gidc_access_suggest('%s')" % flagged, who=who, ok=False)
    check("%s cannot see the Access list" % who, r.startswith("ERROR"), r)
    r = sql("select gidc_access_search('smith')", who=who, ok=False)
    check("%s cannot search it" % who, r.startswith("ERROR"), r)
    r = sql("select gidc_link_job_access('%s', 1, false, false)" % flagged, who=who, ok=False)
    check("%s cannot link" % who, r.startswith("ERROR"), r)
r = sql("select count(*) from access_customers", who="sales", ok=False)
check("the table itself is closed to a rep", r.startswith("ERROR"), r)
sug = json.loads(sql("select gidc_access_suggest('%s')" % flagged, who="admin"))
check("an administrator gets suggestions, the two Access copies first",
      len(sug) >= 2 and sug[0]["score"] >= 70 and sug[1]["score"] >= 70, sug[:3])
cust = sql("select customer from jobs where id = '%s'" % flagged)
found = json.loads(sql("select gidc_access_search(%s)" % ("'" + cust.split()[-1].replace("'", "''") + "'"), who="admin"))
check("search by surname finds them", any(f["estimate_id"] == sug[0]["estimate_id"] for f in found), len(found))
ph = sql("select k_phones[1] from access_customers where estimate_id = %d" % sug[0]["estimate_id"])
found = json.loads(sql("select gidc_access_search('(%s) %s-%s')" % (ph[:3], ph[3:6], ph[6:]), who="admin"))
check("search by a phone typed with punctuation finds them", any(f["estimate_id"] == sug[0]["estimate_id"] for f in found))
num = sql("select order_no from access_customers where order_no is not null order by estimate_id limit 1")
found = json.loads(sql("select gidc_access_search('%s')" % num, who="admin"))
check("search by the Access job number finds it", found and found[0]["order_no"] == num, found[:1])
ok = json.loads(sql("select gidc_link_job_access('%s', %d, false, false)" % (flagged, sug[0]["estimate_id"]), who="admin"))
check("an administrator links it", ok["linked"] and sql(
    "select access_link || ' ' || coalesce(access_flag, 'no flag') || ' ' || access_linked_by from jobs where id = '%s'" % flagged)
      == "manual no flag admin", ok)
other = sql("select id from jobs where access_flag like 'No customer in Access%' order by id limit 1")
r = sql("select gidc_link_job_access('%s', %d, false, false)" % (other, sug[0]["estimate_id"]), who="admin", ok=False)
check("linking a customer another job has says so", "already linked to" in r, r)
sql("select gidc_link_job_access('%s', %d, false, true)" % (other, sug[0]["estimate_id"]), who="admin")
check("moving it takes it off the first job and flags that one", sql(
    "select (select access_estimate_id from jobs where id = '%s') = %d and (select access_flag from jobs where id = '%s') like '%%moved%%'"
    % (other, sug[0]["estimate_id"], flagged)) == "t")
test = sql("select id from jobs where customer = 'asdf'")
sql("select gidc_link_job_access('%s', null, true)" % test, who="admin")
check("Not in Access clears the flag for good", sql(
    "select access_link || coalesce(access_flag, '') from jobs where id = '%s'" % test) == "none")
sql("select gidc_sync_measurement_jobs(true)")
check("and the sync leaves it alone after", sql("select access_link || coalesce(access_flag, '') from jobs where id = '%s'" % test) == "none")
check("a manual link survives the next sync", sql("select access_link from jobs where id = '%s'" % other) == "manual")

# ---- a deleted Access job is not made again ------------------------
sql("delete from jobs where access_link = 'new' and access_estimate_id = %d" % json.loads(made)[1])
again = json.loads(sql("select gidc_sync_measurement_jobs(true)"))
check("a new job somebody deleted is not made again", again["made_count"] == 0, again)

if fails:
    print("%d FAILED" % fails)
    sys.exit(1)
print("ALL PASSED")

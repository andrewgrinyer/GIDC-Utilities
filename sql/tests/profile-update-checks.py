#!/usr/bin/env python3
"""TEST ONLY. Checks sql/customer-profile-update.sql on the database that
measurement-link.sh leaves behind (socket /tmp/pg, port 5499, database t).
Run by measurement-link.sh after its own checks."""
import json, subprocess, sys

fails = 0


def sql(q, who=None, ok=True):
    pre = ("set role authenticated; select set_config('request.jwt.claim.sub', md5('%s')::uuid::text, false);" % who) if who else ""
    r = subprocess.run(["psql", "-h", "/tmp/pg", "-p", "5499", "-U", "postgres", "-X", "-q", "-t", "-A",
                        "-v", "ON_ERROR_STOP=1", "t"], input=pre + q, capture_output=True, text=True)
    if ok and r.returncode:
        raise SystemExit("SQL failed: " + q[:200] + "\n" + r.stderr)
    out = [l for l in r.stdout.strip().split("\n") if l.strip()]
    return (out[-1] if out else "") if r.returncode == 0 else ("ERROR " + r.stderr.strip())


def check(name, good, got=""):
    global fails
    print(("PASS " if good else "FAIL ") + name + ("" if good else "  got: " + str(got)[:600]))
    if not good:
        fails += 1


def save(job, who, **kv):
    # the way the app saves: an upsert of the whole row, data replaced
    data = json.loads(sql("select data from jobs where id = '%s'" % job))
    data.update(kv)
    d = json.dumps(data).replace("'", "''")
    return sql("insert into jobs(id, owner_name, customer, data, updated) values ('%s', 'x', '%s', '%s'::jsonb, now()) "
               "on conflict (id) do update set customer = excluded.customer, data = excluded.data, updated = excluded.updated"
               % (job, data.get("customer", "").replace("'", "''"), d), who=who, ok=False)


def pending():
    return json.loads(sql("select coalesce(jsonb_agg(to_jsonb(u) order by id), '[]') from customer_profile_updates u where sent_at is null"))


sql("delete from customer_profile_updates")
linked = sql("select id from jobs where access_estimate_id is not null order by id limit 1")
loose = sql("select id from jobs where access_estimate_id is null order by id limit 1")
old = json.loads(sql("select data from jobs where id = '%s'" % linked))

r = save(linked, "sales", phone="519 555 0000")
check("a rep can still save a linked job", not r.startswith("ERROR"), r)
check("a phone change sends nothing", pending() == [], pending())

save(linked, "sales", customer=old["customer"] + " Jr")
p = pending()
check("a name change on a linked job is recorded once", len(p) == 1 and p[0]["new_customer"] == old["customer"] + " Jr"
      and p[0]["old_customer"] == old["customer"] and p[0]["changed_by"] == "Nick Matsias", p)
save(linked, "sales", address="77 New Rd")
p = pending()
check("then an address change folds into the same email", len(p) == 1 and p[0]["new_address"] == "77 New Rd"
      and p[0]["old_address"] == (old.get("address") or "") and p[0]["new_customer"] == old["customer"] + " Jr", p)
save(linked, "sales", customer=old["customer"], address=old.get("address") or "")
check("put back the way it was, nothing is sent", pending() == [], pending())

save(loose, "sales", customer="Somebody Else")
check("a job not linked to Access sends nothing", pending() == [], pending())

sql("update jobs set data = jsonb_set(data, '{city}', '\"Elsewhere\"') where id = '%s'" % linked)
check("the hourly sync (no one signed in) sends nothing", pending() == [], pending())

save(linked, "sales", city="Kitchener")
r = sql("select gidc_claim_profile_updates()", who="sales", ok=False)
check("a rep cannot take the list", r.startswith("ERROR"), r)
r = sql("select count(*) from customer_profile_updates", who="sales", ok=False)
check("nor read the table", r.startswith("ERROR"), r)
got = json.loads(sql("set role service_role; select gidc_claim_profile_updates()"))
check("the edge function gets it with the Access numbers", len(got) == 1 and got[0]["estimate_id"] and
      got[0]["old_city"] == "Elsewhere" and got[0]["new_city"] == "Kitchener", got)
again = json.loads(sql("set role service_role; select gidc_claim_profile_updates()"))
check("a claimed one is not sent twice", again == [], again)
save(linked, "sales", city="Waterloo")
check("a change while one is sending starts a new email", len(pending()) == 2, pending())
sql("set role service_role; select gidc_profile_update_done(%d, false, 'resend said no')" % got[0]["id"])
retry = json.loads(sql("set role service_role; select gidc_claim_profile_updates()"))
check("a failed send is tried again", sorted(x["id"] for x in retry) == sorted(x["id"] for x in pending()), retry)
for x in retry:
    sql("set role service_role; select gidc_profile_update_done(%d, true)" % x["id"])
check("once sent, nothing is waiting", pending() == [], pending())

print("ALL PASSED" if not fails else "%d FAILED" % fails)
sys.exit(1 if fails else 0)

#!/usr/bin/env python3
"""TEST ONLY. Makes a realistic stand in for the Access customer list and
the measurement app's jobs, with the answer each job should get.

    python3 make-measurement-data.py OUT.sql OUT-expected.json

Fixed seed, so the same data every time. The shapes are the ones seen in
the real data and in how reps type: a surname alone, a unit written three
ways, phones with and without punctuation, repeat customers with an older
estimate, two estimates typed in Access for one visit, a customer the
office has not typed in yet, test jobs, and the same customer measured
twice in the app.
"""
import json, random, sys
from datetime import date, timedelta

R = random.Random(2311)
FIRST = "James Mary John Patricia Robert Jennifer Michael Linda David Elizabeth William Barbara Richard Susan Joseph Jessica Thomas Sarah Daniel Karen Paul Nancy Mark Lisa Raj Priya Wei Mei Ahmed Fatima Jose Maria Luc Chantal Sean Siobhan Tyler Ashley Kyle Megan".split()
LAST = ("Smith Brown Tremblay Martin Roy Wilson MacDonald Gagnon Johnson Taylor Campbell Anderson Leblanc Lee White Thompson "
        "Patel Singh Nguyen Wong Chen Kowalski Novak DeSousa Ferreira Rossi Bianchi Muller Schmidt Bauer Van-Dyk O'Brien "
        "Murphy Kelly Walsh Byrne Ryan Grant Fraser Stewart Reid Clarke Hughes Morrison Sparks Cortes Aris Disanti Abraham").split()
# real surnames hardly repeat: about 700 here, so two people sharing a
# whole name is as rare as it is in Access, and done on purpose below
LAST = LAST + [b + x for b in LAST for x in ["son", "ford", "ley", "ton", "berg", "wood", "field", "er", "s", "e", "ini", "ova", "ek"]]
STREETS = "King Queen Main Water Dundas Hespeler Franklin Elgin Concession Victoria Weber Fischer-Hallman Erb Ottawa Highland Pioneer Doon Blair Coronation Myers".split()
KINDS = ["St", "Street", "Rd", "Road", "Ave", "Dr", "Cres", "Blvd"]
CITIES = ["Cambridge", "Kitchener", "Waterloo", "Guelph", "Elmira", "Ayr", "Paris", "Brantford"]
EST = [(1, "Initial Visit Booked", 1), (2, "Quote Sent", 2), (3, "Follow Up", 3), (4, "Showroom Booked", 4),
       (5, "Sold", 5), (6, "Not Sold", 6)]
ORD = [(1, "Order Entered", 1), (2, "Doors Ordered", 2), (3, "In Production", 3), (4, "Ready To Install", 4),
       (5, "Install Booked", 5), (6, "Installed", 6), (7, "Completed", 7)]
REPS = ["Nick", "Michael", "Andrew", None]
TODAY = date(2026, 11, 23)


def phone():
    return "519%07d" % R.randint(2000000, 9999999)


def fmt_phone(p, how):
    return [p, "(%s) %s-%s" % (p[:3], p[3:6], p[6:]), "%s %s %s" % (p[:3], p[3:6], p[6:]),
            "%s.%s.%s" % (p[:3], p[3:6], p[6:]), "+1 %s-%s-%s" % (p[:3], p[3:6], p[6:]), p[3:6] + "-" + p[6:]][how]


access, jobs, expect = [], [], {}
eid = 8000


def add_customer(first, last, addr, city, ph, email, created, sold=False, stage=None):
    global eid
    eid += 1
    est = R.choice(EST[:4]) if not sold else EST[4]
    if stage == "notsold":
        est = EST[5]
    # Access keeps PhoneNumbers and EmailAddresses as lists in one field
    # (TRY, 23 Nov), and only a sold estimate has an order and a job number
    if ph and R.random() < .45:
        ph = R.choice(["%s cell, %s home", "%s / %s", "Home %s Work %s", "%s; %s"]) % (
            fmt_phone(ph, R.randint(0, 4)), fmt_phone(phone(), R.randint(0, 4)))
    elif ph:
        ph = fmt_phone(ph, R.randint(0, 4))
    if email and R.random() < .25:
        email = email + R.choice(["; ", ", ", " "]) + "other%d@example.com" % R.randint(1, 999)
    row = dict(estimate_id=eid, order_id=(eid + 2) if sold else None, order_no=str(eid - 2) if sold else None,
               first_name=first, last_name=last,
               address=addr, city=city, phone=ph, phone2=None, email=email, rep=R.choice(REPS),
               created_on=created.isoformat(), measure_on=(created + timedelta(days=R.randint(2, 12))).isoformat(),
               sold_on=None, completed_on=None, estimate_status_id=est[0], estimate_status=est[1],
               estimate_status_sort=est[2], order_status_id=None, order_status=None, order_status_sort=None,
               sale_type_id=R.choice([1, 2, 2, 2, 3]))
    if sold:
        o = R.choice(ORD)
        row.update(sold_on=(created + timedelta(days=R.randint(10, 30))).isoformat(), order_status_id=o[0],
                   order_status=o[1], order_status_sort=o[2])
        if o[0] == 7:
            row["completed_on"] = (created + timedelta(days=80)).isoformat()
    access.append(row)
    return row


def person():
    f, l = R.choice(FIRST), R.choice(LAST)
    num = R.randint(1, 980)
    st = R.choice(STREETS)
    return dict(first=f, last=l, num=num, street=st, kind=R.choice(KINDS), city=R.choice(CITIES), phone=phone(),
                email=("%s.%s%d@example.ca" % (f, l, R.randint(1, 99))).lower().replace("'", ""))


# three years of Access customers nobody measured in the app
d = date(2023, 11, 1)
while d <= TODAY:
    for _ in range(R.choice([1, 2, 2, 3])):
        p = person()
        add_customer(p["first"], p["last"], "%d %s %s" % (p["num"], p["street"], p["kind"]), p["city"], p["phone"],
                     p["email"] if R.random() < .7 else None, d, sold=d < TODAY - timedelta(days=40) and R.random() < .45)
    d += timedelta(days=1)

jid = 0


def job(customer, addr, city, ph, email, day, want, why=""):
    global jid
    jid += 1
    i = "job%03d" % jid
    data = dict(id=i, owner="Nick Matsias", customer=customer, address=addr, city=city, phone=ph, email=email,
                date=day.isoformat(), created=int((day - date(1970, 1, 1)).total_seconds() * 1000) + 15 * 3600 * 1000,
                openings=[], status=R.choice(["active", "downloaded", "closed"]))
    jobs.append(dict(id=i, owner_name="Nick Matsias", customer=customer, openings=R.randint(0, 9), data=data,
                     updated=(day + timedelta(days=R.randint(0, 5))).isoformat() + "T15:00:00Z"))
    expect[i] = dict(want=want, why=why, customer=customer)
    return i


# app jobs from mid September to today
start = date(2026, 9, 15)
for k in range(170):
    day = start + timedelta(days=R.randint(0, (TODAY - start).days))
    p = person()
    booked = day - timedelta(days=R.randint(2, 20))
    addr_a = "%d %s %s" % (p["num"], p["street"], p["kind"])
    kind = R.random()
    if kind < .15:          # the whole name and nothing else, which is what reps often type (Andrew's send, 23 Nov)
        c = add_customer(p["first"], p["last"], addr_a, p["city"], p["phone"], p["email"], booked)
        job(p["first"] + " " + p["last"], "", "", "", "", day, c["estimate_id"], "full name only")
    elif kind < .50:        # typed the way the office did, phone punctuated differently
        c = add_customer(p["first"], p["last"], addr_a, p["city"], p["phone"], p["email"], booked, sold=R.random() < .4)
        job(p["first"] + " " + p["last"], addr_a.replace("Street", "St"), p["city"], fmt_phone(p["phone"], R.randint(1, 4)),
            p["email"] if R.random() < .6 else "", day, c["estimate_id"], "plain")
    elif kind < .60:        # surname only, unit written differently
        unit = R.randint(1, 40)
        c = add_customer(p["first"], p["last"], "%s Unit %d" % (addr_a, unit), p["city"], p["phone"], None, booked)
        job(p["last"], "Unit %d - %s" % (unit, addr_a), p["city"], "", "", day, c["estimate_id"], "unit")
    elif kind < .68:        # first name only, but the phone and address are right
        c = add_customer(p["first"], p["last"], addr_a, p["city"], p["phone"], p["email"], booked)
        job(p["first"], addr_a, p["city"], fmt_phone(p["phone"], 2), "", day, c["estimate_id"], "first name + phone + address")
    elif kind < .74:        # repeat customer: an estimate from 2024 too
        add_customer(p["first"], p["last"], addr_a, p["city"], p["phone"], p["email"], date(2024, R.randint(1, 12), 10), sold=True)
        c = add_customer(p["first"], p["last"], addr_a, p["city"], p["phone"], p["email"], booked)
        job(p["first"] + " " + p["last"], addr_a, p["city"], p["phone"], "", day, c["estimate_id"], "repeat, newest")
    elif kind < .78:        # typed twice in Access the same week: a person decides
        add_customer(p["first"], p["last"], addr_a, p["city"], p["phone"], None, booked)
        add_customer(p["first"], p["last"], addr_a, p["city"], p["phone"], None, booked + timedelta(days=2))
        job(p["first"] + " " + p["last"], addr_a, p["city"], p["phone"], "", day, None, "several")
    elif kind < .83:        # the office has not typed them in at all
        job(p["first"] + " " + p["last"], addr_a, p["city"], p["phone"], "", day, None, "not in access")
    elif kind < .87:        # only an old estimate from 2024, nothing current
        add_customer(p["first"], p["last"], addr_a, p["city"], p["phone"], None, date(2024, 3, 3), sold=True)
        job(p["first"] + " " + p["last"], addr_a, p["city"], p["phone"], "", day, None, "only old")
    elif kind < .92:        # name and street number only, street spelled the same
        c = add_customer(p["first"], p["last"], addr_a, p["city"], p["phone"], None, booked)
        job(p["first"] + " " + p["last"], "%d %s" % (p["num"], p["street"]), "", "", "", day, c["estimate_id"], "name + address")
    elif kind < .96:        # same surname, same street, a neighbour's number: must not link to the neighbour
        add_customer(R.choice(FIRST), p["last"], "%d %s %s" % (p["num"] + 2, p["street"], p["kind"]), p["city"], phone(), None, booked)
        job(p["first"] + " " + p["last"], addr_a, p["city"], "", "", day, None, "neighbour only")
    elif kind < .975:       # two people with the same whole name in Access, the job has only the name: a person decides
        add_customer(p["first"], p["last"], addr_a, p["city"], p["phone"], None, booked)
        add_customer(p["first"], p["last"], "%d %s" % (p["num"] + 40, R.choice(STREETS)), R.choice(CITIES), phone(), None,
                     booked - timedelta(days=40))
        job(p["first"] + " " + p["last"], "", "", "", "", day, None, "namesake")
    else:                   # email only, nothing else typed
        c = add_customer(p["first"], p["last"], addr_a, p["city"], p["phone"], p["email"], booked)
        job(p["first"], "", "", "", p["email"], day, None, "email alone is not enough")

# test jobs and blanks
for name in ["Test", "test job", "asdf", ""]:
    job(name, "", "", "", "", TODAY - timedelta(days=R.randint(1, 40)), None, "test")

# the same customer measured twice in the app: the first gets it
p = person()
c = add_customer(p["first"], p["last"], "%d %s St" % (p["num"], p["street"]), p["city"], p["phone"], None, TODAY - timedelta(days=20))
job(p["first"] + " " + p["last"], "%d %s St" % (p["num"], p["street"]), p["city"], p["phone"], "", TODAY - timedelta(days=15), c["estimate_id"], "first of two")
job(p["first"] + " " + p["last"], "%d %s St" % (p["num"], p["street"]), p["city"], p["phone"], "", TODAY - timedelta(days=5), None, "second of two")

# tomorrow and after: new customers that should become jobs
new = []
for k in range(6):
    p = person()
    c = add_customer(p["first"], p["last"], "%d %s %s" % (p["num"], p["street"], p["kind"]), p["city"], p["phone"], p["email"],
                     date(2026, 11, 24) + timedelta(days=k // 2))
    c["rep"] = ["Nick", "Michael", "Andrew", None, "Nick", "Michael"][k]
    c["estimate_status_id"], c["estimate_status"], c["estimate_status_sort"] = EST[0]
    new.append(c["estimate_id"])
# a wholesale one on the same day never becomes a job
w = add_customer("Wholesale", "Builder", "1 Industrial Rd", "Cambridge", phone(), None, date(2026, 11, 24))
w["sale_type_id"] = 4
w["estimate_status_id"], w["estimate_status"], w["estimate_status_sort"] = EST[0]
w["measure_on"] = "2026-11-26"
# Initial Visit Booked but the visit was yesterday, and Showroom Booked next week: neither is made
y = add_customer("Yesterday", "Visit", "5 Past Rd", "Ayr", phone(), None, date(2026, 11, 10))
y["estimate_status_id"], y["estimate_status"], y["estimate_status_sort"] = EST[0]
y["measure_on"] = "2026-11-22"
sb = add_customer("Showroom", "Later", "6 Later Rd", "Ayr", phone(), None, date(2026, 11, 20))
sb["estimate_status_id"], sb["estimate_status"], sb["estimate_status_sort"] = EST[3]
sb["measure_on"] = "2026-11-30"
# booked today for a visit next week, created before the 24th: made (Andrew's rule is the status and the visit date)
nb = add_customer("Booked", "Today", "7 Soon Rd", "Ayr", phone(), None, date(2026, 11, 23))
nb["estimate_status_id"], nb["estimate_status"], nb["estimate_status_sort"] = EST[0]
nb["measure_on"] = "2026-11-28"
new.append(nb["estimate_id"])


def q(v):
    if v is None:
        return "null"
    if isinstance(v, (int, float)):
        return str(v)
    return "'" + str(v).replace("'", "''") + "'"


cols = list(access[0].keys())
with open(sys.argv[1], "w") as f:
    f.write("-- TEST ONLY. Made by make-measurement-data.py.\n")
    for i in range(0, len(access), 500):
        f.write("insert into public.access_customers(%s) values\n" % ",".join(cols))
        f.write(",\n".join("(" + ",".join(q(r[c]) for c in cols) + ")" for r in access[i:i + 500]) + ";\n")
    for j in jobs:
        f.write("insert into public.jobs(id,owner_name,customer,openings,data,updated) values (%s,%s,%s,%d,%s::jsonb,%s);\n" % (
            q(j["id"]), q(j["owner_name"]), q(j["customer"]), j["openings"], q(json.dumps(j["data"])), q(j["updated"])))
json.dump(dict(jobs=expect, new=new, wholesale=w["estimate_id"], not_made=[y["estimate_id"], sb["estimate_id"]], access=len(access)), open(sys.argv[2], "w"), indent=1)
print("access customers %d, jobs %d" % (len(access), len(jobs)))

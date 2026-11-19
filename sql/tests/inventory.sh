#!/bin/bash
# Tests sql/door-inventory.sql against a local stand in. Needs the same
# throwaway local Postgres as run.sh (socket /tmp/pg, port 5499). Never
# points at Supabase. Runs the file twice, then checks who sees what.
#
#   inventory.sh          the live shape, no login files run
#   inventory.sh after    after the three login files
P="psql -h /tmp/pg -p 5499 -U postgres -X -q -v ON_ERROR_STOP=1"
D="$(dirname "$0")"
$P -c "drop database if exists t" -c "create database t" postgres
sed 's/NOTNULL_HERE//' "$D"/mock-live-shape.sql | $P t >/dev/null || exit 1
$P t -c "do \$\$ begin create role service_role nologin; exception when duplicate_object then null; end \$\$" >/dev/null
files="door-inventory.sql door-inventory.sql"
[ "$1" = after ] && files="door-inventory.sql security-tighten.sql two-sided-access.sql email-verification.sql door-inventory.sql"
for f in $files; do
  echo "== $f"; $P t -f "$D"/../$f >/dev/null 2>/tmp/gidc-sql-err || { echo FAIL; cat /tmp/gidc-sql-err; exit 1; }
done
$P t -c "insert into auth.users(id,email) values (md5('stranger')::uuid,'stranger@x.ca')"
$P t -f "$D"/inventory-checks.sql 2>&1

#!/bin/bash
# Tests sql/dealer-order-number.sql against a local stand in. Needs the
# same throwaway local Postgres as run.sh (socket /tmp/pg, port 5499).
# Never points at Supabase. Runs the file twice, then checks who may set
# the number and what the sync steps do.
#
#   order-number.sh          the live shape, no login files run (today)
#   order-number.sh after    after security-tighten and two-sided-access
P="psql -h /tmp/pg -p 5499 -U postgres -X -q -v ON_ERROR_STOP=1"
D="$(dirname "$0")"
$P -c "drop database if exists t" -c "create database t" postgres
sed 's/NOTNULL_HERE//' "$D"/mock-live-shape.sql | $P t >/dev/null || exit 1
$P t -f "$D"/mock-dealer-sync.sql >/dev/null || exit 1
files="dealer-order-number.sql dealer-order-number.sql"
[ "$1" = after ] && files="security-tighten.sql two-sided-access.sql $files"
for f in $files; do
  echo "== $f"; $P t -f "$D"/../$f >/dev/null 2>/tmp/gidc-sql-err || { echo FAIL; cat /tmp/gidc-sql-err; exit 1; }
done
$P t -f "$D"/order-number-checks.sql

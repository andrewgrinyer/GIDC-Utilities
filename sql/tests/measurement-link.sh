#!/bin/bash
# Tests sql/measurement-access-link.sql against a local stand in, with a
# realistic Access list and set of jobs (make-measurement-data.py). Needs
# the throwaway local Postgres run.sh uses (socket /tmp/pg, port 5499).
# Never points at Supabase.
#
#   measurement-link.sh          the live shape, no login files (today)
#   measurement-link.sh after    after security-tighten and two-sided-access
P="psql -h /tmp/pg -p 5499 -U postgres -X -q -v ON_ERROR_STOP=1"
D="$(cd "$(dirname "$0")" && pwd)"
T="${TMPDIR:-/tmp}/gidc-measurement-test"; mkdir -p "$T"
$P -c "drop database if exists t" -c "create database t" postgres >/dev/null
sed 's/NOTNULL_HERE//' "$D"/mock-live-shape.sql | $P t >/dev/null || exit 1
$P t -f "$D"/mock-measurement-jobs.sql >/dev/null || exit 1
files="measurement-access-link.sql measurement-access-link.sql"
[ "$1" = after ] && files="security-tighten.sql two-sided-access.sql $files"
for f in $files; do
  echo "== $f"; $P t -f "$D"/../$f >/dev/null 2>"$T"/err || { echo FAIL; cat "$T"/err; exit 1; }
done
python3 "$D"/make-measurement-data.py "$T"/data.sql "$T"/expected.json || exit 1
$P t -f "$T"/data.sql >/dev/null || exit 1
python3 -I "$D"/measurement-link-checks.py "$T"/expected.json

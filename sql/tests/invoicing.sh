#!/bin/bash
# Tests sql/dealer-invoicing.sql against a local stand in. Needs the same
# throwaway local Postgres as run.sh (socket /tmp/pg, port 5499). Never
# points at Supabase. Runs the file twice, then checks who may read and
# write the invoices and that an order cannot be invoiced twice.
#
#   invoicing.sh          the live shape, no login files run (today)
#   invoicing.sh after    after security-tighten and two-sided-access
P="psql -h /tmp/pg -p 5499 -U postgres -X -q -v ON_ERROR_STOP=1"
D="$(dirname "$0")"
$P -c "drop database if exists t" -c "create database t" postgres
sed 's/NOTNULL_HERE//' "$D"/mock-live-shape.sql | $P t >/dev/null || exit 1
$P t -f "$D"/mock-dealer-sync.sql >/dev/null || exit 1
$P t -c "create table public.pallets(id uuid primary key default gen_random_uuid(), dealer_id uuid, name text unique, max_rows int, closed_at timestamptz, built_on date default current_date);
  alter table pallets enable row level security;
  create policy pallets_admin on pallets for all to authenticated using (is_admin()) with check (is_admin());
  grant select,insert,update,delete on pallets to authenticated;
  insert into pallets(id,dealer_id,name) select md5('p1')::uuid, id, 'SFD 1' from dealers where slug='SOUTHFLORIDA';" >/dev/null || exit 1
files="dealer-invoicing.sql dealer-invoicing.sql"
[ "$1" = after ] && files="security-tighten.sql two-sided-access.sql $files"
for f in $files; do
  echo "== $f"; $P t -f "$D"/../$f >/dev/null 2>/tmp/gidc-sql-err || { echo FAIL; cat /tmp/gidc-sql-err; exit 1; }
done
$P t -f "$D"/invoicing-checks.sql

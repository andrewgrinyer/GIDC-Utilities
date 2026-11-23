#!/bin/bash
# Tests sql/fixes/undo-split-benech*.sql on a throwaway local copy shaped
# like SFD Benech: sixteen lines typed by hand (no saved door numbers),
# split by gidc_split_order with doors 4, 12, 13 and 14 moved. Then the
# preview, the undo twice, and a check that the order is exactly as it
# was before the split. Needs the local Postgres run.sh uses. Never
# points at Supabase.
P="psql -h /tmp/pg -p 5499 -U postgres -X -q -v ON_ERROR_STOP=1"
D="$(dirname "$0")"
$P -c "drop database if exists t" -c "create database t" postgres
sed 's/NOTNULL_HERE//' "$D"/mock-live-shape.sql | $P t >/dev/null || exit 1
$P t -f "$D"/mock-dealer-sync.sql >/dev/null || exit 1
$P t -f "$D"/mock-split-shape.sql >/dev/null || exit 1
for f in dealer-order-number.sql dealer-invoicing.sql dealer-split-order.sql; do
  $P t -f "$D"/../$f >/dev/null 2>/tmp/gidc-sql-err || { echo FAIL $f; cat /tmp/gidc-sql-err; exit 1; }
done
$P t <<'SQL' >/dev/null
insert into dealer_orders(id, dealer_id, order_ref, customer_name, status, access_order_id, access_order_no, door_count, panel_count, form)
select md5('benech')::uuid, d.id, 'SFD BENECH 41', 'SFDB', 'in_production', 4275, '4273', 18, 20,
  jsonb_build_object('rows', (select jsonb_agg(jsonb_build_object(
     'id', 'mh' || lpad(to_hex(1000000 + n * 37), 6, '0') || 'x' || n,
     'opening', '', 'location', (array['Front entry','Hall closet','Powder','Bedroom 1','Bedroom 1 closet','Bedroom 2','Bedroom 2 closet',
        'Bedroom 3','Bedroom 3 closet','Main bath','Linen','Laundry','Pantry','Basement','Furnace','Office'])[n],
     'doorType', (array['Single Swing','Bifold','Single Swing','Single Swing','Bypass','Single Swing','Bifold','Single Swing','Bifold',
        'Single Swing','Single Swing','Double Swing AST','Bifold','Single Swing','Double Swing Dummy','Single Swing'])[n],
     'qty', case when n in (5,12,15) then 2 else 1 end,
     'width', (array[32,48,24,30,60,30,36,30,48,28,18,30,24,32,24,30])[n], 'height', 80) order by n)
   from generate_series(1,16) n), 'custom', '{}'::jsonb)
  from dealers d where d.slug = 'SOUTHFLORIDA';
create table before as select form from dealer_orders where id = md5('benech')::uuid;
grant select on before to authenticated;
SQL
echo "-- the split, as the portal did it: doors 4, 12, 13, 14"
$P t -c "select set_config('request.jwt.claim.sub', md5('admin')::text, false)" -c "set role authenticated" \
  -c "select gidc_split_order(md5('benech')::uuid, (select array_agg(r->>'id') from before, jsonb_array_elements(form->'rows') with ordinality t(r,n) where n in (4,12,13,14)), '{\"door_count\":13,\"panel_count\":15}', '{\"door_count\":5,\"panel_count\":5}')->>'order_ref'" | tail -3
# 2.21 as it ran live did not save the door numbers before moving lines; the
# split in this repo now does, so take them back off to match Benech as it is
$P t -c "update dealer_orders set form = jsonb_set(form, '{rows}', (select jsonb_agg(r || '{\"opening\":\"\"}' order by n) from jsonb_array_elements(form->'rows') with ordinality t(r,n))) where order_ref ~* 'benech'" >/dev/null
$P t -c "select order_ref, jsonb_array_length(form->'rows') lines, door_count from dealer_orders where order_ref ~* 'benech' order by order_ref"
echo "-- locking every door number is refused while Benech is still split"
$P t -c "insert into dealer_orders(dealer_id, order_ref, status, form) select id, 'SFD MIXED 3', 'under_review',
  '{\"rows\":[{\"id\":\"m1\",\"opening\":\"\"},{\"id\":\"m2\",\"opening\":\"1\"},{\"id\":\"m3\"},{\"id\":\"m4\",\"opening\":\"7\"}]}' from dealers where slug='SOUTHFLORIDA'" \
  -c "insert into dealer_orders(dealer_id, order_ref, status, form) select id, 'SFD NUMBERED 9', 'shipped',
  '{\"rows\":[{\"id\":\"n1\",\"opening\":\"3\"},{\"id\":\"n2\",\"opening\":\"5\"}]}' from dealers where slug='SOUTHFLORIDA'" >/dev/null
$P t -f "$D"/../lock-door-numbers.sql 2>&1 | grep -i "error\|notice"
echo "-- step 1, preview"
$P t -f "$D"/../fixes/undo-split-benech-preview.sql
echo "-- step 2, the undo, twice"
$P t -f "$D"/../fixes/undo-split-benech.sql 2>&1
$P t -f "$D"/../fixes/undo-split-benech.sql 2>&1
echo "-- the rows are exactly as before the split"
$P t -c "select (select form->'rows' from dealer_orders where id = md5('benech')::uuid) = (select form->'rows' from before) as identical"
echo "-- then every door number is locked: preview, run, run again"
$P t -f "$D"/../lock-door-numbers-preview.sql
$P t -f "$D"/../lock-door-numbers.sql 2>&1
$P t -f "$D"/../lock-door-numbers.sql 2>&1 | grep -i notice
$P t -c "select order_ref, form->>'lastDoorNo' as last_no, (select string_agg(r->>'opening', ',') from jsonb_array_elements(form->'rows') r) as door_numbers from dealer_orders where form ? 'rows' order by order_ref"
echo "-- Benech's rows are still the original rows, each now carrying its number"
$P t -c "select (select jsonb_agg(r - 'opening') from dealer_orders, jsonb_array_elements(form->'rows') r where id = md5('benech')::uuid) = (select jsonb_agg(r - 'opening') from before, jsonb_array_elements(form->'rows') r) as same_doors"

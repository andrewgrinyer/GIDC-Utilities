-- TEST ONLY. Run by split-order.sh against the throwaway database.
\set ON_ERROR_STOP 0
\pset null '·'
-- Cortes, linked to Access job 4273 (id 4275), four openings as the portal saves them
update dealer_orders set status = 'in_production', door_count = 6, panel_count = 6, paint_colour = 'Pearly',
  customer_addr = '88 Ocean Dr', customer_city = 'Miami', submitted_at = now() - interval '9 days',
  emailed_at = now() - interval '9 days',
  files = '[{"kind":"proliner","name":"cortes.xml","path":"x/cortes.xml"},{"kind":"orderform","name":"SFD - Cortes.xlsx","path":"x/f.xlsx"}]',
  form = '{"rows":[
   {"id":"r1","opening":"1","location":"Hall closet","doorType":"Double Bifold","style":"4 Panel True Shaker","width":"48","height":"80","paintColour":"Pearly"},
   {"id":"r2","opening":"2","location":"Bedroom 1","doorType":"Single Swing","style":"4 Panel True Shaker","width":"30","height":"80","paintColour":"Pearly"},
   {"id":"r3","opening":"3","location":"Pantry","doorType":"Single Swing","style":"Kingston","width":"24","height":"80","paintColour":"Pearly"},
   {"id":"r4","opening":"4","location":"Laundry","doorType":"Bypass","style":"Kingston","width":"60","height":"80","paintColour":"Pearly"}],
   "custom":{"a":1},"measured":["1","2","3","4"],"sources":{"xml":"cortes.xml"}}'
 where id = md5('c')::uuid;
-- Aris, not linked, and a shipped one
update dealer_orders set status = 'doors_ordered', form = '{"rows":[{"id":"a1","opening":"1"},{"id":"a2","opening":"2"}]}' where id = md5('a')::uuid;
update dealer_orders set status = 'shipped', form = '{"rows":[{"id":"b1"},{"id":"b2"}]}' where id = md5('b')::uuid;
update access_dealer_orders set order_status_id = 3, packed_on = null where order_id = 5069;

\echo -- a dealer cannot split, even their own order
set role authenticated;
select set_config('request.jwt.claim.sub', md5('dealer')::text, false);
select gidc_split_order(md5('c')::uuid, array['r3','r4'], '{}', '{}');
\echo -- nor mark an order as a part by hand
update dealer_orders set split_of = md5('a')::uuid where id = md5('c')::uuid;
reset role;

set role authenticated;
select set_config('request.jwt.claim.sub', md5('admin')::text, false);
\echo -- a shipped order is refused
select gidc_split_order(md5('b')::uuid, array['b2'], '{}', '{}');
\echo -- nothing ticked, everything ticked, a door that is not there
select gidc_split_order(md5('c')::uuid, array[]::text[], '{}', '{}');
select gidc_split_order(md5('c')::uuid, array['r1','r2','r3','r4'], '{}', '{}');
select gidc_split_order(md5('c')::uuid, array['r3','zz'], '{}', '{}');
\echo -- an order on a pallet is refused; taking it off voids the customs papers that covered it
insert into pallet_orders values (md5('c')::uuid, md5('p1')::uuid, 1), (md5('a')::uuid, md5('p1')::uuid, 2);
insert into pallet_customs_docs(pallet_id, pallet_name, order_ids, html) values
  (md5('p1')::uuid::text, 'SFD 1', jsonb_build_array(md5('c')::uuid, md5('a')::uuid), '<html>papers</html>');
select gidc_split_order(md5('c')::uuid, array['r3','r4'], '{}', '{}');
delete from pallet_orders where order_id = md5('c')::uuid;
select pallet_name, voided_at is not null as voided, voided_reason from pallet_customs_docs;
\echo -- taking Aris off as well leaves the voided papers as they were
delete from pallet_orders where order_id = md5('a')::uuid;
select count(*) as papers_kept from pallet_customs_docs;
\echo -- an invoiced order is refused until the invoice is voided
insert into dealer_invoices(order_id, invoice_no, charge, total) values (md5('c')::uuid, '2001', 'charge', 900);
select gidc_split_order(md5('c')::uuid, array['r3','r4'], '{}', '{}');
update dealer_invoices set voided_at = now() where invoice_no = '2001';
\echo -- the administrator moves the pantry and the laundry to Part 2
select gidc_split_order(md5('c')::uuid, array['r3','r4'],
  '{"door_count":3,"panel_count":3,"paint_colour":"Pearly"}', '{"door_count":3,"panel_count":3,"paint_colour":"Pearly","status":"shipped"}');
reset role;
select order_ref, status, est_ship_date, access_order_id, access_order_no, split_part, split_of = md5('c')::uuid as of_part1,
       door_count, jsonb_array_length(form->'rows') as lines,
       (select string_agg(r->>'opening', ',') from jsonb_array_elements(form->'rows') r) as openings,
       form->'measured' as measured, jsonb_array_length(files) as files, customer_addr, emailed_at is not null as emailed, search_text
  from dealer_orders where order_ref like 'SFD CORTES%' order by order_ref;

\echo -- Aris was never linked: after the split both parts carry the name, so the name match cannot pick
set role authenticated;
select set_config('request.jwt.claim.sub', md5('admin')::text, false);
select gidc_split_order(md5('a')::uuid, array['a2'], '{}', '{}')->>'order_ref';
reset role;
select set_config('request.jwt.claim.sub', '', false) as as_the_sync \gset
set role service_role;
select jsonb_array_length(gidc_sync_dealer_orders()) as moved;
reset role;
select order_ref, status, access_order_id from dealer_orders where order_ref like 'SFD ARIS%' order by order_ref;
\echo -- typing its Access number on Part 1 links it
set role authenticated;
select set_config('request.jwt.claim.sub', md5('admin')::text, false);
select gidc_set_access_order_no(md5('a')::uuid, '5067')->>'linked' as linked;
reset role;
select set_config('request.jwt.claim.sub', '', false) as as_the_sync \gset
set role service_role;
select jsonb_array_length(gidc_sync_dealer_orders()) as moved;
reset role;
select order_ref, status, est_ship_date, access_order_id from dealer_orders where order_ref like 'SFD ARIS%' order by order_ref;

\echo -- Access packs job 4273: the hour after, Part 1 has a ship date and Part 2 does not
update access_dealer_orders set packed_on = '2026-11-27', order_status_id = 4 where order_id = 4275;
select set_config('request.jwt.claim.sub', '', false) as as_the_sync \gset
set role service_role;
select gidc_link_dealer_orders_by_no(), jsonb_array_length(gidc_sync_dealer_orders()) as moved, gidc_fill_access_order_no();
reset role;
select order_ref, status, est_ship_date, access_order_id from dealer_orders where order_ref like 'SFD CORTES%' order by order_ref;

\echo -- whatever the sync writes straight onto Part 2 is put back
select set_config('request.jwt.claim.sub', '', false) as as_the_sync \gset
set role service_role;
update dealer_orders set status = 'shipped', est_ship_date = '2026-11-30', access_order_id = 4275
 where order_ref = 'SFD CORTES 88 Part 2' returning order_ref, status, est_ship_date, access_order_id;
reset role;

\echo -- an administrator sets Part 2 by hand and it stays
set role authenticated;
select set_config('request.jwt.claim.sub', md5('admin')::text, false);
update dealer_orders set est_ship_date = '2026-12-04', status = 'doors_ordered'
 where order_ref = 'SFD CORTES 88 Part 2' returning order_ref, status, est_ship_date;
\echo -- the same Access job cannot go on Part 2 as well
select gidc_set_access_order_no((select id from dealer_orders where order_ref = 'SFD CORTES 88 Part 2'), '4273');
\echo -- the office relinks Part 2 to a new Access job, 7101, which Access has not sent yet
select gidc_set_access_order_no((select id from dealer_orders where order_ref = 'SFD CORTES 88 Part 2'), '7101');
reset role;
select set_config('request.jwt.claim.sub', '', false) as as_the_sync \gset
set role service_role;
select jsonb_array_length(gidc_sync_dealer_orders()) as moved;
reset role;
select order_ref, status, est_ship_date, access_order_id, access_order_no from dealer_orders where order_ref = 'SFD CORTES 88 Part 2';
\echo -- the job reaches Access: the next hour links Part 2 and the sync takes over
insert into access_dealer_orders values (7103,'7101','SFD','Cortes','88',4,'2026-12-10',now());
select set_config('request.jwt.claim.sub', '', false) as as_the_sync \gset
set role service_role;
select gidc_link_dealer_orders_by_no() as linked, jsonb_array_length(gidc_sync_dealer_orders()) as moved, gidc_fill_access_order_no();
reset role;
select order_ref, status, est_ship_date, access_order_id, access_order_no, gidc_split_manual(d) as manual
  from dealer_orders d where order_ref like 'SFD CORTES%' order by order_ref;

\echo -- Part 1 again: Bedroom 1 goes to Part 3, named from the original, manual
set role authenticated;
select set_config('request.jwt.claim.sub', md5('admin')::text, false);
select gidc_split_order(md5('c')::uuid, array['r2'], '{"door_count":2}', '{"door_count":1}');
reset role;
select order_ref, split_part, split_of = md5('c')::uuid as of_part1, gidc_split_manual(d) as manual,
       (select string_agg(r->>'opening', ',') from jsonb_array_elements(form->'rows') r) as openings
  from dealer_orders d where order_ref like 'SFD CORTES%' order by order_ref;

\echo -- a dealer reads both parts of their order, and nothing about manual
set role authenticated;
select set_config('request.jwt.claim.sub', md5('dealer')::text, false);
select order_ref, status, est_ship_date from dealer_orders where order_ref like 'SFD CORTES%' order by order_ref;
\echo -- a dealer copying their order does not bring the split
insert into dealer_orders(dealer_id, order_ref, split_of, split_part) select dealer_id, 'copy', split_of, split_part
  from dealer_orders where order_ref = 'SFD CORTES 88 Part 2' returning order_ref, split_of, split_part;
reset role;

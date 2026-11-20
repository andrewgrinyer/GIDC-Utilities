-- TEST ONLY. Run by supplies.sh against the throwaway database.
\set ON_ERROR_STOP 0
\pset footer off
create or replace function pg_temp.as_who(n text) returns void language sql as
$$ select set_config('request.jwt.claim.sub', md5(n)::text, false); $$;

insert into auth.users(id,email) values (md5('manufacturing')::uuid,'manufacturing@x.ca') on conflict do nothing;
update profiles set name='manufacturing', role='manufacturing' where id=md5('manufacturing')::uuid;

\echo -- seeded: three lists, five shop items (want SHP SND INST, Ashley copied)
select code, po_prefix, copy_to from supply_categories order by sort;
select shop_name, uses, per_unit, waste_pct from supply_items order by sort;

\echo -- the server loads a schedule (as the service key does)
set role service_role;
select supply_schedule_load('[
 {"order_id":5069,"order_no":"5067","job":"Aris","uses":"rerail","need_on":"2026-11-24","amount":60,"cuts":[30,30]},
 {"order_id":5069,"order_no":"5067","job":"Aris","uses":"rerail","need_on":"2026-11-24","amount":36,"cuts":[36]},
 {"order_id":5069,"order_no":"5067","job":"Aris","uses":"pine","need_on":"2026-11-24","amount":80,"cuts":[72,4,4]},
 {"order_id":5070,"order_no":"5068","job":"Cortes","uses":"valance_large","need_on":"2026-11-26","amount":96,"cuts":[96]},
 {"order_id":5071,"order_no":"5069","job":"Old","uses":"doors","need_on":"2026-11-01","amount":6}
]'::jsonb, '2026-11-05');
reset role;
\echo -- want: Aris rerail 96 cuts 36,30,30; Aris pine 80; Cortes valance 96; Old doors 6
select job, uses, amount, cuts from supply_schedule order by job, uses;

\echo -- a second load without the old job keeps it and drops Cortes (want Aris rows and Old)
set role service_role;
select supply_schedule_load('[{"order_id":5069,"order_no":"5067","job":"Aris","uses":"pine","need_on":"2026-11-24","amount":10,"cuts":[10]}]'::jsonb, '2026-11-05');
reset role;
select job, uses, amount from supply_schedule order by job, uses;

\echo -- who can see the items (want admin and manufacturing 5; everybody else 0)
do $$ declare n text; c int; begin
  foreach n in array array['admin','user','sales','manufacturing','installer','dealer','dadmin','cdealer','stranger'] loop
    perform set_config('request.jwt.claim.sub', md5(n)::text, false);
    set local role authenticated;
    select count(*) into c from supply_items;
    reset role;
    raise notice '% sees %', n, c;
  end loop; end $$;

\echo -- signed out sees nothing (want: permission denied twice)
set role anon; select count(*) from supply_items; select count(*) from supply_orders; reset role;

\echo -- a page may not load the schedule, write an order or a line directly (want: denied four times)
set role authenticated; select pg_temp.as_who('admin');
select supply_schedule_load('[]'::jsonb, '2026-11-05');
insert into supply_orders(category, po_no) values ('shop', 'SHP99999');
insert into supply_order_lines(order_id, shop_name, unit, qty) values (gen_random_uuid(), 'x', 'piece', 1);
select supply_next_po('SHP');
reset role;

\echo -- an installer may not order (want: Only the shop and administrators)
set role authenticated; select pg_temp.as_who('installer');
select supply_place_order('shop', null, '[{"item_id":"00000000-0000-0000-0000-000000000000","qty":1}]'::jsonb);
reset role;

\echo -- the shop adds two suppliers and sets them on items
set role authenticated; select pg_temp.as_who('manufacturing');
insert into supply_suppliers(name, email) values ('  Lumber   Yard ', 'Orders@Lumber.CA'), ('Valance Co', 'sales@val.ca');
insert into supply_suppliers(name, email) values ('lumber yard', null);
insert into supply_suppliers(name, email) values ('Bad mail', 'not an email');
update supply_items set supplier_id = (select id from supply_suppliers where name = 'Lumber Yard'), supplier_item = ' 1x4 primed pine 16 ', standard_order = 20, warn_qty = 10
 where shop_name like 'Pine%' or shop_name like 'ReRail%';
update supply_items set supplier_id = (select id from supply_suppliers where name = 'Valance Co') where shop_name like '%Valance';
insert into supply_items(category, shop_name, unit) values ('shop', 'Glue', 'bottle');
insert into supply_items(category, shop_name, unit, uses) values ('shop', 'Bad', 'piece', 'pine');
update supply_categories set copy_to = 'buyer@grinyer.ca', po_prefix = 'XX', name = 'Changed' where code = 'shop';
insert into supply_counts(item_id, qty, counted_on, created_by) select id, 12, '2026-11-18', 'someone else' from supply_items where shop_name like 'Pine%';
reset role;
\echo -- want: Lumber Yard orders@lumber.ca, duplicate refused, bad email refused, Bad refused, shop copy buyer@ prefix SHP name Shop Supplies, count by manufacturing
select name, email, updated_by from supply_suppliers order by name;
select shop_name, supplier_item, updated_by from supply_items where supplier_id is not null order by sort limit 2;
select code, name, po_prefix, copy_to from supply_categories where code = 'shop';
select qty, created_by from supply_counts;

\echo -- orders: one per supplier, numbered SHP00001, SHP00002; a refused one leaves no gap
set role authenticated; select pg_temp.as_who('manufacturing');
select po_no, supplier_name, requested_by, status from supply_place_order('shop', (select id from supply_suppliers where name = 'Lumber Yard'),
  (select jsonb_agg(jsonb_build_object('item_id', id, 'qty', 5)) from supply_items where shop_name like 'Pine%' or shop_name like 'ReRail%'),
  '2026-11-28', 'Back door');
\echo -- want: refused, Small Valance is not from that supplier
select po_no from supply_place_order('shop', (select id from supply_suppliers where name = 'Lumber Yard'),
  (select jsonb_agg(jsonb_build_object('item_id', id, 'qty', 1)) from supply_items where shop_name = 'Small Valance'));
\echo -- want: refused, nothing to order; and refused, qty 0
select po_no from supply_place_order('shop', null, '[]'::jsonb);
select po_no from supply_place_order('shop', null, (select jsonb_agg(jsonb_build_object('item_id', id, 'qty', 0)) from supply_items where shop_name = 'Glue'));
\echo -- want: Glue with no supplier works, SHP00002
select po_no, supplier_name from supply_place_order('shop', null, (select jsonb_agg(jsonb_build_object('item_id', id, 'qty', 2)) from supply_items where shop_name = 'Glue'));
\echo -- a sanding item on the shop list is refused
insert into supply_items(category, shop_name, unit) values ('sanding', '120 grit disc', 'box');
select po_no from supply_place_order('shop', null, (select jsonb_agg(jsonb_build_object('item_id', id, 'qty', 2)) from supply_items where shop_name = '120 grit disc'));
\echo -- want SND00001
select po_no from supply_place_order('sanding', null, (select jsonb_agg(jsonb_build_object('item_id', id, 'qty', 2)) from supply_items where shop_name = '120 grit disc'));
reset role;
select po_no, supplier_name, needed_by, note, (select count(*) from supply_order_lines l where l.order_id = o.id) as lines from supply_orders o order by po_no;
select shop_name, supplier_item, unit, qty from supply_order_lines order by shop_name;

\echo -- received: stamped, and what was asked for cannot change from a page
set role authenticated; select pg_temp.as_who('manufacturing');
update supply_orders set status = 'received', po_no = 'SHP12345', needed_by = '2027-01-01', emailed_at = now(), sent_to = 'x@y.z' where po_no = 'SHP00001';
reset role;
\echo -- want SHP00001 received today by manufacturing, needed 2026-11-28, emailed_at blank
select po_no, status, received_on = current_date as today, received_by, needed_by, emailed_at, sent_to from supply_orders where po_no = 'SHP00001';

\echo -- removing an item keeps the order lines, drops its counts
set role authenticated; select pg_temp.as_who('manufacturing');
delete from supply_items where shop_name like 'Pine%';
reset role;
select shop_name, item_id is null as gone from supply_order_lines order by shop_name;
select count(*) as counts_left from supply_counts;

-- TEST ONLY. Run by split-move.sh against the throwaway database.
\set ON_ERROR_STOP 0
\pset null '·'
-- Benech shaped: typed by hand (no numbers saved), 8 openings
insert into dealer_orders(id, dealer_id, order_ref, customer_name, status, form, door_count)
select md5('benech')::uuid, d.id, 'SFD BENECH 41', 'SFDB', 'in_production',
  jsonb_build_object('rows', (select jsonb_agg(jsonb_build_object('id', 'b' || n, 'opening', '',
     'doorType', case when n = 5 then 'Bypass' when n = 6 then 'Double Swing AST' when n = 7 then 'Double Bifold' else 'Single Swing' end,
     'qty', case when n in (5, 6, 7) then 2 else 1 end, 'width', case when n = 7 then 72 else 30 end) order by n)
   from generate_series(1, 8) n)), 11
  from dealers d where d.slug = 'SOUTHFLORIDA';
insert into dealer_orders(id, dealer_id, order_ref, customer_name, status, form)
select md5('other')::uuid, d.id, 'SFD OTHER 9', 'SFDO', 'in_production', '{"rows":[{"id":"o1"},{"id":"o2"}]}'
  from dealers d where d.slug = 'SOUTHFLORIDA';

\pset format unaligned
\pset fieldsep ' | '
\pset tuples_only on
create temp view parts as
  select order_ref, door_count,
         (select string_agg(coalesce(r->>'opening','?') ||
                   coalesce((select string_agg(l, '') from jsonb_array_elements_text(r->'leaves') l), '') ||
                   case when r->>'qty' is not null then '(' || (r->>'qty') || (case when r->>'doorType' = 'Double Bifold' then ' w' || (r->>'width') else '' end) || ')' else '' end, ' ' order by ord)
            from jsonb_array_elements(form->'rows') with ordinality x(r, ord)) as doors,
         form->>'lastDoorNo' as last
    from dealer_orders where order_ref ~ 'BENECH' order by split_part nulls first;
grant select on parts to authenticated;

set role authenticated;
select set_config('request.jwt.claim.sub', md5('admin')::text, false) \g /dev/null
\echo -- split: 4 and 6A to Part 2, then 7 c/d and 8 to Part 3 off Part 1
select gidc_split_order(md5('benech')::uuid, array['b4'], '{}', '{}',
  '{"b6":{"keep":{"qty":1,"leaves":["P"]},"move":{"qty":1,"leaves":["A"]}}}')->>'order_ref';
select gidc_split_order(md5('benech')::uuid, array['b8'], '{}', '{}',
  '{"b7":{"keep":{"qty":1,"leaves":["a/b"],"width":"36"},"move":{"qty":1,"leaves":["c/d"],"width":"36"}}}')->>'order_ref';
select * from parts;
create temp table ids as select order_ref, id from dealer_orders where order_ref ~ 'BENECH';
\echo -- a dealer cannot move doors
select set_config('request.jwt.claim.sub', md5('dealer')::text, false) \g /dev/null
select gidc_move_split_doors((select id from ids where order_ref ~ 'Part 2'), md5('benech')::uuid, array['b4']);
select set_config('request.jwt.claim.sub', md5('admin')::text, false) \g /dev/null
\echo -- refused: same part, another order, an order that is not split, nothing ticked, a door that is not there
select gidc_move_split_doors(md5('benech')::uuid, md5('benech')::uuid, array['b1']);
select gidc_move_split_doors(md5('benech')::uuid, md5('other')::uuid, array['b1']);
select gidc_move_split_doors(md5('other')::uuid, md5('benech')::uuid, array['o1']);
select gidc_move_split_doors((select id from ids where order_ref ~ 'Part 2'), md5('benech')::uuid, array[]::text[]);
select gidc_move_split_doors((select id from ids where order_ref ~ 'Part 2'), md5('benech')::uuid, array['b1']);
\echo -- refused: Part 1 cannot be emptied
select gidc_move_split_doors(md5('benech')::uuid, (select id from ids where order_ref ~ 'Part 2'), array['b1','b2','b3','b5','b6','b7']);
\echo -- refused: the part the doors land on has shipped, is on a pallet, is invoiced
update dealer_orders set status = 'shipped' where id = md5('benech')::uuid;
select gidc_move_split_doors((select id from ids where order_ref ~ 'Part 2'), md5('benech')::uuid, array['b4']);
update dealer_orders set status = 'in_production' where id = md5('benech')::uuid;
insert into pallet_orders values (md5('benech')::uuid, md5('p1')::uuid, 1);
select gidc_move_split_doors((select id from ids where order_ref ~ 'Part 2'), md5('benech')::uuid, array['b4']);
delete from pallet_orders where order_id = md5('benech')::uuid;
insert into dealer_invoices(order_id, invoice_no, charge, total) values ((select id from ids where order_ref ~ 'Part 2'), '3001', 'charge', 100);
select gidc_move_split_doors((select id from ids where order_ref ~ 'Part 2'), md5('benech')::uuid, array['b4']);
update dealer_invoices set voided_at = now() where invoice_no = '3001';
select * from parts;

\echo -- Part 3 to Part 2: door 8 moves whole, sorted into door number order
select gidc_move_split_doors((select id from ids where order_ref ~ 'Part 3'), (select id from ids where order_ref ~ 'Part 2'),
  array['b8'], '{"door_count":1}', '{"door_count":3}') - 'to_id';
select * from parts;
\echo -- Part 2 to Part 1: 6A goes back into 6, which is 6AP again; 4 goes back too
select gidc_move_split_doors((select id from ids where order_ref ~ 'Part 2'), md5('benech')::uuid,
  array['b4','b6-p2'], '{"door_count":1}', '{"door_count":8}') - 'to_id';
select * from parts;
\echo -- Part 3 to Part 1: 7 c/d goes back, the widths add up to 72 again, Part 3 is left empty and deleted
select gidc_move_split_doors((select id from ids where order_ref ~ 'Part 3'), md5('benech')::uuid,
  array['b7-p3'], '{}', '{"door_count":9}', '{}', array['b7-p3']) - 'to_id';
select * from parts;
\echo -- Part 2 to Part 1 in part: 5B of the bypass on Part 1 first goes to Part 2, then back
select gidc_move_split_doors(md5('benech')::uuid, (select id from ids where order_ref ~ 'Part 2'),
  array[]::text[], '{}', '{}', '{"b5":{"keep":{"qty":1,"leaves":["A"]},"move":{"qty":1,"leaves":["B"]}}}') - 'to_id';
select * from parts;
select gidc_move_split_doors((select id from ids where order_ref ~ 'Part 2'), md5('benech')::uuid,
  array['b5-p2','b8']) - 'to_id';
\echo -- Part 2 had a voided invoice: it now sits on Part 1, so 3001 is never used again
select order_ref, invoice_no, voided_at is not null as voided from dealer_invoices i join dealer_orders d on d.id = i.order_id;
select * from parts;
\echo -- every line and its id, Part 1 at the end
select r->>'id', r->>'opening', r->>'qty', r->'leaves', r->>'width' from dealer_orders d, jsonb_array_elements(d.form->'rows') r
 where d.id = md5('benech')::uuid;
reset role;

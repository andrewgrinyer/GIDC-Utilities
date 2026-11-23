-- ====================================================================
--  UNDO THE BENECH SPLIT, STEP 2: PUT IT BACK TO ONE ORDER.
--  Run this in the Supabase SQL editor only after the preview looked
--  right. Safe to run twice: the second time there is no Part 2 left,
--  so it changes nothing and says so.
-- ====================================================================
--
--  What it does, all in one go or not at all:
--   * puts doors 4, 12, 13 and 14 from Part 2 back into Part 1 at those
--     places, so every door has its original number again
--   * takes "Part 1" off the name, and adds Part 2's door and panel
--     counts back
--   * deletes Part 2
--
--  It stops without changing anything if it does not find exactly one
--  Benech Part 1 with one Part 2, if the counts do not add up, or if
--  Part 2 is on a pallet, invoiced, or linked to its own Access job.
--  Part 1 keeps its status, ship date, Access link and files as they are.
-- ====================================================================
do $$
declare
  p1     public.dealer_orders%rowtype;
  p2     public.dealer_orders%rowtype;
  moved  int[] := array[4, 12, 13, 14];
  n1     int;
  n2     int;
  rows_  jsonb;
  n      int;
begin
  select count(*) into n from public.dealer_orders
   where order_ref ~* 'benech' and split_part = 1 and split_of is null;
  if n = 0 then
    raise notice 'No Benech Part 1 found. Either the undo has already run or the name differs. Nothing changed.';
    return;
  end if;
  if n > 1 then raise exception 'More than one Benech Part 1. Nothing changed.'; end if;
  select * into p1 from public.dealer_orders
   where order_ref ~* 'benech' and split_part = 1 and split_of is null for update;

  select count(*) into n from public.dealer_orders where split_of = p1.id;
  if n = 0 then
    raise notice 'Benech has no Part 2 left. Nothing changed.';
    return;
  end if;
  if n > 1 then raise exception 'Benech has more than one later part. Nothing changed.'; end if;
  select * into p2 from public.dealer_orders where split_of = p1.id for update;

  n1 := jsonb_array_length(coalesce(p1.form -> 'rows', '[]'));
  n2 := jsonb_array_length(coalesce(p2.form -> 'rows', '[]'));
  if n2 <> cardinality(moved) then
    raise exception 'Part 2 has % lines, not %. Nothing changed.', n2, cardinality(moved);
  end if;
  if (select max(x) from unnest(moved) x) > n1 + n2 then
    raise exception 'The two parts have % lines between them, fewer than door %. Nothing changed.',
      n1 + n2, (select max(x) from unnest(moved) x);
  end if;
  if p2.access_order_id is not null then
    raise exception 'Part 2 is linked to its own Access job. Nothing changed.';
  end if;
  if to_regclass('public.pallet_orders') is not null then
    execute 'select count(*) from public.pallet_orders where order_id = $1' into n using p2.id;
    if n > 0 then raise exception 'Part 2 is on a pallet. Take it off first. Nothing changed.'; end if;
  end if;
  if to_regclass('public.dealer_invoices') is not null then
    execute 'select count(*) from public.dealer_invoices where order_id = $1 and voided_at is null'
      into n using p2.id;
    if n > 0 then raise exception 'Part 2 has been invoiced. Nothing changed.'; end if;
  end if;

  select jsonb_agg(case when array_position(moved, g.pos) is not null
                        then p2.form -> 'rows' -> (array_position(moved, g.pos) - 1)
                        else p1.form -> 'rows' ->
                             (g.pos - (select count(*) from unnest(moved) x where x < g.pos)::int - 1)
                   end order by g.pos)
    into rows_
    from generate_series(1, n1 + n2) g(pos);

  update public.dealer_orders
     set order_ref   = regexp_replace(order_ref, '\s+Part\s+\d+\s*$', '', 'i'),
         split_part  = null,
         form        = jsonb_set(form, '{rows}', rows_),
         door_count  = coalesce(p1.door_count, 0) + coalesce(p2.door_count, 0),
         panel_count = coalesce(p1.panel_count, 0) + coalesce(p2.panel_count, 0)
   where id = p1.id;
  delete from public.dealer_orders where id = p2.id;
  raise notice 'Done. % is one order again with % lines.',
    regexp_replace(p1.order_ref, '\s+Part\s+\d+\s*$', '', 'i'), n1 + n2;
end $$;

select order_ref, split_part, door_count, panel_count,
       jsonb_array_length(form -> 'rows') as lines
  from public.dealer_orders
 where order_ref ~* 'benech'
 order by created_at;

-- ====================================================================
--  UNDO THE BENECH SPLIT, STEP 1: PREVIEW. READ ONLY.
--  Run this in the Supabase SQL editor. It changes nothing, so it is
--  safe to run twice or any number of times.
-- ====================================================================
--
--  Andrew split SFD Benech on 23 November, moving doors 4, 12, 13 and 14
--  to Part 2. Those doors had no door number saved on them, so the portal
--  numbered every door by its place in the list, and the numbers shifted.
--  The doors themselves were not changed.
--
--  This shows the order as the undo will put it back: one row per door,
--  its number, which part it comes from, and what the door is. Doors 4,
--  12, 13 and 14 should say Part 2 and the rest Part 1. If anything looks
--  wrong, do not run step 2.
--
--  The last column checks the order the doors were first typed in (their
--  line ids carry the time they were made). "yes" on every row is a second
--  sign that the numbering is right; a "no" is worth a look, but doors
--  added later or moved by hand can say "no" and still be right.
-- ====================================================================
with p1 as (
  select * from public.dealer_orders
   where order_ref ~* 'benech' and split_part = 1 and split_of is null
),
p2 as (
  select d.* from public.dealer_orders d join p1 on d.split_of = p1.id
),
moved as (select array[4, 12, 13, 14] as m),
sizes as (
  select (select count(*) from p1) as part1_orders, (select count(*) from p2) as part2_orders,
         (select jsonb_array_length(form -> 'rows') from p1 limit 1) as n1,
         (select jsonb_array_length(form -> 'rows') from p2 limit 1) as n2
),
merged as (
  select g.pos,
         array_position(m.m, g.pos) as k,
         (g.pos - (select count(*) from unnest(m.m) x where x < g.pos))::int as j
    from sizes s, moved m, generate_series(1, s.n1 + s.n2) g(pos)
),
doors as (
  select mg.pos,
         case when mg.k is not null then 'Part 2' else 'Part 1' end as from_part,
         case when mg.k is not null then (select form -> 'rows' -> (mg.k - 1) from p2)
              else (select form -> 'rows' -> (mg.j - 1) from p1) end as r
    from merged mg
)
select
  (select part1_orders || ' Part 1, ' || part2_orders || ' Part 2 found. Both should be 1.' from sizes) as check_found,
  (select (select order_ref from p1) || '  +  ' || (select order_ref from p2)) as orders,
  d.pos as door_number,
  d.from_part,
  nullif(d.r ->> 'opening', '') as saved_door_number,
  d.r ->> 'location' as location,
  d.r ->> 'doorType' as door_type,
  coalesce(d.r ->> 'width', '') || ' x ' || coalesce(d.r ->> 'height', '') as size,
  coalesce(d.r ->> 'qty', '1') as qty,
  case when lag(d.r ->> 'id') over (order by d.pos) is null then 'yes'
       when left(d.r ->> 'id', 8) >= left(lag(d.r ->> 'id') over (order by d.pos), 8) then 'yes'
       else 'no' end as in_typed_order
  from doors d
 order by d.pos;

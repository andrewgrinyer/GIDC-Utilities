-- ====================================================================
--  LOCK EVERY DOOR NUMBER IN PLACE, ON EVERY ORDER
--  Run this in the Supabase SQL editor AFTER the Benech undo. Safe to run
--  twice: the second time every door already has its number, so nothing
--  changes. lock-door-numbers-preview.sql shows what it will do first.
-- ====================================================================
--
--  Andrew, 23 November: door numbers are permanent. If a door is deleted
--  its number is gone and the others keep theirs.
--
--  A door typed in by hand has never had its number saved. The portal has
--  shown its place in the list instead, which is why deleting or moving a
--  door renumbered the ones after it. This saves the number each door
--  shows today onto the door itself (form.rows[].opening), on every order.
--  From 2.21.3 the portal never numbers by place again: a new door gets
--  the next number the order has never used, kept in form.lastDoorNo.
--
--  Doors that already have a number keep it untouched. If a door's place
--  in the list is a number another door on the same order already has,
--  it gets the next unused number instead, so no order ends up with two
--  doors called the same thing. The preview lists those.
--
--  It stops, changing nothing, while any split order still has doors with
--  no saved number, because those are the ones 2.21 renumbered (Benech):
--  locking them now would lock the wrong numbers in.
-- ====================================================================
do $$
declare
  o       record;
  r       jsonb;
  n       int;
  top     int;
  used    text[];
  out_    jsonb;
  changed int := 0;
  doors   int := 0;
  no      text;
begin
  if exists (
    select 1 from public.dealer_orders d, jsonb_array_elements(coalesce(d.form -> 'rows', '[]')) x
     where (d.split_of is not null or d.split_part is not null)
       and coalesce(btrim(x ->> 'opening'), '') = '') then
    raise exception 'A split order still has doors with no saved number (%). Run the Benech '
                    'undo first. Nothing changed.',
      (select string_agg(distinct d.order_ref, ', ') from public.dealer_orders d,
              jsonb_array_elements(coalesce(d.form -> 'rows', '[]')) x
        where (d.split_of is not null or d.split_part is not null)
          and coalesce(btrim(x ->> 'opening'), '') = '');
  end if;

  for o in
    select d.id, d.form from public.dealer_orders d
     where jsonb_typeof(d.form -> 'rows') = 'array'
       and (exists (select 1 from jsonb_array_elements(d.form -> 'rows') x
                     where coalesce(btrim(x ->> 'opening'), '') = '')
            or d.form -> 'lastDoorNo' is null)
     for update
  loop
    used := array(select btrim(x ->> 'opening') from jsonb_array_elements(o.form -> 'rows') x
                   where coalesce(btrim(x ->> 'opening'), '') <> '');
    top := greatest(coalesce((o.form ->> 'lastDoorNo')::int, 0),
                    coalesce((select max((substring(u from '^\d+'))::int) from unnest(used) u
                               where u ~ '^\d+'), 0),
                    jsonb_array_length(o.form -> 'rows'));
    out_ := '[]'::jsonb;
    n := 0;
    for r in select x from jsonb_array_elements(o.form -> 'rows') x loop
      n := n + 1;
      if coalesce(btrim(r ->> 'opening'), '') = '' then
        no := n::text;
        if no = any(used) then top := top + 1; no := top::text; end if;
        used := used || no;
        r := r || jsonb_build_object('opening', no);
        doors := doors + 1;
      end if;
      out_ := out_ || jsonb_build_array(r);
    end loop;
    update public.dealer_orders
       set form = jsonb_set(o.form, '{rows}', out_) || jsonb_build_object('lastDoorNo', top)
     where id = o.id;
    changed := changed + 1;
  end loop;
  raise notice 'Door numbers locked: % doors given their number, on % orders.', doors, changed;
end $$;

select count(*) as orders,
       count(*) filter (where exists (select 1 from jsonb_array_elements(coalesce(form -> 'rows', '[]')) x
                                       where coalesce(btrim(x ->> 'opening'), '') = '')) as orders_with_a_door_unnumbered
  from public.dealer_orders;

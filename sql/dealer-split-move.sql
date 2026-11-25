-- ====================================================================
--  MOVING DOORS BETWEEN THE PARTS OF A SPLIT ORDER (portal 2.24)
--  Run this in the Supabase SQL editor. Safe to run twice. Needs
--  dealer-split-order.sql first (the split columns and can_split_order).
-- ====================================================================
--
--  Andrew, 25 November: doors have to move between the parts that are
--  already there, not only out to a new part. A door on Part 2 can go
--  back to Part 1, a door on Part 3 to Part 1 or 2, as long as neither
--  part has shipped. The pallet and invoice rules of a split apply to
--  both parts. A part left with no doors is deleted.
--
--  DOOR NUMBERS NEVER CHANGE. Every line keeps the number it has; a line
--  with no number saved is given the number it shows (its place in the
--  list) before anything moves, the same as a split. A door that was
--  split out of its opening (12A on Part 2, 12P on Part 1) goes back into
--  the same line it came from, so the opening is one line again.
--
--  Part 1 is where the others hang from, so it always keeps at least one
--  door: move doors from it to a new part or to another part, but not all
--  of them.
--
--  gidc_move_split_doors(p_from, p_to, p_rows, p_from_counts, p_to_counts, p_leaves, p_shared)
--    p_rows         line ids that move whole
--    p_from_counts  door_count, panel_count, paint_colour for what stays
--    p_to_counts    the same for the part they land on, after the move
--    p_leaves       lines moved in part, as gidc_split_order takes them:
--                   {"<id>": {"keep": {"qty":1,"leaves":["P"]},
--                             "move": {"qty":1,"leaves":["A"]}}}
--    p_shared       moving line ids whose width is written for the whole
--                   opening (a bifold), so going back into their line the
--                   widths add. A swing or bypass width is per door and stays.
--
--  A part that is emptied and deleted hands its voided invoices to the
--  part the doors went to, so their numbers are never used again.

-- an earlier draft took one argument fewer
drop function if exists public.gidc_move_split_doors(uuid, uuid, text[], jsonb, jsonb, jsonb);

create or replace function public.gidc_move_split_doors(p_from uuid, p_to uuid, p_rows text[],
                                                        p_from_counts jsonb default '{}'::jsonb,
                                                        p_to_counts jsonb default '{}'::jsonb,
                                                        p_leaves jsonb default '{}'::jsonb,
                                                        p_shared text[] default '{}')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  f       public.dealer_orders%rowtype;
  t       public.dealer_orders%rowtype;
  o       public.dealer_orders%rowtype;
  rows_f  jsonb;
  rows_t  jsonb;
  keep    jsonb;
  move    jsonb;
  leaves  jsonb := coalesce(p_leaves, '{}'::jsonb);
  allowed text[] := array['qty', 'leaves', 'width'];
  billed  boolean;
  k       text;
  half    jsonb;
  found_  int;
  top     int;
  m       jsonb;
  hit     int;
  out_t   jsonb;
  gone    boolean := false;
  nm      text;
begin
  if p_from = p_to then raise exception 'Pick a different part to move the doors to.'; end if;
  -- the lower id first, so two people moving between the same pair cannot deadlock
  perform 1 from public.dealer_orders where id in (p_from, p_to) order by id for update;
  select * into f from public.dealer_orders where id = p_from;
  if not found then raise exception 'That order is not there any more.'; end if;
  select * into t from public.dealer_orders where id = p_to;
  if not found then raise exception 'The part you picked is not there any more.'; end if;
  if not public.can_split_order(f.dealer_id) then
    raise exception 'Only Grinyer can move doors between parts.';
  end if;
  if coalesce(f.split_of, f.id) <> coalesce(t.split_of, t.id)
     or (f.split_of is null and f.split_part is null)
     or (t.split_of is null and t.split_part is null) then
    raise exception 'Doors can only move between parts of the same split order.';
  end if;

  -- the same rules as a split, on both parts
  foreach o in array array[f, t] loop
    nm := coalesce(o.order_ref, 'That part');
    if o.status::text = 'shipped' then
      raise exception '% has shipped, so no doors can move on or off it.', nm;
    end if;
    if to_regclass('public.pallet_orders') is not null then
      execute 'select exists (select 1 from public.pallet_orders where order_id = $1)'
        into billed using o.id;
      if billed then
        raise exception '% is on a pallet. Take it off the pallet first, then move the doors.', nm;
      end if;
    end if;
    if to_regclass('public.dealer_invoices') is not null then
      execute 'select exists (select 1 from public.dealer_invoices
                               where order_id = $1 and voided_at is null)'
        into billed using o.id;
      if billed then
        raise exception '% has been invoiced. Void its invoice first, then move the doors.', nm;
      end if;
    end if;
  end loop;

  -- every line on both parts keeps the number it shows now
  select coalesce(jsonb_agg(case when coalesce(btrim(r ->> 'opening'), '') = ''
                                 then r || jsonb_build_object('opening', n::text)
                                 else r end order by n), '[]'::jsonb)
    into rows_f
    from jsonb_array_elements(coalesce(f.form -> 'rows', '[]'::jsonb)) with ordinality x(r, n);
  select coalesce(jsonb_agg(case when coalesce(btrim(r ->> 'opening'), '') = ''
                                 then r || jsonb_build_object('opening', n::text)
                                 else r end order by n), '[]'::jsonb)
    into rows_t
    from jsonb_array_elements(coalesce(t.form -> 'rows', '[]'::jsonb)) with ordinality x(r, n);

  -- the highest door number anywhere on the job, so a door added later never reuses one
  top := greatest((select max(coalesce((d.form ->> 'lastDoorNo')::int, 0)) from public.dealer_orders d
                    where coalesce(d.split_of, d.id) = coalesce(f.split_of, f.id)),
                  coalesce((select max((substring(btrim(r ->> 'opening') from '^\d+'))::int)
                              from jsonb_array_elements(rows_f || rows_t) r
                             where btrim(r ->> 'opening') ~ '^\d+'), 0));

  -- lines moved in part: checked before anything changes
  for k in select jsonb_object_keys(leaves) loop
    if k = any(coalesce(p_rows, '{}')) then
      raise exception 'A line cannot move whole and in part at once.';
    end if;
    select count(*) into found_ from jsonb_array_elements(rows_f) r where r ->> 'id' = k;
    if found_ <> 1 then
      raise exception 'Some of the ticked doors are not on this part any more. '
                      'Open it again and try once more.';
    end if;
    half := leaves -> k;
    if coalesce((half #>> '{keep,qty}')::int, 0) < 1 or coalesce((half #>> '{move,qty}')::int, 0) < 1
       or (half #>> '{keep,qty}')::int + (half #>> '{move,qty}')::int
          <> greatest(coalesce((select (r ->> 'qty')::int from jsonb_array_elements(rows_f) r
                                 where r ->> 'id' = k and (r ->> 'qty') ~ '^\d+$'), 1), 1) then
      raise exception 'The doors in that opening do not add up. Open it again and try once more.';
    end if;
  end loop;

  select coalesce(jsonb_agg(case when leaves ? (r ->> 'id')
                                 then r || (select coalesce(jsonb_object_agg(e.key, e.value), '{}')
                                              from jsonb_each(leaves -> (r ->> 'id') -> 'keep') e
                                             where e.key = any(allowed))
                                 else r end order by n), '[]'::jsonb) into keep
    from jsonb_array_elements(rows_f) with ordinality x(r, n)
   where not (r ->> 'id' = any(coalesce(p_rows, '{}')));
  select coalesce(jsonb_agg(case when leaves ? (r ->> 'id')
                                 then r || (select coalesce(jsonb_object_agg(e.key, e.value), '{}')
                                              from jsonb_each(leaves -> (r ->> 'id') -> 'move') e
                                             where e.key = any(allowed))
                                        || jsonb_build_object('id', (r ->> 'id') || '-p' || coalesce(t.split_part, 1))
                                 else r end order by n), '[]'::jsonb) into move
    from jsonb_array_elements(rows_f) with ordinality x(r, n)
   where r ->> 'id' = any(coalesce(p_rows, '{}')) or leaves ? (r ->> 'id');

  if jsonb_array_length(move) = 0 and coalesce(cardinality(p_rows), 0) = 0 then
    raise exception 'Tick at least one door to move.';
  end if;
  if jsonb_array_length(move) <> coalesce(cardinality(p_rows), 0)
                                + (select count(*) from jsonb_object_keys(leaves)) then
    raise exception 'Some of the ticked doors are not on this part any more. '
                    'Open it again and try once more.';
  end if;
  if jsonb_array_length(keep) = 0 and f.split_of is null then
    raise exception 'Part 1 keeps at least one door, because the other parts hang from it.';
  end if;

  -- onto the other part. A door that was split out of an opening that is
  -- on this part (same door number, same line it came from) goes back
  -- into that line: the quantities add and the letters join up again.
  out_t := rows_t;
  for m in select value from jsonb_array_elements(move) loop
    select (i - 1)::int into hit
      from jsonb_array_elements(out_t) with ordinality y(r, i)
     where btrim(r ->> 'opening') = btrim(m ->> 'opening')
       and regexp_replace(r ->> 'id', '(-p\d+)+$', '') = regexp_replace(m ->> 'id', '(-p\d+)+$', '')
       and jsonb_typeof(r -> 'leaves') = 'array' and jsonb_typeof(m -> 'leaves') = 'array'
     limit 1;
    if hit is null then
      out_t := out_t || jsonb_build_array(m);
    else
      out_t := jsonb_set(out_t, array[hit::text],
        (out_t -> hit)
        || jsonb_build_object(
             'qty', coalesce((out_t -> hit ->> 'qty')::int, 1) + coalesce((m ->> 'qty')::int, 1),
             'leaves', (select jsonb_agg(l order by l)
                          from (select jsonb_array_elements_text((out_t -> hit) -> 'leaves') l
                                union all
                                select jsonb_array_elements_text(m -> 'leaves')) z))
        || case when ((m ->> 'id') = any(coalesce(p_shared, '{}'))
                      or regexp_replace(m ->> 'id', '-p\d+$', '') = any(coalesce(p_shared, '{}')))
                     and (out_t -> hit ->> 'width') ~ '^\d+(\.\d+)?$' and (m ->> 'width') ~ '^\d+(\.\d+)?$'
                then jsonb_build_object('width',
                       trim_scale(round(((out_t -> hit ->> 'width')::numeric + (m ->> 'width')::numeric), 4))::text)
                else '{}'::jsonb end);
    end if;
  end loop;
  -- in door number order, so the part reads the way the job does
  select coalesce(jsonb_agg(r order by coalesce(nullif(substring(btrim(r ->> 'opening') from '^\d+'), '')::int, 1 << 30),
                                       btrim(r ->> 'opening'), i), '[]'::jsonb)
    into out_t
    from jsonb_array_elements(out_t) with ordinality y(r, i);

  update public.dealer_orders d
     set form = jsonb_set(coalesce(t.form, '{}'::jsonb), '{rows}', out_t)
                || jsonb_build_object('lastDoorNo', top),
         door_count = coalesce((p_to_counts ->> 'door_count')::int, d.door_count),
         panel_count = coalesce((p_to_counts ->> 'panel_count')::int, d.panel_count),
         paint_colour = case when p_to_counts ? 'paint_colour' then p_to_counts ->> 'paint_colour'
                             else d.paint_colour end
   where d.id = t.id;

  if jsonb_array_length(keep) = 0 then
    if to_regclass('public.dealer_invoices') is not null then
      execute 'update public.dealer_invoices set order_id = $1 where order_id = $2' using t.id, f.id;
    end if;
    delete from public.dealer_orders where id = f.id;
    gone := true;
  else
    update public.dealer_orders d
       set form = jsonb_set(coalesce(f.form, '{}'::jsonb), '{rows}', keep)
                  || jsonb_build_object('lastDoorNo', top),
           door_count = coalesce((p_from_counts ->> 'door_count')::int, d.door_count),
           panel_count = coalesce((p_from_counts ->> 'panel_count')::int, d.panel_count),
           paint_colour = case when p_from_counts ? 'paint_colour' then p_from_counts ->> 'paint_colour'
                               else d.paint_colour end
     where d.id = f.id;
  end if;

  return jsonb_build_object('from_ref', f.order_ref, 'to_ref', t.order_ref, 'to_id', t.id,
    'moved', jsonb_array_length(move), 'kept', jsonb_array_length(keep), 'deleted', gone);
end $$;

revoke all on function public.gidc_move_split_doors(uuid, uuid, text[], jsonb, jsonb, jsonb, text[]) from public, anon;
grant execute on function public.gidc_move_split_doors(uuid, uuid, text[], jsonb, jsonb, jsonb, text[]) to authenticated;

select 'moving doors between parts is in' as done;

notify pgrst, 'reload schema';

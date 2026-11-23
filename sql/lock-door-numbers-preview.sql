-- ====================================================================
--  LOCK EVERY DOOR NUMBER: PREVIEW. READ ONLY.
--  Run in the Supabase SQL editor. Changes nothing, safe to run any
--  number of times. Shows which orders have doors with no saved number,
--  how many, and the numbers they will be given (the ones the portal
--  shows today). "clash" rows are doors whose place in the list is a
--  number another door on that order already has; they get the next
--  unused number instead.
-- ====================================================================
with d as (
  select o.id, o.order_ref, o.status::text as status, o.split_of, o.split_part, o.created_at,
         x.r, x.n,
         array(select btrim(y ->> 'opening') from jsonb_array_elements(o.form -> 'rows') y
                where coalesce(btrim(y ->> 'opening'), '') <> '') as used
    from public.dealer_orders o,
         jsonb_array_elements(coalesce(o.form -> 'rows', '[]')) with ordinality x(r, n)
)
select order_ref, status,
       case when split_of is not null or split_part is not null
            then 'SPLIT: run the Benech undo first' else '' end as warning,
       count(*) as doors_to_number,
       string_agg(n::text || case when n::text = any(used) then ' (clash)' else '' end,
                  ', ' order by n) as numbers_they_get
  from d
 where coalesce(btrim(r ->> 'opening'), '') = ''
 group by id, order_ref, status, split_of, split_part, created_at
 order by warning desc, created_at desc;

-- ====================================================================
--  THE PORTAL ORDERS THE SYNC CANNOT MATCH, AND WHAT ACCESS HAS CLOSE
--  Read only. Run in the Supabase SQL editor. Changes nothing, so safe
--  to run twice. One row per unmatched order. Use Export, CSV, and send
--  the file back.
-- ====================================================================
with u as (
  select d.id, d.order_ref, d.customer_name, d.status::text as status,
         d.created_at::date as made, k.name as dealer, k.slug
    from public.dealer_orders d
    join public.dealer_orders_unmatched x on x.order_ref = d.order_ref
    left join public.dealers k on k.id = d.dealer_id
   where d.access_order_id is null
)
select u.dealer, u.order_ref, u.customer_name as dealer_id_box, u.status, u.made,
       -- Access jobs whose surname appears as a word in the portal name
       (select string_agg(s.tag || ' ' || s.last_name || ' ' || coalesce(s.street_number, '') ||
                          ' (job ' || coalesce(s.order_no::text, '?') || ')', '; ' order by s.order_id desc)
          from public.access_dealer_orders s
         where length(s.last_name) > 2
           and upper(u.order_ref) ~ ('\m' || regexp_replace(upper(split_part(s.last_name, ' ', 1)), '[^A-Z0-9]', '', 'g') || '\M')
       ) as access_jobs_with_that_name
  from u
 order by u.dealer, u.made;

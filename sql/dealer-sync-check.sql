-- ====================================================================
--  WHY ARE DEALER STATUSES NOT MOVING?  Read only.
--  Run in the Supabase SQL editor. Changes nothing, so safe to run twice
--  or any number of times. Prints counts and dates, no customer names.
--  Paste back the one row it returns.
-- ====================================================================
select
  -- when the office server last got anything through. Null means never.
  (select max(pulled_at) from public.access_dealer_orders)           as last_pulled,
  (select count(*) from public.access_dealer_orders)                 as staged_jobs,
  (select string_agg(tag || ' ' || n, ', ' order by tag) from
     (select tag, count(*) n from public.access_dealer_orders group by tag) t) as staged_by_tag,
  (select count(*) from public.access_dealer_orders where packed_on is not null) as staged_with_packing_date,
  (select count(*) from public.dealer_orders where status <> 'draft') as portal_orders_submitted,
  (select count(*) from public.dealer_orders where access_order_id is not null) as portal_orders_linked_by_id,
  (select count(*) from public.dealer_orders where est_ship_date is not null) as portal_orders_with_ship_date,
  (select count(*) from public.dealer_orders_unmatched)              as portal_orders_unmatched,
  -- the sync's own code, which is not in the repo yet. Copy this cell out.
  pg_get_functiondef('public.gidc_sync_dealer_orders()'::regprocedure) as sync_function,
  pg_get_viewdef('public.dealer_orders_unmatched'::regclass, true)    as unmatched_view;

-- ====================================================================
--  TEST ONLY. NEVER RUN THIS IN SUPABASE.
--  The rest of dealer_orders as the portal reads and writes it, pallets
--  for dealer-invoicing.sql, and a stand in for gidc_sync_dealer_orders()
--  that behaves the way docs/dealer-sync.md says the live one does:
--  a linked order follows its job by id, an unlinked one is matched by
--  surname and street number in its name, only when exactly one order
--  fits, and is then linked. Loaded after mock-dealer-sync.sql into the
--  throwaway database split-order.sh makes fresh each time.
-- ====================================================================
update dealer_orders set status = 'under_review';
create type public.order_status as enum ('draft','under_review','doors_ordered','in_production',
  'complete_invoiced','ready_to_ship','shipped','on_hold');
alter table dealer_orders alter column status drop default;
alter table dealer_orders alter column status type order_status using status::order_status;
alter table dealer_orders alter column status set default 'draft';
alter table dealer_orders add column form jsonb default '{}'::jsonb, add column files jsonb default '[]'::jsonb,
  add column door_count int, add column panel_count int, add column paint_colour text,
  add column pallet_name text, add column customer_addr text, add column customer_city text,
  add column submitted_at timestamptz, add column emailed_at timestamptz, add column admin_note text,
  add column redo_of uuid, add column created_by uuid default auth.uid(),
  add column search_text text generated always as (lower(coalesce(order_ref,'') || ' ' || coalesce(customer_name,''))) stored;
create policy dealer_orders_insert on dealer_orders for insert to authenticated with check (is_admin() or dealer_id = my_dealer());
create table public.pallets(id uuid primary key default gen_random_uuid(), dealer_id uuid, name text unique, max_rows int,
  closed_at timestamptz, built_on date default current_date);
grant select,insert,update,delete on pallets to authenticated;
insert into pallets(id,dealer_id,name) select md5('p1')::uuid, id, 'SFD 1' from dealers where slug='SOUTHFLORIDA';
create table public.pallet_orders(order_id uuid primary key references dealer_orders on delete cascade,
  pallet_id uuid references pallets on delete cascade, position int);
grant select,insert,update,delete on pallet_orders to authenticated;

create function public.gidc_sync_dealer_orders() returns jsonb language plpgsql security definer set search_path=public as $$
declare r record; n int; changed jsonb := '[]'::jsonb;
begin
  -- by id
  for r in select d.id, s.order_status_id, s.packed_on from dealer_orders d join access_dealer_orders s on s.order_id = d.access_order_id
            where d.status <> 'draft' loop
    update dealer_orders set status = case r.order_status_id when 3 then 'in_production' when 4 then 'ready_to_ship'
                                         when 5 then 'shipped' else status end::order_status,
                             est_ship_date = coalesce(r.packed_on + 3, est_ship_date)
     where id = r.id and (status is distinct from (case r.order_status_id when 3 then 'in_production' when 4 then 'ready_to_ship'
                                         when 5 then 'shipped' else status end::order_status) or est_ship_date is distinct from coalesce(r.packed_on + 3, est_ship_date));
    get diagnostics n = row_count; if n > 0 then changed := changed || to_jsonb(r.id); end if;
  end loop;
  -- by name, only one order may fit, and the job is not already taken
  for r in select s.* from access_dealer_orders s
            where not exists (select 1 from dealer_orders x where x.access_order_id = s.order_id) loop
    if (select count(*) from dealer_orders d where d.access_order_id is null and d.status <> 'draft'
          and upper(d.order_ref) ~ ('\m' || upper(r.last_name) || '\M') and d.order_ref ~ ('\m' || r.street_number || '\M')) = 1 then
      update dealer_orders d set access_order_id = r.order_id,
             est_ship_date = coalesce(r.packed_on + 3, d.est_ship_date),
             status = case r.order_status_id when 3 then 'in_production' when 4 then 'ready_to_ship' when 5 then 'shipped' else d.status end::order_status
       where d.access_order_id is null and d.status <> 'draft'
         and upper(d.order_ref) ~ ('\m' || upper(r.last_name) || '\M') and d.order_ref ~ ('\m' || r.street_number || '\M');
      changed := changed || to_jsonb(r.order_id);
    end if;
  end loop;
  return changed;
end $$;
grant execute on function gidc_sync_dealer_orders() to service_role;

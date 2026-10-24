-- ====================================================================
--  TEST ONLY. NEVER RUN THIS IN SUPABASE.
--  The dealer order and Access staging tables as far as the portal and
--  the dealer-sync function show their shape. Loaded after
--  mock-live-shape.sql into the throwaway database order-number.sh
--  makes fresh each time, so running it twice is safe by construction.
-- ====================================================================
do $$ begin create role service_role nologin bypassrls; exception when duplicate_object then null; end $$;
create table public.dealer_orders(id uuid primary key default gen_random_uuid(), dealer_id uuid references public.dealers,
  order_ref text, customer_name text, status text default 'draft', est_ship_date date, access_order_id integer,
  created_at timestamptz default now());
alter table dealer_orders enable row level security;
create policy dealer_orders_read on dealer_orders for select to authenticated using (is_admin() or dealer_id = my_dealer());
create policy dealer_orders_write on dealer_orders for update to authenticated using (is_admin() or dealer_id = my_dealer());
create table public.access_dealer_orders(order_id integer primary key, order_no text, tag text, last_name text,
  street_number text, order_status_id integer, packed_on date, pulled_at timestamptz);
grant select,insert,update,delete on dealer_orders, access_dealer_orders to authenticated, service_role;
insert into access_dealer_orders values
  (5069,'5067','SFD','Aris','12',5,'2026-10-20',now()),
  (4275,'4273','SFD','Cortes','88',3,null,now()),
  (6001,'6000','CIN','Twin','1',3,null,now()),
  (6002,'6000','CIN','Twin','2',3,null,now());
insert into dealer_orders(id,dealer_id,order_ref,customer_name,status) select md5(v.k)::uuid, d.id, v.ref, 'SFDC', 'submitted'
  from (values ('a','SFD ARIS 12'),('b','SFD NEWJOB 5'),('c','SFD CORTES 88')) v(k,ref), dealers d where d.slug='SOUTHFLORIDA';
update dealer_orders set access_order_id = 4275 where id = md5('c')::uuid;

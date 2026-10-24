-- ====================================================================
--  TEST ONLY. NEVER RUN THIS IN SUPABASE.
--  A small stand in for the live database as it was before 21 October:
--  the old trigger that gave every new account role user, the old
--  denylist price rule, the old profiles rule. run.sh loads it into a
--  throwaway local database that it drops and makes again each time, so
--  running it twice is safe by construction.
--  NOTNULL_HERE is replaced by run.sh, to test both shapes of role.
-- ====================================================================
do $$ begin create role anon nologin; create role authenticated nologin; exception when duplicate_object then null; end $$;
create schema auth;
create table auth.users(id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb default '{}');
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated;
create table public.dealers(id uuid primary key default gen_random_uuid(), name text, slug text, active boolean default true);
create table public.profiles(id uuid primary key references auth.users on delete cascade, name text, email text,
  role text NOTNULL_HERE default 'user', dealer_id uuid references public.dealers, active boolean default true, created_at timestamptz default now());
create function public.is_admin() returns boolean language sql stable security definer set search_path=public as $$ select exists(select 1 from profiles where id=auth.uid() and role='admin') $$;
create function public.my_dealer() returns uuid language sql stable security definer set search_path=public as $$
  select case when p.role in ('dealer','dealer_admin') then p.dealer_id when p.role='user' then (select id from dealers where lower(slug)='grinyer') end from profiles p where p.id=auth.uid() $$;
create function public.can_see_prices() returns boolean language sql stable security definer set search_path=public as $$ select exists(select 1 from profiles where id=auth.uid() and coalesce(role,'') <> 'dealer_admin') $$;
create function public.can_order() returns boolean language sql stable security definer set search_path=public as $$ select exists(select 1 from profiles where id=auth.uid() and coalesce(role,'') <> 'dealer_admin') $$;
create function public.handle_new_user() returns trigger language plpgsql security definer set search_path=public as $$
begin insert into profiles(id,name,email,role) values(new.id, coalesce(new.raw_user_meta_data->>'name',''), new.email,'user'); return new; end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();
alter table profiles enable row level security;
create policy profiles_read on profiles for select to authenticated using (id=auth.uid() or is_admin() or my_dealer() is null or dealer_id=my_dealer());
create policy profiles_admin on profiles for all to authenticated using (is_admin()) with check (is_admin());
create table public.orders(id serial primary key, dealer_id uuid);
alter table orders enable row level security;
create policy orders_read on orders for select to authenticated using (is_admin() or dealer_id = my_dealer());
create table public.prices(id serial primary key, price numeric);
alter table prices enable row level security;
create policy prices_read on prices for select to authenticated using (can_see_prices());
grant select,insert,update,delete on all tables in schema public to authenticated;
insert into dealers(name,slug) values ('Grinyer','GRINYER'),('South Florida','SOUTHFLORIDA'),('Columbus','COLUMBUS');
insert into orders(dealer_id) select id from dealers; insert into orders(dealer_id) select id from dealers where slug='SOUTHFLORIDA';
insert into prices(price) values (1),(2);
-- people
do $$ declare r record; begin
for r in select * from (values ('admin','admin',null),('user','user',null),('sales','sales',null),('installer','installer',null),
  ('dealer','dealer','SOUTHFLORIDA'),('dadmin','dealer_admin','SOUTHFLORIDA'),('cdealer','dealer','COLUMBUS')) v(n,ro,sl) loop
  insert into auth.users(id,email) values (md5(r.n)::uuid, r.n||'@x.ca');
  update profiles set name=r.n, role=r.ro, dealer_id=(select id from dealers where slug=r.sl) where id=md5(r.n)::uuid;
end loop; end $$;

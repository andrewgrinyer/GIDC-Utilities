-- ====================================================================
--  TEST ONLY. NEVER RUN THIS IN SUPABASE.
--  A stand in for the measurement app's jobs table as the app uses it:
--  id text, owner_name, customer, openings, data (the whole job), and
--  updated. Every team login reads and writes; only administrators
--  delete. Loaded after mock-live-shape.sql.
-- ====================================================================
create table public.jobs(id text primary key, owner_name text, customer text, openings integer default 0,
  data jsonb not null default '{}', updated timestamptz default now());
alter table public.jobs enable row level security;
create policy jobs_read on public.jobs for select to authenticated using (true);
create policy jobs_write on public.jobs for insert to authenticated with check (true);
create policy jobs_update on public.jobs for update to authenticated using (true) with check (true);
create policy jobs_delete on public.jobs for delete to authenticated using (is_admin());
grant select, insert, update, delete on public.jobs to authenticated;
do $$ begin create role service_role nologin bypassrls; exception when duplicate_object then null; end $$;
grant usage on schema public to service_role;
grant select, insert, update, delete on all tables in schema public to service_role;
-- the reps as the app lists them
update public.profiles set name = 'Nick Matsias', role = 'sales' where name = 'sales';
insert into auth.users(id, email) values (md5('michael')::uuid, 'michael@x.ca');
update public.profiles set name = 'Michael Sparaco', role = 'sales' where id = md5('michael')::uuid;

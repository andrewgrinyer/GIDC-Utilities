-- ====================================================================
--  PAINT: use estimator and custom colour forecaster
--  Run this in the Supabase SQL editor. Safe to run twice, and safe in
--  any order with the other files in sql/.
-- ====================================================================
--
--  Andrew, 19 November: a paint tool on the tools site for the shop and
--  administrators. The server reads the production schedule out of
--  Access every hour and counts the doors of each colour to be primed
--  and painted each day. The page works out the gallons, keeps track of
--  what is in stock, and sends an order request to Ashley.
--
--  THE RULES ANDREW GAVE (19 November)
--
--    Every door gets one coat of primer and one coat of paint.
--    A 5 gallon pail of primer primes about 50 doors.
--    A 5 gallon pail of paint paints about 35 doors, custom colours too.
--    Primer is counted on the Scheduled Prime Date, paint on the
--      Scheduled Paint Date.
--    A door line whose colour says primer only gets primer and no paint.
--    Stocked: primer and five colours, Extra White, Pure White,
--      Alabaster, Pearly and Chantilly Lace. Anything else is custom and
--      is bought per job.
--    Stock goes down by itself as scheduled days pass. A physical count
--      replaces whatever the estimate said.
--    Gallons are the unit. An order is in 5 gallon or 1 gallon pails.
--
--  THE TABLES
--
--    paint_colours    primer, the five stocked colours, and one row for
--                     custom colours. Coverage and the warning level
--                     live here, so changing them is an edit on the
--                     page and never a change of code.
--    paint_schedule   what the server sent from Access: per order and
--                     colour, how many doors, and the two dates.
--    paint_counts     physical counts.
--    paint_orders     order requests, and when each arrived.
--
--  WHO MAY
--
--    can_use_paint()  admin and manufacturing, the same people the
--                     tools page calls the shop. An allowlist like every
--                     other helper, so dealers and any role invented
--                     later get nothing.
--
--    The schedule is written only by the paint-sync edge function, with
--    the service key, through paint_schedule_load(). Nobody signed in
--    can change it from a page.
--
--    If email-verification.sql runs after this file, run this file once
--    more so the helper picks up its email rule as well.
-- ====================================================================

do $$
begin
  if to_regclass('public.profiles') is null then
    raise exception 'profiles is not here. This is the wrong project.';
  end if;
end $$;

-- ---------- 1. who may ------------------------------------------------
-- Built the same way as can_see_inventory() in door-inventory.sql: the
-- active column and the email rule are added only if they exist.
do $$
declare act text := '';
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'profiles'
                and column_name = 'active')
  then act := 'and coalesce(p.active, true)';
  end if;
  if exists (select 1 from pg_proc f join pg_namespace n on n.oid = f.pronamespace
              where n.nspname = 'public' and f.proname = 'email_ok')
  then act := act || ' and public.email_ok()';
  end if;

  execute format($f$
    create or replace function public.can_use_paint()
    returns boolean language sql stable security definer set search_path = public as $b$
      select exists (select 1 from public.profiles p
                      where p.id = auth.uid() %s
                        and p.role in ('admin','manufacturing'));
    $b$ $f$, act);
end $$;

comment on function public.can_use_paint is
  'Who may see and use the paint tool: administrators and the shop '
  '(manufacturing). A list of who may, so dealers and any role invented '
  'later are shut out.';
revoke all on function public.can_use_paint() from public, anon;
grant execute on function public.can_use_paint() to authenticated;

-- ---------- 2. the colours ----------------------------------------------
create table if not exists public.paint_colours (
  name            text primary key,
  kind            text not null,
  doors_per_pail  integer not null,
  warn_gallons    numeric(7,2),
  match_words     text[] not null default '{}',
  sort            integer not null default 100,
  updated_at      timestamptz not null default now(),
  updated_by      text
);
alter table public.paint_colours drop constraint if exists paint_colours_kind_ok;
alter table public.paint_colours add constraint paint_colours_kind_ok
  check (kind in ('primer', 'stock', 'custom'));
alter table public.paint_colours drop constraint if exists paint_colours_cover_ok;
alter table public.paint_colours add constraint paint_colours_cover_ok
  check (doors_per_pail > 0 and doors_per_pail < 1000
         and (warn_gallons is null or warn_gallons >= 0));

comment on table public.paint_colours is
  'Primer, the stocked colours, and one row standing for every custom '
  'colour. doors_per_pail is doors per 5 gallon pail. match_words are '
  'how a colour typed in Access is recognised: lower case, letters and '
  'digits only, and a colour matches if it contains any of them.';

-- Added once. A second run leaves alone whatever was changed on the
-- page since, coverage and warning levels included.
insert into public.paint_colours (name, kind, doors_per_pail, warn_gallons, match_words, sort) values
  ('Primer',         'primer', 50, 10,   '{}',                                  0),
  ('Extra White',    'stock',  35, 5,    '{extrawhite}',                       10),
  ('Pure White',     'stock',  35, 5,    '{purewhite}',                        20),
  ('Alabaster',      'stock',  35, 5,    '{alabaster}',                        30),
  ('Pearly',         'stock',  35, 5,    '{pearly}',                           40),
  ('Chantilly Lace', 'stock',  35, 5,    '{chantilly,chantily,chantilylace}',  50),
  ('Custom',         'custom', 35, null, '{}',                                 90)
on conflict (name) do nothing;

-- Only one primer row and one custom row, whatever is edited later.
create unique index if not exists paint_colours_one_primer on public.paint_colours ((kind)) where kind in ('primer', 'custom');

-- ---------- 3. the schedule from Access ----------------------------------
create table if not exists public.paint_schedule (
  access_order_id integer not null,
  order_no        text,
  job             text,
  colour_raw      text not null default '',
  doors           numeric(8,2) not null,
  prime_on        date,
  paint_on        date,
  pulled_at       timestamptz not null default now(),
  primary key (access_order_id, colour_raw)
);
alter table public.paint_schedule drop constraint if exists paint_schedule_doors_ok;
alter table public.paint_schedule add constraint paint_schedule_doors_ok
  check (doors >= 0 and doors < 10000);
create index if not exists paint_schedule_prime on public.paint_schedule (prime_on);
create index if not exists paint_schedule_paint on public.paint_schedule (paint_on);

comment on table public.paint_schedule is
  'Doors to prime and paint, per Access order and colour as typed in '
  'Access, with the Scheduled Prime Date and Scheduled Paint Date. '
  'Written only by paint_schedule_load(), from the hourly server script. '
  'access_order_id is the Access OrderID, not OrderNo.';

-- What a colour typed in Access is. Lower case, letters and digits only,
-- the same idea as gidc_pnorm(), then checked against each stocked
-- colour's match words.
create or replace function public.paint_colour_of(raw text)
returns text language sql stable set search_path = public as $$
  with n as (select lower(regexp_replace(coalesce(raw, ''), '[^A-Za-z0-9]', '', 'g')) as k)
  select case
    when (select k from n) = '' then null
    when (select k from n) ~ '(primeronly|primedonly|primeonly)' then 'Primer only'
    else coalesce(
      (select c.name from public.paint_colours c, n
        where c.kind = 'stock'
          and exists (select 1 from unnest(c.match_words) w where w <> '' and n.k like '%' || w || '%')
        order by c.sort limit 1),
      btrim(raw))
  end
$$;
comment on function public.paint_colour_of is
  'The colour a door line is, from what was typed in Access: a stocked '
  'colour''s name, Primer only, the typed name for a custom colour, or '
  'null when nothing was typed.';

-- The page reads this. security_invoker, so the rules on the table
-- apply to whoever is reading.
drop view if exists public.paint_schedule_lines;
create view public.paint_schedule_lines with (security_invoker = true) as
  select s.access_order_id, s.order_no, s.job, s.colour_raw, s.doors,
         s.prime_on, s.paint_on, s.pulled_at,
         public.paint_colour_of(s.colour_raw) as colour,
         case
           when public.paint_colour_of(s.colour_raw) is null then 'none'
           when public.paint_colour_of(s.colour_raw) = 'Primer only' then 'primer_only'
           when exists (select 1 from public.paint_colours c
                         where c.kind = 'stock' and c.name = public.paint_colour_of(s.colour_raw)) then 'stock'
           else 'custom'
         end as kind
    from public.paint_schedule s;

-- THE LOAD
-- Access is the truth for every order it sends, and for every day from
-- keep_before on. Days before that are left as they were, so the use on
-- past days stays put after an order is finished and drops out of
-- Access's window. All in one statement, so a failed load changes nothing.
create or replace function public.paint_schedule_load(p_rows jsonb, p_keep_before date)
returns jsonb language plpgsql security definer set search_path = public as $$
declare removed int; added int;
begin
  if jsonb_typeof(p_rows) <> 'array' then raise exception 'rows must be a list'; end if;

  delete from paint_schedule s
   where greatest(coalesce(s.prime_on, '-infinity'::date), coalesce(s.paint_on, '-infinity'::date)) >= p_keep_before
      or s.access_order_id in (select (r->>'order_id')::int from jsonb_array_elements(p_rows) r);
  get diagnostics removed = row_count;

  insert into paint_schedule (access_order_id, order_no, job, colour_raw, doors, prime_on, paint_on, pulled_at)
  select (r->>'order_id')::int, max(r->>'order_no'), max(r->>'job'), coalesce(btrim(r->>'colour'), ''),
         sum((r->>'doors')::numeric), max((r->>'prime_on')::date), max((r->>'paint_on')::date), now()
    from jsonb_array_elements(p_rows) r
   group by (r->>'order_id')::int, coalesce(btrim(r->>'colour'), '');
  get diagnostics added = row_count;

  return jsonb_build_object('removed', removed, 'added', added);
end $$;
revoke all on function public.paint_schedule_load(jsonb, date) from public, anon, authenticated;
do $$ begin
  execute 'grant execute on function public.paint_schedule_load(jsonb, date) to service_role';
exception when undefined_object then null;
end $$;

-- ---------- 4. counts and orders ------------------------------------------
create table if not exists public.paint_counts (
  id          uuid primary key default gen_random_uuid(),
  colour      text not null references public.paint_colours(name) on update cascade,
  gallons     numeric(8,2) not null,
  counted_on  date not null default current_date,
  note        text,
  created_at  timestamptz not null default now(),
  created_by  text
);
alter table public.paint_counts drop constraint if exists paint_counts_ok;
alter table public.paint_counts add constraint paint_counts_ok check (gallons >= 0 and gallons < 10000);
comment on table public.paint_counts is
  'Physical counts of primer and the stocked colours, in gallons. A count '
  'is the stock at the end of that day and replaces the estimate.';

create table if not exists public.paint_orders (
  id            uuid primary key default gen_random_uuid(),
  colour        text not null,
  custom        boolean not null default false,
  pails_5       integer not null default 0,
  pails_1       integer not null default 0,
  gallons       numeric(8,2) generated always as (pails_5 * 5 + pails_1) stored,
  for_job       text,
  needed_by     date,
  note          text,
  status        text not null default 'requested',
  requested_at  timestamptz not null default now(),
  requested_by  text,
  emailed_at    timestamptz,
  received_on   date,
  received_by   text
);
alter table public.paint_orders drop constraint if exists paint_orders_ok;
alter table public.paint_orders add constraint paint_orders_ok
  check (btrim(colour) <> '' and pails_5 >= 0 and pails_1 >= 0 and pails_5 + pails_1 > 0
         and pails_5 < 1000 and pails_1 < 1000
         and status in ('requested', 'received', 'cancelled'));
comment on table public.paint_orders is
  'Paint order requests. The page files the row, then the paint-order '
  'edge function emails it to Ashley and stamps emailed_at. A stocked '
  'colour marked received is added to stock on received_on.';
-- Added after the table was first made, so a table from an earlier run
-- of this file gets it too.
alter table public.paint_orders add column if not exists needed_by date;

-- ---------- 5. who changed it, set by the database ----------------------
create or replace function public.paint_stamp()
returns trigger language plpgsql security definer set search_path = public as $$
declare who text;
begin
  select coalesce(nullif(p.name, ''), p.email) into who
    from public.profiles p where p.id = auth.uid();
  if tg_table_name = 'paint_colours' then
    new.updated_at := now(); new.updated_by := who;
  elsif tg_table_name = 'paint_counts' then
    if tg_op = 'INSERT' then new.created_at := now(); new.created_by := who; end if;
  elsif tg_table_name = 'paint_orders' then
    if tg_op = 'INSERT' then
      new.requested_at := now(); new.requested_by := who;
      new.status := 'requested'; new.emailed_at := null;
      new.received_on := null; new.received_by := null;
    else
      -- What was asked for is a record and stays as it was. Only the
      -- arrival, a cancel and the note may change from a page.
      new.colour := old.colour; new.custom := old.custom;
      new.pails_5 := old.pails_5; new.pails_1 := old.pails_1;
      new.for_job := old.for_job; new.needed_by := old.needed_by;
      new.requested_at := old.requested_at;
      new.requested_by := old.requested_by;
      if auth.uid() is not null then new.emailed_at := old.emailed_at; end if;
      if new.status = 'received' and old.status <> 'received' then
        new.received_on := coalesce(new.received_on, current_date); new.received_by := who;
      elsif new.status <> 'received' then
        new.received_on := null; new.received_by := null;
      end if;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists paint_colours_stamp on public.paint_colours;
create trigger paint_colours_stamp before insert or update on public.paint_colours
  for each row execute function public.paint_stamp();
drop trigger if exists paint_counts_stamp on public.paint_counts;
create trigger paint_counts_stamp before insert on public.paint_counts
  for each row execute function public.paint_stamp();
drop trigger if exists paint_orders_stamp on public.paint_orders;
create trigger paint_orders_stamp before insert or update on public.paint_orders
  for each row execute function public.paint_stamp();

-- ---------- 6. the rules ----------------------------------------------------
alter table public.paint_colours  enable row level security;
alter table public.paint_schedule enable row level security;
alter table public.paint_counts   enable row level security;
alter table public.paint_orders   enable row level security;

drop policy if exists paint_colours_read   on public.paint_colours;
drop policy if exists paint_colours_change on public.paint_colours;
create policy paint_colours_read on public.paint_colours
  for select to authenticated using (public.can_use_paint());
-- Coverage and warning levels may be changed; colours are not added or
-- removed from a page, so there is no insert or delete rule.
create policy paint_colours_change on public.paint_colours
  for update to authenticated using (public.can_use_paint()) with check (public.can_use_paint());

drop policy if exists paint_schedule_read on public.paint_schedule;
create policy paint_schedule_read on public.paint_schedule
  for select to authenticated using (public.can_use_paint());

drop policy if exists paint_counts_read   on public.paint_counts;
drop policy if exists paint_counts_add    on public.paint_counts;
drop policy if exists paint_counts_remove on public.paint_counts;
create policy paint_counts_read on public.paint_counts
  for select to authenticated using (public.can_use_paint());
create policy paint_counts_add on public.paint_counts
  for insert to authenticated with check (public.can_use_paint());
-- A count typed wrong can be taken back.
create policy paint_counts_remove on public.paint_counts
  for delete to authenticated using (public.can_use_paint());

drop policy if exists paint_orders_read   on public.paint_orders;
drop policy if exists paint_orders_add    on public.paint_orders;
drop policy if exists paint_orders_change on public.paint_orders;
create policy paint_orders_read on public.paint_orders
  for select to authenticated using (public.can_use_paint());
create policy paint_orders_add on public.paint_orders
  for insert to authenticated with check (public.can_use_paint());
create policy paint_orders_change on public.paint_orders
  for update to authenticated using (public.can_use_paint()) with check (public.can_use_paint());

revoke all on public.paint_colours, public.paint_schedule, public.paint_counts, public.paint_orders
  from anon, public;
revoke all on public.paint_schedule_lines from anon, public;
grant select, update                 on public.paint_colours  to authenticated;
grant select                         on public.paint_schedule to authenticated;
grant select                         on public.paint_schedule_lines to authenticated;
grant select, insert, delete         on public.paint_counts   to authenticated;
grant select, insert, update         on public.paint_orders   to authenticated;
revoke execute on function public.paint_colour_of(text) from public, anon;
grant execute on function public.paint_colour_of(text) to authenticated;
do $$ begin
  execute 'grant all on public.paint_colours, public.paint_schedule, public.paint_counts, public.paint_orders to service_role';
  execute 'grant select on public.paint_schedule_lines to service_role';
  execute 'grant execute on function public.paint_colour_of(text) to service_role';
exception when undefined_object then null;
end $$;

notify pgrst, 'reload schema';

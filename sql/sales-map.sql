-- ====================================================================
--  SALES MAP
--  Run this in the Supabase SQL editor. Safe to run twice, and safe in
--  any order with the other files in sql/.
-- ====================================================================
--
--  Andrew, 26 November: a map of every retail customer, dated by the
--  estimate, coloured by how far they got, to see how the close rate
--  changes with the distance from the showroom. Dealer orders are left
--  out. Admins only.
--
--  Everything comes from the Estimates side of Access (Andrew): the in
--  home visit (MeasureDate), the showroom booking (ShowroomBookedDate,
--  or a Showroom appointment), and the sale (the order's SalesDate).
--  The server script gidc-sales-map-sync.ps1 reads them, places each
--  address with OpenStreetMap (Andrew chose it, 26 November), and sends
--  the lot every hour through the sales-map-sync edge function.
--
--  The colours are worked out on the page, from the three dates, so a
--  rule can change without touching the database.
--
--  THE TABLES
--    sales_map_customers  one row per estimate: name, address, the
--                         dates, and where it sits on the map (lat and
--                         lng empty when the address could not be found).
--    sales_map_showrooms  the three showrooms and where they sit.
--    sales_map_runs       when the server last sent, and its counts.
--
--  WHO MAY
--    can_see_sales_map()  administrators only (Andrew, 26 November). A
--                         list of who may, so every other role, and any
--                         role invented later, sees nothing.
--    Nobody writes from a page. sales_map_load() replaces the lot in one
--    go and only the edge function (service role) may call it.
-- ====================================================================

do $$
begin
  if to_regclass('public.profiles') is null then
    raise exception 'profiles is not here. This is the wrong project.';
  end if;
end $$;

-- ---------- 1. who may ------------------------------------------------
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
    create or replace function public.can_see_sales_map()
    returns boolean language sql stable security definer set search_path = public as $b$
      select exists (select 1 from public.profiles p
                      where p.id = auth.uid() %s
                        and p.role in ('admin'));
    $b$ $f$, act);
end $$;
comment on function public.can_see_sales_map is
  'Who may see the Sales Map: administrators only (Andrew, 26 November). '
  'A list of who may, so dealers, staff and any role invented later are shut out.';
revoke all on function public.can_see_sales_map() from public, anon;
grant execute on function public.can_see_sales_map() to authenticated;

-- ---------- 2. the tables ---------------------------------------------
create table if not exists public.sales_map_customers (
  estimate_id  integer primary key,
  order_no     text,
  name         text,
  address      text,
  city         text,
  postal       text,
  created_on   date not null,
  measure_on   date,
  showroom_on  date,
  sold_on      date,
  lat          double precision,
  lng          double precision,
  placed_by    text,
  loaded_at    timestamptz not null default now()
);
alter table public.sales_map_customers drop constraint if exists sales_map_customers_ok;
alter table public.sales_map_customers add constraint sales_map_customers_ok
  check ((lat is null) = (lng is null)
         and (lat is null or (lat between -90 and 90 and lng between -180 and 180))
         and (placed_by is null or placed_by in ('address', 'postal')));
create index if not exists sales_map_customers_created on public.sales_map_customers (created_on);
-- Andrew, 26 November: filter by the measurement salesperson, the
-- estimate's SalesAssociateID named from def_Employees.CalendarName.
alter table public.sales_map_customers add column if not exists rep text;

comment on table public.sales_map_customers is
  'Retail customers for the Sales Map, one per Access estimate (EstimateID). '
  'measure_on is the in home visit, showroom_on the showroom booking, sold_on '
  'the sale. placed_by says whether the dot is at the street address or only '
  'the postal code. Written only by sales_map_load().';

create table if not exists public.sales_map_showrooms (
  name     text primary key,
  address  text not null,
  lat      double precision,
  lng      double precision,
  sort     integer not null default 100
);
comment on table public.sales_map_showrooms is
  'The showrooms drawn on the Sales Map. Distances are to the nearest one. '
  'Placed by the server script the same way as the customers.';

-- Andrew, 26 November. Added once; the server fills in where they sit.
insert into public.sales_map_showrooms (name, address, sort) values
  ('Cambridge',   '1177 Franklin Blvd, Cambridge, ON',  10),
  ('Mississauga', '2225 Dundas St E, Mississauga, ON',  20),
  ('Burlington',  '18 Plains Road W, Burlington, ON',   30)
on conflict (name) do nothing;

create table if not exists public.sales_map_runs (
  id        integer primary key default 1 check (id = 1),
  ran_at    timestamptz not null default now(),
  counts    jsonb
);

-- ---------- 3. reading: admins only -------------------------------------
alter table public.sales_map_customers enable row level security;
alter table public.sales_map_showrooms enable row level security;
alter table public.sales_map_runs      enable row level security;

drop policy if exists sales_map_customers_read on public.sales_map_customers;
create policy sales_map_customers_read on public.sales_map_customers
  for select to authenticated using (public.can_see_sales_map());
drop policy if exists sales_map_showrooms_read on public.sales_map_showrooms;
create policy sales_map_showrooms_read on public.sales_map_showrooms
  for select to authenticated using (public.can_see_sales_map());
drop policy if exists sales_map_runs_read on public.sales_map_runs;
create policy sales_map_runs_read on public.sales_map_runs
  for select to authenticated using (public.can_see_sales_map());

revoke all on public.sales_map_customers, public.sales_map_showrooms, public.sales_map_runs from anon;
revoke insert, update, delete, truncate on public.sales_map_customers, public.sales_map_showrooms,
  public.sales_map_runs from authenticated;
grant select on public.sales_map_customers, public.sales_map_showrooms, public.sales_map_runs to authenticated;

-- ---------- 4. writing: the server, all or nothing ----------------------
-- Replaces every customer with what was sent, so an estimate that turns
-- into a dealer order, or is deleted in Access, leaves the map too.
-- Showrooms are only updated where they were sent with a place.
create or replace function public.sales_map_load(p_rows jsonb, p_showrooms jsonb, p_counts jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare removed int; added int;
begin
  if jsonb_typeof(p_rows) <> 'array' then raise exception 'rows must be a list'; end if;

  delete from sales_map_customers where true;
  get diagnostics removed = row_count;

  insert into sales_map_customers (estimate_id, order_no, name, rep, address, city, postal,
                                   created_on, measure_on, showroom_on, sold_on,
                                   lat, lng, placed_by, loaded_at)
  select distinct on ((r->>'estimate_id')::int)
         (r->>'estimate_id')::int, r->>'order_no', r->>'name', nullif(btrim(r->>'rep'), ''), r->>'address', r->>'city', r->>'postal',
         (r->>'created_on')::date, (r->>'measure_on')::date, (r->>'showroom_on')::date,
         (r->>'sold_on')::date, (r->>'lat')::float8, (r->>'lng')::float8,
         nullif(r->>'placed_by', ''), now()
    from jsonb_array_elements(p_rows) r
   order by (r->>'estimate_id')::int;
  get diagnostics added = row_count;

  if jsonb_typeof(p_showrooms) = 'array' then
    update sales_map_showrooms s
       set lat = (x->>'lat')::float8, lng = (x->>'lng')::float8
      from jsonb_array_elements(p_showrooms) x
     where s.name = x->>'name' and x->>'lat' is not null and x->>'lng' is not null;
  end if;

  insert into sales_map_runs (id, ran_at, counts) values (1, now(), p_counts)
  on conflict (id) do update set ran_at = excluded.ran_at, counts = excluded.counts;

  return jsonb_build_object('removed', removed, 'added', added);
end $$;
revoke all on function public.sales_map_load(jsonb, jsonb, jsonb) from public, anon, authenticated;
do $$ begin
  execute 'grant execute on function public.sales_map_load(jsonb, jsonb, jsonb) to service_role';
exception when undefined_object then null;
end $$;

notify pgrst, 'reload schema';

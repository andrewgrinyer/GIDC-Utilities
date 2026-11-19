-- ====================================================================
--  DOOR INVENTORY
--  Run this in the Supabase SQL editor. Safe to run twice, and safe in
--  any order with the other files in sql/.
-- ====================================================================
--
--  Andrew, 12 November: a door inventory on the team side, and when a
--  dealer places an order, the order email says if a door on it might
--  already be on the shelf.
--
--  WHAT A DOOR ON THE SHELF IS (agreed with Andrew, 12 November)
--
--    style, width, height, core, how many, and a free notes field for
--    where it is, its condition and its handing.
--
--  NOTHING IS LISTED TWICE
--
--    Andrew asked that door styles and the like be cross referenced
--    against what is already in the database, not kept again here. So
--    this is the one new table, and it holds only what is on the shelf:
--
--      style   picked on the screen from wholesale_prices, the price
--              list, and matched through wholesale_style_alias, so the
--              portal's name for a door and the list's name agree
--      core    one of the price list's own core columns: Hollow, Solid,
--              Bifold, 1.75
--
--  WHAT COUNTS AS A MATCH
--
--    Same style (case, spaces and punctuation ignored, then through the
--    alias table), same core, and exactly the same width and height. The
--    matching itself is done by the send-order edge function, which reads
--    this table and the two above with the service key. The order email
--    goes out as before if this table is not here.
--
--  WHO SEES IT
--
--    Grinyer only. Dealers never see it, through the portal or round it.
--
--      can_see_inventory()     everybody who works here, installers
--                              included, so a crew can check the shelf
--      can_change_inventory()  Grinyer staff: admin, user, sales,
--                              manufacturing. Installers read only.
--
--    Both are allowlists of team roles, like every other helper. A
--    dealer's own access lives in dealer_role (or, before
--    two-sided-access.sql, in role as 'dealer' or 'dealer_admin'), and
--    neither is on either list, so a dealer gets nothing either way.
--
--    If email-verification.sql runs after this file, run this file once
--    more so the two helpers pick up its email rule as well.
-- ====================================================================

do $$
begin
  if to_regclass('public.profiles') is null then
    raise exception 'profiles is not here. This is the wrong project.';
  end if;
end $$;

-- ---------- 1. the table ----------------------------------------------
create table if not exists public.door_inventory (
  id          uuid primary key default gen_random_uuid(),
  style       text not null,
  width_in    numeric(7,3) not null,
  height_in   numeric(7,3),
  core        text,
  qty         integer not null default 1,
  notes       text,
  created_at  timestamptz not null default now(),
  created_by  text,
  updated_at  timestamptz not null default now(),
  updated_by  text
);

-- NOT RECORDED IS ALLOWED FOR HEIGHT AND CORE
-- Andrew's count sheets of 12 November list bifolds by width alone and
-- many doors with no core. Blank means "not written down", never a
-- guess, and such a door matches an order line of any height or core:
-- the email says "may be", and a person looks before cutting. Dropping
-- not null here also brings a table made by the first version of this
-- file into line.
alter table public.door_inventory alter column height_in drop not null;
alter table public.door_inventory alter column core drop not null;

-- Written as separate steps so a second run adds nothing twice.
do $$ begin
  alter table public.door_inventory add constraint door_inventory_style_ok
    check (btrim(style) <> '');
exception when duplicate_object then null; end $$;
alter table public.door_inventory drop constraint if exists door_inventory_size_ok;
alter table public.door_inventory add constraint door_inventory_size_ok
  check (width_in > 0 and width_in < 200
         and (height_in is null or (height_in > 0 and height_in < 200)));
-- Dropped and made again, so the list of cores here is always the one
-- that is live: the price list's own core columns.
alter table public.door_inventory drop constraint if exists door_inventory_core_ok;
alter table public.door_inventory add constraint door_inventory_core_ok
  check (core is null or core in ('Hollow', 'Solid', 'Bifold', '1.75'));
do $$ begin
  alter table public.door_inventory add constraint door_inventory_qty_ok
    check (qty >= 0);
exception when duplicate_object then null; end $$;

comment on table public.door_inventory is
  'Doors on the shelf at Grinyer. Team only: dealers never see it. The '
  'send-order edge function compares every new dealer order against it '
  'and adds a "may be in inventory" note to the order email.';
comment on column public.door_inventory.style     is 'As named on the price list (wholesale_prices).';
comment on column public.door_inventory.width_in  is 'Inches, as on the order form.';
comment on column public.door_inventory.height_in is 'Inches, as on the order form. Blank when not recorded; matches any height.';
comment on column public.door_inventory.core      is 'Hollow, Solid, Bifold or 1.75: the price list''s core columns. Blank when not recorded; matches any core.';
comment on column public.door_inventory.qty       is 'How many are on the shelf. Zero keeps the line but never matches.';

-- ---------- 2. who may ------------------------------------------------
-- Built the same way as is_team() in security-tighten.sql: the active
-- column and the email rule are added only if they exist, so this runs
-- on the database as it is today and as it will be after the login files.
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
    create or replace function public.can_see_inventory()
    returns boolean language sql stable security definer set search_path = public as $b$
      select exists (select 1 from public.profiles p
                      where p.id = auth.uid() %s
                        and p.role in ('admin','user','sales','manufacturing','installer'));
    $b$ $f$, act);

  execute format($f$
    create or replace function public.can_change_inventory()
    returns boolean language sql stable security definer set search_path = public as $b$
      select exists (select 1 from public.profiles p
                      where p.id = auth.uid() %s
                        and p.role in ('admin','user','sales','manufacturing'));
    $b$ $f$, act);
end $$;

comment on function public.can_see_inventory is
  'Who may read the door inventory: everybody who works at Grinyer, '
  'installers included. A list of who may, so a role invented later and '
  'every dealer are shut out.';
comment on function public.can_change_inventory is
  'Who may add, change or remove a door in the inventory: Grinyer staff, '
  'not installers. A list of who may.';

revoke all on function public.can_see_inventory()    from public, anon;
revoke all on function public.can_change_inventory() from public, anon;
grant execute on function public.can_see_inventory()    to authenticated;
grant execute on function public.can_change_inventory() to authenticated;

-- ---------- 3. who changed it last -------------------------------------
-- Set by the database, not taken from the page, so the name is right.
create or replace function public.door_inventory_stamp()
returns trigger language plpgsql security definer set search_path = public as $$
declare who text;
begin
  select coalesce(nullif(p.name, ''), p.email) into who
    from public.profiles p where p.id = auth.uid();
  new.style := btrim(new.style);
  new.updated_at := now();
  new.updated_by := who;
  if tg_op = 'INSERT' then
    new.created_at := now();
    new.created_by := who;
  else
    new.created_at := old.created_at;
    new.created_by := old.created_by;
  end if;
  return new;
end $$;

drop trigger if exists door_inventory_stamp on public.door_inventory;
create trigger door_inventory_stamp
  before insert or update on public.door_inventory
  for each row execute function public.door_inventory_stamp();

-- ---------- 4. the rules ------------------------------------------------
alter table public.door_inventory enable row level security;

drop policy if exists door_inventory_read   on public.door_inventory;
drop policy if exists door_inventory_add    on public.door_inventory;
drop policy if exists door_inventory_change on public.door_inventory;
drop policy if exists door_inventory_remove on public.door_inventory;

create policy door_inventory_read on public.door_inventory
  for select to authenticated using (public.can_see_inventory());
create policy door_inventory_add on public.door_inventory
  for insert to authenticated with check (public.can_change_inventory());
create policy door_inventory_change on public.door_inventory
  for update to authenticated using (public.can_change_inventory())
  with check (public.can_change_inventory());
create policy door_inventory_remove on public.door_inventory
  for delete to authenticated using (public.can_change_inventory());

-- Nobody signed out sees anything at all. The service key, which only
-- the edge functions hold, reads it to match orders.
revoke all on public.door_inventory from anon, public;
grant select, insert, update, delete on public.door_inventory to authenticated;
do $$ begin
  execute 'grant select on public.door_inventory to service_role';
exception when undefined_object then null;
end $$;

notify pgrst, 'reload schema';

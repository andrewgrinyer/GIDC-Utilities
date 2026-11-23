-- ====================================================================
--  ORDER SUPPLIES: shop, sanding and install supplies
--  Run this in the Supabase SQL editor. Safe to run twice, and safe in
--  any order with the other files in sql/. Paint keeps its own tables
--  (paint.sql); this is everything else under Order Supplies.
-- ====================================================================
--
--  Andrew, 20 November: one Order Supplies button on the tools page, and
--  under it Paint, Shop Supplies, Sanding Supplies and Install Supplies,
--  each with its own purchase order numbers. Shop Supplies first, and
--  many of its items can be predicted from the doors in Access.
--
--  THE RULES ANDREW GAVE (20 November)
--
--    PO numbers: SHP, SND or INST, then five digits from 00001. Paint
--      keeps PD.
--    Each item shows the shop's name for it, and in small print the
--      supplier's name for it.
--    Order quantity can be changed; each item has a standard order.
--    Items, suppliers and their email addresses are added on the page.
--    Items ordered together from one supplier go on one PO, emailed to
--      that supplier, with the purchasing manager copied (Ashley,
--      ashley@grinyer.ca).
--    Stock works like paint: a count, taken down as the schedule passes,
--      a warning level.
--    The same people as paint: administrators and the shop.
--
--    What Shop Supplies predicts, from the door lines in Access:
--      Rerail       each rerailed door needs its width of rerail.
--      Pine         bump stops, at the lengths in Access, and a piece the
--                   width of the opening for each door with a valance.
--      Valances     opening 83" high or less takes a small valance, over
--                   83" a large one. Valance stock comes in lengths and
--                   one valance is never pieced from two.
--      Oversize valances are stocked but not in Access, so not predicted.
--    The day a job needs them: two weeks before its installation date,
--      or with none, two weeks after its template date.
--
--  THE TABLES
--
--    supply_categories  Shop, Sanding, Install: name, PO prefix, and who
--                       is copied on every order.
--    supply_suppliers   who items are bought from, and their email.
--    supply_items       what is stocked: names, supplier, unit, warning
--                       level, standard order, and what in Access (if
--                       anything) it is predicted from.
--    supply_counts      physical counts.
--    supply_schedule    what the server sent from Access: per order and
--                       use, the day needed, the total and each cut.
--    supply_orders      one per PO, and when it arrived.
--    supply_order_lines what is on each PO.
--
--  WHO MAY
--
--    can_use_supplies()  admin and manufacturing. An allowlist, so dealers
--                        and any role invented later get nothing.
--    An order is made only through supply_place_order(), which gives the
--    PO number and checks every line, so a page cannot write its own.
--    The schedule is written only by the supplies-sync edge function.
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
    create or replace function public.can_use_supplies()
    returns boolean language sql stable security definer set search_path = public as $b$
      select exists (select 1 from public.profiles p
                      where p.id = auth.uid() %s
                        and p.role in ('admin','manufacturing'));
    $b$ $f$, act);
end $$;
comment on function public.can_use_supplies is
  'Who may see and use Order Supplies: administrators and the shop '
  '(manufacturing). A list of who may, so dealers and any role invented '
  'later are shut out.';
revoke all on function public.can_use_supplies() from public, anon;
grant execute on function public.can_use_supplies() to authenticated;

-- ---------- 2. categories and suppliers ---------------------------------
create table if not exists public.supply_categories (
  code        text primary key,
  name        text not null,
  po_prefix   text not null unique,
  copy_to     text,
  sort        integer not null default 100,
  updated_at  timestamptz not null default now(),
  updated_by  text
);
alter table public.supply_categories drop constraint if exists supply_categories_ok;
alter table public.supply_categories add constraint supply_categories_ok
  check (po_prefix ~ '^[A-Z]{2,5}$' and btrim(name) <> '');
comment on table public.supply_categories is
  'Shop, Sanding and Install supplies. po_prefix starts every PO number. '
  'copy_to is the purchasing manager, copied on every order; commas for several.';

-- Added once. A second run leaves alone whatever was changed on the page.
insert into public.supply_categories (code, name, po_prefix, copy_to, sort) values
  ('shop',    'Shop Supplies',    'SHP',  'ashley@grinyer.ca', 10),
  ('hardware','Hardware',         'HDW',  'ashley@grinyer.ca', 15),
  ('sanding', 'Sanding Supplies', 'SND',  'ashley@grinyer.ca', 20),
  ('install', 'Install Supplies', 'INST', 'ashley@grinyer.ca', 30)
on conflict (code) do nothing;

create table if not exists public.supply_suppliers (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  email       text,
  note        text,
  updated_at  timestamptz not null default now(),
  updated_by  text
);
create unique index if not exists supply_suppliers_same_name
  on public.supply_suppliers (lower(regexp_replace(name, '[^A-Za-z0-9]', '', 'g')));
alter table public.supply_suppliers drop constraint if exists supply_suppliers_ok;
alter table public.supply_suppliers add constraint supply_suppliers_ok
  check (btrim(name) <> ''
         and (email is null or email ~ '^[^@\s,]+@[^@\s,]+\.[^@\s,]+(\s*,\s*[^@\s,]+@[^@\s,]+\.[^@\s,]+)*$'));
comment on table public.supply_suppliers is
  'Who supplies are bought from. A PO goes to email; commas for several.';

-- ---------- 3. items ------------------------------------------------------
create table if not exists public.supply_items (
  id              uuid primary key default gen_random_uuid(),
  category        text not null references public.supply_categories(code),
  shop_name       text not null,
  supplier_item   text,
  supplier_id     uuid references public.supply_suppliers(id) on delete set null,
  unit            text not null default 'piece',
  uses            text,
  per_unit        numeric(9,2),
  waste_pct       numeric(5,1) not null default 10,
  warn_qty        numeric(9,2),
  standard_order  numeric(9,2),
  sort            integer not null default 100,
  updated_at      timestamptz not null default now(),
  updated_by      text
);
alter table public.supply_items drop constraint if exists supply_items_ok;
alter table public.supply_items add constraint supply_items_ok
  check (btrim(shop_name) <> '' and btrim(unit) <> ''
         and (uses is null or uses in ('rerail', 'pine', 'valance_small', 'valance_large', 'doors',
                                       'astragal_7', 'astragal_8', 'hinge', 'track', 'roller_set',
                                       'floor_guide', 'finger_pull', 'flush_bolt'))
         and (uses is null or coalesce(per_unit, 0) > 0)
         and (per_unit is null or per_unit < 100000)
         and waste_pct >= 0 and waste_pct <= 100
         and (warn_qty is null or warn_qty >= 0)
         and (standard_order is null or standard_order >= 0));
-- Andrew, 23 November: hardware comes in sizes and colours, so an item
-- is matched to what Access asks for by its spec as well as its use:
-- for a hinge 'size=3.5; radius=0.25; finish=Satin Nickel', for a track
-- 'length=72', for a finger pull 'shape=round; finish=Black'. Blank
-- for anything with only one kind. The sync writes the same words.
alter table public.supply_items add column if not exists spec text not null default '';
create unique index if not exists supply_items_same_name
  on public.supply_items (category, lower(regexp_replace(shop_name, '[^A-Za-z0-9]', '', 'g')));
comment on table public.supply_items is
  'What is stocked. uses says what in Access predicts it: rerail, pine '
  'and valance_small or valance_large are cuts in inches, per_unit then '
  'being the length of one piece in inches; doors is a door count, '
  'per_unit then being doors per unit. No uses: not predicted, counted only. '
  'waste_pct is added on top of the predicted use.';

-- Shop Supplies as Andrew listed them, added only if Shop has no items
-- yet, so a second run never puts back an item taken off on purpose.
insert into public.supply_items (category, shop_name, unit, uses, per_unit, waste_pct, sort)
select 'shop', v.n, 'piece', v.u, v.p, v.w, v.s
  from (values
    ('Pine 3.5 x .75 x 16'' Primed',      'pine',          192::numeric, 10::numeric, 10),
    ('ReRail 1 1/8 x 1 1/8 Pine x 12''',  'rerail',        144,          10,          20),
    ('Small Valance',                      'valance_small', 192,          10,          30),
    ('Large Valance',                      'valance_large', 192,          10,          40),
    ('Oversize Valance',                   null,            null,         0,           50)
  ) as v(n, u, p, w, s)
 where not exists (select 1 from public.supply_items i where i.category = 'shop');

-- Andrew, 23 November: astragals, 7 and 8 feet, one for each Double
-- Swing AST door, the length by the door's height. Each added once, by
-- name, and from Elmira Doors & Trim when that supplier is on the list.
insert into public.supply_items (category, shop_name, unit, uses, per_unit, waste_pct, sort, supplier_id)
select 'shop', v.n, 'piece', v.u, 1, 0, v.s,
       (select s.id from public.supply_suppliers s
         where lower(regexp_replace(s.name, '[^A-Za-z0-9]', '', 'g')) = 'elmiradoorstrim' limit 1)
  from (values ('Astragal 7''', 'astragal_7', 60), ('Astragal 8''', 'astragal_8', 70)) as v(n, u, s)
 where not exists (select 1 from public.supply_items i
                    where i.category = 'shop' and i.uses = v.u);

-- ---------- 4. the schedule from Access -----------------------------------
create table if not exists public.supply_schedule (
  access_order_id  integer not null,
  uses             text not null,
  order_no         text,
  job              text,
  need_on          date not null,
  amount           numeric(12,2) not null default 0,
  cuts             numeric[] not null default '{}',
  pulled_at        timestamptz not null default now(),
  primary key (access_order_id, uses)
);
-- One row per order, use and spec (Andrew, 23 November: hardware comes
-- in sizes and colours). Added to a table from an earlier run too.
alter table public.supply_schedule add column if not exists spec text not null default '';
do $$
begin
  if not exists (select 1 from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
                  where i.indrelid = 'public.supply_schedule'::regclass and i.indisprimary and a.attname = 'spec') then
    alter table public.supply_schedule drop constraint if exists supply_schedule_pkey;
    alter table public.supply_schedule add primary key (access_order_id, uses, spec);
  end if;
end $$;
comment on table public.supply_schedule is
  'Sent from Access every hour by gidc-supplies-sync.ps1. One row per '
  'order and use. For cut uses, amount is the inches and cuts each piece; '
  'for doors, amount is the door count. need_on is the day it is needed.';

-- THE LOAD. Access is the truth for every order it sends and for every
-- day from keep_before on; days before that stay, so stock already used
-- stays used. One statement each, inside one function, so a failed load
-- changes nothing.
create or replace function public.supply_schedule_load(p_rows jsonb, p_keep_before date)
returns jsonb language plpgsql security definer set search_path = public as $$
declare removed int; added int;
begin
  if jsonb_typeof(p_rows) <> 'array' then raise exception 'rows must be a list'; end if;

  delete from supply_schedule s
   where s.need_on >= p_keep_before
      or s.access_order_id in (select (r->>'order_id')::int from jsonb_array_elements(p_rows) r);
  get diagnostics removed = row_count;

  with r as (
    select (x->>'order_id')::int as o, x->>'uses' as u, coalesce(btrim(x->>'spec'), '') as sp, x
      from jsonb_array_elements(p_rows) x
  ), a as (
    select o, u, sp, max(x->>'order_no') as order_no, max(x->>'job') as job,
           max((x->>'need_on')::date) as need_on,
           sum(coalesce((x->>'amount')::numeric, 0)) as amount
      from r group by o, u, sp
  ), c as (
    select o, u, sp, array_agg(v::numeric order by v::numeric desc) as cuts
      from r, jsonb_array_elements_text(coalesce(x->'cuts', '[]'::jsonb)) v
     group by o, u, sp
  )
  insert into supply_schedule (access_order_id, uses, spec, order_no, job, need_on, amount, cuts, pulled_at)
  select a.o, a.u, a.sp, a.order_no, a.job, a.need_on, a.amount, coalesce(c.cuts, '{}'), now()
    from a left join c on c.o = a.o and c.u = a.u and c.sp = a.sp
   where a.need_on is not null;
  get diagnostics added = row_count;

  return jsonb_build_object('removed', removed, 'added', added);
end $$;
revoke all on function public.supply_schedule_load(jsonb, date) from public, anon, authenticated;
do $$ begin
  execute 'grant execute on function public.supply_schedule_load(jsonb, date) to service_role';
exception when undefined_object then null;
end $$;

-- ---------- 5. counts -------------------------------------------------------
create table if not exists public.supply_counts (
  id          uuid primary key default gen_random_uuid(),
  item_id     uuid not null references public.supply_items(id) on delete cascade,
  qty         numeric(9,2) not null,
  counted_on  date not null default current_date,
  note        text,
  created_at  timestamptz not null default now(),
  created_by  text
);
alter table public.supply_counts drop constraint if exists supply_counts_ok;
alter table public.supply_counts add constraint supply_counts_ok check (qty >= 0 and qty < 1000000);
comment on table public.supply_counts is
  'Physical counts. A count is the stock at the end of that day and '
  'replaces the estimate.';

-- ---------- 6. orders ---------------------------------------------------------
create table if not exists public.supply_orders (
  id            uuid primary key default gen_random_uuid(),
  category      text not null references public.supply_categories(code),
  po_no         text not null,
  supplier_id   uuid references public.supply_suppliers(id) on delete set null,
  supplier_name text,
  needed_by     date,
  note          text,
  status        text not null default 'requested',
  requested_at  timestamptz not null default now(),
  requested_by  text,
  sent_to       text,
  copied_to     text,
  emailed_at    timestamptz,
  received_on   date,
  received_by   text
);
alter table public.supply_orders drop constraint if exists supply_orders_ok;
alter table public.supply_orders add constraint supply_orders_ok
  check (status in ('requested', 'received', 'cancelled'));
create unique index if not exists supply_orders_po on public.supply_orders (po_no);
comment on table public.supply_orders is
  'One per purchase order. Made by supply_place_order(), emailed by the '
  'supply-order edge function, which stamps sent_to, copied_to and '
  'emailed_at. Marked received, its lines are added to stock on received_on.';

create table if not exists public.supply_order_lines (
  id             uuid primary key default gen_random_uuid(),
  order_id       uuid not null references public.supply_orders(id) on delete cascade,
  item_id        uuid references public.supply_items(id) on delete set null,
  shop_name      text not null,
  supplier_item  text,
  unit           text not null,
  qty            numeric(9,2) not null
);
alter table public.supply_order_lines drop constraint if exists supply_order_lines_ok;
alter table public.supply_order_lines add constraint supply_order_lines_ok check (qty > 0 and qty < 100000);
create index if not exists supply_order_lines_order on public.supply_order_lines (order_id);
comment on table public.supply_order_lines is
  'What is on each PO, with the names as they were when it was sent, so '
  'renaming or removing an item later leaves the record as it was.';

-- PURCHASE ORDER NUMBERS: the prefix, then one more than the highest so
-- far under that prefix, under a lock, so two orders at the same moment
-- never share a number and a refused order leaves no gap.
create or replace function public.supply_next_po(p_prefix text)
returns text language plpgsql volatile security definer set search_path = public as $$
declare n bigint;
begin
  if p_prefix !~ '^[A-Z]{2,5}$' then raise exception 'Bad PO prefix'; end if;
  perform pg_advisory_xact_lock(hashtext('gidc supply po ' || p_prefix));
  select coalesce(max(substring(po_no from length(p_prefix) + 1)::bigint), 0) + 1 into n
    from public.supply_orders where po_no ~ ('^' || p_prefix || '[0-9]+$');
  return p_prefix || case when n < 100000 then lpad(n::text, 5, '0') else n::text end;
end $$;
revoke all on function public.supply_next_po(text) from public, anon, authenticated;

-- PLACING AN ORDER: one supplier, one PO, several lines. The page calls
-- this once for each supplier in what was picked.
create or replace function public.supply_place_order(
  p_category text, p_supplier uuid, p_lines jsonb, p_needed_by date default null, p_note text default null)
returns public.supply_orders language plpgsql volatile security definer set search_path = public as $$
declare cat public.supply_categories; sup public.supply_suppliers; o public.supply_orders;
        who text; l jsonb; it public.supply_items; q numeric; n int := 0;
begin
  if not public.can_use_supplies() then
    raise exception 'Only the shop and administrators can order supplies.' using errcode = '42501';
  end if;
  select * into cat from supply_categories where code = p_category;
  if cat.code is null then raise exception 'No such supplies list.'; end if;
  if p_supplier is not null then
    select * into sup from supply_suppliers where id = p_supplier;
    if sup.id is null then raise exception 'That supplier is not on the list any more.'; end if;
  end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'Nothing to order.';
  end if;
  select coalesce(nullif(p.name, ''), p.email) into who from profiles p where p.id = auth.uid();

  insert into supply_orders (category, po_no, supplier_id, supplier_name, needed_by, note, requested_by)
  values (cat.code, supply_next_po(cat.po_prefix), sup.id, sup.name, p_needed_by,
          nullif(btrim(coalesce(p_note, '')), ''), who)
  returning * into o;

  for l in select * from jsonb_array_elements(p_lines) loop
    select * into it from supply_items where id = (l->>'item_id')::uuid;
    if it.id is null or it.category <> cat.code then raise exception 'An item is not on this list.'; end if;
    if it.supplier_id is distinct from p_supplier then
      raise exception '% is not from that supplier.', it.shop_name;
    end if;
    q := (l->>'qty')::numeric;
    if q is null or q <= 0 then raise exception 'Order more than nothing of %.', it.shop_name; end if;
    insert into supply_order_lines (order_id, item_id, shop_name, supplier_item, unit, qty)
    values (o.id, it.id, it.shop_name, it.supplier_item, it.unit, q);
    n := n + 1;
  end loop;
  return o;
end $$;
revoke all on function public.supply_place_order(text, uuid, jsonb, date, text) from public, anon;
grant execute on function public.supply_place_order(text, uuid, jsonb, date, text) to authenticated;

-- ---------- 7. who changed it, set by the database ----------------------
create or replace function public.supply_stamp()
returns trigger language plpgsql security definer set search_path = public as $$
declare who text;
begin
  select coalesce(nullif(p.name, ''), p.email) into who
    from public.profiles p where p.id = auth.uid();
  if tg_table_name in ('supply_categories', 'supply_suppliers', 'supply_items') then
    new.updated_at := now(); new.updated_by := who;
  end if;
  if tg_table_name = 'supply_categories' and tg_op = 'UPDATE' then
    -- Only who is copied may change from a page.
    new.code := old.code; new.name := old.name; new.po_prefix := old.po_prefix; new.sort := old.sort;
    new.copy_to := nullif(btrim(coalesce(new.copy_to, '')), '');
  elsif tg_table_name = 'supply_suppliers' then
    new.name := btrim(regexp_replace(coalesce(new.name, ''), '\s+', ' ', 'g'));
    new.email := nullif(lower(btrim(coalesce(new.email, ''))), '');
  elsif tg_table_name = 'supply_items' then
    new.shop_name := btrim(regexp_replace(coalesce(new.shop_name, ''), '\s+', ' ', 'g'));
    new.supplier_item := nullif(btrim(coalesce(new.supplier_item, '')), '');
    new.unit := coalesce(nullif(btrim(coalesce(new.unit, '')), ''), 'piece');
    new.spec := btrim(coalesce(new.spec, ''));
    if tg_op = 'UPDATE' then new.category := old.category; end if;
  elsif tg_table_name = 'supply_counts' then
    if tg_op = 'INSERT' then new.created_at := now(); new.created_by := who; end if;
  elsif tg_table_name = 'supply_orders' then
    if tg_op = 'UPDATE' then
      -- What was asked for is a record. From a page only the arrival, a
      -- cancel and the note may change; the email function, with the
      -- service key, stamps when and where it went.
      new.category := old.category; new.po_no := old.po_no;
      new.supplier_id := old.supplier_id; new.supplier_name := old.supplier_name;
      new.needed_by := old.needed_by;
      new.requested_at := old.requested_at; new.requested_by := old.requested_by;
      if auth.uid() is not null then
        new.emailed_at := old.emailed_at; new.sent_to := old.sent_to; new.copied_to := old.copied_to;
      end if;
      if new.status = 'received' and old.status <> 'received' then
        new.received_on := coalesce(new.received_on, current_date); new.received_by := who;
      elsif new.status <> 'received' then
        new.received_on := null; new.received_by := null;
      end if;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists supply_categories_stamp on public.supply_categories;
create trigger supply_categories_stamp before update on public.supply_categories
  for each row execute function public.supply_stamp();
drop trigger if exists supply_suppliers_stamp on public.supply_suppliers;
create trigger supply_suppliers_stamp before insert or update on public.supply_suppliers
  for each row execute function public.supply_stamp();
drop trigger if exists supply_items_stamp on public.supply_items;
create trigger supply_items_stamp before insert or update on public.supply_items
  for each row execute function public.supply_stamp();
drop trigger if exists supply_counts_stamp on public.supply_counts;
create trigger supply_counts_stamp before insert on public.supply_counts
  for each row execute function public.supply_stamp();
drop trigger if exists supply_orders_stamp on public.supply_orders;
create trigger supply_orders_stamp before update on public.supply_orders
  for each row execute function public.supply_stamp();

-- ---------- 8. the rules ----------------------------------------------------
alter table public.supply_categories  enable row level security;
alter table public.supply_suppliers   enable row level security;
alter table public.supply_items       enable row level security;
alter table public.supply_schedule    enable row level security;
alter table public.supply_counts      enable row level security;
alter table public.supply_orders      enable row level security;
alter table public.supply_order_lines enable row level security;

do $$
declare t text;
begin
  foreach t in array array['supply_categories','supply_suppliers','supply_items','supply_schedule',
                           'supply_counts','supply_orders','supply_order_lines'] loop
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.can_use_supplies())',
                   t || '_read', t);
  end loop;
  -- Suppliers and items are added, changed and removed on the page.
  foreach t in array array['supply_suppliers','supply_items'] loop
    execute format('drop policy if exists %I on public.%I', t || '_add', t);
    execute format('drop policy if exists %I on public.%I', t || '_change', t);
    execute format('drop policy if exists %I on public.%I', t || '_remove', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.can_use_supplies())', t || '_add', t);
    execute format('create policy %I on public.%I for update to authenticated using (public.can_use_supplies()) with check (public.can_use_supplies())', t || '_change', t);
    execute format('create policy %I on public.%I for delete to authenticated using (public.can_use_supplies())', t || '_remove', t);
  end loop;
end $$;

drop policy if exists supply_categories_change on public.supply_categories;
create policy supply_categories_change on public.supply_categories
  for update to authenticated using (public.can_use_supplies()) with check (public.can_use_supplies());

drop policy if exists supply_counts_add    on public.supply_counts;
drop policy if exists supply_counts_remove on public.supply_counts;
create policy supply_counts_add on public.supply_counts
  for insert to authenticated with check (public.can_use_supplies());
create policy supply_counts_remove on public.supply_counts
  for delete to authenticated using (public.can_use_supplies());

drop policy if exists supply_orders_change on public.supply_orders;
create policy supply_orders_change on public.supply_orders
  for update to authenticated using (public.can_use_supplies()) with check (public.can_use_supplies());

revoke all on public.supply_categories, public.supply_suppliers, public.supply_items, public.supply_schedule,
              public.supply_counts, public.supply_orders, public.supply_order_lines
  from anon, public, authenticated;
grant select, update                 on public.supply_categories  to authenticated;
grant select, insert, update, delete on public.supply_suppliers   to authenticated;
grant select, insert, update, delete on public.supply_items       to authenticated;
grant select                         on public.supply_schedule    to authenticated;
grant select, insert, delete         on public.supply_counts      to authenticated;
grant select, update                 on public.supply_orders      to authenticated;
grant select                         on public.supply_order_lines to authenticated;
do $$ begin
  execute 'grant all on public.supply_categories, public.supply_suppliers, public.supply_items, '
          'public.supply_schedule, public.supply_counts, public.supply_orders, public.supply_order_lines to service_role';
exception when undefined_object then null;
end $$;

notify pgrst, 'reload schema';

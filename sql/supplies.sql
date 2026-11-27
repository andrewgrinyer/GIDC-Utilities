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
  ('install', 'Install Supplies', 'INST', 'ashley@grinyer.ca', 30),
  -- Andrew, 23 November: painting supplies, all ordered through Ashley.
  ('painting','Painting Supplies','PNT',  'ashley@grinyer.ca', 5),
  -- Andrew, 27 November: pallets from Grand River Pallets and packing
  -- materials from Uline, all ordered through Ashley.
  ('packaging','Packaging Materials','PKG','ashley@grinyer.ca', 40)
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
  per_unit        numeric(12,4),
  waste_pct       numeric(5,1) not null default 10,
  warn_qty        numeric(9,2),
  standard_order  numeric(9,2),
  sort            integer not null default 100,
  updated_at      timestamptz not null default now(),
  updated_by      text
);
-- PRICES AND PACKS (Andrew, 27 November: a price on every item, for an
-- inventory value tool to come, and Uline sells by the carton, bundle
-- and case). order_step is how many of the item's unit come in one pack
-- (30 corner protectors a carton); pack_name is what the pack is called.
-- price is for one of the item's unit (Andrew, 27 November: per gallon
-- of paint, per roll of foam, per corner protector, per piece of pine),
-- never per pack. Blank until somebody types it.
-- per_unit takes four places now: stretch wrap is 200 ft of a 1,500 ft
-- roll on each pallet, 0.1333 of a roll.
alter table public.supply_items add column if not exists price      numeric(12,4);
alter table public.supply_items add column if not exists order_step numeric(9,2);
alter table public.supply_items add column if not exists pack_name  text;
do $$
begin
  if (select numeric_scale from information_schema.columns
       where table_schema = 'public' and table_name = 'supply_items' and column_name = 'per_unit') < 4 then
    alter table public.supply_items alter column per_unit type numeric(12,4);
  end if;
  -- a strap guard is about 15 cents, so a price per item takes four places
  if (select numeric_scale from information_schema.columns
       where table_schema = 'public' and table_name = 'supply_items' and column_name = 'price') < 4 then
    alter table public.supply_items alter column price type numeric(12,4);
  end if;
end $$;
alter table public.supply_items drop constraint if exists supply_items_ok;
alter table public.supply_items add constraint supply_items_ok
  check (btrim(shop_name) <> '' and btrim(unit) <> ''
         and (uses is null or uses in ('rerail', 'pine', 'valance_small', 'valance_large', 'doors',
                                       'astragal_7', 'astragal_8', 'hinge', 'track', 'roller_set',
                                       'floor_guide', 'finger_pull', 'flush_bolt',
                                       'pallet', 'door_foam'))
         and (uses is null or coalesce(per_unit, 0) > 0)
         and (per_unit is null or per_unit < 100000)
         and waste_pct >= 0 and waste_pct <= 100
         and (warn_qty is null or warn_qty >= 0)
         and (standard_order is null or standard_order >= 0)
         and (price is null or (price >= 0 and price < 10000000))
         and (order_step is null or (order_step > 0 and order_step < 100000)));
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

-- THE SUPPLIERS ANDREW NAMED (23 November). Added once, by name.
--   Elmira Doors & Trim: shop supplies, bypass tracks and rollers, astragals.
--   Onward: hinges, finger pulls, floor guides and flush bolts. Onward
--     takes orders through its own portal, so it has no email here: an
--     Onward PO goes to Ashley alone, as a request for her to place it.
insert into public.supply_suppliers (name, email, note)
select v.n, v.e, v.note
  from (values ('Elmira Doors & Trim', 'mike@elmiradoorandtrim.com', null::text),
               ('Onward', null, 'Orders through the Onward portal. POs go to Ashley to place.')) as v(n, e, note)
 where not exists (select 1 from public.supply_suppliers s
                    where lower(regexp_replace(s.name, '[^A-Za-z0-9]', '', 'g'))
                        = lower(regexp_replace(v.n, '[^A-Za-z0-9]', '', 'g')));

-- THE HARDWARE LIST (Andrew, 23 November), added only if Hardware has
-- no items yet. spec is matched to what the sync sends, word for word.
do $$
declare elm uuid; onw uuid; sz text; cr text; fin text; n int := 0;
        sizes text[] := array['3', '3.5', '4'];
        corners text[] := array['square', '1/4 radius', '5/8 radius'];
        finishes text[] := array['Satin Nickel', 'Bright Brass', 'Black', 'Aged Bronze', 'Chrome'];
begin
  if exists (select 1 from public.supply_items where category = 'hardware') then return; end if;
  select id into elm from public.supply_suppliers where lower(regexp_replace(name, '[^A-Za-z0-9]', '', 'g')) = 'elmiradoorstrim' limit 1;
  select id into onw from public.supply_suppliers where lower(regexp_replace(name, '[^A-Za-z0-9]', '', 'g')) = 'onward' limit 1;

  foreach sz in array sizes loop
    foreach cr in array corners loop
      foreach fin in array finishes loop
        n := n + 1;
        insert into public.supply_items (category, shop_name, unit, uses, spec, per_unit, waste_pct, sort, supplier_id)
        values ('hardware', 'Hinge ' || sz || '" ' || cr || ' ' || fin, 'hinge', 'hinge',
                'size=' || sz || '; corner=' || cr || '; finish=' || fin, 1, 0, 100 + n, onw);
      end loop;
    end loop;
  end loop;

  insert into public.supply_items (category, shop_name, unit, uses, spec, per_unit, waste_pct, sort, supplier_id)
  select 'hardware', 'Bypass track ' || l || '"', 'track', 'track', 'length=' || l, 1, 0, 200 + l::int / 12, elm
    from unnest(array['48', '60', '72', '96']) as l;
  insert into public.supply_items (category, shop_name, unit, uses, spec, per_unit, waste_pct, sort, supplier_id) values
    ('hardware', 'Extra roller set', 'set', 'roller_set', '', 1, 0, 220, elm),
    ('hardware', 'Floor guide', 'piece', 'floor_guide', '', 1, 0, 230, onw);

  n := 0;
  foreach fin in array finishes loop
    n := n + 1;
    -- Round finger pulls are bought in pairs (Andrew, 23 November).
    insert into public.supply_items (category, shop_name, unit, uses, spec, per_unit, waste_pct, sort, supplier_id) values
      ('hardware', 'Finger pull round ' || fin, 'pair', 'finger_pull', 'shape=round; finish=' || fin, 2, 0, 300 + n, onw),
      ('hardware', 'Finger pull square ' || fin, 'piece', 'finger_pull', 'shape=square; finish=' || fin, 1, 0, 310 + n, onw),
      ('hardware', 'Flush bolt 6" radius bottom ' || fin, 'piece', 'flush_bolt', 'finish=' || fin, 1, 0, 400 + n, onw);
  end loop;
end $$;

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

-- PAINTING AND SANDING SUPPLIES (Andrew, 23 November). Counted only,
-- nothing in Access predicts them. Each list is filled once, only while
-- it has no items, so a second run never puts back an item taken off.
--   Painting: every order goes to Ashley (Sherwin Williams, Allied Stars
--     and GFL have no email here, so their POs go to her alone).
--   Sanding: Mirka discs, backing pads and vacuum bags from Abrasive
--     Supply (info@abrasivesupply.ca, Ashley copied). Bondo, DryDex and
--     Wood Pro through Ashley (no supplier, so the PO goes to her alone).
insert into public.supply_suppliers (name, email, note)
select v.n, v.e, v.note
  from (values ('Sherwin Williams', null::text, 'Ashley places these orders.'),
               ('Allied Stars', null, 'Ashley places these orders.'),
               ('GFL', null, 'Waste paint barrels and paint wash pickup. Pickup needs at least 3 barrels. Ashley places these orders.'),
               ('Abrasive Supply', 'info@abrasivesupply.ca', null)) as v(n, e, note)
 where not exists (select 1 from public.supply_suppliers s
                    where lower(regexp_replace(s.name, '[^A-Za-z0-9]', '', 'g'))
                        = lower(regexp_replace(v.n, '[^A-Za-z0-9]', '', 'g')));

do $$
declare sw uuid; al uuid; gfl uuid; ab uuid;
begin
  select id into sw  from public.supply_suppliers where lower(regexp_replace(name, '[^A-Za-z0-9]', '', 'g')) = 'sherwinwilliams' limit 1;
  select id into al  from public.supply_suppliers where lower(regexp_replace(name, '[^A-Za-z0-9]', '', 'g')) = 'alliedstars' limit 1;
  select id into gfl from public.supply_suppliers where lower(regexp_replace(name, '[^A-Za-z0-9]', '', 'g')) = 'gfl' limit 1;
  select id into ab  from public.supply_suppliers where lower(regexp_replace(name, '[^A-Za-z0-9]', '', 'g')) = 'abrasivesupply' limit 1;

  if not exists (select 1 from public.supply_items where category = 'painting') then
    insert into public.supply_items (category, shop_name, supplier_item, unit, standard_order, sort, supplier_id) values
      ('painting', 'Paint pockets 20 x 20',      '20x20 paint pockets, box of 30', 'box',    0, 10, sw),
      ('painting', 'Floor paper',                null,                              'roll',   0, 20, al),
      ('painting', 'Acetone',                    null,                              'jug',    0, 30, sw),
      ('painting', 'Pre filter roll',            null,                              'roll',   0, 40, sw),
      ('painting', 'Waste paint barrel',         null,                              'barrel', 0, 50, gfl),
      ('painting', 'Lubricant P',                null,                              'can',    0, 60, al),
      ('painting', 'Paint wash pickup',          'Paint wash pickup, 3 barrel minimum', 'barrel', 3, 70, gfl),
      ('painting', 'Paint sprayer tip 09 114',   'Kremlin tip 09-114',              'tip',    0, 80, al);
  end if;

  if not exists (select 1 from public.supply_items where category = 'sanding') then
    insert into public.supply_items (category, shop_name, supplier_item, unit, sort, supplier_id) values
      ('sanding', 'Sanding disc 60 grit',  'Mirka Abranet Ace Grip 6in P60, 50 pieces, AC-241-060',  'box', 10, ab),
      ('sanding', 'Sanding disc 80 grit',  'Mirka Abranet Ace Grip 6in P80, 50 pieces, AC-241-080',  'box', 15, ab),
      ('sanding', 'Sanding disc 120 grit', 'Mirka Abranet Ace Grip 6in P120, 50 pieces, AC-241-120', 'box', 20, ab),
      ('sanding', 'Sanding disc 240 grit', 'Mirka Abranet Ace Grip 6in P240, 50 pieces, AC-241-240', 'box', 30, ab),
      ('sanding', 'Sanding disc 320 grit', 'Mirka Abranet Ace Grip 6in P320, 50 pieces, AC-241-320', 'box', 40, ab),
      ('sanding', 'Backing pad 6in',       'Mirka 6in Grip backing pad',                              'pad', 50, ab),
      ('sanding', 'Vacuum bags',           'Mirka Dustbag Fleece for DE 1230',                        'bag', 60, ab),
      ('sanding', 'Bondo',                 '3M Bondo Body Filler 261C, 397 g',                        'can', 70, null),
      ('sanding', 'DryDex',                'DAP DryDex Spackling, 237 mL',                            'tub', 80, null),
      ('sanding', 'Wood Pro',              'DAP Wood Pro wood filler, Natural, 453 g, 52268',         'tub', 90, null);
  end if;
end $$;

-- More for Sanding (Andrew, 23 November), each added once by name so a
-- list already filled still gets them: the vacuum pad, the pad protector
-- and the 3" x 4" square sheets for the square sander.
insert into public.supply_items (category, shop_name, supplier_item, unit, sort, supplier_id)
select 'sanding', v.n, v.si, v.u, v.s,
       (select id from public.supply_suppliers where lower(regexp_replace(name, '[^A-Za-z0-9]', '', 'g')) = 'abrasivesupply' limit 1)
  from (values ('Vacuum pad 6in 48 hole', 'Mirka 6in Grip 48 Hole Vacuum Pad', 'pad', 52),
               ('Pad protector 6in',      'Mirka Pad Protector 6 Inch',         'piece', 55),
               ('Square sheet 240 grit',  'Mirka Abranet Ace 3in x 4in Grip P240', 'box', 44),
               ('Square sheet 320 grit',  'Mirka Abranet Ace 3in x 4in Grip P320', 'box', 46)) as v(n, si, u, s)
 where not exists (select 1 from public.supply_items i
                    where i.category = 'sanding'
                      and lower(regexp_replace(i.shop_name, '[^A-Za-z0-9]', '', 'g'))
                        = lower(regexp_replace(v.n, '[^A-Za-z0-9]', '', 'g')));

-- Predicted discs (Andrew, 23 November): every door is sanded twice,
-- once at 240 grit (one disc lasts about 4 doors) and once at 320 (about
-- 10 doors). From the door count the sync already sends, a box of 50
-- covers 200 doors at 240 and 500 at 320. Set only while the disc is not
-- predicted yet, so a length changed by hand is kept.
update public.supply_items set uses = 'doors', per_unit = 200, waste_pct = 0
 where category = 'sanding' and uses is null
   and lower(regexp_replace(shop_name, '[^A-Za-z0-9]', '', 'g')) = 'sandingdisc240grit';
update public.supply_items set uses = 'doors', per_unit = 500, waste_pct = 0
 where category = 'sanding' and uses is null
   and lower(regexp_replace(shop_name, '[^A-Za-z0-9]', '', 'g')) = 'sandingdisc320grit';

-- PACKAGING MATERIALS (Andrew, 27 November). Pallets from Grand River
-- Pallets and everything else from Uline, all ordered through Ashley,
-- so neither supplier has an email here and their POs go to her alone.
-- What a pallet uses, from the pallets in the dealer portal:
--   every pallet: one shipping pallet, 4 corner protectors, 10 strap
--     guards, 2 No Stack cones, about 200 ft of stretch wrap, 50 ft of tape
--   every door on it: one layer of foam, the door's height plus 12"
-- Uline's packs (uline.com, 27 November): foam S-1098 2 rolls a bundle
-- (Andrew orders rolls in pairs), corner protectors S-14337 30 a carton,
-- strap guards S-765 1,000 a carton, cones S-22361 50 a bundle, stretch
-- wrap S-2187 4 rolls a case, tape S-200 (2" x 55 yds, 165 ft a roll)
-- 36 rolls a case. Only dealer orders are packed on pallets; a double
-- door is two doors, so two lengths of foam.
-- per_unit for 'pallet' is how much of the item's unit one pallet uses;
-- for 'door_foam' it is the length of one roll in inches (1,250 ft).
insert into public.supply_suppliers (name, email, note)
select v.n, null, v.note
  from (values ('Grand River Pallets', 'Ashley places these orders.'),
               ('Uline', 'Ashley places these orders.')) as v(n, note)
 where not exists (select 1 from public.supply_suppliers s
                    where lower(regexp_replace(s.name, '[^A-Za-z0-9]', '', 'g'))
                        = lower(regexp_replace(v.n, '[^A-Za-z0-9]', '', 'g')));

do $$
declare grp uuid; ul uuid;
begin
  select id into grp from public.supply_suppliers where lower(regexp_replace(name, '[^A-Za-z0-9]', '', 'g')) = 'grandriverpallets' limit 1;
  select id into ul  from public.supply_suppliers where lower(regexp_replace(name, '[^A-Za-z0-9]', '', 'g')) = 'uline' limit 1;
  if not exists (select 1 from public.supply_items where category = 'packaging') then
    insert into public.supply_items (category, shop_name, supplier_item, unit, uses, per_unit, waste_pct,
                                     order_step, pack_name, standard_order, sort, supplier_id) values
      ('packaging', 'Shipping pallet 99 x 40', '99" x 40" new block pallet, solid top',
         'pallet', 'pallet', 1, 0, null, null, null, 10, grp),
      ('packaging', 'Door foam', 'S-1098 Foam roll, non perforated, 1/16", 36" x 1,250''',
         'roll', 'door_foam', 15000, 0, 2, 'bundle', 2, 20, ul),
      ('packaging', 'Corner protectors', 'S-14337 Heavy duty edge protectors, .225" thick, 2 1/2 x 2 1/2 x 72"',
         'piece', 'pallet', 4, 0, 30, 'carton', 30, 30, ul),
      ('packaging', 'Strap guards', 'S-765 Strap guards, 2 1/2 x 2", white',
         'piece', 'pallet', 10, 0, 1000, 'carton', 1000, 40, ul),
      ('packaging', 'No Stack cones', 'S-22361 No Stack pallet cones, red',
         'piece', 'pallet', 2, 0, 50, 'bundle', 50, 50, ul),
      ('packaging', 'Stretch wrap', 'S-2187 Stretch wrap, cast, 70 gauge, 18" x 1,500''',
         'roll', 'pallet', 0.1333, 0, 4, 'case', 4, 60, ul),
      ('packaging', 'Packing tape', 'S-200 Uline industrial tape, 2 mil, 2" x 55 yds, clear',
         'roll', 'pallet', 0.3030, 0, 36, 'case', 36, 70, ul);
  end if;
  -- a list filled before the tape's part number was known (3.10)
  update public.supply_items
     set supplier_item = 'S-200 Uline industrial tape, 2 mil, 2" x 55 yds, clear',
         uses = 'pallet', per_unit = 0.3030, waste_pct = 0, order_step = 36, pack_name = 'case',
         standard_order = coalesce(standard_order, 36)
   where category = 'packaging' and uses is null
     and supplier_item = 'Uline industrial tape (part number to confirm)';
end $$;

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

-- WHAT THE PALLETS USED (Andrew, 27 November: one shipping pallet for
-- every packed pallet, foam for every door on it, all of it known in the
-- dealer portal). One row per pallet with at least one order on it, on
-- the day it was built: its name, its doors and the foam they take.
-- A door is a level on the pallet, as the portal counts them: one per
-- door on the line, a bifold pair being one. Foam is the door's height
-- on the order plus 12". Read by the Packaging Materials page, which
-- takes stock down by it the way the Access schedule does. Empty when
-- the portal's pallet tables are not in this database.
create or replace function public.supply_pallet_use(p_from date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare out jsonb;
begin
  if not public.can_use_supplies() then raise exception 'not allowed'; end if;
  if to_regclass('public.pallets') is null or to_regclass('public.pallet_orders') is null
     or to_regclass('public.dealer_orders') is null then
    return '[]'::jsonb;
  end if;
  with lines as (
    select po.pallet_id::text as pid, r
      from pallet_orders po
      join dealer_orders o on o.id::text = po.order_id::text
      left join lateral jsonb_array_elements(
             case when jsonb_typeof(o.form::jsonb -> 'rows') = 'array' then o.form::jsonb -> 'rows' else '[]'::jsonb end) r on true
  ), doors as (
    select pid,
           sum(case when r is null then 0
                    else greatest(1, coalesce(substring(r->>'qty' from '^\s*(\d+)')::int, 1)) end) as doors,
           sum(case when r is null then 0
                    else greatest(1, coalesce(substring(r->>'qty' from '^\s*(\d+)')::int, 1))
                       * (coalesce(substring(r->>'height' from '^\s*(\d+(?:\.\d+)?)')::numeric, 80) + 12) end) as foam
      from lines group by pid
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'pallet_id', p.id::text, 'name', p.name, 'day', p.built_on,
           'doors', d.doors, 'foam_in', d.foam) order by p.built_on, p.name), '[]'::jsonb)
    into out
    from pallets p join doors d on d.pid = p.id::text
   where p.built_on >= p_from;
  return out;
end $$;
revoke all on function public.supply_pallet_use(date) from public, anon;
grant execute on function public.supply_pallet_use(date) to authenticated;

-- WHAT THE PALLETS WILL USE (Andrew, 27 November). Two parts: an order
-- is forecast from its Packaging Date in Access until it goes on a pallet
-- in the portal, and from then on the pallet itself counts it (see
-- supply_pallet_use). Here: every dealer order linked to its Access job,
-- not shipped, not a draft, not on hold, not on a pallet yet, whose Access
-- Packaging Date (access_dealer_orders.packed_on, sent hourly by the
-- dealer sync) is on or before p_to. Counted the same way as on a pallet:
-- its doors, and the foam they take. One row per dealer and packaging
-- date, since a pallet carries one dealer; a date already past counts as
-- today. The page packs the doors into pallets of 20 to 45.
create or replace function public.supply_pallet_ahead(p_to date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare out jsonb;
begin
  if not public.can_use_supplies() then raise exception 'not allowed'; end if;
  if to_regclass('public.dealer_orders') is null or to_regclass('public.pallet_orders') is null
     or to_regclass('public.access_dealer_orders') is null then
    return '[]'::jsonb;
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'dealer_orders' and column_name = 'access_order_id') then
    return '[]'::jsonb;
  end if;
  execute $q$
    with o as (
      select o.id, o.dealer_id, greatest(s.packed_on, current_date) as pack_on, o.form
        from dealer_orders o
        join access_dealer_orders s on s.order_id = o.access_order_id
       where s.packed_on is not null and s.packed_on <= $1
         and o.status::text not in ('draft', 'shipped', 'on_hold')
         and not exists (select 1 from pallet_orders po where po.order_id::text = o.id::text)
    ), lines as (
      select o.id, o.dealer_id, o.pack_on, r
        from o left join lateral jsonb_array_elements(
               case when jsonb_typeof(o.form::jsonb -> 'rows') = 'array' then o.form::jsonb -> 'rows' else '[]'::jsonb end) r on true
    )
    select coalesce(jsonb_agg(jsonb_build_object('dealer_id', g.dealer_id::text, 'pack_on', g.pack_on,
                     'orders', g.orders, 'doors', g.doors, 'foam_in', g.foam) order by g.dealer_id::text, g.pack_on), '[]'::jsonb)
      from (select dealer_id, pack_on, count(distinct id) as orders,
                   sum(case when r is null then 0
                            else greatest(1, coalesce(substring(r->>'qty' from '^\s*(\d+)')::int, 1)) end) as doors,
                   sum(case when r is null then 0
                            else greatest(1, coalesce(substring(r->>'qty' from '^\s*(\d+)')::int, 1))
                               * (coalesce(substring(r->>'height' from '^\s*(\d+(?:\.\d+)?)')::numeric, 80) + 12) end) as foam
              from lines group by dealer_id, pack_on) g
     where g.doors > 0
  $q$ into out using p_to;
  return out;
end $$;
revoke all on function public.supply_pallet_ahead(date) from public, anon;
grant execute on function public.supply_pallet_ahead(date) to authenticated;

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
    -- Andrew, 27 November: Ashley is copied on ALL orders. Taking her
    -- off on a page puts her straight back; anybody else may be added.
    if coalesce(new.copy_to, '') !~* '(^|[\s,])ashley@grinyer\.ca($|[\s,])' then
      new.copy_to := coalesce(new.copy_to || ', ', '') || 'ashley@grinyer.ca';
    end if;
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

-- Ashley copied on every list there now (Andrew, 27 November: ALL
-- orders). Anybody else already copied stays copied.
update public.supply_categories
   set copy_to = case when coalesce(btrim(copy_to), '') = '' then 'ashley@grinyer.ca'
                      else copy_to || ', ashley@grinyer.ca' end
 where coalesce(copy_to, '') !~* '(^|[\s,])ashley@grinyer\.ca($|[\s,])';

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

-- ====================================================================
--  INVOICING A PALLET FROM THE DEALER PORTAL
--  Run this in the Supabase SQL editor. Safe to run twice, and safe in
--  any order with the other files in sql/. Changes nobody's access to
--  anything that exists today.
-- ====================================================================
--
--  Andrew, 23 November: one button on a pallet invoices every order on
--  it, one invoice per order, as soon as the order is on a pallet and
--  whatever its status. Start with one file per order that QuickBooks
--  can import, and later write the invoices straight into QuickBooks.
--  Before anything is made, the person confirms which orders are being
--  charged and which are a no cost remake or replacement.
--
--  WHAT THIS ADDS
--
--   dealer_invoices              one row per invoice made: which order,
--                                which pallet, the invoice number, charged
--                                or no charge, the total and the lines as
--                                they went into the file. One live invoice
--                                per order, so nothing is billed twice.
--                                qbo_id is empty until the tool writes to
--                                QuickBooks directly, which is the next step.
--   invoice_settings             per dealer: the customer name exactly as
--                                QuickBooks has it, currency, terms,
--                                discount, tariff and tax code. Remembered
--                                from the last file made for that dealer.
--   qbo_items                    the QuickBooks products and services list,
--                                so the screen can say when an item name
--                                is not in QuickBooks. Seeded below from
--                                the list the wholesale tool carries.
--   pallet_customs_docs          the customs papers made for a pallet
--                                (proforma, Lacey, TSCA), the html as made
--                                and the orders it covered, newest is the
--                                one in use. Kept, never deleted.
--   qbo_item_map                 which QuickBooks item each of our door
--                                styles goes to, remembered for everybody
--                                once somebody picks it.
--
--  WHY NOT THE ORDER STATUS
--
--  Statuses come from Access through the hourly sync, so marking an order
--  invoiced from here would be overwritten within the hour, or fight it.
--  An invoice is its own record and the status is left to Access.
--
--  WHO MAY
--
--  can_invoice(), a helper and an allowlist like every other one. For
--  now Grinyer administrators, the same people who see the pallets.
--  Dealers never read any of these tables.
-- ====================================================================

do $$
begin
  if to_regclass('public.dealer_orders') is null then
    raise exception 'dealer_orders is not here. This is the wrong project.';
  end if;
  if to_regclass('public.pallets') is null then
    raise exception 'pallets is not here, so dealer-pallets.sql has not been '
                    'run on this project. Nothing was changed.';
  end if;
end $$;

-- ---------- 1. who may ------------------------------------------------
create or replace function public.can_invoice()
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin()
$$;

-- ---------- 3. the invoices -------------------------------------------
create table if not exists public.dealer_invoices (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid not null references public.dealer_orders(id) on delete cascade,
  dealer_id   uuid,
  pallet_id   text,                 -- text, so it fits whatever type pallets.id is
  pallet_name text,
  invoice_no  text not null,
  charge      text not null default 'charge',
  reason      text,                 -- why a no charge one was free
  customer    text,                 -- as it went into QuickBooks
  currency    text,
  invoice_date date,
  total       numeric(12,2),
  lines       jsonb not null default '[]'::jsonb,
  qbo_id      text,                 -- filled when written to QuickBooks directly
  created_at  timestamptz not null default now(),
  created_by  uuid default auth.uid(),
  voided_at   timestamptz,
  voided_by   uuid
);
alter table public.dealer_invoices drop constraint if exists dealer_invoices_charge_check;
alter table public.dealer_invoices add constraint dealer_invoices_charge_check
  check (charge in ('charge', 'no_charge'));
-- one live invoice per order: a second needs the first voided
create unique index if not exists dealer_invoices_one_live
  on public.dealer_invoices(order_id) where voided_at is null;
create index if not exists dealer_invoices_pallet on public.dealer_invoices(pallet_id);

-- ---------- 4. per dealer settings ------------------------------------
create table if not exists public.invoice_settings (
  dealer_id    uuid primary key,
  qbo_customer text,
  currency     text default 'USD',
  terms        text default 'Due on receipt',
  discount_pct numeric default 20,
  tariff_pct   numeric default 50,
  tax_code     text default 'E',
  updated_at   timestamptz default now()
);
alter table public.invoice_settings add column if not exists ship_to text;

create table if not exists public.pallet_customs_docs (
  id          uuid primary key default gen_random_uuid(),
  pallet_id   text not null,
  pallet_name text,
  order_ids   jsonb not null default '[]'::jsonb,
  fields      jsonb not null default '{}'::jsonb,
  total       numeric(12,2),
  html        text not null,
  created_at  timestamptz not null default now(),
  created_by  uuid default auth.uid()
);
create index if not exists pallet_customs_docs_pallet on public.pallet_customs_docs(pallet_id, created_at desc);

-- ---------- 5. the QuickBooks item list and our matches ---------------
create table if not exists public.qbo_items (
  name text primary key
);
create table if not exists public.qbo_item_map (
  key        text primary key,      -- door:<style>|<core>, or extra:<what>
  item       text not null,
  updated_at timestamptz default now()
);

-- ---------- 6. the rules ----------------------------------------------
alter table public.dealer_invoices  enable row level security;
alter table public.invoice_settings enable row level security;
alter table public.qbo_items        enable row level security;
alter table public.qbo_item_map     enable row level security;
alter table public.pallet_customs_docs enable row level security;

drop policy if exists dealer_invoices_invoicer  on public.dealer_invoices;
drop policy if exists invoice_settings_invoicer on public.invoice_settings;
drop policy if exists qbo_items_invoicer        on public.qbo_items;
drop policy if exists qbo_item_map_invoicer     on public.qbo_item_map;
drop policy if exists pallet_customs_docs_invoicer on public.pallet_customs_docs;
create policy dealer_invoices_invoicer on public.dealer_invoices
  for all to authenticated using (public.can_invoice()) with check (public.can_invoice());
create policy invoice_settings_invoicer on public.invoice_settings
  for all to authenticated using (public.can_invoice()) with check (public.can_invoice());
create policy qbo_items_invoicer on public.qbo_items
  for all to authenticated using (public.can_invoice()) with check (public.can_invoice());
create policy qbo_item_map_invoicer on public.qbo_item_map
  for all to authenticated using (public.can_invoice()) with check (public.can_invoice());
create policy pallet_customs_docs_invoicer on public.pallet_customs_docs
  for all to authenticated using (public.can_invoice()) with check (public.can_invoice());

-- an invoice is voided, never deleted, so the history stays; customs
-- papers are made again, never deleted, for the same reason
revoke delete on public.dealer_invoices, public.pallet_customs_docs from authenticated, anon;
grant select, insert on public.pallet_customs_docs to authenticated;
revoke all on public.pallet_customs_docs from anon;
grant select, insert, update on public.dealer_invoices to authenticated;
grant select, insert, update, delete on public.invoice_settings, public.qbo_items,
  public.qbo_item_map to authenticated;
revoke all on public.dealer_invoices, public.invoice_settings, public.qbo_items,
  public.qbo_item_map from anon;

-- ---------- 7. the QuickBooks list, as the wholesale tool has it -------
insert into public.qbo_items(name) values
  ('145 Big Tex Flat Bed'), ('2015 Chevy Tahoe'), ('4 Post Lift'), ('Accessories'),
  ('Accessories:14 x 24 Metal Shelf'), ('Accessories:1" Snap Hook'), ('Accessories:4" Snap Hook'), ('Accessories:6" Snap Hook'),
  ('Accessories:Baskets'), ('Accessories:Baskets:12 x 18" Basket'), ('Accessories:Baskets:12 x 24" Basket'), ('Accessories:Baskets:3 x 12" Basket'),
  ('Accessories:Baskets:8 x 12" Basket'), ('Accessories:Bike Hook'), ('Accessories:Bike Rack'), ('Accessories:Double Hook'),
  ('Accessories:Double Hook:4" Double Hook'), ('Accessories:Double Hook:8" Double Hook'), ('Accessories:Double Hook:Double Utility Hook'), ('Accessories:J-Hook 6"'),
  ('Accessories:Large tip out bins'), ('Accessories:Loop Hook'), ('Accessories:Loop Hook:4" Loop Hook'), ('Accessories:Loop Hook:8" Loop Hook'),
  ('Accessories:Magnets'), ('Accessories:Paper Towel Holder'), ('Accessories:Screw Driver Rack'), ('Accessories:Shelf'),
  ('Accessories:S-Hook'), ('Accessories:Ski Rack'), ('Accessories:Small Tool Rack'), ('Accessories:Sports Rack'),
  ('Accessories:Storage Bins'), ('Accessories:Storage Bins:6 - Tilt Bin'), ('Accessories:Storage Bins:9 - Tilt Bin'), ('Accessories:Wire shelves'),
  ('Accessories:Wire shelves:14 x 24" Shelf'), ('Accessories:Wire shelves:14 x 48" Shelf'), ('Accessories:Wire shelves:Shoe Shelf'), ('Adjustment'),
  ('Adjustment2'), ('A/R ADJ'), ('AR-ADJ'), ('Bad Debt'),
  ('Barn Door'), ('Cabinets'), ('Cabinets:Barzel Steel-Doors'), ('Cabinets:Barzel Steel-Drawers'),
  ('Cabinets:Barzel Steel-Locker'), ('Cabinets:Barzel Steel-Upper'), ('Cabinets:Counter Top/Work Surface'), ('Cabinets:Garage Cabinets'),
  ('Closet'), ('Closet:Closet Installation'), ('Credit Card Fee'), ('Delivery'),
  ('Discount'), ('Finance Charge'), ('Finance it'), ('GDL Door Line'),
  ('GDL Door Line:Bi-fold'), ('GDL Door Line:Mirror By-Pass Set'), ('GDL Door Line:Privacy ByPass Set'), ('GMD Doors'),
  ('GMD Doors:10 Lite Clear'), ('GMD Doors:15 Lite Clear'), ('GMD Doors:1 Lite Clear'), ('GMD Doors:1 Lite Mirror'),
  ('GMD Doors:1 Lite Pantry'), ('GMD Doors:1 Lite Privacy'), ('GMD Doors:1 Lite Rain'), ('GMD Doors:1 Lite Reed'),
  ('GMD Doors:1 Panel'), ('GMD Doors:1 Panel Shaker'), ('GMD Doors:2 Panel Arch'), ('GMD Doors:2 Panel Roman'),
  ('GMD Doors:2 Panel Roman V-Groove'), ('GMD Doors:2 Panel Shaker'), ('GMD Doors:2 Panel Square'), ('GMD Doors:3 Lite Clear'),
  ('GMD Doors:3 Lite Privacy'), ('GMD Doors:3 Panel'), ('GMD Doors:3 Panel Equal Shaker'), ('GMD Doors:3 Panel Shaker'),
  ('GMD Doors:4 Lite Privacy'), ('GMD Doors:4 Panel'), ('GMD Doors:4 Panel Even'), ('GMD Doors:4 Panel Shaker'),
  ('GMD Doors:4 Panel True Shaker Door'), ('GMD Doors:5 Lite Privacy'), ('GMD Doors:5 Panel Shaker'), ('GMD Doors:6 Panel Textured'),
  ('GMD Doors:Aberdeen'), ('GMD Doors:Alki'), ('GMD Doors:Astragal'), ('GMD Doors:Ballard HC Modern'),
  ('GMD Doors:Barn Door'), ('GMD Doors:Barn Door Tracking'), ('GMD Doors:Berkley'), ('GMD Doors:Bifold'),
  ('GMD Doors:Birkdale'), ('GMD Doors:By Pass Door Track'), ('GMD Doors:Cheyenne'), ('GMD Doors:Custom Paint'),
  ('GMD Doors:Deman'), ('GMD Doors:Door Disposal'), ('GMD Doors:Flat Slab'), ('GMD Doors:Flush White'),
  ('GMD Doors:Installation'), ('GMD Doors:Jamb/Trim'), ('GMD Doors:Kingston'), ('GMD Doors:Laurelhurst'),
  ('GMD Doors:Lincoln Park'), ('GMD Doors:Livingston'), ('GMD Doors:Logans'), ('GMD Doors:Madison'),
  ('GMD Doors:Melrose'), ('GMD Doors:Mercer'), ('GMD Doors:Monroe Smooth'), ('GMD Doors:Montlake'),
  ('GMD Doors:Paint'), ('GMD Doors:Paint-Custom'), ('GMD Doors:Paint-Glass'), ('GMD Doors:Pivot'),
  ('GMD Doors:Plantation'), ('GMD Doors:Plantation Over Panel'), ('GMD Doors:Pocket Door'), ('GMD Doors:Rerail'),
  ('GMD Doors:Re Stile'), ('GMD Doors:Riverside'), ('GMD Doors:Robson'), ('GMD Doors:Router & Stop'),
  ('GMD Doors:Solid Core'), ('GMD Doors:Standard Door'), ('GMD Doors:Vanair'), ('GMD Doors:Whitman'),
  ('GMD Doors:Winslow'), ('GMD Doors:Winthrop'), ('GMD - Supply Only'), ('GMD - Supply Only:Flat/Flush Slab'),
  ('GMD-Wholesale'), ('GMD-Wholesale:10-Lite Clear Glass'), ('GMD-Wholesale:1 Lite Clear Glass'), ('GMD-Wholesale:1 Lite Laminated'),
  ('GMD-Wholesale:1 Lite Mirror (2 sided)'), ('GMD-Wholesale:1 Lite "Pantry"'), ('GMD-Wholesale:1 Panel Shaker S&R'), ('GMD-Wholesale:1 Panel Stile & Rail Shaker Bi'),
  ('GMD-Wholesale:2 Panel Arch Top'), ('GMD-Wholesale:2 Panel Shaker S & R'), ('GMD-Wholesale:3 Lite Clear Glass'), ('GMD-Wholesale:3 Lite DWL'),
  ('GMD-Wholesale:3 Panel Equal Shaker S & R'), ('GMD-Wholesale:4 Lite Privacy'), ('GMD-Wholesale:4 Panel Shaker S & R'), ('GMD-Wholesale:5 Panel Shaker'),
  ('GMD-Wholesale:Aberdeen HC'), ('GMD-Wholesale:Benton HC'), ('GMD-Wholesale:Berkley HC Modern'), ('GMD-Wholesale:Bonniville/Columbia HC'),
  ('GMD-Wholesale:Bonnville Bi Fold'), ('GMD-Wholesale:Columbia HC'), ('GMD-Wholesale:Columbia SC'), ('GMD-Wholesale:Deman Modern HC'),
  ('GMD-Wholesale:Deman Modern SC'), ('GMD-Wholesale:Discount'), ('GMD-Wholesale:Flat Flush'), ('GMD-Wholesale:Kingston Bi Fold'),
  ('GMD-Wholesale:Kingston HC'), ('GMD-Wholesale:Kingston SC'), ('GMD-Wholesale:Laurelhurst Modern HC'), ('GMD-Wholesale:Livingston HC'),
  ('GMD-Wholesale:Livingston SC'), ('GMD-Wholesale:Melrose HC'), ('GMD-Wholesale:Mercer HC'), ('GMD-Wholesale:Mercer HC Bi Fold'),
  ('GMD-Wholesale:Mercer SC'), ('GMD-Wholesale:Meridian'), ('GMD-Wholesale:Modern Alki HC'), ('GMD-Wholesale:Modern Alki SC'),
  ('GMD-Wholesale:Plantation Louver SC'), ('GMD-Wholesale:Shop Work'), ('GMD-Wholesale:Whitman HC'), ('GMD-Wholesale:Whitman SC'),
  ('GMD-Wholesale:Whittman Bi fold'), ('GMD-Wholesale:Winthrop SC'), ('GMD-Wholesale:Yarrow HC'), ('GMD-Wholesale:Yarrow SC'),
  ('GST (ITC)'), ('Hardware'), ('Hardware:Accent Lever'), ('Hardware:Alexandria Crystal Knob'),
  ('Hardware:Andover Knob'), ('Hardware:Avanti Lever'), ('Hardware:Avila Lever'), ('Hardware:Barn Door Handle'),
  ('Hardware:Bifold Knob'), ('Hardware:Bowery Knob'), ('Hardware:Broadway Lever'), ('Hardware:Customer Supplied'),
  ('Hardware:Dead Bolt'), ('Hardware:Dover Lever'), ('Hardware:Eller Lever'), ('Hardware:EmTek'),
  ('Hardware:Finger Pull'), ('Hardware:Flair Lever'), ('Hardware:Georgian Knob'), ('Hardware:Halifax Sq'),
  ('Hardware:Hinge'), ('Hardware:Hobson Crystal Knob'), ('Hardware:Latitude Lever'), ('Hardware:Mag Catch'),
  ('Hardware:Manhattan Lever'), ('Hardware:Merano Lever'), ('Hardware:Miscellaneous Hardware'), ('Hardware:Northbrook'),
  ('Hardware:Orbit'), ('Hardware:Plymouth Knob'), ('Hardware:Pocket Door Latch'), ('Hardware:Reuse Handle'),
  ('Hardware:Sienna Knob'), ('Hardware:Taymor Vega'), ('Hardware:Torino Lever'), ('Hardware:T-Strikes'),
  ('Hardware:Whitney'), ('Home Depot Percentage'), ('HST Adjustments'), ('HST (ITC) Adjustments'),
  ('HST (ON)'), ('HST (ON) (ITC)'), ('Hydroguard Installation/Repair'), ('Hydroguard Install/Repair'),
  ('Initial Deposit'), ('Labour'), ('PmntDiscount_Product'), ('PmntDiscount_Supplies'),
  ('Product'), ('Product - Closets & Organizers'), ('Product - Retail Doors'), ('Products'),
  ('Products:Custom Work'), ('Products:Flooring'), ('Products:Flooring:Flake'), ('Products:Flooring:Floor Repair'),
  ('Product - SGA Doors'), ('Products:Overhead Storage'), ('Products:Slatwall Panels'), ('Product - Wholesale Doors'),
  ('Refund'), ('Reimb Group'), ('Service Fee'), ('Services'),
  ('SFD Discount'), ('Shipping'), ('Shipping Pallet'), ('Supplies'),
  ('Travel Expenses'), ('Trusscore Panels'), ('Tuffboard'), ('Victoria Mouldings'),
  ('Victoria Mouldings:Klasik 3 Panel raised'), ('Work Surfaces')
on conflict (name) do nothing;

notify pgrst, 'reload schema';

select 'dealer invoicing is in' as done,
       (select count(*) from public.qbo_items) as quickbooks_items,
       (select count(*) from public.dealer_invoices where voided_at is null) as invoices;

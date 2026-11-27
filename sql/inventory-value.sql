-- ====================================================================
--  INVENTORY VALUE: a price on paint and on the door inventory
--  Run this in the Supabase SQL editor. Safe to run twice, and safe in
--  any order with the other files in sql/: a table that is not there
--  yet is skipped, and running this again after it is made adds the
--  column then.
-- ====================================================================
--
--  Andrew, 27 November: every inventory and supplies item gets a value,
--  and one screen lists and totals them all. Supplies items already have
--  price (supplies.sql, a price for one of the item's unit). This adds
--  the same to the other two kinds of stock:
--
--    paint_colours.price_per_gallon   primer, the stocked colours and the
--                                     other colours on the shelf
--    door_inventory.unit_value        what one door on that line is worth
--
--  Both blank until somebody types them. Who may change them is who may
--  already change those rows: the paint page's people for paint, staff
--  for the door inventory. Nothing new to allow, and the Inventory Value
--  screen only reads.
-- ====================================================================

do $$
begin
  if to_regclass('public.paint_colours') is not null then
    alter table public.paint_colours add column if not exists price_per_gallon numeric(12,4);
    alter table public.paint_colours drop constraint if exists paint_colours_price_ok;
    alter table public.paint_colours add constraint paint_colours_price_ok
      check (price_per_gallon is null or (price_per_gallon >= 0 and price_per_gallon < 1000000));
  end if;
  if to_regclass('public.door_inventory') is not null then
    alter table public.door_inventory add column if not exists unit_value numeric(12,2);
    alter table public.door_inventory drop constraint if exists door_inventory_value_ok;
    alter table public.door_inventory add constraint door_inventory_value_ok
      check (unit_value is null or (unit_value >= 0 and unit_value < 1000000));
  end if;
end $$;

notify pgrst, 'reload schema';

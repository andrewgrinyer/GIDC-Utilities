-- ====================================================================
--  DOOR INVENTORY: THE COUNT OF 12 NOVEMBER 2026
--  Run this in the Supabase SQL editor, after door-inventory.sql.
--  Safe to run twice: each line has a fixed id. A line nobody has
--  changed on the tools page is brought up to date with this file; a
--  line somebody has changed there is left exactly as it is. A line
--  somebody removed on the tools page comes back if this is run again.
-- ====================================================================
--
--  From Andrew's spreadsheet GIDC_Door_Inventory.xlsx, itself typed up
--  from two handwritten count sheets. What was done to it:
--
--    style   put under the price list's own name where the reading is
--            clear: "1 Side Mirror" is 1-sided Mirror, "Demen" is
--            Deman, "Rasio?" is Rasario (the sheet says so too). A style
--            the price list does not have is Other, with the name from
--            the sheet first in its notes ("Style: Boston."), as Andrew
--            asked on 12 November.
--    core    as written. 1 3/4" thick is 1.75. Where none was written
--            and the price list sells the style only in solid, Solid.
--            Otherwise left blank, which matches an order of any core.
--    height  the bifolds were counted by width alone, so blank, which
--            matches an order of any height.
--    repeats the same style, size and core twice is one line with the
--            two counts added, so an order email never lists one door
--            as two.
--
--  Every line's notes say which sheet and line it came from. Lines the
--  spreadsheet marked yellow say "Check:" and show under Needs a check.
-- ====================================================================

do $$
begin
  if to_regclass('public.door_inventory') is null then
    raise exception 'Run door-inventory.sql first. door_inventory is not here yet.';
  end if;
end $$;

insert into public.door_inventory (id, style, width_in, height_in, core, qty, notes) values

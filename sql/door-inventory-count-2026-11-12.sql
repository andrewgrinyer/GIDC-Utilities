-- ====================================================================
--  DOOR INVENTORY: THE COUNT OF 12 NOVEMBER 2026
--  Run this in the Supabase SQL editor, after door-inventory.sql.
--  Safe to run twice: each line has a fixed id, and a line already
--  there is left exactly as it is, edits and all. A line somebody
--  removed on the tools page comes back if this is run again.
-- ====================================================================
--
--  From Andrew's spreadsheet GIDC_Door_Inventory.xlsx, itself typed up
--  from two handwritten count sheets. What was done to it:
--
--    style   put under the price list's own name where the reading is
--            clear: "1 Side Mirror" is 1-sided Mirror, "Demen" is
--            Deman, "Rasio?" is Rasario (the sheet says so too). A style
--            the price list does not have is kept as written and its
--            notes start "Check:", and the tools page marks it "Not on
--            the price list" until somebody picks the right one.
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
--  spreadsheet marked yellow, and any style not on the price list,
--  start with "Check:".
-- ====================================================================

do $$
begin
  if to_regclass('public.door_inventory') is null then
    raise exception 'Run door-inventory.sql first. door_inventory is not here yet.';
  end if;
end $$;

insert into public.door_inventory (id, style, width_in, height_in, core, qty, notes) values
  (md5('gidc count 2026-11-12 line 1')::uuid, 'Rasario', 36, null, 'Bifold', 2, 'Count of 12 Nov 2026, spreadsheet line 1 (Sheet 1).'),
  (md5('gidc count 2026-11-12 line 2')::uuid, 'Whitman', 34, 96, 'Solid', 2, 'Count of 12 Nov 2026, spreadsheet line 2 (Sheet 1).'),
  (md5('gidc count 2026-11-12 line 3')::uuid, '1 Lite Lam Ovolo', 30, 80, null, 1, 'Check: Style not on the price list, pick the right one with Edit. Count of 12 Nov 2026, spreadsheet line 3 (Sheet 1).'),
  (md5('gidc count 2026-11-12 line 4')::uuid, '1 panel shaker', 26, 84, 'Solid', 1, 'Check: Size overwritten on sheet, please verify. Count of 12 Nov 2026, spreadsheet line 4 (Sheet 1). Core from the price list, which only sells it solid.'),
  (md5('gidc count 2026-11-12 line 5')::uuid, 'Whitman', 28, 78, 'Hollow', 1, 'Check: Height smudged on sheet (78?), please verify. Count of 12 Nov 2026, spreadsheet line 5 (Sheet 1).'),
  (md5('gidc count 2026-11-12 line 6')::uuid, 'Boston', 24, 78, 'Hollow', 1, 'Check: Style not on the price list, pick the right one with Edit. Count of 12 Nov 2026, spreadsheet line 6 (Sheet 1).'),
  (md5('gidc count 2026-11-12 line 7')::uuid, '1 Lite Lam', 26, 80, null, 1, 'Check: Style not on the price list, pick the right one with Edit. Count of 12 Nov 2026, spreadsheet line 7 (Sheet 1).'),
  (md5('gidc count 2026-11-12 line 8')::uuid, 'Flat Flush', 24, 80, 'Hollow', 2, 'Check: Style not on the price list, pick the right one with Edit. Count of 12 Nov 2026, spreadsheet line 8 (Sheet 1).'),
  (md5('gidc count 2026-11-12 line 9')::uuid, '2 panel shaker', 20, 80, 'Solid', 2, 'Count of 12 Nov 2026, spreadsheet line 9 (Sheet 1). Core from the price list, which only sells it solid.'),
  (md5('gidc count 2026-11-12 line 10')::uuid, 'Columbia', 30, 80, 'Hollow', 1, 'Count of 12 Nov 2026, spreadsheet line 10 (Sheet 1).'),
  (md5('gidc count 2026-11-12 line 11')::uuid, '2 panel shaker', 24, 80, 'Solid', 1, 'Count of 12 Nov 2026, spreadsheet line 11 (Sheet 1). Core from the price list, which only sells it solid.'),
  (md5('gidc count 2026-11-12 line 12')::uuid, '2 panel shaker', 36, 80, 'Solid', 1, 'Count of 12 Nov 2026, spreadsheet line 12 (Sheet 1). Core from the price list, which only sells it solid.'),
  (md5('gidc count 2026-11-12 line 13')::uuid, '2 panel shaker', 28, 80, 'Solid', 1, 'Count of 12 Nov 2026, spreadsheet line 13 (Sheet 1). Core from the price list, which only sells it solid.'),
  (md5('gidc count 2026-11-12 line 14')::uuid, 'Alki', 36, 80, 'Hollow', 2, 'Count of 12 Nov 2026, spreadsheet line 14 (Sheet 1).'),
  (md5('gidc count 2026-11-12 line 15')::uuid, 'Alki', 30, 80, '1.75', 1, 'Count of 12 Nov 2026, spreadsheet line 15 (Sheet 1).'),
  (md5('gidc count 2026-11-12 line 16')::uuid, 'Alki', 30, 84, 'Hollow', 1, 'Count of 12 Nov 2026, spreadsheet line 16 (Sheet 1).'),
  (md5('gidc count 2026-11-12 line 17')::uuid, 'Melrose', 24, 80, 'Hollow', 3, 'Count of 12 Nov 2026, spreadsheet line 17 (Sheet 1).'),
  (md5('gidc count 2026-11-12 line 18')::uuid, 'Alki', 24, 77, 'Solid', 2, 'Count of 12 Nov 2026, spreadsheet line 18 (Sheet 1).'),
  (md5('gidc count 2026-11-12 line 19')::uuid, 'DSM', 28, 80, null, 1, 'Check: Handwriting unclear, please verify. Style not on the price list, pick the right one with Edit. Count of 12 Nov 2026, spreadsheet line 19 (Sheet 1).'),
  (md5('gidc count 2026-11-12 line 20')::uuid, 'Kingston', 36, 80, 'Hollow', 1, 'Count of 12 Nov 2026, spreadsheet line 20 (Sheet 1).'),
  (md5('gidc count 2026-11-12 line 21')::uuid, '1 Panel Duct', 32, 79, null, 1, 'Check: Handwriting unclear, please verify. Style not on the price list, pick the right one with Edit. Count of 12 Nov 2026, spreadsheet line 21 (Sheet 1).'),
  (md5('gidc count 2026-11-12 line 22')::uuid, '1-sided Mirror', 36, 84, 'Solid', 2, 'Count of 12 Nov 2026, spreadsheet line 22 (Sheet 2). Sheet says 1 Side Mirror. Core from the price list, which only sells it solid.'),
  (md5('gidc count 2026-11-12 line 23')::uuid, 'Mercer', 22, null, 'Bifold', 1, 'Count of 12 Nov 2026, spreadsheet line 23 (Sheet 2).'),
  (md5('gidc count 2026-11-12 line 24')::uuid, 'Rasario', 32, null, 'Bifold', 1, 'Check: Possibly Rasario, please verify. Count of 12 Nov 2026, spreadsheet line 24 (Sheet 2). Sheet says Rasio?.'),
  (md5('gidc count 2026-11-12 line 25')::uuid, 'Rasario', 24, null, 'Bifold', 1, 'Count of 12 Nov 2026, spreadsheet line 25 (Sheet 2).'),
  (md5('gidc count 2026-11-12 line 26')::uuid, 'Parkrose', 24, null, 'Bifold', 1, 'Count of 12 Nov 2026, spreadsheet line 26 (Sheet 2).'),
  (md5('gidc count 2026-11-12 line 27')::uuid, 'Flat Flush', 30, 80, 'Hollow', 2, 'Check: Style not on the price list, pick the right one with Edit. Count of 12 Nov 2026, spreadsheet line 27 (Sheet 2).'),
  (md5('gidc count 2026-11-12 line 28')::uuid, '1 panel shaker', 28, 96, 'Solid', 1, 'Count of 12 Nov 2026, spreadsheet line 28 (Sheet 2). Core from the price list, which only sells it solid.'),
  (md5('gidc count 2026-11-12 line 29')::uuid, 'Kingston', 36, null, 'Bifold', 1, 'Count of 12 Nov 2026, spreadsheet line 29 (Sheet 2).'),
  (md5('gidc count 2026-11-12 line 30')::uuid, 'Ballard', 28, 80, 'Hollow', 1, 'Check: Style not on the price list, pick the right one with Edit. Count of 12 Nov 2026, spreadsheet line 30 (Sheet 2).'),
  (md5('gidc count 2026-11-12 line 31')::uuid, 'Aberdeen', 30, 80, 'Hollow', 1, 'Count of 12 Nov 2026, spreadsheet line 31 (Sheet 2).'),
  (md5('gidc count 2026-11-12 line 32')::uuid, 'Deman', 30, 80, 'Hollow', 1, 'Check: Name spelling unclear, please verify. Count of 12 Nov 2026, spreadsheet line 32 (Sheet 2). Sheet says Demen.'),
  (md5('gidc count 2026-11-12 line 33')::uuid, 'Deman', 32, 80, 'Hollow', 3, 'Count of 12 Nov 2026, spreadsheet line 33 and line 36 (Sheet 2). Sheet says Demen.'),
  (md5('gidc count 2026-11-12 line 34')::uuid, 'Deman', 24, 80, 'Hollow', 1, 'Count of 12 Nov 2026, spreadsheet line 34 (Sheet 2). Sheet says Demen.'),
  (md5('gidc count 2026-11-12 line 35')::uuid, 'Rasario', 24, 80, 'Solid', 1, 'Count of 12 Nov 2026, spreadsheet line 35 (Sheet 2).'),
  (md5('gidc count 2026-11-12 line 37')::uuid, 'Mercer', 22, 80, 'Hollow', 1, 'Count of 12 Nov 2026, spreadsheet line 37 (Sheet 2).'),
  (md5('gidc count 2026-11-12 line 38')::uuid, 'Alki', 34, 80, 'Solid', 1, 'Count of 12 Nov 2026, spreadsheet line 38 (Sheet 2).'),
  (md5('gidc count 2026-11-12 line 39')::uuid, 'Smooth Blank', 32, 80, 'Hollow', 1, 'Check: Handwriting unclear, please verify. Style not on the price list, pick the right one with Edit. Count of 12 Nov 2026, spreadsheet line 39 (Sheet 2).'),
  (md5('gidc count 2026-11-12 line 40')::uuid, '1 Panel Mirror w/ Square', 36, 96, null, 1, 'Check: Style not on the price list, pick the right one with Edit. Count of 12 Nov 2026, spreadsheet line 40 (Sheet 2).'),
  (md5('gidc count 2026-11-12 line 41')::uuid, 'Mercer', 30, 80, 'Hollow', 1, 'Count of 12 Nov 2026, spreadsheet line 41 (Sheet 2).'),
  (md5('gidc count 2026-11-12 line 42')::uuid, 'Craftsman', 29, 79.5, null, 1, 'Check: Style not on the price list, pick the right one with Edit. Count of 12 Nov 2026, spreadsheet line 42 (Sheet 2).'),
  (md5('gidc count 2026-11-12 line 43')::uuid, 'Rasario', 28, 80, 'Hollow', 1, 'Count of 12 Nov 2026, spreadsheet line 43 (Sheet 2).')
on conflict (id) do nothing;

select count(*) as lines, sum(qty) as doors,
       count(*) filter (where notes like 'Check:%') as to_check
  from public.door_inventory
 where id in (select md5('gidc count 2026-11-12 line ' || n)::uuid from generate_series(1, 200) n);

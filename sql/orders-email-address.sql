-- orders@grinyer.ca, not order@grinyer.ca (27 Nov 2026)
-- Safe to run twice. A second run finds nothing left to change.
--
-- 1. Changes order@grinyer.ca to orders@grinyer.ca where the tools site
--    keeps email addresses that orders go out with: the Order Supplies
--    lists ("copy every order to") and the suppliers' own addresses.
-- 2. Then looks through every text column in the database for
--    order@grinyer.ca and lists any place it is still written, so nothing
--    is missed. It only reads in step 2; it changes nothing there.
--
-- orders@grinyer.ca and border@ and similar are left alone: only the exact
-- address order@grinyer.ca is matched.

do $$
begin
  if to_regclass('public.supply_categories') is not null then
    update public.supply_categories
       set copy_to = regexp_replace(copy_to, '\morder@grinyer\.ca\M', 'orders@grinyer.ca', 'gi')
     where copy_to ~* '\morder@grinyer\.ca\M';
  end if;
  if to_regclass('public.supply_suppliers') is not null then
    update public.supply_suppliers
       set email = regexp_replace(email, '\morder@grinyer\.ca\M', 'orders@grinyer.ca', 'gi')
     where email ~* '\morder@grinyer\.ca\M';
  end if;
end $$;

-- Every place order@grinyer.ca is still written. No rows = all clear.
select c.table_schema || '.' || c.table_name as "table",
       c.column_name as "column",
       (xpath('/row/n/text()',
          query_to_xml(format('select count(*) as n from %I.%I where %I::text ~* %L',
                              c.table_schema, c.table_name, c.column_name,
                              '\morder@grinyer\.ca\M'), false, true, '')))[1]::text::int as "rows with order@"
  from information_schema.columns c
  join information_schema.tables t
    on t.table_schema = c.table_schema and t.table_name = c.table_name
   and t.table_type = 'BASE TABLE'
 where c.table_schema in ('public', 'auth')
   and c.data_type in ('text', 'character varying', 'character', 'json', 'jsonb', 'ARRAY')
   and (xpath('/row/n/text()',
          query_to_xml(format('select count(*) as n from %I.%I where %I::text ~* %L',
                              c.table_schema, c.table_name, c.column_name,
                              '\morder@grinyer\.ca\M'), false, true, '')))[1]::text::int > 0
 order by 1, 2;

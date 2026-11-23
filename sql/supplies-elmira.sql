-- ====================================================================
--  SHOP SUPPLIES: every item from Elmira Doors & Trim, Ashley copied
--  Run this in the Supabase SQL editor after supplies.sql. Safe to run
--  twice: the supplier is added once, and running it again only sets
--  the same things again.
-- ====================================================================
--
--  Andrew, 23 November: all the items in Shop Supplies come from one
--  supplier, Elmira Doors & Trim, mike@elmiradoorandtrim.com. Ashley
--  (ashley@grinyer.ca) is copied on ALL supplies orders.
--
--  An item added to Shop Supplies later picks its supplier on the page.
-- ====================================================================

do $$
begin
  if to_regclass('public.supply_items') is null then
    raise exception 'Run supplies.sql first.';
  end if;
end $$;

-- the supplier, once (names are matched ignoring spaces and punctuation)
insert into public.supply_suppliers (name, email)
select 'Elmira Doors & Trim', 'mike@elmiradoorandtrim.com'
 where not exists (select 1 from public.supply_suppliers
                    where lower(regexp_replace(name, '[^A-Za-z0-9]', '', 'g')) = 'elmiradoorstrim');
update public.supply_suppliers set email = 'mike@elmiradoorandtrim.com'
 where lower(regexp_replace(name, '[^A-Za-z0-9]', '', 'g')) = 'elmiradoorstrim'
   and email is distinct from 'mike@elmiradoorandtrim.com';

-- every Shop Supplies item there now
update public.supply_items i
   set supplier_id = s.id
  from public.supply_suppliers s
 where lower(regexp_replace(s.name, '[^A-Za-z0-9]', '', 'g')) = 'elmiradoorstrim'
   and i.category = 'shop'
   and i.supplier_id is distinct from s.id;

-- Ashley copied on every list: Shop, Sanding and Install. Anybody else
-- already copied stays copied.
update public.supply_categories
   set copy_to = case when coalesce(btrim(copy_to), '') = '' then 'ashley@grinyer.ca'
                      else copy_to || ', ashley@grinyer.ca' end
 where coalesce(copy_to, '') !~* '(^|[\s,])ashley@grinyer\.ca($|[\s,])';

-- what it did
select i.shop_name, s.name as supplier, s.email
  from public.supply_items i left join public.supply_suppliers s on s.id = i.supplier_id
 where i.category = 'shop' order by i.sort, i.shop_name;

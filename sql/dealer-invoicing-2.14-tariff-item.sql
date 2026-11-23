-- Dealer portal 2.14: the tariff line's QuickBooks item is just "Tariff".
-- Safe to run twice. Removes any remembered pick for the tariff line and
-- makes sure "Tariff" is on the QuickBooks item list.
delete from public.qbo_item_map where key = 'extra:tariff';
insert into public.qbo_items(name) values ('Tariff') on conflict (name) do nothing;
select 'tariff item is Tariff' as done;

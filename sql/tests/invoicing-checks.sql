-- TEST ONLY. Run by invoicing.sh against the throwaway database.
\set ON_ERROR_STOP 0
\echo -- the QuickBooks list is seeded once however often the file runs
select count(*) as qbo_items from qbo_items;

\echo -- an administrator invoices an order on a pallet
set role authenticated;
select set_config('request.jwt.claim.sub', md5('admin')::text, false);
insert into dealer_invoices(order_id, pallet_id, pallet_name, invoice_no, charge, total)
  values (md5('a')::uuid, md5('p1')::text, 'SFD 1', '1043', 'charge', 1200) returning invoice_no, charge, created_by = auth.uid() as mine;
\echo -- the same order again is refused while the first is live
insert into dealer_invoices(order_id, invoice_no, charge) values (md5('a')::uuid, '1044', 'charge');
\echo -- a charge that is neither is refused
insert into dealer_invoices(order_id, invoice_no, charge) values (md5('b')::uuid, '1045', 'maybe');
\echo -- a no charge remake is fine
insert into dealer_invoices(order_id, invoice_no, charge, reason, total) values (md5('b')::uuid, '1045', 'no_charge', 'Shipping damage', 0) returning invoice_no, charge;
\echo -- nobody deletes one, it is voided instead
delete from dealer_invoices where invoice_no = '1043';
update dealer_invoices set voided_at = now(), voided_by = auth.uid() where invoice_no = '1043' returning invoice_no, voided_at is not null as voided;
\echo -- and once voided the order can be invoiced again
insert into dealer_invoices(order_id, invoice_no, charge, total) values (md5('a')::uuid, '1046', 'charge', 1200) returning invoice_no;
insert into invoice_settings(dealer_id, qbo_customer) select id, 'South Florida Doors & Closets' from dealers where slug='SOUTHFLORIDA'
  on conflict (dealer_id) do update set qbo_customer = excluded.qbo_customer returning qbo_customer, currency, discount_pct, tariff_pct;
insert into qbo_item_map(key, item) values ('door:kingston|Hollow', 'GMD-Wholesale:Kingston HC') returning key, item;
\echo -- customs papers are kept, and never deleted
insert into pallet_customs_docs(pallet_id, pallet_name, order_ids, html, total)
  values (md5('p1')::text, 'SFD 1', jsonb_build_array(md5('a')::uuid, md5('b')::uuid), '<html></html>', 1200) returning pallet_name, jsonb_array_length(order_ids) as orders;
delete from pallet_customs_docs;
update invoice_settings set ship_to = 'South Florida Doors' returning ship_to;
reset role;

\echo -- everybody else sees and writes nothing
do $$ declare n text; r record; begin
  for n in select unnest(array['user','sales','installer','dealer','dadmin','cdealer','stranger']) loop
    perform set_config('request.jwt.claim.sub', md5(n)::text, false);
    set local role authenticated;
    select (select count(*) from dealer_invoices) inv, (select count(*) from invoice_settings) st,
           (select count(*) from qbo_items) qi, (select count(*) from qbo_item_map) qm, (select count(*) from pallet_customs_docs) cd into r;
    raise notice '% sees invoices % settings % items % map % customs %', n, r.inv, r.st, r.qi, r.qm, r.cd;
    begin
      insert into dealer_invoices(order_id, invoice_no, charge) values (md5('c')::uuid, '9999', 'charge');
      raise notice '%  WROTE AN INVOICE', n;
    exception when others then raise notice '%  may not write an invoice', n; end;
    begin
      insert into pallet_customs_docs(pallet_id, html) values ('x', 'x');
      raise notice '%  WROTE CUSTOMS PAPERS', n;
    exception when others then raise notice '%  may not write customs papers', n; end;
    reset role;
  end loop;
end $$;

\echo -- what is there at the end
select invoice_no, charge, reason, total, voided_at is not null as voided from dealer_invoices order by invoice_no;

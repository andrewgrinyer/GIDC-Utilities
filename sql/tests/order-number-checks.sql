-- TEST ONLY. Run by order-number.sh against the throwaway database.
\set ON_ERROR_STOP 0
\echo -- filled on install: C was linked by id, so it carries 4273
select order_ref, access_order_id, access_order_no from dealer_orders order by order_ref;

\echo -- a dealer may not set it, through the function or round it
set role authenticated;
select set_config('request.jwt.claim.sub', md5('dealer')::text, false);
select gidc_set_access_order_no(md5('a')::uuid, '5067');
update dealer_orders set access_order_no = '5067' where id = md5('a')::uuid;
reset role;

\echo -- an administrator sets the job number and gets the id two along
set role authenticated;
select set_config('request.jwt.claim.sub', md5('admin')::text, false);
select gidc_set_access_order_no(md5('a')::uuid, ' #5067 ');
\echo -- a number Access has not sent yet is kept, not linked
select gidc_set_access_order_no(md5('b')::uuid, '7001');
\echo -- the same job on a second order is refused
select gidc_set_access_order_no(md5('b')::uuid, '5067');
\echo -- a number two jobs share is refused
select gidc_set_access_order_no(md5('b')::uuid, '6000');
\echo -- letters are refused
select gidc_set_access_order_no(md5('b')::uuid, 'abc');
\echo -- and the sync steps are not for people
select gidc_link_dealer_orders_by_no();
reset role;

\echo -- the job turns up in Access, and the hour after it is linked
insert into access_dealer_orders values (7003,'7001','SFD','Newjob','5',4,'2026-10-22',now());
set role service_role;
select gidc_link_dealer_orders_by_no() as linked, gidc_fill_access_order_no() as filled;
reset role;
select order_ref, access_order_id, access_order_no from dealer_orders order by order_ref;

\echo -- clearing it unlinks
set role authenticated;
select set_config('request.jwt.claim.sub', md5('admin')::text, false);
select gidc_set_access_order_no(md5('a')::uuid, '');
reset role;
select order_ref, access_order_id, access_order_no from dealer_orders order by order_ref;

\echo -- unlinking or relinking inside the order takes the number with it
set role authenticated;
select set_config('request.jwt.claim.sub', md5('admin')::text, false);
update dealer_orders set access_order_id = null where id = md5('b')::uuid;
update dealer_orders set access_order_id = 5069 where id = md5('c')::uuid;
reset role;
set role service_role;
select gidc_link_dealer_orders_by_no() as linked_again;
reset role;
select order_ref, access_order_id, access_order_no from dealer_orders order by order_ref;

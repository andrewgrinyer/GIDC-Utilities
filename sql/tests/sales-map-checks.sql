-- TEST ONLY. Run by sales-map.sh against the throwaway database.
\set ON_ERROR_STOP 0
\pset footer off

\echo -- seeded: three showrooms (want Cambridge, Mississauga, Burlington)
select name, address from sales_map_showrooms order by sort;

\echo -- the server loads (as the service key does)
set role service_role;
select sales_map_load('[
 {"estimate_id":1,"name":"A","rep":" Nick ","address":"1 Main St","city":"Cambridge","created_on":"2026-01-05","measure_on":"2026-01-10","lat":43.39,"lng":-80.31,"placed_by":"address"},
 {"estimate_id":2,"name":"B","created_on":"2026-02-05","showroom_on":"2026-02-08","sold_on":"2026-02-20","order_no":"5067"},
 {"estimate_id":2,"name":"B again","created_on":"2026-02-05"}
]'::jsonb, '[{"name":"Cambridge","lat":43.4,"lng":-80.3}]'::jsonb, '{"sent":3}'::jsonb);
reset role;
\echo -- want 2 customers, Cambridge placed, run counted
select estimate_id, name, rep, sold_on, lat from sales_map_customers order by 1;
select name, lat, lng from sales_map_showrooms order by sort;
select counts from sales_map_runs;

\echo -- a second load replaces the lot (want only 3)
set role service_role;
select sales_map_load('[{"estimate_id":3,"created_on":"2026-03-01"}]'::jsonb, '[]'::jsonb, null);
reset role;
select estimate_id from sales_map_customers;

\echo -- a page cannot load (want permission denied)
set role authenticated;
select sales_map_load('[]'::jsonb, '[]'::jsonb, null);
reset role;

\echo -- who can see it (want admin 1 and 3 showrooms; everybody else 0)
do $$ declare n text; c int; s int; begin
  foreach n in array array['admin','user','sales','manufacturing','installer','dealer','dadmin','cdealer','stranger'] loop
    perform set_config('request.jwt.claim.sub', md5(n)::text, false);
    set local role authenticated;
    select count(*) into c from sales_map_customers;
    select count(*) into s from sales_map_showrooms;
    reset role;
    raise notice '% sees % customers, % showrooms', n, c, s;
  end loop;
end $$;

\echo -- nobody signed in sees anything (want permission denied)
set role anon;
select count(*) from sales_map_customers;
reset role;

\echo -- a page cannot write (want permission denied)
select set_config('request.jwt.claim.sub', md5('admin')::text, false);
set role authenticated;
insert into sales_map_customers (estimate_id, created_on) values (9, '2026-01-01');
update sales_map_showrooms set lat = 0;
reset role;

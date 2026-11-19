-- TEST ONLY. Run by paint.sh against the throwaway database.
\set ON_ERROR_STOP 0
\pset footer off
create or replace function pg_temp.as_who(n text) returns void language sql as
$$ select set_config('request.jwt.claim.sub', md5(n)::text, false); $$;

insert into auth.users(id,email) values (md5('manufacturing')::uuid,'manufacturing@x.ca');
update profiles set name='manufacturing', role='manufacturing' where id=md5('manufacturing')::uuid;

\echo -- the server loads a schedule (as the service key does)
set role service_role;
select paint_schedule_load('[
 {"order_id":5069,"order_no":"5067","job":"Aris","colour":"Chantilly Lace OC-65","doors":12,"prime_on":"2026-11-23","paint_on":"2026-11-24"},
 {"order_id":5069,"order_no":"5067","job":"Aris","colour":"BM Chantily lace","doors":2,"prime_on":"2026-11-23","paint_on":"2026-11-24"},
 {"order_id":5070,"order_no":"5068","job":"Cortes","colour":"Extra-White","doors":7,"prime_on":"2026-11-23","paint_on":"2026-11-25"},
 {"order_id":5071,"order_no":"5069","job":"SFD Abraham","colour":"Hale Navy","doors":4,"prime_on":"2026-11-24","paint_on":"2026-11-25"},
 {"order_id":5071,"order_no":"5069","job":"SFD Abraham","colour":"Hale Navy","doors":1,"prime_on":"2026-11-24","paint_on":"2026-11-25"},
 {"order_id":5072,"order_no":"5070","job":"Old job","colour":"Primer Only","doors":3,"prime_on":"2026-11-01","paint_on":null},
 {"order_id":5073,"order_no":"5071","job":"No colour","colour":"","doors":2,"prime_on":"2026-11-26","paint_on":"2026-11-27"}
]'::jsonb, '2026-11-05');
reset role;
\echo -- want: Aris 14 Chantilly Lace stock, Cortes 7 Extra White stock, Abraham 5 Hale Navy custom, Old job Primer only, No colour none
select job, doors, colour, kind from paint_schedule_lines order by job;

\echo -- a second load without the old job keeps it (its days are before keep_before) and drops Cortes
set role service_role;
select paint_schedule_load('[
 {"order_id":5069,"order_no":"5067","job":"Aris","colour":"Chantilly Lace OC-65","doors":10,"prime_on":"2026-11-23","paint_on":"2026-11-24"}
]'::jsonb, '2026-11-05');
reset role;
\echo -- want: Aris 10 and Old job 3 only
select job, doors from paint_schedule order by job;

\echo -- what each login can see (want: admin manufacturing 2; everybody else 0)
do $$ declare n text; c int; begin
  foreach n in array array['admin','user','sales','manufacturing','installer','dealer','dadmin','cdealer','stranger'] loop
    perform set_config('request.jwt.claim.sub', md5(n)::text, false);
    set local role authenticated;
    select count(*) into c from paint_schedule_lines;
    reset role;
    raise notice '% sees %', n, c;
  end loop; end $$;

\echo -- signed out sees nothing (want: permission denied twice)
set role anon; select count(*) from paint_schedule; select count(*) from paint_colours; reset role;

\echo -- a signed in page may not load or change the schedule (want: permission denied twice)
set role authenticated; select pg_temp.as_who('admin');
select paint_schedule_load('[]'::jsonb, '2026-11-05');
delete from paint_schedule;
reset role;

\echo -- the shop counts and orders; names are stamped by the database
set role authenticated; select pg_temp.as_who('manufacturing');
insert into paint_counts(colour, gallons, counted_on, created_by) values ('Alabaster', 12.5, '2026-11-18', 'someone else');
insert into paint_orders(colour, pails_5, pails_1, status, emailed_at, requested_by) values ('Alabaster', 2, 1, 'received', now(), 'someone else');
update paint_colours set warn_gallons = 8 where name = 'Alabaster';
reset role;
\echo -- want: manufacturing, requested, 11 gallons, emailed_at blank, warn 8
select created_by from paint_counts;
select requested_by, status, gallons, emailed_at from paint_orders;
select warn_gallons, updated_by from paint_colours where name = 'Alabaster';

\echo -- a page may not change what was asked for, only mark it received (want: 2 1 received manufacturing)
set role authenticated; select pg_temp.as_who('manufacturing');
update paint_orders set pails_5 = 9, pails_1 = 9, status = 'received';
reset role;
select pails_5, pails_1, status, received_on = current_date as today, received_by from paint_orders;

\echo -- sales, an installer and a dealer may not count, order or change coverage (want: refused, refused, 0 rows)
do $$ declare n text; begin
  foreach n in array array['sales','installer','dealer','user'] loop
    perform set_config('request.jwt.claim.sub', md5(n)::text, false);
    set local role authenticated;
    begin insert into paint_counts(colour, gallons) values ('Primer', 1); raise notice '% COUNT WENT IN', n;
    exception when others then raise notice '% count refused', n; end;
    begin insert into paint_orders(colour, pails_5) values ('Primer', 1); raise notice '% ORDER WENT IN', n;
    exception when others then raise notice '% order refused', n; end;
    update paint_colours set doors_per_pail = 1;
    reset role;
  end loop; end $$;
select name, doors_per_pail from paint_colours where doors_per_pail = 1;

\echo -- colour words: want Pure White, Chantilly Lace twice, Primer only twice, null twice, Sea Salt, null
select paint_colour_of('PURE WHITE (OC-64)'), paint_colour_of('Katie Chantilly'), paint_colour_of('Chantilly Lae'), paint_colour_of('PRIMER ONLY'), paint_colour_of('Prime only'), paint_colour_of('TBD'), paint_colour_of('Null'),
       paint_colour_of(' Sea Salt '), paint_colour_of('  ');

\echo -- PO numbers: want PD00001, PD00002, PD00003 with no gaps from the refused tries above; a page cannot pick or change one
set role authenticated; select pg_temp.as_who('manufacturing');
insert into paint_orders(colour, pails_5, po_no) values ('Pure White', 1, 'PD99999');
insert into paint_orders(colour, custom, pails_1, for_job) values ('Hale Navy', true, 2, '  Abraham ');
update paint_orders set po_no = 'PD12345' where colour = 'Pure White';
reset role;
select po_no, colour, for_job from paint_orders order by po_no;

\echo -- a custom colour with no customer is refused, a stocked colour with none is fine (want: violates, then PD00004)
set role authenticated; select pg_temp.as_who('manufacturing');
insert into paint_orders(colour, custom, pails_1, for_job) values ('Sea Salt', true, 1, '   ');
insert into paint_orders(colour, pails_1) values ('Pearly', 1) returning po_no;
reset role;

\echo -- OTHER COLOURS: the earlier Hale Navy order put Hale Navy on the shelf (want: Hale Navy other, Hale Navy)
select name, kind, match_words, doors_per_pail from paint_colours where kind = 'other';
select po_no, colour, stock_colour from paint_orders where custom;

\echo -- the shop adds one with the New paint colour button; the same name again is refused; a standard one cannot be added
set role authenticated; select pg_temp.as_who('manufacturing');
insert into paint_colours(name, kind) values ('  Oxford   White ', 'other') returning name, kind, match_words, sort;
insert into paint_colours(name, kind) values ('oxford white', 'other');
insert into paint_colours(name, kind) values ('Navy', 'stock');
insert into paint_counts(colour, gallons) values ('Oxford White', 3);
\echo -- sales may not add one (want: refused)
select pg_temp.as_who('sales');
insert into paint_colours(name, kind) values ('Sea Salt', 'other');
reset role;

\echo -- the schedule draws on it: want Oxford White other, Hale Navy other, Extra White stock, Sea Salt custom
select paint_colour_of('Oxford White (OC 17)'), paint_colour_of('HALE NAVY HC-154'), paint_colour_of('Extra White'), paint_colour_of('Sea Salt');
set role service_role;
select paint_schedule_load('[{"order_id":6001,"order_no":"6000","job":"Ox","colour":"Oxford White (OC 17)","doors":7,"prime_on":"2026-11-30","paint_on":"2026-11-30"}]'::jsonb, '2026-11-05');
reset role;
select job, colour, kind from paint_schedule_lines where job = 'Ox';

\echo -- an order for Oxford White (OC 17) adds to Oxford White, keeps its own name for Ashley, adds no new colour
set role authenticated; select pg_temp.as_who('manufacturing');
insert into paint_orders(colour, custom, pails_1, for_job) values ('Oxford White (OC 17)', true, 2, 'Ox') returning po_no, colour, stock_colour;
\echo -- a page cannot change which colour it adds to
update paint_orders set stock_colour = 'Pearly', status = 'received' where colour = 'Oxford White (OC 17)' returning stock_colour, status;
reset role;
select count(*) as other_colours from paint_colours where kind = 'other';

\echo -- used up: removing it takes its counts; the five cannot be removed (want: 1 row, 0 counts, then 0 rows)
set role authenticated; select pg_temp.as_who('manufacturing');
delete from paint_colours where name = 'Oxford White' returning name;
delete from paint_colours where name = 'Pearly' returning name;
update paint_colours set kind = 'other' where name = 'Pearly' returning kind;
reset role;
select count(*) as oxford_counts from paint_counts where colour = 'Oxford White';

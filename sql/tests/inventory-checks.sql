-- TEST ONLY. Run by inventory.sh against the throwaway database.
\set ON_ERROR_STOP 0
\pset footer off
create or replace function pg_temp.as_who(n text) returns void language sql as
$$ select set_config('request.jwt.claim.sub', md5(n)::text, false); $$;

insert into auth.users(id,email) values (md5('manufacturing')::uuid,'manufacturing@x.ca');
update profiles set name='manufacturing', role='manufacturing' where id=md5('manufacturing')::uuid;

\echo -- staff add two doors; the name is stamped by the database
set role authenticated; select pg_temp.as_who('sales');
insert into door_inventory(style,width_in,height_in,core,qty,notes,created_by)
  values ('Clear 1-Lite',30,80,'Solid',2,'Rack B, left hand','somebody else');
select pg_temp.as_who('admin');
insert into door_inventory(style,width_in,height_in,core,qty) values ('Shaker 2 Panel',28,80,'Hollow',1);
reset role;
select style, width_in, height_in, core, qty, created_by from door_inventory order by style;

\echo -- what each login can see (want: admin user sales manufacturing installer 2; dealers and stranger 0)
do $$ declare n text; c int; begin
  foreach n in array array['admin','user','sales','manufacturing','installer','dealer','dadmin','cdealer','stranger'] loop
    perform set_config('request.jwt.claim.sub', md5(n)::text, false);
    set local role authenticated;
    select count(*) into c from door_inventory;
    reset role;
    raise notice '% sees %', n, c;
  end loop; end $$;

\echo -- signed out sees nothing (want: permission denied)
set role anon; select count(*) from door_inventory; reset role;

\echo -- an installer may not add, change or remove (want: refused, 0 rows, 0 rows)
set role authenticated; select pg_temp.as_who('installer');
insert into door_inventory(style,width_in,height_in,core) values ('X',30,80,'Hollow');
update door_inventory set qty = 9 returning id;
delete from door_inventory returning id;
reset role;

\echo -- a dealer may not add, change or remove (want: refused, 0 rows, 0 rows)
set role authenticated; select pg_temp.as_who('dealer');
insert into door_inventory(style,width_in,height_in,core) values ('X',30,80,'Hollow');
update door_inventory set qty = 9 returning id;
delete from door_inventory returning id;
reset role;

\echo -- bad values refused (want: core error, a Bifold row, two more errors)
set role authenticated; select pg_temp.as_who('admin');
insert into door_inventory(style,width_in,height_in,core) values ('  ',30,80,'Hollow');
insert into door_inventory(style,width_in,height_in,core) values ('X',30,80,'Glass');
insert into door_inventory(style,width_in,height_in,core) values ('Columbia',30,80,'Bifold') returning core;
insert into door_inventory(style,width_in,height_in,core,qty) values ('X',30,80,'Solid',-1);

\echo -- manufacturing takes one off the shelf; changed by is stamped
select pg_temp.as_who('manufacturing');
update door_inventory set qty = qty - 1 where style = 'Clear 1-Lite' returning qty, created_by, updated_by;
reset role;

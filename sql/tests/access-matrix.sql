-- ====================================================================
--  TEST ONLY. Read only. What each kind of login can see: prices,
--  orders, profiles. Run by run.sh after the files under test.
-- ====================================================================
create or replace function pg_temp.m() returns table(who text, prices bigint, orders bigint, profiles bigint) language plpgsql as $$
declare n text; begin
foreach n in array array['admin','user','sales','installer','dealer','dadmin','cdealer','stranger'] loop
  perform set_config('request.jwt.claim.sub', md5(n)::text, true);
  set local role authenticated;
  who:=n; select count(*) into prices from prices; select count(*) into orders from orders; select count(*) into profiles from profiles;
  reset role;
  return next; end loop; end $$;
begin; select * from pg_temp.m(); commit;

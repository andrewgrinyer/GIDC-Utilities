-- ====================================================================
--  WHAT IS ACTUALLY EXPOSED
--  Read only. Nothing is changed by running this.
-- ====================================================================
--
--  Run this any time you want the real state of the database rather
--  than what anybody remembers writing. Query 1 matters most.
-- ====================================================================

-- ---------- 1. WHAT A BRAND NEW ACCOUNT IS GIVEN --------------------
-- Every account created in Supabase fires a trigger that makes a
-- profile row. Whatever role that trigger writes is what a brand new
-- account gets, including one created by somebody signing themselves
-- up. If that is a working role, the only thing between a stranger and
-- the inside of this system is whether signups happen to be off.
select p.proname                                    as trigger_function,
       case when pg_get_functiondef(p.oid) ~* $re$'user'$re$  then 'ROLE user: full Grinyer staff'
            when pg_get_functiondef(p.oid) ~* $re$'admin'$re$ then 'ROLE admin: everything'
            else 'read the definition below' end     as what_it_grants,
       pg_get_functiondef(p.oid)                     as the_definition
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname = 'handle_new_user';

-- ---------- 2. EVERY TABLE, AND WHETHER ANYTHING GUARDS IT ----------
-- A table with row level security off is readable by anybody holding
-- the publishable key, which is printed in every page.
select c.relname                                     as table_name,
       case when c.relrowsecurity then 'on' else 'OFF' end as row_security,
       count(pol.polname)                            as policies,
       case when not c.relrowsecurity then 'NO RULES AT ALL: anyone signed in can read this'
            when count(pol.polname) = 0 then 'locked: security on but no policy, so nobody reads it'
            else '' end                              as note
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  left join pg_policy pol on pol.polrelid = c.oid
 where n.nspname = 'public' and c.relkind = 'r'
 group by c.relname, c.relrowsecurity
 order by c.relrowsecurity, c.relname;

-- ---------- 3. EVERY RULE, IN FULL ----------------------------------
select tablename, policyname, cmd,
       coalesce(qual, '')       as who_may_read_it,
       coalesce(with_check, '') as what_they_may_write
  from pg_policies where schemaname = 'public'
 order by tablename, cmd, policyname;

-- ---------- 4. RULES WRITTEN AS A DENYLIST --------------------------
-- A rule that says "anybody except X" admits every role invented
-- afterwards, because nobody goes back to add them to the exception.
select tablename, policyname, qual as the_rule
  from pg_policies
 where schemaname = 'public'
   and (qual ~* '<>' or qual ~* ' not in ' or qual ~* '!=')
 order by tablename;

-- ---------- 5. THE SAME QUESTION ABOUT THE FUNCTIONS ----------------
-- Most rules call a function rather than spelling the test out, so the
-- denylists hide in here.
select p.proname                   as function_name,
       pg_get_functiondef(p.oid)   as definition,
       case when pg_get_functiondef(p.oid) ~* '<>|not in|!=' then 'WRITTEN AS A DENYLIST'
            else '' end            as note
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('is_admin','is_staff','is_team','is_team_no_installer',
                     'is_production','is_installer','is_buying_dealer',
                     'has_dealer_access','is_dealer_admin',
                     'can_order','can_see_prices','my_dealer','kpi_may_read',
                     'email_ok','verification_required')
 order by p.proname;

-- ---------- 6. WHO HOLDS WHAT ---------------------------------------
-- Counts only, no names or addresses.
select coalesce(p.role, '(none)')                             as team,
       coalesce(p.dealer_role, '(none)')                      as dealer,
       count(*)                                               as logins,
       count(*) filter (where coalesce(p.active, true))       as still_active,
       case when p.role is null and p.dealer_role is null
              then 'no access, which is the safe state'
            when coalesce(p.role,'admin') not in ('admin','user','sales','manufacturing','installer')
              then 'UNRECOGNISED TEAM ROLE: nothing expects it, so nothing refuses it'
            else '' end                                       as note
  from public.profiles p
 group by p.role, p.dealer_role
 order by count(*) desc;

-- ---------- 7. ANYTHING RUNNING AS ITS OWNER ------------------------
-- A security definer function runs with the rights of whoever made it.
-- That is correct and necessary for a policy helper. It is also how a
-- mistake becomes a way in, so the list is worth knowing.
select p.proname                                      as function_name,
       pg_get_function_identity_arguments(p.oid)      as takes,
       case when p.proconfig is null then 'NO search_path SET: worth fixing'
            else array_to_string(p.proconfig, ', ') end as settings
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.prosecdef
 order by (p.proconfig is null) desc, p.proname;

-- ---------- 8. WHAT THE PUBLIC KEY CAN REACH WITHOUT SIGNING IN -----
-- anon is the role a page uses before anybody signs in. Anything here
-- is readable by a stranger with the publishable key.
--
-- Wrapped, because the role belongs to Supabase. On Supabase it is
-- always there. Anywhere else it is not, and an audit that stops with
-- an error about a missing role is no use to anybody.
do $$
declare r record; n int := 0;
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    raise notice 'No anon role here, so this question does not apply.';
    return;
  end if;
  for r in
    select c.relname, c.relkind
      from pg_class c join pg_namespace n2 on n2.oid = c.relnamespace
     where n2.nspname = 'public' and c.relkind in ('r','v')
       and has_table_privilege('anon', c.oid, 'SELECT')
       and (c.relkind = 'v' or not c.relrowsecurity)
     order by c.relname
  loop
    n := n + 1;
    raise notice 'anon can read %  (%)', rpad(r.relname, 34),
      case r.relkind when 'v' then 'a view, which does not have rules of its own'
                     else 'a table with row level security off' end;
  end loop;
  if n = 0 then
    raise notice 'Nothing is reachable without signing in. This is the answer you want.';
  else
    raise notice '% object(s) above are readable by anybody holding the publishable key.', n;
  end if;
end $$;

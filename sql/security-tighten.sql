-- ====================================================================
--  THREE HOLES, CLOSED
--  Run this in the Supabase SQL editor. Safe to run twice.
--  Nothing anybody currently has is taken away.
-- ====================================================================
--
--  Andrew, 21 October: what do I recommend to improve security.
--
--  1. A BRAND NEW ACCOUNT IS HANDED THE RUN OF THE PLACE
--
--     Every account made in Supabase fires a trigger that writes a
--     profile with role 'user'. That is a working Grinyer staff role.
--     It opens every tool on the tools site, the company dashboard with
--     revenue on it, and the wholesale price list.
--
--     We know self signup is enabled, because the measurement app
--     creates logins by calling the public signup endpoint with the
--     publishable key. So this is live, not theoretical: anybody who
--     can reach that endpoint with a key printed in every page on the
--     site can have all of the above, uninvited, with nobody told.
--
--     After this, a new account gets no role at all and can see
--     nothing until somebody grants it. The screen where you create
--     logins sets the role straight after, so making a login the
--     normal way is unaffected.
--
--     DO THIS AS WELL, IN THE SUPABASE DASHBOARD. Authentication,
--     Sign In / Providers, Email: turn OFF "Allow new users to sign
--     up". This file is the braces: if that switch is ever turned back
--     on, a stranger still gets nothing. Note that turning it off stops
--     the measurement app from creating logins, which is deliberate:
--     logins are made on the tools site, which goes through an edge
--     function with a proper admin key and is unaffected.
--
--  2. THE PRICE LIST IS GUARDED BY A DENYLIST
--
--     can_see_prices() says "anybody whose role is not dealer_admin".
--     A rule written that way lets in every role invented afterwards,
--     and a role with no name at all, which is how a new account could
--     read REV002. It becomes a list of who may.
--
--  3. A STAFF LOGIN CAN ONLY SEE ITSELF
--
--     Mine, from 20 October. The rule on profiles decided "is this
--     person staff" by asking whether my_dealer() is null. When I fixed
--     the short name matching, my_dealer() started returning Grinyer's
--     own record for staff instead of nothing, which is correct, and
--     that test quietly became false. A login with role 'user' can see
--     only its own profile. Sales and manufacturing are unaffected,
--     because the Grinyer fallback only applies to 'user'.
-- ====================================================================

-- ---------- 0. who works here ----------------------------------------
-- One allowlist, used by everything below. Written twice because the
-- active column arrived with the installer roles and naming a column
-- that is not there is an error rather than a null. An error inside a
-- policy fails the whole query, so it would lock everybody out rather
-- than let anybody in.
do $$
declare has_active boolean;
begin
  select exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'profiles'
       and column_name = 'active'
  ) into has_active;

  if has_active then
    execute $fn$
      create or replace function public.is_team()
      returns boolean language sql stable security definer set search_path = public as $body$
        select exists (
          select 1 from public.profiles p
           where p.id = auth.uid()
             and coalesce(p.active, true)
             and p.role in ('admin', 'user', 'sales', 'manufacturing', 'installer')
        );
      $body$
    $fn$;
  else
    execute $fn$
      create or replace function public.is_team()
      returns boolean language sql stable security definer set search_path = public as $body$
        select exists (
          select 1 from public.profiles p
           where p.id = auth.uid()
             and p.role in ('admin', 'user', 'sales', 'manufacturing', 'installer')
        );
      $body$
    $fn$;
  end if;
end $$;

comment on function public.is_team is
  'Everybody who works at Grinyer, installers included. A list of who '
  'is, never a list of who is not, so a role invented later is shut out '
  'until somebody lets it in rather than the other way round.';

do $$ begin
  execute 'grant execute on function public.is_team() to authenticated';
exception when undefined_object then null;
end $$;

-- ---------- 1. a new account gets nothing ----------------------------
-- The profile is still made, so the name and address are recorded and
-- the Users screen can see the account exists. It simply has no role,
-- and every check in the system is a list of roles that may, so no role
-- means no.
--
-- The on conflict clause keeps an existing role untouched, so running
-- this cannot demote anybody who already has one.
--
-- Added 23 October on rechecking: if role was ever declared not null,
-- writing a profile with no role would fail, and because the trigger
-- runs inside the account insert, every new login would fail with it,
-- the ones made on the tools site included. Nothing in the repo says
-- whether that constraint exists, so this makes sure it does not.
-- Harmless if it was never there, and harmless run twice.
alter table public.profiles alter column role drop not null;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, name, email, role)
  values (new.id,
          coalesce(new.raw_user_meta_data->>'name', split_part(new.email,'@',1)),
          new.email,
          null)                     -- no role. Somebody grants it, on purpose.
  on conflict (id) do update
    set email = excluded.email,
        name  = coalesce(nullif(public.profiles.name,''), excluded.name);
        -- role is deliberately not touched here
  return new;
end $$;

comment on function public.handle_new_user is
  'Makes the profile when an account is made. Gives it no role: an '
  'account that nobody granted anything to can see nothing. Before 21 '
  'October 2026 it gave every new account role ''user'', which is full '
  'Grinyer staff including the wholesale price list.';

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- 2. the price list, as a list of who may ------------------
-- Staff see prices because they quote from them. A dealer sees prices
-- because they buy at them. A dealer administrator does not, which is
-- what the old rule was trying to say. An installer does not, which is
-- new and deliberate: there is nothing on a job site that needs the
-- wholesale cost of a door. Nobody without a role does.
do $$
declare has_active boolean; act text;
begin
  select exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'profiles'
       and column_name = 'active') into has_active;
  act := case when has_active then 'and coalesce(p.active, true)' else '' end;

  execute format($fn$
    create or replace function public.is_team_no_installer()
    returns boolean language sql stable security definer set search_path = public as $body$
      select exists (select 1 from public.profiles p
                      where p.id = auth.uid() %s
                        and p.role in ('admin','user','sales','manufacturing'));
    $body$ $fn$, act);

  -- A dealer is recorded in role today and in dealer_role once
  -- two-sided-access.sql has run. This reads whichever of the two is
  -- actually there, so the two files can be run in either order, on
  -- either day, without a dealer silently losing the price list.
  --
  -- The second column has to be named conditionally rather than just
  -- tested: naming a column that does not exist is an error, not a
  -- null, and an error inside a policy fails the whole query.
  declare dealer_test text;
  begin
    if exists (select 1 from information_schema.columns
                where table_schema = 'public' and table_name = 'profiles'
                  and column_name = 'dealer_role')
    then dealer_test := $t$(p.role = 'dealer' or p.dealer_role = 'dealer')$t$;
    else dealer_test := $t$p.role = 'dealer'$t$;
    end if;

    execute format($fn$
      create or replace function public.is_buying_dealer()
      returns boolean language sql stable security definer set search_path = public as $body$
        select exists (select 1 from public.profiles p
                        where p.id = auth.uid() %s
                          and %s
                          and p.dealer_id is not null);
      $body$ $fn$, act, dealer_test);
  end;
end $$;

create or replace function public.can_see_prices()
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_team_no_installer() or public.is_buying_dealer();
$$;

do $$ begin
  execute 'grant execute on function public.can_see_prices() to authenticated';
  execute 'grant execute on function public.is_team_no_installer() to authenticated';
  execute 'grant execute on function public.is_buying_dealer() to authenticated';
exception when undefined_object then null;
end $$;

comment on function public.can_see_prices is
  'Who may read the wholesale price list. A list of who may. Until 21 '
  'October 2026 this said "anybody who is not a dealer administrator", '
  'which let in every role invented afterwards and every account with '
  'no role at all.';

-- ---------- 3. staff can see staff again -----------------------------
-- The clause that meant "is this person staff" asked whether my_dealer()
-- is null, which stopped being true for staff when the short name
-- matching was fixed. It asks about the role now.
--
-- Installers are in is_team() on purpose, so nothing they use changes.
drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles for select to authenticated
  using (
    id = auth.uid()                               -- always your own
    or public.is_admin()                          -- an administrator sees everyone
    or (public.is_team() and dealer_id is null)   -- the team see the team
    or dealer_id = public.my_dealer()             -- a dealer sees their own people
  );

notify pgrst, 'reload schema';

-- ====================================================================
--  WHAT IT LOOKS LIKE NOW
-- ====================================================================
select coalesce(p.role, '(no role)')                        as role,
       count(*)                                             as logins,
       case when p.role is null then 'can see nothing until granted'
            when p.role in ('admin','user','sales','manufacturing')
              then 'team, and may see the price list'
            when p.role = 'installer' then 'team, and may NOT see the price list'
            when p.role = 'dealer' then 'their own orders, and the price list'
            when p.role = 'dealer_admin' then 'their own orders, and no prices'
            else 'UNRECOGNISED: nothing expects this role'
       end                                                  as what_they_get
  from public.profiles p
 group by p.role
 order by count(*) desc;

-- ====================================================================
--  ONE LOGIN, TWO KINDS OF ACCESS
--  Part one of the login change: the database.
--  Run this in the Supabase SQL editor. Safe to run twice.
-- ====================================================================
--
--  Andrew, 21 October: handle dealer and employee logins from one
--  screen, two columns, and let anybody have one side or the other or
--  both.
--
--  WHY THIS IS NOT A SMALL CHANGE
--
--  Until now role is one column holding one word. Team and dealer are
--  two values of the same field, which is exactly why nobody can be
--  both: saying someone is a dealer says they are not staff, in the
--  same breath, whether or not that was meant.
--
--  So it splits in two.
--
--     role          the team side.   null, admin, user, sales,
--                                    manufacturing, installer
--     dealer_role   the dealer side. null, dealer, dealer_admin
--     dealer_id     which dealer, required when dealer_role is set
--
--  Either may be empty. Both may be filled. Somebody with neither can
--  see nothing, which is the state a brand new account arrives in.
--
--  WHAT MAKES IT TRACTABLE
--
--  Every rule in the database compares dealer_id against my_dealer().
--  Not one of them reads the role column itself. So the rules do not
--  change at all: the handful of functions they lean on do, and the
--  rules follow.
--
--  ONE RULE WORTH STATING OUT LOUD
--
--  A Grinyer staff login with no dealer of its own orders against
--  Grinyer's own record. Somebody who has been given real dealer access
--  acts for that dealer instead. Explicit access wins over the
--  fallback, so there is never a question of which one a person is at
--  any moment.
--
--  WHAT THIS DOES NOT DO
--
--  Nothing about email verification, invitations or password resets,
--  which are later parts. Nothing about the screens. Running this on
--  its own changes nobody's access: the migration moves existing
--  dealers across and every check comes out the same as before.
-- ====================================================================

-- ---------- 1. the column ---------------------------------------------
alter table public.profiles
  add column if not exists dealer_role text;

comment on column public.profiles.dealer_role is
  'The dealer side: dealer, dealer_admin, or null for no dealer access. '
  'Separate from role, which is the team side, so one person can have '
  'either, both or neither.';

comment on column public.profiles.role is
  'The team side: admin, user, sales, manufacturing, installer, or null '
  'for no team access. Dealer access lives in dealer_role.';

-- ---------- 2. move the dealers across --------------------------------
-- Idempotent: once a row has moved, role no longer holds a dealer word
-- and this matches nothing.
do $$
declare n int;
begin
  update public.profiles
     set dealer_role = role,
         role        = null
   where role in ('dealer', 'dealer_admin');
  get diagnostics n = row_count;
  if n > 0 then raise notice '% dealer login(s) moved to the dealer column.', n;
  else raise notice 'No dealer logins left in the team column, so this has already run.';
  end if;
end $$;

-- ---------- 3. what may be written ------------------------------------
-- The old guard said a dealer login must point at a dealer, and that a
-- team login must not. The second half is now wrong: a team login with
-- dealer access points at a dealer on purpose.
create or replace function public.profiles_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.dealer_role is not null and new.dealer_id is null then
    raise exception 'Dealer access has to say which dealer';
  end if;
  if new.dealer_role is null then
    new.dealer_id := null;        -- no dealer access, no dealer
  end if;
  if new.dealer_role is not null
     and new.dealer_role not in ('dealer', 'dealer_admin') then
    raise exception 'Unknown dealer access: %', new.dealer_role;
  end if;
  if new.role is not null
     and new.role not in ('admin', 'user', 'sales', 'manufacturing', 'installer') then
    raise exception 'Unknown team role: %', new.role;
  end if;
  return new;
end $$;

drop trigger if exists profiles_guard_trg on public.profiles;
create trigger profiles_guard_trg
  before insert or update on public.profiles
  for each row execute function public.profiles_guard();

-- ---------- 4. the helpers everything else leans on -------------------
-- Written once here, as lists of who may. The active column arrived
-- with the installer roles and may not be on every database, and naming
-- a column that is not there is an error rather than a null. An error
-- inside a policy fails the whole query, so it would shut everybody out
-- rather than let anybody in. Hence the format().
do $$
declare act text;
begin
  select case when exists (
           select 1 from information_schema.columns
            where table_schema = 'public' and table_name = 'profiles'
              and column_name = 'active')
         then 'and coalesce(p.active, true)' else '' end
    into act;

  -- If email-verification.sql has already run, its rule has to survive
  -- this file being run again, or running the files in a different order
  -- would quietly switch verification off. email_ok() is always true
  -- while the switch is off, so adding it changes nothing until then.
  if exists (select 1 from pg_proc f join pg_namespace n on n.oid = f.pronamespace
              where n.nspname = 'public' and f.proname = 'email_ok')
  then act := act || ' and public.email_ok()';
  end if;

  execute format($f$
    create or replace function public.is_team()
    returns boolean language sql stable security definer set search_path = public as $b$
      select exists (select 1 from public.profiles p
                      where p.id = auth.uid() %s
                        and p.role in ('admin','user','sales','manufacturing','installer'));
    $b$ $f$, act);

  execute format($f$
    create or replace function public.is_team_no_installer()
    returns boolean language sql stable security definer set search_path = public as $b$
      select exists (select 1 from public.profiles p
                      where p.id = auth.uid() %s
                        and p.role in ('admin','user','sales','manufacturing'));
    $b$ $f$, act);

  execute format($f$
    create or replace function public.is_admin()
    returns boolean language sql stable security definer set search_path = public as $b$
      select exists (select 1 from public.profiles p
                      where p.id = auth.uid() %s and p.role = 'admin');
    $b$ $f$, act);

  execute format($f$
    create or replace function public.is_staff()
    returns boolean language sql stable security definer set search_path = public as $b$
      select exists (select 1 from public.profiles p
                      where p.id = auth.uid() %s
                        and p.role in ('admin','user','sales','manufacturing'));
    $b$ $f$, act);

  execute format($f$
    create or replace function public.is_installer()
    returns boolean language sql stable security definer set search_path = public as $b$
      select exists (select 1 from public.profiles p
                      where p.id = auth.uid() %s and p.role = 'installer');
    $b$ $f$, act);

  execute format($f$
    create or replace function public.is_production()
    returns boolean language sql stable security definer set search_path = public as $b$
      select exists (select 1 from public.profiles p
                      where p.id = auth.uid() %s
                        and p.role in ('admin','manufacturing'));
    $b$ $f$, act);

  execute format($f$
    create or replace function public.has_dealer_access()
    returns boolean language sql stable security definer set search_path = public as $b$
      select exists (select 1 from public.profiles p
                      where p.id = auth.uid() %s
                        and p.dealer_role is not null and p.dealer_id is not null);
    $b$ $f$, act);

  execute format($f$
    create or replace function public.is_dealer_admin()
    returns boolean language sql stable security definer set search_path = public as $b$
      select exists (select 1 from public.profiles p
                      where p.id = auth.uid() %s and p.dealer_role = 'dealer_admin');
    $b$ $f$, act);

  -- WHO MAY PLACE AN ORDER
  -- Was "anybody who is not a dealer administrator", which admitted
  -- every role invented afterwards and every account with no role.
  execute format($f$
    create or replace function public.can_order()
    returns boolean language sql stable security definer set search_path = public as $b$
      select exists (select 1 from public.profiles p
                      where p.id = auth.uid() %s
                        and (p.role in ('admin','user')
                             or p.dealer_role = 'dealer'));
    $b$ $f$, act);

  -- WHO MAY SEE THE WHOLESALE PRICE LIST
  -- The office and the showroom because they quote from it, a dealer
  -- because they buy at it. Not a dealer administrator, which is what
  -- the old rule meant. Not an installer: nothing on a job site needs
  -- the wholesale cost of a door. Not an account with no access at all.
  execute format($f$
    create or replace function public.can_see_prices()
    returns boolean language sql stable security definer set search_path = public as $b$
      select exists (select 1 from public.profiles p
                      where p.id = auth.uid() %s
                        and (p.role in ('admin','user','sales','manufacturing')
                             or p.dealer_role = 'dealer'));
    $b$ $f$, act);

  -- WHICH DEALER THIS LOGIN ACTS FOR
  -- Real dealer access wins. Failing that, a Grinyer office login acts
  -- for Grinyer's own record. The in house record is found with the
  -- case and punctuation taken out, because putting the short names
  -- into capitals on 15 October hid it from a letter for letter
  -- comparison and shut the staff out of the portal.
  execute format($f$
    create or replace function public.my_dealer()
    returns uuid language sql stable security definer set search_path = public as $b$
      select case
               when p.dealer_role is not null and p.dealer_id is not null
                 then p.dealer_id
               when p.role = 'user'
                 then (select d.id from public.dealers d
                        where lower(regexp_replace(d.slug, '[^a-zA-Z0-9]', '', 'g')) = 'grinyer'
                        order by d.active desc nulls last, d.slug
                        limit 1)
               else null
             end
        from public.profiles p
       where p.id = auth.uid() %s;
    $b$ $f$, act);
end $$;

do $$
declare f text;
begin
  foreach f in array array['is_team()','is_team_no_installer()','is_admin()','is_staff()',
                           'is_installer()','is_production()','has_dealer_access()',
                           'is_dealer_admin()','can_order()','can_see_prices()','my_dealer()']
  loop
    begin
      execute 'grant execute on function public.' || f || ' to authenticated';
    exception when undefined_object then null;
    end;
  end loop;
end $$;

-- ---------- 4a. who may see whose profile -----------------------------
-- Restated here rather than left to another file, because this one
-- changes what a login IS and the rule that reads profiles has to agree
-- with it in the same breath.
--
-- The clause that means "is this person team" used to ask whether
-- my_dealer() returns nothing. That stopped being true for staff when
-- the short name matching was fixed on 20 October, and a login with
-- role user could see only itself. It asks about the team side now.
--
-- Somebody with both sides matches both clauses and sees both sets,
-- which is the point of having both.
drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles for select to authenticated
  using (
    id = auth.uid()                               -- always your own
    or public.is_admin()                          -- an administrator sees everyone
    or (public.is_team() and dealer_id is null)   -- the team see the team
    or dealer_id = public.my_dealer()             -- a dealer sees their own people
  );

-- ---------- 5. what the screens read ----------------------------------
-- Dropped first, not replaced. "create or replace view" refuses to drop
-- a column, so once email-verification.sql has added email_verified_at
-- to this view, running this file again would fail with "cannot drop
-- columns from view". Dropping makes the order of these files, and how
-- many times each is run, stop mattering.
drop view if exists public.portal_users;
create view public.portal_users as
  select p.id, p.name, p.email,
         p.role,                       -- the team side
         p.dealer_role,                -- the dealer side
         p.dealer_id, p.created_at,
         coalesce(p.active, true) as active,
         d.name as dealer_name
    from public.profiles p
    left join public.dealers d on d.id = p.dealer_id;

grant select on public.portal_users to authenticated;

-- ---------- 6. and a new account still arrives with nothing -----------
-- Restated from security-tighten.sql so that this file is the whole
-- truth about what a login is, whichever order the two are run in.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, name, email, role, dealer_role)
  values (new.id,
          coalesce(new.raw_user_meta_data->>'name', split_part(new.email,'@',1)),
          new.email,
          null, null)                 -- neither side. Somebody grants it, on purpose.
  on conflict (id) do update
    set email = excluded.email,
        name  = coalesce(nullif(public.profiles.name,''), excluded.name);
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

notify pgrst, 'reload schema';

-- ====================================================================
--  WHAT EVERY LOGIN CAN DO NOW
-- ====================================================================
-- Read it against the day before. Nothing should have moved.
select p.name,
       coalesce(p.role, '—')                            as team,
       coalesce(p.dealer_role, '—')                     as dealer,
       coalesce(d.name, '—')                            as acts_for,
       case when p.role is null and p.dealer_role is null
              then 'nothing, until somebody grants it'
            when p.role = 'admin' then 'everything'
            else trim(
              case when p.role is not null then 'team tools ' else '' end ||
              case when p.dealer_role = 'dealer' then '+ places orders '
                   when p.dealer_role = 'dealer_admin' then '+ reads orders ' else '' end ||
              case when p.role in ('admin','user','sales','manufacturing')
                        or p.dealer_role = 'dealer' then '+ prices' else '' end)
       end                                              as what_they_get
  from public.profiles p
  left join public.dealers d on d.id = p.dealer_id
 order by (p.role = 'admin') desc nulls last, p.role nulls last, p.name;

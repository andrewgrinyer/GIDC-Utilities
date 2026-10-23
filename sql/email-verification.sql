-- ====================================================================
--  VERIFY YOUR EMAIL ADDRESS
--  Part three of the login change. Run AFTER two-sided-access.sql.
--  Safe to run twice. Changes nobody's access on its own.
-- ====================================================================
--
--  Andrew, 21 October: a one time verify your email function for the
--  people who already have logins, and I like the banner idea.
--
--  WHY SUPABASE'S OWN FLAG IS NO USE HERE
--
--  Every existing login was created with its address already marked
--  confirmed, because that is what let people sign in straight away
--  without waiting for an email. So Supabase believes every address on
--  the system is verified, and that belief is worth nothing: it records
--  that a box was ticked when the account was made, not that anybody
--  ever proved they can read that mailbox.
--
--  So verification gets a record of its own. email_verified_at means
--  one thing and only one thing: this person followed a link sent to
--  that address and arrived. Nothing else sets it. An administrator
--  cannot set it by hand from the screen, because an administrator
--  saying an address is fine is the exact claim we stopped trusting.
--
--  THREE STEPS, NOT ONE
--
--  Nineteen logins. If two of those addresses have a typo or belong to
--  somebody who has left, turning this on in one go shuts those two out
--  and you are the only way back in. So:
--
--     1. MEASURE   this file. The screen shows verified against not.
--                  Nothing is blocked. Nothing changes for anybody.
--     2. NUDGE     the screen sends the link, and anybody who has not
--                  used it sees a banner. Still nothing blocked.
--     3. ENFORCE   you turn the switch on when the number looks right.
--
--  THE SWITCH CANNOT LOCK YOU OUT
--
--  Two things stop that. It refuses to turn on unless the person
--  turning it on has verified their own address, so you cannot be the
--  one left outside. And if it ever does go wrong, you always have the
--  Supabase SQL editor, which does not go through any of this:
--
--      update public.app_settings set value = 'false'
--       where key = 'require_verified_email';
--
--  That line is the way back in. Worth knowing it exists before you
--  need it.
-- ====================================================================

-- ---------- 0. this needs the two sided model first ------------------
do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'profiles'
       and column_name = 'dealer_role')
  then
    raise exception
      'Run two-sided-access.sql first. This file rebuilds is_team() and '
      'has_dealer_access(), and without the dealer_role column it would '
      'rebuild them wrongly and change who can get in. Nothing has been '
      'changed.';
  end if;
end $$;

-- ---------- 1. the record --------------------------------------------
alter table public.profiles
  add column if not exists email_verified_at timestamptz;

comment on column public.profiles.email_verified_at is
  'When this person followed a link sent to their address and arrived. '
  'Null means never proven. Set only by accepting an invitation or a '
  'verification email, never by an administrator: an administrator '
  'vouching for an address is the claim this column exists to replace.';

-- ---------- 2. the switch, off ---------------------------------------
-- A table rather than a constant, so turning it on is a thing you do
-- rather than a thing I have to deploy for you.
create table if not exists public.app_settings (
  key         text primary key,
  value       text not null,
  changed_at  timestamptz not null default now(),
  changed_by  uuid
);

insert into public.app_settings (key, value)
values ('require_verified_email', 'false')
on conflict (key) do nothing;        -- never resets a switch you turned on

-- A policy says who may, a grant says whether the role can reach the
-- table at all, and both are needed. Without this the screen cannot
-- even read the switch, let alone turn it on, and the error it gets
-- back says permission denied rather than anything useful. No delete:
-- there is no reason to remove a setting, only to change it.
grant select, insert, update on public.app_settings to authenticated;

alter table public.app_settings enable row level security;

drop policy if exists app_settings_read on public.app_settings;
create policy app_settings_read on public.app_settings for select to authenticated
  using (true);                      -- the pages need to know, it is not a secret

-- Writing it is administrators only, and only after they have proved
-- their own address. This is the half of the lockout protection that
-- lives in the database rather than in a screen, because a screen can
-- be edited by whoever has it open.
drop policy if exists app_settings_write on public.app_settings;
create policy app_settings_write on public.app_settings for all to authenticated
  using (public.is_admin())
  with check (
    public.is_admin()
    and (
      key <> 'require_verified_email'
      or value <> 'true'
      or exists (select 1 from public.profiles p
                  where p.id = auth.uid() and p.email_verified_at is not null)
    )
  );

-- ---------- 3. the question itself -----------------------------------
create or replace function public.verification_required()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select value = 'true' from public.app_settings
                    where key = 'require_verified_email'), false);
$$;

-- True when this login has either proved its address or does not need
-- to yet. Written this way round on purpose: while the switch is off
-- this is true for everybody, so the clause can be added to the access
-- checks today and sit there doing nothing until you are ready.
create or replace function public.email_ok()
returns boolean language sql stable security definer set search_path = public as $$
  select not public.verification_required()
      or exists (select 1 from public.profiles p
                  where p.id = auth.uid() and p.email_verified_at is not null);
$$;

comment on function public.email_ok is
  'Whether this login satisfies the email rule. Always true while the '
  'switch is off, so it can be wired into every access check now and '
  'start mattering later, with no second deployment.';

-- ---------- 4. wired into access, doing nothing yet ------------------
-- Rebuilt from two-sided-access.sql with one clause added. The active
-- column is named conditionally for the same reason as there: naming a
-- column that is not present is an error rather than a null, and an
-- error inside a policy fails the whole query, which would shut
-- everybody out rather than let anybody in.
do $$
declare act text;
begin
  select case when exists (
           select 1 from information_schema.columns
            where table_schema = 'public' and table_name = 'profiles'
              and column_name = 'active')
         then 'and coalesce(p.active, true)' else '' end
    into act;

  execute format($f$
    create or replace function public.is_team()
    returns boolean language sql stable security definer set search_path = public as $b$
      select public.email_ok() and exists (
        select 1 from public.profiles p
         where p.id = auth.uid() %s
           and p.role in ('admin','user','sales','manufacturing','installer'));
    $b$ $f$, act);

  execute format($f$
    create or replace function public.has_dealer_access()
    returns boolean language sql stable security definer set search_path = public as $b$
      select public.email_ok() and exists (
        select 1 from public.profiles p
         where p.id = auth.uid() %s
           and p.dealer_role is not null and p.dealer_id is not null);
    $b$ $f$, act);

  -- An administrator is NOT exempt. They are the most valuable login on
  -- the system and exempting them would put the hole exactly where it
  -- hurts most. The protection against locking yourself out is the
  -- write rule above plus the SQL editor, not an exemption.
  execute format($f$
    create or replace function public.is_admin()
    returns boolean language sql stable security definer set search_path = public as $b$
      select public.email_ok() and exists (
        select 1 from public.profiles p
         where p.id = auth.uid() %s and p.role = 'admin');
    $b$ $f$, act);

  execute format($f$
    create or replace function public.is_staff()
    returns boolean language sql stable security definer set search_path = public as $b$
      select public.email_ok() and exists (
        select 1 from public.profiles p
         where p.id = auth.uid() %s
           and p.role in ('admin','user','sales','manufacturing'));
    $b$ $f$, act);

  execute format($f$
    create or replace function public.is_installer()
    returns boolean language sql stable security definer set search_path = public as $b$
      select public.email_ok() and exists (
        select 1 from public.profiles p
         where p.id = auth.uid() %s and p.role = 'installer');
    $b$ $f$, act);

  execute format($f$
    create or replace function public.is_production()
    returns boolean language sql stable security definer set search_path = public as $b$
      select public.email_ok() and exists (
        select 1 from public.profiles p
         where p.id = auth.uid() %s
           and p.role in ('admin','manufacturing'));
    $b$ $f$, act);

  execute format($f$
    create or replace function public.can_order()
    returns boolean language sql stable security definer set search_path = public as $b$
      select public.email_ok() and exists (
        select 1 from public.profiles p
         where p.id = auth.uid() %s
           and (p.role in ('admin','user') or p.dealer_role = 'dealer'));
    $b$ $f$, act);

  execute format($f$
    create or replace function public.can_see_prices()
    returns boolean language sql stable security definer set search_path = public as $b$
      select public.email_ok() and exists (
        select 1 from public.profiles p
         where p.id = auth.uid() %s
           and (p.role in ('admin','user','sales','manufacturing')
                or p.dealer_role = 'dealer'));
    $b$ $f$, act);
end $$;

do $$
declare f text;
begin
  foreach f in array array['verification_required()','email_ok()','is_team()','is_admin()',
                           'is_staff()','is_installer()','is_production()',
                           'has_dealer_access()','can_order()','can_see_prices()']
  loop
    begin
      execute 'grant execute on function public.' || f || ' to authenticated';
    exception when undefined_object then null;
    end;
  end loop;
end $$;

-- ---------- 5. what the screen reads ---------------------------------
-- Dropped and remade rather than replaced. "create or replace view"
-- refuses to add a column in the middle, and complains that you are
-- renaming the one that used to sit there, which reads as nonsense. It
-- would have installed on a fresh database and failed on yours.
drop view if exists public.portal_users;
create view public.portal_users as
  select p.id, p.name, p.email,
         p.role,
         p.dealer_role,
         p.dealer_id, p.created_at,
         coalesce(p.active, true) as active,
         p.email_verified_at,
         (p.email_verified_at is not null) as email_verified,
         d.name as dealer_name
    from public.profiles p
    left join public.dealers d on d.id = p.dealer_id;

grant select on public.portal_users to authenticated;

notify pgrst, 'reload schema';

-- ====================================================================
--  WHERE YOU STAND
-- ====================================================================
select count(*)                                             as logins,
       count(email_verified_at)                             as verified,
       count(*) - count(email_verified_at)                   as not_yet,
       case when public.verification_required() then 'ON: unverified logins are refused'
            else 'off: nothing is blocked yet' end           as the_switch
  from public.profiles
 where role is not null or dealer_role is not null;

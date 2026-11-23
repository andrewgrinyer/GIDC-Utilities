-- ====================================================================
--  CUSTOMER PROFILE UPDATE EMAILS (measurement app 2.67)
--  Run this in the Supabase SQL editor. SAFE TO RUN TWICE. Run it after
--  measurement-access-link.sql, because it watches the Access link on
--  each job. It only adds: no job is changed and nothing is dropped.
-- ====================================================================
--
--  Andrew, 23 November 2026: "we need an automated email to be sent to
--  the office if the sales person updates the customer name or address.
--  Please send the email to info@grinyer.ca subject is Customer Profile
--  Update Required. Place the update information in the body."
--
--  Access is where the customer record lives, so a change made in the
--  app has to be made again in Access by the office. This file records
--  every such change; the customer-update-email edge function sends it.
--
--  WHAT COUNTS
--    * a person (not the hourly sync) saves a job that is linked to an
--      Access estimate, and its customer name, address, city, phone or
--      email is different from what was saved before (phone and email
--      added the same day: Andrew, "email and phone number changes need
--      to trigger 100%")
--    * a job not linked to Access sends one too, with a big note at the
--      top that it is not linked, as a reminder to link it (Andrew, same
--      day). Only a job marked "Not in Access" (a test or a duplicate)
--      is left out.
--
--  ONE EMAIL PER BURST OF TYPING
--    The app saves after every field. Changes to the same job that have
--    not gone out yet are folded into one row, keeping the first "was"
--    and the latest "now". If the person puts it back the way it was,
--    the row is dropped and nothing is sent.
--
--  WHEN IT GOES
--    The app asks for the send about a minute after the last change,
--    or straight away when the person leaves the job. The hourly
--    measurement sync also sends anything left over, so a phone that
--    loses signal or is closed does not lose the email.
-- ====================================================================

create table if not exists public.customer_profile_updates (
  id            bigint generated always as identity primary key,
  job_id        text not null,
  estimate_id   integer,
  old_customer  text, old_address text, old_city text,
  new_customer  text, new_address text, new_city text,
  changed_by    text,
  changed_by_id uuid,
  first_at      timestamptz not null default now(),
  changed_at    timestamptz not null default now(),
  claimed_at    timestamptz,
  sent_at       timestamptz,
  tries         integer not null default 0,
  last_error    text
);
alter table public.customer_profile_updates add column if not exists old_phone text;
alter table public.customer_profile_updates add column if not exists old_email text;
alter table public.customer_profile_updates add column if not exists new_phone text;
alter table public.customer_profile_updates add column if not exists new_email text;
create index if not exists customer_profile_updates_pending
  on public.customer_profile_updates (job_id) where sent_at is null;
-- only the edge function (service role) reads or writes it
alter table public.customer_profile_updates enable row level security;
revoke all on public.customer_profile_updates from anon, authenticated;

create or replace function public.gidc_profile_txt(v text)
returns text language sql immutable as $$
  select coalesce(nullif(regexp_replace(btrim(coalesce(v, '')), '\s+', ' ', 'g'), ''), '')
$$;

create or replace function public.jobs_profile_watch()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  oc text := gidc_profile_txt(old.data->>'customer');
  oa text := gidc_profile_txt(old.data->>'address');
  oy text := gidc_profile_txt(old.data->>'city');
  nc text := gidc_profile_txt(new.data->>'customer');
  na text := gidc_profile_txt(new.data->>'address');
  ny text := gidc_profile_txt(new.data->>'city');
  op text := gidc_profile_txt(old.data->>'phone');
  oe text := gidc_profile_txt(old.data->>'email');
  np text := gidc_profile_txt(new.data->>'phone');
  ne text := gidc_profile_txt(new.data->>'email');
  who text;
  p public.customer_profile_updates%rowtype;
begin
  -- the hourly sync and the link screens write as no one; only people count
  if auth.uid() is null then return new; end if;
  if new.access_link = 'none' then return new; end if;     -- marked Not in Access
  if oc = nc and oa = na and oy = ny and op = np and oe = ne then return new; end if;
  who := coalesce((select nullif(name, '') from public.profiles where id = auth.uid()),
                  (select email from auth.users where id = auth.uid()), 'someone');

  select * into p from public.customer_profile_updates
   where job_id = new.id and sent_at is null and claimed_at is null
   order by id desc limit 1 for update;
  if found then
    if gidc_profile_txt(p.old_customer) = nc and gidc_profile_txt(p.old_address) = na
       and gidc_profile_txt(p.old_city) = ny and gidc_profile_txt(p.old_phone) = np
       and gidc_profile_txt(p.old_email) = ne then
      delete from public.customer_profile_updates where id = p.id;   -- put back as it was
    else
      update public.customer_profile_updates
         set new_customer = nc, new_address = na, new_city = ny, new_phone = np, new_email = ne,
             changed_at = now(),
             changed_by = who, changed_by_id = auth.uid(), estimate_id = new.access_estimate_id
       where id = p.id;
    end if;
  else
    insert into public.customer_profile_updates
      (job_id, estimate_id, old_customer, old_address, old_city, old_phone, old_email,
       new_customer, new_address, new_city, new_phone, new_email, changed_by, changed_by_id)
    values (new.id, new.access_estimate_id, oc, oa, oy, op, oe, nc, na, ny, np, ne, who, auth.uid());
  end if;
  return new;
end $$;

drop trigger if exists jobs_profile_watch on public.jobs;
create trigger jobs_profile_watch after update of data on public.jobs
  for each row execute function public.jobs_profile_watch();

-- rows recorded before phone and email were watched: their phone and
-- email count as unchanged
update public.customer_profile_updates
   set old_phone = '', new_phone = '', old_email = '', new_email = ''
 where old_phone is null and new_phone is null;

-- the edge function takes what is waiting. A claim older than ten
-- minutes is taken as a send that died, and is tried again.
create or replace function public.gidc_claim_profile_updates()
returns jsonb language plpgsql security definer set search_path = public as $$
declare out jsonb;
begin
  with c as (
    update public.customer_profile_updates u set claimed_at = now(), tries = u.tries + 1
     where u.sent_at is null and u.tries < 20
       and (u.claimed_at is null or u.claimed_at < now() - interval '10 minutes')
    returning u.*)
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', c.id, 'job_id', c.job_id, 'estimate_id', j.access_estimate_id,
           'order_no', j.access_order_no, 'status', j.access_status,
           'old_customer', c.old_customer, 'old_address', c.old_address, 'old_city', c.old_city,
           'new_customer', c.new_customer, 'new_address', c.new_address, 'new_city', c.new_city,
           'old_phone', c.old_phone, 'old_email', c.old_email,
           'new_phone', c.new_phone, 'new_email', c.new_email,
           'phone', j.data->>'phone', 'email', j.data->>'email', 'rep', j.data->>'salesRep',
           'changed_by', c.changed_by, 'first_at', c.first_at, 'changed_at', c.changed_at)
         order by c.id), '[]'::jsonb)
    into out
    from c left join public.jobs j on j.id = c.job_id;
  return out;
end $$;

create or replace function public.gidc_profile_update_done(p_id bigint, p_ok boolean, p_error text default null)
returns void language sql security definer set search_path = public as $$
  update public.customer_profile_updates
     set sent_at = case when p_ok then now() end,
         claimed_at = case when p_ok then claimed_at end,
         last_error = case when p_ok then null else left(p_error, 500) end
   where id = p_id
$$;

revoke all on function public.gidc_claim_profile_updates() from public, anon, authenticated;
revoke all on function public.gidc_profile_update_done(bigint, boolean, text) from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.gidc_claim_profile_updates() to service_role;
    grant execute on function public.gidc_profile_update_done(bigint, boolean, text) to service_role;
    grant all on public.customer_profile_updates to service_role;
  end if;
end $$;

notify pgrst, 'reload schema';

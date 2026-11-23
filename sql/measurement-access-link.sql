-- ====================================================================
--  MEASUREMENT APP JOBS LINKED TO ACCESS
--  Run this in the Supabase SQL editor. SAFE TO RUN TWICE, and safe in
--  any order with the other files in sql/. It only adds: no job is
--  changed by running it, and nothing that exists is dropped.
-- ====================================================================
--
--  Andrew, 23 November 2026:
--    * new customers in Access come into the measurement app by
--      themselves
--    * every job carries a link to its Access job, the way a dealer
--      order does
--    * the jobs already in the app (today and earlier) are linked once
--      where they can be, and the rest are flagged for an administrator
--      to link by hand
--    * the status comes one way from Access, using the Access status
--      names, and can no longer be changed in the app
--    * new customers start coming in from tomorrow, 24 November
--
--  THE PATH
--
--  The office server (gidc-measurement-sync.ps1, hourly) reads the
--  retail customers out of Access and posts them to the
--  measurement-sync edge function. That function replaces the staging
--  table access_customers with them and calls
--  gidc_sync_measurement_jobs(), which is where every rule lives:
--
--    1. every linked job gets its Access status and job number again
--    2. every job not linked yet is matched against Access (name, street
--       number, phone, email, and the date). One clear match links it.
--       Anything else is flagged with the reason, for an administrator.
--    3. every Access customer created on or after the start date
--       (access_job_settings.new_jobs_from, 24 November) that no job is
--       linked to becomes a new job in the app, already linked
--
--  Step 2 runs before step 3 on purpose: a rep who starts a job by hand
--  before the hour comes round gets that job linked, rather than a
--  second copy of the customer appearing.
--
--  WHICH ACCESS RECORD
--
--  The estimate (EstimateID), because that is the customer record and it
--  exists from the first phone call. The job number people say out loud
--  (OrderNo) is stored beside it for the screen. Never the OrderID,
--  which sits two away from the OrderNo in this data.
--
--  WHO MAY DO WHAT
--
--  Reading the Access list, and linking or unlinking a job, go through
--  can_link_access_jobs(), a helper, which is administrators for now.
--  The status columns are written only by the sync. A trigger holds both
--  for direct writes, so nothing can go round the functions. The app's
--  normal save never sends these columns, so saving a job leaves them
--  exactly as the sync left them.
-- ====================================================================

do $$
begin
  if to_regclass('public.jobs') is null then
    raise exception 'There is no jobs table here. This is the wrong project.';
  end if;
  if to_regprocedure('public.is_admin()') is null then
    raise exception 'is_admin() is not here. This is the wrong project.';
  end if;
end $$;

-- ---------- 1. the Access customer list (staging) --------------------
-- Replaced whole by every sync. Only a copy of Access, never edited here.
create table if not exists public.access_customers (
  estimate_id          integer primary key,
  order_id             integer,
  order_no             text,
  first_name           text,
  last_name            text,
  address              text,
  city                 text,
  phone                text,
  phone2               text,
  email                text,
  rep                  text,
  created_on           date,
  measure_on           date,
  sold_on              date,
  completed_on         date,
  estimate_status_id   integer,
  estimate_status      text,
  estimate_status_sort integer,
  order_status_id      integer,
  order_status         text,
  order_status_sort    integer,
  sale_type_id         integer,
  pulled_at            timestamptz not null default now()
);
alter table public.access_customers enable row level security;
-- no policies, on purpose: only the sync (service role) and the
-- administrator functions below, which check first, read it
revoke all on public.access_customers from anon, authenticated;

comment on table public.access_customers is
  'Retail customers copied from Access by the hourly measurement sync. '
  'RLS on with no policies: read only through the gidc_access_ functions.';

-- ---------- 2. settings ----------------------------------------------
create table if not exists public.access_job_settings (
  id              integer primary key default 1 check (id = 1),
  new_jobs_from   date    not null default date '2026-11-24',
  -- how far from the job's own date an Access customer may be created
  -- and still count as the same visit
  days_before     integer not null default 180,
  days_after      integer not null default 45
);
insert into public.access_job_settings (id) values (1) on conflict (id) do nothing;
alter table public.access_job_settings enable row level security;
revoke all on public.access_job_settings from anon, authenticated;

-- every job the sync has made, so a job somebody deletes is not made again
create table if not exists public.access_jobs_made (
  estimate_id integer primary key,
  job_id      text not null,
  made_at     timestamptz not null default now()
);
alter table public.access_jobs_made enable row level security;
revoke all on public.access_jobs_made from anon, authenticated;

-- ---------- 3. the link on each job ----------------------------------
alter table public.jobs add column if not exists access_estimate_id integer;
alter table public.jobs add column if not exists access_order_no    text;
alter table public.jobs add column if not exists access_status      text;
alter table public.jobs add column if not exists access_status_sort integer;
alter table public.jobs add column if not exists access_completed   boolean;
-- auto: matched by the sync. manual: linked by an administrator.
-- new: made by the sync from Access. none: an administrator said it is
-- not in Access (a test, a duplicate), so it is never flagged again.
alter table public.jobs add column if not exists access_link        text;
-- why a job is waiting to be linked by hand; empty when it is not
alter table public.jobs add column if not exists access_flag        text;
alter table public.jobs add column if not exists access_linked_at   timestamptz;
alter table public.jobs add column if not exists access_linked_by   text;

do $$ begin
  alter table public.jobs add constraint jobs_access_link_kind
    check (access_link is null or access_link in ('auto', 'manual', 'new', 'none'));
exception when duplicate_object then null; end $$;

-- one Access customer belongs to one job
create unique index if not exists jobs_access_estimate_once
  on public.jobs (access_estimate_id) where access_estimate_id is not null;

comment on column public.jobs.access_estimate_id is
  'The Access EstimateID this job is linked to. Set by the hourly sync or by '
  'an administrator, never by the app''s normal save.';
comment on column public.jobs.access_status is
  'The status as Access names it, copied one way by the hourly sync.';

-- ---------- 4. who may link ------------------------------------------
-- An allowlist, like every other helper. Widening it is this one line.
create or replace function public.can_link_access_jobs()
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin()
$$;

-- ---------- 5. the guard on the columns ------------------------------
-- auth.uid() is null for the service role, which is how the sync writes,
-- and in the SQL editor, so those always may. A signed in person may
-- never write the status, and may write the link only if the helper says.
create or replace function public.jobs_access_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;
  if coalesce(current_setting('gidc.access_link_ok', true), '') = 'yes' then return new; end if;
  if tg_op = 'INSERT' then
    -- a job saved from a phone never brings a link with it
    new.access_estimate_id := null; new.access_order_no := null;
    new.access_status := null; new.access_status_sort := null;
    new.access_completed := null; new.access_link := null; new.access_flag := null;
    new.access_linked_at := null; new.access_linked_by := null;
    return new;
  end if;
  if (new.access_status, new.access_status_sort, new.access_completed)
       is distinct from (old.access_status, old.access_status_sort, old.access_completed)
     or (new.access_estimate_id, new.access_order_no, new.access_link, new.access_flag,
         new.access_linked_at, new.access_linked_by)
       is distinct from (old.access_estimate_id, old.access_order_no, old.access_link,
                         old.access_flag, old.access_linked_at, old.access_linked_by) then
    raise exception 'The Access link and status are set by Access, not from here.';
  end if;
  return new;
end $$;

drop trigger if exists jobs_access_guard on public.jobs;
create trigger jobs_access_guard
  before insert or update of access_estimate_id, access_order_no, access_status,
    access_status_sort, access_completed, access_link, access_flag,
    access_linked_at, access_linked_by
  on public.jobs
  for each row execute function public.jobs_access_guard();

-- ---------- 6. small pieces the matching is made of ------------------
-- letters and digits only, lower case
create or replace function public.gidc_acc_norm(t text)
returns text language sql immutable as $$
  select nullif(regexp_replace(lower(coalesce(t, '')), '[^a-z0-9]+', '', 'g'), '')
$$;

-- the last ten digits of a phone number; fewer than seven is no number
create or replace function public.gidc_acc_phone(t text)
returns text language sql immutable as $$
  select case when length(d) >= 7 then right(d, 10) end
    from (select regexp_replace(coalesce(t, ''), '\D', '', 'g') as d) x
$$;

create or replace function public.gidc_acc_email(t text)
returns text language sql immutable as $$
  select nullif(lower(btrim(coalesce(t, ''))), '')
$$;

-- THE STREET NUMBER, AND THE FIRST WORD OF THE STREET
-- "Unit 4, 123 Main St", "4-123 Main St", "#4 123 Main", "123 Main St
-- Unit 4" all give 123 and main.
create or replace function public.gidc_acc_street(t text, out num text, out street text)
language plpgsql immutable as $$
declare a text := lower(btrim(coalesce(t, '')));
        m text[];
begin
  a := regexp_replace(a, '^(unit|apt|apartment|suite|ste|#)\s*[a-z0-9]+\s*[,-]?\s*', '');
  m := regexp_match(a, '^\d+[a-z]?\s*-\s*(\d+)\s*([a-z]+)?');     -- 4-123 Main
  if m is null then m := regexp_match(a, '^(\d+)[a-z]?\y[\s,]*([a-z]+)?'); end if;
  if m is not null then num := m[1]; street := m[2]; end if;
end $$;

-- every word in a name, letters only, two letters or more
create or replace function public.gidc_acc_words(t text)
returns text[] language sql immutable as $$
  select coalesce(array_agg(w), '{}')
    from regexp_split_to_table(lower(coalesce(t, '')), '[^a-z]+') as w
   where length(w) >= 2
$$;

-- the status a job shows. Once Access has sold it, the order's status;
-- before that, the estimate's. Changing which one shows is this function.
create or replace function public.gidc_acc_status(c public.access_customers,
  out status text, out sort integer)
language sql stable as $$
  select case when c.sold_on is not null and c.order_status is not null
              then c.order_status else coalesce(c.estimate_status, c.order_status) end,
         case when c.sold_on is not null and c.order_status is not null
              then 1000 + coalesce(c.order_status_sort, c.order_status_id, 0)
              else coalesce(c.estimate_status_sort, c.estimate_status_id, 0) end
$$;

-- the day a job belongs to: the date on it, else the day it was started
create or replace function public.gidc_job_day(d jsonb, upd timestamptz)
returns date language sql immutable as $$
  select coalesce(
    case when d->>'date' ~ '^\d{4}-\d{2}-\d{2}$' then (d->>'date')::date end,
    case when d->>'created' ~ '^\d{10,14}$'
         then (to_timestamp((d->>'created')::bigint / 1000.0) at time zone 'America/Toronto')::date end,
    (upd at time zone 'America/Toronto')::date)
$$;

-- the same keys, worked out once per row of the Access list rather than
-- once per job, and indexed, so matching a few hundred jobs against a few
-- thousand customers stays quick
alter table public.access_customers add column if not exists k_email  text
  generated always as (public.gidc_acc_email(email)) stored;
alter table public.access_customers add column if not exists k_phone  text
  generated always as (public.gidc_acc_phone(phone)) stored;
alter table public.access_customers add column if not exists k_phone2 text
  generated always as (public.gidc_acc_phone(phone2)) stored;
alter table public.access_customers add column if not exists k_num    text
  generated always as ((public.gidc_acc_street(address)).num) stored;
alter table public.access_customers add column if not exists k_street text
  generated always as ((public.gidc_acc_street(address)).street) stored;
alter table public.access_customers add column if not exists k_last   text[]
  generated always as (public.gidc_acc_words(last_name)) stored;
alter table public.access_customers add column if not exists k_city   text
  generated always as (public.gidc_acc_norm(city)) stored;
create index if not exists access_customers_k_email  on public.access_customers (k_email);
create index if not exists access_customers_k_phone  on public.access_customers (k_phone);
create index if not exists access_customers_k_phone2 on public.access_customers (k_phone2);
create index if not exists access_customers_k_num    on public.access_customers (k_num);
create index if not exists access_customers_k_last   on public.access_customers using gin (k_last);

-- ---------- 7. the candidates for one job ----------------------------
-- Every Access customer that shares anything with the job, scored. Used
-- by the sync to decide, and by the link screen to suggest.
--   email the same                      50
--   phone the same (either Access one)  50
--   surname is a word of the job name   30
--   street number and street the same   40   (number alone 15)
--   city the same                        5
-- 70 or more is a match: a name with an address, a phone or an email,
-- or a phone with an email. A phone or an email on its own is not, since
-- a family shares them.
create or replace function public.gidc_access_candidates_for(p_job text)
returns table (estimate_id integer, score integer, why text, day_gap integer,
               in_window boolean, taken_by text)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare
  j      public.jobs%rowtype;
  s      public.access_job_settings%rowtype;
  jday   date;
  jwords text[];
  jph    text;
  jem    text;
  jnum   text;
  jst    text;
  jcity  text;
begin
  select * into j from public.jobs where id = p_job;
  if not found then return; end if;
  select * into s from public.access_job_settings where id = 1;
  jday   := public.gidc_job_day(j.data::jsonb, j.updated::timestamptz);
  jwords := public.gidc_acc_words(coalesce(j.data->>'customer', j.customer));
  jph    := public.gidc_acc_phone(j.data->>'phone');
  jem    := public.gidc_acc_email(j.data->>'email');
  select x.num, x.street into jnum, jst from public.gidc_acc_street(j.data->>'address') x;
  jcity  := public.gidc_acc_norm(j.data->>'city');

  return query
  with c as (
    select a.* from public.access_customers a where jem is not null and a.k_email = jem
    union
    select a.* from public.access_customers a where jph is not null and (a.k_phone = jph or a.k_phone2 = jph)
    union
    select a.* from public.access_customers a where jnum is not null and a.k_num = jnum
    union
    select a.* from public.access_customers a where cardinality(jwords) > 0 and a.k_last && jwords
  ), scored as (
    select c.estimate_id,
           (case when jem is not null and c.k_email = jem then 50 else 0 end) +
           (case when jph is not null and jph in (c.k_phone, c.k_phone2) then 50 else 0 end) +
           (case when c.k_last && jwords then 30 else 0 end) +
           (case when jnum is not null and c.k_num = jnum and jst is not null and c.k_street = jst then 40
                 when jnum is not null and c.k_num = jnum then 15 else 0 end) +
           (case when jcity is not null and c.k_city = jcity then 5 else 0 end) as score,
           concat_ws(', ',
             case when jem is not null and c.k_email = jem then 'email' end,
             case when jph is not null and jph in (c.k_phone, c.k_phone2) then 'phone' end,
             case when c.k_last && jwords then 'name' end,
             case when jnum is not null and c.k_num = jnum and jst is not null and c.k_street = jst then 'address'
                  when jnum is not null and c.k_num = jnum then 'street number' end,
             case when jcity is not null and c.k_city = jcity then 'city' end) as why,
           case when c.created_on is null or jday is null then null else (c.created_on - jday) end as gap
      from c
  )
  select sc.estimate_id, sc.score, sc.why, sc.gap,
         sc.gap is not null and sc.gap between -s.days_before and s.days_after,
         (select coalesce(nullif(o.customer, ''), o.data->>'customer', 'another job')
            from public.jobs o
           where o.access_estimate_id = sc.estimate_id and o.id <> p_job)
    from scored sc
   where sc.score > 0
   order by sc.score desc, abs(coalesce(sc.gap, 99999)), sc.estimate_id desc;
end $$;

-- ---------- 8. the sync ----------------------------------------------
-- p_apply false is the preview: everything is worked out exactly as it
-- would be, then undone, and the answer says what would have happened.
create or replace function public.gidc_measurement_sync_run()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  s         public.access_job_settings%rowtype;
  j         record;
  c         record;
  ac        public.access_customers%rowtype;
  best      record;
  nxt       record;
  st        record;
  reason    text;
  nfound    integer;
  n_status  integer := 0;
  linked    jsonb := '[]';
  flagged   jsonb := '[]';
  made      jsonb := '[]';
  ms        bigint := (extract(epoch from now()) * 1000)::bigint;
  newid     text;
  repname   text;
  jdata     jsonb;
begin
  select * into s from public.access_job_settings where id = 1;
  perform set_config('gidc.access_link_ok', 'yes', true);

  -- 1. the status, the number and whether it is complete, on every
  --    linked job, from Access, one way
  with u as (
    update public.jobs jb
       set access_status      = x.status,
           access_status_sort = x.sort,
           access_order_no    = a.order_no,
           access_completed   = a.completed_on is not null
      from public.access_customers a
      cross join lateral public.gidc_acc_status(a) x
     where jb.access_estimate_id = a.estimate_id
       and (jb.access_status, jb.access_status_sort, jb.access_order_no, jb.access_completed)
           is distinct from (x.status, x.sort, a.order_no, a.completed_on is not null)
    returning 1)
  select count(*) into n_status from u;

  -- 2. every job not linked yet, oldest first, so if two jobs are the
  --    same customer the one that came first gets the link
  for j in
    select jb.id, coalesce(nullif(jb.customer, ''), jb.data->>'customer') as customer,
           public.gidc_job_day(jb.data::jsonb, jb.updated::timestamptz) as day
      from public.jobs jb
     where jb.access_estimate_id is null
       and coalesce(jb.access_link, '') <> 'none'
     order by public.gidc_job_day(jb.data::jsonb, jb.updated::timestamptz), jb.id
  loop
    nfound := 0; reason := null;
    -- the matches nobody else has, nearest the job's date first
    for c in
      select * from public.gidc_access_candidates_for(j.id) x
       where x.score >= 70
       order by x.taken_by is not null, x.in_window desc, abs(coalesce(x.day_gap, 99999)), x.score desc
       limit 2
    loop
      nfound := nfound + 1;
      if nfound = 1 then best := c; else nxt := c; end if;
    end loop;

    if coalesce(btrim(j.customer), '') = '' then
      reason := 'No customer name on the job';
    elsif nfound = 0 then
      reason := 'No customer in Access matches';
    elsif best.taken_by is not null then
      reason := 'Its match is already linked to ' || best.taken_by;
    elsif not best.in_window then
      reason := 'The only match in Access is from ' ||
                coalesce(to_char((select created_on from public.access_customers where estimate_id = best.estimate_id), 'FMMonth YYYY'), 'another time');
    elsif nfound = 2 then
      -- a second match nobody has, near the same date: a person decides
      if nxt.taken_by is null and nxt.in_window
         and abs(coalesce(nxt.day_gap, 99999)) - abs(coalesce(best.day_gap, 99999)) < 14 then
        reason := 'More than one customer in Access matches';
      end if;
    end if;

    if reason is null then
      update public.jobs set access_estimate_id = best.estimate_id, access_link = 'auto',
             access_flag = null, access_linked_at = now(), access_linked_by = 'the hourly sync'
       where id = j.id;
      select * into ac from public.access_customers a where a.estimate_id = best.estimate_id;
      select * into st from public.gidc_acc_status(ac);
      update public.jobs set access_order_no = ac.order_no, access_status = st.status,
             access_status_sort = st.sort, access_completed = ac.completed_on is not null
       where id = j.id;
      linked := linked || jsonb_build_object('job', j.customer, 'day', j.day,
                 'access_no', ac.order_no, 'access_name', concat_ws(' ', ac.first_name, ac.last_name),
                 'access_address', ac.address, 'on', best.why);
    else
      update public.jobs set access_flag = reason
       where id = j.id and access_flag is distinct from reason;
      flagged := flagged || jsonb_build_object('job', j.customer, 'day', j.day, 'why', reason);
    end if;
  end loop;

  -- 3. new customers in Access become jobs, from the start date on
  for ac in
    select a.* from public.access_customers a
     where a.created_on >= s.new_jobs_from
       and coalesce(a.sale_type_id, 0) <> 4
       and not exists (select 1 from public.jobs jb where jb.access_estimate_id = a.estimate_id)
       and not exists (select 1 from public.access_jobs_made m where m.estimate_id = a.estimate_id)
     order by a.created_on, a.estimate_id
  loop
    newid := 'ax' || substr(md5('gidc access ' || ac.estimate_id), 1, 10);
    -- the rep as the app knows them: the one team login whose first name
    -- is the first word of the Access calendar name, else Access's words
    select min(p.name) into repname from public.profiles p
     where ac.rep is not null
       and lower(split_part(btrim(p.name), ' ', 1)) = lower(split_part(btrim(ac.rep), ' ', 1))
       and p.role in ('admin', 'user', 'sales')
     having count(*) = 1;
    repname := coalesce(repname, nullif(btrim(ac.rep), ''), '');
    select * into st from public.gidc_acc_status(ac);
    jdata := jsonb_build_object(
      'id', newid, 'owner', repname, 'created', ms, 'updated', ms,
      'defaults', '{}'::jsonb, 'sizing', 2, 'openings', '[]'::jsonb, 'closets', '[]'::jsonb,
      'materials', '[{"desc":"","price":"","qty":""},{"desc":"","price":"","qty":""},{"desc":"","price":"","qty":""}]'::jsonb,
      'customer', btrim(concat_ws(' ', nullif(btrim(ac.first_name), ''), nullif(btrim(ac.last_name), ''))),
      'address', coalesce(ac.address, ''), 'city', coalesce(ac.city, ''),
      'phone', coalesce(nullif(ac.phone, ''), ac.phone2, ''), 'email', coalesce(ac.email, ''),
      'date', to_char(coalesce(ac.measure_on, ac.created_on), 'YYYY-MM-DD'),
      'salesRep', repname, 'leadTime', '', 'docType', 'Estimate - Financing',
      'status', 'active', 'inHome', false, 'fromAccess', ac.estimate_id);
    insert into public.jobs (id, owner_name, customer, openings, data, updated,
                             access_estimate_id, access_order_no, access_status, access_status_sort,
                             access_completed, access_link, access_linked_at, access_linked_by)
    values (newid, repname, jdata->>'customer', 0, jdata, now(),
            ac.estimate_id, ac.order_no, st.status, st.sort,
            ac.completed_on is not null, 'new', now(), 'the hourly sync')
    on conflict (id) do nothing;
    insert into public.access_jobs_made (estimate_id, job_id) values (ac.estimate_id, newid)
    on conflict (estimate_id) do nothing;
    made := made || jsonb_build_object('job', jdata->>'customer', 'access_no', ac.order_no,
              'rep', repname, 'created', ac.created_on);
  end loop;

  return jsonb_build_object(
    'statuses_changed', n_status,
    'linked', linked, 'linked_count', jsonb_array_length(linked),
    'flagged', flagged, 'flagged_count', jsonb_array_length(flagged),
    'made', made, 'made_count', jsonb_array_length(made),
    'access_customers', (select count(*) from public.access_customers),
    'jobs_linked', (select count(*) from public.jobs where access_estimate_id is not null),
    'jobs_total', (select count(*) from public.jobs),
    'new_jobs_from', s.new_jobs_from);
end $$;

create or replace function public.gidc_sync_measurement_jobs(p_apply boolean default true)
returns jsonb language plpgsql security definer set search_path = public as $$
declare res jsonb;
begin
  if p_apply then return public.gidc_measurement_sync_run(); end if;
  begin
    res := public.gidc_measurement_sync_run();
    raise exception 'gidc preview, undo' using errcode = 'P0099';
  exception when sqlstate 'P0099' then
    null;   -- everything inside the block is undone; res is kept
  end;
  return res || jsonb_build_object('preview', true);
end $$;

-- ---------- 9. what an administrator uses to link by hand ------------
-- the suggestions for one job, best first
create or replace function public.gidc_access_suggest(p_job text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.can_link_access_jobs() then
    raise exception 'Only an administrator can link jobs to Access.';
  end if;
  return coalesce((
    select jsonb_agg(to_jsonb(r) order by r.score desc, abs(coalesce(r.day_gap, 99999)))
      from (select x.estimate_id, x.score, x.why, x.day_gap, x.in_window, x.taken_by,
                   a.order_no, concat_ws(' ', a.first_name, a.last_name) as name,
                   a.address, a.city, a.phone, a.email, a.created_on, st.status, a.rep
              from public.gidc_access_candidates_for(p_job) x
              join public.access_customers a on a.estimate_id = x.estimate_id
              cross join lateral public.gidc_acc_status(a) st
             order by x.score desc, abs(coalesce(x.day_gap, 99999))
             limit 8) r), '[]'::jsonb);
end $$;

-- search the Access list: every word has to be in the name, address,
-- city, email, job number or phone
create or replace function public.gidc_access_search(p_q text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare w text[];
begin
  if not public.can_link_access_jobs() then
    raise exception 'Only an administrator can link jobs to Access.';
  end if;
  w := array(select x from regexp_split_to_table(lower(btrim(coalesce(p_q, ''))), '\s+') x where x <> '');
  if cardinality(w) = 0 then return '[]'::jsonb; end if;
  return coalesce((
    select jsonb_agg(to_jsonb(r) order by r.created_on desc nulls last, r.estimate_id desc)
      from (select a.estimate_id, a.order_no, concat_ws(' ', a.first_name, a.last_name) as name,
                   a.address, a.city, a.phone, a.email, a.created_on, st.status, a.rep,
                   (select coalesce(nullif(o.customer, ''), 'another job') from public.jobs o
                     where o.access_estimate_id = a.estimate_id) as taken_by
              from public.access_customers a
              cross join lateral public.gidc_acc_status(a) st
             where not exists (
                     select 1 from unnest(w) q
                      where position(q in lower(concat_ws(' ', a.first_name, a.last_name, a.address,
                                     a.city, a.email, a.order_no))) = 0
                        and not (length(regexp_replace(q, '\D', '', 'g')) >= 3 and q ~ '^[\d()+. -]+$'
                                 and position(regexp_replace(q, '\D', '', 'g') in
                                     regexp_replace(coalesce(a.phone, '') || ' ' || coalesce(a.phone2, ''), '\D', '', 'g')) > 0))
             order by a.created_on desc nulls last, a.estimate_id desc
             limit 40) r), '[]'::jsonb);
end $$;

-- link a job to an Access customer, or say it is not in Access.
-- p_move takes the customer off another job that has it.
create or replace function public.gidc_link_job_access(p_job text, p_estimate integer,
  p_none boolean default false, p_move boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  j     public.jobs%rowtype;
  a     public.access_customers%rowtype;
  st    record;
  other text;
  who   text := coalesce((select name from public.profiles where id = auth.uid()), 'an administrator');
begin
  if not public.can_link_access_jobs() then
    raise exception 'Only an administrator can link jobs to Access.';
  end if;
  select * into j from public.jobs where id = p_job;
  if not found then raise exception 'That job is not there any more.'; end if;
  perform set_config('gidc.access_link_ok', 'yes', true);

  if p_none then
    update public.jobs set access_estimate_id = null, access_order_no = null, access_status = null,
           access_status_sort = null, access_completed = null, access_link = 'none', access_flag = null,
           access_linked_at = now(), access_linked_by = who
     where id = p_job;
    return jsonb_build_object('linked', false, 'none', true);
  end if;

  if p_estimate is null then
    -- unlinked: the next sync tries to match it again
    update public.jobs set access_estimate_id = null, access_order_no = null, access_status = null,
           access_status_sort = null, access_completed = null, access_link = null,
           access_flag = 'Unlinked by ' || who, access_linked_at = now(), access_linked_by = who
     where id = p_job;
    return jsonb_build_object('linked', false);
  end if;

  select * into a from public.access_customers where estimate_id = p_estimate;
  if not found then raise exception 'That customer is not in the Access list any more.'; end if;
  select coalesce(nullif(customer, ''), 'another job') into other from public.jobs
   where access_estimate_id = p_estimate and id <> p_job;
  if other is not null and not p_move then
    raise exception 'Access job % is already linked to %.', coalesce(a.order_no, p_estimate::text), other;
  end if;
  if other is not null then
    update public.jobs set access_estimate_id = null, access_order_no = null, access_status = null,
           access_status_sort = null, access_completed = null, access_link = null,
           access_flag = 'Its Access customer was moved to another job by ' || who
     where access_estimate_id = p_estimate and id <> p_job;
  end if;
  select * into st from public.gidc_acc_status(a);
  update public.jobs set access_estimate_id = p_estimate, access_order_no = a.order_no,
         access_status = st.status, access_status_sort = st.sort,
         access_completed = a.completed_on is not null, access_link = 'manual',
         access_flag = null, access_linked_at = now(), access_linked_by = who
   where id = p_job;
  return jsonb_build_object('linked', true, 'order_no', a.order_no, 'status', st.status,
                            'name', concat_ws(' ', a.first_name, a.last_name));
end $$;

-- ---------- 10. who may call what ------------------------------------
revoke all on function public.gidc_measurement_sync_run() from public, anon, authenticated;
revoke all on function public.gidc_sync_measurement_jobs(boolean) from public, anon, authenticated;
revoke all on function public.gidc_access_candidates_for(text) from public, anon, authenticated;
revoke all on function public.gidc_access_suggest(text) from public, anon;
revoke all on function public.gidc_access_search(text) from public, anon;
revoke all on function public.gidc_link_job_access(text, integer, boolean, boolean) from public, anon;
grant execute on function public.gidc_access_suggest(text) to authenticated;
grant execute on function public.gidc_access_search(text) to authenticated;
grant execute on function public.gidc_link_job_access(text, integer, boolean, boolean) to authenticated;
grant execute on function public.can_link_access_jobs() to authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.gidc_sync_measurement_jobs(boolean) to service_role;
    grant execute on function public.gidc_measurement_sync_run() to service_role;
    grant execute on function public.gidc_access_candidates_for(text) to service_role;
    grant all on public.access_customers to service_role;
  end if;
end $$;

notify pgrst, 'reload schema';

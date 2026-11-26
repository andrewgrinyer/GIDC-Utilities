-- ====================================================================
--  WEB LEADS TRACKER
--  Run this in the Supabase SQL editor. Safe to run twice, and safe in
--  any order with the other files in sql/. It only adds: nothing that
--  exists is changed or dropped, and a lead already in the tracker keeps
--  its status, notes and Access link when this runs again.
-- ====================================================================
--
--  Andrew, 26 November 2026: a tool on the tools site where the
--  receptionist follows up every web lead. New leads load by themselves
--  from the Google Sheet the website form writes to, show as NEW LEAD,
--  and the receptionist sets the status and writes notes. Once a lead
--  is booked it can be linked to its estimate in Access (a web lead is
--  not in Access until an appointment is made).
--
--  THE STATUSES, in Andrew's order (26 November)
--    NEW LEAD                      what a lead shows when it comes in
--    Initial Measure booked
--    In home estimate booked
--    Bringing Measurements booked
--    First Call No Answer
--    Second Call No Answer         (Andrew typed "Anser")
--    Contact Email Sent
--    Contact Text Message Sent
--    Lead No Response - Dead
--  They live in web_lead_statuses, so one can be added or renamed with
--  an edit there rather than a change of code. "done" marks the ones the
--  page can hide: the three booked ones and Dead.
--
--  THE PATH
--    The script in the Google Sheet (apps-script/gidc-web-leads.gs,
--    sendLeadsToTracker, every five minutes) sends every lead from the
--    last 30 days to the web-leads edge function (action track), which
--    calls web_lead_tracker_load(). A lead it has not seen is added as
--    NEW LEAD. A lead it has seen gets its sheet details refreshed and
--    nothing else: the status, notes and link are the receptionist's.
--    Nothing is ever deleted by a load, so a row taken out of the sheet
--    stays in the tracker.
--
--    A lead is known by its key, made by the sheet script from the time
--    it came in and its email (or phone), so sorting the sheet or
--    fixing a name does not make it a new lead.
--
--  THE ACCESS LINK
--    web_lead_link() stores the estimate number (Estimates.EstimateID,
--    the number the measurement app calls the estimate number). The
--    page suggests one from web_lead_sales (sql/web-leads-sold.sql, the
--    hourly copy of every retail estimate): the same email, else the
--    same phone, else the same whole name, made from two weeks before
--    the lead onward. A suggestion is only shown, never linked, until
--    somebody presses Link. A number that is not in the hourly copy yet
--    can still be linked; the page says it is not in the copy yet.
--    If web-leads-sold.sql has not been run, the tracker works without
--    suggestions.
--
--  WHO MAY
--    can_use_web_leads()  administrators and office staff (role user,
--                         "Staff" on the People screen), where the
--                         receptionist sits. A list of who may, so
--                         sales, the shop, installers, dealers and any
--                         role invented later get nothing.
--    The page reads through web_leads_board() and writes through
--    web_lead_set_status(), web_lead_add_note() and web_lead_link().
--    Nobody signed in can write the tables directly. Only the edge
--    function (service role) may load.
--
--    If email-verification.sql runs after this file, run this file once
--    more so the helper picks up its email rule as well.
-- ====================================================================

do $$
begin
  if to_regclass('public.profiles') is null then
    raise exception 'profiles is not here. This is the wrong project.';
  end if;
end $$;

-- ---------- 1. who may ------------------------------------------------
do $$
declare act text := '';
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'profiles'
                and column_name = 'active')
  then act := 'and coalesce(p.active, true)';
  end if;
  if exists (select 1 from pg_proc f join pg_namespace n on n.oid = f.pronamespace
              where n.nspname = 'public' and f.proname = 'email_ok')
  then act := act || ' and public.email_ok()';
  end if;

  execute format($f$
    create or replace function public.can_use_web_leads()
    returns boolean language sql stable security definer set search_path = public as $b$
      select exists (select 1 from public.profiles p
                      where p.id = auth.uid() %s
                        and p.role in ('admin', 'user'));
    $b$ $f$, act);
end $$;
comment on function public.can_use_web_leads is
  'Who may use the Web Leads tracker: administrators and office staff (role user), '
  'Andrew, 26 November. A list of who may, so every other role is shut out.';
revoke all on function public.can_use_web_leads() from public, anon;
grant execute on function public.can_use_web_leads() to authenticated;

-- ---------- 2. the statuses -------------------------------------------
create table if not exists public.web_lead_statuses (
  name  text primary key,
  sort  integer not null,
  done  boolean not null default false
);
-- Andrew's list. Safe to run twice: a status already here keeps its
-- name and gets the order and done flag below.
insert into public.web_lead_statuses (name, sort, done) values
  ('NEW LEAD',                     10, false),
  ('Initial Measure booked',       20, true),
  ('In home estimate booked',      30, true),
  ('Bringing Measurements booked', 40, true),
  ('First Call No Answer',         50, false),
  ('Second Call No Answer',        60, false),
  ('Contact Email Sent',           70, false),
  ('Contact Text Message Sent',    80, false),
  ('Lead No Response - Dead',      90, true)
on conflict (name) do update set sort = excluded.sort, done = excluded.done;
alter table public.web_lead_statuses enable row level security;
revoke all on public.web_lead_statuses from anon, authenticated;

-- ---------- 3. the leads ----------------------------------------------
create table if not exists public.web_lead_tracker (
  lead_key     text primary key,
  received_at  timestamptz,
  lead_day     date,
  first_name   text,
  last_name    text,
  name         text,
  email        text,
  phone        text,
  details      jsonb not null default '[]',     -- every other column of the sheet row, [header, value] pairs
  sheet_row    integer,                         -- where it was last seen, for finding it
  status       text not null default 'NEW LEAD'
               references public.web_lead_statuses (name) on update cascade,
  status_by    text,
  status_at    timestamptz,
  estimate_id  integer,                         -- Access Estimates.EstimateID once linked
  linked_by    text,
  linked_at    timestamptz,
  first_seen   timestamptz not null default now(),
  last_seen    timestamptz not null default now()
);
alter table public.web_lead_tracker alter column details set default '[]';
create index if not exists web_lead_tracker_day on public.web_lead_tracker (lead_day desc);
alter table public.web_lead_tracker enable row level security;
revoke all on public.web_lead_tracker from anon, authenticated;
comment on table public.web_lead_tracker is
  'Web leads from the Google Sheet, with the receptionist''s status and Access link '
  '(Andrew, 26 November). Loaded by web_lead_tracker_load(), read by web_leads_board().';

-- every note, and every status change and link, with who and when
create table if not exists public.web_lead_events (
  id        bigint generated always as identity primary key,
  lead_key  text not null references public.web_lead_tracker (lead_key) on delete cascade,
  at        timestamptz not null default now(),
  by_id     uuid,
  by_name   text,
  kind      text not null check (kind in ('note', 'status', 'link')),
  body      text not null
);
create index if not exists web_lead_events_lead on public.web_lead_events (lead_key, at);
alter table public.web_lead_events enable row level security;
revoke all on public.web_lead_events from anon, authenticated;

-- when the sheet last sent
create table if not exists public.web_lead_tracker_runs (
  id       integer primary key default 1 check (id = 1),
  sent_at  timestamptz,
  sent     integer,
  added    integer
);
alter table public.web_lead_tracker_runs enable row level security;
revoke all on public.web_lead_tracker_runs from anon, authenticated;

-- ---------- 4. the sheet's load ---------------------------------------
-- p_leads: [{ "key": "...", "received_at": "2026-11-26T14:03:00Z", "day": "2026-11-26",
--             "row": 3512, "first": "Ann", "last": "Ray", "name": "", "email": "...",
--             "phone": "...", "details": [["City", "..."], ["Message", "..."]] }]
-- details are the row's other columns as [header, value] pairs, in the
-- sheet's own order (a json object would lose the order).
create or replace function public.web_lead_tracker_load(p_leads jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare n_sent integer; n_new integer;
begin
  if p_leads is null or jsonb_typeof(p_leads) <> 'array' then
    raise exception 'No leads were sent.';
  end if;

  with given as (
    select distinct on (l->>'key')
           l->>'key' as k,
           case when (l->>'received_at') ~ '^\d{4}-\d{2}-\d{2}T' then (l->>'received_at')::timestamptz end as rcv,
           case when (l->>'day') ~ '^\d{4}-\d{2}-\d{2}$' then (l->>'day')::date end as d,
           case when (l->>'row') ~ '^\d+$' then (l->>'row')::integer end as r,
           nullif(btrim(l->>'first'), '') as f, nullif(btrim(l->>'last'), '') as la,
           nullif(btrim(l->>'name'), '') as nm, nullif(btrim(l->>'email'), '') as em,
           nullif(btrim(l->>'phone'), '') as ph,
           case when jsonb_typeof(l->'details') in ('array', 'object') then l->'details' else '[]'::jsonb end as det
      from jsonb_array_elements(p_leads) as l
     where coalesce(l->>'key', '') ~ '^[0-9a-f]{16,64}$'
  ),
  up as (
    insert into public.web_lead_tracker as t
           (lead_key, received_at, lead_day, sheet_row, first_name, last_name, name,
            email, phone, details)
    select k, rcv, d, r, f, la, nm, em, ph, det from given
    on conflict (lead_key) do update
       set received_at = excluded.received_at, lead_day = excluded.lead_day,
           sheet_row = excluded.sheet_row, first_name = excluded.first_name,
           last_name = excluded.last_name, name = excluded.name, email = excluded.email,
           phone = excluded.phone, details = excluded.details, last_seen = now()
    returning (xmax = 0) as is_new
  )
  select count(*), count(*) filter (where is_new) into n_sent, n_new from up;

  insert into public.web_lead_tracker_runs (id, sent_at, sent, added)
  values (1, now(), n_sent, n_new)
  on conflict (id) do update set sent_at = excluded.sent_at, sent = excluded.sent,
                                 added = excluded.added;
  return jsonb_build_object('sent', n_sent, 'added', n_new);
end $$;

-- ---------- 5. what the page reads ------------------------------------
-- Every lead that came in on or after p_from (all of them when empty),
-- newest first, with its notes and history, its Access link, and for a
-- lead not linked yet the likeliest estimate in Access.
create or replace function public.web_leads_board(p_from date default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  leads jsonb; statuses jsonb; run jsonb; access_at timestamptz;
  has_access boolean := to_regclass('public.web_lead_sales') is not null;
begin
  if not public.can_use_web_leads() then
    raise exception 'The Web Leads tracker is for administrators and office staff.'
      using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('name', name, 'done', done) order by sort), '[]')
    into statuses from public.web_lead_statuses;
  select to_jsonb(r) - 'id' into run from public.web_lead_tracker_runs r where id = 1;

  select coalesce(jsonb_agg(to_jsonb(t) || jsonb_build_object(
           'events', coalesce((select jsonb_agg(jsonb_build_object(
                         'at', e.at, 'by', e.by_name, 'kind', e.kind, 'body', e.body) order by e.at)
                         from public.web_lead_events e where e.lead_key = t.lead_key), '[]'))
           order by t.received_at desc nulls last, t.lead_key), '[]')
    into leads
    from public.web_lead_tracker t
   where p_from is null or t.lead_day >= p_from or t.lead_day is null;

  if has_access then
    execute 'select sent_at from public.web_lead_sales_runs where id = 1' into access_at;
    -- the linked estimate, and for the rest the likeliest one
    execute $q$
      with l as (
        select x as lead, ord,
               x->>'lead_key' as k,
               nullif(x->>'estimate_id', '')::integer as est,
               nullif(x->>'lead_day', '')::date as day,
               public.gidc_lead_emails(x->>'email') as emails,
               public.gidc_lead_phones(x->>'phone') as phones,
               coalesce(public.gidc_lead_name(concat_ws(' ', x->>'first_name', x->>'last_name')),
                        public.gidc_lead_name(x->>'name')) as nm
          from jsonb_array_elements($1) with ordinality as a (x, ord)
      ),
      guess as (
        select distinct on (l.k) l.k, s.estimate_id, s.first_name, s.last_name,
               s.created_on, s.sold_on, w.how
          from l
          join public.web_lead_sales s on l.est is null and (
                  (cardinality(l.emails) > 0 and s.emails && l.emails)
               or (cardinality(l.phones) > 0 and s.phones && l.phones)
               or (l.nm like '% %' and l.nm = any (s.names)))
          cross join lateral (select case
                when cardinality(l.emails) > 0 and s.emails && l.emails then 1
                when cardinality(l.phones) > 0 and s.phones && l.phones then 2
                else 3 end as how) w
         where s.created_on is not null
           and (l.day is null or s.created_on >= l.day - 14)
           and (w.how < 3 or l.day is null or s.created_on <= l.day + 365)
         order by l.k, w.how, s.created_on, s.estimate_id
      )
      select coalesce(jsonb_agg(l.lead || jsonb_strip_nulls(jsonb_build_object(
               'access', case when s.estimate_id is not null then jsonb_build_object(
                   'estimate_id', s.estimate_id,
                   'name', concat_ws(' ', s.first_name, s.last_name),
                   'created_on', s.created_on, 'sold_on', s.sold_on, 'price', s.price) end,
               'suggest', case when g.estimate_id is not null then jsonb_build_object(
                   'estimate_id', g.estimate_id,
                   'name', concat_ws(' ', g.first_name, g.last_name),
                   'created_on', g.created_on, 'sold_on', g.sold_on,
                   'by', case g.how when 1 then 'email' when 2 then 'phone' else 'name' end) end))
               order by l.ord), '[]')
        from l
        left join public.web_lead_sales s on s.estimate_id = l.est
        left join guess g on g.k = l.k
    $q$ into leads using leads;
  end if;

  return jsonb_build_object('statuses', statuses, 'leads', leads, 'sheet', run,
                            'access_sent_at', access_at, 'access_copy', has_access);
end $$;

-- ---------- 6. what the page writes -----------------------------------
create or replace function public.web_lead_who_()
returns text language sql stable security definer set search_path = public as $$
  select coalesce((select coalesce(nullif(p.name, ''), p.email) from public.profiles p
                    where p.id = auth.uid()), 'somebody')
$$;

create or replace function public.web_lead_set_status(p_key text, p_status text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare who text := public.web_lead_who_(); was text;
begin
  if not public.can_use_web_leads() then
    raise exception 'The Web Leads tracker is for administrators and office staff.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.web_lead_statuses where name = p_status) then
    raise exception 'There is no status called "%".', p_status;
  end if;
  select status into was from public.web_lead_tracker where lead_key = p_key for update;
  if not found then raise exception 'That lead is not in the tracker.'; end if;
  if was is distinct from p_status then
    update public.web_lead_tracker set status = p_status, status_by = who, status_at = now()
     where lead_key = p_key;
    insert into public.web_lead_events (lead_key, by_id, by_name, kind, body)
    values (p_key, auth.uid(), who, 'status', p_status);
  end if;
  return jsonb_build_object('status', p_status, 'by', who);
end $$;

create or replace function public.web_lead_add_note(p_key text, p_note text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare who text := public.web_lead_who_(); n text := btrim(coalesce(p_note, ''));
begin
  if not public.can_use_web_leads() then
    raise exception 'The Web Leads tracker is for administrators and office staff.' using errcode = '42501';
  end if;
  if n = '' then raise exception 'The note is empty.'; end if;
  if length(n) > 4000 then raise exception 'That note is too long. Keep it under 4000 characters.'; end if;
  if not exists (select 1 from public.web_lead_tracker where lead_key = p_key) then
    raise exception 'That lead is not in the tracker.';
  end if;
  insert into public.web_lead_events (lead_key, by_id, by_name, kind, body)
  values (p_key, auth.uid(), who, 'note', n);
  return jsonb_build_object('by', who);
end $$;

-- p_estimate empty takes the link off
create or replace function public.web_lead_link(p_key text, p_estimate integer)
returns jsonb language plpgsql security definer set search_path = public as $$
declare who text := public.web_lead_who_(); was integer;
begin
  if not public.can_use_web_leads() then
    raise exception 'The Web Leads tracker is for administrators and office staff.' using errcode = '42501';
  end if;
  if p_estimate is not null and p_estimate <= 0 then
    raise exception 'An estimate number is a whole number above nought.';
  end if;
  select estimate_id into was from public.web_lead_tracker where lead_key = p_key for update;
  if not found then raise exception 'That lead is not in the tracker.'; end if;
  if was is distinct from p_estimate then
    update public.web_lead_tracker
       set estimate_id = p_estimate,
           linked_by = case when p_estimate is null then null else who end,
           linked_at = case when p_estimate is null then null else now() end
     where lead_key = p_key;
    insert into public.web_lead_events (lead_key, by_id, by_name, kind, body)
    values (p_key, auth.uid(), who, 'link',
            case when p_estimate is null then 'Link to estimate ' || was || ' taken off'
                 else 'Linked to Access estimate ' || p_estimate end);
  end if;
  return jsonb_build_object('estimate_id', p_estimate, 'by', who);
end $$;

-- ---------- 7. grants -------------------------------------------------
revoke all on function public.web_lead_tracker_load(jsonb) from public, anon, authenticated;
revoke all on function public.web_lead_who_() from public, anon, authenticated;
revoke all on function public.web_leads_board(date) from public, anon;
revoke all on function public.web_lead_set_status(text, text) from public, anon;
revoke all on function public.web_lead_add_note(text, text) from public, anon;
revoke all on function public.web_lead_link(text, integer) from public, anon;
grant execute on function public.web_leads_board(date) to authenticated;
grant execute on function public.web_lead_set_status(text, text) to authenticated;
grant execute on function public.web_lead_add_note(text, text) to authenticated;
grant execute on function public.web_lead_link(text, integer) to authenticated;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.web_lead_tracker_load(jsonb) to service_role';
    execute 'grant select, insert, update on public.web_lead_tracker, public.web_lead_tracker_runs, '
            'public.web_lead_events, public.web_lead_statuses to service_role';
  end if;
end $$;

notify pgrst, 'reload schema';

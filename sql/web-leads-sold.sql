-- ====================================================================
--  WEB LEADS MARKED NOT BOOKED, BOOKED OR SOLD
--  Run this in the Supabase SQL editor. Safe to run twice, and safe in
--  any order with the other files in sql/. It only adds: nothing that
--  exists is changed or dropped.
-- ====================================================================
--
--  Andrew, 26 November 2026: the Google Sheet the website form writes
--  to gets a Status column and a Sold Price column. Leads are matched to
--  Access by email first, as the most dependable, then by phone, then by
--  name. Later the same evening he split Unsold in two:
--    Not Booked  not in Access at all
--    Booked      in Access (an estimate), not sold
--    Sold        sold, with the Sold Price
--
--  THE PATH
--    The office server (gidc-web-leads-sync.ps1, hourly) reads every
--    retail estimate out of Access: the names, the emails and phones on
--    the estimate, when it was made (Estimates.DateTimeCreated), the
--    sale date if sold (Orders.SalesDate) and the price (Estimates.Price). It posts them to the web-leads edge
--    function, which replaces web_lead_sales with them.
--    The script in the Google Sheet (apps-script/gidc-web-leads.gs,
--    hourly) posts each lead's row number, date, email, phone and name
--    to the same function, which answers with web_leads_match(): Not
--    Booked, Booked, or Sold with the price. Nothing from the sheet is
--    kept here.
--
--  THE MATCH, for each lead
--    Sold: a sale on or after the day the lead came in, so a repeat
--    customer's old job does not mark a new lead sold.
--    Booked: failing that, an estimate made from two weeks before the
--    lead onward (the office may have taken the call first), so a
--    customer from years ago who writes in again is Not Booked until
--    the office makes them a new estimate.
--    Not Booked: neither.
--    The same three ways of matching for both:
--    1. email: any email on the lead equals any email on the estimate
--       (case and spaces ignored)
--    2. phone: failing that, the last ten digits of any phone match
--    3. name: failing both, the whole name matches (first and last, in
--       either order, punctuation ignored), and only for a sale or an
--       estimate within a year of the lead, as a name is the weakest
--    Several sales after one lead: the first one is taken, and its
--    price is the Sold Price.
--
--  WHO MAY
--    Nobody from a page. Both functions are for the edge function
--    (service role) only, and the table has row level security on with
--    no policies.
-- ====================================================================

-- ---------- 1. the retail estimates (a copy of Access) ----------------
-- Named for the sales it first held; since the Booked status it holds
-- every retail estimate, sold or not.
create table if not exists public.web_lead_sales (
  estimate_id integer primary key,
  first_name  text,
  last_name   text,
  emails      text[] not null default '{}',
  phones      text[] not null default '{}',
  names       text[] not null default '{}',
  sold_on     date,
  price       numeric(12,2),
  pulled_at   timestamptz not null default now()
);
-- the first version had only sold ones, so a sale date was required
alter table public.web_lead_sales alter column sold_on drop not null;
alter table public.web_lead_sales add column if not exists created_on date;
alter table public.web_lead_sales enable row level security;
revoke all on public.web_lead_sales from anon, authenticated;
create index if not exists web_lead_sales_emails on public.web_lead_sales using gin (emails);
create index if not exists web_lead_sales_phones on public.web_lead_sales using gin (phones);
create index if not exists web_lead_sales_names  on public.web_lead_sales using gin (names);
comment on table public.web_lead_sales is
  'Retail estimates from Access, replaced every hour by gidc-web-leads-sync.ps1, '
  'for marking the web leads sheet Sold. RLS on with no policies.';

-- when the server last sent, and what it counted
create table if not exists public.web_lead_sales_runs (
  id       integer primary key default 1 check (id = 1),
  sent_at  timestamptz,
  loaded   integer,
  counts   jsonb
);
alter table public.web_lead_sales_runs enable row level security;
revoke all on public.web_lead_sales_runs from anon, authenticated;

-- ---------- 2. the same tidy on both sides ----------------------------
-- every email in a cell that may hold several, lower case
create or replace function public.gidc_lead_emails(p text)
returns text[] language sql immutable set search_path = public as $$
  select coalesce(array_agg(distinct m[1]), '{}')
    from regexp_matches(lower(coalesce(p, '')),
                        '([a-z0-9._%+''-]+@[a-z0-9.-]+\.[a-z]{2,})', 'g') as m
$$;

-- every phone in a cell that may hold several, as its last ten digits
create or replace function public.gidc_lead_phones(p text)
returns text[] language sql immutable set search_path = public as $$
  select coalesce(array_agg(distinct right(regexp_replace(m[1], '\D', '', 'g'), 10)), '{}')
    from regexp_matches(coalesce(p, ''),
                        '((?:\+?1[\s.-]*)?\(?\d{3}\)?[\s.-]*\d{3}[\s.-]*\d{4})', 'g') as m
$$;

-- a name with the punctuation and extra spaces taken out, lower case
create or replace function public.gidc_lead_name(p text)
returns text language sql immutable set search_path = public as $$
  select nullif(btrim(regexp_replace(regexp_replace(lower(coalesce(p, '')),
                 '[^a-z ]', '', 'g'), '\s+', ' ', 'g')), '')
$$;

-- ---------- 3. the server's load: replaces the lot, all or nothing ----
create or replace function public.web_lead_sales_load(p_rows jsonb, p_counts jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'No rows were sent.';
  end if;
  delete from public.web_lead_sales where true;
  insert into public.web_lead_sales (estimate_id, first_name, last_name, emails, phones, names,
                                     created_on, sold_on, price)
  select distinct on ((r->>'estimate_id')::integer)
         (r->>'estimate_id')::integer,
         nullif(btrim(r->>'first_name'), ''),
         nullif(btrim(r->>'last_name'), ''),
         public.gidc_lead_emails(r->>'emails'),
         public.gidc_lead_phones(r->>'phones'),
         array_remove(array[
           public.gidc_lead_name(concat_ws(' ', r->>'first_name', r->>'last_name')),
           public.gidc_lead_name(concat_ws(' ', r->>'last_name', r->>'first_name'))], null),
         case when (r->>'created_on') ~ '^\d{4}-\d{2}-\d{2}$' then (r->>'created_on')::date end,
         case when (r->>'sold_on') ~ '^\d{4}-\d{2}-\d{2}$' then (r->>'sold_on')::date end,
         nullif(r->>'price', '')::numeric
    from jsonb_array_elements(p_rows) as r
   where (r->>'estimate_id') ~ '^\d+$'
     and ((r->>'created_on') ~ '^\d{4}-\d{2}-\d{2}$' or (r->>'sold_on') ~ '^\d{4}-\d{2}-\d{2}$');
  get diagnostics n = row_count;
  insert into public.web_lead_sales_runs (id, sent_at, loaded, counts)
  values (1, now(), n, p_counts)
  on conflict (id) do update set sent_at = excluded.sent_at, loaded = excluded.loaded,
                                 counts = excluded.counts;
  return jsonb_build_object('loaded', n);
end $$;

-- ---------- 4. the sheet's question: where did each lead get to ------
-- p_leads: [{ "row": 2, "day": "2026-03-04", "email": "...", "phone": "...",
--             "name": "...", "first": "...", "last": "..." }]
-- answers: [{ "row": 2, "status": "Sold", "price": 8123.45,
--             "sold_on": "2026-04-01", "by": "email" }], one per lead;
--          status is Sold, Booked or Not Booked
create or replace function public.web_leads_match(p_leads jsonb)
returns jsonb language sql stable security definer set search_path = public as $$
  with lead as (
    select (l->>'row')::integer as row_no,
           case when (l->>'day') ~ '^\d{4}-\d{2}-\d{2}$' then (l->>'day')::date end as day,
           public.gidc_lead_emails(l->>'email') as emails,
           public.gidc_lead_phones(l->>'phone') as phones,
           coalesce(public.gidc_lead_name(concat_ws(' ', l->>'first', l->>'last')),
                    public.gidc_lead_name(l->>'name')) as name
      from jsonb_array_elements(coalesce(p_leads, '[]')) as l
     where (l->>'row') ~ '^\d+$'
  ),
  -- every estimate that is the same person, and how sure
  same as (
    select lead.row_no, lead.day, s.*,
           case when cardinality(lead.emails) > 0 and s.emails && lead.emails then 1
                when cardinality(lead.phones) > 0 and s.phones && lead.phones then 2
                when lead.name is not null and lead.name like '% %' and lead.name = any (s.names) then 3
           end as how
      from lead join public.web_lead_sales s
        on (cardinality(lead.emails) > 0 and s.emails && lead.emails)
        or (cardinality(lead.phones) > 0 and s.phones && lead.phones)
        or (lead.name is not null and lead.name like '% %' and lead.name = any (s.names))
  ),
  hit as (
    -- 1 sold after the lead, 2 an estimate made from two weeks before it
    select row_no, estimate_id, how, sold_on, price,
           case when sold_on is not null and (day is null or sold_on >= day) then 1 else 2 end as stage
      from same
     where (    sold_on is not null and (day is null or sold_on >= day)
            and (how < 3 or sold_on <= day + 365))
        or (    created_on is not null and (day is null or created_on >= day - 14)
            and (how < 3 or created_on <= day + 365))
  ),
  best as (
    select distinct on (row_no) row_no, stage, sold_on, price, how
      from hit
     order by row_no, stage, how, sold_on nulls last, estimate_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'row', lead.row_no,
           'status', case best.stage when 1 then 'Sold' when 2 then 'Booked' else 'Not Booked' end,
           'price', case when best.stage = 1 then best.price end,
           'sold_on', case when best.stage = 1 then best.sold_on end,
           'by', case best.how when 1 then 'email' when 2 then 'phone' when 3 then 'name' end)
           order by lead.row_no), '[]')
    from lead left join best on best.row_no = lead.row_no
$$;

revoke all on function public.web_lead_sales_load(jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.web_leads_match(jsonb) from public, anon, authenticated;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.web_lead_sales_load(jsonb, jsonb) to service_role';
    execute 'grant execute on function public.web_leads_match(jsonb) to service_role';
    execute 'grant select, insert, update, delete on public.web_lead_sales, public.web_lead_sales_runs to service_role';
  end if;
end $$;

notify pgrst, 'reload schema';

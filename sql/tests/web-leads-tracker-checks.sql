-- TEST ONLY. Run by web-leads-tracker.sh against the throwaway database.
\set ON_ERROR_STOP 0
\pset footer off

\echo -- nine statuses in the order Andrew gave
select name, done from web_lead_statuses order by sort;

\echo -- the sheet loads three leads (as the service key does), one key twice
set role service_role;
select web_lead_tracker_load('[
 {"key":"aaaaaaaaaaaaaaaa","received_at":"2026-11-20T15:00:00Z","day":"2026-11-20","row":10,"first":"Ann","last":"Ray","email":"ann@x.ca","phone":"519 555 1234","details":[["Message","Bifolds please"]]},
 {"key":"bbbbbbbbbbbbbbbb","received_at":"2026-11-25T15:00:00Z","day":"2026-11-25","row":11,"name":"Bob Lee","phone":"(905) 555-0000"},
 {"key":"bbbbbbbbbbbbbbbb","received_at":"2026-11-25T15:00:00Z","day":"2026-11-25","row":11,"name":"Bob Lee","phone":"(905) 555-0000"},
 {"key":"not a key","day":"2026-11-25"}
]'::jsonb);
reset role;
\echo -- want 2 leads, both NEW LEAD
select lead_key, name, first_name, status, sheet_row from web_lead_tracker order by 1;

\echo -- Access copy, if web-leads-sold.sql is here
do $$ begin
  if to_regclass('public.web_lead_sales') is not null then
    perform web_lead_sales_load('[
      {"estimate_id":501,"first_name":"Ann","last_name":"Ray","emails":"ANN@x.ca","created_on":"2026-11-22"},
      {"estimate_id":400,"first_name":"Ann","last_name":"Ray","emails":"ann@x.ca","created_on":"2025-01-01","sold_on":"2025-02-01","price":"9000"},
      {"estimate_id":502,"first_name":"Bob","last_name":"Lee","phones":"905-555-0000","created_on":"2026-11-26","sold_on":"2026-11-26","price":"1234.50"}
    ]'::jsonb, null);
  end if;
end $$;

\echo -- office staff set a status, add a note, link (want three events)
select set_config('request.jwt.claim.sub', md5('user')::text, false);
set role authenticated;
select web_lead_set_status('aaaaaaaaaaaaaaaa', 'First Call No Answer');
select web_lead_set_status('aaaaaaaaaaaaaaaa', 'First Call No Answer');
select web_lead_add_note('aaaaaaaaaaaaaaaa', '  Left a voicemail  ');
select web_lead_link('aaaaaaaaaaaaaaaa', 501);
\echo -- want errors: no such status, empty note, no such lead
select web_lead_set_status('aaaaaaaaaaaaaaaa', 'Bogus');
select web_lead_add_note('aaaaaaaaaaaaaaaa', '   ');
select web_lead_add_note('zzzzzzzzzzzzzzzz', 'x');
\echo -- want permission denied writing the table directly
update web_lead_tracker set status = 'NEW LEAD';
select count(*) from web_lead_events;
\echo -- want permission denied: a page cannot load
select web_lead_tracker_load('[]'::jsonb);
\echo -- the board: Ann linked to 501, Bob suggested 502 by phone, 2 leads
select jsonb_array_length(b->'leads') as leads, jsonb_array_length(b->'statuses') as statuses,
       b->'leads'->0->>'name' as first_shown,
       b->'leads'->1->'access'->>'estimate_id' as ann_linked,
       b->'leads'->0->'suggest' as bob_suggest,
       b->'leads'->1->'suggest' as ann_suggest,
       jsonb_array_length(b->'leads'->1->'events') as ann_events,
       b->'leads'->1->'events'->1->>'body' as note
  from (select web_leads_board(null) b) x;
\echo -- from a date: only Bob
select jsonb_array_length(web_leads_board('2026-11-24')->'leads');
reset role;

\echo -- a second load keeps the status, notes and link, refreshes the details
set role service_role;
select web_lead_tracker_load('[{"key":"aaaaaaaaaaaaaaaa","received_at":"2026-11-20T15:00:00Z","day":"2026-11-20","row":12,"first":"Anne","last":"Ray","email":"ann@x.ca"}]'::jsonb);
reset role;
select first_name, status, estimate_id, sheet_row, details from web_lead_tracker where lead_key = 'aaaaaaaaaaaaaaaa';
select kind, by_name, body from web_lead_events order by id;

\echo -- unlink
select set_config('request.jwt.claim.sub', md5('admin')::text, false);
set role authenticated;
select web_lead_link('aaaaaaaaaaaaaaaa', null);
reset role;
select estimate_id, linked_by from web_lead_tracker where lead_key = 'aaaaaaaaaaaaaaaa';

\echo -- who can use it (want admin and user yes, everybody else refused)
do $$ declare n text; c int; begin
  foreach n in array array['admin','user','sales','manufacturing','installer','dealer','dadmin','cdealer','stranger'] loop
    perform set_config('request.jwt.claim.sub', md5(n)::text, false);
    set local role authenticated;
    begin
      c := jsonb_array_length(web_leads_board(null)->'leads');
      raise notice '% sees % leads', n, c;
    exception when others then raise notice '% refused: %', n, sqlerrm;
    end;
    begin
      perform web_lead_add_note('bbbbbbbbbbbbbbbb', 'from ' || n);
      raise notice '% can write a note', n;
    exception when others then raise notice '% cannot write: %', n, sqlerrm;
    end;
    reset role;
  end loop;
end $$;

\echo -- nobody signed in (want permission denied)
set role anon;
select web_leads_board(null);
select count(*) from web_lead_tracker;
reset role;

\echo -- OLD LEADS: four old ones and a recent one
set role service_role;
select web_lead_tracker_load(jsonb_build_array(
  jsonb_build_object('key','1111111111111111','day',(current_date - 100)::text,'first','Sal','last','Old','email','sal@old.ca'),
  jsonb_build_object('key','2222222222222222','day',(current_date - 100)::text,'first','Ned','last','Old','email','ned@old.ca'),
  jsonb_build_object('key','3333333333333333','day',(current_date - 100)::text,'first','Tom','last','Old','email','tom@old.ca'),
  jsonb_build_object('key','4444444444444444','day',(current_date - 100)::text,'first','Pat','last','Old','phone','519 000 1111'),
  jsonb_build_object('key','5555555555555555','day',(current_date - 10)::text,'first','Rec','last','Ent','email','rec@x.ca')));
reset role;
\echo -- a person already set Tom
select set_config('request.jwt.claim.sub', md5('user')::text, false);
set role authenticated;
select web_lead_set_status('3333333333333333', 'Contact Email Sent');
reset role;
do $$ begin
  if to_regclass('public.web_lead_sales') is not null then
    perform web_lead_sales_load(jsonb_build_array(
      jsonb_build_object('estimate_id',801,'first_name','Sal','last_name','Old','emails','sal@old.ca','created_on',(current_date - 95)::text,'sold_on',(current_date - 90)::text,'price','5000'),
      jsonb_build_object('estimate_id',802,'first_name','Pat','last_name','Old','phones','5190001111','created_on',(current_date - 400)::text,'sold_on',(current_date - 390)::text,'price','100'),
      jsonb_build_object('estimate_id',803,'first_name','Ned','last_name','Old','emails','ned@old.ca','created_on',(current_date - 95)::text)), null);
  end if;
end $$;
set role service_role;
select web_lead_tracker_load('[]'::jsonb);
reset role;
\echo -- want Sal Sold linked 801, Ned Dead (estimate only), Tom untouched, Pat Dead (sold BEFORE the lead), Rec NEW LEAD
\echo -- (with no Access copy: all four old stay NEW LEAD apart from Tom)
select first_name, status, status_by, estimate_id, linked_by from web_lead_tracker
 where lead_key ~ '^[1-5]{16}$' order by lead_key;
select lead_key, kind, by_name, body from web_lead_events where by_name = 'Automatic' order by id;
\echo -- runs twice without changing anything again (want 0)
set role service_role;
select web_lead_age_out();
\echo -- the sheet gets every status
select web_lead_sheet_statuses()->>'1111111111111111' as sal, web_lead_sheet_statuses()->>'3333333333333333' as tom;
reset role;
set role authenticated;
select web_lead_sheet_statuses();
reset role;

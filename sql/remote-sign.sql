-- remote-sign.sql: the record of contracts sent to a customer to sign on
-- their own device, and the private store for every signed contract PDF.
-- Measurement app 2.26, 18 November 2026. 2.28 adds the superseded columns.
--
-- SAFE TO RUN TWICE, and in any order with the other files. It only adds:
-- nothing that exists is changed or dropped.
--
-- Nobody reads or writes these from a web page. The table has row level
-- security on and NO policies, so the publishable key and every login get
-- nothing at all. Only the remote-sign and send-contract edge functions
-- touch it, with the service role, after checking who is asking: the sales
-- associate by their login and role, the customer by the secret in their
-- link. The link's secret itself is never stored, only its SHA-256 hash.

create extension if not exists pgcrypto;

create table if not exists public.sign_requests (
  id            uuid primary key default gen_random_uuid(),
  token_hash    text not null unique,             -- sha256 hex of the link secret
  job_id        text not null,                    -- jobs.id
  job           jsonb not null,                   -- the order exactly as sent
  fp            text,                             -- the app's fingerprint of it
  customer_name text,
  sent_to       text not null,                    -- customer email
  sent_by       uuid,                             -- auth.users id of the associate
  sent_by_name  text,
  sent_by_email text,
  sent_at       timestamptz not null default now(),
  expires_at    timestamptz not null default now() + interval '30 days',
  opened_at     timestamptz,                      -- first time the link was opened
  status        text not null default 'sent'
                check (status in ('sent', 'signed', 'done', 'cancelled')),
  signer_name   text,
  signed        jsonb,                            -- the pen strokes, per field
  signed_at     timestamptz,                      -- server time, not the device's
  signer_ip     text,
  signer_agent  text,
  pdf_path      text,                             -- in the signed-contracts store
  pdf_sha256    text,
  emailed_at    timestamptz,
  emailed_to    text[]
);

create index if not exists sign_requests_job on public.sign_requests (job_id, sent_at desc);

-- 2.28: a signed contract replaced by a later revision is kept and marked
-- superseded; the stamped copy sits beside the original in the store
alter table public.sign_requests add column if not exists superseded_at       timestamptz;
alter table public.sign_requests add column if not exists superseded_by_rev   integer;
alter table public.sign_requests add column if not exists superseded_pdf_path text;

alter table public.sign_requests enable row level security;
-- no policies, on purpose: see the top of this file
revoke all on public.sign_requests from anon, authenticated;

comment on table public.sign_requests is
  'Contracts sent to a customer to sign remotely. RLS on with no policies: '
  'only the remote-sign edge function (service role) reads or writes it.';

-- the private store for signed contract PDFs (remote and in person)
do $$ begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public)
    values ('signed-contracts', 'signed-contracts', false)
    on conflict (id) do nothing;
  else
    raise notice 'No storage schema here (a local test copy): bucket skipped.';
  end if;
end $$;

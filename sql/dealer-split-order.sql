-- ====================================================================
--  SPLITTING A DEALER ORDER INTO PARTS
--  Run this in the Supabase SQL editor. Safe to run twice, and safe in
--  any order with the other files in sql/. Changes nobody's access to
--  anything that exists today.
-- ====================================================================
--
--  Andrew, 23 November: an administrator opens an order anywhere in the
--  process except Shipped, ticks the doors to take off it, and those
--  doors become a second order. Both keep the name, with Part 1 and
--  Part 2 added. Part 2 keeps the dealer and the customer, starts with
--  no ship date, and the office can link it to its own Access job.
--  While it is not linked, administrators see in red that its ship date
--  is set by hand. Dealers never see that.
--
--  WHAT THIS ADDS
--
--   dealer_orders.split_of     on Part 2 and later: the order the split
--                              started from (Part 1). Plain uuid, no
--                              foreign key, so deleting Part 1 does not
--                              quietly hand Part 2 back to the sync.
--   dealer_orders.split_part   1 on the original, 2, 3 and so on after.
--   can_split_order()          the helper. Grinyer administrators.
--   gidc_split_order()         the split itself, all in one go.
--   dealer_orders_split_guard  the rule that keeps the hourly sync off
--                              a part that is set by hand.
--
--  TWO PORTAL ORDERS, ONE ACCESS JOB
--
--  Part 1 keeps the Access link it had, so the sync carries on setting
--  its status and ship date exactly as before. Part 2 is not linked:
--  one Access job can only be linked to one portal order (the link
--  screen refuses a second), and if both followed the one job, Part 1's
--  ship date would land on Part 2 every hour.
--
--  So a part with split_of set and no access_order_id is "manual": its
--  status, ship date and link are only ever changed by a person. The
--  guard below puts back whatever the sync tries to change on it,
--  including a link the sync might guess from the name, because the
--  name of Part 2 is the name of the job Part 1 already follows.
--
--  Linking Part 2 to its own Access job, from the Order # box or from
--  Linked to Access inside the order, ends that. From the next hour the
--  sync sets its status and ship date like any other linked order.
--
--  PALLETS AND INVOICES
--
--  Andrew, 23 November: the order has to be taken off its pallet before
--  it is split, and taking it off voids the pallet's commercial invoice
--  and packing list (the customs papers). So:
--
--   * an order on a pallet cannot be split; take it off first
--   * taking an order off a pallet voids the customs papers that
--     covered it (pallet_customs_docs.voided_at), here in the database,
--     so it holds however the order comes off. Voided papers are kept,
--     never deleted, and are made again from Invoice pallet
--   * before that happens the portal shows a big warning, and once it
--     has, ashley@grinyer.ca and accounting@grinyer.ca are emailed by
--     the customs-void-alert edge function from customs_void_alerts
--   * an order with a live QuickBooks invoice cannot be split either:
--     the invoice was made for every door on it. Void it first.
-- ====================================================================

do $$
begin
  if to_regclass('public.dealer_orders') is null then
    raise exception 'dealer_orders is not here. This is the wrong project.';
  end if;
  if to_regprocedure('public.gidc_order_no_norm(text)') is null then
    raise exception 'Run dealer-order-number.sql first. This file uses the Access '
                    'order number it adds. Nothing was changed.';
  end if;
end $$;

-- ---------- 1. the columns --------------------------------------------
alter table public.dealer_orders add column if not exists split_of uuid;
alter table public.dealer_orders add column if not exists split_part integer;
create index if not exists dealer_orders_split_of on public.dealer_orders(split_of);

comment on column public.dealer_orders.split_of is
  'On a part made by splitting an order: the order it was split from (Part 1). '
  'Set only by gidc_split_order().';
comment on column public.dealer_orders.split_part is
  'Which part of a split order this is: 1 on the original, then 2, 3 and so on.';

-- ---------- 2. who may ------------------------------------------------
-- Allowlists, like every other helper. p_dealer is here so it can be
-- widened later without changing any caller.
create or replace function public.can_split_order(p_dealer uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin()
$$;
-- who reads the alerts: the same people who make the papers
create or replace function public.can_void_customs()
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin()
$$;

-- ---------- 2b. voiding the customs papers ----------------------------
do $$
begin
  if to_regclass('public.pallet_customs_docs') is not null then
    alter table public.pallet_customs_docs add column if not exists voided_at timestamptz;
    alter table public.pallet_customs_docs add column if not exists voided_reason text;
  end if;
end $$;

-- THE ALERT
-- Andrew, 23 November: a big warning before it happens, and once it has,
-- an email to ashley@grinyer.ca and accounting@grinyer.ca that an order
-- with a completed commercial invoice has been modified. The record is
-- written here, by the database, as the papers are voided, so it exists
-- even if the email never goes. The customs-void-alert edge function
-- reads it, sends it, and stamps emailed_at.
create table if not exists public.customs_void_alerts (
  id              uuid primary key default gen_random_uuid(),
  order_id        uuid,
  order_ref       text,
  dealer_id       uuid,
  pallet_id       text,
  pallet_name     text,
  papers_id       uuid,
  papers_made_at  timestamptz,
  ci_no           text,          -- the commercial invoice number on the papers
  qbo_invoice_no  text,          -- the order's own QuickBooks invoice, if live
  changed_by      uuid,
  changed_by_name text,
  changed_at      timestamptz not null default now(),
  emailed_at      timestamptz,
  email_error     text
);
create index if not exists customs_void_alerts_order on public.customs_void_alerts(order_id);
alter table public.customs_void_alerts enable row level security;
drop policy if exists customs_void_alerts_read on public.customs_void_alerts;
create policy customs_void_alerts_read on public.customs_void_alerts
  for select to authenticated using (public.can_void_customs());
revoke all on public.customs_void_alerts from anon, authenticated;
grant select on public.customs_void_alerts to authenticated;

create or replace function public.gidc_void_customs_on_removal()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  c    record;
  o    record;
  who  text;
  qbo  text;
begin
  if to_regclass('public.pallet_customs_docs') is null then return old; end if;
  select d.order_ref, d.dealer_id into o from public.dealer_orders d where d.id = old.order_id;
  select coalesce(nullif(btrim(p.name), ''), p.email) into who
    from public.profiles p where p.id = auth.uid();
  if to_regclass('public.dealer_invoices') is not null then
    execute 'select string_agg(invoice_no, '', '') from public.dealer_invoices
              where order_id = $1 and voided_at is null' into qbo using old.order_id;
  end if;
  for c in
    update public.pallet_customs_docs
       set voided_at = now(),
           voided_reason = 'An order on them was taken off the pallet'
     where replace(pallet_id, '-', '') = replace(old.pallet_id::text, '-', '')
       and voided_at is null and order_ids ? old.order_id::text
    returning id, pallet_id, pallet_name, created_at, fields
  loop
    insert into public.customs_void_alerts(order_id, order_ref, dealer_id, pallet_id, pallet_name,
        papers_id, papers_made_at, ci_no, qbo_invoice_no, changed_by, changed_by_name)
      values (old.order_id, o.order_ref, o.dealer_id, c.pallet_id, c.pallet_name,
        c.id, c.created_at, nullif(c.fields ->> 'invNo', ''), qbo, auth.uid(), who);
  end loop;
  return old;
end $$;

do $$
begin
  if to_regclass('public.pallet_orders') is not null then
    drop trigger if exists pallet_orders_void_customs on public.pallet_orders;
    create trigger pallet_orders_void_customs
      after delete on public.pallet_orders
      for each row execute function public.gidc_void_customs_on_removal();
  end if;
end $$;


-- ---------- 3. a part whose ship date is set by hand ------------------
create or replace function public.gidc_split_manual(o public.dealer_orders)
returns boolean language sql stable as $$
  select o.split_of is not null and o.access_order_id is null
$$;

-- ---------- 4. the guard ----------------------------------------------
-- auth.uid() is null for the service role, which is how the hourly sync
-- writes. A person goes through the helper.
create or replace function public.dealer_orders_split_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if auth.uid() is not null
       and (new.split_of is not null or new.split_part is not null)
       and not public.can_split_order(new.dealer_id) then
      new.split_of := null;          -- a copied order does not bring the split
      new.split_part := null;
    end if;
    return new;
  end if;

  if auth.uid() is not null then
    if (new.split_of is distinct from old.split_of
        or new.split_part is distinct from old.split_part)
       and not public.can_split_order(old.dealer_id) then
      raise exception 'Only Grinyer can split an order.';
    end if;
    return new;
  end if;

  -- THE SYNC, ON A PART SET BY HAND
  if old.split_of is not null and old.access_order_id is null then
    -- A number an administrator typed into the Order # box links it
    -- the hour that job reaches the staging table. That is the office
    -- relinking it, so it is let through.
    if new.access_order_id is not null
       and public.gidc_order_no_norm(old.access_order_no) is not null
       and exists (select 1 from public.access_dealer_orders s
                    where s.order_id = new.access_order_id
                      and public.gidc_order_no_norm(s.order_no::text)
                          = public.gidc_order_no_norm(old.access_order_no)) then
      return new;
    end if;
    -- Anything else the sync tries is put back.
    new.access_order_id := old.access_order_id;
    new.access_order_no := old.access_order_no;
    new.status          := old.status;
    new.est_ship_date   := old.est_ship_date;
    new.split_of        := old.split_of;
    new.split_part      := old.split_part;
  end if;
  return new;
end $$;

drop trigger if exists dealer_orders_split_guard on public.dealer_orders;
create trigger dealer_orders_split_guard
  before insert or update on public.dealer_orders
  for each row execute function public.dealer_orders_split_guard();

-- ---------- 5. the split ----------------------------------------------
-- p_rows    the line ids (form.rows[].id) that move to the new part
-- p_keep    door_count, panel_count, paint_colour for what stays
-- p_move    the same for what moves
-- The counts come from the portal because it is the portal that knows
-- how many doors a line makes. Everything else is copied in here, in
-- one statement each, so a split is never half done.
create or replace function public.gidc_split_order(p_order uuid, p_rows text[],
                                                   p_keep jsonb default '{}'::jsonb,
                                                   p_move jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  o       public.dealer_orders%rowtype;
  rows_in jsonb;
  keep    jsonb;
  move    jsonb;
  root    uuid;
  base    text;
  part    int;
  new_id  uuid := gen_random_uuid();
  j       jsonb;
  cols    text;
  billed  boolean := false;
begin
  select * into o from public.dealer_orders where id = p_order for update;
  if not found then raise exception 'That order is not there any more.'; end if;
  if not public.can_split_order(o.dealer_id) then
    raise exception 'Only Grinyer can split an order.';
  end if;
  if o.status::text = 'shipped' then
    raise exception 'This order has shipped, so it cannot be split.';
  end if;
  if to_regclass('public.pallet_orders') is not null then
    execute 'select exists (select 1 from public.pallet_orders where order_id = $1)'
      into billed using p_order;
    if billed then
      raise exception 'This order is on a pallet. Take it off the pallet first, then split it.';
    end if;
  end if;
  if to_regclass('public.dealer_invoices') is not null then
    execute 'select exists (select 1 from public.dealer_invoices
                             where order_id = $1 and voided_at is null)'
      into billed using p_order;
    if billed then
      raise exception 'This order has been invoiced. Void its invoice on the pallet '
                      'first, then split it.';
    end if;
  end if;

  rows_in := coalesce(o.form -> 'rows', '[]'::jsonb);
  select coalesce(jsonb_agg(r order by n), '[]'::jsonb) into keep
    from jsonb_array_elements(rows_in) with ordinality t(r, n)
   where not (r ->> 'id' = any(coalesce(p_rows, '{}')));
  select coalesce(jsonb_agg(r order by n), '[]'::jsonb) into move
    from jsonb_array_elements(rows_in) with ordinality t(r, n)
   where r ->> 'id' = any(coalesce(p_rows, '{}'));

  if jsonb_array_length(move) = 0 then
    raise exception 'Tick at least one door to move to the new part.';
  end if;
  if jsonb_array_length(move) <> cardinality(p_rows) then
    raise exception 'Some of the ticked doors are not on this order any more. '
                    'Open it again and try once more.';
  end if;
  if jsonb_array_length(keep) = 0 then
    raise exception 'At least one door has to stay on this order.';
  end if;

  -- the name: the original without any Part number, then the part
  root := coalesce(o.split_of, o.id);
  base := regexp_replace(coalesce(o.order_ref, 'Order'), '\s+Part\s+\d+\s*$', '', 'i');
  select greatest(coalesce(max(d.split_part), 1), 1) + 1 into part
    from public.dealer_orders d
   where d.id = root or d.split_of = root;

  -- the new part: a copy of the order, then what is different about it.
  -- Built from the row itself so a column added later comes across too.
  j := to_jsonb(o)
       || jsonb_build_object(
            'id', new_id,
            'created_at', now(),
            'order_ref', base || ' Part ' || part,
            'form', jsonb_set(coalesce(o.form, '{}'::jsonb), '{rows}', move)
                    || jsonb_build_object('split', jsonb_build_object(
                         'of', root, 'part', part, 'from', o.id)),
            'files', '[]'::jsonb,
            'est_ship_date', null,
            'access_order_id', null,
            'access_order_no', null,
            'pallet_name', null,
            'split_of', root,
            'split_part', part)
       || (coalesce(p_move, '{}'::jsonb)
           - array(select k from jsonb_object_keys(coalesce(p_move, '{}'::jsonb)) k
                    where k not in ('door_count', 'panel_count', 'paint_colour')));

  select string_agg(quote_ident(c.column_name), ', ' order by c.ordinal_position) into cols
    from information_schema.columns c
   where c.table_schema = 'public' and c.table_name = 'dealer_orders'
     and c.is_generated = 'NEVER' and coalesce(c.identity_generation, '') <> 'ALWAYS';
  execute format('insert into public.dealer_orders (%s) select %s from '
                 'jsonb_populate_record(null::public.dealer_orders, $1)', cols, cols)
    using j;

  -- and what stays
  update public.dealer_orders d
     set order_ref  = base || ' Part ' || coalesce(o.split_part, 1),
         split_part = coalesce(o.split_part, 1),
         form       = jsonb_set(coalesce(o.form, '{}'::jsonb), '{rows}', keep),
         door_count = coalesce((p_keep ->> 'door_count')::int, d.door_count),
         panel_count = coalesce((p_keep ->> 'panel_count')::int, d.panel_count),
         paint_colour = case when p_keep ? 'paint_colour' then p_keep ->> 'paint_colour'
                             else d.paint_colour end
   where d.id = o.id;

  return jsonb_build_object('id', new_id, 'order_ref', base || ' Part ' || part,
    'part', part, 'kept_ref', base || ' Part ' || coalesce(o.split_part, 1),
    'moved', jsonb_array_length(move), 'kept', jsonb_array_length(keep));
end $$;

revoke all on function public.gidc_split_order(uuid, text[], jsonb, jsonb) from public, anon;
grant execute on function public.gidc_split_order(uuid, text[], jsonb, jsonb) to authenticated;

select 'split orders are in' as done;

notify pgrst, 'reload schema';

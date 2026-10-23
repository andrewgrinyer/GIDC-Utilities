-- ====================================================================
--  THE ACCESS ORDER NUMBER ON A DEALER ORDER
--  Run this in the Supabase SQL editor. Safe to run twice, and safe in
--  any order with the other files in sql/.
-- ====================================================================
--
--  Andrew, 23 October: show the Access order number between Customer
--  and Dealer ID on the portal's order list, be able to change it there,
--  and have the hourly sync use it to find the right job in Access.
--
--  WHICH NUMBER
--
--  The job number, OrderNo, because that is the one on the Access screen
--  and the one people say out loud. It is not OrderID. In this data the
--  two sit two apart (Aris is OrderNo 5067 and OrderID 5069), and
--  access_order_id has always held the ID. So this column holds the No,
--  and the ID is worked out from it, never typed.
--
--  HOW IT TAKES PRIORITY
--
--  The sync already looks at access_order_id before it tries to match by
--  name, so a linked order is never guessed at again. This file does not
--  touch gidc_sync_dealer_orders() at all. It adds a step the edge
--  function runs just before it:
--
--     gidc_link_dealer_orders_by_no()   every order with a number gets
--                                       access_order_id set from the job
--                                       carrying that number, so the
--                                       number wins over the name match
--
--  and one just after:
--
--     gidc_fill_access_order_no()       every order linked by id gets
--                                       its number filled in, so the list
--                                       shows it without anybody typing
--
--  WHO MAY CHANGE IT
--
--  can_set_access_order_no(), a helper, so widening it later is one line
--  and no policy changes. For now: Grinyer administrators, the same
--  people who can already link an order to Access by hand. A trigger
--  holds that for direct writes too, so the column cannot be changed by
--  a PATCH that goes round the function.
--
--  WHAT IT CANNOT DO
--
--  Find a job the sync has not pulled down. Only the dealer tags the
--  office server is set to read are in access_dealer_orders. A number
--  for a job outside those is kept, and links the hour it appears.
-- ====================================================================

do $$
begin
  if to_regclass('public.dealer_orders') is null then
    raise exception 'dealer_orders is not here. This is the wrong project.';
  end if;
  if to_regclass('public.access_dealer_orders') is null then
    raise exception 'access_dealer_orders is not here, so the Access sync has '
                    'not been set up on this project yet. Nothing was changed.';
  end if;
end $$;

-- ---------- 1. the column ---------------------------------------------
alter table public.dealer_orders
  add column if not exists access_order_no text;

comment on column public.dealer_orders.access_order_no is
  'The Access job number (OrderNo) this order belongs to, as on the Access '
  'screen. Not the OrderID, which is access_order_id and sits two away. Set '
  'through gidc_set_access_order_no(), or filled in by the hourly sync.';

-- ---------- 2. how two numbers are compared ---------------------------
-- Digits only, no leading zeros, so "5067", " 5067 " and "#5067" agree.
create or replace function public.gidc_order_no_norm(t text)
returns text language sql immutable as $$
  select nullif(ltrim(regexp_replace(coalesce(t, ''), '\D', '', 'g'), '0'), '')
$$;

-- ---------- 3. who may change it --------------------------------------
-- An allowlist, like every other helper. p_dealer is here so dealers can
-- be let in for their own orders later without changing any caller.
create or replace function public.can_set_access_order_no(p_dealer uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin()
$$;

-- ---------- 4. the guard on the column ---------------------------------
-- auth.uid() is null for the service role, which is how the sync writes,
-- so the sync always may. A signed in person may only if the helper says.
create or replace function public.dealer_orders_access_no_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return new; end if;
  if tg_op = 'INSERT' then
    if new.access_order_no is not null
       and not public.can_set_access_order_no(new.dealer_id) then
      new.access_order_no := null;   -- a copied order does not bring the number
    end if;
    return new;
  end if;
  if new.access_order_no is distinct from old.access_order_no
     and not public.can_set_access_order_no(old.dealer_id) then
    raise exception 'Only Grinyer can change the Access order number.';
  end if;
  -- THE LINK INSIDE THE ORDER AND THE NUMBER ON THE LIST STAY ONE THING
  -- Unlink, or Link to a different job, from inside the order moves the
  -- id and not the number. Left alone, the old number would pull the
  -- order straight back to the old job on the next sync. So a person
  -- moving the id takes the number with it.
  if new.access_order_id is distinct from old.access_order_id
     and new.access_order_no is not distinct from old.access_order_no then
    new.access_order_no := (select s.order_no::text from public.access_dealer_orders s
                             where s.order_id = new.access_order_id);
  end if;
  return new;
end $$;

drop trigger if exists dealer_orders_access_no_guard on public.dealer_orders;
create trigger dealer_orders_access_no_guard
  before insert or update of access_order_no, access_order_id on public.dealer_orders
  for each row execute function public.dealer_orders_access_no_guard();

-- ---------- 5. setting it from the portal ------------------------------
-- Stores the number and, if the sync has pulled that job down, links the
-- order to it there and then, so the screen can say which job it found.
-- An empty number unlinks: the order goes back to being matched by name.
create or replace function public.gidc_set_access_order_no(p_order uuid, p_no text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  o     public.dealer_orders%rowtype;
  n     text := nullif(btrim(coalesce(p_no, '')), '');
  hits  int;
  job   record;
  other text;
begin
  select * into o from public.dealer_orders where id = p_order;
  if not found then raise exception 'That order is not there any more.'; end if;
  if not public.can_set_access_order_no(o.dealer_id) then
    raise exception 'Only Grinyer can change the Access order number.';
  end if;

  if n is null then
    update public.dealer_orders
       set access_order_no = null, access_order_id = null
     where id = p_order;
    return jsonb_build_object('linked', false, 'cleared', true);
  end if;
  if public.gidc_order_no_norm(n) is null then
    raise exception 'An Access order number is digits, like 5067.';
  end if;

  select count(*) into hits from public.access_dealer_orders s
   where public.gidc_order_no_norm(s.order_no::text) = public.gidc_order_no_norm(n);

  if hits > 1 then
    raise exception 'More than one Access job has the number %. Link it from '
                    'inside the order instead, where you can pick the right one.', n;
  end if;

  if hits = 0 then
    update public.dealer_orders
       set access_order_no = n, access_order_id = null
     where id = p_order;
    return jsonb_build_object('linked', false, 'order_no', n);
  end if;

  select s.order_id, s.order_no::text as order_no, s.last_name, s.street_number, s.packed_on
    into job from public.access_dealer_orders s
   where public.gidc_order_no_norm(s.order_no::text) = public.gidc_order_no_norm(n);

  select coalesce(d.order_ref, d.customer_name, 'another order') into other
    from public.dealer_orders d
   where d.access_order_id = job.order_id and d.id <> p_order
   limit 1;
  if other is not null then
    raise exception 'Access job % is already on %. Take it off that one first.',
                    job.order_no, other;
  end if;

  update public.dealer_orders
     set access_order_no = job.order_no, access_order_id = job.order_id
   where id = p_order;
  return jsonb_build_object('linked', true, 'order_no', job.order_no,
    'order_id', job.order_id, 'last_name', job.last_name,
    'street_number', job.street_number, 'packed_on', job.packed_on);
end $$;

-- ---------- 6. the step before the sync --------------------------------
-- A number that fits exactly one staged job, which no other order holds,
-- sets access_order_id. That is all it takes for the sync to follow it.
create or replace function public.gidc_link_dealer_orders_by_no()
returns integer language plpgsql security definer set search_path = public as $$
declare moved int;
begin
  with one as (
    select public.gidc_order_no_norm(s.order_no::text) as k, min(s.order_id) as order_id
      from public.access_dealer_orders s
     where public.gidc_order_no_norm(s.order_no::text) is not null
     group by 1 having count(*) = 1
  )
  update public.dealer_orders d
     set access_order_id = one.order_id
    from one
   where public.gidc_order_no_norm(d.access_order_no) = one.k
     and d.access_order_id is distinct from one.order_id
     and not exists (select 1 from public.dealer_orders x
                      where x.access_order_id = one.order_id and x.id <> d.id);
  get diagnostics moved = row_count;
  return moved;
end $$;

-- ---------- 7. the step after the sync ---------------------------------
-- Whatever is linked by id shows its number. A number somebody typed is
-- only ever replaced by the same number written the way Access writes it.
create or replace function public.gidc_fill_access_order_no()
returns integer language plpgsql security definer set search_path = public as $$
declare filled int;
begin
  update public.dealer_orders d
     set access_order_no = s.order_no::text
    from public.access_dealer_orders s
   where s.order_id = d.access_order_id
     and nullif(btrim(s.order_no::text), '') is not null
     and d.access_order_no is distinct from s.order_no::text
     and (d.access_order_no is null
          or public.gidc_order_no_norm(d.access_order_no)
             = public.gidc_order_no_norm(s.order_no::text));
  get diagnostics filled = row_count;
  return filled;
end $$;

-- ---------- 8. who may call what ---------------------------------------
revoke all on function public.gidc_set_access_order_no(uuid, text) from public, anon;
grant execute on function public.gidc_set_access_order_no(uuid, text) to authenticated;

revoke all on function public.gidc_link_dealer_orders_by_no() from public, anon, authenticated;
revoke all on function public.gidc_fill_access_order_no() from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.gidc_link_dealer_orders_by_no() to service_role;
    grant execute on function public.gidc_fill_access_order_no() to service_role;
  end if;
end $$;

-- Fill the numbers for everything already linked, so the column is not
-- empty until the next hour.
select public.gidc_fill_access_order_no() as numbers_filled_now;

notify pgrst, 'reload schema';

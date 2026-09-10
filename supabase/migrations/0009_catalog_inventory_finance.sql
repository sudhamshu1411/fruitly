-- ============================================================
-- Phase 1 of the admin portal roadmap: categories, real inventory
-- with an audit trail, stock-safe ordering, and finance reporting.
--
-- Deliberately NOT included: true product variants. fruit_id is a text
-- primary key referenced directly by order_items, subscription_items and
-- exclusions, and by name throughout the frontend. Turning that into
-- variant_id is a breaking change through checkout and subscriptions at
-- once — it needs its own careful migration, not a rider on this one.
-- ============================================================

-- ---------- categories ----------
-- Same shape and the same staff_write pattern as fruits/boxes: public read,
-- staff-only write, enforced by RLS rather than trusting the client.
create table public.categories (
  id text primary key check (id ~ '^[a-z_]{2,30}$'),
  name text not null check (char_length(name) between 2 and 40),
  sort int not null default 100,
  is_active boolean not null default true
);

alter table public.categories enable row level security;

create policy categories_select on public.categories
  for select to anon, authenticated using (true);
create policy categories_staff_write on public.categories
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

grant select on public.categories to anon, authenticated;
grant insert, update, delete on public.categories to authenticated;
revoke insert, update, delete, truncate on public.categories from anon;
revoke truncate on public.categories from authenticated;

alter table public.fruits add column category_id text references public.categories (id) on delete set null;
alter table public.boxes  add column category_id text references public.categories (id) on delete set null;

-- ---------- inventory: stock on the item, ledger for the audit trail ----------
-- stock_qty stays a plain column on fruits (public-readable — "12 left" is
-- normal storefront UX, not a confidential number) so it can be locked and
-- decremented atomically in the same statement as order placement.
alter table public.fruits add column stock_qty int not null default 200 check (stock_qty >= 0);

-- Append-only. No anon/authenticated grant at all — every write goes through
-- adjust_stock() or the order-placement RPCs, all SECURITY DEFINER, all
-- checking is_staff() or ownership themselves. Modelled on the TRUNCATE
-- lesson from the last audit: don't rely on "no policy exists" alone when a
-- table holds nothing anyone but staff should ever see.
create table public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  fruit_id text not null references public.fruits (id),
  delta int not null check (delta <> 0),
  reason text not null check (reason in ('restock', 'order', 'adjustment', 'wastage', 'correction')),
  ref_order_id uuid references public.orders (id) on delete set null,
  actor_id uuid references public.profiles (id) on delete set null,
  note text check (note is null or char_length(note) <= 200),
  created_at timestamptz not null default now()
);

alter table public.inventory_movements enable row level security;
create policy inventory_movements_select on public.inventory_movements
  for select to authenticated using (public.is_staff());
revoke all on public.inventory_movements from anon, authenticated;
grant select on public.inventory_movements to authenticated;  -- RLS still narrows this to staff

create index inventory_movements_fruit on public.inventory_movements (fruit_id, created_at desc);

-- ---------- cost & reorder threshold: staff-only, never on the public catalogue ----------
-- Kept out of the fruits table on purpose. fruits_select is `using (true)` for
-- anon — a select * from the storefront's own catalogue query would otherwise
-- leak margin to every browser. A separate, staff-only table means the
-- existing public query is untouched and this can never leak by accident.
create table public.fruit_ops (
  fruit_id text primary key references public.fruits (id) on delete cascade,
  cost_price_paise int check (cost_price_paise is null or cost_price_paise >= 0),
  reorder_threshold int not null default 20 check (reorder_threshold >= 0),
  updated_at timestamptz not null default now()
);

alter table public.fruit_ops enable row level security;
create policy fruit_ops_staff on public.fruit_ops
  for all to authenticated using (public.is_staff()) with check (public.is_staff());
-- Revoke from BOTH roles: Supabase's default privileges grant ALL on new
-- tables in public, so anything not explicitly stripped stays granted.
revoke all on public.fruit_ops from anon, authenticated;
grant select on public.fruit_ops to authenticated;  -- RLS narrows to staff; writes via set_fruit_ops()

-- ---------- fulfillment issues: what the midnight loop couldn't complete ----------
create table public.fulfillment_issues (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid references public.subscriptions (id) on delete cascade,
  user_id uuid references public.profiles (id) on delete cascade,
  issue_date date not null,
  reason text not null check (char_length(reason) <= 200),
  detail jsonb,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

alter table public.fulfillment_issues enable row level security;
create policy fulfillment_issues_staff on public.fulfillment_issues
  for all to authenticated using (public.is_staff()) with check (public.is_staff());
revoke all on public.fulfillment_issues from anon, authenticated;
grant select on public.fulfillment_issues to authenticated;  -- RLS narrows to staff; writes via RPC only

create index fulfillment_issues_open on public.fulfillment_issues (issue_date desc) where resolved_at is null;

-- ============================================================
-- Stock-safe ordering
-- ============================================================

-- place_one_time_order: now locks and decrements stock as part of the same
-- transaction as the order. Insufficient stock rolls the whole call back —
-- nothing is inserted, the customer sees which item is short. Order of checks
-- matters: rate limit and pricing are cheap and go first; the row lock is last
-- so it's held for the shortest time.
create or replace function public.place_one_time_order(
  p_items jsonb,
  p_cutting public.cutting_style default 'cubed'
) returns jsonb
language plpgsql security definer set search_path = public as
$$
declare
  uid uuid := auth.uid();
  total int;
  total_grams int;
  oid uuid;
  d date := public.ist_today() + 1;
  addr uuid;
  recent int;
  item record;
  available int;
begin
  if uid is null then raise exception 'sign in first'; end if;

  select count(*) into recent
  from public.orders
  where user_id = uid
    and subscription_id is null
    and created_at > now() - interval '24 hours';
  if recent >= 10 then
    raise exception 'that is a lot of boxes for one day — get in touch and we will sort it out';
  end if;

  select coalesce(sum(line_paise), 0), coalesce(sum(line_grams), 0)
    into total, total_grams from public.priced_items(p_items);
  if total <= 0 then raise exception 'your box is empty'; end if;

  select id into addr from public.addresses where user_id = uid and is_default limit 1;

  insert into public.orders
    (user_id, delivery_date, status, total_paise, grams, cutting, address_id, events)
  values
    (uid, d, 'placed', total, total_grams, p_cutting, addr,
     jsonb_build_array(jsonb_build_object('event', 'placed', 'at', now())))
  returning id into oid;

  -- Lock every fruit row this order touches, in a stable order, before
  -- checking any of them — avoids a deadlock against a concurrent order that
  -- shares some but not all of the same fruits.
  for item in
    select i.fruit_id, i.cups from public.priced_items(p_items) i order by i.fruit_id
  loop
    select stock_qty into available from public.fruits where id = item.fruit_id for update;
    if not found then raise exception 'unknown fruit: %', item.fruit_id; end if;
    if available < item.cups then
      raise exception '% is out of stock right now', item.fruit_id;
    end if;
  end loop;

  insert into public.order_items (order_id, fruit_id, cups, price_paise_per_cup)
  select oid, i.fruit_id, i.cups, f.price_paise
  from public.priced_items(p_items) i join public.fruits f on f.id = i.fruit_id;

  update public.fruits f set stock_qty = f.stock_qty - i.cups
  from public.priced_items(p_items) i where f.id = i.fruit_id;

  insert into public.inventory_movements (fruit_id, delta, reason, ref_order_id, actor_id)
  select i.fruit_id, -i.cups, 'order', oid, uid from public.priced_items(p_items) i;

  return jsonb_build_object('order_id', oid, 'delivery_date', d, 'total_paise', total);
end
$$;

revoke execute on function public.place_one_time_order(jsonb, public.cutting_style) from public, anon;

-- create_order_for_subscription: a stock shortfall here must not raise. This
-- runs inside generate_orders' loop across every active subscription for the
-- day; one customer's box being short an ingredient must never block anyone
-- else's order from being created. Instead: create nothing for this
-- subscription today, and leave a fulfillment_issues row so staff sees it.
create or replace function public.create_order_for_subscription(p_sub uuid, p_date date)
returns uuid
language plpgsql security definer set search_path = public as
$$
declare
  s record;
  oid uuid;
  short record;
  short_list jsonb := '[]'::jsonb;
begin
  select * into s from public.subscriptions where id = p_sub;
  if not found or s.status <> 'active' then
    return null;
  end if;
  if exists (select 1 from public.skips k where k.subscription_id = p_sub and k.skip_date = p_date) then
    return null;
  end if;

  -- Check and lock stock for every item before creating anything. Locking in
  -- fruit_id order keeps this consistent with place_one_time_order and avoids
  -- a lock-order deadlock between a subscription delivery and a same-morning
  -- one-time order sharing an ingredient.
  for short in
    select si.fruit_id, si.cups, f.stock_qty
    from public.subscription_items si join public.fruits f on f.id = si.fruit_id
    where si.subscription_id = p_sub
    order by si.fruit_id
    for update of f
  loop
    if short.stock_qty < short.cups then
      short_list := short_list || jsonb_build_object('fruit_id', short.fruit_id, 'needed', short.cups, 'have', short.stock_qty);
    end if;
  end loop;

  if jsonb_array_length(short_list) > 0 then
    insert into public.fulfillment_issues (subscription_id, user_id, issue_date, reason, detail)
    values (p_sub, s.user_id, p_date, 'insufficient stock', short_list);
    return null;
  end if;

  insert into public.orders
    (user_id, subscription_id, delivery_date, status, total_paise, grams,
     cutting, payment, address_id, events)
  values
    (s.user_id, p_sub, p_date, 'placed', s.price_paise, s.grams,
     s.cutting, s.payment, s.address_id,
     jsonb_build_array(jsonb_build_object('event', 'placed', 'at', now())))
  on conflict (subscription_id, delivery_date) where (subscription_id is not null) do nothing
  returning id into oid;

  if oid is not null then
    insert into public.order_items (order_id, fruit_id, cups, price_paise_per_cup)
    select oid, si.fruit_id, si.cups, f.price_paise
    from public.subscription_items si
    join public.fruits f on f.id = si.fruit_id
    where si.subscription_id = p_sub;

    update public.fruits f set stock_qty = f.stock_qty - si.cups
    from public.subscription_items si
    where si.subscription_id = p_sub and f.id = si.fruit_id;

    insert into public.inventory_movements (fruit_id, delta, reason, ref_order_id)
    select si.fruit_id, -si.cups, 'order', oid
    from public.subscription_items si where si.subscription_id = p_sub;
  end if;
  return oid;
end
$$;

revoke execute on function public.create_order_for_subscription(uuid, date) from public, anon, authenticated;

-- generate_orders: defense in depth. Even with the shortfall handled above,
-- one subscription throwing an unexpected error (a future bug, a bad row)
-- must not roll back everyone else's order for the day. Each iteration now
-- has its own exception boundary; a failure is logged as a fulfillment issue
-- and the loop continues.
create or replace function public.generate_orders(p_date date)
returns int language plpgsql security definer set search_path = public as
$$
declare
  n int := 0;
  s record;
begin
  update public.subscriptions
     set status = 'active', paused_until = null
   where status = 'paused' and paused_until is not null and paused_until < p_date;

  for s in
    select * from public.subscriptions
    where status = 'active' and public.cadence_hits(cadence, delivery_days, p_date)
  loop
    begin
      if public.create_order_for_subscription(s.id, p_date) is not null then
        n := n + 1;
      end if;
    exception when others then
      insert into public.fulfillment_issues (subscription_id, user_id, issue_date, reason, detail)
      values (s.id, s.user_id, p_date, 'order generation failed', jsonb_build_object('error', sqlerrm));
    end;
  end loop;
  return n;
end
$$;

revoke execute on function public.generate_orders(date) from public, anon, authenticated;

-- ============================================================
-- Inventory management RPCs (staff-only)
-- ============================================================

-- Every stock change — restock, correction, wastage — goes through here so
-- the ledger is never out of sync with the number on the fruit. Row-locked
-- for the same reason the order paths are: two staff adjusting the same
-- fruit at once must not race.
create or replace function public.adjust_stock(p_fruit_id text, p_delta int, p_reason text, p_note text default null)
returns int
language plpgsql security definer set search_path = public as
$$
declare
  uid uuid := auth.uid();
  current_qty int;
  new_qty int;
begin
  if not public.is_staff() then raise exception 'staff only'; end if;
  if p_delta = 0 then raise exception 'delta must be nonzero'; end if;
  if p_reason not in ('restock', 'adjustment', 'wastage', 'correction') then
    raise exception 'reason must be restock, adjustment, wastage or correction';
  end if;
  if p_note is not null and char_length(p_note) > 200 then
    raise exception 'note too long';
  end if;

  select stock_qty into current_qty from public.fruits where id = p_fruit_id for update;
  if not found then raise exception 'unknown fruit'; end if;

  new_qty := current_qty + p_delta;
  if new_qty < 0 then
    raise exception 'that would take % below zero (currently %)', p_fruit_id, current_qty;
  end if;

  update public.fruits set stock_qty = new_qty where id = p_fruit_id;
  insert into public.inventory_movements (fruit_id, delta, reason, actor_id, note)
  values (p_fruit_id, p_delta, p_reason, uid, p_note);

  return new_qty;
end
$$;

revoke execute on function public.adjust_stock(text, int, text, text) from public, anon;

-- Staff view of the catalogue with stock, cost and margin joined — everything
-- the customer-facing fruits()/boxes() calls deliberately never return.
create or replace function public.admin_catalog()
returns jsonb
language plpgsql stable security definer set search_path = public as
$$
declare result jsonb;
begin
  if not public.is_staff() then raise exception 'staff only'; end if;
  select jsonb_build_object(
    'categories', coalesce((select jsonb_agg(c order by c.sort, c.name)
                             from public.categories c), '[]'::jsonb),
    'fruits', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', f.id, 'name', f.name, 'category_id', f.category_id,
        'price_paise', f.price_paise, 'grams_per_cup', f.grams_per_cup,
        'stock_qty', f.stock_qty, 'is_active', f.is_active, 'sold_out', f.sold_out,
        'cost_price_paise', o.cost_price_paise,
        'reorder_threshold', coalesce(o.reorder_threshold, 20),
        'low_stock', f.stock_qty <= coalesce(o.reorder_threshold, 20)
      ) order by f.sort, f.name)
      from public.fruits f left join public.fruit_ops o on o.fruit_id = f.id
    ), '[]'::jsonb),
    'low_stock_count', (
      select count(*) from public.fruits f left join public.fruit_ops o on o.fruit_id = f.id
      where f.stock_qty <= coalesce(o.reorder_threshold, 20)
    ),
    'open_fulfillment_issues', (
      select count(*) from public.fulfillment_issues where resolved_at is null
    )
  ) into result;
  return result;
end
$$;

revoke execute on function public.admin_catalog() from public, anon;

create or replace function public.resolve_fulfillment_issue(p_id uuid)
returns void
language plpgsql security definer set search_path = public as
$$
begin
  if not public.is_staff() then raise exception 'staff only'; end if;
  update public.fulfillment_issues set resolved_at = now()
  where id = p_id and resolved_at is null;
  if not found then raise exception 'no open issue with that id'; end if;
end
$$;

revoke execute on function public.resolve_fulfillment_issue(uuid) from public, anon;

-- ============================================================
-- Finance
-- ============================================================

-- Revenue, COGS and margin over a date range. COGS is computed from
-- order_items.cups * fruit_ops.cost_price_paise at query time (not frozen at
-- order time) — acceptable for a first pass since ingredient cost moves
-- slowly; flagged in the README as something to revisit if that stops holding.
create or replace function public.admin_finance_summary(p_from date, p_to date)
returns jsonb
language plpgsql stable security definer set search_path = public as
$$
declare result jsonb;
begin
  if not public.is_staff() then raise exception 'staff only'; end if;
  if p_from > p_to then raise exception 'from date must not be after to date'; end if;
  if p_to - p_from > 366 then raise exception 'range too wide — ask for at most a year at a time'; end if;

  select jsonb_build_object(
    'from', p_from, 'to', p_to,
    'orders_count', (select count(*) from public.orders
                     where delivery_date between p_from and p_to
                       and status not in ('cancelled', 'skipped')),
    'revenue_paise', (select coalesce(sum(total_paise), 0) from public.orders
                      where delivery_date between p_from and p_to
                        and status not in ('cancelled', 'skipped', 'failed')),
    'cogs_paise', (select coalesce(sum(oi.cups * o.cost_price_paise), 0)
                   from public.order_items oi
                   join public.orders ord on ord.id = oi.order_id
                   join public.fruit_ops o on o.fruit_id = oi.fruit_id
                   where ord.delivery_date between p_from and p_to
                     and ord.status not in ('cancelled', 'skipped', 'failed')
                     and o.cost_price_paise is not null),
    'cogs_coverage', jsonb_build_object(
      'items_with_cost', (select count(distinct oi.fruit_id) from public.order_items oi
                           join public.orders ord on ord.id = oi.order_id
                           join public.fruit_ops o on o.fruit_id = oi.fruit_id
                           where ord.delivery_date between p_from and p_to and o.cost_price_paise is not null),
      'items_total', (select count(distinct oi.fruit_id) from public.order_items oi
                       join public.orders ord on ord.id = oi.order_id
                       where ord.delivery_date between p_from and p_to)
    ),
    'payments', jsonb_build_object(
      'cod_pending_paise', (select coalesce(sum(total_paise), 0) from public.orders
                             where delivery_date between p_from and p_to
                               and payment = 'cod' and payment_status = 'pending'
                               and status not in ('cancelled', 'skipped', 'failed')),
      'cod_paid_paise', (select coalesce(sum(total_paise), 0) from public.orders
                          where delivery_date between p_from and p_to
                            and payment = 'cod' and payment_status = 'paid'),
      'online_paise', (select coalesce(sum(total_paise), 0) from public.orders
                        where delivery_date between p_from and p_to
                          and payment <> 'cod' and payment_status = 'paid')
    ),
    'by_day', coalesce((
      select jsonb_agg(jsonb_build_object('date', d.delivery_date, 'orders', d.n, 'revenue_paise', d.rev) order by d.delivery_date)
      from (select delivery_date, count(*) n, sum(total_paise) rev
            from public.orders
            where delivery_date between p_from and p_to
              and status not in ('cancelled', 'skipped', 'failed')
            group by delivery_date) d
    ), '[]'::jsonb)
  ) into result;
  return result;
end
$$;

revoke execute on function public.admin_finance_summary(date, date) from public, anon;

-- ============================================================
-- Seed
-- ============================================================
insert into public.categories (id, name, sort) values
  ('citrus', 'Citrus', 10),
  ('tropical', 'Tropical', 20),
  ('everyday', 'Everyday', 30),
  ('seasonal', 'Seasonal', 40);

update public.fruits set category_id = case
  when id in ('mango', 'papaya', 'pineapple') then 'tropical'
  when id in ('pomegranate', 'grapes', 'strawberry') then 'seasonal'
  else 'everyday'
end;

insert into public.fruit_ops (fruit_id, cost_price_paise, reorder_threshold)
select id,
       round(price_paise * 0.55),  -- placeholder 55% cost ratio — replace with real supplier cost
       20
from public.fruits;

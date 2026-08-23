-- Fruitly backend · 0002 — server-side business logic
-- All functions are SECURITY DEFINER: they bypass RLS, so every one of them
-- validates auth + ownership explicitly. Prices are always computed here,
-- never trusted from the client.

-- ---------- internal helpers ----------

-- Does this cadence deliver on this date? days: 0 = Mon … 6 = Sun.
create or replace function public.cadence_hits(p_cadence public.cadence, p_days int[], p_date date)
returns boolean language sql immutable as
$$
select case p_cadence
  when 'daily'     then true
  when 'alternate' then (extract(isodow from p_date)::int - 1) = any (p_days)
  when 'weekly'    then (extract(isodow from p_date)::int - 1) = any (p_days)
  when 'monthly'   then (extract(isodow from p_date)::int - 1) = any (p_days)
                        and extract(day from p_date)::int <= 7
end
$$;

create or replace function public.next_eligible_date(p_cadence public.cadence, p_days int[])
returns date language sql stable as
$$
select d::date
from generate_series(public.ist_today() + 1, public.ist_today() + 62, interval '1 day') d
where public.cadence_hits(p_cadence, p_days, d::date)
order by d
limit 1
$$;

-- Validate + price a custom-box item list: [{"fruit_id":"mango","cups":2}, …]
create or replace function public.priced_items(p_items jsonb)
returns table (fruit_id text, cups int, line_paise int, line_grams int)
language plpgsql stable security definer set search_path = public as
$$
declare
  n int;
  bad int;
  missing text;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'items must be a JSON array';
  end if;
  n := jsonb_array_length(p_items);
  if n < 1 or n > 7 then
    raise exception 'choose between 1 and 7 fruits';
  end if;

  select count(*) into bad
  from jsonb_array_elements(p_items) e
  where jsonb_typeof(e) <> 'object'
     or (e ->> 'fruit_id') is null
     or (e ->> 'cups') is null
     or not ((e ->> 'cups') ~ '^[0-9]{1,2}$')
     or (e ->> 'cups')::int not between 1 and 9;
  if bad > 0 then
    raise exception 'each item needs a fruit_id and 1–9 cups';
  end if;

  select count(*) - count(distinct e ->> 'fruit_id') into bad
  from jsonb_array_elements(p_items) e;
  if bad > 0 then
    raise exception 'duplicate fruit in items';
  end if;

  select string_agg(x.fid, ', ') into missing
  from (select e ->> 'fruit_id' as fid from jsonb_array_elements(p_items) e) x
  left join public.fruits f on f.id = x.fid
  where f.id is null or not f.is_active or f.sold_out;
  if missing is not null then
    raise exception 'not available today: %', missing;
  end if;

  return query
  select f.id, x.cups, f.price_paise * x.cups, f.grams_per_cup * x.cups
  from (
    select e ->> 'fruit_id' as fid, (e ->> 'cups')::int as cups
    from jsonb_array_elements(p_items) e
  ) x
  join public.fruits f on f.id = x.fid;
end
$$;

-- Materialise one order from a subscription for a date. Internal.
create or replace function public.create_order_for_subscription(p_sub uuid, p_date date)
returns uuid
language plpgsql security definer set search_path = public as
$$
declare
  s record;
  oid uuid;
begin
  select * into s from public.subscriptions where id = p_sub;
  if not found or s.status <> 'active' then
    return null;
  end if;
  if exists (select 1 from public.skips k where k.subscription_id = p_sub and k.skip_date = p_date) then
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
  end if;
  return oid;
end
$$;

-- ---------- customer RPCs ----------

create or replace function public.create_subscription(
  p_cadence public.cadence,
  p_days int[],
  p_cutting public.cutting_style default 'cubed',
  p_payment public.payment_method default 'cod',
  p_box_id text default null,
  p_items jsonb default null
) returns jsonb
language plpgsql security definer set search_path = public as
$$
declare
  uid uuid := auth.uid();
  days int[];
  total int := 0;
  total_grams int := 0;
  sub_id uuid;
  first_date date;
  addr uuid;
begin
  if uid is null then raise exception 'sign in first'; end if;

  -- normalise + validate delivery days per cadence
  if p_cadence = 'daily' then
    days := array[0, 1, 2, 3, 4, 5, 6];
  else
    select coalesce(array_agg(distinct x order by x), '{}') into days
    from unnest(coalesce(p_days, '{}')) x where x between 0 and 6;
    if p_cadence in ('weekly', 'monthly') and coalesce(array_length(days, 1), 0) <> 1 then
      raise exception 'pick exactly one delivery day for a % plan', p_cadence;
    end if;
    if p_cadence = 'alternate' and coalesce(array_length(days, 1), 0) not between 1 and 7 then
      raise exception 'pick your delivery days';
    end if;
  end if;

  -- price server-side
  if p_box_id is not null then
    select price_paise, grams into total, total_grams from public.boxes where id = p_box_id;
    if not found then raise exception 'unknown box'; end if;
  else
    select coalesce(sum(line_paise), 0), coalesce(sum(line_grams), 0)
      into total, total_grams
    from public.priced_items(p_items);
    if total <= 0 then raise exception 'your box is empty'; end if;
  end if;

  select id into addr from public.addresses
    where user_id = uid and is_default limit 1;

  -- one live plan per user: replace any existing one
  update public.subscriptions
     set status = 'cancelled', cancelled_at = now()
   where user_id = uid and status in ('active', 'paused');
  update public.orders o
     set status = 'cancelled',
         events = o.events || jsonb_build_object('event', 'cancelled', 'at', now())
   where o.user_id = uid and o.subscription_id is not null
     and o.delivery_date > public.ist_today() and o.status = 'placed';

  insert into public.subscriptions
    (user_id, box_id, cadence, delivery_days, cutting, price_paise, grams, payment, address_id)
  values
    (uid, p_box_id, p_cadence, days, p_cutting, total, total_grams, p_payment, addr)
  returning id into sub_id;

  if p_box_id is null then
    insert into public.subscription_items (subscription_id, fruit_id, cups)
    select sub_id, i.fruit_id, i.cups from public.priced_items(p_items) i;
  end if;

  first_date := public.next_eligible_date(p_cadence, days);
  perform public.create_order_for_subscription(sub_id, first_date);

  return jsonb_build_object(
    'subscription_id', sub_id,
    'price_paise', total,
    'grams', total_grams,
    'first_delivery', first_date
  );
end
$$;

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
begin
  if uid is null then raise exception 'sign in first'; end if;

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

  insert into public.order_items (order_id, fruit_id, cups, price_paise_per_cup)
  select oid, i.fruit_id, i.cups, f.price_paise
  from public.priced_items(p_items) i join public.fruits f on f.id = i.fruit_id;

  return jsonb_build_object('order_id', oid, 'delivery_date', d, 'total_paise', total);
end
$$;

create or replace function public.skip_delivery(p_subscription uuid, p_date date)
returns void language plpgsql security definer set search_path = public as
$$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'sign in first'; end if;
  if not exists (select 1 from public.subscriptions s
                 where s.id = p_subscription and s.user_id = uid and s.status = 'active') then
    raise exception 'no active plan found';
  end if;
  if p_date <= public.ist_today() then
    raise exception 'skips close at midnight — that delivery is already being prepared';
  end if;
  if p_date > public.ist_today() + 62 then
    raise exception 'that date is too far ahead';
  end if;

  insert into public.skips (subscription_id, user_id, skip_date)
  values (p_subscription, uid, p_date)
  on conflict do nothing;

  update public.orders o
     set status = 'skipped',
         events = o.events || jsonb_build_object('event', 'skipped', 'at', now())
   where o.subscription_id = p_subscription and o.delivery_date = p_date and o.status = 'placed';
end
$$;

create or replace function public.unskip_delivery(p_subscription uuid, p_date date)
returns void language plpgsql security definer set search_path = public as
$$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'sign in first'; end if;
  if p_date <= public.ist_today() then
    raise exception 'skips close at midnight';
  end if;
  delete from public.skips k
   where k.subscription_id = p_subscription and k.skip_date = p_date and k.user_id = uid;
  update public.orders o
     set status = 'placed',
         events = o.events || jsonb_build_object('event', 'restored', 'at', now())
   where o.subscription_id = p_subscription and o.delivery_date = p_date
     and o.status = 'skipped'
     and exists (select 1 from public.subscriptions s
                 where s.id = p_subscription and s.user_id = uid);
end
$$;

create or replace function public.pause_subscription(p_subscription uuid, p_until date)
returns void language plpgsql security definer set search_path = public as
$$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'sign in first'; end if;
  if p_until <= public.ist_today() or p_until > public.ist_today() + 30 then
    raise exception 'pause for up to 30 days';
  end if;
  update public.subscriptions s
     set status = 'paused', paused_until = p_until
   where s.id = p_subscription and s.user_id = uid and s.status = 'active';
  if not found then raise exception 'no active plan found'; end if;

  update public.orders o
     set status = 'cancelled',
         events = o.events || jsonb_build_object('event', 'paused', 'at', now())
   where o.subscription_id = p_subscription
     and o.delivery_date > public.ist_today() and o.status = 'placed';
end
$$;

create or replace function public.resume_subscription(p_subscription uuid)
returns void language plpgsql security definer set search_path = public as
$$
declare
  uid uuid := auth.uid();
  s record;
begin
  if uid is null then raise exception 'sign in first'; end if;
  update public.subscriptions
     set status = 'active', paused_until = null
   where id = p_subscription and user_id = uid and status = 'paused'
  returning * into s;
  if not found then raise exception 'no paused plan found'; end if;
  perform public.create_order_for_subscription(
    p_subscription, public.next_eligible_date(s.cadence, s.delivery_days));
end
$$;

create or replace function public.cancel_subscription(p_subscription uuid)
returns void language plpgsql security definer set search_path = public as
$$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'sign in first'; end if;
  update public.subscriptions
     set status = 'cancelled', cancelled_at = now()
   where id = p_subscription and user_id = uid and status in ('active', 'paused');
  if not found then raise exception 'no plan found'; end if;
  update public.orders o
     set status = 'cancelled',
         events = o.events || jsonb_build_object('event', 'cancelled', 'at', now())
   where o.subscription_id = p_subscription
     and o.delivery_date > public.ist_today() and o.status = 'placed';
end
$$;

create or replace function public.update_subscription_prefs(
  p_subscription uuid, p_days int[], p_cutting public.cutting_style
) returns void language plpgsql security definer set search_path = public as
$$
declare
  uid uuid := auth.uid();
  s record;
  days int[];
begin
  if uid is null then raise exception 'sign in first'; end if;
  select * into s from public.subscriptions
   where id = p_subscription and user_id = uid and status in ('active', 'paused');
  if not found then raise exception 'no plan found'; end if;

  if s.cadence = 'daily' then
    days := array[0, 1, 2, 3, 4, 5, 6];
  else
    select coalesce(array_agg(distinct x order by x), '{}') into days
    from unnest(coalesce(p_days, '{}')) x where x between 0 and 6;
    if s.cadence in ('weekly', 'monthly') and coalesce(array_length(days, 1), 0) <> 1 then
      raise exception 'pick exactly one delivery day';
    end if;
    if coalesce(array_length(days, 1), 0) < 1 then
      raise exception 'pick your delivery days';
    end if;
  end if;

  update public.subscriptions
     set delivery_days = days, cutting = p_cutting
   where id = p_subscription;
end
$$;

create or replace function public.rate_order(p_order uuid, p_stars int, p_comment text default null)
returns void language plpgsql security definer set search_path = public as
$$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'sign in first'; end if;
  if p_stars not between 1 and 5 then raise exception 'stars must be 1–5'; end if;
  if p_comment is not null and char_length(p_comment) > 500 then
    raise exception 'comment too long';
  end if;
  if not exists (select 1 from public.orders o
                 where o.id = p_order and o.user_id = uid and o.status = 'delivered') then
    raise exception 'you can rate a delivery once it arrives';
  end if;
  insert into public.ratings (order_id, user_id, stars, comment)
  values (p_order, uid, p_stars, p_comment)
  on conflict (order_id) do update
    set stars = excluded.stars, comment = excluded.comment, created_at = now();
end
$$;

create or replace function public.set_exclusions(p_fruit_ids text[])
returns void language plpgsql security definer set search_path = public as
$$
declare
  uid uuid := auth.uid();
  unknown text;
begin
  if uid is null then raise exception 'sign in first'; end if;
  if coalesce(array_length(p_fruit_ids, 1), 0) > 10 then
    raise exception 'that excludes almost everything';
  end if;
  select string_agg(x, ', ') into unknown
  from unnest(coalesce(p_fruit_ids, '{}')) x
  where not exists (select 1 from public.fruits f where f.id = x);
  if unknown is not null then raise exception 'unknown fruit: %', unknown; end if;

  delete from public.exclusions where user_id = uid;
  insert into public.exclusions (user_id, fruit_id)
  select uid, x from unnest(coalesce(p_fruit_ids, '{}')) x;
end
$$;

-- ---------- staff RPCs ----------

create or replace function public.advance_order(p_order uuid)
returns public.order_status language plpgsql security definer set search_path = public as
$$
declare
  cur public.order_status;
  nxt public.order_status;
begin
  if not public.is_staff() then raise exception 'staff only'; end if;
  select status into cur from public.orders where id = p_order for update;
  if not found then raise exception 'no such order'; end if;
  nxt := case cur
    when 'placed' then 'preparing'::public.order_status
    when 'preparing' then 'packed'::public.order_status
    when 'packed' then 'out_for_delivery'::public.order_status
    when 'out_for_delivery' then 'delivered'::public.order_status
    else null
  end;
  if nxt is null then raise exception 'order is % — nothing to advance', cur; end if;

  update public.orders o
     set status = nxt,
         payment_status = case when nxt = 'delivered' and o.payment = 'cod'
                               then 'paid'::public.payment_status else o.payment_status end,
         events = o.events || jsonb_build_object('event', nxt, 'at', now())
   where o.id = p_order;
  return nxt;
end
$$;

create or replace function public.fail_order(p_order uuid)
returns void language plpgsql security definer set search_path = public as
$$
begin
  if not public.is_staff() then raise exception 'staff only'; end if;
  update public.orders o
     set status = 'failed',
         events = o.events || jsonb_build_object('event', 'failed', 'at', now())
   where o.id = p_order and o.status in ('placed', 'preparing', 'packed', 'out_for_delivery');
  if not found then raise exception 'order cannot be failed'; end if;
end
$$;

create or replace function public.admin_today()
returns jsonb language plpgsql stable security definer set search_path = public as
$$
declare
  today date := public.ist_today();
  result jsonb;
begin
  if not public.is_staff() then raise exception 'staff only'; end if;
  select jsonb_build_object(
    'date', today,
    'orders_total', (select count(*) from public.orders where delivery_date = today),
    'by_status', coalesce(
      (select jsonb_object_agg(t.status, t.n)
       from (select status, count(*) n from public.orders
             where delivery_date = today group by status) t), '{}'::jsonb),
    'boxes_to_prepare', (select count(*) from public.orders
                         where delivery_date = today and status in ('placed', 'preparing')),
    'revenue_paise', (select coalesce(sum(total_paise), 0) from public.orders
                      where delivery_date = today
                        and status not in ('skipped', 'cancelled', 'failed')),
    'active_subscriptions', (select count(*) from public.subscriptions where status = 'active'),
    'avg_rating', (select round(avg(stars)::numeric, 2) from public.ratings),
    'fruits_required', coalesce(
      (select jsonb_agg(jsonb_build_object(
                'fruit_id', f.id, 'name', f.name, 'color', f.color,
                'cups', t.cups, 'kg', round(t.g / 1000.0, 1))
              order by t.g desc)
       from (select oi.fruit_id, sum(oi.cups) cups, sum(oi.cups * f2.grams_per_cup) g
             from public.order_items oi
             join public.orders o on o.id = oi.order_id
             join public.fruits f2 on f2.id = oi.fruit_id
             where o.delivery_date = today
               and o.status not in ('skipped', 'cancelled', 'failed')
             group by oi.fruit_id) t
       join public.fruits f on f.id = t.fruit_id), '[]'::jsonb)
  ) into result;
  return result;
end
$$;

-- ---------- the midnight loop ----------

create or replace function public.generate_orders(p_date date)
returns int language plpgsql security definer set search_path = public as
$$
declare
  n int := 0;
  s record;
begin
  -- pauses that have lapsed come back automatically
  update public.subscriptions
     set status = 'active', paused_until = null
   where status = 'paused' and paused_until is not null and paused_until < p_date;

  for s in
    select * from public.subscriptions
    where status = 'active' and public.cadence_hits(cadence, delivery_days, p_date)
  loop
    if public.create_order_for_subscription(s.id, p_date) is not null then
      n := n + 1;
    end if;
  end loop;
  return n;
end
$$;

-- ---------- function privileges ----------
-- Internal machinery is not callable from the API roles.
revoke execute on function public.priced_items(jsonb) from public, anon, authenticated;
revoke execute on function public.create_order_for_subscription(uuid, date) from public, anon, authenticated;
revoke execute on function public.generate_orders(date) from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.ensure_single_default_address() from public, anon, authenticated;

-- Customer/staff RPCs require a session; keep them away from anon.
revoke execute on function public.create_subscription(public.cadence, int[], public.cutting_style, public.payment_method, text, jsonb) from public, anon;
revoke execute on function public.place_one_time_order(jsonb, public.cutting_style) from public, anon;
revoke execute on function public.skip_delivery(uuid, date) from public, anon;
revoke execute on function public.unskip_delivery(uuid, date) from public, anon;
revoke execute on function public.pause_subscription(uuid, date) from public, anon;
revoke execute on function public.resume_subscription(uuid) from public, anon;
revoke execute on function public.cancel_subscription(uuid) from public, anon;
revoke execute on function public.update_subscription_prefs(uuid, int[], public.cutting_style) from public, anon;
revoke execute on function public.rate_order(uuid, int, text) from public, anon;
revoke execute on function public.set_exclusions(text[]) from public, anon;
revoke execute on function public.advance_order(uuid) from public, anon;
revoke execute on function public.fail_order(uuid) from public, anon;
revoke execute on function public.admin_today() from public, anon;

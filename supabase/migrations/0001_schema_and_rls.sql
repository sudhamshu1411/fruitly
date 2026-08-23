-- Fruitly backend · 0001 — schema, constraints, row-level security
-- Money is stored in paise (integer). Dates are IST business dates.

-- ---------- enums ----------
create type public.cadence as enum ('daily', 'alternate', 'weekly', 'monthly');
create type public.cutting_style as enum ('cubed', 'sliced', 'whole');
create type public.sub_status as enum ('active', 'paused', 'cancelled');
create type public.order_status as enum
  ('placed', 'preparing', 'packed', 'out_for_delivery', 'delivered', 'failed', 'skipped', 'cancelled');
create type public.payment_method as enum ('cod', 'upi_mandate');
create type public.payment_status as enum ('pending', 'paid', 'refunded');

-- ---------- helpers ----------
create or replace function public.ist_today()
returns date language sql stable as
$$ select (now() at time zone 'Asia/Kolkata')::date $$;

-- ---------- profiles ----------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null default '' check (char_length(full_name) <= 80),
  phone text check (phone is null or phone ~ '^[0-9+ -]{7,15}$'),
  doorstep_note text check (doorstep_note is null or char_length(doorstep_note) <= 200),
  is_staff boolean not null default false,
  created_at timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public as
$$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''), ''));
  return new;
end
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- staff check used inside policies; security definer so it can read profiles
-- without recursing through profiles' own RLS.
create or replace function public.is_staff()
returns boolean
language sql stable security definer set search_path = public as
$$ select coalesce((select p.is_staff from public.profiles p where p.id = auth.uid()), false) $$;

-- ---------- addresses ----------
create table public.addresses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  label text not null default 'Home' check (char_length(label) between 1 and 30),
  line1 text not null check (char_length(line1) between 3 and 120),
  line2 text check (line2 is null or char_length(line2) <= 120),
  city text not null default 'Bengaluru' check (char_length(city) between 2 and 60),
  pincode text not null check (pincode ~ '^[1-9][0-9]{5}$'),
  is_default boolean not null default true,
  created_at timestamptz not null default now()
);
create index addresses_user_idx on public.addresses (user_id);

create or replace function public.ensure_single_default_address()
returns trigger language plpgsql security definer set search_path = public as
$$
begin
  if new.is_default then
    update public.addresses
      set is_default = false
      where user_id = new.user_id and id <> new.id and is_default;
  end if;
  return new;
end
$$;
create trigger addresses_single_default
  before insert or update of is_default on public.addresses
  for each row when (new.is_default) execute function public.ensure_single_default_address();

-- ---------- catalogue ----------
create table public.fruits (
  id text primary key check (id ~ '^[a-z_]{2,30}$'),
  name text not null check (char_length(name) between 2 and 40),
  cut_desc text not null check (char_length(cut_desc) <= 60),
  grams_per_cup int not null check (grams_per_cup between 50 and 1000),
  price_paise int not null check (price_paise between 1000 and 100000),
  color text not null default '#FFC233' check (color ~ '^#[0-9A-Fa-f]{6}$'),
  is_active boolean not null default true,
  sold_out boolean not null default false,
  sort int not null default 100
);

create table public.boxes (
  id text primary key check (id ~ '^[a-z_]{2,30}$'),
  name text not null,
  description text not null,
  grams int not null check (grams between 100 and 5000),
  cups int not null check (cups between 1 and 10),
  fruit_kinds text not null,
  price_paise int not null check (price_paise between 1000 and 500000),
  is_premium boolean not null default false,
  sort int not null default 100
);

-- ---------- subscriptions ----------
create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  box_id text references public.boxes (id),          -- null = custom box
  cadence public.cadence not null,
  delivery_days int[] not null,                      -- 0 = Mon … 6 = Sun
  cutting public.cutting_style not null default 'cubed',
  status public.sub_status not null default 'active',
  paused_until date,
  price_paise int not null check (price_paise > 0),  -- computed server-side
  grams int not null check (grams > 0),
  payment public.payment_method not null default 'cod',
  address_id uuid references public.addresses (id) on delete set null,
  created_at timestamptz not null default now(),
  cancelled_at timestamptz,
  constraint delivery_days_valid check (
    delivery_days <@ array[0, 1, 2, 3, 4, 5, 6]
    and array_length(delivery_days, 1) between 1 and 7
  )
);
create unique index one_active_subscription_per_user
  on public.subscriptions (user_id) where (status in ('active', 'paused'));
create index subscriptions_user_idx on public.subscriptions (user_id);

create table public.subscription_items (
  subscription_id uuid not null references public.subscriptions (id) on delete cascade,
  fruit_id text not null references public.fruits (id),
  cups int not null check (cups between 1 and 9),
  primary key (subscription_id, fruit_id)
);

create table public.exclusions (
  user_id uuid not null references public.profiles (id) on delete cascade,
  fruit_id text not null references public.fruits (id),
  primary key (user_id, fruit_id)
);

create table public.skips (
  subscription_id uuid not null references public.subscriptions (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  skip_date date not null,
  created_at timestamptz not null default now(),
  primary key (subscription_id, skip_date)
);

-- ---------- orders ----------
create table public.orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  subscription_id uuid references public.subscriptions (id) on delete set null,
  delivery_date date not null,
  status public.order_status not null default 'placed',
  total_paise int not null check (total_paise >= 0),
  grams int not null default 0 check (grams >= 0),
  cutting public.cutting_style not null default 'cubed',
  payment public.payment_method not null default 'cod',
  payment_status public.payment_status not null default 'pending',
  address_id uuid references public.addresses (id) on delete set null,
  events jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);
create unique index one_order_per_sub_per_day
  on public.orders (subscription_id, delivery_date) where (subscription_id is not null);
create index orders_user_idx on public.orders (user_id, delivery_date desc);
create index orders_day_idx on public.orders (delivery_date, status);

create table public.order_items (
  order_id uuid not null references public.orders (id) on delete cascade,
  fruit_id text not null references public.fruits (id),
  cups int not null check (cups between 1 and 9),
  price_paise_per_cup int not null check (price_paise_per_cup >= 0),
  primary key (order_id, fruit_id)
);

create table public.ratings (
  order_id uuid primary key references public.orders (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  stars int not null check (stars between 1 and 5),
  comment text check (comment is null or char_length(comment) <= 500),
  created_at timestamptz not null default now()
);

-- ---------- row-level security ----------
alter table public.profiles enable row level security;
alter table public.addresses enable row level security;
alter table public.fruits enable row level security;
alter table public.boxes enable row level security;
alter table public.subscriptions enable row level security;
alter table public.subscription_items enable row level security;
alter table public.exclusions enable row level security;
alter table public.skips enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.ratings enable row level security;

-- profiles: read own (staff read all); update own, but only safe columns
-- (column grants below keep is_staff out of reach).
create policy profiles_select on public.profiles
  for select to authenticated using (id = auth.uid() or public.is_staff());
create policy profiles_update on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- addresses: full CRUD on own rows; staff may read.
create policy addresses_select on public.addresses
  for select to authenticated using (user_id = auth.uid() or public.is_staff());
create policy addresses_insert on public.addresses
  for insert to authenticated with check (user_id = auth.uid());
create policy addresses_update on public.addresses
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy addresses_delete on public.addresses
  for delete to authenticated using (user_id = auth.uid());

-- catalogue: public read; writes only for staff.
create policy fruits_select on public.fruits for select to anon, authenticated using (true);
create policy fruits_staff_write on public.fruits
  for update to authenticated using (public.is_staff()) with check (public.is_staff());
create policy boxes_select on public.boxes for select to anon, authenticated using (true);
create policy boxes_staff_write on public.boxes
  for update to authenticated using (public.is_staff()) with check (public.is_staff());

-- subscriptions and children: read own (staff read all).
-- All mutations flow through security-definer RPCs; no direct write policies.
create policy subscriptions_select on public.subscriptions
  for select to authenticated using (user_id = auth.uid() or public.is_staff());
create policy subscription_items_select on public.subscription_items
  for select to authenticated using (
    exists (select 1 from public.subscriptions s
            where s.id = subscription_id and (s.user_id = auth.uid() or public.is_staff()))
  );
create policy skips_select on public.skips
  for select to authenticated using (user_id = auth.uid() or public.is_staff());

-- exclusions: users manage their own set.
create policy exclusions_select on public.exclusions
  for select to authenticated using (user_id = auth.uid() or public.is_staff());
create policy exclusions_insert on public.exclusions
  for insert to authenticated with check (user_id = auth.uid());
create policy exclusions_delete on public.exclusions
  for delete to authenticated using (user_id = auth.uid());

-- orders: read own (staff read all); mutations via RPCs only.
create policy orders_select on public.orders
  for select to authenticated using (user_id = auth.uid() or public.is_staff());
create policy order_items_select on public.order_items
  for select to authenticated using (
    exists (select 1 from public.orders o
            where o.id = order_id and (o.user_id = auth.uid() or public.is_staff()))
  );

-- ratings: read own (staff read all); insert via RPC (validates delivered + ownership).
create policy ratings_select on public.ratings
  for select to authenticated using (user_id = auth.uid() or public.is_staff());

-- ---------- privileges ----------
-- Default Supabase grants are broad; narrow them so writes only exist where a
-- policy (or an RPC) explicitly allows them.
revoke insert, update, delete on public.profiles from anon, authenticated;
grant  update (full_name, phone, doorstep_note) on public.profiles to authenticated;

revoke insert, update, delete on public.fruits from anon, authenticated;
grant  update (price_paise, sold_out, is_active) on public.fruits to authenticated; -- staff via RLS
revoke insert, update, delete on public.boxes from anon, authenticated;
grant  update (price_paise) on public.boxes to authenticated;                        -- staff via RLS

revoke insert, update, delete on public.subscriptions      from anon, authenticated;
revoke insert, update, delete on public.subscription_items from anon, authenticated;
revoke insert, update, delete on public.skips              from anon, authenticated;
revoke insert, update, delete on public.orders             from anon, authenticated;
revoke insert, update, delete on public.order_items        from anon, authenticated;
revoke insert, update, delete on public.ratings            from anon, authenticated;

revoke all on public.profiles, public.addresses, public.subscriptions,
  public.subscription_items, public.exclusions, public.skips, public.orders,
  public.order_items, public.ratings from anon;

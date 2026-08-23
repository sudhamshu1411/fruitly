# Fruitly 🥭

**Freshly peeled fruits at your doorstep. Fresh Fruit. Zero Hassle.**

Fruitly isn't a fruit-selling website — it's a **freshness subscription platform**.
The customer shouldn't think *"I need to buy fruits."* They should think
*"My Fruitly is coming today."*

Full stack: a dependency-free static front end on top of a Postgres backend
(Supabase) where **all** business logic, pricing and authorisation live.

---

## Architecture

```
Browser (static HTML/CSS/JS)
   │  supabase-js  ·  anon key only
   ▼
Supabase API gateway  ──►  Postgres
                            ├── Row-Level Security on every table
                            ├── SECURITY DEFINER RPCs  ← all writes
                            └── pg_cron 00:05 IST      ← nightly orders
   ▲
   └── Edge function `signup` (service-role key, server-side only)
```

**The client can't be trusted, and isn't.** The browser sends *intent*
(“subscribe me to these fruits, on these days”); the server decides the price,
the dates, and whether you're allowed. There is no code path where a client
value becomes money.

## Security model

| Concern | How it's handled |
|---|---|
| Price tampering | Clients never send prices. `create_subscription` / `place_one_time_order` recompute totals from the `fruits`/`boxes` tables. `INSERT/UPDATE` on `orders` is **revoked** from the API roles. |
| Reading other people's data | RLS on all 11 tables: `user_id = auth.uid()`. Verified by test — a signed-in user sees only their own rows. |
| Privilege escalation | `profiles.is_staff` is outside the `authenticated` column grant, so no user can promote themselves. Staff-only RPCs re-check `is_staff()` server-side. |
| Internal machinery | `EXECUTE` revoked from `anon`/`authenticated` on `priced_items`, `create_order_for_subscription`, `generate_orders`, trigger functions. |
| Injection | Everything goes through parameterised RPCs; inputs are regex/range/enum-checked in SQL and by table `CHECK` constraints. |
| Secrets | Only the anon key ships to the browser (it is public by design and gated by RLS). The service-role key exists solely inside the `signup` edge function. |
| Business rules | Skips close at midnight IST; pauses capped at 30 days; ratings only on **delivered** orders you own; one live plan per user (partial unique index). |

Run `supabase` advisors after any migration; `0004_hardening.sql` pins
`search_path` on helpers and keeps `is_staff()` away from `anon`.

## Database

`supabase/migrations/` — apply in order:

| File | Contents |
|---|---|
| `0001_schema_and_rls.sql` | 11 tables, 6 enums, constraints, RLS policies, narrowed grants |
| `0002_business_logic.sql` | 16 RPCs (subscription lifecycle, orders, ratings, staff ops, order generator) |
| `0003_seed_and_cron.sql` | Catalogue seed + `pg_cron` job at 00:05 IST |
| `0004_hardening.sql` | Advisor fixes |

Core tables: `profiles · addresses · fruits · boxes · subscriptions ·
subscription_items · exclusions · skips · orders · order_items · ratings`.
Money is stored in **paise** (integers — no float drift). Dates are IST
business dates via `ist_today()`.

### The midnight loop

`generate_orders(date)` runs nightly at 00:05 IST: it reactivates lapsed
pauses, walks every active subscription whose cadence hits that date, skips
anything the customer skipped, and writes one order + its item lines. It is
**idempotent** — a partial unique index means a re-run creates nothing.

## Customer API (RPCs)

`create_subscription` · `place_one_time_order` · `skip_delivery` ·
`unskip_delivery` · `pause_subscription` · `resume_subscription` ·
`cancel_subscription` · `update_subscription_prefs` · `rate_order` ·
`set_exclusions`

**Staff only:** `advance_order` (placed → preparing → packed → out for
delivery → delivered, flipping COD to paid) · `fail_order` · `admin_today`.

## Pages

| Page | What it does |
|---|---|
| `index.html` | Home — hero, live catalogue, boxes, subscription CTA |
| `shop.html` | Shop — tabbed categories, live prices and availability |
| `build.html` | Box builder — catalogue-driven; subscribes or orders for real |
| `auth.html` | Sign in / create account |
| `plans.html` | Live plan — skip, undo, change days/cut, pause, cancel |
| `orders.html` | Real orders, kitchen-to-door timeline, tap-to-rate |
| `account.html` | Profile, addresses, never-send list, subscription |
| `admin.html` | Ops dashboard — KPIs, pipeline, cut list, order queue (staff-gated) |
| `404.html` | Not-found |

## Run locally

```bash
npx http-server .        # or: python3 -m http.server
```

`js/config.js` holds the project URL and anon key. Point it at your own
Supabase project after applying the migrations and deploying the edge function:

```bash
supabase functions deploy signup
```

## Deploy

Static files — **Vercel** (`npx vercel`), **Netlify** (publish dir `/`), or
**GitHub Pages** (Settings → Pages → `main` / root). No build step.

## What's next

Payments are modelled (`payment_method`, `payment_status`, COD flips to paid
on delivery) but no gateway is wired — add a UPI-mandate/Razorpay webhook that
updates `orders.payment_status`. Live rider GPS, push notifications and
procurement/inventory tables are the next backend slices; the ops dashboard
already has the shape for them.

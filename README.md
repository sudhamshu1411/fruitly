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
| Table wipes | `TRUNCATE` is not governed by RLS, so it is revoked from `anon`/`authenticated` on every table (`0006`). |
| Signup abuse | `signup` calls `admin.createUser`, which bypasses Supabase Auth's own rate limits — so it throttles itself: 5 attempts an hour and 20 a day per IP, keyed on a SHA-256 so no raw address is stored (`0007`). |
| OAuth flow | `flowType: 'pkce'` is set explicitly rather than left to the library default — a one-time code in the query string, exchanged against a verifier that never leaves the browser, instead of access and refresh tokens sitting in the URL fragment. |
| Open redirect | `?next=` is matched against `^[a-z0-9-]+\.html$` in both `auth.js` and `auth-callback.js`. A scheme, a `//host`, or a path is discarded and replaced with `account.html`. |
| Account enumeration | Duplicate signup, password reset and resend all answer identically whether or not the address is registered. Supabase obfuscates the duplicate-signup response; the UI does not undo that by saying "already registered". |
| XSS | Every value from the database or a user is written with `textContent` / DOM properties. No user- or catalogue-supplied string is ever concatenated into `innerHTML`. |
| Order spam | `place_one_time_order` caps a user at 10 one-time orders per rolling 24h (`0008`). Subscriptions were already bounded by the one-active-plan index; one-time orders had no ceiling, so a signed-in account could loop the RPC and mint unlimited kitchen tickets. Cron-generated subscription deliveries do not count against the cap. |

| Cost & margin | `fruit_ops` is a separate, staff-only table precisely so the public catalogue query (`fruits`, `using (true)` for anon) can never return it. Cost never reaches a browser. |
| Stock integrity | `stock_qty` is deliberately absent from the column-level UPDATE grant on `fruits`, so **not even staff** can set it directly — it moves only through `adjust_stock()`, which writes a matching `inventory_movements` row in the same transaction. The ledger cannot drift from the number. |
| Overselling | `place_one_time_order` locks each fruit row (in `fruit_id` order, to avoid deadlocking against a concurrent order) and refuses the whole order if any item is short. Nothing is written on failure. |
| Nightly-run blast radius | A stock-out in one subscription logs a `fulfillment_issues` row and returns null instead of raising; `generate_orders` additionally wraps each subscription in its own exception boundary. One customer's missing ingredient can no longer roll back everybody else's order for the day. |

Run `supabase` advisors after any migration; `0004_hardening.sql` pins
`search_path` on helpers and keeps `is_staff()` away from `anon`.

### Sign-in, confirmation and Google

Three ways in, one account per address:

- **Email + password** via `auth.signUp()` / `signInWithPassword()`.
- **Email confirmation** — the account exists but cannot sign in until the
  emailed link is opened, so a spam signup is an inert row.
- **Continue with Google** via `signInWithOAuth()`, PKCE flow.

`auth-callback.html` catches both the confirmation link and the Google return,
waits for supabase-js to exchange the code for a session, then forwards to
`?next=` — validated against `^[a-z0-9-]+\.html$` so it can only ever be a page
on this site. Expired links and a declined Google consent screen each get their
own explanation rather than a spinner that never resolves.

**Email confirmation is not optional if Google is enabled.** Supabase links
identities that share an email address, and only drops *unconfirmed* ones when
it does. With confirmation off, someone could register `you@gmail.com` with a
password of their choosing, wait for you to "Continue with Google", and keep a
working password on your account — a pre-account-takeover. Confirmation is what
closes that.

**Required setup — none of it is code:**

1. **SMTP** — Project Settings → Authentication → SMTP. Without it Supabase's
   shared sender is rate-limited to a handful an hour and may only reach project
   members, so confirmation mail will not arrive for real customers.
2. **Google provider** — Authentication → Sign In / Providers → Google. Needs a
   Client ID and Secret from Google Cloud Console, with
   `https://vmoymtsfsfurmceycmep.supabase.co/auth/v1/callback` as the authorised
   redirect URI **on Google's side**.
3. **Redirect allowlist** — Authentication → URL Configuration. Site URL set to
   the deployed origin, and `https://<your-domain>/auth-callback.html` plus
   `https://<your-domain>/reset.html` under Redirect URLs. Supabase refuses to
   redirect anywhere unlisted, so both flows fail silently without this.
4. **"Allow new users to sign up" must be ON.** This reverses earlier advice in
   this file's history: it was correct to disable it while signup ran through a
   throttled edge function, because the built-in endpoint was then a bypass. It
   is now the signup path, protected by Supabase's own rate limits and by
   confirmation.

The old `signup` edge function is retired — it created pre-confirmed accounts
through the admin API, which would now be a confirmation bypass. Its slug still
answers, with 410.

### Password recovery

`auth.html` offers "Forgot your password?", which calls
`resetPasswordForEmail` and mails a link to `reset.html`. That page turns the
recovery token into a session, takes the new password and calls `updateUser`.
It answers identically whether or not the address is registered, so it cannot
be used to discover who has an account.

**It needs two things configured to actually deliver mail:**

1. **SMTP** — Project Settings → Authentication → SMTP Settings. Without it,
   Supabase's shared sender is rate-limited to a handful an hour and may only
   reach project members, which is fine for you and useless for customers.
2. **Redirect allowlist** — Authentication → URL Configuration → add
   `https://<your-domain>/reset.html` under Redirect URLs, and set Site URL to
   the deployed origin. Supabase refuses to redirect anywhere unlisted, so the
   link silently fails without this.

### Known gap: the supabase-js script is not pinned

Every page loads `@supabase/supabase-js@2` from jsDelivr — a floating major
version, with no Subresource Integrity hash. That script handles the auth
session, so a bad build served from the CDN would run with full access to it.
The fix is to pin an exact version and add an SRI hash:

```bash
V=2.58.0   # check the real latest first
curl -s https://cdn.jsdelivr.net/npm/@supabase/supabase-js@$V/dist/umd/supabase.min.js \
  | openssl dgst -sha384 -binary | openssl base64 -A
```

Then in every page: `<script src="...@$V/..." integrity="sha384-<hash>" crossorigin="anonymous" defer>`.
Not done here because this environment's egress policy blocks the CDN, so the
version and hash could not be verified — and a wrong SRI hash blocks the script
and takes the whole site down.

### Two knobs worth setting before launch

- **`ALLOWED_ORIGINS`** on the `signup` function — a comma-separated origin
  list. Unset means any origin, which is the historical behaviour. CORS only
  binds browsers, so this is hardening on top of the throttle, not a substitute
  for it.
- **Leaked-password protection** — Authentication → Passwords in the Supabase
  dashboard. It is the one advisor warning that cannot be fixed from a
  migration.

`signup` creates accounts with `email_confirm: true` because the project has no
SMTP configured. That is a deliberate trade — it also means an address is never
proven to belong to the person signing up. Configure SMTP and move to the normal
confirmation flow before treating an email address as verified.

## Admin portal (Phase 1)

Three tabs at `/admin.html`, all staff-gated:

- **Today** — the order pipeline, cut list and queue (unchanged).
- **Catalogue & stock** — stock levels with low-stock highlighting, one-tap
  restock/wastage, per-fruit cost and computed margin, and category management.
- **Finance** — revenue, COGS, gross margin and cash still to collect over 30
  days, a daily revenue chart, payment split, and the list of boxes the
  nightly run could not make.

Two caveats worth knowing:

- **COGS is computed at query time** from the *current* cost price, not the
  cost frozen at order time. Fine while ingredient costs move slowly; if they
  start moving fast, snapshot `cost_price_paise` onto `order_items` and sum
  that instead.
- The seeded cost prices are a **placeholder 55% of sell price**. Replace them
  with real supplier costs on the Catalogue tab or the margin numbers are
  fiction.

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

### Vercel (recommended)

Import this repository at [vercel.com/new](https://vercel.com/new). Everything
it needs is committed, so accept the defaults — Framework Preset **Other**, and
leave Build Command, Output Directory and Install Command untouched:

- `package.json` exposes `build`, which runs `build.sh`
- `build.sh` assembles the deployable tree into `public/`, deliberately leaving
  out `supabase/` so the SQL migrations are never served from the CDN
- `vercel.json` turns on clean URLs and sets the response headers (HSTS, CSP,
  `nosniff`, referrer and permissions policies, and per-type `Cache-Control`)

Every push to `main` then redeploys on its own.

`build.sh` also works when it is deployed on its own, without the rest of the
repository: with no `index.html` beside it, it fetches `main` from this
repository instead. That is only a bootstrap for deploying without a git link —
a real Vercel project should be linked to the repo so pushes deploy themselves.

### Anywhere else

**Netlify** (build `npm run build`, publish `public`) or **GitHub Pages**
(Settings → Pages → `main` / root — serve the repo as-is; it needs no build,
though `supabase/` will then be publicly readable).

The CSP in `vercel.json` names the four hosts the site talks to — jsDelivr for
`supabase-js`, Google Fonts, and the Supabase project. Update `connect-src`
when you point `js/config.js` at a different Supabase project.

## What's next

Payments are modelled (`payment_method`, `payment_status`, COD flips to paid
on delivery) but no gateway is wired — add a UPI-mandate/Razorpay webhook that
updates `orders.payment_status`. Live rider GPS, push notifications and
procurement/inventory tables are the next backend slices; the ops dashboard
already has the shape for them.

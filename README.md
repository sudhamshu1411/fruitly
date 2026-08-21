# Fruitly 🥭

**Freshly peeled fruits at your doorstep. Fresh Fruit. Zero Hassle.**

Fruitly isn't a fruit-selling website — it's a **freshness subscription platform**.
The customer shouldn't think *"I need to buy fruits."* They should think
*"My Fruitly is coming today."*

This repository is the production front end: a fast, dependency-free static site
built directly on the Fruitly Brand System v3.

## Pages

| Page | Purpose |
|---|---|
| `index.html` | Home — hero, what's fresh today, boxes, subscription CTA |
| `shop.html` | Shop — fruit boxes, individual fruits, seasonal specials (tabbed) |
| `build.html` | Build your box — fruits, quantity, cutting style, exclusions, delivery days (fully interactive) |
| `plans.html` | Subscriptions — current plan, upcoming deliveries, skip / pause / change days |
| `orders.html` | Orders — kitchen-to-door tracking timeline, map, previous deliveries + ratings |
| `account.html` | Account — address, payments, preferences, subscription |
| `admin.html` | Ops dashboard — today's orders, prep pipeline, fruits required, routes, low stock (`noindex`, sample data) |
| `404.html` | Not-found page |

## Stack

- **No build step, no dependencies.** Semantic HTML + one stylesheet (`css/fruitly.css`,
  design tokens from Brand System v3) + a few small vanilla-JS modules (`js/`).
- **Interactive box builder** — selections, quantities, cutting style and delivery days
  compute totals client-side and persist in `localStorage` (`fruitly.box.v1`), shared
  between Shop and Build via the nav badge.
- **Responsive** — desktop, tablet and phone layouts; reduced-motion respected.
- Google Fonts: Archivo (variable width), Instrument Sans, Instrument Serif.

## Run locally

Any static server works:

```bash
npx http-server .        # or: python3 -m http.server
```

## Deploy

The site is host-agnostic static files:

- **Vercel** — `npx vercel` from the repo root (zero config).
- **Netlify** — drag the folder in, or connect the repo (no build command, publish dir `/`).
- **GitHub Pages** — Settings → Pages → deploy from `main` / root.

## What's intentionally not here yet

This is the front-end release. Checkout, payments, live tracking, auth and the ops
backend are stubbed behind an in-page notice (`data-checkout` buttons) — wire them to
your API by replacing those handlers in `js/fruitly.js`. Prices, dates and stock
numbers are sample data. Photo slots use brand-styled placeholder art until macro
fruit photography is shot.

## Design source

Brand + product design live on the Fruitly Product System canvas (Claude Design):
brand system v3, product architecture, all app screens, the operations loop and the
admin dashboard.

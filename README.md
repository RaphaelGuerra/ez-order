# EZ-Order (Push Notification Mode)

Last updated: 2026-02-17

## Table of Contents

<!-- TOC start -->
- [How It Works](#how-it-works)
- [Workspace Layout](#workspace-layout)
- [Quick Start](#quick-start)
- [Build](#build)
- [Runtime Catalog (Phase 1)](#runtime-catalog-phase-1)
  - [Non-Developer Update Flow](#non-developer-update-flow)
  - [Validation](#validation)
- [Runtime Catalog (Phase 2: Localized Content)](#runtime-catalog-phase-2-localized-content)
  - [What this changes operationally](#what-this-changes-operationally)
  - [Required locale keys in catalog](#required-locale-keys-in-catalog)
- [Web Routes](#web-routes)
- [Seeded Table Setup](#seeded-table-setup)
  - [Manual Table Codes](#manual-table-codes)
  - [Area Distribution](#area-distribution)
  - [Legacy/Special Spots Kept](#legacyspecial-spots-kept)
- [Notes](#notes)
<!-- TOC end -->

Mobile-first QR ordering flow where the waiter is alerted via Pushover push notifications.

## How It Works
1. Guest scans QR on table (opens `/g/:locationToken`) or enters table number on `/`.
2. Guest browses menu and builds cart.
3. Guest taps **Send order**.
4. A Cloudflare Pages Function sends an emergency push notification to the waiter's device via Pushover (repeats every 30 s until acknowledged).
5. Cart is cleared automatically on success, and the guest sees a confirmation screen.
6. Waiter acknowledges the notification and attends the table.

## Workspace Layout
- `apps/web`: React + Vite guest app (QR/manual table -> menu -> cart -> push notification).
- `apps/web/public/catalog/order-config.json`: runtime catalog (locations, menu, pricing) editable without touching app code.
- `apps/web/src/config/order-config.json`: bundled fallback catalog used only if runtime catalog fails to load.
- `functions/api/notify.ts`: Cloudflare Pages Function that calls the Pushover API.

## Quick Start
1. Install dependencies:
   ```bash
   npm install
   ```
2. Configure:
   - Copy `apps/web/.env.example` to `apps/web/.env`
   - Optional: set `VITE_DISPLAY_CURRENCY` (ISO-4217 like `BRL`, `USD`, `EUR`; default is `BRL`)
   - Optional: set `VITE_MENU_CONFIG_URL` (defaults to `/catalog/order-config.json`)
   - Optional: set `VITE_MENU_CONFIG_TIMEOUT_MS` (catalog fetch timeout in milliseconds, default `4500`)
   - Set Pushover secrets in Cloudflare Pages dashboard (Settings -> Environment variables):
     - `PUSHOVER_APP_TOKEN` — your Pushover application token
     - `PUSHOVER_USER_KEY` — user key or delivery group key for the waiter device(s)
   - Optional hardening env vars in Cloudflare Pages:
     - `ALLOWED_ORIGINS` — comma-separated origin allowlist for `/api/notify` (defaults to same origin only)
     - `NOTIFY_RATE_LIMIT_PER_MINUTE` — per-IP notify request limit (default: `8`)
     - `PUSHOVER_TIMEOUT_MS` — outbound timeout to Pushover (default: `8000`)
     - `NOTIFY_AUTH_TTL_SECONDS` — signed auth token TTL for notify requests (default: `600`)
     - `NOTIFY_SIGNING_SECRET` — optional explicit signing secret for notify auth tokens (if omitted, derives from Pushover secrets)
     - `NOTIFY_ALLOWED_LOCATION_TOKENS` — optional comma-separated allowlist of valid location tokens. If omitted, `/api/notify` validates against `/catalog/order-config.json`.
3. Start app:
   ```bash
   npm run dev
   ```
   For local end-to-end testing with the notify function, also run:
   ```bash
   npx wrangler pages dev apps/web/dist
   ```
4. Open:
   - Web: `http://localhost:5173`

## Build
```bash
npm run build
```

The root `build` command already runs:
1. `npm run catalog:validate`
2. `npm run catalog:sync`
3. web build (`@ez-order/web`)

## Runtime Catalog (Phase 1)
This repo now supports runtime menu updates with a standalone JSON catalog.
Detailed phase plan: `docs/phase1-runtime-catalog-plan.md`.

- App load order:
  1. Tries to fetch `VITE_MENU_CONFIG_URL` (or `/catalog/order-config.json` by default).
  2. Validates basic catalog shape.
  3. If fetch/validation fails, falls back to bundled `apps/web/src/config/order-config.json`.
- This lets you update menu items, prices, availability, and images by editing a single JSON file.

### Non-Developer Update Flow
1. Edit `apps/web/public/catalog/order-config.json`.
2. Run `npm run catalog:validate`.
3. Run `npm run catalog:sync` (updates bundled fallback automatically).
4. If validation passes, run `npm run build`.
   - Or just run `npm run build` directly (it already validates and syncs).
5. Deploy.

### Validation
- Command: `npm run catalog:validate`
- Checks include:
  - schema shape (`locations`, `menu`, `pricing`)
  - duplicate IDs/tokens/manual codes
  - broken category/group references
  - invalid prices/bounds
  - malformed image URLs

## Runtime Catalog (Phase 2: Localized Content)
Menu content now supports multilingual fields inside the catalog itself.

- `menu.categories[].nameI18n`
- `menu.modifierGroups[].nameI18n`
- `menu.modifierOptions[].nameI18n`
- `menu.items[].nameI18n`
- `menu.items[].descriptionI18n`

The app resolves these fields using the active locale (`en`, `pt-BR`, `fr`, `es`), with fallback behavior if needed.

### What this changes operationally
- To add/edit menu item names/descriptions in all languages, update only `apps/web/public/catalog/order-config.json`.
- No need to touch `apps/web/src/locales/*.json` for menu content updates.
- Locale files remain responsible for static interface strings (buttons, labels, errors, etc.).

### Required locale keys in catalog
`npm run catalog:validate` now enforces that each `nameI18n`/`descriptionI18n` block includes all supported locales:
- `en`
- `pt-BR`
- `fr`
- `es`

## Web Routes
- `/` manual table number fallback
- `/g/:locationToken` location confirmation
- `/g/:locationToken/menu` menu
- `/g/:locationToken/cart` cart + send order
- `/g/:locationToken/sent` order confirmation

## Seeded Table Setup
### Manual Table Codes
- `1` to `100` are now seeded and available.

### Area Distribution
- `1` to `20`: `Pool North`
- `21` to `40`: `Pool East`
- `41` to `60`: `Pool South`
- `63` to `80`: `Pool West`
- `81` to `100`: `Infinity Deck`
- `61` and `62`: `Restaurant Terrace` (special mapped spots)

### Legacy/Special Spots Kept
- `17`, `18`, `19`: Pool East cabanas (`C17`, `C18`, `C19`)
- `42`, `43`, `44`: Pool North umbrellas (`U42`, `U43`, `U44`)
- `51`, `52`: Infinity deck daybeds (`D51`, `D52`)
- `61`, `62`: Restaurant terrace tables (`T61`, `T62`)

## Notes
- Order is sent server-side via Pushover — no manual step required from the guest.
- `POST /api/notify` now requires a short-lived signed auth token issued by `GET /api/notify?locationToken=...`.
- Auth tokens are single-use and bound to a short-lived server session cookie + client fingerprint to reduce replay/spoofing.
- The cart is cleared automatically when the notification is confirmed sent.
- Allergy/notes text is included in the push notification message but not persisted locally.
- Pushover credentials are server-side only (never exposed to the browser).
- Waiter push notifications are always generated in Portuguese (pt-BR) for operational consistency.
- `/api/notify` enforces origin checks (allowlist), request validation, per-IP rate limiting, and timeout protection.
- `/api/notify` validates `locationToken` against an allowlist (`NOTIFY_ALLOWED_LOCATION_TOKENS` or runtime catalog) before issuing/sending notifications.
- Multilingual guest UI is built in (`English`, `Português (Brasil)`, `Français`, `Español`).
- Language defaults to `Português (Brasil)`, can be changed from the top selector on each screen, and is saved in browser storage.
- Runtime catalog loading is non-blocking: the app starts with bundled fallback and applies runtime catalog when it arrives.
- `apps/web/src/config/order-config.json` should be treated as generated fallback data (synced from `apps/web/public/catalog/order-config.json`).
- Translation dictionaries live at:
  - `apps/web/src/locales/en.json`
  - `apps/web/src/locales/pt-BR.json`
  - `apps/web/src/locales/fr.json`
  - `apps/web/src/locales/es.json`

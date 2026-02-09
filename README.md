# EZ-Order (Push Notification Mode)

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
- `apps/web/src/config/order-config.json`: single source of truth for locations, table codes, menu, and pricing.
- `functions/api/notify.ts`: Cloudflare Pages Function that calls the Pushover API.

## Quick Start
1. Install dependencies:
   ```bash
   npm install
   ```
2. Configure:
   - Copy `apps/web/.env.example` to `apps/web/.env`
   - Optional: set `VITE_DISPLAY_CURRENCY` (ISO-4217 like `BRL`, `USD`, `EUR`; default is `BRL`)
   - Set Pushover secrets in Cloudflare Pages dashboard (Settings -> Environment variables):
     - `PUSHOVER_APP_TOKEN` — your Pushover application token
     - `PUSHOVER_USER_KEY` — user key or delivery group key for the waiter device(s)
   - Optional hardening env vars in Cloudflare Pages:
     - `ALLOWED_ORIGINS` — comma-separated origin allowlist for `/api/notify` (defaults to same origin only)
     - `NOTIFY_RATE_LIMIT_PER_MINUTE` — per-IP notify request limit (default: `8`)
     - `PUSHOVER_TIMEOUT_MS` — outbound timeout to Pushover (default: `8000`)
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

## Web Routes
- `/` manual table number fallback
- `/g/:locationToken` location confirmation
- `/g/:locationToken/menu` menu
- `/g/:locationToken/cart` cart + send order
- `/g/:locationToken/sent` order confirmation

## Seeded Table Setup
### QR Tokens
- `pool-north-u42`
- `pool-east-c17`

### Manual Table Codes
- `42`
- `17`

## Notes
- Order is sent server-side via Pushover — no manual step required from the guest.
- The cart is cleared automatically when the notification is confirmed sent.
- Allergy/notes text is included in the push notification message but not persisted locally.
- Pushover credentials are server-side only (never exposed to the browser).
- `/api/notify` enforces origin checks (allowlist), request validation, per-IP rate limiting, and timeout protection.
- Multilingual guest UI is built in (`English`, `Português (Brasil)`, `Français`, `Español`).
- Language auto-detects from browser and can be changed from the top selector on each screen.
- Translation dictionaries live at:
  - `apps/web/src/locales/en.json`
  - `apps/web/src/locales/pt-BR.json`
  - `apps/web/src/locales/fr.json`
  - `apps/web/src/locales/es.json`

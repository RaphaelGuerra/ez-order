# EZ-Order (WhatsApp Alert Mode)

Mobile-first, client-only QR ordering flow where the waiter is alerted via WhatsApp.

## How It Works
1. Guest scans QR on table (opens `/g/:locationToken`) or enters table number on `/`.
2. Guest browses menu and builds cart.
3. Guest taps **Send to waiter on WhatsApp**.
4. A prefilled WhatsApp message opens to the waiter device number.
5. Guest confirms with **I sent it** in the app, then cart is cleared.
6. Waiter takes over manually from WhatsApp alert.

No backend server is required in this mode.

## Workspace Layout
- `apps/web`: React + Vite guest app (QR/manual table -> menu -> cart -> WhatsApp alert).
- `apps/web/src/config/order-config.json`: single source of truth for locations, table codes, menu, and pricing.
- `docs/01-prd.md`: product requirements for client-only WhatsApp mode.
- `docs/02-ui-spec.md`: UI/routes/state spec for the implemented guest flow.

## Quick Start
1. Install dependencies:
   ```bash
   npm install
   ```
2. Configure waiter number:
   - Copy `apps/web/.env.example` to `apps/web/.env`
   - Set `VITE_WAITER_WHATSAPP_NUMBER` to waiter device number (international format, digits only)
   - Optional: set `VITE_DISPLAY_CURRENCY` (ISO-4217 like `USD`, `BRL`, `EUR`)
3. Start app:
   ```bash
   npm run dev
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
- `/g/:locationToken/cart` cart + WhatsApp trigger
- `/g/:locationToken/sent` post-trigger confirmation

## Seeded Table Setup
### QR Tokens
- `pool-north-u42`
- `pool-east-c17`

### Manual Table Codes
- `42`
- `17`

## Notes
- Browser cannot send WhatsApp silently. The guest must confirm/send inside WhatsApp.
- The cart is only cleared after guest taps **I sent it**.
- Allergy/notes text is not persisted in local storage for privacy.
- If WhatsApp number is missing/invalid, send is blocked with a config error.
- Multilingual guest UI is built in (`English`, `Português (Brasil)`, `Français`, `Español`).
- Language auto-detects from browser and can be changed from the top selector on each screen.
- Translation dictionaries live at:
  - `apps/web/src/locales/en.json`
  - `apps/web/src/locales/pt-BR.json`
  - `apps/web/src/locales/fr.json`
  - `apps/web/src/locales/es.json`

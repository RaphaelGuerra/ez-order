# EZ-Order UI Spec (Push Notification Mode)

## 1. App Model
- Platform: mobile-first web app (React + Vite).
- Backend: Cloudflare Pages Function (`functions/api/notify.ts`) sends push notifications via Pushover.
- Routing: browser routes with table token context.
- Persistence:
  - Cart persisted in localStorage per location token.
  - Language preference persisted in localStorage.
  - Notes/allergy text included in notification but not persisted locally.

## 2. Routes
| Route | Purpose |
|---|---|
| `/` | Landing page with QR-first guidance and manual table fallback |
| `/g/:locationToken` | Location confirmation |
| `/g/:locationToken/menu` | Menu browsing + item configuration |
| `/g/:locationToken/cart` | Cart review + send order |
| `/g/:locationToken/sent` | Order confirmation |

## 3. Screen-by-Screen

### `/`
- Header with language selector.
- QR-first instruction block.
- Manual table entry form.
- Invalid table code error state.

### `/g/:locationToken`
- Shows zone + spot label.
- CTA: continue with this table.
- Secondary CTA: choose another table.
- Invalid token fallback to start.

### `/g/:locationToken/menu`
- Category tabs.
- Item cards with availability and base price.
- Item configuration sheet for required modifiers.
- Sticky footer cart CTA with count.

### `/g/:locationToken/cart`
- Line items with remove action.
- Order notes + allergy notes textareas.
- Totals (subtotal, tax, service fee, estimate total).
- CTA: send order (async, with loading state).
- Validation errors:
  - empty cart
  - send failed (network/server error)

### `/g/:locationToken/sent`
- Confirms table context.
- Shows sent-at timestamp.
- Instructions that waiter has been notified.
- CTA: done (returns to start).
- Secondary CTA: order more (returns to menu).

## 4. Notification Message Contract
Message sent to Pushover includes:
- Header
- Table, zone, code, timestamp
- Item list with quantities and selected modifiers
- Monetary summary
- Optional order notes and allergy notes
- Final confirmation line for waiter

Pushover settings:
- Priority 2 (emergency): repeats every 30 seconds until acknowledged.
- Expires after 10 minutes.
- Persistent alarm sound.

## 5. Localization
Supported locales:
- `en`
- `pt-BR`
- `fr`
- `es`

Rules:
- Auto-detect from browser language on first load.
- Persist selected locale in localStorage.
- Allow runtime switching via header selector.
- Translation fallback chain: selected locale -> English -> inline fallback string.

## 6. Config + Theming
- Menu/location/pricing values come from `apps/web/src/config/order-config.json`.
- UI currency controlled by `VITE_DISPLAY_CURRENCY` (default `USD`).
- Pushover credentials (`PUSHOVER_APP_TOKEN`, `PUSHOVER_USER_KEY`) set as environment variables in Cloudflare Pages dashboard.

## 7. Accessibility and Mobile Usability
- 48px minimum touch-friendly button heights.
- High contrast typography and controls for bright outdoor usage.
- Sticky cart CTA for one-handed access.
- Large, readable status/error messages.
- Reduced motion support via CSS media query.

## 8. State Summary
```text
start
  -> location_confirmed
    -> menu_browsing
      -> cart_review
        -> order_sent
          -> confirmation
            -> reset_to_start / order_more
```

## 9. Frontend File Map
- App logic: `apps/web/src/App.tsx`
- Styles: `apps/web/src/index.css`
- Config data: `apps/web/src/config/order-config.json`
- Locale dictionaries: `apps/web/src/locales/*.json`
- Notify function: `functions/api/notify.ts`

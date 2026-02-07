# EZ-Order UI Spec (Client-Only)

## 1. App Model
- Platform: mobile-first web app (React + Vite).
- Backend/API: none.
- Routing: browser routes with table token context.
- Persistence:
  - Cart persisted in localStorage per location token.
  - Language preference persisted in localStorage.
  - Notes/allergy text intentionally not persisted after sent flow.

## 2. Routes
| Route | Purpose |
|---|---|
| `/` | Landing page with QR-first guidance and manual table fallback |
| `/g/:locationToken` | Location confirmation |
| `/g/:locationToken/menu` | Menu browsing + item configuration |
| `/g/:locationToken/cart` | Cart review + WhatsApp trigger |
| `/g/:locationToken/sent` | Post-trigger confirmation and resend helper |

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
- CTA: send to waiter on WhatsApp.
- Validation errors:
  - empty cart
  - invalid/missing waiter number

### `/g/:locationToken/sent`
- Confirms table context.
- Shows generated message preview.
- CTA: open WhatsApp again.
- CTA: "I sent it" (clears cart and returns start).
- Warning if page is reopened and notes are unavailable.

## 4. WhatsApp Message Contract
Message includes:
- Header
- Table, zone, code, timestamp
- Item list with quantities and selected modifiers
- Monetary summary
- Optional order notes and allergy notes
- Final confirmation line for waiter

Transport behavior:
- Uses `https://wa.me/<number>?text=<encodedMessage>`.
- Opens a new tab/window when possible.
- Falls back to current tab redirect if popup blocked.

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
- Waiter destination controlled by `VITE_WAITER_WHATSAPP_NUMBER`.

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
        -> whatsapp_opened
          -> sent_confirmation
            -> reset_to_start
```

## 9. Frontend File Map
- App logic: `apps/web/src/App.tsx`
- Styles: `apps/web/src/index.css`
- Config data: `apps/web/src/config/order-config.json`
- Locale dictionaries: `apps/web/src/locales/*.json`

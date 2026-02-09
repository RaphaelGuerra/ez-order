# EZ-Order PRD (Push Notification Mode)

## 1. Problem Statement
Pool guests wait too long to place orders because the bar is far and waiter capture is manual. The app should remove the first friction step: getting the waiter's attention with a structured order request.

## 2. Product Goal
Enable guests to place a quick order request in under 60 seconds from their phone browser, then notify waiter operations through a Pushover push notification.

## 3. Scope
- Guest-facing web app (React + Vite).
- Cloudflare Pages Function sends push notifications to waiter device(s) via Pushover.
- Table/spot context via QR deep link or manual table code input.
- Menu browsing and cart.
- Notes/allergy notes.
- Emergency-priority notification (repeats until acknowledged).
- Multilingual UX: English, Portuguese (Brazil), French, Spanish.

## 4. Out of Scope
- POS/KDS integration.
- Live order tracking and order lifecycle states.
- In-app payments.
- Staff/admin dashboards.

## 5. Personas
| Persona | Need | Success |
|---|---|---|
| Guest | Order without waiting for a waiter to arrive | Can send a request quickly and clearly |
| Waiter | Be alerted with enough detail to take over manually | Receives readable push notification with table, items, and notes |
| Operator/Admin | Keep setup simple and reliable | Can configure menu, table mapping, and Pushover credentials with low effort |

## 6. Primary Flow
1. Guest scans table QR (preferred) or opens page and enters table code.
2. Guest confirms detected location.
3. Guest browses menu and adds items/modifiers.
4. Guest reviews cart, optional notes/allergy notes.
5. Guest taps **Send order**.
6. App sends notification to waiter device via server-side Pushover call.
7. Cart is cleared automatically and guest sees confirmation.

## 7. Edge Cases
- Invalid table code or QR token.
- Empty cart on send attempt.
- Network failure or server error when sending notification.
- Weak connectivity (retry guidance shown to guest).

## 8. Success Metrics
- P50 time-to-send request <= 60s.
- Cart-to-notification send completion rate.
- Invalid table entry rate.
- Send failure rate (network/server errors).

## 9. Operating Model
- Waiter receives push notification and handles fulfillment manually.
- Emergency priority ensures the notification repeats every 30 seconds until acknowledged.
- Final service workflow remains human/manual outside the app.
- Menu and location updates are managed via static config file changes.

## 10. Configuration Sources
- Guest/menu/locations/pricing: `apps/web/src/config/order-config.json`
- Display currency: `apps/web/.env` (`VITE_DISPLAY_CURRENCY`)
- Pushover credentials: Cloudflare Pages dashboard environment variables (`PUSHOVER_APP_TOKEN`, `PUSHOVER_USER_KEY`)
- UI translations:
  - `apps/web/src/locales/en.json`
  - `apps/web/src/locales/pt-BR.json`
  - `apps/web/src/locales/fr.json`
  - `apps/web/src/locales/es.json`

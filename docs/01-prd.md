# EZ-Order Client-Only PRD (WhatsApp Alert)

## 1. Problem Statement
Pool guests wait too long to place orders because the bar is far and waiter capture is manual. The app should remove the first friction step: getting the waiter’s attention with a structured order request.

## 2. Product Goal
Enable guests to place a quick order request in under 60 seconds from their phone browser, then notify waiter operations through WhatsApp.

## 3. Scope
- Guest-facing web app only (no backend server required).
- Table/spot context via QR deep link or manual table code input.
- Menu browsing and cart.
- Notes/allergy notes.
- WhatsApp prefilled message sent to a configured waiter number.
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
| Waiter | Be alerted with enough detail to take over manually | Receives readable WhatsApp request with table, items, and notes |
| Operator/Admin | Keep setup simple and reliable | Can configure menu, table mapping, and waiter number with low effort |

## 6. Primary Flow
1. Guest scans table QR (preferred) or opens page and enters table code.
2. Guest confirms detected location.
3. Guest browses menu and adds items/modifiers.
4. Guest reviews cart, optional notes/allergy notes.
5. Guest taps send.
6. App opens WhatsApp with prefilled message to waiter number.
7. Guest taps "I sent it" to clear cart and finish.

## 7. Edge Cases
- Invalid table code or QR token.
- Empty cart on send attempt.
- Missing/invalid waiter WhatsApp number.
- User reopens sent page (notes/allergy text is not persisted by design).
- Weak connectivity opening WhatsApp URL.

## 8. Success Metrics
- P50 time-to-send request <= 60s.
- Cart-to-WhatsApp send completion rate.
- Invalid table entry rate.
- Send failures due to config issues (invalid waiter number).

## 9. Operating Model
- Waiter receives request in WhatsApp and handles fulfillment manually.
- Final service workflow remains human/manual outside the app.
- Menu and location updates are managed via static config file changes.

## 10. Configuration Sources
- Guest/menu/locations/pricing: `apps/web/src/config/order-config.json`
- Waiter number + currency: `apps/web/.env`
- UI translations:
  - `apps/web/src/locales/en.json`
  - `apps/web/src/locales/pt-BR.json`
  - `apps/web/src/locales/fr.json`
  - `apps/web/src/locales/es.json`

# Phase 1 Technical Plan: Runtime Catalog for Easy Menu Maintenance

## Goal
Allow business/content operations to update menu content (items, prices, availability, images, table mapping) without changing React code.

## Scope (Phase 1)
- Runtime catalog loading from a JSON endpoint/file.
- Safe fallback to bundled config if runtime catalog fails.
- Catalog validation command for pre-deploy checks.
- Operational documentation for non-developer updates.

## Non-Goals (Phase 1)
- Full admin CMS UI.
- Role-based editing in-app.
- Automatic spreadsheet sync.
- Historical version browser UI.

## Architecture
### 1. Catalog Source
- Default runtime source: `/catalog/order-config.json`
- Optional override via `VITE_MENU_CONFIG_URL`
- Bundled fallback: `apps/web/src/config/order-config.json`

### 2. Startup Flow
1. App boot requests runtime catalog.
2. Basic schema validation runs client-side.
3. If valid: runtime data is applied.
4. If invalid/unreachable: app logs warning and uses bundled fallback.

### 3. Data Contract (Current)
- `locations[]`: table/spot mapping and manual codes.
- `menu.categories[]`
- `menu.modifierGroups[]`
- `menu.modifierOptions[]`
- `menu.items[]`
- `pricing.taxRate`, `pricing.serviceFeeRate`

### 4. Integrity Gate
- CLI validator: `npm run catalog:validate`
- Checks:
  - schema structure
  - duplicate IDs
  - duplicate/colliding manual codes
  - broken references (category/group)
  - invalid bounds and prices
  - malformed image URLs

## Operational Workflow
1. Edit `apps/web/public/catalog/order-config.json`.
2. Run `npm run catalog:validate`.
3. Run `npm run build`.
4. Deploy to Cloudflare Pages.

## Risks and Mitigations
- Risk: broken JSON blocks runtime catalog.
  - Mitigation: validator + bundled fallback.
- Risk: content edits break cross-references.
  - Mitigation: relational checks in validator.
- Risk: image link rot.
  - Mitigation: URL checks in validator; recommend managed asset storage.

## Phase 2 (Recommended Next)
- Move menu names/descriptions to catalog-localized fields (single source for i18n content).
- Add catalog versioning (`version`, `publishedAt`, `publishedBy`).
- Add publish pipeline (staging -> production).
- Add no-code editor layer (Airtable/Sheet + sync job) with approval flow.

## Status Update
- Phase 2 localization in catalog has been implemented.
- See `docs/phase2-localized-catalog.md` for current operational model.

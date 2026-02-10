# Phase 2: Localized Catalog Content

## Objective
Make menu maintenance independent from application locale files by storing menu text directly in the catalog.

## Implemented
- Runtime catalog now carries multilingual menu text through:
  - `nameI18n` on categories/modifier groups/modifier options/items
  - `descriptionI18n` on items
- App rendering prefers catalog-localized text based on active locale.
- Existing locale JSON files are now focused on static UI copy.
- Catalog validator enforces complete locale coverage (`en`, `pt-BR`, `fr`, `es`) for all multilingual menu fields.

## Data Example
```json
{
  "id": "item_club_sandwich",
  "categoryId": "cat_quick_bites",
  "basePriceCents": 2800,
  "available": true,
  "modifierGroupIds": ["mg_sandwich_bread", "mg_addons", "mg_side"],
  "imageUrl": "https://...",
  "nameI18n": {
    "en": "Club Sandwich",
    "pt-BR": "Club Sandwich",
    "fr": "Club sandwich",
    "es": "Club sándwich"
  },
  "descriptionI18n": {
    "en": "Grilled chicken, bacon and lettuce",
    "pt-BR": "Frango grelhado, bacon e alface",
    "fr": "Poulet grillé, bacon et laitue",
    "es": "Pollo a la plancha, tocino y lechuga"
  }
}
```

## Update Workflow
1. Edit `apps/web/public/catalog/order-config.json`.
2. Run `npm run catalog:validate`.
3. Run `npm run catalog:sync` (or just run `npm run build`, which already syncs).
4. Run `npm run build`.
5. Deploy.

## Notes
- Fallback bundled config (`apps/web/src/config/order-config.json`) is kept for runtime resilience.
- Fallback config is generated from the runtime catalog via `npm run catalog:sync`; avoid manual edits.
- Keep IDs stable (`item_*`, `cat_*`, `mg_*`, `opt_*`) to avoid regressions in existing carts and references.

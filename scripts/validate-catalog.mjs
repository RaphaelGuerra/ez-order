#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const DEFAULT_CATALOG_PATH = "apps/web/public/catalog/order-config.json";
const targetPath = process.argv[2] ?? DEFAULT_CATALOG_PATH;
const resolvedPath = path.resolve(process.cwd(), targetPath);
const SUPPORTED_LOCALES = ["en", "pt-BR", "fr", "es"];

/** @type {string[]} */
const errors = [];
/** @type {string[]} */
const warnings = [];

function addError(message) {
  errors.push(message);
}

function addWarning(message) {
  warnings.push(message);
}

function normalizeManualCode(value) {
  const normalized = String(value ?? "")
    .trim()
    .toUpperCase();

  const pureNumberMatch = /^0*(\d+)$/.exec(normalized);
  if (pureNumberMatch) {
    return String(Number.parseInt(pureNumberMatch[1], 10));
  }

  const prefixedNumberMatch = /^([A-Z]+)0*(\d+)$/.exec(normalized);
  if (prefixedNumberMatch) {
    return `${prefixedNumberMatch[1]}${Number.parseInt(prefixedNumberMatch[2], 10)}`;
  }

  return normalized;
}

function isObjectRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateLocalizedTextMap(value, label, options = {}) {
  const required = options.required === true;

  if (value === undefined) {
    if (required) {
      addError(`${label} is required and must contain ${SUPPORTED_LOCALES.join(", ")}.`);
    }
    return;
  }

  if (!isObjectRecord(value)) {
    addError(`${label} must be an object keyed by locale (${SUPPORTED_LOCALES.join(", ")}).`);
    return;
  }

  for (const key of Object.keys(value)) {
    if (!SUPPORTED_LOCALES.includes(key)) {
      addError(`${label} contains unsupported locale key "${key}".`);
    }
  }

  for (const locale of SUPPORTED_LOCALES) {
    const localizedValue = value[locale];
    if (typeof localizedValue !== "string" || !localizedValue.trim()) {
      addError(`${label}.${locale} must be a non-empty string.`);
    }
  }
}

function loadCatalogJson(filePath) {
  let raw;
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch (error) {
    addError(`Could not read file: ${filePath}`);
    addError(String(error));
    return null;
  }

  try {
    return JSON.parse(raw);
  } catch (error) {
    addError(`Invalid JSON in ${filePath}`);
    addError(String(error));
    return null;
  }
}

function validateCatalogShape(config) {
  if (!isObjectRecord(config)) {
    addError("Catalog root must be an object.");
    return false;
  }

  if (!Array.isArray(config.locations)) {
    addError("`locations` must be an array.");
    return false;
  }

  if (!isObjectRecord(config.menu)) {
    addError("`menu` must be an object.");
    return false;
  }

  if (!Array.isArray(config.menu.categories)) {
    addError("`menu.categories` must be an array.");
    return false;
  }
  if (!Array.isArray(config.menu.modifierGroups)) {
    addError("`menu.modifierGroups` must be an array.");
    return false;
  }
  if (!Array.isArray(config.menu.modifierOptions)) {
    addError("`menu.modifierOptions` must be an array.");
    return false;
  }
  if (!Array.isArray(config.menu.items)) {
    addError("`menu.items` must be an array.");
    return false;
  }

  if (!isObjectRecord(config.pricing)) {
    addError("`pricing` must be an object.");
    return false;
  }
  if (typeof config.pricing.taxRate !== "number") {
    addError("`pricing.taxRate` must be a number.");
  }
  if (typeof config.pricing.serviceFeeRate !== "number") {
    addError("`pricing.serviceFeeRate` must be a number.");
  }

  return true;
}

function validateLocations(locations) {
  const seenIds = new Set();
  const seenTokens = new Set();
  const manualCodeOwner = new Map();

  for (const [index, location] of locations.entries()) {
    const label = `locations[${index}]`;
    if (!isObjectRecord(location)) {
      addError(`${label} must be an object.`);
      continue;
    }

    if (typeof location.id !== "string" || !location.id.trim()) {
      addError(`${label}.id must be a non-empty string.`);
    } else if (seenIds.has(location.id)) {
      addError(`Duplicate location id: ${location.id}`);
    } else {
      seenIds.add(location.id);
    }

    if (typeof location.token !== "string" || !location.token.trim()) {
      addError(`${label}.token must be a non-empty string.`);
    } else if (seenTokens.has(location.token)) {
      addError(`Duplicate location token: ${location.token}`);
    } else {
      seenTokens.add(location.token);
    }

    if (typeof location.zoneName !== "string" || !location.zoneName.trim()) {
      addError(`${label}.zoneName must be a non-empty string.`);
    }
    if (typeof location.spotLabel !== "string" || !location.spotLabel.trim()) {
      addError(`${label}.spotLabel must be a non-empty string.`);
    }
    validateLocalizedTextMap(location.zoneNameI18n, `${label}.zoneNameI18n`, { required: false });
    validateLocalizedTextMap(location.spotLabelI18n, `${label}.spotLabelI18n`, { required: false });

    if (!Array.isArray(location.manualCodes) || location.manualCodes.length === 0) {
      addError(`${label}.manualCodes must be a non-empty array.`);
      continue;
    }

    for (const code of location.manualCodes) {
      if (typeof code !== "string" || !code.trim()) {
        addError(`${label}.manualCodes contains an invalid value.`);
        continue;
      }
      const normalized = normalizeManualCode(code);
      const owner = manualCodeOwner.get(normalized);
      if (owner && owner !== location.id) {
        addError(`Manual code collision (${normalized}) between ${owner} and ${location.id}`);
      } else {
        manualCodeOwner.set(normalized, location.id);
      }
    }
  }
}

function validateMenu(menu) {
  const categoryIds = new Set();
  const groupIds = new Set();
  const optionIds = new Set();
  const itemIds = new Set();
  const optionsByGroup = new Map();

  for (const [index, category] of menu.categories.entries()) {
    const label = `menu.categories[${index}]`;
    if (!isObjectRecord(category)) {
      addError(`${label} must be an object.`);
      continue;
    }
    if (typeof category.id !== "string" || !category.id.trim()) {
      addError(`${label}.id must be a non-empty string.`);
    } else if (categoryIds.has(category.id)) {
      addError(`Duplicate category id: ${category.id}`);
    } else {
      categoryIds.add(category.id);
    }
    if (typeof category.sortOrder !== "number" || !Number.isFinite(category.sortOrder)) {
      addError(`${label}.sortOrder must be a finite number.`);
    }
    validateLocalizedTextMap(category.nameI18n, `${label}.nameI18n`, { required: true });
  }

  for (const [index, group] of menu.modifierGroups.entries()) {
    const label = `menu.modifierGroups[${index}]`;
    if (!isObjectRecord(group)) {
      addError(`${label} must be an object.`);
      continue;
    }
    if (typeof group.id !== "string" || !group.id.trim()) {
      addError(`${label}.id must be a non-empty string.`);
      continue;
    }
    if (groupIds.has(group.id)) {
      addError(`Duplicate modifier group id: ${group.id}`);
      continue;
    }
    groupIds.add(group.id);

    const min = typeof group.minSelect === "number" ? group.minSelect : Number.NaN;
    const max = typeof group.maxSelect === "number" ? group.maxSelect : Number.NaN;
    if (!Number.isFinite(min) || !Number.isFinite(max)) {
      addError(`${label}.minSelect and .maxSelect must be finite numbers.`);
    } else if (min < 0 || max < 0 || max < min) {
      addError(`${label} has invalid bounds (minSelect=${min}, maxSelect=${max}).`);
    }
    validateLocalizedTextMap(group.nameI18n, `${label}.nameI18n`, { required: true });
  }

  for (const [index, option] of menu.modifierOptions.entries()) {
    const label = `menu.modifierOptions[${index}]`;
    if (!isObjectRecord(option)) {
      addError(`${label} must be an object.`);
      continue;
    }
    if (typeof option.id !== "string" || !option.id.trim()) {
      addError(`${label}.id must be a non-empty string.`);
      continue;
    }
    if (optionIds.has(option.id)) {
      addError(`Duplicate modifier option id: ${option.id}`);
      continue;
    }
    optionIds.add(option.id);

    if (typeof option.groupId !== "string" || !groupIds.has(option.groupId)) {
      addError(`${label}.groupId points to a missing modifier group (${String(option.groupId)}).`);
      continue;
    }
    const groupOptions = optionsByGroup.get(option.groupId);
    if (groupOptions) {
      groupOptions.push(option);
    } else {
      optionsByGroup.set(option.groupId, [option]);
    }

    if (typeof option.priceDeltaCents !== "number" || !Number.isFinite(option.priceDeltaCents)) {
      addError(`${label}.priceDeltaCents must be a finite number.`);
    }
    validateLocalizedTextMap(option.nameI18n, `${label}.nameI18n`, { required: true });
  }

  for (const groupId of groupIds) {
    const count = (optionsByGroup.get(groupId) ?? []).length;
    if (count === 0) {
      addError(`Modifier group ${groupId} has no options.`);
    }
  }

  for (const [index, item] of menu.items.entries()) {
    const label = `menu.items[${index}]`;
    if (!isObjectRecord(item)) {
      addError(`${label} must be an object.`);
      continue;
    }

    if (typeof item.id !== "string" || !item.id.trim()) {
      addError(`${label}.id must be a non-empty string.`);
      continue;
    }
    if (itemIds.has(item.id)) {
      addError(`Duplicate item id: ${item.id}`);
      continue;
    }
    itemIds.add(item.id);

    if (typeof item.categoryId !== "string" || !categoryIds.has(item.categoryId)) {
      addError(`${label}.categoryId points to a missing category (${String(item.categoryId)}).`);
    }
    if (typeof item.basePriceCents !== "number" || !Number.isFinite(item.basePriceCents) || item.basePriceCents < 0) {
      addError(`${label}.basePriceCents must be a finite, non-negative number.`);
    }
    if (typeof item.available !== "boolean") {
      addError(`${label}.available must be a boolean.`);
    }
    validateLocalizedTextMap(item.nameI18n, `${label}.nameI18n`, { required: true });
    validateLocalizedTextMap(item.descriptionI18n, `${label}.descriptionI18n`, { required: true });

    if (!Array.isArray(item.modifierGroupIds)) {
      addError(`${label}.modifierGroupIds must be an array.`);
      continue;
    }

    const seenGroupRefs = new Set();
    for (const groupId of item.modifierGroupIds) {
      if (typeof groupId !== "string" || !groupId.trim()) {
        addError(`${label}.modifierGroupIds contains a non-string value.`);
        continue;
      }
      if (!groupIds.has(groupId)) {
        addError(`${label}.modifierGroupIds references missing group ${groupId}.`);
      }
      if (seenGroupRefs.has(groupId)) {
        addError(`${label}.modifierGroupIds has duplicate group ${groupId}.`);
      }
      seenGroupRefs.add(groupId);
    }

    if (typeof item.imageUrl === "string" && item.imageUrl.trim()) {
      try {
        const imageUrl = new URL(item.imageUrl);
        if (!["http:", "https:"].includes(imageUrl.protocol)) {
          addError(`${label}.imageUrl must use http or https (${item.imageUrl}).`);
        }
      } catch {
        addError(`${label}.imageUrl is not a valid URL (${item.imageUrl}).`);
      }
    }
  }

  for (const categoryId of categoryIds) {
    const count = menu.items.filter((item) => item.categoryId === categoryId).length;
    if (count === 0) {
      addWarning(`Category ${categoryId} has no menu items.`);
    }
  }
}

const catalog = loadCatalogJson(resolvedPath);
if (!catalog) {
  process.exit(1);
}

if (validateCatalogShape(catalog)) {
  validateLocations(catalog.locations);
  validateMenu(catalog.menu);
}

console.log(`[catalog] File: ${resolvedPath}`);
if (warnings.length > 0) {
  console.log(`[catalog] Warnings (${warnings.length}):`);
  for (const warning of warnings) {
    console.log(`  - ${warning}`);
  }
}

if (errors.length > 0) {
  console.error(`[catalog] Validation failed with ${errors.length} error(s):`);
  for (const error of errors) {
    console.error(`  - ${error}`);
  }
  process.exit(1);
}

console.log("[catalog] Validation passed.");

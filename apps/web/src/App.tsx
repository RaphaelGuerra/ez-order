import {
  createContext,
  type FormEvent,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Link, Navigate, Route, Routes, useLocation, useNavigate, useParams } from "react-router-dom";
import configData from "./config/order-config.json";
import enLocale from "./locales/en.json";
import esLocale from "./locales/es.json";
import frLocale from "./locales/fr.json";
import ptBrLocale from "./locales/pt-BR.json";

type LocaleCode = "en" | "pt-BR" | "fr" | "es";
type LocaleDictionary = Record<string, string>;
type TranslateVars = Record<string, string | number>;
type TranslateFn = (key: string, fallback: string, vars?: TranslateVars) => string;
type CatalogTextByLocale = Partial<Record<LocaleCode, string>>;

type Location = {
  id: string;
  token: string;
  zoneName: string;
  spotLabel: string;
  manualCodes: string[];
  zoneNameI18n?: CatalogTextByLocale;
  spotLabelI18n?: CatalogTextByLocale;
};

type MenuCategory = { id: string; name: string; sortOrder: number; nameI18n?: CatalogTextByLocale };
type ModifierGroup = {
  id: string;
  name: string;
  minSelect: number;
  maxSelect: number;
  required: boolean;
  nameI18n?: CatalogTextByLocale;
};
type ModifierOption = {
  id: string;
  groupId: string;
  name: string;
  priceDeltaCents: number;
  nameI18n?: CatalogTextByLocale;
};
type MenuItem = {
  id: string;
  categoryId: string;
  name: string;
  description?: string;
  basePriceCents: number;
  available: boolean;
  modifierGroupIds: string[];
  imageUrl?: string;
  nameI18n?: CatalogTextByLocale;
  descriptionI18n?: CatalogTextByLocale;
};

type ModifierSelection = {
  optionId: string;
  quantity: number;
};

type GroupSelectionState = Record<string, number>;
type ConfigSelectionState = Record<string, GroupSelectionState>;

type CartLine = {
  id: string;
  menuItemId: string;
  itemNameSnapshot: string;
  quantity: number;
  unitPriceCents: number;
  lineTotalCents: number;
  notes?: string;
  modifierSelections: ModifierSelection[];
  modifierLabel: string;
};

type ConfigState = {
  item: MenuItem;
  selectedOptionsByGroup: ConfigSelectionState;
  validationError: string | null;
};

type SentPageState = {
  sentAtIso?: string;
};

export type AppConfig = {
  locations: Location[];
  menu: {
    categories: MenuCategory[];
    modifierGroups: ModifierGroup[];
    modifierOptions: ModifierOption[];
    items: MenuItem[];
  };
  pricing: {
    taxRate: number;
    serviceFeeRate: number;
  };
};

type I18nContextValue = {
  locale: LocaleCode;
  setLocale: (locale: LocaleCode) => void;
  t: TranslateFn;
  formatMoney: (cents: number) => string;
  formatDateTime: (date: Date) => string;
};

const DEFAULT_APP_CONFIG: AppConfig = configData;
const FALLBACK_LOCALE: LocaleCode = "pt-BR";
const SUPPORTED_LOCALES: LocaleCode[] = ["en", "pt-BR", "fr", "es"];
const LOCALE_STORAGE_KEY = "ez-order:locale";

const LOCALE_LABEL_KEYS: Record<LocaleCode, string> = {
  en: "ui.language.en",
  "pt-BR": "ui.language.pt-BR",
  fr: "ui.language.fr",
  es: "ui.language.es",
};

const LOCALES: Record<LocaleCode, LocaleDictionary> = {
  en: enLocale,
  "pt-BR": ptBrLocale,
  fr: frLocale,
  es: esLocale,
};

const RAW_DISPLAY_CURRENCY = (import.meta.env.VITE_DISPLAY_CURRENCY ?? "BRL").trim().toUpperCase();
const DISPLAY_CURRENCY = /^[A-Z]{3}$/.test(RAW_DISPLAY_CURRENCY) ? RAW_DISPLAY_CURRENCY : "BRL";

let APP_CONFIG: AppConfig = DEFAULT_APP_CONFIG;
let LOCATIONS: Location[] = [];
let MENU_CATEGORIES: MenuCategory[] = [];
let MODIFIER_GROUPS: ModifierGroup[] = [];
let MODIFIER_OPTIONS: ModifierOption[] = [];
let MENU_ITEMS: MenuItem[] = [];
let TAX_RATE = 0;
let SERVICE_FEE_RATE = 0;

let MENU_ITEM_BY_ID = new Map<string, MenuItem>();
let MODIFIER_GROUP_BY_ID = new Map<string, ModifierGroup>();
let MODIFIER_OPTION_BY_ID = new Map<string, ModifierOption>();
let MODIFIER_OPTIONS_BY_GROUP = new Map<string, ModifierOption[]>();
let INCLUDED_MODIFIER_OPTIONS_BY_GROUP = new Map<string, ModifierOption[]>();
let INCLUDED_MODIFIER_OPTION_IDS_BY_GROUP = new Map<string, Set<string>>();

const EMPTY_MODIFIER_OPTIONS: ModifierOption[] = [];
const EMPTY_MODIFIER_OPTION_IDS = new Set<string>();

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// eslint-disable-next-line react-refresh/only-export-components
export function isValidAppConfig(value: unknown): value is AppConfig {
  if (!isObjectRecord(value)) {
    return false;
  }

  const locations = value.locations;
  const menu = value.menu;
  const pricing = value.pricing;

  if (!Array.isArray(locations) || !isObjectRecord(menu) || !isObjectRecord(pricing)) {
    return false;
  }

  if (
    !Array.isArray(menu.categories) ||
    !Array.isArray(menu.modifierGroups) ||
    !Array.isArray(menu.modifierOptions) ||
    !Array.isArray(menu.items)
  ) {
    return false;
  }

  return typeof pricing.taxRate === "number" && typeof pricing.serviceFeeRate === "number";
}

function rebuildConfigIndexes(config: AppConfig): void {
  LOCATIONS = config.locations;
  MENU_CATEGORIES = [...config.menu.categories].sort((a, b) => a.sortOrder - b.sortOrder);
  MODIFIER_GROUPS = config.menu.modifierGroups;
  MODIFIER_OPTIONS = config.menu.modifierOptions;
  MENU_ITEMS = config.menu.items;
  TAX_RATE = config.pricing.taxRate;
  SERVICE_FEE_RATE = config.pricing.serviceFeeRate;

  MENU_ITEM_BY_ID = new Map(MENU_ITEMS.map((item) => [item.id, item]));
  MODIFIER_GROUP_BY_ID = new Map(MODIFIER_GROUPS.map((group) => [group.id, group]));
  MODIFIER_OPTION_BY_ID = new Map(MODIFIER_OPTIONS.map((option) => [option.id, option]));

  MODIFIER_OPTIONS_BY_GROUP = new Map<string, ModifierOption[]>();
  for (const option of MODIFIER_OPTIONS) {
    const groupOptions = MODIFIER_OPTIONS_BY_GROUP.get(option.groupId);
    if (groupOptions) {
      groupOptions.push(option);
    } else {
      MODIFIER_OPTIONS_BY_GROUP.set(option.groupId, [option]);
    }
  }

  INCLUDED_MODIFIER_OPTIONS_BY_GROUP = new Map<string, ModifierOption[]>(
    Array.from(MODIFIER_OPTIONS_BY_GROUP.entries()).map(([groupId, options]) => [
      groupId,
      options.filter((option) => option.priceDeltaCents <= 0),
    ]),
  );
  INCLUDED_MODIFIER_OPTION_IDS_BY_GROUP = new Map<string, Set<string>>(
    Array.from(INCLUDED_MODIFIER_OPTIONS_BY_GROUP.entries()).map(([groupId, options]) => [
      groupId,
      new Set(options.map((option) => option.id)),
    ]),
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function setRuntimeConfig(nextConfig: AppConfig): void {
  if (!isValidAppConfig(nextConfig)) {
    console.warn("[catalog] Ignoring invalid runtime config payload.");
    return;
  }

  APP_CONFIG = nextConfig;
  rebuildConfigIndexes(nextConfig);
}

rebuildConfigIndexes(APP_CONFIG);

const CART_PREFIX = "ez-order:cart:";
const I18nContext = createContext<I18nContextValue | null>(null);
const MAX_FREE_TEXT_LENGTH = 280;
const NOTIFY_REQUEST_TIMEOUT_MS = 12_000;
const ZONE_TRANSLATION_KEY_BY_VALUE: Record<string, string> = {
  "Pool North": "location.zone.pool_north",
  "Pool East": "location.zone.pool_east",
  "Pool South": "location.zone.pool_south",
  "Pool West": "location.zone.pool_west",
  "Infinity Deck": "location.zone.infinity_deck",
  "Restaurant Terrace": "location.zone.restaurant_terrace",
};
const SPOT_TRANSLATION_PATTERNS: Array<{
  pattern: RegExp;
  key: string;
  fallback: string;
}> = [
  { pattern: /^Table\s+(\d+)$/i, key: "location.spot.table", fallback: "Table {number}" },
  { pattern: /^Umbrella\s+(\d+)$/i, key: "location.spot.umbrella", fallback: "Umbrella {number}" },
  { pattern: /^Cabana\s+(\d+)$/i, key: "location.spot.cabana", fallback: "Cabana {number}" },
  { pattern: /^Daybed\s+(\d+)$/i, key: "location.spot.daybed", fallback: "Daybed {number}" },
  { pattern: /^Lounger\s+(\d+)$/i, key: "location.spot.lounger", fallback: "Lounger {number}" },
];

function cartKey(locationToken: string): string {
  return `${CART_PREFIX}${locationToken}`;
}

function localGet<T>(key: string): T | null {
  const raw = localStorage.getItem(key);
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function localSet(key: string, value: unknown): void {
  localStorage.setItem(key, JSON.stringify(value));
}

function normalizeModifierSelections(raw: unknown): ModifierSelection[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  if (raw.every((value) => typeof value === "string")) {
    const quantitiesByOption: Record<string, number> = {};
    for (const optionId of raw) {
      quantitiesByOption[optionId] = (quantitiesByOption[optionId] ?? 0) + 1;
    }

    return Object.entries(quantitiesByOption)
      .map(([optionId, quantity]) => ({ optionId, quantity }))
      .sort((a, b) => a.optionId.localeCompare(b.optionId));
  }

  const normalized: ModifierSelection[] = [];
  for (const value of raw) {
    if (typeof value !== "object" || value === null) {
      continue;
    }

    const candidate = value as { optionId?: unknown; quantity?: unknown };
    if (typeof candidate.optionId !== "string") {
      continue;
    }

    const quantity =
      typeof candidate.quantity === "number" && Number.isFinite(candidate.quantity)
        ? Math.max(1, Math.floor(candidate.quantity))
        : 1;
    normalized.push({ optionId: candidate.optionId, quantity });
  }

  const mergedByOption: Record<string, number> = {};
  for (const selection of normalized) {
    mergedByOption[selection.optionId] = (mergedByOption[selection.optionId] ?? 0) + selection.quantity;
  }

  return Object.entries(mergedByOption)
    .map(([optionId, quantity]) => ({ optionId, quantity }))
    .sort((a, b) => a.optionId.localeCompare(b.optionId));
}

function loadCartLines(locationToken: string): CartLine[] {
  const raw = localGet<unknown[]>(cartKey(locationToken));
  if (!Array.isArray(raw)) {
    return [];
  }

  const normalized: CartLine[] = [];
  for (const value of raw) {
    if (typeof value !== "object" || value === null) {
      continue;
    }

    const line = value as {
      id?: unknown;
      menuItemId?: unknown;
      itemNameSnapshot?: unknown;
      quantity?: unknown;
      unitPriceCents?: unknown;
      lineTotalCents?: unknown;
      notes?: unknown;
      modifierSelections?: unknown;
      modifierOptionIds?: unknown;
      modifierLabel?: unknown;
    };

    if (typeof line.menuItemId !== "string") {
      continue;
    }

    const quantity =
      typeof line.quantity === "number" && Number.isFinite(line.quantity)
        ? Math.max(1, Math.floor(line.quantity))
        : 1;
    const unitPriceCents =
      typeof line.unitPriceCents === "number" && Number.isFinite(line.unitPriceCents)
        ? Math.max(0, Math.round(line.unitPriceCents))
        : 0;
    const lineTotalCents =
      typeof line.lineTotalCents === "number" && Number.isFinite(line.lineTotalCents)
        ? Math.max(0, Math.round(line.lineTotalCents))
        : unitPriceCents * quantity;

    normalized.push({
      id: typeof line.id === "string" ? line.id : crypto.randomUUID(),
      menuItemId: line.menuItemId,
      itemNameSnapshot:
        typeof line.itemNameSnapshot === "string" ? line.itemNameSnapshot : line.menuItemId,
      quantity,
      unitPriceCents,
      lineTotalCents,
      notes: typeof line.notes === "string" ? line.notes : undefined,
      modifierSelections: normalizeModifierSelections(line.modifierSelections ?? line.modifierOptionIds),
      modifierLabel: typeof line.modifierLabel === "string" ? line.modifierLabel : "",
    });
  }

  return normalized;
}

function saveCartLines(locationToken: string, lines: CartLine[]): void {
  localSet(cartKey(locationToken), lines);
}

function isSupportedLocale(value: string): value is LocaleCode {
  return SUPPORTED_LOCALES.includes(value as LocaleCode);
}

function normalizeLocale(value: string | null | undefined): LocaleCode | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  if (isSupportedLocale(trimmed)) {
    return trimmed;
  }

  const lower = trimmed.toLowerCase();
  if (lower.startsWith("pt")) {
    return "pt-BR";
  }
  if (lower.startsWith("en")) {
    return "en";
  }
  if (lower.startsWith("fr")) {
    return "fr";
  }
  if (lower.startsWith("es")) {
    return "es";
  }

  return null;
}

function detectInitialLocale(): LocaleCode {
  const storedLocale = normalizeLocale(localGet<string>(LOCALE_STORAGE_KEY));
  if (storedLocale) {
    return storedLocale;
  }

  return FALLBACK_LOCALE;
}

function interpolate(template: string, vars?: TranslateVars): string {
  if (!vars) {
    return template;
  }

  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (fullMatch, variableName: string) => {
    const replacement = vars[variableName];
    return replacement === undefined ? fullMatch : String(replacement);
  });
}

function createTranslator(locale: LocaleCode): TranslateFn {
  return (key, fallback, vars) => {
    const template = LOCALES[locale]?.[key] ?? LOCALES[FALLBACK_LOCALE]?.[key] ?? fallback;
    return interpolate(template, vars);
  };
}

function centsToMoney(cents: number, locale: LocaleCode): string {
  return new Intl.NumberFormat(locale, { style: "currency", currency: DISPLAY_CURRENCY }).format(cents / 100);
}

function formatDateTime(date: Date, locale: LocaleCode): string {
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function normalizeCode(value: string): string {
  return value.trim().toUpperCase();
}

function normalizeManualCode(value: string): string {
  const normalized = normalizeCode(value);

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

function findLocationByToken(token: string): Location | undefined {
  return LOCATIONS.find((location) => location.token === token);
}

function findLocationByManualCode(code: string): Location | undefined {
  const normalized = normalizeManualCode(code);
  return LOCATIONS.find((location) =>
    location.manualCodes.some((allowed) => normalizeManualCode(allowed) === normalized),
  );
}

function calculateTotals(lines: CartLine[]) {
  const subtotalCents = lines.reduce((sum, line) => sum + line.lineTotalCents, 0);
  const taxCents = Math.round(subtotalCents * TAX_RATE);
  const serviceFeeCents = Math.round(subtotalCents * SERVICE_FEE_RATE);
  const totalCents = subtotalCents + taxCents + serviceFeeCents;
  return { subtotalCents, taxCents, serviceFeeCents, totalCents };
}

function getCatalogLocalizedText(textByLocale: CatalogTextByLocale | undefined, locale: LocaleCode): string | null {
  if (!textByLocale || typeof textByLocale !== "object") {
    return null;
  }

  const direct = textByLocale[locale];
  if (typeof direct === "string" && direct.trim()) {
    return direct.trim();
  }

  const fallback = textByLocale[FALLBACK_LOCALE];
  if (typeof fallback === "string" && fallback.trim()) {
    return fallback.trim();
  }

  for (const localeCode of SUPPORTED_LOCALES) {
    const candidate = textByLocale[localeCode];
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }

  return null;
}

function getCategoryName(category: MenuCategory, t: TranslateFn, locale: LocaleCode): string {
  const fromCatalog = getCatalogLocalizedText(category.nameI18n, locale);
  if (fromCatalog) {
    return fromCatalog;
  }
  return t(`menu.categories.${category.id}.name`, category.name);
}

function getMenuItemName(item: MenuItem, t: TranslateFn, locale: LocaleCode): string {
  const fromCatalog = getCatalogLocalizedText(item.nameI18n, locale);
  if (fromCatalog) {
    return fromCatalog;
  }
  return t(`menu.items.${item.id}.name`, item.name);
}

function getMenuItemDescription(item: MenuItem, t: TranslateFn, locale: LocaleCode): string {
  const fromCatalog = getCatalogLocalizedText(item.descriptionI18n, locale);
  if (fromCatalog) {
    return fromCatalog;
  }
  return t(`menu.items.${item.id}.description`, item.description ?? "");
}

function getModifierGroupName(group: ModifierGroup, t: TranslateFn, locale: LocaleCode): string {
  const fromCatalog = getCatalogLocalizedText(group.nameI18n, locale);
  if (fromCatalog) {
    return fromCatalog;
  }
  return t(`menu.modifierGroups.${group.id}.name`, group.name);
}

function getModifierOptionName(option: ModifierOption, t: TranslateFn, locale: LocaleCode): string {
  const fromCatalog = getCatalogLocalizedText(option.nameI18n, locale);
  if (fromCatalog) {
    return fromCatalog;
  }
  return t(`menu.modifierOptions.${option.id}.name`, option.name);
}

function getLineItemName(line: CartLine, t: TranslateFn, locale: LocaleCode): string {
  const item = MENU_ITEM_BY_ID.get(line.menuItemId);
  return item ? getMenuItemName(item, t, locale) : line.itemNameSnapshot;
}

function buildModifierLabel(selections: ModifierSelection[], t: TranslateFn, locale: LocaleCode): string {
  return selections
    .slice()
    .sort((a, b) => a.optionId.localeCompare(b.optionId))
    .map((selection) => {
      const option = MODIFIER_OPTION_BY_ID.get(selection.optionId);
      if (!option) {
        return null;
      }
      const name = getModifierOptionName(option, t, locale);
      return selection.quantity > 1 ? `${selection.quantity}x ${name}` : name;
    })
    .filter((label): label is string => Boolean(label))
    .join(", ");
}

function getLineModifierLabel(line: CartLine, t: TranslateFn, locale: LocaleCode): string {
  const translated = buildModifierLabel(line.modifierSelections, t, locale);
  return translated || line.modifierLabel;
}

function getLocationZoneName(location: Location, t: TranslateFn, locale: LocaleCode): string {
  const catalogText = getCatalogLocalizedText(location.zoneNameI18n, locale);
  if (catalogText) {
    return catalogText;
  }

  const translationKey = ZONE_TRANSLATION_KEY_BY_VALUE[location.zoneName];
  if (!translationKey) {
    return location.zoneName;
  }
  return t(translationKey, location.zoneName);
}

function getLocationSpotLabel(location: Location, t: TranslateFn, locale: LocaleCode): string {
  const catalogText = getCatalogLocalizedText(location.spotLabelI18n, locale);
  if (catalogText) {
    return catalogText;
  }

  for (const { pattern, key, fallback } of SPOT_TRANSLATION_PATTERNS) {
    const match = pattern.exec(location.spotLabel);
    if (!match) {
      continue;
    }
    return t(key, fallback, { number: match[1] });
  }
  return location.spotLabel;
}

function getOptionsForGroup(groupId: string): ModifierOption[] {
  return MODIFIER_OPTIONS_BY_GROUP.get(groupId) ?? EMPTY_MODIFIER_OPTIONS;
}

function getIncludedOptionsForGroup(groupId: string): ModifierOption[] {
  return INCLUDED_MODIFIER_OPTIONS_BY_GROUP.get(groupId) ?? EMPTY_MODIFIER_OPTIONS;
}

function getIncludedOptionIdsForGroup(groupId: string): Set<string> {
  return INCLUDED_MODIFIER_OPTION_IDS_BY_GROUP.get(groupId) ?? EMPTY_MODIFIER_OPTION_IDS;
}

function isIncludedModifierOption(groupId: string, optionId: string): boolean {
  return getIncludedOptionIdsForGroup(groupId).has(optionId);
}

function isPaidModifierOptionId(optionId: string): boolean {
  const option = MODIFIER_OPTION_BY_ID.get(optionId);
  return Boolean(option && option.priceDeltaCents > 0);
}

function getSelectionBounds(group: ModifierGroup): { min: number; max: number } {
  const min = Math.max(0, group.minSelect);
  const max = Math.max(min, group.maxSelect);
  return { min, max };
}

function getIncludedSelectionCount(groupId: string, selectedQuantitiesByOption: GroupSelectionState): number {
  const includedOptionIds = getIncludedOptionIdsForGroup(groupId);
  return Object.entries(selectedQuantitiesByOption).filter(
    ([optionId, quantity]) => quantity > 0 && includedOptionIds.has(optionId),
  ).length;
}

function flattenSelectedOptionsByGroup(selectedOptionsByGroup: ConfigSelectionState): ModifierSelection[] {
  return Object.values(selectedOptionsByGroup)
    .flatMap((groupSelections) =>
      Object.entries(groupSelections).map(([optionId, quantity]) => ({
        optionId,
        quantity,
      })),
    )
    .filter((selection) => selection.quantity > 0)
    .map((selection) => ({
      optionId: selection.optionId,
      quantity: Math.max(1, Math.floor(selection.quantity)),
    }));
}

function normalizeSelectionQuantity(quantity: number): number {
  return Math.max(1, Math.floor(quantity));
}

function normalizeSelectionsForPricing(selections: ModifierSelection[]): ModifierSelection[] {
  return selections
    .filter((selection) => MODIFIER_OPTION_BY_ID.has(selection.optionId))
    .map((selection) => ({
      optionId: selection.optionId,
      quantity: normalizeSelectionQuantity(selection.quantity),
    }))
    .sort((a, b) => a.optionId.localeCompare(b.optionId));
}

function calculateModifierDeltaCents(selections: ModifierSelection[]): number {
  return selections.reduce((sum, selection) => {
    const option = MODIFIER_OPTION_BY_ID.get(selection.optionId);
    if (!option) {
      return sum;
    }
    return sum + option.priceDeltaCents * selection.quantity;
  }, 0);
}

function calculateMenuItemUnitPriceCents(item: MenuItem, selections: ModifierSelection[]): number {
  return item.basePriceCents + calculateModifierDeltaCents(selections);
}

function getCartLineItemCount(lines: CartLine[]): number {
  return lines.reduce((count, line) => count + line.quantity, 0);
}

function lineSignature(menuItemId: string, selections: ModifierSelection[]): string {
  const parts = selections
    .slice()
    .sort((a, b) => a.optionId.localeCompare(b.optionId))
    .map((selection) => `${selection.optionId}:${selection.quantity}`);
  return [menuItemId, ...parts].join("|");
}

function upsertCartLine(
  lines: CartLine[],
  item: MenuItem,
  selections: ModifierSelection[],
  t: TranslateFn,
  locale: LocaleCode,
): void {
  const signature = lineSignature(item.id, selections);
  const itemNameSnapshot = getMenuItemName(item, t, locale);
  const modifierLabel = buildModifierLabel(selections, t, locale);
  const unitPriceCents = calculateMenuItemUnitPriceCents(item, selections);

  const existingLine = lines.find(
    (line) => lineSignature(line.menuItemId, line.modifierSelections) === signature,
  );

  if (existingLine) {
    existingLine.quantity += 1;
    existingLine.lineTotalCents = existingLine.quantity * existingLine.unitPriceCents;
    existingLine.itemNameSnapshot = itemNameSnapshot;
    existingLine.modifierLabel = modifierLabel;
    return;
  }

  lines.push({
    id: crypto.randomUUID(),
    menuItemId: item.id,
    itemNameSnapshot,
    quantity: 1,
    unitPriceCents,
    lineTotalCents: unitPriceCents,
    modifierSelections: selections,
    modifierLabel,
  });
}

function validateItemConfiguration(
  item: MenuItem,
  selectedOptionsByGroup: ConfigSelectionState,
  t: TranslateFn,
  locale: LocaleCode,
): string | null {
  for (const groupId of item.modifierGroupIds) {
    const group = MODIFIER_GROUP_BY_ID.get(groupId);
    if (!group) {
      continue;
    }

    const { min, max } = getSelectionBounds(group);
    const groupName = getModifierGroupName(group, t, locale);
    const selectedQuantitiesByOption = selectedOptionsByGroup[groupId] ?? {};
    const includedOptions = getIncludedOptionsForGroup(groupId);
    const includedSelectedCount = getIncludedSelectionCount(groupId, selectedQuantitiesByOption);

    if (includedOptions.length < min) {
      return t(
        "error.modifier_unavailable",
        "This item is temporarily unavailable. Required options for {group} are missing.",
        { group: groupName },
      );
    }

    if (includedSelectedCount < min) {
      return t("error.modifier_required", "Select at least {count} option(s) for {group}.", {
        count: min,
        group: groupName,
      });
    }

    if (includedSelectedCount > max) {
      return t("error.modifier_limit", "Select up to {count} option(s) for {group}.", {
        count: max,
        group: groupName,
      });
    }
  }

  return null;
}

function buildOrderMessage(input: {
  t: TranslateFn;
  locale: LocaleCode;
  formatMoney: (cents: number) => string;
  formatDateTime: (date: Date) => string;
  location: Location;
  lines: CartLine[];
  notes: string;
  allergyNotes: string;
  totals: { subtotalCents: number; taxCents: number; serviceFeeCents: number; totalCents: number };
}): string {
  const locationZone = getLocationZoneName(input.location, input.t, input.locale);
  const locationSpot = getLocationSpotLabel(input.location, input.t, input.locale);
  const lineRows = input.lines
    .map((line) => {
      const itemName = getLineItemName(line, input.t, input.locale);
      const modifierLabel = getLineModifierLabel(line, input.t, input.locale);
      const modifierText = modifierLabel ? ` (${modifierLabel})` : "";
      const noteText = line.notes?.trim()
        ? input.t("order.item_note_suffix", " | note: {value}", { value: line.notes.trim() })
        : "";
      return `- ${line.quantity}x ${itemName}${modifierText}${noteText}`;
    })
    .join("\n");

  const parts: string[] = [
    input.t("order.header", "New Guest Order Request"),
    input.t("order.table_line", "Table: {value}", { value: locationSpot }),
    input.t("order.zone_line", "Zone: {value}", { value: locationZone }),
    input.t("order.code_line", "Code: {value}", {
      value: input.location.manualCodes[0] ?? input.location.token,
    }),
    input.t("order.time_line", "Time: {value}", { value: input.formatDateTime(new Date()) }),
    "",
    input.t("order.items_header", "Items:"),
    lineRows || input.t("order.no_items", "- No items"),
    "",
    input.t("order.subtotal_line", "Subtotal: {value}", {
      value: input.formatMoney(input.totals.subtotalCents),
    }),
    input.t("order.tax_line", "Tax: {value}", {
      value: input.formatMoney(input.totals.taxCents),
    }),
    input.t("order.service_fee_line", "Service fee: {value}", {
      value: input.formatMoney(input.totals.serviceFeeCents),
    }),
    input.t("order.total_line", "Total estimate: {value}", {
      value: input.formatMoney(input.totals.totalCents),
    }),
  ];

  if (input.notes.trim()) {
    parts.push("", input.t("order.order_notes_line", "Order notes: {value}", { value: input.notes.trim() }));
  }

  if (input.allergyNotes.trim()) {
    parts.push(
      "",
      input.t("order.allergy_notes_line", "Allergy notes: {value}", { value: input.allergyNotes.trim() }),
    );
  }

  parts.push("", input.t("order.confirm_line", "Please confirm this order at the table."));

  return parts.join("\n");
}

function useI18n(): I18nContextValue {
  const value = useContext(I18nContext);
  if (!value) {
    throw new Error("useI18n must be used inside I18nContext provider");
  }
  return value;
}

function GuestMenuRoute() {
  const { locationToken = "" } = useParams();
  return <GuestMenuPage key={locationToken} />;
}

function GuestCartRoute() {
  const { locationToken = "" } = useParams();
  return <GuestCartPage key={locationToken} />;
}

function App() {
  const [locale, setLocale] = useState<LocaleCode>(() => detectInitialLocale());

  useEffect(() => {
    localSet(LOCALE_STORAGE_KEY, locale);
  }, [locale]);

  useEffect(() => {
    if (typeof document !== "undefined") {
      document.documentElement.lang = locale;
    }
  }, [locale]);

  const t = useMemo(() => createTranslator(locale), [locale]);
  const formatMoney = useMemo(() => (cents: number) => centsToMoney(cents, locale), [locale]);
  const formatDateTimeWithLocale = useMemo(() => (date: Date) => formatDateTime(date, locale), [locale]);

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }

    document.title = t("ui.page_title", "Itatiaia Resort & Eventos");

    const description = t(
      "ui.meta_description",
      "Poolside ordering at Itatiaia Resort & Eventos. Scan your table QR and order drinks & snacks to your lounger.",
    );
    const metaDescription = document.querySelector('meta[name="description"]');
    if (metaDescription) {
      metaDescription.setAttribute("content", description);
    }
  }, [t]);

  const i18nValue = useMemo<I18nContextValue>(
    () => ({
      locale,
      setLocale,
      t,
      formatMoney,
      formatDateTime: formatDateTimeWithLocale,
    }),
    [locale, t, formatMoney, formatDateTimeWithLocale],
  );

  return (
    <I18nContext.Provider value={i18nValue}>
      <Routes>
        <Route path="/" element={<GuestStartPage />} />
        <Route path="/g/:locationToken" element={<GuestLocationPage />} />
        <Route path="/g/:locationToken/menu" element={<GuestMenuRoute />} />
        <Route path="/g/:locationToken/cart" element={<GuestCartRoute />} />
        <Route path="/g/:locationToken/sent" element={<GuestSentPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </I18nContext.Provider>
  );
}

function LeafIcon(props: { size?: number; className?: string }) {
  const s = props.size ?? 20;
  return (
    <svg width={s} height={s} viewBox="0 0 20 20" fill="none" className={props.className}>
      <path
        d="M6.5 17.5C4 15 3.5 11 5.2 7.2C7 3.8 10.5 2 14.5 2C14.2 6.2 12 10.2 8.5 13C7.2 14 6.5 15.8 6.5 17.5Z"
        fill="currentColor"
        fillOpacity={0.9}
      />
      <path
        d="M6.8 16.5C9 11 11.5 7 14.5 2"
        stroke="currentColor"
        strokeWidth={0.8}
        strokeOpacity={0.4}
        strokeLinecap="round"
      />
    </svg>
  );
}

function MenuItemImage(props: {
  src?: string;
  alt: string;
  containerClassName: "menu-item-thumb" | "menu-item-hero";
  fallbackText: string;
}) {
  const [failedSources, setFailedSources] = useState<Record<string, true>>({});
  const source = props.src;
  const imageUnavailable = source ? Boolean(failedSources[source]) : true;

  if (imageUnavailable) {
    return (
      <div className={`${props.containerClassName} menu-item-image-fallback`} role="img" aria-label={props.alt}>
        <svg viewBox="0 0 24 24" aria-hidden="true" className="menu-item-image-fallback-icon">
          <path
            d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v11a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 17.5v-11Zm3.2 10.6h9.6L14 13.7a1 1 0 0 0-1.5-.1l-1.5 1.6-1.1-.9a1 1 0 0 0-1.4.1l-1.3 1.7Z"
            fill="currentColor"
            fillOpacity="0.42"
          />
          <circle cx="9.2" cy="9" r="1.7" fill="currentColor" fillOpacity="0.58" />
        </svg>
        <span>{props.fallbackText}</span>
      </div>
    );
  }

  return (
    <div className={props.containerClassName}>
      <img
        src={source}
        alt={props.alt}
        loading="lazy"
        onError={() => {
          if (!source) {
            return;
          }
          setFailedSources((current) => {
            if (current[source]) {
              return current;
            }
            return { ...current, [source]: true };
          });
        }}
      />
    </div>
  );
}

function Screen(props: { title: string; subtitle?: string; children: ReactNode }) {
  const { locale, setLocale, t } = useI18n();
  const brandName = t("ui.brand_name", "Itatiaia Resort & Eventos");
  const brandTagline = t("ui.brand_tagline", "Poolside Ordering");
  const brandLogoAlt = t("ui.brand_logo_alt", "Itatiaia Resort & Eventos logo");

  return (
    <main className="screen">
      <div className="brand-bar">
        <Link to="/" className="brand-logo-link" aria-label={t("action.back_start", "Back to start")}>
          <img className="brand-logo" src="/logo.png" alt={brandLogoAlt} />
        </Link>
        <div className="brand-text">
          <span className="brand-name">{brandName}</span>
          <span className="brand-tagline">{brandTagline}</span>
        </div>
      </div>
      <header className="header">
        <div className="header-top">
          <h1>{props.title}</h1>
          <label className="language-control">
            <span>{t("ui.language_label", "Language")}</span>
            <select
              value={locale}
              onChange={(event) => {
                const nextLocale = normalizeLocale(event.target.value);
                if (nextLocale) {
                  setLocale(nextLocale);
                }
              }}
              aria-label={t("ui.language_label", "Language")}
            >
              {SUPPORTED_LOCALES.map((supportedLocale) => (
                <option key={supportedLocale} value={supportedLocale}>
                  {t(LOCALE_LABEL_KEYS[supportedLocale], supportedLocale)}
                </option>
              ))}
            </select>
          </label>
        </div>
        {props.subtitle ? <p className="subtle">{props.subtitle}</p> : null}
      </header>
      {props.children}
    </main>
  );
}

function GuestStartPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [manualInput, setManualInput] = useState("");
  const [manualNotFound, setManualNotFound] = useState(false);

  const submitManualCode = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setManualNotFound(false);

    const location = findLocationByManualCode(manualInput);
    if (!location) {
      setManualNotFound(true);
      return;
    }

    navigate(`/g/${location.token}`);
  };

  return (
    <Screen
      title={t("screen.start.title", "Start your order")}
      subtitle={t("screen.start.subtitle", "Scan the table QR with your phone camera app.")}
    >
      <section className="panel">
        <h2>{t("screen.start.qr_title", "QR first")}</h2>
        <p className="subtle">
          {t(
            "screen.start.qr_body",
            "Scan the printed QR at your table. It opens your table page directly.",
          )}
        </p>
      </section>

      <div className="leaf-ornament" aria-hidden="true">
        <LeafIcon size={22} />
      </div>

      <section className="panel">
        <h2>{t("screen.start.manual_title", "Manual fallback")}</h2>
        <p className="subtle">
          {t("screen.start.manual_body", "If you opened this page manually, enter your table number.")}
        </p>
        <form className="form" onSubmit={submitManualCode}>
          <label className="field">
            {t("screen.start.table_label", "Table number")}
            <input
              value={manualInput}
              onChange={(event) => {
                setManualInput(event.target.value);
                if (manualNotFound) {
                  setManualNotFound(false);
                }
              }}
              placeholder={t("screen.start.table_placeholder", "e.g. 42")}
              autoCapitalize="none"
              autoCorrect="off"
              required
            />
          </label>
          {manualNotFound ? (
            <p className="error">{t("error.table_not_found", "Table number not found. Check and try again.")}</p>
          ) : null}
          <button className="button" type="submit">
            {t("screen.start.continue", "Continue")}
          </button>
        </form>
      </section>
    </Screen>
  );
}

function GuestLocationPage() {
  const { t, locale } = useI18n();
  const { locationToken = "" } = useParams();
  const navigate = useNavigate();
  const location = findLocationByToken(locationToken);

  if (!location) {
    return (
      <Screen
        title={t("screen.location_missing.title", "Location not found")}
        subtitle={t("screen.location_missing.subtitle", "Please scan the table QR again.")}
      >
        <section className="panel">
          <p className="error">{t("screen.location_missing.error", "Invalid or inactive table link.")}</p>
          <Link className="button" to="/">
            {t("action.back_start", "Back to start")}
          </Link>
        </section>
      </Screen>
    );
  }

  const locationZone = getLocationZoneName(location, t, locale);
  const locationSpot = getLocationSpotLabel(location, t, locale);

  return (
    <Screen
      title={t("screen.location_confirm.title", "Confirm your location")}
      subtitle={t("screen.location_confirm.subtitle", "Double-check before ordering.")}
    >
      <section className="panel">
        <p className="location">
          <strong>{locationZone}</strong>
          <br />
          {locationSpot}
        </p>
        <div className="button-row">
          <button className="button" onClick={() => navigate(`/g/${location.token}/menu`)}>
            {t("action.order_to_table", "Order to this table")}
          </button>
          <Link className="button button-secondary" to="/">
            {t("action.use_another_table", "Use another table")}
          </Link>
        </div>
      </section>
    </Screen>
  );
}

function GuestMenuPage() {
  const { t, formatMoney, locale } = useI18n();
  const { locationToken = "" } = useParams();
  const navigate = useNavigate();
  const location = findLocationByToken(locationToken);

  const [activeCategoryId, setActiveCategoryId] = useState<string>(MENU_CATEGORIES[0]?.id ?? "");
  const [config, setConfig] = useState<ConfigState | null>(null);
  const [cartCount, setCartCount] = useState<number>(() => {
    const cart = loadCartLines(locationToken);
    return getCartLineItemCount(cart);
  });
  const [toastText, setToastText] = useState<string | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const categoryTabsRef = useRef<HTMLElement | null>(null);
  const [canScrollCategoriesLeft, setCanScrollCategoriesLeft] = useState(false);
  const [canScrollCategoriesRight, setCanScrollCategoriesRight] = useState(false);

  useEffect(() => {
    return () => clearTimeout(toastTimerRef.current);
  }, []);

  const updateCategoryScrollIndicators = () => {
    const element = categoryTabsRef.current;
    if (!element) {
      setCanScrollCategoriesLeft(false);
      setCanScrollCategoriesRight(false);
      return;
    }

    const tolerancePx = 2;
    const maxScrollLeft = Math.max(0, element.scrollWidth - element.clientWidth);
    setCanScrollCategoriesLeft(element.scrollLeft > tolerancePx);
    setCanScrollCategoriesRight(maxScrollLeft - element.scrollLeft > tolerancePx);
  };

  useEffect(() => {
    const frameId = window.requestAnimationFrame(updateCategoryScrollIndicators);
    const handleResize = () => updateCategoryScrollIndicators();
    window.addEventListener("resize", handleResize);

    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined" && categoryTabsRef.current) {
      resizeObserver = new ResizeObserver(() => updateCategoryScrollIndicators());
      resizeObserver.observe(categoryTabsRef.current);
    }

    return () => {
      window.cancelAnimationFrame(frameId);
      window.removeEventListener("resize", handleResize);
      resizeObserver?.disconnect();
    };
  }, [t]);

  if (!location) {
    return <Navigate to="/" replace />;
  }

  const locationZone = getLocationZoneName(location, t, locale);
  const locationSpot = getLocationSpotLabel(location, t, locale);
  const categories = MENU_CATEGORIES;
  const items = MENU_ITEMS.filter((item) => item.categoryId === activeCategoryId);

  const scrollCategoryTabs = (direction: -1 | 1) => {
    const element = categoryTabsRef.current;
    if (!element) {
      return;
    }

    const scrollAmount = Math.max(150, Math.floor(element.clientWidth * 0.6));
    element.scrollBy({ left: direction * scrollAmount, behavior: "smooth" });
    window.setTimeout(updateCategoryScrollIndicators, 220);
  };

  const openConfigurator = (item: MenuItem) => {
    const defaults: ConfigSelectionState = {};
    for (const groupId of item.modifierGroupIds) {
      const group = MODIFIER_GROUP_BY_ID.get(groupId);
      if (!group) {
        defaults[groupId] = {};
        continue;
      }

      const options = getOptionsForGroup(groupId);
      const { min } = getSelectionBounds(group);
      const includedOptions = getIncludedOptionsForGroup(groupId);
      const defaultOptions = (includedOptions.length > 0 ? includedOptions : options).slice(
        0,
        Math.min(min, options.length),
      );

      defaults[groupId] = defaultOptions.reduce<Record<string, number>>((map, option) => {
        map[option.id] = 1;
        return map;
      }, {});
    }

    setConfig({ item, selectedOptionsByGroup: defaults, validationError: null });
  };

  const addToCart = (item: MenuItem, selections: ModifierSelection[]) => {
    if (!item.available) {
      return;
    }

    const normalizedSelections = normalizeSelectionsForPricing(selections);
    const existing = loadCartLines(locationToken);
    upsertCartLine(existing, item, normalizedSelections, t, locale);

    saveCartLines(locationToken, existing);
    setCartCount(getCartLineItemCount(existing));
    setConfig(null);

    const itemName = getMenuItemName(item, t, locale);
    setToastText(t("toast.item_added", "{item} added to cart", { item: itemName }));
    clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToastText(null), 2000);
  };

  return (
    <Screen title={t("screen.menu.title", "Menu")} subtitle={`${locationZone} · ${locationSpot}`}>
      <div className="category-tabs-shell">
        <button
          type="button"
          className="category-tabs-arrow"
          disabled={!canScrollCategoriesLeft}
          onClick={() => scrollCategoryTabs(-1)}
          aria-label={t("action.scroll_categories_left", "Scroll categories left")}
        >
          <span aria-hidden="true">‹</span>
        </button>
        <section className="category-tabs" ref={categoryTabsRef} onScroll={updateCategoryScrollIndicators}>
          {categories.map((category) => (
            <button
              key={category.id}
              className={category.id === activeCategoryId ? "tab tab-active" : "tab"}
              onClick={() => setActiveCategoryId(category.id)}
            >
              {getCategoryName(category, t, locale)}
            </button>
          ))}
        </section>
        <button
          type="button"
          className="category-tabs-arrow"
          disabled={!canScrollCategoriesRight}
          onClick={() => scrollCategoryTabs(1)}
          aria-label={t("action.scroll_categories_right", "Scroll categories right")}
        >
          <span aria-hidden="true">›</span>
        </button>
      </div>

      <section className="menu-grid">
        {items.length === 0 ? (
          <article className="panel">
            <p className="subtle">
              {t("screen.menu.empty", "No items available in this category right now.")}
            </p>
          </article>
        ) : (
          items.map((item) => (
            <article key={item.id} className={`panel${!item.available ? " item-unavailable" : ""}`}>
              <MenuItemImage
                src={item.imageUrl}
                alt={getMenuItemName(item, t, locale)}
                containerClassName="menu-item-thumb"
                fallbackText={t("media.image_unavailable", "Image unavailable")}
              />
              <h3>{getMenuItemName(item, t, locale)}</h3>
              <p className="subtle">{getMenuItemDescription(item, t, locale)}</p>
              <p className="price">{formatMoney(item.basePriceCents)}</p>
              {!item.available ? <p className="warning">{t("error.item_unavailable", "Out of stock")}</p> : null}
              <button
                className="button"
                disabled={!item.available}
                onClick={() => {
                  if (item.modifierGroupIds.length === 0) {
                    addToCart(item, []);
                    return;
                  }
                  openConfigurator(item);
                }}
              >
                {t("action.add", "Add")}
              </button>
            </article>
          ))
        )}
      </section>

      <footer className="sticky-footer">
        <button className="button" onClick={() => navigate(`/g/${location.token}/cart`)}>
          {`${t("action.view_cart", "View cart")} (${cartCount})`}
        </button>
      </footer>

      {config ? (
        <div className="modal-backdrop" onClick={() => setConfig(null)}>
          <section
            className="modal-sheet"
            role="dialog"
            aria-modal="true"
            aria-label={t("aria.item_customization", "Item customization")}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modal-handle" aria-hidden="true" />
            <button
              className="modal-close"
              onClick={() => setConfig(null)}
              aria-label={t("aria.close", "Close")}
              type="button"
            >
              ×
            </button>
            <MenuItemImage
              src={config.item.imageUrl}
              alt={getMenuItemName(config.item, t, locale)}
              containerClassName="menu-item-hero"
              fallbackText={t("media.image_unavailable", "Image unavailable")}
            />
            <h3>{getMenuItemName(config.item, t, locale)}</h3>
            {config.item.modifierGroupIds.map((groupId) => {
              const group = MODIFIER_GROUP_BY_ID.get(groupId);
              if (!group) {
                return null;
              }
              const options = getOptionsForGroup(groupId);
              const selectedQuantitiesByOption = config.selectedOptionsByGroup[group.id] ?? {};
              const { min, max } = getSelectionBounds(group);
              const useRadio = min === 1 && max === 1;
              const includedSelectedCount = getIncludedSelectionCount(group.id, selectedQuantitiesByOption);

              return (
                <fieldset key={group.id} className="fieldset">
                  <legend>{getModifierGroupName(group, t, locale)}</legend>
                  {options.map((option) => {
                    const delta = option.priceDeltaCents;
                    const deltaLabel = delta === 0 ? "" : ` (${delta > 0 ? "+" : ""}${formatMoney(delta)})`;
                    const isPaidExtra = option.priceDeltaCents > 0;
                    const selectedQuantity = selectedQuantitiesByOption[option.id] ?? 0;
                    const isSelected = selectedQuantity > 0;
                    const disableBecauseMaxReached =
                      !isPaidExtra && !useRadio && max > 1 && includedSelectedCount >= max && !isSelected;

                    if (isPaidExtra) {
                      return (
                        <div key={option.id} className="option-row option-row-quantity">
                          <span>{`${getModifierOptionName(option, t, locale)}${deltaLabel}`}</span>
                          <div className="qty-controls">
                            <button
                              type="button"
                              className="qty-button"
                              disabled={selectedQuantity === 0}
                              onClick={() => {
                                setConfig((current) => {
                                  if (!current) {
                                    return current;
                                  }

                                  const currentGroupSelections = current.selectedOptionsByGroup[group.id] ?? {};
                                  const currentQuantity = currentGroupSelections[option.id] ?? 0;
                                  const nextQuantity = Math.max(0, currentQuantity - 1);
                                  const nextGroupSelections = { ...currentGroupSelections };

                                  if (nextQuantity === 0) {
                                    delete nextGroupSelections[option.id];
                                  } else {
                                    nextGroupSelections[option.id] = nextQuantity;
                                  }

                                  return {
                                    ...current,
                                    validationError: null,
                                    selectedOptionsByGroup: {
                                      ...current.selectedOptionsByGroup,
                                      [group.id]: nextGroupSelections,
                                    },
                                  };
                                });
                              }}
                            >
                              -
                            </button>
                            <span className="qty-value">{selectedQuantity}</span>
                            <button
                              type="button"
                              className="qty-button"
                              onClick={() => {
                                setConfig((current) => {
                                  if (!current) {
                                    return current;
                                  }

                                  const currentGroupSelections = current.selectedOptionsByGroup[group.id] ?? {};
                                  const currentQuantity = currentGroupSelections[option.id] ?? 0;
                                  const nextGroupSelections = {
                                    ...currentGroupSelections,
                                    [option.id]: currentQuantity + 1,
                                  };

                                  return {
                                    ...current,
                                    validationError: null,
                                    selectedOptionsByGroup: {
                                      ...current.selectedOptionsByGroup,
                                      [group.id]: nextGroupSelections,
                                    },
                                  };
                                });
                              }}
                            >
                              +
                            </button>
                          </div>
                        </div>
                      );
                    }

                    return (
                      <label key={option.id} className="option-row">
                        <input
                          type={useRadio ? "radio" : "checkbox"}
                          name={useRadio ? group.id : undefined}
                          checked={isSelected}
                          disabled={disableBecauseMaxReached}
                          onChange={() => {
                            setConfig((current) =>
                              (() => {
                                if (!current) {
                                  return current;
                                }

                                const currentSelected = current.selectedOptionsByGroup[group.id] ?? {};
                                let nextSelected: Record<string, number>;
                                const currentIncludedCount = getIncludedSelectionCount(group.id, currentSelected);

                                if (useRadio) {
                                  const paidSelections: Record<string, number> = {};
                                  for (const [selectedOptionId, quantity] of Object.entries(currentSelected)) {
                                    if (isPaidModifierOptionId(selectedOptionId) && quantity > 0) {
                                      paidSelections[selectedOptionId] = quantity;
                                    }
                                  }

                                  nextSelected = {
                                    ...paidSelections,
                                    [option.id]: 1,
                                  };
                                } else if ((currentSelected[option.id] ?? 0) > 0) {
                                  nextSelected = { ...currentSelected };
                                  delete nextSelected[option.id];
                                } else if (max === 1) {
                                  nextSelected = { ...currentSelected };
                                  for (const candidate of options) {
                                    if (isIncludedModifierOption(group.id, candidate.id)) {
                                      delete nextSelected[candidate.id];
                                    }
                                  }
                                  nextSelected[option.id] = 1;
                                } else if (currentIncludedCount < max) {
                                  nextSelected = {
                                    ...currentSelected,
                                    [option.id]: 1,
                                  };
                                } else {
                                  return {
                                    ...current,
                                    validationError: t(
                                      "error.modifier_limit",
                                      "Select up to {count} option(s) for {group}.",
                                      { count: max, group: getModifierGroupName(group, t, locale) },
                                    ),
                                  };
                                }

                                return {
                                  ...current,
                                  validationError: null,
                                  selectedOptionsByGroup: {
                                    ...current.selectedOptionsByGroup,
                                    [group.id]: nextSelected,
                                  },
                                };
                              })(),
                            );
                          }}
                        />
                        {`${getModifierOptionName(option, t, locale)}${deltaLabel}`}
                      </label>
                    );
                  })}
                </fieldset>
              );
            })}
            {config.validationError ? <p className="error">{config.validationError}</p> : null}

            <div className="button-row">
              <button
                className="button"
                onClick={() => {
                  const validationError = validateItemConfiguration(
                    config.item,
                    config.selectedOptionsByGroup,
                    t,
                    locale,
                  );
                  if (validationError) {
                    setConfig((current) => (current ? { ...current, validationError } : current));
                    return;
                  }

                  addToCart(config.item, flattenSelectedOptionsByGroup(config.selectedOptionsByGroup));
                }}
              >
                {t("action.add_to_cart", "Add to cart")}
              </button>
              <button className="button button-secondary" onClick={() => setConfig(null)}>
                {t("action.cancel", "Cancel")}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      <div role="status" aria-live="polite">
        {toastText ? <div className="toast">{toastText}</div> : null}
      </div>
    </Screen>
  );
}

function GuestCartPage() {
  const { t, formatMoney, formatDateTime, locale } = useI18n();
  const { locationToken = "" } = useParams();
  const navigate = useNavigate();
  const location = findLocationByToken(locationToken);

  const [lines, setLines] = useState<CartLine[]>(() => loadCartLines(locationToken));
  const [notes, setNotes] = useState("");
  const [allergyNotes, setAllergyNotes] = useState("");
  const [errorKey, setErrorKey] = useState<"cart_empty" | "send_failed" | null>(null);
  const [sending, setSending] = useState(false);
  const sendingRef = useRef(false);

  if (!location) {
    return <Navigate to="/" replace />;
  }

  const locationSpot = getLocationSpotLabel(location, t, locale);
  const totals = calculateTotals(lines);

  const removeLine = (id: string) => {
    const nextLines = lines.filter((line) => line.id !== id);
    setLines(nextLines);
    saveCartLines(locationToken, nextLines);
  };

  const sendOrder = async () => {
    if (sendingRef.current) {
      return;
    }

    setErrorKey(null);

    if (lines.length === 0) {
      setErrorKey("cart_empty");
      return;
    }

    const message = buildOrderMessage({
      t,
      locale,
      formatMoney,
      formatDateTime,
      location,
      lines,
      notes,
      allergyNotes,
      totals,
    });

    const title = t("order.push_title", "New order: {spot}", { spot: locationSpot });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), NOTIFY_REQUEST_TIMEOUT_MS);

    sendingRef.current = true;
    setSending(true);
    try {
      const res = await fetch("/api/notify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, message }),
        signal: controller.signal,
      });

      if (!res.ok) {
        setErrorKey("send_failed");
        return;
      }

      localStorage.removeItem(cartKey(locationToken));
      navigate(`/g/${locationToken}/sent`, {
        state: {
          sentAtIso: new Date().toISOString(),
        } satisfies SentPageState,
      });
    } catch {
      setErrorKey("send_failed");
    } finally {
      clearTimeout(timeout);
      sendingRef.current = false;
      setSending(false);
    }
  };

  const errorText =
    errorKey === "cart_empty"
      ? t("error.cart_empty", "Your cart is empty.")
      : errorKey === "send_failed"
        ? t("error.send_failed", "Could not send your order. Please try again.")
        : null;

  return (
    <Screen
      title={t("screen.cart.title", "Your cart")}
      subtitle={t("screen.cart.subtitle", "Review your order before sending.")}
    >
      <section className="panel">
        {lines.length === 0 ? <p>{t("screen.cart.empty", "Your cart is empty.")}</p> : null}
        {lines.map((line) => {
          const itemName = getLineItemName(line, t, locale);
          const modifierLabel = getLineModifierLabel(line, t, locale);

          return (
            <article key={line.id} className="line-item">
              <div>
                <strong>
                  {line.quantity}x {itemName}
                </strong>
                {modifierLabel ? <p className="subtle">{modifierLabel}</p> : null}
              </div>
              <div>
                <p>{formatMoney(line.lineTotalCents)}</p>
                <button className="link-button" onClick={() => removeLine(line.id)}>
                  {t("action.remove", "Remove")}
                </button>
              </div>
            </article>
          );
        })}

        <label className="field">
          {t("field.notes", "Notes")}
          <textarea
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            rows={2}
            maxLength={MAX_FREE_TEXT_LENGTH}
          />
        </label>
        <label className="field">
          {t("field.allergy_notes", "Allergy notes")}
          <textarea
            value={allergyNotes}
            onChange={(event) => setAllergyNotes(event.target.value)}
            rows={2}
            maxLength={MAX_FREE_TEXT_LENGTH}
          />
        </label>

        <div className="totals">
          <p>
            <span>{t("label.subtotal", "Subtotal")}</span>
            <span>{formatMoney(totals.subtotalCents)}</span>
          </p>
          <p>
            <span>{t("label.tax", "Tax")}</span>
            <span>{formatMoney(totals.taxCents)}</span>
          </p>
          <p>
            <span>{t("label.service_fee", "Service fee")}</span>
            <span>{formatMoney(totals.serviceFeeCents)}</span>
          </p>
          <p className="total-row">
            <span>{t("label.total_estimate", "Total estimate")}</span>
            <span>{formatMoney(totals.totalCents)}</span>
          </p>
        </div>

        {errorText ? <p className="error">{errorText}</p> : null}

        <button
          className={`button button-place-order${sending ? " button-loading" : ""}`}
          onClick={sendOrder}
          disabled={lines.length === 0 || sending}
        >
          {sending ? t("action.sending", "Sending...") : t("action.send_order", "Send order")}
        </button>
        <button className="button button-secondary" onClick={() => navigate(`/g/${locationToken}/menu`)}>
          {t("action.back_menu", "Back to menu")}
        </button>
      </section>
    </Screen>
  );
}

function GuestSentPage() {
  const { t, formatDateTime, locale } = useI18n();
  const { locationToken = "" } = useParams();
  const navigate = useNavigate();
  const routerLocation = useLocation();
  const sentState = (routerLocation.state as SentPageState | null) ?? null;

  const location = findLocationByToken(locationToken);

  if (!location) {
    return <Navigate to="/" replace />;
  }

  const locationSpot = getLocationSpotLabel(location, t, locale);
  const sentAt = sentState?.sentAtIso ? new Date(sentState.sentAtIso) : null;

  return (
    <Screen
      title={t("screen.sent.title", "Order sent!")}
      subtitle={t("screen.sent.subtitle", "Your order has been sent to the waiter.")}
    >
      <section className="panel sent-confirmation">
        <div className="success-icon" aria-hidden="true">
          <svg width="64" height="64" viewBox="0 0 56 56" fill="none">
            <circle cx="28" cy="28" r="26" stroke="currentColor" strokeWidth="2" opacity="0.15" />
            <circle cx="28" cy="28" r="26" stroke="currentColor" strokeWidth="2" className="success-circle" />
            <path d="M18 28l7 7 13-13" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="success-check" />
          </svg>
        </div>
        <p className="sent-table">
          {t("label.table", "Table")}: <strong>{locationSpot}</strong>
        </p>
        {sentAt ? (
          <p className="subtle">
            {t("screen.sent.sent_at", "Sent at {time}", { time: formatDateTime(sentAt) })}
          </p>
        ) : null}
        <p className="sent-instructions">{t("screen.sent.instructions", "The waiter has been notified and will attend to your table shortly.")}</p>

        <div className="sent-actions">
          <button className="button button-accent" onClick={() => navigate("/")}>
            {t("action.done", "Done")}
          </button>
          <button className="button button-secondary" onClick={() => navigate(`/g/${locationToken}/menu`)}>
            {t("action.order_more", "Order more")}
          </button>
        </div>
      </section>
    </Screen>
  );
}

export default App;

import {
  createContext,
  type FormEvent,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
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

type Location = {
  id: string;
  token: string;
  zoneName: string;
  spotLabel: string;
  manualCodes: string[];
};

type MenuCategory = { id: string; name: string; sortOrder: number };
type ModifierGroup = { id: string; name: string; minSelect: number; maxSelect: number; required: boolean };
type ModifierOption = { id: string; groupId: string; name: string; priceDeltaCents: number };
type MenuItem = {
  id: string;
  categoryId: string;
  name: string;
  description?: string;
  basePriceCents: number;
  available: boolean;
  modifierGroupIds: string[];
};

type CartLine = {
  id: string;
  menuItemId: string;
  itemNameSnapshot: string;
  quantity: number;
  unitPriceCents: number;
  lineTotalCents: number;
  notes?: string;
  modifierOptionIds: string[];
  modifierLabel: string;
};

type ConfigState = {
  item: MenuItem;
  selectedOptionByGroup: Record<string, string>;
};

type SentPageState = {
  notes?: string;
  allergyNotes?: string;
  sentAtIso?: string;
};

type AppConfig = {
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

const APP_CONFIG: AppConfig = configData;
const FALLBACK_LOCALE: LocaleCode = "en";
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

const WAITER_WHATSAPP_NUMBER = (import.meta.env.VITE_WAITER_WHATSAPP_NUMBER ?? "").replace(/\D/g, "");
const RAW_DISPLAY_CURRENCY = (import.meta.env.VITE_DISPLAY_CURRENCY ?? "USD").trim().toUpperCase();
const DISPLAY_CURRENCY = /^[A-Z]{3}$/.test(RAW_DISPLAY_CURRENCY) ? RAW_DISPLAY_CURRENCY : "USD";

const LOCATIONS = APP_CONFIG.locations;
const MENU_CATEGORIES = [...APP_CONFIG.menu.categories].sort((a, b) => a.sortOrder - b.sortOrder);
const MODIFIER_GROUPS = APP_CONFIG.menu.modifierGroups;
const MODIFIER_OPTIONS = APP_CONFIG.menu.modifierOptions;
const MENU_ITEMS = APP_CONFIG.menu.items;
const TAX_RATE = APP_CONFIG.pricing.taxRate;
const SERVICE_FEE_RATE = APP_CONFIG.pricing.serviceFeeRate;

const MENU_ITEM_BY_ID = new Map(MENU_ITEMS.map((item) => [item.id, item]));
const MODIFIER_GROUP_BY_ID = new Map(MODIFIER_GROUPS.map((group) => [group.id, group]));
const MODIFIER_OPTION_BY_ID = new Map(MODIFIER_OPTIONS.map((option) => [option.id, option]));

const CART_PREFIX = "ez-order:cart:";
const I18nContext = createContext<I18nContextValue | null>(null);
const MAX_FREE_TEXT_LENGTH = 280;

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

  if (typeof navigator !== "undefined") {
    for (const candidate of navigator.languages ?? []) {
      const resolved = normalizeLocale(candidate);
      if (resolved) {
        return resolved;
      }
    }

    const browserLocale = normalizeLocale(navigator.language);
    if (browserLocale) {
      return browserLocale;
    }
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

function findLocationByToken(token: string): Location | undefined {
  return LOCATIONS.find((location) => location.token === token);
}

function findLocationByManualCode(code: string): Location | undefined {
  const normalized = normalizeCode(code);
  return LOCATIONS.find((location) =>
    location.manualCodes.some((allowed) => normalizeCode(allowed) === normalized),
  );
}

function calculateTotals(lines: CartLine[]) {
  const subtotalCents = lines.reduce((sum, line) => sum + line.lineTotalCents, 0);
  const taxCents = Math.round(subtotalCents * TAX_RATE);
  const serviceFeeCents = Math.round(subtotalCents * SERVICE_FEE_RATE);
  const totalCents = subtotalCents + taxCents + serviceFeeCents;
  return { subtotalCents, taxCents, serviceFeeCents, totalCents };
}

function getCategoryName(category: MenuCategory, t: TranslateFn): string {
  return t(`menu.categories.${category.id}.name`, category.name);
}

function getMenuItemName(item: MenuItem, t: TranslateFn): string {
  return t(`menu.items.${item.id}.name`, item.name);
}

function getMenuItemDescription(item: MenuItem, t: TranslateFn): string {
  return t(`menu.items.${item.id}.description`, item.description ?? "");
}

function getModifierGroupName(group: ModifierGroup, t: TranslateFn): string {
  return t(`menu.modifierGroups.${group.id}.name`, group.name);
}

function getModifierOptionName(option: ModifierOption, t: TranslateFn): string {
  return t(`menu.modifierOptions.${option.id}.name`, option.name);
}

function getLineItemName(line: CartLine, t: TranslateFn): string {
  const item = MENU_ITEM_BY_ID.get(line.menuItemId);
  return item ? getMenuItemName(item, t) : line.itemNameSnapshot;
}

function buildModifierLabel(optionIds: string[], t: TranslateFn): string {
  return optionIds
    .map((id) => MODIFIER_OPTION_BY_ID.get(id))
    .filter((option): option is ModifierOption => Boolean(option))
    .map((option) => getModifierOptionName(option, t))
    .join(", ");
}

function getLineModifierLabel(line: CartLine, t: TranslateFn): string {
  const translated = buildModifierLabel(line.modifierOptionIds, t);
  return translated || line.modifierLabel;
}

function buildWhatsAppMessage(input: {
  t: TranslateFn;
  formatMoney: (cents: number) => string;
  formatDateTime: (date: Date) => string;
  location: Location;
  lines: CartLine[];
  notes: string;
  allergyNotes: string;
  totals: { subtotalCents: number; taxCents: number; serviceFeeCents: number; totalCents: number };
}): string {
  const lineRows = input.lines
    .map((line) => {
      const itemName = getLineItemName(line, input.t);
      const modifierLabel = getLineModifierLabel(line, input.t);
      const modifierText = modifierLabel ? ` (${modifierLabel})` : "";
      const noteText = line.notes?.trim()
        ? input.t("wa.item_note_suffix", " | note: {value}", { value: line.notes.trim() })
        : "";
      return `- ${line.quantity}x ${itemName}${modifierText}${noteText}`;
    })
    .join("\n");

  const parts: string[] = [
    input.t("wa.header", "New Guest Order Request"),
    input.t("wa.table_line", "Table: {value}", { value: input.location.spotLabel }),
    input.t("wa.zone_line", "Zone: {value}", { value: input.location.zoneName }),
    input.t("wa.code_line", "Code: {value}", {
      value: input.location.manualCodes[0] ?? input.location.token,
    }),
    input.t("wa.time_line", "Time: {value}", { value: input.formatDateTime(new Date()) }),
    "",
    input.t("wa.items_header", "Items:"),
    lineRows || input.t("wa.no_items", "- No items"),
    "",
    input.t("wa.subtotal_line", "Subtotal: {value}", {
      value: input.formatMoney(input.totals.subtotalCents),
    }),
    input.t("wa.tax_line", "Tax: {value}", {
      value: input.formatMoney(input.totals.taxCents),
    }),
    input.t("wa.service_fee_line", "Service fee: {value}", {
      value: input.formatMoney(input.totals.serviceFeeCents),
    }),
    input.t("wa.total_line", "Total estimate: {value}", {
      value: input.formatMoney(input.totals.totalCents),
    }),
  ];

  if (input.notes.trim()) {
    parts.push("", input.t("wa.order_notes_line", "Order notes: {value}", { value: input.notes.trim() }));
  }

  if (input.allergyNotes.trim()) {
    parts.push(
      "",
      input.t("wa.allergy_notes_line", "Allergy notes: {value}", { value: input.allergyNotes.trim() }),
    );
  }

  parts.push("", input.t("wa.confirm_line", "Please confirm this order at the table."));

  return parts.join("\n");
}

function openWhatsApp(number: string, message: string) {
  const url = `https://wa.me/${number}?text=${encodeURIComponent(message)}`;
  const popup = window.open(url, "_blank", "noopener,noreferrer");
  if (!popup) {
    window.location.href = url;
  }
}

function isValidWhatsAppNumber(value: string): boolean {
  return /^[1-9]\d{7,14}$/.test(value);
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

  const t = useMemo(() => createTranslator(locale), [locale]);
  const formatMoney = useMemo(() => (cents: number) => centsToMoney(cents, locale), [locale]);
  const formatDateTimeWithLocale = useMemo(() => (date: Date) => formatDateTime(date, locale), [locale]);

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

function Screen(props: { title: string; subtitle?: string; children: ReactNode }) {
  const { locale, setLocale, t } = useI18n();

  return (
    <main className="screen">
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
  const { t } = useI18n();
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

  return (
    <Screen
      title={t("screen.location_confirm.title", "Confirm your location")}
      subtitle={t("screen.location_confirm.subtitle", "Double-check before ordering.")}
    >
      <section className="panel">
        <p className="location">
          <strong>{location.zoneName}</strong>
          <br />
          {location.spotLabel}
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
  const { t, formatMoney } = useI18n();
  const { locationToken = "" } = useParams();
  const navigate = useNavigate();
  const location = findLocationByToken(locationToken);

  const [activeCategoryId, setActiveCategoryId] = useState<string>(MENU_CATEGORIES[0]?.id ?? "");
  const [config, setConfig] = useState<ConfigState | null>(null);
  const [cartCount, setCartCount] = useState<number>(() => {
    const cart = localGet<CartLine[]>(cartKey(locationToken)) ?? [];
    return cart.reduce((count, line) => count + line.quantity, 0);
  });

  if (!location) {
    return <Navigate to="/" replace />;
  }

  const categories = MENU_CATEGORIES;
  const items = MENU_ITEMS.filter((item) => item.categoryId === activeCategoryId);

  const openConfigurator = (item: MenuItem) => {
    const defaults: Record<string, string> = {};
    for (const groupId of item.modifierGroupIds) {
      const option = MODIFIER_OPTIONS.find((candidate) => candidate.groupId === groupId);
      if (option) {
        defaults[groupId] = option.id;
      }
    }
    setConfig({ item, selectedOptionByGroup: defaults });
  };

  const addToCart = (item: MenuItem, optionIds: string[]) => {
    if (!item.available) {
      return;
    }

    const modifierDelta = MODIFIER_OPTIONS
      .filter((option) => optionIds.includes(option.id))
      .reduce((sum, option) => sum + option.priceDeltaCents, 0);

    const unitPrice = item.basePriceCents + modifierDelta;
    const existing = localGet<CartLine[]>(cartKey(locationToken)) ?? [];
    const signature = [item.id, ...optionIds.slice().sort()].join("|");

    const existingLine = existing.find(
      (line) => [line.menuItemId, ...line.modifierOptionIds.slice().sort()].join("|") === signature,
    );

    if (existingLine) {
      existingLine.quantity += 1;
      existingLine.lineTotalCents = existingLine.quantity * existingLine.unitPriceCents;
      existingLine.itemNameSnapshot = getMenuItemName(item, t);
      existingLine.modifierLabel = buildModifierLabel(optionIds, t);
    } else {
      existing.push({
        id: crypto.randomUUID(),
        menuItemId: item.id,
        itemNameSnapshot: getMenuItemName(item, t),
        quantity: 1,
        unitPriceCents: unitPrice,
        lineTotalCents: unitPrice,
        modifierOptionIds: optionIds,
        modifierLabel: buildModifierLabel(optionIds, t),
      });
    }

    localSet(cartKey(locationToken), existing);
    setCartCount(existing.reduce((count, line) => count + line.quantity, 0));
    setConfig(null);
  };

  return (
    <Screen title={t("screen.menu.title", "Menu")} subtitle={`${location.zoneName} · ${location.spotLabel}`}>
      <section className="category-tabs">
        {categories.map((category) => (
          <button
            key={category.id}
            className={category.id === activeCategoryId ? "tab tab-active" : "tab"}
            onClick={() => setActiveCategoryId(category.id)}
          >
            {getCategoryName(category, t)}
          </button>
        ))}
      </section>

      <section className="menu-grid">
        {items.map((item) => (
          <article key={item.id} className={`panel${!item.available ? " item-unavailable" : ""}`}>
            <h3>{getMenuItemName(item, t)}</h3>
            <p className="subtle">{getMenuItemDescription(item, t)}</p>
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
        ))}
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
            <button
              className="modal-close"
              onClick={() => setConfig(null)}
              aria-label={t("aria.close", "Close")}
              type="button"
            >
              ×
            </button>
            <h3>{getMenuItemName(config.item, t)}</h3>
            {config.item.modifierGroupIds.map((groupId) => {
              const group = MODIFIER_GROUP_BY_ID.get(groupId);
              if (!group) {
                return null;
              }
              const options = MODIFIER_OPTIONS.filter((option) => option.groupId === groupId);

              return (
                <fieldset key={group.id} className="fieldset">
                  <legend>{getModifierGroupName(group, t)}</legend>
                  {options.map((option) => {
                    const delta = option.priceDeltaCents;
                    const deltaLabel = delta === 0 ? "" : ` (${delta > 0 ? "+" : ""}${formatMoney(delta)})`;

                    return (
                      <label key={option.id} className="option-row">
                        <input
                          type="radio"
                          name={group.id}
                          checked={config.selectedOptionByGroup[group.id] === option.id}
                          onChange={() => {
                            setConfig((current) =>
                              current
                                ? {
                                    ...current,
                                    selectedOptionByGroup: {
                                      ...current.selectedOptionByGroup,
                                      [group.id]: option.id,
                                    },
                                  }
                                : current,
                            );
                          }}
                        />
                        {`${getModifierOptionName(option, t)}${deltaLabel}`}
                      </label>
                    );
                  })}
                </fieldset>
              );
            })}

            <div className="button-row">
              <button
                className="button"
                onClick={() => addToCart(config.item, Object.values(config.selectedOptionByGroup))}
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
    </Screen>
  );
}

function GuestCartPage() {
  const { t, formatMoney, formatDateTime } = useI18n();
  const { locationToken = "" } = useParams();
  const navigate = useNavigate();
  const location = findLocationByToken(locationToken);

  const [lines, setLines] = useState<CartLine[]>(() => localGet<CartLine[]>(cartKey(locationToken)) ?? []);
  const [notes, setNotes] = useState("");
  const [allergyNotes, setAllergyNotes] = useState("");
  const [errorKey, setErrorKey] = useState<"cart_empty" | "wa_invalid" | null>(null);

  if (!location) {
    return <Navigate to="/" replace />;
  }

  const totals = calculateTotals(lines);

  const removeLine = (id: string) => {
    const nextLines = lines.filter((line) => line.id !== id);
    setLines(nextLines);
    localSet(cartKey(locationToken), nextLines);
  };

  const sendToWhatsApp = () => {
    setErrorKey(null);

    if (lines.length === 0) {
      setErrorKey("cart_empty");
      return;
    }

    if (!isValidWhatsAppNumber(WAITER_WHATSAPP_NUMBER)) {
      setErrorKey("wa_invalid");
      return;
    }

    const message = buildWhatsAppMessage({
      t,
      formatMoney,
      formatDateTime,
      location,
      lines,
      notes,
      allergyNotes,
      totals,
    });

    openWhatsApp(WAITER_WHATSAPP_NUMBER, message);

    navigate(`/g/${locationToken}/sent`, {
      state: {
        notes,
        allergyNotes,
        sentAtIso: new Date().toISOString(),
      } satisfies SentPageState,
    });
  };

  const errorText =
    errorKey === "cart_empty"
      ? t("error.cart_empty", "Your cart is empty.")
      : errorKey === "wa_invalid"
        ? t("error.whatsapp_invalid", "Waiter WhatsApp number is missing or invalid.")
        : null;

  return (
    <Screen
      title={t("screen.cart.title", "Your cart")}
      subtitle={t("screen.cart.subtitle", "Review before alerting waiter on WhatsApp.")}
    >
      <section className="panel">
        {lines.length === 0 ? <p>{t("screen.cart.empty", "Your cart is empty.")}</p> : null}
        {lines.map((line) => {
          const itemName = getLineItemName(line, t);
          const modifierLabel = getLineModifierLabel(line, t);

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

        <div className="button-row">
          <button className="button" onClick={sendToWhatsApp} disabled={lines.length === 0}>
            {t("action.send_whatsapp", "Send to waiter on WhatsApp")}
          </button>
          <button className="button button-secondary" onClick={() => navigate(`/g/${locationToken}/menu`)}>
            {t("action.back_menu", "Back to menu")}
          </button>
        </div>
      </section>
    </Screen>
  );
}

function GuestSentPage() {
  const { t, formatMoney, formatDateTime } = useI18n();
  const { locationToken = "" } = useParams();
  const navigate = useNavigate();
  const routerLocation = useLocation();
  const sentState = (routerLocation.state as SentPageState | null) ?? null;

  const location = findLocationByToken(locationToken);
  const lines = localGet<CartLine[]>(cartKey(locationToken)) ?? [];

  if (!location) {
    return <Navigate to="/" replace />;
  }

  const totals = calculateTotals(lines);
  const message =
    lines.length > 0
      ? buildWhatsAppMessage({
          t,
          formatMoney,
          formatDateTime,
          location,
          lines,
          notes: sentState?.notes ?? "",
          allergyNotes: sentState?.allergyNotes ?? "",
          totals,
        })
      : "";

  const openAgain = () => {
    if (!message) {
      return;
    }
    if (!isValidWhatsAppNumber(WAITER_WHATSAPP_NUMBER)) {
      return;
    }
    openWhatsApp(WAITER_WHATSAPP_NUMBER, message);
  };

  const confirmSent = () => {
    localStorage.removeItem(cartKey(locationToken));
    navigate("/");
  };

  return (
    <Screen
      title={t("screen.sent.title", "Request ready")}
      subtitle={t("screen.sent.subtitle", "Finish sending in WhatsApp.")}
    >
      <section className="panel">
        <p>
          {t("label.table", "Table")}: <strong>{location.spotLabel}</strong>
        </p>
        <p className="subtle">{t("screen.sent.instructions", "WhatsApp opened with your order message. After sending it there, tap I sent it here.")}</p>

        {!sentState ? (
          <p className="warning">
            {t(
              "screen.sent.reopened_warning",
              "This page was reopened. Notes/allergy text is not persisted for privacy.",
            )}
          </p>
        ) : null}

        {lines.length > 0 ? (
          <>
            <label className="field">
              {t("field.message_preview", "Message preview")}
              <textarea readOnly value={message} rows={8} />
            </label>
            <p className="total-row">
              <span>{t("label.total_estimate", "Total estimate")}</span>
              <span>{formatMoney(totals.totalCents)}</span>
            </p>
          </>
        ) : (
          <p className="warning">{t("screen.sent.empty_warning", "Cart is empty. Add items before sending another alert.")}</p>
        )}

        <div className="button-row">
          <button
            className="button"
            onClick={openAgain}
            disabled={!message || !isValidWhatsAppNumber(WAITER_WHATSAPP_NUMBER)}
          >
            {t("action.open_whatsapp_again", "Open WhatsApp again")}
          </button>
          <button className="button" onClick={confirmSent} disabled={lines.length === 0}>
            {t("action.i_sent_it", "I sent it")}
          </button>
          <button
            className="button button-secondary"
            onClick={() => navigate(`/g/${locationToken}/cart`, { state: sentState })}
          >
            {t("action.back_cart", "Back to cart")}
          </button>
        </div>
      </section>
    </Screen>
  );
}

export default App;

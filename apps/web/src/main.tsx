import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App, { isValidAppConfig, setRuntimeConfig } from "./App";
import "./index.css";

const DEFAULT_CATALOG_URL = "/catalog/order-config.json";
const DEFAULT_CATALOG_TIMEOUT_MS = 4_500;
const MIN_CATALOG_TIMEOUT_MS = 1_000;
const MAX_CATALOG_TIMEOUT_MS = 20_000;

function resolveCatalogUrl(): string {
  const raw = (import.meta.env.VITE_MENU_CONFIG_URL ?? DEFAULT_CATALOG_URL).trim();
  return raw || DEFAULT_CATALOG_URL;
}

function resolveCatalogTimeoutMs(): number {
  const raw = Number.parseInt(import.meta.env.VITE_MENU_CONFIG_TIMEOUT_MS ?? "", 10);
  if (!Number.isFinite(raw)) {
    return DEFAULT_CATALOG_TIMEOUT_MS;
  }
  return Math.min(MAX_CATALOG_TIMEOUT_MS, Math.max(MIN_CATALOG_TIMEOUT_MS, raw));
}

async function loadCatalogConfig(): Promise<void> {
  const catalogUrl = resolveCatalogUrl();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), resolveCatalogTimeoutMs());

  try {
    const response = await fetch(catalogUrl, { cache: "no-store", signal: controller.signal });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const payload: unknown = await response.json();
    if (!isValidAppConfig(payload)) {
      throw new Error("Invalid catalog schema");
    }

    setRuntimeConfig(payload);
  } catch (error) {
    console.warn(`[catalog] Failed to load ${catalogUrl}. Using bundled fallback config.`, error);
  } finally {
    clearTimeout(timeout);
  }
}

function renderApp(): void {
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </StrictMode>,
  );
}

renderApp();
void loadCatalogConfig();

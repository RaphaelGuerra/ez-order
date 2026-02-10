import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App, { isValidAppConfig, setRuntimeConfig, type AppConfig } from "./App";
import fallbackConfig from "./config/order-config.json";
import "./index.css";

const DEFAULT_CATALOG_URL = "/catalog/order-config.json";

function resolveCatalogUrl(): string {
  const raw = (import.meta.env.VITE_MENU_CONFIG_URL ?? DEFAULT_CATALOG_URL).trim();
  return raw || DEFAULT_CATALOG_URL;
}

async function loadCatalogConfig(): Promise<void> {
  const fallback = fallbackConfig as AppConfig;
  const catalogUrl = resolveCatalogUrl();

  try {
    const response = await fetch(catalogUrl, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const payload: unknown = await response.json();
    if (!isValidAppConfig(payload)) {
      throw new Error("Invalid catalog schema");
    }

    setRuntimeConfig(payload);
    return;
  } catch (error) {
    console.warn(`[catalog] Failed to load ${catalogUrl}. Using bundled fallback config.`, error);
    setRuntimeConfig(fallback);
  }
}

async function bootstrap(): Promise<void> {
  await loadCatalogConfig();

  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </StrictMode>,
  );
}

void bootstrap();

interface Env {
  PUSHOVER_APP_TOKEN: string;
  PUSHOVER_USER_KEY: string;
  ALLOWED_ORIGINS?: string;
  NOTIFY_RATE_LIMIT_PER_MINUTE?: string;
  PUSHOVER_TIMEOUT_MS?: string;
}

interface NotifyBody {
  title: string;
  message: string;
}

const DEFAULT_RATE_LIMIT_PER_MINUTE = 8;
const RATE_LIMIT_WINDOW_MS = 60_000;
const DEFAULT_PUSHOVER_TIMEOUT_MS = 8_000;
const MIN_TIMEOUT_MS = 2_000;
const MAX_TIMEOUT_MS = 20_000;
const MAX_TITLE_LENGTH = 100;
const MAX_MESSAGE_LENGTH = 1_024;

const rateLimitBuckets = new Map<string, { count: number; startedAtMs: number }>();

function parseBoundedInteger(
  input: string | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  const parsed = Number.parseInt(input ?? "", 10);
  if (Number.isNaN(parsed)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, parsed));
}

function resolveRequestOrigin(request: Request): string | null {
  const directOrigin = request.headers.get("Origin");
  if (directOrigin) {
    return directOrigin;
  }

  const referer = request.headers.get("Referer");
  if (!referer) {
    return null;
  }

  try {
    return new URL(referer).origin;
  } catch {
    return null;
  }
}

function parseAllowedOrigins(request: Request, rawAllowedOrigins?: string): Set<string> {
  const configuredOrigins = (rawAllowedOrigins ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .flatMap((value) => {
      try {
        return [new URL(value).origin];
      } catch {
        return [];
      }
    });

  // Default to same-origin only when no explicit allowlist is configured.
  const defaults = configuredOrigins.length === 0 ? [new URL(request.url).origin] : [];
  return new Set([...defaults, ...configuredOrigins]);
}

function buildCorsHeaders(allowedOrigin: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
  };

  if (allowedOrigin) {
    headers["Access-Control-Allow-Origin"] = allowedOrigin;
    headers.Vary = "Origin";
  }

  return headers;
}

function json(data: unknown, status = 200, corsHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

function getClientIp(request: Request): string {
  const connectingIp = request.headers.get("CF-Connecting-IP");
  if (connectingIp) {
    return connectingIp;
  }

  const forwardedFor = request.headers.get("X-Forwarded-For");
  if (forwardedFor) {
    const firstIp = forwardedFor.split(",")[0]?.trim();
    if (firstIp) {
      return firstIp;
    }
  }

  return "unknown";
}

function isRateLimited(clientIp: string, limitPerMinute: number): boolean {
  const now = Date.now();
  const bucket = rateLimitBuckets.get(clientIp);

  if (!bucket || now - bucket.startedAtMs >= RATE_LIMIT_WINDOW_MS) {
    rateLimitBuckets.set(clientIp, { count: 1, startedAtMs: now });
    return false;
  }

  if (bucket.count >= limitPerMinute) {
    return true;
  }

  bucket.count += 1;

  if (rateLimitBuckets.size > 5_000) {
    for (const [ip, value] of rateLimitBuckets) {
      if (now - value.startedAtMs >= RATE_LIMIT_WINDOW_MS) {
        rateLimitBuckets.delete(ip);
      }
    }
  }

  return false;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function parseNotifyBody(request: Request): Promise<{ value: NotifyBody } | { error: string }> {
  let parsed: unknown;
  try {
    parsed = await request.json();
  } catch {
    return { error: "Invalid JSON body" };
  }

  if (!isObjectRecord(parsed)) {
    return { error: "Invalid JSON body" };
  }

  const rawTitle = parsed.title;
  const rawMessage = parsed.message;

  if (typeof rawTitle !== "string" || typeof rawMessage !== "string") {
    return { error: "title and message are required" };
  }

  const title = rawTitle.trim().slice(0, MAX_TITLE_LENGTH);
  const message = rawMessage.trim().slice(0, MAX_MESSAGE_LENGTH);

  if (!title || !message) {
    return { error: "title and message are required" };
  }

  return { value: { title, message } };
}

function isAbortError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }
  return "name" in error && (error as { name?: string }).name === "AbortError";
}

function getAllowedOriginForRequest(request: Request, env: Env): string | null {
  const requestOrigin = resolveRequestOrigin(request);
  if (!requestOrigin) {
    return null;
  }

  const allowedOrigins = parseAllowedOrigins(request, env.ALLOWED_ORIGINS);
  return allowedOrigins.has(requestOrigin) ? requestOrigin : null;
}

function getPushoverTimeoutMs(env: Env): number {
  return parseBoundedInteger(
    env.PUSHOVER_TIMEOUT_MS,
    DEFAULT_PUSHOVER_TIMEOUT_MS,
    MIN_TIMEOUT_MS,
    MAX_TIMEOUT_MS,
  );
}

function getRateLimitPerMinute(env: Env): number {
  return parseBoundedInteger(env.NOTIFY_RATE_LIMIT_PER_MINUTE, DEFAULT_RATE_LIMIT_PER_MINUTE, 1, 60);
}

export const onRequestOptions: PagesFunction<Env> = async ({ request, env }) => {
  const allowedOrigin = getAllowedOriginForRequest(request, env);
  if (!allowedOrigin) {
    return new Response(null, { status: 403 });
  }

  return new Response(null, { status: 204, headers: buildCorsHeaders(allowedOrigin) });
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const allowedOrigin = getAllowedOriginForRequest(request, env);
  if (!allowedOrigin) {
    return json({ ok: false, error: "Forbidden origin" }, 403);
  }

  if (!env.PUSHOVER_APP_TOKEN || !env.PUSHOVER_USER_KEY) {
    return json({ ok: false, error: "Pushover credentials not configured" }, 500, buildCorsHeaders(allowedOrigin));
  }

  const rateLimitPerMinute = getRateLimitPerMinute(env);
  const clientIp = getClientIp(request);
  if (isRateLimited(clientIp, rateLimitPerMinute)) {
    return json(
      { ok: false, error: "Too many requests. Please wait and try again." },
      429,
      buildCorsHeaders(allowedOrigin),
    );
  }

  const parsedBody = await parseNotifyBody(request);
  if ("error" in parsedBody) {
    return json({ ok: false, error: parsedBody.error }, 400, buildCorsHeaders(allowedOrigin));
  }

  const form = new URLSearchParams({
    token: env.PUSHOVER_APP_TOKEN,
    user: env.PUSHOVER_USER_KEY,
    title: parsedBody.value.title,
    message: parsedBody.value.message,
    priority: "2",
    retry: "30",
    expire: "600",
    sound: "persistent",
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), getPushoverTimeoutMs(env));

  let pushoverRes: Response;
  try {
    pushoverRes = await fetch("https://api.pushover.net/1/messages.json", {
      method: "POST",
      body: form,
      signal: controller.signal,
    });
  } catch (error) {
    if (isAbortError(error)) {
      return json(
        { ok: false, error: "Notification timeout. Please try again." },
        504,
        buildCorsHeaders(allowedOrigin),
      );
    }

    console.error("Pushover request failed", error);
    return json(
      { ok: false, error: "Notification request failed. Please try again." },
      502,
      buildCorsHeaders(allowedOrigin),
    );
  } finally {
    clearTimeout(timeout);
  }

  if (!pushoverRes.ok) {
    const providerBody = await pushoverRes.text();
    console.error("Pushover rejected notification", {
      status: pushoverRes.status,
      body: providerBody.slice(0, 500),
    });
    return json(
      { ok: false, error: "Notification provider rejected request." },
      502,
      buildCorsHeaders(allowedOrigin),
    );
  }

  return json({ ok: true }, 200, buildCorsHeaders(allowedOrigin));
};

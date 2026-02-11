interface Env {
  PUSHOVER_APP_TOKEN: string;
  PUSHOVER_USER_KEY: string;
  ALLOWED_ORIGINS?: string;
  NOTIFY_RATE_LIMIT_PER_MINUTE?: string;
  PUSHOVER_TIMEOUT_MS?: string;
  NOTIFY_SIGNING_SECRET?: string;
  NOTIFY_AUTH_TTL_SECONDS?: string;
}

interface NotifyBody {
  title: string;
  message: string;
  locationToken: string;
  authToken: string;
}

interface NotifyAuthPayload {
  v: 1;
  loc: string;
  exp: number;
}

const DEFAULT_RATE_LIMIT_PER_MINUTE = 8;
const RATE_LIMIT_WINDOW_MS = 60_000;
const DEFAULT_PUSHOVER_TIMEOUT_MS = 8_000;
const MIN_TIMEOUT_MS = 2_000;
const MAX_TIMEOUT_MS = 20_000;
const MAX_TITLE_LENGTH = 100;
const MAX_MESSAGE_LENGTH = 1_024;
const MAX_LOCATION_TOKEN_LENGTH = 80;
const MAX_AUTH_TOKEN_LENGTH = 2_048;
const MAX_JSON_BODY_BYTES = 8_192;
const DEFAULT_NOTIFY_AUTH_TTL_SECONDS = 600;
const MIN_NOTIFY_AUTH_TTL_SECONDS = 60;
const MAX_NOTIFY_AUTH_TTL_SECONDS = 3_600;

const rateLimitBuckets = new Map<string, { count: number; startedAtMs: number }>();
const signingKeyCache = new Map<string, Promise<CryptoKey>>();
const encoder = new TextEncoder();
const decoder = new TextDecoder();

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
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
  };

  if (allowedOrigin) {
    headers["Access-Control-Allow-Origin"] = allowedOrigin;
    headers.Vary = "Origin";
  }

  return headers;
}

function json(
  data: unknown,
  status = 200,
  corsHeaders: Record<string, string> = {},
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders, ...extraHeaders },
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

function isValidLocationToken(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= MAX_LOCATION_TOKEN_LENGTH &&
    /^[A-Za-z0-9_-]+$/.test(value)
  );
}

function getSigningSecret(env: Env): string | null {
  const explicitSecret = env.NOTIFY_SIGNING_SECRET?.trim();
  if (explicitSecret) {
    return explicitSecret;
  }

  if (env.PUSHOVER_APP_TOKEN && env.PUSHOVER_USER_KEY) {
    return `${env.PUSHOVER_APP_TOKEN}:${env.PUSHOVER_USER_KEY}`;
  }

  return null;
}

function getNotifyAuthTtlSeconds(env: Env): number {
  return parseBoundedInteger(
    env.NOTIFY_AUTH_TTL_SECONDS,
    DEFAULT_NOTIFY_AUTH_TTL_SECONDS,
    MIN_NOTIFY_AUTH_TTL_SECONDS,
    MAX_NOTIFY_AUTH_TTL_SECONDS,
  );
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBytes(value: string): Uint8Array | null {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padding = "=".repeat((4 - (normalized.length % 4)) % 4);

  let binary: string;
  try {
    binary = atob(normalized + padding);
  } catch {
    return null;
  }

  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function getSigningKey(secret: string): Promise<CryptoKey> {
  const cached = signingKeyCache.get(secret);
  if (cached) {
    return cached;
  }

  const keyPromise = crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
  signingKeyCache.set(secret, keyPromise);
  return keyPromise;
}

async function signEncodedPayload(payloadEncoded: string, secret: string): Promise<string> {
  const key = await getSigningKey(secret);
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(payloadEncoded));
  return bytesToBase64Url(new Uint8Array(signature));
}

async function verifyEncodedPayloadSignature(
  payloadEncoded: string,
  signatureEncoded: string,
  secret: string,
): Promise<boolean> {
  const signatureBytes = base64UrlToBytes(signatureEncoded);
  if (!signatureBytes) {
    return false;
  }

  const key = await getSigningKey(secret);
  const signatureBuffer = signatureBytes.buffer.slice(
    signatureBytes.byteOffset,
    signatureBytes.byteOffset + signatureBytes.byteLength,
  );
  return crypto.subtle.verify("HMAC", key, signatureBuffer, encoder.encode(payloadEncoded));
}

async function issueNotifyAuthToken(
  locationToken: string,
  env: Env,
): Promise<{ authToken: string; expiresAtMs: number } | null> {
  const signingSecret = getSigningSecret(env);
  if (!signingSecret) {
    return null;
  }

  const expiresAtMs = Date.now() + getNotifyAuthTtlSeconds(env) * 1_000;
  const payload: NotifyAuthPayload = {
    v: 1,
    loc: locationToken,
    exp: expiresAtMs,
  };
  const payloadEncoded = bytesToBase64Url(encoder.encode(JSON.stringify(payload)));
  const signatureEncoded = await signEncodedPayload(payloadEncoded, signingSecret);
  return {
    authToken: `${payloadEncoded}.${signatureEncoded}`,
    expiresAtMs,
  };
}

function parseNotifyAuthToken(
  authToken: string,
): { payloadEncoded: string; signatureEncoded: string; payload: NotifyAuthPayload } | null {
  const [payloadEncoded, signatureEncoded, extra] = authToken.split(".");
  if (!payloadEncoded || !signatureEncoded || extra !== undefined) {
    return null;
  }

  const payloadBytes = base64UrlToBytes(payloadEncoded);
  if (!payloadBytes) {
    return null;
  }

  let payloadValue: unknown;
  try {
    payloadValue = JSON.parse(decoder.decode(payloadBytes));
  } catch {
    return null;
  }

  if (!isObjectRecord(payloadValue)) {
    return null;
  }

  if (
    payloadValue.v !== 1 ||
    typeof payloadValue.loc !== "string" ||
    !isValidLocationToken(payloadValue.loc) ||
    typeof payloadValue.exp !== "number" ||
    !Number.isFinite(payloadValue.exp)
  ) {
    return null;
  }

  return {
    payloadEncoded,
    signatureEncoded,
    payload: {
      v: 1,
      loc: payloadValue.loc,
      exp: Math.floor(payloadValue.exp),
    },
  };
}

async function verifyNotifyAuthToken(
  authToken: string,
  expectedLocationToken: string,
  env: Env,
): Promise<boolean> {
  const signingSecret = getSigningSecret(env);
  if (!signingSecret) {
    return false;
  }

  const parsedToken = parseNotifyAuthToken(authToken);
  if (!parsedToken) {
    return false;
  }

  if (parsedToken.payload.loc !== expectedLocationToken) {
    return false;
  }

  if (parsedToken.payload.exp <= Date.now()) {
    return false;
  }

  return verifyEncodedPayloadSignature(
    parsedToken.payloadEncoded,
    parsedToken.signatureEncoded,
    signingSecret,
  );
}

function readContentLength(request: Request): number | null {
  const value = request.headers.get("Content-Length");
  if (!value) {
    return null;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }

  return parsed;
}

async function parseNotifyBody(
  request: Request,
): Promise<{ value: NotifyBody } | { error: string; status: number }> {
  const contentType = request.headers.get("Content-Type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return { error: "Content-Type must be application/json", status: 415 };
  }

  const contentLength = readContentLength(request);
  if (contentLength !== null && contentLength > MAX_JSON_BODY_BYTES) {
    return { error: "Request body too large", status: 413 };
  }

  let rawBody = "";
  try {
    rawBody = await request.text();
  } catch {
    return { error: "Invalid request body", status: 400 };
  }

  const bodyByteLength = encoder.encode(rawBody).byteLength;
  if (bodyByteLength > MAX_JSON_BODY_BYTES) {
    return { error: "Request body too large", status: 413 };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return { error: "Invalid JSON body", status: 400 };
  }

  if (!isObjectRecord(parsed)) {
    return { error: "Invalid JSON body", status: 400 };
  }

  const rawTitle = parsed.title;
  const rawMessage = parsed.message;
  const rawLocationToken = parsed.locationToken;
  const rawAuthToken = parsed.authToken;

  if (
    typeof rawTitle !== "string" ||
    typeof rawMessage !== "string" ||
    typeof rawLocationToken !== "string" ||
    typeof rawAuthToken !== "string"
  ) {
    return { error: "title, message, locationToken and authToken are required", status: 400 };
  }

  const title = rawTitle.trim().slice(0, MAX_TITLE_LENGTH);
  const message = rawMessage.trim().slice(0, MAX_MESSAGE_LENGTH);
  const locationToken = rawLocationToken.trim();
  const authToken = rawAuthToken.trim();

  if (!title || !message) {
    return { error: "title and message are required", status: 400 };
  }

  if (!isValidLocationToken(locationToken)) {
    return { error: "Invalid locationToken", status: 400 };
  }

  if (!authToken || authToken.length > MAX_AUTH_TOKEN_LENGTH) {
    return { error: "Invalid authToken", status: 400 };
  }

  return { value: { title, message, locationToken, authToken } };
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

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const allowedOrigin = getAllowedOriginForRequest(request, env);
  if (!allowedOrigin) {
    return json({ ok: false, error: "Forbidden origin" }, 403);
  }

  const signingSecret = getSigningSecret(env);
  if (!signingSecret) {
    return json(
      { ok: false, error: "Notify signing secret not configured" },
      500,
      buildCorsHeaders(allowedOrigin),
    );
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

  const url = new URL(request.url);
  const locationToken = url.searchParams.get("locationToken")?.trim() ?? "";
  if (!isValidLocationToken(locationToken)) {
    return json({ ok: false, error: "Invalid locationToken" }, 400, buildCorsHeaders(allowedOrigin));
  }

  const token = await issueNotifyAuthToken(locationToken, env);
  if (!token) {
    return json(
      { ok: false, error: "Notify signing secret not configured" },
      500,
      buildCorsHeaders(allowedOrigin),
    );
  }

  return json(
    { ok: true, authToken: token.authToken, expiresAtMs: token.expiresAtMs },
    200,
    buildCorsHeaders(allowedOrigin),
    { "Cache-Control": "no-store" },
  );
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const allowedOrigin = getAllowedOriginForRequest(request, env);
  if (!allowedOrigin) {
    return json({ ok: false, error: "Forbidden origin" }, 403);
  }

  if (!env.PUSHOVER_APP_TOKEN || !env.PUSHOVER_USER_KEY) {
    return json({ ok: false, error: "Pushover credentials not configured" }, 500, buildCorsHeaders(allowedOrigin));
  }

  const signingSecret = getSigningSecret(env);
  if (!signingSecret) {
    return json(
      { ok: false, error: "Notify signing secret not configured" },
      500,
      buildCorsHeaders(allowedOrigin),
    );
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
    return json(
      { ok: false, error: parsedBody.error },
      parsedBody.status,
      buildCorsHeaders(allowedOrigin),
    );
  }

  const authValid = await verifyNotifyAuthToken(
    parsedBody.value.authToken,
    parsedBody.value.locationToken,
    env,
  );
  if (!authValid) {
    return json(
      { ok: false, error: "Unauthorized request" },
      401,
      buildCorsHeaders(allowedOrigin),
    );
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

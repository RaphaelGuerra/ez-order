interface Env {
  PUSHOVER_APP_TOKEN: string;
  PUSHOVER_USER_KEY: string;
}

interface NotifyBody {
  title: string;
  message: string;
}

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

export const onRequestOptions: PagesFunction<Env> = async () => {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!env.PUSHOVER_APP_TOKEN || !env.PUSHOVER_USER_KEY) {
    return json({ ok: false, error: "Pushover credentials not configured" }, 500);
  }

  let body: NotifyBody;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "Invalid JSON body" }, 400);
  }

  if (!body.title || !body.message) {
    return json({ ok: false, error: "title and message are required" }, 400);
  }

  const message = body.message.length > 1024 ? body.message.slice(0, 1024) : body.message;

  const form = new URLSearchParams({
    token: env.PUSHOVER_APP_TOKEN,
    user: env.PUSHOVER_USER_KEY,
    title: body.title,
    message,
    priority: "2",
    retry: "30",
    expire: "600",
    sound: "persistent",
  });

  const pushoverRes = await fetch("https://api.pushover.net/1/messages.json", {
    method: "POST",
    body: form,
  });

  if (!pushoverRes.ok) {
    const text = await pushoverRes.text();
    return json({ ok: false, error: `Pushover error: ${text}` }, 502);
  }

  return json({ ok: true });
};

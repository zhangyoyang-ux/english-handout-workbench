import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

type Stage1Note = {
  id: string;
  title: string;
  content: string;
  created_at: string;
  updated_at: string;
};

type NotePayload = {
  id?: string;
  title?: unknown;
  content?: unknown;
};

const MAX_TITLE_LENGTH = 200;
const MAX_CONTENT_LENGTH = 200_000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const allowedOrigins = new Set([
  "https://zhangyoyang-ux.github.io",
  "http://localhost:5173",
  "http://127.0.0.1:4173",
  ...(Deno.env.get("ALLOWED_ORIGINS") ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
]);

function responseHeaders(request: Request) {
  const origin = request.headers.get("Origin");
  return {
    "Access-Control-Allow-Origin": origin && allowedOrigins.has(origin)
      ? origin
      : "https://zhangyoyang-ux.github.io",
    "Access-Control-Allow-Headers": "content-type",
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, OPTIONS",
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    Vary: "Origin",
  };
}

function json(request: Request, status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: responseHeaders(request),
  });
}

function originIsAllowed(request: Request) {
  const origin = request.headers.get("Origin");
  return !origin || allowedOrigins.has(origin);
}

function getSupabaseClient(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!url || !serviceRoleKey) {
    throw new Error("Supabase server environment variables are not configured.");
  }

  return createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function validatePayload(payload: NotePayload) {
  if (typeof payload.title !== "string" || typeof payload.content !== "string") {
    return "标题和正文必须是文字。";
  }

  if (payload.title.length > MAX_TITLE_LENGTH) {
    return `标题不能超过 ${MAX_TITLE_LENGTH} 个字符。`;
  }

  if (payload.content.length > MAX_CONTENT_LENGTH) {
    return `正文不能超过 ${MAX_CONTENT_LENGTH} 个字符。`;
  }

  if (payload.id !== undefined && (typeof payload.id !== "string" || !UUID_PATTERN.test(payload.id))) {
    return "知识记录 ID 格式不正确。";
  }

  return null;
}

async function readLatestNote(client: SupabaseClient) {
  return client
    .from("stage1_notes")
    .select("id,title,content,created_at,updated_at")
    .order("updated_at", { ascending: false })
    .limit(1);
}

Deno.serve(async (request) => {
  if (!originIsAllowed(request)) {
    return json(request, 403, {
      ok: false,
      error: { code: "CORS_ORIGIN_NOT_ALLOWED", message: "请求来源不被允许。" },
    });
  }

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: responseHeaders(request) });
  }

  if (!["GET", "POST", "PUT", "PATCH"].includes(request.method)) {
    return json(request, 405, {
      ok: false,
      error: { code: "METHOD_NOT_ALLOWED", message: "不支持该请求方法。" },
    });
  }

  let client: SupabaseClient;
  try {
    client = getSupabaseClient();
  } catch {
    return json(request, 503, {
      ok: false,
      error: {
        code: "SERVER_CONFIG_ERROR",
        message: "Edge Function 服务端数据库尚未配置。",
      },
    });
  }

  if (request.method === "GET") {
    try {
      const { data, error } = await readLatestNote(client);
      if (error) {
        return json(request, 500, {
          ok: false,
          error: { code: "DATABASE_READ_ERROR", message: "读取云端内容失败。" },
        });
      }

      return json(request, 200, {
        ok: true,
        note: (data?.[0] as Stage1Note | undefined) ?? null,
      });
    } catch {
      return json(request, 500, {
        ok: false,
        error: { code: "SERVICE_ERROR", message: "读取服务暂时不可用。" },
      });
    }
  }

  let payload: NotePayload;
  try {
    payload = await request.json() as NotePayload;
  } catch {
    return json(request, 400, {
      ok: false,
      error: { code: "INVALID_JSON", message: "请求内容不是有效 JSON。" },
    });
  }

  const validationError = validatePayload(payload);
  if (validationError) {
    return json(request, 400, {
      ok: false,
      error: { code: "VALIDATION_ERROR", message: validationError },
    });
  }

  const values = {
    ...(payload.id ? { id: payload.id } : {}),
    title: payload.title as string,
    content: payload.content as string,
  };

  try {
    const { data, error } = await client
      .from("stage1_notes")
      .upsert(values, { onConflict: "id" })
      .select("id,title,content,created_at,updated_at")
      .single();

    if (error) {
      return json(request, 500, {
        ok: false,
        error: { code: "DATABASE_WRITE_ERROR", message: "保存到云端失败。" },
      });
    }

    return json(request, 200, { ok: true, note: data as Stage1Note });
  } catch {
    return json(request, 500, {
      ok: false,
      error: { code: "SERVICE_ERROR", message: "保存服务暂时不可用。" },
    });
  }
});

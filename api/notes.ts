import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { VercelRequest, VercelResponse } from "@vercel/node";

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

function json(
  response: VercelResponse,
  status: number,
  body: Record<string, unknown>,
) {
  response.status(status).setHeader("Cache-Control", "no-store").json(body);
}

function getSupabaseClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error("Supabase server environment variables are not configured.");
  }

  return createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function parseBody(request: VercelRequest): NotePayload {
  if (typeof request.body === "string") {
    return JSON.parse(request.body) as NotePayload;
  }

  return (request.body ?? {}) as NotePayload;
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

  if (payload.id !== undefined && typeof payload.id !== "string") {
    return "知识记录 ID 格式不正确。";
  }

  if (payload.id !== undefined && !UUID_PATTERN.test(payload.id)) {
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

export default async function handler(
  request: VercelRequest,
  response: VercelResponse,
) {
  if (request.method === "OPTIONS") {
    response.status(204).end();
    return;
  }

  if (request.method !== "GET" && request.method !== "PUT") {
    response.setHeader("Allow", "GET, PUT, OPTIONS");
    json(response, 405, {
      ok: false,
      error: { code: "METHOD_NOT_ALLOWED", message: "不支持该请求方法。" },
    });
    return;
  }

  let client: SupabaseClient;
  try {
    client = getSupabaseClient();
  } catch {
    json(response, 503, {
      ok: false,
      error: {
        code: "SERVER_CONFIG_ERROR",
        message: "服务端数据库尚未配置，请检查 Supabase 环境变量。",
      },
    });
    return;
  }

  if (request.method === "GET") {
    try {
      const { data, error } = await readLatestNote(client);

      if (error) {
        json(response, 500, {
          ok: false,
          error: { code: "DATABASE_READ_ERROR", message: "读取云端内容失败。" },
        });
        return;
      }

      json(response, 200, { ok: true, note: (data?.[0] as Stage1Note | undefined) ?? null });
    } catch {
      json(response, 500, {
        ok: false,
        error: { code: "SERVICE_ERROR", message: "读取服务暂时不可用。" },
      });
    }
    return;
  }

  let payload: NotePayload;
  try {
    payload = parseBody(request);
  } catch {
    json(response, 400, {
      ok: false,
      error: { code: "INVALID_JSON", message: "请求内容不是有效 JSON。" },
    });
    return;
  }

  const validationError = validatePayload(payload);
  if (validationError) {
    json(response, 400, {
      ok: false,
      error: { code: "VALIDATION_ERROR", message: validationError },
    });
    return;
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
      json(response, 500, {
        ok: false,
        error: { code: "DATABASE_WRITE_ERROR", message: "保存到云端失败。" },
      });
      return;
    }

    json(response, 200, { ok: true, note: data as Stage1Note });
  } catch {
    json(response, 500, {
      ok: false,
      error: { code: "SERVICE_ERROR", message: "保存服务暂时不可用。" },
    });
  }
}

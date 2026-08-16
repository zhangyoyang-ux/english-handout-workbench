import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

type Stage1Note = {
  id: string;
  title: string;
  content: string;
  created_at: string;
  updated_at: string;
};

type Chapter = {
  id: string;
  title: string;
  parent_id: string | null;
  sort_order: number;
  content: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

type KnowledgePoint = {
  id: string;
  title: string;
  status: "draft" | "needs_improvement" | "organized";
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

type RichDocument = {
  type?: unknown;
  [key: string]: unknown;
};

type KnowledgePointContent = {
  id: string;
  knowledge_point_id: string;
  explanation: RichDocument;
  exercises: RichDocument;
  supplement: RichDocument;
  inspiration: RichDocument;
  created_at: string;
  updated_at: string;
};

type KnowledgePointPlacement = {
  id: string;
  knowledge_point_id: string;
  chapter_id: string;
  sort_order: number;
  created_at: string;
};

type NotePayload = {
  id?: unknown;
  title?: unknown;
  content?: unknown;
};

type ChapterPayload = {
  id?: unknown;
  title?: unknown;
  parent_id?: unknown;
  content?: unknown;
  operation?: unknown;
};

type KnowledgePointPayload = {
  id?: unknown;
  title?: unknown;
  status?: unknown;
  chapter_id?: unknown;
  placement_id?: unknown;
  explanation?: unknown;
  exercises?: unknown;
  supplement?: unknown;
  inspiration?: unknown;
};

type ReorderPayload = {
  parent_id?: unknown;
  chapter_id?: unknown;
  ids?: unknown;
};

const MAX_TITLE_LENGTH = 200;
const MAX_CONTENT_LENGTH = 200_000;
const MAX_RICH_DOCUMENT_LENGTH = 500_000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STATUS_VALUES = new Set(["draft", "needs_improvement", "organized"]);
const CONTENT_FIELDS = ["explanation", "exercises", "supplement", "inspiration"] as const;

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
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
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

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function isNonEmptyTitle(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= MAX_TITLE_LENGTH;
}

function isOptionalContent(value: unknown): value is string {
  return typeof value === "string" && value.length <= MAX_CONTENT_LENGTH;
}

function isRichDocument(value: unknown): value is RichDocument {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  if ((value as RichDocument).type !== "doc") return false;
  try {
    return JSON.stringify(value).length <= MAX_RICH_DOCUMENT_LENGTH;
  } catch {
    return false;
  }
}

function validationError(request: Request, message: string) {
  return json(request, 400, {
    ok: false,
    error: { code: "VALIDATION_ERROR", message },
  });
}

function databaseError(request: Request, error: unknown, fallback: string) {
  const message = typeof error === "object" && error !== null && "message" in error
    ? String(error.message)
    : String(error ?? "");

  if (message.includes("CHAPTER_CYCLE")) {
    return json(request, 409, {
      ok: false,
      error: { code: "CHAPTER_CYCLE", message: "不能把章节移动到自己或自己的后代下面。" },
    });
  }
  if (message.includes("CHAPTER_NOT_FOUND")) {
    return json(request, 404, {
      ok: false,
      error: { code: "CHAPTER_NOT_FOUND", message: "目标章节不存在或已删除。" },
    });
  }
  if (message.includes("KNOWLEDGE_POINT_NOT_FOUND")) {
    return json(request, 404, {
      ok: false,
      error: { code: "KNOWLEDGE_POINT_NOT_FOUND", message: "知识点不存在或已删除。" },
    });
  }
  if (message.includes("INVALID_CHAPTER_ORDER")) {
    return json(request, 400, {
      ok: false,
      error: { code: "INVALID_CHAPTER_ORDER", message: "章节排序数据无效。" },
    });
  }
  if (message.includes("INVALID_KNOWLEDGE_POINT_ORDER")) {
    return json(request, 400, {
      ok: false,
      error: { code: "INVALID_KNOWLEDGE_POINT_ORDER", message: "知识点排序数据无效。" },
    });
  }

  const validationCodes: Record<string, string> = {
    CHAPTER_TITLE_INVALID: "章节名称不能为空，且不能超过 200 个字符。",
    CHAPTER_PARENT_INVALID: "目标父章节无效。",
    KNOWLEDGE_POINT_PAYLOAD_INVALID: "知识点参数无效。",
    KNOWLEDGE_POINT_TITLE_INVALID: "知识点名称不能为空，且不能超过 200 个字符。",
    KNOWLEDGE_POINT_STATUS_INVALID: "知识点状态无效。",
    KNOWLEDGE_POINT_CREATE_ERROR: "知识点创建失败。",
    PLACEMENT_NOT_FOUND: "知识点位置不存在。",
    CONTENT_PAYLOAD_INVALID: "知识点内容格式无效。",
  };
  for (const [code, messageText] of Object.entries(validationCodes)) {
    if (message.includes(code)) {
      return json(request, 400, {
        ok: false,
        error: { code, message: messageText },
      });
    }
  }

  return json(request, 500, {
    ok: false,
    error: { code: "DATABASE_ERROR", message: fallback },
  });
}

async function parseBody(request: Request) {
  try {
    return await request.json() as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function readLatestNote(client: SupabaseClient) {
  return client
    .from("stage1_notes")
    .select("id,title,content,created_at,updated_at")
    .order("updated_at", { ascending: false })
    .limit(1);
}

async function readTree(client: SupabaseClient) {
  const [chaptersResult, pointsResult, placementsResult] = await Promise.all([
    client
      .from("chapters")
      .select("id,title,parent_id,sort_order,content,created_at,updated_at,deleted_at")
      .is("deleted_at", null)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true }),
    client
      .from("knowledge_points")
      .select("id,title,status,created_at,updated_at,deleted_at")
      .is("deleted_at", null)
      .order("created_at", { ascending: true }),
    client
      .from("knowledge_point_placements")
      .select("id,knowledge_point_id,chapter_id,sort_order,created_at")
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true }),
  ]);

  const error = chaptersResult.error ?? pointsResult.error ?? placementsResult.error;
  if (error) throw error;

  const chapterIds = new Set((chaptersResult.data ?? []).map((chapter) => chapter.id));
  const pointIds = new Set((pointsResult.data ?? []).map((point) => point.id));
  const placements = (placementsResult.data ?? []).filter((placement) =>
    chapterIds.has(placement.chapter_id) && pointIds.has(placement.knowledge_point_id)
  );

  return {
    chapters: (chaptersResult.data ?? []) as Chapter[],
    knowledge_points: (pointsResult.data ?? []) as KnowledgePoint[],
    knowledge_point_placements: placements as KnowledgePointPlacement[],
  };
}

async function readChapter(client: SupabaseClient, id: string) {
  return client
    .from("chapters")
    .select("id,title,parent_id,sort_order,content,created_at,updated_at,deleted_at")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
}

async function createChapter(client: SupabaseClient, payload: ChapterPayload) {
  if (!isNonEmptyTitle(payload.title)) throw new Error("CHAPTER_TITLE_INVALID");

  const parentId = payload.parent_id === null || payload.parent_id === undefined
    ? null
    : payload.parent_id;
  if (parentId !== null && !isUuid(parentId)) throw new Error("CHAPTER_PARENT_INVALID");

  if (parentId !== null) {
    const parent = await readChapter(client, parentId);
    if (parent.error) throw parent.error;
    if (!parent.data) throw new Error("CHAPTER_NOT_FOUND");
  }

  let sortQuery = client
    .from("chapters")
    .select("sort_order")
    .is("deleted_at", null)
    .order("sort_order", { ascending: false })
    .limit(1);
  sortQuery = parentId === null ? sortQuery.is("parent_id", null) : sortQuery.eq("parent_id", parentId);
  const { data: sortData, error: sortError } = await sortQuery;
  if (sortError) throw sortError;

  const { data, error } = await client
    .from("chapters")
    .insert({
      title: payload.title.trim(),
      parent_id: parentId,
      sort_order: (sortData?.[0]?.sort_order ?? -1) + 1,
      content: isOptionalContent(payload.content) ? payload.content : "",
    })
    .select("id,title,parent_id,sort_order,content,created_at,updated_at,deleted_at")
    .single();
  if (error) throw error;
  return data as Chapter;
}

async function descendantsOf(client: SupabaseClient, id: string) {
  const { data, error } = await client
    .from("chapters")
    .select("id,parent_id")
    .is("deleted_at", null);
  if (error) throw error;

  const all = (data ?? []) as Array<{ id: string; parent_id: string | null }>;
  const ids = new Set([id]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const chapter of all) {
      if (chapter.parent_id && ids.has(chapter.parent_id) && !ids.has(chapter.id)) {
        ids.add(chapter.id);
        changed = true;
      }
    }
  }
  return ids;
}

async function deleteChapter(client: SupabaseClient, id: string, confirm: boolean) {
  const chapter = await readChapter(client, id);
  if (chapter.error) throw chapter.error;
  if (!chapter.data) throw new Error("CHAPTER_NOT_FOUND");

  const ids = [...await descendantsOf(client, id)];
  const { data: placements, error: placementError } = await client
    .from("knowledge_point_placements")
    .select("id")
    .in("chapter_id", ids);
  if (placementError) throw placementError;

  const childCount = Math.max(ids.length - 1, 0);
  const knowledgePointCount = placements?.length ?? 0;
  if (!confirm && (childCount > 0 || knowledgePointCount > 0)) {
    return { blocked: true, childCount, knowledgePointCount };
  }

  const { error } = await client
    .from("chapters")
    .update({ deleted_at: new Date().toISOString() })
    .in("id", ids);
  if (error) throw error;
  return { blocked: false, childCount, knowledgePointCount };
}

async function createKnowledgePoint(client: SupabaseClient, payload: KnowledgePointPayload) {
  if (!isNonEmptyTitle(payload.title) || !isUuid(payload.chapter_id)) {
    throw new Error("KNOWLEDGE_POINT_PAYLOAD_INVALID");
  }

  const { data, error } = await client.rpc("create_knowledge_point_with_placement", {
    p_title: payload.title.trim(),
    p_chapter_id: payload.chapter_id,
  });
  if (error) throw error;

  const result = Array.isArray(data) ? data[0] : data;
  if (!result?.knowledge_point_id || !result?.placement_id) {
    throw new Error("KNOWLEDGE_POINT_CREATE_ERROR");
  }

  const { data: point, error: pointError } = await client
    .from("knowledge_points")
    .select("id,title,status,created_at,updated_at,deleted_at")
    .eq("id", result.knowledge_point_id)
    .single();
  if (pointError) throw pointError;

  const { data: placement, error: placementError } = await client
    .from("knowledge_point_placements")
    .select("id,knowledge_point_id,chapter_id,sort_order,created_at")
    .eq("id", result.placement_id)
    .single();
  if (placementError) throw placementError;

  return { point: point as KnowledgePoint, placement: placement as KnowledgePointPlacement };
}

async function updateKnowledgePoint(client: SupabaseClient, id: string, payload: KnowledgePointPayload) {
  const values: Record<string, string> = {};
  if (payload.title !== undefined) {
    if (!isNonEmptyTitle(payload.title)) throw new Error("KNOWLEDGE_POINT_TITLE_INVALID");
    values.title = payload.title.trim();
  }
  if (payload.status !== undefined) {
    if (typeof payload.status !== "string" || !STATUS_VALUES.has(payload.status)) {
      throw new Error("KNOWLEDGE_POINT_STATUS_INVALID");
    }
    values.status = payload.status;
  }
  if (Object.keys(values).length === 0) throw new Error("KNOWLEDGE_POINT_PAYLOAD_INVALID");

  const { data, error } = await client
    .from("knowledge_points")
    .update(values)
    .eq("id", id)
    .is("deleted_at", null)
    .select("id,title,status,created_at,updated_at,deleted_at")
    .single();
  if (error) throw error;
  return data as KnowledgePoint;
}

async function readKnowledgePointContent(client: SupabaseClient, id: string) {
  if (!isUuid(id)) throw new Error("CONTENT_PAYLOAD_INVALID");

  const { data: point, error: pointError } = await client
    .from("knowledge_points")
    .select("id,title,status,created_at,updated_at,deleted_at")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (pointError) throw pointError;
  if (!point) throw new Error("KNOWLEDGE_POINT_NOT_FOUND");

  const { data: content, error: contentError } = await client
    .from("knowledge_point_contents")
    .select("id,knowledge_point_id,explanation,exercises,supplement,inspiration,created_at,updated_at")
    .eq("knowledge_point_id", id)
    .maybeSingle();
  if (contentError) throw contentError;

  return {
    knowledge_point: point as KnowledgePoint,
    content: (content as KnowledgePointContent | null) ?? null,
  };
}

async function updateKnowledgePointContent(client: SupabaseClient, id: string, payload: KnowledgePointPayload) {
  if (!isUuid(id)) throw new Error("CONTENT_PAYLOAD_INVALID");

  const { data: point, error: pointError } = await client
    .from("knowledge_points")
    .select("id")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (pointError) throw pointError;
  if (!point) throw new Error("KNOWLEDGE_POINT_NOT_FOUND");

  const values: Record<string, RichDocument> = {};
  for (const field of CONTENT_FIELDS) {
    if (payload[field] !== undefined) {
      if (!isRichDocument(payload[field])) throw new Error("CONTENT_PAYLOAD_INVALID");
      values[field] = payload[field];
    }
  }
  if (Object.keys(values).length === 0) throw new Error("CONTENT_PAYLOAD_INVALID");

  const { data, error } = await client
    .from("knowledge_point_contents")
    .upsert({ knowledge_point_id: id, ...values }, { onConflict: "knowledge_point_id" })
    .select("id,knowledge_point_id,explanation,exercises,supplement,inspiration,created_at,updated_at")
    .single();
  if (error) throw error;
  return data as KnowledgePointContent;
}

async function moveKnowledgePoint(client: SupabaseClient, placementId: string, chapterId: string) {
  if (!isUuid(chapterId)) throw new Error("CHAPTER_PARENT_INVALID");
  const chapter = await readChapter(client, chapterId);
  if (chapter.error) throw chapter.error;
  if (!chapter.data) throw new Error("CHAPTER_NOT_FOUND");

  const { data: placement, error: placementError } = await client
    .from("knowledge_point_placements")
    .select("id,knowledge_point_id,chapter_id,sort_order,created_at")
    .eq("id", placementId)
    .maybeSingle();
  if (placementError) throw placementError;
  if (!placement) throw new Error("PLACEMENT_NOT_FOUND");

  const { data: maxSort, error: sortError } = await client
    .from("knowledge_point_placements")
    .select("sort_order")
    .eq("chapter_id", chapterId)
    .order("sort_order", { ascending: false })
    .limit(1);
  if (sortError) throw sortError;

  const { data, error } = await client
    .from("knowledge_point_placements")
    .update({ chapter_id: chapterId, sort_order: (maxSort?.[0]?.sort_order ?? -1) + 1 })
    .eq("id", placementId)
    .select("id,knowledge_point_id,chapter_id,sort_order,created_at")
    .single();
  if (error) throw error;
  return data as KnowledgePointPlacement;
}

async function reorderChapters(client: SupabaseClient, payload: ReorderPayload) {
  if (payload.parent_id !== null && payload.parent_id !== undefined && !isUuid(payload.parent_id)) {
    throw new Error("CHAPTER_PARENT_INVALID");
  }
  if (!Array.isArray(payload.ids) || !payload.ids.every(isUuid)) throw new Error("INVALID_CHAPTER_ORDER");
  const { error } = await client.rpc("reorder_chapter_siblings", {
    p_parent_id: payload.parent_id ?? null,
    p_ids: payload.ids,
  });
  if (error) throw error;
}

async function reorderKnowledgePoints(client: SupabaseClient, payload: ReorderPayload) {
  if (!isUuid(payload.chapter_id) || !Array.isArray(payload.ids) || !payload.ids.every(isUuid)) {
    throw new Error("INVALID_KNOWLEDGE_POINT_ORDER");
  }
  const { error } = await client.rpc("reorder_knowledge_point_placements", {
    p_chapter_id: payload.chapter_id,
    p_ids: payload.ids,
  });
  if (error) throw error;
}

async function handleNote(request: Request, client: SupabaseClient) {
  if (request.method === "GET") {
    const { data, error } = await readLatestNote(client);
    if (error) {
      return json(request, 500, {
        ok: false,
        error: { code: "DATABASE_READ_ERROR", message: "读取云端内容失败。" },
      });
    }
    return json(request, 200, { ok: true, note: (data?.[0] as Stage1Note | undefined) ?? null });
  }

  if (!["POST", "PUT", "PATCH"].includes(request.method)) {
    return json(request, 405, {
      ok: false,
      error: { code: "METHOD_NOT_ALLOWED", message: "不支持该请求方法。" },
    });
  }

  const payload = await parseBody(request) as NotePayload | null;
  if (!payload || typeof payload.title !== "string" || typeof payload.content !== "string") {
    return validationError(request, "标题和正文必须是文字。");
  }
  if (payload.title.length > MAX_TITLE_LENGTH || payload.content.length > MAX_CONTENT_LENGTH) {
    return validationError(request, "标题或正文超过长度限制。");
  }
  if (payload.id !== undefined && !isUuid(payload.id)) return validationError(request, "知识记录 ID 格式不正确。");

  const { data, error } = await client
    .from("stage1_notes")
    .upsert({
      ...(payload.id ? { id: payload.id } : {}),
      title: payload.title,
      content: payload.content,
    }, { onConflict: "id" })
    .select("id,title,content,created_at,updated_at")
    .single();
  if (error) {
    return json(request, 500, {
      ok: false,
      error: { code: "DATABASE_WRITE_ERROR", message: "保存到云端失败。" },
    });
  }
  return json(request, 200, { ok: true, note: data as Stage1Note });
}

async function handlePhase2(request: Request, client: SupabaseClient, resource: string) {
  if (request.method === "GET" && resource === "tree") {
    return json(request, 200, { ok: true, ...(await readTree(client)) });
  }

  if (request.method === "GET" && resource === "content") {
    const id = new URL(request.url).searchParams.get("id");
    if (!isUuid(id)) return validationError(request, "知识点内容参数无效。");
    return json(request, 200, { ok: true, ...(await readKnowledgePointContent(client, id)) });
  }

  if (request.method === "PATCH" && resource === "content") {
    const id = new URL(request.url).searchParams.get("id");
    const payload = await parseBody(request) as KnowledgePointPayload | null;
    if (!payload || !isUuid(id)) return validationError(request, "知识点内容参数无效。");
    return json(request, 200, {
      ok: true,
      content: await updateKnowledgePointContent(client, id, payload),
    });
  }

  if (request.method === "POST" && resource === "chapter") {
    const payload = await parseBody(request) as ChapterPayload | null;
    if (!payload) return validationError(request, "请求内容不是有效 JSON。");
    return json(request, 201, { ok: true, chapter: await createChapter(client, payload) });
  }

  if (request.method === "POST" && resource === "knowledge_point") {
    const payload = await parseBody(request) as KnowledgePointPayload | null;
    if (!payload) return validationError(request, "请求内容不是有效 JSON。");
    return json(request, 201, { ok: true, ...(await createKnowledgePoint(client, payload)) });
  }

  if (request.method === "PATCH" && resource === "chapters") {
    const payload = await parseBody(request) as ReorderPayload | null;
    if (!payload) return validationError(request, "请求内容不是有效 JSON。");
    await reorderChapters(client, payload);
    return json(request, 200, { ok: true });
  }

  if (request.method === "PATCH" && resource === "knowledge_points") {
    const payload = await parseBody(request) as ReorderPayload | null;
    if (!payload) return validationError(request, "请求内容不是有效 JSON。");
    await reorderKnowledgePoints(client, payload);
    return json(request, 200, { ok: true });
  }

  if (request.method === "PATCH" && resource === "chapter") {
    const payload = await parseBody(request) as ChapterPayload | null;
    const id = new URL(request.url).searchParams.get("id");
    if (!payload || !isUuid(id)) return validationError(request, "章节参数无效。");

    const values: Record<string, string | null> = {};
    if (payload.title !== undefined) {
      if (!isNonEmptyTitle(payload.title)) return validationError(request, "章节名称不能为空，且不能超过 200 个字符。");
      values.title = payload.title.trim();
    }
    if (payload.content !== undefined) {
      if (!isOptionalContent(payload.content)) return validationError(request, "章节内容超过长度限制。");
      values.content = payload.content;
    }
    if (payload.parent_id !== undefined || payload.operation === "move") {
      if (payload.parent_id !== null && !isUuid(payload.parent_id)) return validationError(request, "目标父章节无效。");
      values.parent_id = payload.parent_id as string | null;
    }
    if (Object.keys(values).length === 0) return validationError(request, "没有需要更新的章节内容。");

    const { data, error } = await client
      .from("chapters")
      .update(values)
      .eq("id", id)
      .is("deleted_at", null)
      .select("id,title,parent_id,sort_order,content,created_at,updated_at,deleted_at")
      .single();
    if (error) return databaseError(request, error, "章节更新失败。");
    return json(request, 200, { ok: true, chapter: data as Chapter });
  }

  if (request.method === "PATCH" && resource === "knowledge_point") {
    const payload = await parseBody(request) as KnowledgePointPayload | null;
    const id = new URL(request.url).searchParams.get("id");
    if (!payload || !isUuid(id)) return validationError(request, "知识点参数无效。");
    try {
      return json(request, 200, { ok: true, knowledge_point: await updateKnowledgePoint(client, id, payload) });
    } catch (error) {
      return databaseError(request, error, "知识点更新失败。");
    }
  }

  if (request.method === "PATCH" && resource === "placement") {
    const payload = await parseBody(request) as KnowledgePointPayload | null;
    const placementId = new URL(request.url).searchParams.get("id") ?? payload?.placement_id;
    if (!payload || !isUuid(placementId) || !isUuid(payload.chapter_id)) return validationError(request, "知识点移动参数无效。");
    try {
      return json(request, 200, { ok: true, placement: await moveKnowledgePoint(client, placementId, payload.chapter_id) });
    } catch (error) {
      return databaseError(request, error, "知识点移动失败。");
    }
  }

  if (request.method === "DELETE" && resource === "chapter") {
    const url = new URL(request.url);
    const id = url.searchParams.get("id");
    if (!isUuid(id)) return validationError(request, "章节 ID 无效。");
    const result = await deleteChapter(client, id, url.searchParams.get("confirm") === "true");
    if (result.blocked) {
      return json(request, 409, {
        ok: false,
        error: {
          code: "CHAPTER_NOT_EMPTY",
          message: `此章节包含 ${result.childCount} 个子章节和 ${result.knowledgePointCount} 个知识点。`,
          child_count: result.childCount,
          knowledge_point_count: result.knowledgePointCount,
        },
      });
    }
    return json(request, 200, { ok: true, deleted: true });
  }

  if (request.method === "DELETE" && resource === "knowledge_point") {
    const id = new URL(request.url).searchParams.get("id");
    if (!isUuid(id)) return validationError(request, "知识点 ID 无效。");
    const { data, error } = await client
      .from("knowledge_points")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", id)
      .is("deleted_at", null)
      .select("id")
      .maybeSingle();
    if (error) return databaseError(request, error, "知识点删除失败。");
    if (!data) return json(request, 404, { ok: false, error: { code: "KNOWLEDGE_POINT_NOT_FOUND", message: "知识点不存在或已删除。" } });
    return json(request, 200, { ok: true, deleted: true });
  }

  return json(request, 404, {
    ok: false,
    error: { code: "RESOURCE_NOT_FOUND", message: "第二阶段 API 资源不存在。" },
  });
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

  if (!["GET", "POST", "PUT", "PATCH", "DELETE"].includes(request.method)) {
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
      error: { code: "SERVER_CONFIG_ERROR", message: "Edge Function 服务端数据库尚未配置。" },
    });
  }

  const resource = new URL(request.url).searchParams.get("resource");
  try {
    if (!resource) return await handleNote(request, client);
    return await handlePhase2(request, client, resource);
  } catch (error) {
    return databaseError(request, error, "服务暂时不可用，请稍后重试。");
  }
});

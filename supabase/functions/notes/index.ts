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
  chapter_note: RichDocument;
  created_at: string;
  deleted_at: string | null;
  deletion_batch_id?: string | null;
};

type HistoryKind = "shared" | "placement";

type KnowledgePointVersion = {
  id: string;
  knowledge_point_id: string;
  snapshot: Record<string, unknown>;
  content_hash: string;
  version_source: string;
  created_at: string;
};

type PlacementNoteVersion = {
  id: string;
  placement_id: string;
  chapter_note_snapshot: RichDocument;
  content_hash: string;
  version_source: string;
  created_at: string;
};

type Tag = {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
};

type SearchRow = {
  point_id: string;
  title: string;
  status: KnowledgePoint["status"];
  updated_at: string;
  placement_id: string | null;
  chapter_id: string | null;
  match_type: string;
  match_text: string | null;
  tag_name: string | null;
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
  knowledge_point_id?: unknown;
  chapter_id?: unknown;
  placement_id?: unknown;
  explanation?: unknown;
  exercises?: unknown;
  supplement?: unknown;
  inspiration?: unknown;
};

type TagPayload = {
  name?: unknown;
  knowledge_point_id?: unknown;
  tag_id?: unknown;
  favorite?: unknown;
  item_type?: unknown;
  item_id?: unknown;
};

type ReorderPayload = {
  parent_id?: unknown;
  chapter_id?: unknown;
  ids?: unknown;
};

type HistoryPayload = {
  kind?: unknown;
  knowledge_point_id?: unknown;
  placement_id?: unknown;
  snapshot?: unknown;
  version_id?: unknown;
  target_chapter_id?: unknown;
};

type RecycleRestorePayload = {
  kind?: unknown;
  id?: unknown;
  restore_parents?: unknown;
  target_chapter_id?: unknown;
};

type BackupTableName =
  | "stage1_notes"
  | "workbench_initialization"
  | "chapters"
  | "knowledge_points"
  | "knowledge_point_contents"
  | "knowledge_point_placements"
  | "tags"
  | "knowledge_point_tags"
  | "favorite_items"
  | "pinned_items"
  | "knowledge_point_versions"
  | "placement_note_versions";

type FullBackupData = Record<BackupTableName, Array<Record<string, unknown>>>;
type FullBackup = {
  manifest: {
    app: "悠扬讲义";
    backup_format_version: 1;
    schema_version: "0008";
    migration_versions: string[];
    created_at: string;
    data_checksum: string;
    checksum_algorithm: "SHA-256";
    counts: Record<BackupTableName, number>;
  };
  data: FullBackupData;
};

const MAX_TITLE_LENGTH = 200;
const MAX_CONTENT_LENGTH = 200_000;
const MAX_RICH_DOCUMENT_LENGTH = 500_000;
const MAX_TAG_LENGTH = 80;
const MAX_BACKUP_BYTES = 25_000_000;
const BACKUP_FORMAT_VERSION = 1 as const;
const BACKUP_SCHEMA_VERSION = "0008" as const;
const BACKUP_MIGRATION_VERSIONS = ["0001", "0002", "0003", "0004", "0005", "0006", "0007", "0008"] as const;
const BACKUP_TABLES: BackupTableName[] = [
  "stage1_notes",
  "workbench_initialization",
  "chapters",
  "knowledge_points",
  "knowledge_point_contents",
  "knowledge_point_placements",
  "tags",
  "knowledge_point_tags",
  "favorite_items",
  "pinned_items",
  "knowledge_point_versions",
  "placement_note_versions",
];
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

function isHistoryKind(value: unknown): value is HistoryKind {
  return value === "shared" || value === "placement";
}

function defaultRichDocument(): RichDocument {
  return { type: "doc", content: [{ type: "paragraph" }] };
}

function isHistorySnapshot(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const snapshot = value as Record<string, unknown>;
  if (!isNonEmptyTitle(snapshot.title) || typeof snapshot.status !== "string" || !STATUS_VALUES.has(snapshot.status)) return false;
  const content = snapshot.content;
  if (typeof content !== "object" || content === null || Array.isArray(content)) return false;
  return CONTENT_FIELDS.every((field) => isRichDocument((content as Record<string, unknown>)[field]));
}

async function hashJson(value: unknown) {
  const encoded = new TextEncoder().encode(JSON.stringify(value));
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function stableJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableJsonValue);
  if (value && typeof value === "object") {
    return Object.keys(value as Record<string, unknown>).sort().reduce<Record<string, unknown>>((result, key) => {
      result[key] = stableJsonValue((value as Record<string, unknown>)[key]);
      return result;
    }, {});
  }
  return value;
}

function stableJsonStringify(value: unknown) {
  return JSON.stringify(stableJsonValue(value));
}

async function hashCanonicalJson(value: unknown) {
  const encoded = new TextEncoder().encode(stableJsonStringify(value));
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function readAllRows<T extends Record<string, unknown>>(
  client: SupabaseClient,
  table: string,
  columns: string,
  orderColumns: string[],
) {
  const rows: T[] = [];
  for (let offset = 0; ; offset += 1000) {
    let query = client.from(table).select(columns);
    for (const column of orderColumns) query = query.order(column, { ascending: true });
    const { data, error } = await query.range(offset, offset + 999);
    if (error) throw error;
    const page = (data ?? []) as T[];
    rows.push(...page);
    if (page.length < 1000) break;
  }
  return rows;
}

async function buildFullBackupData(client: SupabaseClient): Promise<FullBackupData> {
  const [stage1_notes, workbench_initialization, chapters, knowledge_points, knowledge_point_contents,
    knowledge_point_placements, tags, knowledge_point_tags, favorite_items, pinned_items,
    knowledge_point_versions, placement_note_versions] = await Promise.all([
    readAllRows(client, "stage1_notes", "id,title,content,created_at,updated_at", ["id"]),
    readAllRows(client, "workbench_initialization", "key,initialized_at", ["key"]),
    readAllRows(client, "chapters", "id,title,parent_id,sort_order,content,created_at,updated_at,deleted_at,deletion_batch_id", ["id"]),
    readAllRows(client, "knowledge_points", "id,title,status,created_at,updated_at,deleted_at,deletion_batch_id", ["id"]),
    readAllRows(client, "knowledge_point_contents", "id,knowledge_point_id,explanation,exercises,supplement,inspiration,created_at,updated_at", ["id"]),
    readAllRows(client, "knowledge_point_placements", "id,knowledge_point_id,chapter_id,sort_order,created_at,chapter_note,deleted_at,deletion_batch_id", ["id"]),
    readAllRows(client, "tags", "id,name,created_at,updated_at", ["id"]),
    readAllRows(client, "knowledge_point_tags", "knowledge_point_id,tag_id,created_at", ["knowledge_point_id", "tag_id"]),
    readAllRows(client, "favorite_items", "knowledge_point_id,created_at", ["knowledge_point_id"]),
    readAllRows(client, "pinned_items", "id,item_type,item_id,sort_order,created_at", ["id"]),
    readAllRows(client, "knowledge_point_versions", "id,knowledge_point_id,snapshot,content_hash,version_source,created_at", ["id"]),
    readAllRows(client, "placement_note_versions", "id,placement_id,chapter_note_snapshot,content_hash,version_source,created_at", ["id"]),
  ]);
  return {
    stage1_notes,
    workbench_initialization,
    chapters,
    knowledge_points,
    knowledge_point_contents,
    knowledge_point_placements,
    tags,
    knowledge_point_tags,
    favorite_items,
    pinned_items,
    knowledge_point_versions,
    placement_note_versions,
  };
}

async function buildFullBackup(client: SupabaseClient): Promise<FullBackup> {
  const data = await buildFullBackupData(client);
  const counts = BACKUP_TABLES.reduce((result, table) => {
    result[table] = data[table].length;
    return result;
  }, {} as Record<BackupTableName, number>);
  return {
    manifest: {
      app: "悠扬讲义",
      backup_format_version: BACKUP_FORMAT_VERSION,
      schema_version: BACKUP_SCHEMA_VERSION,
      migration_versions: [...BACKUP_MIGRATION_VERSIONS],
      created_at: new Date().toISOString(),
      data_checksum: await hashCanonicalJson(data),
      checksum_algorithm: "SHA-256",
      counts,
    },
    data,
  };
}

function hasOnlyKeys(value: unknown, keys: string[]) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value as Record<string, unknown>).every((key) => keys.includes(key)));
}

async function validateFullBackup(value: unknown): Promise<FullBackup> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("BACKUP_INVALID");
  const backup = value as Partial<FullBackup>;
  const manifest = backup.manifest;
  const data = backup.data;
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest) || !data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("BACKUP_INVALID");
  }
  const manifestRecord = manifest as Record<string, unknown>;
  const expectedManifestKeys = ["app", "backup_format_version", "schema_version", "migration_versions", "created_at", "data_checksum", "checksum_algorithm", "counts"];
  if (!hasOnlyKeys(manifest, expectedManifestKeys)
    || manifestRecord.app !== "悠扬讲义"
    || manifestRecord.backup_format_version !== BACKUP_FORMAT_VERSION
    || manifestRecord.schema_version !== BACKUP_SCHEMA_VERSION
    || manifestRecord.checksum_algorithm !== "SHA-256"
    || !Array.isArray(manifestRecord.migration_versions)
    || !manifestRecord.migration_versions.every((version) => typeof version === "string")
    || typeof manifestRecord.created_at !== "string"
    || typeof manifestRecord.data_checksum !== "string"
    || !manifestRecord.counts || typeof manifestRecord.counts !== "object" || Array.isArray(manifestRecord.counts)) {
    throw new Error(manifestRecord.schema_version && manifestRecord.schema_version !== BACKUP_SCHEMA_VERSION ? "BACKUP_SCHEMA_UNSUPPORTED" : "BACKUP_INVALID");
  }
  const dataRecord = data as Record<string, unknown>;
  if (!hasOnlyKeys(data, BACKUP_TABLES)) throw new Error("BACKUP_INVALID");
  const counts = manifestRecord.counts as Record<string, unknown>;
  if (!hasOnlyKeys(counts, BACKUP_TABLES) || BACKUP_TABLES.some((table) => !Array.isArray(dataRecord[table]) || counts[table] !== (dataRecord[table] as unknown[]).length)) {
    throw new Error("BACKUP_COUNTS_INVALID");
  }
  const size = new TextEncoder().encode(JSON.stringify(value)).byteLength;
  if (size > MAX_BACKUP_BYTES) throw new Error("BACKUP_SIZE_LIMIT");
  const checksum = await hashCanonicalJson(data);
  if (checksum !== manifestRecord.data_checksum) throw new Error("BACKUP_CHECKSUM_INVALID");
  return backup as FullBackup;
}

function backupIdSet(rows: Array<Record<string, unknown>>, key: string) {
  return new Set(rows.map((row) => String(row[key])));
}

async function postRestoreVerify(client: SupabaseClient, backup: FullBackup) {
  const current = await buildFullBackupData(client);
  const projectByIds = (table: BackupTableName, key: string) => current[table].filter((row) => backupIdSet(backup.data[table], key).has(String(row[key])));
  const projected: FullBackupData = {
    ...current,
    chapters: projectByIds("chapters", "id"),
    knowledge_points: projectByIds("knowledge_points", "id"),
    knowledge_point_placements: projectByIds("knowledge_point_placements", "id"),
    knowledge_point_contents: current.knowledge_point_contents.filter((row) => backupIdSet(backup.data.knowledge_points, "id").has(String(row.knowledge_point_id))),
    knowledge_point_versions: projectByIds("knowledge_point_versions", "id"),
    placement_note_versions: projectByIds("placement_note_versions", "id"),
  };
  if (stableJsonStringify(projected) !== stableJsonStringify(backup.data)) throw new Error("BACKUP_POSTCHECK_FAILED");
  return { passed: true, counts: backup.manifest.counts };
}

async function preflightFullBackup(client: SupabaseClient, backup: FullBackup) {
  const { data, error } = await client.rpc("restore_workbench_backup", { p_backup: backup, p_apply: false });
  if (error) throw error;
  return data as Record<string, unknown>;
}

async function restoreFullBackup(client: SupabaseClient, backup: FullBackup) {
  const { data, error } = await client.rpc("restore_workbench_backup", { p_backup: backup, p_apply: true });
  if (error) throw error;
  const postCheck = await postRestoreVerify(client, backup);
  return { restore: data as Record<string, unknown>, post_check: postCheck };
}

async function readCurrentPointSnapshot(client: SupabaseClient, pointId: string, includeDeleted = false) {
  const pointQuery = client
    .from("knowledge_points")
    .select("id,title,status,deleted_at")
    .eq("id", pointId);
  const { data: point, error: pointError } = includeDeleted
    ? await pointQuery.maybeSingle()
    : await pointQuery.is("deleted_at", null).maybeSingle();
  if (pointError) throw pointError;
  if (!point) throw new Error("KNOWLEDGE_POINT_NOT_FOUND");
  const { data: content, error: contentError } = await client
    .from("knowledge_point_contents")
    .select("explanation,exercises,supplement,inspiration")
    .eq("knowledge_point_id", pointId)
    .maybeSingle();
  if (contentError) throw contentError;
  return {
    title: point.title,
    status: point.status,
    content: {
      explanation: content?.explanation ?? defaultRichDocument(),
      exercises: content?.exercises ?? defaultRichDocument(),
      supplement: content?.supplement ?? defaultRichDocument(),
      inspiration: content?.inspiration ?? defaultRichDocument(),
    },
  };
}

async function createKnowledgePointVersion(client: SupabaseClient, pointId: string, snapshot: unknown) {
  if (!isUuid(pointId) || !isHistorySnapshot(snapshot)) throw new Error("HISTORY_PAYLOAD_INVALID");
  const contentHash = await hashJson(snapshot);
  const { data, error } = await client
    .from("knowledge_point_versions")
    .upsert({ knowledge_point_id: pointId, snapshot, content_hash: contentHash }, { onConflict: "knowledge_point_id,content_hash", ignoreDuplicates: true })
    .select("id,knowledge_point_id,snapshot,content_hash,version_source,created_at")
    .maybeSingle();
  if (error) throw error;
  if (data) return data as KnowledgePointVersion;
  const { data: existing, error: existingError } = await client
    .from("knowledge_point_versions")
    .select("id,knowledge_point_id,snapshot,content_hash,version_source,created_at")
    .eq("knowledge_point_id", pointId)
    .eq("content_hash", contentHash)
    .single();
  if (existingError) throw existingError;
  return existing as KnowledgePointVersion;
}

async function createPlacementNoteVersion(client: SupabaseClient, placementId: string, snapshot: unknown) {
  if (!isUuid(placementId) || !isRichDocument(snapshot)) throw new Error("HISTORY_PAYLOAD_INVALID");
  const contentHash = await hashJson(snapshot);
  const { data, error } = await client
    .from("placement_note_versions")
    .upsert({ placement_id: placementId, chapter_note_snapshot: snapshot, content_hash: contentHash }, { onConflict: "placement_id,content_hash", ignoreDuplicates: true })
    .select("id,placement_id,chapter_note_snapshot,content_hash,version_source,created_at")
    .maybeSingle();
  if (error) throw error;
  if (data) return data as PlacementNoteVersion;
  const { data: existing, error: existingError } = await client
    .from("placement_note_versions")
    .select("id,placement_id,chapter_note_snapshot,content_hash,version_source,created_at")
    .eq("placement_id", placementId)
    .eq("content_hash", contentHash)
    .single();
  if (existingError) throw existingError;
  return existing as PlacementNoteVersion;
}

async function readHistory(client: SupabaseClient, kind: HistoryKind, id: string) {
  if (!isUuid(id)) throw new Error("HISTORY_PAYLOAD_INVALID");
  if (kind === "shared") {
    const { data, error } = await client
      .from("knowledge_point_versions")
      .select("id,knowledge_point_id,content_hash,version_source,created_at")
      .eq("knowledge_point_id", id)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return { versions: (data ?? []) as KnowledgePointVersion[] };
  }
  const { data, error } = await client
    .from("placement_note_versions")
    .select("id,placement_id,content_hash,version_source,created_at")
    .eq("placement_id", id)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return { versions: (data ?? []) as PlacementNoteVersion[] };
}

async function readHistoryVersion(client: SupabaseClient, kind: HistoryKind, id: string) {
  if (!isUuid(id)) throw new Error("HISTORY_PAYLOAD_INVALID");
  if (kind === "shared") {
    const { data, error } = await client
      .from("knowledge_point_versions")
      .select("id,knowledge_point_id,snapshot,content_hash,version_source,created_at")
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new Error("HISTORY_VERSION_NOT_FOUND");
    return { version: data as KnowledgePointVersion };
  }
  const { data, error } = await client
    .from("placement_note_versions")
    .select("id,placement_id,chapter_note_snapshot,content_hash,version_source,created_at")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("HISTORY_VERSION_NOT_FOUND");
  return { version: data as PlacementNoteVersion };
}

async function restoreHistory(client: SupabaseClient, kind: HistoryKind, versionId: string) {
  if (!isUuid(versionId)) throw new Error("HISTORY_PAYLOAD_INVALID");
  if (kind === "shared") {
    const { data: version, error: versionError } = await client
      .from("knowledge_point_versions")
      .select("id,knowledge_point_id")
      .eq("id", versionId)
      .maybeSingle();
    if (versionError) throw versionError;
    if (!version) throw new Error("HISTORY_VERSION_NOT_FOUND");
    const currentSnapshot = await readCurrentPointSnapshot(client, version.knowledge_point_id);
    const currentHash = await hashJson(currentSnapshot);
    const { data, error } = await client.rpc("restore_knowledge_point_version", {
      p_knowledge_point_id: version.knowledge_point_id,
      p_version_id: versionId,
      p_current_snapshot: currentSnapshot,
      p_current_hash: currentHash,
    });
    if (error) throw error;
    return { kind, ...(data as Record<string, unknown>) };
  }

  const { data: version, error: versionError } = await client
    .from("placement_note_versions")
    .select("id,placement_id")
    .eq("id", versionId)
    .maybeSingle();
  if (versionError) throw versionError;
  if (!version) throw new Error("HISTORY_VERSION_NOT_FOUND");
  const { data: placement, error: placementError } = await client
    .from("knowledge_point_placements")
    .select("id,chapter_note")
    .eq("id", version.placement_id)
    .is("deleted_at", null)
    .maybeSingle();
  if (placementError) throw placementError;
  if (!placement) throw new Error("PLACEMENT_NOT_FOUND");
  const currentHash = await hashJson(placement.chapter_note);
  const { data, error } = await client.rpc("restore_placement_note_version", {
    p_placement_id: version.placement_id,
    p_version_id: versionId,
    p_current_snapshot: placement.chapter_note,
    p_current_hash: currentHash,
  });
  if (error) throw error;
  return { kind, ...(data as Record<string, unknown>) };
}

async function readRecycleBin(client: SupabaseClient, kind: "all" | "chapter" | "knowledge_point") {
  const [chaptersResult, pointsResult, placementsResult] = await Promise.all([
    client.from("chapters").select("id,title,parent_id,sort_order,deleted_at,deletion_batch_id").order("deleted_at", { ascending: false, nullsFirst: false }),
    client.from("knowledge_points").select("id,title,status,deleted_at,deletion_batch_id").not("deleted_at", "is", null).order("deleted_at", { ascending: false }),
    client.from("knowledge_point_placements").select("id,knowledge_point_id,chapter_id,deleted_at,deletion_batch_id,sort_order").order("sort_order", { ascending: true }),
  ]);
  const error = chaptersResult.error ?? pointsResult.error ?? placementsResult.error;
  if (error) throw error;

  const chapters = (chaptersResult.data ?? []) as Array<Chapter & { deletion_batch_id: string | null }>;
  const points = (pointsResult.data ?? []) as Array<KnowledgePoint & { deletion_batch_id: string | null }>;
  const placements = (placementsResult.data ?? []) as Array<KnowledgePointPlacement & { deletion_batch_id: string | null }>;
  const chapterMap = new Map(chapters.map((chapter) => [chapter.id, chapter]));
  const deletedChapterIds = new Set(chapters.filter((chapter) => chapter.deleted_at !== null).map((chapter) => chapter.id));
  const activeChapters = chapters.filter((chapter) => chapter.deleted_at === null).map((chapter) => ({ id: chapter.id, title: chapter.title, path: chapterPath(chapters, chapter.id) }));
  const items: Array<Record<string, unknown>> = [];

  if (kind === "all" || kind === "chapter") {
    for (const chapter of chapters.filter((item) => item.deleted_at !== null && (!item.parent_id || !deletedChapterIds.has(item.parent_id)))) {
      items.push({
        id: chapter.id,
        item_type: "chapter",
        title: chapter.title,
        path: chapterPath(chapters, chapter.parent_id),
        deleted_at: chapter.deleted_at,
        deletion_batch_id: chapter.deletion_batch_id,
        parent_deleted: Boolean(chapter.parent_id && chapterMap.get(chapter.parent_id)?.deleted_at),
      });
    }
  }

  if (kind === "all" || kind === "knowledge_point") {
    for (const point of points) {
      const pointPlacements = placements.filter((placement) => placement.knowledge_point_id === point.id);
      const activePlacementCount = pointPlacements.filter((placement) => placement.deleted_at === null && !deletedChapterIds.has(placement.chapter_id)).length;
      const firstPlacement = pointPlacements[0];
      items.push({
        id: point.id,
        item_type: "knowledge_point",
        title: point.title,
        status: point.status,
        path: firstPlacement ? chapterPath(chapters, firstPlacement.chapter_id) : "原章节不可用",
        deleted_at: point.deleted_at,
        deletion_batch_id: point.deletion_batch_id,
        placement_count: pointPlacements.length,
        active_placement_count: activePlacementCount,
      });
    }
  }

  return { items, active_chapters: activeChapters };
}

async function restoreRecycleItem(client: SupabaseClient, payload: RecycleRestorePayload) {
  if (!isUuid(payload.id) || (payload.kind !== "chapter" && payload.kind !== "knowledge_point")) throw new Error("RECYCLE_PAYLOAD_INVALID");
  if (payload.kind === "chapter") {
    const { data, error } = await client.rpc("restore_chapter_tree", {
      p_chapter_id: payload.id,
      p_restore_parent_chain: payload.restore_parents === true,
    });
    if (error) throw error;
    return { item_type: payload.kind, ...(data as Record<string, unknown>) };
  }
  const targetChapterId = payload.target_chapter_id === undefined || payload.target_chapter_id === null
    ? null
    : payload.target_chapter_id;
  if (targetChapterId !== null && !isUuid(targetChapterId)) throw new Error("RECYCLE_PAYLOAD_INVALID");
  const { data, error } = await client.rpc("restore_knowledge_point_with_placements", {
    p_knowledge_point_id: payload.id,
    p_target_chapter_id: targetChapterId,
  });
  if (error) throw error;
  return { item_type: payload.kind, ...(data as Record<string, unknown>) };
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
  if (message.includes("PLACEMENT_DUPLICATE")) {
    return json(request, 409, {
      ok: false,
      error: { code: "PLACEMENT_DUPLICATE", message: "该知识点已经存在于此章节。" },
    });
  }
  if (message.includes("KNOWLEDGE_POINT_SHARED")) {
    return json(request, 409, {
      ok: false,
      error: { code: "KNOWLEDGE_POINT_SHARED", message: "该知识点仍被其他章节引用。" },
    });
  }
  if (message.includes("PIN_LIMIT")) {
    return json(request, 409, {
      ok: false,
      error: { code: "PIN_LIMIT", message: "最多只能置顶 4 个项目。" },
    });
  }
  if (message.includes("TAG_DUPLICATE")) {
    return json(request, 409, {
      ok: false,
      error: { code: "TAG_DUPLICATE", message: "这个标签已经添加到该知识点。" },
    });
  }
  if (message.includes("PIN_DUPLICATE")) {
    return json(request, 409, {
      ok: false,
      error: { code: "PIN_DUPLICATE", message: "这个项目已经置顶。" },
    });
  }
  if (message.includes("TAG_NOT_FOUND")) {
    return json(request, 404, {
      ok: false,
      error: { code: "TAG_NOT_FOUND", message: "标签不存在。" },
    });
  }
  if (message.includes("TAG_IN_USE")) {
    return json(request, 409, {
      ok: false,
      error: { code: "TAG_IN_USE", message: "这个标签仍被知识点使用。" },
    });
  }
  if (message.includes("PARENT_CHAIN_DELETED")) {
    return json(request, 409, {
      ok: false,
      error: { code: "PARENT_CHAIN_DELETED", message: "上级章节仍在回收站中，需要同时恢复上级目录。" },
    });
  }
  if (message.includes("RESTORE_TARGET_REQUIRED")) {
    return json(request, 409, {
      ok: false,
      error: { code: "RESTORE_TARGET_REQUIRED", message: "原引用位置均不可用，请选择一个当前章节作为恢复位置。" },
    });
  }
  if (message.includes("HISTORY_VERSION_NOT_FOUND")) {
    return json(request, 404, {
      ok: false,
      error: { code: "HISTORY_VERSION_NOT_FOUND", message: "历史版本不存在或已不属于当前内容。" },
    });
  }
  if (message.includes("HISTORY_SNAPSHOT_INVALID")) {
    return json(request, 400, {
      ok: false,
      error: { code: "HISTORY_SNAPSHOT_INVALID", message: "历史快照格式无效。" },
    });
  }
  if (message.includes("RECYCLE_ITEM_NOT_FOUND")) {
    return json(request, 404, {
      ok: false,
      error: { code: "RECYCLE_ITEM_NOT_FOUND", message: "回收站项目不存在或已经恢复。" },
    });
  }

  const backupValidationCodes: Record<string, string> = {
    BACKUP_INVALID: "这不是有效的悠扬讲义完整备份文件。",
    BACKUP_COUNTS_INVALID: "备份文件数量统计与数据不一致。",
    BACKUP_FIELDS_INVALID: "备份文件包含不支持的数据字段。",
    BACKUP_DUPLICATE_ID: "备份文件存在重复数据 ID。",
    BACKUP_PARENT_INVALID: "备份文件的章节层级关系无效。",
    BACKUP_CHAPTER_CYCLE: "备份文件的章节结构存在循环。",
    BACKUP_PLACEMENT_DUPLICATE: "备份文件存在重复的知识点位置关系。",
    BACKUP_FOREIGN_KEY_INVALID: "备份文件存在失效的数据关系。",
    BACKUP_ENUM_INVALID: "备份文件包含不支持的状态或类型。",
    BACKUP_RICH_CONTENT_INVALID: "备份文件中的富文本结构无效。",
    BACKUP_RELATION_DUPLICATE: "备份文件存在重复的标签、收藏或置顶关系。",
    BACKUP_HISTORY_DUPLICATE: "备份文件存在重复的历史版本。",
    BACKUP_CHECKSUM_INVALID: "备份文件完整性校验失败。",
    BACKUP_SCHEMA_UNSUPPORTED: "该备份由更新版本的悠扬讲义生成，请先升级系统后再恢复。",
    BACKUP_SIZE_LIMIT: "备份文件过大，无法安全处理。",
    BACKUP_PIN_LIMIT: "备份文件中的置顶项目超过当前上限。",
  };
  for (const [code, messageText] of Object.entries(backupValidationCodes)) {
    if (message.includes(code)) return json(request, 400, { ok: false, error: { code, message: messageText } });
  }
  if (message.includes("BACKUP_POSTCHECK_FAILED") || message.includes("BACKUP_RESTORE_TRANSACTION_FAILED")) {
    return json(request, 500, { ok: false, error: { code: "BACKUP_RESTORE_TRANSACTION_FAILED", message: "恢复失败，数据库已保持恢复前状态。" } });
  }

  const validationCodes: Record<string, string> = {
    CHAPTER_TITLE_INVALID: "章节名称不能为空，且不能超过 200 个字符。",
    CHAPTER_PARENT_INVALID: "目标父章节无效。",
    KNOWLEDGE_POINT_PAYLOAD_INVALID: "知识点参数无效。",
    KNOWLEDGE_POINT_TITLE_INVALID: "知识点名称不能为空，且不能超过 200 个字符。",
    KNOWLEDGE_POINT_STATUS_INVALID: "知识点状态无效。",
    KNOWLEDGE_POINT_CREATE_ERROR: "知识点创建失败。",
    PLACEMENT_NOT_FOUND: "知识点位置不存在。",
    CHAPTER_NOTE_INVALID: "本章补充内容格式无效。",
    CONTENT_PAYLOAD_INVALID: "知识点内容格式无效。",
    TAG_NAME_INVALID: "标签名称不能为空，且不能超过 80 个字符。",
    TAG_PAYLOAD_INVALID: "标签参数无效。",
    FAVORITE_PAYLOAD_INVALID: "收藏参数无效。",
    PIN_PAYLOAD_INVALID: "置顶参数无效。",
    HISTORY_PAYLOAD_INVALID: "历史版本参数无效。",
    RECYCLE_PAYLOAD_INVALID: "回收站参数无效。",
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
      .select("id,knowledge_point_id,chapter_id,sort_order,chapter_note,created_at,deleted_at")
      .is("deleted_at", null)
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

async function readKnowledgePoint(client: SupabaseClient, id: string) {
  return client
    .from("knowledge_points")
    .select("id,title,status,created_at,updated_at,deleted_at")
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

async function deleteChapter(client: SupabaseClient, id: string, confirm: boolean) {
  const { data, error } = await client.rpc("soft_delete_chapter_tree", {
    p_chapter_id: id,
    p_confirm: confirm,
  });
  if (error) throw error;
  return data as { blocked: boolean; child_count: number; knowledge_point_count: number; deletion_batch_id?: string };
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
    .select("id,knowledge_point_id,chapter_id,sort_order,chapter_note,created_at,deleted_at")
    .eq("id", result.placement_id)
    .is("deleted_at", null)
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
    .select("id,knowledge_point_id,chapter_id,sort_order,chapter_note,created_at,deleted_at")
    .eq("id", placementId)
    .is("deleted_at", null)
    .maybeSingle();
  if (placementError) throw placementError;
  if (!placement) throw new Error("PLACEMENT_NOT_FOUND");

  const { data: maxSort, error: sortError } = await client
    .from("knowledge_point_placements")
    .select("sort_order")
    .eq("chapter_id", chapterId)
    .is("deleted_at", null)
    .order("sort_order", { ascending: false })
    .limit(1);
  if (sortError) throw sortError;

  const { data, error } = await client
    .from("knowledge_point_placements")
    .update({ chapter_id: chapterId, sort_order: (maxSort?.[0]?.sort_order ?? -1) + 1 })
    .eq("id", placementId)
    .is("deleted_at", null)
    .select("id,knowledge_point_id,chapter_id,sort_order,chapter_note,created_at,deleted_at")
    .single();
  if (error) throw error;
  return data as KnowledgePointPlacement;
}

async function readKnowledgePointPlacements(client: SupabaseClient, knowledgePointId: string) {
  if (!isUuid(knowledgePointId)) throw new Error("PLACEMENT_NOT_FOUND");

  const { data: point, error: pointError } = await client
    .from("knowledge_points")
    .select("id,title,status")
    .eq("id", knowledgePointId)
    .is("deleted_at", null)
    .maybeSingle();
  if (pointError) throw pointError;
  if (!point) throw new Error("KNOWLEDGE_POINT_NOT_FOUND");

  const { data, error } = await client
    .from("knowledge_point_placements")
    .select("id,knowledge_point_id,chapter_id,sort_order,chapter_note,created_at,deleted_at")
    .eq("knowledge_point_id", knowledgePointId)
    .is("deleted_at", null)
    .order("sort_order", { ascending: true });
  if (error) throw error;
  return { knowledge_point: point as Pick<KnowledgePoint, "id" | "title" | "status">, placements: (data ?? []) as KnowledgePointPlacement[] };
}

async function nextPlacementSortOrder(client: SupabaseClient, chapterId: string) {
  const { data, error } = await client
    .from("knowledge_point_placements")
    .select("sort_order")
    .eq("chapter_id", chapterId)
    .is("deleted_at", null)
    .order("sort_order", { ascending: false })
    .limit(1);
  if (error) throw error;
  return (data?.[0]?.sort_order ?? -1) + 1;
}

async function createPlacement(client: SupabaseClient, knowledgePointId: string, chapterId: string) {
  if (!isUuid(knowledgePointId) || !isUuid(chapterId)) throw new Error("PLACEMENT_NOT_FOUND");

  const [point, chapter] = await Promise.all([readKnowledgePoint(client, knowledgePointId), readChapter(client, chapterId)]);
  if (point.error) throw point.error;
  if (chapter.error) throw chapter.error;
  if (!point.data) throw new Error("KNOWLEDGE_POINT_NOT_FOUND");
  if (!chapter.data) throw new Error("CHAPTER_NOT_FOUND");

  const { data: existing, error: existingError } = await client
    .from("knowledge_point_placements")
    .select("id,knowledge_point_id,chapter_id,sort_order,chapter_note,created_at,deleted_at")
    .eq("knowledge_point_id", knowledgePointId)
    .eq("chapter_id", chapterId)
    .maybeSingle();
  if (existingError) throw existingError;
  if (existing && existing.deleted_at === null) throw new Error("PLACEMENT_DUPLICATE");

  if (existing) {
    const { data, error } = await client
      .from("knowledge_point_placements")
      .update({ deleted_at: null, sort_order: await nextPlacementSortOrder(client, chapterId) })
      .eq("id", existing.id)
      .select("id,knowledge_point_id,chapter_id,sort_order,chapter_note,created_at,deleted_at")
      .single();
    if (error) throw error;
    return { placement: data as KnowledgePointPlacement, restored: true };
  }

  const { data, error } = await client
    .from("knowledge_point_placements")
    .insert({ knowledge_point_id: knowledgePointId, chapter_id: chapterId, sort_order: await nextPlacementSortOrder(client, chapterId) })
    .select("id,knowledge_point_id,chapter_id,sort_order,chapter_note,created_at,deleted_at")
    .single();
  if (error) throw error;
  return { placement: data as KnowledgePointPlacement, restored: false };
}

async function savePlacementNote(client: SupabaseClient, placementId: string, chapterNote: unknown) {
  if (!isUuid(placementId) || !isRichDocument(chapterNote)) throw new Error("CHAPTER_NOTE_INVALID");
  const { data, error } = await client
    .from("knowledge_point_placements")
    .update({ chapter_note: chapterNote })
    .eq("id", placementId)
    .is("deleted_at", null)
    .select("id,knowledge_point_id,chapter_id,sort_order,chapter_note,created_at,deleted_at")
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("PLACEMENT_NOT_FOUND");
  return data as KnowledgePointPlacement;
}

async function removePlacement(client: SupabaseClient, placementId: string) {
  if (!isUuid(placementId)) throw new Error("PLACEMENT_NOT_FOUND");
  const { data, error } = await client
    .from("knowledge_point_placements")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", placementId)
    .is("deleted_at", null)
    .select("id,knowledge_point_id,chapter_id,sort_order,chapter_note,created_at,deleted_at")
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("PLACEMENT_NOT_FOUND");
  return data as KnowledgePointPlacement;
}

async function deleteKnowledgePoint(client: SupabaseClient, id: string, confirm: boolean) {
  if (!isUuid(id)) throw new Error("KNOWLEDGE_POINT_NOT_FOUND");
  const { data, error } = await client.rpc("soft_delete_knowledge_point", {
    p_knowledge_point_id: id,
    p_confirm: confirm,
  });
  if (error) throw error;
  return data as { blocked: boolean; placement_count: number; deletion_batch_id?: string };
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

function isTagName(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.trim().length <= MAX_TAG_LENGTH;
}

function isPinType(value: unknown): value is "chapter" | "knowledge_point" {
  return value === "chapter" || value === "knowledge_point";
}

function readableDocumentText(value: unknown): string {
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (parsed && typeof parsed === "object") return readableDocumentText(parsed);
    } catch {
      return value;
    }
    return value;
  }
  if (Array.isArray(value)) return value.map(readableDocumentText).filter(Boolean).join(" ");
  if (!value || typeof value !== "object") return "";
  const record = value as Record<string, unknown>;
  const text = typeof record.text === "string" ? record.text : "";
  const content = readableDocumentText(record.content);
  return [text, content].filter(Boolean).join(" ");
}

function makeSnippet(value: unknown, query: string) {
  const text = readableDocumentText(value).replace(/\s+/g, " ").trim();
  if (!text) return "";
  const lowerText = text.toLocaleLowerCase();
  const index = lowerText.indexOf(query.toLocaleLowerCase());
  if (index < 0) return text.slice(0, 140);
  const start = Math.max(0, index - 45);
  const end = Math.min(text.length, index + query.length + 95);
  return `${start > 0 ? "…" : ""}${text.slice(start, end)}${end < text.length ? "…" : ""}`;
}

async function readTags(client: SupabaseClient) {
  const { data, error } = await client
    .from("tags")
    .select("id,name,created_at,updated_at")
    .order("name", { ascending: true });
  if (error) throw error;
  return (data ?? []) as Tag[];
}

async function readTagsForPoint(client: SupabaseClient, pointId: string) {
  const { data: links, error: linkError } = await client
    .from("knowledge_point_tags")
    .select("tag_id")
    .eq("knowledge_point_id", pointId);
  if (linkError) throw linkError;
  const tagIds = (links ?? []).map((link) => link.tag_id as string);
  if (tagIds.length === 0) return [] as Tag[];
  const { data, error } = await client
    .from("tags")
    .select("id,name,created_at,updated_at")
    .in("id", tagIds)
    .order("name", { ascending: true });
  if (error) throw error;
  return (data ?? []) as Tag[];
}

function chapterPath(chapters: Chapter[], chapterId: string | null) {
  if (!chapterId) return "";
  const byId = new Map(chapters.map((chapter) => [chapter.id, chapter]));
  const names: string[] = [];
  const seen = new Set<string>();
  let current = byId.get(chapterId);
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    names.unshift(current.title);
    current = current.parent_id ? byId.get(current.parent_id) : undefined;
  }
  return names.join(" → ");
}

async function readPointAccessContext(client: SupabaseClient, pointIds: string[]) {
  const tree = await readTree(client);
  const placements = tree.knowledge_point_placements.filter((placement) => pointIds.includes(placement.knowledge_point_id));
  return { tree, placements };
}

async function readDiscoveryMeta(client: SupabaseClient, pointId: string) {
  const point = await readKnowledgePoint(client, pointId);
  if (point.error) throw point.error;
  if (!point.data) throw new Error("KNOWLEDGE_POINT_NOT_FOUND");

  const [tags, favoriteResult, pinResult] = await Promise.all([
    readTagsForPoint(client, pointId),
    client.from("favorite_items").select("knowledge_point_id").eq("knowledge_point_id", pointId).maybeSingle(),
    client.from("pinned_items").select("id,item_type,item_id,sort_order,created_at").eq("item_type", "knowledge_point").eq("item_id", pointId).maybeSingle(),
  ]);
  if (favoriteResult.error) throw favoriteResult.error;
  if (pinResult.error) throw pinResult.error;
  return {
    knowledge_point: point.data as KnowledgePoint,
    tags,
    favorite: Boolean(favoriteResult.data),
    pinned: (pinResult.data ?? null),
  };
}

async function readFastAccess(client: SupabaseClient) {
  const [recentResult, favoriteResult, pinResult, tree] = await Promise.all([
    client.rpc("recent_workbench_edits", { p_limit: 6 }),
    client.from("favorite_items").select("knowledge_point_id,created_at").order("created_at", { ascending: false }),
    client.from("pinned_items").select("id,item_type,item_id,sort_order,created_at").order("sort_order", { ascending: true }).order("created_at", { ascending: true }),
    readTree(client),
  ]);
  if (recentResult.error) throw recentResult.error;
  if (favoriteResult.error) throw favoriteResult.error;
  if (pinResult.error) throw pinResult.error;

  const pointMap = new Map(tree.knowledge_points.map((point) => [point.id, point]));
  const chapterMap = new Map(tree.chapters.map((chapter) => [chapter.id, chapter]));
  const placementsByPoint = new Map<string, KnowledgePointPlacement[]>();
  for (const placement of tree.knowledge_point_placements) {
    const existing = placementsByPoint.get(placement.knowledge_point_id) ?? [];
    existing.push(placement);
    placementsByPoint.set(placement.knowledge_point_id, existing);
  }
  const accessItem = (itemType: string, itemId: string, updatedAt: string | null = null) => {
    const point = itemType === "knowledge_point" ? pointMap.get(itemId) : null;
    const chapter = itemType === "chapter" ? chapterMap.get(itemId) : null;
    const placement = point ? placementsByPoint.get(point.id)?.[0] : null;
    const chapterId = chapter?.id ?? placement?.chapter_id ?? null;
    return {
      item_type: itemType,
      item_id: itemId,
      title: point?.title ?? chapter?.title ?? "",
      status: point?.status ?? null,
      updated_at: updatedAt ?? point?.updated_at ?? chapter?.updated_at ?? null,
      chapter_id: chapterId,
      placement_id: placement?.id ?? null,
      path: chapterPath(tree.chapters, chapterId),
    };
  };

  const recent = (recentResult.data ?? [])
    .map((item) => accessItem(item.item_type, item.item_id, item.updated_at))
    .filter((item) => item.title);
  const favorites = (favoriteResult.data ?? [])
    .map((item) => accessItem("knowledge_point", item.knowledge_point_id, item.created_at))
    .filter((item) => item.title);
  const pins = (pinResult.data ?? [])
    .map((item) => ({ ...item, ...accessItem(item.item_type, item.item_id) }))
    .filter((item) => item.title);
  return { recent, favorites, pins };
}

async function searchKnowledgePoints(client: SupabaseClient, query: string, status: string | null, tagId: string | null) {
  const trimmedQuery = query.trim();
  if (!trimmedQuery) return [];
  if (status !== null && !STATUS_VALUES.has(status)) throw new Error("KNOWLEDGE_POINT_STATUS_INVALID");
  if (tagId !== null && !isUuid(tagId)) throw new Error("TAG_PAYLOAD_INVALID");

  const { data, error } = await client.rpc("search_workbench", {
    p_query: trimmedQuery,
    p_status: status,
    p_tag_id: tagId,
  });
  if (error) throw error;
  const rows = (data ?? []) as SearchRow[];
  if (rows.length === 0) return [];

  const pointIds = [...new Set(rows.map((row) => row.point_id))];
  const { tree, placements } = await readPointAccessContext(client, pointIds);
  const tagsByPoint = new Map<string, Tag[]>();
  await Promise.all(pointIds.map(async (pointId) => { tagsByPoint.set(pointId, await readTagsForPoint(client, pointId)); }));
  const grouped = new Map<string, {
    id: string;
    title: string;
    status: string;
    updated_at: string;
    match_types: string[];
    contexts: Array<{ type: string; text: string; chapter_id: string | null; placement_id: string | null; path: string }>;
    chapter_id: string | null;
    placement_id: string | null;
  }>();

  for (const row of rows) {
    const pointPlacements = placements.filter((placement) => placement.knowledge_point_id === row.point_id);
    const preferredPlacement = row.placement_id
      ? pointPlacements.find((placement) => placement.id === row.placement_id)
      : pointPlacements[0];
    const chapterId = row.chapter_id ?? preferredPlacement?.chapter_id ?? null;
    const placementId = row.placement_id ?? preferredPlacement?.id ?? null;
    const current = grouped.get(row.point_id) ?? {
      id: row.point_id,
      title: row.title,
      status: row.status,
      updated_at: row.updated_at,
      match_types: [],
      contexts: [],
      chapter_id: chapterId,
      placement_id: placementId,
    };
    if (!current.match_types.includes(row.match_type)) current.match_types.push(row.match_type);
    const context = makeSnippet(row.match_text, trimmedQuery);
    if (context && !current.contexts.some((item) => item.type === row.match_type && item.text === context)) {
      current.contexts.push({
        type: row.match_type,
        text: context,
        chapter_id: chapterId,
        placement_id: placementId,
        path: chapterPath(tree.chapters, chapterId),
      });
    }
    grouped.set(row.point_id, current);
  }

  const priority: Record<string, number> = { title: 0, explanation: 1, exercises: 2, supplement: 3, inspiration: 4, chapter_note: 5, tag: 6 };
  return [...grouped.values()]
    .map((item) => ({
      ...item,
      paths: [...new Set(placements.filter((placement) => placement.knowledge_point_id === item.id).map((placement) => chapterPath(tree.chapters, placement.chapter_id)).filter(Boolean))],
      tags: tagsByPoint.get(item.id) ?? [],
      context: [...item.contexts].sort((left, right) => (priority[left.type] ?? 99) - (priority[right.type] ?? 99))[0] ?? null,
    }))
    .sort((left, right) => {
      const leftPriority = Math.min(...left.match_types.map((type) => priority[type] ?? 99));
      const rightPriority = Math.min(...right.match_types.map((type) => priority[type] ?? 99));
      return leftPriority - rightPriority || right.updated_at.localeCompare(left.updated_at);
    });
}

async function createTag(client: SupabaseClient, name: unknown) {
  if (!isTagName(name)) throw new Error("TAG_NAME_INVALID");
  const trimmed = name.trim();
  const { data: existing, error: existingError } = await client
    .from("tags")
    .select("id,name,created_at,updated_at")
    .ilike("name", trimmed)
    .limit(1)
    .maybeSingle();
  if (existingError) throw existingError;
  if (existing) return { tag: existing as Tag, created: false };
  const { data, error } = await client
    .from("tags")
    .insert({ name: trimmed })
    .select("id,name,created_at,updated_at")
    .single();
  if (error) throw error;
  return { tag: data as Tag, created: true };
}

async function renameTag(client: SupabaseClient, id: string, name: unknown) {
  if (!isUuid(id)) throw new Error("TAG_NOT_FOUND");
  if (!isTagName(name)) throw new Error("TAG_NAME_INVALID");
  const { data, error } = await client
    .from("tags")
    .update({ name: name.trim() })
    .eq("id", id)
    .select("id,name,created_at,updated_at")
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("TAG_NOT_FOUND");
  return data as Tag;
}

async function deleteTag(client: SupabaseClient, id: string) {
  if (!isUuid(id)) throw new Error("TAG_NOT_FOUND");
  const { count, error: linkError } = await client
    .from("knowledge_point_tags")
    .select("tag_id", { count: "exact", head: true })
    .eq("tag_id", id);
  if (linkError) throw linkError;
  if ((count ?? 0) > 0) throw new Error("TAG_IN_USE");
  const { data, error } = await client.from("tags").delete().eq("id", id).select("id").maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("TAG_NOT_FOUND");
}

async function attachTag(client: SupabaseClient, pointId: string, tagId: string) {
  if (!isUuid(pointId) || !isUuid(tagId)) throw new Error("TAG_PAYLOAD_INVALID");
  const point = await readKnowledgePoint(client, pointId);
  if (point.error) throw point.error;
  if (!point.data) throw new Error("KNOWLEDGE_POINT_NOT_FOUND");
  const { data: tag, error: tagError } = await client.from("tags").select("id").eq("id", tagId).maybeSingle();
  if (tagError) throw tagError;
  if (!tag) throw new Error("TAG_NOT_FOUND");
  const { error } = await client.from("knowledge_point_tags").insert({ knowledge_point_id: pointId, tag_id: tagId });
  if (error) {
    if (error.code === "23505") throw new Error("TAG_DUPLICATE");
    throw error;
  }
  return readTagsForPoint(client, pointId);
}

async function detachTag(client: SupabaseClient, pointId: string, tagId: string) {
  if (!isUuid(pointId) || !isUuid(tagId)) throw new Error("TAG_PAYLOAD_INVALID");
  const { error } = await client.from("knowledge_point_tags").delete().eq("knowledge_point_id", pointId).eq("tag_id", tagId);
  if (error) throw error;
  return readTagsForPoint(client, pointId);
}

async function setFavorite(client: SupabaseClient, pointId: string, favorite: boolean) {
  if (!isUuid(pointId)) throw new Error("FAVORITE_PAYLOAD_INVALID");
  const point = await readKnowledgePoint(client, pointId);
  if (point.error) throw point.error;
  if (!point.data) throw new Error("KNOWLEDGE_POINT_NOT_FOUND");
  if (favorite) {
    const { error } = await client.from("favorite_items").upsert({ knowledge_point_id: pointId }, { onConflict: "knowledge_point_id" });
    if (error) throw error;
  } else {
    const { error } = await client.from("favorite_items").delete().eq("knowledge_point_id", pointId);
    if (error) throw error;
  }
  return { favorite };
}

async function setPin(client: SupabaseClient, itemType: "chapter" | "knowledge_point", itemId: string) {
  if (!isUuid(itemId)) throw new Error("PIN_PAYLOAD_INVALID");
  const existing = await client.from("pinned_items").select("id").eq("item_type", itemType).eq("item_id", itemId).maybeSingle();
  if (existing.error) throw existing.error;
  if (existing.data) throw new Error("PIN_DUPLICATE");
  const active = itemType === "chapter" ? await readChapter(client, itemId) : await readKnowledgePoint(client, itemId);
  if (active.error) throw active.error;
  if (!active.data) throw new Error(itemType === "chapter" ? "CHAPTER_NOT_FOUND" : "KNOWLEDGE_POINT_NOT_FOUND");
  const { count, error: countError } = await client.from("pinned_items").select("id", { count: "exact", head: true });
  if (countError) throw countError;
  if ((count ?? 0) >= 4) throw new Error("PIN_LIMIT");
  const { data, error } = await client
    .from("pinned_items")
    .insert({ item_type: itemType, item_id: itemId, sort_order: count ?? 0 })
    .select("id,item_type,item_id,sort_order,created_at")
    .single();
  if (error) throw error;
  return data;
}

async function removePin(client: SupabaseClient, itemType: string | null, itemId: string | null, pinId: string | null) {
  let query = client.from("pinned_items").delete();
  if (isUuid(pinId)) query = query.eq("id", pinId);
  else if (isPinType(itemType) && isUuid(itemId)) query = query.eq("item_type", itemType).eq("item_id", itemId);
  else throw new Error("PIN_PAYLOAD_INVALID");
  const { error } = await query;
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
  if (request.method === "GET" && resource === "backup") {
    try {
      return json(request, 200, { ok: true, backup: await buildFullBackup(client) });
    } catch (error) {
      return databaseError(request, error, "完整备份生成失败，请重试。");
    }
  }

  if ((request.method === "POST" && (resource === "backup_preflight" || resource === "backup_restore"))) {
    const contentLength = Number(request.headers.get("Content-Length") ?? "0");
    if (contentLength > MAX_BACKUP_BYTES + 200_000) return databaseError(request, new Error("BACKUP_SIZE_LIMIT"), "备份文件过大，无法安全处理。");
    const payload = await parseBody(request);
    if (!payload || !("backup" in payload)) return databaseError(request, new Error("BACKUP_INVALID"), "这不是有效的悠扬讲义完整备份文件。");
    try {
      const backup = await validateFullBackup(payload.backup);
      if (resource === "backup_preflight") {
        return json(request, 200, { ok: true, preflight: await preflightFullBackup(client, backup) });
      }
      return json(request, 200, { ok: true, ...(await restoreFullBackup(client, backup)) });
    } catch (error) {
      return databaseError(request, error, resource === "backup_preflight" ? "备份预检失败，请检查文件后重试。" : "恢复失败，数据库已保持恢复前状态。");
    }
  }

  if (request.method === "GET" && resource === "history") {
    const url = new URL(request.url);
    const kind = url.searchParams.get("kind");
    const id = kind === "shared" ? url.searchParams.get("knowledge_point_id") : url.searchParams.get("placement_id");
    if (!isHistoryKind(kind) || !isUuid(id)) return validationError(request, "历史版本参数无效。");
    try {
      return json(request, 200, { ok: true, kind, ...(await readHistory(client, kind, id)) });
    } catch (error) {
      return databaseError(request, error, "历史版本读取失败。");
    }
  }

  if (request.method === "GET" && resource === "history_version") {
    const url = new URL(request.url);
    const kind = url.searchParams.get("kind");
    const id = url.searchParams.get("id") ?? url.searchParams.get("version_id");
    if (!isHistoryKind(kind) || !isUuid(id)) return validationError(request, "历史版本参数无效。");
    try {
      return json(request, 200, { ok: true, kind, ...(await readHistoryVersion(client, kind, id)) });
    } catch (error) {
      return databaseError(request, error, "历史版本读取失败。");
    }
  }

  if (request.method === "POST" && resource === "history") {
    const payload = await parseBody(request) as HistoryPayload | null;
    if (!payload || !isHistoryKind(payload.kind)) return validationError(request, "历史版本参数无效。");
    const id = payload.kind === "shared" ? payload.knowledge_point_id : payload.placement_id;
    if (!isUuid(id)) return validationError(request, "历史版本对象无效。");
    try {
      const version = payload.kind === "shared"
        ? await createKnowledgePointVersion(client, id, payload.snapshot)
        : await createPlacementNoteVersion(client, id, payload.snapshot);
      return json(request, 201, { ok: true, kind: payload.kind, version });
    } catch (error) {
      return databaseError(request, error, "历史快照保存失败。");
    }
  }

  if (request.method === "POST" && resource === "restore_history") {
    const payload = await parseBody(request) as HistoryPayload | null;
    if (!payload || !isHistoryKind(payload.kind) || !isUuid(payload.version_id)) {
      return validationError(request, "历史版本恢复参数无效。");
    }
    try {
      return json(request, 200, { ok: true, ...(await restoreHistory(client, payload.kind, payload.version_id)) });
    } catch (error) {
      return databaseError(request, error, "历史版本恢复失败。");
    }
  }

  if (request.method === "GET" && resource === "recycle_bin") {
    const kind = new URL(request.url).searchParams.get("kind") ?? "all";
    if (kind !== "all" && kind !== "chapter" && kind !== "knowledge_point") {
      return validationError(request, "回收站筛选参数无效。");
    }
    try {
      return json(request, 200, { ok: true, ...(await readRecycleBin(client, kind)) });
    } catch (error) {
      return databaseError(request, error, "回收站读取失败。");
    }
  }

  if (request.method === "POST" && resource === "restore_recycle") {
    const payload = await parseBody(request) as RecycleRestorePayload | null;
    if (!payload || !isUuid(payload.id) || (payload.kind !== "chapter" && payload.kind !== "knowledge_point")) {
      return validationError(request, "回收站恢复参数无效。");
    }
    try {
      return json(request, 200, { ok: true, ...(await restoreRecycleItem(client, payload)) });
    } catch (error) {
      return databaseError(request, error, "回收站恢复失败。");
    }
  }

  if (request.method === "GET" && resource === "search") {
    const url = new URL(request.url);
    const query = url.searchParams.get("q") ?? "";
    const status = url.searchParams.get("status");
    const tagId = url.searchParams.get("tag_id");
    try {
      return json(request, 200, { ok: true, query: query.trim(), results: await searchKnowledgePoints(client, query, status, tagId) });
    } catch (error) {
      return databaseError(request, error, "搜索失败，请稍后重试。");
    }
  }

  if (request.method === "GET" && resource === "tags") {
    return json(request, 200, { ok: true, tags: await readTags(client) });
  }

  if (request.method === "GET" && resource === "discovery_meta") {
    const id = new URL(request.url).searchParams.get("id");
    if (!isUuid(id)) return validationError(request, "知识点快速访问参数无效。");
    return json(request, 200, { ok: true, ...(await readDiscoveryMeta(client, id)) });
  }

  if (request.method === "GET" && resource === "fast_access") {
    return json(request, 200, { ok: true, ...(await readFastAccess(client)) });
  }

  if (request.method === "POST" && resource === "tag") {
    const payload = await parseBody(request) as TagPayload | null;
    if (!payload) return validationError(request, "请求内容不是有效 JSON。");
    try {
      return json(request, 201, { ok: true, ...(await createTag(client, payload.name)) });
    } catch (error) {
      return databaseError(request, error, "标签创建失败。");
    }
  }

  if (request.method === "PATCH" && resource === "tag") {
    const id = new URL(request.url).searchParams.get("id");
    const payload = await parseBody(request) as TagPayload | null;
    if (!payload || !isUuid(id)) return validationError(request, "标签参数无效。");
    try {
      return json(request, 200, { ok: true, tag: await renameTag(client, id, payload.name) });
    } catch (error) {
      return databaseError(request, error, "标签更新失败。");
    }
  }

  if (request.method === "DELETE" && resource === "tag") {
    const id = new URL(request.url).searchParams.get("id");
    try {
      await deleteTag(client, id ?? "");
      return json(request, 200, { ok: true, deleted: true });
    } catch (error) {
      return databaseError(request, error, "标签删除失败。");
    }
  }

  if (request.method === "POST" && resource === "knowledge_point_tag") {
    const payload = await parseBody(request) as TagPayload | null;
    if (!payload || !isUuid(payload.knowledge_point_id) || !isUuid(payload.tag_id)) {
      return validationError(request, "知识点标签参数无效。");
    }
    try {
      return json(request, 201, { ok: true, tags: await attachTag(client, payload.knowledge_point_id, payload.tag_id) });
    } catch (error) {
      return databaseError(request, error, "添加标签失败。");
    }
  }

  if (request.method === "DELETE" && resource === "knowledge_point_tag") {
    const url = new URL(request.url);
    const pointId = url.searchParams.get("knowledge_point_id");
    const tagId = url.searchParams.get("tag_id");
    try {
      return json(request, 200, { ok: true, tags: await detachTag(client, pointId ?? "", tagId ?? "") });
    } catch (error) {
      return databaseError(request, error, "移除标签失败。");
    }
  }

  if (request.method === "PATCH" && resource === "favorite") {
    const payload = await parseBody(request) as TagPayload | null;
    if (!payload || !isUuid(payload.knowledge_point_id) || typeof payload.favorite !== "boolean") {
      return validationError(request, "收藏参数无效。");
    }
    try {
      return json(request, 200, { ok: true, ...(await setFavorite(client, payload.knowledge_point_id, payload.favorite)) });
    } catch (error) {
      return databaseError(request, error, "收藏状态更新失败。");
    }
  }

  if (request.method === "POST" && resource === "pin") {
    const payload = await parseBody(request) as TagPayload | null;
    if (!payload || !isPinType(payload.item_type) || !isUuid(payload.item_id)) {
      return validationError(request, "置顶参数无效。");
    }
    try {
      return json(request, 201, { ok: true, pinned: await setPin(client, payload.item_type, payload.item_id) });
    } catch (error) {
      return databaseError(request, error, "置顶失败。");
    }
  }

  if (request.method === "DELETE" && resource === "pin") {
    const url = new URL(request.url);
    try {
      await removePin(client, url.searchParams.get("item_type"), url.searchParams.get("item_id"), url.searchParams.get("id"));
      return json(request, 200, { ok: true });
    } catch (error) {
      return databaseError(request, error, "取消置顶失败。");
    }
  }

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

  if (request.method === "GET" && resource === "placements") {
    const id = new URL(request.url).searchParams.get("id");
    if (!isUuid(id)) return validationError(request, "知识点引用参数无效。");
    return json(request, 200, { ok: true, ...(await readKnowledgePointPlacements(client, id)) });
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

  if (request.method === "POST" && resource === "placement") {
    const payload = await parseBody(request) as KnowledgePointPayload | null;
    if (!payload || !isUuid(payload.knowledge_point_id) || !isUuid(payload.chapter_id)) {
      return validationError(request, "知识点引用参数无效。");
    }
    try {
      return json(request, 201, {
        ok: true,
        ...(await createPlacement(client, payload.knowledge_point_id, payload.chapter_id)),
      });
    } catch (error) {
      return databaseError(request, error, "添加引用失败。");
    }
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
    if (!payload || !isUuid(placementId)) return validationError(request, "知识点位置参数无效。");
    try {
      if (payload.chapter_id !== undefined) {
        if (!isUuid(payload.chapter_id)) return validationError(request, "知识点移动参数无效。");
        const moved = await moveKnowledgePoint(client, placementId, payload.chapter_id);
        const placement = payload.chapter_note !== undefined
          ? await savePlacementNote(client, placementId, payload.chapter_note)
          : moved;
        return json(request, 200, { ok: true, placement });
      }
      if (payload.chapter_note !== undefined) {
        return json(request, 200, { ok: true, placement: await savePlacementNote(client, placementId, payload.chapter_note) });
      }
      return validationError(request, "没有需要更新的知识点位置内容。");
    } catch (error) {
      return databaseError(request, error, "知识点移动失败。");
    }
  }

  if (request.method === "DELETE" && resource === "placement") {
    const id = new URL(request.url).searchParams.get("id");
    if (!isUuid(id)) return validationError(request, "知识点位置 ID 无效。");
    try {
      return json(request, 200, { ok: true, placement: await removePlacement(client, id) });
    } catch (error) {
      return databaseError(request, error, "移除当前引用失败。");
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
          message: `此章节包含 ${result.child_count} 个子章节和 ${result.knowledge_point_count} 个知识点。`,
          child_count: result.child_count,
          knowledge_point_count: result.knowledge_point_count,
        },
      });
    }
    return json(request, 200, { ok: true, deleted: true });
  }

  if (request.method === "DELETE" && resource === "knowledge_point") {
    const id = new URL(request.url).searchParams.get("id");
    if (!isUuid(id)) return validationError(request, "知识点 ID 无效。");
    const result = await deleteKnowledgePoint(client, id, new URL(request.url).searchParams.get("confirm") === "true");
    if (result.blocked) {
      return json(request, 409, {
        ok: false,
        error: {
          code: "KNOWLEDGE_POINT_SHARED",
          message: `该知识点目前存在于 ${result.placement_count} 个章节中。请确认彻底删除，或只移除当前章节引用。`,
          placement_count: result.placement_count,
        },
      });
    }
    return json(request, 200, { ok: true, deleted: true, placement_count: result.placement_count });
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

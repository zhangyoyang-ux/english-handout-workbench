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
  overview_revision: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

type KnowledgePoint = {
  id: string;
  title: string;
  status: "draft" | "needs_improvement" | "organized";
  core_revision: number;
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
  note_revision: number;
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
  expected_revision?: unknown;
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
  expected_revision?: unknown;
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
// 0007 introduced deletion batches after the two known formal placement deletions.
// Keep the historical deletion timestamp as-is instead of inventing a batch ID.
const PHASE8_DELETION_BATCH_INTRODUCED_AT = "2026-08-16T07:31:30.000Z";

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

class EditConflictError extends Error {
  readonly entity: string;
  readonly currentRevision: number;
  readonly updatedAt: string | null;

  constructor(entity: string, currentRevision: number, updatedAt: string | null) {
    super("EDIT_CONFLICT");
    this.name = "EditConflictError";
    this.entity = entity;
    this.currentRevision = currentRevision;
    this.updatedAt = updatedAt;
  }
}

function expectedRevision(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) throw new Error("EDIT_REVISION_INVALID");
  return value;
}

function throwIfRevisionConflict(value: unknown): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("EDIT_CONFLICT_RESPONSE_INVALID");
  const result = value as Record<string, unknown>;
  if (result.conflict !== true) return;
  if (typeof result.entity !== "string" || typeof result.current_revision !== "number") throw new Error("EDIT_CONFLICT_RESPONSE_INVALID");
  throw new EditConflictError(result.entity, result.current_revision, typeof result.updated_at === "string" ? result.updated_at : null);
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

async function hashLegacyHistorySnapshot(value: unknown) {
  if (!isHistorySnapshot(value)) return null;
  const snapshot = value as Record<string, unknown>;
  const content = snapshot.content as Record<string, unknown>;
  const legacyContent = {
    explanation: content.explanation,
    exercises: content.exercises,
    supplement: content.supplement,
    inspiration: content.inspiration,
  };
  return hashJson({ title: snapshot.title, status: snapshot.status, content: legacyContent });
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
  let postCheck: { passed: boolean; counts: Record<BackupTableName, number> };
  try {
    postCheck = await postRestoreVerify(client, backup);
  } catch {
    throw new Error("BACKUP_POSTCHECK_FAILED");
  }
  return { restore: data as Record<string, unknown>, post_check: postCheck };
}

type IntegrityIssueSeverity = "WARNING" | "ERROR";
type IntegritySectionStatus = "PASS" | "WARNING" | "ERROR" | "CHECK_FAILED";
type IntegrityIssue = {
  severity: IntegrityIssueSeverity;
  code: string;
  message: string;
  entity_type?: string;
  entity_id?: string;
  related_ids?: string[];
};
type IntegrityTableResult = { rows: Array<Record<string, unknown>>; error: unknown | null };
type IntegrityTables = Partial<Record<BackupTableName, IntegrityTableResult>>;
type IntegritySection = {
  key: string;
  label: string;
  status: IntegritySectionStatus;
  summary: string;
  checked: number;
  issue_count: number;
  error_count: number;
  warning_count: number;
  legacy_count: number;
  displayed_issue_count: number;
  truncated_issue_count: number;
  issues: IntegrityIssue[];
};
type IntegrityReport = {
  status: "PASS" | "WARNING" | "ERROR" | "CHECK_FAILED";
  checked_at: string;
  schema_version: string;
  backup_format_version: 1;
  issue_count: number;
  legacy_count: number;
  summary: string;
  sections: IntegritySection[];
  report_text: string;
};

const INTEGRITY_ISSUE_DISPLAY_LIMIT = 80;

function integrityRows(tables: IntegrityTables, table: BackupTableName) {
  return tables[table]?.rows ?? [];
}

function integrityTableFailed(tables: IntegrityTables, table: BackupTableName) {
  return !tables[table] || Boolean(tables[table]?.error);
}

function integrityAnyTableFailed(tables: IntegrityTables, requiredTables: BackupTableName[]) {
  return requiredTables.some((table) => integrityTableFailed(tables, table));
}

function createIntegrityCollector() {
  const issues: IntegrityIssue[] = [];
  let issueCount = 0;
  let errorCount = 0;
  let warningCount = 0;
  let legacyCount = 0;
  const add = (issue: IntegrityIssue) => {
    issueCount += 1;
    if (issue.severity === "ERROR") errorCount += 1;
    else warningCount += 1;
    if (issues.length < INTEGRITY_ISSUE_DISPLAY_LIMIT) issues.push(issue);
  };
  const addLegacy = () => { legacyCount += 1; };
  return { issues, add, addLegacy, get issueCount() { return issueCount; }, get errorCount() { return errorCount; }, get warningCount() { return warningCount; }, get legacyCount() { return legacyCount; } };
}

function integritySection(
  key: string,
  label: string,
  checked: number,
  collector: ReturnType<typeof createIntegrityCollector>,
  failed: boolean,
): IntegritySection {
  const status: IntegritySectionStatus = failed
    ? "CHECK_FAILED"
    : collector.errorCount > 0
      ? "ERROR"
      : collector.warningCount > 0
        ? "WARNING"
        : "PASS";
  const summary = failed
    ? "未能读取本项所需的全部数据，检查未完整完成。"
    : status === "ERROR"
      ? `发现 ${collector.errorCount} 个错误。`
      : status === "WARNING"
        ? `发现 ${collector.warningCount} 个需要留意的警告。`
        : `已检查 ${checked} 项，未发现问题。`;
  return {
    key,
    label,
    status,
    summary,
    checked,
    issue_count: collector.issueCount,
    error_count: collector.errorCount,
    warning_count: collector.warningCount,
    legacy_count: collector.legacyCount,
    displayed_issue_count: collector.issues.length,
    truncated_issue_count: Math.max(0, collector.issueCount - collector.issues.length),
    issues: collector.issues,
  };
}

async function readIntegrityTables(client: SupabaseClient): Promise<IntegrityTables> {
  const columns: Record<BackupTableName, string> = {
    stage1_notes: "id,title,content,created_at,updated_at",
    workbench_initialization: "key,initialized_at",
    chapters: "id,title,parent_id,sort_order,content,created_at,updated_at,deleted_at,deletion_batch_id,overview_revision",
    knowledge_points: "id,title,status,created_at,updated_at,deleted_at,deletion_batch_id,core_revision",
    knowledge_point_contents: "id,knowledge_point_id,explanation,exercises,supplement,inspiration,created_at,updated_at",
    knowledge_point_placements: "id,knowledge_point_id,chapter_id,sort_order,created_at,chapter_note,deleted_at,deletion_batch_id,note_revision",
    tags: "id,name,created_at,updated_at",
    knowledge_point_tags: "knowledge_point_id,tag_id,created_at",
    favorite_items: "knowledge_point_id,created_at",
    pinned_items: "id,item_type,item_id,sort_order,created_at",
    knowledge_point_versions: "id,knowledge_point_id,snapshot,content_hash,version_source,created_at",
    placement_note_versions: "id,placement_id,chapter_note_snapshot,content_hash,version_source,created_at",
  };
  const results = await Promise.all(BACKUP_TABLES.map(async (table) => {
    try {
      const orderColumns = table === "workbench_initialization"
        ? ["key"]
        : table === "knowledge_point_tags"
          ? ["knowledge_point_id", "tag_id"]
          : table === "favorite_items"
            ? ["knowledge_point_id"]
          : ["id"];
      const rows = await readAllRows<Record<string, unknown>>(client, table, columns[table], orderColumns);
      return [table, { rows, error: null }] as const;
    } catch (error) {
      return [table, { rows: [], error }] as const;
    }
  }));
  return Object.fromEntries(results) as IntegrityTables;
}

function integrityIsActive(row: Record<string, unknown>) {
  return row.deleted_at === null;
}

function integrityIsDeleted(row: Record<string, unknown>) {
  return typeof row.deleted_at === "string";
}

function integrityId(row: Record<string, unknown>, key = "id") {
  return typeof row[key] === "string" ? row[key] : undefined;
}

function integrityValidSort(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function integrityValidRevision(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1;
}

function integrityValidDate(value: unknown) {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function integrityRichDocument(value: unknown): { valid: boolean; reason?: string } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return { valid: false, reason: "根节点不是对象" };
  const root = value as Record<string, unknown>;
  if (root.type !== "doc") return { valid: false, reason: "根节点 type 不是 doc" };
  if (!Array.isArray(root.content)) return { valid: false, reason: "根节点缺少 content 数组" };
  try {
    if (JSON.stringify(value).length > MAX_RICH_DOCUMENT_LENGTH) return { valid: false, reason: "富文本内容超过长度限制" };
  } catch {
    return { valid: false, reason: "富文本内容无法序列化" };
  }
  const walk = (node: unknown): string | null => {
    if (typeof node !== "object" || node === null || Array.isArray(node)) return "节点不是对象";
    const record = node as Record<string, unknown>;
    if (typeof record.type !== "string" || record.type.length === 0) return "节点缺少 type";
    if (record.type === "text" && typeof record.text !== "string") return "text 节点缺少文字";
    if (record.type !== "text" && record.text !== undefined) return "非 text 节点包含 text";
    if (record.marks !== undefined && (!Array.isArray(record.marks) || record.marks.some((mark) => typeof mark !== "object" || mark === null || Array.isArray(mark) || typeof (mark as Record<string, unknown>).type !== "string"))) return "marks 结构无效";
    if (record.attrs !== undefined && (typeof record.attrs !== "object" || record.attrs === null || Array.isArray(record.attrs))) return "attrs 结构无效";
    if (record.content !== undefined) {
      if (!Array.isArray(record.content)) return "content 结构无效";
      for (const child of record.content) {
        const reason = walk(child);
        if (reason) return reason;
      }
    }
    return null;
  };
  for (const child of root.content) {
    const reason = walk(child);
    if (reason) return { valid: false, reason };
  }
  return { valid: true };
}

function integrityHistorySnapshot(value: unknown): { valid: boolean; reason?: string } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return { valid: false, reason: "历史快照不是对象" };
  const snapshot = value as Record<string, unknown>;
  if (!isNonEmptyTitle(snapshot.title)) return { valid: false, reason: "历史快照标题无效" };
  if (typeof snapshot.status !== "string" || !STATUS_VALUES.has(snapshot.status)) return { valid: false, reason: "历史快照状态无效" };
  if (typeof snapshot.content !== "object" || snapshot.content === null || Array.isArray(snapshot.content)) return { valid: false, reason: "历史快照缺少 content" };
  const content = snapshot.content as Record<string, unknown>;
  for (const field of CONTENT_FIELDS) {
    const result = integrityRichDocument(content[field]);
    if (!result.valid) return { valid: false, reason: `${field}：${result.reason ?? "富文本结构无效"}` };
  }
  return { valid: true };
}

async function integrityHashMatches(value: unknown, storedHash: unknown) {
  return typeof storedHash === "string" && /^[0-9a-f]{64}$/i.test(storedHash) && storedHash.toLowerCase() === (await hashJson(value)).toLowerCase();
}

async function integrityHistoryHashStatus(value: unknown, storedHash: unknown): Promise<"CURRENT" | "LEGACY" | "INVALID"> {
  if (typeof storedHash !== "string" || !/^[0-9a-f]{64}$/i.test(storedHash)) return "INVALID";
  if (await integrityHashMatches(value, storedHash)) return "CURRENT";
  const legacyHash = await hashLegacyHistorySnapshot(value);
  return legacyHash && legacyHash.toLowerCase() === storedHash.toLowerCase() ? "LEGACY" : "INVALID";
}

function integrityIsLegacyDeletedWithoutBatch(row: Record<string, unknown>) {
  return integrityIsDeleted(row)
    && row.deletion_batch_id === null
    && typeof row.deleted_at === "string"
    && Number.isFinite(Date.parse(row.deleted_at))
    && Date.parse(row.deleted_at) < Date.parse(PHASE8_DELETION_BATCH_INTRODUCED_AT);
}

function integrityIsMissingDeletionBatch(row: Record<string, unknown>) {
  return integrityIsDeleted(row) && row.deletion_batch_id === null && !integrityIsLegacyDeletedWithoutBatch(row);
}

function integrityCheckChapters(tables: IntegrityTables) {
  const rows = integrityRows(tables, "chapters");
  const collector = createIntegrityCollector();
  const byId = new Map<string, Record<string, unknown>>();
  const activeChildren = new Map<string, Record<string, unknown>[]>();
  for (const row of rows) {
    const id = integrityId(row);
    if (!id || !isUuid(id)) collector.add({ severity: "ERROR", code: "CHAPTER_ID_INVALID", message: "章节 ID 无效。", entity_type: "chapter", entity_id: id });
    else if (byId.has(id)) collector.add({ severity: "ERROR", code: "CHAPTER_ID_DUPLICATE", message: "章节 ID 重复。", entity_type: "chapter", entity_id: id });
    else byId.set(id, row);
    if (!isNonEmptyTitle(row.title)) collector.add({ severity: "ERROR", code: "CHAPTER_TITLE_INVALID", message: "章节标题为空或超过长度限制。", entity_type: "chapter", entity_id: id });
    if (!integrityValidSort(row.sort_order)) collector.add({ severity: "ERROR", code: "CHAPTER_SORT_INVALID", message: "章节排序值无效。", entity_type: "chapter", entity_id: id });
    if (!integrityValidDate(row.created_at) || !integrityValidDate(row.updated_at)) collector.add({ severity: "ERROR", code: "CHAPTER_TIMESTAMP_INVALID", message: "章节时间字段无效。", entity_type: "chapter", entity_id: id });
    if (row.deleted_at !== null && !integrityIsDeleted(row)) collector.add({ severity: "ERROR", code: "CHAPTER_DELETED_AT_INVALID", message: "章节 deleted_at 字段无效。", entity_type: "chapter", entity_id: id });
    if (integrityIsLegacyDeletedWithoutBatch(row)) collector.addLegacy();
    else if (integrityIsMissingDeletionBatch(row)) collector.add({ severity: "ERROR", code: "CHAPTER_DELETION_BATCH_MISSING", message: "回收站章节缺少删除批次标记。", entity_type: "chapter", entity_id: id });
    if (integrityIsActive(row)) {
      const parentId = row.parent_id === null ? null : typeof row.parent_id === "string" ? row.parent_id : undefined;
      const siblingKey = parentId ?? "__root__";
      const siblings = activeChildren.get(siblingKey) ?? [];
      siblings.push(row);
      activeChildren.set(siblingKey, siblings);
    }
  }
  for (const row of rows) if (integrityIsActive(row)) {
    const id = integrityId(row);
    const parentId = row.parent_id === null ? null : typeof row.parent_id === "string" ? row.parent_id : undefined;
    if (parentId === undefined) collector.add({ severity: "ERROR", code: "CHAPTER_PARENT_INVALID", message: "活动章节的 parent_id 无效。", entity_type: "chapter", entity_id: id });
    else if (parentId === id) collector.add({ severity: "ERROR", code: "CHAPTER_SELF_PARENT", message: "章节不能把自己设为父章节。", entity_type: "chapter", entity_id: id });
    else if (parentId && !byId.has(parentId)) collector.add({ severity: "ERROR", code: "CHAPTER_PARENT_MISSING", message: "活动章节的父章节不存在。", entity_type: "chapter", entity_id: id, related_ids: [parentId] });
    else if (parentId && integrityIsDeleted(byId.get(parentId)!)) collector.add({ severity: "ERROR", code: "CHAPTER_PARENT_DELETED", message: "活动章节的父章节在回收站中。", entity_type: "chapter", entity_id: id, related_ids: [parentId] });
  }
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const stack: string[] = [];
  const cycles = new Set<string>();
  const visit = (id: string) => {
    if (visiting.has(id)) {
      const start = stack.indexOf(id);
      const cycle = stack.slice(start).sort().join(",");
      if (cycle && !cycles.has(cycle)) {
        cycles.add(cycle);
        collector.add({ severity: "ERROR", code: "CHAPTER_CYCLE", message: "章节父子关系存在循环。", entity_type: "chapter", related_ids: stack.slice(start) });
      }
      return;
    }
    if (visited.has(id)) return;
    visiting.add(id); stack.push(id);
    const parentId = byId.get(id)?.parent_id;
    if (typeof parentId === "string" && parentId !== id && byId.has(parentId)) visit(parentId);
    stack.pop(); visiting.delete(id); visited.add(id);
  };
  for (const id of byId.keys()) visit(id);
  for (const [parentId, siblings] of activeChildren) {
    const sortMap = new Map<string, string[]>();
    for (const sibling of siblings) {
      const sort = String(sibling.sort_order);
      const ids = sortMap.get(sort) ?? [];
      if (integrityId(sibling)) ids.push(integrityId(sibling)!);
      sortMap.set(sort, ids);
    }
    for (const [sort, ids] of sortMap) if (ids.length > 1) collector.add({ severity: "WARNING", code: "CHAPTER_SORT_DUPLICATE", message: `同一父章节下有多个活动章节使用排序值 ${sort}。`, entity_type: "chapter_group", related_ids: [parentId, ...ids] });
  }
  return integritySection("chapters", "章节目录", rows.length, collector, integrityTableFailed(tables, "chapters"));
}

function integrityCheckKnowledgePoints(tables: IntegrityTables) {
  const points = integrityRows(tables, "knowledge_points");
  const contents = integrityRows(tables, "knowledge_point_contents");
  const collector = createIntegrityCollector();
  const byId = new Map<string, Record<string, unknown>>();
  const contentByPoint = new Map<string, Record<string, unknown>[]>();
  for (const row of points) {
    const id = integrityId(row);
    if (!id || !isUuid(id)) collector.add({ severity: "ERROR", code: "KNOWLEDGE_POINT_ID_INVALID", message: "知识点 ID 无效。", entity_type: "knowledge_point", entity_id: id });
    else if (byId.has(id)) collector.add({ severity: "ERROR", code: "KNOWLEDGE_POINT_ID_DUPLICATE", message: "知识点 ID 重复。", entity_type: "knowledge_point", entity_id: id });
    else byId.set(id, row);
    if (!isNonEmptyTitle(row.title)) collector.add({ severity: "ERROR", code: "KNOWLEDGE_POINT_TITLE_INVALID", message: "知识点标题为空或超过长度限制。", entity_type: "knowledge_point", entity_id: id });
    if (typeof row.status !== "string" || !STATUS_VALUES.has(row.status)) collector.add({ severity: "ERROR", code: "KNOWLEDGE_POINT_STATUS_INVALID", message: "知识点状态无效。", entity_type: "knowledge_point", entity_id: id });
    if (!integrityValidDate(row.created_at) || !integrityValidDate(row.updated_at)) collector.add({ severity: "ERROR", code: "KNOWLEDGE_POINT_TIMESTAMP_INVALID", message: "知识点时间字段无效。", entity_type: "knowledge_point", entity_id: id });
    if (row.deleted_at !== null && !integrityIsDeleted(row)) collector.add({ severity: "ERROR", code: "KNOWLEDGE_POINT_DELETED_AT_INVALID", message: "知识点 deleted_at 字段无效。", entity_type: "knowledge_point", entity_id: id });
    if (integrityIsLegacyDeletedWithoutBatch(row)) collector.addLegacy();
    else if (integrityIsMissingDeletionBatch(row)) collector.add({ severity: "ERROR", code: "KNOWLEDGE_POINT_DELETION_BATCH_MISSING", message: "回收站知识点缺少删除批次标记。", entity_type: "knowledge_point", entity_id: id });
    if (integrityIsActive(row) && !integrityValidRevision(row.core_revision)) collector.add({ severity: "ERROR", code: "CORE_REVISION_INVALID", message: "活动知识点的版本号无效。", entity_type: "knowledge_point", entity_id: id });
  }
  for (const row of contents) {
    const id = integrityId(row);
    const pointId = typeof row.knowledge_point_id === "string" ? row.knowledge_point_id : undefined;
    if (!id || !isUuid(id)) collector.add({ severity: "ERROR", code: "CONTENT_ID_INVALID", message: "知识点正文记录 ID 无效。", entity_type: "knowledge_point_content", entity_id: id });
    if (!pointId || !byId.has(pointId)) collector.add({ severity: "ERROR", code: "CONTENT_POINT_MISSING", message: "知识点正文找不到对应的知识点。", entity_type: "knowledge_point_content", entity_id: id, related_ids: pointId ? [pointId] : undefined });
    else {
      const records = contentByPoint.get(pointId) ?? [];
      records.push(row); contentByPoint.set(pointId, records);
    }
    for (const field of CONTENT_FIELDS) {
      const result = integrityRichDocument(row[field]);
      if (!result.valid) collector.add({ severity: "ERROR", code: "RICH_CONTENT_INVALID", message: `知识点正文的 ${field} 结构无效：${result.reason ?? "格式错误"}。`, entity_type: "knowledge_point_content", entity_id: id });
    }
  }
  for (const [pointId, records] of contentByPoint) if (records.length > 1) collector.add({ severity: "ERROR", code: "CONTENT_DUPLICATE", message: "同一知识点存在多份正文记录。", entity_type: "knowledge_point", entity_id: pointId, related_ids: records.map((row) => integrityId(row)).filter((id): id is string => Boolean(id)) });
  for (const [pointId, point] of byId) if (integrityIsActive(point) && (contentByPoint.get(pointId)?.length ?? 0) !== 1) collector.add({ severity: "ERROR", code: "CONTENT_MISSING", message: "活动知识点缺少唯一的正文记录。", entity_type: "knowledge_point", entity_id: pointId });
  const failed = integrityAnyTableFailed(tables, ["knowledge_points", "knowledge_point_contents"]);
  return integritySection("knowledge_points", "知识点与正文记录", points.length + contents.length, collector, failed);
}

function integrityCheckPlacements(tables: IntegrityTables) {
  const placements = integrityRows(tables, "knowledge_point_placements");
  const points = new Map(integrityRows(tables, "knowledge_points").map((row) => [integrityId(row), row] as const).filter(([id]) => Boolean(id)) as Array<[string, Record<string, unknown>]>);
  const chapters = new Map(integrityRows(tables, "chapters").map((row) => [integrityId(row), row] as const).filter(([id]) => Boolean(id)) as Array<[string, Record<string, unknown>]>);
  const collector = createIntegrityCollector();
  const activePairs = new Map<string, string[]>();
  const activeSorts = new Map<string, string[]>();
  for (const row of placements) {
    const id = integrityId(row);
    const pointId = typeof row.knowledge_point_id === "string" ? row.knowledge_point_id : undefined;
    const chapterId = typeof row.chapter_id === "string" ? row.chapter_id : undefined;
    if (!id || !isUuid(id)) collector.add({ severity: "ERROR", code: "PLACEMENT_ID_INVALID", message: "知识点位置 ID 无效。", entity_type: "placement", entity_id: id });
    if (!pointId || !points.has(pointId)) collector.add({ severity: "ERROR", code: "PLACEMENT_POINT_MISSING", message: "知识点位置找不到对应的知识点。", entity_type: "placement", entity_id: id, related_ids: pointId ? [pointId] : undefined });
    if (!chapterId || !chapters.has(chapterId)) collector.add({ severity: "ERROR", code: "PLACEMENT_CHAPTER_MISSING", message: "知识点位置找不到对应的章节。", entity_type: "placement", entity_id: id, related_ids: chapterId ? [chapterId] : undefined });
    if (!integrityValidSort(row.sort_order)) collector.add({ severity: "ERROR", code: "PLACEMENT_SORT_INVALID", message: "知识点位置排序值无效。", entity_type: "placement", entity_id: id });
    if (row.deleted_at !== null && !integrityIsDeleted(row)) collector.add({ severity: "ERROR", code: "PLACEMENT_DELETED_AT_INVALID", message: "知识点位置 deleted_at 字段无效。", entity_type: "placement", entity_id: id });
    if (integrityIsLegacyDeletedWithoutBatch(row)) collector.addLegacy();
    else if (integrityIsMissingDeletionBatch(row)) collector.add({ severity: "ERROR", code: "PLACEMENT_DELETION_BATCH_MISSING", message: "回收站知识点位置缺少删除批次标记。", entity_type: "placement", entity_id: id });
    if (!integrityValidRevision(row.note_revision)) collector.add({ severity: "ERROR", code: "NOTE_REVISION_INVALID", message: "知识点位置的本章补充版本号无效。", entity_type: "placement", entity_id: id });
    if (integrityIsActive(row)) {
      if (pointId && points.has(pointId) && integrityIsDeleted(points.get(pointId)!)) collector.add({ severity: "ERROR", code: "PLACEMENT_POINT_DELETED", message: "活动知识点位置指向了回收站中的知识点。", entity_type: "placement", entity_id: id, related_ids: [pointId] });
      if (chapterId && chapters.has(chapterId) && integrityIsDeleted(chapters.get(chapterId)!)) collector.add({ severity: "ERROR", code: "PLACEMENT_CHAPTER_DELETED", message: "活动知识点位置指向了回收站中的章节。", entity_type: "placement", entity_id: id, related_ids: [chapterId] });
      if (pointId && chapterId) {
        const pair = `${pointId}:${chapterId}`;
        const pairIds = activePairs.get(pair) ?? [];
        pairIds.push(id ?? ""); activePairs.set(pair, pairIds);
        const sortIds = activeSorts.get(chapterId) ?? [];
        sortIds.push(id ?? ""); activeSorts.set(`${chapterId}:${String(row.sort_order)}`, sortIds);
      }
    }
    const rich = integrityRichDocument(row.chapter_note);
    if (!rich.valid) collector.add({ severity: "ERROR", code: "CHAPTER_NOTE_INVALID", message: `本章补充结构无效：${rich.reason ?? "格式错误"}。`, entity_type: "placement", entity_id: id });
  }
  for (const [pair, ids] of activePairs) if (ids.length > 1) collector.add({ severity: "ERROR", code: "PLACEMENT_DUPLICATE", message: "同一个知识点在同一章节存在重复的活动引用。", entity_type: "placement", related_ids: [pair, ...ids] });
  const sortGroups = new Map<string, string[]>();
  for (const row of placements) if (integrityIsActive(row) && typeof row.chapter_id === "string" && integrityId(row)) {
    const key = `${row.chapter_id}:${String(row.sort_order)}`;
    const ids = sortGroups.get(key) ?? []; ids.push(integrityId(row)!); sortGroups.set(key, ids);
  }
  for (const [key, ids] of sortGroups) if (ids.length > 1) collector.add({ severity: "WARNING", code: "PLACEMENT_SORT_DUPLICATE", message: "同一章节下有多个活动知识点使用相同排序值。", entity_type: "placement_group", related_ids: [key, ...ids] });
  for (const [pointId, point] of points) if (integrityIsActive(point) && !placements.some((row) => integrityIsActive(row) && row.knowledge_point_id === pointId)) collector.add({ severity: "WARNING", code: "ACTIVE_POINT_ORPHAN", message: "活动知识点没有活动章节引用。", entity_type: "knowledge_point", entity_id: pointId });
  return integritySection("placements", "章节引用与排序", placements.length, collector, integrityAnyTableFailed(tables, ["knowledge_point_placements", "knowledge_points", "chapters"]));
}

async function integrityCheckRichText(tables: IntegrityTables) {
  const contents = integrityRows(tables, "knowledge_point_contents");
  const placements = integrityRows(tables, "knowledge_point_placements");
  const pointVersions = integrityRows(tables, "knowledge_point_versions");
  const noteVersions = integrityRows(tables, "placement_note_versions");
  const collector = createIntegrityCollector();
  for (const row of contents) for (const field of CONTENT_FIELDS) {
    const result = integrityRichDocument(row[field]);
    if (!result.valid) collector.add({ severity: "ERROR", code: "RICH_CONTENT_INVALID", message: `共享正文 ${field} 结构无效。`, entity_type: "knowledge_point_content", entity_id: integrityId(row) });
  }
  for (const row of placements) {
    const result = integrityRichDocument(row.chapter_note);
    if (!result.valid) collector.add({ severity: "ERROR", code: "CHAPTER_NOTE_INVALID", message: "本章补充富文本结构无效。", entity_type: "placement", entity_id: integrityId(row) });
  }
  for (const row of pointVersions) {
    const snapshot = integrityHistorySnapshot(row.snapshot);
    if (!snapshot.valid) collector.add({ severity: "ERROR", code: "HISTORY_SNAPSHOT_INVALID", message: `知识点历史快照无效：${snapshot.reason ?? "格式错误"}。`, entity_type: "knowledge_point_version", entity_id: integrityId(row) });
  }
  for (const row of noteVersions) {
    const snapshot = integrityRichDocument(row.chapter_note_snapshot);
    if (!snapshot.valid) collector.add({ severity: "ERROR", code: "PLACEMENT_HISTORY_SNAPSHOT_INVALID", message: "本章补充历史快照无效。", entity_type: "placement_note_version", entity_id: integrityId(row) });
  }
  return integritySection("rich_text", "富文本与本章补充", contents.length * CONTENT_FIELDS.length + placements.length + pointVersions.length + noteVersions.length, collector, integrityAnyTableFailed(tables, ["knowledge_point_contents", "knowledge_point_placements", "knowledge_point_versions", "placement_note_versions"]));
}

function integrityCheckTagsAndAccess(tables: IntegrityTables) {
  const tags = integrityRows(tables, "tags");
  const relations = integrityRows(tables, "knowledge_point_tags");
  const favorites = integrityRows(tables, "favorite_items");
  const pins = integrityRows(tables, "pinned_items");
  const points = new Map(integrityRows(tables, "knowledge_points").map((row) => [integrityId(row), row] as const).filter(([id]) => Boolean(id)) as Array<[string, Record<string, unknown>]>);
  const chapters = new Map(integrityRows(tables, "chapters").map((row) => [integrityId(row), row] as const).filter(([id]) => Boolean(id)) as Array<[string, Record<string, unknown>]>);
  const tagMap = new Map<string, Record<string, unknown>>();
  const collector = createIntegrityCollector();
  const tagNames = new Map<string, string[]>();
  for (const row of tags) {
    const id = integrityId(row);
    if (!id || !isUuid(id)) collector.add({ severity: "ERROR", code: "TAG_ID_INVALID", message: "标签 ID 无效。", entity_type: "tag", entity_id: id });
    else tagMap.set(id, row);
    if (!isTagName(row.name)) collector.add({ severity: "ERROR", code: "TAG_NAME_INVALID", message: "标签名称为空或超过长度限制。", entity_type: "tag", entity_id: id });
    else { const names = tagNames.get(row.name) ?? []; names.push(id ?? ""); tagNames.set(row.name, names); }
  }
  for (const [name, ids] of tagNames) if (ids.length > 1) collector.add({ severity: "ERROR", code: "TAG_NAME_DUPLICATE", message: `标签名称“${name}”重复。`, entity_type: "tag", related_ids: ids });
  const relationSet = new Set<string>();
  for (const row of relations) {
    const pointId = typeof row.knowledge_point_id === "string" ? row.knowledge_point_id : undefined;
    const tagId = typeof row.tag_id === "string" ? row.tag_id : undefined;
    const key = `${pointId ?? ""}:${tagId ?? ""}`;
    if (relationSet.has(key)) collector.add({ severity: "ERROR", code: "TAG_RELATION_DUPLICATE", message: "知识点标签关系重复。", entity_type: "knowledge_point_tag", related_ids: [pointId ?? "", tagId ?? ""] });
    relationSet.add(key);
    if (!pointId || !points.has(pointId)) collector.add({ severity: "ERROR", code: "TAG_POINT_MISSING", message: "标签关系找不到对应的知识点。", entity_type: "knowledge_point_tag", related_ids: pointId ? [pointId] : undefined });
    if (!tagId || !tagMap.has(tagId)) collector.add({ severity: "ERROR", code: "TAG_MISSING", message: "标签关系找不到对应的标签。", entity_type: "knowledge_point_tag", related_ids: tagId ? [tagId] : undefined });
  }
  const favoriteSet = new Set<string>();
  for (const row of favorites) {
    const pointId = typeof row.knowledge_point_id === "string" ? row.knowledge_point_id : undefined;
    if (pointId && favoriteSet.has(pointId)) collector.add({ severity: "ERROR", code: "FAVORITE_DUPLICATE", message: "知识点收藏关系重复。", entity_type: "favorite", entity_id: pointId });
    if (pointId) favoriteSet.add(pointId);
    if (!pointId || !points.has(pointId)) collector.add({ severity: "ERROR", code: "FAVORITE_POINT_MISSING", message: "收藏关系找不到对应的知识点。", entity_type: "favorite", entity_id: pointId });
  }
  const pinSet = new Set<string>();
  let activePinCount = 0;
  const pinSorts = new Map<number, string[]>();
  for (const row of pins) {
    const id = integrityId(row);
    const itemType = row.item_type;
    const itemId = typeof row.item_id === "string" ? row.item_id : undefined;
    const key = `${String(itemType)}:${itemId ?? ""}`;
    if (pinSet.has(key)) collector.add({ severity: "ERROR", code: "PIN_DUPLICATE", message: "置顶关系重复。", entity_type: "pin", entity_id: id, related_ids: itemId ? [itemId] : undefined });
    pinSet.add(key);
    const target = itemType === "chapter" ? chapters.get(itemId) : itemType === "knowledge_point" ? points.get(itemId) : undefined;
    if (itemType !== "chapter" && itemType !== "knowledge_point") collector.add({ severity: "ERROR", code: "PIN_TYPE_INVALID", message: "置顶项目类型无效。", entity_type: "pin", entity_id: id });
    else if (!itemId || !target) collector.add({ severity: "ERROR", code: "PIN_TARGET_MISSING", message: "置顶项目找不到对应的章节或知识点。", entity_type: "pin", entity_id: id, related_ids: itemId ? [itemId] : undefined });
    else if (integrityIsActive(target)) { activePinCount += 1; if (integrityValidSort(row.sort_order)) { const ids = pinSorts.get(row.sort_order) ?? []; ids.push(id ?? ""); pinSorts.set(row.sort_order, ids); } }
    if (!integrityValidSort(row.sort_order)) collector.add({ severity: "ERROR", code: "PIN_SORT_INVALID", message: "置顶项目排序值无效。", entity_type: "pin", entity_id: id });
  }
  if (activePinCount > 4) collector.add({ severity: "ERROR", code: "PIN_LIMIT_EXCEEDED", message: `当前有 ${activePinCount} 个活动置顶项目，超过 4 个上限。`, entity_type: "pin_group" });
  for (const [sort, ids] of pinSorts) if (ids.length > 1) collector.add({ severity: "WARNING", code: "PIN_SORT_DUPLICATE", message: `活动置顶项目排序值 ${sort} 重复。`, entity_type: "pin_group", related_ids: ids });
  return integritySection("tags_access", "标签、收藏与置顶", tags.length + relations.length + favorites.length + pins.length, collector, integrityAnyTableFailed(tables, ["tags", "knowledge_point_tags", "favorite_items", "pinned_items", "knowledge_points", "chapters"]));
}

async function integrityCheckHistory(tables: IntegrityTables) {
  const pointVersions = integrityRows(tables, "knowledge_point_versions");
  const noteVersions = integrityRows(tables, "placement_note_versions");
  const points = new Map(integrityRows(tables, "knowledge_points").map((row) => [integrityId(row), row] as const).filter(([id]) => Boolean(id)) as Array<[string, Record<string, unknown>]>);
  const placements = new Map(integrityRows(tables, "knowledge_point_placements").map((row) => [integrityId(row), row] as const).filter(([id]) => Boolean(id)) as Array<[string, Record<string, unknown>]>);
  const collector = createIntegrityCollector();
  const pointHashes = new Set<string>();
  for (const row of pointVersions) {
    const id = integrityId(row);
    const pointId = typeof row.knowledge_point_id === "string" ? row.knowledge_point_id : undefined;
    if (!id || !isUuid(id)) collector.add({ severity: "ERROR", code: "HISTORY_ID_INVALID", message: "知识点历史版本 ID 无效。", entity_type: "knowledge_point_version", entity_id: id });
    if (!pointId || !points.has(pointId)) collector.add({ severity: "ERROR", code: "HISTORY_POINT_MISSING", message: "知识点历史版本找不到所属知识点。", entity_type: "knowledge_point_version", entity_id: id, related_ids: pointId ? [pointId] : undefined });
    const hash = typeof row.content_hash === "string" ? row.content_hash : "";
    const hashKey = `${pointId ?? ""}:${hash}`;
    if (pointHashes.has(hashKey)) collector.add({ severity: "ERROR", code: "HISTORY_DUPLICATE", message: "知识点历史版本内容哈希重复。", entity_type: "knowledge_point_version", entity_id: id });
    pointHashes.add(hashKey);
    const snapshot = integrityHistorySnapshot(row.snapshot);
    if (!snapshot.valid) collector.add({ severity: "ERROR", code: "HISTORY_SNAPSHOT_INVALID", message: `知识点历史快照无效：${snapshot.reason ?? "格式错误"}。`, entity_type: "knowledge_point_version", entity_id: id });
    if (!integrityValidDate(row.created_at)) collector.add({ severity: "ERROR", code: "HISTORY_TIMESTAMP_INVALID", message: "知识点历史版本时间无效。", entity_type: "knowledge_point_version", entity_id: id });
    const historyHashStatus = await integrityHistoryHashStatus(row.snapshot, row.content_hash);
    if (historyHashStatus === "LEGACY") collector.addLegacy();
    else if (historyHashStatus === "INVALID") collector.add({ severity: "ERROR", code: "HISTORY_HASH_INVALID", message: "知识点历史版本哈希校验失败。", entity_type: "knowledge_point_version", entity_id: id });
  }
  const noteHashes = new Set<string>();
  for (const row of noteVersions) {
    const id = integrityId(row);
    const placementId = typeof row.placement_id === "string" ? row.placement_id : undefined;
    if (!id || !isUuid(id)) collector.add({ severity: "ERROR", code: "PLACEMENT_HISTORY_ID_INVALID", message: "本章补充历史版本 ID 无效。", entity_type: "placement_note_version", entity_id: id });
    if (!placementId || !placements.has(placementId)) collector.add({ severity: "ERROR", code: "PLACEMENT_HISTORY_PARENT_MISSING", message: "本章补充历史版本找不到所属引用位置。", entity_type: "placement_note_version", entity_id: id, related_ids: placementId ? [placementId] : undefined });
    const hash = typeof row.content_hash === "string" ? row.content_hash : "";
    const hashKey = `${placementId ?? ""}:${hash}`;
    if (noteHashes.has(hashKey)) collector.add({ severity: "ERROR", code: "PLACEMENT_HISTORY_DUPLICATE", message: "本章补充历史版本内容哈希重复。", entity_type: "placement_note_version", entity_id: id });
    noteHashes.add(hashKey);
    const snapshot = integrityRichDocument(row.chapter_note_snapshot);
    if (!snapshot.valid) collector.add({ severity: "ERROR", code: "PLACEMENT_HISTORY_SNAPSHOT_INVALID", message: "本章补充历史快照无效。", entity_type: "placement_note_version", entity_id: id });
    if (!integrityValidDate(row.created_at)) collector.add({ severity: "ERROR", code: "PLACEMENT_HISTORY_TIMESTAMP_INVALID", message: "本章补充历史版本时间无效。", entity_type: "placement_note_version", entity_id: id });
    if (!await integrityHashMatches(row.chapter_note_snapshot, row.content_hash)) collector.add({ severity: "ERROR", code: "PLACEMENT_HISTORY_HASH_INVALID", message: "本章补充历史版本哈希校验失败。", entity_type: "placement_note_version", entity_id: id });
  }
  return integritySection("history", "历史版本", pointVersions.length + noteVersions.length, collector, integrityAnyTableFailed(tables, ["knowledge_point_versions", "placement_note_versions", "knowledge_points", "knowledge_point_placements"]));
}

function integrityCheckRecycleAndRevisions(tables: IntegrityTables) {
  const chapters = integrityRows(tables, "chapters");
  const points = integrityRows(tables, "knowledge_points");
  const placements = integrityRows(tables, "knowledge_point_placements");
  const collector = createIntegrityCollector();
  for (const row of [...chapters, ...points, ...placements]) {
    if (row.deleted_at !== null && !integrityIsDeleted(row)) collector.add({ severity: "ERROR", code: "DELETED_AT_INVALID", message: "回收站状态的 deleted_at 字段无效。", entity_type: "recycle_item", entity_id: integrityId(row) });
    if (integrityIsLegacyDeletedWithoutBatch(row)) collector.addLegacy();
    else if (integrityIsMissingDeletionBatch(row)) collector.add({ severity: "ERROR", code: "DELETION_BATCH_MISSING", message: "回收站项目缺少删除批次标记。", entity_type: "recycle_item", entity_id: integrityId(row) });
    if (integrityIsActive(row) && row.deletion_batch_id !== null) collector.add({ severity: "WARNING", code: "ACTIVE_DELETION_BATCH", message: "活动数据仍保留删除批次标记，请留意恢复状态。", entity_type: "recycle_item", entity_id: integrityId(row) });
  }
  const chapterMap = new Map(chapters.map((row) => [integrityId(row), row] as const).filter(([id]) => Boolean(id)) as Array<[string, Record<string, unknown>]>);
  for (const row of chapters) if (integrityIsActive(row) && typeof row.parent_id === "string" && integrityIsDeleted(chapterMap.get(row.parent_id) ?? {})) collector.add({ severity: "ERROR", code: "ACTIVE_CHILD_OF_DELETED", message: "活动章节挂在回收站章节下面。", entity_type: "chapter", entity_id: integrityId(row), related_ids: [row.parent_id] });
  for (const row of points) if (integrityIsDeleted(row) && placements.some((placement) => integrityIsActive(placement) && placement.knowledge_point_id === row.id)) collector.add({ severity: "ERROR", code: "DELETED_POINT_HAS_ACTIVE_PLACEMENT", message: "回收站知识点仍有活动章节引用。", entity_type: "knowledge_point", entity_id: integrityId(row) });
  return {
    recycle: integritySection("recycle", "回收站与软删除", chapters.length + points.length + placements.length, collector, integrityAnyTableFailed(tables, ["chapters", "knowledge_points", "knowledge_point_placements"])),
  };
}

function integrityCheckRevisions(tables: IntegrityTables) {
  const chapters = integrityRows(tables, "chapters");
  const points = integrityRows(tables, "knowledge_points");
  const placements = integrityRows(tables, "knowledge_point_placements");
  const collector = createIntegrityCollector();
  for (const row of chapters) if (!integrityValidRevision(row.overview_revision)) collector.add({ severity: "ERROR", code: "OVERVIEW_REVISION_INVALID", message: "章节 overview_revision 无效。", entity_type: "chapter", entity_id: integrityId(row) });
  for (const row of points) if (!integrityValidRevision(row.core_revision)) collector.add({ severity: "ERROR", code: "CORE_REVISION_INVALID", message: "知识点 core_revision 无效。", entity_type: "knowledge_point", entity_id: integrityId(row) });
  for (const row of placements) if (!integrityValidRevision(row.note_revision)) collector.add({ severity: "ERROR", code: "NOTE_REVISION_INVALID", message: "引用位置 note_revision 无效。", entity_type: "placement", entity_id: integrityId(row) });
  return integritySection("revisions", "编辑版本号", chapters.length + points.length + placements.length, collector, integrityAnyTableFailed(tables, ["chapters", "knowledge_points", "knowledge_point_placements"]));
}

function integrityStatusLabel(status: IntegrityReport["status"] | IntegritySectionStatus) {
  return status === "PASS" ? "通过" : status === "WARNING" ? "有警告" : status === "ERROR" ? "发现错误" : "检查未完整完成";
}

function buildIntegrityReportText(report: Omit<IntegrityReport, "report_text">) {
  const lines = [
    "悠扬讲义｜系统完整性检查报告",
    `检查时间：${report.checked_at}`,
    `检查范围：${report.schema_version} / Backup Format ${report.backup_format_version}`,
    `总体状态：${integrityStatusLabel(report.status)}`,
    "",
  ];
  for (const section of report.sections) {
    lines.push(`【${section.label}】${integrityStatusLabel(section.status)}：${section.summary}`);
    for (const issue of section.issues) {
      const entity = issue.entity_id ? `（${issue.entity_type ?? "记录"} ${issue.entity_id}）` : "";
      lines.push(`- [${issue.severity}] ${issue.message}${entity}`);
    }
    if (section.legacy_count > 0) lines.push(`- 历史兼容数据：${section.legacy_count} 条（LEGACY，不视为错误）`);
    if (section.truncated_issue_count > 0) lines.push(`- 另有 ${section.truncated_issue_count} 条同类问题未在报告中展开。`);
  }
  return lines.join("\n");
}

async function runIntegrityCheck(client: SupabaseClient): Promise<IntegrityReport> {
  const tables = await readIntegrityTables(client);
  const sections = [
    integrityCheckChapters(tables),
    integrityCheckKnowledgePoints(tables),
    integrityCheckPlacements(tables),
    await integrityCheckRichText(tables),
    integrityCheckTagsAndAccess(tables),
    await integrityCheckHistory(tables),
    integrityCheckRecycleAndRevisions(tables).recycle,
    integrityCheckRevisions(tables),
    integritySection("backup_search", "备份与搜索基础", BACKUP_TABLES.reduce((count, table) => count + integrityRows(tables, table).length, 0), createIntegrityCollector(), BACKUP_TABLES.some((table) => integrityTableFailed(tables, table))),
  ];
  const status = sections.some((section) => section.status === "CHECK_FAILED")
    ? "CHECK_FAILED"
    : sections.some((section) => section.status === "ERROR")
      ? "ERROR"
      : sections.some((section) => section.status === "WARNING")
        ? "WARNING"
        : "PASS";
  const checked_at = new Date().toISOString();
  const reportWithoutText = {
    status,
    checked_at,
    schema_version: "0016",
    backup_format_version: BACKUP_FORMAT_VERSION,
    issue_count: sections.reduce((total, section) => total + section.issue_count, 0),
    legacy_count: sections.reduce((total, section) => total + section.legacy_count, 0),
    summary: status === "CHECK_FAILED"
      ? "检查未完整完成，部分数据未能读取。"
      : status === "ERROR"
        ? "发现需要处理的数据完整性错误。"
        : status === "WARNING"
          ? "检查完成，但有部分数据需要留意。"
          : "检查完成，未发现完整性问题。",
    sections,
  } as Omit<IntegrityReport, "report_text">;
  return { ...reportWithoutText, report_text: buildIntegrityReportText(reportWithoutText) };
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

  if (error instanceof EditConflictError) {
    return json(request, 409, {
      ok: false,
      error: {
        code: "EDIT_CONFLICT",
        message: "这个内容已经在另一台设备或另一个页面更新。为了避免覆盖最新内容，本次修改没有保存到云端。",
        entity: error.entity,
        current_revision: error.currentRevision,
        updated_at: error.updatedAt,
      },
    });
  }
  if (message.includes("EDIT_REVISION_INVALID")) {
    return validationError(request, "保存请求缺少有效的服务器版本号。");
  }
  if (message.includes("EDIT_CONFLICT_RESPONSE_INVALID")) {
    return json(request, 500, { ok: false, error: { code: "EDIT_CONFLICT_RESPONSE_INVALID", message: "服务器版本信息无效，未执行保存。" } });
  }

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
  if (message.includes("BACKUP_POSTCHECK_FAILED")) {
    return json(request, 500, { ok: false, error: { code: "BACKUP_POSTCHECK_FAILED", message: "恢复后的数据校验未通过，数据库已保持恢复前状态。" } });
  }
  if (message.includes("BACKUP_RESTORE_TRANSACTION_FAILED")) {
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
      .select("id,title,parent_id,sort_order,content,overview_revision,created_at,updated_at,deleted_at")
      .is("deleted_at", null)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true }),
    client
      .from("knowledge_points")
      .select("id,title,status,core_revision,created_at,updated_at,deleted_at")
      .is("deleted_at", null)
      .order("created_at", { ascending: true }),
    client
      .from("knowledge_point_placements")
      .select("id,knowledge_point_id,chapter_id,sort_order,chapter_note,note_revision,created_at,deleted_at")
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
    .select("id,title,parent_id,sort_order,content,overview_revision,created_at,updated_at,deleted_at")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
}

async function readKnowledgePoint(client: SupabaseClient, id: string) {
  return client
    .from("knowledge_points")
    .select("id,title,status,core_revision,created_at,updated_at,deleted_at")
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
    .select("id,title,parent_id,sort_order,content,overview_revision,created_at,updated_at,deleted_at")
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
    .select("id,title,status,core_revision,created_at,updated_at,deleted_at")
    .eq("id", result.knowledge_point_id)
    .single();
  if (pointError) throw pointError;

  const { data: placement, error: placementError } = await client
    .from("knowledge_point_placements")
    .select("id,knowledge_point_id,chapter_id,sort_order,chapter_note,note_revision,created_at,deleted_at")
    .eq("id", result.placement_id)
    .is("deleted_at", null)
    .single();
  if (placementError) throw placementError;

  return { point: point as KnowledgePoint, placement: placement as KnowledgePointPlacement };
}

async function updateKnowledgePointCore(client: SupabaseClient, id: string, payload: KnowledgePointPayload) {
  if (!isUuid(id)) throw new Error("KNOWLEDGE_POINT_PAYLOAD_INVALID");
  const revision = expectedRevision(payload.expected_revision);
  const patch: Record<string, unknown> = {};
  if (payload.title !== undefined) {
    if (!isNonEmptyTitle(payload.title)) throw new Error("KNOWLEDGE_POINT_TITLE_INVALID");
    patch.title = payload.title.trim();
  }
  if (payload.status !== undefined) {
    if (typeof payload.status !== "string" || !STATUS_VALUES.has(payload.status)) {
      throw new Error("KNOWLEDGE_POINT_STATUS_INVALID");
    }
    patch.status = payload.status;
  }
  for (const field of CONTENT_FIELDS) {
    if (payload[field] !== undefined) {
      if (!isRichDocument(payload[field])) throw new Error("CONTENT_PAYLOAD_INVALID");
      patch[field] = payload[field];
    }
  }
  if (Object.keys(patch).length === 0) throw new Error("KNOWLEDGE_POINT_PAYLOAD_INVALID");

  const { data, error } = await client.rpc("update_knowledge_point_core", {
    p_knowledge_point_id: id,
    p_expected_revision: revision,
    p_patch: patch,
  });
  if (error) throw error;
  throwIfRevisionConflict(data);
  const result = data as Record<string, unknown>;
  if (!result.knowledge_point || !result.content) throw new Error("EDIT_CONFLICT_RESPONSE_INVALID");
  return {
    knowledge_point: result.knowledge_point as KnowledgePoint,
    content: result.content as KnowledgePointContent,
  };
}

async function updateKnowledgePoint(client: SupabaseClient, id: string, payload: KnowledgePointPayload) {
  return updateKnowledgePointCore(client, id, payload);
}

async function readKnowledgePointContent(client: SupabaseClient, id: string) {
  if (!isUuid(id)) throw new Error("CONTENT_PAYLOAD_INVALID");

  const { data: point, error: pointError } = await client
    .from("knowledge_points")
    .select("id,title,status,core_revision,created_at,updated_at,deleted_at")
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
  return updateKnowledgePointCore(client, id, payload);
}

async function moveKnowledgePoint(client: SupabaseClient, placementId: string, chapterId: string) {
  if (!isUuid(chapterId)) throw new Error("CHAPTER_PARENT_INVALID");
  const chapter = await readChapter(client, chapterId);
  if (chapter.error) throw chapter.error;
  if (!chapter.data) throw new Error("CHAPTER_NOT_FOUND");

  const { data: placement, error: placementError } = await client
    .from("knowledge_point_placements")
    .select("id,knowledge_point_id,chapter_id,sort_order,chapter_note,note_revision,created_at,deleted_at")
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
    .select("id,knowledge_point_id,chapter_id,sort_order,chapter_note,note_revision,created_at,deleted_at")
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
    .select("id,knowledge_point_id,chapter_id,sort_order,chapter_note,note_revision,created_at,deleted_at")
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
    .select("id,knowledge_point_id,chapter_id,sort_order,chapter_note,note_revision,created_at,deleted_at")
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
      .select("id,knowledge_point_id,chapter_id,sort_order,chapter_note,note_revision,created_at,deleted_at")
      .single();
    if (error) throw error;
    return { placement: data as KnowledgePointPlacement, restored: true };
  }

  const { data, error } = await client
    .from("knowledge_point_placements")
    .insert({ knowledge_point_id: knowledgePointId, chapter_id: chapterId, sort_order: await nextPlacementSortOrder(client, chapterId) })
    .select("id,knowledge_point_id,chapter_id,sort_order,chapter_note,note_revision,created_at,deleted_at")
    .single();
  if (error) throw error;
  return { placement: data as KnowledgePointPlacement, restored: false };
}

async function updatePlacementNote(client: SupabaseClient, placementId: string, chapterNote: unknown, expected: unknown) {
  if (!isUuid(placementId) || !isRichDocument(chapterNote)) throw new Error("CHAPTER_NOTE_INVALID");
  const revision = expectedRevision(expected);
  const { data, error } = await client.rpc("update_placement_note", {
    p_placement_id: placementId,
    p_expected_revision: revision,
    p_chapter_note: chapterNote,
  });
  if (error) throw error;
  throwIfRevisionConflict(data);
  const result = data as Record<string, unknown>;
  if (!result.placement) throw new Error("EDIT_CONFLICT_RESPONSE_INVALID");
  return result.placement as KnowledgePointPlacement;
}

// Keep the phase 4 operation name as a thin compatibility wrapper while the
// implementation now enforces the phase 10.2 revision check transactionally.
async function savePlacementNote(client: SupabaseClient, placementId: string, chapterNote: unknown, expected: unknown) {
  return updatePlacementNote(client, placementId, chapterNote, expected);
}

async function updateChapterOverview(client: SupabaseClient, chapterId: string, content: unknown, expected: unknown) {
  if (!isUuid(chapterId) || !isOptionalContent(content)) throw new Error("CHAPTER_CONTENT_INVALID");
  const revision = expectedRevision(expected);
  const { data, error } = await client.rpc("update_chapter_overview", {
    p_chapter_id: chapterId,
    p_expected_revision: revision,
    p_content: content,
  });
  if (error) throw error;
  throwIfRevisionConflict(data);
  const result = data as Record<string, unknown>;
  if (!result.chapter) throw new Error("EDIT_CONFLICT_RESPONSE_INVALID");
  return result.chapter as Chapter;
}

async function removePlacement(client: SupabaseClient, placementId: string) {
  if (!isUuid(placementId)) throw new Error("PLACEMENT_NOT_FOUND");
  const { data, error } = await client
    .from("knowledge_point_placements")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", placementId)
    .is("deleted_at", null)
    .select("id,knowledge_point_id,chapter_id,sort_order,chapter_note,note_revision,created_at,deleted_at")
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

type OfflineSnapshotData = {
  tree: {
    chapters: Chapter[];
    knowledge_points: KnowledgePoint[];
    knowledge_point_placements: KnowledgePointPlacement[];
  };
  contents: Record<string, KnowledgePointContent>;
  point_meta: Record<string, { tags: Tag[]; favorite: boolean; pinned: { id: string } | null }>;
  tags: Tag[];
  fast_access: Awaited<ReturnType<typeof readFastAccess>>;
};

async function buildOfflineSnapshot(client: SupabaseClient) {
  const tree = await readTree(client);
  const [contentRows, tagRows, tagLinkRows, favoriteRows, pinRows, fast_access] = await Promise.all([
    readAllRows(client, "knowledge_point_contents", "id,knowledge_point_id,explanation,exercises,supplement,inspiration,created_at,updated_at", ["id"]),
    readAllRows(client, "tags", "id,name,created_at,updated_at", ["id"]),
    readAllRows(client, "knowledge_point_tags", "knowledge_point_id,tag_id,created_at", ["knowledge_point_id", "tag_id"]),
    readAllRows(client, "favorite_items", "knowledge_point_id,created_at", ["knowledge_point_id"]),
    readAllRows(client, "pinned_items", "id,item_type,item_id,sort_order,created_at", ["id"]),
    readFastAccess(client),
  ]);

  const pointIds = new Set(tree.knowledge_points.map((point) => point.id));
  const activeContents = (contentRows as unknown as KnowledgePointContent[]).filter((content) => pointIds.has(content.knowledge_point_id));
  const activeTagLinks = (tagLinkRows as Array<Record<string, unknown>>).filter((link) => pointIds.has(String(link.knowledge_point_id)));
  const usedTagIds = new Set(activeTagLinks.map((link) => String(link.tag_id)));
  const tags = (tagRows as unknown as Tag[]).filter((tag) => usedTagIds.has(tag.id));
  const tagsByPoint = new Map<string, Tag[]>();
  const tagById = new Map(tags.map((tag) => [tag.id, tag]));
  for (const link of activeTagLinks) {
    const tag = tagById.get(String(link.tag_id));
    if (!tag) continue;
    const existing = tagsByPoint.get(String(link.knowledge_point_id)) ?? [];
    existing.push(tag);
    tagsByPoint.set(String(link.knowledge_point_id), existing);
  }
  const favoritePointIds = new Set((favoriteRows as Array<Record<string, unknown>>).map((row) => String(row.knowledge_point_id)));
  const pinnedByPoint = new Map<string, { id: string }>();
  for (const pin of pinRows as Array<Record<string, unknown>>) {
    if (pin.item_type === "knowledge_point" && pointIds.has(String(pin.item_id))) pinnedByPoint.set(String(pin.item_id), { id: String(pin.id) });
  }
  const point_meta = Object.fromEntries(tree.knowledge_points.map((point) => [point.id, {
    tags: tagsByPoint.get(point.id) ?? [],
    favorite: favoritePointIds.has(point.id),
    pinned: pinnedByPoint.get(point.id) ?? null,
  }]));
  const data: OfflineSnapshotData = {
    tree,
    contents: Object.fromEntries(activeContents.map((content) => [content.knowledge_point_id, content])),
    point_meta,
    tags,
    fast_access,
  };
  return {
    snapshot_version: 1 as const,
    schema_version: "0016",
    generated_at: new Date().toISOString(),
    data_checksum: await hashCanonicalJson(data),
    counts: {
      chapters: tree.chapters.length,
      knowledge_points: tree.knowledge_points.length,
      placements: tree.knowledge_point_placements.length,
      contents: activeContents.length,
      tags: tags.length,
    },
    data,
  };
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
  if (request.method === "POST" && resource === "integrity_check") {
    try {
      return json(request, 200, { ok: true, report: await runIntegrityCheck(client) });
    } catch (error) {
      return databaseError(request, error, "系统检查未完整完成，请稍后重试。");
    }
  }

  if (request.method === "GET" && resource === "backup") {
    try {
      return json(request, 200, { ok: true, backup: await buildFullBackup(client) });
    } catch (error) {
      return databaseError(request, error, "完整备份生成失败，请重试。");
    }
  }

  if (request.method === "GET" && resource === "offline_snapshot") {
    try {
      return json(request, 200, { ok: true, snapshot: await buildOfflineSnapshot(client) });
    } catch (error) {
      return databaseError(request, error, "离线阅读快照生成失败，请稍后重试。");
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
    try {
      const result = await updateKnowledgePointContent(client, id, payload);
      return json(request, 200, { ok: true, knowledge_point: result.knowledge_point, content: result.content });
    } catch (error) {
      return databaseError(request, error, "知识点内容保存失败。");
    }
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

    if (payload.content !== undefined) {
      if (payload.title !== undefined || payload.parent_id !== undefined || payload.operation !== undefined) return validationError(request, "章节总览保存不能与目录操作合并。");
      try {
        return json(request, 200, { ok: true, chapter: await updateChapterOverview(client, id, payload.content, payload.expected_revision) });
      } catch (error) {
        return databaseError(request, error, "章节内容保存失败。");
      }
    }

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
      .select("id,title,parent_id,sort_order,content,overview_revision,created_at,updated_at,deleted_at")
      .single();
    if (error) return databaseError(request, error, "章节更新失败。");
    return json(request, 200, { ok: true, chapter: data as Chapter });
  }

  if (request.method === "PATCH" && resource === "knowledge_point") {
    const payload = await parseBody(request) as KnowledgePointPayload | null;
    const id = new URL(request.url).searchParams.get("id");
    if (!payload || !isUuid(id)) return validationError(request, "知识点参数无效。");
    try {
      const result = await updateKnowledgePoint(client, id, payload);
      return json(request, 200, { ok: true, knowledge_point: result.knowledge_point, content: result.content });
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
        if (payload.chapter_note !== undefined || payload.expected_revision !== undefined) return validationError(request, "移动操作不能同时保存本章补充。");
        if (!isUuid(payload.chapter_id)) return validationError(request, "知识点移动参数无效。");
        const moved = await moveKnowledgePoint(client, placementId, payload.chapter_id);
        return json(request, 200, { ok: true, placement: moved });
      }
      if (payload.chapter_note !== undefined) {
        return json(request, 200, { ok: true, placement: await savePlacementNote(client, placementId, payload.chapter_note, payload.expected_revision) });
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

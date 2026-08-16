import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const PROJECT_REF = "dtcrxkdjzrklrhtxosxn";
const NOTES_FUNCTION_URL = process.env.NOTES_FUNCTION_URL ?? `https://${PROJECT_REF}.supabase.co/functions/v1/notes`;
const EXPECTED_ORIGIN = "https://zhangyoyang-ux.github.io";
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SUPABASE_CONFIG = path.join(REPO_ROOT, "supabase", "config.toml");

// These are the manually audited UUIDs from the 2026-08-16 Production snapshot.
// Do not replace these arrays with title matching or a broad deleted_at query.
const CHAPTER_IDS = [
  "04798d32-f97b-40c1-9999-7f96f7251896", "127eb0c6-1ac7-49c0-8315-1a30ef9dacdc",
  "2584bceb-8256-4d31-a68a-084eeebea2c3", "2decd39b-dcdf-4d9e-b5be-d16e9aa2e7ef",
  "3ea21583-dea9-437c-aa91-27f3a4bd18a7", "4e29b43c-7182-492d-9fb1-efc2727da30d",
  "733d5987-75e0-4f49-99ec-e943d16cda6c", "89e1097f-108c-4a06-ae23-51dce0ae6444",
  "8d4134c5-9104-4059-bbe1-5cff50bbe3ed", "92038472-af98-4c4a-841f-4cf6b788b35e",
  "921e9f76-ac07-4a51-8219-6e27a402cfc3", "9a294d96-29c2-4156-9aef-ae0653dea137",
  "a8d9ca00-9038-4ffe-ae2d-847b39d86ce4", "acc69408-8826-4bca-9a2c-7c5e02cac3d7",
  "b17f3c3a-3b93-42dc-8e6b-c04d716f9b4b", "bdbe69c5-1af1-42ea-947b-7b4829d720ac",
  "c78580d1-6fc6-4af2-81be-731383540b2a", "cd272bdc-ec4d-4969-8981-4cb79197f9e1",
  "ce34fc67-dd27-4dbb-91a2-14ce0b43b78e", "de9b83d3-1148-48b1-9cd9-ace3cc695100",
  "e0fc484a-d06e-4e30-bb91-0b031d08fef1", "e3dc80d3-9a4a-4f57-80e2-98c618329c6d",
  "e8fca453-6e38-4d22-9d6f-8b3ab95f522b", "ff877119-0a82-48ca-9e10-07dea10dff0b",
  "b5f9b092-69a3-48d2-a56c-fd9e88546e21",
];

const KNOWLEDGE_POINT_IDS = [
  "0a916b68-b180-4d15-874c-337a87e720d4", "0f7fd6a4-44d2-49a8-a5ed-2286c2a74d1a",
  "1816c7c8-4487-4596-9377-14c7598a8610", "1935c882-dd79-4e6c-b13b-1fc231cdc284",
  "1c53753c-010c-4977-b1e5-336065679170", "1e524317-526c-4f98-a641-691aeb63aa8e",
  "24445b49-0090-49a4-b021-aac7ca899fdb", "27221e42-981b-4488-8afd-9ef0ffebd3dd",
  "520dcfdb-aaef-454a-a4b7-d5fd7c594eba", "5ad66cf3-1b2b-4b26-9964-c0932ca052ad",
  "5d1eac08-6d5d-417f-86a8-0f5279443088", "64a0ab5c-b520-4ff2-8cd6-332362f7efd2",
  "778ba189-70e1-470b-819c-fa31289bc082", "868d8aac-cfd4-482a-9409-f4e738e06d7a",
  "897d8a31-cf66-4e75-8906-a2912bc20de3", "8c24d8f8-f1e0-43fb-923a-0913b2f2525d",
  "8dc9a9b9-a23a-4fd5-a90a-fa9c16f77444", "9684d3d2-122d-4404-a3ea-e099421f0684",
  "969cfce9-d7b5-4eda-a4a1-b54a9007a24b", "9765132c-5f12-43de-93a9-f0902769f9aa",
  "a17c1e9a-48ae-415b-9b94-86026e4e0919", "a6c882b1-58cd-4093-a20b-5325f91aa0ef",
  "b7b7cf2b-cefc-4e01-be2e-d3f565f033c4", "bdc18210-fb07-457a-a6c0-6510549c9396",
  "bff563d3-1810-4b07-a377-b888dd83561e", "c8d2f14b-3028-4a34-80d0-3b4a072b5549",
  "c9aa02b2-cebb-4ecf-a10b-555304837442", "cca77682-7da8-4e90-aff3-18bbecdd8d9d",
  "d669dccc-c60e-4fde-aa99-750c4ee65b28", "dcc04f2d-440f-42c6-8228-d7872da030fd",
  "e5d69828-9c90-47f4-a716-382a617efe51", "e848cf49-c80d-4c58-bf4c-632388622aa2",
  "e871312f-3e76-4fb1-9b6a-f898a315525c", "e992fc71-5e91-42f4-a1be-71d5db233a08",
  "5c5127ed-c018-4901-8c2b-7a74832c131f",
];

const CONTENT_IDS = [
  "08af69b1-28d7-4bc5-aa3c-aeb0be576648", "0db13391-bd48-4abe-8d2b-ed32dce264d2",
  "12c15f9f-f21c-4900-b385-9d8d8c1fff37", "2327627d-4450-4a60-8bf6-f0af8a214585",
  "2490f8c8-320c-427e-bf04-5c49af70c9db", "2ff260be-d49d-4935-b284-acb801732125",
  "4c9777d2-7493-4d71-80ca-2139a3616968", "5351f8f6-fa44-427c-b88e-da4a5c2e8857",
  "8f7d9b32-d535-4ef6-a787-fba264238271", "a5da58fe-cd08-48a6-9b57-3add28f76573",
  "b2644638-a314-4841-a070-43b6131c75e2", "c0f05397-5837-4161-8357-15b4e0d1b071",
  "efe723f2-d56b-4999-b7b9-34726a2a01e3", "fbd74a43-9de3-4a72-995d-63dc63f26745",
];

const PLACEMENT_IDS = [
  "02b4411e-db3d-47be-8987-b50ff03f1a5c", "07060bfb-a342-4dcc-a48a-b2576bce9a71",
  "186c919a-be13-4145-a751-cc2bb0bd7f5f", "1fd19486-a5cc-4e80-aa6e-1024ab3f8d41",
  "228c7bbe-9b1d-4b17-b7fb-8d642450946d", "24ca3a72-a020-4842-bd5d-ea8daffa1f5c",
  "266d2534-caaf-4318-b6b0-f3a8c0793fbb", "3f65e3f0-c91f-4d7f-93bf-377e9438be20",
  "466ed603-dd70-49f5-8bf6-1e8cc1c0c2cf", "48188cfa-2380-471d-9f79-63feea2ca32a",
  "5129c5e2-8a12-4721-95f7-b02da98888aa", "58298ecb-ffee-4d67-b910-2864f4079099",
  "58ac2f34-70b1-4f23-978f-86d6d599660a", "5c22453c-f046-4717-a81b-97a39daf0e42",
  "5fdab101-c34c-40b9-ba5d-42feda321512", "611bb176-ef2f-49fe-98a7-b2052f725e36",
  "657badcc-be6e-43ab-8e17-7d13f98847c3", "692733e2-1b0d-427f-8e2b-a0448ddd9933",
  "6d0eb60d-001e-41a8-af4e-7141c6a56b19", "6e45dd3f-7e13-45fc-8667-48e8fa211db7",
  "725f2161-ed35-4136-9a7b-f92eae045288", "72a421fc-33d5-4b2b-8bde-38e11644c92c",
  "7d4da995-facd-441a-aa7f-effe556c22c9", "82abfcf5-14fe-43fa-a39f-4def60e36500",
  "8ca18aa1-434f-46c2-bfbe-a27d9effcf72", "8d89c439-89e3-4920-b960-b3bd3040a0a0",
  "93204a20-6b88-4a1f-ab6c-c66cb0560d54", "982283f5-1156-4dda-a985-b670d6bbcdbf",
  "98adb021-76ab-4882-b0f0-94ece73fdfa4", "9bda3554-70cb-4856-9f8c-04d7505f0061",
  "9caaf462-aaec-4ace-86e7-f76c72f2a40f", "a4b08a55-8ff2-4b3f-9a5e-905d30386be7",
  "b5540754-101d-4cd3-88d9-71f5a8f1ee89", "b755b5bc-c663-4edb-bb77-72e7dbdede01",
  "c04499a6-cd33-4805-bcf1-170bb9e4081e", "cb536e45-db69-46ad-aa5a-ceefdd085790",
  "cf02dc66-bbe6-48f8-b799-8040c0452303", "cf689bc3-e8e3-4b5d-afa6-14c9012151a7",
  "dfee4b34-33ec-4d43-bf64-b172e8225dee", "e22314fb-fe44-4af7-817b-bc544be27045",
  "e38886c7-1f7b-4b6c-b3b4-04017c2d6995", "e7795ea0-0897-4ded-9416-f887b6178df6",
  "f20cfb1b-849f-4140-a538-00bdeaddc06d", "f9862299-5b13-47eb-8f73-087fd3cb40b3",
  "ffed2061-7a65-4d40-85ac-099589351067",
];

const KNOWLEDGE_POINT_VERSION_IDS = [
  "2ff3ab15-39ba-4120-a570-36f5bfa04648", "493ee80b-518a-4e6c-a670-14c0d78bbc39",
];
const PLACEMENT_NOTE_VERSION_IDS = [
  "1cab6735-4c12-47c6-9587-b21e168fb1c4", "39377ed2-46f3-4f90-b3c8-057a62a9fc51",
];

const PROTECTED_KNOWN_FORMAL_IDS = new Set([
  "57fc5ff5-2536-4c85-9b7e-e9c7e46fcd01", // 可数名词复数变形
  "783e0435-215d-422c-8547-4d33f759df0f", // 一轮基础知识点，含真实正文
]);

const TEST_CHAPTER_TITLES = new Set([
  "测试章节 A", "测试章节 B", "测试子章节 A1", "测试子章节 B1", "第八阶段测试章节",
  "第八阶段测试子章节", "第八阶段循环测试父章节", "第八阶段循环测试子章节",
  "冠词分类",
  "10.2 冲突保护测试 20260816203022", "10.2 冲突保护测试 20260816203108",
  "10.2 恢复失效测试 20260816203157", "10.2 恢复失效测试 20260816203328",
  "10.2 子章节 20260816203022", "10.2 子章节 20260816203108",
]);
const TEST_POINT_TITLES = new Set([
  "第四阶段测试知识点-共享标题", "第四阶段排序测试", "第三阶段上一篇测试", "第三阶段下一篇测试",
  "第三阶段编辑器测试", "第三阶段编辑器测试-已重命名", "第三阶段移动诊断测试", "第三阶段页面检查",
  "测试知识点", "测试知识点改名", "测试知识点 hardly...when...", "测试", "第八阶段测试知识点",
  "10.2 共享核心冲突测试 20260816203022", "10.2 共享核心冲突测试 20260816203108",
  "10.2 恢复 revision 测试 20260816203157", "10.2 恢复 revision 测试 20260816203328", "冠词分类",
]);

function parseArg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function stamp(date = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function ensureDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true });
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") return Object.keys(value).sort().reduce((result, key) => { result[key] = stableValue(value[key]); return result; }, {});
  return value;
}

function checksum(value) {
  return crypto.createHash("sha256").update(JSON.stringify(stableValue(value)), "utf8").digest("hex");
}

function validateBackup(backup) {
  if (!backup || backup.manifest?.app !== "悠扬讲义" || backup.manifest?.backup_format_version !== 1 || backup.manifest?.checksum_algorithm !== "SHA-256") throw new Error("清理前完整备份 Manifest 无效。");
  const tables = Object.keys(backup.data ?? {});
  if (tables.length !== 12 || tables.some((table) => !Array.isArray(backup.data[table]))) throw new Error("清理前完整备份数据表不完整。");
  if (checksum(backup.data) !== backup.manifest.data_checksum) throw new Error("清理前完整备份 checksum 校验失败。");
  for (const table of tables) if (backup.manifest.counts[table] !== backup.data[table].length) throw new Error(`清理前备份 counts 校验失败：${table}`);
}

async function getResource(resource, method = "GET") {
  const url = new URL(NOTES_FUNCTION_URL);
  url.searchParams.set("resource", resource);
  const response = await fetch(url, { method, headers: { Origin: EXPECTED_ORIGIN, "Content-Type": "application/json" }, body: method === "POST" ? "{}" : undefined });
  const body = await response.json();
  if (!response.ok || body.ok !== true) throw new Error(body.error?.message ?? `${resource} 请求失败（${response.status}）。`);
  return body;
}

function setOf(values) { return new Set(values); }
function ensureExactIds(rows, ids, label) {
  const selected = rows.filter((row) => ids.includes(row.id));
  if (selected.length !== ids.length) throw new Error(`${label} 白名单与清理前快照不一致。`);
  return selected;
}

function assertTargetRows(backup) {
  for (const id of PROTECTED_KNOWN_FORMAL_IDS) if (KNOWLEDGE_POINT_IDS.includes(id)) throw new Error(`保护对象意外进入白名单：${id}`);
  const chapters = ensureExactIds(backup.data.chapters, CHAPTER_IDS, "章节");
  const points = ensureExactIds(backup.data.knowledge_points, KNOWLEDGE_POINT_IDS, "知识点");
  const contents = ensureExactIds(backup.data.knowledge_point_contents, CONTENT_IDS, "正文");
  const placements = ensureExactIds(backup.data.knowledge_point_placements, PLACEMENT_IDS, "引用位置");
  const pointVersions = ensureExactIds(backup.data.knowledge_point_versions, KNOWLEDGE_POINT_VERSION_IDS, "知识点历史");
  const noteVersions = ensureExactIds(backup.data.placement_note_versions, PLACEMENT_NOTE_VERSION_IDS, "本章补充历史");
  if (chapters.some((row) => row.deleted_at === null || !TEST_CHAPTER_TITLES.has(row.title))) throw new Error("章节白名单存在活动或无法确认身份的对象，停止清理。");
  if (points.some((row) => row.deleted_at === null || !TEST_POINT_TITLES.has(row.title))) throw new Error("知识点白名单存在活动或无法确认身份的对象，停止清理。");
  if (contents.some((row) => !KNOWLEDGE_POINT_IDS.includes(row.knowledge_point_id))) throw new Error("正文白名单与知识点白名单不一致。");
  const chapterSet = setOf(CHAPTER_IDS);
  const pointSet = setOf(KNOWLEDGE_POINT_IDS);
  if (placements.some((row) => !chapterSet.has(row.chapter_id) && !pointSet.has(row.knowledge_point_id))) throw new Error("引用位置白名单关联对象不在清理白名单内。");
  if (pointVersions.some((row) => !pointSet.has(row.knowledge_point_id))) throw new Error("知识点历史白名单关联对象不在清理白名单内。");
  const placementSet = setOf(PLACEMENT_IDS);
  if (noteVersions.some((row) => !placementSet.has(row.placement_id))) throw new Error("本章补充历史白名单关联对象不在清理白名单内。");
  const unexpectedRelations = [
    ...backup.data.knowledge_point_tags.filter((row) => pointSet.has(row.knowledge_point_id)),
    ...backup.data.favorite_items.filter((row) => pointSet.has(row.knowledge_point_id)),
    ...backup.data.pinned_items.filter((row) => pointSet.has(row.item_id) || chapterSet.has(row.item_id)),
  ];
  if (unexpectedRelations.length > 0) throw new Error("清理对象存在未单独审计的标签、收藏或置顶关系，停止清理。");
  return { chapters, points, contents, placements, pointVersions, noteVersions };
}

function countData(backup) {
  return Object.fromEntries(Object.entries(backup.data).map(([table, rows]) => [table, rows.length]));
}

function buildPlan(backup) {
  const selected = assertTargetRows(backup);
  return {
    classification: {
      A_explicit_test_residue: { chapters: CHAPTER_IDS.length, knowledge_points: KNOWLEDGE_POINT_IDS.length, contents: CONTENT_IDS.length, placements: PLACEMENT_IDS.length, knowledge_point_versions: KNOWLEDGE_POINT_VERSION_IDS.length, placement_note_versions: PLACEMENT_NOTE_VERSION_IDS.length },
      B_formal_data: { objects: 0, note: "正式内容未修改；保护对象包括 active 的“一轮基础知识点”和可数名词复数变形。" },
      C_uncertain_data: { knowledge_points: 1, history_versions: 2, note: "一轮基础知识点含真实正文，其两条历史版本保留。" },
    },
    selected,
    counts_before: countData(backup),
    checksum_before: backup.manifest.data_checksum,
    operations: [
      "删除精确白名单中的 placement_note_versions",
      "删除精确白名单中的 knowledge_point_versions",
      "删除精确白名单中的 knowledge_point_contents",
      "删除精确白名单中的 knowledge_point_placements",
      "删除精确白名单中的 knowledge_points",
      "删除精确白名单中的 chapters（子节点先于父节点）",
    ],
  };
}

function sqlString(value) { return `'${String(value).replaceAll("'", "''")}'`; }
function sqlUuidArray(values) { return `ARRAY[${values.map(sqlString).join(",")}]::uuid[]`; }
function sqlExpectedRows(rows, columns) { return rows.map((row) => `(${columns.map((column) => sqlString(row[column])).join(",")})`).join(",\n"); }

function buildCleanupSql(selected) {
  const expectedChapters = sqlExpectedRows(selected.chapters, ["id", "title", "created_at", "updated_at", "deleted_at"]);
  const expectedPoints = sqlExpectedRows(selected.points, ["id", "title", "created_at", "updated_at", "deleted_at"]);
  const chapterIds = sqlUuidArray(CHAPTER_IDS);
  const pointIds = sqlUuidArray(KNOWLEDGE_POINT_IDS);
  const contentIds = sqlUuidArray(CONTENT_IDS);
  const placementIds = sqlUuidArray(PLACEMENT_IDS);
  const pointVersionIds = sqlUuidArray(KNOWLEDGE_POINT_VERSION_IDS);
  const noteVersionIds = sqlUuidArray(PLACEMENT_NOTE_VERSION_IDS);
  // Supabase CLI's Management API rejects explicit top-level BEGIN/COMMIT by
  // switching to a direct database login. A single DO block is still atomic:
  // any RAISE EXCEPTION rolls back every statement in this block.
  return `DO $cleanup$
BEGIN
CREATE TEMP TABLE _cleanup_expected_chapters(id uuid primary key, title text, created_at timestamptz, updated_at timestamptz, deleted_at timestamptz) ON COMMIT DROP;
INSERT INTO _cleanup_expected_chapters VALUES
${expectedChapters};
CREATE TEMP TABLE _cleanup_expected_points(id uuid primary key, title text, created_at timestamptz, updated_at timestamptz, deleted_at timestamptz) ON COMMIT DROP;
INSERT INTO _cleanup_expected_points VALUES
${expectedPoints};
  IF (SELECT count(*) FROM public.chapters WHERE id = ANY(${chapterIds})) <> ${CHAPTER_IDS.length} THEN RAISE EXCEPTION 'CLEANUP_STATE_CHANGED_CHAPTER_COUNT'; END IF;
  IF (SELECT count(*) FROM public.knowledge_points WHERE id = ANY(${pointIds})) <> ${KNOWLEDGE_POINT_IDS.length} THEN RAISE EXCEPTION 'CLEANUP_STATE_CHANGED_POINT_COUNT'; END IF;
  IF EXISTS (SELECT 1 FROM public.chapters c JOIN _cleanup_expected_chapters e USING (id) WHERE c.title IS DISTINCT FROM e.title OR c.created_at IS DISTINCT FROM e.created_at OR c.updated_at IS DISTINCT FROM e.updated_at OR c.deleted_at IS DISTINCT FROM e.deleted_at OR c.deleted_at IS NULL) THEN RAISE EXCEPTION 'CLEANUP_STATE_CHANGED_CHAPTER'; END IF;
  IF EXISTS (SELECT 1 FROM public.knowledge_points p JOIN _cleanup_expected_points e USING (id) WHERE p.title IS DISTINCT FROM e.title OR p.created_at IS DISTINCT FROM e.created_at OR p.updated_at IS DISTINCT FROM e.updated_at OR p.deleted_at IS DISTINCT FROM e.deleted_at OR p.deleted_at IS NULL) THEN RAISE EXCEPTION 'CLEANUP_STATE_CHANGED_POINT'; END IF;
  IF EXISTS (SELECT 1 FROM public.knowledge_point_contents WHERE knowledge_point_id = ANY(${pointIds}) AND id <> ALL(${contentIds})) THEN RAISE EXCEPTION 'CLEANUP_UNALLOWLISTED_CONTENT'; END IF;
  IF EXISTS (SELECT 1 FROM public.knowledge_point_placements WHERE (knowledge_point_id = ANY(${pointIds}) OR chapter_id = ANY(${chapterIds})) AND id <> ALL(${placementIds})) THEN RAISE EXCEPTION 'CLEANUP_UNALLOWLISTED_PLACEMENT'; END IF;
  IF EXISTS (SELECT 1 FROM public.knowledge_point_versions WHERE knowledge_point_id = ANY(${pointIds}) AND id <> ALL(${pointVersionIds})) THEN RAISE EXCEPTION 'CLEANUP_UNALLOWLISTED_POINT_HISTORY'; END IF;
  IF EXISTS (SELECT 1 FROM public.placement_note_versions WHERE placement_id = ANY(${placementIds}) AND id <> ALL(${noteVersionIds})) THEN RAISE EXCEPTION 'CLEANUP_UNALLOWLISTED_NOTE_HISTORY'; END IF;
  IF EXISTS (SELECT 1 FROM public.knowledge_point_tags WHERE knowledge_point_id = ANY(${pointIds})) THEN RAISE EXCEPTION 'CLEANUP_UNAUDITED_TAG_RELATION'; END IF;
  IF EXISTS (SELECT 1 FROM public.favorite_items WHERE knowledge_point_id = ANY(${pointIds})) THEN RAISE EXCEPTION 'CLEANUP_UNAUDITED_FAVORITE_RELATION'; END IF;
  IF EXISTS (SELECT 1 FROM public.pinned_items WHERE item_id = ANY(${pointIds}) OR item_id = ANY(${chapterIds})) THEN RAISE EXCEPTION 'CLEANUP_UNAUDITED_PIN_RELATION'; END IF;
  IF EXISTS (SELECT 1 FROM public.chapters WHERE parent_id = ANY(${chapterIds}) AND id <> ALL(${chapterIds})) THEN RAISE EXCEPTION 'CLEANUP_UNALLOWLISTED_CHILD_CHAPTER'; END IF;
DELETE FROM public.placement_note_versions WHERE id = ANY(${noteVersionIds});
DELETE FROM public.knowledge_point_versions WHERE id = ANY(${pointVersionIds});
DELETE FROM public.knowledge_point_contents WHERE id = ANY(${contentIds});
DELETE FROM public.knowledge_point_placements WHERE id = ANY(${placementIds});
DELETE FROM public.knowledge_points WHERE id = ANY(${pointIds});
DELETE FROM public.chapters WHERE id = ANY(${chapterIds});
END
$cleanup$;`;
}

function verifyProjectIdentity() {
  if (!fs.existsSync(SUPABASE_CONFIG) || !new RegExp(`project_id\\s*=\\s*["']${PROJECT_REF}["']`).test(fs.readFileSync(SUPABASE_CONFIG, "utf8"))) throw new Error(`Supabase Project identity check failed: expected ${PROJECT_REF}.`);
  const output = execFileSync("npx", ["--yes", "supabase@latest", "migration", "list", "--linked"], { cwd: REPO_ROOT, encoding: "utf8", shell: process.platform === "win32", stdio: ["ignore", "pipe", "pipe"] });
  if (!output.includes("0016")) throw new Error("Production migration 0016 未确认，停止维护。");
}

function executeSql(sql) {
  const filePath = path.join(os.tmpdir(), `english-handout-workbench-cleanup-${process.pid}-${Date.now()}.sql`);
  fs.writeFileSync(filePath, `${sql}\n`, "utf8");
  try {
    return execFileSync("npx", ["--yes", "supabase@latest", "db", "query", "--linked", "--debug", "--file", filePath], { cwd: REPO_ROOT, encoding: "utf8", shell: process.platform === "win32", stdio: ["ignore", "pipe", "pipe"] });
  } catch (error) {
    const details = [error?.stdout, error?.stderr].filter(Boolean).map((value) => String(value).trim()).filter(Boolean).join("\n");
    throw new Error(details ? `${error.message}\n${details}` : error.message);
  } finally {
    fs.rmSync(filePath, { force: true });
  }
}

async function main() {
  const apply = process.argv.includes("--apply");
  const outputDirectory = parseArg("--output-dir");
  const beforeBackupPath = parseArg("--before-backup");
  if (apply && !beforeBackupPath) throw new Error("Production apply requires --before-backup <清理前完整备份路径>。");
  verifyProjectIdentity();
  const currentEnvelope = await getResource("backup");
  const currentBackup = currentEnvelope.backup;
  validateBackup(currentBackup);
  const beforeBackup = apply ? JSON.parse(fs.readFileSync(path.resolve(beforeBackupPath), "utf8")) : currentBackup;
  validateBackup(beforeBackup);
  if (apply && beforeBackup.manifest.data_checksum !== currentBackup.manifest.data_checksum) throw new Error("清理前备份与当前 Production checksum 不一致，状态已变化，停止处理。");
  const plan = buildPlan(beforeBackup);
  const integrityBefore = (await getResource("integrity_check", "POST")).report;
  const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: REPO_ROOT, encoding: "utf8" }).trim();
  const snapshot = { project_ref: PROJECT_REF, captured_at: new Date().toISOString(), git_commit: commit, migration_version: "0016", integrity: integrityBefore, counts: plan.counts_before, data_checksum: plan.checksum_before, allowlist_counts: { chapters: CHAPTER_IDS.length, knowledge_points: KNOWLEDGE_POINT_IDS.length, contents: CONTENT_IDS.length, placements: PLACEMENT_IDS.length, knowledge_point_versions: KNOWLEDGE_POINT_VERSION_IDS.length, placement_note_versions: PLACEMENT_NOTE_VERSION_IDS.length } };
  if (!apply) {
    console.log(JSON.stringify({ mode: "DRY_RUN", project_ref: PROJECT_REF, before: snapshot, plan: { classification: plan.classification, operations: plan.operations, ids: { chapters: CHAPTER_IDS, knowledge_points: KNOWLEDGE_POINT_IDS, contents: CONTENT_IDS, placements: PLACEMENT_IDS, knowledge_point_versions: KNOWLEDGE_POINT_VERSION_IDS, placement_note_versions: PLACEMENT_NOTE_VERSION_IDS } } }, null, 2));
    if (outputDirectory) {
      ensureDirectory(outputDirectory);
      const fileStamp = stamp();
      writeJson(path.join(outputDirectory, `悠扬讲义_10.3.1清理前完整备份_${fileStamp}.json`), beforeBackup);
      writeJson(path.join(outputDirectory, `悠扬讲义_10.3.1清理前检查报告_${fileStamp}.json`), integrityBefore);
      writeJson(path.join(outputDirectory, `悠扬讲义_10.3.1BeforeSnapshot_${fileStamp}.json`), snapshot);
      console.log(JSON.stringify({ saved: { backup: path.join(outputDirectory, `悠扬讲义_10.3.1清理前完整备份_${fileStamp}.json`), integrity: path.join(outputDirectory, `悠扬讲义_10.3.1清理前检查报告_${fileStamp}.json`), snapshot: path.join(outputDirectory, `悠扬讲义_10.3.1BeforeSnapshot_${fileStamp}.json`) } }, null, 2));
    }
    return;
  }
  console.log(JSON.stringify({ mode: "APPLY", project_ref: PROJECT_REF, before_checksum: beforeBackup.manifest.data_checksum, allowlist_counts: snapshot.allowlist_counts }, null, 2));
  executeSql(buildCleanupSql(plan.selected));
  const afterEnvelope = await getResource("backup");
  validateBackup(afterEnvelope.backup);
  const afterIntegrity = (await getResource("integrity_check", "POST")).report;
  const cleanupReport = { project_ref: PROJECT_REF, cleaned_at: new Date().toISOString(), before: snapshot, operation: "精确 UUID 白名单事务删除明确历史测试残留及其依赖关系", actual_deleted_counts: snapshot.allowlist_counts, after: { integrity: afterIntegrity, counts: countData(afterEnvelope.backup), data_checksum: afterEnvelope.backup.manifest.data_checksum }, rollback_protection: "单次 PostgreSQL transaction；任一状态校验失败即抛错并回滚" };
  if (outputDirectory) {
    ensureDirectory(outputDirectory);
    const fileStamp = stamp();
    writeJson(path.join(outputDirectory, `悠扬讲义_10.3.1清理后完整备份_${fileStamp}.json`), afterEnvelope.backup);
    writeJson(path.join(outputDirectory, `悠扬讲义_10.3.1CleanupReport_${fileStamp}.json`), cleanupReport);
  }
  console.log(JSON.stringify({ mode: "APPLY_COMPLETE", after_status: afterIntegrity.status, after_issue_count: afterIntegrity.issue_count, after_checksum: afterEnvelope.backup.manifest.data_checksum, counts: countData(afterEnvelope.backup) }, null, 2));
}

main().catch((error) => { console.error(`Maintenance stopped: ${error instanceof Error ? error.message : String(error)}`); process.exitCode = 1; });

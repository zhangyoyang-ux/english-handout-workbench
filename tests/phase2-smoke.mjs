import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const read = (file) => readFileSync(resolve(root, file), "utf8");

const migration = read("supabase/migrations/0002_phase2_structure.sql");
assert.match(migration, /create table if not exists public\.workbench_initialization/);
assert.match(migration, /create table if not exists public\.chapters/);
assert.match(migration, /create table if not exists public\.knowledge_points/);
assert.match(migration, /create table if not exists public\.knowledge_point_placements/);
assert.match(migration, /on delete restrict/);
assert.match(migration, /deleted_at timestamptz/);
assert.match(migration, /prevent_chapter_cycle/);
assert.match(migration, /create_knowledge_point_with_placement/);
assert.match(migration, /reorder_chapter_siblings/);
assert.match(migration, /reorder_knowledge_point_placements/);
assert.match(migration, /phase2_default_chapters/);
for (const title of [
  "名词", "冠词", "代词", "形容词副词", "数词", "介词", "连词", "动词", "时态",
  "语态", "非谓语动词", "定语从句", "状语从句", "名词性从句", "特殊句式", "主谓一致",
  "虚拟语气", "其他专题",
]) {
  assert.match(migration, new RegExp(`'${title}'`));
}

const app = read("src/main.tsx");
for (const marker of [
  'endpoint("tree")', 'endpoint("chapter"', 'endpoint("knowledge_point"',
  'endpoint("placement"', 'endpoint("chapters"', 'endpoint("knowledge_points"',
  "整理目录", "新建子章节名称", "新建知识点名称", "保存失败", "localStorage",
  "AUTOSAVE_DELAY = 1300",
]) assert.match(app, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
assert.doesNotMatch(app, /图片上传|用户登录|自动备份/);

const edge = read("supabase/functions/notes/index.ts");
for (const marker of [
  'resource === "tree"', 'resource === "chapter"', 'resource === "knowledge_point"',
  'resource === "placement"', 'resource === "chapters"', 'resource === "knowledge_points"',
  "create_knowledge_point_with_placement", "CHAPTER_CYCLE", "CHAPTER_NOT_EMPTY",
  'request.method === "DELETE"', "SUPABASE_SERVICE_ROLE_KEY",
]) assert.match(edge, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

console.log("Phase 2 smoke checks: PASS");

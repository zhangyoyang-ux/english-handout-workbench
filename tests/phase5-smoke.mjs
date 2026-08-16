import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const read = (file) => readFileSync(resolve(root, file), "utf8");
const contains = (text, marker) => assert.match(text, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

const migration = read("supabase/migrations/0005_phase5_discovery.sql");
for (const marker of [
  "create table if not exists public.tags",
  "create table if not exists public.knowledge_point_tags",
  "create table if not exists public.favorite_items",
  "create table if not exists public.pinned_items",
  "phase5_default_tags",
  "search_workbench",
  "recent_workbench_edits",
  "ILIKE",
]) contains(migration, marker);
assert.doesNotMatch(migration, /drop\s+table|truncate\s+/i);
const followUpMigration = read("supabase/migrations/0006_phase5_search_active_placements.sql");
for (const marker of ["create or replace function public.search_workbench", "visible_placement.deleted_at is null", "visible_chapter.deleted_at is null"]) contains(followUpMigration, marker);
assert.doesNotMatch(followUpMigration, /drop\s+table|truncate\s+/i);

const edge = read("supabase/functions/notes/index.ts");
for (const marker of [
  'resource === "search"',
  'resource === "tags"',
  'resource === "fast_access"',
  'resource === "discovery_meta"',
  'resource === "knowledge_point_tag"',
  'resource === "favorite"',
  'resource === "pin"',
  "searchKnowledgePoints",
  "readFastAccess",
  "PIN_LIMIT",
  "recent_workbench_edits",
]) contains(edge, marker);
const app = read("src/main.tsx");
assert.doesNotMatch(app, /service_role|SUPABASE_DB_PASSWORD|postgresql:\/\//i);
for (const marker of [
  "全局搜索",
  "搜索标题、正文、例题、灵感或标签",
  "全部状态",
  "收藏",
  "置顶",
  "最近编辑",
  "继续整理",
  'endpoint("search"',
  'endpoint("favorite"',
  'endpoint("pin"',
  'endpoint("knowledge_point_tag"',
]) contains(app, marker);
assert.doesNotMatch(app, /Word 导出|历史版本|离线阅读|图片上传|用户登录/);

console.log("Phase 5 smoke checks: PASS");

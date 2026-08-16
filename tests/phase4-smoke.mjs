import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const read = (file) => readFileSync(resolve(root, file), "utf8");
const contains = (text, marker) => assert.match(text, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

const migration = read("supabase/migrations/0004_phase4_references.sql");
for (const marker of [
  "alter table public.knowledge_point_placements",
  "chapter_note jsonb not null",
  "deleted_at timestamptz",
  "placements_active_point_chapter_idx",
  "placements_active_chapter_sort_idx",
  "reorder_knowledge_point_placements",
]) contains(migration, marker);
assert.doesNotMatch(migration, /drop\s+table|truncate\s+/i);

const edge = read("supabase/functions/notes/index.ts");
for (const marker of [
  'resource === "placements"', 'resource === "placement"', 'request.method === "POST"',
  "createPlacement", "PLACEMENT_DUPLICATE", "chapter_note", "savePlacementNote",
  "removePlacement", "deleteKnowledgePoint", "KNOWLEDGE_POINT_SHARED",
  'knowledge_point_id', '.is("deleted_at", null)',
]) contains(edge, marker);

const app = read("src/main.tsx");
for (const marker of [
  "添加到其他章节", "所在章节", "共享核心", "本章补充", "仅当前章节可见",
  "修改后会同步到所有引用位置", "从当前章节移除", "chapter_note",
  'endpoint("placement"', "chapterPath", "上一篇", "下一篇", "返回目录",
]) contains(app, marker);
assert.doesNotMatch(app, /图片上传|用户登录/);

console.log("Phase 4 smoke checks: PASS");

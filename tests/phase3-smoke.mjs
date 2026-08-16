import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const read = (file) => readFileSync(resolve(root, file), "utf8");
const contains = (text, marker) => assert.match(text, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

const migration = read("supabase/migrations/0003_phase3_content.sql");
for (const marker of [
  "create table if not exists public.knowledge_point_contents",
  "knowledge_point_id uuid not null",
  "explanation jsonb not null",
  "exercises jsonb not null",
  "supplement jsonb not null",
  "inspiration jsonb not null",
  "knowledge_point_contents_one_per_point",
  "on delete restrict",
  "set_phase3_content_updated_at",
  "knowledge_point_contents_updated_idx",
]) contains(migration, marker);
assert.doesNotMatch(migration, /drop table|truncate/i);

const app = read("src/main.tsx");
for (const marker of [
  '@tiptap/react', '@tiptap/starter-kit', "EditorContent", "StarterKit",
  "explanation", "exercises", "supplement", "inspiration",
  "知识讲解", "例题练习", "补充内容", "💡 灵感",
  "阅读", "编辑", "上一篇", "下一篇", "返回目录", "保存失败",
  "AUTOSAVE_DELAY = 800", "localStorage", 'endpoint("content"',
]) contains(app, marker);
assert.doesNotMatch(app, /dangerouslySetInnerHTML|搜索|Word 导出|图片上传|收藏|置顶/);

const edge = read("supabase/functions/notes/index.ts");
for (const marker of [
  'resource === "content"', "knowledge_point_contents", "CONTENT_FIELDS",
  "CONTENT_PAYLOAD_INVALID", "KNOWLEDGE_POINT_NOT_FOUND", "upsert",
]) contains(edge, marker);

console.log("Phase 3 smoke checks: PASS");

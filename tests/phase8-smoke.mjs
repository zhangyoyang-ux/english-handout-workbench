import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const read = (file) => readFileSync(resolve(root, file), "utf8");
const contains = (text, marker) => assert.match(text, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

const migration = read("supabase/migrations/0007_phase8_history_recycle_bin.sql");
for (const marker of [
  "deletion_batch_id uuid",
  "create table if not exists public.knowledge_point_versions",
  "create table if not exists public.placement_note_versions",
  "content_hash",
  "soft_delete_chapter_tree",
  "soft_delete_knowledge_point",
  "restore_knowledge_point_version",
  "restore_placement_note_version",
  "restore_chapter_tree",
  "restore_knowledge_point_with_placements",
  "p_restore_parent_chain",
  "RESTORE_TARGET_REQUIRED",
]) contains(migration, marker);
assert.doesNotMatch(migration, /drop\s+table|truncate\s+|delete\s+from\s+public\./i);

const edge = read("supabase/functions/notes/index.ts");
for (const marker of [
  'resource === "history"',
  'resource === "history_version"',
  'resource === "restore_history"',
  'resource === "recycle_bin"',
  'resource === "restore_recycle"',
  "createKnowledgePointVersion",
  "createPlacementNoteVersion",
  "restoreHistory",
  "readRecycleBin",
  "restoreRecycleItem",
  "soft_delete_chapter_tree",
  "restore_chapter_tree",
]) contains(edge, marker);

const app = read("src/main.tsx");
for (const marker of [
  "历史版本",
  "恢复此版本",
  "恢复前当前版本",
  "回收站",
  "恢复到此章节",
  "capturePointHistory",
  "capturePlacementHistory",
  "recycleRestoreTarget",
  "mobile-workbench",
]) contains(app, marker);
assert.doesNotMatch(app, /PDF 导出|图片上传|AI 助手/);

const styles = read("src/styles.css");
for (const marker of ["phase8-overlay-backdrop", "phase8-history", "phase8-recycle", "@media (max-width: 900px)"]) contains(styles, marker);

console.log("Phase 8 smoke checks: PASS");

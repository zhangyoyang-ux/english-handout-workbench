import assert from "node:assert/strict";
import fs from "node:fs";

const read = (file) => fs.readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const migration = read("supabase/migrations/0016_phase10_2_optimistic_concurrency.sql");
const edge = read("supabase/functions/notes/index.ts");
const app = read("src/main.tsx");
const styles = read("src/styles.css");

for (const marker of [
  "core_revision",
  "note_revision",
  "overview_revision",
  "update_knowledge_point_core",
  "update_placement_note",
  "update_chapter_overview",
  "for update",
  "restore_workbench_backup",
]) assert.match(migration, new RegExp(marker.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")), `migration marker: ${marker}`);
assert.doesNotMatch(migration, /drop\s+table|truncate\s+/i, "concurrency migration never drops or truncates tables");

for (const marker of [
  "expectedRevision",
  "EditConflictError",
  "EDIT_CONFLICT",
  "update_knowledge_point_core",
  "update_placement_note",
  "update_chapter_overview",
  "savePlacementNote",
]) assert.match(edge, new RegExp(marker.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")), `edge marker: ${marker}`);

for (const marker of [
  '"conflict"',
  "检测到内容更新冲突",
  "加载云端最新版本",
  "本机草稿",
  "revalidateSelectedEntity",
  "expected_revision",
  "contentSaveInFlightRef",
  "noteSaveInFlightRef",
  "chapterSaveInFlightRef",
]) assert.match(app, new RegExp(marker.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")), `app marker: ${marker}`);
assert.match(styles, /conflict-overlay|message-bar--conflict|save-badge--conflict/);
assert.doesNotMatch(app, /实时协作|自动合并|离线编辑/);

console.log("Phase 10.2 smoke checks: PASS");

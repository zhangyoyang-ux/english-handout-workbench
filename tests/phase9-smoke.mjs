import assert from "node:assert/strict";
import fs from "node:fs";

const read = (file) => fs.readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const app = read("src/main.tsx");
const exporter = read("src/wordExport.ts");
const styles = read("src/styles.css");
const packageJson = JSON.parse(read("package.json"));

assert.ok(packageJson.dependencies.docx, "docx library is installed");
for (const marker of [
  "buildKnowledgePointExportModel",
  "buildChapterExportModel",
  "buildCombinedExportModel",
  "createDocxBlob",
  "safeDocxFilename",
  "Packer.toBlob",
  "HandoutBullets",
  "HandoutNumbers",
  "LevelFormat.BULLET",
  "LevelFormat.DECIMAL",
  "宋体",
  "Times New Roman",
  "11906",
  "16838",
  "section",
  "inspiration",
  "chapterNote",
]) assert.match(exporter, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `exporter marker: ${marker}`);

for (const marker of [
  "import(\"./wordExport\")",
  "导出 Word",
  "导出本章 Word",
  "组合导出",
  "generateCombinedExport",
  "placementId",
  "本章补充",
  "当前修改尚未成功保存，请先完成保存后再导出",
  "悠扬讲义",
  "笨蛋也能学好英语",
  "favorite-entry",
  "chapter-new-child",
  "chapter-sequence",
  "chapter-child-link",
  "chapter-point-link",
  "content-list__preview",
  "mobile-home-signature",
  "mobile-child-row",
  "mobile-point-preview",
]) assert.match(app, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `app marker: ${marker}`);

assert.doesNotMatch(app, /<section className="fast-section chapter-section"/, "desktop home keeps chapters in the left tree only");
assert.doesNotMatch(app, /subsection-grid|chapter-create-point/, "chapter page uses one vertical sequence with one knowledge-point create entry");

for (const marker of ["phase9-overlay-backdrop", "phase9-panel", "phase9-export-browser", "phase9-export-selected", "@media (max-width: 900px)", "--ui-action", "--ui-success", "--ui-pending", "--ui-teal", "--ui-lavender", "--ui-rose", "--ui-ink-blue", "home-signature"]) {
  assert.match(styles, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `style marker: ${marker}`);
}

assert.doesNotMatch(exporter, /fetch\(|supabase|service_role|SUPABASE/);
assert.doesNotMatch(exporter, /PDF|图片|AI|Word 导入|导出服务器/);
assert.doesNotMatch(read("supabase/migrations/0007_phase8_history_recycle_bin.sql"), /export_records|exported_files|download_history/);
assert.equal(fs.existsSync(new URL("../supabase/migrations/0008_phase9_export.sql", import.meta.url)), false, "Phase 9 does not add a migration");

console.log("Phase 9 smoke checks: PASS");

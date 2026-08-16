import assert from "node:assert/strict";
import fs from "node:fs";

const read = (file) => fs.readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const migration = read("supabase/migrations/0008_phase10_full_backup_restore.sql");
const edge = read("supabase/functions/notes/index.ts");
const app = read("src/main.tsx");
const styles = read("src/styles.css");

for (const marker of [
  "restore_workbench_backup",
  "app.full_restore",
  "BACKUP_POSTCHECK_FAILED",
  "p_apply boolean default false",
  "revoke all on function public.restore_workbench_backup",
  "deletion_batch_id",
]) assert.match(migration, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `migration marker: ${marker}`);
assert.doesNotMatch(migration, /drop\s+table|truncate\s+/i, "restore migration never drops or truncates tables");

for (const marker of [
  'resource === "backup"',
  'resource === "backup_preflight"',
  'resource === "backup_restore"',
  "backup_format_version",
  'schema_version: BACKUP_SCHEMA_VERSION',
  'checksum_algorithm: "SHA-256"',
  "hashCanonicalJson",
  "p_apply: false",
  "p_apply: true",
  "SUPABASE_SERVICE_ROLE_KEY",
]) assert.match(edge, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `edge marker: ${marker}`);
assert.doesNotMatch(edge, /SUPABASE_SERVICE_ROLE_KEY[^\n]*backup|service_role[^\n]*data_checksum/i, "backup model does not select or return secrets");

for (const marker of [
  "数据与安全",
  "完整备份",
  "从备份恢复",
  "backup_preflight",
  "backup_restore",
  "showSaveFilePicker",
  "悠扬讲义_恢复前安全备份",
  "last_full_backup_at",
  "备份文件完整性校验失败",
]) assert.match(app, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `app marker: ${marker}`);
assert.match(styles, /backup-overlay|backup-surface/);
assert.doesNotMatch(app, /10\.2|冲突保护|离线编辑|PWA/);
assert.equal(fs.existsSync(new URL("../supabase/migrations/0009_phase10_2.sql", import.meta.url)), false, "10.1 does not start 10.2");

console.log("Phase 10.1 smoke checks: PASS");

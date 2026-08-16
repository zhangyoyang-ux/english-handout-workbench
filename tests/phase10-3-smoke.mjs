import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const edge = read("supabase/functions/notes/index.ts");
const app = read("src/main.tsx");
const styles = read("src/styles.css");
const packageJson = JSON.parse(read("package.json"));

const checkerStart = edge.indexOf("type IntegrityIssueSeverity");
const checkerEnd = edge.indexOf("async function readCurrentPointSnapshot");
assert.ok(checkerStart >= 0 && checkerEnd > checkerStart, "integrity checker block exists");
const checker = edge.slice(checkerStart, checkerEnd);

assert.match(edge, /request\.method === "POST" && resource === "integrity_check"/, "integrity check is a fixed POST resource");
assert.match(edge, /readIntegrityTables\(client\)/, "integrity check reads the complete business table set server-side");
assert.match(edge, /status: "PASS" \| "WARNING" \| "ERROR" \| "CHECK_FAILED"/, "checker has explicit incomplete-check status");
assert.match(edge, /CHAPTER_CYCLE|CHAPTER_PARENT_MISSING|CHAPTER_SORT_DUPLICATE/, "chapter hierarchy checks exist");
assert.match(edge, /ACTIVE_POINT_ORPHAN|PLACEMENT_DUPLICATE|PLACEMENT_POINT_DELETED/, "placement and orphan checks exist");
assert.match(edge, /RICH_CONTENT_INVALID|CHAPTER_NOTE_INVALID|HISTORY_SNAPSHOT_INVALID/, "rich text checks exist");
assert.match(edge, /TAG_RELATION_DUPLICATE|FAVORITE_POINT_MISSING|PIN_LIMIT_EXCEEDED/, "tag/favorite/pin checks exist");
assert.match(edge, /HISTORY_HASH_INVALID|PLACEMENT_HISTORY_HASH_INVALID|DELETED_POINT_HAS_ACTIVE_PLACEMENT/, "history and recycle checks exist");
assert.doesNotMatch(checker, /\.from\([^)]*\)\.(update|insert|upsert|delete)\(|\.rpc\(/, "integrity checker is read-only");
assert.match(edge, /return json\(request, 200, \{ ok: true, report: await runIntegrityCheck\(client\) \}\)/, "checker returns a structured report");

assert.match(app, /endpoint\("integrity_check"\)/, "frontend calls the integrity check endpoint");
assert.match(app, /开始检查/, "frontend has a manual check entry");
assert.match(app, /复制报告/, "frontend exposes copyable report");
assert.match(app, /检查未完整完成/, "frontend distinguishes incomplete checks");
assert.match(app, /LAST_INTEGRITY_CHECK_KEY/, "last check time is UI-only local state");
assert.match(styles, /integrity-report|integrity-section/, "integrity result styles exist");
assert.ok(packageJson.scripts.test.includes("tests/phase10-3-smoke.mjs"), "phase 10.3 smoke test is included");
assert.equal(fs.existsSync(new URL("../supabase/migrations/0017_phase10_3.sql", import.meta.url)), false, "10.3 does not add a migration");

console.log("Phase 10.3 smoke checks: PASS");

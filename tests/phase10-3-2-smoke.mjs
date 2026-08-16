import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const edge = read("supabase/functions/notes/index.ts");
const packageJson = JSON.parse(read("package.json"));

assert.match(edge, /PHASE8_DELETION_BATCH_INTRODUCED_AT/, "legacy deletion cutoff is explicit");
assert.match(edge, /hashLegacyHistorySnapshot/, "legacy history hash compatibility exists");
assert.match(edge, /const legacyContent = \{\s*explanation: content\.explanation,\s*exercises: content\.exercises,\s*supplement: content\.supplement,\s*inspiration: content\.inspiration,\s*\}/s, "legacy history serialization preserves the original content field order");
assert.match(edge, /integrityHistoryHashStatus\(value: unknown, storedHash: unknown\): Promise<"CURRENT" \| "LEGACY" \| "INVALID">/, "history hash validation distinguishes current, legacy, and invalid hashes");
assert.match(edge, /historyHashStatus === "LEGACY".*collector\.addLegacy\(\)/s, "valid legacy history hashes are recorded as legacy, not errors");
assert.match(edge, /historyHashStatus === "INVALID".*HISTORY_HASH_INVALID/s, "invalid history hashes remain errors");
assert.match(edge, /Date\.parse\(row\.deleted_at\) < Date\.parse\(PHASE8_DELETION_BATCH_INTRODUCED_AT\)/, "legacy deleted rows are classified by deletion time");
assert.match(edge, /integrityIsMissingDeletionBatch\(row\).*PLACEMENT_DELETION_BATCH_MISSING/s, "post-mechanism placement rows without a batch remain detectable");
assert.match(edge, /integrityIsMissingDeletionBatch\(row\)\)\s*collector\.add\(\{\s*severity: "ERROR"/s, "post-mechanism missing deletion batches remain errors");
assert.match(edge, /legacy_count: collector\.legacyCount/, "integrity report exposes legacy counts");
assert.match(edge, /LEGACY，不视为错误/, "integrity report explains legacy data");
assert.ok(packageJson.scripts.test.includes("tests/phase10-3-2-smoke.mjs"), "10.3.2 smoke test is included");
assert.equal(fs.existsSync(new URL("../supabase/migrations/0017_phase10_3.sql", import.meta.url)), false, "10.3.2 does not add a migration");

console.log("Phase 10.3.2 smoke checks: PASS");

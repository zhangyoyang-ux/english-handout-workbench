import assert from "node:assert/strict";
import fs from "node:fs";

const maintenancePath = "scripts/maintenance/cleanup-phase10-3-1-test-residue.mjs";
const source = fs.readFileSync(maintenancePath, "utf8");

assert.match(source, /const PROJECT_REF = "dtcrxkdjzrklrhtxosxn"/);
assert.match(source, /"migration", "list", "--linked"/);
assert.match(source, /getResource\("backup"\)/);
assert.match(source, /getResource\("integrity_check", "POST"\)/);
assert.match(source, /const apply = process\.argv\.includes\("--apply"\)/);
assert.match(source, /if \(apply && !beforeBackupPath\)/);
assert.match(source, /BEGIN\s*\n/);
assert.match(source, /single DO block|single DO/i);
assert.match(source, /\$cleanup\$/);
assert.match(source, /RAISE EXCEPTION/);
assert.match(source, /CLEANUP_STATE_CHANGED/);
assert.match(source, /CLEANUP_UNALLOWLISTED/);
assert.match(source, /PROTECTED_KNOWN_FORMAL_IDS/);

assert.doesNotMatch(source, /DROP\s+TABLE/i);
assert.doesNotMatch(source, /TRUNCATE/i);
assert.doesNotMatch(source, /DISABLE\s+(TRIGGER|ROW\s+LEVEL\s+SECURITY)/i);
assert.doesNotMatch(source, /DELETE\s+FROM\s+public\.\w+\s*;/i);
assert.doesNotMatch(source, /\bLIKE\b/i);
assert.doesNotMatch(source, /service_role|SUPABASE_SERVICE_ROLE_KEY|DATABASE_PASSWORD|JWT_SECRET/i);

for (const name of ["CHAPTER_IDS", "KNOWLEDGE_POINT_IDS", "CONTENT_IDS", "PLACEMENT_IDS", "KNOWLEDGE_POINT_VERSION_IDS", "PLACEMENT_NOTE_VERSION_IDS"]) {
  assert.match(source, new RegExp(`const ${name} = \\[`));
}

console.log("Phase 10.3.1 maintenance safety smoke: PASS");

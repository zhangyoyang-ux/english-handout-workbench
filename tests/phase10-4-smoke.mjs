import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const main = read("src/main.tsx");
const offline = read("src/offline.ts");
const worker = read("public/sw.js");
const edge = read("supabase/functions/notes/index.ts");
const packageJson = JSON.parse(read("package.json"));

assert.match(offline, /indexedDB\.open\(DATABASE_NAME, DATABASE_VERSION\)/, "offline data uses IndexedDB");
assert.match(offline, /transaction\(SNAPSHOT_STORE, "readwrite"\)/, "snapshot replacement uses a write transaction");
assert.match(offline, /transaction\.oncomplete/, "snapshot write waits for transaction completion");
assert.doesNotMatch(offline, /localStorage/, "offline snapshot module does not use LocalStorage");
assert.match(main, /endpoint\("offline_snapshot"\)/, "client requests the production offline snapshot");
assert.match(main, /writeOfflineSnapshot\(snapshot\)/, "validated snapshots are persisted locally");
assert.match(main, /离线阅读暂不提供全文搜索/, "offline search degrades without breaking the page");
assert.match(main, /联网后可以继续编辑/, "offline editing is disabled with an explicit message");
assert.match(main, /clearOfflineSnapshot\(\)/, "full restore invalidates the old offline snapshot");
assert.match(edge, /resource === "offline_snapshot"/, "Edge Function exposes the offline snapshot resource");
assert.match(edge, /snapshot_version: 1/, "offline snapshot has a format version");
assert.match(edge, /schema_version: "0016"/, "offline snapshot records the current schema version");
assert.match(edge, /data_checksum: await hashCanonicalJson\(data\)/, "offline snapshot includes a checksum");
assert.match(edge, /contents: Object\.fromEntries/, "offline snapshot includes structured point contents");
assert.match(worker, /if \(request\.method !== "GET"\) return/, "Service Worker never handles write requests");
assert.match(worker, /url\.pathname\.includes\("\/functions\/notes"\)/, "Service Worker excludes the Supabase API");
assert.doesNotMatch(worker, /backgroundSync|writeQueue|request\.method\s*===\s*["'](?:POST|PATCH|DELETE)["']/i, "Service Worker has no background write queue");
assert.ok(packageJson.scripts.test.includes("tests/phase10-4-smoke.mjs"), "10.4 smoke test is included");
assert.ok(packageJson.scripts.test.includes("tests/phase10-4-stress.mjs"), "10.4 stress test is included");

console.log("Phase 10.4 offline reading smoke checks: PASS");

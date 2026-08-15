import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const read = (file) => readFileSync(resolve(root, file), "utf8");

assert.ok(existsSync(resolve(root, "supabase/migrations/0001_stage1_notes.sql")));
assert.match(read("supabase/migrations/0001_stage1_notes.sql"), /create table if not exists public\.stage1_notes/);
assert.match(read("supabase/migrations/0001_stage1_notes.sql"), /id uuid primary key/);
assert.match(read("supabase/migrations/0001_stage1_notes.sql"), /created_at timestamptz/);
assert.match(read("supabase/migrations/0001_stage1_notes.sql"), /updated_at timestamptz/);

const api = read("api/notes.ts");
assert.match(api, /SUPABASE_SERVICE_ROLE_KEY/);
assert.match(api, /request\.method === "GET"/);
assert.match(api, /request\.method !== "GET" && request\.method !== "PUT"/);
assert.match(api, /DATABASE_READ_ERROR/);
assert.match(api, /DATABASE_WRITE_ERROR/);

const app = read("src/main.tsx");
assert.match(app, /AUTOSAVE_DELAY = 800/);
assert.match(app, /localStorage/);
assert.match(app, /保存失败/);
assert.match(app, /Supabase PostgreSQL/);

const html = read("index.html");
assert.match(html, /noindex/);
assert.match(html, /nofollow/);
assert.match(read("public/robots.txt"), /Disallow: \/$/m);
assert.doesNotMatch(app, /VITE_SUPABASE/);

console.log("Phase 1 smoke checks: PASS");

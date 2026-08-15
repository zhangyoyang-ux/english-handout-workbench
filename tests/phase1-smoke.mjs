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

const app = read("src/main.tsx");
assert.match(app, /AUTOSAVE_DELAY = 800/);
assert.match(app, /functions\/v1\/notes/);
assert.match(app, /localStorage/);
assert.match(app, /保存失败/);
assert.match(app, /Supabase PostgreSQL/);

const html = read("index.html");
assert.match(html, /noindex/);
assert.match(html, /nofollow/);
assert.match(read("public/robots.txt"), /Disallow: \/$/m);
assert.doesNotMatch(app, /VITE_SUPABASE/);
assert.doesNotMatch(app, /service_role/i);

const edgeFunction = read("supabase/functions/notes/index.ts");
assert.match(edgeFunction, /Deno\.serve/);
assert.match(edgeFunction, /SUPABASE_SERVICE_ROLE_KEY/);
assert.match(edgeFunction, /CORS_ORIGIN_NOT_ALLOWED/);
assert.match(edgeFunction, /request\.method === "GET"/);
assert.match(edgeFunction, /DATABASE_WRITE_ERROR/);
assert.doesNotMatch(edgeFunction, /console\.log/);

const workflow = read(".github/workflows/deploy-pages.yml");
assert.match(workflow, /actions\/deploy-pages@v4/);
assert.match(workflow, /VITE_BASE_PATH: \/english-handout-workbench\//);
assert.match(workflow, /VITE_NOTES_FUNCTION_URL/);

const packageJson = read("package.json");
assert.doesNotMatch(packageJson, /vercel/i);
assert.doesNotMatch(read("vite.config.ts"), /vercel/i);

console.log("Phase 1 smoke checks: PASS");

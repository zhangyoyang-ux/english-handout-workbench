# 个人英语讲义工作台

第一阶段生产架构：

`GitHub Pages → React → Supabase Edge Function → Supabase PostgreSQL`

当前只验证文字输入、自动保存、云端持久化与跨设备读取。不包含登录、图片、正式章节、知识点、搜索、备份或 Cron。

## 技术架构

- 前端：Vite + React + TypeScript
- 网页托管：GitHub Pages
- 服务端 API：Supabase Edge Function，`notes`
- 数据库：Supabase PostgreSQL
- 数据 Schema：`supabase/migrations/0001_stage1_notes.sql`
- Edge Function 源码：`supabase/functions/notes/index.ts`

## 本地运行

```text
npm install
npm run dev
```

前端通过 `VITE_NOTES_FUNCTION_URL` 访问 Edge Function；该变量只包含公开 Endpoint，不包含任何 Secret。

## Supabase

1. 在新的 Supabase Project 执行 `supabase/migrations/0001_stage1_notes.sql`。
2. 部署 `supabase/functions/notes/index.ts`，函数名为 `notes`。
3. 保持 Edge Function 服务端使用 `SUPABASE_SERVICE_ROLE_KEY`，不要把它写入 React、`VITE_*` 变量或 Git。
4. 生产前端来源允许 `https://zhangyoyang-ux.github.io`，本地开发来源仅用于调试。

## GitHub Pages

`.github/workflows/deploy-pages.yml` 会在 `main` 分支更新后构建并部署。GitHub Pages 子路径使用 `/english-handout-workbench/`，生产构建会自动设置 Vite base path。

LocalStorage 只用于保存尚未成功上传的临时草稿；正常联网时云端内容优先。

# 个人英语讲义工作台

第一阶段的干净项目，只验证“文字输入 → 自动保存 → 刷新/换设备继续读取”的核心链路。

## 技术架构

- 前端：Vite + React + TypeScript
- 部署：Vercel
- API：Vercel Server Function，`/api/notes`
- 数据库：Supabase PostgreSQL
- Schema：Supabase SQL migration

## 本地运行

1. 复制 `.env.example` 为 `.env`。
2. 填入新的 Supabase 项目 URL 与仅服务端使用的 `SUPABASE_SERVICE_ROLE_KEY`。
3. 在新的 Supabase 项目执行 `supabase/migrations/0001_stage1_notes.sql`。
4. 运行 `npm install`、`npm run dev`。

浏览器只访问 `/api/notes`，不会持有高权限数据库 Secret。LocalStorage 只保存尚未成功上传的临时草稿；云端内容优先。

## 第一阶段边界

当前没有登录、用户体系、图片、Storage、Cron、自动备份、正式章节、知识点、搜索或 Word 导出。旧版项目位于同级目录 `讲义网站`，本项目没有复制或迁移旧数据。

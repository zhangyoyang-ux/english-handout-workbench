# 悠扬讲义 Stable Baseline

> 这是悠扬讲义 V1.0 的正式 Stable 基线记录。

## 产品

- 产品：悠扬讲义
- 工程基线日期：2026-08-16
- 稳定版本：v1.0.0
- 当前状态：Stable / Maintenance Mode

## 代码与部署

- Final engineering commit：`8bbec0909c2e3b6fa9c5356c7c588f71804a8efe`
- Stable tag：`v1.0.0`（annotated，已推送）
- GitHub repository：`zhangyoyang-ux/english-handout-workbench`
- Production URL：`https://zhangyoyang-ux.github.io/english-handout-workbench/`
- Supabase Edge Function：`https://dtcrxkdjzrklrhtxosxn.supabase.co/functions/v1/notes`
- Migration：`0001–0016`
- GitHub main：已与本地工程提交同步

## 数据与完整性

- Backup Format Version：`1`
- Backup schema model：`0008`
- Production schema checked：`0016`
- Integrity：`ERROR 0 / WARNING 0`
- Legacy compatibility records：`6`（已解释，不计为错误）

## 正式封版基线备份

- 文件：`D:\悠扬讲义备份\悠扬讲义_正式封版基线_2026-08-16_2230.json`
- SHA-256：`01a1d1825a9e366ebd18585502aecfaea3f95f6fe18acf4ecdf1dcfc238d87bf`
- Backup checksum：PASS
- Backup preflight：PASS
- 不包含 Secret、数据库密码、Token 或环境变量

## 10.4 工程验证

- IndexedDB active library snapshot：PASS
- Offline read-only guards：PASS
- Service Worker GET-only app shell：PASS
- Snapshot checksum 与原子更新：PASS
- 300+ chapters / 1000+ knowledge points / 1500+ placements synthetic stress：PASS
- Phase 1–10.3.2 regression：PASS
- npm test：PASS
- Build：PASS
- Lint：PASS

## 真实设备验收（用户确认）

- 电脑真实断网阅读：PASS
- 手机真实断网阅读：PASS
- Wi-Fi / 移动网络恢复：PASS
- 离线阅读未产生云端写入：PASS

真实设备验收完成，产品进入 Stable / Maintenance Mode。

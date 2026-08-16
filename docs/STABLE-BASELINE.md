# 悠扬讲义 Stable Baseline

> 这是 10.4 工程封版候选基线记录。真实设备的断网阅读与恢复网络测试仍需由用户本人完成；在该门槛通过前，不宣称正式 Stable 封版。

## 产品

- 产品：悠扬讲义
- 工程基线日期：2026-08-16
- 目标稳定版本：v1.0.0
- 当前状态：Engineering Candidate / Maintenance Gate Pending

## 代码与部署

- Final engineering commit：`1abe992bd6220c7bf730d49c4c779d0e5b725761`
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

## Release gate

正式建立 `v1.0.0` tag 并宣布“悠扬讲义 V1.0 正式封版”前，必须由用户本人确认：

- 电脑真实断网后仍可打开并阅读
- 手机真实断网后仍可打开、进入目录并阅读
- Wi-Fi / 移动网络恢复后回到在线状态
- 离线阅读不会产生任何云端写入

通过上述真实设备验收后，再创建并推送正式 `v1.0.0` annotated tag，进入 Stable / Maintenance Mode。

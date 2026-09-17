# 数据库迁移说明（MOMO Corn 安全加固）

> ⚠️ **所有迁移都需要你在 Supabase Dashboard → SQL Editor 中手动执行。**
> 本轮代码改造没有、也无法替你修改线上数据库。
> 执行任何迁移前，请先在 Dashboard → Database → Backups 确认最近一次备份可用。

## 迁移文件清单

| 文件 | 目的 | 风险 | 可否重复执行 |
|---|---|---|---|
| `0001_profiles_and_functions.sql` | 建 profiles 身份映射 + 辅助函数 + 注册触发器 | 低（只新增对象） | ✅ |
| `0002_rls_policies.sql` | 删除全部 Allow all，按参与者重建 RLS | **高**（执行后 anon/旧 APK 立即失去数据访问） | ✅ |
| `0003_ephemeral_rpc_hardening.sql` | 小纸条/语音 RPC 改 SECURITY DEFINER + 身份校验 | 中（签名不变，客户端无需改） | ✅ |
| `0004_storage_private.sql` | photos bucket 私有化 + storage 策略 | **高**（旧公开 URL 立即失效） | ✅ |
| `0005_media_paths_backfill_and_cron.sql` | 历史图片 URL 回填为路径 + 定时清理 | 中（改字符串，建议先备份） | ✅（cron 会重复注册，先 unschedule） |
| `0006_momi_and_features_upgrade.sql` | 建立 momi 消息、记忆、头像与配置基础表 | 中（新增对象；momi 表沿用固定双人宽松策略） | ✅ |
| `0007_momi_v5_memory_history.sql` | 可信记忆证据账本、稳定历史、幂等键与 worker job | **中高**（迁移旧记忆状态与重复幂等键，必须先备份） | ✅ |
| `0008_momi_v5_atomic_rpc.sql` | 原子记忆 RPC、可恢复 lease、幂等回复与最小执行权 | 中（替换同签名函数；worker RPC 仅 service_role） | ✅ |

## 执行顺序（严格遵守）

```
阶段 0（准备，Dashboard 操作）
  0a. Database → Backups：确认有可用备份
  0b. Authentication → Users → Add user：
      创建 momo 与 苞米 两个邮箱账号（勾选 Auto Confirm，
      metadata 中填 {"app_username": "momo"} / {"app_username": "苞米"}）
  0c. Edge Functions：部署 usersig（见 supabase/functions/usersig/）
      并设置 secrets：TIM_SECRET_KEY、TIM_SDKAPPID

阶段 1（可与现有 APK 并存）
  1a. 执行 0001_profiles_and_functions.sql
      → 新建的两个 auth 用户会自动（触发器/回填）得到 profiles 行
  1b. 验证：select * from profiles; 应恰好两行（momo / 苞米）

阶段 2（两台手机都装好新 APK 并能用邮箱登录后）
  2a. 执行 0002_rls_policies.sql
  2b. 执行 0003_ephemeral_rpc_hardening.sql
  2c. 执行 0004_storage_private.sql
  2d. 执行 0005_media_paths_backfill_and_cron.sql

阶段 3（momi V5；备份确认后严格串行）
  3a. 执行 0006_momi_and_features_upgrade.sql
  3b. 执行 0007_momi_v5_memory_history.sql
  3c. 执行 0008_momi_v5_atomic_rpc.sql
  3d. 设置 momi-chat-worker 服务端 secrets 并部署函数
  3e. 先做授权健康检查和单条手动验收，再启用 scheduler

阶段 4（收尾）
  4a. 腾讯云控制台：更换 IM SecretKey（旧 key 已进过 Git 历史，视为泄露）
  4b. 重新部署 usersig Edge Function 的 secret 为新 key
```

## 为什么是这个顺序

- 0001 只新增对象，旧 APK（anon 访问）完全不受影响。
- 0002/0003/0004 一旦执行，anon 与旧 APK 全部失效，因此必须等两台手机
  都升级到「Supabase Auth 登录」的新 APK 后再执行。
- 0005 依赖 0004（bucket 私有后路径回填才有意义），且新 APK 的
  mediaResolver 同时兼容 URL 与路径，执行早晚都不影响显示。
- 0007 明确依赖 0006 的基础表；0008 明确依赖 0007 的证据列与 job 表。
- worker 在 0008 之前无法获得安全的 claim/complete/fail RPC；scheduler 必须最后启用。

## momi V5 当前安全边界

- `momi-chat-worker` 的 claim/complete/fail RPC 只授予 `service_role`；APK 不持有 worker secret、service-role key 或模型 API key。
- 当前 momi 页面仍用本地昵称解析 actor；这**不等于 Supabase Auth**，因此 `private` 记忆还不是数据库层真正的用户隔离。客户端会按 actor 二次过滤，但不能把它描述成完整 RLS 安全。
- 在 momo/苞米都迁移到可验证的 Supabase Auth 身份后，必须再新增迁移，收紧 momi 消息、记忆来源与记忆事件策略。
- `0007`/`0008` 和 worker 当前都只在仓库中，尚未在真实 PostgreSQL 或线上项目执行/部署。

## 执行后验证（权限反向测试）

用 **无认证** 的 anon key 直接发 REST 请求（模拟攻击者），全部应被拒绝：

```bash
URL=https://kotakqdxwvienrmbcrnk.supabase.co
KEY=<anon publishable key>

# 1. 读表 → 应 401/空（迁移前返回数据）
curl -s "$URL/rest/v1/messages?select=id&limit=1" -H "apikey: $KEY"

# 2. 写表 → 应被拒
curl -s -X POST "$URL/rest/v1/messages" -H "apikey: $KEY" \
  -H "Content-Type: application/json" -d '{"user_id":"momo","content":"x","type":"text"}'

# 3. RPC → 应 permission denied
curl -s -X POST "$URL/rest/v1/rpc/claim_ephemeral_note" -H "apikey: $KEY" \
  -H "Content-Type: application/json" -d '{"p_receiver":"momo"}'

# 4. Storage 列目录 / 公开 URL → 应被拒
curl -s -X POST "$URL/storage/v1/object/list/photos" -H "apikey: $KEY" \
  -H "Content-Type: application/json" -d '{"prefix":"","limit":5}'
```

正向验证：两台手机用邮箱登录后，聊天、打卡、游戏、纸条、语音均正常。

momi V5 还需单独验证：anon/authenticated 不能调用 worker RPC；service_role 可以领取 job；客户端与 worker 同时回复时，同一 `generation_key` 最终只有一行；过期 `processing` lease 可被回收，尝试次数不超过 5。

## 回滚方案

- 每个文件末尾附有对应回滚 SQL。
- 0002 的应急回滚（恢复 Allow all）会让数据重新对公众开放，仅用于
  新 APK 出现致命问题时临时止血，恢复后应尽快重新收紧。
- momi worker 紧急回滚应先停 scheduler，再停用函数；不要删除消息、outbox 或 job 数据。

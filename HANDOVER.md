# 交接记录 (HANDOVER.md)

## 2026-08-14 会话

### 任务：更新项目到 GitHub 最新版本
- 本地项目已更新至 GitHub 最新提交 `4567780 fix(navigation): 修复加号模块全屏层穿透与点击失效`
- 当前分支 `main` 与 `origin/main` 完全一致

### 注意事项
- 本地原有提交 `c32a6ba`（checkpoint before forensic audit of Little Notes + Voice Mailbox）及未提交改动已被丢弃，请勿在本地查找这些改动
- 未跟踪目录 `.audit/` 保留在本地，未纳入版本控制
- 最新代码基于 Expo SDK 56，编写代码前请参阅 https://docs.expo.dev/versions/v56.0.0/

### 任务：本地打包 APK
- 已成功本地打包 release APK：`android/app/build/outputs/apk/release/app-release.apk`（87.5 MB）
- 构建方式：`gradlew assembleRelease --no-daemon`，使用 JDK 21（D:\AndroidStudio\jbr）
- 注意：release APK 用的是 `android/app/debug.keystore` 签名，仅适合开发调试，正式发布需配置正式签名（keystore）

### 任务：小纸条与录音深度复查二次修复（2026-08-14 深夜）
- 服务端已用 curl 端到端验证正常（INSERT → claim → content 返回），病灶在客户端
- **录音根因**：expo-audio `RecorderState` 字段名是 `durationMillis`（源码实证），原代码 `durationMs` 恒为 undefined；且需 `isMeteringEnabled: true` 才有波形
- **小纸条根因**：fetchWithTimeout 自动重试副作用 RPC（claim）→ 超时后重试拿到空 → 纸条丢失
- **⚠️ 必须按顺序操作**：
  1. 先在 Supabase SQL Editor 重新执行 `src/lib/ephemeral_schema.sql`（新增 claim_request_id 列 + claim RPC 带 p_client_id 幂等参数）
  2. 再把 2026-08-14 23:15 打包的 app-release.apk 装到手机（旧 APK 的录音修复不完整）
- 新 RPC 签名 `claim_ephemeral_note(p_receiver, p_client_id DEFAULT NULL)` 向后兼容旧客户端
- 经验：写代码前先查 node_modules 里库的源码确认字段名；有副作用的 RPC 调用禁止自动重试

### 任务：修复小纸条/语音信箱/你画我猜问题（2026-08-14 晚）
- 已修复 4 个问题（详见 process.md 同日记录），重新打包 APK 并推送 GitHub
- 语音信箱录音修复要点：`await audioRecorder.record()`；试听 Player 拆为 PreviewPanel 子组件按需创建
- 键盘遮挡根因：新架构 edge-to-edge 下 Android adjustResize 失效，所有 KeyboardAvoidingView 必须显式 `behavior="padding"`
- 后续如有新输入界面，务必带上 KAV padding，勿再用 `Platform.OS === 'ios' ? 'padding' : undefined`
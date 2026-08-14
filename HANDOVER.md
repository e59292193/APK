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

### 任务：修复小纸条/语音信箱/你画我猜问题（2026-08-14 晚）
- 已修复 4 个问题（详见 process.md 同日记录），重新打包 APK 并推送 GitHub
- **⚠️ 关键待办：小纸条修复需在 Supabase Dashboard → SQL Editor 重新执行 `src/lib/ephemeral_schema.sql`**（claim RPC 的 42702 歧义错误在服务端，仅改代码文件不生效）
- 验证方法：执行 SQL 后，可 curl `POST /rest/v1/rpc/claim_ephemeral_note` body `{"p_receiver":"momo"}`，应返回 `[]` 或纸条数据而非 400 错误
- 语音信箱录音修复要点：`await audioRecorder.record()`；试听 Player 拆为 PreviewPanel 子组件按需创建
- 键盘遮挡根因：新架构 edge-to-edge 下 Android adjustResize 失效，所有 KeyboardAvoidingView 必须显式 `behavior="padding"`
- 后续如有新输入界面，务必带上 KAV padding，勿再用 `Platform.OS === 'ios' ? 'padding' : undefined`
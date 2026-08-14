# 项目进程记录 (process.md)

## 任务记录

### 2026-08-14 更新项目到 GitHub 最新版本
- **任务**：从 GitHub (https://github.com/e59292193/APK.git) 更新本地项目到最新版本
- **操作**：
  1. `git pull` 时本地与远程分叉（本地 1 个提交，远程 31 个提交），产生合并冲突
  2. 用户选择"以 GitHub 为准（丢弃本地改动）"
  3. 执行 `git merge --abort` + `git fetch origin` + `git reset --hard origin/main`
- **结果**：本地 HEAD 更新至 `4567780 fix(navigation): 修复加号模块全屏层穿透与点击失效`，与 `origin/main` 一致
- **说明**：本地原有提交 `c32a6ba checkpoint before forensic audit` 及未提交改动已按用户要求丢弃；未跟踪目录 `.audit/` 保留

### 2026-08-14 本地打包 APK
- **任务**：本地打包 APK
- **环境**：Node v24.16.0、Android SDK (D:\AndroidStudio\Sdk)、JDK 21 (D:\AndroidStudio\jbr)、eas-cli 20.1.0（未登录 Expo 账号）
- **操作**：
  1. 尝试 `eas build --local`，因未登录 Expo 账号失败
  2. 改用 gradle 直接构建 release APK：设置 JAVA_HOME 为 JDK 21，运行 `.\android\gradlew.bat -p .\android assembleRelease --no-daemon`
- **结果**：`BUILD SUCCESSFUL in 5m 49s`，产物 [app-release.apk](file:///d:/APK/APK/android/app/build/outputs/apk/release/app-release.apk)（87.5 MB，Hermes）
- **注意**：release APK 使用 android/app/debug.keystore 签名（开发调试用），非正式发布签名

### 2026-08-14 修复小纸条/语音信箱/你画我猜问题
- **任务**：修复 4 个问题并重新打包推送
- **问题 1（小纸条"网络开小差"）**：
  - 根因：Supabase RPC `claim_ephemeral_note` / `claim_ephemeral_voice` 内 `WHERE id = v_id` 与 `RETURNS TABLE` 的 OUT 参数 `id` 产生 42702 歧义错误（已用 curl 验证：HTTP 400 ambiguous column reference）
  - 修复：[ephemeral_schema.sql](file:///d:/APK/APK/src/lib/ephemeral_schema.sql) 改为表名限定 `WHERE ephemeral_notes.id = v_id`
  - ⚠️ **需在 Supabase Dashboard → SQL Editor 手动重新执行该 SQL 文件才能生效**
  - 另在 EphemeralNoteScreen catch 中加入 console.warn 便于诊断
- **问题 2（语音信箱录音不开始/不计时）**：
  - 根因：`audioRecorder.record()` 未 await，Promise 异常被吞；`useAudioPlayer(null)` 常驻抢占 AudioSession；卸载清理闭包陈旧
  - 修复：[VoiceMailboxScreen.js](file:///d:/APK/APK/src/screens/VoiceMailboxScreen.js)——`await record()`、试听拆为 PreviewPanel 子组件（仅录制完成才创建 Player）、durationRef 累计时长（stop 后 recorderState 会归零）、isRecordingRef 修复卸载清理
- **问题 3（你画我猜错误答案画画方看不到）**：
  - 根因：错误猜词仅有 4.2 秒浮动弹幕，画画方易错过
  - 修复：[useDrawGuessSession.js](file:///d:/APK/APK/src/hooks/useDrawGuessSession.js) 新增 `guesses` 持久记录（本地提交+信号接收均写入，轮次切换清空）；[DrawGuessControls.js](file:///d:/APK/APK/src/components/drawguess/DrawGuessControls.js) 新增 GuessHistory 水平滚动条（画布下方，双方可见，错误=深色、正确=绿色）
- **问题 4（键盘遮挡输入框）**：
  - 根因：新架构 edge-to-edge（gradle.properties `edgeToEdgeEnabled=true`）下 Android adjustResize 失效，而 KAV 写法 `Platform.OS === 'ios' ? 'padding' : undefined` 在 Android 上等于未启用
  - 修复：三处统一改为 `behavior="padding"`——App.js 登录页、DrawGuessGameScreen 猜词/提示输入、CustomWordsModal 私房词库弹窗（DrawGuessModals.js）
- **构建**：`BUILD SUCCESSFUL in 1m 10s`，APK 重新生成（87.5 MB，2026-08-14 22:56）

### 2026-08-14 深度复查：小纸条与录音二次修复
- **背景**：用户执行 SQL 后，小纸条仍不显示内容；录音计时仍停 0 秒
- **服务端验证**：curl 端到端测试（INSERT → claim）完全正常，content 正确返回 → 服务端无问题，病灶在客户端
- **录音根因（实锤）**：查 expo-audio 源码（node_modules/expo-audio/src/utils/useAudioRecorderState.ts + Audio.types.ts），`RecorderState` 的字段名是 **`durationMillis`**，而代码用的 `recorderState.durationMs` 永远是 undefined → 计时停 0、停止后时长 0 报"录音太短"。另外 preset 未含 `isMeteringEnabled`，波形 metering 也是 undefined
- **录音修复**（VoiceMailboxScreen.js）：`durationMs` → `durationMillis`（3 处）；`useAudioRecorder({ ...RecordingPresets.HIGH_QUALITY, isMeteringEnabled: true })`
- **小纸条根因（高嫌疑）**：`fetchWithTimeout` 默认重试 3 次——claim 是有副作用（at-most-once）的 RPC，首次超时但服务端已 claim 成功时，重试拿到空结果 → 纸条被误判 empty，内容永久丢失
- **小纸条修复**：
  1. ephemeralService.js：claimNote/claimVoice 改 `retries: 0, timeout: 20000`（绝不自动重试有副作用的操作）
  2. SQL（ephemeral_schema.sql）：claim RPC 新增 `p_client_id` 幂等参数 + `claim_request_id` 列/索引——同一客户端超时重试返回同一张纸条，彻底防丢
  3. 两个 Screen：claimSessionRef 会话 ID 贯穿失败重试（失败保留、成功清空）
- **⚠️ 用户操作顺序（重要）**：**先**在 Supabase SQL Editor 重新执行 `src/lib/ephemeral_schema.sql`（幂等列 + 新 RPC 签名），**再**安装 23:15 新 APK。顺序反了会因 RPC 签名不匹配报错（新 APK 传 p_client_id，旧 SQL 无此参数）
- **旧 APK 提醒**：上一轮 22:12/22:56 的 APK 中录音修复不完整（durationMillis 字段名 bug 是本轮才发现的），必须安装本轮 23:15 的 APK
- **构建**：`BUILD SUCCESSFUL in 54s`，APK 87.5 MB（2026-08-14 23:15）
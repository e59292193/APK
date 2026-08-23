# 交接记录 (HANDOVER.md)

## 2026-08-23 会话（因额度终止，含未完成 bug 排查线索）

### ⚠️ 未完成：新增愿望 / 新增旅程弹窗不渲染（下次会话第一优先）

- **症状**：点击"新增愿望"（WishlistScreen，BottomSheetContainer）或"新增旅程"（TravelDiaryScreen，原生 Modal）后，弹窗打开但正文区（ScrollView+输入框+图片选择）整体不渲染——标题栏和底部按钮正常，正文区像素全白，uiautomator 节点树中 ScrollView/EditText 完全缺失，无任何 JS 报错。
- **已确认事实**：
  1. 旧 APK（139455c 时代，7 月 15 日构建）同一模拟器上弹窗完整渲染（2 个 EditText 在）——**回归由本轮变更引入**
  2. 登录页（KAV+ScrollView+AppInput，结构与弹窗相同）在新 APK 中正常 → **问题特定于 Modal 内部渲染**
  3. 两种不同弹窗实现同时坏 → 系统性问题，非单组件
  4. 复现步骤：愿望清单 → 点"新增愿望" → dump：`adb exec-out uiautomator dump /dev/tty`，观察无 EditText；截图 `.audit/bug-wishlist-modal.png`
- **二分排查状态（进行到一半）**：
  - 头号嫌疑：**依赖补丁对齐**（commit 3e5178e：expo 56.0.11→56.0.20 等 9 项 + react-native-svg 15.15.5→**降级**15.15.4 + app.json 加了 expo-image 插件）
  - 次级嫌疑：commit be1a9c6/cb4f91a 的源码（但未触碰 Modal/ScrollView/布局路径）
  - 工作区已把 package.json/package-lock.json 还原到 139455c（旧依赖+新源码），对应构建被中断未完成
- **下次第一步**：`export JAVA_HOME=/d/AndroidStudio/jbr && cd android && ./gradlew assembleRelease --no-daemon`（依赖已还原）→ 安装 → 测弹窗。若恢复 → 保留依赖回退；若仍坏 → 逐个回退 be1a9c6 中的源码模块（先 imageCache.js/mediaResolver，再 ErrorBoundary/usePolling）
- **注意**：模拟器 Pixel_8a 上现为最新 APK（05:30 构建，含昵称登录）；模拟器 Google 密码管理器存有旧凭据 momo/20260225 会自动填充（无碍）；本机 shell 的 HTTP_PROXY/HTTPS_PROXY 指向已关闭的 7892 端口，curl/git 直连外网前需 `HTTP_PROXY= HTTPS_PROXY= ` 置空

### 已完成（本会话）

1. **登录方式已按用户要求改回昵称+密码**（momo/苞米，密码 20260225）：`src/lib/auth.js` 本地校验+AsyncStorage 会话，App.js 登录屏已恢复昵称字段；模拟器实测错误密码提示与正确登录进主界面均正常。**⚠️ 此决定覆盖了 P0-1（客户端固定口令）整改；supabase/migrations 与 UserSig Edge Function 代码保留但 0002 及之后的收紧策略在启用真实认证前不可执行**
2. **P0 其余整改**（详见 .audit/AUDIT.md）：IM 密钥移出客户端（UserSig 服务端化，Edge Function 需用户部署）、ErrorBoundary 脱敏、build-apk.ps1 重写、local.properties 解除跟踪、RLS/Storage/RPC 迁移 5 件套+README；顺带清除了旧脚本遗留的仓库级 `http.proxy/sslverify=false` 配置
3. **P1**：fetchWithTimeout/usePolling/wakeUpSupabase/realtimeSignal/tim.waitReady 生命周期与重试语义；consumeVoice 数组返回修复；sendVoice 幂等续传
4. **工程化**：npm 唯一包管理、lint/test 脚本、ESLint 0 错误、Jest 38 测试、GitHub Actions
5. **验证**：expo-doctor 21/22（余 1 项需 SDK 57）、npm audit 余 16 项构建链漏洞（同理）、release 构建成功、模拟器登录/五标签/聊天数据加载实测通过、0 FATAL/0 ANR

### 产物

- 最终 APK：`android/app/build/outputs/apk/release/app-release.apk`（91,719,920 字节，2026-08-23 05:30，含昵称登录；**注意：含弹窗回归 bug**）
- SHA-256：构建于依赖回退实验前，如复用请以 `certutil -hashfile <apk> SHA256` 现算为准
- 证据截图：`.audit/smoke-0*.png`、`.audit/bug-wishlist-modal.png`

## 2026-08-23 会话（审计轮，早段）

### 任务：全应用审计、P0/P1 修复、构建与模拟器验收（分支 audit/full-app-stabilization-20260823）
- **基线**：main @ 139455c；审计分支 6 个提交（文档同步 / 基线整备 / P0 安全 / P1 网络与语音 / CI）
- **P0 完成项**：
  1. 登录改为 Supabase Auth 邮箱+密码（`src/lib/auth.js`，App.js 重写登录屏；`__DEV__` 构建保留测试身份入口，release 无此路径）
  2. 腾讯 IM SecretKey 从客户端移除；UserSig 改由 Edge Function `supabase/functions/usersig` 签发（验证 Supabase 会话→profiles 身份，24h 有效期）
  3. RLS/Storage/RPC 收紧迁移 5 件套：`supabase/migrations/0001-0005` + README（执行顺序、兼容窗口、验证 SQL、回滚）
  4. photos bucket 客户端改造：photoUtils 只存 bucket 路径，渲染经 `mediaResolver.resolvePhotosUrl` 换 7 天 signed URL（缓存）；历史 URL 由 0005 迁移回填
  5. ErrorBoundary：release 只显示错误编号+重试；上报仅 HTTPS 可配置且脱敏；删除局域网 HTTP DEBUG_URL
  6. build-apk.ps1 重写（无 git 操作/不改全局配置/不关 SSL/失败即退/留完整日志）；local.properties 解除跟踪
- **P1 完成项**：fetchWithTimeout（真实取消+读写语义分类+抖动退避）、usePolling（防重叠+退避+前后台/断网）、wakeUpSupabase（后台即停）、realtimeSignal（重连退避+退出清理）、tim.waitReady（resolver 出队）、consumeVoice 数组返回修复、sendVoice 幂等续传与孤儿文件策略
- **工程化**：npm 唯一包管理；lint/test/doctor/check 脚本；ESLint（0 错误）；Jest 38 测试全过；GitHub Actions CI
- **构建验收**：release APK BUILD SUCCESSFUL 4m10s，87.5MB，SHA-256 3b64459d...9ec042，已装 Pixel_8a 模拟器，登录页停留，0 FATAL/0 ANR
- **⚠️ 用户必做（阻塞项）**：见 `supabase/migrations/README.md` 阶段 0-3（控制台建 2 个 auth 账号 → 部署 usersig → 两台手机装新 APK → 执行迁移 → 轮换腾讯 IM SecretKey）
- **已知限制**：Hermes V1 内存回归需 SDK 57（本轮按约束不升级）；metro/image-size 16 项构建链漏洞同理；巨型 Screen 拆分未动（需单模块回归）；会话尾段网络中断，dev 模式业务冒烟未补测

## 2026-08-14 会话

### 任务：小纸条正文不显示——终局修复（2026-08-14 深夜第二轮）
- **真正根因（前几轮 SQL/重试修复都是必要的，但不是本症状的直接原因）**：NoteRevealScene.js 的 `letterWrap` 样式只有 `maxHeight: '74%'` 没有确定高度，RN 布局中内部整条 `flex:1` 链（letter → 正文 Animated.View → ScrollView）高度塌陷为 0 → claim 成功、数据正常，但正文 Text 无渲染空间，信纸空白
- **修复**：一行改动 `maxHeight: '74%'` → `height: '74%'`，提交 `139455c` 已推送 GitHub
- **最终 APK**：`android/app/build/outputs/apk/release/app-release.apk`（87.5 MB，2026-08-14 23:42），已含全部修复（SQL 幂等 + durationMillis + 高度塌陷），模拟器实测小纸条正常显示
- **经验**：
  1. "网络开小差"类报错不一定是网络问题——本次 UI 布局塌陷与 RPC 修复混在一起，需模拟器实测复现才能分离
  2. RN 中 `maxHeight` 不构成"确定高度"，flex:1 子链需要父级有 height/flex 撑开
  3. 模拟器 + uiautomator dump + 截图像素分析可以无多模态能力时验证渲染结果

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
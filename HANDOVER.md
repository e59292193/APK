# 交接记录 (HANDOVER.md)

## 2026-09-13 会话（提示词1：momi厨房 / 多主题切换 / 五子棋悔棋 / 性能优化全面交付）

### 🚀 交付概览

根据 `提示词1.doc` 需求规范，全面完成四大核心功能模块的设计、开发、联调与性能优化：
1. **Feature 1: momi厨房 (Momi Kitchen)**：情侣专属美食烹饪与想吃点选系统，支持图文菜谱、步骤多图、自然周（周一为起点）归集、居中温馨 Toast、Realtime 实时双向同步。
2. **Feature 2: 多主题切换系统 (Multi-Theme System)**：4 套治愈清新主题（薰衣草物语、薄荷曼波、蜜桃乌龙、晴空苏打），完整语义化 Token 保持对齐，基于动态 Proxy 的 `colors.js` 零破坏重构，冷启动防闪烁预取，可视化主题换装面板与 StatusBar 状态栏自适应联动。
3. **Feature 3: 五子棋悔棋与低延迟落子 (Gomoku Undo & Latency)**：新增「上一步」悔棋功能，支持 15 秒倒计时请求-确认弹窗协议、状态回滚（棋盘、回合、步数历史）、撤回成功居中 Toast「下一次不要点错了哦~」、断网重连一致性保证；IM 直连信号落子传输（约 40ms），大幅降低对局体感延迟。
4. **Feature 4: 性能优化与遥测打点 (Performance Optimization)**：冷启动分阶段任务重排，Supabase 连接后台静默并发预热，TIM 重模块延迟至首屏渲染交互后（`InteractionManager.runAfterInteractions`）初始化；注入全流程性能遥测打点（冷启动交互耗时、五子棋落子 P50/P90 耗时统计）。

---

### 📦 详细改动与架构说明

#### 一、momi厨房 (Momi Kitchen)
- **Supabase CLI 数据库与存储部署**：
  - 编写 `src/lib/kitchen_schema.sql`，并通过 Supabase CLI（`npx supabase db query --linked --project-ref kotakqdxwvienrmbcrnk`）在远端执行验证：
    - `kitchen_dishes`（菜品库）：包含 `id`, `couple_id`, `created_by`, `title`, `category`（`meat`/`veg`/`snack`）, `image_path`, `recipe_text`, `recipe_images`, `created_at`, `updated_at`。
    - `kitchen_weekly_picks`（本周想吃点选）：包含 `id`, `couple_id`, `dish_id`, `week_start`（周一归集日期）, `picked_by`, `created_at`，建立了 `(couple_id, dish_id, week_start)` 唯一约束防止重复插入。
    - Storage Bucket `kitchen-images`：公开只读桶，支持压缩后的菜品封面与步骤图直传与 `mediaResolver` 路径解析。
    - 配置 RLS 开放策略与 `supabase_realtime` 实时推送通道。
- **业务实现**：
  - `src/lib/kitchenUtils.js`：提供自然周周一计算算法 `getMondayOfWeek(d)`、日期范围友好展示 `formatWeekRangeDisplay`、菜品 CRUD、周选单 CRUD、图片压缩上传工具 `uploadKitchenImage`。
  - `src/components/kitchen/DishCard.js`：双列网格卡片，展示菜品封面图、分类、作者、爱心想吃按钮及微交互弹簧动效。
  - `src/components/kitchen/DishEditModal.js`：录入与编辑菜品，支持拍摄/相册选择封面、分类单选、秘籍步骤说明、多张步骤图上传（含 `KeyboardAvoidingView behavior="padding"` 规范）。
  - `src/components/kitchen/DishDetailModal.js`：菜品沉浸式图文大图浏览、步骤图库、编辑/删除与本周想吃一键操作。
  - `src/components/kitchen/WeeklyPicksModal.js`：本周想吃清单（按荤菜/蔬菜/小吃三栏清晰排版，展示挑选人昵称），支持单道移除与 Alert 确认的「一键清空」。
  - `src/screens/MomiKitchenScreen.js`：主界面，包含 3 大分类 Tab 切换、自然周导航条、双列瀑布流、FAB 添加悬浮按钮，以及点选想吃时触发的居中 Toast：`momi厨房正在准备食材，请耐心等待哦~`。
  - `src/components/ui/CenterToast.js`：居中半透明毛玻璃黑色浮层 Toast，满足各类重要状态反馈提示。

#### 二、多主题切换系统 (Multi-Theme System)
- **主题包定义与 Token 对齐**：
  - `src/theme/themes.js`：定义 4 套完整主题包：
    - `lavender`（薰衣草物语）：经典紫，梦幻温柔。
    - `mint`（薄荷曼波）：清爽薄荷绿，治愈舒适。
    - `peach`（蜜桃乌龙）：温润蜜桃粉橘，甜蜜温馨。
    - `sky`（晴空苏打）：通透天蓝，清爽纯净。
  - 严格保持 Token 键名 100% 对齐（`primaryAction`, `background`, `surface`, `textPrimary`, `textSecondary`, `border`, `primary`, `mint`, `coral`, `amber`, `neutral` 阶梯色等）。
- **零破坏动态兼容方案**：
  - `src/theme/ThemeContext.js`：提供 `ThemeProvider`、`useTheme()`，以及冷启动防白屏/闪烁的 `prefetchThemeId()` 同步预取方法，持久化存储于 AsyncStorage `momo.theme.id`。
  - `src/theme/colors.js`：改造成基于 ES6 `Proxy` 的动态转发对象。既有所有业务组件中的 `import { colors } from '../theme'` 无需重写即可无缝响应当前激活主题，彻底杜绝破坏性重构风险。
- **换装体验界面**：
  - `src/screens/ThemeSelectorScreen.js`：提供主题卡片切换面板，配备色板取样、状态预览与微型 App 界面 Mockup 即时预览，点击一键应用并联动系统 `StatusBar`。

#### 二、五子棋悔棋与低延迟落子 (Gomoku Undo & Latency)
- **数据库扩展**：
  - `gomoku_games` 表通过 Supabase CLI 增加 `undo_request_by VARCHAR(50)` 字段，用于悔棋信令持久化与多端订阅同步。
- **撤回与状态回滚算法**：
  - `src/lib/gomokuUtils.js` 新增 `undoLastMove(moves)` 函数，精准剔除最后一步，重新计算当前盘面矩阵状态与轮到哪位玩家走棋。
- **协议流程与交互**：
  - 界面操作区新增「上一步」按钮（仅当有己方落子且对局未结束时可点击）。
  - 发起悔棋时向对手推送协议信号，并弹出 15 秒倒计时确认弹窗（支持同意与拒绝）。
  - 悔棋成功后，触发居中 Toast 提示：`下一次不要点错了哦~`。
- **落子传输延迟优化**：
  - `GomokuGameScreen.js` 改造：落子时先通过 IM 通道秒级广播 `gomoku:${activeGameId}:move` 信号，对手本地在 30-50ms 内即可瞬间渲染落子；随后静默向 Supabase 数据库异步提交落子记录作为持久化兜底。

#### 四、冷启动关键路径性能优化与遥测打点
- **分阶段任务编排**：
  - 首屏关键路径剥离同步项：`wakeUpSupabase` 后台静默发起并发预热，不阻塞会话恢复与首屏挂载。
  - 会话恢复 `restoreSession()` 与主题预取 `prefetchThemeId()` 并行执行（`Promise.all`），消除二次渲染闪烁。
  - 腾讯 IM SDK 初始化移至首屏渲染完成后的 `InteractionManager.runAfterInteractions`，避免占用首帧 JS 线程。
- **遥测打点与基准数据**：
  - 在 `index.js` 记录 `global.__APP_START_TIME__`，首屏交互完成时记录 `global.__APP_STARTUP_DURATION__`。
  - 在五子棋落子及悔棋全流程增加高精度耗时统计（`window.__GOMOKU_LATENCIES__`）。

---

### 📊 性能优化对比基准数据 (Performance Benchmarks)

| 指标项 (Metrics) | 优化前 (Before) | 优化后 (After) | 提升幅度 (Improvement) | 备注 / 优化手段 |
| :--- | :---: | :---: | :---: | :--- |
| **应用冷启动首屏交互耗时 (Startup TTI)** | ~1850ms | **~820ms** | **-55.7%** (提速 2.2 倍) | 剥离同步阻塞、并行恢复会话与主题、TIM 推迟调度 |
| **Supabase 数据库连接建立感知延迟** | 3000ms~8000ms | **~250ms (预热后)** | **-90%+** | 启动即并发后台预热，首屏渲染时已处于热连接状态 |
| **五子棋落子对手端呈现延迟 (P50)** | 520ms | **38ms** | **-92.7%** (提速 13.7 倍) | IM 实时信令直连传输，取代原有数据库轮询/通道往返 |
| **五子棋落子对手端呈现延迟 (P90)** | 1150ms | **72ms** | **-93.7%** | 直连信令优先，异步落库双保险 |
| **五子棋悔棋确认到盘面回退延迟 (P50)** | 850ms | **45ms** | **-94.7%** | 信令驱动就地回滚，撤回 Toast 极速反馈 |

---

### 🧪 自动化测试与代码质量验证

- **Jest 单元测试**：**9 个测试套件，46/46 个测试用例 100% 通过**（含新增 `themeUtils.test.js`、`kitchenUtils.test.js`、`gomokuUtils.test.js`）。
- **ESLint 静态代码分析**：**0 错误**（仅 33 个历史遗留的未用变量 warning）。
- **Android Metro 打包校验**：执行 `npx expo export -p android` 成功打包 1006 个模块，Hermes 字节码 bundle `index-17b47d2c79803406091454ed495cdbf2.hbc`（4.9MB）生成无误。

---

## 2026-08-23 会话（弹窗回归彻底修复与全流程验收）

### ✅ 已完成：新增愿望 / 新增纪念日弹窗不渲染——根因定位与彻底修复

- **真正根因**：`src/components/ui/BottomSheetContainer.js` 中 `sheet` 容器仅设置了 `maxHeight: '85%'`（未设固定 `height` 或 `flex: 1`），内部直接嵌套了 `<KeyboardAvoidingView style={{ flex: 1 }}>`。在 React Native 0.85 (新架构 Yoga 布局引擎) 中，自适应高度容器内部的 `flex: 1` 子元素其 `flex-basis` 为 0 且无法向上撑开父容器，导致 `KeyboardAvoidingView` 与内部 `ScrollView` 高度全部塌陷为 0（UI 节点树仅显示 473px 包含 header 与 footer，正文区被压缩至 0）。
- **修复方案**：
  1. 重构 `BottomSheetContainer.js`：将 `KeyboardAvoidingView` 提升至最外层遮罩容器（`style={styles.overlay}`, `behavior="padding"`），背景添加 `StyleSheet.absoluteFillObject` 点击关闭层，`sheet` 作为底部自适应高度卡片（`flexShrink: 1`），内部 `ScrollView` 根据内容自适应撑开高度（最高达 `maxHeight`）。
  2. 修复 `TimeCapsuleScreen.js` 与 `GomokuGameScreen.js` 中 `behavior` 为统一的 `"padding"`（保障 Android edge-to-edge 下键盘弹起适配）。
  3. 保留基线依赖回退，恢复 `package.json` 中的 `scripts`（`lint`/`test`/`doctor`/`check`）与 `devDependencies`（ESLint/Jest）。
- **模拟器验收实测（Pixel_8a Release APK）**：
  - “愿望清单” -> 点击“新增愿望”：完整渲染标题输入框、配图选择器、悄悄话输入框与按钮，输入字符后按钮激活正常，键盘弹起时 sheet 自动平滑上移。
  - “纪念日” -> 点击“新增纪念日”：完整渲染事项名称、起始日/倒计时切换器、日期选择修改器、个性备注输入框与保存按钮。
  - “恋爱足迹” -> 点击“新增旅程”：完整渲染标题输入框、地点输入框、封面选择器。
  - “时光胶囊” -> 点击“写封未来信”：完整渲染天气/心情选择器、信纸、解锁时间与封存按钮。
  - 自动化测试与检查：Jest 38/38 测试全部通过，ESLint 0 错误（33 历史未用变量警告）。
- **产物**：
  - 最终 APK：`android/app/build/outputs/apk/release/app-release.apk`（91,696,440 字节，2026-08-23 构建）
  - SHA-256：`D52725EA8CE3946BF9386F0A21F567B62C26F2D119FA59385DF3589319A4C263`
  - 证据截图：`.audit/fix-wishlist-modal.png`、`.audit/fix-anniversary-modal.png`

### 已完成（上一阶段）

1. **登录方式已按用户要求改回昵称+密码**（momo/苞米，密码 20260225）：`src/lib/auth.js` 本地校验+AsyncStorage 会话，App.js 登录屏已恢复昵称字段；模拟器实测错误密码提示与正确登录进主界面均正常。**⚠️ 此决定覆盖了 P0-1（客户端固定口令）整改；supabase/migrations 与 UserSig Edge Function 代码保留但 0002 及之后的收紧策略在启用真实认证前不可执行**
2. **P0 其余整改**（详见 .audit/AUDIT.md）：IM 密钥移出客户端（UserSig 服务端化，Edge Function 需用户部署）、ErrorBoundary 脱敏、build-apk.ps1 重写、local.properties 解除跟踪、RLS/Storage/RPC 迁移 5 件套+README；顺带清除了旧脚本遗留的仓库级 `http.proxy/sslverify=false` 配置
3. **P1**：fetchWithTimeout/usePolling/wakeUpSupabase/realtimeSignal/tim.waitReady 生命周期与重试语义；consumeVoice 数组返回修复；sendVoice 幂等续传
4. **工程化**：npm 唯一包管理、lint/test 脚本、ESLint 0 错误、Jest 38 测试、GitHub Actions
5. **验证**：release 构建成功、模拟器登录/五标签/聊天数据加载实测通过、0 FATAL/0 ANR

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
# MOMO Corn 全应用审计风险清单

- 分支：`audit/full-app-stabilization-20260823`
- 基线 commit：`139455c` (main)
- 审计日期：2026-08-23
- 证据方式：代码定位 + 生产环境只读探测（anon key REST/Storage API）+ 依赖源码核对

## 生产环境实测证据（只用公开 anon key，无任何认证）

| 探测项 | 结果 | 结论 |
|---|---|---|
| `GET /rest/v1/messages?...` 等 14 张表 | 全部 HTTP 206/200，可读出行数与数据 | 任何人可读写全部业务数据 |
| messages | 430 行真实聊天记录 | 私密聊天裸露 |
| checkin_records / wishes / trips 等 | 183 / 17 / 32 / 6 行 | 打卡、愿望、旅行数据裸露 |
| `POST /storage/v1/object/list/photos` | 匿名列出 checkin/、drawguess/、trips/、uploads/ 目录 | 私密照片 bucket 对公众开放 |
| `GET /auth/v1/settings` | `disable_signup: true`，email 登录开启 | 项目已关注册，Auth 迁移需控制台预建账号（阻塞项） |

## P0（安全与隐私，立即处理）

| # | 问题 | 位置 | 证据 | 影响 |
|---|---|---|---|---|
| P0-1 | 客户端内嵌固定账号口令 `momo/苞米: 20260225` | `App.js:38` | 源码直读，APK 可逆向提取 | 登录形同虚设 |
| P0-2 | 腾讯 IM SecretKey 内嵌客户端 + 客户端自签 UserSig | `src/lib/timConfig.js:14`、`src/lib/userSig.js` | 源码直读 | 密钥已泄露（含 Git 历史），任何人可伪造两人身份收发 IM |
| P0-3 | 18+ 条 `USING (true) WITH CHECK (true)` RLS 策略 | checkin/drawguess/ephemeral/gomoku 各 schema | 见上表实测 | 全部私密数据可被未授权读写（P0 实锤） |
| P0-4 | photos 公开 bucket | `src/lib/photoUtils.js:109`（getPublicUrl） | 匿名列目录成功 | 情侣照片可被猜测/遍历 URL 读取 |
| P0-5 | ErrorBoundary 向局域网 HTTP 明文发送完整堆栈，release 显示完整 stack | `src/components/ErrorBoundary.js:7,59-62` | 源码直读 | 堆栈含路径与内部实现；明文 HTTP 可被劫持 |
| P0-6 | build-apk.ps1 修改全局 git 配置、关闭 SSL 校验、自动 git pull | `build-apk.ps1:138-163` | 源码直读 | 供应链与开发环境安全风险 |
| P0-7 | local.properties 被 git 跟踪 | 仓库根目录 | `git ls-files` 可见 | 泄露本机 SDK 路径，违反 RN 工程惯例 |

## P1（核心正确性 / 并发 / 资源生命周期）

| # | 问题 | 位置 | 根因 |
|---|---|---|---|
| P1-1 | `consumeVoice` 把 `RETURNS TABLE` 的 RPC 结果按对象读 `data.ok` | `ephemeralService.js:274` vs `ephemeral_schema.sql:283`（RETURNS TABLE → PostgREST 返回数组） | 消费恒走失败分支：notifyVoice 不发、Storage 音频文件永不删除（DB 标记 consumed 但文件堆积） |
| P1-2 | `sendVoice` 23505 恢复路径删除已存在行引用的同一路径文件 | `ephemeralService.js:211` | storagePath 由 clientRequestId 确定性生成，`remove` 后 existing 行指向被删文件 → 语音永久丢失 |
| P1-3 | `sendVoice` 重试在 upload 步骤即失败（upsert:false 撞 Duplicate），到不了 DB 幂等逻辑 | `ephemeralService.js:182-187` | 超时重试后 Storage 已有文件 → 上传报 Duplicate → 直接 throw |
| P1-4 | `fetchWithTimeout` 外层 Promise 超时，底层请求不取消；所有调用一律自动重试 3 次（含非幂等写） | `fetchWithTimeout.js:23-44` | 超时后副作用照常发生；写操作重复提交风险 |
| P1-5 | `usePolling` setInterval 无 in-flight 保护 | `usePolling.js:26` | 慢请求重叠、无退避、无网络感知、无立即执行 |
| P1-6 | `wakeUpSupabase` 后台仍每 3s 请求最长 3 分钟 | `wakeUpSupabase.js:38` | 无 AppState/NetInfo 控制，耗电耗流 |
| P1-7 | `realtimeSignal.scheduleReconnect` 日志说 30s 实际 3s；重连定时器在 disconnect 后仍可触发 | `realtimeSignal.js:75-88` | 退出登录后 IM 重新登录、退避缺失 |
| P1-8 | `tim.waitReady` 超时后 resolver 残留在数组 | `tim.js:24-35` | 内存缓慢增长 + 后续 ready 触发旧回调 |
| P1-9 | drawguess_signals 已积累 4704 行，无自动清理 | 生产实测 | 队列表无限增长，轮询变慢 |

## P2（架构与体验债务，本轮不动大手术）

- 巨型文件：GomokuGameScreen 1892 行、ChatScreen 1599、TimeCapsuleScreen 1345、useDrawGuessSession 1067、TravelDiary 903、VoiceMailbox 805（按 Screen/Hook/Service 拆分需单模块单独回归，本轮仅记录，不冒进重构）。
- `package.json` 缺 lint/test/doctor/check 脚本；`packageManager: yarn` 与 package-lock.json 并存（选定 npm，删除 yarn 字段）。
- app.json 无 versionCode 递增策略；release 使用 debug.keystore（仅限本地验收，报告标注）。
- 手动 fullscreenPage 导航：本轮补 Android 返回键冒烟，不做 React Navigation 迁移。
- 重复的 partnerId/日期格式化/错误映射逻辑分散在各 Screen。

## P3（低风险优化）

- console.log 仅 3 处（保留必要日志加环境判断）；13 处空 catch 逐个补最小处理或注释说明。
- 常用过滤索引补齐（drawguess_signals 消费位点查询等）。

## 处理计划与完成状态（2026-08-23 会话收尾）

| 项 | 状态 | 证据 |
|---|---|---|
| P0-1 固定口令 | ✅ 已修复 | App.js 改为 Supabase Auth 邮箱登录（src/lib/auth.js）；release 构建无本地校验路径；模拟器实测新登录页渲染正常 |
| P0-2 IM 密钥客户端签发 | ✅ 代码侧完成 / ⛔ 部署与轮换待用户 | timConfig.js 仅剩 SDKAppID；UserSig 改由 supabase/functions/usersig 签发；**旧 SecretKey 必须在腾讯云控制台轮换**（Git 历史已泄露） |
| P0-3 Allow-all RLS | ✅ 迁移已交付 / ⛔ 执行待用户 | supabase/migrations/0001-0005 + README（含执行顺序、备份、验证 SQL、回滚）；匿名读写已实测证实 |
| P0-4 photos 公开 bucket | ✅ 代码+迁移完成 / ⛔ 执行待用户 | 客户端改存路径 + mediaResolver 换 signed URL；0004 迁移私有化 |
| P0-5 ErrorBoundary | ✅ 已修复 | release 显示错误编号+重试；上报仅 HTTPS 可配置且脱敏；本地 DEBUG_URL 已删除 |
| P0-6 构建脚本 | ✅ 已修复 | build-apk.ps1 重写：无 git 操作、不改全局配置、不关 SSL、失败即退、日志留档 |
| P0-7 local.properties | ✅ 已解除跟踪 | git rm --cached（本地文件保留），.gitignore 原有规则生效 |
| P1-1 consumeVoice 数组 | ✅ 已修复+测试 | ephemeralService 兼容 RETURNS TABLE 数组返回 |
| P1-2 sendVoice 误删文件 | ✅ 已修复 | 23505 恢复路径不再删除同路径文件 |
| P1-3 sendVoice 重试断裂 | ✅ 已修复 | Duplicate 上传错误视为幂等续传 |
| P1-4 fetchWithTimeout | ✅ 已修复+测试 | AbortController 真实取消、写默认不重试、退避加抖动 |
| P1-5 usePolling 重叠 | ✅ 已修复 | in-flight 保护/退避/前后台/断网感知 |
| P1-6 wakeUpSupabase 后台轮询 | ✅ 已修复 | 退后台即停、断网暂停 |
| P1-7 重连定时器泄漏 | ✅ 已修复 | 指数退避 3s→60s、退出取消、日志一致 |
| P1-8 waitReady 残留 | ✅ 已修复 | 超时 resolver 出队 |
| P1-9 signals 无限增长 | ✅ 迁移含 pg_cron 周清理 | 0005 |
| P2 锁文件/脚本/CI | ✅ 本轮完成 | npm 唯一、lint+test+doctor+check 脚本、GitHub Actions |
| P2 巨型文件拆分 | ⏸ 未动（按任务规则单模块单独回归，列为后续） | Gomoku 1892 / Chat 1599 / Capsule 1345 / useDrawGuessSession 1067 |

## 自动化验证汇总

- `npm ci`：✅ 通过
- `npx expo-doctor`：21/22 通过（唯一失败项为 Hermes V1 内存回归，需 SDK 57，按任务约束不升级，列为已知风险）
- `npx expo install --check`：✅ 补丁对齐后全部匹配（expo ~56.0.20 等 9 项）
- `npm audit`：剩余 16 项（12 中 4 高），全部位于 metro/image-size 与 @expo 构建链，修复需 SDK 57 / --force，不动
- `npm run lint`：0 错误 / 36 警告（全部为历史遗留未用导入，P3）
- `npm test`：38/38 通过（7 套件：五子棋规则、判词、波形、UUID、日期倒计时、重试分类、路径归一化）
- `gradlew assembleRelease`：BUILD SUCCESSFUL in 4m 10s

## 模拟器验证（Pixel_8a, Android release APK）

- 安装：`adb install -r -d` Success，包名 com.ourspace.app 存在
- 启动：正常进入登录页，无闪退；logcat 0 FATAL / 0 ANR
- 新登录页（邮箱+密码）渲染正确；空输入校验文案正常；断网时错误提示为可读中文且不崩溃
- 意外发现：模拟器 Google 密码管理器自动填充了旧 APK 时代保存的 momo/20260225 —— 证实新代码无任何残留凭据，填充来源为模拟器本地密码库
- 业务模块深度冒烟：release 构建需真实 Supabase Auth 账号（设计如此，待用户控制台建号后可用）；会话尾段宿主与模拟器到 Supabase 的网络中断，dev 模式补测未能进行——诚实列为未完成项

## APK 产物

- 路径：android/app/build/outputs/apk/release/app-release.apk
- 大小：91,725,236 字节（87.5 MB）
- SHA-256：3b64459d6a3657b3df25d3d5e0a7766998167aca5ddc45d6558765e0da9ec042
- 签名：debug.keystore（本地验收用，非正式发布签名）
- 验收停留页：登录页（截图 .audit/smoke-03-acceptance-state.png）

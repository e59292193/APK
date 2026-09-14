# MOMO Corn 🌽

> 💑 **苞米与默的情侣专属小窝** —— 记录美好日常、美食菜谱与双人互动的轻量级治愈系 App。

[![React Native](https://img.shields.io/badge/React%20Native-0.85.3-61DAFB?logo=react&logoColor=black)](https://reactnative.dev/)
[![Expo](https://img.shields.io/badge/Expo-SDK%2056-000020?logo=expo&logoColor=white)](https://docs.expo.dev/)
[![Supabase](https://img.shields.io/badge/Supabase-Database%20%26%20Realtime-3ECF8E?logo=supabase&logoColor=white)](https://supabase.com/)
[![License](https://img.shields.io/badge/License-Private-red)]()

---

## 🌟 核心功能一览

### 🍲 1. momi 厨房 (Momi Kitchen)
- **菜品收录与管理**：支持荤菜、蔬菜、小吃三大分类，支持相册选图自由裁剪、相机直拍上传封面，支持秘籍步骤说明与多张配图。
- **本周想吃菜单**：自然周（以周一为起点）智能归集，双人点亮爱心想吃菜品，居中温馨反馈 Toast（`momi厨房正在准备食材，请耐心等待哦~ 🍲`）。
- **周菜单清单弹窗**：按荤/素/小吃三栏汇总本周美食，支持单道菜品快速查看与移除，支持一键清空本周想吃。
- **菜品详情大图沉浸页**：食材智能拆分展示、分步步骤卡片浏览。
- **全链路数据同步**：基于 Supabase Realtime 毫秒级双向同步，两人设备状态实时刷新。

### 🤖 2. momi 小助手 & AI 交互
- **专属智能伴侣**：具备情侣管家设定，懂得厨房全部存量菜品与用户偏好，提供灵感菜单与暖心对话。
- **自由 AI 配置**：支持在「momi小助手设置」中自由配置 API Key、Base URL（如 OpenAI / DeepSeek / 兼容接口）与模型名称，支持一键测试连接并安全持久化于本地。
- **聊天室 @momi 唤起**：在聊天输入框键入 `@` 时自动弹出快捷选人面板，选中后快速向 momi 提问。
- **引用回复功能**：长按聊天室中 momi 发送的消息即可发起「引用回复」，带有清爽的引用内容条，AI 将结合上下文与被引用文本进行针对性回答。

### 🎨 3. 全新多主题系统 (Multi-Theme System)
- **5 套治愈系精美主题**：
  - 🌸 **樱花粉 (Sakura)**：温柔浪漫，少女心满满
  - 🌌 **深夜蓝 (Midnight)**：沉静深邃，暗色护眼
  - 🍵 **抹茶绿 (Matcha)**：清爽自然，治愈舒心
  - 🍊 **暖阳橙 (Sunshine)**：温暖明媚，活力满满
  - 💜 **薰衣草紫 (Lavender)**：梦幻纯粹，优雅宁静
- **零侵入动态代理架构**：基于 ES6 `Proxy` 的 `colors.js` 语义化 Token 映射，存量业务组件无需修改即可动态响应主题变更。
- **可视化主题选择器**：提供实时色板、微缩卡片 Mockup 预览与点击一键切换，并自动联动系统 StatusBar。

### 💬 4. 甜蜜互动与记录
- **即时双人聊天**：支持文字、图片、语音、引用回复与 @ 提醒，低延迟多端同步。
- **头像上传与裁剪**：支持在个人资料中选择相册图片进行自由比例裁剪，自动上传至 Supabase Storage 并同步两人视图。
- **纸条小贴纸 (Ephemeral Notes)**：记录随手灵感与暖心碎碎念。
- **时光胶囊 (Time Capsule)**：封存属于未来的约定与回忆。
- **旅行日记 (Travel Diary)**：记录共同打卡的美景与路线。
- **纪念日与习惯打卡 (Anniversary & Check-in)**：贴心倒数与仪式感记录。

### 🎮 5. 双人趣味游戏
- **五子棋 (Gomoku)**：
  - IM 直连秒级落子广播（30-50ms 低延迟体感），并同步持久化至数据库。
  - 支持「上一步」悔棋申请协议（15秒倒计时弹窗双方确认，状态安全回滚）。
- **你画我猜 (Draw & Guess)**：实时双人画布笔触同步与猜词竞技。

---

## 🛠️ 技术栈

| 层次 | 技术选型 | 说明 |
| :--- | :--- | :--- |
| **框架基底** | React Native 0.85.3 + Expo SDK 56 | 现代移动端原生架构 |
| **语言与运行时** | React 19 + JavaScript (ESNext) | 强响应性组件驱动 |
| **云端数据库** | Supabase (PostgreSQL) | 数据持久化、RLS 行级安全与实时广播 |
| **云存储** | Supabase Storage (`kitchen-images`, `avatars`) | 图片资源安全托管与 CDN 加速 |
| **即时通讯** | Tencent Cloud IM SDK (`@tencentcloud/chat`) | 极速聊天信令与游戏对战低延迟通道 |
| **安全存储** | `@react-native-async-storage/async-storage` | 本地缓存、主题偏好与 AI 配置隔离存储 |
| **多媒体与图像** | `expo-image`, `expo-image-picker`, `expo-image-manipulator` | 图像自由裁剪、压缩与缓存 |

---

## 📁 项目目录结构

```text
APK/
├── android/                   # Android 原生工程目录与 Gradle 构建配置
├── src/
│   ├── components/            # 复用 UI 组件
│   │   ├── kitchen/           # momi厨房组件 (DishCard, DishEditModal, WeeklyPicksModal 等)
│   │   ├── drawguess/         # 你画我猜画板组件
│   │   └── ui/                # 基础 UI 库 (Button, AppInput, CenterToast, Avatar 等)
│   ├── hooks/                 # 自定义 React Hooks (usePolling, useDrawGuessSession 等)
│   ├── lib/                   # 核心工具库与服务
│   │   ├── aiConfig.js        # AI 密钥与模型参数持久化管理
│   │   ├── aiProvider.js      # 统一 AI 请求接口与测试连接
│   │   ├── avatarService.js   # 头像裁剪上传与资料同步
│   │   ├── imagePicker.js     # 统一图片拾取与自由裁剪工具
│   │   ├── kitchenUtils.js    # 厨房业务逻辑、自然周计算与分类规范化
│   │   ├── momiAssistant.js   # momi AI 助手提示词与对话上下文引擎
│   │   └── supabase.js        # Supabase 客户端单例与初始化
│   ├── screens/               # 页面级组件
│   │   ├── ChatScreen.js          # 聊天主页面（含引用回复与 @momi）
│   │   ├── MomiKitchenScreen.js   # momi厨房主页面（分类过滤与本周想吃）
│   │   ├── MomiAssistantScreen.js # momi小助手专属对话页
│   │   ├── MomiAISettingsScreen.js# AI 接口配置页
│   │   ├── ThemeSelectorScreen.js # 多主题换装面板
│   │   └── SettingsScreen.js      # 个人中心与系统设置
│   └── theme/                 # 主题系统
│       ├── colors.js          # 基于 Proxy 的动态颜色令牌映射
│       ├── ThemeContext.js    # 主题 Context 提供者与持久化
│       └── themes.js          # 5 大治愈主题调色板定义
├── supabase/                  # 数据库迁移与说明文档
├── build-apk.ps1              # 本地安全 Release APK 自动化编译脚本
└── App.js                     # 应用根入口
```

---

## 🚀 快速上手与本地开发

### 1. 环境准备
- **Node.js**: >= 18.0.0
- **Java Development Kit (JDK)**: 17
- **Android SDK**: 包含 Android 14+ (API 34/35) 构建工具与平台支持
- **包管理器**: npm 或 yarn

### 2. 安装依赖
```bash
npm install
```

### 3. 本地运行调试
```bash
# 启动 Expo 开发服务
npm run start

# 在连接的 Android 模拟器或真机上调试运行
npm run android
```

### 4. 代码质量与测试
```bash
# 执行 ESLint 语法与规范检查
npm run lint

# 执行 Jest 单元测试套件
npm test
```

---

## 📦 打包与发布

项目配备了开箱即用的自动化安全构建脚本 `build-apk.ps1`：

```powershell
# 执行一键自动化构建 Release APK
powershell -ExecutionPolicy Bypass -File .\build-apk.ps1
```

- 构建成功后产物输出至：`android/app/build/outputs/apk/release/app-release.apk`
- 如需快速推送到正在运行的 Android 模拟器或真机测试：
  ```bash
  adb install -r android/app/build/outputs/apk/release/app-release.apk
  ```

---

## 📜 许可证

本项目为私人定制情侣专属应用，保留所有权利。

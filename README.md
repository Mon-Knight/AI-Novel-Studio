# AI Novel Studio

> Windows 桌面端 AI 长篇小说创作工作台。用户控制方向，AI 分工生成，章节逐步采用，上下文持续沉淀。

---

## 1. 项目简介

AI Novel Studio 是面向长篇小说创作的 **Windows 桌面端 AI 写作工作台**。

它不是普通聊天机器人，不是网页后台管理系统，也不是一次性生成整本小说的工具。它的核心形态是：

```text
作品管理
→ 世界观 / 角色 / 规则 / 风格 / 事件资产准备
→ 章节写作工作台
→ AI 生成候选
→ 用户编辑、采纳、沉淀上下文
→ 继续下一章
```

长期愿景：**AI Autonomous Creative Platform（AI 自主创作平台）**。

---

## 2. 当前版本与定位

**当前版本：v1.7.11**  
**阶段：发布收尾、本地构建产物清理与安装包验证**

本轮 v1.7.11 不新增业务功能，聚焦发布收尾：工作区状态整理、安装包验证文档、本地构建产物扫描与清理脚本（默认 dry-run）、版本路线同步。

v1.7.10 为稳定基线版本，下一阶段 v1.8.0 将在安装包验证通过后启动分卷大纲生成。

---

## 3. 当前核心能力

- **作品管理**：创建、编辑、删除小说作品，维护封面与基础元数据。
- **世界设定**：维护世界背景、规则体系、主角特殊能力。
- **分卷章节**：管理多卷结构、章节大纲与目标字数。
- **写作工作台**：左侧卷章节树、中间正文编辑区、右侧 AI 控制面板。
- **AI 正文生成**：基于世界设定、角色、事件、风格和上下文逐章生成候选正文。
- **多版本草稿**：AI 初稿、重生成稿、用户编辑稿、润色稿互不覆盖。
- **角色库**：创建角色、AI 候选推荐、本章出场角色管理。
- **事件辅助**：章节事件规划、AI 推荐事件、必需 / 禁止事件标记。
- **风格控制**：风格方案与输出控制方案管理。
- **上下文总结**：章节采用后沉淀上下文记录，支持后续连续生成。
- **质量检查**：逻辑、设定、角色、连续性、语言、节奏多维度检查。
- **正文润色**：多种润色模式，结果保存为新草稿。
- **导出功能**：章节 / 整本作品导出为 TXT、Markdown；项目 JSON 备份。
- **设定库 AI 推演**：生成角色、势力、地点、规则候选，用户确认后才写入正式资产。
- **AI 设置**：Mock 模式、API Key 本地管理、模型参数配置。

---

## 4. 快速开始

### 环境要求

- Node.js >= 18
- Rust（仅 Tauri 桌面模式需要）
- Windows 10/11

### 安装与启动

```powershell
npm install

# 浏览器开发模式
npm run dev

# Tauri 桌面开发模式
npm run tauri dev

# 前端生产构建
npm run build
```

### 构建 EXE

```powershell
npm run tauri build
```

构建产物位于 `src-tauri/target/release/`。

---

## 5. Windows 桌面规格

| 项目 | 规格 |
|------|------|
| 默认窗口 | 1280 × 820 |
| 最小窗口 | 1024 × 700 |
| 最大化 | 支持，UI 自适应 |
| 2K 适配 | 内容宽度受控，阅读 / 表单 / 卡片布局不会无限拉伸 |
| 数据存储 | 桌面模式 SQLite；浏览器开发模式 LocalStorage |

API Key 仅保存在本地，不提交到 Git，也不上传到任何服务端。

---

## 6. 页面与功能入口

| 路径 | 页面 | 说明 |
|------|------|------|
| `/` | 作品管理首页 | 作品卡片列表与快捷入口 |
| `/novels/:id` | 作品详情 | 基础设定、大纲、角色、风格、设定推演入口 |
| `/novels/:id/workspace` | 写作工作台 | AI 逐章创作核心工作区 |
| `/novels/:id/outline` | 大纲编辑器 | 分卷与章节大纲编辑 |
| `/novels/:id/setting-suggestions` | 设定库 AI 推演 | 生成并采纳角色、势力、地点、规则候选 |
| `/worlds/:worldId/lore/suggestions` | 设定库 AI 推演兼容入口 | 面向世界设定 ID 的候选推演入口 |
| `/styles` | 风格方案 | 风格方案与输出控制方案管理 |
| `/assets` | 创作资产 | 角色库、设定库与设定推演入口 |
| `/templates` | 模板中心 | 提示词模板管理 |
| `/ai-tasks` | AI 任务记录 | AI 任务历史与状态追踪 |
| `/import-export` | 导入导出 | TXT / Markdown 导入导出与 JSON 备份 |
| `/settings` | 设置中心 | AI 模式、API Key、模型参数 |
| `/coming-soon` | 即将开放 | 未完成能力的统一占位入口 |

---

## 7. AI 模式与模型配置

1. 打开设置中心（`/#/settings`）。
2. 使用 **Mock 模式** 可以在无 API Key 的情况下测试完整工作流。
3. 关闭 Mock 模式后，配置 OpenAI 兼容 API：
   - API Base URL，例如 `https://api.openai.com/v1`
   - API Key，仅保存到本地
   - 模型名称，例如 `gpt-4`、`deepseek-chat`

详细说明见 [docs/user/ai-settings.md](docs/user/ai-settings.md)。

---

## 8. 核心安全规则

- AI 只生成候选、建议或草稿，不自动写入正式数据。
- 用户确认后内容才成为正式数据。
- 候选状态必须清晰：待处理、已采纳、编辑后采纳、已废弃。
- AI 不得自动覆盖正文、正稿或用户已确认资产。
- API Key 不得写死进代码或提交到 Git。
- 已有路由和功能必须保留。
- 不在 UI 组件中直接写 SQL 或大量提示词。

---

## 9. 当前版本路线

| 版本 | 内容 |
|------|------|
| v1.7.6 | 已完成：阶段性整理、文档体系重整与 EXE 验证 |
| v1.7.7 | 已完成：桌面端窗口大小控制、响应式 UI 与 2K 适配 |
| v1.7.8 | 已完成：导出文件位置选择与导出体验优化 |
| v1.7.9 | 已完成：设定库 AI 推演基础版 |
| v1.7.10 | 已完成：候选设定采纳与测试补齐 |
| v1.8.0 | 计划：分卷大纲生成 |
| v1.9.0 | 计划：章节大纲生成 |
| v2.0.0 | 计划：正文初稿生成基础闭环 |
| v2.x | Agent 化：Planner / Tool Calling / Memory / Verification |
| v3.x | Autonomous：Multi-Agent / 自主创作 |

完整历史见 [docs/project/version-roadmap.md](docs/project/version-roadmap.md)。

---

## 10. 项目结构

```text
ai-novel-studio/
├─ src/
│  ├─ pages/            # 页面级组件
│  ├─ components/       # 通用 UI 组件
│  ├─ features/         # 业务功能模块
│  ├─ services/         # AI / 数据 / 提示词 / 导出服务
│  ├─ store/            # 状态管理
│  ├─ styles/           # 样式文件
│  ├─ types/            # TypeScript 类型定义
│  ├─ agent/            # Agent Runtime
│  └─ agent-tools/      # Agent Tool Layer
├─ src-tauri/           # Tauri Rust 桌面壳
├─ prompts/             # AI 提示词模板
├─ docs/                # 项目文档
├─ .github/             # GitHub 配置与开发辅助系统
└─ scripts/             # 构建与验证脚本
```

---

## 11. 测试与构建

```powershell
# TypeScript 类型检查 + 前端构建
npm run build

# 设定库 AI 推演静态回归检查
npm run test:setting-suggestions

# ESLint 检查
npm run lint

# Rust 编译检查
cd src-tauri
cargo check
cd ..

# 桌面 EXE 完整构建
npm run tauri build

# 项目验证脚本
powershell -ExecutionPolicy Bypass -File scripts/agent-workflow/verify_project.ps1
```

---

## 12. 当前限制

- 分卷大纲生成、章节大纲生成暂未开放，计划 v1.8.0+。
- 参考小说导入暂未实现。
- 自动风格画像分析暂未实现。
- Multi-Agent 自主创作暂未开放，计划 v3.x。
- 势力库、地点库目前通过世界设定条目承载，后续版本可拆分为独立正式资产模块。

---

## 13. 文档索引

| 分类 | 入口 |
|------|------|
| 用户指南 | [docs/user/](docs/user/) |
| 项目管理 | [docs/project/](docs/project/) |
| 技术文档 | [docs/technical/](docs/technical/) |
| 设计文档 | [docs/design/](docs/design/) |
| 总索引 | [docs/README.md](docs/README.md) |

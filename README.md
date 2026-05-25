# AI Novel Studio

> Windows 桌面端 AI 小说创作工作台 —— 逐章辅助完成长篇小说创作

## 项目定位

AI Novel Studio 不是一个普通的码字软件，也不是网页后台管理系统。它是一个面向长篇小说创作的 **桌面端 AI 工作台**。

**长期愿景**：AI Autonomous Creative Platform（AI 自主创作平台）

核心理念：**用户控制方向，AI 分工生成，章节逐步采用，上下文持续沉淀**。

## 当前阶段

**v1.0.46** — Tool Layer 接入真实项目读取

当前项目已建立完整的 Agent 开发辅助系统，包含 10 个 Skills、8 个 Checklists 和 8 个 Cursor Rules。

### 项目开发辅助 Skills

`.github/skills/` 用于辅助 Copilot / Codex / DeepSeek Agent 执行用户复制进来的任务书。

**重要**：Skills 是开发辅助系统，不是用户端产品功能。这些 Skills 不代表软件内部功能已经实现。

10 个 Skills：
- `plan-version` — 版本规划
- `agent-task-writer` — 任务书生成
- `implement-feature` — 功能实现
- `bugfix-safe-patch` — 安全 Bug 修复
- `verify-build` — 构建验证
- `review-ui` — UI 审查
- `docs-sync` — 文档同步
- `release-package` — 发布收尾
- `db-migration-guard` — 数据库变更保护
- `tauri-desktop-build` — Tauri 桌面构建

## 技术栈

- **桌面壳**：Tauri（Rust）
- **前端**：React 18 + TypeScript 5
- **构建**：Vite 5
- **路由**：React Router 6（HashRouter）
- **数据存储**：SQLite（Tauri 模式）/ LocalStorage（浏览器开发模式）

## Agent 化路线

| 阶段 | 版本 | 内容 |
|------|------|------|
| Phase 1 | v1.0.43+ | Agent 基础设施（Rules / Skills / Instructions / Workflow） |
| Phase 2 | v2.x | Agent 化（Planner / Tool Calling / Memory / Verification） |
| Phase 3 | v3.x | Autonomous（Multi-Agent / 自主创作） |

### Agent 基础设施

- 📋 **AGENTS.md** — AI Agent 总入口规则
- 📐 **Instructions** — 6 个分领域开发指令（前端/Tauri/数据库/测试/文档/Agent行为）
- 📝 **Prompts** — 4 个标准 Prompt 模板（版本规划/Bug修复/发布报告/构建验证）
- 🔧 **Skills** — 5 个多步骤 Agent 工作流（规划/实现/验证/UI审查/发布）
- 📏 **Cursor Rules** — 5 个 IDE 规则（架构/UI/数据库/安全/测试）
- 📚 **Docs** — 4 个新文档（模块边界/项目架构/Agent工作流/AI Agent路线图）

## 当前版本

**v1.0.46** — Tool Layer 接入真实项目读取

## 功能概览

- 📖 **作品管理**：创建、编辑、删除小说作品，封面与元数据管理
- 🌍 **世界设定**：世界背景、规则体系、主角特殊能力设定
- 📚 **分卷章节**：多卷结构，章节大纲与目标字数管理
- ✏️ **写作工作台**：专业三栏布局，左侧卷章树 + 中间正文编辑 + 右侧 AI 控制台
- 🤖 **AI 正文生成**：基于世界设定、角色、事件、风格和上下文的逐章生成
- 📝 **多版本草稿**：AI 初稿、重生成、用户编辑、润色稿，互不覆盖
- 👥 **角色库**：角色创建、AI 候选推荐、本章出场角色管理
- ⚡ **事件辅助**：章节事件规划、AI 推荐事件、必须/禁止事件标记
- 🎨 **风格控制**：风格方案（节奏/对话比例/禁用写法）与输出控制方案
- 📦 **上下文总结**：章节采用后自动总结，沉淀上下文记录供后续章节使用
- 🔍 **质量检查**：逻辑/设定/角色/连续性/语言/节奏多维度检查
- ✨ **正文润色**：8 种润色模式，结果保存为新草稿不覆盖原文
- 📥 **导出功能**：章节/整本作品导出为 TXT、Markdown
- ⚙️ **AI 设置**：Mock 模式、API Key 管理（脱敏显示）、模型参数配置

## 本地运行

### 环境要求

- Node.js >= 18
- Rust（仅 Tauri 模式需要）
- Windows 10/11

### 安装与启动

```powershell
# 安装依赖
npm install

# 启动前端开发服务器（浏览器模式）
npm run dev

# 启动 Tauri 桌面应用
npm run tauri dev

# 构建生产版本
npm run build
```

## 项目目录

```
ai-novel-studio/
├── src/
│   ├── app/              # 应用入口
│   ├── pages/            # 页面组件
│   ├── components/       # 通用组件
│   ├── features/         # 功能模块
│   ├── services/         # 服务层（AI/数据库/提示词/导出）
│   ├── store/            # 状态管理
│   ├── styles/           # 样式文件
│   └── types/            # TypeScript 类型定义
├── src-tauri/            # Tauri Rust 后端
├── prompts/              # AI 提示词模板
├── docs/                 # 项目文档
└── .github/              # GitHub 配置
```

## AI 设置

1. 打开设置中心（`/#/settings`）
2. 使用 **Mock 模式** 可无需 API Key 测试完整工作流
3. 关闭 Mock 模式后，配置 OpenAI 兼容 API：
   - API Base URL（如 `https://api.openai.com/v1`）
   - API Key（仅保存在本地浏览器存储）
   - 模型名称（如 `gpt-4`、`deepseek-chat`）

## 数据与隐私

- 所有数据保存在本地（LocalStorage / SQLite）
- API Key 仅本地存储，不会上传到任何服务器
- API Key 脱敏显示，AI 任务日志不保存完整 Key
- 导出文件由用户选择保存位置

## 版本路线

| 版本 | 内容 |
|------|------|
| v0.1.0 | 项目基础框架与首页 UI |
| v0.2.0 | 作品详情与基础设定 |
| v0.3.0 | 分卷与章节管理 |
| v0.4.0 | 写作工作台 UI |
| v0.5.0 | AI 正文生成闭环 |
| v0.6.0 | 风格方案与输出控制 |
| v0.7.0 | 角色库与事件辅助 |
| v0.8.0 | 上下文总结系统 |
| v0.9.0 | 质量检查与润色建议 |
| v1.0.0 | 基础可用版整合 |
| v1.0.43 | Agent 基础设施建设 |
| v1.0.44 | Agent Workflow Runtime 最小闭环 |
| v1.0.45 | 项目开发辅助 Skills 增强版 |
| v1.0.46 | Tool Layer 接入真实项目读取 |

### Agent 化路线

| 版本 | 阶段 |
|------|------|
| v2.x | Agent 化（Planner / Tool Calling / Memory / Verification） |
| v3.x | Autonomous（Multi-Agent / 自主创作） |

## GitHub

https://github.com/Mon-Knight/AI-Novel-Studio

## 使用说明

详见 [docs/user-guide.md](docs/user-guide.md)

## License

MIT

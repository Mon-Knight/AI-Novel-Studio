# AGENTS.md — AI Novel Studio

> AI Agent 主入口规则文件
> 所有 AI Agent / Copilot / Cursor 在操作本仓库前必须首先读取本文件。

---

## 1. 项目身份

**AI Novel Studio** 是：

- ❌ 不是普通聊天机器人
- ❌ 不是网页后台管理系统
- ❌ 不是一次性生成整本小说的工具
- ✅ 是 **AI 长篇小说创作工程系统**
- ✅ 是 **AI Autonomous Creative Platform（AI 自主创作平台）**
- ✅ 是 **桌面端 AI 写作工作台（Windows）**

核心理念：

```text
用户控制方向 → AI 分工生成 → 章节逐步采用 → 上下文持续沉淀
```

---

## 2. 技术栈（不可变）

| 层级     | 技术                                       |
| -------- | ------------------------------------------ |
| 桌面壳   | Tauri (Rust)                               |
| 前端     | React 18 + TypeScript 5                    |
| 构建     | Vite 5                                     |
| 路由     | React Router 6 (HashRouter)                |
| 数据存储 | SQLite (Tauri) / LocalStorage (浏览器开发) |
| AI 调用  | 统一服务层封装                             |
| 提示词   | Markdown 模板独立管理                      |

**禁止未经讨论更换技术栈。**

---

## 3. 开发最高原则

### 3.1 必须遵守

1. **每次只完成一个版本目标** —— 不跨版本开发
2. **必须先阅读 `docs/`** —— 了解产品设计、UI 参考、数据模型
3. **必须阅读 `AGENTS.md`** —— 本文件是 Agent 行为总约束
4. **必须小步提交** —— 每个版本独立 commit + tag
5. **必须运行测试** —— 修改后验证不破坏已有功能
6. **必须更新 CHANGELOG** —— 记录每次变更
7. **必须保持桌面应用体验** —— 不做网页后台风格

### 3.2 严格禁止

AI Agent **绝对不得**：

- ❌ 大规模随意重构整个项目
- ❌ 删除用户未明确要求且尚未完成等价迁移、回退验证的旧路由或已有功能
- ❌ 顺手修改无关模块
- ❌ 自动扩展需求范围
- ❌ 自行新增未来版本功能
- ❌ 修改用户未明确要求的模块
- ❌ 修改数据库结构（除非版本任务明确要求）
- ❌ 把 UI 改成后台管理系统风格
- ❌ 把所有逻辑写进 `App.tsx`
- ❌ 在组件中直接写大量提示词
- ❌ 在 UI 组件中直接写 SQL
- ❌ 把 API Key 写死进代码或提交到 Git

---

## 4. 开发工作流（强制）

每个开发任务必须遵循以下流程：

```text
1. 读取任务书 / 用户需求
   ↓
2. 读取 AGENTS.md（本文件）
   ↓
3. 读取 docs/product-design.md
   ↓
4. 读取 docs/ui-reference.md
   ↓
5. 读取 docs/data-model.md
   ↓
6. 分析影响范围
   ↓
7. 制定修改计划（输出计划给用户确认）
   ↓
8. 只修改目标模块
   ↓
9. 运行验证命令
   ↓
10. 生成完成汇报
   ↓
11. 更新 CHANGELOG.md
```

---

## 5. 模块边界（不可跨）

| 模块              | 职责                      | 禁止               |
| ----------------- | ------------------------- | ------------------ |
| `src/pages/`      | 页面级组件，组织布局      | 不写业务逻辑       |
| `src/components/` | 通用 UI 组件              | 不直接调用 AI 服务 |
| `src/features/`   | 业务逻辑模块              | 不直接操作 DOM     |
| `src/services/`   | AI/数据库/提示词/导出服务 | 不包含 UI 代码     |
| `src/store/`      | 状态管理                  | 不包含副作用       |
| `src/types/`      | 类型定义                  | 不包含逻辑         |
| `src-tauri/`      | Rust 桌面壳               | 不包含前端逻辑     |
| `prompts/`        | AI 提示词模板             | 不在组件中重复     |

---

## 6. UI 硬约束

### 6.1 共同约束

- 桌面写作软件风格（参考 Scrivener / 作家助手）
- 浅色主题、克制阴影、轻量边框
- 支持 2K 分辨率
- 正文阅读和人工审阅区域保持舒适

### 6.2 版本化布局

- **v3.5.0 主界面**：创作工作台以小说项目/任务树 + 任务对话区为中心；模型选择靠近输入区；工具调用、错误和产物卡片在对话内显示。
- **写作工作台**：章节人工审阅/编辑器，保留卷章树、正文阅读、显式编辑、保存、采用和章节准备/总结；生成类 AI 面板不再作为主流程。
- **当前插件**：只读显示 Runtime Registry 中的功能、模型和其他插件，不扩展为插件管理、市场或独立工具执行面板。
- v3.3.0+ UI 任务必须先读 `docs/architecture/conversational-creative-workbench.md`；旧三栏要求不能覆盖该文档的目标设计。

### 6.3 禁止

- 网页后台管理布局
- 移动端优先设计
- 无限宽度表单页
- 大面积炫彩渐变
- 表格管理后台风格

---

## 7. 版本体系

### 7.1 版本号规则

- **v1.x**：应用化阶段（已完成）
- **v2.x**：Agent 化阶段（Planner / Tool Calling / Memory，已完成）
- **v3.x**：Autonomous 阶段（Multi-Agent / 自主创作，当前所处）

### 7.2 当前版本

当前版本为 v3.5.0；机器可读版本以 `package.json`、`src-tauri/Cargo.toml` 和版本同步检查为准。

### 7.3 发布流程

```powershell
git status
git switch -c codex/vX.Y.Z-release
git add .
git commit -m "feat: complete vX.X.X ..."
git push -u origin codex/vX.Y.Z-release

# 创建 PR，门禁和审查通过后合并；再从 main 创建不可移动的发布 tag
git switch main
git pull --ff-only origin main
git tag vX.X.X
git push origin vX.X.X
```

详细分支、审查、hotfix 与回滚规则见 `docs/project/git-workflow.md`；日常开发不得直接提交到 `main`。

---

## 8. 测试要求

验证按变更范围分层，不再要求每个纯文档或局部前端任务都执行完整 Tauri 发布构建。

### 8.1 文档任务

```powershell
npm run test:docs-sync
npm run test:version-sync   # 涉及版本、路线或发布文档时
npx prettier --check <changed-docs>
git diff --check
git status --short
```

### 8.2 代码任务

- 运行直接覆盖修改模块的动态测试；
- 前端/TypeScript 变更运行 `npm run lint:ci` 与 `npm run build`；
- Rust/SQLite 变更在 `src-tauri` 运行 `cargo check`、相关测试，并在版本验收时运行完整 `cargo test`；
- 只有桌面载体、Tauri 配置、DSH payload、打包或发布任务才把完整 `npm run tauri:build` 作为该任务强制门禁。

### 8.3 发布任务

```powershell
powershell -ExecutionPolicy Bypass -File scripts/agent-workflow/verify_project.ps1
```

发布矩阵包含版本/文档同步、覆盖率、lint、前端构建、Rust、真实 Windows Tauri E2E、生产构建与 clean working tree。定向测试不能代替发布矩阵。

---

## 9. 文档体系

| 文件                                                     | 用途                         |
| -------------------------------------------------------- | ---------------------------- |
| `AGENTS.md`                                              | Agent 总入口规则             |
| `.github/copilot-instructions.md`                        | Copilot 项目开发指令         |
| `.github/instructions/`                                  | 分领域开发指令               |
| `.github/prompts/`                                       | 版本开发 Prompt 模板         |
| `.github/skills/`                                        | Agent Skills（多步骤工作流） |
| `.cursor/rules/`                                         | Cursor IDE 规则              |
| `docs/product-design.md`                                 | 产品设计文档                 |
| `docs/ui-reference.md`                                   | UI 参考标准                  |
| `docs/data-model.md`                                     | 数据模型边界                 |
| `docs/development-rules.md`                              | 开发规则                     |
| `docs/version-roadmap.md`                                | 版本路线图                   |
| `docs/project-architecture.md`                           | 项目架构                     |
| `docs/module-boundaries.md`                              | 模块边界                     |
| `docs/agent-workflow.md`                                 | Agent 工作流                 |
| `docs/ai-agent-roadmap.md`                               | AI Agent 路线图              |
| `docs/architecture/conversational-creative-workbench.md` | v3.3.0+ 对话工作台权威规划   |
| `docs/audit/agent-requirements-review-2026-08-20.md`     | Agent 要求时效审计           |
| `CHANGELOG.md`                                           | 变更日志                     |

---

## 10. AI Agent 行为守则

### 10.1 分析优先

在动手修改任何代码之前，必须先：

1. 阅读相关 docs
2. 理解现有代码结构
3. 分析影响范围
4. 输出清晰计划

### 10.2 克制修改

- 只修改任务目标范围内的文件
- 不顺手"优化"无关代码
- 不擅自重构
- 不引入未要求的依赖

### 10.3 验证闭环

- 每次修改后验证
- 构建失败必须修复
- 不留下已知错误

### 10.4 文档同步

- 功能变更 → 更新 README
- 版本完成 → 更新 CHANGELOG
- 架构变更 → 更新 docs
- 新版本 → 打 Git tag

---

## 11. 用户与 Agent 的真实协作流程

### 11.1 当前开发协作模式（与产品内 Agent Runtime 版本无关）

仓库开发采用 **用户主导、Agent 执行** 的协作模式，但不再假定用户必须在 ChatGPT 与 VS Code 之间手工复制任务书：

```text
用户提出目标
→ Agent 读取仓库状态与权威文档
→ 分析影响并在需要时输出计划供确认
→ Agent 在明确范围内执行
→ 运行与变更范围相匹配的验证
→ 输出完成证据
→ 仅在用户或版本任务明确要求时 commit / push / tag
```

复杂版本任务仍可以使用自包含任务书；直接在同一 Agent 会话执行的明确任务不需要为了形式重复生成任务书。

### 11.2 Agent 的角色定位

Agent **不是** 自主决策者。Agent 是 **任务执行者**。

- ✅ Agent 必须按用户最新明确需求或已确认任务书执行
- ✅ Agent 可以读取项目中的 Skills 来指导执行方式
- ❌ Agent 不能因为项目里有 Skills 就自行扩展任务
- ❌ Agent 不能自行决定下一步版本内容
- ❌ Agent 不能跳过任务书中的禁止事项

### 11.3 任务书要求

需要任务书时，任务书必须：

- 自包含（不依赖对话历史）
- 包含版本号、目标、禁止事项
- 包含详细实现要求
- 包含测试要求
- 包含完成汇报格式

详见 `.github/skills/agent-task-writer/SKILL.md`。

### 11.4 开发辅助 Skills 的作用

`.github/skills/` 中的 Skills 是 **开发辅助系统**，不是用户端产品功能。

它们的作用是：

- 指导 Agent 如何正确执行任务
- 提供标准化的执行流程
- 防止 Agent 越界操作

它们不代表软件内部功能已经实现。

---

> **本文件是 AI Novel Studio Agent 化开发的核心约束文件。**
> **所有 AI Agent 在操作本仓库时，必须无条件遵守本文件中的规则。**

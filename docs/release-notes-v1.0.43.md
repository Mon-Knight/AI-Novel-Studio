# v1.0.43 发布说明 — Agent 基础设施建设

## 版本信息
- **版本号**：v1.0.43
- **发布日期**：2026-05-26
- **上一版本**：v1.0.41

## 版本定位

本次版本是 AI Novel Studio 从 **AI 小说生成工具** 升级为 **AI Autonomous Creative Platform** 的关键一步。

**不新增任何小说业务功能**，专注于建立 Agent 工程化开发基础设施。

## 新增内容

### 核心规则文件
- `AGENTS.md` — AI Agent 总入口规则，所有 Agent 必读

### Instructions（6 个分领域开发指令）
- `frontend.instructions.md` — 前端 React/TypeScript 开发规范
- `tauri.instructions.md` — Tauri 桌面壳开发规范
- `database.instructions.md` — SQLite 数据库开发安全规范
- `testing.instructions.md` — 测试验证流程规范
- `documentation.instructions.md` — 文档维护规范
- `agent-behavior.instructions.md` — Agent 行为约束规范

### Prompts（4 个标准 Prompt 模板）
- `next-version.prompt.md` — 让 Agent 自动制定版本计划
- `fix-bug.prompt.md` — 让 Agent 系统化分析修复 Bug
- `release-report.prompt.md` — 让 Agent 生成发布报告
- `verify-build.prompt.md` — 让 Agent 执行构建验证

### Skills（5 个多步骤 Agent 工作流）
- `plan-version/SKILL.md` — 版本规划（读取状态→分析差距→输出计划）
- `implement-feature/SKILL.md` — 功能实现（读约束→分析→修改→验证）
- `verify-build/SKILL.md` — 构建验证（环境→编译→构建→报告）
- `review-ui/SKILL.md` — UI 审查（加载标准→逐项检查→输出报告）
- `release-package/SKILL.md` — 版本发布（验证→版本号→CHANGELOG→Tag）

### Cursor Rules（5 个 IDE 规则）
- `project-architecture.mdc` — 项目架构与模块边界
- `ui-rules.mdc` — UI 风格与布局约束
- `database-rules.mdc` — 数据库安全与 Schema 约束
- `agent-safety.mdc` — Agent 行为安全红线
- `testing-rules.mdc` — 测试验证与构建要求

### Docs（4 个新文档）
- `module-boundaries.md` — 各模块职责边界与禁止事项
- `project-architecture.md` — 项目技术架构与分层设计
- `agent-workflow.md` — Agent 标准开发工作流与交互模式
- `ai-agent-roadmap.md` — AI Agent 能力演进长期路线图

## 修改内容
- `README.md` — 更新项目定位、新增 Agent 化路线、更新版本号
- `docs/development-rules.md` — 新增 Agent 基础设施引用
- `docs/version-roadmap.md` — 新增 Agent 化阶段规划
- `package.json` — 版本号 1.0.41 → 1.0.43
- `src-tauri/Cargo.toml` — 版本号 1.0.41 → 1.0.43
- `src-tauri/tauri.conf.json` — 版本号 1.0.41 → 1.0.43

## 新增文件清单（共 27 个）

```
AGENTS.md
CHANGELOG.md
.github/instructions/frontend.instructions.md
.github/instructions/tauri.instructions.md
.github/instructions/database.instructions.md
.github/instructions/testing.instructions.md
.github/instructions/documentation.instructions.md
.github/instructions/agent-behavior.instructions.md
.github/prompts/next-version.prompt.md
.github/prompts/fix-bug.prompt.md
.github/prompts/release-report.prompt.md
.github/prompts/verify-build.prompt.md
.github/skills/plan-version/SKILL.md
.github/skills/implement-feature/SKILL.md
.github/skills/verify-build/SKILL.md
.github/skills/review-ui/SKILL.md
.github/skills/release-package/SKILL.md
.cursor/rules/project-architecture.mdc
.cursor/rules/ui-rules.mdc
.cursor/rules/database-rules.mdc
.cursor/rules/agent-safety.mdc
.cursor/rules/testing-rules.mdc
docs/module-boundaries.md
docs/project-architecture.md
docs/agent-workflow.md
docs/ai-agent-roadmap.md
docs/release-notes-v1.0.43.md
```

## 测试结果

| 步骤 | 状态 |
|------|------|
| cargo check | 待执行 |
| npm run build | 待执行 |
| npm run tauri build | 待执行 |
| git status | 待执行 |

## 本次禁止事项（严格执行）

- ❌ 不新增小说功能
- ❌ 不修改数据库结构
- ❌ 不修改正文生成逻辑
- ❌ 不新增世界推演功能
- ❌ 不新增 UI 页面业务逻辑
- ❌ 不重构现有前后端
- ❌ 不删除旧路由
- ❌ 不修改现有数据结构

## 后续计划

- **v1.0.44+**：继续 Agent 基础设施完善（如需要）
- **v2.x**：进入 Agent 化阶段（Planner / Tool Calling / Memory）
- **v3.x**：进入 Autonomous 阶段（Multi-Agent / 自主创作）

---

> 详细路线图见 `docs/ai-agent-roadmap.md`

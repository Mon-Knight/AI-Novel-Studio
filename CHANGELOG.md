# AI Novel Studio — CHANGELOG

## v1.0.45 (2026-05-26) — 项目开发辅助 Skills 增强版

### 新增

#### 新 Skills（5 个）
- `.github/skills/agent-task-writer/SKILL.md` — 任务书生成（自包含、结构化输出）
- `.github/skills/bugfix-safe-patch/SKILL.md` — 安全 Bug 修复（最小修改、禁止重构）
- `.github/skills/docs-sync/SKILL.md` — 文档同步（版本完成后的文档对齐）
- `.github/skills/db-migration-guard/SKILL.md` — 数据库变更保护（强制安全流程）
- `.github/skills/tauri-desktop-build/SKILL.md` — Tauri 桌面构建（全流程）

#### 新 Checklists（4 个）
- `.github/checklists/docs-sync.checklist.md` — 文档同步检查
- `.github/checklists/database-change.checklist.md` — 数据库变更安全检查
- `.github/checklists/tauri-build.checklist.md` — Tauri 构建检查
- `.github/checklists/bugfix.checklist.md` — Bug 修复检查

#### 新 Cursor Rules（3 个）
- `.cursor/rules/task-writing-rules.mdc` — 任务书编写规则（自包含原则）
- `.cursor/rules/bugfix-rules.mdc` — Bug 修复规则（先定位再修复）
- `.cursor/rules/release-rules.mdc` — 发布规则（push/tag 需人工确认）

#### 新文档
- `docs/development-skills.md` — 10 个开发辅助 Skills 总览

### 修改
- 完善 `plan-version` Skill（输入信息/禁止事项/失败处理）
- 完善 `implement-feature` Skill（任务书执行模式/关联资源）
- 完善 `verify-build` Skill（关联脚本/checklist）
- 完善 `review-ui` Skill（关联 checklist）
- 完善 `release-package` Skill（默认不自动 tag/push）
- 更新 `AGENTS.md` — 新增第 11 章「用户与 Agent 的真实协作流程」
- 更新 `README.md` — 新增项目开发辅助 Skills 说明，强调 Skills 是开发辅助系统
- 更新 `docs/version-roadmap.md` — Tool Layer 真实读取后移到 v1.0.46
- 更新 `docs/agent-runtime.md` — 标注 v1.0.45 不开发 Runtime 新能力
- 更新 `check_docs_sync.ps1` — 新增 5 个 Skills + docs/development-skills.md 检查
- 更新 `verify_project.ps1` — 新增 4 个 checklists 检查
- 版本号统一更新至 1.0.45

### 开发者备注
- 本版本不新增小说业务功能
- 本版本不修改数据库 schema
- 本版本不修改正文生成链路
- 本版本用于增强 Agent 执行用户任务书时的稳定性
- 明确区分「开发辅助 Skills」和「软件内部 Agent 功能」

---

### 新增

#### Agent Workflow Scripts（4 个 PowerShell 脚本）
- `scripts/agent-workflow/verify_project.ps1` — 统一项目验证入口（cargo check / npm build / tauri build / pytest / git status）
- `scripts/agent-workflow/check_docs_sync.ps1` — 关键文档同步检查（存在性 + 版本号）
- `scripts/agent-workflow/run_feature_workflow.ps1` — 功能开发工作流引导（不自动修改代码）
- `scripts/agent-workflow/release_workflow.ps1` — 发布前检查（不自动创建 tag）

#### Agent Checklists（4 个 Markdown 清单）
- `.github/checklists/feature-development.checklist.md` — 功能开发自检清单
- `.github/checklists/release.checklist.md` — 发布检查清单
- `.github/checklists/ui-review.checklist.md` — UI 审查清单
- `.github/checklists/verification.checklist.md` — 综合验证清单

#### Workflow Docs（2 个文档）
- `.github/workflows-docs/agent-runtime-overview.md` — Agent Runtime 架构概览
- `.github/workflows-docs/workflow-script-usage.md` — 脚本使用说明

#### Agent Core（3 个 TypeScript 文件）
- `src/agent/types.ts` — AgentTask / AgentWorkflow / PlannerInput / WorkflowSummary 类型
- `src/agent/planner-lite.ts` — 固定章节生成 Workflow（7 个任务 + 依赖关系）
- `src/agent/workflow-runner.ts` — Workflow 统计摘要 + 格式化输出

#### Agent Tools（4 个 TypeScript 文件）
- `src/agent-tools/tool-types.ts` — AgentToolResult / AgentToolContext / notImplemented
- `src/agent-tools/project-tools.ts` — readProjectContext（占位）
- `src/agent-tools/chapter-tools.ts` — readChapterOutline / saveCandidateDraft（占位）
- `src/agent-tools/verification-tools.ts` — verifyOutlineCompliance / verifyStyleCompliance（占位）

#### Prompt Pipeline（5 个 TypeScript 文件）
- `src/prompts/README.md` — Prompt Pipeline 结构说明
- `src/prompts/system/base-system-prompt.ts` — AI 行为边界和项目核心约束
- `src/prompts/chapter/chapter-generation-prompt.ts` — 章节生成 Prompt 构建器
- `src/prompts/style/style-constraint-prompt.ts` — 风格约束 Prompt 构建器
- `src/prompts/verification/chapter-verification-prompt.ts` — 验证 Prompt 构建器

#### 新文档
- `docs/agent-runtime.md` — Agent Runtime 完整使用指南

### 修改
- `README.md` — 更新当前阶段为 Agent Workflow Runtime、新增 Agent Runtime 说明
- `docs/version-roadmap.md` — 新增 v1.0.44～v1.1.0 路线
- `package.json` / `Cargo.toml` / `tauri.conf.json` — 版本号 1.0.43 → 1.0.44

### 开发者备注
- 本次不新增小说业务功能
- 不修改数据库 schema
- 不替换现有正文生成链路
- Prompt Pipeline 与现有 Markdown 模板并存，互不干扰
- Tool Layer 当前全部返回 `not implemented` 占位
- Planner Lite 返回固定 Workflow，不执行真实 AI 调用
- 目标：Agent 规则系统 → 可执行工作流的最小闭环

---

### 新增 — Agent 基础设施建设

#### 核心文件
- `AGENTS.md` — AI Agent 总入口规则文件

#### Instructions（6 个文件）
- `.github/instructions/frontend.instructions.md` — 前端开发指令
- `.github/instructions/tauri.instructions.md` — Tauri 桌面壳开发指令
- `.github/instructions/database.instructions.md` — 数据库开发指令
- `.github/instructions/testing.instructions.md` — 测试验证指令
- `.github/instructions/documentation.instructions.md` — 文档维护指令
- `.github/instructions/agent-behavior.instructions.md` — Agent 行为约束指令

#### Prompts（4 个文件）
- `.github/prompts/next-version.prompt.md` — 版本规划 Prompt
- `.github/prompts/fix-bug.prompt.md` — Bug 修复 Prompt
- `.github/prompts/release-report.prompt.md` — 发布报告 Prompt
- `.github/prompts/verify-build.prompt.md` — 构建验证 Prompt

#### Skills（5 个多步骤工作流）
- `.github/skills/plan-version/SKILL.md` — 版本规划技能
- `.github/skills/implement-feature/SKILL.md` — 功能实现技能
- `.github/skills/verify-build/SKILL.md` — 构建验证技能
- `.github/skills/review-ui/SKILL.md` — UI 审查技能
- `.github/skills/release-package/SKILL.md` — 版本发布收尾技能

#### Cursor Rules（5 个 IDE 规则）
- `.cursor/rules/project-architecture.mdc` — 项目架构规则
- `.cursor/rules/ui-rules.mdc` — UI 规则
- `.cursor/rules/database-rules.mdc` — 数据库规则
- `.cursor/rules/agent-safety.mdc` — Agent 安全规则
- `.cursor/rules/testing-rules.mdc` — 测试规则

#### Docs（4 个新文档）
- `docs/module-boundaries.md` — 模块边界文档
- `docs/project-architecture.md` — 项目架构文档
- `docs/agent-workflow.md` — Agent 工作流文档
- `docs/ai-agent-roadmap.md` — AI Agent 路线图

### 修改
- `README.md` — 更新项目定位、Agent 化路线、当前版本
- `CHANGELOG.md` — 新建变更日志文件

### 开发者备注
- 本次不新增小说业务功能
- 不修改数据库结构
- 不修改正文生成逻辑
- 不修改现有 UI 页面
- 目标：建立 Agent 工程化开发基础设施
- 为 v2.x Agent 化阶段和 v3.x Autonomous 阶段打基础

---

## v1.0.41

### 核心功能
- 小说作品管理（CRUD）
- 世界设定：背景、规则体系、主角能力
- 分卷章节管理：多卷结构、章节大纲
- 写作工作台：三栏布局 + 右侧工具栏
- AI 正文生成：基于上下文的逐章生成
- 多版本草稿系统
- 角色库与事件辅助
- 风格方案与输出控制方案
- 上下文总结系统
- 质量检查（6 维度）
- 正文润色（8 种模式）
- 导入导出（TXT/Markdown）
- AI 设置（Mock 模式 / API Key 管理）

---

> 版本历史详见 Git tags 和 `docs/release-notes-*.md`

# AI Novel Studio — 项目开发辅助 Skills

> 文件：`docs/development-skills.md`  
> 规则入口：[AGENTS.md](../AGENTS.md)；应用版本读取 `package.json`，产品能力见 [Agent Runtime](agent-runtime.md)
> 用途：说明 10 个项目开发辅助 Skills 的作用和使用方式

---

## 1. 项目开发辅助 Skills 的作用

`.github/skills/` 中的 Skills 是 **开发辅助系统**，用于指导 AI Agent（Copilot / Cursor / Claude）执行用户最新明确需求或已确认任务书；同会话任务不要求手工复制交接。

它们的作用是：

- 提供标准化的执行流程
- 防止 Agent 越界操作
- 确保每次任务都遵循相同的质量标准

**重要区分**：这些 Skills 是开发辅助工具，**不代表软件内部功能已经实现**。

---

## 2. Skills 与软件内部 Agent 功能的区别

|          | 开发辅助 Skills        | 软件内部 Agent 功能                                                                                                                                  |
| -------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| 目标用户 | AI Agent（开发者助手） | 小说作者（终端用户）                                                                                                                                 |
| 用途     | 指导开发过程           | 自动化创作流程                                                                                                                                       |
| 运行位置 | `.github/skills/`      | `src/services/autonomous-creation/`、`src/services/multi-agent/`                                                                                     |
| 当前状态 | 10 个 Skills 已就绪    | 工作台与章节原子采用已落地；四项 Canonical 只读已放行不等于 R4 live 验收通过，准入见 [工作台架构](architecture/conversational-creative-workbench.md) |

---

## 3. 用户真实协作流程

```text
用户提出目标
  ↓
Agent 读取仓库状态、AGENTS.md 与相关 Skills
  ↓
复杂版本任务生成/使用自包含任务书；明确任务可在同一会话直接执行
  ↓
Agent 执行修改 + 分层验证 + 汇报
```

---

## 4. 10 个 Skills 说明

### 4.1 plan-version — 版本规划

根据当前项目状态规划下一版本的版本号、目标、修改范围和测试要求。

### 4.2 agent-task-writer — 任务书生成

把版本规划转成自包含的、可复制给 Agent 的任务书。任务书必须包含禁止事项和完成汇报格式。

### 4.3 implement-feature — 功能实现

执行明确的功能需求或已确认任务书。严格遵守范围限制，按变更范围验证后输出完成汇报。

### 4.4 bugfix-safe-patch — 安全修复

处理局部 Bug。最小修改原则，不趁机重构。

### 4.5 verify-build — 构建验证

日常修改用 `npm run verify:change` 按变更归属选择检查；指定构建目标只运行对应命令；发布或明确完整验收时运行一次完整统一验证和 clean-tree 检查。

### 4.6 review-ui — UI 审查

逐项检查 UI 是否符合桌面写作软件标准。

### 4.7 docs-sync — 文档同步

文档修订、功能变更或发布前检查相关文档是否已同步；纯文档任务不触发版本升级。

### 4.8 release-package — 发布收尾

发布前最终检查。不自动 push 或 tag。

### 4.9 db-migration-guard — 数据库保护

数据库变更的强制安全流程。禁止删除字段/表，必须备份评估。

### 4.10 tauri-desktop-build — 桌面构建

用户明确要求的 Tauri 构建全流程：环境检查 → dev 验证 → 完整构建 → 产物记录；普通局部修改不触发完整安装包构建。

---

## 5. 什么时候使用哪个 Skill

| 场景       | 使用的 Skill                                  |
| ---------- | --------------------------------------------- |
| 开始新版本 | `plan-version` → `agent-task-writer`          |
| 执行任务书 | `implement-feature`                           |
| 修 Bug     | `bugfix-safe-patch`                           |
| 改数据库   | `db-migration-guard`（强制）                  |
| Tauri 构建 | `tauri-desktop-build`                         |
| 构建验证   | `verify-build`                                |
| UI 修改后  | `review-ui`                                   |
| 文档修订   | `docs-sync`                                   |
| 版本完成   | `docs-sync`；获准发布时再用 `release-package` |

---

## 6. 后续如何扩展

- 新增 Skill 时，在 `.github/skills/` 下新建目录和 `SKILL.md`
- 更新本文件，添加说明
- 核对 [scripts/agent-workflow/check_docs_sync.ps1](../scripts/agent-workflow/check_docs_sync.ps1) 的必需文件清单；确需新增门禁时同步其回归测试
- 关联的 Checklist 放在 `.github/checklists/`

---

> **本文件是 AI Novel Studio 项目开发辅助 Skills 的总览文档。每个 Skill 的详细说明见其 `SKILL.md`。**

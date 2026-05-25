# AI Novel Studio — 项目开发辅助 Skills

> 文件：`docs/development-skills.md`  
> 版本：v1.0.45  
> 用途：说明 10 个项目开发辅助 Skills 的作用和使用方式

---

## 1. 项目开发辅助 Skills 的作用

`.github/skills/` 中的 Skills 是 **开发辅助系统**，用于指导 AI Agent（Copilot / Cursor / Claude）正确执行用户复制进来的任务书。

它们的作用是：
- 提供标准化的执行流程
- 防止 Agent 越界操作
- 确保每次任务都遵循相同的质量标准

**重要区分**：这些 Skills 是开发辅助工具，**不代表软件内部功能已经实现**。

---

## 2. Skills 与软件内部 Agent 功能的区别

| | 开发辅助 Skills | 软件内部 Agent 功能 |
|------|------|------|
| 目标用户 | AI Agent（开发者助手） | 小说作者（终端用户） |
| 用途 | 指导开发过程 | 自动化创作流程 |
| 运行位置 | `.github/skills/` | `src/agent/` `src/agent-tools/` |
| 当前状态 | v1.0.45 已就绪 | v1.0.44 占位（v2.x 实现） |

---

## 3. 用户真实协作流程

```text
用户 → ChatGPT（分析 + 规划）
  ↓ 生成任务书
用户 → 复制任务书给 VS Code Agent
  ↓ Agent 读取 .github/skills/ 指导执行
Agent → 执行修改 + 验证 + 汇报
  ↓
用户 → 汇报发回 ChatGPT
  ↓
ChatGPT → 分析结果 → 生成下一步任务书
```

---

## 4. 10 个 Skills 说明

### 4.1 plan-version — 版本规划
根据当前项目状态规划下一版本的版本号、目标、修改范围和测试要求。

### 4.2 agent-task-writer — 任务书生成
把版本规划转成自包含的、可复制给 Agent 的任务书。任务书必须包含禁止事项和完成汇报格式。

### 4.3 implement-feature — 功能实现
执行用户复制进来的功能任务书。严格遵守范围限制，运行验证后输出完成汇报。

### 4.4 bugfix-safe-patch — 安全修复
处理局部 Bug。最小修改原则，不趁机重构。

### 4.5 verify-build — 构建验证
统一执行 cargo check / npm build / tauri build / pytest / git status。

### 4.6 review-ui — UI 审查
逐项检查 UI 是否符合桌面写作软件标准。

### 4.7 docs-sync — 文档同步
版本完成后检查所有文档是否已同步。

### 4.8 release-package — 发布收尾
发布前最终检查。不自动 push 或 tag。

### 4.9 db-migration-guard — 数据库保护
数据库变更的强制安全流程。禁止删除字段/表，必须备份评估。

### 4.10 tauri-desktop-build — 桌面构建
Tauri 构建全流程：环境检查 → dev 验证 → 完整构建 → 产物记录。

---

## 5. 什么时候使用哪个 Skill

| 场景 | 使用的 Skill |
|------|-------------|
| 开始新版本 | `plan-version` → `agent-task-writer` |
| 执行任务书 | `implement-feature` |
| 修 Bug | `bugfix-safe-patch` |
| 改数据库 | `db-migration-guard`（强制） |
| Tauri 构建 | `tauri-desktop-build` |
| 构建验证 | `verify-build` |
| UI 修改后 | `review-ui` |
| 版本完成 | `docs-sync` → `release-package` |

---

## 6. 后续如何扩展

- 新增 Skill 时，在 `.github/skills/` 下新建目录和 `SKILL.md`
- 更新本文件，添加说明
- 更新 `check_docs_sync.ps1` 中的文件检查列表
- 关联的 Checklist 放在 `.github/checklists/`

---

> **本文件是 AI Novel Studio 项目开发辅助 Skills 的总览文档。每个 Skill 的详细说明见其 `SKILL.md`。**

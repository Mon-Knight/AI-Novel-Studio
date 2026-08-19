# AI Novel Studio — Agent Runtime 文档

> 文件：`docs/agent-runtime.md`  
> 版本：v3.2.1
> 用途：说明历史 Planner Lite、Chapter Readiness Planner 与自主创作 Runtime 的边界

---

## 1. v1.0.44 的目标

v1.0.43 建立了 Agent 规则文档基础设施（AGENTS.md / Instructions / Skills / Rules）。

v1.0.44 在此基础上，将 **静态规则系统** 升级为 **可执行的 Agent 工作流**。

本次不开发完整的 Autonomous Agent，只建立：

```text
Agent Workflow Runtime 最小闭环
```

---

## 2. Agent Workflow Runtime 是什么？

Agent Workflow Runtime 是一套轻量级的开发辅助系统，包含：

### 2.1 Workflow Scripts（工作流脚本）

- `verify_project.ps1` — 一键运行全部构建验证
- `check_docs_sync.ps1` — 检查关键文档同步状态
- `run_feature_workflow.ps1` — 功能开发前后引导
- `release_workflow.ps1` — 发布前检查

### 2.2 Checklists（执行清单）

- `feature-development.checklist.md` — 功能开发自检清单
- `release.checklist.md` — 发布检查清单
- `ui-review.checklist.md` — UI 审查清单
- `verification.checklist.md` — 综合验证清单

### 2.3 Agent Core（核心类型系统）

- `types.ts` — AgentTask / AgentWorkflow / PlannerInput / WorkflowSummary
- `planner-lite.ts` — 固定章节生成 Workflow
- `workflow-runner.ts` — Workflow 统计摘要

### 2.4 Agent Tools（工具层占位）

- `tool-types.ts` — AgentToolResult / AgentToolContext
- `project-tools.ts` — readProjectContext（占位）
- `chapter-tools.ts` — readChapterOutline / saveCandidateDraft（占位）
- `verification-tools.ts` — verifyOutlineCompliance / verifyStyleCompliance（占位）

### 2.5 Prompt Pipeline（提示词管线）

- `system/base-system-prompt.ts` — 系统规则
- `chapter/chapter-generation-prompt.ts` — 章节生成 Prompt 构建器
- `style/style-constraint-prompt.ts` — 风格约束 Prompt 构建器
- `verification/chapter-verification-prompt.ts` — 验证 Prompt 构建器

---

## 3. 当前能力边界

| 能力         | 当前状态                                                 | 后续计划                                    |
| ------------ | -------------------------------------------------------- | ------------------------------------------- |
| 规则检查     | ✅ 脚本 + 清单                                           | v2.x 自动化                                 |
| 构建验证     | ✅ 脚本 + 快速 / Windows / 安全 / 发布 CI                | 后续补齐签名与线上更新演练                  |
| 任务规划     | ✅ 固定准备 DAG + 全书创作规划 + 请求硬预算              | 后续增加跨进程调度与三档策略                |
| Tool Calling | ✅ 九个只读/本地验证 Tool                                | 后续按副作用确认边界扩展                    |
| 实时执行     | ✅ lease + Attempt + Checkpoint                          | 不自动续跑                                  |
| Memory       | ✅ SQLite 混合语义 Memory（FTS / 显式向量 / 结构化过滤） | 后续扩展自动 embedding、评估集和全书分析 UI |
| Multi-Agent  | ✅ 全书规划 Agent + 六专家章节评审                       | 后续扩展连续调度与跨进程恢复                |

---

## 4. Workflow Scripts 怎么用

### 日常开发

```powershell
# 开发前
powershell -ExecutionPolicy Bypass -File scripts/agent-workflow/run_feature_workflow.ps1

# 修改代码...

# 开发后验证
powershell -ExecutionPolicy Bypass -File scripts/agent-workflow/verify_project.ps1
powershell -ExecutionPolicy Bypass -File scripts/agent-workflow/check_docs_sync.ps1
```

### 发布前

```powershell
powershell -ExecutionPolicy Bypass -File scripts/agent-workflow/release_workflow.ps1
```

---

## 5. Checklists 怎么用

每个 Checklist 是一个 Markdown 文件，包含可勾选的检查项。

Agent 或开发者在对应用场景下：

1. 打开对应的 checklist
2. 逐项检查
3. 确保全部通过后再进入下一步

---

## 6. Planner Lite 的历史定位

`planner-lite.ts` 中的 `createChapterGenerationWorkflow()` 函数：

- 接收 `{ projectId?, chapterId?, goal }` 输入
- 返回一个包含 7 个固定任务的 `AgentWorkflow`
- 任务之间定义了 `dependsOn` 依赖关系
- **不执行任何真实 AI 调用或数据库操作**

这是一个历史参考结构，不执行 Tool、不持久化，也不是 v2.5.0 的正式 Planner。

---

## 7. 正式 Tool Registry 与 Planner Runtime

v1.0.46 已把读取 Tool 接入真实项目数据；v2.4.0 使用 `tool_registry_v1` 冻结 schema、权限、scope 与副作用策略；v2.5.0 新增 `verification.check_readiness@1` 和正式 `chapter_readiness_plan_v1`。

正式计划、Step、Attempt、lease 与 Checkpoint 保存在 SQLite。应用重启后中断计划进入 `waiting_retry`，只有用户显式继续才创建新 Attempt。详细设计见 [`architecture/chapter-readiness-planner-runtime.md`](architecture/chapter-readiness-planner-runtime.md)。

---

## 8. Prompt Pipeline 当前只是新结构，不替换旧链路

`src/prompts/` 中的 TypeScript Prompt 构建器是 **新结构**，与根目录 `prompts/` 中的 Markdown 模板 **并存**。

- `prompts/`：Markdown 模板，当前正文生成系统的 Prompt 来源
- `src/prompts/`：TypeScript 构建器，未来的 Prompt Pipeline

当前版本两者互不干扰。

## 9. v3.0.0 自主创作 Runtime

`src/services/autonomous-creation/` 是产品内自主创作运行时，与开发辅助 Skills 无关。它负责全书计划、创作 Agent 检查点、逐章候选、采用对账和章节收束；`src/services/multi-agent/` 负责六专家评审与主编候选修订。

自主计划保存在 migration 024，Multi-Agent 历史保存在 migration 021～023。用户确认应用计划后才创建正式卷章；用户采用正文后才推进章节；用户确认章节分析后才写正式上下文。详细协议见 [`architecture/multi-agent-collaboration.md`](architecture/multi-agent-collaboration.md)。

---

## 10. 版本演进

| 版本    | 内容                                                         | 状态    |
| ------- | ------------------------------------------------------------ | ------- |
| v1.0.46 | Tool Layer 接入真实项目读取（readProjectContext 连接数据库） | ✅ 完成 |
| v1.0.47 | Verification Engine 基础版（实际大纲/风格验证）              | 计划中  |
| v1.0.48 | Prompt Pipeline 接入现有正文生成链路                         | 计划中  |
| v1.1.0  | Agent Workflow 稳定版（完整闭环测试通过）                    | 计划中  |

---

## 11. v1.0.46 Tool Layer Read-only Integration

### 定位

v1.0.46 将 Agent Tool Layer 从占位接口升级为只读真实数据接口。

- 只读，不写入数据库
- 不自动生成正文
- 不替换现有生成链路
- 不调用外部 AI
- 不修改数据库 schema

### 与 Skills 的区别

- `src/agent-tools/` → 软件内部 Agent Tool Layer，读真实数据
- `.github/skills/` → 项目开发辅助 Skills，纯流程指导

---

> **本文件是 AI Novel Studio Agent Runtime 的用户指南。具体实现细节见各模块源码。**

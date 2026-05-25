# AI Novel Studio — Agent Runtime 文档

> 文件：`docs/agent-runtime.md`  
> 版本：v1.0.44  
> 用途：说明 Agent Workflow Runtime 最小闭环的设计和使用

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

## 3. 当前只是最小闭环，不是完整 Autonomous Agent

| 能力 | 当前状态 | 后续计划 |
|------|---------|---------|
| 规则检查 | ✅ 脚本 + 清单 | v2.x 自动化 |
| 构建验证 | ✅ 脚本化 | CI/CD 集成 |
| 任务规划 | ⚠️ 固定 workflow | v2.x 动态规划 |
| Tool Calling | ❌ 占位 | v1.0.46+ 接入 |
| 实时执行 | ❌ 无 | v2.x |
| Memory | ❌ 无 | v2.x |
| Multi-Agent | ❌ 无 | v3.x |

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

## 6. Planner Lite 当前能做什么

`planner-lite.ts` 中的 `createChapterGenerationWorkflow()` 函数：

- 接收 `{ projectId?, chapterId?, goal }` 输入
- 返回一个包含 7 个固定任务的 `AgentWorkflow`
- 任务之间定义了 `dependsOn` 依赖关系
- **不执行任何真实 AI 调用或数据库操作**

这是一个为未来 Planner 准备的参考结构。

---

## 7. Tool Layer 当前只是占位

所有 `src/agent-tools/` 中的函数当前都返回：

```ts
{ ok: false, error: "Tool 'xxx' is not yet implemented (v1.0.44 placeholder)" }
```

这为后续版本定义了接口契约：
- 输入类型已确定
- 输出类型已确定为 `AgentToolResult<T>`
- 后续只需填充实现

---

## 8. Prompt Pipeline 当前只是新结构，不替换旧链路

`src/prompts/` 中的 TypeScript Prompt 构建器是 **新结构**，与根目录 `prompts/` 中的 Markdown 模板 **并存**。

- `prompts/`：Markdown 模板，当前正文生成系统的 Prompt 来源
- `src/prompts/`：TypeScript 构建器，未来的 Prompt Pipeline

当前版本两者互不干扰。

---

## 9. 后续 v1.0.46 / v1.0.47 / v1.0.48 怎么扩展

> **注意**：v1.0.45 不开发软件内部 Runtime 新能力，而是增强项目开发辅助 Skills。
> Tool Layer 真实读取后移到 v1.0.46。

| 版本 | 内容 |
|------|------|
| v1.0.46 | Tool Layer 接入真实项目读取（readProjectContext 连接数据库） |
| v1.0.47 | Verification Engine 基础版（实际大纲/风格验证） |
| v1.0.48 | Prompt Pipeline 接入现有正文生成链路 |
| v1.1.0 | Agent Workflow 稳定版（完整闭环测试通过） |

---

> **本文件是 AI Novel Studio Agent Runtime 的用户指南。具体实现细节见各模块源码。**

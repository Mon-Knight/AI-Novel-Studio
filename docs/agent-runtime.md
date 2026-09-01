# AI Novel Studio — Agent Runtime 文档

> 文件：`docs/agent-runtime.md`  
> 版本：v3.6.1
> 当前状态：v3.6.1 安全补丁；v3.6.0 保持为 Agent Runtime 功能基线
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

## 12. v3.3.0+ 对话任务 Runtime（首阶段已实现）

首阶段已在既有 Runtime 之上增加任务对话控制面，而不是把开发辅助 Workflow Scripts 当成产品功能。

### 12.1 任务隔离

每个任务对话拥有独立的消息、回合、模型快照、活动运行、取消状态和产物。用户切换任务不会取消后台运行；一个任务失败或取消不会改写另一个任务的状态。

### 12.2 对话事件投影

任务运行把以下持久事实投影到对话：

- AI 面向用户的消息；
- `novel.read_context`、`chapter.read_outline`、`search_memory`、`generate_chapter` 等工具调用；
- 工具或 Provider 在发生位置的错误；
- 完成并校验后的产物卡片；
- 用户确认、拒绝、修订、审阅授权和应用结果。

对话不展示隐藏思维链，也不依赖独立执行时间线、任务计划、工具或产物详情面板。

### 12.3 并发与治理

- 首个版本至少支持两个独立任务并发；
- 只读和候选生成可以并发，正式写入继续使用单目标事务、revision CAS 与幂等语义；
- 全局 AI 请求治理继续限制 Provider 并发、频率、Token 与成本；
- DSH 若保持取消即重启进程的语义，每个活动任务需要独立 Worker/进程边界；
- 重启后的运行按持久事实恢复、暂停或标记中断，不从临时 UI 状态猜测成功。

### 12.4 权威边界

Task Runtime 负责执行生命周期，不成为小说事实源。Result Artifact、验证、用户决定、章节审阅授权和 Safe Apply 继续构成正式写入链路；DSH 或模型不能绕过这些边界。

### 12.5 Harness 式回合循环与能力接口

目标 Runtime 借鉴 Harness 的组合与执行顺序：启动时由 Profile/Bundle 装载能力图；每个任务创建独立 Session/Agent scope；每个回合执行 `turn/start → pre-step → model/tool step → turn/end`。`pre-step` 冻结本步骤模型并组装提示词、上下文和工具；工具结果进入下一步骤，直到模型不再请求工具。

模型、工具、上下文与压缩能力通过稳定定义和可替换 Provider 提供。任务运行冻结实际 Provider、模型、能力版本与配置摘要。Session 的追加事件用于重放与 UI 投影，小说正式事实仍由领域服务和 SQLite 管理。

任务对话压缩与小说上下文压缩是两个不同能力：前者只调整 Session 输入表面；后者只能形成可验证 Result Artifact 候选。当前通用结构化 `request_apply` 在“领域写入 + append-only `ArtifactDecision`”完成同事务迁移前固定失败关闭且不产生领域写入；这不能与已完成的章节 `ReviewAuthorization + adopt_review_authorized_draft` 原子采用链路混写。

### 12.6 当前插件投影

Runtime 对 UI 提供当前 Plugin/Capability Registry 的只读投影，至少包含稳定插件 ID、名称、分类、版本、说明、加载状态和能力摘要。分类仅用于查看功能插件、模型插件和其他插件；该投影不承担安装、卸载、启停、配置、更新、权限、市场或项目绑定，也不保存为第二套插件事实。

### 12.7 DSH Headless Adapter

当前发布载体继续固定 DSH commit `47f943859bef60e4160492346772ded9b24f765a`。首阶段桌面实现已在 ANS Task Runtime 与固定 DSH Worker 之间建立稳定 Adapter；它不完整 Fork Harness 或嵌入其 Web UI：

- `TaskConversation / TaskRun` 映射为持续 Session/Agent 和 Turn；
- DSH 事件转换为 ANS 持久消息、运行和工具事实；每个活动任务持有独立 child/Job Object，取消不会跨任务传播；
- ANS 领域服务通过受约束 Novel Tool Adapter 暴露给 DSH；
- 成功生成结果经过既有 AI Task/Attempt/ResultArtifact 管线验证后，卡片只保存 `artifactId` 投影，不把普通 assistant 文本当成第二份产物正文；
- Worker 取消、崩溃和重启不能影响其他活动任务；
- Plugin Graph 只通过稳定只读 Projection 暴露给 UI。

较新 Harness 源码只作为架构参考。升级固定 commit 必须先完成 API 差异审计、载体构建、任务隔离和回归验证，不能在工作台版本中顺带升级。

完整设计与版本路线见 [`architecture/conversational-creative-workbench.md`](architecture/conversational-creative-workbench.md)。任务对话、决定/审阅授权、章节原子采用、领域候选工具、上下文压缩候选和写作工作台审阅收敛已落地；旧生成类 AI 面板、独立实验面板和草稿历史生产入口已经移除。通用结构化 Safe Apply 仍按失败关闭边界处理。

v3.6.0 已经完成 Canonical 1A-A/B/C/D 的 Catalog、Domain Facade、Projection、共享 Manifest 与宿主门禁，但四个只读 identity 仍为 `catalog_only + partial`，`modelVisibleToolIdentities=[]`。必须先关闭四项 Facade blocker，再以独立 exposure 变更验证 scoped manifest、权限、负例和重启行为；只有 exposure 通过后才进入 R4 真实 Main Agent Runtime 验证。

---

> **本文件是 AI Novel Studio Agent Runtime 的用户指南。具体实现细节见各模块源码。**

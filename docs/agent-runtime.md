# AI Novel Studio — Agent Runtime 文档

<!-- ans-current-canonical:start -->

Canonical 当前模型可见工具：`context.read@1`、`memory.search@1`、`novel.read@1`、`structure.read@1`。
桌面统一执行：`unified-agent-runtime`（本批集成验证中）；只读阶段：`canonical-only`；受控写章：`writing-subagent`；`deterministic-writer` 仅限浏览器开发兼容；真实云端：`NOT_VERIFIED`。
<!-- ans-current-canonical:end -->

> 文件：`docs/agent-runtime.md`  
> 版本：v3.7.0
> 当前状态：统一原生 Agent Runtime 与任务级预授权已进入本批实现，状态为 **INTEGRATION / NOT YET FULLY VERIFIED**；当前契约见第 13 节，R4 live 保持 `NOT_VERIFIED`
> 用途：说明当前统一执行与授权边界，同时保留历史 Planner Lite、Chapter Readiness Planner 与自主创作 Runtime 的演进记录

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

## 3. 历史开发辅助与旧运行时能力边界

下表保留各版本演进背景，不是当前桌面工具 exposure 或统一 Runtime 验收清单；当前行为以第 13 节为准。

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

每个任务对话拥有独立的消息、回合、下一回合模型选择、活动运行、取消状态和产物。同一任务可在回合间切换模型；每个 Run 的模型快照仍不可变，重试沿用原 Run 模型，切换不重写历史或借用其他身份的凭据。用户切换任务不会取消后台运行；一个任务失败或取消不会改写另一个任务的状态。

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

任务对话压缩与小说上下文压缩是两个不同能力：前者只调整 Session 输入表面；后者只能形成可验证 Result Artifact 候选。桌面端结构化 `request_apply` 仅对白名单领域产物及精确 `generic_json`+`context_compression` 执行“领域写入 + append-only `ArtifactDecision`”同事务；其余类型失败关闭。这不能与章节 `ReviewAuthorization + adopt_review_authorized_draft` 原子采用链路混写。

### 12.6 当前插件投影

Runtime 对 UI 提供当前 Plugin/Capability Registry 的只读投影，至少包含稳定插件 ID、名称、分类、版本、说明、加载状态和能力摘要。分类仅用于查看功能插件、模型插件和其他插件；该投影不承担安装、卸载、启停、配置、更新、权限、市场或项目绑定，也不保存为第二套插件事实。

无任务快照时的 DeepSeek 插件探测（`probe_input(None)` / 会话 `__ans_plugin_probe__`）只用于加载健康与 Plugin Graph 投影：它可以合成 `deepseek-official/deepseek-chat` 与 `DSH_PROXY_UPSTREAM`（缺省 loopback `127.0.0.1:9`）。它不是用户任务，不得创建 Turn/Run/Artifact，也不得作为真实任务的默认路由。用户 DSH 任务必须携带冻结快照中的显式非空 `baseUrl`，缺失或空白时失败关闭，不得回落到该目录探测或任何 Provider 默认地址。

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

在 Canonical 1A-A/B/C/D 基础之上，本文开头事实块列出的四项只读工具已解除 blocker，健康度 `working`，exposure `stable`。工作台 `read` intent、宿主 start 契约、Worker 环境和工具授权使用 Canonical-only allowlist，Gateway 据此列出对应无版本号工具名；候选与审计回合保留 legacy 工具。仓内 loopback 已有证据，live 云端仍未验收。`mainAgentRuntimeService` 是未接入发送路径的启发式脚手架，不是 R4 VERIFIED。v3.7.0 初次开放时曾按真实 API 与 Mock/本地模型分流；该桌面双宿主已由第 13 节原生统一生命周期替代，确定性 Writer 旧顶层仅限浏览器开发兼容。本批仍待完整验证。

---

## 13. 统一原生执行与任务级预授权（2026-11-11，集成验证中）

本节是当前源码边界，**INTEGRATION / NOT YET FULLY VERIFIED**，不是完整验收结论。第 1～11 节保留历史版本职责；第 12 节中的桌面双宿主描述由本节替代。既有本地、loopback 或 live 历史结果不覆盖本批实现。

### 13.1 同一生命周期，不共享全部上下文

桌面对话、规划、写章/修订、检查、总结，以及自主规划、章节准备、设定推演、全书候选队列等专用入口，经任务接入与冻结模型快照进入原生协调器。前端服务提交目标、明确的领域入口输入与取消信号，并读取持久投影；不在回调中切换另一套 Writer，也不根据 Mock、本地模型或 Scene/Beat 计划选择另一任务宿主。

```text
桌面 AI 入口 → TaskConversation / ConversationTurn + 冻结模型
→ 原生协调器 → 阶段 allowlist + 受控子任务 + 固定 DSH
→ AiTask / Attempt / Snapshot / ResultArtifact + 校验
→ 等待人工决定，或原生任务预授权复验
→ SQLite 原子应用、采用与上下文更新 + 回执
```

复用现有 `TaskRun / ToolCallEvent` 记录阶段与父子关系：`dsh.execution_contract` 保存 `rootTaskId / rootTurnId / rootRunId / parentRunId / phase / budgetEpoch`、章节基线和限制；工具事件继续承担步骤标识、输入/结果引用与错误。没有另建一套任务状态表。新的授权表是权限事实，不是第二套 Runtime。

主 Agent 通过结构化工具请求下一项能力，宿主复读持久工具回执并验证阶段转换。普通 assistant 文本不能被解析为执行指令。专用入口中的有效计划、检查点与已有候选继续复用；`domain.submit_candidate` 只提交绑定阶段/schema 的候选，不是任意 JSON 的正式写入入口，也不增加 Canonical 四项只读 exposure。

不同作品、任务和阶段 Session 隔离；Writing SubAgent 保留独立输入、受限读取与 `chapter_text` 候选协议。子任务继承根目标、冻结模型、取消、截止时间和累计请求/工具/Token/成本预算，只能缩小作用域。根预算按持久请求与事件累计，不能靠创建新 Run 或拆子任务重置。候选、修订次数、阶段数与执行时长均有上限，缺材料、冲突和超限明确停止或等待处理。

### 13.2 模型适配与兼容退出边界

API、Mock、本地模型都进入同一个桌面原生生命周期。Mock 是模型响应适配，返回与真实适配器相同的结构化工具调用；本地模型须满足所需协议，能力不支持时明确拒绝，不偷偷换模型或执行框架。固定 DSH commit `47f943859bef60e4160492346772ded9b24f765a` 与 `ans_task_session_v2` 不变。

确定性 Writer 的上下文编译、字数规则、完整性检查等作为有限能力复用；旧顶层 TypeScript 编排只留在浏览器开发兼容，不再是桌面备用宿主。兼容代码的退出条件是对应浏览器开发用例完成等价迁移；在此之前必须保留明确的浏览器守卫，不能为桌面失败重新开放回退。浏览器不签发任务预授权、不提供真实共享 Runtime 服务，也不构成桌面 SQLite/DSH 验收证据。

### 13.3 两种授权，统一正式写入边界

默认仍为人工确认。原有候选阅读、拒绝、要求修改、审阅授权、编辑、保存和采用保留。用户可在任务头的「本任务授权」中分别选择：

| 动作                 | 当前可用产物边界                                            | 不隐含的权限                            |
| -------------------- | ----------------------------------------------------------- | --------------------------------------- |
| `apply_planning`     | 精确 `outline` 规划族；作品级规划与有限新建范围另行显式选择 | 不包含任意 `generic_json`、世界规则修改 |
| `adopt_chapter_text` | 明确章节或本任务新建回执内的 `chapter_text`                 | 生成不等于采用，不扩大总结权限          |
| `apply_summary`      | 绑定当前采用稿的 `chapter_summary`                          | 不代替指定的人工判断，不清理历史数据    |

授权绑定作品、任务、当前明确用户目标 `sourceTurnId`、动作及每动作/总写入次数、已有章节 IDs、可选卷区间/新建卷章数量、请求/工具/修订/Token/费用/时长预算、有效期、冻结模型及版本/hash 基线。它只覆盖该目标及原生验证的受控后续阶段，不覆盖同一对话中后来独立提出的新目标。模型、提示词、候选均不能签发或扩权；模型身份或请求配置改变时停止并要求重新授权。运行中的阶段不接受追溯签发来修改已开始请求的预算。

每次应用在原生 `IMMEDIATE` 事务内重新校验授权有效性、目标/产物/模型、确定性校验、基线、额度和 `operationId`，将正式写入、授权消费与不可变回执原子提交。自动采用记为 `task_preauthorized`，不伪造 `authorReviewed=true` 或人工审阅授权。回执带 `beforeHash / afterHash`；任务自身后续基线只依据精确已提交回执推进，不能刷新当前快照来跳过人工编辑或竞争任务造成的冲突。

撤销只阻断新的授权写入，已提交事务保持真实结果。授权到期、结束、取消和作用域失效须停止自动应用；未知提交结果先核对权威回执，不盲目重放模型调用。等待决定的进程内续接不等于跨重启自动续跑，重启后依持久事实对账并显式恢复。签发后的待处理候选应用及提交后续接仍属本批集成验收范围。

### 13.4 总结安全与待验收事项

总结策略区分 `blockingIssues`、`advisories`、`semanticValidation=not_checked` 与 `reviewRequirement`。`passed=false` 或阻断问题不能仅因分数较高取得上下文资格；`SUMMARY_EVIDENCE_FRAGMENT`、`SUMMARY_CERTAINTY_ESCALATION` 要求具体人工审阅，预授权必须暂停。普通提醒不等于阻断，结构/摘录核验也不等于语义正确。原生写入与上下文/Memory 读取共用资格策略；实际旧人工审阅记录按窄兼容条件读取，不批量清理独立人工上下文。

新增兼容迁移 `041_task_authorizations`、`042_library_task_scope` 与 `043_host_terminal_native_facts`，001～040 的 definition/checksum 不改，041/042 已落地定义不重写，本批仅 043 新增 trigger。043 只允许 `dsh.*` 原生控制事实在所属 Run 终态后 append，普通工具仍限活动 Run。项目备份 schema 13 恢复时将 active 任务授权变为 expired，不恢复可执行权限。详见 [数据模型第 45 节](data-model.md#45-任务级预授权与总结应用策略2026-11-11)。

父子隔离、全部入口归一、预算/取消、同章多授权与竞争、人工中途编辑、重复回调、未知提交及重启、总结污染阻断、键盘/焦点和真实桌面闭环须以本批动态结果证明。**Scene/Beat 原生阶段链源码已落地（`scene_plan → 每 Scene beat_plan → 每 Beat beat_write/beat_state → scene_close → chapter_assemble`），并有隔离 SQLite 单测；真实 Windows Tauri 已用固定 Mock 验证 Beat 状态中断后的显式续跑及两次重启，整章生成携带计划上下文不等于逐 Scene/Beat 功能对等，不能宣称全部迁移完成。**

本批隔离 SQLite 动态复现已确认旧 issued 人工审阅授权首次消费可在另一份授权采用后切换采用指针；两份草稿正文均保留，**不是正文丢失**。已 consumed 授权在人工改采后的重放原先已拒绝。041 已新增 `review_authorizations.native_baseline_hash` 与不可变约束；该首消费 guard 已接入主采用路径与旧 consume IPC，隔离 SQLite 回归已验证：另一份授权采用后再消费旧授权会被拒绝，两份草稿都保留；已消费授权也不能在人工改采后重放。完整结果由[本批实施记录](../reports/unified-agent-2026-11-11/implementation.md)统一维护，R4 live 与文学效果未验证。

### 13.5 Scene/Beat 原生阶段链与装配复验（源码已落地）

- 原生阶段图为 `scene_plan → 每 Scene beat_plan → 每 Beat beat_write/beat_state → scene_close → chapter_assemble`，按实际持久阶段推进并复用已有计划/检查点；隔离 SQLite 用例覆盖阶段顺序、绑定、恢复与整章装配，固定 Mock 的[桌面续验](../reports/unified-agent-2026-11-11/implementation.md#closeout-20261118)覆盖 Beat 状态中断、复用三个已完成阶段、完成装配且未采用；不外推至其他故障点或真实云模型。
- 装配候选必须携带原生来源清单；宿主复验每个来源阶段的 workflow/turn/run/作品/章节、计划与输入 hash、结果文档归属及全文 hash，并要求 `beat_write` 正文按序精确拼接。该证据随候选保存，不依赖渲染层自报。
- 人工采用与预授权采用使用同一份装配证据复验：人工路径在 `adopt_review_authorized_draft` 内校验候选来源，预授权路径在原生应用前经 `validate_candidate_for_application` 复验；普通整章候选不额外增加该要求。装配恢复只复用完全匹配的既有候选，并在缺少 `dsh.candidate_admission` 时按同一准入规则补齐，不重复调用模型或创建第二份候选。
- `042_library_task_scope` 的资料库任务只用于无作品来源与 `style_analysis` 候选，不获得章节、正式写入或任务授权；`043_host_terminal_native_facts` 使 `dsh.*` 原生控制事实可在 Run 终态后追加，普通工具事件边界不变。两者均不授予正式写入权限，也不改变 candidate-only 边界。

---

> **本文件是 AI Novel Studio Agent Runtime 的用户指南。具体实现细节见各模块源码。**

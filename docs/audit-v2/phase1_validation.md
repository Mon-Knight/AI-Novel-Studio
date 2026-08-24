# AI Novel Studio 第二次全量能力审计：Phase 1 Validation

## 0. 阶段重分类（2026-08-24）

本报告的“第一阶段”只应被标记为：

```text
Phase 0.5 — Model / Provider Infrastructure Verified
```

已验证的是固定 DSH Provider、真实模型请求、Tool Calling wire、候选 Proposal schema 和宿主 Artifact/审阅基础设施；尚未验证完整的：

```text
Workbench → Main Agent → canonical Tool Registry → Writing SubAgent → Artifact
```

因此不能把本报告称为“Phase 1 Harness 完成”，也不能据此进入 Context Agent。后续已按顺序完成 Phase 1A-A Capability Catalog、Phase 1A-B Domain Facade 和 Phase 1A-C Canonical Projection 的内部描述/适配器层；这些成果仍不等于模型可见 Registry 或真实 Agent Runtime 放行。

## 1. 复核结论

第一阶段不是“完全失败”，也不是“全部通过”。准确结论是：

> 第一阶段成功验证了生产桌面的会话、候选 Artifact、人工审阅、CAS 保存/采用、跨作品隔离和重启持久化基础设施；但没有验证外部 LLM 自主选 Tool，也没有证明独立 Writing SubAgent。其原始汇报中的 Tool 名称和 Decision Trace 与当前生产 Registry 不一致。

符合度：**PARTIAL**。可继续保留基础设施成果，但不能以该报告作为 Context Agent/更多 Tool 的直接开工依据。

## 2. 原任务逐项复核

| 第一阶段声称                                                                       | 当前证据                                                                                                                                                    | 复核状态 | 结论                                         |
| ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | -------------------------------------------- |
| 用户从 Workbench 发起章节生成、修改、审阅、保存                                    | Windows Tauri E2E 实际走 5 轮、2 作品                                                                                                                       | PASS     | 用户操作闭环真实存在                         |
| Main Agent 通过 LLM/JSON 自主决定工具                                              | 章节路径由 regex + fixed steps；E2E 证据写 `plannerToolSelection=deterministic orchestration`                                                               | FAIL     | 章节任务不是 LLM Tool selection              |
| `read_current_context → invoke_writing_agent → publish_candidate → adopt_artifact` | 全仓无这些生产 canonical Tool；实际是 `novel.read_context/chapter.read_outline/search_memory` + writer service + candidate validator + review authorization | FAIL     | 原 Decision Trace 不能作为生产证据           |
| Writing SubAgent 独立 Prompt/模型/上下文                                           | writer 有服务边界和上下文编译，但复用 TaskModelSnapshot，无独立 Agent loop/model config                                                                     | PARTIAL  | 是 writer orchestrator，不是已证明 SubAgent  |
| Writer 不直接写正式数据库                                                          | writer 不写正式章节采用指针；但 AI pipeline 写 AI Task/ResultArtifact 事实                                                                                  | PARTIAL  | 可说“不写正式小说事实”，不可说“数据库写入 0” |
| Artifact 卡片和人工确认                                                            | E2E 检查 ResultArtifact hash、card、decision、authorization                                                                                                 | PASS     | 生产候选事实链真实                           |
| 保存使用 CAS/授权                                                                  | `adopt_review_authorized_draft` 一次性消费授权并绑定草稿                                                                                                    | PASS     | 正式落地安全链真实                           |
| 连续 5 轮跨作品、重启无串书                                                        | E2E 两本作品五章，进程 PID 改变后数量/hash/归属一致                                                                                                         | PASS     | 数据隔离和持久化真实                         |
| 真实模型生成约 2000 字且理解上下文                                                 | E2E 强制 mock；五轮初版 hash 完全相同；证据写 `externalLlmDecision=NOT RUN`                                                                                 | FAIL     | 不能据此评价模型能力、字数或语义隔离         |
| Tool Registry 向模型提供完整能力                                                   | DSH 只 allow 11；TS 18；permission 等元数据未完整模型可见                                                                                                   | FAIL     | Registry 既遗漏又漂移                        |
| 可直接进入 Context Agent 阶段                                                      | 本轮发现 BROKEN UI、Registry drift；仅固定 DSH preparation 有真实模型 smoke，Workbench/章节路径仍未验证                                                     | FAIL     | 必须先完成修复 Gate                          |

## 3. 真实 E2E 证据

补充的真实 DSH Provider smoke 记录见 [`real_model_validation.md`](./real_model_validation.md)。该记录证明固定 DSH 载体可以通过真实模型完成只读工具调用和 Proposal 校验，但不改变本报告对 Workbench `chapter_write` 与独立 Writing SubAgent 的未验证结论。

证据文件：`test-results/e2e/agent-production-closed-loop/closed-loop-evidence.json`

核心事实：

```text
plannerToolSelection: deterministic orchestration
externalLlmDecision: NOT RUN
totalRounds: 5
adoptedChapters: 5
conversationCount: 5
turnCount: 20
runCount: 10
toolEventCount: 40
resultArtifactCount: 10
artifactDecisionCount: 5
reviewGrantCount: 5
consumedReviewGrantCount: 5
draftCount: 10
chapterCount: 5
adoptedDraftCount: 5
```

五轮 `restartVerified=true`，且重启前后进程 PID 不同。每轮 ResultArtifact、授权、草稿、章节 ID 都按作品/章节校验。这个证据足够支持“生产数据闭环 WORKING”。

同时，五轮初版 Artifact hash 都是：

```text
e2573411ba197d417184462b49b9569dbf6cd90e8897f9b5f172a3e4b91cfaf5
```

这与 E2E 强制 Mock 一致，不能支持“模型理解两本不同小说并生成不同正文”。修改版 hash 不同是 Mock/提示文本流程行为，也不能替代真实外部模型验证。

## 4. 实际生产调用链

### 4.1 章节生成/修改

```text
Workbench user turn
  → taskSessionAdapter
  → taskGoalRouting (regex)
  → taskRuntimeAdapter fixed steps
  → novel.read_context
  → chapter.read_outline
  → search_memory
  → workbenchChapterWriter
  → executeChapterGeneration (E2E: Mock)
  → generate_chapter/polish_chapter candidate validator
  → ResultArtifact + Card
```

### 4.2 确认/审阅/采用

```text
ArtifactCard confirm-review
  → record artifact decision
  → issue one-time review authorization
  → navigate Writing Workspace
  → user unlock/edit
  → atomic draft save
  → adopt_review_authorized_draft
  → consume authorization + update adopted draft in one transaction
```

第二条链是真实生产闭环；不存在 `adopt_artifact` Main Agent Tool。

## 5. 第一阶段哪些成果可以保留

- Conversation/Turn/TaskRun/ToolEvent SQLite 事实。
- ResultArtifact 与 validation issues 不可变事实。
- ArtifactCard/Decision/ReviewAuthorization 协议。
- 候选不直接覆盖正式正文。
- 编辑器 CAS 保存、一次性授权采用和跨书 ownership 校验。
- 模型快照冻结、取消/失败收敛、任务重试创建新 Run。
- 重启恢复与跨作品隔离 E2E。
- `search_memory` 和 context compiler 的确定性/生产底座。

这些是真实的 Agent Harness 基础设施，不需要推倒重来。

## 6. 哪些声明必须撤回或改写

- “Main Agent 已由 LLM 自主选 Tool” → 改为“章节路径目前是确定性 orchestration；固定 DSH preparation 已有真实模型 smoke，但完整 Workbench DSH 仍待验证”。
- “独立 Writing SubAgent 已完成” → 改为“Writing service/orchestrator 已接入候选流程”。
- “外部模型真实生成 2000 字通过” → 改为“Mock candidate pipeline 通过；固定 DSH preparation 的真实 Provider smoke 已通过，但章节生成 Provider 未运行”。
- “`adopt_artifact` Tool CAS 落盘” → 改为“用户审阅授权后由编辑器领域服务 CAS 采用”。
- “数据库直接写调用数为 0” → 改为“writer 不直接写正式小说事实，但 execution pipeline 持久化 AI Task/ResultArtifact”。
- “Tool Registry 完整” → 改为“TS 18/DSH 11/gateway 14 存在 drift，需统一”。

## 7. 是否建立在真实能力之上

分层回答：

| 层                         | 判断     | 说明                                                                             |
| -------------------------- | -------- | -------------------------------------------------------------------------------- |
| SQLite/草稿/采用/重启      | 是       | 真实生产能力，E2E 有证据                                                         |
| Conversation/Artifact/审阅 | 是       | 真实生产能力，E2E 有证据                                                         |
| Context/Memory 读取底座    | 大部分是 | 服务与 Tool handler 真实；模型上下文质量仍未验证                                 |
| Main Agent 自主决策        | 否       | 章节主链确定性；固定 DSH preparation 有真实模型证据，但完整 Workbench DSH 未运行 |
| Writing SubAgent           | 部分     | writer service 真实，独立 Agent/模型隔离未证实                                   |
| Registry 能力地图          | 否       | 不完整且多份定义漂移                                                             |

最终结论：**第一阶段 Harness 部分建立在真实能力之上，基础设施是真实的，但“自主 Agent + 正确 Registry + 独立 SubAgent”部分尚未建立。**

## 8. 下一阶段放行条件

在进入 Main Agent Tool 投影或 Context Agent 前必须全部满足：

1. 修复或下线三个 BROKEN 入口。
2. 把 TS、Rust gateway、DSH allowlist 收敛为单一 canonical manifest。
3. 将 candidate validators 从 `generate_*` 改为不误导的职责名称。
4. 明确章节路径是宿主编排还是 LLM 决策，并在 trace 中分别标记。
5. 固定 DSH preparation 的真实 Provider tool-calling smoke 已完成；`chapter_write`/Writing SubAgent 的运行时验证必须等能力 facade 与 canonical manifest 完成后再做。
6. 将 Writing service 升格为受约束 SubAgent contract，或明确它不是 SubAgent。
7. 对每个拟开放 Tool 做 ownership、permission、side-effect、confirmation、重启和负例验证。

放行结论：**当前 NOT READY for model-visible Main Agent Tool execution / Context Agent expansion**。能力资产化和内部 canonical projection 已建立，但不能跳过 Registry/权限/运行时统一直接进入 Writing SubAgent。

## 2026-08-24 状态增补：Phase 1A-B Domain Facade

在上述结论之后，已完成 Domain Facade 的第一版薄层建设。它只整理已验证的生产 handler 和宿主协议，不改变“Main Agent 未放行”的结论。

新增真实浏览器回退链验证：

- `projectCapability`：作品、设定、卷章和章节定位 DTO；
- `contextCapability`：章节上下文和带来源 Memory 检索；
- `conversationCapability`：运行事实安全投影；
- `artifactCapability`：候选、用户确认、审阅授权和版本/hash 校验后的采用；
- `writingCapability`：candidate-only 和冻结模型快照前置边界。

浏览器定向测试为 6/6 PASS，来源明确为 `localstorage / browser_fallback`；另有 `tests/e2e/domain-facade-sqlite.spec.ts` 的真实 Windows Tauri + SQLite 1/1 PASS，覆盖写后读、重启和 CAS 重放。完整记录见 [`domain_facade_validation.md`](../architecture-audit-v2/domain_facade_validation.md)。

当前阶段应读作：**Phase 1A-B Domain Facade verified（Browser + SQLite E2E）；Phase 1A-C Canonical Tool Projection 的 catalog-only 描述/固定 adapter 已验证；模型可见工具仍为 0，Main Agent、Writing SubAgent 仍未放行。**

## 2026-08-24 状态增补：Phase 1A-C Canonical Tool Projection

新增 `src/services/capabilities/canonical/`，首批仅投影 `novel.read`、`structure.read`、`context.read`、`memory.search` 四个已有 Facade。投影采用固定函数绑定、严格输入 schema、宿主 scope 复验和稳定 manifest hash；旧 alias、技术 handler 名和无 Facade 能力均不形成隐式执行入口。

所有 descriptor 继续继承 `catalog_only`，`listAgentExposedCapabilities()` 和 Canonical Agent manifest 均为空；现有 `productionToolRegistry`、`WORKBENCH_TOOLS`、Rust/DSH allowlist 与 Main Agent prompt 未被修改。设计与测试证据见 [`canonical_tool_projection.md`](../architecture-audit-v2/canonical_tool_projection.md) 与 [`canonical_tool_projection_validation.md`](../architecture-audit-v2/canonical_tool_projection_validation.md)。

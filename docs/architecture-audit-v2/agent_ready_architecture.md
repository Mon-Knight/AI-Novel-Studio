# AI Novel Studio Agent-Ready Architecture（重构准备版）

## 1. 目标架构

```text
┌────────────────────────────────────────────┐
│ Workbench / Writing Workspace / Project UI │
└──────────────────┬─────────────────────────┘
                   │ user intent + confirmation
┌──────────────────▼─────────────────────────┐
│ Domain Capability Layer (12 canonical domains)│
│ novel structure writing context memory ... │
└───────────────┬────────────────────────────┘
                │ typed facade / proposal
       ┌────────▼────────┐       ┌──────────────▼─────────────┐
       │ Deterministic   │       │ SubAgent adapters           │
       │ Tool adapters    │       │ writing/context/quality/... │
       └────────┬────────┘       └──────────────┬─────────────┘
                │                               │ candidate only
                └──────────────┬────────────────┘
                               ▼
                     ResultArtifact / Decision
                               │ user authorization
                               ▼
                     Domain transaction / CAS
                               │
                               ▼
                    SQLite durable source of truth
```

Main Agent 只编排 Domain Capability，不直接知道 React component、Tauri command、SQLite table、chunk、lease 或 LocalStorage key。

## 2. 层职责

### UI 层

- 展示作品、章节、候选、审阅和确认。
- 维护可丢失的 loading/selection projection。
- 不直接调用 AI、SQL 或 legacy registry。

### Domain Capability 层

- 每个领域一个 canonical facade。
- 负责 ownership、revision/hash、状态转换和事务边界。
- 输出稳定 DTO/Proposal/Candidate，不暴露内部表结构。

### Tool Adapter 层

- 将确定性 capability action 转成 Tool schema。
- 在入口和后端双重验证 scope/permission。
- 只读或 prepare 默认无需确认；write/apply/export 需要宿主授权。

### SubAgent Adapter 层

- 提供 role prompt、模型快照、只读工具清单、预算和取消边界。
- 只交付 ResultArtifact candidate/report。
- 不执行 domain adoption/write。

### Runtime/Storage 层

- DSH/Provider、AI request governance、TaskRun、Artifact storage、SQLite repository。
- 这些是内部设施；其变化不应改变 Agent 能力名称。

## 3. Main Agent 目标协议

### 3.1 输入

```ts
interface MainAgentRequest {
  conversationId: string;
  novelId: string;
  chapterId?: string;
  userGoal: string;
  targetSnapshot: { novelId: string; chapterId?: string; revision: string };
  capabilityManifestHash: string;
  modelSnapshot: TaskModelSnapshot;
}
```

### 3.2 决策结果

```ts
interface MainAgentDecision {
  intent: 'read' | 'write_candidate' | 'review' | 'export';
  capability: string;
  action: string;
  arguments: unknown;
  requiresConfirmation: boolean;
  rationaleLabel?: string;
}
```

`rationaleLabel` 是可审计的短标签，不是隐藏推理。宿主必须验证 Agent 返回的 capability/action 是否在当前 manifest 和 target scope 中。

### 3.3 章节写作目标流

```text
用户“继续当前章节”
  → Main Agent 选择 writing.continue
  → Host 创建 SA-WRITING run
  → SubAgent 调用 novel/structure/context/memory/style read
  → 生成 candidate
  → Artifact service 验证/hash/保存
  → UI Card
  → 用户确认 review
  → Writing Workspace 编辑/CAS save/adopt
```

即便 Main Agent 选择了 `writing.continue`，也不能直接调用 `draft.adopt`。

## 4. Canonical manifest 设计

Manifest 应是唯一声明源，至少包含：

```ts
interface CapabilityManifestEntry {
  name: string;
  version: string;
  kind: 'tool' | 'subagent' | 'host_protocol';
  description: string;
  inputSchema: JsonSchema;
  outputSchema: JsonSchema;
  scope: 'novel' | 'chapter' | 'project' | 'runtime';
  permissions: string[];
  sideEffect: 'none' | 'proposal' | 'write';
  confirmationPolicy: 'never' | 'user_required';
  sourceOfTruth: string;
  status: 'stable' | 'partial' | 'experimental' | 'legacy';
}
```

生成目标：

```text
manifest
  → TS production registry
  → Rust gateway tools/list/call allowlist
  → DSH public-scoped registry
  → currentPluginService projection
  → docs/registry snapshot
```

构建失败条件：canonical name 重复、schema hash 漂移、DSH/TS 集合不一致、partial/legacy 能力进入 stable allowlist、write action 没有 confirmation。

## 5. 状态与事实源架构

```text
SQLite durable facts
  ├─ novels / structure / drafts / adopted pointer
  ├─ memory / context / quality / style / references
  ├─ task runs / artifacts / decisions / authorizations
  └─ governance / recovery / leases (internal)

UI projections (discardable)
  ├─ workspaceSessionStore
  ├─ rightSidebarStore
  └─ local loading/selection state

Recovery facts
  └─ workspace recovery snapshots (not adopted truth)
```

规则：UI projection 永远不能覆盖 durable fact；重启时从 durable fact hydrate；stale hash 只能提示/丢弃，不能静默写回。

## 6. Agent 看到的能力数量

### 默认稳定面：18 个核心动作

见 [tool_mapping.md](./tool_mapping.md)：10 个确定性/确认 Tool、6 个 SubAgent adapter、2 个 Host protocol。默认 prompt 只显示当前任务允许的子集，不显示 75 个审计行。

### 不在默认面

- autonomous planning、Multi-Agent、旧 Harness：实验 manifest。
- migration、chunk、lease、AI task internals：internal only。
- BROKEN/UNKNOWN/PARTIAL 未通过 gate 的能力：不进入 stable manifest。

因此最终答案不是“Main Agent 看到 75 个能力”，而是“Main Agent 在任务作用域内看到不超过 18 个 canonical action；实际每轮通常只投影 6～12 个”。

## 7. 从当前实现到目标架构的迁移阶段

### R0：事实冻结（已完成设计）

- 75 能力族、14 个宏观重复组、16 个具体冲突簇（13 个可归并、3 个边界治理）、健康状态和第一阶段边界已记录。
- 三个 BROKEN 入口列为阻断。

### R0.5：模型接入层收口（已完成）

- 固定 DSH Provider、真实模型请求、Tool Calling wire、候选 Proposal schema 和凭据隔离已验证。
- 该结果只证明 Model/Provider Infrastructure，不证明完整 Harness Agent 闭环。
- 当前阶段标签为 `Phase 0.5 — Model / Provider Infrastructure Verified`；默认 Mock E2E 和 `chapter_write` 的非 DSH 路由保持不变。

### R0.75：能力资产化（已完成）

- 建立独立的 Capability Catalog v1，登记 75 个审计能力族归并后的 18 个 canonical action。
- 记录健康、调用链、事实源、旧 alias、迁移阻断和 Agent exposure；所有条目先固定为 `catalog_only`。
- 资产目录见 [`capability_registry_v1.md`](./capability_registry_v1.md)，执行任务书见 [`phase1a_capability_assetization_taskbook.md`](../audit-v2/phase1a_capability_assetization_taskbook.md)。

### R1：首批 Domain facade（已完成并通过 Browser + SQLite E2E）

- 已实现只读 `novel.read`、`structure.read`、`context.read`、`memory.search` facade，显式校验 ownership、revision/hash 和跨作品负例。
- 不改变现有 UI、TS Tool Registry、Rust Gateway 或 DSH allowlist；增加 adapter/证据测试。

### R1.5：Canonical Tool Projection（已完成描述与适配器层）

- 以固定映射将上述四个 Facade 投影为 canonical descriptor，并生成排序稳定的内部 manifest/hash。
- 所有 descriptor 继续继承 `catalog_only`；模型可见 manifest 为 0，不接入 Main Agent、DSH `tools/list` 或旧 production Registry。
- 设计与证据见 [`canonical_tool_projection.md`](./canonical_tool_projection.md) 和 [`canonical_tool_projection_validation.md`](./canonical_tool_projection_validation.md)。

### R2：候选与 Artifact 统一

- writer/outline/summary/quality/style 全部返回同一 candidate contract。
- 旧 `generate_*` validator 改为内部实现名。
- UI 仍使用现有 Card/Authorization。

### R3：Manifest/Runtime 统一（资产化通过后）

- 删除手写 `WORKBENCH_TOOLS`/allowlist 漂移（以生成投影替代）。
- 做 TS/Rust/DSH schema hash gate。
- 对外真实模型 smoke（固定 DSH preparation 已完成；`chapter_write`/Writing SubAgent 仍待单独验证）。

### R4：真实 Main Agent Runtime 验证

- 通过显式 real profile 调用真实 DSH Task Runtime，审计模型自主产生的 `tool/call` 与 `tool/result`。
- 只验证已通过 catalog/facade gate 的工具→候选 Artifact 投影和错误负例；不暴露 `adopt_artifact`，不宣称 Writing SubAgent。
- 结果必须落到 [`docs/audit-v2/agent_runtime_validation.md`](../audit-v2/agent_runtime_validation.md)。

### R5：旧入口隔离

- hidden/legacy routes、旧 panels、autonomous/multi-agent 默认禁用或标实验。
- LocalStorage formal-fact mirrors 双读单写迁移。

### R6：真实模型与 SubAgent 放行

- SA-WRITING 先放行；其余按能力族逐步放行。
- 每次只启用一个新 SubAgent，完成跨作品、重启、失败、越权负例。

## 8. Agent-ready 放行条件

以下任一未满足，都不能进入 Context Agent 扩展：

1. 删除/修复/资产统计三个 BROKEN 入口已修复或明确禁用。
2. canonical manifest 是唯一 Registry 来源。
3. Main Agent trace 能区分 LLM decision 与宿主固定 orchestration。
4. `writing.generate/continue/rewrite` 有独立 SubAgent contract。
5. 外部真实 Provider 至少完成只读、候选、schema rejection 三类 smoke。
6. 所有 candidate 都经 Artifact/Decision/Authorization，不能直接落正式事实。
7. 每个 stable Tool 有 ownership、permission、confirmation、restart/negative evidence。
8. legacy 入口不再出现在默认 UI、prompt 或 manifest。
9. `structure.read` 的 version/active pointer、`context.propose_summary` 的 adopted-draft/FK 绑定、`draft.read` 的 SQLite 单写规则均有正向与负向证据。

当前放行结论：**NOT READY**。Capability Catalog、Domain Facade 与 Canonical Projection 描述层已建立，但 TS/Rust/DSH 单一 manifest、模型可见权限门禁、Main Agent 与 Writing SubAgent 仍未放行。

本轮已完成的修复只覆盖确定性宿主边界：事务级作品清理、SQLite 基础数据诊断、资产统计、summary adopted-draft 校验和 outline active scope。它们仍需要真实 Windows/Tauri 入口回归；修复本身不等于 Context Agent 准入。

## 9. 审计问题的直接回答

| 问题                          | 当前结论                                                                                                                                 |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| 软件真实拥有多少能力？        | 75 个独立能力族；这是按真实入口、调用链、数据库和模型反查后的审计计数，不是文件数。                                                      |
| 重复能力多少？                | 14 个宏观重叠组，展开为 16 个具体冲突簇。                                                                                                |
| 可以合并多少组？              | 13 个具体簇可通过 Domain Capability facade 归并；3 个具体簇必须做边界/事实源治理。                                                       |
| 哪些应保留？                  | SQLite project/structure/draft/adoption、memory/context、ResultArtifact/Decision/Authorization、Workbench/DSH session 作为当前生产权威。 |
| 哪些应废弃？                  | 旧 Agent Harness/registry、退休 AI 面板、LocalStorage formal-fact mirror、旧 autonomous/multi-agent 路径；先迁移和隔离，本轮不删除。     |
| 哪些是 Tool？                 | 10 个确定性/确认动作：读取、检索、参考资料读取和导出等。                                                                                 |
| 哪些是 SubAgent？             | 6 类契约：writing、structure、context、quality、style、planning；首期默认只放行已验证子集。                                              |
| Main Agent 看到多少核心能力？ | 目标为 18 个 canonical action，按任务 scope 通常只投影其中 6～12 个。                                                                    |
| 是否存在历史架构阻碍？        | 有：三处已确认 BROKEN 入口，加上 outline active/version、summary bundle/FK、draft 多事实源、Registry 漂移和固定 orchestration 证据不足。 |

因此当前不能直接进入 Context Agent 扩展；必须先完成 M0 事实冻结和 M1 facade 的入口级验证。

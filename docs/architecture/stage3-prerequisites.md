# 阶段 3 前置契约与安全边界

## 1. 状态

本文冻结阶段 3 开始前的 V1 输入、确认、治理和 Apply 边界。它不实现正式创作导演、Story State、多 Agent 或自动 Apply。

阶段 3 后续能力必须继续复用现有 `AiTask + Attempt + Snapshot + Artifact + Proposal + ApplyPlan + DAG`，不得为创作意图或导演另建任务系统。

## 2. 创作意图输入协议

`CreativeIntentSnapshotV1` 是一次不可变、可追溯的作者意图快照：

- `schemaVersion=1`；
- `intentId` 是意图链身份；
- `revision` 从 1 递增；
- `parentIntentId` 指向上一冻结版本；
- 每条 statement 有独立 `statementHash`；
- 整体以规范化 JSON 计算 `contentHash`；
- 冻结后只创建新 revision，不原地修改。

每条陈述必须属于一类：

| 分类 | 含义 | 默认确认规则 |
|------|------|--------------|
| `author_explicit` | 作者直接给出的事实、目标或约束 | 必须记录 `confirmedBy=author` |
| `inferred_preference` | 从作者输入推断出的偏好 | 默认 pending，禁止自动确认 |
| `requires_confirmation` | AI 提议、信息不足或会改变方向的内容 | 默认 pending，必须人工确认 |

推断结果允许进入冻结输入，以便复现当时决策，但 pending 不等于 Canon，也不得被 Prompt 编译器描述成“作者已确认”。

## 3. 初始化候选协议

`InitializationCandidateBundleV1` 绑定一个冻结意图版本。每个候选包含：

- `candidateId`、`targetType` 和结构化 `proposedValue`；
- 知识分类与置信度；
- 至少一个证据引用；
- 面向作者的生成解释；
- 冲突代码、严重度、说明和证据引用；
- 依赖的候选 ID；
- 不含确认状态的稳定 `candidateHash`；
- 独立的 pending / confirmed / rejected 状态。

确认采用乐观锁：客户端提交 `expectedBundleHash + expectedCandidateHash`。只更新被作者决定的条目并生成新 bundle revision；未选择条目保持原状态。存在冲突时必须显式确认冲突，不能用一次“全部同意”绕过逐项证据。

## 4. 持久化映射

不新增 schema：

```text
CreativeIntentSnapshotV1
  -> ai_input_snapshots.payload_json

DirectorBudgetV1
  -> ai_context_snapshots.budget_json

DirectorPermissionsV1
  -> ai_constraint_snapshots.payload_json

InitializationCandidateBundleV1
  -> generic_json ResultArtifact.structured_payload_json

DirectorDecisionAuditV1
  -> generic_json ResultArtifact
```

Snapshot 与 Artifact 继续由现有 `AiTask/Attempt` 关联；工作流关联、依赖、重试、取消和 stale 继续由现有 DAG 处理。

## 5. 未来导演治理

`DirectorGovernanceV1` 在任务提交前冻结：

- Provider 调用次数；
- 输入/输出 token；
- 费用；
- 运行时长；
- 可提交的 Task 类型；
- 可提议的 Canon 目标；
- 是否可读 Canon、提交任务和提出更改。

V1 的超限策略固定为 `block`；`canApplyCanonChanges` 与 `canChangeProviderConfig` 固定为 false。治理契约只授予“生成候选”的权限，正式写入仍要求作者确认后的 ApplyPlan。

`DirectorDecisionAuditV1` 记录选定动作、可选动作、简要理由、证据、是否需要用户确认及结果。它记录可审计的决策依据，不保存隐藏思维链，也不得包含 API Key 或 Provider 凭据。

## 6. 多 Canon ApplyPlan

首个可执行边界仅支持创建：

1. `world_setting`；
2. `rule_system`；
3. `character`。

不支持覆盖、删除或合并既有 Canon。计划只能从已通过校验、未 stale 的初始化候选 Artifact 创建；前端只能选择 Artifact 内已经作者确认的候选，不能提交任意业务 payload。

Rust 在 Plan 固化前预分配目标 UUID，将候选依赖转换为 `artifact_apply_dependencies`，进行循环检测并固定 `operationId/requestHash`。浏览器 LocalStorage 无法提供跨键原子性，因此明确拒绝该命令。

执行边界：

```text
BEGIN IMMEDIATE
  -> CAS ready -> applying
  -> 复检 Proposal / Artifact / novel scope / stale
  -> 复检 bundleHash / candidateHash / 作者确认 / 冲突确认
  -> 拓扑排序并逐项执行 Canon INSERT
  -> 每项 affected rows 必须等于 1
  -> 写入每项 ArtifactTargetLink
  -> 写入 ApplyPlan completed/result
COMMIT
```

任何校验、业务唯一性、SQL、TargetLink 或完成结果失败都会回滚同一事务。事务外只记录 Plan failed；不会留下部分 Canon 或部分 TargetLink。completed Plan 的重复请求按 `operationId/requestHash` 返回首次结果，不再次执行 SQL。

## 7. 阶段 3 仍需在正式功能中完成

- 提供作者可编辑和逐项确认创作意图的正式 UI；
- 由 Rust Worker 生成并持久化初始化候选 Artifact；
- 将治理契约接入真实导演任务提交门禁和用量记账；
- 为更新既有 Canon 设计 expectedVersion/hash 与合并冲突，而不是扩张当前 create-only 入口；
- 在正式初始化工作流中增加端到端桌面验收。

这些事项属于阶段 3 正式实施，不改变本文件已冻结的 V1 安全边界。

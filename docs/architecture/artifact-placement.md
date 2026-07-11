# Artifact Placement 与 Apply Plan 架构冻结

> v2.3.0：单目标；v2.4.0：多目标与正文选区

## 1. PlacementProposal

~~~ts
interface PlacementProposal {
  proposalId: string;
  artifactId: string;
  schemaVersion: number;
  targets: PlacementTarget[];
  confidence: number;
  reasons: string[];
  warnings: string[];
  unresolvedItems: string[];
  projectRevisionHash: string;
  createdAt: string;
}
~~~

Proposal 是本地 Target Resolver 根据 Artifact、Task scope 和当前项目结构生成的不可变审计记录。AI 可以提供目标建议，但优先级最低，且所有 ID 都要重新查询和校验。

### 1.1 目标优先级

1. 用户在 Task 输入中显式指定且仍合法的目标。
2. Task 创建时的 scope 锚点（novel/chapter/draft/selection）。
3. 本地确定性规则与已存在的领域关系。
4. AI 返回的 target hint，仅用于候选排序。

不得因为 AI 返回了存在的 targetId 就越过作品归属、目标类型、版本/hash 或 adopted 不可变校验。

### 1.2 PlacementTarget

每个 target 至少包含 targetType、targetId、novelId、chapterId、action、expectedVersion、expectedHash、sourcePriority、confidence、reason 和可选 textRangeLockId。关键身份是独立列或规范化子表，不能只藏在 targets JSON 中。

### 1.3 生命周期

- Proposal 持久化以支持审计、恢复和用户确认。
- 项目结构、目标版本/hash 或 Artifact 校验结论变化后，旧 Proposal 变为 stale；不得原地更新。
- 用户改变目标、排序或排除项时创建新 Proposal，并记录 parentProposalId。
- unresolvedItems 非空可展示，但不能生成 ready ApplyPlan，除非用户明确解决每项。

## 2. ApplyPlan

~~~ts
type ApplyPlanStatus =
  | 'draft'
  | 'validated'
  | 'blocked'
  | 'ready'
  | 'applying'
  | 'completed'
  | 'failed'
  | 'commit_unknown'
  | 'cancelled';

interface ApplyPlan {
  planId: string;
  artifactId: string;
  proposalId: string;
  schemaVersion: number;
  operations: ApplyOperation[];
  dependencies: ApplyDependency[];
  expectedVersions: Record<string, number>;
  expectedHashes: Record<string, string>;
  conflicts: ApplyConflict[];
  requestHash: string;
  operationId: string;
  status: ApplyPlanStatus;
  createdAt: string;
}
~~~

Proposal 回答“结果适合放到哪里”；ApplyPlan 回答“经过用户确认后，要以什么顺序、什么前置条件执行哪些写入”。ApplyPlan 在用户确认目标并完成最后一次后端预检时生成。

### 2.1 不可变与用户编辑

- operations、dependencies、expectedVersions、expectedHashes、requestHash 创建后不可变。
- status、错误摘要和完成时间是执行状态，不属于请求内容。
- 用户排除操作、编辑 payload、改变顺序或目标时，创建新 Plan 并记录 parentPlanId；旧 Plan cancelled/superseded，不原地改。
- Plan 过期时创建新 Proposal/Plan；不能只刷新 expectedVersion。

### 2.2 requestHash

使用稳定 key 排序、明确 null、UTF-8 编码和 SHA-256。参与字段：

- artifactId、Artifact 内容 hash、artifact schemaVersion；
- proposalId 与 plan schemaVersion；
- novelId/scope；
- 按 operationIndex 排序的 targetType、targetId、action、payloadHash、textRangeLockHash；
- 按稳定顺序的 dependencies；
- expectedVersions、expectedHashes；
- adopted 不可变要求和校验器版本。

不参与：operationId、status、createdAt、traceId、UI 文案。operationId 标识一次业务提交，requestHash 标识其不可变载荷。

### 2.3 幂等规则

| 情况 | 权威结果 |
|---|---|
| 新 operationId | 插入 started 记录并执行。 |
| 同 operationId + 同 requestHash + completed | 不再写业务表，返回首次 resultJson/target links。 |
| 同 operationId + 不同 requestHash | OPERATION_PAYLOAD_CONFLICT。 |
| applying 中重复请求 | 返回 IN_PROGRESS 和同一 operation 位置；不并行执行。 |
| commit_unknown 重试 | 先对账 operation/target links，再决定成功或保持 unknown；不盲写。 |
| 同 Artifact 新目标 | 新 Plan、新 operationId，仍需完整校验。 |

## 3. ApplyPlan 状态机

| 当前 | 允许进入 | 说明 |
|---|---|---|
| draft | validated、blocked、cancelled | 后端展开操作并检查 schema/目标。 |
| validated | ready、blocked、cancelled | 冲突为零且用户确认后进入 ready。 |
| blocked | draft、cancelled | 只能通过生成新 Plan 继续；原 Plan 通常 cancelled。 |
| ready | applying、cancelled | applying 使用 compare-and-swap。 |
| applying | completed、failed、commit_unknown | completed 仅在业务写入、链接和 operation 结果同一事务提交后。 |
| failed | 无 | 已知回滚；修正后创建新 Plan。 |
| commit_unknown | completed、failed | 仅 reconciler 可转换。 |
| completed | 无状态变化 | 重放返回首次权威结果。 |
| cancelled | 无 | 用户确认前取消；不产生业务写入。 |

错误码：APPLY_PLAN_ILLEGAL_TRANSITION、APPLY_PLAN_STALE、TARGET_NOT_FOUND、TARGET_SCOPE_MISMATCH、TARGET_VERSION_CONFLICT、TARGET_HASH_CONFLICT、ADOPTED_DRAFT_IMMUTABLE、DEPENDENCY_CYCLE、OPERATION_PAYLOAD_CONFLICT、COMMIT_UNKNOWN。

## 4. 单目标 v2.3.0

- 章节正文：Artifact → chapter_text Proposal → ApplyPlan → save_chapter_draft_atomic 的事务内实现 → 新候选草稿 → target link。绝不直接覆盖 adopted 草稿。
- 大纲、人物、事件、设定、总结、质量报告：调用对应 Service/Repository 的后端命令；验证作品归属、expectedVersion/hash 和 affected rows。
- 所有正式落位都需要用户确认；生成完成不等于应用成功。
- UI 只有在后端返回 completed 和 target links 后显示成功。

## 5. 多目标 v2.4.0

- Proposal 可含多目标和 unresolvedItems；用户可预览差异并排除操作。
- ApplyPlan 将所有业务写入、长文本、target links 和 operation 结果纳入同一 Immediate transaction。
- dependencies 必须拓扑排序；环路或缺失依赖在事务前阻断。
- 任何操作 affected rows 不符合预期，整体回滚。
- 禁止静默把一个 Artifact 分散写入多个对象；用户必须看到目标和差异。

## 6. 当前链路的迁移约束

- AiGeneratePanel 的“确认采用”必须绑定当前 Artifact/resultId，不能重新查询章节 latest 草稿。
- OutlinePanel、EventsPanel、ChapterSummaryPanel 等局部候选必须记录生成时目标，章节切换后旧结果只能保留为 stale，不能应用到新章节。
- setting_suggestions 的 localStorage 候选状态与正式目标写入必须由 Apply transaction/target link 取代，避免目标已创建但候选仍 pending。
- v2.1.1 的页面内 DocumentApplyIdempotencyGuard 可保留为 UI 防抖，但不能替代持久化 operationId。

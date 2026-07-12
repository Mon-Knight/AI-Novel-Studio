# AI Task Pipeline 架构冻结

> 冻结日期：2026-07-12
>
> 适用版本：v2.3.0（实现）、v2.4.0（扩展）
>
> 状态：架构契约；章节正文生成已接入第一阶段 Context / Constraint Compiler，其余入口仍按各自迁移计划推进。

## 1. 目标与唯一管线

所有生产 AI 请求必须逐步收敛到同一条管线：

~~~text
AiTask
→ immutable snapshots
→ AiTaskAttempt
→ Provider Adapter
→ ResultArtifact
→ validation
→ PlacementProposal
→ ApplyPlan
→ authoritative transaction
→ ArtifactTargetLink
~~~

现有 ai_task_records、generation_jobs 和各面板局部状态是迁移来源，不再继续扩展为第三套状态模型。React 组件只发起命令、订阅任务摘要和展示结果；Provider 调用、状态转换、落库校验由 Service/Rust 后端负责。

## 2. AiTask 冻结模型

~~~ts
type AiTaskStatus =
  | 'created'
  | 'preparing_context'
  | 'ready'
  | 'queued'
  | 'running'
  | 'validating'
  | 'completed'
  | 'applying'
  | 'applied'
  | 'failed'
  | 'cancel_requested'
  | 'cancelled';

interface AiTask {
  taskId: string;
  taskType: string;
  novelId: string;
  chapterId?: string;
  draftId?: string;
  scopeType: string;
  targetHint?: unknown;
  status: AiTaskStatus;
  inputSnapshotId: string;
  contextSnapshotId: string;
  constraintSnapshotId: string;
  currentAttemptId?: string;
  resultArtifactId?: string;
  traceId: string;
  operationId: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  appliedAt?: string;
  error?: AppError;
}
~~~

### 2.1 字段语义

| 字段 | 冻结语义 |
|---|---|
| taskId | 全局 UUID；任务身份永久不变。一次用户意图对应一个 Task。 |
| taskType | 稳定业务枚举，不使用按钮文案；章节总结和卷总结必须是不同类型。 |
| novelId | 权威作品边界；后端必须校验所有目标均属于该作品。 |
| chapterId / draftId | 创建时已明确的作用域锚点；不是 Provider 可修改的目标。 |
| scopeType | book、volume、chapter、draft、selection、asset 或 system；决定允许的目标种类。 |
| targetHint | 非权威、版本化 JSON。可含用户显式目标或 AI 建议，但不能直接驱动写入。 |
| status | 由后端状态机维护；前端不得直接 patch 任意状态。 |
| inputSnapshotId | 用户指令、模式、显式参数的不可变快照。Task 持有唯一输入快照。 |
| contextSnapshotId | 本次请求实际采用的项目上下文快照；不存在时 Task 不得进入 ready。 |
| constraintSnapshotId | 输出格式、安全规则、范围、风格和写入约束的不可变快照。 |
| currentAttemptId | 当前或最后一次 Attempt；历史 Attempt 由独立表保留。 |
| resultArtifactId | 主 Artifact 的便捷引用；一对多关系仍以 artifacts.task_id 为准。 |
| traceId | 跨前端、Rust、Provider 和数据库日志的诊断 ID；不承担幂等。 |
| operationId | Task 创建幂等 ID；同 ID 不同请求哈希必须报冲突。应用有独立 operationId。 |
| createdAt | Task 行首次持久化时间。 |
| startedAt | 首个 Provider Attempt 开始时间，不等于上下文准备时间。 |
| completedAt | Artifact 解析和校验完成时间；无可用结果的 failed/cancelled 不设置。 |
| appliedAt | 至少一个 ApplyPlan 完整提交的时间；部分应用不设置。 |
| error | 结构化 AppError；仅记录当前终态/最近失败摘要，不覆盖 Attempt 历史。 |

targetHint、error 等 JSON 必须带 schemaVersion；关键查询字段不得只存在 JSON 中。Task Store 只缓存摘要和 ID，不保存完整正文、Prompt 或上下文。

## 3. AiTaskAttempt 冻结模型

~~~ts
type AiTaskAttemptStatus =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancel_requested'
  | 'cancelled'
  | 'late_response_ignored';

interface AiTaskAttempt {
  attemptId: string;
  taskId: string;
  attemptNumber: number;
  providerId?: string;
  providerRequestId?: string;
  status: AiTaskAttemptStatus;
  startedAt?: string;
  finishedAt?: string;
  responseMetadata?: unknown;
  error?: AppError;
}
~~~

- UNIQUE(task_id, attempt_number)；attemptNumber 从 1 单调递增。
- responseMetadata 仅保存模型、用量、finish reason、响应哈希和长度等脱敏信息；完整响应通过大文本引用进入 Artifact，不写日志。
- Provider 的原始 request ID 可空；不得用它替代本地 attemptId。
- 同一 Task 的网络超时、限流、Provider 5xx 和可重试传输错误创建新 Attempt，并复用原三类快照。
- 用户修改输入、目标、范围、约束，或项目变化后要求重新取上下文时，必须创建新 Task。
- completed 结果的“重新生成”以及 cancelled Task 的“重新运行”必须创建新 Task；不能复活旧终态。
- 取消同时记录 Task 和活跃 Attempt。Provider 返回后若 Task 已 cancel_requested/cancelled，则 Attempt 进入 late_response_ignored；不得创建或关联可应用 Artifact。

## 4. 三类不可变 Snapshot

三类表都使用 snapshotId、taskId、schemaVersion、contentHash、createdAt，并在创建后禁止 UPDATE/DELETE（作品删除时由明确保留策略处理）。hash 为规范化结构 JSON 加所有长文本 SHA-256 的整体 SHA-256。

~~~ts
interface SnapshotSourceRef {
  sourceType: string;
  sourceId?: string;
  sourceVersion?: number;
  sourceHash?: string;
  contentRefId?: string;
  includeReason: string;
  transform?: 'none' | 'truncate' | 'summarize';
}

interface AiInputSnapshot {
  snapshotId: string;
  taskId: string;
  schemaVersion: number;
  inputType: string;
  payloadJson: unknown;
  bodyRefId?: string;
  sourceDraftId?: string;
  sourceDraftVersion?: number;
  baseContentHash?: string;
  contentHash: string;
  createdAt: string;
}

interface AiContextSnapshot {
  snapshotId: string;
  taskId: string;
  schemaVersion: number;
  sourceManifest: SnapshotSourceRef[];
  compiledContextRefId?: string;
  budgetJson: unknown;
  compilerVersion: string;
  contentHash: string;
  createdAt: string;
}

interface AiConstraintSnapshot {
  snapshotId: string;
  taskId: string;
  schemaVersion: number;
  payloadJson: unknown;
  promptTemplateId: string;
  promptTemplateVersion: string;
  promptTemplateHash: string;
  promptTemplateRefId?: string;
  providerOptionsJson: unknown;
  contentHash: string;
  createdAt: string;
}
~~~

### 4.1 AiInputSnapshot

| 字段 | 语义 |
|---|---|
| inputType | 与 taskType 对应的输入 schema 名称。 |
| payloadJson | 用户指令、生成模式、参数、显式目标 ID；版本化 JSON。 |
| bodyRefId | 可选；正文或大段参考文本的 large_text_documents 引用。 |
| sourceDraftId / sourceDraftVersion / baseContentHash | 正文类任务必填；锁定请求基线。 |

### 4.2 AiContextSnapshot

| 字段 | 语义 |
|---|---|
| sourceManifestJson | 每项来源的 sourceType、sourceId、version、contentHash、includeReason、顺序和裁剪信息。 |
| compiledContextRefId | 编译后的完整上下文大文本引用；不内联到 Task Store。 |
| budgetJson | 总预算、分区预算、实际字符/估算 token、截断/摘要策略。 |
| compilerVersion | 可重现编译规则的版本。 |

历史快照允许查看与回放解析，但“回放”不等于向 Provider 重新发送。重新执行必须经过显式确认并创建 Task/Attempt。

### 4.3 AiConstraintSnapshot

| 字段 | 语义 |
|---|---|
| payloadJson | 输出 schema、风格/字数、禁止事项、目标类型白名单、应用范围和质量门槛。 |
| promptTemplateId / promptTemplateVersion / promptTemplateHash | 使用的模板身份；模板正文如较长则引用大文本。 |
| providerOptionsJson | temperature、maxTokens 等非密钥参数；绝不保存 API Key。 |

项目后续变化不得修改旧 Snapshot。缺少来源版本/hash 的 legacy 数据只能标记 unknown，不得推断或回填。

### 4.4 章节生成 Context / Constraint Compiler（第一阶段）

章节正文生成在创建 `AiTask`、`AiTaskAttempt` 和调用 Provider 之前，必须由
`src/services/prompt/chapterGenerationCompiler.ts` 生成一对可复现合约：

- Context：当前作品、分卷、章节、章节大纲与关键点、当前采用正文、当前草稿基线、最近三个章节状态、前两章摘要、未解决线索、相关角色、世界规则、质量问题和当前章节工程状态。
- Constraint：按固定顺序输出 `must`、`should`、`forbid` 三类约束，覆盖本章大纲事件、角色身份/行为、工程中的时间线/地点/视角限制、世界规则、禁止提前发生剧情、目标字数、质量问题规避和“仅生成当前章节候选”的范围限制。
- 预算：Context 上限为 24,000 Unicode 字符，Constraint 上限为 12,000 Unicode 字符。关键章节目标与大纲优先保留；软背景按 `critical → high → normal → background` 顺序裁剪，硬约束超预算时 fail-closed。
- 隔离：编译器校验 `novelId → volumeId → chapterId → sourceDraftId/version/hash`，只读取当前作品的记录，只读取当前章节之前的摘要，禁止把后续章节或其他作品的内容带入快照。
- 隐私：编译前递归拒绝疑似 API Key、Authorization、credential 或 secret；Snapshot 和诊断日志不写入 Provider 凭据或完整 Prompt/正文日志。

Context Snapshot 持久化 `sourceManifest`、稳定 Context hash、裁剪统计和受预算的编译文本；Constraint Snapshot 持久化三类约束、稳定 Constraint hash、模板身份/正文 hash 和非密钥 Provider 选项。Provider 调用只能使用这一次已经冻结的合约。编译或 Snapshot 创建失败时不得创建 Attempt，也不得调用 Provider。

### 4.5 Chapter Constraint Validation and Diff Preview

For `chapter_generate`, the persisted Artifact is validated before any PlacementProposal is
created. The validator reads only the frozen task identity, Input/Context/Constraint Snapshots,
and Artifact body. It never reads the currently selected React chapter and never invokes a
Provider.

- `must` and `forbid` failures or unknown results produce `blocked`; `should` failures remain
  explicit warnings and require the normal user confirmation.
- Every run writes append-only rows to `artifact_validation_issues` under a unique
  `validationRunId`. Existing table severities remain compatible (`error` for hard constraints,
  `warning` for recommendations); the original constraint category and status are stored in the
  issue details. Messages contain short summaries only.
- The Rust authority checks the latest validation result when creating or validating a Proposal;
  ApplyPlan creation and execution re-enter that Proposal validation path. A missing or blocked
  result makes the Proposal stale or rejects its creation, so UI button state is not the authority.
- The preview compares only `sourceDraftId/sourceDraftVersion/baseContentHash` with the candidate
  Artifact. Paragraph diff data is computed in memory, never persisted or logged. Novel/chapter
  identity, source draft identity, version, or hash mismatch blocks adoption rather than falling
  back to a latest draft.

## 5. 权威状态机

非法转换统一返回 AI_TASK_ILLEGAL_TRANSITION，并在 details 中携带 taskId、from、to。并发更新使用 expected_status（或状态版本）进行 compare-and-swap；affected rows 必须为 1。

| 当前状态 | 允许进入 | 触发者 | 持久化位置 | 非法转换错误码 |
|---|---|---|---|---|
| created | preparing_context、cancelled、failed | Task service / 用户取消 | ai_tasks | AI_TASK_ILLEGAL_TRANSITION |
| preparing_context | ready、cancel_requested、failed | Context service / 用户 | ai_tasks | AI_TASK_ILLEGAL_TRANSITION |
| ready | queued、cancelled、failed | Scheduler / 用户 / Service | ai_tasks | AI_TASK_ILLEGAL_TRANSITION |
| queued | running、cancelled、failed | Worker / 用户 / Scheduler | ai_tasks + attempts | AI_TASK_ILLEGAL_TRANSITION |
| running | validating、cancel_requested、failed | Provider adapter / 用户 | ai_tasks + attempts | AI_TASK_ILLEGAL_TRANSITION |
| validating | completed、cancel_requested、failed | Artifact service / 用户 | ai_tasks + artifacts | AI_TASK_ILLEGAL_TRANSITION |
| completed | applying | 用户确认 / Apply service | ai_tasks + apply_plans | AI_TASK_ILLEGAL_TRANSITION |
| applying | applied、completed | Apply service | ai_tasks + apply_plans | AI_TASK_ILLEGAL_TRANSITION |
| applied | 无状态变化；只允许幂等查询 | Apply service | ai_tasks + target_links | AI_TASK_TERMINAL_STATE |
| failed | preparing_context、queued | Retry command（仅可重试原因） | ai_tasks + 新 attempt | AI_TASK_RETRY_NOT_ALLOWED |
| cancel_requested | cancelled | Worker / cancellation reconciler | ai_tasks + attempts | AI_TASK_ILLEGAL_TRANSITION |
| cancelled | 无 | — | ai_tasks | AI_TASK_TERMINAL_STATE |

### 5.1 关键场景

- 上下文构建失败：preparing_context → failed，保留结构化错误；无伪快照。
- queued 取消：原子 queued → cancelled，不创建 Provider 请求。
- running 取消：running → cancel_requested；Adapter 尽力 abort，最终 → cancelled。
- 迟到响应：Attempt → late_response_ignored，Task → cancelled；仅保存响应 hash/长度/Provider metadata，不连接 Artifact。
- completed 后应用：先创建 immutable ApplyPlan，再 completed → applying。
- applying 已知回滚：ApplyPlan → failed/blocked，Task → completed，Artifact 仍可重新规划。
- commit 结果未知：ApplyPlan → commit_unknown，Task 暂留 applying；必须按 operationId 对账后进入 applied 或 completed。
- applied 重复应用：不再执行 SQL，返回首次 ArtifactTargetLink/operation 结果。
- failed 重试：仅在快照和用户意图未改变时同 Task 新 Attempt；否则新 Task。
- cancelled 重新运行：始终新 Task。

## 6. 前后端职责

### 前端

- src/stores/aiTaskStore.ts：任务摘要、活跃 ID、订阅状态；不保存正文。
- src/services/ai-tasks：创建、取消、重试和查询命令。
- src/hooks/useAiTask.ts：UI 订阅与事件绑定，不含 Provider 或 SQL。
- 旧面板按优先级逐个迁移；未迁移入口继续旧链路但不得扩展。

### Rust

- commands/ai_tasks.rs：参数解码、身份与权限边界。
- services/ai_task_service.rs：状态机、幂等、Attempt 编排。
- repositories/ai_task_repository.rs：SQL 与 affected rows 校验。
- Provider Adapter：统一超时、取消句柄、请求 metadata、错误归一化；禁止 UI 直接调用 ai_chat_completion。

## 7. 迁移接入顺序

1. 先落表、状态机和纯函数/SQLite 测试。
2. 接入连接测试与只读分析类入口，验证 Task/Attempt/Snapshot/Artifact。
3. 接入正文生成、润色和质量检查，但正文仍只生成候选草稿。
4. 修复原子草稿保存中的 aiTaskId/note 来源丢失，再启用 ArtifactTargetLink。
5. 最后迁移大纲、人物、事件、设定与总结等业务落位入口。

任何阶段都不得让占位 Store 接管未完成的生产请求，也不得删除 legacy 表或历史读取能力。

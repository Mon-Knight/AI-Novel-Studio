# v2.3.0 AI 执行事实层（M1）

> 状态：已实现并冻结
> 适用版本：v2.3.0
> 边界：持久执行数据面，不包含生产 Provider、Planner、Memory、Apply 或 Multi-Agent

## 1. 目的

执行事实层用于回答以下问题，并且答案在应用重启后仍可验证：

- AI 为什么执行这项任务？
- 它读取了哪一版正文、上下文、约束和 Prompt？
- 哪个 Attempt 调用了哪个 Provider / Model？
- Provider 返回的完整原始结果是什么？
- 结果通过了哪些校验，为什么有效或无效？
- 相同操作重试时，是否返回首次提交的同一事实？

旧 `ai_task_records` 和 `generation_jobs` 无法完整证明这些关系，因此继续作为 Legacy 保留，但不回填虚构的 Snapshot、Attempt 或 Artifact。

## 2. 持久模型

```text
AiTask
├── AiInputSnapshot ─────── large_text(input_body)
├── AiContextSnapshot ───── large_text(compiled_context)
├── AiConstraintSnapshot ── large_text(prompt_template)
├── AiTaskAttempt[]
└── ResultArtifact[] ────── large_text(raw/display/structured)
    └── ArtifactValidationIssue[]
```

七类权威事实：

1. `AiTask`：任务、目标、requestHash、预期 Artifact 契约和状态。
2. `AiTaskAttempt`：每次排队、领取、Provider 身份、响应身份、失败与取消。
3. `AiInputSnapshot`：输入类型、结构化输入及来源草稿 version/hash。
4. `AiContextSnapshot`：来源清单、预算、compilerVersion 与完整编译上下文。
5. `AiConstraintSnapshot`：约束、Prompt 模板身份/正文及白名单 Provider 选项。
6. `ResultArtifact`：完整原始结果、展示结果、结构化结果和权威来源身份。
7. `ArtifactValidationIssue`：按 validation run/index 排序的追加式校验问题。

## 3. Task 创建与 requestHash

Task 和三类 Snapshot 在同一个 SQLite `IMMEDIATE` 事务中创建。Rust 后端负责计算 canonical requestHash；调用方提供的 hash 只能用于交叉校验，不能成为权威值。

requestHash v1 覆盖：

- request contract version；
- task type、scope、novel/chapter/draft 目标；
- 预期 Artifact type/schema；
- target hint；
- Input schema/type/payload/body SHA-256/source draft/version/base hash；
- Context schema/source manifest/compiled context SHA-256/budget/compilerVersion；
- Constraint schema/payload/template id/version/声明与实际正文 hash；
- 白名单化后的 Provider options。

JSON 在 hash 前递归按 key 排序。相同 `operationId + requestHash` 返回首次 Task；相同 operationId 携带不同请求时返回 `OPERATION_PAYLOAD_CONFLICT`。

## 4. 状态与并发

Task 关键执行边：

```text
ready → queued → running → validating → completed
  │        │         │          │
  └────────┴─────────┴──────────┴→ cancelled / failed
failed(retryable) → queued（创建新 Attempt）
```

Attempt 关键执行边：

```text
queued → running → succeeded
  │         ├──────→ failed
  │         └──────→ cancel_requested → cancelled
  └────────────────→ cancelled
cancelled/cancel_requested/running → late_response_ignored（仅取消竞态）
```

每个 Task 同时最多一个 `queued/running/cancel_requested` Attempt。Task 和 Attempt 都使用状态 + `state_revision` CAS；Attempt 必须以 `(taskId, attemptId)` 联合身份操作，不能跨 Task 使用。

queue、claim、Provider success/failure、取消及根 Artifact 都支持同身份重放，用于处理“数据库已提交，但 IPC 响应丢失”的窗口。重放参数变化时拒绝，不覆盖历史事实。

## 5. Artifact 与来源证明

Artifact 写入前必须同时满足：

- Task 正处于 `validating`；
- Attempt 属于 Task、为当前 Attempt 且已 `succeeded`；
- type/schema 与 Task 冻结的预期契约一致；
- raw body 的 SHA-256 和字符长度与 Attempt 的 Provider response metadata 一致；
- novel/chapter/draft/version/base hash 从持久 Input Snapshot 派生，不接受 IPC 自报来源；
- 父子关系（后续版本开放写入时）必须属于同一 Task。

JSON 解析失败会创建 `invalid` Artifact 和追加式 Issue，完整 raw body 仍保留。有效或带 warning 的 Artifact 令 Task 进入 `completed`；无效 Artifact 令 Task 进入可显式重试的 `failed`。

## 6. 不可变与大文本

以下对象建立后不可更新或删除：

- 三类 Snapshot 整行；
- Task / Attempt 的身份字段；
- Artifact 的 Task、Attempt、类型、schema、全部来源、全部内容引用/hash/length、父子身份和创建时间；
- ValidationIssue 整行。

Snapshot 与 Artifact 引用的 `large_text_documents` 和 `large_text_chunks` 同样由触发器冻结，避免只冻结引用行、却绕过引用直接篡改正文。写入顺序固定为：

```text
document → 全部分片 → Snapshot/Artifact 引用
```

读取时仍重新校验分片顺序、字符/字节数、分片 hash、全文 hash、document 目标和上层事实 hash。

## 7. 凭据与日志边界

- Snapshot JSON、正文、上下文、Prompt、Artifact 和 Provider metadata 均执行疑似凭据检测。
- Provider options 与 response metadata 使用后端字段白名单和大小限制。
- response metadata 只允许 Provider、Model、requestId、responseHash/length、token 计数、finishReason 和 duration 等标量。
- AppError 入库前移除任意调用方 details，仅保留安全 code/message/retryable。
- 普通日志不得输出正文、Prompt、上下文、Provider raw body、headers 或 API Key；新 Task IPC 日志只记录命令名。

## 8. IPC 与前端边界

桌面端提供创建、读取、列出、排队、领取、Provider 结果确认、失败、取消及 Artifact 创建/读取命令。前端 `aiTaskRuntimeService` 只是薄 IPC facade：

- 不包含 Provider 调用；
- 不包含业务 UI；
- 不在浏览器模式伪造 LocalStorage 持久化；
- 不允许通用、任意的 Task 状态跳转命令；
- 不执行 Placement 或正式正文写入。

## 9. 后续依赖顺序

```text
M1 执行事实层（本版本）
→ Provider Adapter 与统一执行管线
→ PlacementProposal / ApplyPlan / 来源链接
→ Context / Constraint Compiler 与 Tool Registry
→ Planner、lease、checkpoint、跨重启恢复
→ Memory / Verification
→ Multi-Agent Orchestrator 与专业 Agent 协作
```

只有上游事实和安全边界通过动态验证后，下游能力才可接入生产入口。

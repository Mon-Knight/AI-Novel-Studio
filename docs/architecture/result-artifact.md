# Result Artifact 架构冻结

> 适用版本：v2.3.0
>
> 状态：内容边界与校验契约

## 1. 定位

ResultArtifact 是 Provider 输出经过本地封装后的不可变候选，不是正式项目数据。Provider 返回的正文、JSON、建议或分析必须先成为 Artifact，完成解析和校验后才允许进入 PlacementProposal。

~~~ts
type ArtifactType =
  | 'chapter_text'
  | 'outline'
  | 'character_candidates'
  | 'event_candidates'
  | 'setting_candidates'
  | 'style_analysis'
  | 'quality_report'
  | 'chapter_summary'
  | 'volume_summary'
  | 'generic_text'
  | 'generic_json';

interface ResultArtifact {
  artifactId: string;
  taskId: string;
  attemptId: string;
  artifactType: ArtifactType;
  schemaVersion: number;
  rawContentRef?: string;
  displayContentRef?: string;
  structuredPayload?: unknown;
  sourceSnapshot: {
    novelId: string;
    chapterId?: string;
    draftId?: string;
    draftVersion?: number;
    baseContentHash?: string;
  };
  validation: {
    status: 'valid' | 'valid_with_warnings' | 'invalid';
    errors: ArtifactValidationIssue[];
    warnings: ArtifactValidationIssue[];
  };
  createdAt: string;
}
~~~

## 2. 字段语义

| 字段 | 冻结语义 |
|---|---|
| artifactId | UUID；Artifact 内容身份。 |
| taskId / attemptId | 追溯用户意图与实际 Provider 执行；一个 Task/Attempt 可产出多个 Artifact。 |
| artifactType | 解析、展示、Placement 白名单与校验器选择依据。 |
| schemaVersion | structuredPayload 的 schema 版本，不是应用版本号。 |
| rawContentRef | 原始 Provider 内容的 large_text_documents 引用；解析失败也应保留。 |
| displayContentRef | 经安全格式化、可供 UI 展示的内容引用；不得反向覆盖 raw。 |
| structuredPayload | 小型结构化结果；大文本字段只能存引用。 |
| sourceSnapshot | 从 Task 三类快照复制出的权威来源身份，创建后不可改。 |
| validation | 当前校验结论；具体 issue 是独立 append-only 行。 |
| createdAt | Artifact 首次持久化时间。 |

structuredPayload 中的 targetId、chapterId 等都只能作为 AI hint，不能覆盖 sourceSnapshot 或 Placement 的后端校验结果。

## 3. 与 Provider 响应的关系

1. Attempt 保存 Provider request ID、用量、finish reason、响应 hash/长度等 metadata。
2. 非取消响应的完整 raw body 进入大文本完整性存储。
3. Parser 可从同一 raw response 生成多个 Artifact，例如六个章节大纲候选。
4. Parser 失败仍创建 generic_text 或 generic_json Artifact，processingStatus=invalid，并记录 ARTIFACT_PARSE_FAILED；不能只保存 500 字摘要。
5. cancel_requested 之后到达的响应不创建可应用 Artifact；Attempt 标为 late_response_ignored。

## 4. 不可变策略

- rawContentRef、displayContentRef、structuredPayload、sourceSnapshot、schemaVersion 创建后不可修改。
- 用户编辑候选时创建新 Artifact，并记录 parentArtifactId 与 derivationType=user_edit；不原地覆盖。
- 重新解析旧 raw response 创建新 Artifact/schemaVersion；旧 Artifact 保留。
- 校验 issue 可追加，校验批次带 validatorVersion；不能改写旧 issue。
- 应用只新增 ApplyPlan、ApplyOperation 和 ArtifactTargetLink，不改变 Artifact 内容。

## 5. Artifact 状态决策

数据库只持久化 processing_status：

~~~text
raw → parsing → valid | valid_with_warnings | invalid
~~~

用户可见的扩展状态从关系数据可靠推导，避免一列同时承担多个维度：

| 展示状态 | 推导规则 |
|---|---|
| raw | processing_status=raw |
| parsing | processing_status=parsing |
| valid | validation.status=valid 且尚无可用 Proposal |
| valid_with_warnings | validation.status=valid_with_warnings 且尚无可用 Proposal |
| invalid | validation.status=invalid |
| ready_for_placement | 校验可用且存在未过期 Proposal/ready ApplyPlan |
| partially_applied | 至少一个 committed target link，且计划中仍有未提交目标 |
| applied | 该 ApplyPlan 的全部操作都有 committed target link；若存在多个 Plan，按所选 Plan 展示 |

processing_status 的转换由 Artifact service 权威校验。关系状态必须以数据库查询为准，前端不能 optimistic 标记 applied。

## 6. 校验层次

| 层次 | 示例 | 失败行为 |
|---|---|---|
| 传输完整性 | 非空、finish reason、response hash | invalid；保留 raw |
| 语法/Schema | JSON 可解析、字段类型、schemaVersion | invalid；记录解析路径 |
| 身份边界 | novelId/scope 与 Task 一致 | invalid；忽略 AI targetId |
| 内容约束 | 正文字数、禁用项、必需角色、候选数量 | warning 或 error |
| 基线一致性 | source draft/version/hash 完整 | 缺失为 error；legacy 显式 unknown |
| 大文本完整性 | chunk 数量、顺序、长度、SHA-256 | invalid/fail-closed |

ArtifactValidationIssue 至少包含 issueId、artifactId、validationRunId、severity、code、message、jsonPath、detailsJson、validatorVersion、createdAt。message/details 禁止写入完整正文或 Prompt。

## 7. 多 Artifact 与多次应用

- 一个 Task 可以产生多个 Artifact；task.resultArtifactId 只指主结果。
- 一个 Artifact 可以生成多个 PlacementProposal 和 ApplyPlan。
- 同一 Artifact 可以应用到多个合法目标，但每次都必须有独立且不可变的 ApplyPlan。
- UNIQUE(plan_id, operation_index) 与 UNIQUE(operation_id) 防止重复写入。
- 同一 artifactId、targetType、targetId、contentHash 的重复应用默认被拒绝或幂等返回既有 target link；不能静默创建重复角色/设定。

## 8. 与正式业务数据的边界

Artifact 只描述“AI 产出了什么”。正式数据仍由现有 Repository/Service 管理：章节正文通过 save_chapter_draft_atomic 创建候选草稿，大纲通过 outline service，人物/事件/设定通过各自 repository。Artifact 不直接成为 chapter、character、world_setting 等行。

成功事务必须新增 ArtifactTargetLink，记录 artifactId、planId、applyOperationId、targetType、targetId、targetVersion、targetHash、operationId 和 committedAt。删除/软删除正式目标不会删除 Artifact；链接保留并标记目标现状。

## 9. 安全与隐私

- 完整 raw、display 正文、Prompt 和上下文不进入 console、AppError、Task Store 或普通 JSON 日志。
- API Key 从不进入 Task、Attempt、Snapshot 或 Artifact。
- 大文本读取失败时 fail-closed，预览不能充当完整内容参与校验或应用。
- 导出 Artifact 需要用户显式操作；默认任务中心只显示摘要、hash、长度和校验状态。

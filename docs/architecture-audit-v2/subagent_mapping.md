# AI Novel Studio 整合版 SubAgent Mapping

## 1. 结论

当前代码拥有多个“需要模型的服务”，但只有 `workbenchChapterWriter` 形成了相对清晰的服务边界；它仍不是已验证的独立 SubAgent（没有独立 Agent loop、独立模型配置和真实外部模型证据）。

目标不是把每个旧 AI service 都注册成 SubAgent，而是建立 **6 类可复用 SubAgent contract**，每类只产出候选/报告，由 Artifact/用户确认协议落地。

## 2. 六类 SubAgent

| SubAgent ID  | canonical role          | 覆盖能力                                       | 当前代码来源                                                                         | 输出                                 | 生产落地                           |
| ------------ | ----------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------ | ---------------------------------- |
| SA-WRITING   | Writing SubAgent        | `writing.generate/continue/rewrite`            | `workbenchChapterWriter`、`chapterGenerationExecutionService`、prose orchestrator    | `chapter_text` ResultArtifact        | 审阅授权 → CAS adopt               |
| SA-STRUCTURE | Structure Planner       | outline、scene/事件/设定候选                   | `outlineGenerateService`、scene plan、setting/event services                         | typed structure candidate            | 用户确认 → structure/asset service |
| SA-CONTEXT   | Context SubAgent        | summary、model compression、context extraction | `chapterSummarizeService`、`novelContextCompressionProvider`、`volumeSummaryService` | summary/context candidate + evidence | 显式启用/Artifact apply            |
| SA-QUALITY   | Quality Reviewer        | quality report、gate、fix proposal             | `qualityCheckAiService`、`qualityGateRunner`、`qualityFixService`                    | immutable report + fix ranges        | 报告展示；局部修复再次确认         |
| SA-STYLE     | Style Analyst           | style profile、reference style extraction      | `styleAnalyzeService`、`layeredStyleAnalyzer`、`referenceStyleProfileService`        | style profile proposal               | 用户确认后激活                     |
| SA-PLANNING  | Story Planner/Consensus | autonomous plan、multi-agent opinions          | autonomous/multi-agent services                                                      | plan/opinion report                  | 暂隔离；未来 feature flag          |

SA-PLANNING 不在首期 Agent allowlist；它是未来扩展契约，不是当前 production capability。

## 3. 统一 SubAgent 输入合同

```ts
interface SubAgentInput {
  taskId: string;
  novelId: string;
  chapterId?: string;
  userInstruction: string;
  contextSnapshot: {
    contextHash: string;
    sourceRevisions: Record<string, number>;
    compiledContextRef?: string;
  };
  modelSnapshot: TaskModelSnapshot;
  allowedReadTools: string[];
  budget: { maxTokens: number; timeoutMs: number };
  signal?: AbortSignal;
}
```

要求：

- `novelId/chapterId` 显式传递，后端再次做 ownership 校验。
- Context 在 SubAgent 开始前冻结；不能在生成中偷偷读取新的章节或切换作品。
- model snapshot 包含 provider/model/runtime/options/pricing，但不携带 API key 到持久化事实。
- 只允许 canonical read/search Tool；写入由宿主处理。
- 取消、超时、预算拒绝必须形成失败事实，不产生半成品 Artifact。

## 4. 统一 SubAgent 输出合同

```ts
interface SubAgentCandidate {
  artifactType:
    | 'chapter_text'
    | 'outline'
    | 'character_candidates'
    | 'event_candidates'
    | 'setting_candidates'
    | 'chapter_summary'
    | 'quality_report'
    | 'style_profile';
  sourceNovelId: string;
  sourceChapterId?: string;
  contextHash: string;
  sourceRevisions: Record<string, number>;
  content: string;
  contentHash: string;
  validation: { status: string; issues: unknown[] };
  candidateOnly: true;
  modelSnapshotId: string;
}
```

SubAgent 不返回 `adopted=true`、`writeCompleted=true` 或任意伪造的 confirmation。Artifact service 负责不可变存储和 hash，宿主负责 Card/Decision/Authorization。

## 5. 各 SubAgent 的隔离细则

### SA-WRITING

当前最接近目标，但要补齐：

1. 独立 role/prompt（不能复用 Main Agent 的任务 prompt）。
2. 独立允许读取工具清单：`novel.read`、`structure.read`、`context.read`、`memory.search`、`style.read`。
3. 只返回 `chapter_text` candidate；不得调用 `draft.save`/`adopt`。
4. `generate`、`continue`、`rewrite` 都复用同一 execution core，但 mode 明确、source hash 明确。
5. 真实 Provider smoke 后才能从 PARTIAL 升级。

### SA-STRUCTURE

- 大纲/事件/设定/场景属于不同 artifact type，不可返回宽泛 JSON。
- 生成前读取 structure/context/memory，生成后通过 schema validator。
- 不能像旧 `outlineGenerateService` 一样直接保存正式大纲或创建卷章。

### SA-CONTEXT

- `novelContextCompressionProvider` 的 extractive 压缩应标为 deterministic provider，不冒充 LLM SubAgent。
- 模型总结必须携带采用正文版本和来源记录。
- 旧 `useWorkspaceSummary` 生成控制器迁移后只做 adapter。

### SA-QUALITY

- `qualityCheckService` 是正式报告事实源。
- AI reviewer 产出报告，局部 fix 产出 patch/proposal，不直接覆盖全文。
- fix 必须带 source/target draft hash、changed ranges、before/after report。

### SA-STYLE

- 风格分析输入可来自粘贴样本或 reference sections，但必须记录来源。
- 分析结果是 proposal；激活 profile 是用户确认动作。
- `styleProfilePromptProjection` 只是运行时投影，不是第二份 profile。

### SA-PLANNING

- autonomous/multi-agent 目前是 legacy/experimental。
- 未来若重新接入，规划只能生成 plan candidate，scheduler/lease 仍是宿主内部设施。
- 多意见综合不能成为写入正式正文的快捷路径。

## 6. 当前实现与目标差距

| 检查项         | 当前 writer                                   | 目标 SubAgent                          |
| -------------- | --------------------------------------------- | -------------------------------------- |
| 独立 Prompt    | 有标准生成 prompt，但与任务 runtime 耦合      | role-specific immutable prompt         |
| 独立模型       | 复用 `TaskModelSnapshot`，无独立配置          | role snapshot + policy limit           |
| 独立上下文     | 编译章节 context，基本有                      | 明确 source revision/hash，禁止漂移    |
| Tool allowlist | 内部直接调用 execution service                | 只读 Tool facade + schema              |
| 正式写库       | 不写正式采用事实，但写 AI task/artifact facts | 仅 Artifact facts，不能写 domain facts |
| 取消/预算      | execution pipeline 有部分治理                 | contract-level mandatory               |
| 真实模型证据   | E2E 默认 Mock                                 | Provider smoke + negative cases        |
| 产物交付       | ResultArtifact 已有                           | 所有 role 统一 candidate contract      |

## 7. SubAgent 迁移顺序

### S0：先给 writer 加 contract wrapper

不改变生成算法，只把现有 `workbenchChapterWriter` 包成 `WritingSubAgentAdapter`，统一输入/输出/失败分类。

### S1：迁移 context/quality/style

先复用现有服务，移除 UI 直接写入；所有结果经过 Artifact candidate。

### S2：迁移 structure

修 outline ownership 后，再接 outline/character/event/setting candidate；旧 UI 仅显示 proposal。

### S3：隔离 planning

把 autonomous/multi-agent 放到实验 manifest，不得进入默认 Main Agent prompt。

## 8. SubAgent 验收矩阵

每类 SubAgent 至少需要：

- 同一作品连续三次生成，context hash 可追溯。
- 两个作品并发，不能串书。
- 重启/取消/超时后无半成品正式事实。
- candidate 内容可审阅，拒绝后正式事实不变。
- 无 API key/raw provider body 泄漏。
- 真实模型与 Mock 分开标记，不能共用“PASS”结论。

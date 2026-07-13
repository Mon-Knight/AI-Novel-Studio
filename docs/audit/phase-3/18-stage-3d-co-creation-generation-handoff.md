# v2.3.0-M6 — 共创大纲任务、章节生成交接与双向深链验收说明

## 1. 范围与停止边界

M6 完成 AI 共创到现有大纲与章节生成能力的安全入口，不建立新的正式作品数据、任务系统或正文 Worker。正式应用版本继续保持 `2.2.0`。

本里程碑交付：

- 共创页结构化生成任务卡与不可变请求/回执；
- 作品总纲、指定卷纲和章节大纲后台 Workflow；
- `chapter_generation` 到工作台现有正文生成面板的安全 handoff；
- AI 共创与工作台双向章节/对象/选区定位；
- 候选审查精确深链；
- Leave Guard、stale、scope 与幂等门禁。

完成 M6 后停止，不进入 M7。未实现导演治理、Story State、Multi-Agent、自动连续多章、自动生成后采用正文或批量自动修改关联对象。

## 2. 受限生成协议

`CoCreationGenerationRequestV1` 只允许四种 kind：

| kind | 目标 | 执行方式 |
|---|---|---|
| `master_outline` | 当前作品 | `compileNovelOutline → submitPrepared` 后台 Workflow |
| `volume_outline` | 当前作品中的精确 volume | `compileVolumeOutline → submitPrepared` 后台 Workflow |
| `chapter_outlines` | 精确 chapter 或当前作品中的 volume | `compileChapterOutlines → submitPrepared` 后台 Workflow |
| `chapter_generation_handoff` | 当前作品中的精确 chapter | 只创建工作台 handoff，不启动正文生成 |

请求固定携带 `requestId/requestHash`、稳定 operationId、scope、受限附加要求、`baseContextHash/baseDataRevision` 和来源共创草案身份。三类后台大纲还必须携带 `compiledInputHash`，章节 handoff 禁止携带该字段。章节大纲数量限制为 1～20；附加要求最多 2,000 字，章节计划最多 6,000 字；凭据、unsafe integer、非法 scope 和未知 kind 均失败关闭。

`baseContextHash` 固定 Canon 与待确认语义字段；`compiledInputHash` 固定 compiler version、最终 Prompt messages、input body/payload、scope/steps、排序来源 manifest 与非密钥 Provider 参数。prepared request 自身写入导致的已知 session CAS 递增不会改变 compiled hash，执行时最新 session revision/state hash 则作为独立 Rust 首次创建 guard。

请求与状态保存在 `co_creation_draft_revisions.payload_json.generationRequests`。记录状态为：

```text
prepared → submitted
prepared → handoff_ready
prepared → failed → retry with the same operationId（stale 除外）
```

字段编辑、建议采用、阶段切换和会话恢复会透传 `lastTurn`、generationRequests、stale 标记及其他持久字段，避免只重新序列化 fields/suggestions 而丢失回执。

## 3. 大纲数据流

```text
作者在共创任务卡核对 kind/scope/附加要求
  → 保存不可变 prepared request
  → 重开权威会话，验证最新草案存在精确 request lineage
  → 严格重编译最新 Canon、pending fields 与完整大纲输入
  → 复核 baseContextHash + compiledInputHash
  → submitPrepared（不再读取作品业务数据）
  → 现有 create_background_ai_workflow
  → Input / Context / Constraint Snapshot
  → AiTask DAG / Attempt / Worker
  → outline Artifact
  → review PlacementProposal
  → AI 任务中心人工审查
```

共创来源 manifest 统一为 `type/id/version/hash/role/status`，按 identity 排序且禁止冲突重复，包含 session CAS、来源 draft revision、request ID/hash、正式数据行、卷章/世界/规则集合 hash，以及活动总纲/卷纲/风格选择。严格读取失败不降级为空上下文。Rust 在首次创建 root operation 前验证同 session 归属、全部来源 guard、novel/volume/chapter 归属及 chapter-volume 一致性，并限制 chapterCount；未知类型、伪造 missing、非标量 guard 或 stale 来源在零 Task 状态失败。

后台 Workflow 使用稳定 operationId。完全相同的请求重放原 `workflowId/rootTaskId/childTaskIds`，不会重排 DAG、重新排队或复制节点；同 operationId 对应不同冻结输入时返回 payload conflict。root 已经存在后，完整或部分图恢复以原 Task Snapshot 为准，不再被之后的 Canon 变化阻断。

generation record 使用 `co-creation:{sessionId}:generation:{requestId}:{status}` 稳定 mutation ID，prepared/submitted/failed 时间统一为 `request.createdAt`。Workflow 已创建但记录保存响应丢失时，Controller 重开权威会话并重放同一 mutation；不会写入伪造的 failed 状态。

M6 没有扩展 outline Artifact 的正式大纲表 Apply：现有大纲 Proposal/ApplyPlan 仍只形成审查/TargetLink 记录。因此“大纲任务已生成 Artifact”不等于“已写入大纲 Canon”。

## 4. 章节正文交接

共创页不复制 `AiGeneratePanel`，也不新增 `chapter_generate` 后台 Worker。`chapter_generation_handoff` 只保存：

```text
handoffId / requestId / requestHash
novelId / volumeId / chapterId
chapterPlan / targetWordCount
baseContextHash
sourceDraftRevisionId / sourceDraftContentHash
```

工作台路由为：

```text
/novels/:novelId/workspace
  ?chapterId=:chapterId
  &panel=ai-generate
  &handoffId=:handoffId
```

工作台恢复 handoff 时再次检查 request/receipt 对应关系、最新 context hash 和 chapter scope。验证通过后打开现有 `ai-generate` 面板、切到“生成新稿”、预填章节计划及目标字数；不会自动点击生成。

作者手动启动后，正文仍使用原链路：

```text
compileChapterGeneration
  → unifiedAiPipeline (taskType=chapter_generate)
  → chapter_text Artifact
  → constraint validation
  → diff
  → PlacementProposal
  → CandidateReviewPane
  → 作者确认采用
```

确认前不自动创建正式正文，不自动采用，也不覆盖工作台未保存内容。

## 5. 双向深链与 Leave Guard

### 5.1 工作台 → AI 共创

工作台路由只携带 `chapterId`；选区通过 React Router `location.state` 临时交接，正文不进入 URL。交接记录包含全文 SHA-256、UTF-16 offset、选区文本/hash 和 draft 身份。

共创页写入对象上下文前读取最新完整 draft：

- 全文 hash、offset、选区文本和选区 hash 全部匹配时保存选区；
- dirty 正文被放弃、正文已变化、完整正文不可用或 offset 切开 surrogate pair 时，只保存章节/分卷/对象定位；
- 跨作品、跨章节或跨分卷交接失败关闭。

程序导航仍由 `useWorkspaceLeaveGuard` 拦截。dirty 正文提供保存、放弃、取消；保存失败保持原页面和 dirty 内容。`chapterGoalDirty` 使用已有独立确认，避免“保存正文”错误地宣称已经保存章节目标。

### 5.2 AI 共创 → 工作台

普通完整审查保留当前章节。候选审查使用：

```text
?chapterId=:chapterId&review=candidate&artifactId=:artifactId&taskId=:taskId
```

恢复时 Artifact、Task、novel 和 chapter 必须精确匹配。显式无效 chapterId、候选身份不一致或 handoff stale 时不回退首章或其他候选。

## 6. 数据结构与 migration

新增 TypeScript contract：

- `CoCreationGenerationRequestV1`
- `CoCreationGenerationRecordV1`
- `CoCreationWorkflowReceiptV1`
- `CoCreationChapterGenerationHandoffV1`
- `CoCreationWorkspaceDiscussionHandoffV1`

M6 无新 migration。请求、回执和讨论对象上下文写入 migration 020 已有共创草案 payload；后台任务复用 017～019，Artifact/Proposal/ApplyPlan 复用 012/013。001～020 checksum 不变。

## 7. 关键交互

1. 作者在右侧任务卡选择总纲、卷纲、章纲或章节交接。
2. 分卷/章节从当前作品的正式数据选择，不接受自由输入 ID。
3. 桌面端大纲任务提交后显示 root Task，可进入统一任务中心；浏览器模式显示明确不可用提示。
4. 章节交接卡显示“只预填、不自动生成/采用”；作者点击后进入精确章节的现有 AI 生成面板。
5. 非 stale 失败请求保留记录，可使用相同 operationId 重试；正式数据变化导致的 stale 必须重新准备，不能直接重试旧请求。
6. 正文候选继续在中央审查区查看完整正文、差异和约束；共创页只负责计划和快速导航。

## 8. 验证门禁

验收覆盖：权威多窗口 stale、双 hash 输入变化、严格读取失败、冻结提交无二次读取、Provider 参数冻结、manifest 去重/排序/冲突、session/集合/活动选择 Rust guard、部分图/完整图重放、记录响应丢失对账、handoff 完整性、工作台深链、Leave Guard 与未保存正文隔离。

最终结果：

| 门禁 | 结果 |
|---|---|
| `npx tsc --noEmit` | 通过 |
| `npm run lint` | 通过；0 error，保留既有 1 条 `react-hooks/exhaustive-deps` warning |
| `npm run test:co-creation` | 19 files，102/102 |
| `npx vitest run` | 63 files，297/297 |
| `npm test` | Node 正文安全 5/5 |
| `cargo test` | 203/203 |
| `cargo check` | 通过；保留既有 10 条 Rust warning |
| `cargo fmt --check` / `git diff --check` | 通过 |
| `npm run build` | TypeScript + Vite 生产构建通过；保留既有动静态导入提示 |
| `npm run tauri:build` | 通过；生成 MSI 与 NSIS 两种 2.2.0 安装包 |

安装包：

- `src-tauri/target/release/bundle/msi/AI Novel Studio_2.2.0_x64_en-US.msi`
- `src-tauri/target/release/bundle/nsis/AI Novel Studio_2.2.0_x64-setup.exe`

分支、最终 commit/tag 与 `git status --short` clean 证明在提交后完成汇报中给出；M6 提交后立即停止，不进入 M7。

## 9. 已知限制

- 大纲 Artifact 的现有 ApplyPlan 只记录人工审查与 TargetLink，不写入正式总纲/卷纲/章纲表。
- 浏览器开发模式不能创建后台大纲 Workflow；可使用 LocalStorage 验证共创草案与章节工作台 handoff。
- 共创页不显示或编辑完整章节正文，不替代中央审查区。
- 不自动连续生成多章，不自动采用正文，不自动批量修改关联对象。
- 未实现导演治理、Story State、Memory Planner 或 Multi-Agent。

## 10. 后续可扩展项（不属于 M6）

- 为大纲 Artifact 增加独立、可审查、事务化的正式大纲 Canon Apply。
- 在不复制编辑器的前提下增加更多共创任务卡筛选和 Artifact 摘要。
- 为 handoff 增加显式 rebase/差异合并，而不是 stale 后只允许重新准备。
- 在后续独立版本评估导演治理、Story State 与受控多 Agent 编排。

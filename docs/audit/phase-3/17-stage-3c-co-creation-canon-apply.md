# v2.3.0-M5 — AI 共创正式采用、冲突保护与反向撤销验收说明

## 1. 范围与边界

M5 把 M4 中作者已经逐项采用到共创草案的建议接入现有正式应用管线。它没有新建第二套 Canon、生成任务或应用系统，也不自动采用正文。

本里程碑支持的正式目标为：

- 冻结创作意图；
- 世界背景；
- 规则体系；
- 主角角色与作品主角投影。

大纲与章节生成安全交接属于 M6。正式应用版本仍为 `2.2.0`。

## 2. 正式采用协议

`PrepareCoCreationApplyInput` 固定提交：

```text
operationId
novelId / sessionId
draftRevisionId / expectedDraftContentHash
suggestionIds[]
optional parentPlanId
```

Rust 在创建计划前重新读取不可变草案与原始 Artifact，并验证：

- 草案是当前 session 的最新 revision，且 content hash 一致；
- 建议已经是 `accepted_to_draft`，字段状态为 `user_confirmed`；
- 一次请求只来自同一 Message / Task / Artifact；
- Artifact 属于当前作品、协议有效、未 stale；
- candidate hash 可从 Artifact 原始建议按前端相同的规范化规则重算；
- 覆盖已有值时已记录 `confirmedReplacement=true`；
- 存在阻断冲突时已记录 `conflictsAcknowledged=true`；
- 目标字段的原值未变，且传入的目标 version/hash 与当前值一致。

前端在准备正式写入前还会重新编译完整共创上下文；`baseContextHash` 不一致时不会调用正式准备命令。

## 3. Proposal → ApplyPlan → Canon

```text
CoCreationTurn ResultArtifact
  → 作者逐项采用/编辑的共创 Draft Revision
  → prepare_co_creation_apply
  → 子 PlacementProposal（保留 parentProposalId）
  → co_creation_canon_apply_v1 ApplyPlan
  → 作者第二次明确确认
  → execute_apply_plan
  → 同一 BEGIN IMMEDIATE 事务中的 Canon + TargetLink + Plan completed
```

Plan 每个正式目标有独立 `ApplyOperation`、payload hash、expected version/hash 和 `ArtifactTargetLink`。任一写入失败，全部 Canon、TargetLink 与 Plan 完成结果整体回滚。相同 operationId/requestHash 重放首次结果；相同 operationId 但 payload 不同时拒绝。

任一正向 Plan 完成后，同作品当前及历史 `co_creation_turn` Artifact 都会追加 stale 事件。尚未采用的同轮建议不能在新的 Plan 中继续直写，必须根据最新 Canon 重新生成或 rebase；已经完成的 Plan 仍可幂等重放，反向撤销也不依赖旧 Artifact 的有效状态。

## 4. Canon 合并语义

### 4.1 世界与规则

结构化字段写入 `structured_json.coCreationFields`，保留原自由文本。系统同时记录 `coCreationBaseContent` 和 `coCreationRenderedContentHash`。如果结构化工作台在上一次采用后又修改了 `content`，下一次共创会把当前正文提升为新 base，不会回写旧文本。

### 4.2 主角

主角操作在一个事务中同步：

- `characters` 中的精确目标角色；
- `novels.protagonist_mode`；
- `novels.protagonists_json`；
- `novels.main_character`；
- `novels.protagonist_ability`。

更新时先按 profile `id === targetId` 定位；只有新建单主角时才允许回退 primary。更新已有角色不改写其 `source/source_type`。完整作品主角投影参与 stale hash，因此采用后任一投影列又被修改时，撤销会阻断并要求差异合并。

### 4.3 创作意图

创作意图继续复用不可变冻结 revision。撤销有上一版时追加精确恢复 revision；首个意图被撤销时追加一条 `requires_confirmation + rejected` 的审计 tombstone。该 tombstone 不是作者确认事实，不进入下一轮共创的已确认意图上下文。

## 5. 反向撤销

`prepare_co_creation_undo` 只接受已完成的正向共创 Plan。它按逆序创建 `co_creation_canon_undo_v1` Proposal/ApplyPlan，其 `parentProposalId` 和 `parentPlanId` 指向正向记录。

准备撤销前必须使用正向 TargetLink 复核当前目标 version/hash。如果正式数据已在采用后被用户修改，撤销不得覆盖，而是以 stale 阻断。新建目标执行精确删除，更新目标恢复完整 before 快照。所有历史 Proposal、Plan、Operation 和 TargetLink 都保留。

## 6. 前端交互

1. AI 建议仍先逐项采用到草案。
2. 正式区域按 Artifact 轮次分组，默认选中最新轮次，不会混合两个 Artifact。
3. “准备正式写入”只创建 Proposal/ApplyPlan，界面显示精确目标、action、字段与关联影响。
4. 只有点击“确认执行 ApplyPlan”才进入正式事务。
5. 完成后的 Plan ID 保存在新的不可变草案 revision 中，重启后仍可准备反向撤销。

## 7. 数据结构与 migration

新增 wire contract：

- `PrepareCoCreationApplyInput`
- `PrepareCoCreationUndoInput`
- `CoCreationApplyPreparationV1`
- `CoCreationAffectedTargetV1`
- `co_creation_canon_apply_v1`
- `co_creation_canon_undo_v1`

M5 无新 migration。它复用 012 的 PlacementProposal、013 的 ApplyPlan/TargetLink 和 020 的共创会话/operation。001～020 definition/checksum 不变。

## 8. 验证门禁

最终结果：

- TypeScript `tsc --noEmit`：通过；
- ESLint：通过，保留基线已有 1 条 Hook dependency warning；
- 共创专项 Vitest：12 files，60/60；
- 全量 Vitest：56 files，253/253；
- Rust 共创正式采用定向：15/15；
- Rust 全量：194/194；
- `cargo fmt --check` 与 `cargo check`：通过，保留基线已有 10 条 warning；
- Vite 生产构建：通过，保留既有动静态导入提示；
- Tauri MSI/NSIS 完整构建：通过；
- `git diff --check`：通过；提交后的 clean 检查记录在 M5 commit/tag 后。

## 9. 已知限制

- 浏览器开发模式只支持共创讨论与草案；跨 Canon 原子事务仅在 Tauri/SQLite 权威实现中可用。
- 共创页不复制完整正文编辑器，不自动采用正文。
- 大纲生成、章节计划与正文候选审查交接由 M6 交付。
- 不实现自动连续生成多章、批量修改关联对象、导演自动推进或 Multi-Agent。

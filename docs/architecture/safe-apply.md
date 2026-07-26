# v2.3.2 Safe Apply：单目标安全应用

> 状态：已实现并冻结
> 适用版本：v2.3.2
> 边界：`setting_candidates@1` 的一个候选创建一条 `world_setting`，必须由用户显式确认

## 1. 目的

Provider 结果成为 Artifact 后仍是候选事实，不能直接等同于正式业务数据。Safe Apply 用可验证、可重放、失败关闭的中间层回答：

- 哪个 Artifact 的哪条候选将产生什么副作用？
- 目标在计划创建时必须处于什么状态？
- 谁确认了应用，何时确认？
- 数据库提交响应丢失后，重试会不会重复写入？
- 正式目标后来变化时，旧应用结果还能否被陈旧重放？

## 2. 数据流与信任边界

```text
completed AiTask
└── valid setting_candidates@1 ResultArtifact
    └── candidate[index] + canonical candidateHash
        └── PlacementProposal（不可变）
            └── ApplyPlan awaiting_confirmation（单 effect）
                └── 用户点击确认
                    └── SQLite IMMEDIATE transaction
                        ├── world_settings INSERT
                        ├── ArtifactTargetLink INSERT
                        └── ApplyPlan applying → applied
```

AI、UI 和 IPC 调用方都不能自报可信来源或最终 hash。Rust 服务从持久 Artifact 重新读取候选、重算 canonical hash/effect/Proposal hash/Plan hash，并由 SQLite 外键、唯一约束和触发器再次约束关系。

## 3. PlacementProposal

当前只允许：

```text
proposalType = create_world_setting
targetType   = world_setting
```

Proposal 冻结以下内容：

- Artifact ID、候选 index 与候选 canonical SHA-256；
- 目标作品、预分配 targetId；
- `expectedTargetVersion = 0`；
- “指定 targetId 不存在”的 canonical expectedTargetHash；
- 唯一 `create` effect payload；
- 覆盖以上字段的 proposalHash。

同一 `(artifactId, candidateIndex)` 只能建立一个 Proposal。同一输入重放返回首次 Proposal/Plan；Proposal 禁止 UPDATE 和 DELETE。

## 4. ApplyPlan

Plan 与 Proposal 一对一，operationId 固定为 Plan 身份的一部分。planHash 覆盖 Proposal 身份/hash、operationId、目标前置条件及仅有的一个 effect。

```text
awaiting_confirmation → applying → applied
                              └──→ conflict
```

- awaiting 不得记录确认人或确认时间；
- 首次进入 applying 必须同时写入 `confirmedBy=user` 与 `userConfirmedAt`；
- 确认只能记录一次；
- 身份、目标、前置条件和 effect 不可更新；
- applied 必须已有匹配 ArtifactTargetLink 和 result JSON；
- Plan 不允许删除。

## 5. 用户确认与单事务副作用

前端只有在桌面端取得持久 PlacementBundle 时显示“确认加入设定库”。点击后发送冻结的 `planId + operationId + expectedPlanHash`，Rust 在 `IMMEDIATE` 事务中：

1. 权威读取 Plan、Proposal、Artifact 和候选；
2. 重算并比对所有 hash 与来源关系；
3. CAS 将 awaiting 标记为 applying，并记录用户确认；
4. 确认预分配 targetId 仍不存在；
5. 插入一条 world_setting；
6. 计算完整业务目标 hash 并插入 ArtifactTargetLink；
7. 写入 result JSON，将 Plan 标记 applied；
8. 一次性提交。

任何步骤失败都会回滚 world_setting、Link、确认和状态。当前不包含第二个业务副作用，也不支持批量/多目标 Plan。

## 6. 目标 hash、冲突与来源链接

目标不存在 hash 覆盖 targetType、targetId、`exists=false` 和 version 0。应用后的目标 hash 覆盖 world_setting 的 ID、作品、标题、正文、structured JSON、启用状态、创建/更新时间和逻辑 version 1。

若预分配 targetId 已存在，Plan 从 applying 进入 conflict，已有目标不被覆盖。成功 Link 保存：

- Artifact / Proposal / ApplyPlan 联合来源；
- `relationship = created_from`；
- target type/ID；
- target version 1/hash。

Link 插入时数据库要求 Proposal、Plan、Artifact 和 world_setting 归属一致，且 Plan 正处于 applying。Link 整行不可更新或删除。

## 7. 幂等与提交状态未知

相同 `planId + operationId + expectedPlanHash` 重放：

- awaiting：执行首次应用；
- applied：重新读取同一个 Link 和 world_setting，通过 hash 后返回 `replayed=true`；
- conflict：返回稳定冲突，不尝试覆盖；
- applying：返回可重试的 in-progress，避免并行副作用。

若 IPC 返回 `DATABASE_COMMIT_UNKNOWN`，前端只重放同一个调用。若首次提交成功，读取首次结果；若事务未提交，则重新执行唯一一次副作用。普通业务冲突不会被自动重放。

applied 目标被删除、修改，或 Link 与 Proposal/Plan 不一致时返回 `PLACEMENT_TARGET_CHANGED`，不能把旧 result JSON 当作成功证明。

## 8. 浏览器与 Provider 边界

- 浏览器开发回退可返回 ephemeral 候选，但不创建 LocalStorage Proposal、Plan 或 Link。
- 没有持久 PlacementBundle 的候选不显示正式采用按钮。
- 本版本不改变 Provider Adapter、网络请求、模型参数或 Prompt；无需再次调用真实 API。
- Task 在 Artifact 成功后保持 completed；业务应用状态由 Plan/Link 表达，不篡改执行事实。

## 9. 版本边界

v2.3.2 不实现：

- 其他 Artifact 类型或正式对象；
- update/delete、批量或多目标 effect；
- Tool Registry、Planner、lease/checkpoint 或跨重启 worker；
- Memory、Verification、Multi-Agent 或 Agent 自主写入。

这些能力必须继续复用本版本的来源、确认、前置条件、事务和幂等边界，不得绕过 Safe Apply 直接写业务表。

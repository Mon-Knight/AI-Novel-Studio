# v2.6.0 Chapter Continuity Memory Facts

## 1. 范围

v2.6.0 只建立长期记忆的持久事实基础：Rust 从既有 SQLite 章节总结、上下文记录和角色状态编译 `memory_snapshot_v1`。快照用于冻结“在进入目标章节时，系统实际可用的连续性记忆是什么”。本版不调用 Provider、不修改正文或业务资产、不增加 Tool Registry 项，也不执行连续性语义判定。

## 2. 权威来源与时间边界

编译器固定为 `structured_memory_compiler_v1@1`。调用方只提交作品、目标章节、lookback、预算和 operationId，不能提交来源正文或伪造 manifest。

章节顺序为：

```text
volume.order_index
→ volume_id
→ chapter.order_index
→ chapter_id
```

只允许以下来源：

- 目标章节之前、lookback 范围内、绑定当前 adopted draft、enabled 且未过期的每章最新 `chapter_summaries`；
- 目标章节之前的 active、未过期 `context_records`，以及没有 chapterId 的作品级记录；
- 目标章节之前、角色仍 active 的 `character_states`，以及没有 chapterId 的作品级状态。

当前章节、未来章节、过期/禁用上下文和不再绑定当前正式正文的总结都不会进入候选集合。

## 3. 确定性选择与预算

候选按以下稳定优先级选择：

1. 作品级来源优先；
2. 更接近目标章节的来源优先；
3. importance 高者优先；
4. summary、context、character state 的固定类型顺序；
5. sourceId 稳定排序。

预算使用 canonical UTF-8 字节数，范围为 4 KiB～256 KiB，默认 64 KiB。每个来源是原子单元：能完整放入才标记 `included=true`，否则保留在 manifest 中并标记 `omissionReason=budget`；不截断事实正文，不把半条角色状态伪装成完整记忆。

## 4. 持久模型

```text
memory_snapshots
  └─ memory_snapshot_sources
```

`memory_snapshots` 冻结：

- operationId、canonical requestHash；
- contract/kind/compiler identity；
- novel/target chapter、target rank、lookback、budget；
- 完整 source manifest JSON/hash；
- 完整 memory JSON/hash、UTF-8 bytes；
- candidate/included/omitted 统计与创建时间。

`memory_snapshot_sources` 按单调 ordinal 冻结每条来源的 type/id、novel/chapter/rank、sourceVersion/hash、included 与 omissionReason。SQLite 约束 manifest 数量、memory 统计、items 数量和 budget 一致；来源 ordinal 不得超过 Snapshot 冻结的 candidateCount。

两表使用 `ON DELETE RESTRICT` 和 no-update/no-delete trigger。相同 operationId 只有 requestHash 完全一致时才重放首次快照；不同请求返回冲突。

## 5. 来源复验

`verify_memory_snapshot` 不修改快照。它执行三层检查：

1. 重算 request、stored manifest 和 stored memory hash/bytes；
2. 使用相同 compiler、lookback 与 budget 从当前 SQLite 重新编译；
3. 对来源身份集合报告 `changed`、`missing`、`unexpected`，并比较重新编译的 manifest/memory hash。

来源漂移不会重写历史快照。用户可创建新 operation 获得新快照，旧快照继续作为当时执行事实读取。

## 6. IPC 与 UI

正式命令：

```text
create_memory_snapshot
get_memory_snapshot
list_memory_snapshots_by_chapter
verify_memory_snapshot
```

工作台“章节连续性记忆”卡片只显示快照数量、预算省略和来源复验结果。浏览器模式明确拒绝创建，不使用 LocalStorage 伪造 SQLite Memory。

## 7. 安全与版本兼容

- 来源由 Rust 从本地数据库读取；普通日志不输出 memory JSON 或用户正文。
- 疑似凭据来源拒绝进入快照。
- 本版不修改 `tool_registry_v1`，其 hash 仍为 `846a38c25bba33c843b56fa6583b334bae3364073fb7f0b6290be0c405aae871`，既有 v2.5.0 Plan 可继续复验和重试。
- Memory Snapshot 是可由业务连续性资产重新编译的派生执行事实；schema 3 项目备份不伪造或迁移这些新事实，恢复后的作品创建新快照。
- 本版不实现向量检索、embedding、知识图谱、Continuity Verification、Provider Tool Calling、自动续跑、正文副作用或 Multi-Agent。


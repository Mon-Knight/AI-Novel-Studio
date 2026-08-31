# AI Novel Studio 整合版 Tool Mapping

## 1. 目标

Agent 不应看到 75 个实现能力、18 个漂移的 TS descriptor 或一串 legacy `generate_*` 名称。整合后的第一版 public manifest 目标是 **18 个核心动作**，按 Domain Capability 命名；实现细节和数据库 command 不进入模型视野。

> 当前 18 个动作只是 [Capability Catalog v1](./capability_registry_v1.md) 的资产化目标，全部处于 `catalog_only`；本文件的映射表不是当前生产 allowlist。任何“已完成 Tool”必须先通过 [Tool 工作性验证报告](./tool_health_validation.md) 的 handler 与负例门禁。

> Phase 1A-C 已为 `novel.read`、`structure.read`、`context.read`、`memory.search` 建立内部 descriptor 与固定 Facade adapter；Phase 1A-D 又建立共享 portable Manifest、TS 宿主门禁和 TS/Rust/DSH hash drift gate，但没有提升 exposure，模型可见数量仍为 0。详见 [Canonical Tool Projection](./canonical_tool_projection.md) 与 [Shared Canonical Manifest](./canonical_manifest_contract.md)。

```text
用户功能 → Domain Capability → canonical Tool/SubAgent adapter → Main Agent
```

## 2. 首期 18 个核心动作

|   # | Canonical name              | 类型             | 来源能力      | 模型是否直接执行       | 输出/落地                     |
| --: | --------------------------- | ---------------- | ------------- | ---------------------- | ----------------------------- |
|   1 | `novel.read`                | Tool             | PRJ-01/03～05 | 是（只读）             | 作品/设定摘要                 |
|   2 | `structure.read`            | Tool             | PRJ-07～09/17 | 是（只读）             | 卷章/大纲版本摘要             |
|   3 | `draft.read`                | Tool             | PRJ-10/11/12  | 是（只读）             | 草稿元数据/已采用正文引用     |
|   4 | `context.read`              | Tool             | PRJ-18        | 是（只读）             | 总结/上下文记录               |
|   5 | `memory.search`             | Tool             | PRJ-19/20     | 是（只读）             | 带来源与版本的记忆片段        |
|   6 | `characters.read`           | Tool             | PRJ-06/21     | 是（只读）             | 角色及可用状态                |
|   7 | `story_assets.read`         | Tool             | PRJ-22/24     | 是（只读）             | 仅 UI 已支持的势力/地点       |
|   8 | `reference.read`            | Tool             | PRJ-27        | 是（只读）             | 参考资料元数据/章节切片       |
|   9 | `style.read`                | Tool             | PRJ-25        | 是（只读）             | 活跃风格/输出控制             |
|  10 | `transfer.export`           | Tool（确认）     | PRJ-31/32     | 可发起，不可静默写文件 | 文件选择后的导出结果          |
|  11 | `writing.generate`          | SubAgent adapter | AI-03         | 由 SubAgent 生成       | `chapter_text` ResultArtifact |
|  12 | `writing.continue`          | SubAgent adapter | AI-03         | 由 SubAgent 生成       | 新候选，不覆盖原稿            |
|  13 | `writing.rewrite`           | SubAgent adapter | AI-08         | 由 SubAgent 生成       | 带 source hash 的新候选       |
|  14 | `structure.propose_outline` | SubAgent adapter | AI-04         | 由 SubAgent 生成       | outline candidate             |
|  15 | `context.propose_summary`   | SubAgent adapter | AI-10         | 由 SubAgent 生成       | summary/context candidate     |
|  16 | `quality.review`            | SubAgent adapter | AI-09         | 由 SubAgent 生成       | 不可变质量报告                |
|  17 | `artifact.review`           | Host protocol    | AG-07         | 只能发起待确认状态     | ReviewAuthorization/Card      |
|  18 | `artifact.apply_approved`   | Host protocol    | AG-08/PRJ-13  | 不由模型直接确认       | 已批准的领域事务结果          |

这 18 个动作不是要求本轮立即注册；它们是统一命名和迁移目标。首期实际 allowlist 可先只包含 1～9、11～16，17～18 由宿主 UI 控制。

## 3. Tool 契约要求

每个 canonical Tool 必须同时具有：

```json
{
  "name": "memory.search",
  "version": "1",
  "description": "在当前作品已采用事实中检索……",
  "inputSchema": {},
  "outputSchema": {},
  "scope": "novel",
  "permissions": ["novel.read"],
  "sideEffect": "none",
  "confirmationPolicy": "never",
  "sourceOfTruth": "sqlite.memory_documents",
  "runtime": "ts+gateway"
}
```

写入/文件动作必须把 `revision/hash/operationId/confirmationId` 作为契约字段；模型只能得到 proposal 状态，不能伪造 confirmed。

## 4. 旧名称迁移表

| 旧名称/实现                                             | 新 canonical                       | 处理                                       |
| ------------------------------------------------------- | ---------------------------------- | ------------------------------------------ |
| `novel.read_context`                                    | `novel.read`                       | 保留兼容 alias，manifest 中只显示新名      |
| `chapter.read_outline`                                  | `structure.read`                   | 兼容 alias；补 ownership                   |
| `chapter.read_context`                                  | `context.read`                     | 从 TS Registry 补进 canonical manifest     |
| `search_memory`                                         | `memory.search`                    | 保留结果 schema，统一 source/version       |
| `generate_chapter`                                      | `writing.generate`                 | 不再把 validator 名称暴露给模型            |
| `polish_chapter`                                        | `writing.rewrite`                  | 明确 source draft/hash                     |
| `generate_outline`                                      | `structure.propose_outline`        | 生成交给 SubAgent，validator 内部化        |
| `generate_characters`                                   | `characters.propose`（后续）       | 不进入首期 18，先保留 candidate adapter    |
| `suggest_events`                                        | `structure.propose_events`（后续） | 不进入首期 18，需生产入口                  |
| `expand_settings`                                       | `story_assets.propose`（后续）     | 不进入首期 18，需 Safe Apply               |
| `check_quality`                                         | `quality.review`                   | validator 内部化                           |
| `summarize_chapter`                                     | `context.propose_summary`          | validator 内部化                           |
| `verification.check_*`                                  | Runtime internal checks            | 不直接暴露给模型，作为 SubAgent/host guard |
| `get_metadata/get_chapter_context/get_character_states` | 对应 read Tool                     | legacy alias，仅兼容旧 DSH                 |
| `query_world_state/...`                                 | `novel.read`/`characters.read`     | legacy registry 不再作为来源               |

## 5. TS、Rust、DSH 的统一方式

目标结构：

```text
capability-manifest.ts/json (唯一声明)
  ├─ TypeScript ToolDescriptor
  ├─ Rust gateway tools/list + call allowlist
  ├─ DSH runtime projection
  └─ currentPluginService UI projection
```

构建门禁必须比较：

- canonical name/version 集合
- input/output schema hash
- scope/permission/sideEffect/confirmation
- disabled/experimental 状态

任何 drift 都失败，不允许通过 `WORKBENCH_TOOLS` 手写第二份列表。

## 6. Tool 与 SubAgent 的边界

### 普通 Tool

只读、检索、准备、导出等确定性动作：`novel.read`、`structure.read`、`draft.read`、`context.read`、`memory.search`、`characters.read`、`story_assets.read`、`reference.read`、`style.read`、`transfer.export`。

### SubAgent adapter

需要模型推理的动作：`writing.*`、`structure.propose_outline`、`context.propose_summary`、`quality.review`。SubAgent 的输出必须包含：model snapshot、context hash、source revisions、candidate artifact id、validation status。

### Host protocol

`artifact.review` 和 `artifact.apply_approved` 不是模型自由 Tool；宿主根据用户点击、一次性 authorization、CAS 和 scope 做最终决定。

## 7. 暂不开放的能力

```text
project.delete / draft.adopt（直到权限与文案修复）
content_transaction.apply（除非有用户 confirmation）
database repair / migrations / leases / checkpoints / chunks
autonomous scheduler / Multi-Agent consensus
legacy AgentToolRegistry
LocalStorage template/setting/polish mirrors
E2E diagnostics and test bridge commands
```

## 8. Tool readiness checklist

某个动作进入 manifest 前必须满足：

1. 对应 canonical Domain Capability 已有唯一写入/读取事实源。
2. 至少一个真实生产消费者。
3. 输入 scope 与 ownership 在后端重复验证。
4. 结果 schema 不依赖隐藏 prompt 或 raw provider body。
5. 失败、取消、重试、重启行为有证据。
6. side effect 和 confirmation 在模型可见 schema 中一致。
7. 旧名称只做兼容 alias，不再出现在模型 prompt。

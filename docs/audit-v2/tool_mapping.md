# AI Novel Studio 第二次全量能力审计：Tool Mapping

## 1. 结论

当前 Registry 不能直接作为后续 Agent 的能力地图：

- TypeScript `productionToolRegistry` 有 **18** 个描述符；它们具备 `name`、描述、`inputSchema`、`outputSchema`、权限、scope、side-effect 和 confirmation 元数据。
- 当前 Workbench/DSH canonical allowlist 只有 **11** 个；TS Registry 有 7 个描述符没有进入 DSH。
- Rust gateway 默认 `tools/list` 有 **14** 个条目，其中 3 个是 legacy alias。
- 当前模型可见 schema 没有完整表达 TS descriptor 的 permission/scope/sideEffect/confirmation 字段。
- 所有 `generate_*` / `polish_chapter` / `check_quality` / `summarize_chapter` gateway handler 都是“候选验证槽”，要求模型先提供 `candidateText`；它们不是生成器。
- Registry 没有正式的 `adopt_artifact`/`save_draft` 写 Tool；这是正确的安全方向，但必须明确由用户确认协议承接。

因此本文件的映射是“审计后的目标分类”，不是授权现在把所有候选加入 Registry。

## 2. 普通确定性 Tool（可考虑开放）

普通 Tool 只负责确定性读取、准备或受控文件动作；模型不负责决定数据库写入细节。所有参数必须显式包含作品/章节作用域，后端再次验证归属。

| 目标 Tool                         | 来源能力     | 输入最小集                            | 输出                     | 写入/确认     | 当前状态        | 前置条件                                       |
| --------------------------------- | ------------ | ------------------------------------- | ------------------------ | ------------- | --------------- | ---------------------------------------------- |
| `novel.list`                      | PRJ-01       | `limit`, `cursor`                     | 作品摘要列表             | 无            | WORKING         | 过滤软删除                                     |
| `novel.read_context`              | PRJ-01/17/18 | `novelId`                             | 基础信息、设定、卷章摘要 | 无            | PARTIAL         | 输出需限长/去敏                                |
| `novel.read_settings`             | PRJ-03～05   | `novelId`                             | 世界/规则/主角摘要       | 无            | PARTIAL         | 当前 TS 有描述，DSH 未 allow                   |
| `volume.list`                     | PRJ-07       | `novelId`                             | 卷树                     | 无            | WORKING         | 只读                                           |
| `chapter.list`                    | PRJ-08       | `novelId`, 可选 `volumeId`            | 章节摘要/状态            | 无            | WORKING         | 只读                                           |
| `chapter.read`                    | PRJ-08/09    | `novelId`, `chapterId`                | 章节、大纲、状态         | 无            | PARTIAL         | ownership 校验                                 |
| `chapter.read_context`            | PRJ-18/21    | `novelId`, `chapterId`                | 角色/事件/前情摘要       | 无            | PARTIAL         | 当前 TS 有描述，DSH 未 allow                   |
| `draft.list`                      | PRJ-10       | `novelId`, `chapterId`                | 草稿版本元数据           | 无            | WORKING         | 不默认返回全文                                 |
| `draft.read_adopted`              | PRJ-11/12    | `novelId`, `chapterId`                | 已采用正文/哈希          | 无            | WORKING         | 大文本完整性检查                               |
| `outline.read`                    | PRJ-17       | `novelId`, `level`, `targetId`        | 对应大纲                 | 无            | PARTIAL         | 先修 cross-project ownership                   |
| `character.list`                  | PRJ-06       | `novelId`                             | 角色摘要/当前状态        | 无            | PARTIAL         | 章节绑定另行授权                               |
| `event.list`                      | PRJ-21       | `novelId`, `chapterId`                | 章节事件                 | 无            | LEGACY/待迁移   | 当前无生产面板                                 |
| `summary.read`                    | PRJ-18       | `novelId`, `chapterId`                | 已采用总结/上下文        | 无            | PARTIAL         | 版本/来源显示                                  |
| `style.read_active`               | PRJ-25       | `novelId`                             | 风格方案                 | 无            | PARTIAL         | 当前 TS `style.read_profile` 未进入 DSH        |
| `output.read_active`              | PRJ-25       | `novelId`                             | 字数/节奏/视角控制       | 无            | PARTIAL         | 当前 TS `style.read_output_control` 未进入 DSH |
| `memory.search`                   | PRJ-19/20    | `novelId`, `query`, filters           | 记忆片段及来源           | 无            | WORKING/PARTIAL | 统一词法/向量 fallback 结果 schema             |
| `reference.list`                  | PRJ-27       | `novelId`                             | 资料元数据               | 无            | PARTIAL         | 不读密钥/本地路径                              |
| `reference.read_section`          | PRJ-27       | `novelId`, `sectionId`, range         | 资料切片                 | 无            | PARTIAL         | 读权限/长度上限                                |
| `story_asset.list`                | PRJ-22       | `novelId`, assetType                  | 势力/地点摘要            | 无            | PARTIAL         | 只暴露 UI 已支持类型                           |
| `content_transaction.prepare`     | PRJ-23       | `novelId`, targets, base revisions    | 候选计划、冲突           | 无（准备）    | PARTIAL         | 不允许模型直接 apply                           |
| `export.chapter` / `export.novel` | PRJ-32       | `novelId`, optional chapterId, format | 文件结果                 | 文件写入/确认 | PARTIAL         | 路径由用户选定                                 |
| `project.backup_export`           | PRJ-31       | `novelId`, destination                | 备份元数据               | 文件写入/确认 | WORKING         | 不能自动覆盖                                   |

“普通 Tool”不等于“现在已加入 Registry”。上表的目标是经过真实性审计后可设计的窄 facade；内部 command、large-text chunk、lease、migration 不应直接注册。

## 3. 必须由 SubAgent/模型服务完成的能力

SubAgent 只产出候选或报告，不能直接写正式事实。它需要独立 prompt、明确上下文快照、独立错误/取消边界和候选 Artifact 输出。

| SubAgent 能力        | 对应能力     | 必须输出                                                | 正式落地方式                                  | 当前实现判断                                                          |
| -------------------- | ------------ | ------------------------------------------------------- | --------------------------------------------- | --------------------------------------------------------------------- |
| `writing`            | AI-03        | `chapter_text` candidate + contextHash + model snapshot | ResultArtifact → 人工审阅 → CAS adopt         | `workbenchChapterWriter` 是服务级 writer；独立模型/Agent 身份尚未证实 |
| `rewrite_polish`     | AI-08        | 带源版本引用的正文候选                                  | 新 Artifact，不覆盖原稿                       | 现有 writer mode 可复用，但仍是 PARTIAL                               |
| `outline_planner`    | AI-04        | 三级大纲候选                                            | Artifact → 用户确认 → outline service         | 旧 Outline UI 有直写路径，必须隔离                                    |
| `character_planner`  | AI-05        | 角色候选 JSON                                           | Artifact → 用户确认 → character service       | 当前 candidate sink 只验模型文本                                      |
| `event_planner`      | AI-06        | 事件候选 JSON                                           | Artifact → 用户确认 → event service           | 当前章节事件无生产 UI                                                 |
| `setting_expander`   | AI-07        | 设定候选 JSON                                           | Artifact → 受限 placement/content transaction | Safe Apply 覆盖面不足                                                 |
| `quality_reviewer`   | AI-09        | 不可变质量报告/问题项                                   | 报告展示；修复另一步                          | `check_quality` 只是验证槽                                            |
| `summary_compactor`  | AI-10        | 章节总结/上下文候选                                     | Artifact → 显式启用/采用                      | 当前 extractive compression 不是模型总结                              |
| `style_analyst`      | AI-11/PRJ-28 | 风格维度和证据                                          | 用户确认后写 profile                          | 外部 API 未动态验证                                                   |
| `story_planner`      | AI-17        | 计划候选                                                | revision/CAS + 用户授权                       | 当前 autonomous page 是旧平行入口                                     |
| `consensus_reviewer` | AI-18        | 多意见和综合报告                                        | 仅报告/候选                                   | Multi-Agent UI 无生产入口                                             |

SubAgent 禁止持有：`dbCall` 任意写权限、migration、lease token、raw API key、直接 `adopt_chapter_draft`、直接覆盖正式正文。

## 4. 明确不开放给 Agent

### 内部持久化/安全设施

```text
migrations/schema_migrations
large_text_documents/chunks/save operations
workspace recovery snapshots
ai_tasks/attempts/input snapshots/result artifact storage internals
agent plan leases/claims/checkpoints
AI request policy reservations/settlements
DSH preparation ledger
conversation turns/runs/tool events persistence commands
E2E diagnostics and test bridge commands
```

### 旧/双真相实现

```text
legacy AgentToolRegistry (query_world_state/.../save_chapter_version)
agentLoop / AgentChatWorkspace
novelMemoryManager in-memory state
LocalStorage templates, setting suggestions, polish records
settings/imported_assets legacy tables without production CRUD
placement low-level apply command
unregistered legacy large-text draft commands
```

### 用户确认与高风险写入

`draft.save`、`draft.adopt`、`artifact.apply`、`project.import`、`project.delete`、`content_transaction.apply`、任何全自动章节采用，都不能作为模型无确认 Tool。若未来需要 Agent 发起，必须返回“待用户确认”的 proposal，而不是执行结果。

## 5. 当前 Registry 逐项审计

### 5.1 TS 18 个描述符

| 组         | 名称                                                                                                                                                       | 真实职责                                                         | 判断                                                         |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------ |
| 记忆       | `search_memory`                                                                                                                                            | 调用 `memoryService.retrieve`，非 Tauri 有 LocalStorage fallback | 合理只读 Tool；fallback 必须显式标识                         |
| 候选验证   | `generate_chapter`, `generate_outline`, `generate_characters`, `suggest_events`, `expand_settings`, `polish_chapter`, `check_quality`, `summarize_chapter` | 验证 `candidateText`，不生成、不写正式事实                       | 名称误导；应改为 `submit_*_candidate` 或由 SubAgent 内部调用 |
| 读取       | `novel.read_context`, `novel.read_settings`, `chapter.read_outline`, `chapter.read_context`, `style.read_profile`, `style.read_output_control`             | 只读领域 facade                                                  | 多数合理，但 7 个未进入 DSH allowlist                        |
| 确定性检查 | `verification.check_readiness`, `verification.check_outline`, `verification.check_style`                                                                   | 本地检查/准备，不调用模型                                        | 合理内部 Tool；目前模型可见性不一致                          |

TS Registry 的 `sideEffect` 全部为 `none`、`confirmationPolicy` 全部为 `never`。这解释了为什么它安全，但也说明它没有正式写操作 Tool；实际写入通过 Artifact/审阅协议发生。

### 5.2 DSH gateway 11 canonical

```text
novel.read_context
chapter.read_outline
search_memory
generate_chapter
generate_outline
generate_characters
suggest_events
expand_settings
polish_chapter
check_quality
summarize_chapter
```

它们都有 `name/description/inputSchema`；候选条目另有 `outputSchema`。但 gateway 是只读数据库连接加候选验证 sink，不能执行正式 domain write。`get_metadata`、`get_chapter_context`、`get_character_states` 是旧 alias，不应继续扩大。

### 5.3 Registry 缺口与错位

当前 Workbench/DSH 缺少 TS Registry 的 7 个能力：

```text
chapter.read_context
novel.read_settings
style.read_profile
style.read_output_control
verification.check_outline
verification.check_style
verification.check_readiness
```

相反，当前 Registry 也没有以下真正有用户价值、但需要受控 facade 的能力：

```text
chapter.list/read
draft.read_adopted/read_version
summary.read
reference.list/read_section
story_asset.list
content_transaction.prepare
project.backup_export
```

这不是建议马上添加；它是后续修复的 gap 列表。必须先确定单一 Registry 来源、输出 schema 和权限/确认传播。

## 6. Main Agent 实际看到什么

当前答案是：**不完全正确**。

- 浏览器/章节写作：用户意图先经 `taskGoalRouting` 正则，再由 `taskRuntimeAdapter` 固定调用上下文/记忆/候选步骤；没有 LLM 自主选择。
- Tauri structured/audit/read：固定 DSH preparation 已通过 `npm run test:dsh:real` 由真实模型调用只读 MCP 工具并通过 Proposal schema；这不代表完整 Workbench 的自主选 Tool 或统一 Registry 已验证。
- 模型看到的工具 schema 没有完整的 TS 权限/确认元数据。
- 模型看到 `generate_chapter` 时会把它理解成生成动作，但实际 handler 要求已写好的 `candidateText`。
- `novel.read_settings`、`style.read_profile` 等已有安全读能力在当前 DSH allowlist 中不可见。

所以 Main Agent 目前既有“看不到真实能力”，也有“看到的名字与语义不一致”的问题。

## 7. Tool 化验收门槛（后续版本必须满足）

每个新 Tool 进入 Registry 前必须同时提供：

1. 稳定 canonical name 和版本。
2. 描述用户可观察的真实行为，不把 validator 叫 generator。
3. 严格 `inputSchema` 和 `outputSchema`，包含 scope/ownership/revision/hash。
4. `permission`、`sideEffect`、`confirmationPolicy` 在 TS、Rust gateway、Runtime projection 三处一致。
5. 真实入口或生产消费者证据；无消费者的表/命令不能注册。
6. 跨作品/跨章节负例和重启/重试测试。
7. 对模型输出只返回 candidate/proposal，正式写入经过人工授权。

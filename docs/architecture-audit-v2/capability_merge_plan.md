# AI Novel Studio 第二次能力审计：Capability Merge Plan

## 1. 归并原则

本计划是迁移设计，不是本轮代码删除清单。所有旧实现先保留，采用“新增 facade → 迁移调用者 → 双读/只读兼容 → 证据回归 → 再退役”的顺序。

必须遵守：

1. SQLite 正式事实优先于 UI state、LocalStorage、测试 fixture。
2. 一个领域能力只有一个 canonical 名称和一个对外契约；内部可以有多个算法实现。
3. AI 生成只产出 Candidate/ResultArtifact；正式写入由领域服务和用户授权完成。
4. 迁移期间旧入口不得悄悄改变语义；若行为已不可靠，显式显示 legacy/unavailable。
5. 每次只迁移一个能力族，保留旧调用兼容层，不做跨版本大重构。

## 2. 归并结果摘要

| 指标                                   |      数量 | 说明                                                |
| -------------------------------------- | --------: | --------------------------------------------------- |
| 宏观能力重叠组                         |        14 | M01～M14；DUP-15/16 是其中 M01/M02 的具体展开       |
| 具体冲突簇                             |        16 | DUP-01～DUP-16                                      |
| 可直接 facade 归并的具体簇             |        13 | DUP-01～08、DUP-10～12、DUP-15～16                  |
| 仅做边界/事实源治理的具体簇            |         3 | DUP-09、DUP-13～14；不应粗暴合并实现                |
| 建议保留的 canonical Domain Capability |   12 个域 | 见第 4 节                                           |
| 首期对模型开放的核心能力               | 18 个动作 | 读/检索/准备为主；写入需确认                        |
| 首期 SubAgent 契约                     |      6 类 | writing、outline、context、quality、style、planning |
| 立即删除的旧文件                       |         0 | 本轮禁止删除                                        |

## 3. 每组保留/迁移/废弃计划

| 组                            | 保留（Keep）                                                                                                | 迁移（Migrate）                                                                                              | 废弃/隔离（Retire/Isolate）                                             | 完成证据                                                         |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------- | ---------------------------------------------------------------- |
| DUP-01 Writing                | `chapterGenerationExecutionService`；`generationContextCompiler`；`workbenchChapterWriter` 作为第一 adapter | `useChapterGenerationAction`、scene/beat pipeline、autonomous writer 改调 `WritingCapability`                | 旧 `agentToolRegistry.generate_prose` 只保留兼容测试，不进生产 manifest | 三种动作输出同一 Artifact schema；跨书/重试/CAS 回归             |
| DUP-02 Outline                | `outlineService` 的读写/版本 API                                                                            | OutlineManager、隐藏 OutlineEditor、OutlinePanel 统一调用 facade；生成改 candidate                           | 旧直接写/旧 route 标 legacy                                             | ownership 负例、版本/CAS、一个 canonical outline trace           |
| DUP-03 Context                | `chapterSummaryService`、`contextRecordService`、deterministic compression provider                         | `useWorkspaceSummary`、volume summary、ContextView 改为 projection/adapter                                   | 无消费者的 summary generator 退役                                       | summary/context 只有一个 DB 记录；压缩回滚/过期一致              |
| DUP-04 Quality                | Rust quality report repositories；`qualityCheckService`；range fix engine                                   | gate runner、AI reviewer、旧 CheckPanel 通过 `QualityCapability`                                             | old agent judge/quality loop 隔离                                       | report immutable、fix range/CAS、失败不写脏状态                  |
| DUP-05 Rewrite                | Workbench writer rewrite；quality fix range application                                                     | PolishPanel、polish AI service 变 adapter；统一 source draft/hash                                            | LocalStorage `polishService` 不再作为正式事实                           | rewrite 与 polish 结果同一 Artifact type，来源可追溯             |
| DUP-06 Memory                 | SQLite `memoryService` + repositories                                                                       | adoptedDraftMemory、scene generator、legacy Agent 改 `MemoryCapability`                                      | `novelMemoryManager` 仅 dev/test adapter                                | 重启后检索、采用失效、跨书隔离、fallback 显式                    |
| DUP-07 Apply                  | Artifact decision/review authorization protocol；domain transaction services                                | placement/setting suggestions/content transaction 接受统一 proposal envelope                                 | generic placement direct apply 隔离                                     | 每种 artifact type 明确 target/schema/confirmation               |
| DUP-08 Runtime/Registry       | canonical manifest；task session/DSH adapter                                                                | TS registry、Rust gateway、plugin projection 由 manifest 生成；legacy Agent 适配只读                         | legacy planner/registry 不进 production                                 | manifest hash、schema/permission drift check、Tool list snapshot |
| DUP-09 Execution facts        | formal AI task/attempt/artifact facts；conversation facts                                                   | generation jobs、AI task page 改为 projection/adapter                                                        | `ai_task_records` 旧页面标 legacy                                       | 运行状态/重启恢复/Artifact 关联一致，不能重复计数                |
| DUP-10 Style                  | style profile service、layered analyzer、prompt projection                                                  | reference analyzer、StyleProfiles UI、旧 StylePanel 统一 facade                                              | mockStyles 仅 fixture                                                   | 分析来源、profile revision、prompt hash 可追溯                   |
| DUP-11 Templates/Prompts      | Prompt Registry + Markdown 作为 AI 权威                                                                     | 用户模板迁移到 TemplateCapability；Workbench 提供显式“插入/预填”                                             | 未接入前“使用模板”只标剪贴板                                            | 模板引用在 task snapshot 中可见，或文案明确不影响生成            |
| DUP-12 Import/Export          | project backup serializer；export facade                                                                    | TXT/JSON dialogs、legacy normalizer 走统一 import transaction                                                | 旧基础 JSON 不冒充完整恢复                                              | 中途失败回滚、备份 round-trip、文件权限确认                      |
| DUP-13 State                  | SQLite durable facts；Zustand UI projections                                                                | 建立 hydration/revision boundary、统一 target snapshot                                                       | 不合并 store；retire 未绑定状态字段                                     | 切章/重启/并发不丢 target，stale UI 可识别                       |
| DUP-14 Orchestration          | Workbench/DSH 作为当前主入口                                                                                | future autonomous/multi-agent 只能通过 Domain Capability adapters 重新接入                                   | Autonomous/Multi-Agent/legacy Harness 生产入口先隔离                    | route/manifest 只出现一套主入口；未来实验有 feature flag         |
| DUP-15 Draft facts            | `draftVersionService` + SQLite adopted pointer                                                              | 旧 LocalStorage `draftService`、内存 `chapterVersionService`、legacy Agent 保存路径改为只读兼容/迁移 adapter | 不再双写；旧版本 API 标 legacy                                          | 重启、跨作品 ownership、CAS/adopt 回归全部一致                   |
| DUP-16 Outline Tool semantics | SQLite active/version contract                                                                              | TS 旧 `chapter.read_outline` 改为兼容 alias；统一 `structure.read` 输出                                      | 同名不同义的旧 handler 隔离                                             | 保存 version 后 active pointer 可读回，schema/hash 一致          |

## 4. 目标 Domain Capability 层

```text
NovelCapability
  list/read/create/update (delete semantics later)

StoryStructureCapability
  volume/chapter/outline read + versioned edits

WritingCapability
  generate / continue / rewrite → CandidateArtifact

ContextCapability
  read / search / summarize-propose / compress-propose / activate

QualityCapability
  review / gate / fix-propose

CharacterCapability
  list/read/state / candidate-propose

StoryAssetCapability
  faction/location list / transaction-prepare / approved-apply

StyleCapability
  read-active / analyze-propose / activate / prompt-project

ReferenceCapability
  import/list/read-section/activate

ArtifactCapability
  publish / decide / issue-review / apply-approved

ProjectTransferCapability
  backup/export/import with file confirmation

RuntimeCapability (internal)
  model snapshot / governance / task run / health / cancellation
```

`RuntimeCapability` 是内部边界，不是模型可见能力。数据库 migration、lease、chunk、UI store 都属于其实现细节。

## 4.1 归并前必须冻结的事实协议

这些不是“顺手修复”，而是 facade 能否安全承接旧调用者的前置条件：

| 协议                              | 当前风险                                                                                                                                                | 归并前要求                                                                                    |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `structure.read`                  | 新 outline version 可能未激活，DSH 只读 active row；旧 `chapters.outline` 仍可被读取                                                                    | 定义 `versionId/activeVersionId/revision`，保存与激活在同一 ownership/CAS 规则下可读回        |
| `context.propose_summary` / apply | `chapterContextPersistenceService` 保存 summary/context/character bundle；Workbench artifact apply 只保存 summary，且 `workbench-unadopted` 可能违反 FK | 候选必须绑定真实 `sourceDraftId`；无 adopted draft 时返回可解释阻断；批准落地走 bundle facade |
| `draft.read` / adopt              | SQLite `draftVersionService`、LocalStorage `draftService`、内存 revision 并存                                                                           | 桌面单写 SQLite；fallback 读取必须带 source marker；Agent 不得看到旧 save API                 |
| `characters.read`                 | novels JSON、protagonists 表、characters 表和 LocalStorage fallback 并存                                                                                | 以 `characters` 为唯一事实，其他来源只做迁移投影，不允许模型选择事实源                        |
| execution ledger                  | `ai_tasks`、`ai_task_records`、generation jobs 语义相邻但非同一状态机                                                                                   | 新 durable task/artifact ledger 为事实；旧表只读投影，所有运行用 `traceId/taskId` 关联        |
| context assembly                  | TS 多套 compiler 与 Rust/DSH bundle 可能得到不同上下文                                                                                                  | 统一输入 snapshot、source revision/hash 和可审计编译结果；SubAgent 只消费 ContextCompiler DTO |

在上述协议完成前，相关能力即使已有 UI 或 service，也不能标记为 stable Tool。

## 4.2 本轮已落地的最小修复

本轮先修复可明确验证的事实一致性问题，不提前做大规模 facade 迁移：

- `NovelCapability.delete` 的桌面入口改调事务级项目清理器；兼容的 `delete_novel` 软删除命令保留，不让旧调用者静默改变语义。
- `NovelCapability.repair` 在桌面端改为 SQLite 事务内的确定性字段规范化与完整性检查；它不是对所有表的万能修复器，结果 DTO 明确返回 storage、integrity 和外键问题数量。
- `transfer/story_assets` 的资产中心统计改为读取真实导入资产服务；导入创建链仍标 `PARTIAL`，未伪装成已完成能力。
- `ContextCapability` 的 summary apply 只接受当前真实 adopted draft，缺失或错配直接返回冲突码。
- `StoryStructureCapability` 的大纲激活按 project + volume/chapter scope 原子更新，并在 candidate apply 后显式激活。

这些修复不删除旧文件、不改变数据库 schema；每项后续仍需真实桌面入口回归后才能调整健康等级。

## 5. 分阶段迁移路线

### Phase M0：冻结事实与命名（本轮之后）

- 把 `docs/architecture-audit-v2/` 作为能力与归并基线。
- 固化交叉计数：14 个宏观组、16 个具体冲突簇、13 个 facade 归并簇、3 个边界治理簇；评审记录必须使用同一口径。
- 建立 canonical capability ID → 旧实现/入口映射表。
- 给旧入口加 `legacy`/`experimental` 状态，不改业务行为。
- 对三个 BROKEN 入口先改文案或禁用，避免误导用户和未来 Agent。

M0 还必须先解决三个高风险事实约束：outline version 与 active pointer 原子一致；summary/context bundle 使用真实 adopted draft 并通过 FK/ownership 校验；草稿只允许 canonical SQLite 路径单写。否则相关 facade 只能保持 `PARTIAL/BLOCKED`。

放行条件：能力数量、重复组、权威实现由评审确认；无新增 Tool。

### Phase M1：先建 facade，不迁 UI

按风险从低到高新增纯 TypeScript domain facade：

1. `StoryStructureCapability`（读为主）。
2. `ContextCapability`（read/search/compression proposal）。
3. `WritingCapability`（复用现有 execution core）。
4. `QualityCapability`、`StyleCapability`。
5. `ArtifactCapability`/`ProjectTransferCapability`。

每个 facade 只能依赖 service/domain 层，不能依赖 React；输入显式 `novelId/chapterId`，输出有版本/hash/来源。

### Phase M2：迁移生产消费者

逐组迁移 Workbench → Writing Workspace → 作品详情 → 旧面板兼容层：

- 先切 Workbench writer 和 Artifact Apply。
- 再切总结/上下文和质量。
- 再切大纲、风格、资产、导入导出。
- 每次迁移后运行对应动态测试和跨作品负例。

旧调用者在迁移期间只能调用 facade adapter，不得直接新增对底层 service/command 的引用。

### Phase M3：Registry 生成与 Agent 预备

- 从 canonical capability manifest 生成 TypeScript descriptor、Rust gateway schema、DSH projection。
- 用构建期检查阻止三份 manifest 漂移。
- 将 `generate_*` validator 改为 `submit_*_candidate` 内部动作；模型看到的是 `writing.generate` SubAgent contract，不是验证槽。
- 首期只开放只读/检索/prepare；所有 apply/save/adopt 返回待确认 proposal。

### Phase M4：旧实现退役（未来独立版本）

只有在调用图显示 0 个生产消费者、备份/迁移兼容完成、回滚方案存在后，才可删除：

- legacy Agent Harness/registry
- E2E-only retired panels
- LocalStorage formal-fact mirrors
- old autonomous/multi-agent routes（若没有重新接入）

本阶段不执行删除。

## 6. 数据与状态迁移策略

### 6.1 双读单写

在 LocalStorage/SQLite 并存期间：

```text
read: canonical SQLite → legacy fallback (only with explicit source marker)
write: canonical service only
```

禁止继续向两套来源同时写入。迁移脚本要记录 source/version/hash，不静默覆盖冲突。

### 6.2 Artifact 迁移

旧 AI 结果如果没有 immutable Artifact/hash/ownership，先转成只读历史记录；不得自动当作可采用候选。新生成统一写 `ResultArtifact`，UI 只显示 projection。

### 6.3 状态迁移

建立如下 ownership matrix：

| 状态     | 唯一事实源                               | UI 允许保存什么  |
| -------- | ---------------------------------------- | ---------------- |
| 采用正文 | SQLite draft + chapter pointer           | 未保存编辑投影   |
| 任务运行 | SQLite task run / DSH status             | loading/显示投影 |
| 当前目标 | conversation target snapshot + ownership | 选择器缓存       |
| 面板输出 | ResultArtifact/quality report            | 显示/过期标记    |
| 记忆     | SQLite memory/context tables             | 检索缓存         |

## 7. 每组迁移验收模板

```text
Capability ID:
Canonical facade:
Old callers:
Legacy callers:
Single-write source:
Input ownership checks:
Revision/hash contract:
Confirmation policy:
Dynamic test:
Restart test:
Cross-novel negative test:
Rollback plan:
```

任何一项为空，都不能把旧实现标记为 retired，也不能把新 facade 加入 Agent Registry。

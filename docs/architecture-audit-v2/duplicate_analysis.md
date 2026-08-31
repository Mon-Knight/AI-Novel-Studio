# AI Novel Studio 第二次能力审计：Duplicate Analysis

## 1. 统计口径与结论

本文件分析的是“同一用户意图/同一领域事实被多套实现或入口表达”的重叠组，不把每个测试文件或每个 Rust command 算成一项重复能力。

- 已识别 **14 组宏观能力重叠**，展开为 **16 个具体冲突簇**。
- 其中 **13 个具体冲突簇适合归并到 Domain Capability facade**。
- **3 个具体冲突簇不应强行合并**，应保留不同层次但建立唯一事实源/明确边界：执行事实、UI 状态、未来自主编排。
- 这些组涉及的是架构重叠，不等于 14 个额外用户功能；它们是 75 个能力族健康基线中的“重复/并行表达”。

计数交叉表如下，避免把“宏观组”和“具体冲突簇”混为一谈：

```text
M01 Writing lifecycle      = DUP-01 + DUP-15
M02 Structure/outline      = DUP-02 + DUP-16
M03～M14                   = DUP-03～DUP-14（各一个具体簇）
宏观组                      = 14
具体冲突簇                  = 16
可直接 facade 归并          = DUP-01～08、DUP-10～12、DUP-15～16（13）
边界/事实源治理             = DUP-09、DUP-13～14（3）
```

因此，DUP-15（草稿/版本事实）和 DUP-16（同名 outline Tool 语义）是 M01/M02 的高风险展开项，不是额外的第 15、16 个宏观用户领域。

判定标签：

- `MERGE`：语义相同或高度重叠，保留一个领域权威入口，其他实现迁移到 adapter 后退役。
- `BOUNDARY`：语义相邻但责任不同，不能合成一个 service；需要明确事实源和投影边界。
- `RETIRE`：旧入口不能继续作为生产能力，但暂不删除，先建立迁移/兼容证据。

## 2. 重叠组总表

| ID     | 重叠能力                             | 当前并行实现/入口                                                                                                                                                                                                                  | 重叠类型        | 当前权威实现                                                                          | 处理判断                                                                              |
| ------ | ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| DUP-01 | 正文生成/继续/改写                   | `workbenchChapterWriter`；`chapterGenerationExecutionService`；`useChapterGenerationAction`；`chapterSceneGenerationExecutionService`/`proseGenerationPipeline`；旧 `agentToolRegistry.generate_prose`；autonomous chapter runtime | MERGE           | `chapterGenerationExecutionService` 作为执行核心 + Workbench writer 作为当前 adapter  | 统一为 `WritingCapability`；面板/旧 Agent/自主运行时改调 facade                       |
| DUP-02 | 三级大纲管理与生成                   | `OutlineManager`；隐藏 `OutlineEditor`；退休 `OutlinePanel`；`outlineGenerateService`；`outlineService`；DSH/legacy `generate_outline`                                                                                             | MERGE           | `outlineService` 作为唯一持久化领域服务                                               | 统一读写与候选生成；隐藏/退休 UI 迁移，不立即删除                                     |
| DUP-03 | 章节总结、上下文记录、压缩           | `ChapterSummaryPanel`；`useWorkspaceSummary`；`chapterSummarizeService`；`volumeSummaryService`；`contextRecordService`；`novelContextCompressionProvider`；DSH `summarize_chapter`                                                | MERGE           | SQLite `chapterSummaryService` + `contextRecordService`；compression 作为候选 adapter | 统一 `ContextCapability` 的 read/propose/apply，废弃无消费者生成 hook                 |
| DUP-04 | 质量审计与质量门禁                   | `qualityCheckService`；`qualityCheckAiService`；`chapterQualityGateService`；`qualityGateRunner`；`qualityFixService`；CheckPanel；旧 `agentQualityJudge/agentQualityLoop`                                                         | MERGE           | `qualityCheckService`/Rust quality repositories 负责正式报告                          | 统一 `QualityCapability`；报告、门禁、局部修复分成子动作                              |
| DUP-05 | 润色/重写                            | `polishAiService`；LocalStorage `polishService`；Workbench writer `mode=polish`；`qualityFixService`；退休 PolishPanel；DSH `polish_chapter`                                                                                       | MERGE           | Workbench writer rewrite + formal quality fix range engine                            | LocalStorage polish 与旧面板迁移；validator 改名为 candidate sink                     |
| DUP-06 | 记忆与上下文召回                     | SQLite `memoryService`；`adoptedDraftMemory`；`novelMemoryManager`；`novelMemoryRetriever`；state updater；DSH `search_memory`；scene integration                                                                                  | MERGE           | SQLite memory service/repository；browser fallback 仅开发适配层                       | 旧 in-memory Agent/scene 调用改 facade；不把多个状态 Map 合并成第二事实源             |
| DUP-07 | 候选应用与安全落地                   | `artifactApply`；`artifactDecisionService`；`placementRuntimeService`；`contentTransactionService`；setting suggestions adopt；autonomous apply                                                                                    | MERGE           | Artifact Decision + domain-specific apply services                                    | 统一 `ApplyCapability` 协议，保留各领域事务实现；旧 placement 变 adapter              |
| DUP-08 | Agent runtime 与 Tool Registry       | `taskSessionAdapter`；`taskRuntimeAdapter`；TS production registry；Rust gateway；DSH allowlist；旧 `agentLoop/agentPlanner/agentToolRegistry`                                                                                     | MERGE           | Workbench session + canonical manifest + DSH adapter                                  | 以一个 manifest 生成 TS/Rust/DSH 投影；旧 Harness 只保留迁移参考                      |
| DUP-09 | AI 执行事实与任务历史                | 正式 `ai_tasks/attempts/snapshots/artifacts`；`task_conversations/runs/tool_events`；旧 `ai_task_records`；generation jobs                                                                                                         | BOUNDARY        | 正式 AI task/artifact facts + conversation projection                                 | 不把所有表合成一张表；统一 Execution Observability facade，旧页面改读 projection      |
| DUP-10 | 风格画像与风格分析                   | `styleProfileService`；`styleAnalyzeService`；`layeredStyleAnalyzer`；`referenceStyleProfileService`；`styleProfilePromptProjection`；退休 StylePanel；mockStyles                                                                  | MERGE           | style profile service + analyzer + prompt projection                                  | 统一 `StyleCapability`；参考资料分析只是输入 adapter                                  |
| DUP-11 | 用户模板与 Prompt 模板               | `templateService` LocalStorage；TemplatesPage built-ins；`promptTemplateRegistry`；`prompts/*.md`；chapter prompt builders；Workbench task prompts                                                                                 | MERGE           | Prompt Registry/Markdown 是 AI 运行时权威                                             | 用户模板迁移到持久化 TemplateCapability，或明确只做剪贴板；不再假装已注入模型         |
| DUP-12 | 导入、导出、备份                     | `ImportTxtDialog`；`ImportJsonDialog`；`exportService`；`projectBackupService`；旧 JSON normalizer；browser delete purge                                                                                                           | MERGE           | `projectBackupService` + export facade                                                | 格式保留，入口/事务/确认统一；旧基础 JSON 仅兼容导入，不当完整恢复                    |
| DUP-13 | Durable state 与 UI/session state    | `workspaceSessionStore`；editor local state；`rightSidebarStore`；conversation SQLite；recovery snapshots；model snapshot                                                                                                          | BOUNDARY        | SQLite durable facts；Zustand 只做可丢失投影；recovery 是恢复事实                     | 不合成单一 store，建立 ownership matrix 和 hydration/revision 规则                    |
| DUP-14 | 对话 Agent、自主创作、多 Agent       | `Workbench/DSH`；旧 CreativeAgentHarness；AutonomousPlanning/scheduler；Multi-Agent runtime                                                                                                                                        | BOUNDARY/RETIRE | 当前只保留 Workbench/DSH 主入口                                                       | 自主/多 Agent 先隔离，不与 Main Agent Registry 混合；未来从同一 Capability 层重新接入 |
| DUP-15 | 草稿/版本/正文事实                   | canonical `draftVersionService` + SQLite；旧 LocalStorage `draftService`；内存 `chapterVersionService`；legacy Agent `save_chapter_version`                                                                                        | MERGE           | `draftVersionService` + `chapters.adopted_draft_id`                                   | 所有读取/保存/采用迁移到 DraftCapability；旧实现只读兼容，不再双写                    |
| DUP-16 | 同名 `chapter.read_outline@1` 的语义 | TS `src/agent-tools/chapter-tools.ts` 读取章节旧 outline/LocalStorage 草稿；DSH gateway 读取 active `chapter_outlines`、engineering、events、summaries                                                                             | MERGE（高风险） | DSH/SQLite canonical structure/context read contract                                  | 统一输出 schema 和事实源；旧 TS handler 改 alias，禁止同名不同义                      |

## 3. 重点重复组证据

### 3.1 正文生成（DUP-01）

当前不是四个“等价 writer”，而是三层责任混杂：

```text
UI/任务入口
  ├─ useChapterGenerationAction（退休面板 orchestration）
  ├─ workbenchChapterWriter（当前 Workbench adapter）
  ├─ autonomousChapterRuntime（旧自主入口）
  └─ legacy AgentToolRegistry.generate_prose（无生产消费者）

共享/底层执行
  ├─ chapterGenerationExecutionService（AI task、治理、结果事实）
  ├─ chapterProseOrchestrator（流式/续写细节）
  └─ chapterSceneGenerationExecutionService（scene/beat 旧路径）
```

结论不是删除底层执行器，而是把 `WritingCapability` 设成唯一领域 facade：`generate`、`continue`、`rewrite` 三个动作都先编译 Context Snapshot，再调用同一个 execution core，最后只返回 Candidate/Artifact。旧 UI/Agent/Autonomous 通过 adapter 迁移。

### 3.2 大纲（DUP-02）

`OutlineManager` 和隐藏 `OutlineEditor` 都能写同一组三层 outline tables；`OutlinePanel` 又重复生成同类候选。另有 `outlineGenerateService` 直接保存/创建卷章的旧路径，以及 DSH `generate_outline` 仅验候选的路径。归并重点是：

- `outlineService` 成为唯一读写领域服务。
- AI 只生成 candidate，不直接 `save_master_outline`。
- 作品/卷/章节归属校验必须在 facade/后端完成。
- 旧页面先变成 facade consumer，再决定是否移除。

### 3.3 总结/上下文（DUP-03）

`useWorkspaceSummary` 仍有 generate/save/re-generate 控制器，但实际 toolbar 打开 `ChapterSummaryPanel`；`volumeSummaryService` 和 `ContextViewPanel` 又各有一套展示/生成逻辑。唯一正式事实应是 `chapter_summaries` 与 `context_records`，而压缩候选应通过 Artifact protocol。不能让每个 UI 保存一份“当前总结”。

### 3.4 记忆（DUP-06）

SQLite `memoryService` 已被 production `search_memory` 和 adopted draft lifecycle 使用；`novelMemoryManager` 则被旧 Agent、旧 scene generator 和测试使用，进程重启丢失。两者不是等价持久层。归并策略是：

```text
MemoryCapability (唯一公开 facade)
  ├─ search → SQLite memoryService
  ├─ ingest adopted draft → SQLite lifecycle
  ├─ state read → character/context repositories
  └─ browser fallback → 仅开发 adapter，显式标记非生产
```

### 3.5 Artifact/Placement/Content Transaction（DUP-07）

三套“应用”语义并存：Artifact decision/review、单目标 placement、跨目标 content transaction。它们不能共享一个宽泛的 `apply()` 名字；应共享 proposal/authorization protocol，但每种领域保留独立事务实现和 target schema。

### 3.6 草稿版本（DUP-15）

草稿是最容易被“文件名扫描”误判的能力：

```text
canonical: draftVersionService → SQLite chapter_drafts + large text + CAS
legacy:    draftService → LocalStorage
legacy:    chapterVersionService → in-memory revision list
legacy:    AgentToolRegistry.save_chapter_version → in-memory/old harness
```

只有 canonical 路径能证明桌面重启、跨作品 ownership 和 adopted pointer 一致。整合期间必须单写 canonical；旧路径不得作为 Agent Tool 或第二个“版本管理能力”。

### 3.7 同名 Tool 语义冲突（DUP-16）

`chapter.read_outline@1` 并非两个实现的无害重复：

- TS `chapter-tools.ts` 的读取器仍带旧 LocalStorage/fallback 语义。
- DSH gateway 的同名 Tool 读取 SQLite active chapter outline，并拼装工程、事件和总结上下文。
- `artifactApply` 保存新 outline version 时未必激活，而 DSH read 只看 `is_active=1`；这会出现“写成功但下一次 Agent 读不到”的假成功。

迁移必须先冻结 canonical output schema、active/version 规则和 ownership；在完成前，不能让 Main Agent 看到该名字的两个投影。

### 3.8 后端反向扫描补充的高风险冲突

以下问题来自 migration、Rust command、repository 和生产调用者的反向核对。它们已经归入上面的 16 个具体冲突簇，不另行增加计数，但必须成为迁移的阻断条件：

- **Outline version/active 不一致（DUP-02/DUP-16）**：`artifactApply` 可以保存新 outline version 而不设置 active；DSH 读取器只读 `is_active=1`。这会产生“写入成功、下一轮读取不到”的假成功。`structure.read` 的契约必须同时定义 version、active pointer 和 revision。
- **Summary apply 两种落盘语义（DUP-03/DUP-07）**：`chapterContextPersistenceService.save` 负责 summary、`contextRecords`、`characterStates` 的 bundle；Workbench `artifactApply.applyChapterSummary` 只调用 `chapterSummaryService.create`。此外，无来源草稿时填入 `workbench-unadopted` 可能违反 `chapter_summaries.adopted_draft_id` 外键与 current-adopted 校验。该路径在修复前只能标记 `PARTIAL/BLOCKED`，不能作为可靠 Apply Tool。
- **角色事实三轨（DUP-07/DUP-13）**：`novels` 主角 JSON、`protagonists` 表和正式 `characters` 表同时存在，且还有 LocalStorage fallback。建议以 `characters` 为唯一事实，其他两轨只做迁移投影；不能让 Agent 选择事实源。
- **AI task ledger 双轨（DUP-09）**：`ai_tasks/attempts/snapshots/artifacts` 是新执行事实，旧 `ai_task_records` 是兼容投影；两者必须建立 `task_id` 映射并禁止在 Tool 层提供 ledger CRUD。
- **Context compiler 多入口（DUP-03/DUP-08）**：`prompt/contextBuilder`、`generationContextCompiler`、`promptOrchestrator`、Rust chapter context bundle 和 DSH gateway 都能组装上下文。应冻结 `ContextCompiler` 输入快照/来源 hash，避免 SubAgent 看到与 UI 不同的上下文。
- **Main Agent 选择证据不足（DUP-08）**：`agentPlanner` 的 JSON 决策失败后仍有关键词 heuristic，`taskRuntimeAdapter` 还有固定编排；因此当前不能把 deterministic orchestration 当作 LLM 自主 Tool selection 证据。正则只能保留为离线分类/安全拒绝。
- **Registry 漂移（DUP-08）**：production TS、Workbench allowlist、Rust gateway、DSH allowlist、legacy registry 仍是多源；canonical manifest 生成和 schema/permission drift gate 完成前，Agent 状态必须是 `NOT READY`。

## 4. 多事实源判定

| 事实类型           | 目前观察到的源                                                                                 | 唯一权威建议                                                | 其他源处理                                                       |
| ------------------ | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | ---------------------------------------------------------------- |
| 采用正文           | `chapter_drafts` + `chapters.adopted_draft_id`；editor local text；Artifact raw content        | SQLite adopted draft + chapter pointer                      | editor 只做未保存投影；Artifact 需 hash/授权                     |
| 任务运行           | `task_runs`；DSH worker state；Zustand loading                                                 | SQLite task run + DSH status projection                     | UI loading 可丢弃，重启从 DB 恢复                                |
| 对话历史           | SQLite conversation tables；LocalStorage fallback                                              | 桌面 SQLite                                                 | 浏览器 fallback 明示 dev-only                                    |
| 当前章节           | `workspaceSessionStore`；URL query；conversation chapterId                                     | URL/任务冻结 target + DB ownership                          | store 仅缓存，切换时必须重新 hydrate                             |
| 面板输出           | `rightSidebarStore`；Artifact cards；质量表                                                    | ResultArtifact/quality report                               | sidebar 只显示 projection，正文 hash 失效即丢弃/提示             |
| 记忆               | SQLite memory tables；novelMemoryManager Map；LocalStorage adoptedDraftMemory                  | SQLite memory service                                       | Map/fallback 不能在桌面作为真相                                  |
| 大纲版本指针       | `chapter_outlines` version rows；`is_active`；旧 `chapters.outline` 字段                       | SQLite 三层 outline + 明确 active pointer                   | 旧字段只读迁移；apply 必须原子更新 version 与 active             |
| 总结/上下文 bundle | `chapter_summaries`；`context_records`；`character_states`；`chapterContextPersistenceService` | Context bundle contract + adopted draft ownership           | 单独 summary create 不能冒充完整 bundle；无 adopted draft 时阻断 |
| 角色事实           | `novels` 主角 JSON；`protagonists`；`characters`；LocalStorage fallback                        | `characters` 表/服务                                        | 其他来源只做兼容投影并带 source marker                           |
| AI 任务执行        | `ai_tasks`/attempts/artifacts；`ai_task_records`；generation jobs                              | 新 durable task/artifact ledger                             | 旧表只读投影，不进入 Agent Tool                                  |
| AI 设置            | LocalStorage + session credentials；遗留 `settings` 表                                         | `aiSettingsStore`（在统一持久化前）                         | `settings` 表不扫描为能力；迁移时明确删除/兼容                   |
| 模板               | Templates LocalStorage；Markdown Prompt Registry                                               | Prompt Registry（AI）；TemplateCapability（用户模板迁移后） | 在迁移完成前禁止宣称模板已影响生成                               |

## 5. 不应做的“合并”

- 不把 UI 状态、会话事实、恢复快照和数据库事实合成一个万能 store。
- 不把 Artifact apply、Placement apply、Content Transaction apply 合成无类型 `apply()`。
- 不把 DSH 主 Agent、旧自主调度和 Multi-Agent 统一成一个未定义的“Agent service”。
- 不把 Mock/fallback、LocalStorage 和 SQLite 当作同等级生产实现。
- 不以删除文件代替迁移；每个 RETIRE 组都必须先有调用者迁移和回归证据。

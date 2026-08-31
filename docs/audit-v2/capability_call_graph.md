# AI Novel Studio 第二次全量能力审计：Capability Call Graph

本文件只记录已经从入口或消费者追到终点的调用链。`存在某个 service` 不被视为调用链证据；没有消费者的底层表/命令在图中单独标为孤儿或内部设施。

## 1. 生产用户主链：作品与正文

### 1.1 作品列表/创建/打开

```text
/novels (HomePage)
  → novelRepository.getAll/create/getById
  → dbCall('get_all_novels' | 'create_novel' | 'get_novel_by_id')
  → src-tauri/commands/project.rs
  → project_service.rs
  → repositories/novel_repository.rs
  → SQLite novels (deleted_at IS NULL)
```

这条链由当前桌面 E2E 的两本作品创建和重启读取覆盖，标 `PRJ-01 WORKING`。

### 1.2 卷章树

```text
WritingWorkspacePage / Workbench chapter selector
  → VolumeTree + useWorkspaceChapterLoader
  → volumeService/chapterService/repositories
  → get/create/update_*_volume/chapter commands
  → volume_service.rs / chapter_service.rs
  → SQLite volumes, chapters
```

卷章创建和跨作品隔离在真实 E2E 中运行；删除、边界状态仍按 `PRJ-07/08` 的 PARTIAL 分支保留风险。

### 1.3 编辑器保存

```text
EditorArea
  → useEditorDocumentController
  → draftVersionService.saveDraftAtomic/update/create
  → save_chapter_draft_atomic
  → draft_service::save_draft_atomic
  → large_text_save (必要时 create/append/finalize)
  → SQLite chapter_drafts + large_text_documents/chunks
```

关键保护：base/current content hash、operationId、scope、Unicode word count、损坏分片 fail-closed。该链在五轮 E2E 和 Rust 大文本测试中被实际执行，标 `PRJ-11/16 WORKING`。

### 1.4 正文采用

```text
编辑器“采用”
  → useEditorDocumentController
  → draftVersionService.adopt
  → adopt_chapter_draft
  → chapter_service + draft_service transaction
  → chapters.adopted_draft_id / draft.is_adopted
  → memory invalidation/context expiration
```

Agent 候选采用是另一条更严格的链：

```text
ArtifactCard confirm-review
  → artifactDecisionService.recordDecision
  → issue_review_authorization
  → WritingWorkspace?authorizationId=...
  → user unlock/edit/save
  → artifactDecisionService.adoptReviewAuthorizedDraft
  → adopt_review_authorized_draft
  → one-time authorization consume + CAS draft adoption
```

这两条链都由 E2E 覆盖；模型不能跳过 Card/Authorization。

## 2. Workbench 实际对话链

### 2.1 浏览器/章节写作的确定性 fallback

```text
WorkbenchPage
  → useWorkbenchTaskRunner
  → taskSessionAdapter.startTurn
  → (browser OR chapter_write) taskRuntimeAdapter.start
  → taskGoalRouting.classifyTaskIntent (regex)
  → 固定步骤：novel.read_context
                 → chapter.read_outline (有 chapterId 时)
                 → search_memory
                 → selectCandidateTool (regex)
  → productionToolRegistry.invoke
  → ResultArtifact / conversation tool event
```

章节正文步骤有额外 writer 分支：

```text
generate_chapter / polish_chapter
  → workbenchChapterWriter.generate
  → generationContextCompiler.compile
  → buildSnapshotGenerateRequest
  → executeChapterGeneration
  → validateCandidateText
  → publishChapterCandidate
  → ResultArtifact card
```

这里的工具选择是确定性字符串路由；`generate_*` 最终只是候选验证器。它解释了为什么 `agent-production-closed-loop` 的证据应写成“deterministic orchestration”，而不是“LLM selected tools”。

### 2.2 Tauri structured/audit/read 的 DSH 路径

```text
WorkbenchPage
  → taskSessionAdapter.startTurn
  → dshTaskRuntimeService.start
  → Tauri dsh_start_task_turn
  → Rust task_runtime::start
  → pinned DSH Node child
  → model followup
  → MCP tools/list (gateway)
  → tools/call
  → read-only SQLite / candidate-only validation
  → projected tool event + task run
```

章节写作明确不走这条路径；它回到上面的 ANS writer。固定 DSH preparation 已通过 `test:dsh:real` 的真实 Provider smoke（工具调用与 Proposal 校验通过），但该证据不覆盖完整 Workbench 的模型决策；`AG-03` 仍按“完整能力未证实”保留受限状态。

## 3. Tool Registry 图

```text
TS productionToolRegistry.ts (18 descriptors)
  ├─ ToolRegistry manifest/hash/invoke
  ├─ TypeScript fallback adapter
  └─ currentPluginService projection

Rust gateway/src/tools.rs
  ├─ tool_list (14 default entries: 11 canonical + 3 legacy aliases)
  ├─ ANS_ALLOWED_TOOLS (11 canonical)
  └─ call_tool → read SQL / candidate validation sink

DSH task_runtime.rs
  ├─ fixed ALLOWED_TOOLS string (11)
  ├─ normalize_tool_name
  ├─ tool_projection_metadata (internal event metadata)
  └─ generated chapter result validation / large-text hash checks
```

三个 Registry 没有一个共同的单一权威来源。TS 18 个描述符中有 7 个不在 DSH allowlist：

```text
chapter.read_context
novel.read_settings
style.read_profile
style.read_output_control
verification.check_outline
verification.check_style
verification.check_readiness
```

反过来，gateway 还保留 `get_metadata`、`get_chapter_context`、`get_character_states` legacy aliases；这些不应被模型当成新能力。

模型实际收到的是 gateway/DSH 的 `name + description + inputSchema (+ 部分 outputSchema)`。TS descriptor 的 `permissions`、`scope`、`sideEffect`、`confirmationPolicy` 没有完整进入模型可见 schema；它们只在内部投影/调用校验中存在。

## 4. Artifact 与 Safe Apply 图

```text
writer / candidate validator / compression provider
  → ResultArtifact (immutable/hash/validation)
  → conversation_artifact_cards
  → user decision (confirm/revise/reject)
  ├─ chapter_text → review authorization → Writing Workspace → CAS adopt
  ├─ outline → outline service (ownership risk; not universal)
  ├─ character_candidates → character service
  ├─ event_candidates → chapter event service
  ├─ setting_candidates → placementRuntimeService (limited target coverage)
  ├─ chapter_summary → summary/context service
  └─ quality/style report → report only; cannot directly apply
```

`artifactApply.ts` 是当前候选真相的中心，但并不是所有 artifact type 都有等价的生产 UI/事务保证。因此 `AG-08` 只能 PARTIAL，不能用一个“apply”名称覆盖所有领域写入。

## 5. 数据库反向图

```text
SQLite migrations (90 tables)
  → Rust repository/service/command
  → TypeScript service/repository
  → actual page/hook or Agent handler
```

### 5.1 有生产消费者的主要族

```text
novels/world_settings/rule_systems/protagonists/volumes/chapters/drafts
  → project/world/writing/draft services
  → HomePage / NovelDetail / WritingWorkspace / Workbench

characters/chapter_characters/chapter_events
  → character/event services
  → 作品级角色库（章节角色/事件面板已退休）

memory_documents/chunks/embeddings/retrieval_logs
  → memory service
  → adopted draft lifecycle + search_memory handler

conversation tables + artifact/authorization tables
  → conversation repository/service
  → Workbench + review workspace

reference_* / story_factions / story_locations / content_transactions
  → reference/content transaction services
  → corresponding pages
```

### 5.2 表存在但不代表能力存在

```text
settings
  → no production CRUD command/repository
  → AI settings actually LocalStorage + session credentials
  → LEGACY

imported_assets
  → backup/legacy references only; user service LocalStorage
  → Assets “导入资产” count hardcoded 0
  → LEGACY/BROKEN projection

polish_records
  → old AI-task unlink references only; polishService LocalStorage
  → LEGACY

agent_plans / leases / checkpoints / reservations / migrations ledger
  → internal persistence only
  → not user-facing capabilities, not Agent Tools
```

### 5.3 后端比 UI 更宽的内容事务

```text
content_transaction_service.rs target handlers (10-ish target kinds)
  → StoryAssets UI builders (only faction/location and a subset of links)
```

后端支持的额外关系类型没有生产查看/编辑入口，不能从 SQL target enum 反推用户可用能力，也不能原样给 LLM。

## 6. 两条明确断链

### 6.1 删除断链

```text
用户看到“删除全部关联数据”
  → browser-only LocalStorage purge (仅 fallback)
  → desktop delete_novel
  → UPDATE novels.deleted_at
  ✕ 没有子表级联/恢复策略与文案一致性
```

### 6.2 修复断链

```text
用户看到“扫描并修复数据库”
  → repairData()
  → lsGet/lsSet
  ✕ 没有 dbCall
  ✕ 没有 SQLite command
  ✕ 没有 Rust repository
```

## 7. 旧/不可达图

```text
AgentChatWorkspace
  → CreativeAgentHarness / legacy agentLoop
  → legacy AgentToolRegistry (9 names, no production schema)
  → in-memory novelMemoryManager
  ✕ no App route / no production consumer

RightPanel retired panels
  → Outline/Characters/Events/Style/Polish/MultiAgent/Context
  ✕ toolbar absent in production (E2E flag only for a subset)

AutonomousPlanningPage
  → autonomous story/scheduler tables
  → separate planning/auto-apply surface
  ✕ conflicts with conversational-workbench single-entry authority
```

这些图在能力健康表中统一标 `LEGACY`，不能作为后续 Agent 的事实来源。

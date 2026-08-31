# AI Novel Studio 关键能力调用链路图 (Capability Call Graph)

> **审计目的**：梳理关键业务流程的真实代码路径，完成三向交叉验证（UI → Service → Command → DB / 反向追踪），为后续 Tool / SubAgent 接入提供精确调用锚点。

---

## 一、核心创作主链路调用图谱

### 1. 第一阶段目标链路 (Workbench Conversation → Writing SubAgent → 确认采纳)

```text
[用户输入目标] "帮我写第一章"
       │
       ▼
[UI Layer] src/pages/Workbench/WorkbenchPage.tsx
       │  (useWorkbenchConversations + useWorkbenchTaskRunner)
       ▼
[Task Session] src/services/conversation/taskConversationService.ts
       │  ├─ appendConversationTurn('user') ──► SQLite task_conversations / turns
       │  ├─ createTaskRun() ──────────────► SQLite task_runs (状态: running)
       │  └─ captureTaskModelSnapshot()
       ▼
[Agent Routing] src/services/conversation/taskGoalRouting.ts
       │  └─ matchCandidateTool(goal)
       ▼
[Writing SubAgent / Orchestrator] ── (当前断层接入点)
       │
       ├─► [上下文检索 Tool] search_memory / read_chapter_context
       │        │
       │        ▼
       │   src/services/memory/memoryService.ts (FTS5 + 余弦相似度)
       │        │
       │        ▼
       │   Rust command: retrieve_memory ──► SQLite memory_documents / chunks
       │
       ├─► [分镜规划 Tool / SubAgent] generate_scene_plan
       │        │
       │        ▼
       │   src/services/ai/chapterScenePlanService.ts ──► AI Model (LLM)
       │
       ├─► [正文生成 SubAgent] chapterProseOrchestrator
       │        │
       │        ├─► generationContextCompiler.ts (Token 预算裁剪)
       │        ├─► styleProfilePromptProjection.ts (风格注入)
       │        └─► executeChapterSceneGeneration() ──► Rust ai_chat_completion_stream
       │
       └─► [质量把关 Tool / Gate] qualityGateRunner (Score >= 80)
                │
                └─► 自动修复 (如需要): qualityFixService.ts (区间精准替换)
       │
       ▼
[产物卡片签发] src/services/conversation/taskConversationService.ts
       │  ├─ publishStructuredCandidate('chapter_text', candidateData)
       │  ├─ createConversationArtifactCard() ──► SQLite conversation_artifact_cards
       │  └─ updateTaskRun(status: 'completed')
       ▼
[用户人工审阅] ArtifactCard (UI 交互: 确认审阅 / 采纳 / 要求修改)
       │
       ├─► [用户点击"确认采纳"]
       │        │
       │        ▼
       │   src/services/conversation/artifactApply.ts
       │        │
       │        ▼
       │   src/services/database/draftVersionService.ts
       │        │
       │        ├─► saveDraftAtomic() ──► Rust: save_chapter_draft_atomic (SHA-256 CAS)
       │        │        │
       │        │        ▼
       │        │   SQLite chapter_drafts + large_text_documents/chunks
       │        │
       │        ├─► adoptDraft() ──► Rust: adopt_chapter_draft
       │        │        │
       │        │        ▼
       │        │   SQLite chapters (更新 adopted_draft_id)
       │        │
       │        └─► memoryService.invalidate() (自动使旧章节向量失效)
       │
       └─► [用户要求修改] ──► 携带当前 Draft 与反馈进入下一轮 ConversationTurn
```

---

## 二、关键能力深度调用链

### 2. 章节正文原子保存与大文本分片链路 (Draft Save & Large Text Engine)

```text
[UI] src/components/workspace/EditorArea.tsx (Ctrl+S / 自动保存)
  │
  ▼
[Service] src/services/database/draftVersionService.ts (saveDraftAtomic)
  │  ├─ 计算正文 sha256、Unicode 字符数
  │  └─ 检查正文长度：若 > 64KB，启动大文本流式分片
  │
  ▼ (Tauri IPC)
[Rust Command] src-tauri/src/commands/drafts.rs (save_chapter_draft_atomic)
  │
  ▼
[Rust Service] src-tauri/src/services/draft_service.rs
  │  ├─ 检查 draft_save_operations 幂等性
  │  ├─ 校验 base_content_hash (CAS 防并发冲突)
  │  ├─ 若包含 large_text_ref_id，调用 large_text_save::verify_document()
  │  └─ 开启 SQLite Transaction:
  │       ├─ INSERT/UPDATE INTO chapter_drafts
  │       ├─ INSERT INTO draft_save_operations
  │       └─ COMMIT
  │
  ▼
[SQLite Tables] chapter_drafts, draft_save_operations, large_text_documents, large_text_chunks
```

---

### 3. 混合语义记忆检索链路 (Hybrid Semantic Memory)

```text
[Caller] Agent Tool (search_memory) / 生成前上下文装配
  │
  ▼
[Service] src/services/memory/memoryService.ts (retrieve)
  │  ├─ 参数校验与默认值: topK=8, candidateLimit=50, tokenBudget=4000
  │  ├─ 计算查询文本 Embedding (可选)
  │  └─ invoke('retrieve_memory', { novelId, query, embedding, ... })
  │
  ▼ (Tauri IPC)
[Rust Command] src-tauri/src/commands/memory.rs (retrieve_memory)
  │
  ▼
[Rust Service] src-tauri/src/repositories/memory_repository.rs
  │  ├─ 1. 结构化元数据过滤 (novel_id, status = 'active', chapter_scope)
  │  ├─ 2. FTS5 全文检索 (BM25 评分)
  │  ├─ 3. 向量余弦相似度计算 (Cosine Similarity)
  │  ├─ 4. RRF (Reciprocal Rank Fusion) 混合重排
  │  ├─ 5. Token 预算截断
  │  └─ 记录检索日志到 memory_retrieval_logs
  │
  ▼
[SQLite Tables] memory_documents, memory_chunks, memory_embeddings, memory_retrieval_logs
```

---

### 4. 质量审查与闭环修复链路 (Quality Check & Fix Loop)

```text
[UI] src/components/right-dock/panels/CheckPanel.tsx
  │
  ▼
[Service] src/services/quality/qualityCheckService.ts (runQualityCheck)
  │  ├─ invoke('create_ai_task_record', { taskType: 'quality_check' })
  │  ├─ promptBuilder.buildQualityCheckPrompt(draftText, rules)
  │  ├─ aiExecutionPipeline.execute() ──► AI Model API
  │  └─ jsonUtils.parseQualityCheckResult()
  │
  ▼ (Tauri IPC)
[Rust Command] src-tauri/src/commands.rs (save_quality_check_result)
  │  ├─ 写入 quality_check_reports (不可变快照)
  │  └─ 批量写入 quality_check_items (severity, offsets, suggestions)
  │
  ▼ (用户点击"一键修复")
[Service] src/services/quality/qualityFixService.ts (runQualityFix)
  │  ├─ 提取待修复问题列表 (Critical / High / Medium)
  │  ├─ promptBuilder.buildQualityFixPrompt(issues, draftText)
  │  ├─ aiExecutionPipeline.execute() ──► AI Model API
  │  ├─ qualityFixRangeApplication.applyPatchCandidates()
  │  │    ├─ 模糊上下文匹配 (Disambiguation)
  │  │    ├─ 重叠区间冲突检测 (Fail-closed)
  │  │    └─ 确定性安全正文缝合
  │  └─ invoke('save_quality_fix_run')
  │
  ▼
[SQLite Tables] quality_check_reports, quality_check_items, quality_issue_states, quality_fix_runs
```

---

## 三、反向入口核对表 (Database / Commands → UI Entry)

| 数据库核心表 / Rust Command                               | 是否有前端 Service 封装                                | 是否有前端 UI 入口                                           | 当前状态         |
| :-------------------------------------------------------- | :----------------------------------------------------- | :----------------------------------------------------------- | :--------------- |
| `novels` / `get_all_novels`, `create_novel`               | `novelRepository`                                      | `HomePage` (`/novels`)                                       | ✅ 正常使用      |
| `volumes`, `chapters` / `create_volume`, `create_chapter` | `volumeService`, `chapterService`                      | `WritingWorkspacePage` (VolumeTree)                          | ✅ 正常使用      |
| `chapter_drafts` / `save_chapter_draft_atomic`            | `draftVersionService`                                  | `WritingWorkspacePage` (EditorArea)                          | ✅ 正常使用      |
| `master_outlines`, `volume_outlines`, `chapter_outlines`  | `outlineService`                                       | `OutlineEditorPage` (`/novels/:id/outline`)                  | ✅ 正常使用      |
| `style_profiles`, `output_profiles`                       | `styleProfileService`, `outputProfileService`          | `StyleProfilesPage` (`/styles`)                              | ✅ 正常使用      |
| `reference_works`, `reference_sections`                   | `referenceLibraryService`                              | `ReferenceLibraryPage` (`/novels/:id/references`)            | ✅ 正常使用      |
| `story_factions`, `story_locations`                       | `contentTransactionService`                            | `StoryAssetsPage` (`/novels/:id/story-assets`)               | ✅ 正常使用      |
| `chapter_engineering_states`                              | `chapterEngineeringService`                            | `WritingWorkspacePage` (ChapterEngineeringPanel)             | ✅ 正常使用      |
| `generation_jobs`, `generation_step_results`              | `generationJobService`                                 | `WritingWorkspacePage` (AiGeneratePanel)                     | ✅ 正常使用      |
| `quality_check_reports`, `quality_fix_runs`               | `qualityCheckService`, `qualityFixService`             | `WritingWorkspacePage` (CheckPanel)                          | ✅ 正常使用      |
| `context_records`, `chapter_summaries`                    | `contextRecordService`, `chapterSummaryService`        | `WritingWorkspacePage` (Context / Summary Panels)            | ✅ 正常使用      |
| `characters`, `character_states`, `chapter_characters`    | `characterService`                                     | `WritingWorkspacePage` (CharactersPanel)                     | ✅ 正常使用      |
| `chapter_events`                                          | `chapterEventService`                                  | `WritingWorkspacePage` (EventsPanel)                         | ✅ 正常使用      |
| `memory_documents`, `memory_chunks`                       | `memoryService`                                        | `WritingWorkspacePage` (MemoryInspectorPanel)                | ✅ 正常使用      |
| `multi_agent_sessions`, `multi_agent_opinions`            | `multiAgentService`                                    | `WritingWorkspacePage` (MultiAgentPanel)                     | ✅ 正常使用      |
| `autonomous_story_plans`, `autonomous_book_runs`          | `autonomousStoryService`, `autonomousSchedulerService` | `AutonomousPlanningPage` (`/novels/:id/autonomous-planning`) | ✅ 正常使用      |
| `task_conversations`, `conversation_turns`, `task_runs`   | `taskConversationService`                              | `WorkbenchPage` (`/`)                                        | ✅ 正常使用      |
| `conversation_artifact_cards`, `review_authorizations`    | `artifactDecisionService`, `artifactApply`             | `WorkbenchPage` (ArtifactCard)                               | ✅ 正常使用      |
| `ai_task_records`                                         | `aiTaskService`                                        | `AiTasksPage` (`/ai-tasks`), `GenerationTracePanel`          | ✅ 正常使用      |
| `global_ai_request_policies`                              | `aiRequestPolicyService`                               | `SettingsPage` (AiGovernanceSettingsCard)                    | ✅ 正常使用      |
| `placement_proposals_v1`, `apply_plans_v1` (v2.0)         | `placementRuntimeService`                              | 无直接 UI（被 Migration 036 替代）                           | ⚠️ 降级/历史兼容 |
| `agent_plans_v1`, `agent_plan_steps_v1` (v2.0)            | `agentPlanRuntimeService`                              | `DshPreparationCard` / `ChapterReadinessPlanCard`            | ⚠️ 局部使用      |
| `localStorage` 模板数据                                   | `templateService`                                      | `TemplatesPage` (`/templates`)                               | ⚠️ 未入 SQLite   |

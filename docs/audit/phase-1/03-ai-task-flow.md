# AI 请求入口、任务与异步链路审计

## 1. 总体结论

- 项目存在两套并行的 AI 任务模型：通用 `ai_task_records` 和章节工程 `generation_jobs + generation_step_results`。
- `ai_task_records` 只固定到项目/章节，不固定目标草稿、基础版本、内容 hash、选区或上下文快照；状态 `cancelled` 虽在类型中存在，但服务没有取消正在执行请求的 API。
- `generation_jobs` 能持久化项目/章节、步骤、进度和完整步骤输出，也有 `chapter_generation_snapshots`；但 job 本身仍缺 `target_revision`、`base_content_hash`、selection snapshot 和可取消的网络句柄。
- 所有真实 AI 请求均为一次性非流式 Chat Completions。不存在 token/delta 流，因此“流式内容保存位置”答案是：**当前没有流式内容**。
- 旧面板请求在数据库层通常使用启动时捕获的章节 ID，能避免直接把响应保存到新章节；但完成回调会把旧章节草稿装入当前页面/编辑器，随后通用“应用”又只面向当前编辑器，形成 P0 错位链。

## 2. 公共 AI 请求封装

```text
入口组件/服务
→ aiSettingsService.getSettings()
→ createAiClient(settings)
   ├─ mock → MockAiClient.generate
   └─ api  → RealAiClient.generate
            ├─ Tauri: invoke('ai_chat_completion')
            │          → Rust reqwest::blocking::Client
            │          → POST /v1/chat/completions
            └─ Browser: fetch + timeout AbortController
→ 等待完整 JSON
→ AiGenerateResponse { text, token usage }
```

证据：`src/services/ai/aiClient.ts:9-25`、`realAiClient.ts:103-206`、`src-tauri/src/ai.rs:108-203`。

默认参数来自设置：temperature 0.7、maxTokens 8000；具体 prompt builder 可覆盖 maxTokens。Rust 校验 temperature 0..2、maxTokens 1..200000、timeout 1..1800 秒（`src-tauri/src/ai.rs:46-71`）。

桌面端 `reqwest::blocking` 没有流式 body、SSE、channel 或 Tauri event；也没有传入取消 token。浏览器态 AbortController 仅用于超时，调用方不能主动取消（`realAiClient.ts:159-205`）。置信度：代码确认。

## 3. AI 请求入口总表

所有入口最终都走上面的同一客户端；错误通常由服务标记 task failed 后抛回组件，组件写 local error/UI modal。表中“取消”指真正终止请求，而不是只隐藏弹窗。

| 功能入口               | 入口组件                          | 调用服务/函数                                                                     | 主要上下文                                                             | 参数/输出                  | 结果保存                                                | 取消                              | 证据与置信度                                                                          |
| ---------------------- | --------------------------------- | --------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | -------------------------- | ------------------------------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------- |
| 章节新生成/重写        | `AiGeneratePanel`                 | `buildFreshChapterGenerationContext` → `buildGenerateRequest` → `client.generate` | 项目、章节、大纲、角色、事件、世界规则、前文、风格；rewrite 加当前正文 | 约 8k/12k tokens           | `ai_task_records` 摘要 + 新 `chapter_drafts`            | 无，`cancelable:false`            | `AiGeneratePanel.tsx:248-436`; 代码确认                                               |
| 按大纲重新修正         | `AiGeneratePanel`                 | `reviseChapterByOutline`                                                          | 最新草稿、章节大纲、缺失点、必须角色                                   | 8k/12k                     | task 摘要 + 新草稿                                      | 无                                | `AiGeneratePanel.tsx:453-568`; 代码确认                                               |
| 章节工程生成           | `ChapterEngineeringPanel`         | `generationJobService.runChapterDraftJob`                                         | 持久化 context snapshot + active engineering state + 当前编辑正文      | 设置中的模型参数           | job/steps、完整 step output、草稿、质量报告、patch 草稿 | 协作式状态取消，不能中止在途 HTTP | `ChapterEngineeringPanel.tsx:553-589`; `generationJobService.ts:617-864`; 代码确认    |
| 润色                   | `PolishPanel`                     | `polishAiService.runPolish`                                                       | 章节、当前正文快照、大纲、模式/自定义要求                              | 8k                         | `polish_records`、task 摘要、新草稿                     | 无                                | `PolishPanel.tsx:49-117`; `polishAiService.ts:10-56`; 代码确认                        |
| 质量检测               | `CheckPanel`、generation job      | `qualityCheckAiService.runCheck`                                                  | 草稿正文、章节目标/大纲、上下文、hash/字数                             | 6k                         | task 摘要 + `quality_check_reports/items`               | 无                                | `CheckPanel.tsx:125-219`; `qualityCheckAiService.ts:13-87`; 代码确认                  |
| AI 质量修复/复检       | `CheckPanel`                      | `qualityFixService.runFix` → 再 `runCheck`                                        | source draft/version/hash、pending/ignored issues、章节上下文          | JSON、10k                  | task 摘要、`quality_fix_runs`、候选草稿、新报告         | 无                                | `CheckPanel.tsx:240-430`; `qualityFixService.ts:343-461`; 代码确认                    |
| 总纲/分卷/章节大纲生成 | `OutlinePanel`、`OutlineManager`  | `outlineGenerateService.generate*`                                                | 作品、世界/规则、主角、现有卷章和已采用大纲                            | 4k/7k/8k                   | task + UI 候选；用户再保存/采用大纲                     | 无                                | `OutlinePanel.tsx:82-137`; `outlineGenerateService.ts:131-293`; 代码确认              |
| 大纲编辑器生成         | `OutlineEditor`                   | `client.generate(request)`                                                        | 当前 outline 类型及上级大纲                                            | request builder            | 只写编辑器 local content，保存由用户触发                | 无                                | `OutlineEditor.tsx:154-184`; 代码确认                                                 |
| 角色候选               | `CharactersPanel`                 | `characterGenerateService.generateCandidates`                                     | 项目/章节、已有角色/上下文                                             | 4k                         | task + 面板候选；采用后写角色                           | 无                                | `CharactersPanel.tsx:81`; `characterGenerateService.ts:11-83`; 代码确认               |
| 事件建议               | `EventsPanel`                     | `eventSuggestService.suggestEvents`                                               | 项目/章节、角色/事件/上下文                                            | 4k                         | task + 面板候选；采用后写事件                           | 无                                | `EventsPanel.tsx:49`; `eventSuggestService.ts:24-111`; 代码确认                       |
| 章节设定补充           | `SettingPanel`                    | `settingExpandService.suggestSettings`                                            | 项目/章节、世界设定/规则                                               | 5k                         | task + 面板建议                                         | 无                                | `SettingPanel.tsx:38`; `settingExpandService.ts:20-78`; 代码确认                      |
| 风格分析               | `StylePanel`、`StyleProfilesPage` | `analyzeStyle`                                                                    | 样本文本/项目                                                          | 4k JSON                    | task + 风格方案（用户保存）                             | 无                                | `StylePanel.tsx`; `styleAnalyzeService.ts:13-68`; 代码确认                            |
| 章节总结               | `ChapterSummaryPanel`、workspace  | `chapterSummarizeService.summarize`                                               | 已采用草稿、章节/作品                                                  | 5k JSON                    | task + `chapter_summaries`（确认后）                    | 无                                | `ChapterSummaryPanel.tsx:91`; `chapterSummarizeService.ts:53-94`; 代码确认            |
| 分卷上下文总结         | `ContextViewPanel`                | `volumeSummaryAiService.summarize`                                                | 章节上下文集合                                                         | 4k JSON                    | task + `context_records`                                | 无                                | `volumeSummaryService.ts:97-185`; 代码确认                                            |
| 设定库 AI 推演         | `SettingSuggestionsPage`          | `settingSuggestionService.generate`                                               | 项目、已有设定/规则/角色、用户选择                                     | 5k JSON                    | task + localStorage 候选记录                            | 无                                | `SettingSuggestionsPage.tsx:129-165`; `settingSuggestionService.ts:113-297`; 代码确认 |
| AI 设置连接测试        | 设置页                            | `aiSettingsService.testConnection`                                                | 配置本身                                                               | temperature .1、100 tokens | task + 设置 test 状态                                   | 无                                | `aiSettingsService.ts:76-121`; 代码确认                                               |

没有发现独立的“续写选区”任务类型或可执行的“通用内容分析后多目标放置”入口。续写/重写主要由章节生成模式和用户 instruction 表达；选区链路未接通，见 `02-state-ownership.md`。

## 4. 旧 AI 任务对象完整性

`AiTaskRecord` 实际字段：`src/types/ai.ts:87-109`；表结构：`src-tauri/src/db.rs:308-332`。

| 任务书要求字段        | `ai_task_records`   | 结论                        |
| --------------------- | ------------------- | --------------------------- |
| `task_id`             | `id`                | 有                          |
| `project_id`          | `novel_id`          | 有，可空                    |
| `task_type`           | `task_type`         | 有                          |
| `target_document_id`  | 无；仅 `chapter_id` | 缺失                        |
| `target_revision`     | 无                  | 缺失                        |
| `selection_snapshot`  | 无                  | 缺失                        |
| `context_snapshot_id` | 无                  | 缺失                        |
| `status`              | 有                  | 有，但取消链未接通          |
| `progress`            | 无                  | 缺失；进度仅 UI local/modal |
| `streamed_content`    | 无                  | 缺失；系统也不流式          |
| `error`               | `error_message`     | 有                          |
| `created_at`          | 有                  | 有                          |

`aiTaskService.markSucceeded` 会把 `resultText/promptSnapshot/resultJson` 各截断到 500 字（`src/services/ai/aiTaskService.ts:134-137,198-251`）。因此 old task record 不能作为可恢复的完整生成结果或完整 prompt 证据；正文生成的完整结果依赖 `chapter_drafts`，其他面板结果可能只在组件内存。置信度：代码确认。

服务只提供 create/succeed/fail/query/delete/clear，未提供 `cancel(id)` 或把运行中 task 标记 cancelled 的方法（`aiTaskService.ts:139-473`）。类型里的 `cancelled` 是未接通状态。

## 5. Generation Job 完整性

`GenerationJob` 字段见 `src/types/generationJob.ts:30-53`；步骤可保存 `inputSnapshot/outputJson/outputText`（`55-65`）。表见 `src-tauri/src/db.rs:259-306`。

| 能力              | 现状                                                               | 结论 |
| ----------------- | ------------------------------------------------------------------ | ---- |
| 固定项目/卷/章节  | job 持久化 `novelId/volumeId/chapterId`                            | 有   |
| 上下文快照        | `chapter_generation_snapshots` 保存完整 context/prompt/hash/source | 有   |
| 完整输出恢复      | `generation_step_results.output_text` 保存生成全文                 | 有   |
| 进度/步骤         | job currentStep/progress + step results                            | 有   |
| 目标草稿/基础版本 | job 没有 target draft/revision/base hash                           | 缺失 |
| 选区快照          | 无                                                                 | 缺失 |
| 网络取消          | `ensureNotCancelled` 只在 step 开始前检查 DB 状态                  | 缺失 |
| 原子性            | 每个 job/step/snapshot/draft/report 独立写入                       | 缺失 |

`runStep` 在 action 前检查取消，然后等待整个 action，再保存 step；AI 请求期间点击取消不会中断 HTTP，也不会在 action 返回后立即再次检查（`generationJobService.ts:639-666,693-717`）。因此迟到响应仍可被保存为 step output；到下一 step 才可能发现 cancelled。置信度：代码确认。

## 6. 章节生成关键时序

### 6.1 旧 AiGeneratePanel

```text
点击生成（章节 A）
→ 构建 A 的 fresh context
→ 创建 ai_task_records(A)
→ 调用非流式 AI（不可取消）
→ 用闭包 chapter.id=A 创建 chapter_drafts(A)
→ task 标记 succeeded（摘要）
→ onGenerated(draft A)
→ 页面不校验 activeChapterId
→ 若用户已切到 B：currentDraft/editor 变为 A 的草稿
→ 面板 local latestGeneratedDraft 也可能在 B 页面重新出现
```

证据：`AiGeneratePanel.tsx:248-272,301-436`、`WritingWorkspacePage.tsx:283-296,631`。风险：P0。置信度：代码确认。

章节变化 effect 会先清空 `latestGeneratedDraft`，但旧 async 没有 request token，随后仍能再次 `setLatestGeneratedDraft(draft A)`（`AiGeneratePanel.tsx:121-144,421-422`），所以清空不是迟到响应保护。

### 6.2 润色

```text
点击润色 A
→ 必要时创建 A 当前正文快照草稿
→ 创建 polish_record(A, sourceDraft)
→ AI
→ 创建 A 的 ai_polished 草稿
→ onGenerated(A 草稿) + setLastPolishResult(A)
```

章节切换 effect 只清 UI；在途请求仍可在 B 页面回写 A。证据：`PolishPanel.tsx:36-47,49-109`。风险：P0。

### 6.3 章节工程 job

```text
create generation_job（固定 A）
→ compile & persist context snapshot(A)
→ AI draft_generation（保存完整 step output）
→ create candidate draft(A)
→ quality report/check(A,draft,hash)
→ build low-risk patches
→ create patched candidate draft(A)
→ job completed
→ panel onGenerated(result.draft)
```

后台持久对象比旧任务完整，但最后同样通过无目标校验的页面 `onGenerated` 更新当前 UI。证据：`generationJobService.ts:617-834`、`ChapterEngineeringPanel.tsx:553-568`。风险：P0（UI 错位）；DB 草稿目标本身固定到 A。

## 7. 同时任务与共享状态

- 每个面板通常只有一个 local `loading/generating/result`；同面板用按钮禁用避免重复点击，但不同面板/章节任务没有全局互斥或统一 registry。
- 收起当前面板用 CSS 隐藏，任务继续；切换到另一面板会卸载旧组件，但 Promise、数据库写入和闭包仍继续。
- `GlobalAiTaskModal` 只是页面 UI 状态（running/title/stage/progress），不是持久任务对象；多个质量/修复任务可覆盖同一个 modal。
- generation job 可以持久查询，但旧面板生成、润色、质量任务的进度依赖各面板或全局 modal。

证据：`WritingWorkspacePage.tsx:116-130`、`RightPanel.tsx:103-142`、各面板 local state。置信度：代码确认。

## 8. 结果保存位置

| 结果类型                | 完整内容位置                                        | UI 位置                              | 重启恢复                               |
| ----------------------- | --------------------------------------------------- | ------------------------------------ | -------------------------------------- |
| 旧章节生成/重写         | `chapter_drafts.content` 或大文本引用               | `latestGeneratedDraft` + 当前编辑器  | 草稿历史可恢复；“未应用结果”语义不完整 |
| 章节工程生成            | step `output_text` + `chapter_drafts`               | engineering panel job/steps + editor | job/step/草稿可查                      |
| 润色                    | `chapter_drafts` + `polish_records.result_draft_id` | `lastPolishResult`                   | 草稿存在；面板按钮状态不恢复           |
| 质量报告                | `quality_check_reports/items`                       | 页面 `qcReport/qcItems` + CheckPanel | 可按章节加载最新报告                   |
| 质量修复                | `quality_fix_runs` + candidate draft + after report | local comparison                     | DB 有 run/草稿，但比较 UI 恢复链不完整 |
| 大纲/角色/事件/设定候选 | task 摘要或面板 local state，部分另有领域记录       | 面板                                 | 多数面板结果不能完整恢复               |
| 设定库推演              | localStorage 完整 candidate/raw output              | 页面                                 | 同浏览器 profile 可恢复；非 SQLite     |
| 流式 delta              | 不存在                                              | 不存在                               | 不适用                                 |

## 9. 任务追溯链能力

当前能较完整追踪的路径只有章节工程：

```text
generation_job
→ generation_step_results
→ chapter_generation_snapshot(context hash)
→ chapter_draft（ai_task_id 被填 job.id）
→ quality_report(draft/version/hash)
```

但 `chapter_drafts.ai_task_id` 外键声明指向 `ai_task_records`，而章节工程传入的是 `generation_jobs.id`。Rust `create_chapter_draft` 会先检查 ID 是否存在于 `ai_task_records`，不存在就清空 `ai_task_id`（`commands.rs:1105-1121`）。因此 generation job 创建的草稿实际上不能通过 `ai_task_id` 反向关联 job；只能从 step output/note 文本追踪。结论：代码确认，属于新旧任务模型断裂。

对于旧任务，能追踪“task → draft”的前提是 `ai_task_id` 有效；但 task 本身没有 source revision/context snapshot。系统目前无法可靠回答：

```text
某次旧 AI 任务
→ 基于哪一个未保存正文快照/版本
→ 用户后来把结果应用到了哪一个编辑器版本
→ 产生了哪一个正式版本
```

## 10. 异步错位风险清单

| 风险                                              | 等级 | 证据                                                    | 置信度   |
| ------------------------------------------------- | ---- | ------------------------------------------------------- | -------- |
| 生成/润色/质量迟到回调把 A 草稿装入 B 编辑器      | P0   | 面板 `onGenerated` + page `handleDraftApplied` 无 guard | 代码确认 |
| 通用 apply 在完成时读取当前编辑器，不读取任务目标 | P0   | `WritingWorkspacePage.tsx:298-319`                      | 代码确认 |
| 取消 generation job 后在途响应仍落 step output    | P1   | `generationJobService.ts:639-666`                       | 代码确认 |
| 多个任务覆盖单一 global AI modal                  | P1   | `WritingWorkspacePage.tsx:116-127`                      | 代码确认 |
| 面板卸载丢进度/结果但后台仍写库                   | P1   | RightPanel 动态组件 + local state                       | 代码确认 |
| 两套任务表追溯断裂                                | P1   | job id 不满足 draft 的 ai_task FK 检查                  | 代码确认 |
| 无统一 trace/log correlation                      | P2   | console/string logs                                     | 代码确认 |

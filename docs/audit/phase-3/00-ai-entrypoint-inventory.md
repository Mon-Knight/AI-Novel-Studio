# 00 — 生产 AI 调用入口清单

> 审计基线：feat/v2.2.0-workspace-reliability / v2.2.0
>
> 审计日期：2026-07-12

## 1. 计数口径与结论

- 发现 **27 个生产触发入口**（含 2 个隐式二次调用和相同业务在不同 UI 的独立入口）。
- 归并为 **17 个业务任务族**：连接测试、章节生成、按大纲修正、章节工程生成、润色、质检、修稿、三类大纲、角色、事件、章节设定、设定库候选、风格分析、章节总结、卷总结。
- ChapterEngineeringPanel 的 runMockChapterJob 不调用 Provider，只是本地演示/测试编排，记录但不计入 27 个生产 AI 请求入口。
- 没有流式输出入口；所有请求返回完整字符串或由本地解析为 JSON。

统一传输末端为：createAiClient → MockAiClient 或 RealAiClient。真实模式下桌面端调用 src-tauri/src/ai.rs::ai_chat_completion（blocking reqwest），浏览器开发态调用 OpenAI-compatible /v1/chat/completions。UI 无法向桌面端 Provider 传递取消信号；浏览器 AbortController 只服务内部超时。

## 2. 调用链与数据流清单

| ID | 入口 / 文件 | 任务族 | Service → Prompt 构建 | 输入与上下文来源 | 结果、保存与应用 |
|---|---|---|---|---|---|
| E01 | 设置页“测试连接” / src/pages/Settings/SettingsPage.tsx | connection_test | aiSettingsService.testConnection → RealAiClient；Prompt 在 aiSettingsService 内联 | 当前未保存设置、固定“只回复 OK”；无项目上下文 | 字符串；ai_task_records 摘要；仅更新设置页测试状态，不写业务对象 |
| E02 | 右栏“生成/重新生成正文” / src/components/right-dock/panels/AiGeneratePanel.tsx | chapter_generate | 组件直接 createAiClient；contextBuilder → promptOrchestrator.buildGenerateRequest → prompts/chapter_generate.md | 用户要求、当前作品/章/卷、世界/规则、主角与本章角色、事件、三层大纲、上下文记录、风格/输出；改写时含当前正文 | 完整字符串 → draftVersionService.create 候选草稿 → guarded onGenerated；可追加/替换编辑器，或“确认采用” |
| E03 | 右栏“按大纲修正” / AiGeneratePanel.tsx | chapter_rewrite | chapterRevisionService.reviseChapterByOutline → buildReviseChapterByOutlineRequest | latest 草稿、大纲缺失点、章节目标、生成上下文；原文最多 18000 字符 | 修订字符串 → 候选草稿 → guarded onGenerated；采用入口与 E02 共用 |
| E04 | 章节工程“生成正式草稿” / src/components/right-dock/panels/ChapterEngineeringPanel.tsx | generation_job chapter_generation | generationJobService.runChapterDraftJob → generationContextCompiler → buildSnapshotGenerateRequest → Provider | 编译快照：作品、设定、角色、大纲、工程状态、上下文、风格/输出、当前编辑器正文 | generation_jobs/steps/snapshot + 完整 step output；保存候选草稿，返回工程面板/工作台 |
| E05 | 工程生成后的隐式质检 / src/services/generation/generationJobService.ts | quality_check | qualityCheckAiService.runCheck → buildQualityCheckPrompt + contextReader | E04 新候选草稿、章节大纲/目标、章节/卷上下文 | quality_check_reports/items + generation step 摘要；随后本地生成低风险 patch 候选，未正式采用 |
| E06 | 右栏“润色” / src/components/right-dock/panels/PolishPanel.tsx | chapter_polish | polishAiService.runPolish → promptBuilder.buildPolishPrompt | 当前编辑器/源草稿、润色模式与自定义要求；正文最多 8000 字符 | polish_records + 新候选草稿；可 guarded 追加/替换编辑器，正式采用另行确认 |
| E07 | 右栏“质量检查” / src/components/right-dock/panels/CheckPanel.tsx | quality_check | qualityCheckAiService.runCheck → contextReader + buildQualityCheckPrompt | 当前编辑器快照草稿、章标题/大纲/目标、内容 hash/字数、章节/卷/手动上下文 | quality report/items 持久化；只展示/定位问题，不改正文 |
| E08 | 质检“AI 修复” / CheckPanel.tsx | quality_fix | qualityFixService.runFix → buildFixPrompt | 当前报告、pending/ignored issues、源草稿、章节/卷上下文；正文最多 10000 字符 | quality_fix_runs + 候选草稿；若复检更好则加载编辑器并提前修改问题/上下文状态 |
| E09 | AI 修复后的隐式复检 / CheckPanel.tsx | quality_check | qualityCheckAiService.runCheck | E08 修订全文、章节上下文、hash/字数 | 新 quality report/items；驱动比较、问题 resolved 和上下文 expired |
| E10 | 右栏“生成作品总大纲” / src/components/right-dock/panels/OutlinePanel.tsx | outline_generate | outlineGenerateService.generateNovelOutline → buildOutlineGeneratePrompt | 作品、世界/规则、主角、现有卷章、当前采用大纲 | 字符串仅保存在组件；“采用”实际复制剪贴板/alert，不写大纲库 |
| E11 | 右栏“生成本卷大纲” / OutlinePanel.tsx | volume_outline_generate | outlineGenerateService.generateVolumeOutline → buildVolumeOutlineGeneratePrompt | 当前采用总纲、卷信息、世界/主角、风格摘要 | 结构化候选仅组件内展示；当前无保存/采用按钮 |
| E12 | 右栏“生成章节大纲” / OutlinePanel.tsx | chapter_outline_generate | outlineGenerateService.generateChapterOutlines → buildChapterOutlineGeneratePrompt | 当前章/卷/总纲、章目标、世界/主角/风格 | 多个候选保存在组件；确认后 chapterRepository.update 当前 chapter |
| E13 | 作品详情“大纲管理-生成作品总纲” / src/components/outline/OutlineManager.tsx | outline_generate | outlineGenerateService | 同 E10 | 组件候选；用户保存后 masterOutlineService.save，source=ai_generated |
| E14 | 大纲管理“生成分卷大纲” / OutlineManager.tsx | volume_outline_generate | outlineGenerateService | 同 E11 | 组件候选；用户保存后更新现有 volume 或创建 volume |
| E15 | 大纲管理“生成章节大纲” / OutlineManager.tsx | chapter_outline_generate | outlineGenerateService | 当前采用总纲/卷纲和目标卷 | 候选列表；逐条确认后创建新章节（必要时创建首卷/首章） |
| E16 | 独立大纲编辑器“AI 生成总纲” / src/components/outline/OutlineEditor.tsx | outline_generate | 组件直接 createAiClient → buildOutlineGeneratePrompt | buildOutlineContext 得到的作品、设定、主角、现有卷章 | 字符串进入编辑器 local state；用户保存 outline 表，contextSnapshot 最多 10000 字符 |
| E17 | 独立大纲编辑器“AI 生成卷纲” / OutlineEditor.tsx | volume_outline_generate | 组件直接 createAiClient → buildVolumeOutlineGeneratePrompt | 当前采用总纲、目标卷、世界/主角/风格 | 同 E16，保存 volume_outlines |
| E18 | 独立大纲编辑器“AI 生成章纲” / OutlineEditor.tsx | chapter_outline_generate | 组件直接 createAiClient → buildChapterOutlineGeneratePrompt | 当前采用总/卷纲、目标章、世界/主角/风格 | 同 E16，保存 chapter_outlines |
| E19 | 右栏“AI 生成角色候选” / src/components/right-dock/panels/CharactersPanel.tsx | character_generate | characterGenerateService → buildCharacterGeneratePrompt | 章大纲/标题、已有角色名、作品 worldBackground 前 500 字符 | JSON/文本解析为候选；组件内存；确认后 characterService.create |
| E20 | 右栏“AI 推荐事件” / src/components/right-dock/panels/EventsPanel.tsx | event_suggest | eventSuggestService → buildEventSuggestPrompt | 章标题/大纲、卷目标、角色、上下文记录 | 候选在组件；确认后 chapterEventService.create，source=ai_suggested |
| E21 | 右栏“AI 补充设定” / src/components/right-dock/panels/SettingPanel.tsx | setting_expand | settingExpandService → buildSettingExpandPrompt | 本章标题/大纲、活跃世界设定最多 1200、规则最多 2000 | 候选在组件；确认后保存 world_setting |
| E22 | 设定库“生成候选” / src/pages/SettingSuggestions/SettingSuggestionsPage.tsx | setting_suggestion_generate | settingSuggestionService.buildPrompt | 作品、可选世界/规则摘要、现有角色线索、类型与用户要求 | raw/prompt/JSON 候选写 ai_novel_studio_setting_suggestions；确认后写角色/规则/世界设定 |
| E23 | 右栏“风格分析” / src/components/right-dock/panels/StylePanel.tsx | style_analyze | styleAnalyzeService.analyzeStyle → prompts/style_analyze.md（fetch，失败用内联模板） | 用户粘贴文本或 latest 草稿前 10000 字符 | 结构化结果在组件；确认后 styleProfileService.create source=ai_analyzed |
| E24 | 风格管理“TXT 分析” / src/pages/StyleProfiles/StyleProfilesPage.tsx | style_analyze | styleAnalyzeService.analyzeStyle | 用户粘贴参考文本，最多 20000 字符 | 结构化结果在页面；转入表单后用户保存 style profile；Task 未关联 novel |
| E25 | 右栏“生成章节上下文” / src/components/right-dock/panels/ChapterSummaryPanel.tsx | chapter_summary（现记录为 context_summarize） | chapterSummarizeService → buildChapterSummarizePrompt | latest 草稿（调用处先截 5000）、章标题/大纲 | 结果/校验在组件；确认后依次写 summary、context records、character states、chapter.status |
| E26 | 采用正文后的总结弹窗 / src/pages/WritingWorkspace/WritingWorkspacePage.tsx | chapter_summary（现记录为 context_summarize） | chapterSummarizeService | 当前已采用草稿（调用处先截 3000）、章标题/大纲 | 编辑后确认；依次写 summary、context records、character states、chapter.status |
| E27 | 右栏“生成卷上下文” / src/components/right-dock/panels/ContextViewPanel.tsx | volume_summary（现记录为 context_summarize） | volumeSummaryAiService，System Prompt 在服务内联 | 卷内已完成章的 summaries/contexts，聚合正文最多 8000 字符 | 结果按 volumeId 存组件；确认后创建 context_record(volume_summary) |

## 3. 状态与安全属性

缩写：V=目标版本校验；H=正文 hash 校验；C=Provider 级取消；R=正式 retry/attempt；Hist=任务历史；Atomic=正文是否走现有原子保存。N/A 表示不写正文。

| ID | 状态所有者 / 结果持久化 | 直接覆盖正文 | V / H | C / R | 迟到风险 | Hist | Atomic | 迁移优先级与原因 |
|---|---|---|---|---|---|---|---|---|
| E01 | SettingsPage local state / ai_task_records 摘要 | 否 | N/A | 否/否 | 有，影响测试状态 | 是 | N/A | P2：统一错误/Attempt |
| E02 | 面板 local + ai_task_records + draft | 否；只加载/编辑器替换 | 编辑器应用是/是；正式采用否/否 | 否/否 | 有；目标 guard 能隔离加载 | 是 | 是，但 Tauri 丢 aiTaskId/note | **P0：确认采用重新取 latest，可能采用另一任务草稿** |
| E03 | 同 E02 | 否 | 同 E02 | 否/否 | 有 | 是；失败可能永留 running | 是但来源丢失 | **P0：共用 latest 采用；P1 任务终态** |
| E04 | 面板 local + generation_jobs/steps/snapshot/draft | 否 | context hash 有；目标 base V/H 不完整 | UI 协作取消/无 Attempt | **有；取消不 abort Provider** | generation_jobs | 是但 job ID 在 Tauri 丢失 | P1：第二套任务状态、取消迟到、来源缺失 |
| E05 | generation step + quality tables | 否 | 报告 V/H 是 | 否/否 | 有 | ai_task_records + job step | N/A | P1：隐式二次任务和 patch 需纳入 Artifact |
| E06 | 面板 local + polish_records + draft | 否 | guarded editor 是/是 | 否/否 | 有；有目标 guard | 是 | 是但来源丢失 | P1：polish 失败行可停 pending，来源断裂 |
| E07 | 面板/工作台 QC state + quality tables | 否 | 是/是 | 否/否 | 有；完成前检查 live target | 是 | N/A | P1：统一 Artifact/任务状态 |
| E08 | 面板 local + fix_runs + draft + quality/context tables | 否，但自动加载候选 | 源报告/编辑器是/是；副作用无 ApplyPlan | 否/否 | 有，部分有 live guard | 是 | 是但来源丢失 | **P0：正式采用前就 resolved/expired，并把 fixRun 标 adopted** |
| E09 | 同 E08 | 否 | 是/是 | 否/否 | 有 | 是 | N/A | P1：隐式调用和多表副作用非事务 |
| E10 | 面板 local | 否 | N/A | 否/否 | 有但只展示 | 是 | N/A | P2：结果易丢、无 Artifact |
| E11 | 面板 local | 否 | N/A | 否/否 | 有但只展示 | 是 | N/A | P2：无持久候选 |
| E12 | 面板 local → chapters | 否 | 否/否 | 否/否 | **有** | 是 | N/A | **P0：切章后候选仍可写当前新章节** |
| E13 | 组件 local → master_outlines | 否 | repository version 有；expected V/H/operation 无 | 否/否 | 页面作品固定 | 是 | N/A | P2：补来源 link/幂等 |
| E14 | 组件 local → volume | 否 | 否/否 | 否/否 | 页面作品固定 | 是 | N/A | P1：更新/创建无 Proposal、V/H、operation |
| E15 | 组件 local → volume/chapter | 否 | 否/否 | 否/否 | 页面作品固定 | 是 | N/A | P1：可能多对象创建，无统一事务/来源 |
| E16–E18 | 编辑器 local → outline tables | 否 | outline 自有 version；无 expected H | 否/否 | 有 | 是；异常路径不 markFailed | N/A | P1：任务悬挂、contextSnapshot 截断且 sourceType=manual |
| E19 | 面板 local → characters | 否 | 否/否 | 否/否 | 有；候选不绑定章基线 | 是 | N/A | P1：无持久 Artifact/来源，候选切面板即丢 |
| E20 | 面板 local → chapter_events | 否 | 否/否 | 否/否 | **有** | 是 | N/A | **P0：切章后可把旧建议写入新章；角色 ID 由服务硬取前两名** |
| E21 | 面板 local → world_settings | 否 | 否/否 | 否/否 | 有 | 是 | N/A | P1：无目标/版本/来源 link |
| E22 | 页面 + localStorage → domain tables | 否 | 否/否 | 否/否 | 页面作品可切换 | 是 | N/A | P1：目标写入与候选状态非事务，可能重复采纳 |
| E23 | 面板 local → style_profiles | 否 | 否/否 | 否/否 | 有 | 是，但无 novelId | N/A | P2：latest 可能非未保存正文，来源弱 |
| E24 | 页面 local → style_profiles | 否 | N/A | 否/否 | 有 | 是，但无 novelId | N/A | P2：统一 Task scope/Artifact |
| E25 | 面板 local → 4 类业务写入 | 否 | summary 保存有 draftVersion/hash | 否/否 | **有** | 是 | N/A | **P0：切章后旧结果可写新章；多写入可部分成功** |
| E26 | 工作台 modal → 4 类业务写入 | 否 | summary 有 V/H | 否/否 | 有 | 是 | N/A | P1：多写入无单一事务、无 target links |
| E27 | 按 volumeId local map → context_records | 否 | 否/内容 hash 可选 | 否/否 | 有但按卷隔离 | 是 | N/A | P1：类型与章节总结混用、无来源版本 |

## 4. 失败终态与历史缺口

- AiGeneratePanel 和 OutlineEditor 在回调内部创建 task，外层 catch 取不到 taskId；Provider/保存失败时记录可能永久 running。
- polish_records 在 AI/草稿保存失败时未统一改 failed。
- chapterSummarizeService 与 volumeSummaryAiService 都写 taskType=context_summarize；已声明的 chapter_summarize 没有被使用，历史无法可靠区分。
- ai_task_records 只保存 300–500 字符摘要，没有 Attempt、取消 API、输入/上下文/约束快照、目标版本/hash、traceId/operationId、Artifact/target link。
- generation_jobs 是并行任务模型；update command 接受任意 patch，状态转换无后端权威表。

## 5. 未发现的入口

没有生产流式/增量写入、选区润色、扩写、缩写、通用续写、Target Resolver、多目标 Apply 或正文范围锁。代码中存在 append/replace_all 的编辑器应用模式，但它们消费完整候选草稿，不是选区 AI 入口。

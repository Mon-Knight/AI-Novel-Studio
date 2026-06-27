# AI Novel Studio - CHANGELOG

## v2.1.0 (2026-06-27) - 单章质量闭环稳定版

### 新增

- 章节工程面板新增“工程 / 快照 / 生成 / 版本 / 质检 / 修复”闭环摘要，集中展示单章正文生产链路状态。
- 质检页新增最新结构化质量报告摘要、待处理问题列表与风险分布，生成完成后会自动刷新。
- 任务页新增局部修复建议、低风险数量、自动应用数量与待确认数量汇总。

### 修改

- AI 生成草稿与自动修复草稿写入来源 `generation_job` ID，正文版本可回溯到具体任务。
- 应用版本号更新为 `v2.1.0`。

## v2.0.3 (2026-06-27) - 正文版本管理增强

### 新增

- 草稿历史面板显示与当前草稿匹配的最新质量检查评分。
- 草稿历史面板新增“废弃”操作，非正式草稿可直接从版本列表移除。

### 修改

- 草稿历史“载入”文案调整为“恢复”，明确其作用是恢复到当前编辑区；“采用”继续作为正式正文入口。
- 应用版本号更新为 `v2.0.3`。

## v2.0.2 (2026-06-27) - 局部修复 Patch

### 新增

- 正文生成任务在质量检查后新增 `patch_generation` 与 `patch_apply` step，基于结构化问题生成局部修复建议。
- 低风险且能精确命中原文 quote 的 patch 会自动应用，并保存为新的 AI 局部修复草稿版本；中高风险或无法精确命中的 patch 仅记录在 step 输出中。

### 修改

- 应用版本号更新为 `v2.0.2`。

## v2.0.1 (2026-06-27) - 生成后结构化质量检查

### 新增

- 正文初稿生成任务在保存草稿后自动执行 `quality_check` step，调用现有 AI 质量检查服务并保存结构化报告与问题列表。
- 生成任务 step 输出新增质量评分、问题数量、待处理数量和报告 ID，工程面板任务页可直接查看本次生成的质检摘要。

### 修改

- 应用版本号更新为 `v2.0.1`。

## v2.0.0 (2026-06-27) - 基于工程面板的正文初稿生成

### 新增

- `GenerationJobService` 新增真实正文初稿任务：编译 `generation_context_snapshot` 后调用当前 AI 设置的正文模型，并将结果保存为章节草稿版本。
- 章节工程面板“任务”页签新增“生成本章初稿”入口，展示任务进度与 step 输出，生成成功后同步回写作台草稿流。
- 正文生成请求改为基于已编译快照构造 prompt，记录 context hash、模型信息与 token 返回摘要。

### 修改

- 应用版本号更新为 `v2.0.0`。

## v1.9.7 (2026-06-27) - API 任务队列与 Mock Runner

### 新增

- 新增 `generation_jobs` 与 `generation_step_results` SQLite 表、迁移和 Tauri 命令，支持创建、查询、更新、取消生成任务，并记录每一步结果。
- 新增 `GenerationJobService`，支持 `chapter_generation_mock` 任务从预检、上下文编译、章节卡、场景计划到 mock draft / skipped 后续步骤的完整跑通。
- 章节工程面板新增“任务”页签，可启动 Mock 任务、查看任务进度、step 输出和取消正在运行的任务。

### 修改

- 应用版本号更新为 `v1.9.7`。

## v1.9.6 (2026-06-27) - 生成上下文编译器

### 新增

- 新增 `GenerationContextCompiler`，将旧式章节上下文、active 章节工程状态、风格/输出控制、当前正文修改编译为统一 `generation_context_snapshot`。
- 新增 `chapter_generation_snapshots` SQLite 表、迁移与 Tauri 读写命令，保存 `compiled_context_json`、`compiled_prompt_text`、`prompt_summary`、`context_hash` 与上下文来源列表。
- 章节工程面板新增“快照”页签，支持手动编译上下文快照、查看来源状态、摘要、hash 与 prompt 预览。

### 修改

- 应用版本号更新为 `v1.9.6`。

## v1.9.5 (2026-06-27) - 章节工程面板

### 新增

- 新增右侧“章节工程”面板，支持维护章节卡、场景计划、生成约束、质量规则与工程版本状态。
- 新增章节工程草稿保存与“保存并应用”流程，区分 draft / active / archived 状态，为后续正文生成上下文编译提供 active 工程输入。
- 新增 `chapter_engineering_states` SQLite 表、迁移与 Tauri 命令，同时保留浏览器开发环境 localStorage 回退。

### 修改

- 写作工作台右侧工具栏新增“工程”入口，保持原有 AI 生成、大纲、角色、事件、设定、风格、上下文、总结、检查、润色等入口不变。
- 应用版本号更新为 `v1.9.5`。

## v1.7.20 (2026-06-24) - 写作台启动、布局与质量检测链路修复

### 修复

- 追加修复质量检测工作台链路：`quality_check_reports` 持久化 `content_hash` / `content_length` / `checked_at`，确保重启或重新打开面板后仍能判断报告是否对应当前正文；AI 修稿复检未明显变好时不再把候选草稿同步覆盖到写作工作台正文。
- 修复写作工作台正文工具栏入口点击后右侧面板被父级点击事件立即关闭的问题，确保“AI 生成 / 质量检测 / 草稿历史”等工作台内入口可以真正展开对应面板。
- 修复启动加载页过早被移除导致开机动画不明显的问题，确保 React 首屏挂载后仍保留最短展示时间再淡出。
- 修复写作工作台首次进入偶发误判“作品不存在”，现在会在判定前进行短重试和作品列表反查。
- 修复质量检测保存失败时桌面端错误被 localStorage 兜底改写成“报告不存在”的问题，并在报告占位缺失时自动重建一次后重试保存。
- 修复桌面端质量检测保存结果传参错误，`save_quality_check_result` 现在按 Tauri 命令要求传入 `{ input }`，不再出现 missing required key input。
- 修复 AI 修稿复检读取 `revised_content` / `fixed_issue_keys` 等 snake_case 返回字段失败的问题，避免正确返回的修订版正文被误判为空。
- 移除正文编辑区内“保存草稿 / 查看大纲 / 草稿历史 / AI 生成 / 质量检测 / 一键排版 / 确认采用”旧按钮条，并将保存、草稿、排版、采用入口收纳到右侧功能栏。
- 启动阶段不再等待系统强调色读取后才挂载 React，降低冷启动白屏风险。
- 新增静态启动加载页与前端/后端启动耗时日志，启动时不再显示纯白无反馈页面。
- 质量检查改为基于当前编辑器正文快照；未保存正文会先保存为检查快照草稿，再绑定检查报告。
- 修复质量检查报告只在 localStorage 创建、Tauri 保存结果时找不到报告的问题。
- 质量检查结果新增正文 hash/长度/检查时间快照，正文变更后显示过期提示。
- 质量检查面板折叠/展开保留当前章节结果，切换章节时不显示错误章节的检查结果。
- AI 修稿和润色链路使用当前编辑器正文快照，生成的新草稿会同步回正文编辑区。

### 修改

- 写作台顶部工具栏按“草稿与章节 / AI 与排版 / 确认采用”分组。
- 正文编辑区减少外层留白，扩大可用编辑宽度，同时保留阅读宽度上限。
- 右侧质量面板打开时正文区域让出面板空间，大窗口下分栏更稳定。
- 质量检查 prompt 增加“只分析当前正文快照”的硬性约束，并要求证据来源于正文。

## v1.7.13 (2026-06-24) - 章节总结升级为章节上下文，打通上下文入库

### 新增

- **章节总结 → 章节上下文升级**：
  - 章节总结不再是临时文本，而是绑定章节、绑定正文版本的**章节上下文**。
  - 生成后自动进行一致性校验（本地算法），检测编造、遗漏、角色错误、设定错误、推测等问题。
  - 校验通过后自动启用并写入上下文记录，供后续 AI 生成调用。

- **一致性校验** (`summaryValidator.ts`)：
  - 本地关键词匹配算法，快速检测总结与正文的明显矛盾。
  - 校验结果分 `passed`/`failed`，score 低于 70 不自动启用。
  - 导出 `hashContent()` 用于正文版本绑定。

- **卷自动归类**：
  - 章节上下文根据 `chapter.volume_id` 自动归类到所属卷。
  - 章节未归属卷时阻止生成，提示用户先归类。

- **过期机制**：
  - 章节上下文绑定 `content_hash` 和 `draft_version`。
  - 正文版本变化后自动标记上下文为已过期。
  - 过期上下文默认不参与 AI 生成。

- **上下文记录面板升级** (ContextViewPanel)：
  - 新增分类标签：全部 / 章节上下文 / 手动上下文。
  - 过期记录计数和标记。

- **Tauri 后端命令** (新增 9 个)：
  - `save_chapter_summary` — 创建/更新章节总结。
  - `get_chapter_summary` — 按章节 ID 获取。
  - `mark_chapter_summaries_expired` — 标记过期（含关联 context_records）。
  - `update_chapter_summary_enabled` — 启用/停用。
  - `save_context_records` — 批量保存上下文记录。
  - `get_context_records` — 获取作品全部上下文。
  - `update_context_record_active` — 切换启用。
  - `delete_context_record` — 删除。

### 数据库迁移

- `chapter_summaries`：新增 `volume_id`、`enabled`、`content_hash`、`draft_version`、`is_expired`、`validation_status`、`validation_result`、`core_events`、`protagonist_state_change`、`important_character_changes`、`setting_changes`、`new_locations`、`new_items_or_abilities`、`foreshadowing`、`unresolved_questions`、`facts_must_remember`、`next_chapter_hook`。
- `context_records`：新增 `volume_id`、`is_expired`、`content_hash`、`draft_version`。

### 修改

- `src/types/chapterSummary.ts`：新增 `ChapterSummaryValidation`、`ValidateSummaryInput`；`ChapterSummary` 扩展结构化字段 + 校验/过期/启用字段。
- `src/types/context.ts`：`ContextRecord` 新增 `volumeId`/`isExpired`/`contentHash`/`draftVersion`；新增 `ContextCategory` 分类类型。
- `src/services/ai/summaryValidator.ts`：新增一致性校验 + 正文哈希工具。
- `src/services/context/chapterSummaryService.ts`：升级为 Tauri + localStorage 双模。
- `src/services/context/contextRecordService.ts`：升级为 Tauri + localStorage 双模，新增 `createBatch`。
- `src/components/right-dock/panels/ChapterSummaryPanel.tsx`：增加校验流程、过期提示、卷归属检查、启用/停用按钮。
- `src/components/right-dock/panels/ContextViewPanel.tsx`：增加分类标签、过期计数。
- `src-tauri/src/commands.rs`：新增 ChapterSummary + ContextRecord 相关 DTOs 和 9 个命令。
- `src-tauri/src/db.rs`：新增 `migrate_chapter_summaries_table` 和 `migrate_context_records_table`。
- `src-tauri/src/main.rs`：注册 9 个新命令。

## v1.7.12 (2026-06-24) - 修复 AI 任务记录删除 FOREIGN KEY 约束失败 + 质量检查问题处理闭环

### 修复

- **修复 AI 任务记录删除 FOREIGN KEY constraint failed 问题**（根因修复）：
  - `ai_task_records` 被 3 个子表通过外键引用：`chapter_drafts.ai_task_id`、`quality_check_reports.ai_task_id`、`polish_records.ai_task_id`。
  - 原删除逻辑直接 `DELETE FROM ai_task_records`，未先清理子表引用，导致 SQLite 外键约束阻止删除。
  - 修复后：单条删除、多选删除、清空全部均**先清理子表 `ai_task_id` 引用，再删除父表记录**。
  - 所有删除操作均包裹在显式事务中（`BEGIN TRANSACTION` / `COMMIT` / `ROLLBACK`）。
  - 额外清理 `chapter_events` 和 `chapter_summaries` 中的 `ai_task_id` 引用以保持数据整洁。
- Rust `DeleteAiTaskRecordsResult` 新增 `deleted_child_rows` 字段，记录各子表清理行数。
- 前端 `DeleteAiTaskRecordsResult` 类型同步新增 `deletedChildRows` 字段。

### 新增：质量检查「问题处理闭环」正式可用化

- **数据库迁移**：
  - `quality_check_reports` 新增 `draft_version`、`model` 字段。
  - `quality_check_items` 新增 `status`（pending/resolved/ignored）、`issue_key`、`resolution_note`、`resolved_at`、`paragraph_index`、`category`、`quote` 字段；弃用旧 `is_resolved` 布尔值。
  - 新增索引：`idx_quality_check_items_issue_key`、`idx_quality_check_items_status`、`idx_quality_check_items_chapter_id_status`。

- **Tauri 后端命令**（新增 4 个）：
  - `get_quality_check_issues(chapter_id)` — 获取最新报告 + 问题列表 + 统计。
  - `update_quality_issue_status(issue_id, status, resolution_note?)` — 更新单条问题状态。
  - `batch_update_quality_issue_status(issue_ids, status)` — 批量更新。
  - `save_quality_check_result(input)` — 保存 AI 检查结果，自动根据 `issue_key` 合并历史问题，保留用户 ignored 状态。

- **前端服务层重构**：
  - `qualityCheckService` 从纯 localStorage 升级为 Tauri SQLite + localStorage 回退双模式。
  - 新增 `generateIssueKey()` — 基于章节 ID + 类别 + 标题 + 引用 + 描述生成稳定 hash，用于重新检测时去重。
  - 新增 `computeStatistics()` — 统一计算 pending/resolved/ignored/critical/high/medium/low 统计。

- **质量检查面板 UI 重构** (CheckPanel.tsx)：
  - 问题状态从布尔 `isResolved` 改为三态：待处理 / 已处理 / 已忽略。
  - 新增筛选按钮：全部 / 待处理 / 已处理 / 已忽略，带数量显示。
  - 统计区显示：总问题、待处理、已处理、已忽略、严重程度分布。
  - 问题卡片增加状态标签和操作按钮：定位、标记已处理、忽略、重新打开。
  - 乐观更新 + 失败回滚，确保 UI 状态与数据库一致。

- **正文定位功能**：
  - EditorArea 新增 `locateTarget` prop：支持按 offset 或文本搜索定位。
  - CheckPanel 新增「📍 定位」按钮，点击后滚动到正文对应位置并短暂高亮。
  - WritingWorkspacePage 中转 `onLocateText` 回调贯穿 RightPanel → CheckPanel → EditorArea。

### 修改

- `src-tauri/src/commands.rs`：新增 quality check 命令 + DTOs + `OptionalExt` trait。
- `src-tauri/src/db.rs`：新增 `migrate_quality_check_tables` 迁移函数。
- `src-tauri/src/main.rs`：注册 4 个新质量检查命令。
- `src/types/qualityCheck.ts`：新增 `QualityIssueStatus`、`QualityIssueFilter`、`QualityCheckStatistics`、`GetQualityCheckIssuesResult` 等类型。
- `src/services/quality/qualityCheckService.ts`：完全重写。
- `src/components/right-dock/panels/CheckPanel.tsx`：完全重写。
- `src/components/right-dock/RightPanel.tsx`：新增 `onLocateText` prop。
- `src/components/workspace/EditorArea.tsx`：新增 `locateTarget` 定位功能。
- `src/pages/WritingWorkspace/WritingWorkspacePage.tsx`：新增定位状态管理和回调。

### 修改（续）

- `src-tauri/src/commands.rs`：
  - `delete_ai_task_records_by_ids_internal`：新增事务 + 子表清理逻辑。
  - `clear_ai_task_records_internal`：新增事务 + 子表清理逻辑。
  - `DeleteAiTaskRecordsResult` 结构体新增 `deleted_child_rows` 字段。
- `src/services/ai/aiTaskService.ts`：`DeleteAiTaskRecordsResult` 接口新增 `deletedChildRows`。

### 备注

- 未使用 `PRAGMA foreign_keys = OFF` 或 `ON DELETE CASCADE`，保持外键约束完整性。
- 不影响作品、章节、草稿、大纲、角色、设定库等无关业务数据。

## v1.7.11 (2026-06-08) - 发布收尾、本地构建产物清理与安装包验证

### 新增

- 新增本地大文件扫描脚本 `scripts/maintenance/report_large_files.ps1`。
- 新增旧构建产物归档脚本 `scripts/maintenance/archive_old_builds.ps1`，默认 dry-run。
- 新增旧构建产物清理脚本 `scripts/maintenance/clean_old_builds.ps1`，默认 dry-run。
- 新增安装包验证清单文档 `docs/technical/installer-verification.md`。
- 新增发布产物保留策略文档 `docs/technical/release-artifact-policy.md`。
- 新增本地构建清理说明文档 `docs/technical/local-build-cleanup.md`。

### 修改

- 版本号统一更新至 `1.7.11` / `v1.7.11`。
- 同步 README 当前版本与阶段说明。
- 同步版本路线图，新增 v1.7.11 节点。
- v1.7.10 NSIS/MSI 安装包标记为稳定基线保留。

### 修复

- 修复 AI 任务记录多选删除、筛选删除和清空全部只删除浏览器本地缓存、不删除 SQLite `ai_task_records` 数据的问题。
- 新增 AI 任务记录删除静态回归检查脚本，覆盖后端命令、Tauri 注册、服务层调用和页面刷新反馈。
- 二次加固 AI 任务记录删除链路：Tauri 环境下移除 `getAll` 等读取接口的错误 localStorage fallback，删除命令返回 SQLite 路径、删除前后计数和命中计数。
- 新增 AI 任务记录运行时删除验证脚本，使用临时 SQLite 文件执行插入、按 ID 删除、重新计数、清空和最终计数校验。
- 三次修复 AI 任务记录清空失败显示“未知错误”的问题：Tauri 字符串错误会被规范化为真实错误摘要，页面和 `dbCall` 均打印完整错误对象，Rust 清空命令补充表存在性、数据库路径和删除前后计数日志。

### 备注

- 本版本不新增业务功能。
- 本版本不修改数据库 schema。
- 本版本不开发分卷、章节、正文生成。
- 本版本不自动删除任何文件。
- 本版本不自动 commit / tag / push。

---

## v1.7.10 (2026-06-08) - 候选设定采纳与测试补齐

### 新增

- 新增设定候选采纳流程，支持角色、势力、地点、规则候选的采纳、编辑后采纳与废弃。
- 新增候选状态流转：`pending`、`adopted`、`edited_adopted`、`discarded`。
- 新增重复采纳保护，已处理候选不能再次写入正式资产。
- 新增 `npm run test:setting-suggestions` 静态回归脚本，检查路由、状态、Mock 支持、采纳入口与重复采纳保护。

### 修改

- 版本号统一更新至 `1.7.10` / `v1.7.10`。
- 同步 README、路线图、设定推演设计、导入导出说明与测试文档。

### 验证

- 覆盖设定候选生成、列表展示、状态过滤、采纳、编辑后采纳与废弃的静态回归检查。

### 开发者备注

- 本版本不修改数据库结构。
- 角色候选采纳进入角色库。
- 规则候选采纳进入规则体系。
- 势力、地点候选在当前正式资产模块尚未独立拆分前，采纳为世界设定条目。
- 本版本不实现 v1.8.0+ 的分卷大纲生成、章节大纲生成或正文生成新链路。

---

## v1.7.9 (2026-06-08) - 设定库 AI 推演基础版

### 新增

- 新增 `/novels/:id/setting-suggestions` 页面，用于生成设定库候选。
- 新增 `/worlds/:worldId/lore/suggestions` 兼容入口。
- 新增 `settingSuggestionService`，统一封装候选生成、解析、保存、采纳和废弃。
- 新增设定候选类型定义：角色、势力、地点、规则。
- 新增 Mock AI 输出，支持无 API Key 测试设定推演流程。
- 新增 AI 任务类型 `setting_suggestion_generate`，候选生成会进入 AI 任务记录。

### 修改

- 作品详情页和创作资产页增加“设定库 AI 推演”入口。
- 顶部栏识别设定推演页面标题。

### 开发者备注

- AI 只生成候选，不自动写入正式数据。
- 候选池保存在本地 LocalStorage，不新增 SQLite 表。

---

## v1.7.8 (2026-06-08) - 导出文件位置选择与导出体验优化

### 新增

- 桌面模式下通过 Tauri 保存对话框选择导出位置。
- 导出成功后在 UI 中展示保存路径。
- JSON 备份使用统一保存服务，不再依赖未定义的浏览器下载函数。

### 修改

- 章节 TXT / Markdown、整本 TXT / Markdown、JSON 备份导出接口统一返回保存路径。
- 扩展 Tauri 文件系统写入权限到用户主目录、文档、下载和桌面目录。

### 修复

- 修复 `exportNovelToMarkdown` 返回类型与调用方不一致的问题。
- 修复 `exportNovelBackupJson` 调用未定义 `downloadBlob` 的问题。
- 修复 Tauri 配置 JSON 结构错误。

---

## v1.7.7 (2026-06-08) - 桌面端窗口与 2K 适配

### 新增

- 首页、作品详情页、创作资产页、导入导出页增加更适合桌面端和 2K 分辨率的响应式布局约束。
- 设定推演页面采用桌面工作台式双栏布局，并在窄窗口下自动收敛为单栏。

### 修改

- 卡片网格改为自适应列宽，避免 2K 屏幕上表单和卡片被无限拉伸。
- 作品详情页基础信息卡片改为响应式网格。

---

## v1.7.6 (2026-06-08) - 阶段性整理、文档体系重整与 EXE 验证

### 新增

- 新增 `docs/README.md` 文档索引。
- 新增 `docs/user/` 用户指南分组。
- 新增 `docs/project/` 项目管理文档分组。
- 新增 `docs/technical/` 技术文档分组。
- 新增 `docs/design/` 设计文档分组。

### 修改

- 重构 `README.md` 结构，使其更适合使用者和开发者阅读。
- 将过长说明拆分到 docs 子文档。
- 统一版本路线说明，README 与 version-roadmap 同步。
- 更新 Tauri 默认窗口尺寸为 1280 × 820，最小窗口高度为 700。

### 验证

- 前端构建通过。
- 现有路由不受影响。

### 开发者备注

- 本版本不新增核心业务功能。
- 本版本不修改数据库结构。
- 本版本用于完成 v1.7.x 应用化阶段的文档与结构收口。

---

## v1.0.46 (2026-05-26) - Tool Layer 接入真实项目读取

### 新增

- `src/agent-tools/style-tools.ts`：风格方案只读 Tool。
- `src/agent-tools/context-tools.ts`：Agent 可读上下文聚合 Tool。
- `src/agent/context-summary.ts`：上下文摘要格式化器。
- `createChapterReadinessWorkflow()`：章节准备度检查 Workflow。
- `validateWorkflow()`：Workflow 结构校验器。

### 修改

- `project-tools.ts`、`chapter-tools.ts`、`verification-tools.ts` 从占位升级为读取真实项目数据的基础接口。
- `planner-lite.ts` 新增 Chapter Readiness Workflow。
- `workflow-runner.ts` 新增 Workflow 结构校验。

### 开发者备注

- Tool Layer 只读，不写数据库、不自动写正文、不调用外部 AI。
- 不修改数据库 schema。

---

## v1.0.45 (2026-05-26) - 项目开发辅助 Skills 增强版

### 新增

- 新增开发辅助 Skills、Checklists、Cursor Rules 与 `docs/development-skills.md`。

### 修改

- 完善 Agent 任务书、Bug 修复、文档同步、发布与验证工作流规则。

---

## v1.0.44 (2026-05-26) - Agent Workflow Runtime 最小闭环

### 新增

- 新增 Agent Workflow Scripts、Agent Checklists、Workflow Docs、Agent Core、Agent Tools 与 Prompt Pipeline 基础文件。

### 开发者备注

- 不新增小说业务功能。
- 不修改数据库 schema。
- 不替换现有正文生成链路。

---

## v1.0.43 (2026-05-26) - Agent 基础设施建设

### 新增

- 新增 `AGENTS.md`、GitHub instructions、prompts、skills、Cursor Rules 与基础架构文档。

### 开发者备注

- 建立 Agent 工程化开发约束，为 v2.x Agent 化阶段打基础。

---

## v1.0.41

- 早期基础版本。

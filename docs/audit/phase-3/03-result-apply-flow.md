# 03 — AI 结果应用链路审计

## 1. 当前正文安全基线

v2.1.1/v2.2.0 已提供可复用基础：

- AI 正文候选先通过 draftVersionService.create 保存为新 chapter_draft，不直接覆盖 adopted。
- onGenerated / onApplyAiText 携带 resultId、novelId、chapterId、sourceDraftId、sourceRevision、baseContentHash。
- WritingWorkspacePage 与 EditorArea 在载入/追加/replace_all 前重新检查目标、来源草稿和正文 hash；DocumentApplyIdempotencyGuard 阻止会话内重复消费。
- 正式 adopt 在 Rust 单一 transaction 中校验草稿归属并更新 chapter_drafts 与 chapters。
- 保存正文统一走 save_chapter_draft_atomic；长文本读取失败 fail-closed。

这些 guard 保护“把一个已知结果加载到当前编辑器”，但还不是持久化 Artifact/ApplyPlan：页面刷新后幂等 guard 消失，adopt 没有 expected version/hash/operationId/target link。

## 2. 结果去向总表

| 结果类型 | 响应→解析→预览 | 用户确认 | 最终写入 | 当前风险 |
|---|---|---|---|---|
| 章节生成/按大纲修正 | 字符串→候选 draft→面板/工作台 | 加载编辑器、追加、全文替换或正式采用 | chapter_drafts；adopt 后 chapters | 确认采用重新查询 latest，而非绑定 displayed resultId；Tauri 保存丢来源 |
| 章节工程生成 | 字符串→step output→候选 draft；自动质检/patch | 候选可在工作台/历史采用 | generation_*、chapter_drafts、quality tables | job 与 task 双模型；取消不隔离迟到响应；aiTaskId 丢失 |
| 润色 | 字符串→候选 draft→面板 | guarded 追加/替换；正式采用另行操作 | polish_records、chapter_drafts | 失败 polish row 可 pending；来源 link 断裂 |
| 质量检查 | JSON/容错解析→报告/问题列表 | 无需采用，只更新问题状态 | quality_check_reports/items | 长章只检查前段；任务/Artifact 不可回放 |
| AI 修稿 | JSON→scope validation→候选 draft→隐式复检 | UI 之后仍显示“确认采用” | fix_runs、draft、quality/context 多表 | 比较更好时已经标 adopted、resolved/expired 并加载正文；副作用非事务 |
| 总纲（右栏） | 字符串→textarea | “采用”仅复制 | 无 | 结果易丢、命名与行为不一致 |
| 卷纲（右栏） | JSON→卡片 | 无保存按钮 | 无 | 结果易丢 |
| 章纲（右栏） | JSON→可编辑候选 | 采用 | chapters.update | 候选没绑定生成时 chapter；切章可错写 |
| 大纲管理/独立编辑器 | 字符串/JSON→页面候选/编辑器 | 保存/逐条保存 | outline tables、volumes、chapters | 无 operationId/target link；部分路径可能创建多个对象 |
| 角色候选 | JSON→组件候选 | 确认 | characters | 无持久 Artifact/task link；只校验主角重名的一部分路径 |
| 事件候选 | JSON→组件候选 | 采用建议 | chapter_events | 切章后 handler 使用新 chapter；AI 角色映射被前两名覆盖 |
| 章节设定 | JSON/文本→组件候选 | 采用 | world_settings | 无来源、expectedVersion/hash |
| 设定库候选 | JSON→localStorage 持久候选 | 采纳/编辑采纳/废弃 | characters/rule_systems/world_settings + localStorage 状态 | DB 写成功与候选状态更新非事务；localStorage 写失败被吞，可重复创建 |
| 风格分析 | JSON→组件/页面 | 保存/转表单 | style_profiles | Task 无 novel 范围；无 Artifact link |
| 章节总结 | JSON→组件/modal→本地校验 | 确认保存 | chapter_summaries、context_records、character_states、chapters | 四类写入非事务；右栏旧结果可串章；部分失败被 catch |
| 卷总结 | JSON→按 volumeId 预览 | 保存卷上下文 | context_records | 无来源版本/hash/task link |

## 3. P0 — 可能造成正文或数据库错误覆盖

### P0-01 “确认采用”绑定 latest，而不是结果

AiGeneratePanel 展示 latestGeneratedDraft，但 handleAdoptLatestDraft 再调用 getLatestByChapterId。若另一任务在预览后保存了更新候选，用户确认 A 时可能正式采用 B。应冻结 artifactId/resultId→draftId，并在 transaction 内校验 draft version/hash；禁止 latest 查询替代用户确认对象。

### P0-02 章纲/事件旧候选可串章

RightPanel 切章节不卸载当前面板。OutlinePanel.handleAdoptChapterOutline 和 EventsPanel.handleAdoptSuggestion 使用点击时最新 chapter prop，没有保存生成时 chapterId/base。旧章候选可被写入新章。迁移前需将候选绑定 Task scope；切章后标 stale 并拒绝应用。

### P0-03 章节总结旧结果和多步写入

ChapterSummaryPanel 切章时会 reload summary，但没有清空 genResult/adoptedDraft。handleSaveSummary 使用当前 chapter 与旧结果，且依次创建 summary、context records、character states、chapter status，多处 catch 后继续，能形成部分应用。必须进入 Artifact + multi-operation ApplyPlan；v2.3 单目标阶段至少禁止串章并把“保存总结”限定为 summary 单目标。

### P0-04 AI 修稿在正式采用前产生正式副作用

CheckPanel 在复检判定 better 后：

- fixRun.status 直接设 adopted；
- 旧问题逐项标 resolved；
- 新 quality report 成为当前展示；
- 章节/卷上下文标 expired；
- 候选草稿被加载到编辑器；
- UI 随后仍提供“确认采用”。

这使“候选更好”与“用户正式采用”混为一谈，且任一步失败会部分提交。所有副作用必须延迟到用户确认的 ApplyPlan transaction；复检结果只能形成验证/Proposal。

## 4. P1 — 串行、重复、部分失败或来源丢失

- draftVersionService.create 在浏览器保存 aiTaskId/note，但桌面 save_chapter_draft_atomic 输入/DTO 没有这些字段；所有 Tauri AI 候选与任务/说明断链。
- settingSuggestionService 先写正式对象，再更新 localStorage 候选；lsSet 捕获异常不抛，重复点击可再建对象。
- ChapterSummaryPanel/WritingWorkspace 的 summary、contexts、character states、chapter.status 不是一个 transaction。
- generation job 取消只改 DB 状态；Provider 迟到响应可写 step output，状态机无 CAS。
- OutlineManager 首卷/章节创建和各业务确认路径没有 operationId；重复点击/commit unknown 无法返回首次权威结果。
- 现有 DocumentApplyIdempotencyGuard 只在页面会话内，刷新/重启后不能防重复。
- adopt transaction 没有 operationId、expected draft version 或 content hash；用户预览后候选若被改动无法检测。
- quality fix 的 sourceContentHash 实现不是统一完整 SHA-256；scope validator 的 unrelatedChangedCount 对每个变化段落递增且不参与拒绝。
- 全文润色/修稿/质检在截断正文后仍把结果当全章，长章有内容遗漏风险。

## 5. P2 — 状态、交互和追踪不统一

- 总纲同一任务在三个 UI 中分别“只复制”“保存版本”“编辑后保存”。
- 大多数组件候选只在内存，面板切换/刷新即丢。
- 各入口成功/失败文案、loading、重试和历史摘要不一致。
- character/event/setting/style 的正式对象一般不保留 aiTaskId 或 Artifact 来源。
- ai_task_records.resultText/promptSnapshot/resultJson 仅保留截断摘要，无法证明结果与正式目标关系。

## 6. 正文范围与 selection

当前没有生产选区 AI 应用。quality_check_items 的 start_offset/end_offset 主要用于定位问题，不是可写范围锁。任何未来局部润色/扩写/缩写不得复用旧 offset 直接替换。

v2.4 使用 TextRangeLock：draftId/version + baseContentHash + UTF-16 start/end + selectedContentHash + anchors。校验冲突时不得退化为整章 replace_all；模糊重定位只生成用户确认的新锁/新 Plan。

## 7. 单目标迁移路径

~~~text
Provider response
→ immutable ResultArtifact
→ validation
→ single-target PlacementProposal
→ immutable ApplyPlan
→ user confirmation
→ existing domain Service/Repository transaction
→ ArtifactTargetLink
~~~

章节正文必须继续复用 save_chapter_draft_atomic 的事务内核心，扩展来源字段和 target link；不新建正文 SQL。人物、大纲、设定、质量报告等也必须由各自 Service/Repository 写入，不允许 React 组件直接操作数据库。

## 8. 成功判定

UI 只在后端返回 ApplyPlan.status=completed 且 target links 完整时显示“已应用”。以下都不是成功：Provider 返回、Artifact valid、候选草稿已创建、编辑器已加载、localStorage 状态已改、前端 optimistic 更新。commit_unknown 必须显示待对账，不得提示失败后鼓励盲重试。

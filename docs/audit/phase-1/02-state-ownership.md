# 正文、章节与状态所有权审计

## 1. 核心判定

1. **持久化正式正文**：桌面端实际以 `chapter_drafts` 中 `is_adopted = 1` 的草稿为事实来源；`chapters.adopted_draft_id` 虽存在但当前采用命令从未维护它。
2. **当前编辑会话**：`EditorArea` 内部 `content` 是用户正在看的/编辑的文本，可能尚未保存，只存在于 React 组件内存。
3. **页面镜像**：`WritingWorkspacePage.currentDraft` 是当前加载/生成的草稿对象；`editorSnapshot` 是编辑器回传的派生快照，不是独立持久化正文。
4. **AI 候选**：AI 生成、重生成、润色、修复会创建新的 `chapter_drafts`，默认 `is_adopted = 0`。它们是候选版本，不应等同正式正文。
5. **不存在自动保存**：未发现正文 autosave、`beforeunload` 保存或章节切换前保存。章节切换只确认“章节目标”是否未保存，不确认编辑器正文。
6. 当前实现存在可导致正文丢失/错位的 P0 链：异步加载/AI 回调不校验活动章节，编辑器也不校验 `currentDraft.chapterId === chapter.id`。

## 2. 状态所有权表

| 状态                          | 权威所有者                          | 生命周期      | 持久化                                | 写入者                                 | 读取者                                | 当前问题                                                    | 置信度   |
| ----------------------------- | ----------------------------------- | ------------- | ------------------------------------- | -------------------------------------- | ------------------------------------- | ----------------------------------------------------------- | -------- |
| 当前项目 ID                   | 路由参数 `novelId`                  | 页面/路由     | URL                                   | Router                                 | `WritingWorkspacePage`、服务调用      | 异步回调没有统一 project generation token                   | 代码确认 |
| 当前项目对象                  | `WritingWorkspacePage.novel`        | 页面          | 源数据在 `novels`                     | 页面加载                               | 工作台                                | 与路由 ID 并存，属缓存镜像                                  | 代码确认 |
| 当前章节 ID                   | `activeChapterId`                   | 页面          | 否                                    | 章节点击、初始化、新建                 | `activeChapter` 派生、右栏、编辑器    | 先切 ID、后异步加载草稿；无请求序号                         | 代码确认 |
| 目标章节 ID（旧 AI 面板）     | 请求启动闭包中的 `chapter.id`       | 单次 async    | 部分写入 `ai_task_records.chapter_id` | 面板                                   | 草稿创建                              | DB 保存目标固定，但迟到回调会更新新章节 UI                  | 代码确认 |
| 目标章节 ID（generation job） | `GenerationJob.chapterId`           | 持久任务      | `generation_jobs.chapter_id`          | `generationJobService.create`          | job runner                            | 绑定章节但缺基础正文版本/hash                               | 代码确认 |
| 当前草稿对象                  | `WritingWorkspacePage.currentDraft` | 页面          | 对应 `chapter_drafts`                 | 加载、保存、AI `onGenerated`、历史恢复 | Editor、右栏                          | 更新时不校验活动章节                                        | 代码确认 |
| 编辑器正文                    | `EditorArea.content`                | 组件挂载      | 否                                    | 用户输入、草稿 effect、apply request   | 保存、选区快照                        | 章节切换可被旧草稿覆盖；未保存正文无离开保护                | 代码确认 |
| 编辑器派生快照                | `editorSnapshot`                    | 页面          | 否                                    | `onEditorContentChange`                | AI 上下文、dirty/hash                 | 不是提交快照；与 `currentDraft` 可能跨章节混合              | 代码确认 |
| 未保存正文                    | `EditorArea.content + isDirty`      | 内存          | 否                                    | 用户                                   | 保存/替换确认                         | 切换章节不确认，页面卸载无恢复                              | 代码确认 |
| 持久草稿版本                  | `chapter_drafts`                    | 长期          | SQLite                                | `draftVersionService`                  | 工作台/历史/质量                      | version 号用 `MAX+1`，无唯一约束/事务防并发                 | 代码确认 |
| 正式正文                      | `chapter_drafts.is_adopted`         | 长期          | SQLite                                | `adopt_chapter_draft`                  | `getAdoptedByChapterId`               | 采用的两次 UPDATE 无事务；可能出现 0 个正式版本             | 代码确认 |
| `chapters.adopted_draft_id`   | `chapters` 列                       | 长期          | SQLite                                | 当前未发现写入                         | DTO/部分上下文类型                    | 已建立但未接入正式采用链                                    | 代码确认 |
| 长正文全文                    | `large_text_documents/chunks`       | 长期          | SQLite                                | `large_text_save.rs`                   | `draftVersionService.readFullContent` | 与 draft 引用分两次操作；读取失败静默退回 500 字预览        | 代码确认 |
| AI 候选正文                   | 非采用 `chapter_drafts`             | 长期          | SQLite                                | 生成/润色/修复服务                     | 编辑器、历史                          | 创建后经 `onGenerated` 自动成为当前编辑草稿，但不是正式正文 | 代码确认 |
| 章节目录对象                  | `chapters[]`                        | 页面镜像      | 源数据在 SQLite                       | repository reload                      | 目录/上下文                           | `adoptedDraftId` 字段不可靠                                 | 代码确认 |
| 右栏显示状态                  | `sidebarState.activeTool/collapsed` | 页面          | 否                                    | toolbar/close                          | RightPanel                            | 页面重启丢失                                                | 代码确认 |
| 各右栏业务结果                | 多数面板 local state                | 面板组件      | 多数否                                | 各面板                                 | 各面板                                | 收起保留，换面板卸载；业务状态与 UI 生命周期混合            | 代码确认 |
| 质量报告                      | SQLite + 页面 `qcReport/qcItems`    | 长期/页面缓存 | 是                                    | quality service                        | CheckPanel                            | 报告绑定较完整；加载/回调仍缺章节请求令牌                   | 代码确认 |

## 3. 正文事实来源

### 3.1 SQLite 正文模型

`chapter_drafts` 包含 `chapter_id`、`content`、`version_no`、`is_adopted`、`ai_task_id`、`large_text_ref_id`（初始化定义与后续补列见 `src-tauri/src/db.rs:188-207,1080-1085`）。创建草稿总是 `is_adopted=0`：

```text
create_chapter_draft
→ 查询 chapter 内 MAX(version_no)
→ INSERT 新草稿，version_no = max + 1，is_adopted = 0
```

证据：`src-tauri/src/commands.rs:1093-1142`。没有 `UNIQUE(chapter_id, version_no)`，`MAX+1` 与 INSERT 也未包在显式事务内。由于全局连接 mutex 通常串行化单进程 command，正常路径冲突概率较低；多实例/超时重试路径未被约束。结论：高度可能。

### 3.2 正式正文判定

前端 `draftVersionService.getAdoptedByChapterId` 获取章节全部草稿后查找 `isAdopted`：`src/services/database/draftVersionService.ts:155-158`。采用 command：

```text
UPDATE chapter_drafts SET is_adopted=0 WHERE chapter_id=?
UPDATE chapter_drafts SET is_adopted=1 WHERE id=? AND chapter_id=?
SELECT draft WHERE id=?
```

证据：`src-tauri/src/commands.rs:1169-1189`。

关键事实：

- 两个 UPDATE 没有事务。
- 第二个 UPDATE 不检查 affected rows。
- 最后按 `draft_id` 查询，不再次约束 `chapter_id`。
- 没有更新 `chapters.adopted_draft_id`；全仓搜索未发现 `UPDATE chapters ... adopted_draft_id`。

因此 `chapters.adopted_draft_id` 不是当前可信事实来源；真正事实是 `chapter_drafts.is_adopted`。如果传入不存在或属于另一章节的 draft ID，第一个 UPDATE 已撤销新章节正式版本，而第二个 UPDATE 不生效；函数仍可能返回另一章节的草稿。风险：P0。置信度：代码确认。

### 3.3 编辑会话

`EditorArea` 的 `content` / `isDirty` 在 `src/components/workspace/EditorArea.tsx:71-75`。`currentDraft` 变化时 effect 直接把草稿正文写入编辑器（`102-117`），但没有验证草稿和 `chapter` 的 ID 一致。

正文修改只更新内存和父级镜像（`240-261`）；保存由 Ctrl+S、右栏命令或采用前显式触发（`281-319,383-402`）。全仓未找到正文自动保存定时器、`beforeunload` 或页面卸载保存。结论：代码确认。

### 3.4 大文本正文

超过阈值的正文先通过 `saveLargeTextWithChunks` 落入 `large_text_documents/chunks`，`chapter_drafts.content` 只保存前 500 字和引用提示，然后另一次 command 创建/更新草稿引用：`draftVersionService.ts:160-220,236-297`。

这意味着：

- 大文本事务只覆盖 document + chunks，不覆盖后续 draft 行/引用。
- 后续草稿写入失败会留下未引用的大文本 document。
- 读取大文本失败时 `readFullContent` 返回 null，列表/最新草稿会保留截断预览（`95-105,119-152`）。
- 用户若在该预览上继续编辑并保存，可能把截断文本当完整正文形成新版本。风险：P0；需要故障注入确认实际用户路径，置信度：高度可能。

## 4. 章节切换真实时序

当前实现：

```text
用户点击章节 B
→ handleSelectChapter(B)
→ 仅确认 chapterGoalDirty（不检查正文 isDirty）
→ setActiveChapterId(B)
→ 不关闭右栏
→ 异步 loadChapterDraft(B)
→ getLatestByChapterId(B)
→ setCurrentDraft(result)
→ EditorArea effect 将 currentDraft.content 写入 textarea
→ writingContext / 右栏 props 随页面状态重新派生
```

证据：`WritingWorkspacePage.tsx:232-242,159-166`，`EditorArea.tsx:101-117`。

任务书期望的“保存旧章节”步骤当前不存在；实际链路直接切换。

## 5. 章节切换风险分析

### S-01：未保存正文直接丢失 — P0

`handleSelectChapter` 只调用 `confirmDiscardChapterGoal`，不读取 `editorSnapshot.isDirty` / 页面 `isDirty`，然后切换章节。新草稿到达后 EditorArea 覆盖本地 `content`。没有自动保存或恢复缓存。证据：`WritingWorkspacePage.tsx:232-242`、`EditorArea.tsx:102-117`。置信度：代码确认。

### S-02：快速 A→B→C 的加载乱序 — P0

`loadChapterDraft(chapterId)` 没有 AbortController、request id、generation counter 或“响应章节 == 当前章节”校验。若 B 的读取晚于 C，B 草稿最后写入 `currentDraft`；EditorArea 随后在 C 标题下显示 B 正文。证据：`WritingWorkspacePage.tsx:159-166,237-242`、`EditorArea.tsx:102-117`。置信度：代码确认；发生概率待动态故障注入。

### S-03：错误章节保存的假成功 — P0

乱序后 `currentDraft.id` 可能来自 A/B，而 `chapter.id` 已为 C。保存时前端调用：

```text
draftVersionService.update(currentDraft.id, chapter.id, content)
```

Rust UPDATE 用 `WHERE id=? AND chapter_id=?`，0 行时随后仍按 `id` 读取并返回旧草稿；即使真正 0 行，前端也存在 `savedDraft ?? currentDraft` 与标记 clean 的路径。证据：`EditorArea.tsx:281-319`、`commands.rs:1145-1165`。这会向用户显示“已保存”而目标章节内容并未按预期写入。置信度：代码确认。

### S-04：AI 迟到结果重占当前编辑器 — P0

AI 面板请求启动时闭包固定 A 的 `chapter.id`，草稿也写入 A；但完成时调用页面级 `onGenerated(draft)`。`handleDraftApplied` 不比较 `draft.chapterId` 与 `activeChapterId`，直接替换 `currentDraft` 和 `editorSnapshot`。用户已在 B 时，A 的结果会进入 B 的当前 UI。证据：

- `AiGeneratePanel.tsx:248-272,338-422`
- `PolishPanel.tsx:49-109`
- `CheckPanel.tsx:125-158,310-405`
- `WritingWorkspacePage.tsx:283-296,625-647`

置信度：代码确认。

### S-05：初始化 effect 的取消标志未覆盖草稿加载 — P1

页面初始化 effect 有 `cancelled` 标志，但它只阻止 `Promise.allSettled` 的页面数据回调；其调用的 `loadChapterDraft` 自身没有取消/页面存活检查。证据：`WritingWorkspacePage.tsx:195-230`。项目切换或卸载后的 DB 结果仍可完成，React 可能忽略 setState，但任务/草稿仍可持久化。置信度：代码确认。

### S-06：章节对象与草稿对象混合上下文 — P1

`writingContext` 在 `editorSnapshot.chapterId !== activeChapterId` 时用 `currentDraft.content`，但仍传入新的 `activeChapter` 和旧的 `currentDraft`。因此上下文可能同时声明 B 的 `chapterId` 与 A 的 `draftId/version/content`。证据：`WritingWorkspacePage.tsx:138-147`、`src/utils/writingContext.ts:59-90`。置信度：代码确认。

## 6. 右侧栏生命周期

### 6.1 收起

`RightPanel` 记住 `lastPanelType`，收起时保留同一个 `PanelComponent` 并在 overlay 上设置 `display:none`：`src/components/right-dock/RightPanel.tsx:103-142`。所以“关闭同一面板再展开”通常保留组件 local state。

### 6.2 切换不同面板

`effectivePanelType` 改变后 `PanelComponent` 类型随之改变，旧面板卸载。因此 AI 生成面板的 `latestGeneratedDraft`、润色面板的 `lastPolishResult`、质量修复比较等 local state 会丢失。页面卸载/软件重启也会丢失这些 UI 结果。候选草稿、质量报告、generation job 若已落库仍存在，但 UI 没有统一恢复所有旧任务结果的机制。

### 6.3 统一侧栏 Store 未接通

`PanelToolState` 已定义 `output/error/loading/relatedContentHash/relatedDraftVersion`，`RightPanel` 也能显示 stale warning：`src/store/rightSidebarStore.ts:13-40,86-125`、`RightPanel.tsx:110-165`。

但全仓调用搜索显示：

- 页面仅创建 `onUpdateToolState` 回调：`WritingWorkspacePage.tsx:652-656`。
- `RightPanel` 仅把回调作为 prop 下传：`RightPanel.tsx:166-191`。
- 没有任何具体面板调用它。

结果是 `toolStates` 始终为空，正文变更后的 stale warning 不会激活。该实现属于“状态模型已建立但链路未接通”。置信度：代码确认。

## 7. 选区状态未接通

编辑器快照已经包含 `selectionStart/selectionEnd`：`EditorArea.tsx:83-99,247-261`。但 `getCurrentWritingContext` 只会从可选的 `textareaElement` 读取选区（`src/utils/writingContext.ts:42-75`），页面调用时既不传 DOM，也不把快照 offset 传进去（`WritingWorkspacePage.tsx:140-147`）。所以统一 `writingContext.selectedText` 恒为空、cursor 恒为 0。

这意味着“重写选区”当前没有可靠的统一选区上下文；实现外观存在，实际数据流未连通。置信度：代码确认。

## 8. 状态边界总结

```text
SQLite chapter_drafts（候选/正式版本）
        │ load / save / adopt
        ▼
WritingWorkspacePage.currentDraft（页面草稿镜像）
        │ props / onGenerated
        ▼
EditorArea.content（当前编辑会话、唯一未保存正文）
        │ onEditorContentChange
        ▼
editorSnapshot / writingContext（派生上下文，不是持久快照）
```

目前最危险的混合是：`activeChapterId` 已变化，而 `currentDraft`、编辑器内容或迟到 AI 回调仍属于旧章节。当前没有统一的不变量阻止这种组合。

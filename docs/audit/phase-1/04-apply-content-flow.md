# 正文应用、保存与采用链路审计

## 1. 结论摘要

- 当前“应用 AI 输出”不是一个持久化领域操作，而是页面创建一次 `applyTextRequest`，EditorArea 把文本追加或替换到内存 textarea，并标记 dirty。
- apply payload 只有 `id/mode/text/source`，没有 project、target chapter、target draft、base revision、content hash、selection 或 task/result id。
- AI 结果完成后还存在另一条隐式正文变更路径：`onGenerated(draft)` 直接把候选草稿载入当前编辑器。它同样没有活动章节校验。
- “保存草稿”和“采用正式正文”是后续独立动作；应用 AI 结果本身不写数据库、无应用记录、无应用级撤销/回滚。
- Rust 采用正式正文的两次 UPDATE 未放在事务中，且不检查目标草稿是否属于章节，属于 P0。
- 当前有多个可改变编辑器/正文版本的入口，但没有一个统一的安全门。

## 2. 所有正文变更入口

### 2.1 编辑器内存变更入口

| 入口 | 触发方 | 实际操作 | 目标确定方式 | 证据 | 置信度 |
|---|---|---|---|---|---|
| 用户键入 | `EditorArea` textarea | `setContent(value)`，dirty | 当前挂载的 `chapter` props | `EditorArea.tsx:240-245` | 代码确认 |
| 加载/切换草稿 | `currentDraft` effect | 用 `currentDraft.content` 替换全文，dirty=false | 不校验 draft.chapterId | `EditorArea.tsx:101-117` | 代码确认 |
| 通用 AI 追加/替换 | AI/润色/质量面板 → page → Editor | append 或 replace_all，dirty=true | **点击时当前编辑器** | `WritingWorkspacePage.tsx:298-319`; `EditorArea.tsx:263-279` | 代码确认 |
| 生成完成自动载入 | `onGenerated` | page 替换 `currentDraft/editorSnapshot`，Editor effect 替换全文 | **回调完成时当前页面** | `WritingWorkspacePage.tsx:283-296,631` | 代码确认 |
| 草稿历史“恢复” | `DraftHistoryPanel` | `onLoadDraft` → `handleDraftApplied` | 面板的 `chapterId`，page 不复核 | `DraftHistoryPanel.tsx:132-133`; page `612-620` | 代码确认 |
| 一键排版 | Editor command | 空行压缩 + trim，dirty | 当前编辑器 | `EditorArea.tsx:321-325` | 代码确认 |
| 质量修复更优结果 | `CheckPanel` | `onGenerated(newDraft)`；无回调时通用 replace | 请求闭包的 chapter 保存，UI 目标未复核 | `CheckPanel.tsx:376-415` | 代码确认 |
| 章节工程完成 | `ChapterEngineeringPanel` | `onGenerated(result.draft)` | job 固定 chapter，UI 未复核 | `ChapterEngineeringPanel.tsx:553-568` | 代码确认 |

### 2.2 持久化正文/版本入口

| 入口 | 前端服务 | Tauri command / SQL | 结果 |
|---|---|---|---|
| 保存新草稿 | `draftVersionService.create` | `create_chapter_draft` / INSERT | 新的非采用版本 |
| 更新当前非采用草稿 | `draftVersionService.update` | `update_chapter_draft` / UPDATE by id+chapter | 覆盖该候选版本内容 |
| 采用草稿 | `draftVersionService.adopt` | `adopt_chapter_draft` / 两次 UPDATE | 改 `is_adopted` |
| AI 生成/重生成 | AiGeneratePanel / job | create draft | 新候选版本 |
| 润色 | PolishPanel | create source snapshot（必要时）+ result draft | 新候选版本 |
| 质量修复 | CheckPanel | create fixed draft | 新候选版本 |
| TXT 导入 | `ImportTxtDialog` | create draft | 导入候选版本 |
| 大文本 | `saveLargeTextWithChunks` + draft command | `large_text_documents/chunks` 事务，随后 draft INSERT/UPDATE | 分片全文 + draft 引用 |

证据：`src/services/database/draftVersionService.ts:160-333`、`src-tauri/src/commands.rs:1093-1200`、`src/components/import/ImportTxtDialog.tsx:73`。

### 2.3 未发现的正文变更机制

- 未发现正文专用 Editor Ref API。
- 未发现自定义 Window Event / EventEmitter / Tauri Event 用于应用正文。
- 未发现正文 application Store action 或统一 command bus。
- 未发现 `content_apply_operations`、undo log 或基于 patch 的通用应用表。

实际控制面是 React props/state + Tauri invoke。

## 3. 通用 AI 应用真实时序

```text
用户在某个面板点击“追加到正文”或“替换全文”
→ 面板读取自己的 local result.content
→ 调用 onApplyAiText({ mode, text, source })
→ WritingWorkspacePage.applyAiTextToEditor
   ├─ text.trim()
   ├─ replace_all 时弹确认；dirty 只形成警告，不阻止
   └─ 创建全新 request id，写 setApplyTextRequest
→ EditorArea effect
   ├─ 仅用 request id 防同一次 React effect 重放
   ├─ append: 当前 prev + incoming
   └─ replace_all: incoming
→ setIsDirty(true)，回传 snapshot/hash
→ **不写 SQLite**
→ 用户另行点击“保存草稿”或 Ctrl+S
→ create/update chapter_draft
→ 用户另行点击“确认采用”
→ adopt_chapter_draft
```

证据：

- Apply 创建：`src/pages/WritingWorkspace/WritingWorkspacePage.tsx:298-319`
- Apply 执行：`src/components/workspace/EditorArea.tsx:263-279`
- 保存：`EditorArea.tsx:281-319`
- 采用：`EditorArea.tsx:327-381`

## 4. 目标和冲突检查

### 4.1 Apply payload

现有字段：

```ts
{
  id,
  mode: 'replace_all' | 'append',
  text,
  source: 'ai_generate' | 'quality_check' | 'polish' | 'layout'
}
```

没有：`novelId`、`chapterId`、`draftId`、`draftVersion`、`baseContentHash`、`selectionStart/end`、`taskId`、`resultId`、`idempotencyKey`。

结果依赖“用户点击时正好打开目标章节”。任务书定义下属于高风险；本报告定级 P0。置信度：代码确认。

### 4.2 替换确认

replace_all 只根据**当前** `editorSnapshot.isDirty` 拼接提示文案，然后允许用户继续覆盖。它不比较生成时正文与当前正文，也不检查结果所属章节。append 不弹冲突确认。证据：`WritingWorkspacePage.tsx:303-319`。

### 4.3 选区

应用模式只有 append 和 replace_all，不支持 replace_selection/insert_at_cursor。虽然 EditorArea 上报 selection offsets，但通用 writingContext 未接入，见 `02-state-ownership.md`。结论：当前 AI 结果应用不检查选区，也不能安全绑定生成时选区。

## 5. 生成结果完成时的隐式应用

`AiGeneratePanel`、`PolishPanel`、`CheckPanel` 和 `ChapterEngineeringPanel` 在创建候选草稿后都可调用 `onGenerated`。页面的 `handleDraftApplied` 直接：

```text
setCurrentDraft(draft)
setDraftWordCount(draft.wordCount)
setIsDirty(false)
setEditorSnapshot({ chapterId: draft.chapterId, ... })
```

它没有 `if (draft.chapterId !== activeChapterId) return`，也没有要求用户选择是否载入。因此“候选保存成功”同时触发“当前编辑器切换到候选”，数据库候选状态和 UI 导航状态被混合。证据：`WritingWorkspacePage.tsx:283-296,625-647`。

如果用户已从 A 切到 B，A 的迟到结果可进入 B 编辑器；之后：

- 点击通用替换/追加会直接修改 B 当前文本；
- 点击保存可能组合 A draft id 与 B chapter id；
- 点击采用可能触发 Rust 采用命令的跨章节缺陷。

风险：P0。置信度：代码确认。

## 6. 重复应用保护

| 机制 | 能防什么 | 不能防什么 |
|---|---|---|
| `lastApplyRequestId` | 同一个 request 对象因重渲染被 effect 重复消费 | 用户重复点击，因为每次点击生成新 id |
| AiGenerate append disabled | 当 latestGeneratedDraft.id == currentDraftId 时禁用该面板的 append | replace_all；Polish apply；跨章节迟到；重启后的重复 |
| `isAdopted` UI | 隐藏已采用草稿的采用按钮 | 并发采用、错误章节参数、超时重试 |
| Setting suggestion status | 非 pending 禁止重复采纳 | 正式写入成功但 local 状态保存失败后的重复 |

通用应用没有持久 idempotency key，也没有“result X 已应用到 document Y revision Z”的记录。风险：append 重复内容 P1，replace 重复覆盖/错误覆盖 P0。

## 7. 保存链路

### 7.1 正常保存

如果 `currentDraft && !isAdopted`，EditorArea 更新现有草稿；否则创建新草稿。采用版本不会被原位修改，用户编辑采用正文后保存会形成新候选，这是合理的版本方向。证据：`EditorArea.tsx:281-301`。

### 7.2 0 行 UPDATE 的假成功

Rust `update_chapter_draft` 用 `WHERE id=? AND chapter_id=?`，但不检查 affected rows，并在之后按 id 单独查询草稿（`commands.rs:1145-1165`）。跨章节参数会更新 0 行但可能返回旧草稿。前端即便 `savedDraft` 为空，也会把 UI 标为 clean 并返回 `savedDraft ?? currentDraft`（`EditorArea.tsx:303-317`）。

风险：用户以为已保存，而目标正文未保存，P0。置信度：代码确认。

### 7.3 3 秒 JS 超时与迟到提交

所有 `dbCall` 在 Tauri 模式把 invoke 与 3 秒定时器 race（`src/services/database/db.ts:77-124`）。超时不会取消 Rust command。可能时序：

```text
前端发起 create/adopt
→ 3 秒到，前端显示失败
→ Rust 随后提交成功
→ 用户重试
→ 第二次 create/adopt 再执行
```

非幂等操作可能产生重复草稿、重复业务记录或 UI/DB 状态分叉。风险：P0（部分成功与错误重试）；需要延迟故障注入量化概率，置信度：高度可能。

## 8. 正式采用链路

### 8.1 前端时序

```text
用户点击“确认采用”
→ 若编辑器 dirty：确认后先 handleSave
→ draftVersionService.adopt(draftId, chapter.id)
→ Rust adopt_chapter_draft
→ 前端 adopted ?? 本地构造 isAdopted=true
→ UI 显示“已采用”
```

证据：`EditorArea.tsx:327-381`。`adopted ?? { ...draftForAdoption, isAdopted: true }` 是危险 fallback：后端返回 null 时仍可让 UI 显示正式状态。

### 8.2 Rust 非原子采用 — P0

`adopt_chapter_draft`：

1. 取消该章节全部已采用标记；
2. 将指定 id + chapter 标为采用；
3. 按 id 读取返回。

三步无事务，且步骤 2 不检查行数（`commands.rs:1169-1189`）。失败或错参可留下 0 个采用版本；若 draft id 属于别章，步骤 3 还可能返回别章草稿。`chapters.adopted_draft_id` 未更新，不能作为第二道一致性约束。

### 8.3 DraftHistory 采用

历史面板采用后再次调用 `getAdoptedByChapterId(chapterId)`，是比 EditorArea 更谨慎的回读；但若 Rust 第一步已取消全部且第二步 0 行，回读 null 后仍 fallback 到 `adoptedDraft` 或本地 `{isAdopted:true}`（`DraftHistoryPanel.tsx:61-68`）。仍不能保证 DB 正式正文存在。

## 9. 大文本原子性与完整性

### 9.1 分片内部事务

`finalize_large_text_save` 对 `large_text_documents` 和全部 chunks 使用一个 SQLite transaction（`src-tauri/src/large_text_save.rs:289-358`），分片内部写入具备回滚。

### 9.2 全文 hash 不匹配仍提交 — P0

当合并全文 SHA-256 与 manifest 不同，代码只 `eprintln!` 并继续事务（`large_text_save.rs:277-286`）。这允许已知完整性失败的正文进入持久层。置信度：代码确认。

### 9.3 commit 后缓存清理错误 — P1

事务在 358 行 commit，随后 361 行清缓存用 `?` 返回错误。如果清理失败，调用方收到失败，但数据库实际已提交；重试可创建另一 document。置信度：代码确认。

### 9.4 大文本与草稿引用非原子 — P0/P1

前端先 finalize 大文本，再调用 create/update draft（`draftVersionService.ts:160-220,236-297`）。没有跨 command 事务。draft 写入失败时 document 已存在但无引用；读取大文本失败又静默使用预览，存在把截断预览保存为新正文的 P0 路径。

## 10. 撤销、失败和恢复

| 能力 | 当前状态 | 结论 |
|---|---|---|
| 编辑器原生撤销 | textarea 浏览器行为可能可用 | 未形成应用事务或持久审计记录 |
| 应用前 diff 预览 | 无 | 缺失 |
| 应用操作记录 | 无表/无实体 | 缺失 |
| 应用失败回滚 | apply 只改内存；保存/采用各自处理 | 跨步骤无整体回滚 |
| 软件崩溃恢复未保存 apply | 无 autosave/session journal | 缺失 |
| 候选草稿恢复 | 草稿历史可读取 | 有，但无法标记“已应用到何处” |
| 采用整体回滚 | 无事务/无 adoption history | 缺失 |
| 大文本完整性阻断 | hash mismatch 不阻断 | 失败 |

## 11. 安全条件逐项判定

| 安全条件 | 通用 apply | 保存草稿 | 正式采用 |
|---|---|---|---|
| 固定目标文档 ID | 否 | chapter.id（可能与 draft 错配） | 参数有 chapter/draft |
| 基础正文版本 | 否 | 否 | 否 |
| 当前版本比较 | 否 | 否 | 否 |
| 内容 Hash | 只重算当前 hash，不比较 base | 否 | 否 |
| 重复应用保护 | 仅单次 effect id | 无幂等键 | 无幂等键 |
| 数据库事务 | 不适用（内存） | 单条 SQL 原子；大文本跨命令非原子 | **无，两个 UPDATE** |
| 原子写入 | 否（apply+save 分离） | 小文本单行；大文本否 | 否 |
| 撤销记录 | 否 | 草稿版本可人工恢复 | 无 adoption history |
| 失败回滚 | 否 | 单 SQL；工作流无 | 否 |
| 异常退出恢复 | 否 | 已提交草稿可恢复 | 当前标记可读，失败中间态不可恢复 |
| 未保存冲突检测 | replace 仅提示当前 dirty | 不比较 base | 采用前仅检查本地 dirty |

## 12. 真实正文应用时序（含风险点）

```text
AI result(A, base unknown)
   │
   ├─ onGenerated ────────────────┐
   │                              ▼
   └─ Apply button → payload ─→ WritingWorkspace current state(B?)
                                  │  无 target/revision/hash guard
                                  ▼
                         EditorArea.content（内存 dirty）
                                  │ Save
                                  ▼
                     create/update chapter_drafts（可能错配）
                                  │ Adopt
                                  ▼
                   two non-transactional is_adopted UPDATEs
```

当前最关键的不变量——“任何正文写入必须同时证明目标章节、基础版本和当前版本仍一致”——尚不存在。


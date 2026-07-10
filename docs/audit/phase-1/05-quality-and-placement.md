# 质量检测、AI 修复与自动放置审计

## 1. 结论摘要

- 质量报告是当前项目中绑定正文快照最完整的 AI 链：含 project/chapter/draft/version/content hash/content length/checked time，并在修复前比较当前 hash。
- 仍缺 quality task id、selected range、context snapshot id；报告保存是多条 SQL 的非事务过程，且会把同 `issue_key` 的历史 item 改挂到新 report。
- 新建 pending report 后 AI 失败时，“按 created_at 最新”可能让旧 completed report 被新的空 pending report遮住。
- 质量修复有程序级范围门控和生成后复检，是比普通生成更成熟的链路；但门控是长度/段落比例启发式，不能证明锁定内容、人物知识边界或具体 issue 范围未被修改。
- 通用“自动放置”不存在统一 placement plan。章节工程的自动 patch 是对单一候选草稿做精确字符串首处替换；设定库推演能按有限 target type 写入正式模块。整体成熟度评为 **L2（局部路径有 L3 特征，但无统一 L3 安全协议）**。

## 2. 质量检测真实时序

```text
用户点击质量检测
→ 读取当前编辑器全文/字数
→ 若 dirty 或与 currentDraft 不同：创建 user_edited 快照草稿
→ create quality_check_report(pending, project/chapter/draft/hash/length/time)
→ qualityCheckAiService.runCheck
   → 创建 ai_task_record（独立，未回填 report.ai_task_id）
   → 读取章节上下文并构建 prompt
   → 非流式 AI，解析 JSON
→ save_quality_check_result
   → report 标记 completed
   → 按 issue_key 合并/更新/插入 items
→ 页面缓存 report/items
→ 正文变化时比较 hash，标记 reportOutdated
```

证据：`src/components/right-dock/panels/CheckPanel.tsx:125-219`、`src/services/ai/qualityCheckAiService.ts:13-87`、`src-tauri/src/commands.rs:3518-3542,3669-3849`。置信度：代码确认。

## 3. 报告快照绑定完整度

`QualityCheckReport`：`src/types/qualityCheck.ts:52-61`；items：`63-84`。

| 要求字段 | 当前字段 | 状态 | 说明 |
|---|---|---|---|
| `quality_task_id` | `aiTaskId?` 类型/列存在 | 未接通 | `runCheck` 创建 task，但 report create/save 不接收 task id |
| `project_id` | `novelId` | 有 | 固定 |
| `document_id` | `chapterId` + `draftId` | 有 | 精确到草稿 |
| `document_revision` | `draftVersion` | 有 | save result 时写入 |
| `content_hash` | `contentHash` | 有 | 检测前计算，修复前比较 |
| `content_length` | `contentLength` | 有 | 辅助证据 |
| `selected_range` | 无 | 缺失 | 当前只检测全文 |
| `context_snapshot_id` | 无 | 缺失 | context read log 与报告无直接 FK |
| `checked_at` | `checkedAt` | 有 | 检测快照时间 |

结论：报告对**正文文本**绑定强，对**任务/上下文/选区**绑定不完整。置信度：代码确认。

## 4. 过期检测与定位

### 4.1 已有保护

`CheckPanel` 只展示 `report.chapterId === chapter.id` 的 active report，并比较 report content hash 与当前 editor hash；hash 不同会显示过期警告，并阻止 `handleAIFix`：`CheckPanel.tsx:97-105,240-248,545-555`。

这是已接通的程序级版本保护，比普通 AI apply 更可靠。

### 4.2 仍有缺口

- `loadLatest` 没有 request id/取消。快速切章时旧章节查询可在新章节回写 local/currentDraft，再经 parent sync 影响页面缓存：`CheckPanel.tsx:109-123`。
- 过期时“定位正文”按钮仍可点击；它传旧 offsets/paragraph/quote 给 EditorArea（`CheckPanel.tsx:453-465,767`）。EditorArea 有多级定位 fallback，但不能保证旧位置仍对应同一问题。
- 多个并行检测共享页面单个 `qcReport/qcItems` 和 global AI modal。chapter filter 防止直接显示错章，但迟到 sync 可覆盖另一任务结果。
- `get_quality_check_issues` 只按 `created_at DESC LIMIT 1`，不要求 `status='completed'`（`commands.rs:3545-3559`）。新 pending 报告如果 AI 失败，会成为“最新报告”并遮住旧完整报告。

风险：P1。置信度：代码确认。

## 5. 报告持久化事务边界

`save_quality_check_result` 依次执行：

1. report UPDATE completed；
2. 查询该章节全部历史 items；
3. 对每个新 issue 逐条 UPDATE/INSERT；
4. 查询 report 并返回。

整个过程没有显式 transaction：`src-tauri/src/commands.rs:3669-3849`。若第 N 个 item 失败，report 已是 completed，前 N 个 items 已写入，后续未写入。风险：P1（质量证据不一致）。

更重要的是，同 `issue_key` 历史命中时，代码更新原 item 的 `report_id` 指向新 report（`commands.rs:3751-3782`）。这会从旧 report 移走问题记录，使历史报告不能稳定重放当时的问题集合。当前模型更像“章节问题状态”而不是不可变“报告快照”，但类型和 UI 又按 report 展示。结论：代码确认。

`batch_update_quality_issue_status` 也逐条 UPDATE、无 transaction（`commands.rs:3635-3667`）。

## 6. AI 修复与复检

### 6.1 绑定信息

`quality_fix_runs` 保存：source draft id/version/hash、target draft id/version/hash、before/after report、分数、问题数、changed ranges、上下文 ID/warning 和状态。表结构：`src-tauri/src/db.rs:597-631`；对象创建：`qualityFixService.ts:354-378`。

这是当前最接近“任务 → 基础版本 → 候选版本 → 复检”的追溯链。

### 6.2 程序门控

`validateFixScope` 会：

- 拒绝空修订版；
- 拒绝长度小于原文 80%；
- 当改动段落比例 >40% 且改动 >3 段时拒绝；
- 对 >30% 墓长和 changed_range 未绑定 issue_key 发 warning。

证据：`src/services/ai/qualityFixService.ts:275-335`。

但它没有验证：

- `changed_ranges.before` 是否真的存在于 source；
- 所有实际 diff 是否落在 pending issue 的 quote/offset 范围；
- 锁定段落是否未变；
- 人物状态/知识边界/世界规则是否仍满足；
- source draft 在 AI 返回时仍是当前目标版本。

实现中的 `unrelatedChangedCount` 对每个变化段落都无条件自增；`if` 块为空（`qualityFixService.ts:309-321`），所以该字段不能代表“无关修改”判断。置信度：代码确认。

### 6.3 生成后复检

修复通过 scope gate 后先创建候选草稿，再对候选全文重新质量检测、比较分数/问题数。只有 `comparison.isBetter` 才把新草稿载入编辑器并保存新报告（`CheckPanel.tsx:310-419`）。这是明确的生成后审查。

缺口：

- `fixRun.status='adopted'` 只表示“修复候选通过并载入当前工作台”，并没有调用 `draftVersionService.adopt`；正式正文仍是旧 adopted draft。状态命名会误导追踪。
- 新草稿 source 使用 `'ai_fix' as any`，但 `DraftSource` union 不包含 `ai_fix`（`CheckPanel.tsx:311-316`; `src/types/ai.ts:137-143`）。类型/数据设计未同步。
- 固定 issue 状态逐条更新并吞掉错误（`CheckPanel.tsx:395-399`），可能只解决部分状态。
- 多步骤没有整体 transaction；失败会保留 fix run、candidate draft 或 report 的部分集合。

## 7. 自动放置成熟度判定

任务书定义：L0 文字；L1 目标名+直写；L2 结构化目标/操作；L3 程序验证后写；L4 版本/diff/事务/整体撤销。

### 7.1 通用正文/项目自动放置

未发现统一 `PlacementPlan`、operation union、target ID 列表、base revision、confidence、conflict 或 lock 结构。AI 普通正文结果仍由用户手动选择追加/替换，属于 L0/L1。

### 7.2 章节工程 low-risk patch

`generationJobService` 从质量 items 构造：

```ts
{ issueId, severity, riskLevel, quote, replacementText, rationale }
```

只对 severity low 且 quote ≤120 的候选判为 low；应用时检查当前候选正文包含 quote，然后执行一次 `String.replace`，保存为新的非正式草稿：`generationJobService.ts:312-355,783-825`。

优点：

- 有结构化操作数据；
- 只写单一 job 的固定 chapter candidate；
- 不覆盖原草稿，而是创建新版本；
- quote 不存在则 skip。

缺口：

- 没有字符 range/base hash/version compare；相同 quote 多次出现时只替换首处；
- “low risk”只由严重度与 quote 长度决定；
- replacementText 来自 AI suggestion，不是可验证 diff；
- 没有锁定内容保护、diff 预览或整体撤销；
- 多 patch 只在内存依次替换，最后一次创建新草稿；创建失败没有 application record；
- 不触碰正式 adopted 正文，因此它是“候选草稿修补”，不是正式自动放置。

局部等级：L3-（有结构化 patch 和有限程序 gate，但没有版本协议）。

### 7.3 设定库推演采用

`settingSuggestionService` 要求 AI 返回 JSON items，候选记录含 `suggestionType`；用户采纳后程序按 type 调用 character/rule/world repository，保存 target ID/type，并禁止已处理记录重复采纳：`settingSuggestionService.ts:113-168,180-230,237-322`；类型见 `src/types/settingSuggestion.ts:4-52`。

优点：结构化目标类型、程序 switch、候选与正式数据分离、单条重复状态保护。

缺口：

- target ID 是创建后才产生，不是计划阶段固定对象；operation 只有 create，没有 update/merge/insert；
- 候选保存在 localStorage，正式数据在 SQLite；正式写入成功后 local record 更新失败会留下可重复采纳状态；
- 无 confidence、base version、冲突检测、锁定内容、diff、事务或撤销；
- 多个候选逐条采纳，不支持一个结果跨多个目标的同事务提交。

局部等级：L2/L3-。

### 7.4 整体等级

**整体评为 L2。** 理由：存在两个局部结构化写入实现，但没有统一 placement plan 和跨领域安全验证，不能把局部字符串 patch 或 type switch 推断为全产品 L3。

## 8. Placement 能力逐项检查

| 能力 | 通用正文 | 章节 patch | 设定库采纳 |
|---|---|---|---|
| placement plan | 无 | transient patch list | 单 candidate payload，不是 plan |
| 目标类型 | 无 | 隐含 chapter draft | character/world/rule |
| 目标 ID | 无 | job chapterId / savedDraft | 写入后生成 |
| 操作类型 | append/replace_all | replace quote | create |
| 基础版本 | 无 | 无 | 无 |
| 置信度 | 无 | 无 | 无 |
| 冲突检测 | 无 | quote exists | 无 |
| 锁定内容保护 | 无 | 无 | 无 |
| 拆分多目标 | 无 | 同草稿多个 patch | 不支持单记录拆分 |
| 同事务多目标 | 无 | 不适用/单草稿 | 无 |
| 部分失败整体回滚 | 无 | 内存 patch 后单次 draft create；无应用记录 | 无 |
| 恢复前状态 | 未保存时依赖 textarea undo | 原草稿版本仍在 | 无正式 undo |
| diff 预览 | 无 | 无 UI diff | 仅编辑 JSON/字段 |

## 9. 质量/放置主要风险

| 风险 | 等级 | 结论 |
|---|---|---|
| 旧报告 item 被改挂到新 report，历史快照不稳定 | P1 | 代码确认 |
| save result 非事务，completed report 可只有部分 items | P1 | 代码确认 |
| 新 pending report 遮住旧 completed report | P1 | 代码确认 |
| 质量检查迟到回调更新新章节 UI | P0 | 代码确认，详见状态审计 |
| 旧报告定位仍可作用于新正文 | P1 | 代码确认 |
| fix status `adopted` 与正式 adopted 正文含义冲突 | P1 | 代码确认 |
| auto patch 无版本/锁保护，首处字符串替换 | P1 | 代码确认；只写候选，降低为非 P0 |
| 设定采纳跨 localStorage/SQLite 非原子，可重复创建 | P1 | 高度可能 |
| 不存在通用安全自动放置 | P1（能力缺口） | 代码确认 |


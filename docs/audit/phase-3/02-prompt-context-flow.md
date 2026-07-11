# 02 — Prompt 与上下文流审计

## 1. 当前构建路径

### 1.1 旧式章节正文链路

~~~text
AiGeneratePanel
→ buildFreshChapterGenerationContext / contextBuilder
→ contextReaderService
→ promptOrchestrator.buildGenerateRequest
→ prompts/chapter_generate.md?raw（失败回退内置模板）
→ createAiClient.generate
~~~

contextBuilder 读取作品、世界/规则、主角、角色、事件、总/卷/章大纲、章节目标、上下文、风格/输出和可选当前正文。多个次要来源读取失败被 catch 后降级，Task 历史没有记录缺失清单或版本/hash。

### 1.2 章节工程链路

~~~text
ChapterEngineeringPanel
→ generationContextCompiler.compileAndSave
→ chapter_generation_snapshots
→ generationJobService.buildSnapshotGenerateRequest
→ Provider
~~~

每个 section 最多 8000 字符，compiled_context_json、compiled_prompt_text 和 sources_json 完整内联 SQLite。它有 contextHash，但没有 schemaVersion、独立 input/context/constraint snapshot、source version/hash 或目标草稿基线。input.userInstruction 传给旧 contextBuilder，却没有进入 sections/prompt/contextHash；因此用户指令可能未参与工程请求的冻结 hash。

## 2. 上下文来源矩阵

“无入口”表示当前仓库不存在该生产任务，不能把 append/replace_all UI 模式误报为已实现。

| 任务 | System/Prompt 位置 | 用户/正文 | 项目上下文 | 预算/截断 | 来源 hash/可重现 | 主要问题 |
|---|---|---|---|---|---|---|
| 章节正文生成 | promptOrchestrator + prompts/chapter_generate.md | 用户要求；新生成通常无正文 | 作品、世界/规则、主角、本章角色/事件、三层大纲、目标、章节/卷/手动上下文、风格/输出 | 无总 token 预算；部分设定摘要，本体可很长 | 旧 task 只存 500 字符 prompt 摘要；不可重现 | 上下文失败静默降级；相邻“下一章”summary 可污染当前章 |
| 续写 | **无独立生产入口** | UI 只有把完整候选 append 到编辑器 | — | — | — | 未来必须用 insertion range lock，不得把整章生成等同续写 |
| 重生成 | 与章节正文生成相同 | 可传 draftContent，promptBuilder 最多 8000 | 同章节生成 | 正文截断 8000 | 无基线 snapshot | 长章尾部丢失但模型被要求输出完整章 |
| 选区润色 | **无生产入口** | — | — | — | — | v2.4 才能用 TextRangeLock 实现 |
| 全文润色 | promptBuilder.buildPolishPrompt | 当前编辑器或源草稿；正文最多 8000 | 章标题/大纲、mode、自定义要求 | 8000 字符硬截断 | task 仅摘要，无正文 hash snapshot | 长章可能被截断后返回“全文”，存在内容丢失风险 |
| 局部改写 | **无通用选区入口**；按大纲修正是整章 | chapterRevisionService 传原草稿最多 18000 | 缺失大纲点、章节上下文 | 18000 字符 | 有 UI base metadata，但 Task 无 snapshot | 名称像局部，实际结果仍是完整章节 |
| 扩写 | **无生产入口** | — | — | — | — | 不能用未来 AI target range 直接写入 |
| 缩写 | **无生产入口** | — | — | — | — | 同上 |
| 章节大纲 | promptBuilder.buildChapterOutlineGeneratePrompt | 章标题/目标/数量 | 当前采用总纲/卷纲、世界/主角、已有章、风格 | outlineContext：世界1600、规则2400、已有章3000 | 记录使用大纲 ID 摘要，但无版本/hash | 三个 UI 表面行为不同；OutlineEditor 保存截断 contextSnapshot |
| 小说大纲 | buildOutlineGeneratePrompt | 无或固定生成指令 | 作品、世界/规则、主角、现有卷章 | 同上 | 无完整 replay | 右栏入口只复制，另两个入口可保存 |
| 人物生成 | buildCharacterGeneratePrompt | 生成数量/章信息 | 章大纲、已有名字、novel.worldBackground 前500 | 500 字世界背景 | 无 source manifest/hash | 上下文过薄；候选与生成时章节不绑定 |
| 世界设定（章节补充） | buildSettingExpandPrompt | 章标题/大纲 | 活跃世界设定1200、规则2000 | 固定字符截断 | 无 | 只生成 world setting 候选，无 constraint snapshot |
| 质量检查 | buildQualityCheckPrompt + contextReader | 全文在 promptBuilder 最多8000 | 章大纲/目标、章节/卷/手动上下文 | 正文8000；上下文分区各自截断 | report 有 draftVersion/hash；请求历史不可重现 | 对长章只检查前段却形成整章报告 |
| 设定建议 | settingSuggestionService.buildPrompt | 类型、数量、世界类型、用户要求 | 可选世界2400、规则1800、角色1200 | 固定字符截断 | localStorage 保存完整 prompt/raw，但无可靠 task link/hash | 完整 Prompt/原始输出长期放 localStorage；采纳非事务 |
| 章节工程分析/生成 | generationContextCompiler | 当前编辑器正文 section；userInstruction 未进入最终 sections | 旧章节上下文 + active engineering state + 风格/输出 | 每 section 8000，无全局 token 预算 | contextHash 有；缺 schema/source version/base draft hash | 完整 prompt 内联；snapshot 未直接 FK 到 job；指令漏 hash |
| 事件建议 | buildEventSuggestPrompt | 章标题/大纲 | 卷目标、角色、上下文 | 依 builder 拼接 | 无 | 解析后 involvedCharacterIds 被硬设为输入角色前两名 |
| 风格分析 | prompts/style_analyze.md 或 fallback | 用户文本/最新草稿，服务最多20000 | 无作品上下文 | 20000 | Task 无 novelId、无文本 hash | 页面和右栏重复状态；模板 fetch 失败会改变请求 |
| 章节总结 | buildChapterSummarizePrompt | 调用处已截3000或5000；builder 最高10000 | 章标题/大纲 | 实际由调用处更早截断 | summary 保存可带 draftVersion/hash；Task 类型混用 | 同功能两个入口取样长度不同，无法证明总结覆盖全文 |
| 卷总结 | volumeSummaryService 内联 System Prompt | 章节上下文聚合 | 卷标题和各章 summary | 聚合最多8000 | 无 source versions/hashes | 与章节总结都记 context_summarize，历史不区分 |
| AI 修稿 | qualityFixService.buildFixPrompt | 当前全文最多10000、pending/ignored issues | 章大纲、章节/卷上下文、可选风格 | 10000 | fixRun 的 source hash 仅弱实现/Task 无 snapshot | 长章截断后要求返回完整章；范围校验逻辑不足 |

## 3. contextReaderService 证据

- 章节任务读取“当前章 + 前一章 + 后一章”summary。对正在生成当前章而言，后一章 summary 可能是未来信息，必须改为由任务策略显式决定，默认只读前序已采用事实。
- usedContextIds 记录 volume/manual context，但没有把纳入 Prompt 的 chapterSummary IDs 全部加入 usedIds；来源日志不完整。
- source 记录没有 version/hash；context_read_logs 只能说明“可能用了哪些 ID”，不能回放原内容。
- 同一函数两次查询 contextRecordService.getByNovelId；这是性能问题，不是本阶段修改范围。
- volume context 每项截 800，manual 总结 1200，manual 最多10条；chapter summary 内容未建立整体预算。
- 持久日志写失败被吞掉，不影响请求，但历史会无提示缺口。

## 4. 长度与完整性问题

当前截断单位是 JavaScript UTF-16 字符索引，不是 token；各 Service 独立设 500、800、1200、1600、1800、2000、2400、3000、5000、8000、10000、18000、20000 等阈值。没有跨分区总预算、优先级解释、被截来源清单或摘要 hash。

尤其危险的模式是：Prompt 只含正文前 N 字符，却要求模型返回“完整章节正文”。全文润色、质量修复和长章重生成都可能丢失尾部。目标架构必须让 Context Builder 先判断完整性；若任务语义需要全文而预算不足，应摘要辅助但保留完整源引用，并拒绝把不完整返回当整章替换。

## 5. Prompt 模板与日志

- 章节生成模板独立在 prompts/chapter_generate.md，符合模块边界；风格分析以 fetch 加内联 fallback，卷总结和质量修复仍有大型内联 Prompt。
- promptOrchestrator 与 RealAiClient 的开发日志主要记录长度、marker 和角色名，不打印完整 Prompt。
- contextBuilder 开发日志会输出 outlineKeyPoints 的文本数组，可能泄露内容片段；目标日志只保留数量/hash。
- Rust ai_chat_completion 记录 message 数量、最后用户消息长度和 marker，不记录 API Key/完整正文；HTTP 错误会截取服务响应前240字符，仍需按敏感响应处理。
- ai_task_records.prompt_snapshot 名称具有误导性：实际被截到500字符，不能作为 Snapshot 或 replay 来源。

## 6. 冻结后的 Context Builder 规则（v2.4.0）

1. 创建 AiInputSnapshot 后按 taskType/scope 选择来源；默认只读已确认且未过期数据。
2. 每个来源记录 ID、类型、版本、hash、是否采用、include/skip reason。
3. 先计算任务总预算，再分配 system/input/constraints/context 分区；裁剪必须可审计。
4. 正文/Prompt/上下文长文本复用 large_text_documents，数据库行只存引用和 hash。
5. 编译结果写 AiContextSnapshot；项目变化不修改旧快照。
6. 模板 ID/version/hash 和 Provider 非密钥参数写 AiConstraintSnapshot。
7. Task 历史可展示来源清单和摘要，但不默认输出完整 Prompt；“重新执行”创建新 Task。

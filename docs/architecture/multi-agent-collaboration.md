# v3.0.0 Multi-Agent 自主创作架构

## 1. 能力边界

v3.0.0 包含两个协作层：

1. 全书创作规划：从小说 Brief 生成故事圣经、人物弧、世界、冲突、节奏、分卷和 12～500 章计划。
2. 逐章创作闭环：既可生成下一章候选，也可由用户启动按章串行的全书候选队列；每章执行六专家评审和主编修订，在用户采用后推进正式计划并形成章节收束候选。

系统不会自动应用计划、采用正文、确认章节分析或采纳世界候选。全书候选队列支持显式启动、暂停和继续，但只在当前应用进程内运行；跨进程自动续跑、向量语义 Memory 和模型自主 Tool Calling 不属于本版本。

## 2. 全书规划流程

```text
小说 Brief
→ Plot Planner：故事圣经 / 故事弧 / 分卷
→ Character Evolution：角色约束 / 成长节点
→ Promise.allSettled(
     World Builder,
     Conflict Generator,
     Pacing Controller
  )
→ Chapter Batch Planner：按卷、每子批最多 5 章展开章节
→ 完整计划校验
→ 用户确认应用
```

Plot Planner 和 Character Evolution 提供后续 Agent 的稳定基础。世界、冲突和节奏维度没有互相写依赖，因此并行执行；单项失败时先保存其他成功结果，计划进入可恢复失败状态。章节按卷串行生成，每卷继续拆成最多 5 章的子批次，以控制 Prompt / 响应大小并形成明确检查点。

每个子批次使用独立的卷 / 章节范围请求身份，输出预算随 1～5 章动态落在 2,100～4,500 tokens。成功响应先校验章节编号、归属和引用，再立即追加到 `plan.chapters` 并通过 revision CAS 保存；只有整卷所有子批次完整保存后，卷 ID 才进入 `completedVolumeIds`。同卷后续子批会携带前三章标题、目标和结尾钩子作为衔接锚点。

结构化响应解析会枚举所有 Markdown fence 与平衡 JSON 对象，扫描过程识别字符串和反斜杠转义，并优先选择含目标根字段的最完整对象。只移除字符串外、紧邻 `]` / `}` 的尾逗号；缺引号、缺闭括号、错误字段类型、章节缺号或引用漂移仍失败关闭。`finish_reason=length` 的非空部分响应同样不会进入解析或保存。

### 2.1 计划形状

`derivePlanShape` 根据目标章节数确定故事弧和分卷数量。所有章节必须：

- 从 1 连续到 `targetChapterCount`，不得重复或缺号。
- 归属于存在的故事弧和分卷。
- 引用存在的角色、人物节点、世界元素和冲突线程。
- 具有确定的目标字数、节奏模式、张力和结尾钩子。

300 章计划的确定形状为 5 个故事弧和 10 卷。

### 2.2 状态与恢复

计划状态：

```text
running → ready → applied
   └────→ failed / cancelled → 显式继续 → running
```

阶段检查点为 `foundation / creative_dimensions / chapter_batches / ready / applied`。相同 `operationId` 只有在 `requestHash` 完全一致时才能重放；已完成 Agent 不重复调用，失败或取消计划只能由用户显式继续。

`chapter_batches` 的部分计划只接受“完整 Provider 子批次组成的单一连续前缀”。恢复时从已保存章节推导下一个范围，成功子批次不重复调用；缺号、重复、越界、非连续范围，或“卷标记完成但子批不完整”都会失败关闭，不在歧义数据周围补写。

## 3. 计划应用

`ready` 计划只能在用户确认后应用。桌面端 `apply_autonomous_story_plan` 使用一个 SQLite `IMMEDIATE` 事务创建：

- volumes
- chapters
- characters
- world_settings
- chapter_events
- chapter_characters

已有作品结构会触发目标冲突，不覆盖人工内容。成功后计划章节从 `planned` 变为 `materialized`。相同应用重放会复验卷、章、角色、世界设定、章节事件和章节角色关系；任何物化目标缺失或漂移都返回重放错误。

浏览器开发模式使用独立 LocalStorage 回退，不伪装成跨存储 ACID。

## 4. 逐章执行

`AutonomousChapterWorkflowService` 提供两种选择策略：

- `generateNextCandidate()`：选择第一章未采用章节，供受审核的单章推进使用。
- `generateAllCandidates()`：选择第一章尚无可用候选的章节，跳过 `candidate_ready / adopted`，供用户显式启动的全书候选队列使用。

单章执行链路为：

```text
章节工程参数与计划事实
→ generationJobService 生成草稿
→ 六专家 Multi-Agent 评审
→ accept：保留最终评审稿
→ revise / regenerate：最多三轮主编候选
→ candidate_ready
```

候选保持未采用。重复执行相同 run 会复用 `operationId`、生成任务、源草稿和已完成评审，不重复生成正文。取消或失败状态可诊断，单个专家失败遵守 quorum 规则。

正文通过 `generationJobService` 安全保存后，`onDraftSaved` 会立即把 `sourceDraftId` 与 `generationJobId` 写入 `autonomous_story_plans.plan_json.chapterRuns`，然后才继续质量检查与专家评审。因此正文已落盘而后序失败时，继续执行会直接从评审阶段恢复，不再次产生正文调用。

### 4.1 全书候选队列

全书队列按章节串行运行，并对同一计划做进程内防重入：

```text
第一章缺失候选
→ 生成并立即保存源草稿
→ 质检 / 六专家评审 / 主编候选
→ candidate_ready 检查点
→ 下一章缺失候选
```

- 用户可在规划页点击“生成 / 继续全书候选草稿”，也可点击“暂停全书生成”。暂停信号传入当前正文生成和评审。
- 继续时以 `chapterRuns` 为检查点，只处理未完成章节；已有候选和已采用章节不会重复生成。
- 前一章候选正文可作为下一章的临时连续性上下文，并在 run 中记录 `predecessorDraftId / predecessorContentHash`。这类上下文不写入正式章节事实，也不冒充已采用正文。
- 队列只生产未采用候选，不自动采用、不自动确认章节分析，也不在应用重启后自行续跑。

### 4.2 候选进入写作工作台

全书候选不是一个合并的“整本正文”字段。每章正文继续写入 `chapter_drafts`，`chapterRuns.candidateDraftId` 只保存指向候选版本的引用。规划页使用：

```text
/novels/:novelId/workspace?chapterId=CHAPTER_ID&draftId=DRAFT_ID
```

工作台通过 `get_draft_by_chapter_and_id` 精确读取指定草稿，并再次验证作品 / 章节 / 草稿归属；不会用该章“最新版本”猜测自主计划指向的候选。工作台每 3 秒刷新卷章状态，当前章节尚无正文且编辑器没有未保存修改时，可在后台生成完成后加载新草稿；dirty 正文始终保持原状。

用户通过左侧卷章树逐章浏览全书，在中间编辑区修改候选，并使用既有草稿历史、润色、质量检查和采用功能完成二次操作。只有采用稿才成为正式正文并进入后续上下文。

### 4.3 长正文存储与 AI 二次处理

- 单章正文不与 `plan_json` 混存。超过 100 KiB（100 × 1024 UTF-8 字节）时，草稿通过 `large_text_ref_id` 指向 `large_text_documents / large_text_chunks`；完整正文与分片哈希、长度和顺序校验成功后才进入编辑器。
- 百万字全书由卷章树中的数百个 `chapter_drafts` 组成，不发起百万字单次 Provider 输出，也不使用单个百万字 textarea。
- 润色和质量检查把单章正文切成最多 7,000 字符的连续分段，优先在段落、换行或句末断开，并携带前后 400 字衔接参考。
- 润色结果逐段校验、按原顺序合并并保存为新草稿；质量分数按段长加权，问题 offset 和段落索引映射回全文。缺段、空段、异常短结果或来源覆盖不完整时失败关闭。
- 质量修稿按全文 offset、引用或段落索引定位问题，只调用相交分段，未命中的正文逐字符保留；章节总结对全部连续分段执行 map，并通过有界分层 reduce 形成待确认的全章上下文。
- 工作台章节改写会把完整当前草稿交给请求构建器；卷总结会接收本卷全部已确认章节上下文，不再通过固定 8,000 字符前缀替代完整来源。

## 5. 六专家共识

| expert      | 评审维度                       |
| ----------- | ------------------------------ |
| `outline`   | 情节结构、大纲落实、冲突与结尾 |
| `character` | 人物动机、行为、对话与成长     |
| `setting`   | 世界规则、场景与设定一致性     |
| `logic`     | 因果、时间线、信息边界与连续性 |
| `polish`    | 语言、节奏、视角与文风         |
| `quality`   | 可读性、完成度与整体体验       |

默认配置：

- `maxRounds = 3`
- `acceptanceThreshold = 0.7`
- `minimumAverageScore = 75`
- `minimumSuccessfulExperts = ceil(selectedExperts × 0.67)`

达到 quorum、接受率和平均分阈值时 `accept`；达到 quorum 且平均分至少 60 时 `revise`；其他情况 `regenerate`。Rust 在持久化 Round 前根据 Opinion 独立复算全部指标和动作。

## 6. 采用与章节收束

草稿采用继续由既有原子采用协议负责。采用成功后：

1. `markAdopted` 更新计划章节与采用进度。
2. `analyzeAdoptedChapter` 从权威采用稿生成章节总结、人物变化和世界扩展候选。
3. 分析以 `pending_confirmation` 保存，不写正式上下文。
4. 用户确认后，章节总结、上下文记录和角色状态通过原子 bundle 保存。
5. 地点与规则仍是 `setting_suggestions` 中的待确认候选。

如果同一章改采另一草稿，正文采用协议先过期旧章节总结与上下文；自主计划同时清除旧分析和已确认人物节点。页面恢复会检查已有 run 和下一未采用章的权威采用稿，修复遗漏的进度并补启动分析。

## 7. 持久事实

### 7.1 Multi-Agent 事实（migration 021～023）

- `multi_agent_sessions`：冻结 operation、章节/草稿身份、专家和阈值。
- `multi_agent_rounds`：保存输入/输出草稿、共识、token 和耗时。
- `multi_agent_opinions`：保存每轮每位专家的成功意见或失败事实。

### 7.2 自主计划（migration 024）

`autonomous_story_plans` 保存：

- `plan_id / operation_id / novel_id / request_hash`
- `schema_version / status / stage / revision`
- 目标章节数和已生成章节数
- canonical `plan_json / plan_hash`
- 错误和时间戳

`plan_json.chapterRuns` 还保存每章的 generation job、源草稿、候选草稿、评审 session、前序候选身份、采用稿和章节分析状态，是全书候选队列暂停 / 继续的持久检查点；章节正文仍以 `chapter_drafts` 为权威，不复制进计划 JSON。

Rust 在每次保存前校验请求身份、计划结构、状态边、revision 和 hash。桌面 IPC 失败不会降级写 LocalStorage。

## 8. Provider 与 Prompt

API 模式复用当前 OpenAI-compatible / DeepSeek Provider；Mock 模式返回确定性结构化数据。每次创作 Agent、专家和主编修订均创建独立 AI Task 事实。Chapter Batch Planner 通过最多 5 章的子批次和动态输出预算降低长响应被上游提前中断的概率；Rust 将客户端 timeout、`finish_reason=length` 与“上游服务在响应完成前中断连接”分别分类，便于恢复到最后一个成功检查点。

Prompt 位于：

```text
prompts/autonomous_*.md
prompts/multi_agent_*.md
```

TypeScript 负责装配受限上下文和解析结构化返回，不把 Prompt 大段写入 UI。

## 9. 完整备份

项目备份 schema 5 包含 Multi-Agent 三类事实和 `autonomous_story_plans`。恢复为新作品时重映射计划、operation、卷、章、角色、世界元素、冲突、人物节点、run 和草稿引用，并重新计算 `requestHash` 与 `planHash`。schema 2/3/4 继续兼容。

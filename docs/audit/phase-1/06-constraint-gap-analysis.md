# 减少用户输入与 AI 约束能力差距

## 1. 目标结论

项目已经能自动汇集相当多的小说工程上下文：项目、章节、总纲/分卷/章节大纲、世界设定、规则、主角、本章角色/事件、章节总结、风格与输出方案。章节工程还提供场景计划、已知/未知信息、禁止改动等结构。

但距离“用户只表达简短意图，系统自动补齐参数并以硬约束安全写入”仍有四个断层：

1. 当前编辑正文/选区/场景与持久上下文没有统一的、版本化的任务快照。
2. `character_states` 等已有数据未进入主要章节生成 context builder；人物知识边界没有统一计算模型。
3. 多数约束只进入 prompt，输出后没有逐条程序验证。
4. 应用正文没有 target/revision/hash/lock 安全协议，约束正确也无法保证写到正确版本。

## 2. 系统自动掌握的上下文

主要章节生成从 `buildFreshChapterGenerationContext` 开始，重新读取章节，再由 `buildChapterContext` 聚合数据：`src/services/prompt/contextBuilder.ts:85-132,395-440`。

| 上下文         | 数据源                                                       | 自动用于旧章节生成 | 用于章节工程 job                      | 可靠性/缺口                                                     | 置信度   |
| -------------- | ------------------------------------------------------------ | ------------------ | ------------------------------------- | --------------------------------------------------------------- | -------- |
| 当前项目       | route `novelId` / `novels`                                   | 是                 | 是                                    | 异步回调缺 project generation guard                             | 代码确认 |
| 当前章节       | `activeChapterId` + fresh repository read                    | 是                 | 是                                    | UI active 与 task target 可分叉                                 | 代码确认 |
| 当前章节目标   | `chapters.goal`                                              | 是                 | 是                                    | 未保存 goal draft 可被 cached outline 路径影响；无任务版本号    | 代码确认 |
| 总纲           | active master outline → novel.outline → description fallback | 是                 | 是                                    | 有来源标记；没有 base revision                                  | 代码确认 |
| 分卷大纲       | active volume outline → volume fields                        | 是                 | 是                                    | 有来源标记                                                      | 代码确认 |
| 章节大纲       | cached draft / chapter field / active outline 选择           | 是                 | 是                                    | 多事实源通过时间比较解决，仍无版本实体绑定                      | 代码确认 |
| 前文/上下文    | chapter summaries + volume context records                   | 是                 | 是                                    | 依赖摘要是否及时过期；读取失败被吞掉                            | 代码确认 |
| 世界设定       | active world settings                                        | 是                 | 是                                    | 只取 active/最近若干；无冲突规则 engine                         | 代码确认 |
| 世界规则       | active rule systems                                          | 是                 | 是                                    | prompt 约束为主                                                 | 代码确认 |
| 主角           | protagonist/novel protagonists                               | 是                 | 是                                    | 含能力限制/禁止行为                                             | 代码确认 |
| 本章出场角色   | `chapter_characters` + characters                            | 是                 | 是                                    | 老数据无 mustAppear 时全设为必须出场                            | 代码确认 |
| 人物当前状态   | `characters.currentState`                                    | 部分               | 部分                                  | `character_states` 历史/knowledgeState 未被 contextBuilder 加载 | 代码确认 |
| 本章事件       | `chapter_events`                                             | 是                 | 是                                    | forbidden/discarded 被过滤，required 有标签                     | 代码确认 |
| 风格           | 显式选择的 style profile                                     | 是                 | 是                                    | 未选择则可能 fallback；需要用户选择                             |
| 输出/字数      | chapter target > output profile > 4000                       | 是                 | 是                                    | 自动优先级明确                                                  | 代码确认 |
| 当前编辑器全文 | 仅 rewrite 时传 `draftContent`                               | 条件使用           | job 始终可加入 current_editor section | new 模式可能忽略未保存正文                                      | 代码确认 |
| 当前选区       | Editor snapshot 有 offsets                                   | **否**             | 否                                    | writingContext 未接快照，selectedText 恒空                      | 代码确认 |
| 当前场景       | 无活动 scene 与光标映射                                      | 否                 | scene plan 全量进入 prompt            | 不知道用户正在写哪个 scene                                      | 代码确认 |
| 伏笔           | chapter summary/context record 可存                          | 间接               | 间接                                  | 没有统一 active/resolved/target chapter 约束验证                | 代码确认 |
| 锁定内容       | 无通用锁表/范围                                              | 否                 | `forbiddenChanges` 作为 prompt        | 没有 range/hash/program gate                                    | 代码确认 |

## 3. 章节工程约束现状

`ChapterEngineeringState` 是重要的新实现：

- `ChapterCard`：目标、起止状态、视角、地点、必须/禁止事件、已知/未知/释放/保留信息、文风/禁区。
- `ScenePlanItem`：场景地点、人物、目标、冲突、动作、信息释放、结果、转场。
- `GenerationConstraints`：mustFollow、forbiddenChanges/additions、禁止提前事件/揭示、禁词、叙事人称、字数与节奏比例。
- `QualityRules`：检查项、严格度、人工复核、auto fix 设置。

证据：`src/types/chapterEngineering.ts:5-88`。

这些对象持久化到 `chapter_engineering_states`，active state 被 context compiler 编译进 prompt 并纳入 context hash：`src/services/generation/generationContextCompiler.ts:233-333`。

但：

- `chapterEngineeringService.activate` 只确认记录存在并切 active/archived，没有业务完整性 validation：`src/services/engineering/chapterEngineeringService.ts:290-365`。
- `knownInformation/forbiddenChanges/scenePlan` 没有对应的生成结果检查器。
- `qualityRules.manualReviewRequired/autoFixAllowed/autoFixForbidden` 在 job runner 的质量/patch 决策中没有被读取；job 对所有 low-risk patch 自动应用到候选草稿。

所以“结构化约束已保存”不等于“硬约束已执行”。当前主要属于结构化上下文 + prompt 约束。置信度：代码确认。

## 4. 用户重复输入清单

分类：

- A：系统已掌握但没有自动使用
- B：系统根本没有保存/没有统一模型
- C：系统保存但可能不可靠或未版本绑定
- D：必须由用户即时决定

### 4.1 续写当前场景

| 仍需用户表达/重复的信息        | 分类 | 原因                                                                           |
| ------------------------------ | ---- | ------------------------------------------------------------------------------ |
| “从当前光标/当前场景继续”      | A/B  | 有全文和 cursor offset，但没有 cursor→scene 映射；writingContext cursor 未接通 |
| 当前未保存正文                 | A/C  | editor 有，但旧 new-generate 不自动传；rewrite/job 才传                        |
| 当前场景目标/冲突/地点         | A/C  | engineering scene plan 可存，但系统不知道 active scene；老项目可能为空         |
| 本次意图（推进、对话、转场等） | D    | 创作选择必须即时决定                                                           |
| 不可改内容                     | B/C  | engineering forbiddenChanges 可人工填，但无正文范围锁                          |

### 4.2 重写选区

| 信息              | 分类              | 原因                                                                       |
| ----------------- | ----------------- | -------------------------------------------------------------------------- |
| 选区文本/范围     | A                 | Editor 已上报 offsets，但统一 context 未读取，也无 replace_selection apply |
| 选区基础版本/hash | B                 | 任务对象没有 selection/base revision snapshot                              |
| 重写风格/目标     | D（风格方案可 A） | 用户需决定本次变化；已有 style 可自动带入                                  |
| 选区外禁止修改    | B                 | 无锁定范围和 diff gate                                                     |

### 4.3 生成下一章

| 信息                        | 分类       | 原因                                                           |
| --------------------------- | ---------- | -------------------------------------------------------------- |
| 项目、当前卷、已有总纲/前文 | 已自动     | context builder 自动加载                                       |
| 下一章记录/章节目标         | C/D        | 必须先创建/选择章节；若规划缺失需用户补充                      |
| 后续章节大纲                | C          | 当前章节、总纲、卷纲会用；“下一章之后的章节计划”未显式聚合     |
| 出场角色/事件               | C          | 有 chapter 关系时自动用；为空时不能可靠推断                    |
| 场景计划/信息释放           | C/D        | engineering 可存，但多为用户手工填写，不会从项目自动推导并验证 |
| 字数/文风                   | 已自动或 D | 有优先级 fallback；用户可覆盖                                  |

### 4.4 创建人物

| 信息                       | 分类   | 原因                                                   |
| -------------------------- | ------ | ------------------------------------------------------ |
| 当前项目/章节/已有角色     | 已自动 | Character service 可读项目与章节上下文                 |
| 人物身份、目标、阵营、性格 | D      | AI 可给候选，但必须用户决定是否成为正式事实            |
| 与已有事实的冲突           | B/C    | 有数据但无 uniqueness/relationship/knowledge validator |
| 首次出场与知识边界         | B/C    | 字段/character state 部分存在，生成候选未形成强约束    |

### 4.5 修改人物

| 信息                  | 分类 | 原因                                                       |
| --------------------- | ---- | ---------------------------------------------------------- |
| 目标人物 ID           | D/A  | UI 可选择；没有通用 AI 修改人物入口/operation plan         |
| 修改字段与保留字段    | D/B  | 必须由用户决定；无 field lock/base version                 |
| 当前人物状态/知识     | A/C  | `character_states` 可存，但主生成 builder 不加载其最新记录 |
| 修改影响哪些章节/事实 | B    | 无依赖分析与变更计划                                       |

### 4.6 生成大纲

| 信息                             | 分类   | 原因                           |
| -------------------------------- | ------ | ------------------------------ |
| 项目、世界、规则、主角、已有卷章 | 已自动 | `outlineGenerateService` 聚合  |
| 大纲层级/目标卷                  | D      | UI 操作决定                    |
| 本次方向/特殊要求                | D      | 创作选择                       |
| 锁定旧大纲片段                   | B      | 无范围锁或 base revision diff  |
| 与当前正式正文的反向一致性       | C      | 有 summary/context，但无硬验证 |

### 4.7 质量检测

| 信息                            | 分类   | 原因                                                                              |
| ------------------------------- | ------ | --------------------------------------------------------------------------------- |
| 当前项目/章节/全文/hash/version | 已自动 | 当前最完整的快照绑定                                                              |
| 检测范围（选区）                | B      | 只支持全文，selected range 未保存                                                 |
| 检查规则                        | C/D    | engineering qualityRules 可填，但 `qualityCheckAiService` 未接 active rule object |
| 人物知识/锁定内容               | A/B    | 部分数据存在但不进入可验证规则                                                    |

### 4.8 自动放置

| 信息                       | 分类 | 原因                                             |
| -------------------------- | ---- | ------------------------------------------------ |
| 目标类型/目标对象          | D/B  | 设定候选有有限 type；通用结果没有 placement plan |
| append/replace/merge/patch | D    | 当前正文只让用户点 append/replace_all            |
| 基础版本/冲突策略          | B    | 没有模型                                         |
| 锁定范围                   | B    | 没有模型                                         |
| 多目标拆分与失败策略       | B/D  | 没有 transaction plan；策略需产品决定            |

## 5. AI 约束分层审计

### 5.1 Prompt 建议/约束

已存在且覆盖广：

- 人物设定、能力限制、禁止行为；
- 世界规则；
- 总纲/卷纲/章节大纲和执行清单；
- 必须出场角色、必须/禁止事件；
- 章节工程已知/未知信息、秘密、场景计划；
- 文风、字数、禁词、禁止改动/新增/提前揭示；
- 质量修复要求只修改问题区域。

证据：`contextBuilder.ts:228-440`、`generationContextCompiler.ts:103-132,250-282`、`promptBuilder.ts`、`qualityFixService.ts:202-268`。

这些是对模型的指令，不是程序硬约束。

### 5.2 结构化上下文约束

已经存在：

- `ChapterGenerationContext`；
- `ChapterEngineeringState` + active version；
- `ChapterGenerationSnapshot` + contextHash + sources；
- quality report/fix run 的 draft/version/hash；
- chapter characters/events 和 context records。

缺口：旧任务没有 context snapshot id；结构化对象多在 prompt 拼接时扁平化为文本，输出后无法逐字段验证。

### 5.3 输出结构约束

要求 JSON 的入口包括角色/事件/设定建议、大纲部分流程、质量检测、质量修复、总结。当前以 prompt + 容错 JSON parser 为主，不是网络层 JSON Schema / constrained decoding。

程序会在解析完全失败时拒绝部分流程（如设定推演无 payload），但质量修复解析失败时可回退到原正文，普通正文本来就是自由文本。

### 5.4 程序硬约束

已确认存在：

- AI 配置参数范围校验：`realAiClient.ts:43-66`、`src-tauri/src/ai.rs:46-71`。
- SQLite 外键（运行时启用）与部分 ID+chapter WHERE。
- 质量修复前 report hash stale check：`CheckPanel.tsx:97-105,240-248`。
- quality fix 长度/段落范围门控：`qualityFixService.ts:275-335`。
- low-risk patch 的 severity/quote length/quote exists gate：`generationJobService.ts:312-355`。
- 设定候选有限 target type switch 和 pending 状态：`settingSuggestionService.ts:180-230,299-315`。
- 大纲/必须角色的生成后字符串覆盖检查：`outlineComplianceChecker.ts`。

未存在：

- 正文 target revision/hash compare；
- 锁定段落/字段保护；
- 人物知识边界 engine；
- scene plan 与输出逐场校验；
- 世界规则语义 validator；
- placement operation allowlist + base version + transaction；
- 通用幂等应用键。

### 5.5 生成后审查

| 流程           | 审查                                         | 是否阻止应用/采用                      |
| -------------- | -------------------------------------------- | -------------------------------------- |
| 旧章节生成     | 大纲关键点与必须角色字符串检查               | 只提示；仍可确认采用                   |
| 章节工程生成   | 自动质量检测 + low-risk patch                | 生成候选；不自动正式采用               |
| 质量修复       | scope gate + 完整复检 + before/after compare | scope 失败不建候选；未变好不载入编辑器 |
| 大纲/设定 JSON | parse/normalize                              | parse 失败通常拒绝候选                 |
| 通用 apply     | 无语义审查、无 base compare                  | 用户确认即可替换当前全文               |

## 6. 任务书关键问题回答

### 当前有哪些硬约束？

参数范围、DB 外键、质量 report hash stale gate、质量修复启发式范围 gate、有限 patch/target type gate。它们只覆盖局部流程。

### 哪些实际上只是提示词？

人物行为、世界规则、章节目标、场景计划、已知/未知信息、禁止提前揭示、文风禁区、禁止改动/新增等绝大多数小说语义约束。

### 是否存在锁定机制？

不存在正文范围/字段级锁。`forbiddenChanges` 与 output forbidden items 是 prompt 字段，不是锁。

### 是否存在人物知识边界？

`ChapterCard.knownInformation/unknownInformation` 和 `CharacterState.knowledgeState` 提供零散数据形态，但没有“角色 X 在章节 N 可知哪些事实”的统一读取与 validator。结论：未形成能力。

### 是否存在文档版本约束？

质量报告/修复有 draft version/hash；普通生成、通用 apply、采用、自动 patch 没有强制 base/current 比较。

### 是否存在场景计划校验？

场景计划进入 chapter engineering prompt，但没有输出场景结构解析和逐项验证。

### 是否存在生成后自动审查？

有：大纲/角色字符串检查、章节工程质量检查、质量修复复检。覆盖不一致，且普通 apply 不要求通过它们。

### 不合格结果是否会被阻止应用？

只有 quality fix scope 失败等局部流程会阻止。旧章节生成不合格主要警告；用户仍可应用/采用。

### AI 是否能直接修改正式事实？

章节正文生成一般先成为候选草稿，不会自动 `is_adopted=1`；大纲/设定通常也需要用户保存/采纳。质量修复“更好”会自动载入编辑器但仍不是正式 adopted 正文。当前形式上保留了人工采用门槛，但正式采用实现本身缺事务/版本安全。

## 7. 能力差距优先级

| 差距                                                  | 风险                        | 等级 |
| ----------------------------------------------------- | --------------------------- | ---- |
| apply/adopt 无固定目标、base revision/hash 与原子事务 | 可写错章节/覆盖正文         | P0   |
| async 任务与当前 UI 状态未隔离                        | 迟到结果错位                | P0   |
| 大文本完整性/引用链不阻断失败                         | 截断/已知 hash 错误仍持久化 | P0   |
| 约束结构只进 prompt、缺输出 validator                 | 违反设定仍可应用            | P1   |
| selection/active scene 未接通                         | 用户重复描述范围/场景       | P1   |
| character_states/knowledge 未进入主 context           | 人物状态/知识不可靠         | P1   |
| 两套任务/上下文追溯断裂                               | 无法解释和恢复              | P1   |
| 日志缺统一 trace                                      | 问题难复现                  | P2   |

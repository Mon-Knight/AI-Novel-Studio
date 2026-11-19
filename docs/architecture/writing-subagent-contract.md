# Writing SubAgent 契约（candidate-only）

> 当前状态：Writing SubAgent 已纳入桌面统一原生 Runtime 的受控 candidate-only 阶段（2026-11-11，**INTEGRATION / NOT YET FULLY VERIFIED**）；API、Mock、本地模型共用生命周期，确定性 Writer 旧顶层仅限浏览器开发兼容。历史关闭开关不再为桌面新请求选择另一宿主，能力不支持时明确拒绝。
> 本文保留 E-0～E-4 和 §3.1/§3.2 的原日期、配置与验收范围，不回写历史。当前受控父子与授权边界见 §3.7；§3.3～§3.6 保留来源/字数/准入安全要求，其中前端调度职责由本次原生协调器接管。历史或离线通过不代表本批整体验收、R4 live 云端 VERIFIED 或文学质量证明。

---

## 1. 历史接入前状态（v3.6.2）

- `taskSessionAdapter.startTurn` 用 `classifyTaskIntent(goal)` 正则分类；`chapter_write` 意图直接进入 `taskRuntimeAdapter` → `workbenchChapterWriter`，即**确定性 Writer 编排**：编译上下文（`generationContextCompiler`）→ 单次 Provider 生成 → 字数修复（`resolveChapterWordRange`）→ 完整性修复（`inspectChapterCandidateIntegrity`）→ 形成 `chapter_text` 候选。模型不做工具选择。
- DSH 运行时（`src-tauri/src/services/dsh/task_runtime.rs`）已经具备候选工具协议：`generate_chapter / polish_chapter` 返回 `chapter_text` 时，宿主校验 `candidateOnly=true`、`novelId/chapterId` 归属、`expectedArtifactType`，并落为 `ResultArtifact`。但 `workbench_task_instruction` 没有 `chapter_write` 任务类型（未知类型 → “停止且不调用候选工具”），也没有字数与完整性的宿主校验。
- 章节采用链路不变：候选 → 用户确认 → `ReviewAuthorization` → 人工审阅/编辑 → 单一 Rust/SQLite 事务采用。**任何 SubAgent 都不写正式正文。**

## 2. 契约定义

契约代码：[writingSubAgentContract.ts](../../src/services/agents/writingSubAgentContract.ts)（`WRITING_SUBAGENT_CONTRACT_VERSION = 'writing_subagent_contract_v1_draft'`）。下表记录原 candidate-only 子任务约束；正式写入始终不属于子任务。当前根预算、原生准入与人工/预授权应用责任按 §3.7 解释，不能把旧 `adoptionPath` 描述理解为自动结果必须伪造人工审阅。

| 维度     | 契约                                                                                                                                                                                                                         | 与现状的关系                                  |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| 身份     | `agentId = writing-subagent`，独立于 Main Agent 会话；`runId` 仍归属任务对话，产物卡片、运行日志与现有 UI 复用                                                                                                               | GAP-09：不再复用 Main Agent 身份              |
| 模式     | `mode = candidate_only`，唯一产物 `chapter_text`，`expectedTool ∈ {generate_chapter, polish_chapter}`                                                                                                                        | 与 `ReviewAuthorization` 采用链路衔接         |
| 工具面   | `allowedTools = requiredReadTools ∪ {expectedTool}`；只读工具固定为 `novel.read_context / chapter.read_outline / get_character_states / search_memory`（legacy 名，与现有候选回合一致；Canonical 名迁移后同步替换）          | 绝不包含其他 `generate_*`、`save/adopt/write` |
| 模型     | 独立 `TaskModelSnapshot`：每回合冻结所选模型，同一任务可在回合间切换；重试沿用原 Run 模型，历史来源不变；`runtimeMode=mock` 时全程确定性                                                                                     | GAP-09 独立模型配置                           |
| 预算     | `maxCandidateAttempts=3`（复用 DSH `MAX_CANDIDATE_TOOL_ATTEMPTS`）、`maxLengthRepairs=2`、`maxIntegrityRepairs=2`、`maxWallClockMs=8 min`、`maxOutputTokens` 由字数区间推导                                                  | SubAgent 自身的尝试预算，现行见 §3.5          |
| 字数     | `wordRange = resolveChapterWordRange(targetWordCount, percents)`，目标依次取本回合明确覆盖、任务对话独立设置、章节大纲；写入宿主指令并作为验收条件。百分比来自设置中心「网关与流控」（默认 80%～115%，本机 LocalStorage）    | 复用 Writer 规则                              |
| 连续性   | `continuity.previousChapterId / sourceHash`：宿主从已采用稿复读并验证，模型不能靠自行检索替代前章门禁                                                                                                                        | 复用 `findPreviousChapterForContinuity`       |
| 取消     | `dsh cancel(conversationId)`，Worker 级取消；UI 与现有停止按钮一致                                                                                                                                                           | 已有                                          |
| 错误责任 | 协议错误（未读必需上下文、未调用候选工具、越权工具）由宿主返回稳定错误码并在预算内自动重试；模型内容错误（字数、完整性）由宿主校验后以 `DSH_CHAPTER_CANDIDATE_REJECTED:<code>` 要求模型修正；预算耗尽 → 运行失败，不产生候选 | 失败关闭                                      |
| 证据     | 对外验收材料仅保留工具名、计数、状态码、内容 hash、字数、修复轮次、模型身份，不包含提示词、正文或凭据；应用内部仍保存受作用域校验的完整执行快照                                                                              | 与 R4 证据口径一致                            |

契约由 `planWritingSubAgentTurn()` 纯函数生成，并由 `assertWritingSubAgentContract()` 复验以下不变式（有单测）：

1. `expectedArtifactType === 'chapter_text'` 且必须绑定 `chapterId`；
2. `allowedTools` 恰好等于只读工具 + 一个候选工具，不含任何其他 `generate_*`；
3. `mode === 'candidate_only'`、`formalWrites === 'forbidden'`、`adoptionPath === 'review_authorization'`；
4. 预算为正整数且不超过上限。

## 3. 分步接入

下表保留 E-0～E-4 的历史接入过程；原 E-2 的事后 advisory 已由 §3.5 的先复核后准入替代，不能把旧表当成当前候选门禁。

| 步骤 | 内容                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | 验证                                                                                                                        | 状态                        |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| E-0  | 契约类型、规划器、不变式断言、特性开关 `ai_novel_studio_writing_subagent_dsh`（E-0～E-4 期间默认关闭；v3.7.0 起桌面端 + API 模型默认开启，`0` 关闭 / `1` 强制开启）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | `writingSubAgentContract.test.ts`                                                                                           | 完成                        |
| E-1  | Rust 新增任务类型 `chapter_write`（→ `generate_chapter`）与 `chapter_polish`（→ `polish_chapter`）：`expected_contract_for_task_kind` 绑定唯一候选工具与 `chapter_text`；必须绑定章节；`turn_allowed_tools` 只暴露四个只读工具 + 该候选工具（`CHAPTER_WRITE_ALLOWED_TOOLS / CHAPTER_POLISH_ALLOWED_TOOLS`）；`workbench_task_instruction` 写入正文写作/润色要求与宿主字数区间；`StartTaskTurnInput.chapter_word_range` 只允许章节写作任务携带且需 `minimum ≤ target ≤ maximum`；候选落库前 `validate_chapter_candidate_length` 用与 `draft_service::word_count` 同源的统计校验，越界返回 `DSH_CHAPTER_CANDIDATE_LENGTH_REJECTED`（最多追加两次有界宿主字数修正；总结的既有协议恢复保持独立） | `task_runtime_tests.rs` 3 项（契约/allowlist/提示词、负例、字数边界）                                                       | 完成                        |
| E-2  | TS 侧完整性复核：DSH 回合返回 `chapter_text` 产物后，读取候选正文与紧邻前章采用稿，运行 `inspectChapterCandidateIntegrity`；存在 `error` 级问题时追加一条助手回合列出问题码并建议「要求修改」，候选本身不修改、不删除。按预算自动发起修正回合留待下一步                                                                                                                                                                                                                                                                                                                                                                                                                                      | `taskSessionAdapter.test.ts`                                                                                                | 完成（advisory）            |
| E-3  | `taskSessionAdapter.startTurn`：仅当桌面端 + 开关开启 + 已绑定章节时，`chapter_write` 意图经 `planWritingSubAgentTurn → toDshTaskStartContract → dshTaskRuntimeService.start`（润色意图映射 `chapter_polish`，字数区间按本回合 / 任务 / 章节目标的优先级解析）；其余一律维持确定性 Writer                                                                                                                                                                                                                                                                                                                                                                                                    | `taskSessionAdapter.test.ts`：开关关闭零变化、开启时 allowlist 收窄、未绑定章节回退 Writer                                  | 完成                        |
| E-4a | 真实模型正向验收：用客户端已配置的模型卡片，在生产 EXE + 操作者真实配置（DPAPI 保管库解密凭据，密钥不出应用）上跑一次 `chapter_write`；判据见 §3.1                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | `npm run test:real-profile:writing-subagent`（`tests/real-acceptance/writing-subagent-real-profile.spec.ts`，opt-in）       | 完成（2026-09-08，见 §3.1） |
| E-4b | 负例与恢复（故障注入）：越权工具、跨书候选、上游瞬时/持续失败、字数越界候选、进程被杀后的重启恢复，全部经生产 EXE + 隔离配置 + 回环脚本上游跑通；判据与发现见 §3.2                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | `npm run test:fault-injection:writing-subagent`（`tests/real-acceptance/writing-subagent-fault-injection.spec.ts`，opt-in） | 完成（2026-09-08，见 §3.2） |

E-0～E-3 已在仓内落地并通过单测（E-0～E-4 期间开关默认关闭，生产 `chapter_write` 走确定性 Writer）。E-4a 已用客户端 Gemini 卡片通过正向真实链路，E-4b 六个负例/恢复场景全部通过；验收中发现的 GAP-18 / GAP-19 已于同日收口（migration 038 持久化运行的章节目标；重试提示显式要求本回合重读），并在故障注入载体上以“不点名章节的目标文本 + 重试”复验。**v3.7.0 已开放**：桌面端 + 真实 API 模型默认走 SubAgent（`isWritingSubAgentDshEnabled` 在未设置开关时按 `runtimeMode === 'api'` 判定），mock / 本地模型与浏览器模式继续走确定性 Writer；真实配置验收已改为不设置开关、按默认路径复验。

### 3.1 E-4a 真实验收记录（2026-09-08）

载体：`tests/real-acceptance/wdio.real-profile.conf.ts` 用 tauri-driver 启动 `src-tauri/target/release/AI Novel Studio.exe`，**不设** `AI_NOVEL_STUDIO_E2E`（隔离载体会阻断网络并改写数据目录），WebView2 用户数据目录传 `%LOCALAPPDATA%\com.ainovelstudio.app`（wry 的父目录，WebView2 自行追加 `EBWebView`；传子目录会得到一份空的嵌套配置）。规格经生产 IPC 建立固定作品「Writing SubAgent E-4 真实验收」（世界、规则、主角、卷、章纲齐备，后续运行复用同一作品并新增章节），在 WebView 内写入开关 `ai_novel_studio_writing_subagent_dsh=1`，经生产工作台 UI 创建并启动任务，结束后经 `get_task_conversation / get_result_artifact / get_chapters_by_novel_id / get_drafts_by_chapter_id` 取证并清除开关。前置：桌面应用已关闭（单实例）、以非提权 shell 运行、`AI_NOVEL_STUDIO_REAL_PROFILE=1` 显式 opt-in。

证据只含工具名、状态、计数、长度与哈希，写入 `test-results/real-profile/<runId>/writing-subagent-real-profile.json`（gitignore）；不含提示词、正文与凭据。两次有效运行（`e4-gemini-03`、`e4-gemini-04`）结果一致：

| 项目           | 结果                                                                                                                                                              |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 模型           | `openai_compatible:gemini-3.7-flash-high`，`runtimeMode=api`，模型目录 `available`                                                                                |
| 回合           | 1 个 `task_run`，`completed`，25～30 s；会话终态 `waiting_user`                                                                                                   |
| 工具调用       | `novel.read_context → chapter.read_outline → get_character_states → search_memory → generate_chapter` 各 1 次且全部 `succeeded`；allowlist 之外的模型工具调用为 0 |
| 运行时投影     | `dsh.session.title` 1 行：`source=dsh-session.event` 的会话事件投影，不是模型工具调用，不受 allowlist 约束                                                        |
| 候选           | 1 张 `chapter_text` 卡片，`status=candidate`、`processingStatus=valid`，绑定固定作品与目标章节；汉字数 1008 / 1122，均落在硬区间 800～1150（目标 1000）           |
| 完整性复核     | 未触发 `error` 级问题，未追加「候选完整性检查」助手回合                                                                                                           |
| 正式写入不变式 | 章节 `status=outline_ready`、`wordCount=0` 不变；`chapter_drafts=0`；作品总字数 0；`ArtifactDecision=0`                                                           |
| 开关           | 运行结束后从 WebView 移除，`flagRestored=true`                                                                                                                    |

排障记录：首轮把 `…\EBWebView` 传给驱动导致嵌套空配置（模型目录报“冻结模型快照 runtimeMode 必须是 api”）；第三轮把 `dsh.session.title` 误判为越权工具。两处均是载体问题，已在规格与配置中修正，第四轮 PASS。

### 3.2 E-4b 故障注入验收记录（2026-09-08）

真实模型下越权、跨书、失败与中断都不可控，因此 E-4b 用确定性回环上游代替模型、其余全部走真实栈：`tests/real-acceptance/wdio.fault-injection.conf.ts` 用 tauri-driver 启动生产 EXE，但把 `LOCALAPPDATA / APPDATA / WebView2` 用户数据目录全部重定向到 `test-results/fault-injection/<runId>/profile/`（不碰操作者的设置、保管库与数据库；DSH 运行时载荷经 `DSH_RUNTIME_ROOT` 只读复用），规格在 WebView 里写入 `ai_novel_studio_ai_settings`（`runtimeMode=api`、`baseUrl` 指向回环 mock、无凭据）与 Writing SubAgent 开关，经生产工作台 UI 创建并启动任务。模型由 `scripts/dsh/mock-workbench-upstream.mjs` 扮演，新增故障模式 `forbidden-tool / cross-novel / upstream-error-once / upstream-error / hold-generate` 与进程内 `configure()`（同一端口切换模式与 id）；mock 只按“最新一条用户消息之后”的工具调用推导下一步，对应宿主“必需读取须在本回合完成”的指令。零网络、零凭据、零计费。

两次连续 PASS（`e4b-05` 旧 EXE、`e4b-06` 含 supervisor 修复的新 EXE），六个场景每个都保持“正式章节字数 0、草稿 0、作品总字数 0、无 ArtifactDecision”：

| 场景                   | 注入                                                               | 观察到的宿主行为                                                                                                                                                                                                     | 判定 |
| ---------------------- | ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| S1 越权工具            | 四个只读工具之后模型调用 `expand_settings`（allowlist 外）         | 宿主拒绝投影该调用，run `failed`，错误为 `DSH 调用了未授权工具: expand_settings`（修复前被后续事件覆盖成“tool/result 找不到对应调用”）；0 张候选卡；世界设定数不变                                                   | PASS |
| S2 跨书候选            | `generate_chapter` 携带另一部作品与章节的 id                       | Gateway 作用域校验使工具事件 `failed`，run 以 `DSH_EXPECTED_CANDIDATE_FAILED` 结束；0 张候选卡；另一部作品的章节字数/草稿保持 0                                                                                      | PASS |
| S3a 上游瞬时失败       | 首个非 attestation 补全返回 HTTP 500，之后正常                     | 传输层自动重试，同一 run 内完成；1 张 `chapter_text` 候选（1019 字，落在 800～1150）；mock 记录 `injectedUpstreamFailures=1`                                                                                         | PASS |
| S3b 上游持续失败与重试 | 所有补全返回 500，run 失败后把 mock 切回正常并点击「重试」         | 3 次 500 后 run `failed`（错误含 `SERVER` 与代理响应统计，不含提示词）；重试产生第 2 个 run 并 `completed`，共 1 张候选                                                                                              | PASS |
| S5 字数越界候选        | 候选正文仅 88 字（目标 1000）                                      | `DSH_CHAPTER_CANDIDATE_LENGTH_REJECTED: 章节候选 88 字，超出宿主区间 800～1150 字`，0 张候选卡（E-1 字数门在真实栈端到端触发）                                                                                       | PASS |
| S4 重启恢复            | 四个读取完成后 mock 挂起 `generate_chapter` 补全，此时强杀应用进程 | 重启后启动恢复对话框 `recoveredRuns=1`，中断 run 标为 `failed`（“工作台已重新加载，上一轮运行已中断”），无产物；重试在新 run 内重新完成四个读取后 `generate_chapter` 成功，共 2 个 run、1 张候选；无残留 worker 进程 | PASS |

**产品发现与收口（登记于 `agent_gap_report.md` 总表与 §7）：**

- **GAP-18 重试目标证据缺失（已修）**：桌面 `task_runs` 没有章节列，Rust `CreateRunInput` 丢弃前端传入的 `chapterId`，DSH 工具投影只保留 `chapterIdHash`，因此 DSH 运行若在任何候选/授权产生前失败（S3b 的持续上游失败、S4 的中断），`resolveRetryRunChapterTarget` 只能靠回合目标文本定位章节；目标写成“生成本章正文…”时重试被 fail-closed 拒绝（`e4b-03` 实测：`WORKBENCH_RETRY_TARGET_MISSING`）。收口：migration `038_task_runs_chapter_binding` 为 `task_runs` 增加可空 `chapter_id`（纳入不可变身份触发器），`create_run` 校验章节属于对话作品且未删除（`TASK_RUN_CHAPTER_SCOPE_MISMATCH`），DSH 运行创建时写入绑定，会话包序列化 `chapterId` 供前端 `run.chapterId` 证据源直接使用。故障注入载体已改回不点名章节的目标文本，`e4b-fix-01/02` 中 S3b/S4 的重试均一次成功，两个 run 都绑定同一章节。
- **GAP-19 重启后沿用旧读取会被拒收（已修）**：重试复用被中断的 DSH 会话转录（会话按对话共享，保证多回合连续性），而宿主的“必需读取”按 run 计数。`e4b-04` 用“沿用转录中已有读取、直接提交候选”的 mock 复现：新 run 直接 `generate_chapter` → `DSH_REQUIRED_CONTEXT_READ_MISSING`，run 失败关闭、零产物。收口：宿主在创建 run 前统计同一回合已有的失败/取消运行数，用户重试时在回合提示追加“用户重试”说明——此前回合读取已失效、宿主只承认本回合内完成的读取、必须重新并行完成全部必需读取后再进入候选阶段（自动协议恢复的提示不变）。按 run 校验的安全属性保持；mock 以布尔值记录该说明是否到达模型，`e4b-fix-01/02` 证实原运行的请求均不含、重试运行的每个请求均含。真实模型是否遵从仍取决于指令遵从度，宿主在不遵从时继续 fail-closed。
- **supervisor 诊断（已修）**：观察者错误改为“首个错误优先”，越权工具调用的根因不再被后续 `tool/result` 投影失败覆盖（`record_observer_error` + 单测）。

### 3.3 当前字数恢复边界

- 独立对话设置由已持久化的用户回合派生；本回合明确覆盖优先于任务设置，最后才取章节目标。引用、否定、疑问、模型回复与自动回合不作为任务设置来源；重试旧回合不读取其后的设置。纯设置走 `ans-local`，不触发凭据 / 模型预检或运行完成后的插件探测。
- 只有宿主完成工具契约与作用域复验后产生的精确 `DSH_CHAPTER_CANDIDATE_LENGTH_REJECTED` 才进入字数恢复。至多两次宿主修正，共享 480 秒截止时间；模型、目标范围和 allowlist 冻结，每次重新读取必需上下文。取消、作用域不符、错误来源不明或预算不足时停止。
- `maxCandidateAttempts=3` 是跨 Run 的累计**候选验收预算**：回合结束后统计包括失败调用在内的候选工具事件，超过即拒绝 Artifact 并停止恢复。它不是 Gateway 派发前硬门；不服从指令的模型可能已经进行了第四次工具调用，不能宣称第四次派发绝不会发生。每个 Provider 请求仍经过既有请求治理。
- 输出 Token 不超过任务冻结模型上限，并取与字数估算的较小值；当前完整性检查按 §3.5 在候选发布前执行。正式正文、草稿采用、审阅授权和数据库 schema 均不变。上节 2026-09-08 的六场景记录为历史证据；当前扩展场景以测试策略和本轮实际运行结果为准。

### 3.4 当前精确修订与完整上下文门禁（待统一验收）

**修订来源不是采用授权。** `ArtifactRevisionSource` 包含 conversationId / novelId / chapterId、cardId / artifactId / artifactHash / artifactType、runId、title 与可选 sourceDraftVersion。要求修改时意见追加到原任务草稿，source chip 独立绑定；来源随发送的用户 Turn 版本化保存，重试读取原 Turn，不改用新输入或最近候选。`taskRuntimeAdapter` 和 `taskSessionAdapter` 重新读取精确候选全文及 hash，不只传标题或摘要。

章节派生最终统一为 `parentArtifactId=<原候选>`、`derivationType=revision`，不会替换旧候选。新 IPC `create_chapter_revision_artifact` 只调用窄门禁；通用 `create_result_artifact` 仍拒绝 parent/derivation，携带修订元数据也不能退回创建无来源的普通候选。原生在既有 Artifact IMMEDIATE 事务中复验：

1. 当前任务、作品/章节、card/artifact/run/turn、标题/类型/草稿版本均指向同一权威候选，目标未删除、任务未归档，原 Artifact 及 Attempt 有合法处理状态。
2. 最新精确 card/任务决定仍为用户的 `request_revision`，artifact/hash 匹配且没有应用或冲突；更早请求不能覆盖之后的拒绝/再确认。
3. 原始 large_text 文档归属该候选，全文 hash/长度正确；不接受客户端正文、预览或“verified”标记替代。
4. 冻结 Input Snapshot 与 Context Snapshot 中的 revisionSource 完全相同，parent/sourceArtifactId/sourceContentHash/derivationType 匹配；`get_task_detail` 复验 input/context/constraint/request hash。实际请求 messages 中必须包含完整来源正文（仅允许编译器的换行/首尾空白规范化），不能只在 manifest 声明或比较 JSON 转义子串。

**必需材料完整性与规则基线。** Gateway 世界/规则分别读取 all-active 全文字段（含旧 structuredJson / forbiddenRules），每域 128 KiB；章节工程 64 KiB，完整或 context_incomplete，不按最近 6/8 条抽样、不截字段。root 失败不计为完成必需读取。宿主 `task_runtime_context_coverage` 校验当前 Run 的真实持久成功回执、largeTextRefId 归属/全文 hash/字符数、root ok、scope、来源 ID/数量、每项原文字段 hash、投影字节/hash 和规则指纹；看到 complete 标签不等于准入。

桌面/Gateway 共用 `src-tauri/shared/world_rule_fingerprint.rs`；DSH expectedRuleSetFingerprint 从实际读时材料验证而来，AI Task 创建以原生 nativeRuleSet 冻结并计入权威 request_hash，拒客户端自报或读取后的规则漂移。规则变更在同事务中 expire 旧 issued reviews，保留 consumed/已采用历史，签发和最终采用再复验。世界规则字段、作者变更预览及回执详见 [世界规则契约](../design/world-rule-contract.md)。

**公开复核结果的限度。** TS `generationContextCompiler` 将视角角色、已知/未知信息实际编入工程材料，`chapterProviderContext` 将世界/规则与工程等材料交给 Provider 的 required/requireFull 预算，缺失或不完整失败关闭。DSH 先按 §3.5 完成有限文本检查再准入候选，公开 error / warning / not_checked 与不可读原因；不把 error 候选先发布后删除，warning 保留作者审阅。`semanticRules` 始终 not_checked，不能把上下文覆盖、结构合规、字数或启发式检查夸为自动语义证明。

本节核对来源：`src/types/artifactRevision.ts`、`workbenchDraftStore`、`useWorkbenchArtifacts` / `useWorkbenchTaskRunner`、`artifactRevisionSourceService` / `artifactRevisionSourceCodec`、两条 Runtime Adapter，以及原生 `chapter_revision_source.rs` / `chapter_revision_artifact.rs` / `artifact_service.rs`。新候选仍须取得自身审阅授权；只读/编辑/保存/采用分离，显式对话采用安全短路保留，不开放模型正式写入。以上均待统一验收，不回写 §3.1 / §3.2 历史证据。

### 3.5 本轮审计修复：宿主复核后才发布候选

- `chapter_write / chapter_polish` 必须带 `chapterHostGate`；缺失在模型预检前失败关闭，不再保留一次直接成卡的旁路。`draft` 在字数合规后仅返回待复核正文/哈希和权威前章材料，Run 保持 `running` 并记录 `DSH_CHAPTER_CANDIDATE_WITHHELD`，没有可用 Artifact/候选卡，也不是完成成功。
- ANS 的宿主适配器调用与 Writer 相同的有限完整性检查。`error` 进入有界整章修复，`warning` 留给作者；只有干净或 warning-only 才请求 `admit`。原生重读精确运行、工具结果和全文哈希，拒绝改写问题严重度、跨任务/章节、已取消、失效基线或模型快照。发布事实使用持久源运行的模型快照，准入本身不再调用 Provider。已成功的精确候选重放不重复创建卡片。
- 预算由持久的 `runtime.chapterBudgetEpoch` 分组，一个自动尝试最多 3 次累计候选验收、至多 2 次字数/完整性修复且共享 480 秒；客户端不提交 remaining 值。自动修复绑定旧 Run，不带旧 Run 也不能重新获得预算。只有作者点击重试、最近运行已失败/取消时才创建新的原生尝试纪元，仍归属原 user Turn；重启不能隐式恢复调用预算或自动重新请求。新建准入前再次检查源纪元的时间和次数，第 3 次有效候选允许准入，超限不创建新候选。
- 前章顺序使用与 Writer 相同的作品/卷/章规则。适配器只声明前章 ID 与哈希，正文由 Rust 从当前采用稿复读；缺少采用稿、空稿、损坏大文本、跨作品或生成期间改采均拒绝。Provider 材料的长前章中段截断会明确标记，来源哈希仍绑定完整原文；结构覆盖和有限检查都不等于语义全检。
- 请求的有效输出 Token 上限是字数估算与冻结模型上限的较小值，不通过目标字数暗中放大已冻结模型配置。采用阶段同样只让 `error` 阻断，warning 不替作者作决定；现有作用域、revision/hash、审阅授权和原子采用事务不放宽。

本节是实现契约，统一原生/桌面与故障注入结果另记。`semanticRules` 继续为 `not_checked`，不宣称文学质量证明、自学习或 R4 live VERIFIED；§3.1 / §3.2 历史记录不作为本轮通过证据。

### 3.6 2026-10-16 失败恢复与定向长度修正（集成验证中）

失败回合的成功规划不能替代正文成功。重试从已核验的执行事实恢复任务类型、原用户目标、必需读取、候选工具和字数范围；不同任务能力使用独立 DSH 会话，不能扩展创作讨论回合工具目录来处理正文重试。新宿主执行契约复用现有持久事件，未新增 migration；历史回合依据原用户消息、受验证规划和一致的原生范围证据恢复，缺少关键冻结范围时拒绝并提供明确的新请求路径。

该历史批次中，旧 DSH 写章或润色回合重试沿用原生宿主路径，SubAgent 关闭开关只影响新请求。当前本批已取消用此开关选择另一桌面宿主，见 §3.7。原生恢复结果缺少执行契约时停止，不回退到当前目标重新规划或确定性 Writer；原模型、硬区间、读取/候选工具和原生尝试预算继续复验。

长度恢复保存已验证作用域的失败完整稿，选择最接近目标的基稿，反馈实际增删差额、每次字数与保留内容要求。仍提交完整正文并由宿主计数，最多调用次数与冻结硬区间保持；改进修订提示不能保证模型必然收敛。界面区分等待模型、自动修正与候选验证，工具越权失败保留原错误链并说明当前阶段权限。

### 3.7 统一 Runtime 中的受控写章（2026-11-11，集成验证中）

当前状态 **INTEGRATION / NOT YET FULLY VERIFIED**。§2 的 candidate-only、精确来源、有限校验和正式写入禁止仍成立，但历史“SubAgent 自己控制完整生命周期、前端 draft/admit、关闭开关回到 Writer”的职责已收敛到原生根协调器：

- 子阶段在同一用户目标下使用独立上下文/Session，执行契约记录根任务/回合/运行、父运行、阶段、预算纪元与冻结章基线；继续复用现有 Run/ToolCallEvent/AiTask/Attempt/Artifact，不新增平行任务系统。
- 原生宿主验证阶段允许的工具、来源回执与结果，再决定读取、生成/修订、检查或等待应用。普通助手回复不是执行指令；子任务只能返回候选或验证结果，不能签发授权或调用正式采用旁路。
- 子任务范围与模型不得扩大或改变，取消与时限继承父任务；请求、工具、Token、费用与修订次数累计到根目标。历史章节修复上限继续作为更窄门禁，不能通过新 Run/子任务恢复根预算。
- 前端只提交任务与呈现持久投影。有限完整性检查与 `draft → admit` 调度由原生协调器完成；API、Mock、本地模型共用此路径。Mock 返回结构化工具响应，本地不兼容明确拒绝；历史关闭开关不把新桌面任务路由到确定性 Writer。
- 已有 Scene/Beat 计划和来源是阶段输入，不更换执行宿主；**原生阶段链源码已落地（`scene_plan → 每 Scene beat_plan → 每 Beat beat_write/beat_state → scene_close → chapter_assemble`），并有隔离 SQLite 单测；真实 Windows Tauri 已以固定 Mock 覆盖 Beat 状态中断、显式续跑和两次重启，整章携带计划不等于 Scene/Beat 功能对等**。相关恢复/阶段证据以[本批实施记录](../../reports/unified-agent-2026-11-11/implementation.md)为准，齐全前不宣称完整迁移。
- 候选准入后，默认走既有人工决定、审阅授权、编辑/保存/采用。若当前目标有有效 `adopt_chapter_text` 预授权，则由原生统一应用服务复验范围、模型、版本/hash、确定性门禁、预算/次数、期限与幂等后采用；SubAgent 仍无正式写入权，预授权结果记为 `task_preauthorized`，不伪造 `authorReviewed=true`。
- 正文提交后的总结阶段与后续基线推进只认精确权威回执。新独立用户目标不继承旧授权；撤销/取消停止新授权写入，已提交事务保留。等待决定的进程内续接不等于跨重启自动模型重放。

固定 DSH commit `47f943859bef60e4160492346772ded9b24f765a` 与 `ans_task_session_v2` 不变。当前新增 041～043 和备份 schema 13 属应用服务的权限/恢复事实，不改变 candidate-only 身份；043 仅允许 `dsh.*` 原生控制事实在 Run 终态后 append，普通工具仍限活动 Run。人工采用与预授权采用都复验 staged assembly evidence，装配恢复复用完全匹配候选并补齐缺失 admission。完整验证由[本批实施记录](../../reports/unified-agent-2026-11-11/implementation.md)维护，不挪用 §3.1/§3.2 历史 live/回环结果。

## 4. 当前非目标与兼容边界

- Writing SubAgent 不自行采用、签发任务授权、修改世界规则或绕过原生事务；有授权的自动采用由外层原生应用服务执行。
- 保留人工 `ReviewAuthorization + adopt_review_authorized_draft` 链路；人工与预授权记录明确区分。
- 本批兼容迁移为 `041_task_authorizations`（含原生人工审阅基线补充）、`042_library_task_scope` 与 `043_host_terminal_native_facts`；001～040 不改写，041/042 已落地定义不重写，本批仅 043 新增 trigger。详见[数据模型](../data-model.md#45-任务级预授权与总结应用策略2026-11-11)。
- 不删除可复用 Writer 编译/校验能力；旧顶层编排只限浏览器开发兼容，不是桌面失败回退。浏览器没有任务预授权或真实共享原生 Runtime，不能作为桌面等价证据。

## 5. 与其他文档的关系

- 产品/架构：以[对话工作台架构](conversational-creative-workbench.md)的 2026-11-11 当前覆盖层及本文 §3.7 为准；§14.5 和 E-4 记录继续保留其历史范围。
- 审计历史：[Agent 缺口报告](../audit-v2/agent_gap_report.md) §7。
- 运行时：[Agent Runtime](../agent-runtime.md) 第 13 节；[双模型历史设计](dual-model-creative-runtime.md)不授权恢复桌面双宿主。

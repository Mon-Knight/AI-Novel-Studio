# Writing SubAgent 契约（candidate-only，设计稿）

> 状态：v3.7.0 起正式开放——桌面端 + 真实 API 模型的 `chapter_write` 默认走本契约；mock / 本地模型与浏览器模式走确定性 Writer，`localStorage['ai_novel_studio_writing_subagent_dsh']='0'` 可关闭。对应审计 `docs/audit-v2/agent_gap_report.md` GAP-01 / GAP-09，Gate E。
> 本文只定义契约与分步接入方案，不宣称 Writing SubAgent 已成立；真实模型验收（含云端）在本轮明确不执行。

---

## 1. 现状（v3.6.2）

- `taskSessionAdapter.startTurn` 用 `classifyTaskIntent(goal)` 正则分类；`chapter_write` 意图直接进入 `taskRuntimeAdapter` → `workbenchChapterWriter`，即**确定性 Writer 编排**：编译上下文（`generationContextCompiler`）→ 单次 Provider 生成 → 字数修复（`resolveChapterWordRange`）→ 完整性修复（`inspectChapterCandidateIntegrity`）→ 形成 `chapter_text` 候选。模型不做工具选择。
- DSH 运行时（`src-tauri/src/services/dsh/task_runtime.rs`）已经具备候选工具协议：`generate_chapter / polish_chapter` 返回 `chapter_text` 时，宿主校验 `candidateOnly=true`、`novelId/chapterId` 归属、`expectedArtifactType`，并落为 `ResultArtifact`。但 `workbench_task_instruction` 没有 `chapter_write` 任务类型（未知类型 → “停止且不调用候选工具”），也没有字数与完整性的宿主校验。
- 章节采用链路不变：候选 → 用户确认 → `ReviewAuthorization` → 人工审阅/编辑 → 单一 Rust/SQLite 事务采用。**任何 SubAgent 都不写正式正文。**

## 2. 契约定义

契约代码：`src/services/agents/writingSubAgentContract.ts`（`WRITING_SUBAGENT_CONTRACT_VERSION = 'writing_subagent_contract_v1_draft'`）。

| 维度     | 契约                                                                                                                                                                                                                         | 与现状的关系                                  |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| 身份     | `agentId = writing-subagent`，独立于 Main Agent 会话；`runId` 仍归属任务对话，产物卡片、运行日志与现有 UI 复用                                                                                                               | GAP-09：不再复用 Main Agent 身份              |
| 模式     | `mode = candidate_only`，唯一产物 `chapter_text`，`expectedTool ∈ {generate_chapter, polish_chapter}`                                                                                                                        | 与 `ReviewAuthorization` 采用链路衔接         |
| 工具面   | `allowedTools = requiredReadTools ∪ {expectedTool}`；只读工具固定为 `novel.read_context / chapter.read_outline / get_character_states / search_memory`（legacy 名，与现有候选回合一致；Canonical 名迁移后同步替换）          | 绝不包含其他 `generate_*`、`save/adopt/write` |
| 模型     | 独立 `TaskModelSnapshot`：默认复用任务快照，允许用户为写作单独选择模型（后续 UI）；`runtimeMode=mock` 时全程确定性                                                                                                           | GAP-09 独立模型配置                           |
| 预算     | `maxCandidateAttempts=3`（复用 DSH `MAX_CANDIDATE_TOOL_ATTEMPTS`）、`maxLengthRepairs=2`、`maxIntegrityRepairs=2`、`maxWallClockMs=8 min`、`maxOutputTokens` 由字数区间推导                                                  | 与 Writer 现有修复轮次一致                    |
| 字数     | `wordRange = resolveChapterWordRange(targetWordCount)`，写入宿主指令并作为验收条件                                                                                                                                           | 复用 Writer 规则                              |
| 连续性   | `continuity.previousChapterId / sourceHash`：紧邻前章采用稿由只读工具读取，宿主指令要求衔接                                                                                                                                  | 复用 `findPreviousChapterForContinuity`       |
| 取消     | `dsh cancel(conversationId)`，Worker 级取消；UI 与现有停止按钮一致                                                                                                                                                           | 已有                                          |
| 错误责任 | 协议错误（未读必需上下文、未调用候选工具、越权工具）由宿主返回稳定错误码并在预算内自动重试；模型内容错误（字数、完整性）由宿主校验后以 `DSH_CHAPTER_CANDIDATE_REJECTED:<code>` 要求模型修正；预算耗尽 → 运行失败，不产生候选 | 失败关闭                                      |
| 证据     | 只留存工具名、计数、状态码、内容 hash、字数、修复轮次、模型身份；不保存提示词、正文与凭据                                                                                                                                    | 与 R4 证据口径一致                            |

契约由 `planWritingSubAgentTurn()` 纯函数生成，并由 `assertWritingSubAgentContract()` 复验以下不变式（有单测）：

1. `expectedArtifactType === 'chapter_text'` 且必须绑定 `chapterId`；
2. `allowedTools` 恰好等于只读工具 + 一个候选工具，不含任何其他 `generate_*`；
3. `mode === 'candidate_only'`、`formalWrites === 'forbidden'`、`adoptionPath === 'review_authorization'`；
4. 预算为正整数且不超过上限。

## 3. 分步接入

| 步骤 | 内容                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | 验证                                                                                                                        | 状态                        |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| E-0  | 契约类型、规划器、不变式断言、特性开关 `ai_novel_studio_writing_subagent_dsh`（E-0～E-4 期间默认关闭；v3.7.0 起桌面端 + API 模型默认开启，`0` 关闭 / `1` 强制开启）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | `writingSubAgentContract.test.ts`                                                                                           | 完成                        |
| E-1  | Rust 新增任务类型 `chapter_write`（→ `generate_chapter`）与 `chapter_polish`（→ `polish_chapter`）：`expected_contract_for_task_kind` 绑定唯一候选工具与 `chapter_text`；必须绑定章节；`turn_allowed_tools` 只暴露四个只读工具 + 该候选工具（`CHAPTER_WRITE_ALLOWED_TOOLS / CHAPTER_POLISH_ALLOWED_TOOLS`）；`workbench_task_instruction` 写入正文写作/润色要求与宿主字数区间；`StartTaskTurnInput.chapter_word_range` 只允许章节写作任务携带且需 `minimum ≤ target ≤ maximum`；候选落库前 `validate_chapter_candidate_length` 用与 `draft_service::word_count` 同源的统计校验，越界返回 `DSH_CHAPTER_CANDIDATE_LENGTH_REJECTED`（本轮不进入自动协议恢复，该恢复仍只服务章节总结） | `task_runtime_tests.rs` 3 项（契约/allowlist/提示词、负例、字数边界）                                                       | 完成                        |
| E-2  | TS 侧完整性复核：DSH 回合返回 `chapter_text` 产物后，读取候选正文与紧邻前章采用稿，运行 `inspectChapterCandidateIntegrity`；存在 `error` 级问题时追加一条助手回合列出问题码并建议「要求修改」，候选本身不修改、不删除。按预算自动发起修正回合留待下一步                                                                                                                                                                                                                                                                                                                                                                                                                            | `taskSessionAdapter.test.ts`                                                                                                | 完成（advisory）            |
| E-3  | `taskSessionAdapter.startTurn`：仅当桌面端 + 开关开启 + 已绑定章节时，`chapter_write` 意图经 `planWritingSubAgentTurn → toDshTaskStartContract → dshTaskRuntimeService.start`（润色意图映射 `chapter_polish`，字数区间取章节 `targetWordCount`）；其余一律维持确定性 Writer                                                                                                                                                                                                                                                                                                                                                                                                        | `taskSessionAdapter.test.ts`：开关关闭零变化、开启时 allowlist 收窄、未绑定章节回退 Writer                                  | 完成                        |
| E-4a | 真实模型正向验收：用客户端已配置的模型卡片，在生产 EXE + 操作者真实配置（DPAPI 保管库解密凭据，密钥不出应用）上跑一次 `chapter_write`；判据见 §3.1                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | `npm run test:real-profile:writing-subagent`（`tests/real-acceptance/writing-subagent-real-profile.spec.ts`，opt-in）       | 完成（2026-09-08，见 §3.1） |
| E-4b | 负例与恢复（故障注入）：越权工具、跨书候选、上游瞬时/持续失败、字数越界候选、进程被杀后的重启恢复，全部经生产 EXE + 隔离配置 + 回环脚本上游跑通；判据与发现见 §3.2                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | `npm run test:fault-injection:writing-subagent`（`tests/real-acceptance/writing-subagent-fault-injection.spec.ts`，opt-in） | 完成（2026-09-08，见 §3.2） |

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

## 4. 非目标

- 不实现自动采用、批量写作或多章连写；
- 不改变 `ReviewAuthorization + adopt_review_authorized_draft` 的采用事务；
- 不新增数据库 migration；
- 不把确定性 Writer 删除：它仍是 mock / 本地模型、浏览器模式与显式关闭开关时的生产路径，也是 SubAgent 不可用时的回退。

## 5. 与其他文档的关系

- 产品/架构基线：`conversational-creative-workbench.md` §11、§14.5（“Writing SubAgent 与 `chapter_write` 走 DSH 继续后置”仍成立，本文是其设计前置）。
- 审计：`docs/audit-v2/agent_gap_report.md` §7 处理记录。
- 运行时：`agent-runtime.md`、`dual-model-creative-runtime.md`。

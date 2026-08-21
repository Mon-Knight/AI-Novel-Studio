# DeepSeek Harness 固定源码复用映射

> Phase 0 证据快照：2026-08-21（Asia/Shanghai）  
> ANS 基线：`babf9c7497ad187bc8ac8c1714c13a3d1414fb1f`，分支 `codex/v3.3.0-conversational-workbench`  
> DSH 固定提交：`47f943859bef60e4160492346772ded9b24f765a`  
> 固定只读 checkout：`F:\dsh-v320-clean`

## 1. 审计边界与结论

本映射以 `F:\dsh-v320-clean` 的实际源码为依据。审计时该 checkout 的 `HEAD` 为固定提交，`git status --porcelain` 为空；`F:\deepseek-harness-source-analysis-20260820` 只作为历史参考快照，不作为实现载体或版本依据。

当前 ANS 桌面路径通过 `dsh_start_task_turn` 启动真实 DSH JSON-RPC child，工作目录为 `{data_dir}/dsh-task-workers/{hash}`，存活 child 在 idle 后保留；`ans-task-server-template.mjs` 对 JSONL 调用公开 `ctx.agents.create/resume` 和 `agent.followup`。`start_path_followup_reuses_session_and_resumes_after_child_exit` 证明同一 conversation 第二回合 `lifecycle=continued`、进程退出后第三回合 `lifecycle=resumed`。`start_path_two_conversations_cancel_one_without_stopping_the_other` 证明两个真实 start() Worker 并发，取消 A 后 B 仍可完成。

`describe_runtime` 不再把 VERSION_MATRIX 文件存在写成 `loaded`；`loaded` 只来自 runtime/health。无任务时的插件健康由显式 probe Worker 提供，工作台打开“当前插件”时才启动，不会在启动路径静默探测。浏览器 `taskRuntimeAdapter` 仍是显式 fallback。

Agent Loop、Session、Tools、inbox/cancel、Profile/Bundle 和 Compaction 必须继续复用下列公开机制，不得在 React、Rust 或 TypeScript Adapter 中复制另一套私有 driver。

状态约定：

- `已有`：当前 ANS 已有与固定源码语义一致的薄适配；
- `部分`：已有真实接线，但还缺目标语义或动态证明；
- `P0 缺口`：Phase 1 完成前必须修复；
- `后续阶段`：任务书明确不属于 v3.3.0。

## 2. 逐项源码映射

| ANS 需求 | 固定提交源码路径 / 符号 | 直接复用的公开 API 或事件语义 | 当前 ANS Adapter | 当前状态、必要差异与原因 | 动态证据 / 缺口 |
| --- | --- | --- | --- | --- | --- |
| 多轮 Agent Loop 与 Turn/Step | `packages/core/agent-loop/src/agent.ts`：`ReactLoopAgent.turn()`、`step()`；`packages/core/agent-loop/src/index.ts`：`AgentLoop.createAgent()`、`resume()`、`create()`；`packages/core/agent/src/index.ts`、`runtime-types.ts` | `ctx.agents.create(...)` / `ctx.agents.resume(...)` 返回公开 Agent handle；由 Harness 生成 `turn/start`、`step/start`、`step/end`、`turn/end` | `src-tauri/src/services/dsh/task_runtime.rs`、`supervisor.rs`；`src/services/dsh/taskSessionAdapter.ts` | `部分 / P0 缺口`。当前确实调用 SDK server，但每个 run 新建进程和临时 Session 根，只发一次 prompt 后 shutdown；未调用 `ctx.agents.resume`，不得把稳定字符串 id 当成历史恢复 | 固定源码带有 `packages/core/agent-loop/tests/loop.spec.ts`、`resume.spec.ts`。ANS 的 `scenario_a_normal_lifecycle` 只证明单次生命周期；必须补同一任务第二回合继承首回合历史、进程重启后公开 resume 的动态测试 |
| follow-up、steer、inject、cancel、idle | `packages/core/agent-loop/src/agent.ts`：`followup()`、`steer()`、`inject()`、`cancel()`、`whenIdle()`；`packages/core/agent/src/inbox.ts`；`dispatch.ts` | `followup` 写入 next-turn 并 wake；`steer` 写入 next-step 并 wake；`inject` 写入 next-step 但不 wake；`cancel(cause, options)` 使用 Harness 取消语义；`whenIdle()` 等待活动收敛；`agent/inbox/spliced` 是 append-only replay 事实 | `task_runtime.rs::start/cancel/status`、`supervisor.rs::RuntimeHandle` | `P0 缺口`。当前后续消息会启动新 Worker；取消是杀掉整个 child/Job Object，不是公开 `Agent.cancel`。进程树清理可以作为 ANS 隔离层保留，但不能替代 Session 内 inbox/cancel 语义 | 固定源码带有 `agent-loop/tests/cancel.spec.ts`、`agent/tests/consumed-work.spec.ts`。必须证明同一 Session 的 follow-up、运行中 steer/inject（若产品使用）、取消后的 `turn/end.reason=aborted`、未派发工具的 skipped result，以及取消任务 A 不影响任务 B |
| Session 事实、重放与崩溃修复 | `packages/core/session/src/index.ts`：`Session.append()`、`events`、`deriveMessages()`、`session/event`、`session/flush`；`types.ts`：`SessionEventMap`；`surface.ts`：`deriveEventMessage()`；`packages/session/session-persistence-jsonl/src/index.ts`：`prepare()`、`load()`、`inspect()`、`readFrom()` | append-only Session Event；surface 使用 append / replace 语义；持久层一个 Session 只有一个 live writer；load 时按公开修复语义关闭 crash-orphaned turn；读取存储前应 flush | `supervisor.rs` 的 observer；`task_runtime.rs::project_session_event`；`conversation_repository.rs`；migrations 032–035 | `部分 / P0 缺口`。observer 先写 SQLite，成功后才折叠内存 snapshot，方向正确；但 Session 根位于 `%TEMP%\ans-task-<worker>\sessions`，下一 run 不复用，SQLite 投影也不能反向伪造 Harness history | 固定源码带有 `session/tests/session.spec.ts`、`repair.spec.ts`、`surface.spec.ts` 和 `session-persistence-jsonl/tests/jsonl.spec.ts`、`win32.spec.ts`。必须补固定 persistence root 的 kill/restart/resume、修复后继续、重复事件幂等、SQLite 投影与 DSH log 一致性测试 |
| 工具注册、allowlist 与调度 | `packages/core/tools/src/index.ts`：`ToolRuntime.register()`、`restrict()`、`schemas()` 及 `tools/pre-execute → tools/execute → tools/post-execute → tools/result`；`schema.ts`：`defineTool()`；`packages/core/agent-loop/src/tool-calls.ts`：`executeToolCalls()` | 模型决定工具和顺序；工具按 scope 注册并通过 allow/deny 限制；parallel/exclusive 只影响 dispatch，结果按模型顺序提交；取消前未派发调用生成 `ABORTED_BEFORE_DISPATCH` skipped result | `src-tauri/gateway/src/tools.rs`、`gateway/src/main.rs`；`scripts/dsh/cordis-template.yml`；`task_runtime.rs`；`src/services/agent-tools/productionToolRegistry.ts` | `部分`。桌面路径通过 DSH Tool Pipeline 调用四个小说工具，并在 observer 再验证 allowlist；这是允许的 ANS 小说领域 Adapter。浏览器 `taskRuntimeAdapter.ts` 仍硬编码固定 steps，只能是显式开发 fallback，不能作为桌面成功证据 | 固定源码带有 `agent-loop/tests/tool-calls.spec.ts`、`tool-order.spec.ts` 和 `tools/tests/scoped.spec.ts`、`execution-mode.spec.ts`。ANS 必须补四工具任意顺序、可跳过工具、工具错误、并行/独占、取消未派发以及未知工具拒绝的真实 Worker 测试 |
| 任务级模型快照与 Provider/Model directory | `packages/core/agent/src/model-selection.ts`：`installModelSelection()`；`packages/llm/llm/src/index.ts`：`registerAdapter()`、`listProviders()`、`listModels()`、`resolveModelInfo()` | 模型选择在每个 step 的 prompt assembly 时捕获；Provider/Model 可用性来自 LLM Runtime，不由 UI 猜测 | `src/services/conversation/taskModelSnapshot.ts`；`task_runtime.rs` 的 `initialize`；`currentPluginService.ts` | `部分 / P0 缺口`。`task_runs.model_snapshot_json` 能冻结 ANS run 输入，`initialize` 也传递 provider/model/maxTokens；但当前 UI 模型投影主要来自单一 AI settings，未读取真实 DSH Provider/Model directory，也未动态证明两个 Worker 的模型隔离 | 固定源码带有 `core/agent/tests/model-selection.spec.ts`。必须补模型快照不可变、两个并发任务不同模型、模型不可用显式失败、Provider/Model roster 与实际 runtime 一致的测试 |
| Profile、Bundle、Cordis composition 与插件健康 | `docs/architecture.md`；`packages/bundle/headless/cordis.patch.yml`、`src/index.ts`；`packages/preset/agent-presets/src/index.ts`：`AgentPresets.list()`、`resolve()`、`mount()`、`composeFrom()`、`composedPreset()`、`standingKeyFor()` | Profile 由有序 Bundle/patch 层组成，运行树是 Cordis composition；官方 runner 在创建 Agent 前 `await ctx.get('loader')?.await()`；preset discovery 的 `broken` 只是形状检查，真实 mount 仍可能失败 | `scripts/dsh/cordis-template.yml`；`src-tauri/src/services/dsh/config.rs`、`task_runtime.rs::describe_runtime`；`src/services/conversation/currentPluginService.ts` | `P0 缺口`。功能项来自 production Tool Registry 是真实来源；模型仍是单一卡片；Rust 当前插件命令只投影一个合成 runtime 项，未枚举实际 composition、Loader settle、preset mount 和 Provider health | 固定源码带有 `agent-presets/tests/discovery.spec.ts`、`mount.spec.ts`、`session.spec.ts` 和 `sdk/server/tests/plugin-apply.spec.ts`。必须补载体缺失、commit 不符、Loader/mount 失败、模型不可用和正常 composition 的只读投影测试 |
| SDK JSON-RPC 边界 | `packages/sdk/server/src/server.ts`：`HarnessSdkJsonRpcServer`、`getOrCreateSession()`、`createSession()`；`packages/sdk/protocol/src/types.ts` | server 将 `session/event` 立即转发为 `session.event`，将 `agent/status` 转发为 `session.status`；公开请求只有 `initialize`、`session/prompt`、`shutdown`；同一进程内 `session/prompt` 会对保留 handle 调 `agent.followup()` | `src-tauri/src/services/dsh/supervisor.rs`、`task_runtime.rs` | `P0 缺口`。当前 wire 没有 resume 或 cancel 方法，且 `createSession()` 调的是 `ctx.agents.create()` 而非 `resume()`。可以在同一长存 server process 内复用 handle；若进程重启，则需固定载体内的薄 Adapter 调公开 `ctx.agents.resume`，不得复制 AgentLoop driver | 固定源码带有 `sdk/server/tests/server.spec.ts`、`built-scope-carrier.e2e.ts`。ANS 必须补协议未知方法、同进程多 prompt、重启 resume、task-scoped cancel、child 异常 EOF 和 shutdown 的动态测试 |
| Compaction capability seam | `packages/compaction/compaction/src/index.ts`：`CompactionEngine.compactIfNeeded()`、`compactNow()`、`compactRegion()`；`packages/compaction/compaction-basic/src/index.ts`：`BasicCompactionEngine` | 基础实现挂接 `agent/pre-step`、`agent/request-error`、`session/event`，通过 surface replace 产生可重放压缩事实 | 当前无 v3.3.0 应用实现 | `后续阶段`。Phase 3 的小说上下文压缩必须作为独立 ANS Provider 接入公开 capability seam；v3.3.0 不得提前实现，也不得改写 Agent Loop | 固定源码带有 `compaction-basic/tests/compaction-basic.spec.ts`、`compaction-loop-repro.spec.ts`、`manual-compaction.spec.ts`。Phase 3 再增加候选、确认、应用、回滚和重启重放测试 |
| ResultArtifact、小说事实与 Safe Apply | DSH 不拥有 ANS 小说领域事实；其边界只提供工具结果和 Session 事件 | DSH 普通 assistant 文本和 Session log 都不是正式小说事实；小说工具只返回候选；正式写入必须进入 ANS ResultArtifact / Apply 管线 | `task_runtime.rs::read_generated_chapter_result/create_artifact_projection`；`artifact_service.rs`；`conversation_repository.rs`；`placement_service.rs`；migrations 010、012–014、034 | `已有 / 后续阶段`。桌面 `generate_chapter` 结果先落校验过的大文本，再创建 AI Task → Attempt → ResultArtifact，卡片仅引用 `artifactId`；这是 DSH 不拥有的必要差异。对话确认和章节 Safe Apply 属于 Phase 2，v3.3.0 不实现 | 已有 artifact、placement、backup 的 Rust 单测；仍需真实 DSH 成功链证明 assistant 文本不会生成 Artifact、卡片无第二正文、错误结果不生成 Artifact。Phase 2 再验收确认/冲突/回滚 |
| 全局 AI 请求治理 | `packages/llm/llm/src/index.ts` 定义实际 Provider adapter 调用边界；DSH 本身不拥有 ANS 全局预算账本 | ANS 可以在 Provider wire 外包一层治理，但不得绕过 Harness 模型选择和请求流程，也不能把凭据写入 Session/SQLite | migration 029；`ai_request_policy_service.rs`；`services/dsh/governed_proxy.rs`；`scripts/dsh/model-proxy.mjs` | `部分`。当前 `/reserve → verify_provider_dispatch → upstream → /settle` 接到 DSH proxy，失败或缺 usage 保守结算；这是 ANS 全局政策所需的薄边界差异 | 现有 policy service 单测覆盖 single-dispatch、TTL 回收和保守结算；必须补真实 Worker 的并发限流、取消/崩溃 outstanding lease 终结、代理失败和无 usage 响应测试 |

## 3. 官方 one-shot 与目标持续 Worker

### 3.1 官方 headless 的精确语义

`packages/bundle/headless/src/index.ts` 是严格 one-shot direct driver：

1. 等待 Loader settle；
2. 读取默认模型选择；
3. 通过 `agents.create(...)` 创建一个新的随机 Session；
4. 等待初始 idle；
5. `agent.followup(...)` 提交一个普通用户消息；
6. 等待 `agent.whenIdle()`；
7. `sessions.flush(agent.session)`；
8. 汇总该区间最后一条非空 assistant 文本与 `turn/end`；
9. 输出文本并请求进程退出。

`packages/bundle/headless/README.md` 明确写明 “One submitted task only”。这套 runner 可复用无 Web Server 的组合、Loader settlement、Agent 创建、模型选择、idle 和 flush 做法，但不能直接包装成多轮任务工作台。

### 3.2 当前 ANS 路径

当前 `task_runtime.rs` 每次 `start(...)`：

1. 生成新的 `runId` 和 `worker-<uuid>`；
2. 保持 `session-<conversationId>` 字符串稳定；
3. 在 `%TEMP%\ans-task-<workerId>` 创建 `cordis.yml`、`home` 和 `sessions`；
4. 启动一个 JSON-RPC server child，并放入 Windows kill-on-close Job Object；
5. 请求一次 `initialize`；
6. 请求一次 `session/prompt`；
7. 等待 `session.status=idle`，读取 observer snapshot；
8. 收敛 SQLite 工具事实、可选创建 ResultArtifact；
9. `shutdown_and_wait` 后删除活动 Worker 记录。

这条路径是真实 DSH 调用，但仍是“一次 run 一个临时 Worker”。下一回合既没有旧 process-local Agent handle，也没有固定 JSONL root 上的 `ctx.agents.resume`。`scenario_c_midstream_kill_restart_resume` 使用相同 Session 字符串重启后再次 prompt，但测试代码仍是新 server + `session/prompt`；它没有断言恢复后的 `deriveMessages()` 包含首进程历史，不能作为公开 resume 的证明。

### 3.3 合规实现选择

Phase 1 可以在固定提交载体上选择以下薄适配方式之一，并用动态测试证明：

- 一个任务一个长存 SDK server/Agent handle；后续消息继续调用同一进程的 `session/prompt`，由 server 内部 `agent.followup()` 驱动；进程退出前必须显式 flush；
- Worker 崩溃或应用重启时，在固定 `session_root` 上由载体内薄 Adapter 调用公开 `ctx.agents.resume(...)`，再把后续消息交给返回的 Agent handle；
- 如需 wire-level cancel/resume，可为 ANS 载体增加窄 JSON-RPC 方法，但方法内部必须委托公开 Agent/Session API，不能复制 `ReactLoopAgent`、tool scheduler 或 JSONL replay driver。

无论选择哪一种，ANS SQLite 只保存 UI/领域投影；它不能反向拼接消息冒充 Harness Session history。

## 4. Session 与工具事件字段映射

DSH `SessionEvent` envelope 为 `{ type, seq, time, data, ...surface metadata }`，其中 `seq` 在单 Session 内单调递增，`time` 是 epoch milliseconds。

| DSH 事件 / 通知 | 固定源码字段 | 当前 ANS 投影 | 必须保持的约束 / 缺口 |
| --- | --- | --- | --- |
| `session.event` | `{ sessionId, event }` | `supervisor.rs` 先调用 observer 持久化，成功后才更新内存 snapshot | observer 失败必须让 run 失败，不能只保留内存成功状态；重放时按 `(sessionId, seq)` 或等价稳定身份幂等 |
| `session.status` | `{ sessionId, status: idle | running }` | 用于 `wait_idle_checked` 和每 Session snapshot | 仅表示 live Agent 状态，不代表 SQLite run 已完成；必须先检查工具终态和 observer error |
| `turn/start` | `data={ turn }` | 当前被忽略 | 可作为 run/turn 诊断投影，但不得自建第二状态机 |
| `turn/end` | `data={ turn, reason }`；reason 可为 completed、aborted、blocked、error、max-tokens、interrupted | 当前错误 reason 会写通用工具/运行错误事实 | 必须把 cancelled、interrupted、error 区分为稳定终态；崩溃恢复需保留 DSH 修复后的 interrupted 事实 |
| `step/start` / `step/end` | `data={ turn, step }` | 当前被忽略 | UI 可不展示全部 step，但测试必须从原始事件证明工具属于真实 Turn/Step |
| `user/message` | `data=UserMessage` | ANS 已持久化用户 turn，DSH 对应事件当前不重复写入 | 必须建立稳定关联，避免同一用户消息重复成两条 UI turn；ANS 用户事实不能替代 Harness replay |
| `assistant/chunk` | `{ turn, step, chunk }` | 当前不持久化 | 可仅用于实时流，不应把 chunk 当最终 Artifact 或最终 assistant message |
| `assistant/message` | `{ turn, step, message, usage? }` | 以稳定投影 id 写 `conversation_turns`；usage 汇总进 snapshot | 只作为对话文本；不得从该文本解析或创建 ResultArtifact |
| `tool/call` | `data={ turn, step, callId, name, arguments }`，arguments 是模型原始 JSON 字符串 | migration 035 增加 `tool_call_events.call_id`；observer 用 `(runId, callId)` 查重并保存参数长度/哈希 | `callId` 是 call/result 关联身份，不得用数组位置猜测；参数正文/凭据不得进入摘要列 |
| `tool/result` | `data.message.source.callId`；模型内容位于 `data.message.content[0].content` 的 content blocks；可带 `data.error={name,code}` | 查找对应 call，正文先写校验过的大文本，SQLite 事件只存引用、长度、哈希和错误摘要 | 未找到 call、哈希不符、结构错误必须失败；error/skipped/cancelled 都必须终态；普通文本结果不能越权成为小说 Artifact |
| `agent/inbox/spliced` | append-only inbox projection | 当前忽略 | 目标多轮/取消测试必须证明 DSH 自身 inbox 语义，而不是 Rust 自制队列 |
| `request/header` | `{ header, reason }`，header 含实际 config/system/tools | 当前 run 只保存 ANS `model_snapshot_json`，事件被忽略 | 需在测试中对照实际 provider/model/tool schemas，证明快照与真实请求一致；不保存密钥 |
| `request/context` | Provider/Model route 与容量元数据 | 当前忽略 | 当前插件和模型投影应使用真实 LLM runtime directory/健康结果，不从此事件推断长期领域对象 |

## 5. Profile、Bundle 与插件投影边界

固定源码的插件概念不是 React 卡片数组：

- Profile 选择有序 Bundle 与 patch 层；
- Bundle/patch 最终挂载成 Cordis runtime tree；
- Loader settle 只能证明加载尝试已经收敛，不能把未挂载项标成 loaded；
- `AgentPresets.list()` / `resolve()` 提供 roster 与发现错误，`mount()` 才能证明 composition 实际可用；
- `LlmRuntime.listProviders()` / `listModels()` / `resolveModelInfo()` 才是 Provider/Model 可用性来源；
- Tool Registry 的 scoped view 才是当前 Agent 真正可调用的工具集合。

ANS 的长期领域对象只能保存稳定 projection，例如 plugin id、名称、版本、状态、能力和错误摘要；Cordis Context、Scope、Service 或 DSH 内部类型不得进入 React props、SQLite schema 或备份格式。

当前 `currentPluginService.ts` 中：

- 功能插件来自 `productionToolRegistry.getManifest()`，来源基本正确；
- 模型插件仍由单一 AI settings 与 runtime 状态组合，未投影完整 Provider/Model directory；
- “其他插件”通常只得到 Rust 返回的一个合成 `ANS DSH Adapter` 项，未证明具体 Cordis composition、Loader settlement 或 mount health。

因此只读 UI 形式已有，但 P0-3 的真实性门禁仍未通过。

## 6. ANS 允许拥有的必要差异

下列能力不属于 DSH，应留在 ANS Adapter / 领域层：

- Novel、Volume、Chapter、Draft、World Setting 等小说正式事实；
- AI Task、Attempt、Input/Context/Constraint Snapshot 与 ResultArtifact；
- Conversation/Run/Tool/Card 的 SQLite UI 投影；
- Safe Apply、显式确认、冲突检测、事务回滚和采用；
- 全局 AI 请求预算、并发、费用与保守结算账本；
- 项目备份、恢复、ID remap 和大文本完整性；
- Windows 每任务进程隔离、Job Object 清理和本地凭据边界。

这些差异必须消费 DSH 的公开输出，不得接管其 Agent Loop、Session replay 或 Tool Pipeline。Windows Job Object 可以保证进程树清理，但任务取消仍应在可能时先调用公开 `Agent.cancel` 并等待工具/turn 终态；强杀只作为超时或崩溃兜底。

## 7. 禁止复制或替代的 DSH 机制

后续实现不得：

1. 在 `taskRuntimeAdapter.ts`、Rust supervisor 或 React 中重写 Turn/Step 循环；
2. 用 SQLite conversation turns 拼出 prompt，声称等价于 `Session.deriveMessages()` / resume；
3. 固定调用四个工具并把顺序称为 DSH 自主 Tool Calling；
4. 自行实现 parallel/exclusive 调度、ordered commit 或取消 skipped result；
5. 用进程 kill 作为唯一 `Agent.cancel` 语义；
6. 用 `isTauri()`、固定数组或 payload 文件存在性冒充实际插件 loaded；
7. 把普通 assistant message、chunk 或 DSH Session log 当 ResultArtifact / 小说事实；
8. 在 Phase 3 之前自制上下文压缩，或绕开 `CompactionEngine` surface replace；
9. 复制 `ReactLoopAgent`、SDK server 私有 session map、JSONL writer 或包内私有 driver 到 ANS；
10. 因 SDK wire 暂无 resume/cancel 就绕开公开 Core API；应增加窄载体 Adapter，并保留固定源码引用和动态测试。

## 8. 测试证据与 Phase 1 必补矩阵

固定 checkout 自带的相关测试文件只证明上游仓库定义了这些机制；本轮 Phase 0 未重新运行 DSH 全仓测试，不能把文件存在写成 ANS 已通过。

| 能力 | 固定源码随附测试 | 当前 ANS 证据 | Phase 1 必补 |
| --- | --- | --- | --- |
| Loop / resume / cancel | `agent-loop/tests/loop.spec.ts`、`resume.spec.ts`、`cancel.spec.ts` | `src-tauri/src/services/dsh/tests.rs` 的单 run 与 kill/restart 场景 | 同一 Session 第二回合历史、公开 resume、cancel reason、inbox 收敛 |
| Tool Pipeline | `tool-calls.spec.ts`、`tool-order.spec.ts`、`tools/tests/scoped.spec.ts` | gateway 与 observer 源码；尚无 Task Runtime 真实四工具成功矩阵 | 任意顺序/跳过/失败/并行/取消/未知工具，全部来自真实 DSH event |
| Session / JSONL | `session/tests/repair.spec.ts`、`surface.spec.ts`、`session-persistence-jsonl/tests/jsonl.spec.ts`、`win32.spec.ts` | observer 先持久化后折叠；每 run 临时 root | 固定 root、单 writer、flush、crash repair、重放幂等、历史一致性 |
| Model | `agent/tests/model-selection.spec.ts` | run model snapshot + initialize 参数 | 两 Worker 不同模型、不可用模型失败、request/header 对照 |
| Composition / plugin | `agent-presets/tests/discovery.spec.ts`、`mount.spec.ts`、`sdk/server/tests/plugin-apply.spec.ts` | 只读插件 UI 与合成 runtime item | 正常/缺失/commit mismatch/Loader failure/mount failure/Provider failure 投影 |
| ResultArtifact | DSH 不拥有 | `artifact_service.rs`、migration/repository tests、backup graph round-trip | 真实 `generate_chapter` 成功链；assistant-only / invalid / hash mismatch 不生成 Artifact |
| 并发与隔离 | DSH 单包测试不能替代 ANS 进程隔离 | ActiveWorker map 与 Windows Job Object 源码 | 两真实 Worker 同时运行；取消/崩溃一个，另一个继续；每个 run/tool 都收敛终态 |
| 桌面 E2E | 不适用 | `tests/e2e/conversational-workbench.spec.ts` 当前主要覆盖路由、只读 UI 和明确失败/重试/重启后失败事实 | Mock Provider + 固定载体下的两个成功 Worker、四工具、ResultArtifact、取消隔离、崩溃恢复、无静默 fallback |

只有这些动态证据通过后，才能把表中对应项从 `部分/P0 缺口` 更新为 `已有`；source map 本身不能替代测试。

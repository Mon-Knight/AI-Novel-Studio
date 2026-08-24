# Phase 1A-B：真实 Main Agent Runtime 验证方案（后置设计稿）

> 当前不执行本设计稿。Phase 1A-A 必须先完成能力资产化、首批 Domain facade 和 canonical manifest 准入；本文件只保留后续 Runtime 验证所需的证据设计。

> 本文是验证设计与现状证据，不代表 Phase 1A 已通过。验证必须使用显式真实 Provider profile；默认 Mock E2E 不变。

## 现状判定

当前已经存在两条不同的 Workbench 执行路径：

```text
Workbench 自然语言任务
  ├─ 问候/能力询问 → 本地固定回复（不启动 Agent）
  ├─ chapter_write → TypeScript taskRuntimeAdapter（固定步骤，浏览器 fallback/ANS writer）
  └─ 其他候选任务（桌面） → Tauri dsh_start_task_turn
                         → 每会话 DSH Worker
                         → DSH Agent Loop + MCP Novel Gateway
                         → DeepSeek/OpenAI-compatible upstream
```

证据：`src/services/dsh/taskSessionAdapter.ts` 对 `classifyTaskIntent(goal) === 'chapter_write'` 明确转入 `taskRuntimeAdapter`；只有非 chapter_write 的桌面任务才调用 `dshTaskRuntimeService.start`。因此现有 `agent-production-closed-loop.spec.ts` 的章节生成闭环不能证明 Main Agent 真实模型决策。

`src-tauri/src/services/dsh/task_runtime.rs` 的固定 DSH allowlist 是：

```text
novel.read_context
chapter.read_outline
search_memory
generate_chapter
generate_outline
generate_characters
suggest_events
expand_settings
polish_chapter
check_quality
summarize_chapter
```

DSH 的 Novel Gateway 以只读 SQLite 打开数据库；`generate_*` 族是 candidate-only 验证 sink，不写入正式正文。`ResultArtifact` 和对话卡片由 Rust projection 创建，正式采用仍需用户审阅授权。

## Phase 1A 的最小验证边界

Phase 1A 只验证真实 Main Agent 的“理解 → 自主选择已注册 Tool → 收敛工具结果”能力，不验证 Writing SubAgent，也不宣称章节正文已经由 DSH 生成。建议先选非 `chapter_write` 的结构化候选任务，例如：

```text
用户：为当前作品生成一份大纲候选
```

期望由真实模型自主决定（顺序不写死）：

```text
novel.read_context (可选)
→ chapter.read_outline / search_memory (按模型判断，可选)
→ generate_outline(candidateText=非空)
→ assistant/message 或候选卡片终态
```

第二个最小场景用于错误恢复：

```text
用户：没有绑定章节时生成章节正文
```

应得到明确的 scope/target 错误，运行进入 `failed` 或安全等待态；不得调用未授权工具、不得创建 ResultArtifact、不得写入 `chapter_drafts`。

`继续当前剧情` → `read_current_context` → `invoke_writing_agent` → `adopt_artifact` 暂不能作为 Phase 1A 通过标准：当前 canonical Registry 没有 `invoke_writing_agent`/`adopt_artifact`，且 `chapter_write` 路由绕过 DSH。该链路应留到 Phase 1B/Workbench writer 接入任务。

## 真实模型 profile

新增测试必须显式 opt-in，例如：

```powershell
$env:DSH_E2E_RUNTIME_ROOT = '...\\.payload-staging\\dsh-runtime'
$env:DSH_GATEWAY_BIN = '...\\novel-domain-gateway.exe'
$env:DSH_E2E_BASE_URL = 'https://api.deepseek.com'       # 云端真实 Provider
$env:DSH_E2E_MODEL = 'deepseek-v4-flash'
$env:DSH_E2E_API_KEY = '<process-only>'
npm run test:agent-runtime:real
```

本地 OpenAI-compatible 服务只允许 loopback URL，并复用同一 DSH 协议：

```powershell
$env:DSH_E2E_BASE_URL = 'http://127.0.0.1:8080/v1'
$env:DSH_E2E_MODEL = 'local-model'
$env:DSH_E2E_API_KEY = ''
npm run test:agent-runtime:real
```

默认 `npm run test:workbench`、Windows E2E 和 Mock upstream 不能读取或继承真实凭据，也不能因为真实 profile 未配置而自动降级为 Mock 并报告 PASS。

## 建议的测试实现

优先增加 Rust `#[ignore]` 集成测试（与 `src-tauri/src/services/dsh/commands.rs` 的真实 smoke 同类），或一个单独 Node/Tauri runner；不要把真实网络请求塞进默认单元/E2E 套件。测试应：

1. 建立临时 SQLite 数据库，插入唯一 novel、volume、chapter、conversation、user turn。
2. 构造无凭据 `model_snapshot`（`adapterProtocol=ans_task_session_v2`、`adapterProvider=deepseek-official`、`capabilities` 含 `tool_calling`）。API Key 仅通过进程环境/调用参数注入。
3. 调用真实 `dsh_start_task_turn`/`task_runtime::start`，等待 `TaskRun` 终态。
4. 从 SQLite 读取 `task_runs`、`tool_call_events`、`conversation_turns`、`conversation_artifact_cards`、`result_artifacts`，生成脱敏 evidence。
5. 断言每个工具调用均属于 allowlist、scope 与 novel/chapter 一致、状态有序且全部收敛；若产生候选，校验 `artifactType`、`candidateOnly=true`、source IDs、content hash 和 ResultArtifact 引用。
6. 对错误场景断言没有候选、没有 adopted draft、没有未收敛工具事件。

## 必须记录的 evidence 字段

```json
{
  "profile": "real-dsh-agent-runtime",
  "provider": "deepseek-official",
  "model": "deepseek-v4-flash",
  "runtime": {
    "sourceCommit": "47f943859bef60e4160492346772ded9b24f765a",
    "protocol": "ans_task_session_v2",
    "sessionLifecycle": "created|continued|resumed",
    "workerIdHash": "sha256:...",
    "sessionIdHash": "sha256:..."
  },
  "input": {
    "goalHash": "sha256:...",
    "novelIdHash": "sha256:...",
    "chapterIdHash": "sha256:..."
  },
  "decisionChain": [
    {
      "sequence": 1,
      "tool": "novel.read_context",
      "toolVersion": "1",
      "scope": "novel",
      "status": "succeeded",
      "argumentsHash": "sha256:...",
      "resultHash": "sha256:..."
    }
  ],
  "result": {
    "runStatus": "completed",
    "assistantMessage": true,
    "artifactId": "redacted-or-hash",
    "artifactType": "outline",
    "candidateOnly": true,
    "adoptedDraftWrites": 0
  },
  "usage": {
    "requests": 0,
    "promptTokens": 0,
    "completionTokens": 0,
    "toolCallCount": 0
  },
  "secrets": {
    "apiKeyPersisted": false,
    "apiKeyInEvidence": false,
    "rawPromptPersisted": false
  }
}
```

`requests`/token 数必须来自 DSH/runtime 或治理账本，而不是测试估算。正文、完整 prompt、API Key、隐藏 reasoning 不得进入报告；只保留长度、hash、类型和安全错误摘要。

## 通过/不通过判定

### PASS

- `TaskRun` 使用 `runtime=ans_task_session_v2`、固定 source commit，真实 Provider 请求数大于 0；
- DSH Agent 自主产生至少一个实际 `tool/call`，工具名称来自当前 scoped registry/allowlist；
- Tool 参数通过 Gateway/Registry schema，scope 归属正确；
- Tool result 与 `tool/call` 一一对应，所有事件终态收敛；
- 候选只形成 `ResultArtifact`/卡片，不直接修改 adopted draft；
- 失败场景 fail-closed，凭据、隐藏 prompt、原文不会出现在持久化 evidence；
- 真实 profile 未配置时测试明确 `SKIP/NOT_RUN`，不能伪装 PASS。

### NOT READY

- 仅看到 Provider `/chat/completions` 的 tool calling 格式，没有 DSH Agent session/tool event 证据；
- 走到 TypeScript `taskRuntimeAdapter` 的固定 `steps` 或 heuristic/Mock fallback；
- `chapter_write` 仍未通过 DSH；
- Registry 中缺少预期 canonical action，或 DSH public tool 名称无法映射；
- 候选被直接写入正式正文，或错误后留下 open tool/run；
- 真实请求数为 0、模型 profile 不明、凭据混入日志/快照。

## 安全与隔离边界

- 真实测试命令必须显式命名（例如 `test:agent-runtime:real`），默认测试永不联网。
- API Key 仅进程内存；`model_snapshot`、TaskRun、ToolCallEvent、JSONL session、报告和 E2E artifact 均不得含凭据字段。
- 本地模型 Base URL 必须是 loopback；禁止任意远程 URL 通过“local” profile 绕过治理代理。
- 使用临时数据库/worker/session 目录；测试结束销毁或保留在明确的失败 artifact 目录，绝不写用户作品库。
- 工具权限保持只读/candidate-only；Phase 1A 不新增 adopt/save/write 工具，采用仍需后续显式 ReviewAuthorization。
- 默认 Mock E2E 的网络阻断、模型快照和断言保持不变；真实 profile 与默认 profile 不能共享环境变量残留。

## 结论

当前可直接验证的是“真实 DSH Agent Runtime + 现有只读/candidate Tool Gateway”的结构化候选闭环；不能把 `chapter_write` 或 `Writing SubAgent` 算入 Phase 1A。完成上述证据后，状态最多更新为：

```text
Phase 0.5：DSH Provider / Tool Calling 基础设施 VERIFIED
Phase 1A：Main Agent Runtime + canonical Tool Registry（待真实 session/tool evidence）
Phase 1B：Writing SubAgent（未开始）
Workbench chapter_write through DSH（未验证）
Context Agent（NOT READY）
```

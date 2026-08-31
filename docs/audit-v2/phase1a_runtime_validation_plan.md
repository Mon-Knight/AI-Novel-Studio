# R4：真实 Main Agent Runtime 验证方案（Canonical exposure 后置设计稿）

> **状态：WAITING_FOR_CANONICAL_EXPOSURE。** v3.6.0 候选已经完成 Phase 1A-A/B/C/D，但四个 Canonical Tool 仍为 `catalog_only + partial`，`modelVisibleToolIdentities=[]`。必须先关闭四项 Facade blocker，再通过独立 exposure 变更；此前不得执行本方案，也不得把它写成当前已授权下一步。

> 本文只定义 exposure 通过后的 R4 验证证据，不代表 R4 已通过。验证必须使用显式真实 Provider profile；默认 Mock E2E 不变。

## 现状判定（legacy 基线）

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

上述 11 个名称属于现有 legacy Workbench/DSH allowlist，只用于解释迁移前基线，不能作为 R4 的模型可见清单。R4 只验证独立 exposure 门禁正式放行的 `novel.read@1 / structure.read@1 / context.read@1 / memory.search@1`；legacy alias 必须拒绝。

## R4 的最小验证边界

R4 只验证真实 Main Agent 的“理解 → 自主选择已正式暴露的 Canonical 只读 Tool → 收敛 Tool Result → 安全回复”能力，不验证 Writing SubAgent、候选生成或章节正文写入。建议使用自然语言只读目标，例如：

```text
用户：读取当前作品与章节上下文，给出下一步创作建议。
```

期望由真实模型自主选择至少一个 exposure 任务已正式放行的 identity，顺序不写死：

```text
novel.read@1
structure.read@1
context.read@1
memory.search@1
→ assistant/message 终态
```

R4 不要求生成 ResultArtifact；执行前后 `result_artifacts`、adopted draft、章节正文指针和结构化正式事实数量必须保持不变。

负向场景至少覆盖缺少作品/章节、跨作品 scope、未知 Tool、legacy alias、未暴露 Canonical identity、输入 schema、permission、projection hash、单次 allowlist、超时和取消。所有错误必须失败关闭，不得创建 Artifact、采用草稿或留下未收敛 Tool Event。

`chapter_write`、`invoke_writing_agent`、`adopt_artifact`、候选 Artifact 生成和通用结构化 Safe Apply 都不属于 R4 通过标准；Writing SubAgent 与正文生成链必须继续由后续独立门禁验证。

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
3. 读取 exposure 任务生成的 scoped Canonical manifest，断言 `tools/list`、每轮投影和宿主 allowlist 只包含本轮正式放行的 versioned identity；legacy alias 不得出现。
4. 调用真实 `dsh_start_task_turn`/`task_runtime::start`，等待 `TaskRun` 终态。
5. 从 SQLite 读取 `task_runs`、`tool_call_events`、`conversation_turns`、`conversation_artifact_cards`、`result_artifacts`，生成脱敏 evidence。
6. 断言每个工具调用均属于 scoped allowlist、scope 与 novel/chapter 一致、状态有序且全部收敛；Tool Result 必须回到同一 Agent 回合。
7. 对成功和错误场景都断言 ResultArtifact、正式结构化事实、adopted draft 和正文指针没有变化，也没有未收敛工具事件。

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
    "sessionIdHash": "sha256:...",
    "canonicalProjectionHash": "sha256:...",
    "scopedManifestHash": "sha256:...",
    "modelVisibleToolIdentities": ["novel.read@1"]
  },
  "input": {
    "goalHash": "sha256:...",
    "novelIdHash": "sha256:...",
    "chapterIdHash": "sha256:..."
  },
  "decisionChain": [
    {
      "sequence": 1,
      "tool": "novel.read@1",
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
    "resultArtifactWrites": 0,
    "structuredFactWrites": 0,
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
- DSH Agent 自主产生至少一个实际 `tool/call`，identity 来自 exposure 任务正式放行的 scoped Canonical manifest；
- `tools/list`、每轮投影、manifest hash 和宿主 allowlist 一致，legacy alias、未暴露 identity 与未知版本均被拒绝；
- Tool 参数通过 schema、permission、projection hash 与双层 scope 校验，作品/章节归属正确；
- Tool result 与 `tool/call` 一一对应，所有事件终态收敛；
- ResultArtifact、正式结构化事实、adopted draft 和章节正文指针均保持不变；
- 失败场景 fail-closed，凭据、隐藏 prompt、原文不会出现在持久化 evidence；
- 真实 profile 未配置时测试明确 `SKIP/NOT_RUN`，不能伪装 PASS。

### NOT READY

- 仅看到 Provider `/chat/completions` 的 tool calling 格式，没有 DSH Agent session/tool event 证据；
- 走到 TypeScript `taskRuntimeAdapter` 的固定 `steps` 或 heuristic/Mock fallback；
- Canonical Tool 仍为模型不可见，或实际调用落入 legacy allowlist/alias；
- scoped manifest、projection hash、permission、schema 或单次 allowlist 无法闭环；
- 产生 ResultArtifact、正式结构化写入、草稿采用、正文指针变化，或错误后留下 open tool/run；
- 真实请求数为 0、模型 profile 不明、凭据混入日志/快照。

## 安全与隔离边界

- 真实测试命令必须显式命名（例如 `test:agent-runtime:real`），默认测试永不联网。
- API Key 仅进程内存；`model_snapshot`、TaskRun、ToolCallEvent、JSONL session、报告和 E2E artifact 均不得含凭据字段。
- 本地模型 Base URL 必须是 loopback；禁止任意远程 URL 通过“local” profile 绕过治理代理。
- 使用临时数据库/worker/session 目录；测试结束销毁或保留在明确的失败 artifact 目录，绝不写用户作品库。
- 工具权限保持只读；R4 不新增 candidate/adopt/save/write 工具。章节采用继续使用已经完成的显式 `ReviewAuthorization` 原子事务，通用结构化 `request_apply` 继续失败关闭。
- 默认 Mock E2E 的网络阻断、模型快照和断言保持不变；真实 profile 与默认 profile 不能共享环境变量残留。

## 结论

当前不能执行 R4。Capability Catalog、Domain Facade、Canonical Projection、共享 portable Manifest 与宿主门禁已经完成，但四个 Canonical Tool 仍为 `catalog_only + partial`，模型可见数为 `0`。执行顺序固定为：

```text
Phase 1A-A/B/C/D：Canonical 宿主基础 VERIFIED，visible=0
        ↓
关闭 novel/structure/context/memory 四项 Facade blocker
        ↓
独立 Canonical exposure 与 scoped Tool 投影验证
        ↓
R4：真实 Main Agent Runtime 验证（本方案）
        ↓
legacy runtime/入口隔离与 Writing SubAgent 后续门禁
```

本文不创建新版本、不创建新任务书，也不授权 exposure、R4、提交、tag 或发布。

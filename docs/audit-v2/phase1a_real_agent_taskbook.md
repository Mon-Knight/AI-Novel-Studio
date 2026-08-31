# R4：真实 Main Agent Runtime 验证任务书（Canonical exposure 后置）

> **状态：WAITING_FOR_CANONICAL_EXPOSURE。** v3.6.0 候选已完成 Phase 1A-A/B/C/D（Capability Catalog、Domain Facade、Canonical Projection、portable Manifest/漂移门禁），但四个 Canonical Tool 仍为 `catalog_only + partial`，`modelVisibleToolIdentities=[]`。必须先关闭四项 Facade blocker，再通过独立 exposure 变更；此前不得执行本任务书，也不得把它写成当前已授权下一步。

## 1. 阶段定位

本任务承接 R3 的共享 Manifest/Runtime 门禁和后续独立 exposure，只验证真实模型是否能在 DSH Task Runtime 中自主选择已经正式暴露的 Canonical 只读领域工具。

本任务不是 Context Agent，也不是 Writing SubAgent 实现任务，不负责关闭 exposure 前置 blocker。

目标链路：

```text
真实 Provider
  ↓
固定 DSH Task Runtime / Main Agent
  ↓
MCP Domain Gateway / 当前 Tool Projection
  ↓
Tool Call / Tool Result
  ↓
持久 Tool Event / assistant response
```

## 2. 明确不做

- 不在本任务中修复 `novel.read / structure.read / context.read / memory.search` 的四项 `partial` blocker，也不自行修改 exposure；
- 不把 `chapter_write` 默认路由切换到 DSH；
- 不删除或替换现有 `taskRuntimeAdapter`、Workbench Writer 或旧 Registry；
- 不新增数据库 migration；
- 不把 legacy `generate_chapter` candidate validator 冒充 Canonical Tool 或正文生成器；
- 不新增 `invoke_writing_agent`、`adopt_artifact` 假 Tool；
- 不让模型直接采用正文或修改正式小说事实；
- 不改变默认 Mock E2E、网络阻断策略或生产凭据配置；
- 不在报告中记录 prompt 正文、候选正文、Authorization header 或 API Key。

## 3. 实现范围

只有独立 exposure 门禁已通过后，才建议新增显式 opt-in 的 ignored/integration 验证入口，优先复用：

```text
src/services/dsh/taskSessionAdapter.ts
src/services/dsh/taskRuntimeService.ts
src-tauri/src/services/dsh/task_runtime.rs
src-tauri/gateway/src/tools.rs
src-tauri/src/services/conversation_service.rs
```

真实测试必须使用隔离 SQLite fixture，不能读取或修改用户生产作品。建议输入包含一个有效小说、一个章节、一个任务对话和一个回合；模型快照至少包含：

```json
{
  "runtimeMode": "api",
  "providerId": "deepseek-official",
  "modelId": "deepseek-v4-flash",
  "runtime": {
    "adapterProtocol": "ans_task_session_v2",
    "adapterProvider": "deepseek-official"
  },
  "capabilities": ["conversation_turn", "tool_calling"]
}
```

凭据只能通过进程环境或瞬时命令参数传递，禁止进入 snapshot、SQLite、日志或报告。

## 4. 必须验证的场景

### 4.1 正向：真实模型自主选择 Canonical 只读工具

使用自然语言目标（例如“读取当前作品上下文并给出下一步建议”），断言：

1. 真实 DSH Worker 启动并通过 source commit/protocol/health 校验；
2. 模型产生至少一个已暴露的 Canonical 只读 Tool Call：`novel.read@1`、`structure.read@1`、`context.read@1` 或 `memory.search@1`；
3. 实际 `tools/list`、每轮 scoped manifest 和宿主 allowlist 均只包含 exposure 任务正式放行的 identity，legacy alias 必须拒绝；
4. `tool_call_events` 中存在完整的 queued/running/terminal 状态，调用顺序来自真实事件，不由测试脚本伪造；
5. Tool Result 回到同一 Agent 回合并形成面向用户的安全回复；R4 只读验证不要求生成章节候选或 ResultArtifact；
6. 正式 adopted draft、章节正文指针、结构化正式事实和 Artifact 数量保持不变。

### 4.2 负向：范围和协议失败关闭

至少覆盖：

- 缺少章节或作品；
- 跨作品/跨章节参数；
- 未知 Tool 名称、legacy alias 或未暴露的 Canonical identity；
- 输入 schema、权限、projection hash 或单次 allowlist 不匹配；
- Provider/Worker 超时或取消。

每种情况都必须记录安全错误分类，且不产生正式 Artifact、草稿采用或半完成 Tool Event。

### 4.3 会话续接

在同一隔离 conversation 上执行一次 follow-up，确认 `sessionLifecycle` 为 `continued` 或 `resumed`，且不同 conversation 的 Worker、事件和 Artifact 不串联。

## 5. 证据报告格式

验证成功后才生成：

```text
docs/audit-v2/agent_runtime_validation.md
```

报告必须包含：

- test profile、fixture 标识和是否真实 Provider；
- provider/model、DSH source commit、protocol、runtime health/composition；
- Tool manifest/allowlist hash 与实际可见 Tool 名称；
- conversation/turn/run/session/worker ID 和生命周期；
- 有序 Tool Call 的名称、版本、scope、状态、耗时、参数 hash/长度、结果 hash/长度；
- upstream request/tool-call 数量和 token usage（不含请求正文）；
- assistant 终态、Tool Result hash/长度和可公开错误分类；
- ResultArtifact、adopted draft、正式正文指针与结构化正式写入的前后计数；
- 失败、取消、重试和 secret scan 结果；
- 明确列出未验证项：`chapter_write through DSH`、Writing SubAgent、候选 Artifact 生成、通用结构化 Safe Apply、Context Agent。

## 6. 通过门槛

只有同时满足以下条件，R4 才能标记 `VERIFIED`：

```text
真实 Provider
  + 真实 DSH session/prompt
  + 模型自主 Canonical 只读 Tool Call（非 heuristic/fixed steps）
  + Tool Result 持久化闭环
  + scoped manifest / allowlist / permission 证据
  + 正式事实零写入
  + 负向 scope/schema/hash/取消证据
  + 凭据零泄露
```

否则状态为 `PARTIAL` 或 `BLOCKED`，不得进入 R5/R6 或 Writing SubAgent 放行。

## 7. 后续顺序

```text
R3 portable Manifest / 宿主门禁（已验证，visible=0）
        ↓
逐项关闭 novel/structure/context/memory 四项 Facade blocker
        ↓
独立 Canonical exposure 变更与 scoped Tool 投影验证
        ↓
R4 真实 Main Agent Runtime 验证（本任务书）
        ↓
R5 legacy runtime/入口隔离
        ↓
R6 Writing SubAgent（独立 Prompt/模型/上下文/预算）
        ↓
Workbench chapter_write 真实闭环；其余 SubAgent 按独立任务放行
```

Canonical Registry/Projection/Facade 是 R4 的前置条件，不能再排在 Main Agent 或 Writing SubAgent 之后。本任务书只定义后置验证证据，不创建新版本、不授权 exposure/R4 执行，也不授权提交、tag 或发布。

# Phase 1A-B：真实 Agent Runtime 接入验证任务书（后置）

> **状态：DEFERRED。** 当前阶段先执行 [Phase 1A-A 能力资产化任务书](./phase1a_capability_assetization_taskbook.md)。在 Capability Catalog、首批 facade 和 canonical manifest 通过准入前，不得执行本任务书，也不得将其称为当前下一步。

## 1. 阶段定位

本任务承接 `Phase 0.5 — Model / Provider Infrastructure Verified`，只验证真实模型是否能在现有 DSH Task Runtime 中自主选择已暴露的领域工具。

本任务不是 Context Agent，也不是 Writing SubAgent 实现任务。

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
ResultArtifact candidate projection
```

## 2. 明确不做

- 不把 `chapter_write` 默认路由切换到 DSH；
- 不删除或替换现有 `taskRuntimeAdapter`、Workbench Writer 或旧 Registry；
- 不新增数据库 migration；
- 不把 `generate_chapter` candidate validator 冒充正文生成器；
- 不新增 `invoke_writing_agent`、`adopt_artifact` 假 Tool；
- 不让模型直接采用正文或修改正式小说事实；
- 不改变默认 Mock E2E、网络阻断策略或生产凭据配置；
- 不在报告中记录 prompt 正文、候选正文、Authorization header 或 API Key。

## 3. 实现范围

建议新增独立、显式 opt-in 的 ignored/integration 验证入口，优先复用：

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

### 4.1 正向：真实模型自主选工具

使用自然语言目标（例如“读取当前作品上下文并给出下一步建议”），断言：

1. 真实 DSH Worker 启动并通过 source commit/protocol/health 校验；
2. 模型产生至少一个只读 Tool Call（如 `novel.read_context`、`chapter.read_outline` 或 `search_memory`）；
3. 若模型形成候选，后续调用只能是当前 allowlist 内的 candidate validator；
4. `tool_call_events` 中存在完整的 queued/running/terminal 状态，调用顺序来自真实事件，不由测试脚本伪造；
5. 候选以 `ResultArtifact`/Card candidate 投影保存，`novelId/chapterId/contentHash` 正确；
6. 正式 adopted draft、章节正文指针和正式事实写入数量保持不变。

### 4.2 负向：范围和协议失败关闭

至少覆盖：

- 缺少章节或作品；
- 跨作品/跨章节参数；
- 未知 Tool 名称；
- 缺少 `candidateText` 或非法 candidate schema；
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
- Artifact 类型、来源作品/章节、hash、processing status；
- adopted draft/正式正文指针前后计数；
- 失败、取消、重试和 secret scan 结果；
- 明确列出未验证项：`chapter_write through DSH`、`Writing SubAgent`、`adopt_artifact`、Context Agent。

## 6. 通过门槛

只有同时满足以下条件，Phase 1A 才能标记 `VERIFIED`：

```text
真实 Provider
  + 真实 DSH session/prompt
  + 模型自主 Tool Call（非 heuristic/fixed steps）
  + Tool Result 持久化闭环
  + candidate-only Artifact
  + 负向 scope/schema/取消证据
  + 凭据零泄露
```

否则状态为 `PARTIAL` 或 `BLOCKED`，不得进入 Phase 1B。

## 7. 后续顺序

```text
Phase 1A 真实 Main Agent Runtime 验证
        ↓
Phase 1B Writing SubAgent（独立 Prompt/模型/上下文/预算）
        ↓
Workbench chapter_write 真实闭环
        ↓
canonical Registry / capability facade 归并
        ↓
Context Agent
```

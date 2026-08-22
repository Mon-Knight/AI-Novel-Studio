# v2.5.0 Chapter Readiness Planner Runtime

## 1. 范围

v2.5.0 只实现一个正式、持久、可恢复的只读计划：`chapter_readiness_plan_v1@1`。该计划用于回答“当前章节是否具备进入正文生成的本地事实条件”。它不调用 AI Provider、不生成正文、不写业务资产，也不替代用户确认。

## 2. 固定 DAG

```text
novel.read_context@1
├─ chapter.read_outline@1
├─ chapter.read_context@1
├─ style.read_profile@1
└─ style.read_output_control@1
   └──────────────┬───────────────┘
                  ↓
verification.check_readiness@1
```

| 顺序 | Step key               | Tool                             | 依赖       |
| ---- | ---------------------- | -------------------------------- | ---------- |
| 1    | `read_novel_context`   | `novel.read_context@1`           | 无         |
| 2    | `read_chapter_outline` | `chapter.read_outline@1`         | 1          |
| 3    | `read_chapter_context` | `chapter.read_context@1`         | 1          |
| 4    | `read_style_profile`   | `style.read_profile@1`           | 1          |
| 5    | `read_output_control`  | `style.read_output_control@1`    | 1          |
| 6    | `check_readiness`      | `verification.check_readiness@1` | 2、3、4、5 |

旧 `src/agent/planner-lite.ts` 继续作为 v1.0.46 历史参考，不是 v2.5.0 的执行事实源。

## 3. 契约冻结

Plan 创建由 Rust 构造固定步骤，调用方不能提交任意 DAG。Plan 和每个 Step 分别冻结：

- `agent_plan_v1`、Planner id/version；
- 生产 `tool_registry_v1` hash；
- Tool name/version/identity；
- input/output JSON schema hash；
- 排序后的权限、scope；
- canonical arguments JSON/hash；
- 稳定 ordinal 和依赖。

TypeScript Executor 在每次 claim 前重新读取生产 Registry manifest，并逐项复验以上字段。当前生产 Registry hash 为：

```text
846a38c25bba33c843b56fa6583b334bae3364073fb7f0b6290be0c405aae871
```

既有 Provider 任务策略仍为 `allowedTools=[]`；新增工具只由本地 Planner Executor 调用，不开放给模型自主选择。

## 4. 持久事实

```text
agent_plans
  ├─ agent_plan_steps
  │    ├─ agent_plan_step_dependencies
  │    └─ agent_plan_step_attempts
  ├─ agent_execution_leases
  └─ agent_plan_checkpoints
```

- Plan 创建以 `operationId + canonical requestHash` 幂等；同 operation 不同 payload 失败关闭。
- Attempt 每次 claim 追加新行；已完成、失败或 abandoned 的 Attempt 不复活。
- Checkpoint 按 Plan 单调 sequence 追加，保存事件 payload 的 canonical hash。
- Plan、Step 和依赖身份由 SQLite trigger 禁止原地改写或删除。

## 5. 状态机

Plan：

```text
ready → running → completed
          ├────→ waiting_retry → running
          ├────→ failed
          └────→ cancelled
ready / waiting_retry ────────→ cancelled
```

Step：

```text
pending → running → completed
            ├────→ waiting_retry → pending
            ├────→ failed
            └────→ cancelled
pending / waiting_retry ─────→ cancelled
```

工具失败若允许用户再次尝试，只把 Plan/Step 写为 `waiting_retry`；Executor 立即停止。只有显式 `authorize_agent_plan_retry` 写入 `confirmedBy=user` checkpoint 后，Step 才回到 pending，并在后续 claim 中创建新的 Attempt。

## 6. Execution lease

每个 Plan 同时最多一个 active lease。Rust 分配单调 epoch、owner、过期时间和高熵瞬时 token：

```text
Executor memory: raw token
SQLite: SHA-256(raw token)
```

claim、complete、fail 和 release 均验证 `planId + leaseId + epoch + owner + token hash + expiresAt`。原始 token 不进入 SQLite、Checkpoint、普通日志或 UI 状态持久化。租约不续期；新执行必须获得新 epoch。

## 7. 跨重启恢复

数据库初始化完成后、Tauri 命令开放前，Rust 执行恢复事务：

1. active lease 变为 `expired`；
2. running Attempt 变为 `abandoned`；
3. running Step（或下一个可运行 pending Step）变为 `waiting_retry`；
4. running Plan 变为 `waiting_retry`；
5. 追加 `interrupted_recovered` Checkpoint，记录 `automaticReplay=false`。

恢复不会调用任何 Tool。用户必须在工作台明确点击“继续 / 重试”。

## 8. IPC 与前端边界

正式命令：

```text
create_agent_plan
get_agent_plan
list_agent_plans_by_chapter
acquire_agent_plan_lease
claim_agent_plan_step
complete_agent_plan_step
fail_agent_plan_step
authorize_agent_plan_retry
release_agent_plan_lease
cancel_agent_plan
recover_interrupted_agent_plans
```

浏览器开发模式不提供 LocalStorage Plan 回退，避免把临时页面状态伪装成持久执行事实。工作台只显示紧凑计划卡片，不承载复杂 Planner 配置。

## 9. 安全边界

- Tool output 本地保存 canonical JSON 与 SHA-256，最大 2 MiB，并拒绝疑似凭据。
- Checkpoint 只保存状态、identity、hash 和安全错误摘要，不复制完整正文或 token。
- `verification.check_readiness@1` 返回 `ready/score/missing/warnings/summary`，缺失信息是结果，不是业务写入。
- 本版没有正文副作用工具、动态任务拆解、长期 Memory、自动续跑或 Multi-Agent。

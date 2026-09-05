# R4 Agent Runtime 验证报告

> 状态：**PARTIAL**。Canonical catalog/manifest、Gateway Canonical-only `tools/list`、宿主 `taskKind=read` allowlist 注入与工作台 read contract 已完成。仓内 runtime 证明是回环 mock DSH Canonical read-turn（`canonical_read_turn`），不是 live 云端 Provider。真实云端 Provider 仍 **NOT VERIFIED**。Writing SubAgent / `chapter_write` 走 DSH 仍未宣称。不含凭据、prompt 正文、候选正文或 API Key。

## 1. 判定

| 门禁                                          | 状态                      | 口径                                                                                                                                              |
| --------------------------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Phase 1A-A/B/C/D 宿主基础                     | VERIFIED                  | Catalog / Facade / Projection / portable Manifest                                                                                                 |
| Canonical catalog/manifest exposure           | DONE                      | 4 项 `stable` + `working`；Manifest identity 带 `@1`                                                                                              |
| Gateway Canonical `tools/list` / `tools/call` | DONE（条件）              | 仅当 `ANS_ALLOWED_TOOLS` 含 Canonical 名                                                                                                          |
| 工作台 `read` DSH start contract              | DONE（TS）                | `taskKind=read` + Canonical `allowedTools`；`chapter_write` 不进 DSH                                                                              |
| 宿主注入 Canonical allowlist                  | DONE                      | `turn_allowed_tools` 在 `taskKind=read` 且无候选工具时注入 `novel.read,structure.read,context.read,memory.search`；client `allowedTools` 不是权威 |
| 宿主 Main Agent 脚手架                        | EXISTS（非 R4 证据）      | `mainAgentRuntimeService` 启发式选工具，生产发送不走它                                                                                            |
| R4 Canonical-only DSH 只读回合                | **PARTIAL / 未 VERIFIED** | 回环 mock DSH Canonical read-turn（`canonical_read_turn`）是仓内 runtime 证明；真实云端 Provider 自主 Tool Call 仍 NOT VERIFIED                   |
| Writing SubAgent / `chapter_write` 走 DSH     | 未做、后置                | 生产 `chapter_write` 仍走 ANS Writer                                                                                                              |

R4 只有在真实云端 Provider + 真实 DSH session 中，模型自主调用 Canonical 只读名（非 heuristic/fixed steps），且 Tool Result 闭环、正式事实零写入时才能标 VERIFIED。仓内回环 mock DSH Canonical read-turn 只证明生产路径能在 loopback mock 上走完 Canonical 只读回合，不能代替 live 云端证据。Catalog 可见集合、Gateway 条件列表、TS contract 或宿主脚手架都不能单独把 R4 标成 VERIFIED。

## 2. 已落地证据（无秘密）

### 2.1 Catalog / Manifest exposure

- 共享 artifact：`contracts/agent/canonical-tool-manifest.v1.json`
  - `modelVisibleToolIdentities`: `context.read@1`, `memory.search@1`, `novel.read@1`, `structure.read@1`
  - 四项 `exposure=stable`、`projectionState=stable`、`health=working`
  - `projectionHash`: `5618416f51b761ff6a9089bc46be7b468bb46c95351aa0690d92e384a83b3e93`
- TypeScript Catalog 使用 `commonExposedRead`；Rust `canonical_manifest.rs` 校验 hash 与 visible gate。
- 模型面投影：`listCanonicalToolsForAgent()` 按 Manifest 可见集合过滤，长度为 4。

Manifest 使用 versioned identity（`novel.read@1`）。DSH Gateway 列表使用 **无 @version** 名（`novel.read`）。二者不要混写成同一个字符串已经出现在 `tools/list`。

### 2.2 Gateway Canonical 路径（条件）

- `src-tauri/gateway/src/tools.rs`
  - `ANS_ALLOWED_TOOLS` 含任一 Canonical 名时，`tools/list` 使用 `canonical_tool_catalog()` 并按 allowlist 过滤。
  - 无限制 / 仅 legacy 时仍列出 `novel.read_context` 等，不把 Canonical 名替换进去。
  - `tools/call`：`novel.read` → `get_metadata`；`structure.read` / `context.read` → 既有章节上下文读；`memory.search` → `search_memory`。Canonical-only allowlist 拒绝 legacy alias。
- 单测覆盖：canonical-only 列表不含 legacy；mixed allowlist 不泄漏未允许 Canonical 名；legacy alias 失败关闭。

### 2.3 工作台 `read` contract（TS）

- `src/services/dsh/taskRuntimeService.ts`：`buildDshTaskStartContract` 在 `classifyTaskIntent === 'read'` 时设置 `allowedTools: CANONICAL_READ_ALLOWED_TOOLS`（`CANONICAL_TOOL_IDS`，无 @version）。
- `taskSessionAdapter.startTurn`：寒暄本地回复；`chapter_write` → `taskRuntimeAdapter`；其余桌面任务把该 contract 传给 `dsh_start_task_turn`。
- `structured_write` / audit **不** 设置 `allowedTools`，保持 legacy DSH allowlist。
- `buildDshTurnContract` 对 read 的 `requiredReadTools` 使用 Canonical 名（`novel.read` / `structure.read` / `context.read` / `memory.search`）；候选任务仍用 legacy 读工具。
- 单元测试：`taskRuntimeService.test.ts`、`taskSessionAdapter.test.ts`、`taskGoalRouting.test.ts`。

### 2.3.1 宿主 `task_runtime` 注入（DONE）

- `is_canonical_only_turn`：`taskKind=read` 且无 `expected_tool`，且非插件探测会话。
- `turn_allowed_tools` 注入 `CANONICAL_ALLOWED_TOOLS`；`turn_context_read_tools` 同步为 Canonical。
- `normalize_tool_name('novel.read')` 保持 Canonical；Canonical-only 回合投影拒绝 `novel.read_context` / `generate_*`。
- Rust 测试：`read_turn_allowlist_is_canonical_only` 等（`workbench_prompt_tests`）。

### 2.4 宿主脚手架（明确不是 R4）

- `mainAgentRuntimeService.ts` 默认 `createDefaultDeterministicExecutor`：正则启发式 `selectInitialToolCalls` + `executeCanonicalTool`。
- 源码注释写明：生产桌面读回合走 DSH，该执行器不是 live DSH Agent 证据。
- 生产发送路径不调用该服务。

### 2.5 opt-in 真实 profile 入口

- `npm run test:agent-runtime:real` → `scripts/dsh/test-agent-runtime-real.mjs`；默认 `npm test` / `test:workbench` **不**调用它。
- 未设置 `DSH_E2E_BASE_URL`：打印 `NOT_RUN`，退出 0（CI 绿灯、无网络）。
- 回环 URL（`127.0.0.1` / `localhost`）：运行 `cargo test --locked --manifest-path src-tauri/Cargo.toml canonical_read_turn -- --test-threads=1`，继承 stdio，以 cargo 退出码结束。该 filter 启动自己的 loopback mock，**不向云端发请求、不打印 API Key**。
- 非回环 URL：本 harness **不执行**云端 Provider profile（失败关闭、无网络）。默认打印 `NOT_RUN` 并以 0 退出，避免误设环境变量弄红 CI；仅当 `DSH_E2E_FORCE_CLOUD=1` 时以退出码 2 失败关闭（仍不发网）。
- 回环 mock DSH Canonical read-turn 是仓内 R4 runtime 证明；**不能**把该脚本或 `canonical_read_turn` 的通过当成 live 云端 Provider VERIFIED。

## 3. 剩余缺口（R4 未通过原因）

1. **没有 live 云端 Provider DSH 回合证据**
   - 仓内已有回环 mock DSH Canonical read-turn（`canonical_read_turn` / opt-in `test:agent-runtime:real` + loopback URL）。
   - 仍无真实云端 Provider + 隔离 SQLite 的 Canonical `tool/call` 链与脱敏 evidence 包。
   - 因此 R4 对 live 云端 Provider 仍是 **NOT VERIFIED**，不得把 mock 通过写成 VERIFIED。
2. **Writing SubAgent / 写章不在范围内**
   - `chapter_write` 继续 ANS Writer。
   - Writing SubAgent / `chapter_write` through DSH 仍未宣称。
   - 不得把 `generate_chapter` candidate sink 写成 Canonical 或正文生成器。

## 4. 建议的下一步（仅 R4）

1. 按 `docs/audit-v2/phase1a_runtime_validation_plan.md` 用隔离 SQLite + **真实云端 Provider** 跑只读回合，记录脱敏 evidence。本 harness 对非回环 URL 失败关闭且不发网。
2. 回环 mock 路径已接到 `canonical_read_turn`；不要把它升级成 live 云端 VERIFIED。
3. 云端通过后再谈 R5/R6。不在本报告范围内实现 Writing SubAgent 或 `chapter_write` through DSH。

## 5. 明确未验证项

- 真实云端模型自主 `tool/call` Canonical 只读工具（仓内仅有 loopback mock DSH Canonical read-turn；live Provider 仍 NOT VERIFIED）
- `chapter_write` through DSH
- Writing SubAgent
- 候选 Artifact 生成作为 R4 通过标准
- 通用结构化 Safe Apply
- Context / Quality SubAgent

# AI Novel Studio v2.2.0 工作区可靠性审计报告

> 版本：v2.2.0  
> 分支：`feat/v2.2.0-workspace-reliability`  
> 审计日期：2026-07-11  
> 范围：迁移账本、结构化错误、正文原子保存与完整性读取、恢复快照、全局 Leave Guard、有限后端分层和动态回归测试

## 1. 实际修改文件

### 1.1 版本与文档

- `package.json`
- `package-lock.json`
- `src-tauri/Cargo.toml`
- `src-tauri/Cargo.lock`
- `src-tauri/tauri.conf.json`
- `src/constants/version.ts`
- `CHANGELOG.md`
- `README.md`
- `docs/README.md`
- `docs/version-roadmap.md`
- `docs/technical/testing.md`
- `docs/audit/phase-2/01-workspace-reliability-report.md`

### 1.2 Rust/Tauri

- `src-tauri/src/main.rs`
- `src-tauri/src/db.rs`
- `src-tauri/src/commands.rs`
- `src-tauri/src/large_text_save.rs`
- `src-tauri/src/errors.rs`
- `src-tauri/src/migrations.rs`
- `src-tauri/src/commands/drafts.rs`
- `src-tauri/src/commands/recovery.rs`
- `src-tauri/src/services/mod.rs`
- `src-tauri/src/services/draft_service.rs`
- `src-tauri/src/services/recovery_service.rs`
- `src-tauri/src/repositories/mod.rs`
- `src-tauri/src/repositories/draft_repository.rs`
- `src-tauri/src/repositories/large_text_repository.rs`
- `src-tauri/src/repositories/recovery_repository.rs`

### 1.3 前端工作区

- `src/main.tsx`
- `src/pages/WritingWorkspace/WritingWorkspacePage.tsx`
- `src/components/workspace/EditorArea.tsx`
- `src/components/workspace/StatusBar.tsx`
- `src/components/workspace/ContentUnavailableState.tsx`
- `src/components/workspace/RecoveryDialog.tsx`
- `src/components/workspace/WorkspaceLeaveDialog.tsx`
- `src/components/right-dock/RightPanel.tsx`
- `src/components/right-dock/RightToolbar.tsx`
- `src/components/right-dock/panels/DraftHistoryPanel.tsx`
- `src/hooks/useWorkspaceRecovery.ts`
- `src/hooks/useWorkspaceLeaveGuard.ts`
- `src/services/database/db.ts`
- `src/services/database/draftVersionService.ts`
- `src/services/workspace/workspaceErrorService.ts`
- `src/services/workspace/workspaceRecoveryService.ts`
- `src/types/ai.ts`
- `src/types/appError.ts`
- `src/types/draftContentState.ts`
- `src/types/workspaceLeave.ts`
- `src/types/workspaceRecovery.ts`
- `src/utils/contentIntegrity.ts`

### 1.4 测试与脚本

- `vitest.config.ts`
- `scripts/agent-workflow/run_vitest_suite.ps1`
- `scripts/agent-workflow/run_cargo_test_filter.ps1`
- `scripts/agent-workflow/run_workspace_test_suite.ps1`
- `src/test/setup.ts`
- `src/test/deferred.ts`
- `src/test/fakes/workspaceFakes.ts`
- `src/test/components/ContentUnavailableState.test.tsx`
- `src/test/components/RecoveryDialog.test.tsx`
- `src/test/workspace-reliability/documentLoadGuard.test.ts`
- `src/test/workspace-reliability/rapidChapterSwitch.test.tsx`
- `src/test/workspace-reliability/useWorkspaceLeaveGuard.test.tsx`
- `src/test/workspace-recovery/recoveryRestore.test.tsx`
- `src/test/workspace-recovery/useWorkspaceRecovery.test.tsx`
- `src/test/workspace-recovery/workspaceRecoveryService.test.ts`
- `src/test/large-text-integrity/draftContentState.test.ts`
- `src/test/large-text-integrity/draftVersionService.test.ts`
- `src/test/migrations/appErrorContract.test.ts`

## 2. 迁移账本设计

保留现有历史初始化 SQL，并在其后运行 v2.2.0 正式迁移账本。账本表为：

```sql
schema_migrations (
  migration_id TEXT PRIMARY KEY,
  version TEXT NOT NULL,
  checksum TEXT NOT NULL,
  applied_at TEXT NOT NULL
)
```

迁移按代码内固定顺序逐项执行，每项使用独立 SQLite transaction。执行前创建或读取账本；已存在且 checksum 一致时跳过，checksum 不一致时返回 `DATABASE_TRANSACTION_FAILED`，附带 migration ID、期望 checksum 和实际 checksum，并停止后续启动写入。迁移失败由 transaction 析构回滚，再次启动可安全重试。

本阶段没有伪造旧版本历史迁移，也没有删除旧表或旧正文。

## 3. 新增迁移

| 顺序 | Migration ID | 内容 |
|---|---|---|
| 1 | `001_schema_migrations` | 建立正式迁移账本并记录自身 |
| 2 | `002_workspace_recovery_snapshots` | 建立恢复快照表、精确复合主键、更新时间索引和可选大文本引用 |
| 3 | `003_draft_save_operations` | 建立草稿保存 operation 幂等记录表及目标索引 |
| 4 | `004_large_text_integrity` | 补齐长文本 document/chunk 完整性字段、状态、索引与 `chapter_drafts.content_hash`，并修复已被旧草稿引用的 document 目标身份 |

空数据库和缺少 v2.2.0 新结构的旧数据库走同一迁移序列；DB01、DB02、DB03 和 DB15 分别验证初始化、重复启动、checksum 冲突和旧库升级。

## 4. AppError 与错误码

Rust 与 TypeScript 使用一致的可序列化结构：`code`、`message`、`retryable`、可选 `traceId`、`operationId` 和 `details`。Tauri 新命令直接返回结构化对象；前端按 `error.code` 分支，不再依赖核心英文消息片段。

本阶段定义了任务书要求的首批错误码：

```text
DOCUMENT_VERSION_CONFLICT
DOCUMENT_HASH_MISMATCH
TARGET_NOVEL_NOT_FOUND
TARGET_CHAPTER_NOT_FOUND
TARGET_CHAPTER_DELETED
TARGET_DRAFT_NOT_FOUND
DRAFT_UPDATE_ZERO_ROWS
LARGE_TEXT_HASH_MISMATCH
LARGE_TEXT_CHUNK_MISSING
LARGE_TEXT_CONTENT_UNAVAILABLE
LARGE_TEXT_REFERENCE_INVALID
RECOVERY_SNAPSHOT_NOT_FOUND
RECOVERY_BASE_CONFLICT
RECOVERY_CONTENT_INVALID
DATABASE_BUSY
DATABASE_TRANSACTION_FAILED
DATABASE_COMMIT_UNKNOWN
OPERATION_ALREADY_COMPLETED
OPERATION_IN_PROGRESS
OPERATION_PAYLOAD_CONFLICT
WORKSPACE_LEAVE_CANCELLED
WORKSPACE_SAVE_FAILED
WINDOW_CLOSE_BLOCKED
```

前后端均提供本地结构化工作区日志。日志保留 trace、operation、novel、chapter、draft、版本、长度、hash、状态和错误码；正文、完整 Prompt、API Key 及常见敏感字段会被拒绝或脱敏，不上传云端。

## 5. 大文本事务时序

统一入口为 `save_chapter_draft_atomic`，使用 `BEGIN IMMEDIATE` 等价的 rusqlite `TransactionBehavior::Immediate`：

```text
验证 operationId 与请求 hash
→ 验证作品、章节、删除状态和草稿归属
→ 验证 draftVersion 与 baseContentHash
→ 重新计算并验证 currentContentHash
→ 判断 inline 或 chunked 存储
→ 写入 large_text_documents 与 large_text_chunks
→ 新建候选草稿或更新未采用草稿
→ 检查 affected_rows = 1
→ 写入 content_hash、large_text_ref_id 和 completed operation 结果
→ commit
→ 执行提交后临时缓存清理
```

任一提交前步骤失败时，document、chunks、草稿引用和 operation 记录整体回滚。已采用草稿保持不可变；对已采用草稿继续编辑会创建新的候选版本。后端重新计算字数，前后端均按 CJK 字符和 ASCII 词组的既有语义统计。

数据库提交成功后的缓存清理失败只记录维护 warning，保存仍返回成功，避免诱导用户重复提交。

## 6. 大文本读取失败行为

长正文读取会校验：

- document 是否存在、状态是否为 `ready`；
- 草稿与 document 的引用关系及兼容的旧目标身份；
- chunk 数量、从 0 开始的连续顺序；
- 每个 chunk 的字符数、字节数和 SHA-256；
- 合并后总字符数、总字节数和完整 SHA-256。

任一校验失败均返回结构化不可用状态，不把 preview 当作完整正文。前端 `DraftContentState` 明确区分 `ready` 和 `unavailable`；不可用时 preview 不进入 textarea 或编辑器 snapshot，并禁用保存、采用、润色、质量检查和正文生成/重写，只提供重新读取、错误详情、草稿历史和返回章节列表。

## 7. 恢复快照模型

`workspace_recovery_snapshots` 使用 `(novel_id, chapter_id)` 作为唯一身份，保存基础草稿 ID、版本、hash、恢复正文 hash、选择区间及时间。小正文直接存储；超过 100 KiB 时复用经过完整性校验的长文本 document/chunk 存储，但快照仍不是正式草稿，不占用版本号、不改变 `is_adopted`，也不进入导出、AI 上下文或质量报告。

前端在 dirty 后 1500 ms debounce upsert，并在 `pagehide`/隐藏前尽力 flush。写入固定捕获的作品/章节目标，StrictMode 下复用 in-flight 写入，保存或放弃前等待在途写入完成，防止正式清理后迟到 UPSERT 重新创建快照。

启动读取会比较作品/章节、基础草稿、版本和正文 hash：

- 基线匹配：允许恢复到编辑器内存，恢复后仍为 dirty，必须再次正式保存；
- 基线冲突：禁止静默覆盖，只允许查看差异、复制、导出或另存候选草稿；
- 正式保存成功、明确放弃、另存候选、明确删除或章节永久删除：只清理精确目标快照；
- 保存失败、离开取消、窗口关闭取消、数据库忙或仅恢复未保存：保留快照。

## 8. Leave Guard 时序

章节切换、创建章节、草稿采用、Hash 路由变化、程序导航和窗口关闭共用 `useWorkspaceLeaveGuard`。当正文 dirty 时：

```text
离开请求
→ 若已有决策则忽略后续请求
→ 显示保存并继续 / 放弃并继续 / 取消
→ 保存路径先等待恢复快照 flush
→ 原子保存成功后清理精确快照并执行一次 continueAction
→ 保存失败或取消时留在原目标并保持 dirty/recovery
```

`createHashRouter` 提供真实路由 blocker，保留原 Hash URL。保存中的重复 Ctrl+S、重复关闭或多个离开请求共享/拒绝重复的 in-flight 行为，不会弹出第二个有效决策、保存两次或导航两次。正文不可用时采用“继续离开/取消”分支，继续离开不会删除恢复快照或覆盖持久正文。

## 9. Tauri 关闭处理

启用了 Tauri v1 的 `window-close` allowlist。`appWindow.onCloseRequested` 首先 `preventDefault()`，再进入同一 Leave Guard。允许关闭时只设置一次 bypass 标记并调用一次 `appWindow.close()`；第二次原生 close 事件消费 bypass 后直接放行，防止递归弹窗。取消或保存失败时窗口保持打开。

## 10. operationId 幂等实现

`draft_save_operations.operation_id` 是数据库主键，请求的目标身份、基础身份、正文 hash、字数、来源和标题共同生成稳定 request hash：

- 相同 operationId、相同请求且已完成：返回第一次持久化的真实结果，并标记 idempotent replay；
- 相同 operationId、不同请求：返回 `OPERATION_PAYLOAD_CONFLICT`；
- 状态为 `started`：返回可重试的 `OPERATION_IN_PROGRESS`；
- 新保存：operation 与正文、chunks、草稿引用在同一事务内完成。

前端对同一未确认保存重试复用 operationId；只有取得权威成功结果后才清除该重试身份。提交状态未知会返回 `DATABASE_COMMIT_UNKNOWN`，调用方可以使用同一 operationId 安全重试。

## 11. 后端拆分范围

只拆分 v2.2.0 直接涉及的新链路：

- Command：`commands/drafts.rs`、`commands/recovery.rs`，负责 Tauri 参数和 DTO 边界；
- Service：`draft_service.rs`、`recovery_service.rs`，负责业务验证、事务、幂等和错误映射；
- Repository：draft、large text、recovery 三个 repository，负责 SQL、映射和 affected rows；
- Infrastructure：`migrations.rs` 和 `errors.rs`。

旧 command 未被全面迁移；旧大文本辅助入口仍保留兼容，但草稿写入不再注册旧的 create/update 命令，旧 finalize/ref 更新也拒绝绕过新原子草稿入口。

## 12. 新增测试

Vitest + React Testing Library + user-event + jsdom 已接入，并增加 deferred Promise、fake repository/service、fake navigation 和 fake close event。

React 动态用例覆盖 T01～T12：快速 A→B→C 切换的迟到读取隔离、保存成功/失败切换、路由取消、关闭取消/成功、保存期间重复关闭、正文不可用锁定、正常恢复、冲突恢复、精确清理和多离开请求单决策。

Rust/SQLite 临时内存数据库覆盖 DB01～DB16：迁移初始化/重复/checksum、hash 回滚、chunk 中途失败、零行更新、跨章节拒绝、operation 重试/冲突、提交后清理、损坏读取、recovery upsert/精确清理/草稿隔离、旧库升级和 AppError round-trip。另有已采用草稿不可变和前后端字数语义测试。

PowerShell 测试入口先验证目标测试实际被发现，拒绝零测试假绿；任何 Vitest、Cargo 或内部命令非零退出码都会向外传播。

## 13. 验证命令与结果

| 命令 | 结果 |
|---|---|
| `npm run lint` | 通过；0 error，保留 1 条既有 React Hooks warning |
| `npm run build` | 通过；TypeScript 与 Vite production build 成功 |
| `npm run test` | 通过，5/5 |
| `npm run test:workspace-safety` | 通过，5/5 |
| `npm run test:components` | 通过，5/5 |
| `npm run test:workspace-reliability` | 通过，10/10 |
| `npm run test:workspace-recovery` | 通过，前端 8/8，Rust 全套 29/29 |
| `npm run test:large-text-integrity` | 通过，前端 4/4，Rust 全套 29/29 |
| `npm run test:migrations` | 通过，前端 1/1，Rust 全套 29/29 |
| `npm run test:ai-tasks-delete` | 通过；静态检查与运行时 1/1 |
| `npm run test:setting-suggestions` | 通过 |
| `npm run test:quality-workspace` | 通过 |
| `cargo test --manifest-path src-tauri/Cargo.toml` | 通过，29/29 |
| `cargo test --manifest-path src-tauri/Cargo.toml -- --nocapture` | 通过，29/29 |
| `cargo check --manifest-path src-tauri/Cargo.toml` | 通过，保留 10 条既有 Rust warning |
| `git diff --check` | 通过 |
| `git status` | 已检查；仅保留本任务修改，工作区按要求未提交 |
| `npm run tauri build` | 前端和 Rust release 编译通过；本机 WiX `light.exe` 因 Windows Installer Service 不可访问而在 MSI ICE 校验失败 |
| `npx tauri build --bundles nsis` | 通过；生成 `AI Novel Studio_2.2.0_x64-setup.exe` |

NSIS 产物路径：

```text
src-tauri/target/release/bundle/nsis/AI Novel Studio_2.2.0_x64-setup.exe
```

验证未调用真实 AI，也未访问真实用户数据库；Rust 数据库测试全部使用内存 SQLite，前端使用 fake service/repository。

## 14. 旧数据库兼容情况

- 先执行既有 legacy 初始化，再执行正式账本迁移，不要求用户手工改库；
- 旧普通草稿继续从 inline `content` 读取；迁移不改写正文；
- 旧长文本草稿允许 document 目标为旧 draft ID、chapter ID 或 NULL，但前提是 `chapter_drafts.large_text_ref_id` 为权威引用，读取仍执行完整性校验；
- 已被旧草稿引用的 document 会在迁移中修复为规范 draft/content 身份；
- 已采用正文不原地覆盖，v2.1.1 的章节、版本、hash 与结果身份安全门继续有效；
- Tauri 调用失败时不会静默切换 localStorage 伪装成功；浏览器开发模式保留明确的本地降级。

## 15. 保留风险

1. 当前机器的 Windows Installer Service 不可访问，导致全目标 `npm run tauri build` 在 MSI 的 ICE 校验阶段出现 `LGHT0217/LGHT0216`；NSIS v2.2.0 已成功生成。MSI 必须在 Windows Installer 服务正常的发布机或 CI 上重跑。
2. 任务书中的八组桌面手工场景未连接真实用户库执行；自动化已使用临时数据库和故障注入覆盖核心时序，正式发布前仍应在一次性测试配置目录中完成 UI 冒烟。
3. 保留既有 1 条 ESLint Hooks warning、10 条 Rust unused/dead-code warning、Vite 动静态 import 与 500 KiB chunk warning；本任务没有扩大范围清理它们。
4. 浏览器开发模式的 recovery 使用 localStorage，不能提供 SQLite transaction 等级保证；桌面 Tauri 路径是本版本的发布主路径。
5. 本版本没有统一全部历史 command、AI 任务模型或所有错误，只收口正文保存、读取、恢复、迁移和离开保护。

## 16. 是否适合发布

v2.2.0 实现已达到代码合入和候选发布条件：核心写入、读取、恢复、离开保护、迁移与故障注入测试均通过，且已生成可安装的 v2.2.0 NSIS 包。

不建议在未完成以下两项前直接宣布正式发布：

1. 在 Windows Installer 服务正常的发布环境重跑全目标 `npm run tauri build`，确认 MSI 与 NSIS 同时生成；
2. 使用一次性测试数据库完成任务书八组桌面手工场景。

本任务未执行 commit、push、tag 或正式发布。

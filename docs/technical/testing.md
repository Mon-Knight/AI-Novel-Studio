# 测试策略与用例

> 当前版本：v2.2.1（工作区竞态可靠性热修）
> 适用范围：正文变更动态回归、Vitest / React 组件测试、Rust / SQLite 故障路径、Windows 真实 Tauri E2E、前端构建、Tauri 编译、静态文本契约与手动桌面验证。

---

## 1. 测试分层与通过原则

截至 v2.2.1，测试体系在既有正文安全、备份恢复、请求取消、质量历史和章节上下文一致性基础上，增加工作区恢复、统一离开保护、正式迁移账本，以及采用/保存、跨会话恢复候选和原生关闭拒绝的动态竞态验证：

```text
Node 原生安全原语测试（内建 TypeScript 类型剔除 + 可控 deferred Promise）
→ Vitest / React Testing Library（jsdom、fake timer、Hash Router、关闭适配器）
→ Rust / SQLite 测试（临时 Schema、正式迁移、事务与故障注入）
→ WebdriverIO Windows 桌面 E2E（真实 Tauri / Rust IPC / SQLite）
→ TypeScript / ESLint / Rust 编译与 Tauri 构建
→ Windows 桌面手动回归
```

通过原则：

- 竞争、迟到响应、版本冲突、事务回滚和幂等行为必须由动态测试证明。
- PowerShell 字符串匹配脚本只能证明文件、字段或调用结构存在，不能证明运行时行为正确。
- 单次正常路径演示、编译通过或静态文本命中，不能替代竞争与故障注入测试。
- 任一子测试失败，聚合命令和 CI 必须返回非零退出码；不得记录为“通过但有失败”。

---

## 2. v2.2.x 动态测试入口

### 2.1 工作区可靠性专项

```powershell
npm run test:components
npm run test:workspace-reliability
npm run test:workspace-recovery
npm run test:large-text-integrity
npm run test:migrations
```

专项脚本必须运行动态测试并原样传播退出码：

- `components`：正文不可用状态与恢复对话框。
- `workspace-reliability`：T01～T07、T12，覆盖快速切章、保存/取消、Hash 路由与 Tauri 关闭防重入。
- `workspace-reliability` 在 v2.2.1 额外覆盖 close reject 后撤销 bypass、第二次关闭重新阻断，以及 goal-only close 拒绝的 Promise 收口。
- `workspace-recovery`：T09～T11，覆盖 debounce、StrictMode、恢复冲突、内存恢复、精确清理、清理失败后的跨会话候选复用，以及 completed replay 目标被删除或损坏时的失败关闭。
- `large-text-integrity`：前端 fail-closed / operation 重试 / 采用竞态 disposition 与 Rust DB04～DB11；Rust 集成回归分别执行采用先提交和保存先提交两个顺序，并核对最终草稿、章节指针与 operation 状态。
- `migrations`：AppError 契约与 Rust DB01～DB03、DB15～DB16。

`components` 与 `workspace-reliability` 只运行各自定向 Vitest。其余三个入口先运行定向 Vitest，再检查所需 Rust 测试的完整名称是否各自唯一存在，最后运行全量 Rust 测试；因此它们不是 Rust 过滤命令。Cargo 测试发现为 0、名称歧义或任一全量 Rust 回归失败均不得被当作通过。

### 2.2 v2.1.8 及此前 Node / tsx 回归集合

```powershell
npm run test
```

该命令要求 Node.js >= 22.6，先使用原生 `node:test` 与 `--experimental-strip-types`，再使用 `tsx --test` 执行 v2.1.8 及此前的生产安全回归。它不包含 `src/test/**` 下的 v2.2.0 Vitest 用例；v2.2.0 必须同时运行 2.1 节列出的五个专项入口。类型剔除不代替 `tsc` 类型检查。

### 2.3 正文变更安全门定向测试

```powershell
npm run test:workspace-safety
```

该命令定向运行 `src/features/workspace` 下的安全门测试。当前核心测试文件为：

```text
src/features/workspace/documentSafety.test.mjs
```

最低动态覆盖：

- A 章节请求未完成时切换到 B，单调加载 guard 在 commit 前拒绝 A 的迟到 token。
- 请求目标作品 / 章节与当前文档不一致时拒绝应用。
- 基础正文哈希变化时返回冲突。来源草稿 ID / revision 由工作台生产路径校验；编辑器完整水合、归属拒绝和失败保留另有组件模块测试。
- 相同结果、目标、基础哈希和模式生成稳定幂等键；当前工作区会话中重复 claim 被拒绝，应用失败释放后允许重试。

测试必须使用可控 Promise 顺序验证行为，不得退化为读取源码字符串。

### 2.4 Rust / SQLite 全量测试

```powershell
cd src-tauri
cargo test
cd ..
```

发布验收运行完整 Rust 测试；定位正文安全门问题时可定向运行命令模块测试：

```powershell
cd src-tauri
cargo test commands::tests -- --nocapture
cd ..
```

v2.2.0 新增测试覆盖迁移账本、checksum 冲突、长正文事务回滚、operation 幂等、提交后清理、fail-closed 读取、恢复隔离、旧库升级和错误序列化。跨版本场景编号只用于文档分组，Rust 完整测试名是唯一权威标识；迁移组记为 `MIG-DB01`～`MIG-DB03`、`MIG-DB15`～`MIG-DB16`，原子保存组记为 `SAVE-DB04`～`SAVE-DB11`。以下 v2.1.1 用例继续作为回归保留：

| 编号 | 场景 | 预期 |
|------|------|------|
| ADOPT-DB01 | 采用不存在的草稿 | 返回 `target_not_found`，原正式草稿不变 |
| ADOPT-DB02 | 采用其他章节的草稿 | 返回 `target_mismatch`，两章正式草稿均不变 |
| ADOPT-DB03 | 草稿更新影响 0 行 | 返回明确冲突，原正文不变 |
| DB-ADOPT | 正式采用中途失败 | 单一事务整体回滚，不出现 0 个或多个正式草稿 |
| DB-META | 正式采用成功 | 草稿、章节正式指针与章节元数据保持一致 |
| AI-TASK | AI 任务删除 | 使用完整临时 Schema 清理可删除任务的子表引用；completed 质量报告引用的 Task 在单删、批量和清空时均受保护，混合操作整体拒绝 |

也可按测试名过滤单项运行，例如：

```powershell
cd src-tauri
cargo test db01_adopt_missing_draft_preserves_existing_adoption -- --nocapture
cargo test db02_adopt_cross_chapter_draft_preserves_both_chapters -- --nocapture
cargo test db03_update_zero_rows_returns_conflict_and_preserves_content -- --nocapture
cargo test adopt_chapter_draft_rolls_back_when_chapter_update_fails -- --nocapture
cd ..
```

AI 任务删除仍保留 npm 入口：

```powershell
npm run test:ai-tasks-delete
npm run test:ai-tasks-delete:runtime
```

组合入口先执行静态契约，再执行运行时测试；运行时入口必须传播内部 `cargo test` 的失败退出码。

### 2.5 v2.1.2 完整项目备份恢复测试

```powershell
npm run test:project-backup
```

该入口运行 `project_backup_` Rust 测试。完整往返场景在同一临时 SQLite 项目库中执行“导出 -> 清空项目数据 -> 导入 -> 全量比对”，避免把“新建数据库”误当成已验证语义。

| 编号 | 场景 | 预期 |
|------|------|------|
| BK01 | 完整备份往返 | 清空临时项目数据后恢复为新作品；按 ID 映射规范化后，重新导出的全部项目记录与备份一致，并通过外键检查 |
| BK02 | 无效关联 ID | 导入失败，目标库中不留下部分项目记录 |
| BK03 | 篡改大文本校验值 | 导入失败，目标库中不留下部分项目记录 |
| BK04 | 源数据大文本已损坏 | 导出被拒绝，不生成无法恢复的完整备份 |

该组测试证明 SQLite 范围内的事务恢复和全量数据比较；它不替代浏览器 LocalStorage 与 Tauri 的跨存储端到端测试。

### 2.6 v2.1.4 大文本正文安全测试

```powershell
cd src-tauri
cargo test large_text -- --test-threads=1
cd ..

npx tsx --test src/components/workspace/EditorArea.test.tsx
```

| 编号 | 场景 | 预期 |
|------|------|------|
| LEGACY-LT-DB04 | 整文 SHA-256 不匹配 | 校验失败，document、chunks、draft 均无新增 |
| LEGACY-LT-DB05 | 数据库已提交但缓存清理失败 | 正文保持 committed，返回 cleanup warning，不报告为可盲重试失败 |
| LEGACY-LT-DB06 | draft create / update 在 document 写入后失败 | 同事务整体回滚，不留下新 document 或错误引用 |
| LEGACY-LT-DB07 | 缺片、片 hash / 元数据错误或已存 chunk 损坏 | 保存或读取失败，不返回预览全文 |
| DB-LIFECYCLE | 连续更新、转小文本、删除草稿 | 旧 document 仅在不再被引用时删除，chunks 级联清理 |
| DB-UNICODE | 中文、emoji、CRLF | 全文、Unicode 字符数、UTF-8 字节数和完整字数一致 |

编辑器模块测试覆盖 loading / error 时保留已知安全内容、只接受归属当前作品章节的完整草稿，以及已验证无草稿章节的安全清空。它通过 Vite SSR 加载真实 `EditorArea` 模块，不以源码字符串匹配代替行为。

### 2.7 v2.1.5 任务重启恢复测试

```powershell
cd src-tauri
cargo test startup_task_recovery -- --test-threads=1
cargo test generation_job -- --test-threads=1
cd ..

npm run test:e2e -- --spec restart-task-recovery
```

| 编号 | 场景 | 预期 |
|------|------|------|
| REC01 | 启动时存在 `pending` / `running` / `retrying` 任务 | 同一事务结算为 `failed`，错误码为 `APP_RESTART_INTERRUPTED`，原进度和结果保留 |
| REC02 | 恢复 checkpoint 插入失败 | 任务更新整体回滚，不留下半恢复状态 |
| REC03 | 对同一数据库再次执行恢复 | 返回 0，终态和 checkpoint 数量均不变 |
| REC04 | 取消后的迟到完成、终态复活或进度倒退 | Rust 状态机拒绝写入 |
| REC05 | 重复 step ID 与同时间戳结果 | ID 不可覆盖，读取顺序按时间和 ID 稳定 |
| REC-E2E | Mock AI 请求暂停后重启真实 Tauri 应用 | 同一隔离 SQLite 中任务安全终结；对话框、保留 checkpoint、二次启动幂等、零外网和零残留均成立 |

恢复测试只证明 `generation_jobs` 的安全中断结算，不证明不确定步骤可以自动续跑。E2E pause gate 只存在于 `VITE_AI_NOVEL_STUDIO_E2E=1` 的专用前端构建中，生产构建不可用。

### 2.8 v2.1.6 在途请求取消测试

```powershell
npm run test
cd src-tauri
cargo test ai::tests -- --test-threads=1
cd ..
npm run test:e2e -- --spec generation-job-cancel
```

| 编号 | 场景 | 预期 |
|------|------|------|
| CAN01 | 慢速 loopback HTTP 请求取消 | 2 秒内返回 `AI_REQUEST_CANCELLED`，服务端观察到连接关闭 |
| CAN02 | 请求注册前立即取消 | tombstone 阻止网络 dispatch，完成后注册表清理 |
| CAN03 | 重复 ID、重复取消与 future drop | 第二请求不发出；取消幂等；future 被丢弃时 HTTP 仍中止 |
| CAN04 | 正常响应与超时 | token 统计保持；超时不误分类为用户取消 |
| CAN05 | 浏览器 fetch 与 Mock gate / delay | caller abort、timeout 分类不同；waiter 立即移除 |
| CAN06 | 质量检查取消 | 对应旧 AI 任务为 `cancelled`，迟到成功不能复活终态 |
| CAN07 | 取消 IPC 延迟、失败或不结算 | 未确认且原请求仍在途时不结算；IPC 失败时等待原请求结束且诊断不含底层错误；原请求已安全结算后不再被卡住的 IPC 阻塞 |
| CAN08 | `2xx` 非法 JSON | Rust 与浏览器固定返回解析错误，不携带 provider body |
| CAN-E2E | UI 取消正文与质量请求 | 唯一取消 checkpoint；正文不新增草稿；质量保留既有草稿、AI task 取消且无 pending 报告；零外网和零残留 |

Rust loopback 只绑定 `127.0.0.1`，测试构建显式绕过系统代理，不访问互联网；生产代理行为不变。真实桌面取消 spec 使用强制 Mock Provider，因此负责验证 React、AbortSignal、Rust/SQLite 任务终态与 WebView 生命周期，不用它替代真实 socket 关闭测试。

### 2.9 v2.1.7 质量历史原子快照与重放

```powershell
npm run test
cd src-tauri
cargo test --locked quality_ -- --test-threads=1
cd ..
npm run test:e2e -- --spec quality-history-replay
```

| 编号 | 场景 | 预期 |
|------|------|------|
| QH01 | 同 issue key 连续出现 | 每份报告创建不同 item ID，旧成员和原始字段不变 |
| QH02 | 第 N 条 item / state 写入故障 | report、items、states 与 completed 终态整体回滚 |
| QH03 | 更新 pending / failed 报告 | 不遮挡最近 completed 报告，也不错误阻止当前完整报告刷新状态 |
| QH04 | 旧报告在新报告 resolved 后迟到 | 旧快照正常保存，当前 workflow state 不被重置 |
| QH05 | 历史 item 状态修改 | 单条和批量都返回 `quality_issue_history_read_only` |
| QH06 | 缺失、运行中、错误类型或错误归属的 AI Task | 整份报告拒绝且无部分写入 |
| QH07 | schema 2 完整备份恢复 | 恢复事务内合成缺失 states，行为不依赖重启 |
| QH08 | 删除 completed 报告引用的 AI Task | 单删、混合批量和清空都在写入前整体拒绝，报告绑定与其他任务不变 |
| QH09 | LocalStorage 当前状态更新与幂等重试 | 独立 state 集合覆盖当前视图，不改写历史 item；Task 不一致拒绝，旧报告重试返回原始快照 |
| QH10 | schema 2 多报告缺少 `sort_order` | 每份报告分别从 0 编号，状态按旧 item 最后更新时间合成 |
| QH-E2E | 两次 Mock 质检、DOM 修改状态后重启真实 Tauri 应用 | 当前 resolved 计数提交，两份原始快照不变；分别回放 report / draft / hash / Task / items，历史只读、零外网、零错误与零残留 |

LocalStorage 回退测试使用同一 completed 过滤、report 次序、snapshot `sortOrder`、独立 workflow state、幂等 Task 和迟到竞态契约，并覆盖旧 item 状态合成。它只验证浏览器开发回退，真实发布门禁仍以 Rust / SQLite 和 Windows Tauri E2E 为准。

### 2.10 v2.1.8 章节上下文持久化一致性

```powershell
npm run test

cd src-tauri
cargo test
cd ..

npm run test:e2e -- --spec chapter-context-persistence
```

| 编号 | 场景 | 预期 |
|------|------|------|
| CTX01 | 调用方指定上下文 UUID 后创建、读取、更新、过期和删除 | SQLite 与返回 DTO 始终使用同一 ID；更新未命中或归属错误明确失败 |
| CTX02 | Tauri IPC 在创建、更新或查询时失败 | 错误向上传播，旧 LocalStorage 集合不新增、不改写，也不返回伪成功 DTO |
| CTX03 | summary、context、character state 或 chapter status 的第 N 步失败 | 同一 SQLite 事务整体回滚，不留下半完成总结或 `summarized` 终态 |
| CTX04 | 作品、章节、已采用草稿或角色归属不一致 | bundle 在任何业务写入前拒绝，相关作品数据保持不变 |
| CTX05 | 同一作品存在多章及同章历史总结 | 以章节次序和 `updated_at / created_at / id` 稳定排序，每次查询都确定性选择同一份每章最新总结 |
| CTX06 | 旧 LocalStorage 与 SQLite 存在同 ID、不同 ID 镜像、重复或歧义记录 | 迁移幂等；唯一镜像映射而不复制；歧义保留并 warning；提交失败不清理缓存 |
| CTX07 | 浏览器 LocalStorage bundle 中途写入失败 | 恢复总结、上下文和角色状态全部快照，错误返回调用方 |
| CTX08 | 已有总结后采用另一版正文，或事务中途注入失败 | 正文采用、章节状态、总结与上下文过期同事务提交或整体回滚；重采同一正文不误过期 |
| CTX09 | 旧角色状态插入或确定性匹配，但 `characters.current_state` 陈旧 | 同一迁移事务按 `created_at DESC, id DESC` 重算当前状态，重复迁移仍能修复且不复制历史 |
| CTX10 | 浏览器采用新正文时上下文过期写入失败 | 草稿采用状态、总结和上下文集合全部恢复到采用前快照，错误返回调用方 |
| CTX-E2E | UI 保存上下文后重启，采用新正文后不打开总结面板即读取和生成，再次重启 | 同一 SQLite 记录和 ID 重启后可见；采用返回时旧记录已过期；生成来源计数立即为零且重启后不反弹；零外网、零前端错误、零残留进程 |

Node 测试负责区分 Tauri 与浏览器运行模式并验证“桌面失败绝不写缓存”和浏览器补偿；Rust 测试负责 SQLite 事务、归属、稳定 ID、查询及迁移；真实桌面 E2E 只通过 React、Tauri IPC 和隔离 SQLite 完成业务写入。三层证据不可互相替代。

### 2.11 Windows 真实桌面 E2E

```powershell
# 启动、窗口、迁移和前端异常冒烟测试
npm run test:e2e:smoke

# 全部独立桌面核心流程
npm run test:e2e

# 定向运行一个独立场景（扩展名可省略）
npm run test:e2e -- --spec candidate-review-apply
```

该入口使用 WebdriverIO、`tauri-driver`、匹配 WebView2 的 EdgeDriver 和真实 Tauri release EXE。每个 suite 在独立 `.e2e-tools/target` 中构建一次带 Cargo `e2e` feature 的应用，每个 spec 独立启动该 suite 的 staged EXE，并使用独立临时 SQLite、WebView2 profile、单实例状态目录和自动选择的空闲 driver 端口；正常业务写入仍通过 React UI、Tauri IPC 与 Rust command 完成。测试桥只提供受限验收查询，以及仅限隔离 E2E 库的大文本故障注入。

E2E feature、运行时标记和逐 spec run-id marker 必须同时匹配，SQLite 实际路径也会通过只读诊断复核。固定 `fixtures/data.ts` 和显式 spec 清单提供确定性输入；每个场景从空库经 UI 建立自己的数据，既不依赖执行顺序，也可以用 `--spec` 单独运行。

AI 设置在 E2E 构建中强制返回 Mock Provider。前端还在 `App` 加载前安装 WebView 网络 guard，在请求发出前拦截外部 `fetch`、XHR、WebSocket、EventSource 和 beacon；Rust AI IPC 是第二层阻断。每个测试都会生成 `frontend-diagnostics.json`，运行器独立校验 console error、未处理异常、guard 状态和网络尝试计数，任何异常都会把场景改判失败，不能被业务 fallback 或 WDIO 零退出码掩盖。该机制不等于操作系统防火墙；当前流程只使用本机 WebDriver loopback 端口，不依赖互联网。

作品保存测试通过受限 IPC 打开第二个 `SQLITE_OPEN_READ_ONLY | SQLITE_OPEN_NO_MUTEX` SQLite 连接，检查作品行数、标题和更新时间；它不复用全局写连接，可以证明事务对独立读连接可见并且没有重复写入。进程快照、残留进程、临时目录或 suite 根目录的清理无法可靠完成时，运行器按失败处理，且不会继续执行可能受污染的后续 spec。

当前自动化流程：

| Spec | 流程 |
|------|------|
| `app-start.spec.ts` | 应用启动、`app-shell`、迁移、SQLite 健康与前端异常 |
| `project-create-open.spec.ts` | 创建作品、返回列表并打开 |
| `project-edit-save.spec.ts` | 修改作品信息，验证保存不挂起、提交且不重复写入 |
| `chapter-save.spec.ts` | 显式创建卷和章节、保存正文、切换页面并重新打开 |
| `large-text-save.spec.ts` | 184KB 中文 / emoji / CRLF 正文保存、重开、采用、全文与 SHA 核对，以及损坏分片失败关闭 |
| `candidate-review-apply.spec.ts` | Mock AI 候选、约束审查、确认采用、页面字数同步与重复采用幂等 |
| `leave-guard.spec.ts` | 未保存离开保护的取消、保存并离开及放弃修改分支 |
| `generation-job-cancel.spec.ts` | 分别暂停正文和质量 Mock AI 后从 UI 取消；唯一 checkpoint、waiter 清理、正文无新草稿、质量保留既有草稿且无 pending 报告，并验证无迟到完成 |
| `restart-task-recovery.spec.ts` | 暂停 Mock AI、真实进程重启、恢复对话框、同一任务安全终结及二次启动幂等 |
| `quality-history-replay.spec.ts` | 连续两次固定 Mock 质检，重启真实应用后分别回放两份不可变报告，校验只读历史、Task 追溯、稳定 item ID 与当前计数 |
| `chapter-context-persistence.spec.ts` | 保存章节总结与上下文后重启，校验稳定 ID 和同一内容；持久化过期后再次重启，证明后续生成不再读取该记录 |

测试通过 `data-testid`、元素状态、HashRouter 和 Tauri IPC 定位与断言，不使用中文文本、CSS 类、DOM 层级、屏幕坐标或截图识别。`frontend-diagnostics.json`、WebdriverIO、driver / Rust 日志、数据库位置和进程清理结果都会写入诊断目录；失败时在会话仍可访问的前提下尽力追加 DOM、当前路由和截图。

完整 Windows 前置条件、环境变量、数据隔离、Mock / 网络阻断、选择器契约和排障见 [Windows 桌面 E2E 自动化](desktop-e2e.md)。

GitHub Actions 的 `windows-desktop-e2e.yml` 在 Pull Request 与 `main` 推送时运行质量门和真实桌面 smoke；`v*` tag、每周定时和手动完整模式运行全部桌面流程，手动 `full-three` 可执行连续三轮稳定性验证。CI 在依赖准备阶段匹配 WebView2 与 EdgeDriver，随后以 Cargo / npm offline 模式构建并运行 E2E；失败诊断作为短期 artifact 上传。

---

## 3. 静态文本契约检查

```powershell
npm run test:setting-suggestions
npm run test:quality-workspace
npm run test:ai-tasks-delete:static
```

对应脚本：

```text
scripts/agent-workflow/check_setting_suggestions.ps1
scripts/agent-workflow/check_quality_workspace.ps1
scripts/agent-workflow/check_ai_task_delete.ps1
```

这些脚本适合检查：

- 目标文件、路由、字段、命令注册和关键调用是否存在。
- 候选状态、质量快照字段和任务删除入口是否仍保留。
- 明确禁止的旧 fallback 或危险字符串结构是否重新出现。

这些脚本不能证明：

- 快速切换章节时异步响应不会串线。
- 未保存正文不会丢失。
- apply 会校验目标、基础版本和幂等状态。
- SQLite 多步写入失败时会整体回滚。
- 取消、超时、进程重启和桌面 WebView 生命周期行为正确。

因此，静态检查通过只能作为补充证据，不能单独满足 v2.2.0 发布验收。

---

## 4. 基础构建与质量命令

```powershell
# npm / Cargo / Tauri / UI 与当前文档版本同步
npm run test:version-sync

# ESLint
npm run lint

# TypeScript 类型检查 + 前端生产构建
npm run build

# Rust 编译检查
cd src-tauri
cargo check
cd ..

# Tauri 完整构建
npm run tauri:build
```

项目辅助脚本：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/agent-workflow/check_docs_sync.ps1
powershell -ExecutionPolicy Bypass -File scripts/agent-workflow/verify_project.ps1
```

`verify_project.ps1` 会顺序运行版本同步、Node 测试、ESLint、前端构建、静态补充检查、AI Task 删除和项目备份运行时测试、`cargo check`、完整 `cargo test`、完整桌面 E2E、Tauri 生产构建、清单与 Git 状态。任一步失败或工作树不干净都返回非零；`release_workflow.ps1` 会再次检查干净工作树，不能从未提交修改获得发布建议。

辅助脚本不替代第 2 节的定向动态测试。发布汇报必须逐项记录真实命令、退出码与失败信息，不能只写“综合验证通过”。

---

## 5. v2.2.0 手动安全回归

### 5.1 迟到响应与章节切换

1. 在章节 A 启动可延迟的 Mock AI 生成。
2. 在响应完成前切换到章节 B，并在 B 输入不同正文。
3. 让 A 的响应完成。
4. 确认结果只属于 A；B 的正文、当前草稿、dirty 状态均不变化。
5. 使用 A→B→C 快速切换并改变返回顺序，确认 C 始终显示 C。

### 5.2 未保存正文保护

1. 修改当前正文但不保存。
2. 分别尝试切换章节、切换项目、应用 replace 结果和确认采用。
3. 验证保存 / 丢弃 / 取消语义一致。
4. 注入保存失败，确认仍停留在当前文档且 dirty 状态保留。

### 5.3 版本冲突与重复应用

1. 基于正文 v1 生成结果。
2. 将正文修改为 v2 后尝试 append 与 replace。
3. 确认两种模式均拒绝旧基础版本结果，不覆盖 v2。
4. 对同一结果快速双击，并在重新打开面板后再次应用。
5. 确认正文只变化一次，重复操作得到明确的已应用提示。

### 5.4 正式采用

1. 采用当前章节的合法候选草稿，确认仅一个正式草稿且章节指针同步。
2. 尝试采用其他章节草稿，确认两章均不变化。
3. 在事务中途注入失败，确认采用状态整体回滚。

### 5.5 长正文、恢复与桌面关闭

1. 保存超过 100 KB 的正文，重启后确认全文、字数和哈希一致；破坏测试库分片后确认编辑器进入不可用状态。
2. 输入未保存正文并等待恢复快照更新，模拟异常退出；重新打开后分别验证匹配恢复和旧基线冲突。
3. 对章节切换、侧栏导航、浏览器式前进后退和 Tauri 窗口关闭分别选择保存、放弃、取消。
4. 保存期间重复触发关闭，确认只出现一个决策、一次保存和一次最终关闭。

---

## 6. 其他功能手动抽查

### 6.1 设定库 AI 推演

1. 使用 Mock 模式生成角色候选。
2. 原样采纳、编辑后采纳和废弃各一个候选。
3. 确认状态分别为 `adopted`、`edited_adopted`、`discarded`。
4. 再次采纳已处理候选，应被阻止。

### 6.2 导出功能

1. 进入 `/import-export`。
2. 分别导出 TXT、Markdown 和完整项目 JSON 备份。
3. 导入完整备份，确认原作品不被覆盖，恢复结果作为新作品出现。
4. 确认桌面模式出现保存位置选择，成功后显示保存路径。

### 6.3 桌面布局

1. 使用 1280 × 820 默认窗口检查主要页面。
2. 最大化到 2K 屏幕，确认内容宽度受控。
3. 缩窄到最小尺寸附近，确认布局正常换行。

---

## 7. 当前测试限制

- Node 安全原语、React 组件 / Hash Router / close adapter、SQLite 故障注入与真实 Windows Tauri E2E 已形成分层动态覆盖；更广泛的页面级并发场景仍需继续补齐。
- v2.2.0 已统一章节操作、HashRouter 导航与 Tauri 原生窗口 close-request 的可恢复离开保护；其他非正文工作流尚未全部接入。
- 当前动态测试已证明会话级幂等 claim / release、`generation_jobs` 重启后的安全终结，以及其中正文生成和质量检查请求的真实取消；跨重启自动续跑和其他 AI 工具仍需要各自的取消、attempt / operation 记录与副作用幂等协议。
- Windows 桌面自动化采用 WebdriverIO + Tauri Driver，不计划用 Playwright 浏览器页面或截图式 Computer Use 替代真实 Tauri E2E。
- `recovery-dialog` 已作为 `generation_jobs` 的真实启动恢复节点纳入桌面 E2E；其他 AI 任务模型仍不得为测试伪造恢复能力。
- 当前产品没有名为 `Artifact`、`PlacementProposal` 或 `ApplyPlan` 的持久化实体；候选测试只按现有模型验证草稿、AI 任务、目标 / 基础正文绑定、采用状态和幂等，不能把这些等价约束写成不存在的实体状态。
- `operationId` 的数据库级重放、completed 目标权威复验与提交后清理故障已由 service 测试证明；真实 IPC 进程在提交边界被强制终止时的端到端对账仍需继续补充。
- 大文本 DB04～DB07、章节工程任务跨重启安全结算、在途 AI 取消与质量历史不可变重放已由 Rust / SQLite 和真实 Tauri 故障场景覆盖；自动续跑和持久正文锁定模型尚未纳入本版本自动化门槛。
- 完整备份的 SQLite 往返已在同一临时项目库中覆盖；SQLite 与 LocalStorage 的跨存储 ACID 不存在，前端补偿撤销尚未由真实 Tauri + 浏览器存储端到端测试覆盖。
- v2.1.8 已把章节总结、上下文和角色状态的桌面事实源收敛到 SQLite；旧缓存清理仍发生在 SQLite 提交之后，因此只能通过明确 ID 映射、warning 和幂等重试保证安全，不宣称跨存储 ACID。
- Tauri 完整构建依赖本机 Rust 与 Windows 构建环境。

发布结论必须准确区分“已由自动化证明”“仅手动验证”和“尚未覆盖”。

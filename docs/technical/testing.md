# 测试策略与用例

> 当前版本：v3.0.0（Multi-Agent 自主创作闭环）
> 适用范围：AI Task/Attempt/Snapshot/Artifact 执行事实、可靠取消与请求治理、真实流式预览、参考资料与分层风格、混合语义 Memory、跨进程三档调度、多目标事务与正式故事资产、正文变更动态回归、性能基准、真实浏览器模式 E2E、Windows 真实 Tauri E2E、签名更新发布、前端构建与 Rust/Tauri 编译。

---

## 1. 测试分层与通过原则

截至 v3.0.0，测试体系在执行事实、Safe Apply、Compiler/Registry 与持久 Planner 基础上，增加 Multi-Agent 并发与共识、12～500 章自主规划、可靠取消 / 流式 / 成本治理、参考资料与风格画像、混合语义 Memory、跨进程 scheduler、多目标事务、正式资产、性能基准、SQLite 事实、工作台交互与备份 schema 9 验证：

```text
Node 原生安全原语测试（内建 TypeScript 类型剔除 + 可控 deferred Promise）
→ Vitest / React Testing Library（jsdom、fake timer、Hash Router、关闭适配器）
→ Rust / SQLite 测试（临时 Schema、正式迁移、事务与故障注入）
→ WebdriverIO 浏览器 E2E（真实 Vite + Chromium/Edge，无 Tauri bridge）
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

## 2. 动态测试入口（v2.2.x～当前 v3.0.0）

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

#### 统一前端入口与覆盖率门禁

```powershell
npm run test:all
npm run test:coverage
npm run test:component-size
npm run lint:ci
```

- `test:all` 顺序运行 Node/tsx 动态测试、三个隔离 AI 面板组、Vitest 自动发现的全部 `src/test/**` 与服务测试，以及性能基准，避免新增专项只存在于文档而未进入 CI。
- `test:coverage` 使用 C8 对生产 `src/**/*.ts` 与 `src/**/*.tsx` 建立全量文件基线；测试文件、声明文件与 `src/test/**` 不计入分母。
- `test:component-size` 扫描全部生产 `.tsx`，要求每个文件不超过 500 行；它不允许通过增加排除规则或提高阈值来绕过组件拆分。
- 当前全量非回退阈值为 lines/statements 34%、functions 44%、branches 64%；核心逻辑集合另设 lines/statements 85%、functions/branches 80%。最近一次完整结果为全量 lines/statements 34.32%、functions 44.13%、branches 64.05%，核心集合 lines/statements 87.82%、functions 85.89%、branches 82.01%。这些阈值是当前可验证基线，不是最终质量目标；后续补测必须单调提高。
- `lint:ci` 将显式 `any` 作为 error，并以 `--max-warnings 0` 运行；生产源码 warning 回归会直接返回非零退出码。
- `workspaceSessionStore.test.ts` 验证切换 novel 时清空 active chapter、当前草稿与 dirty，并覆盖可追踪的函数式集合更新；同一 reset 契约还统一持有质量和 AI 弹窗状态，该 Zustand store 已进入核心覆盖率集合。
- Pull Request、`main` 推送和发布构建都执行上述门禁；覆盖率或 warning 数发生回退时命令返回非零退出码。

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

| 编号       | 场景               | 预期                                                                                                                       |
| ---------- | ------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| ADOPT-DB01 | 采用不存在的草稿   | 返回 `target_not_found`，原正式草稿不变                                                                                    |
| ADOPT-DB02 | 采用其他章节的草稿 | 返回 `target_mismatch`，两章正式草稿均不变                                                                                 |
| ADOPT-DB03 | 草稿更新影响 0 行  | 返回明确冲突，原正文不变                                                                                                   |
| DB-ADOPT   | 正式采用中途失败   | 单一事务整体回滚，不出现 0 个或多个正式草稿                                                                                |
| DB-META    | 正式采用成功       | 草稿、章节正式指针与章节元数据保持一致                                                                                     |
| AI-TASK    | AI 任务删除        | 使用完整临时 Schema 清理可删除任务的子表引用；completed 质量报告引用的 Task 在单删、批量和清空时均受保护，混合操作整体拒绝 |

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

| 编号 | 场景               | 预期                                                                                                 |
| ---- | ------------------ | ---------------------------------------------------------------------------------------------------- |
| BK01 | 完整备份往返       | 清空临时项目数据后恢复为新作品；按 ID 映射规范化后，重新导出的全部项目记录与备份一致，并通过外键检查 |
| BK02 | 无效关联 ID        | 导入失败，目标库中不留下部分项目记录                                                                 |
| BK03 | 篡改大文本校验值   | 导入失败，目标库中不留下部分项目记录                                                                 |
| BK04 | 源数据大文本已损坏 | 导出被拒绝，不生成无法恢复的完整备份                                                                 |

该组测试证明 SQLite 范围内的事务恢复和全量数据比较；它不替代浏览器 LocalStorage 与 Tauri 的跨存储端到端测试。

### 2.6 v2.1.4 大文本正文安全测试

```powershell
cd src-tauri
cargo test large_text -- --test-threads=1
cd ..

npx tsx --test src/components/workspace/EditorArea.test.tsx
```

| 编号           | 场景                                         | 预期                                                           |
| -------------- | -------------------------------------------- | -------------------------------------------------------------- |
| LEGACY-LT-DB04 | 整文 SHA-256 不匹配                          | 校验失败，document、chunks、draft 均无新增                     |
| LEGACY-LT-DB05 | 数据库已提交但缓存清理失败                   | 正文保持 committed，返回 cleanup warning，不报告为可盲重试失败 |
| LEGACY-LT-DB06 | draft create / update 在 document 写入后失败 | 同事务整体回滚，不留下新 document 或错误引用                   |
| LEGACY-LT-DB07 | 缺片、片 hash / 元数据错误或已存 chunk 损坏  | 保存或读取失败，不返回预览全文                                 |
| DB-LIFECYCLE   | 连续更新、转小文本、删除草稿                 | 旧 document 仅在不再被引用时删除，chunks 级联清理              |
| DB-UNICODE     | 中文、emoji、CRLF                            | 全文、Unicode 字符数、UTF-8 字节数和完整字数一致               |

编辑器模块测试覆盖 loading / error 时保留已知安全内容、只接受归属当前作品章节的完整草稿，以及已验证无草稿章节的安全清空。它通过 Vite SSR 加载真实 `EditorArea` 模块，不以源码字符串匹配代替行为。

### 2.7 v2.1.5 任务重启恢复测试

```powershell
cd src-tauri
cargo test startup_task_recovery -- --test-threads=1
cargo test generation_job -- --test-threads=1
cd ..

npm run test:e2e -- --spec restart-task-recovery
```

| 编号    | 场景                                               | 预期                                                                                        |
| ------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| REC01   | 启动时存在 `pending` / `running` / `retrying` 任务 | 同一事务结算为 `failed`，错误码为 `APP_RESTART_INTERRUPTED`，原进度和结果保留               |
| REC02   | 恢复 checkpoint 插入失败                           | 任务更新整体回滚，不留下半恢复状态                                                          |
| REC03   | 对同一数据库再次执行恢复                           | 返回 0，终态和 checkpoint 数量均不变                                                        |
| REC04   | 取消后的迟到完成、终态复活或进度倒退               | Rust 状态机拒绝写入                                                                         |
| REC05   | 重复 step ID 与同时间戳结果                        | ID 不可覆盖，读取顺序按时间和 ID 稳定                                                       |
| REC-E2E | Mock AI 请求暂停后重启真实 Tauri 应用              | 同一隔离 SQLite 中任务安全终结；对话框、保留 checkpoint、二次启动幂等、零外网和零残留均成立 |

恢复测试只证明 `generation_jobs` 的安全中断结算，不证明不确定步骤可以自动续跑。E2E pause gate 只存在于 `VITE_AI_NOVEL_STUDIO_E2E=1` 的专用前端构建中，生产构建不可用。

### 2.8 v2.1.6 在途请求取消测试

```powershell
npm run test
cd src-tauri
cargo test ai::tests -- --test-threads=1
cd ..
npm run test:e2e -- --spec generation-job-cancel
```

| 编号    | 场景                              | 预期                                                                                                              |
| ------- | --------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| CAN01   | 慢速 loopback HTTP 请求取消       | 2 秒内返回 `AI_REQUEST_CANCELLED`，服务端观察到连接关闭                                                           |
| CAN02   | 请求注册前立即取消                | tombstone 阻止网络 dispatch，完成后注册表清理                                                                     |
| CAN03   | 重复 ID、重复取消与 future drop   | 第二请求不发出；取消幂等；future 被丢弃时 HTTP 仍中止                                                             |
| CAN04   | 正常响应与超时                    | token 统计保持；超时不误分类为用户取消                                                                            |
| CAN05   | 浏览器 fetch 与 Mock gate / delay | caller abort、timeout 分类不同；waiter 立即移除                                                                   |
| CAN06   | 质量检查取消                      | 对应旧 AI 任务为 `cancelled`，迟到成功不能复活终态                                                                |
| CAN07   | 取消 IPC 延迟、失败或不结算       | 未确认且原请求仍在途时不结算；IPC 失败时等待原请求结束且诊断不含底层错误；原请求已安全结算后不再被卡住的 IPC 阻塞 |
| CAN08   | `2xx` 非法 JSON                   | Rust 与浏览器固定返回解析错误，不携带 provider body                                                               |
| CAN-E2E | UI 取消正文与质量请求             | 唯一取消 checkpoint；正文不新增草稿；质量保留既有草稿、AI task 取消且无 pending 报告；零外网和零残留              |

Rust loopback 只绑定 `127.0.0.1`，测试构建显式绕过系统代理，不访问互联网；生产代理行为不变。真实桌面取消 spec 使用强制 Mock Provider，因此负责验证 React、AbortSignal、Rust/SQLite 任务终态与 WebView 生命周期，不用它替代真实 socket 关闭测试。

### 2.9 v2.1.7 质量历史原子快照与重放

```powershell
npm run test
cd src-tauri
cargo test --locked quality_ -- --test-threads=1
cd ..
npm run test:e2e -- --spec quality-history-replay
```

| 编号   | 场景                                              | 预期                                                                                                                      |
| ------ | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| QH01   | 同 issue key 连续出现                             | 每份报告创建不同 item ID，旧成员和原始字段不变                                                                            |
| QH02   | 第 N 条 item / state 写入故障                     | report、items、states 与 completed 终态整体回滚                                                                           |
| QH03   | 更新 pending / failed 报告                        | 不遮挡最近 completed 报告，也不错误阻止当前完整报告刷新状态                                                               |
| QH04   | 旧报告在新报告 resolved 后迟到                    | 旧快照正常保存，当前 workflow state 不被重置                                                                              |
| QH05   | 历史 item 状态修改                                | 单条和批量都返回 `quality_issue_history_read_only`                                                                        |
| QH06   | 缺失、运行中、错误类型或错误归属的 AI Task        | 整份报告拒绝且无部分写入                                                                                                  |
| QH07   | schema 2 完整备份恢复                             | 恢复事务内合成缺失 states，行为不依赖重启                                                                                 |
| QH08   | 删除 completed 报告引用的 AI Task                 | 单删、混合批量和清空都在写入前整体拒绝，报告绑定与其他任务不变                                                            |
| QH09   | LocalStorage 当前状态更新与幂等重试               | 独立 state 集合覆盖当前视图，不改写历史 item；Task 不一致拒绝，旧报告重试返回原始快照                                     |
| QH10   | schema 2 多报告缺少 `sort_order`                  | 每份报告分别从 0 编号，状态按旧 item 最后更新时间合成                                                                     |
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

| 编号    | 场景                                                                  | 预期                                                                                                                         |
| ------- | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| CTX01   | 调用方指定上下文 UUID 后创建、读取、更新、过期和删除                  | SQLite 与返回 DTO 始终使用同一 ID；更新未命中或归属错误明确失败                                                              |
| CTX02   | Tauri IPC 在创建、更新或查询时失败                                    | 错误向上传播，旧 LocalStorage 集合不新增、不改写，也不返回伪成功 DTO                                                         |
| CTX03   | summary、context、character state 或 chapter status 的第 N 步失败     | 同一 SQLite 事务整体回滚，不留下半完成总结或 `summarized` 终态                                                               |
| CTX04   | 作品、章节、已采用草稿或角色归属不一致                                | bundle 在任何业务写入前拒绝，相关作品数据保持不变                                                                            |
| CTX05   | 同一作品存在多章及同章历史总结                                        | 以章节次序和 `updated_at / created_at / id` 稳定排序，每次查询都确定性选择同一份每章最新总结                                 |
| CTX06   | 旧 LocalStorage 与 SQLite 存在同 ID、不同 ID 镜像、重复或歧义记录     | 迁移幂等；唯一镜像映射而不复制；歧义保留并 warning；提交失败不清理缓存                                                       |
| CTX07   | 浏览器 LocalStorage bundle 中途写入失败                               | 恢复总结、上下文和角色状态全部快照，错误返回调用方                                                                           |
| CTX08   | 已有总结后采用另一版正文，或事务中途注入失败                          | 正文采用、章节状态、总结与上下文过期同事务提交或整体回滚；重采同一正文不误过期                                               |
| CTX09   | 旧角色状态插入或确定性匹配，但 `characters.current_state` 陈旧        | 同一迁移事务按 `created_at DESC, id DESC` 重算当前状态，重复迁移仍能修复且不复制历史                                         |
| CTX10   | 浏览器采用新正文时上下文过期写入失败                                  | 草稿采用状态、总结和上下文集合全部恢复到采用前快照，错误返回调用方                                                           |
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

| Spec                                  | 流程                                                                                                                                     |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `app-start.spec.ts`                   | 应用启动、`app-shell`、迁移、SQLite 健康与前端异常                                                                                       |
| `project-create-open.spec.ts`         | 创建作品、返回列表并打开                                                                                                                 |
| `project-edit-save.spec.ts`           | 修改作品信息，验证保存不挂起、提交且不重复写入                                                                                           |
| `chapter-save.spec.ts`                | 显式创建卷和章节、保存正文、切换页面并重新打开                                                                                           |
| `large-text-save.spec.ts`             | 184KB 中文 / emoji / CRLF 正文保存、重开、采用、全文与 SHA 核对，以及损坏分片失败关闭                                                    |
| `provider-pipeline-setting.spec.ts`   | Mock 设定候选经过 Task/Snapshot/Attempt/Artifact 全链路，且未确认前不写入正式设定                                                        |
| `candidate-review-apply.spec.ts`      | Mock AI 候选、约束审查、确认采用、页面字数同步与重复采用幂等                                                                             |
| `leave-guard.spec.ts`                 | 未保存离开保护的取消、保存并离开及放弃修改分支                                                                                           |
| `generation-job-cancel.spec.ts`       | 分别暂停正文和质量 Mock AI 后从 UI 取消；唯一 checkpoint、waiter 清理、正文无新草稿、质量保留既有草稿且无 pending 报告，并验证无迟到完成 |
| `restart-task-recovery.spec.ts`       | 暂停 Mock AI、真实进程重启、恢复对话框、同一任务安全终结及二次启动幂等                                                                   |
| `quality-history-replay.spec.ts`      | 连续两次固定 Mock 质检，重启真实应用后分别回放两份不可变报告，校验只读历史、Task 追溯、稳定 item ID 与当前计数                           |
| `chapter-context-persistence.spec.ts` | 保存章节总结与上下文后重启，校验稳定 ID 和同一内容；持久化过期后再次重启，证明后续生成不再读取该记录                                     |

测试通过 `data-testid`、元素状态、HashRouter 和 Tauri IPC 定位与断言，不使用中文文本、CSS 类、DOM 层级、屏幕坐标或截图识别。`frontend-diagnostics.json`、WebdriverIO、driver / Rust 日志、数据库位置和进程清理结果都会写入诊断目录；失败时在会话仍可访问的前提下尽力追加 DOM、当前路由和截图。

完整 Windows 前置条件、环境变量、数据隔离、Mock / 网络阻断、选择器契约和排障见 [Windows 桌面 E2E 自动化](desktop-e2e.md)。

GitHub Actions 的 `windows-desktop-e2e.yml` 在 Pull Request 与 `main` 推送时运行质量门和真实桌面 smoke；`v*` tag、每周定时和手动完整模式运行全部桌面流程，手动 `full-three` 可执行连续三轮稳定性验证。CI 在依赖准备阶段匹配 WebView2 与 EdgeDriver，随后以 Cargo / npm offline 模式构建并运行 E2E；失败诊断作为短期 artifact 上传。

### 2.12 v2.3.0 执行事实层专项

```powershell
# 005～011、空库、升级、checksum、回滚、schema fingerprint
cargo test migrations::tests -- --nocapture

# Task / Attempt / Snapshot / Artifact / Issue、重放与重启读取
cargo test services:: -- --nocapture

# 常规 Rust/SQLite 全量
cargo test

# 使用真实用户数据库的隔离副本；默认 ignored，绝不直接迁移源文件
$env:AI_NOVEL_STUDIO_MIGRATION_DB = '<isolated-copy>\ai-novel-studio.db'
cargo test db23_external_v221_copy_upgrades_without_business_row_or_shape_changes -- --ignored
```

专项动态矩阵至少证明：

| 编号      | 场景                                     | 必须结果                                                      |
| --------- | ---------------------------------------- | ------------------------------------------------------------- |
| M1-DB01   | 空库与 v2.2.1 升级                       | ledger 到 011；业务表零改形、旧行零变化                       |
| M1-DB02   | 重复启动与新旧 checksum 冲突             | 幂等；任一 checksum 漂移 fail closed                          |
| M1-DB03   | 当前 migration / Snapshot 插入故障       | 当前事务回滚，不留下 Task、document 或 chunk                  |
| M1-TASK01 | 相同/不同 operationId payload            | 同 hash 返回同一 Task；不同 hash 拒绝                         |
| M1-TASK02 | 双 queue / claim、跨 Task Attempt        | 同身份重放；不同身份或跨 Task 拒绝；最多一个 live Attempt     |
| M1-TASK03 | retry、cancel、late response             | 历史 Attempt 保留；迟到响应不创建 Artifact                    |
| M1-ART01  | 合法、warning、malformed、超长 raw       | 完整 raw 可校验读取；Task 终态与 Issue 正确                   |
| M1-ART02  | Artifact 重放、raw mismatch、未知契约    | 同身份返回同 Artifact；变化请求 fail closed 且无残留 document |
| M1-IMM01  | Snapshot / Artifact / Issue / 大文本篡改 | UPDATE、DELETE 及追加 chunk 全部拒绝                          |
| M1-READ01 | 文件数据库关闭再打开                     | Task、Attempts、三 Snapshot、Artifacts、Issues 全部完整读取   |
| M1-SEC01  | API Key、Bearer、rawBody metadata        | 写入前拒绝；普通日志无正文、Prompt 或 Provider body           |

v2.3.0 没有修改生产 Provider Adapter，因此未执行真实 API 测试。

### 2.13 v2.3.1 Provider 管线专项

```powershell
# Provider 单次派发、提交未知重放、取消、完成结果重放、浏览器 ephemeral
npx tsx --test --test-concurrency=1 src/services/ai/aiExecutionPipeline.test.ts

# 真实 Tauri + Mock Provider + SQLite 全事实链路
npm run test:e2e -- --spec provider-pipeline-setting
```

专项动态矩阵：

| 编号    | 场景                                              | 必须结果                                                                                                                                                          |
| ------- | ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PA01    | Task/Snapshot → queue/claim → Provider → Artifact | 只派发一次 Provider；响应 hash/Unicode 字符长度与 Artifact 一致                                                                                                   |
| PA02    | 持久化返回 `DATABASE_COMMIT_UNKNOWN`              | 仅重放同身份 IPC，不再次调用 Provider                                                                                                                             |
| PA03    | AbortSignal / Tauri cancel                        | Task 与 Attempt 安全取消，不创建迟到 Artifact                                                                                                                     |
| PA04    | 已完成 operationId 重放                           | 读取首次 Task/Artifact，Provider 调用次数为 0                                                                                                                     |
| PA05    | 浏览器开发回退                                    | 可以临时运行 Mock/API，但不伪造 Task、Attempt、Snapshot 或 Artifact                                                                                               |
| PA06    | API Key / Base URL                                | 只作为瞬时 Adapter 配置；Task 创建参数和持久结果均不包含                                                                                                          |
| PA07    | Tauri 字符串错误                                  | 保留已脱敏后端消息；401/403 与 400 分别形成不可盲重试的稳定错误码并安全终结 Attempt                                                                               |
| PA08    | 截断或非字符串 final content                      | `finish_reason=length` 明确提示提高输出预算并持久化为可重试 malformed response；浏览器 content-parts 不得冒充字符串成功                                           |
| PA-E2E  | 设定候选 Mock 桌面闭环                            | Task completed、Attempt succeeded、Artifact valid；正式设定行数不变                                                                                               |
| PA-REAL | 真实 API 连接测试                                 | 只调用一次、`temperature = 0`、`maxTokens = 128`、响应为 `OK`，并形成 system Task 与 generic_text Artifact；推理型兼容模型不得因 8-token 预算返回空 final content |

真实 API 验收不进入自动化套件，不读取或输出完整 API Key，不连续重试。若配置缺失或 Provider 外部失败，必须如实记录为未通过，不能用 Mock 结果替代。

### 2.14 v2.3.2 Safe Apply 专项

```powershell
# 前端提交未知重放边界
npx tsx --test --test-concurrency=1 src/services/placements/placementRuntimeService.test.ts

# Rust Proposal / Plan / Link、事务与冲突测试
cargo test --manifest-path src-tauri/Cargo.toml placement_service

# 真实 Tauri + Mock Provider + SQLite 用户确认闭环
npm run test:e2e -- --spec provider-pipeline-setting
```

专项动态矩阵：

| 编号   | 场景                            | 必须结果                                                              |
| ------ | ------------------------------- | --------------------------------------------------------------------- |
| SA01   | 准备同一 Artifact 候选两次      | 返回同一 Proposal/Plan；正式设定与 TargetLink 均为 0                  |
| SA02   | 用户确认单目标计划              | 同事务创建一条 world_setting、一条 TargetLink，并将 Plan 标记 applied |
| SA03   | 相同 operationId 或提交未知重放 | 返回首次目标和链接；副作用数量保持 1                                  |
| SA04   | 预分配 targetId 已存在          | 记录 conflict；不得覆盖已有世界设定                                   |
| SA05   | Link 插入故障                   | world_setting、Link、确认与状态转换全部回滚                           |
| SA06   | Proposal/Plan/Link 篡改或删除   | SQLite 触发器或 canonical hash 校验拒绝                               |
| SA07   | 已应用目标被修改或删除          | 重放返回 `PLACEMENT_TARGET_CHANGED`，不得返回陈旧成功                 |
| SA08   | 浏览器 ephemeral 候选           | 不创建持久 Placement 事实，不显示正式采用按钮                         |
| SA-E2E | 桌面候选显式确认                | 确认前正式设定不变；确认后仅一个候选落地，3 Plan / 1 Link 可诊断      |

v2.3.2 不修改 Provider 网络协议或请求参数，因此不重复消耗真实 API；Provider 链路继续由 v2.3.1 的单次真实尝试记录和本版 Mock 桌面回归覆盖。

### 2.15 v2.4.0 Compiler / Tool Registry 专项

```powershell
npx tsx --test --test-concurrency=1 `
  src/services/ai/compilation/executionContractCompiler.test.ts `
  src/services/ai/aiExecutionPipeline.test.ts `
  src/services/agent-tools/toolRegistry.test.ts

cargo test --manifest-path src-tauri/Cargo.toml task0 -- --test-threads=1
npm run test:e2e -- --spec provider-pipeline-setting
```

专项动态矩阵：

| 编号    | 场景                                               | 必须结果                                                                               |
| ------- | -------------------------------------------------- | -------------------------------------------------------------------------------------- |
| CC01    | 相同来源乱序与 JSON key 乱序                       | compiled context、manifest 与 compilationHash 完全一致                                 |
| CC02    | Context 超过预算                                   | 按固定 estimator 确定性截断/省略；必需来源无空间时失败关闭                             |
| CC03    | 来源版本、内容或集合漂移                           | 分别报告 changed、missing、unexpected，不伪报一致                                      |
| CC04    | Prompt / Context / request / compilation hash 篡改 | 前端管线或 Rust Task 创建前拒绝，不留下 Task/Snapshot                                  |
| CC05    | 改写 Artifact type 试图绕过编译                    | Rust 仍按生产 taskType 强制正式契约并拒绝                                              |
| TR01    | Registry 定义顺序变化                              | manifest 顺序与 registryHash 不变                                                      |
| TR02    | Registry 返回对象被调用方修改                      | 再次读取仍返回冻结权威 manifest                                                        |
| TR03    | 工具未列入 allowlist、权限不足或跨 scope           | handler 调用次数保持 0，返回稳定错误码                                                 |
| TR04    | input/output 不符合 schema                         | 执行前或返回后拒绝，不持久化伪结果                                                     |
| TR05    | 副作用工具只有调用方自报确认                       | 必须由定义方复验持久计划证据，否则不得执行                                             |
| CC-E2E  | Windows 设定候选完整闭环                           | schema v2 Snapshot、来源 ID/hash、预算、模板与 Registry hash 可读取，Safe Apply 不回归 |
| CC-REAL | 真实 API 连接测试                                  | 仅一次、最大 128 tokens；成功或外部失败均如实记录，不重试、不用 Mock 替代              |

v2.4.0 修改了正式 Prompt 与 Provider messages 编译路径，因此发布前只执行一次低输出真实连接测试。自动化仍默认使用 Mock 与 E2E 网络阻断，绝不从日志或产物读取/输出 API Key。

### 2.16 v2.5.0 Planner Runtime 专项

```powershell
npx tsx --test --test-concurrency=1 `
  src/services/agent-tools/toolRegistry.test.ts `
  src/services/agent-planner/agentPlanRuntimeService.test.ts

cargo test --manifest-path src-tauri/Cargo.toml agent_plan_service::tests
cargo test --manifest-path src-tauri/Cargo.toml migrations::tests::db24
npm run test:e2e -- --spec chapter-readiness-planner
```

| 编号   | 场景                            | 必须结果                                                                        |
| ------ | ------------------------------- | ------------------------------------------------------------------------------- |
| PL01   | 相同 operationId + 相同请求创建 | 返回同一 Plan；不同请求失败关闭                                                 |
| PL02   | 创建固定计划                    | 恰好六个 Step、八条依赖，identity/schema/权限/scope/参数 hash 冻结              |
| PL03   | 并发获取 lease                  | 同 Plan 最多一个 active lease，epoch 单调                                       |
| PL04   | 检查 SQLite lease               | 只有 token SHA-256，无明文 token 字段或值                                       |
| PL05   | 按依赖完成六步                  | 六个 succeeded Attempt、Plan completed、最终 readiness result 可读              |
| PL06   | Tool 执行失败                   | 只追加一个 failed Attempt，Plan/Step waiting_retry，不自动重试                  |
| PL07   | 应用重启恢复                    | running Attempt abandoned、lease expired、Plan/Step waiting_retry、零 Tool 重放 |
| PL08   | 显式继续                        | 写入 user retry checkpoint，原 Attempt 不变，下一 claim 才产生新 Attempt        |
| PL09   | 篡改持久 schema/参数/依赖       | claim 前拒绝，Tool handler 调用次数为 0                                         |
| PL10   | 浏览器开发模式                  | 明确提示仅桌面可用，不创建 LocalStorage Plan                                    |
| PL-E2E | Windows 工作台运行计划          | 六个真实本地 Tool 各运行一次，SQLite 事实和 Checkpoint 顺序可验证，网络请求为 0 |

v2.5.0 不修改 Prompt、Provider messages 或 Provider Adapter；真实 API 不属于本地只读 Planner 的必要验收，因此本版不发起真实 API 请求。

### 2.17 v3.0.0 Multi-Agent 自主创作专项

```powershell
npx tsx --test --test-concurrency=1 `
  src/services/multi-agent/multiAgentService.test.ts `
  src/components/right-dock/panels/MultiAgentPanel.test.tsx `
  src/services/autonomous-creation/autonomousStoryService.test.ts `
  src/services/autonomous-creation/autonomousChapterWorkflow.test.ts `
  src/pages/AutonomousPlanning/AutonomousExecutionPanel.test.tsx

node --experimental-strip-types --test src/services/backup/projectBackupService.test.mjs
cargo test --manifest-path src-tauri/Cargo.toml autonomous_story
cargo test --manifest-path src-tauri/Cargo.toml project_backup
```

| 编号  | 场景                   | 必须结果                                                                                                                                              |
| ----- | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| AC01  | 300 章全书规划         | 5 个故事弧、10 卷、连续 1～300 章，人物/世界/冲突/节奏引用完整                                                                                        |
| AC02  | 相同 operationId 重放  | 不重复调用任何已完成创作 Agent；Brief 漂移失败关闭                                                                                                    |
| AC03  | 世界/冲突/节奏部分失败 | 成功维度先持久化；显式继续只补齐缺失 Agent                                                                                                            |
| AC04  | 计划确认应用           | 一个事务创建卷、章、角色、世界、事件和章节角色关系；重复应用复验目标                                                                                  |
| AC05  | 下一章生成与评审       | 只创建未采用候选；六专家和最多三轮修订完成后仍不自动采用                                                                                              |
| AC06  | 评审阶段恢复           | 复用源草稿和 operation，不重复生成正文                                                                                                                |
| AC07  | 正文采用               | 采用进度推进；分析进入待确认，确认前正式上下文写入次数为 0                                                                                            |
| AC08  | 章节分析确认           | 原子保存总结/上下文/角色状态，人物节点按实际变化确认，世界条目保持候选                                                                                |
| AC09  | 改采与页面恢复         | 改采清除旧分析；权威采用稿可修复遗漏进度且重复对账幂等                                                                                                |
| AC10  | 备份 schema 9          | 自主计划、Multi-Agent、参考资料、Memory、scheduler 和正式资产一起恢复并重映射；中断调度收敛、hash 重算、地点拓扑恢复；旧 schema 2～8 按历史表集合兼容 |
| AC11  | Chapter Batch 子批恢复 | 每批最多 5 章；首批保存后续批失败时，显式继续不重复调用或覆盖成功范围                                                                                 |
| AC12  | Provider 结构响应边界  | 多 fence、前后无关对象、字符串内括号和尾逗号可定位正式对象；截断、字段漂移和非空 `finish_reason=length` 失败关闭                                      |
| AC-UI | 自主执行面板           | 明确展示候选、评审共识、采用进度和章节分析确认入口                                                                                                    |

Mock 自动化证明协议、状态与 UI，不代表真实模型的文学质量。真实 API 只在用户自有配置下手动验证，不能读取或输出 API Key，也不能用 Mock 冒充真实 Provider 结果。

2026-07-28 Windows release 手动验收：使用既有本地 API 配置从生产计划第 156 章检查点继续，连续 6 个五章批次（第 156～185 章）均为 `succeeded`，输出 Token 分别为 2603、2133、3778、3644、3634、3214；随后第 186～190 章任务受控进入 `cancelled`。计划最终保存 1～185 章连续前缀，`revision=119`，SQLite `quick_check=ok` 且 `foreign_key_check` 为空。该验收未读取、输出或修改 API Key。

同一 release 的真实 API 连接测试显示“连接成功！（2577ms）”。测试期间未编辑、读取或输出 API Key，也未点击“保存设置”。

同日使用该 release 在写作工作台执行一次 2,000 字目标的真实流式正文生成：预览先显示 `输出中 · 2170 字符`，结束后显示 `已完成 · 3514 字符`；任务 `chapter_generate` 为 `succeeded`（2914 input / 2349 output / 5263 total Token），生成结果保存为未采用的 `ai_generated v21`，工作台自动载入并显示 2,867 字。数据库正文 SHA-256 与 `chapter_drafts.content_hash` 相同，`quick_check=ok` 且外键检查为空；旧草稿与正式采用指针未被覆盖。

### 2.18 P0 取消、真实流式事件与成本计量专项

定向入口按文件或小组单独运行，避免把三个 Vite SSR 面板用例放入同一 Node 进程造成无关的堆内存波动：

```powershell
# 浏览器/Tauri 取消握手、SSE 协议与 LocalStorage 成本往返
npx tsx --test --test-concurrency=1 src/services/ai/aiCancellation.test.ts

# 成本公式与状态语义
npx tsx --test --test-concurrency=1 src/services/ai/aiCost.test.ts

# 请求频率、并发、reservation、每日 Token / 成本硬预算
npx tsx --test --test-concurrency=1 src/services/ai/providerRequestPolicy.test.ts

# 正式 Provider 管线成本 metadata、篡改与重放边界
npx tsx --test --test-concurrency=1 src/services/ai/aiExecutionPipeline.test.ts

# 设定、事件、角色、质量检查和风格面板的停止/卸载边界
npm run test:ai-panels

# Rust socket 取消与 SSE loopback
cargo test --locked --manifest-path src-tauri/Cargo.toml ai::tests -- --nocapture

# 正式 response metadata 成本白名单和状态组合
cargo test --locked --manifest-path src-tauri/Cargo.toml ai_fact_security::tests -- --nocapture

# Legacy ai_task_records 使用冻结单价结算
cargo test --locked --manifest-path src-tauri/Cargo.toml ai_task_success_calculates_cost_from_frozen_pricing -- --nocapture
```

`npm test` 已包含 `aiCancellation.test.ts`、`aiCost.test.ts`、`providerRequestPolicy.test.ts` 和 `aiExecutionPipeline.test.ts`；`npm run test:all` 还会依次运行隔离的 `test:ai-panels`、Vitest 与性能基准。发布门禁仍需再执行完整 Rust、前端构建、Windows E2E 和 Tauri production build，不能用上述定向入口代替。

| 编号   | 动态证据                                        | 已证明边界                                                                                                                                           |
| ------ | ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| STR01  | 浏览器 `ReadableStream` + OpenAI-compatible SSE | UTF-8 字符跨 chunk 保持完整；delta sequence 有序；usage 进入最终聚合响应；最终文本与全部 delta 精确一致                                              |
| STR02  | Rust loopback SSE                               | 字节级帧缓冲、跨 chunk 多字节文本、有序 Tauri delta、usage 和最终聚合一致                                                                            |
| STR03  | 浏览器与 Rust 中断/截断用例                     | 无 `[DONE]` 且无 finish reason 的 EOF、非法帧和 `finish_reason=length` 均失败关闭，不把部分正文当成功结果                                            |
| STR04  | Windows 真实 Provider 手动验收                  | 正文 delta 在请求结束前进入“实时候选预览”；只有完整最终响应原子创建未采用草稿，旧采用稿不被覆盖                                                      |
| CAN01  | Rust request registry + socket loopback         | 提前取消、活动取消、重复 ID、重复取消、近期完成 ID、future drop、连接关闭和 timeout 分类                                                             |
| CAN02  | `aiCancellation.test.ts`                        | Tauri cancel IPC 成功、失败和挂起时均等待确认或原请求安全结算；Mock waiter 清理；取消与超时不混淆                                                    |
| CAN03  | `test:ai-panels`                                | 设定/事件/角色停止后 signal 中止且迟到候选不回写；设定/风格卸载中止；质量检查迟到结果不创建报告或草稿                                                |
| CAN04  | AI Task active-execution 回归                   | 当前进程 owner 可发起停止，任务中心复用同一 service；任务进入 `cancelled` 后，迟到 success 不能复活终态                                              |
| COST01 | `aiCost.test.ts` + LocalStorage 回归            | 用户配置 USD 单价公式、八位小数、Mock 零成本、`unpriced` / `usage_missing` 非零伪装，以及创建时价格冻结                                              |
| COST02 | Rust `ai_task_records` 回归                     | SQLite 用创建时冻结单价和最终 token 结算；动态用例已直接证明 `complete/mock/unpriced`，`usage_missing` 目前由 TypeScript 状态用例和 SQL 分支共同覆盖 |
| COST03 | Provider pipeline + Rust security 回归          | 成本字段只进入 response metadata 白名单；非法状态、币种、来源、负数/超范围单价及不一致 Mock 组合在 Artifact 前失败关闭；重放复验持久事实             |
| GOV01  | `providerRequestPolicy.test.ts`                 | 每分钟请求数与最大并发超限在 Provider 派发前失败；活动 reservation 结算后释放，过期 reservation 不永久占位                                           |
| GOV02  | `providerRequestPolicy.test.ts`                 | 每日 Token / 估算 USD 预算包含已用量与在途保守预留；缺完整单价时成本预算失败关闭，缺 usage 时按预留值保守入账                                        |

边界说明：

- 交互式 AI 入口的 request owner 是 WebView/前端进程内 `AbortController`、loading operation 和 AI Task active map；应用重启后不接管旧 Map。Autonomous Scheduler 使用 migration 027 的独立持久 owner/lease/epoch 域，只接管 scheduler run，不能复活任意旧交互请求。
- 可见流式预览当前面向正文生成；结构化 Agent 可以继续聚合完整响应后再解析。仓库尚无 Provider capability negotiation 或 streaming 不支持时的自动非流式重派发，不能把失败重派发描述为无缝降级。
- 自动化流协议使用浏览器内存流与本机 loopback，不消耗真实 API；真实 Provider 证据是上节记录的受控 Windows 手动验收。
- `cost_estimate` 是用户单价乘 Provider usage 的 USD 估算，不是账单。交互请求 ledger 保存于本机 LocalStorage/内存；scheduler 另冻结 run 预算并在 claim/finish 中复验。失败或取消后的 Provider 实际费用和账单对账仍属于后续能力。

---

### 2.19 参考资料库、分层风格与混合语义 Memory

```powershell
# TXT 解码 / 章节边界、版本库、分页 UI、六层画像与 Prompt 投影
npx vitest run src/test/references

# TypeScript Memory IPC 边界：真实向量与无向量降级
npx tsx --test --test-concurrency=1 src/services/memory/memoryService.test.ts

# Rust Memory 来源、向量、检索、日志与事务失效
cargo test --locked --manifest-path src-tauri/Cargo.toml memory_service::tests -- --nocapture

# migration 026、采用事务回滚和当前 schema 9 备份由完整 Rust 集合覆盖
cargo test --locked --manifest-path src-tauri/Cargo.toml
```

| 编号  | 动态证据                                      | 已证明边界                                                                                                                                                                          |
| ----- | --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| REF01 | `referenceTextParser.test.ts`                 | UTF-8 / BOM / GB18030 / 显式编码、emoji 字符语义、原始字节与解码正文双 hash、UTF-16 半开章节范围和 64 MiB / 10,000 章节硬上限                                                       |
| REF02 | reference service / page tests + Rust service | 重复导入必须显式决策；operation 幂等、CAS 版本切换、分页 metadata、单节正文按需读取、跨作品注入拒绝和删除图一致性                                                                   |
| REF03 | layered style / prompt projection tests       | 六层确定性采样、长文本有界读取、取消、字段置信度与来源 hash；保存和生成投影不包含参考原文片段                                                                                       |
| REF04 | Rust project backup                           | schema 6～9 参考表往返、机器路径清空、ID 重映射、大文本 target / hash 校验和篡改回滚                                                                                                |
| MEM01 | `memoryService.test.ts`                       | 显式向量必须有限、非零且维度一致；无向量请求保留受预算约束的 lexical / structured 降级契约                                                                                          |
| MEM02 | Rust `memory_service::tests`                  | `adopted_draft / chapter_summary / context_record` 来源、novel / chapter / adopted draft 归属、source version/hash 与幂等重放失败关闭                                               |
| MEM03 | Rust 混合检索                                 | provider/model/dimension 绑定、余弦 + lexical + importance + recency 排名、FTS / substring 降级、最多 500 候选、50 结果和 100,000 Token 预算；不可变日志保存评分原因而非 query 原文 |
| MEM04 | Rust 采用事务                                 | 改采正文与旧 Memory `adopted_draft_changed` 失效同事务提交；注入失效写入错误时草稿指针、采用标志和 Memory 状态整体回滚                                                              |
| MEM05 | migration / project backup                    | migration 026 checksum 冻结；schema 7～9 四张 Memory 表往返并重映射，向量 hash / norm / dimension 与检索引用篡改在提交前拒绝；schema 2～6 按空 Memory 兼容                          |

当前完成的是 SQLite 权威的混合检索基础。自动 embedding Provider、固定召回评估集、ANN / HNSW 和全书分析 UI 尚未纳入发布门禁；持久 worker lease 必须以 2.21 节 scheduler 测试证明，不能由 Memory 测试替代。

---

### 2.20 长文本、大章节列表与本地观测基准

```powershell
npm run test:performance

# appLogger 脱敏 / 有界持久化定向回归
npx vitest run src/services/observability/appLogger.test.ts

# P50 / P95 与 500 样本上限定向回归（也包含于 test:vitest）
npx vitest run src/test/performance/aiPerformanceMonitor.test.ts

# Rust panic 最小信封、路径脱敏、50 条读取上限与清理
cargo test --locked --manifest-path src-tauri/Cargo.toml crash_reports -- --nocapture
```

`test:performance` 使用 `node --expose-gc`，当前包含三项硬门禁：

| 场景                  | 正确性断言                            | 时间 / 资源阈值             | 最近记录  |
| --------------------- | ------------------------------------- | --------------------------- | --------- |
| 120 万字符章节分段    | 所有 segment 拼接后逐字符等于原文     | `< 1,500 ms`                | 约 5 ms   |
| 500 章导航索引与窗口  | 10 卷、目标卷 50 章，活动章节始终可达 | `< 100 ms`                  | 约 0.6 ms |
| 重复长文本分段 100 次 | 每轮拼接均等于原文                    | 强制 GC 后堆增长 `< 96 MiB` | 通过      |

性能时间只作为同一测试环境中的非回退信号，不承诺所有机器达到最近记录。AI 观测最多保留 500 个本地样本并计算 P50 / P95 / max、成功 / 失败 / 取消数；`appLogger` 最多持久化 50 条脱敏 error。原生 panic 报告按 128 KiB 单代轮换，导出最近 50 条，且只包含时间、应用版本和源码文件名 / 行列号。诊断导出不包含正文、Prompt、API Key、Provider 原始响应、panic payload、堆栈或绝对路径；完整边界见 [`diagnostics.md`](diagnostics.md)。

---

### 2.21 跨进程 scheduler 与备份 schema 8

```powershell
npx tsx --test --test-concurrency=1 src/services/autonomous-creation/autonomousSchedulerService.test.ts
npx tsx --test --test-concurrency=1 src/services/autonomous-creation/autonomousSchedulerWorker.test.ts
cargo test --locked --manifest-path src-tauri/Cargo.toml autonomous_scheduler -- --nocapture
cargo test --locked --manifest-path src-tauri/Cargo.toml project_backup_schema_eight -- --nocapture
```

动态用例必须覆盖：同一 run 唯一 active lease、epoch/token 失配、heartbeat 过期、claim/finish CAS、预算与时间窗、可重试失败、连续失败熔断、停止与幂等重放；启动恢复必须证明 `running → queued`、active lease → expired、claimed attempt → abandoned，并重算 policy/request/decision/payload hash。三档策略必须分别证明草稿-only、质量确认门禁和全自动采用前复验，不能只检查 UI 中存在三个选项。

### 2.22 多目标事务、StoryAssets 与备份 schema 9

```powershell
npx tsx --test --test-concurrency=1 src/services/content-transactions/contentTransactionService.test.ts
npx vitest run src/test/story-assets/StoryAssetsPage.test.tsx
cargo test --locked --manifest-path src-tauri/Cargo.toml content_transaction_service_tests -- --nocapture
cargo test --locked --manifest-path src-tauri/Cargo.toml project_backup_schema_nine -- --nocapture
```

Rust 故障注入证明 target set/hash 冻结、每目标 base CAS、`all_or_nothing` 整体回滚、`reviewed_partial` 显式批准、提交未知重放、目标漂移复验、地点环拒绝和父子拓扑写入。React 用例证明浏览器只读边界、候选审阅、批准子集和失败保留；Windows E2E `story-assets-transaction.spec.ts` 从真实 UI 创建势力，再只应用两章中的一个 metadata 目标，并从 SQLite IPC 复验另一章未变化。

### 2.23 真实浏览器主题与签名更新发布

```powershell
npm run test:e2e:browser
node --test scripts/release/build-release-manifest.test.mjs
npx vitest run src/services/update/appUpdateService.test.ts
cargo test --locked --manifest-path src-tauri/Cargo.toml commands::app_update::tests -- --nocapture
```

- 浏览器 E2E 启动真实 Vite，驱动 Chromium/Edge，证明 StoryAssets lazy route、无 Tauri bridge 时不伪造 SQLite 资产，以及手动 dark/light 的 root dataset、`color-scheme`、语义 token 和 computed surface 均切换。
- updater 单元测试证明 Stable/Beta 版本隔离、发布说明限长/控制字符清理、普通本地包的公钥槽位不被视为已配置。
- release manifest 测试使用临时 MSI updater/signature fixture，验证静态 Tauri v1 `latest.json`、artifact SHA-256、上一版 HTTPS installer 和 rollback backup 要求；稳定版本不得进入 Beta 索引。
- `.github/workflows/release.yml` 只有在 `TAURI_PUBLIC_KEY / TAURI_PRIVATE_KEY` secrets 存在时构建 `msi,updater`，并在发布前检查 `.msi.zip.sig`。普通本地构建不会读取或生成私钥。

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

# ESLint：0 warning
npm run lint:ci

# 统一前端、覆盖率、文档与版本门禁
npm run test:all
npm run test:coverage
npm run test:docs-sync
npm run test:version-sync

# TypeScript 类型检查 + 前端生产构建
npm run build

# Rust 格式、编译和全量测试
cargo fmt --all --manifest-path src-tauri/Cargo.toml -- --check
cargo check --locked --manifest-path src-tauri/Cargo.toml
cargo test --locked --manifest-path src-tauri/Cargo.toml

# Tauri 完整构建
npm run tauri:build
```

本地入口显式生成 MSI 与 NSIS，不进入需要私钥的 updater 签名阶段；正式发布使用 `tauri:build:release`，并由 release workflow 注入公私钥后生成 MSI updater。

项目辅助脚本：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/agent-workflow/check_docs_sync.ps1
powershell -ExecutionPolicy Bypass -File scripts/agent-workflow/verify_project.ps1
```

`verify_project.ps1` 会顺序运行版本同步、文档同步、覆盖率、组件体积、Node 测试、ESLint、前端构建、静态补充检查、AI Task 删除和项目备份运行时测试、`cargo check`、完整 `cargo test`、完整桌面 E2E、Tauri 生产构建、清单与 Git 状态。任一步失败或工作树不干净都返回非零；`release_workflow.ps1` 会再次检查干净工作树，不能从未提交修改获得发布建议。

GitHub Actions 分为四层：`ci.yml` 提供 Linux lint / test / build 并运行真实 Chromium 浏览器模式 E2E；`windows-desktop-e2e.yml` 在 Windows 运行版本、文档、覆盖率、Rust、无 bundle 生产构建和真实 Tauri E2E；`security.yml` 定期运行 npm / Cargo 审计与 CodeQL；`release.yml` 在 tag 或手动 Beta / Stable 通道构建 MSI、签名 updater 与回滚 manifest。浏览器快速 CI 通过不等于桌面发布通过。

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

### 5.6 Multi-Agent 协作评审

1. 使用可控 Provider 同时阻塞六个专家，确认六个调用均已启动后再统一释放，证明不是串行执行。
2. 分别构造通过、可修订、需重写和不足 quorum 的意见，确认 TypeScript 与 Rust 得出相同动作。
3. 让一个专家失败，确认其他意见正常保存；让成功专家低于 quorum，确认不能接受。
4. 第一轮返回 revise 或 regenerate，确认创建新的未采用草稿，第二轮接收的是新正文而非源正文。
5. 使用相同 operationId 重放 completed session，确认不重复调用专家；更改阈值后重放必须返回 payload conflict。
6. 伪造平均分、接受率或 action，确认 Rust 拒绝并回滚整轮；跨作品草稿和过期版本同样失败关闭。
7. 在工作台启动评审并查看逐轮结果，确认候选只有在用户点击“载入候选草稿”且离开保护通过后才进入编辑器。
8. 导出 schema 9 项目备份并恢复，确认 session、round、opinion、参考资料、Memory、scheduler 和正式资产及其引用全部重映射；schema 2～8 仍可按各自历史能力导入。

### 5.7 自主创作全链路

1. 从只有标题、简介和题材的作品进入自主创作规划，输入 300 章 Brief。
2. 确认 5 个故事弧、10 卷、连续 300 章以及人物、世界、冲突和节奏视图均可读取。
3. 应用前确认作品卷章未变化；用户确认后确认 300 章以及章节角色/冲突参数已物化。
4. 生成第一章候选，确认六专家完成且候选未自动采用。
5. 在写作工作台采用候选，返回规划页确认进度为 `1 / 300` 且下一章为第 2 章。
6. 确认章节分析展示人物变化、新地点和待确认世界候选；点击确认前章节不应为“已总结”。
7. 确认分析后，工作台章节状态变为“已总结”，设定推演页仍显示待确认世界候选。
8. 在 1280×820、1024×700 和 2K 窗口检查双栏规划工作台，无横向溢出、控件遮挡或文本截断。

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
- 当前动态测试已证明交互式请求的幂等 claim/release、`generation_jobs` 安全终结、Rust socket 取消，以及独立 AI 面板的停止/卸载和迟到结果隔离；migration 027 另以持久 lease/epoch/attempt/checkpoint 覆盖无人值守 run。二者是不同 owner 域，不能用 scheduler lease 伪装任意交互请求可跨重启接管。
- Windows 桌面自动化采用 WebdriverIO + Tauri Driver，不计划用 Playwright 浏览器页面或截图式 Computer Use 替代真实 Tauri E2E。
- `recovery-dialog` 已作为 `generation_jobs` 的真实启动恢复节点纳入桌面 E2E；其他 AI 任务模型仍不得为测试伪造恢复能力。
- v2.3.0+ 已具有 Artifact，v2.3.2 已具有 PlacementProposal / ApplyPlan；测试必须读取真实 SQLite 事实，不能以 UI 文案或旧 AiTaskRecord 代替。
- `operationId` 的数据库级重放、completed 目标权威复验与提交后清理故障已由 service 测试证明；真实 IPC 进程在提交边界被强制终止时的端到端对账仍需继续补充。
- 大文本 DB04～DB07、章节工程任务跨重启安全结算、在途 AI 取消、质量历史不可变重放、v2.5.0 Planner、SQLite 混合语义 Memory、migration 027 scheduler 和 migration 028 多目标事务均已由 Rust / SQLite 动态测试覆盖；自动 embedding 和 Provider 账单对账仍不在当前能力中。
- 完整备份 schema 9 的 SQLite 往返已在临时项目库中覆盖参考资料、Memory、scheduler 和正式资产；SQLite 与 LocalStorage 的跨存储 ACID 不存在，浏览器 StoryAssets 因此保持只读而不是补偿式伪持久化。
- v2.1.8 已把章节总结、上下文和角色状态的桌面事实源收敛到 SQLite；旧缓存清理仍发生在 SQLite 提交之后，因此只能通过明确 ID 映射、warning 和幂等重试保证安全，不宣称跨存储 ACID。
- Tauri 完整构建依赖本机 Rust 与 Windows 构建环境。
- v3.0.0 自动化覆盖全书规划、单章节 Multi-Agent 协作、逐章采用推进、章节收束候选、持久化和备份；真实 Windows Tauri 中的完整 300 章自主流程尚未加入 WebdriverIO CI，本次浏览器 Mock 验收只能作为补充证据。
- 当前已支持进程内交互式候选队列和 migration 027 跨进程无人值守 run，并已建立 usage 成本估算、速率/并发限制、每日硬预算与 SQLite 混合语义 Memory；任意交互面板的跨进程接管、Provider 账单对账、自动 embedding 和模型自主 Tool Calling 尚不在当前范围。

发布结论必须准确区分“已由自动化证明”“仅手动验证”和“尚未覆盖”。

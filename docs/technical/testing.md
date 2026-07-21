# 测试策略与用例

> 当前版本：v2.1.5（章节工程任务跨重启恢复闭环）
> 适用范围：正文变更动态回归、Rust / SQLite 故障路径、Windows 真实 Tauri E2E、前端构建、Tauri 编译、静态文本契约与手动桌面验证。

---

## 1. 测试分层与通过原则

截至 v2.1.5，测试体系在正文安全、项目备份恢复和 Windows 真实桌面 E2E 上增加任务状态机、启动恢复事务和真实应用进程重启验证：

```text
Node 原生安全原语测试（内建 TypeScript 类型剔除 + 可控 deferred Promise）
→ Rust / SQLite command 测试（完整临时 Schema + 事务故障路径）
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

## 2. 动态测试入口

### 2.1 全部现有前端安全原语动态测试

```powershell
npm run test
```

该命令要求 Node.js >= 22.6，使用原生 `node:test` 和 `--experimental-strip-types` 直接执行生产安全模块，不新增测试依赖。类型剔除不代替 `tsc` 类型检查。

### 2.2 正文变更安全门定向测试

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

### 2.3 Rust / SQLite 命令安全测试

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

最低动态覆盖：

| 编号 | 场景 | 预期 |
|------|------|------|
| DB01 | 采用不存在的草稿 | 返回 `target_not_found`，原正式草稿不变 |
| DB02 | 采用其他章节的草稿 | 返回 `target_mismatch`，两章正式草稿均不变 |
| DB03 | 草稿更新影响 0 行 | 返回明确冲突，原正文不变 |
| DB-ADOPT | 正式采用中途失败 | 单一事务整体回滚，不出现 0 个或多个正式草稿 |
| DB-META | 正式采用成功 | 草稿、章节正式指针与章节元数据保持一致 |
| AI-TASK | AI 任务删除 | 使用完整临时 Schema 清理子表引用并删除任务 |

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

### 2.4 v2.1.2 完整项目备份恢复测试

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

### 2.5 v2.1.4 大文本正文安全测试

```powershell
cd src-tauri
cargo test large_text -- --test-threads=1
cd ..

npx tsx --test src/components/workspace/EditorArea.test.tsx
```

| 编号 | 场景 | 预期 |
|------|------|------|
| DB04 | 整文 SHA-256 不匹配 | 校验失败，document、chunks、draft 均无新增 |
| DB05 | 数据库已提交但缓存清理失败 | 正文保持 committed，返回 cleanup warning，不报告为可盲重试失败 |
| DB06 | draft create / update 在 document 写入后失败 | 同事务整体回滚，不留下新 document 或错误引用 |
| DB07 | 缺片、片 hash / 元数据错误或已存 chunk 损坏 | 保存或读取失败，不返回预览全文 |
| DB-LIFECYCLE | 连续更新、转小文本、删除草稿 | 旧 document 仅在不再被引用时删除，chunks 级联清理 |
| DB-UNICODE | 中文、emoji、CRLF | 全文、Unicode 字符数、UTF-8 字节数和完整字数一致 |

编辑器模块测试覆盖 loading / error 时保留已知安全内容、只接受归属当前作品章节的完整草稿，以及已验证无草稿章节的安全清空。它通过 Vite SSR 加载真实 `EditorArea` 模块，不以源码字符串匹配代替行为。

### 2.6 v2.1.5 任务重启恢复测试

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

### 2.7 Windows 真实桌面 E2E

```powershell
# 启动、窗口、迁移和前端异常冒烟测试
npm run test:e2e:smoke

# 八个独立桌面核心流程
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
| `restart-task-recovery.spec.ts` | 暂停 Mock AI、真实进程重启、恢复对话框、同一任务安全终结及二次启动幂等 |

测试通过 `data-testid`、元素状态、HashRouter 和 Tauri IPC 定位与断言，不使用中文文本、CSS 类、DOM 层级、屏幕坐标或截图识别。`frontend-diagnostics.json`、WebdriverIO、driver / Rust 日志、数据库位置和进程清理结果都会写入诊断目录；失败时在会话仍可访问的前提下尽力追加 DOM、当前路由和截图。

完整 Windows 前置条件、环境变量、数据隔离、Mock / 网络阻断、选择器契约和排障见 [Windows 桌面 E2E 自动化](desktop-e2e.md)。

GitHub Actions 的 `windows-desktop-e2e.yml` 在 Pull Request 与 `main` 推送时运行质量门和真实桌面 smoke；`v*` tag、每周定时和手动完整模式运行八条桌面流程，手动 `full-three` 可执行连续三轮稳定性验证。CI 在依赖准备阶段匹配 WebView2 与 EdgeDriver，随后以 Cargo / npm offline 模式构建并运行 E2E；失败诊断作为短期 artifact 上传。

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

因此，静态检查通过只能作为补充证据，不能单独满足 v2.1.1 发布验收。

---

## 4. 基础构建与质量命令

```powershell
# ESLint
npm run lint

# TypeScript 类型检查 + 前端生产构建
npm run build

# Rust 编译检查
cd src-tauri
cargo check
cd ..

# Tauri 完整构建
npm run tauri build
```

项目辅助脚本：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/agent-workflow/check_docs_sync.ps1
powershell -ExecutionPolicy Bypass -File scripts/agent-workflow/verify_project.ps1
```

辅助脚本不替代第 2 节的定向动态测试。发布汇报必须逐项记录真实命令、退出码与失败信息，不能只写“综合验证通过”。

---

## 5. v2.1.1 手动安全回归

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

- v2.1.1 已引入 Node 原生安全原语动态测试，v2.1.4 增加编辑器失败关闭模块测试；更广泛的 React 组件级并发集成覆盖仍需继续补齐。
- 章节切换的 Leave Guard 已纳入桌面 E2E；HashRouter 其他非按钮导航与 Tauri 原生窗口 close-request 尚未纳入可恢复离开保护的自动化闭环。
- 当前动态测试已证明会话级幂等 claim / release，以及 `generation_jobs` 重启后的安全终结；跨重启自动续跑和其他 AI 任务模型仍需要持久化 attempt / operation 记录与副作用幂等协议。
- Windows 桌面自动化采用 WebdriverIO + Tauri Driver，不计划用 Playwright 浏览器页面或截图式 Computer Use 替代真实 Tauri E2E。
- `recovery-dialog` 已作为 `generation_jobs` 的真实启动恢复节点纳入桌面 E2E；其他 AI 任务模型仍不得为测试伪造恢复能力。
- 当前产品没有名为 `Artifact`、`PlacementProposal` 或 `ApplyPlan` 的持久化实体；候选测试只按现有模型验证草稿、AI 任务、目标 / 基础正文绑定、采用状态和幂等，不能把这些等价约束写成不存在的实体状态。
- DB08“前端超时但 Rust 随后提交”的 operation ID 查询与幂等恢复仍需专项动态验证。
- 大文本 DB04～DB07 与章节工程任务跨重启安全结算已由 Rust / SQLite 和真实 Tauri 故障场景覆盖；质量报告事务、自动续跑和持久正文锁定模型尚未纳入本版本自动化门槛。
- 完整备份的 SQLite 往返已在同一临时项目库中覆盖；SQLite 与 LocalStorage 的跨存储 ACID 不存在，前端补偿撤销尚未由真实 Tauri + 浏览器存储端到端测试覆盖。
- Tauri 完整构建依赖本机 Rust 与 Windows 构建环境。

发布结论必须准确区分“已由自动化证明”“仅手动验证”和“尚未覆盖”。

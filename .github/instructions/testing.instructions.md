# Testing Instructions

> 适用于：所有版本的验证与测试
> 优先级：高
> 当前版本从 `package.json` 派生；命令以 `package.json` scripts 与 [测试策略](../../docs/technical/testing.md) 为准
> 适用范围：整个项目

---

## 1. 三类验证层级

| 层级                | 触发                                                          | 入口                                                                                 |
| ------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| 日常修改            | 任何代码、脚本、文档或开发指令变更                            | `npm run verify:change`（先加 `-- --dry-run` 查看选择理由）                          |
| 专项验收            | 用户明确要求的领域检查：工作区可靠性、迁移、DSH、指定桌面场景 | 对应专项脚本，或 `npm run test:e2e -- --spec <a> --spec <b>` 一次构建后运行多个场景  |
| 发布 / 明确完整验收 | 发布任务、定时完整验收                                        | `powershell -ExecutionPolicy Bypass -File scripts/agent-workflow/verify_project.ps1` |

完整发布矩阵只在对应任务中运行一次；它不是普通修改的默认检查，定向检查也不能替代它。发布矩阵已包含的子测试不再提前手动重复。

### 1.1 按变更范围选择检查

`npm run verify:change` 读取已暂存、未暂存与未跟踪的变更路径（PR 中用 `--base <ref>` 纳入基线以来的提交），按 `scripts/quality/verification-scopes.mjs` 的模块归属表选择行为测试、Rust 筛选条件和桌面场景，合并后去重，并输出选择原因、命令、用例数、耗时与结果。本地与 PR CI 使用同一份归属表。

| 变更                                 | 默认检查                                                   |
| ------------------------------------ | ---------------------------------------------------------- |
| 文档、开发指令                       | 文档同步、改动文件格式、差异检查；涉及版本时加版本同步     |
| 局部前端逻辑                         | 相邻或所属模块行为测试、改动文件 ESLint、一次类型检查      |
| 用户交互、写作流程                   | 上述检查，加对应真实桌面场景                               |
| Rust、SQLite 逻辑                    | `--locked` 编译检查及有非零匹配证明的相关 Rust/SQLite 测试 |
| Migration、共享持久化、DSH、打包配置 | 扩大到对应完整领域门禁；打包变化验证生产构建               |
| 发布、定时完整验收                   | 完整矩阵，各测试集合执行一次                               |

未映射的代码路径必须在归属表中补充行为归属；选择器不会以零测试通过，也不会自动扩大为全仓检查。同一批代码/配置未变化且已通过的检查不重复运行；修复失败或出现具体新风险时只复测受影响项。任何检查失败都传播非零退出码。

### 1.2 版本与文档同步

```powershell
npm run test:version-sync
npm run test:docs-sync
```

版本、路线或发布口径变化时核对 npm lock、Cargo manifest / lock、Tauri 配置、前端版本常量，以及 README、CHANGELOG、路线图和测试文档中的当前版本。

### 1.3 前端测试、质量与构建

```powershell
npm run test:coverage
npm run lint:ci
npm run build
npm run test:bundle-size
```

- `test:coverage` 由 c8 包裹 `test:all` 一次执行归属校验、Node/tsx、独立 AI 面板、Vitest、性能与工作台测试；同一轮 Vitest 通道同时采集关键组件覆盖率，随后只生成核心覆盖率报告和检查关键组件阈值，不再次执行相同组件测试。阈值只能收紧。
- `lint:ci` 不允许 error 或 warning；日常修改只对改动文件运行 ESLint 与一次 `tsc --noEmit`，构建配置或依赖变化时才运行完整 lint 与 `build`。
- `build` 必须同时通过 TypeScript 类型检查与 Vite 生产构建。

### 1.4 Rust / SQLite

```powershell
cargo check --locked --manifest-path src-tauri/Cargo.toml
node scripts/quality/run-cargo-tests.mjs --filter services::draft_service::
cargo test --locked --manifest-path src-tauri/Cargo.toml -- --test-threads=1
```

相关领域测试通过 `run-cargo-tests.mjs` 以 `--filter` 或 `--exact` 选择，零匹配、名称歧义或零通过都失败关闭，并保留 `--locked` 与串行参数。专项脚本（`test:workspace-recovery`、`test:large-text-integrity`、`test:migrations`）按列出的完整测试名精确执行，不再运行全部 Rust 测试。AI Task 删除与项目备份用例由完整 `cargo test` 覆盖，发布聚合器只以 `--list-only` 校验它们存在；`test:ai-tasks-delete` 与 `test:project-backup` 仍可单独运行真实 Rust 行为。事务回滚、归属校验、稳定 ID、迁移幂等和故障注入必须由临时 SQLite 动态测试证明。

### 1.5 Windows 真实 Tauri E2E

```powershell
# app-start + 生产界面日常写作场景
npm run test:e2e:smoke

# 一次构建，运行多个指定场景
npm run test:e2e -- --spec chapter-save --spec leave-guard

# 发布门禁完整套件
npm run test:e2e
```

默认桌面验收使用生产界面、真实 Tauri、隔离 SQLite、固定模型响应、外部网络阻断和进程清理；已从生产移除的旧面板只由 `scripts/e2e/spec-selection.ts` 列出的兼容性用例在 E2E 构建中显式启用。`workbench-writing-smoke` 覆盖创建作品和章节 → 创建工作台任务 → 生成候选 → 请求修订 → 显式进入审阅 → 编辑保存 → 确认采用 → 真实进程重启 → 核对正文、采用记录和授权状态；夹具只准备前置资产，不代替待验证的保存与采用。五轮跨作品闭环继续用于完整验收；取消、失效授权、冲突和损坏正文按相关变更触发。Mock 总结失败是失败边界证据，不得描述为总结成功。

### 1.6 Tauri 生产构建

```powershell
npm run tauri:build
```

打包配置、依赖图或发布任务才运行完整构建；E2E 专用 executable 不能替代生产构建。

### 1.7 Git 状态

```powershell
git status --short
```

只有版本发布终态要求 clean working tree；普通任务保留用户已有修改，不为取得干净工作树自动提交或清理。

---

## 2. 统一发布入口

```powershell
powershell -ExecutionPolicy Bypass -File scripts/agent-workflow/verify_project.ps1
```

该脚本顺序运行版本同步、文档同步、覆盖率（含关键组件阈值）、组件体积、ESLint、前端构建、包体预算、`cargo check --locked`、Gateway 清理与重建、所需 Rust 回归用例存在性校验、完整串行 `cargo test`、完整桌面 E2E、Tauri 生产构建、清单与 Git 状态。它是聚合入口，不减少任一子测试的证据要求，也不应先手动重复其子测试。

`release_workflow.ps1` 会调用统一验证，并再次检查工作树；脚本不得自动 commit、tag 或 push。

---

## 3. 定向复测

开发中可直接运行选择器选出的命令，或按需运行专项入口：

```powershell
npm run test:workspace-safety
npm run test:e2e -- --spec chapter-context-persistence
node scripts/quality/run-cargo-tests.mjs --filter commands::tests::
```

定向复测通过不等于完整版本验收。修复后只复测受影响项；变更触及新的归属范围时由选择器重新选择，不无条件重跑全部门禁。

---

## 4. 失败处理

如果任何一步失败：

1. 完整记录命令、退出码和首个根因错误。
2. 区分产品缺陷、测试缺陷与环境缺失，不得把环境失败写成通过。
3. 在目标范围内修复问题。
4. 复测受影响项；发布任务在最终提交与配置上完整运行一次发布矩阵。
5. 只有发布矩阵全部通过且工作树干净后才可建议发布。

不得吞掉异常、忽略非零退出码，或用“其他测试通过”抵消失败项。跳过、`NOT_RUN`、`NOT_APPLICABLE`、Mock、浏览器与真实桌面/云端证据分别报告。

---

## 5. 数据与证据边界

- 自动测试使用 Mock Provider，不依赖真实 API Key，不访问外部 AI 服务。
- Rust 测试和桌面 E2E 只使用临时、隔离数据库，不读取或修改正式用户数据。
- LocalStorage 动态测试只证明浏览器开发回退；桌面发布行为必须由 Rust / SQLite 和真实 Tauri E2E 证明。
- 截图只用于诊断，不作为业务断言；真实桌面断言使用 DOM、`data-testid`、受限 IPC 和只读 SQLite 探针。
- 汇报必须逐项列出实际执行结果与实测命令数、用例数、耗时，明确区分自动化证明、手动抽查和未覆盖范围；不预先承诺未经测量的提速比例。

---

> **本文件是 AI Novel Studio 测试验证的权威指令。任何版本未经完整发布矩阵验证不得发布；日常修改按变更范围验证。**

# Workflow Script Usage

> 文件：`.github/workflows-docs/workflow-script-usage.md`
> 版本：随 `package.json` 派生
> 用途：说明变更选择器与 Agent Workflow 核心、专项 PowerShell 脚本的用途和使用方法

---

## 1. 脚本列表

```text
scripts/quality/
├── verify-change.mjs                  # 日常入口：按变更范围选择并执行检查（npm run verify:change）
├── verification-scopes.mjs            # 模块归属表：变更路径 → 行为测试 / Rust 筛选 / 桌面场景
├── verification-process.mjs           # 子进程执行、用例计数与耗时采集
├── run-cargo-tests.mjs                # Rust 精确/筛选执行，零匹配失败关闭
└── test-ownership.mjs                 # 测试归属校验与遗漏单测执行

scripts/agent-workflow/
├── verify_project.ps1                 # 完整发布矩阵（仅发布/明确完整验收）
├── check_docs_sync.ps1                # 检查关键文档是否存在和同步
├── test_docs_sync.ps1                 # 文档同步门禁与失败关闭回归
├── check_version_sync.ps1             # 检查版本元数据与发布文档一致性
├── run_feature_workflow.ps1           # 功能开发开工检查 / 调用变更选择器
├── run_workspace_test_suite.ps1       # 工作区专项：定向 Vitest + 精确 Rust 用例
├── run_cargo_test_filter.ps1          # 单个 Rust 过滤器（带最小匹配数）
├── runtime_check_ai_task_delete.ps1   # AI Task 删除 Rust 动态检查
├── runtime_check_project_backup.ps1   # 完整项目备份 Rust 动态检查
└── release_workflow.ps1               # 发布前检查（不自动发布）
```

---

## 2. verify-change.mjs（`npm run verify:change`）

### 用途

日常修改的统一验证入口。读取已暂存、未暂存与未跟踪的变更路径，按 `verification-scopes.mjs` 选择行为测试、Rust 筛选条件与桌面场景，合并去重后执行，并输出选择原因、命令、用例数、耗时和结果。本地与 PR CI 共用同一份归属表。

### 运行

```powershell
npm run verify:change -- --dry-run            # 只输出选择理由与命令
npm run verify:change                         # 执行所选检查
npm run verify:change -- --base origin/main   # 纳入基线以来的提交（PR 使用）
npm run verify:change -- --lane frontend      # 只运行某一车道：frontend / native / desktop
npm run verify:change -- --full               # 完整矩阵（合入 main、定时、发布）
```

### 说明

- 未映射的代码路径抛出 `Unmapped change`，需要在归属表补充；没有行为测试的归属抛出 `No behavior tests`，不会以零测试通过，也不自动扩大为全仓检查。
- 完整门禁（覆盖率 / 完整 Rust / 完整桌面）会吸收对应的定向选择，避免同一测试执行两次。
- 任一检查失败返回非零；`--report <file>` 写出 JSON 证据，`--github-output` 供 CI 决定后续作业。

---

## 3. verify_project.ps1

### 用途

发布或明确完整验收时一次运行完整矩阵，输出统一摘要。普通修改不运行它。

### 运行

```powershell
powershell -ExecutionPolicy Bypass -File scripts/agent-workflow/verify_project.ps1
```

### 输出格式

```text
[verify_project] npm run test:version-sync: PASS
[verify_project] npm run test:docs-sync: PASS
[verify_project] npm run test:coverage: PASS
[verify_project] npm run test:component-size: PASS
[verify_project] npm run lint:ci: PASS
[verify_project] npm run build: PASS
[verify_project] npm run test:bundle-size: PASS
[verify_project] cargo check: PASS
[verify_project] cargo clean -p novel-domain-gateway: PASS
[verify_project] cargo build -p novel-domain-gateway: PASS
[verify_project] required Rust regression discovery: PASS
[verify_project] cargo test: PASS
[verify_project] npm run test:e2e: PASS
[verify_project] npm run tauri:build: PASS
[verify_project] required checklists: PASS
[verify_project] git status: CLEAN
```

### 说明

- 命令步骤输出 `PASS / FAIL`，Git 工作树步骤输出 `CLEAN / DIRTY`
- `test:coverage` 在首次执行时采集覆盖率并检查关键组件阈值；AI Task 删除与项目备份用例由完整 `cargo test` 覆盖，聚合器只校验它们存在
- 任一步失败或工作树不干净都返回非零

---

## 4. check_docs_sync.ps1

### 用途

检查关键文档、Checklist、Skill、工作流脚本与治理文件是否存在，版本与当前阶段声明是否同步，CI/发布工作流是否保持固定顺序。

### 运行

```powershell
powershell -ExecutionPolicy Bypass -File scripts/agent-workflow/check_docs_sync.ps1
```

`test_docs_sync.ps1` 在其基础上追加失败关闭回归，是 `npm run test:docs-sync` 的实际入口。

---

## 5. run_feature_workflow.ps1

### 用途

功能开发的开工检查与验证阶段引导。不自动修改代码。

### 运行

```powershell
# 开工检查（默认）：git status、关键文件存在、版本与 Node 要求；不运行测试
powershell -ExecutionPolicy Bypass -File scripts/agent-workflow/run_feature_workflow.ps1

# 验证阶段：调用变更选择器
powershell -ExecutionPolicy Bypass -File scripts/agent-workflow/run_feature_workflow.ps1 -Phase Verify
powershell -ExecutionPolicy Bypass -File scripts/agent-workflow/run_feature_workflow.ps1 -Phase Verify -DryRun
powershell -ExecutionPolicy Bypass -File scripts/agent-workflow/run_feature_workflow.ps1 -Phase Verify -Base origin/main
```

### 说明

- `Prepare` 只读取状态并提示后续入口，不调用完整发布矩阵
- `Verify` 原样传播 `verify-change.mjs` 的退出码；失败不会被记为警告后返回成功

### 禁止

- 不自动修改代码
- 不自动 commit
- 不自动 tag
- 不调用危险命令

---

## 6. run_workspace_test_suite.ps1 与 run_cargo_test_filter.ps1

```powershell
powershell -ExecutionPolicy Bypass -File scripts/agent-workflow/run_workspace_test_suite.ps1 -Suite migrations
powershell -ExecutionPolicy Bypass -File scripts/agent-workflow/run_cargo_test_filter.ps1 -Filter commands::tests:: -MinimumCount 1
```

- `run_workspace_test_suite.ps1` 先运行套件的定向 Vitest，再把列出的完整 Rust 测试名交给 `run-cargo-tests.mjs --exact` 精确执行；名称缺失或歧义失败关闭，不再运行全部 Rust 测试。
- `run_cargo_test_filter.ps1` 对单个过滤器先 `--list` 校验最小匹配数，再以 `--locked` 与 `--test-threads=1` 执行。

---

## 7. release_workflow.ps1

### 用途

发布前检查，不负责强制发布。

### 运行

```powershell
powershell -ExecutionPolicy Bypass -File scripts/agent-workflow/release_workflow.ps1
```

### 流程

1. 运行 `check_version_sync.ps1` 检查全部版本来源
2. 检查 `CHANGELOG.md` 是否包含当前版本
3. 检查 `README.md` 是否更新
4. 运行 `verify_project.ps1`
5. 检查 `git status`
6. 输出是否可以创建 tag 的建议

### 禁止

- 不自动创建 tag
- 不自动 push
- 不自动删除文件
- 不自动修改版本号

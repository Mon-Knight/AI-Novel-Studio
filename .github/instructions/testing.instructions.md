# Testing Instructions

> 适用于：所有版本的验证与测试
> 优先级：高（每个版本必须执行）
> 当前基线：v2.1.8
> 适用范围：整个项目

---

## 1. 发布前强制验证矩阵

每个版本开发完成后，必须运行以下入口并通过。任一失败都阻断发布，不得把静态检查、编译通过或单次手动演示代替动态测试。

### 1.1 版本同步

```powershell
npm run test:version-sync
```

必须核对 npm lock、Cargo manifest / lock、Tauri 配置、前端版本常量，以及 README、CHANGELOG、路线图和测试文档中的当前版本。

### 1.2 前端动态测试、质量与构建

```powershell
npm run test
npm run lint
npm run build
```

- `npm run test` 使用 Node / tsx 动态执行生产安全模块。
- `npm run lint` 不允许 error；warning 必须在完成汇报中如实记录。
- `npm run build` 必须同时通过 TypeScript 类型检查与 Vite 生产构建。

### 1.3 补充静态与运行时回归

```powershell
npm run test:quality-workspace
npm run test:setting-suggestions
npm run test:ai-tasks-delete
npm run test:project-backup
```

PowerShell 文本契约检查只能证明入口或结构存在；`test:ai-tasks-delete` 和 `test:project-backup` 中的 Rust 运行时部分必须传播真实失败退出码。

### 1.4 Rust / SQLite

```powershell
cd src-tauri
cargo check
cargo test
cd ..
```

必须运行完整 Rust 测试，不得只执行单个过滤器后宣称发布通过。事务回滚、归属校验、稳定 ID、迁移幂等和故障注入必须由临时 SQLite 动态测试证明。

### 1.5 Windows 真实 Tauri E2E

```powershell
# 冒烟只用于快速定位
npm run test:e2e:smoke

# 发布门禁必须运行完整套件
npm run test:e2e
```

桌面 E2E 必须使用隔离 SQLite、强制 Mock Provider、外部网络阻断和进程清理。v2.1.8 的章节上下文场景还必须覆盖保存、真实应用重启、过期持久化、再次重启及生成排除。

### 1.6 Tauri 生产构建

```powershell
npm run tauri:build
```

完整构建必须生成可发布桌面产物；E2E 专用 executable 不能替代生产构建。

### 1.7 Git 状态

```powershell
git status --short
```

版本发布只能从 clean working tree 进行。存在未提交、未跟踪或意外生成文件时，统一验证和发布工作流必须返回非零。

---

## 2. 统一入口

```powershell
powershell -ExecutionPolicy Bypass -File scripts/agent-workflow/verify_project.ps1
```

该脚本依次运行第 1 节的版本同步、Node、ESLint、构建、补充回归、完整 Rust、完整桌面 E2E、Tauri 生产构建、清单和 Git 状态。它是聚合入口，不减少任一子测试的证据要求。

`release_workflow.ps1` 会调用统一验证，并再次检查工作树；脚本不得自动 commit、tag 或 push。

---

## 3. 定向复测

开发中可以使用过滤器快速定位，例如：

```powershell
npm run test:workspace-safety
npm run test:e2e -- --spec chapter-context-persistence

cd src-tauri
cargo test commands::tests -- --nocapture
cd ..
```

定向复测通过不等于完整版本验收。修复后仍需重新运行第 1 节全部门禁。

---

## 4. 失败处理

如果任何一步失败：

1. 完整记录命令、退出码和首个根因错误。
2. 区分产品缺陷、测试缺陷与环境缺失，不得把环境失败写成通过。
3. 在目标范围内修复问题。
4. 先定向复测，再重新运行完整验证矩阵。
5. 只有全部通过且工作树干净后才可建议发布。

不得吞掉异常、忽略非零退出码，或用“其他测试通过”抵消失败项。

---

## 5. 数据与证据边界

- 自动测试使用 Mock Provider，不依赖真实 API Key，不访问外部 AI 服务。
- Rust 测试和桌面 E2E 只使用临时、隔离数据库，不读取或修改正式用户数据。
- LocalStorage 动态测试只证明浏览器开发回退；桌面发布行为必须由 Rust / SQLite 和真实 Tauri E2E 证明。
- 截图只用于诊断，不作为业务断言；真实桌面断言使用 DOM、`data-testid`、受限 IPC 和只读 SQLite 探针。
- 发布汇报必须逐项列出实际执行结果，明确区分自动化证明、手动抽查和未覆盖范围。

---

> **本文件是 AI Novel Studio 测试验证的权威指令。任何版本未经完整验证不得发布。**

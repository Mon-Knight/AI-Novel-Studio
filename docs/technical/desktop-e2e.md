# Windows 桌面 E2E 自动化

> 适用版本：v2.1.7 及后续版本的桌面 E2E 基础设施
> 目标平台：Windows 10 / 11，真实 Tauri 窗口、Rust IPC、SQLite 与 WebView2

本套测试使用 WebdriverIO、`tauri-driver` 和 Microsoft Edge WebDriver 直接操作 WebView DOM。测试只通过 `data-testid`、元素状态、路由和受限 Tauri IPC 进行定位与断言；截图不参与点击、定位或通过判定，且只在失败后、WebDriver 会话仍可访问时尽力生成。

---

## 1. 接入前只读审计

### 1.1 版本基线

以下版本来自 `package.json`、`package-lock.json`、`Cargo.toml`、`Cargo.lock` 和接入时的 Windows 验证机。带“安装”的版本是锁文件或本机实际解析结果，不只是 semver 声明。

| 项目 | 声明 / 最低版本 | 接入时安装版本 |
|------|-----------------|----------------|
| 应用 | `2.1.2` | `2.1.2` |
| Tauri Rust crate | `1.7` | `1.8.3` |
| `tauri-build` | `1.5` | `1.5.6` |
| `@tauri-apps/api` | `^1.6.0` | `1.6.0` |
| `@tauri-apps/cli` | `^1.5.14` | `1.6.3` |
| React / React DOM | `^18.3.1` | `18.3.1` |
| React Router | `^6.23.1` | `6.30.3` |
| TypeScript | `^5.4.5` | `5.9.3` |
| Vite | `^5.3.1` | `5.4.21` |
| Node.js | `>=22.6.0` | `24.15.0` |
| npm | 未锁定 | `11.12.1` |
| Rust / Cargo | manifest `rust-version = 1.60` | `1.95.0` |
| WebdriverIO | 固定 `9.29.1` | `9.29.1` |
| WDIO Mocha adapter | 固定 `9.29.1` | `9.29.1` |
| `tauri-driver` | 独立工具 | `0.1.5` |
| WebView2 / EdgeDriver | 主版本必须一致 | 验证机均为 `150.0.4078.83` |

`package-lock.json` 中的 `@vitest/*` 是 WebdriverIO 断言依赖的传递依赖。项目没有 `vitest` 命令、Vitest 配置或 Vitest 测试套件，不能把这些传递包视为已有 Vitest 覆盖。

### 1.2 原有测试与构建入口

接入前已有：

- `npm run test`：Node 原生 `node:test`，运行正文安全门和备份服务动态测试。
- `npm run test:workspace-safety`：正文变更安全门定向测试。
- `cargo test`：Rust / SQLite 命令、事务和备份恢复测试。
- `npm run test:ai-tasks-delete`：AI Task 删除的真实 Rust / SQLite 运行时检查。
- `npm run lint`、`npm run build`、`cargo check`、`npm run tauri:build`：质量和生产构建入口。

接入前没有：

- Windows 真实 Tauri 窗口 E2E；
- WebdriverIO、`tauri-driver`、EdgeDriver 或 Playwright 配置；
- Vitest 或 React Testing Library 组件测试；
- 可由自动化访问的 Tauri IPC 诊断桥；
- 失败时自动收集 DOM、前端 console、Rust 日志和路由的机制。

### 1.3 启动、数据与环境

- 浏览器开发：`npm run dev`，Vite 默认运行在 `http://localhost:1420`。
- Tauri 开发：`npm run tauri:dev`，由 Tauri 启动 Vite。
- Tauri 生产构建：`npm run tauri:build`，前端先执行 `npm run build`，随后嵌入 release 应用。
- 正式 SQLite：`%LOCALAPPDATA%\AI Novel Studio\ai-novel-studio.db`，不可被测试读取或写入。
- 正式单实例和窗口状态：`%APPDATA%\com.ainovelstudio.app`。
- 浏览器开发模式的数据回退到 LocalStorage；真实 Tauri 模式通过 Rust IPC 使用 SQLite。
- AI 设置默认是本地 Mock 模式；API Key 和其他本机设置保存在本地，不来自仓库环境文件。
- Tauri 配置没有 updater 插件或自动更新端点，因此当前应用没有需要在 E2E 中额外关闭的自动更新任务。

### 1.4 稳定选择器缺口

接入前 `src/` 中没有任何 `data-testid`。以下关键路径只能依赖中文文本、CSS 类、DOM 层级或原生对话框，均不满足桌面自动化要求：

| 页面 / 流程 | 接入前缺口 |
|-------------|------------|
| 应用启动 | 应用壳、初始化错误、首页列表无稳定锚点 |
| 作品首页 | 列表、新建、名称输入、保存、作品卡片和打开操作无稳定锚点 |
| 作品详情 | 设置区、编辑、名称输入、保存和结果提示无稳定锚点 |
| 写作工作台 | 卷 / 章创建、章节列表、章节项、编辑器和保存无稳定锚点 |
| AI 候选 | 生成入口、生成提交、约束、候选审查、采用和确认无稳定锚点 |
| 离开保护 | 原生确认框无法通过 WebDriver DOM 访问 |
| 恢复 | 首批 E2E 接入时产品尚无恢复节点；v2.1.5 已增加真实 `recovery-dialog` 与重启流程 |
| 请求取消 | v2.1.5 只能写入任务取消终态，无法中止在途 HTTP / Mock 请求；v2.1.6 增加真实取消链路与桌面回归 |

---

## 2. 技术方案

```text
scripts/e2e/run-e2e.ts
  -> 每个 suite 在 .e2e-tools/target 构建一次带前端标记和 Cargo e2e feature 的 release 应用
  -> 复制为本轮唯一 application/ai-novel-studio-e2e.exe
  -> 为每个 spec 创建独立临时目录和端口
  -> 写入随机 run-id marker
  -> 启动 WebdriverIO
       -> 启动 tauri-driver
            -> 启动匹配 WebView2 的 msedgedriver
            -> 独立启动真实 staged ai-novel-studio-e2e.exe
                 -> Rust 校验 feature / runtime flag / run-id marker
                 -> Rust 初始化独立 SQLite / 单实例状态
                 -> WebView2 使用独立 user data folder
                 -> 前端在应用模块加载前安装 WebView 外部网络硬阻断
                 -> AI 设置在 E2E 构建中强制返回 Mock Provider
                 -> React 通过真实 Tauri IPC 读写数据库
  -> 每个 spec 后校验 frontend-diagnostics.json 与进程清理结果
  -> 采集诊断并清理本轮创建的进程
```

核心文件：

```text
tests/e2e/
  fixtures/data.ts
  app-start.spec.ts
  project-create-open.spec.ts
  project-edit-save.spec.ts
  chapter-save.spec.ts
  large-text-save.spec.ts
  candidate-review-apply.spec.ts
  leave-guard.spec.ts
  generation-job-cancel.spec.ts
  restart-task-recovery.spec.ts
  quality-history-replay.spec.ts
  chapter-context-persistence.spec.ts
  helpers.ts
  wdio.conf.ts
scripts/e2e/run-e2e.ts
src/services/tauri/e2eBridge.ts
src/services/tauri/e2eNetworkGuard.ts
src/components/common/E2eDialogHost.tsx
src-tauri/src/runtime.rs
```

设计边界：

- `browserName: "wry"` 和 `tauri:options.application` 指向真实 release EXE，不使用浏览器预览代替桌面应用。
- WebdriverIO 使用经典 WebDriver 协议，测试与应用交互均为 DOM / WebDriver 命令。
- E2E 构建与生产构建使用不同 Cargo target：默认是 `.e2e-tools/target`，运行器拒绝与 `src-tauri/target` 重叠的覆盖路径，因此测试不会覆盖生产 release 产物。
- Cargo `e2e` feature 和运行时标记必须双向匹配：E2E feature 构建没有 `AI_NOVEL_STUDIO_E2E=1` 会拒绝启动，普通构建收到该标记也会拒绝进入 E2E 模式。
- `window.__AI_NOVEL_STUDIO_E2E__` 只在 `VITE_AI_NOVEL_STUDIO_E2E=1` 的专用构建中存在。
- IPC 桥默认只允许诊断和只读查询：`get_e2e_diagnostics`、`get_e2e_novel_commit_state`、`get_e2e_large_text_draft_state` 及必要业务读取。另有 `corrupt_e2e_large_text_chunk` 仅用于隔离测试库故障注入；大文本状态探针与损坏命令只在 Cargo `e2e` feature 下注册和编译，运行时还必须通过标志、临时路径与 marker 校验，普通生产产物不包含这两个命令。除该确定性损坏场景外，测试数据仍通过真实 UI 和生产写入 IPC 建立。
- 原生确认框在 E2E 构建中由 `E2eDialogHost` 映射为语义等价的 DOM 对话框；正式构建仍使用 Tauri 原生 dialog。
- `fixtures/data.ts` 保存固定作品名、章节正文、离开保护正文和 Mock 响应片段，运行器按显式 `allSpecs` 清单选择场景。每个 spec 单独启动应用并使用空数据库，不预灌生产表、不依赖前一测试；场景数据从这些确定性输入经 UI 创建，AI 内容由本地 Mock Provider 返回。
- 每个 suite 只构建一次。运行器在 `.e2e-tools/target/release` 中比较 Cargo 包名 `ai-novel-studio.exe` 与 Tauri `productName` 对应 EXE，选取修改时间最新的现有产物，再复制为本轮唯一的 `%TEMP%\...\application\ai-novel-studio-e2e.exe`；每个 spec 都独立启动这份只读 staged EXE。
- 每个 spec 使用随机 `AI_NOVEL_STUDIO_E2E_RUN_ID`，运行器以独占创建方式把同一 ID 写入数据目录中的 `.ai-novel-studio-e2e-marker`。Rust 在数据库初始化前规范化临时目录并核对 marker，防止手工拼接环境变量误入测试模式。

---

## 3. Windows 前置条件

1. Windows 10 或 11，已安装 Microsoft Edge WebView2 Runtime。
2. Node.js `>=22.6.0`，执行过 `npm install`。
3. Rust stable、Cargo、MSVC target 和 Visual Studio C++ Build Tools 可用于 Tauri 构建。
4. 安装 `tauri-driver 0.1.5`：

```powershell
cargo install tauri-driver --version 0.1.5 --locked
```

5. 下载与本机 WebView2 **主版本一致**的 Microsoft Edge WebDriver。可放到任一位置：

```text
.e2e-tools/**/msedgedriver.exe
PATH 中的 msedgedriver.exe
AI_NOVEL_STUDIO_E2E_NATIVE_DRIVER 指定的绝对路径
```

运行器优先使用显式环境变量，其次扫描 `.e2e-tools`，最后搜索 `PATH`。驱动下载和 `npm install` 可能需要网络，但测试运行本身不依赖互联网。

### 3.1 Windows CI

`.github/workflows/windows-desktop-e2e.yml` 在固定的 `windows-2022` GitHub-hosted runner 上运行两层门禁：

- Pull Request 和 `main` 分支 push：先运行前端测试、Lint、前端构建、Rust check / test 与无安装包的生产 Tauri 构建，再执行真实窗口 E2E smoke。
- `v*` 发布标签、每周定时和手工触发：通过同一质量门后执行十一个真实桌面场景；手工触发还可选择 `full-three` 连续执行三轮。

CI 从 Microsoft 文档规定的 WebView2 Runtime 注册表键读取 `pv`，下载该精确版本的 Microsoft Edge WebDriver，并在执行前验证双方版本号前三段一致。它同时固定 `tauri-driver 0.1.5`、关闭 EdgeDriver 遥测，并在驱动下载后暂停 Evergreen WebView2 更新，避免准备和启动之间发生版本漂移。

所有依赖、Rust crates、`tauri-driver` 和 EdgeDriver 都在准备阶段下载。专用 E2E EXE 随后使用 Cargo / npm offline 模式构建；真正的 WDIO 步骤设置 `AI_NOVEL_STUDIO_E2E_SKIP_BUILD=1`、`CARGO_NET_OFFLINE=true` 和 `NPM_CONFIG_OFFLINE=true`，不会在场景执行时补装依赖。应用侧仍由 WebView 网络 guard、强制 Mock Provider 和 Rust AI IPC 阻断共同保证零外部业务请求；WebDriver 只使用本机 loopback 端口。失败时 CI 上传脱敏后的 `test-results/e2e`，保留 7 天。

---

## 4. 运行命令

### 4.1 启动冒烟测试

```powershell
npm run test:e2e:smoke
```

只运行 `app-start.spec.ts`，验证窗口、`app-shell`、首页、前端异常、迁移和 SQLite 诊断。

### 4.2 全部桌面流程

```powershell
npm run test:e2e
```

运行器先构建一次 suite 应用；十一个 spec 随后逐个在独立应用进程、数据库和 WebView2 profile 中执行。

### 4.3 定向单场景复测

单独复测一个场景时可传入清单中的 spec 名称，扩展名可省略：

```powershell
npm run test:e2e -- --spec candidate-review-apply
```

`--spec` 只能出现一次，不能与 `--smoke` 同时使用；未知名称会在启动应用前失败。

### 4.4 连续稳定性检查

```powershell
npm run test:e2e:smoke
npm run test:e2e:smoke
npm run test:e2e:smoke
```

正式验收还应连续运行三次完整 `npm run test:e2e`。每次运行都会创建新临时根目录，成功后删除，不会沿用前一次数据。

### 4.5 已知新鲜构建的快速复测

```powershell
$env:AI_NOVEL_STUDIO_E2E_SKIP_BUILD = '1'
npm run test:e2e:smoke
Remove-Item Env:AI_NOVEL_STUDIO_E2E_SKIP_BUILD
```

只在 `.e2e-tools/target` 中的 release EXE 已经同时使用 `VITE_AI_NOVEL_STUDIO_E2E=1` 和 Cargo `e2e` feature 构建、且相关前端和 Rust 代码没有变化时使用。发布验收不得用一个来源不明的旧 EXE 代替完整构建。

---

## 5. 环境变量

正常使用只需运行 npm 命令。以下变量用于 CI、驱动位置或故障定位：

| 变量 | 作用 |
|------|------|
| `AI_NOVEL_STUDIO_E2E=1` | 打开 Rust E2E 隔离和网络阻断；其他值会被运行器拒绝 |
| `VITE_AI_NOVEL_STUDIO_E2E=1` | 构建时启用前端受限桥和 DOM 对话框，由运行器自动设置 |
| `AI_NOVEL_STUDIO_E2E_DATA_DIR` | 单个 spec 已存在的绝对临时目录；由运行器生成 |
| `AI_NOVEL_STUDIO_E2E_RUN_ID` | 单个 spec 的随机握手 ID；必须与临时目录 marker 一致，由运行器生成 |
| `AI_NOVEL_STUDIO_E2E_APP` | 覆盖被测 EXE 路径；该 EXE 必须是 E2E 构建 |
| `AI_NOVEL_STUDIO_E2E_CARGO_TARGET_DIR` | 覆盖 E2E Cargo target，默认 `.e2e-tools/target`；不得与 `src-tauri/target` 重叠 |
| `AI_NOVEL_STUDIO_E2E_DRIVER` | `tauri-driver` 可执行文件名或路径 |
| `AI_NOVEL_STUDIO_E2E_NATIVE_DRIVER` | `msedgedriver.exe` 路径 |
| `AI_NOVEL_STUDIO_E2E_DRIVER_HOST` | driver 地址，默认 `127.0.0.1` |
| `AI_NOVEL_STUDIO_E2E_DRIVER_PORT` | 可选的固定起始端口；未设置时运行器自动选择整组空闲端口，原生 driver 使用各端口 `+1000` |
| `AI_NOVEL_STUDIO_E2E_ARTIFACTS` | 运行诊断产物根目录，默认 `test-results/e2e` |
| `AI_NOVEL_STUDIO_E2E_KEEP_DATA=1` | 即使成功也保留临时 SQLite / WebView2 数据 |
| `AI_NOVEL_STUDIO_E2E_SKIP_BUILD=1` | 跳过 Tauri E2E 构建，仅用于已知新鲜 EXE |
| `AI_NOVEL_STUDIO_E2E_SPEC_TIMEOUT` | 单个 WDIO 进程总超时，默认 10 分钟 |
| `AI_NOVEL_STUDIO_E2E_TIMEOUT` | Mocha 测试超时，默认 120 秒 |
| `AI_NOVEL_STUDIO_E2E_WAIT` | WebDriver 显式等待默认值，默认 15 秒 |
| `AI_NOVEL_STUDIO_E2E_LOG_LEVEL` | WebdriverIO 日志级别，默认 `warn` |

不要手工设置 `AI_NOVEL_STUDIO_E2E_DATA_DIR` 或 `AI_NOVEL_STUDIO_E2E_RUN_ID`。Rust 要求数据目录已存在、规范化后是操作系统临时目录的专用子目录、不是文件系统根或正式 `%LOCALAPPDATA%\AI Novel Studio`，并要求 marker 内容与 run-id 完全一致；任一条件不满足都会在数据库初始化前拒绝启动。

---

## 6. 数据、网络与更新隔离

### 6.1 文件隔离

每个 spec 使用：

```text
%TEMP%\ai-novel-studio-e2e-*\<序号>-<spec>\
  .ai-novel-studio-e2e-marker
  ai-novel-studio.db
  e2e-rust.log
  webview2\
  instance.lock / window-state 等运行状态
```

同一 run root 还包含本轮专用的 `application\ai-novel-studio-e2e.exe`；所有 spec 共享这一份只读应用副本，但数据目录彼此独立。

运行器先创建 `AI_NOVEL_STUDIO_E2E_DATA_DIR` 和 marker；Rust 在数据库初始化之前规范化并校验它，然后：

- SQLite 固定为 `<data-dir>\ai-novel-studio.db`；
- `WEBVIEW2_USER_DATA_FOLDER` 固定为 `<data-dir>\webview2`，隔离 LocalStorage、缓存和浏览器状态；
- 单实例锁、聚焦请求和窗口状态也使用该临时目录；
- 新数据库执行与正式应用相同的建表 / 迁移流程、`WAL` 和外键设置。
- 每个 spec 的 WebdriverIO `before` 钩子调用只读诊断，并以 SQLite `PRAGMA database_list` 取得实际主库路径；实际路径必须与规范化后的 `<data-dir>\ai-novel-studio.db` 完全一致，业务步骤才会继续。
- 作品保存场景还会调用 `get_e2e_novel_commit_state`：Rust 使用独立的 `SQLITE_OPEN_READ_ONLY | SQLITE_OPEN_NO_MUTEX` 连接读取行数、标题和更新时间。该连接不复用全局写连接，因此能证明另一连接已经看见事务提交，并同时验证同一作品没有重复写入。

诊断获取全局 SQLite 锁最多等待 2 秒，超时会明确失败，不会让测试无限挂起。它还检查 `integrity_check`、外键、journal mode、必需表和行数。

成功 spec 默认删除临时目录。失败 spec 保留临时目录并把路径写入运行元数据，便于只读检查；`AI_NOVEL_STUDIO_E2E_KEEP_DATA=1` 可显式保留全部数据。`.e2e-tools/` 和 `test-results/e2e/` 均被 Git 忽略。

### 6.2 Mock AI 与网络阻断

- `VITE_AI_NOVEL_STUDIO_E2E=1` 会让 AI 设置读取器无条件返回 `runtimeMode: "mock"` / `provider: "mock"`；即使隔离 profile 中出现意外设置，也不能把 E2E 切到真实 Provider。
- Mock AI Client 在本地返回固定结构和测试正文，不需要 API Key，不访问 OpenAI、DeepSeek 或其他 Provider。
- E2E-only pause gate 支持 `AbortSignal`；请求取消后 waiter 必须立即归零，`releaseMockAi` 不得再次结算或产生迟到正文。
- E2E 桥在 `App` 及业务模块加载前安装 WebView 网络 guard。它允许当前应用端点及 `data:` / `blob:` / `about:`，并在请求发出前拦截外部 `fetch`、`XMLHttpRequest`、`WebSocket`、`EventSource` 和 `navigator.sendBeacon`。
- guard 只记录 transport、protocol、时间和计数，不记录 URL、query、header 或 body；因此诊断不会泄漏 API Key、Authorization 或完整 prompt。
- 即使前端错误进入真实 API 路径，Rust `ai_chat_completion` 也会在创建或发送 HTTP 请求之前检查 E2E 模式并返回错误。
- 测试不配置 API Base URL、Authorization Header、代理或真实账号。
- 当前 Tauri 应用未集成自动更新器；因此 E2E 中不会触发更新检查。

`networkBlocked: true` 证明 Rust AI IPC 阻断已启用；`webviewNetwork.installed: true` 和 `total: 0` 证明前端 guard 已安装且场景没有尝试外部请求。WDIO 每个测试后固定写出 `frontend-diagnostics.json`，运行器再独立解析它：文件缺失、无法解析、前端 console error、未处理异常、guard 未安装或任一外部网络尝试都会把 spec 改判为失败，即使 WDIO 原始退出码为 0。该机制不是操作系统级防火墙；WebDriver 仍使用本机 loopback 端口。测试运行本身不依赖互联网。

---

## 7. 选择器契约

业务测试不得使用中文按钮文本、CSS 类、DOM 父子层级、窗口坐标或分辨率。核心契约如下：

| 区域 | `data-testid` |
|------|---------------|
| 应用 / 首页 | `app-shell`、`project-list`、`project-create`、`project-card`、`project-open` |
| 作品编辑 | `project-settings`、`project-edit`、`project-name-input`、`project-save` |
| 卷章 | `volume-create`、`volume-create-dialog`、`volume-title-input`、`volume-save`、`volume-item`、`chapter-create-first`、`chapter-create`、`chapter-create-dialog`、`chapter-title-input`、`chapter-create-submit`、`chapter-list`、`chapter-item` |
| 编辑器 | `chapter-editor`、`chapter-save`、`chapter-adopt`、`chapter-load-retry` |
| AI 候选 | `ai-generate`、`ai-generate-submit`、`candidate-review`、`candidate-content`、`candidate-constraints`、`candidate-replace`、`candidate-apply` |
| 章节工程任务 | `chapter-engineering`、`engineering-panel`、`engineering-tab-jobs`、`generation-job-start`、`generation-job-cancel`、`generation-job-status`、`generation-job-step`、`generation-job-recovery` |
| 质量检查与历史 | `quality-check`、`quality-history`、`quality-history-select`、`quality-history-readonly`、`quality-report`、`quality-issue` |
| 章节上下文 | `chapter-summary`、`chapter-summary-panel`、`chapter-summary-generate`、`chapter-summary-save`、`chapter-summary-record`、`generation-context-count` |
| 确认与保护 | `generation-preflight`、`apply-confirm`、`leave-guard`、`dialog-confirm`、`dialog-cancel` |
| 结果与恢复 | `error-notice`、`success-notice`、`recovery-dialog`、`recovery-dismiss` |

重复节点使用同一个语义 test ID，并用业务属性区分，例如 `data-project-id`、`data-chapter-id`、`data-chapter-title`。只给业务边界和必要子操作增加选择器，不给普通布局元素批量加 ID。

`recovery-dialog` 是正式启动恢复体验的一部分，不是测试专用假 UI。只有检测到遗留章节工程任务或恢复检查本身失败时才显示；E2E 只通过 DOM 读取其状态并关闭。

---

## 8. 自动化覆盖

| Spec | 真实流程与主要断言 |
|------|--------------------|
| `app-start.spec.ts` | Tauri 窗口和 `app-shell` 可见；首页可访问；前端无未处理异常；E2E 桥存在；SQLite 完整性、外键、Schema 和空库计数正常 |
| `project-create-open.spec.ts` | 从 UI 新建作品、输入名称、保存、回到列表并打开；断言名称、作品 ID、详情路由和 SQLite 记录 |
| `project-edit-save.spec.ts` | 打开设置并修改名称；限定时间内完成保存；按钮恢复；成功提示出现；导航后重新读取仍正确；独立只读 SQLite 连接看见已提交标题 / 新更新时间，且数据库仅有一条对应作品 |
| `chapter-save.spec.ts` | 显式创建卷和章节；在编辑器输入、保存、切换页面并重新打开；断言正文完整、卷章归属和 SQLite 草稿记录 |
| `large-text-save.spec.ts` | 通过 DOM 输入 184KB 中文 / emoji / CRLF 正文，保存、离开、重开并采用；逐值核对全文、字数、document / chunks 元数据和 SHA-256；损坏隔离库一个 chunk 后断言安全章节与编辑器不被 500 字预览替换 |
| `candidate-review-apply.spec.ts` | 使用固定 Mock AI 生成候选；查看约束评分 / 缺失计数和 result / draft / novel / chapter / source / revision / base hash / AI task 元数据；确认正式采用；断言任务成功、编辑器及页面字数同步、只有一个正式草稿且重复操作不重复采用 |
| `leave-guard.spec.ts` | 修改正文后切换章节；取消离开保留 dirty 内容；分别验证“保存并离开”和“放弃修改”，断言保存正文可重开、放弃内容不入库且没有错误删除或错位覆盖 |
| `generation-job-cancel.spec.ts` | 分别暂停正文生成和质量检查 Mock 请求后通过 DOM 点击取消；断言 5 秒内 waiter 清理、SQLite 唯一取消 checkpoint、正文取消不新增草稿、质量取消保留已提交草稿且 AI task 为 `cancelled`、无 pending 报告，release 后无迟到 step / completed 状态 |
| `restart-task-recovery.spec.ts` | 通过 E2E-only Mock AI gate 把章节工程任务暂停在生成步骤；重启真实 Tauri 应用并复用同一隔离 SQLite；断言 `APP_RESTART_INTERRUPTED`、进度和已完成 step 保留、恢复 checkpoint 唯一、二次启动幂等且没有自动重发 AI |
| `quality-history-replay.spec.ts` | 从空库经 UI 创建作品、卷章和正文；连续执行两次固定 Mock 质检，重启真实应用后回放两份报告；断言 report / draft / content hash / AI Task 绑定、item ID 隔离、历史只读与当前计数一致 |
| `chapter-context-persistence.spec.ts` | 从 UI 采用正文并原子保存章节上下文；重启后逐值核对总结及上下文稳定 ID；采用新正文触发总结和关联记录原子过期，再次重启后断言生成上下文计数为零 |

这些测试保留真实 React、HashRouter、Tauri IPC、Rust command、SQLite 事务和 WebView2 生命周期。IPC 桥用于受限验收、隔离库故障注入和 E2E-only Mock pause / release，不替换正常业务写入流程；pause gate 不调用网络，也不直接修改数据库。

当前产品没有名为 `Artifact`、`PlacementProposal` 或 `ApplyPlan` 的持久化实体。候选 spec 按现有真实模型验证其等价业务约束：结果 ID、目标作品 / 章节、基础正文 hash、apply mode、`chapter_drafts` 候选、`ai_task_records` 的 Mock 成功状态、`chapters.adopted_draft_id`、唯一正式草稿和重复采用幂等。不能把不存在的表或状态写成已验证；如果未来引入这些正式模型，需增加相应 IPC 只读查询和状态断言。

尚未覆盖：

- 不确定 AI 步骤的自动续跑、旧 `ai_task_records` 跨重启恢复，以及旧 AI 面板和其他独立 AI 工具的通用请求取消；
- Windows 安装程序、原生文件选择器、系统托盘、Windows 通知；
- OCR、截图识别、屏幕坐标、多显示器；
- Tauri 原生窗口 close-request 的完整恢复式离开保护；
- 浏览器 LocalStorage 与 SQLite 之间的跨存储原子性；
- 真实 Provider、互联网、API 限流和外部服务故障；
- 命名为 `Artifact` / `PlacementProposal` / `ApplyPlan` 的状态机，因为当前产品尚未实现这些正式实体；
- 全量页面和全部 AI 工具面板。

---

## 9. 失败产物与脱敏

默认诊断目录：

```text
test-results/e2e/<spec>/
  tauri-driver.log
  rust-backend.log
  wdio.log
  frontend-diagnostics.json
  run.json
  <suite-test>.html
  <suite-test>.json
  <suite-test>.png
  WebdriverIO 日志文件
```

`tauri-driver.log`、`wdio.log`、Rust 日志（若应用已启动）、`frontend-diagnostics.json` 和 `run.json` 用于每次运行的可追溯诊断。`frontend-diagnostics.json` 无论业务断言是否通过都会写出，包含当前路由、DOM 摘要、前端 console、未处理异常、Rust 诊断和 WebView 网络尝试摘要，并由运行器作为独立硬门禁复核。测试失败时，WDIO 还会在当前 WebDriver 会话仍可访问的前提下尽力追加：

- `.html` 保存页面源码 / DOM；
- `.json` 保存当前 URL、DOM 摘要、可见 test ID、前端 console、未处理异常和 Rust 诊断；
- `.png` 保存失败时截图，仅用于人工复盘；
- `.html`、`.json` 或 `.png` 的采集失败不会遮蔽原始 WDIO 错误，也不保证在 session 创建失败或会话已经断开时存在。

其中 `tauri-driver.log` 保存 driver 启动和协议错误，`rust-backend.log` 保存 Rust E2E 启动与诊断阶段，`run.json` 始终记录退出码、超时、测试数据库位置和进程清理结果。

前端桥只保留有限条目并截断单条消息。JSON 产物必须先解析，再递归脱敏键和值并重新序列化；HTML、日志和文本才使用文本级规则。脱敏覆盖 API Key、Bearer / Authorization、密码 / secret、cookie / token、完整 prompt 和 Windows 绝对路径。运行器在 WDIO 完成、复制 Rust 日志后先执行最终脱敏，再解析 `frontend-diagnostics.json` 健康门禁；malformed JSON 会被替换为不含原文的有效错误对象，并令当前 spec 失败。测试临时目录在运行元数据中保留为 `%TEMP%\ai-novel-studio-e2e-*`，仓库路径显示为 `%WORKSPACE%\...`，既可定位又不包含 Windows 账户名。测试不得输出真实作品正文、用户账号或正式数据库内容。新增日志字段时必须先更新脱敏规则和结构化产物回归测试。

---

## 10. 进程清理

运行器在每个 spec 前获取 Windows CIM 进程快照，清理时只认领测试开始后新建且能由以下证据归属本轮的进程：

- 当前 WebdriverIO PID 及其后代；
- 可执行路径或命令行命中本轮唯一 staged `ai-novel-studio-e2e.exe`；
- 命令行命中当前 spec 临时目录或 WebView2 profile；
- 上述已归属进程的后代，包括本轮 `tauri-driver` 和 `msedgedriver`。

正常结束、测试失败、WDIO 启动失败和单 spec 总超时都会进入清理。Windows 使用 `taskkill /T /F` 清理已归属进程树，再重新获取快照并轮询确认；进程快照不可信、清理不可验证、仍有残留 PID，或通过 spec 的临时目录无法删除时，本 spec 都会强制判失败并停止执行后续 spec。suite 全部通过后还必须成功删除 run root，否则 suite 失败。运行器不会按通用进程名杀掉测试启动前已经存在的无关 Node 或应用进程。

---

## 11. 已发现并修复的产品缺陷

真实桌面流程复现了作品创建 / 保存永久等待：`create_novel` 和 `update_novel` 持有全局 SQLite `Mutex<Connection>` 后，又调用会再次获取同一非可重入 Mutex 的公开查询命令，导致 IPC 永不返回。

修复方式是提取接受现有 `&Connection` 的内部查询函数。创建和更新在同一个已持有连接上完成写入和 read-back，不再递归加锁，也没有绕过真实业务或数据库流程。Rust 回归测试在线程中执行两个命令，并用 300 ms `recv_timeout` 稳定证明不会重新加锁卡死；桌面作品编辑 spec 再验证保存完成、界面恢复和 SQLite 已提交。

接入真实桌面会话还暴露了系统强调色 IPC 可能长时间不返回：原实现同步等待 `reg query`，会占住 Tauri command 并拖住页面初始化。生产路径现改为 `spawn_blocking`，注册表子进程最多等待 750 ms，超时后会 kill / wait 并返回 `None`；另有 Rust 边界时间回归测试。E2E 模式直接跳过注册表读取，因为强调色不是这些业务流程的验收对象，也可避免短生命周期注册表子进程干扰隔离与清理。

章节保存与候选采用场景还发现前后端计字语义不一致：编辑器按“每个中日韩字符 + 每个连续 ASCII 字母数字词”计数，Rust 原实现却把部分标点算入字符数，导致落库 `word_count` 与页面显示不同。Rust 计字函数已改为与编辑器一致，并新增中英文、Markdown 分隔符和纯标点回归测试。

运行器对 `frontend-diagnostics.json` 的硬门禁进一步暴露了三处原本会被 UI fallback 掩盖的 console error：旧 `style_profiles` 表缺少 `description` 列、`list_style_profiles` 不接受可选的项目参数，以及 `save_context_read_log` 的前端调用没有按 Rust DTO 包装 `{ input }`。修复包括兼容旧库的幂等列迁移与迁移测试、可选 `project_id` 查询及空 SQLite 结果时保留内建风格，以及正确的 context log 参数包装；同一候选桌面场景随后要求 console error 为零。

v2.1.4 的长正文场景暴露并验证了大文本保存链的真实缺陷：struct IPC 参数缺少 `{ input }`、整文 hash 不匹配仍提交、读取损坏时回退预览，以及 document / chunks 与 draft 引用跨命令。修复后，Rust 强校验并以单事务提交，工作台在目标全文读取失败时保留原安全章节。连续运行还暴露固定 `4444/5444` 端口可能被上一轮占用；运行器现默认预检并随机选择一组空闲 driver 端口。

v2.1.5 的重启场景确认了章节工程 runner 只存在于页面内 Promise：进程退出后，SQLite 中的 `pending` / `running` / `retrying` 会永久遗留，面板重载后的本地运行标志又会复位，允许用户重复启动。状态更新还允许迟到回调覆盖取消，step 的 `INSERT OR REPLACE` 可覆盖旧 checkpoint。修复后，启动事务把遗留任务确定结算为 `APP_RESTART_INTERRUPTED`，终态不可复活、进度不可倒退、step ID 不可覆盖，面板同时检查持久化 active 状态。系统不会自动重放不确定步骤。

v2.1.6 的取消场景与 loopback 测试确认了另一个真实缺陷：工作台虽然能把 `generation_jobs` 写为 `cancelled`，同步 `reqwest::blocking`、浏览器 fetch 和 Mock waiter 却仍继续运行，最长可能等待 1800 秒。发布审阅又复现了取消 IPC 未确认即结算，以及浏览器 `2xx` 非法 JSON 把正文片段带入异常的问题。修复后，章节工程 job controller 等待 AI client 与 Rust abort handle 的取消确认；服务端连接被关闭，错误正文被固定消息替代，取消 checkpoint 保持唯一，质量旧任务正确结算，迟到响应不能生成草稿或完成任务。

v2.1.7 的质量历史场景确认了三类真实一致性缺陷：报告先标记 completed 再逐条写问题，中途失败会留下部分数据；复检会把旧 item 改挂到新报告，使旧报告丢失快照；旧请求迟到会重置新报告已处理的同 key 问题。复审还发现可通过省略 `aiTaskId` 绕过追溯、删除 Task 会清空 completed 报告绑定、更新但未完成的报告会错误阻止最新完整报告刷新状态，以及完成后的迟到历史请求可在快速切章时覆盖新章节。schema 2 多报告恢复还会跨报告累计 `sort_order`。修复后，历史快照与当前状态分离、整笔事务提交、Task 强绑定并受删除保护、旧备份按报告排序；真实窗口会修改当前问题状态，再由应用重启回归证明两份历史仍可稳定回放。

---

## 12. 故障排查

### 12.1 E2E bridge 不存在或新选择器找不到

通常是 release EXE 仍嵌入旧前端，即 stale executable：

1. 清除 `AI_NOVEL_STUDIO_E2E_SKIP_BUILD`。
2. 重新运行 `npm run test:e2e:smoke`，让运行器以 `VITE_AI_NOVEL_STUDIO_E2E=1` 执行完整 Tauri 构建。
3. 不要在前端变更后只运行 `cargo build --release`；它不应被当作重新嵌入 Vite 产物的替代流程。
4. 若使用 `AI_NOVEL_STUDIO_E2E_APP`，确认路径指向刚构建的 E2E EXE，而不是旧安装目录或普通生产 EXE。

默认流程会先使用 `.e2e-tools/target` 执行完整 Tauri E2E 构建，再从 Cargo 包名和 Tauri `productName` 两个 release 候选中选择最新产物，创建本轮唯一应用副本并校验文件大小 / 副本修改时间。这样不会覆盖生产 `src-tauri/target`，也不会误启 bundle 目录里的旧 EXE。显式 `AI_NOVEL_STUDIO_E2E_APP` 会覆盖候选选择，因此调用方必须自行保证它是最新 E2E feature 构建；运行器仍会把它复制成 staged EXE。

### 12.2 `session not created`、`DevToolsActivePort` 或窗口一闪而退

- 检查 WebView2 Runtime 与 `msedgedriver.exe` 主版本一致。
- 使用 `msedgedriver.exe --version` 查看驱动版本，并在 Windows“应用”或 WebView2 注册信息中确认 Runtime 版本。
- 显式设置 `AI_NOVEL_STUDIO_E2E_NATIVE_DRIVER`，避免扫描到另一个旧驱动。
- 查看 `tauri-driver.log`，确认 `webviewOptions.userDataFolder` 指向本 spec 的临时 `webview2` 目录。

### 12.3 driver 无法启动或端口占用

- 用 `cargo install --list` 确认 `tauri-driver v0.1.5` 在 `PATH`。
- 默认运行器会为整个 suite 预检并选择空闲的 driver / native driver 端口组。若显式设置了 `AI_NOVEL_STUDIO_E2E_DRIVER_PORT`，请取消该覆盖后重试，或改为一段完整空闲区间。
- 查看 `run.json` 的残留 PID；确认上一次异常中断的 driver 已结束后再运行。

### 12.4 IPC 超时或页面停在加载状态

- 先看 `rust-backend.log` 的最后一个阶段，再看失败 JSON 中的前端异常和当前路由。
- `get_e2e_diagnostics` 会记录等待数据库锁、取得锁、完整性检查、外键、journal mode、Schema / 行数和完成阶段，可区分 Mutex 等待与 SQL 诊断阻塞。
- 不要用固定 `sleep` 掩盖问题。给对应 UI 状态、数据库计数或按钮可用状态增加显式条件等待。

### 12.5 `frontend-diagnostics.json` 健康门禁失败

- 先看运行器给出的分类：文件缺失 / 无法解析、console error、未处理异常、guard 未安装或外部网络尝试。
- 查看 `frontend-diagnostics.json` 的 `route`、`logs`、`errors` 和 `networkAttempts`。网络尝试只含 transport / protocol / time，不含完整目标地址或请求内容。
- console error 即使被业务代码 catch 或 fallback 处理也会使测试失败；应修复真实 IPC / Schema / 参数契约，不要在测试中清空日志绕过。
- 外部请求在 WebView 中已被阻断；不要把非零尝试改写成允许列表，除非该端点确属应用本地资源且隔离设计已经同步评审。

### 12.6 临时目录无法删除

- 确认没有手工打开失败 SQLite，且应用、EdgeDriver 和 tauri-driver 均已退出。
- 失败数据默认保留是预期行为；复盘完成后再删除对应 `%TEMP%\ai-novel-studio-e2e-*`。
- 成功数据也需保留时设置 `AI_NOVEL_STUDIO_E2E_KEEP_DATA=1`，不要修改运行器清理逻辑。
- 若通过 spec 的目录删除失败、进程残留或进程快照不可验证，运行器会按失败处理并停止剩余 spec；先查看该 spec 与 suite 的 `run.json`，不要把清理错误忽略成测试通过。

### 12.7 防止误碰正式数据库

- 始终从 `npm run test:e2e:*` 入口运行，不直接拼装 driver capability。
- 启动日志和 `run.json` 中的数据目录及数据库必须位于 `%TEMP%\ai-novel-studio-e2e-*`，且 marker path / run-id 对应当前 spec。
- 若路径指向 `%LOCALAPPDATA%\AI Novel Studio`，立即停止测试并作为隔离失败处理。

### 12.8 取消按钮已生效但请求仍不结束

- 先定向运行 `npm run test:e2e -- --spec generation-job-cancel`，检查 gate 的 `waitingRequests` 是否在 5 秒内归零。
- 若任务已取消但 waiter 不为 0，检查 `generationJobService` 是否向当前 AI step 传递同一个 `AbortSignal`，以及 Mock gate / delay 是否移除了 abort listener。
- 若 UI 已显示取消但后端请求仍存在，检查 `cancel_ai_request` IPC 是否被等待；不得用 fire-and-forget 或吞掉 IPC 失败，控制调用失败时应等待原请求安全结算。
- 真实 API 模式用 `cargo test ai::tests -- --test-threads=1` 检查 loopback socket 关闭；不要用真实 Provider、截图或延长 sleep 判断取消是否有效。
- `AI_REQUEST_CANCELLED` 是用户取消；请求超时必须继续显示超时错误，不能为追求统一而合并两种状态。

---

## 13. 发布验收命令

```powershell
npm run test:e2e:smoke
npm run test:e2e

# 连续稳定性
npm run test:e2e
npm run test:e2e
npm run test:e2e

# 既有测试与质量门
npm run test
npm run lint
npm run build
cd src-tauri
cargo check
cargo test
cd ..
npm run tauri:build
git diff --check
git status --short
```

最终报告必须逐条记录真实结果。E2E 通过不能替代 Node / Rust 测试、lint、类型检查和生产构建；反之，编译通过也不能替代真实 Windows 桌面流程。

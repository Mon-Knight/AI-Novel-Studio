# v2.1.3 发布说明 - Windows 真实桌面 E2E 与稳定性

## 版本信息

- **版本号**：v2.1.3
- **发布日期**：2026-07-21
- **上一版本**：v2.1.2
- **目标平台**：Windows 10 / 11

## 版本定位

本版本不扩展新的 AI 自动写入范围，重点建立可重复验证真实 Windows Tauri 应用的桌面自动化基础，并发布自动化过程中稳定复现的产品缺陷修复。

测试直接操作真实 Tauri 窗口中的 DOM，通过稳定 `data-testid`、HashRouter 状态和受限 Tauri IPC 验证 React、Rust command、SQLite 事务与 Mock AI 流程。截图只作为失败诊断，不参与定位、点击或通过判定。

## 新增内容

### Windows 真实桌面 E2E

- 接入 WebdriverIO 9.29.1、`tauri-driver 0.1.5` 和 Microsoft Edge WebDriver。
- 新增 `npm run test:e2e:smoke`、`npm run test:e2e` 和 `--spec <name>` 定向复测入口。
- 覆盖应用启动、作品创建与打开、作品信息保存、卷章正文保存、Mock AI 候选审查采用和未保存离开保护六条流程。
- 每个 spec 使用独立临时 SQLite、WebView2 profile、单实例状态、窗口状态、driver 端口和进程树。
- E2E feature、运行时标志、绝对临时路径和随机 run-id marker 必须全部匹配，否则 Rust 在打开数据库前拒绝启动。
- 作品保存通过独立只读 SQLite 连接验证事务已经提交，并检查同一作品不存在重复行。

### Mock 与网络隔离

- E2E 前端构建强制使用 Mock Provider，不读取隔离 profile 中可能存在的真实 AI 设置。
- WebView 在业务模块加载前拦截外部 fetch、XHR、WebSocket、EventSource 和 beacon。
- Rust AI IPC 在创建或发送 HTTP 请求前再次阻断真实 Provider。
- 每个场景必须证明网络 guard 已安装、外部请求尝试为零，否则运行器改判失败。

### 失败诊断与清理

- 始终输出脱敏的 `frontend-diagnostics.json`、WebdriverIO、Tauri Driver 和 Rust 日志。
- 失败时追加当前路由、DOM 摘要和截图；诊断不记录 API Key、Authorization、完整 prompt 或用户正式数据。
- 运行器只清理本轮拥有的 Node、Driver、应用和 WebView 子进程；残留 PID 或清理无法确认时停止后续 spec。

### Windows GitHub Actions

- Pull Request 与 `main` 推送运行前端、Rust、生产构建和真实 Tauri smoke。
- `v*` tag、每周定时和手动完整模式运行六条桌面流程；手动 `full-three` 连续运行三轮。
- CI 自动读取 WebView2 Runtime 版本，下载精确版本 EdgeDriver，并在执行前再次校验前三段版本号。
- 依赖准备完成后，E2E 构建和执行使用 Cargo / npm offline 模式；失败诊断保留 7 天。

## 修复内容

- 修复 `create_novel` / `update_novel` 已持有 SQLite Mutex 时再次获取同一锁，导致作品创建或保存永久等待的问题。
- 修复同步 `reg query` 读取 Windows 强调色可能阻塞 Tauri command 的问题，增加 750 ms 上限和子进程终止。
- 统一编辑器与 Rust 草稿保存的中英文计字语义，避免页面与数据库字数不一致。
- 为旧 `style_profiles` 表幂等补充 `description` 列，修正风格列表可选参数和上下文日志 `{ input }` IPC 包装。
- 修复 Windows 运行器启动 `.cmd` 的 `EINVAL`、Edge 150 capability 和旧 E2E 可执行文件选择问题。

## 主要文件变更

- `.github/workflows/windows-desktop-e2e.yml`
- `scripts/e2e/run-e2e.ts`
- `tests/e2e/`
- `src-tauri/src/runtime.rs`
- `src/services/tauri/e2eBridge.ts`
- `src/services/tauri/e2eNetworkGuard.ts`
- `src/components/common/E2eDialogHost.tsx`
- `docs/technical/desktop-e2e.md`
- `docs/technical/testing.md`

核心页面与组件只在关键业务节点增加稳定选择器，没有为普通展示元素批量添加测试属性。

## 验证结果

| 验证 | 结果 |
|------|------|
| `npm run test` | 14 / 14 通过 |
| `npx tsc --noEmit` | 通过 |
| `npm run lint` | 0 error；保留 1 条既有 Hook warning |
| `cargo check` | 通过 |
| `cargo check --features e2e` | 通过 |
| `cargo test` | 33 / 33 通过 |
| `npm run test:e2e:smoke` | 1 / 1 通过 |
| `npm run test:e2e` 连续三轮 | 18 / 18 通过 |
| `npm run tauri:build` | 通过；MSI 与 NSIS 均生成 |
| 文档同步检查 | 通过 |
| Windows workflow 静态验证 | YAML、9 个 PowerShell block、actionlint 全部通过 |

生产 bundle 已确认不包含 E2E bridge；桌面测试结束后未发现本轮应用、Node、Tauri Driver、EdgeDriver 或 WebView 子进程残留。

## 已知边界

- 产品当前没有崩溃恢复流程，因此不伪造 `recovery-dialog`。
- 当前数据模型没有名为 `Artifact`、`PlacementProposal` 或 `ApplyPlan` 的持久化实体；候选测试验证现有草稿、AI Task、目标绑定、基础哈希、采用状态和幂等约束。
- GitHub-hosted Windows 的实际缓存、桌面会话和 artifact 服务只能在 workflow 首次推送后验证；本地已完成 workflow 静态检查和同等桌面命令验证。
- React 组件级并发覆盖、安装程序 UI、原生文件选择器、系统托盘、Windows 通知和多显示器不在本版本范围。

## 后续计划

1. 为 v2.1.2 完整备份与恢复补充固定临时路径的真实桌面往返 E2E。
2. 收敛大文本全文校验、读取失败恢复和草稿引用之间的端到端事务边界。
3. 再处理任务跨重启恢复、真实网络取消和质量历史稳定重放。
4. 在正文安全门与动态回归稳定后，单独设计 `Artifact`、`PlacementProposal`、`ApplyPlan` 与更高自主度 Agent 能力。

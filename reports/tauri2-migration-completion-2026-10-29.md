# Tauri 2 迁移遗漏收口（2026-10-29）

- 分支：`feat/tauri-2-migration`
- 版本：`3.7.0`（非版本任务）
- 范围：v1 HTTP LocalStorage 迁移、签名更新与回滚验收、原生插件桌面覆盖、updater 正式依赖、格式门禁
- 是否提交/发布：否
- 是否使用真实生产密钥：否。签名更新在独立测试产品上使用一次性测试密钥完成，测试安装已卸载

## 1. v1 HTTP origin LocalStorage 迁移

`useHttpsScheme: true` 会把 Tauri 1 Windows 的 `http://tauri.localhost` 存储迁到
`https://tauri.localhost`。新增 `src-tauri/src/legacy_local_storage.rs` 与
`legacy-storage-migration.html`：

- 仅在检测不到一次性完成标记时创建一个隐藏的 HTTP-origin WebView；页面读取
  `ai_novel_studio_*` 键，经受限命令暂存在进程内存，不写入明文临时文件。
- 主 HTTPS 页面在 React 启动前轮询暂存状态，只补齐当前 origin 缺失的键，不覆盖新 origin
  已写入的数据。
- 主页面确认写入后才发送 `applied`；HTTP 页面随后只删除已经完成迁移的键并关闭。进程崩溃时
  旧 origin 数据仍保留，下一次启动可重试。
- 迁移完成标记为 `legacy-local-storage-migration-v1.json`，包含时间、条目数和来源 origin。
- 隐藏窗口固定 `use_https_scheme(false)`，命令校验调用窗口 label 与精确旧 origin；迁移启动失败
  不阻止主应用，且不写入完成标记。
- 窗口销毁处理只保存 `main` 的窗口状态，隐藏迁移窗口不会覆盖用户窗口尺寸/位置。

验证：

- `cargo test --locked ... legacy_local_storage`：3/3 passed。
- `src/services/startup/legacyLocalStorageMigration.test.ts`：4/4 passed。
- `tests/e2e/tauri2-migration-regression.spec.ts`：4/4 passed。真实 Windows WebView2 中先在
  `http://tauri.localhost` 写入 Beta/暗色/哨兵值，重启后由 HTTPS 页面读取，断言三个值均已迁移，
  并通过第二个 HTTP-origin 探测确认旧值已清理。
- 完整 Windows 桌面 E2E：27/27 specs passed。每个 spec 均使用独立 SQLite、WebView2 profile
  和进程；运行器同时校验 frontend diagnostics、进程清理与 artifact sanitization。

## 2. updater 依赖与正式版本

- `tauri-plugin-updater` 从临时 Git patch 切换到 crates.io `2.14.1`。
- `cargo tree --locked -p tauri-plugin-updater` 仍解析到 `zip 9.1.2`。
- 删除 `[patch.crates-io]`，后续构建不再依赖 GitHub 提交。

## 3. 真实签名更新、错误签名拒绝与回滚

使用独立测试产品，避免触碰正式安装或用户数据：

- Product：`AI Novel Studio Update E2E`
- Identifier：`com.ainovelstudio.update-e2e`
- 测试通道：本机 HTTP 测试服务器 + `dangerousInsecureTransportProtocol`（仅测试构建）
- 一次性 minisign 密钥：仅保存在临时目录，验收后删除
- 自动验收钩子只在非默认 Cargo feature `update-e2e` 中编译，正式构建不包含

实际结果：

| 场景 | 结果 |
| --- | --- |
| 3.7.0 检查 3.7.1 清单 | `shouldUpdate=true`，`latestVersion=3.7.1` |
| 篡改 updater ZIP、保留原签名 | `更新下载或签名校验失败`，版本保持 3.7.0 |
| 有效 3.7.1 签名包 | 下载、签名校验、NSIS 安装成功；安装器自动拉起 3.7.1，日志记录 `currentVersion=3.7.1` |
| 回滚到保留的 3.7.0 安装包 | 安装成功，启动日志记录 `currentVersion=3.7.0` |
| `rollback.json` | 包含 3.7.0 安装包 URL 与上一版 updater/installer SHA-256 |

产物摘要：

- 3.7.0 updater ZIP：`932535698A190A45CA87EAA32DCD2515FDD3DE51CC372E660DAEC91AAEE2A7AF`
- 3.7.0 NSIS installer：`36CD46401CED42CF09A01849D604959701596138A105E1C9A23C94873A1C6725`
- 3.7.1 updater ZIP：`CE21A8BE9CDFC8E2F5ACBDA7E3D04E246ADB683384768E2A6AE604B2434F9977`
- 3.7.1 NSIS installer：`9533672FE2D2045BFF54C65E21A5130175A587D568392EDD3E675753EAF61BED`

边界：上述验证证明真实签名下载、安装、版本切换、错误签名拒绝以及保留安装包回滚可用；没有使用
正式发布私钥，也没有从正式 GitHub 通道下载。正式发布仍须在发布环境检查公钥/私钥、GitHub
endpoint 与真实渠道资产一致。

## 4. 原生插件真实桌面覆盖

新增 `tests/e2e/native-plugin-contract.spec.ts`：

- 真实 Windows 文件打开对话框：通过 dialog 插件打开，Win32 定位该进程的 `#32770` 窗口并发送
  `WM_CLOSE`，断言 Promise 以 `null` 结束。
- 真实 Windows 文件保存对话框：同上，覆盖 `dialog:allow-save`。
- 前端 FS 越权读取：在隔离数据目录创建哨兵文件，直接经 Tauri fs 插件读取；真实 ACL 在 IPC 层
  返回 `forbidden path`，未读取内容。
- Windows 通知：经通知插件提交真实 toast；权限为 granted，命令回报成功，未走 DOM Toast 回退。
  本项验证 Native Notification API 接受，不声称检查了 Action Center 的视觉呈现。

## 5. 其他

- `git diff --check` 的临时 updater 补丁空行问题已修正。
- 一次性测试安装已卸载，测试私钥已删除；`src-tauri/target/release` 下仍保留 ignored 的测试产品构建产物，不影响正式 EXE，本次未对构建缓存执行删除。

## 6. 终态校验与生产 EXE

最终源码校验：

- `npx tsc --noEmit`：通过。
- 本次涉及的 TS/TSX ESLint：通过。
- 本次涉及的源码、脚本、配置和文档 Prettier：通过。
- `npm run test:docs-sync`：通过。
- `npm run test:version-sync`：通过，版本保持 `3.7.0`。
- `npm run test:rust-file-size`、`npm run test:component-size`：通过。
- `check-bundle-size.test.mjs`：10/10 passed。
- `cargo check --locked --features e2e --manifest-path src-tauri/Cargo.toml`：通过；仍有既有
  dead-code warnings。
- `git diff --check`：通过。

完整 Windows 桌面 E2E 在最终源码上重新构建并执行：

- 27/27 independent desktop specs passed；`test-results/e2e/run.json` 记录 `failures: 0`、
  `cleanupError: null`、`dataDirectoryRetained: false`。
- `tauri2-migration-regression.spec.ts`：4/4 passed，包括 HTTP-origin LocalStorage 到
  HTTPS-origin 的一次性迁移。
- `native-plugin-contract.spec.ts`：4/4 passed，覆盖真实 Windows 打开/保存对话框取消、FS ACL
  拒绝和 notification 插件调用。

production bundle 预算：

- `main-CgdpeSfD.js`：113,220 B raw / 35,695 B gzip-9。
- `legacy-storage-migration-DpG_1rAv.js`：1,806 B raw / 838 B gzip-9。
- 最大 chunk `WorkbenchPage-C6FPp_-J.js`：386,649 B raw / 119,593 B gzip-9。
- 共测量 130 个 JavaScript chunk；`npm run test:bundle-size` 通过。

本地生产 EXE 已按 `tauri build --no-bundle` 重建，未启用 `update-e2e`：

- 路径：`F:\ai-novel-studio-hotfix-v321\src-tauri\target\release\AI Novel Studio.exe`
- 大小：34,299,392 字节
- 修改时间：2026-10-29 17:11:41
- SHA-256：`61F07C3192D8E98A960AFF4D4DBC24FBADCBF44A9F55AFCB5AA80DDD9E5D20B1`
- 使用隔离 `APPDATA`/`LOCALAPPDATA` 启动验证：主窗口标题 `AI Novel Studio`，数据库初始化和
  Tauri setup 正常；`CloseMainWindow` 返回 True，进程正常退出。

仍属于发布环境验收、不能由本地测试替代：

- 正式 GitHub Release 通道的真实下载与资产一致性。
- 正式生产签名公钥/私钥和真实安装包升级。
- Windows Action Center 中 toast 的视觉呈现。
- 从 Tauri 2 降级回 Tauri 1 的偏好恢复；本迁移为单向迁移，产品当前没有正式降级流程。

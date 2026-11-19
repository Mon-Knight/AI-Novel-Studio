# 桌面端构建指南

> 当前桌面载体：Tauri 2.12.5 + Rust（Windows 10/11）。
> 当前应用版本：v3.7.0；本次同步为 Tauri 2 迁移事实整理，不是版本发布任务。
> 历史说明：本文件早期以 v1.7.11 为文档基线。Tauri 1.x 的 `allowlist`、`tauri.updater`、`--bundles updater` 等写法已不适用于当前分支；历史基线保留其版本含义，不回溯改写为当前事实。

## 1. 当前版本与工具链

| 项目                                  | 当前事实                                                                           |
| ------------------------------------- | ---------------------------------------------------------------------------------- |
| 桌面壳 Rust crate                     | `tauri` 2.12.5（`Cargo.lock`）                                                     |
| `tauri-build`                         | 2.7.4                                                                              |
| `@tauri-apps/cli` / `@tauri-apps/api` | 2.12.4 / 2.12.4（`package-lock.json`）                                             |
| 官方插件                              | fs 2.7.1、shell 2.5.0、dialog 2.8.3、notification 2.7.0、updater 2.14.1            |
| Rust MSRV                             | `src-tauri/Cargo.toml` 的 `rust-version = "1.90"`                                  |
| 固定构建工具链                        | `rust-toolchain.toml` 的 `channel = "1.95.0"`，`profile = "minimal"`，含 `rustfmt` |
| 目标平台                              | Windows 10/11、WebView2、MSVC x64                                                  |

具体版本以 `package.json`、`package-lock.json`、`src-tauri/Cargo.toml` 和 `src-tauri/Cargo.lock` 为准，不从本文档推断浮动版本。Rust crate 2.12.5 与 CLI/API 2.12.4 是当前锁文件中的真实组合；不要为追求“完全一致”擅自升级或降级其中一侧。

## 2. 构建入口

```powershell
# 安装依赖
npm ci

# 前端类型检查与生产构建（tsc + vite）
npm run build

# Rust 编译检查
cargo check --locked --manifest-path src-tauri/Cargo.toml

# 本地安装包：先准备固定 DeepSeek assets，再打 MSI 与 NSIS
npm run tauri:build
```

`npm run tauri:build` 实际执行 `npm run dsh:assets && tauri build --bundles msi,nsis`。它包含前端 `beforeBuildCommand`，不需要提前重复 `npm run build`；普通本地构建不会读取或生成更新签名私钥。

日常任务刷新用户打开的 EXE 时，按根 [AGENTS.md](../../AGENTS.md) 第 7.6 节：清除 `CARGO_TARGET_DIR` 后执行 `npm run dsh:assets` 与 `npx tauri build --no-bundle`，产物为 `src-tauri/target/release/AI Novel Studio.exe`（`productName`）。不要把该步骤当成 `npm run tauri:build` 发布打包；构建不等于获准发布。

默认产物位于 `src-tauri/target/release/`；若设置了 `CARGO_TARGET_DIR`，以实际输出为准。完整发布门禁与载体/Gateway 准备顺序见 [测试策略](testing.md)。

### 2.1 当前统一 Runtime 本地交付（2026-11-11）

本批统一内核与任务级预授权仍处于 **INTEGRATION / NOT YET FULLY VERIFIED**。完整本地验收可使用：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/agent-workflow/verify_project.ps1 -NoBundle
```

`-NoBundle` 只将最后生产构建改为准备当前 DSH assets 并执行 `tauri build --no-bundle`，不生成 MSI/NSIS，不发布。默认发布矩阵及脏工作树检查保持原行为，不为本地交付清理、覆盖或提交用户已有修改；本批脚本改动尚须实际验证。

交付路径固定为仓库的 [AI Novel Studio.exe](../../src-tauri/target/release/AI%20Novel%20Studio.exe)，构建前清除进程级 `CARGO_TARGET_DIR`；不可用其他输出目录或小写 crate 可执行文件代替。目标 EXE 被占用时拒绝覆盖并等待用户退出。固定 DSH commit 和 `ans_task_session_v2` 未升级，但必须重建/绑定当前 Gateway，不能用过往载荷或过去桌面测试证明本批产物正确。实际结果、未验证项及 EXE 对应代码见[实施记录](../../reports/unified-agent-2026-11-11/implementation.md)；下方 2026-10-29 的 Tauri 迁移结果仍只证明当时批次。

## 3. Tauri 2 配置与桌面能力

当前配置见 `src-tauri/tauri.conf.json`。与 Tauri 1.x 的关键差异：

- 顶层 `build.frontendDist`、`build.devUrl` 分别指向 `../dist` 与 `http://localhost:1420`；`app.withGlobalTauri = false`，前端通过模块化 `@tauri-apps/api` 调用 IPC，不依赖全局 `window.__TAURI__`。
- 主窗口设置 `useHttpsScheme: true`。Windows 上自定义协议因此使用 HTTPS scheme，满足需要 secure context 的 Web API；生产 CSP 的 `connect-src` 允许 `https://ipc.localhost`，`img-src` 允许 `asset:` / `https://asset.localhost`。该配置不等于 XSS 已消除，CSP 仍须按实际注入结果复核。
- `bundle.createUpdaterArtifacts = "v1Compatible"`。它不是 Tauri 1 的运行模式，而是让 Tauri 2 CLI 继续产出 Tauri 1 可消费的“安装包 + 未压缩 ZIP + `.sig`”布局，便于旧 MSI 客户端沿同一静态清单更新。
- `plugins.updater` 配置稳定通道端点、`installMode: "passive"`、空的 `installerArgs` 和 `requireSignedVersion: true`。仓库内 `pubkey` 仍是 `UPDATER_PUBLIC_KEY_REPLACED_IN_RELEASE_CI` 占位值；发布 workflow 才注入真实公钥。`app_update.rs` 将该占位值判定为“未配置”，本地包不得声称已具备可用的签名更新。
- 权限不再使用 Tauri 1 的 `allowlist`，而由 `src-tauri/capabilities/` 声明。`desktop.json` 对主窗口开放空权限列表；`migrated.json` 只授予 `core:default`、单个本地模型生命周期 sidecar 文件的 `fs:scope`、文件读写、窗口控制、`shell:allow-open`、dialog 与 notification 的既有命令。没有 `fs:default`、`shell:default`、`dialog:default`、`notification:default`，也没有 `updater:default`；前端不能直接调用 plugin-updater 的 IPC，只能走 `app_update` 自有命令。
- 已在 `src-tauri/src/main.rs` 注册 dialog、updater、notification、shell、fs 五个官方插件。插件只提供受 capability 约束的命令面，权限收紧不能由前端自行扩大。

### 3.1 自有更新 IPC 与 v1 事件兼容

`src-tauri/src/commands/app_update.rs` 保留 ANS 自己的更新协议，不直接暴露插件默认命令：

- `get_app_update_capabilities` 返回平台支持、更新器是否配置和当前版本。
- `check_app_update` 按显式 `stable` / `beta` 通道读取对应静态 `latest.json`，校验返回版本是否属于该通道，并限制发布说明长度、清理控制字符。
- `install_app_update` 在下载前再次拉取清单并复验 `expectedVersion`；版本已变化时返回 `APP_UPDATE_CHANGED`，不安装用户未确认的新版本。下载和安装通过 updater 插件的 `download_and_install` 完成。
- 为保持旧前端兼容，继续发出 Tauri 1 事件名 `tauri://update-status`（`PENDING` / `DOWNLOADED` / `DONE` / `ERROR`）与 `tauri://update-download-progress`（`chunkLength`、`contentLength`）。这些是 IPC 事件投影，不是“已真实完成签名更新”的证据。
- `tauri.conf.json` 中的 updater `endpoints` 是插件默认值；实际检查由上述命令按通道传入 `updates-stable` 或 `updates-beta` 的固定 GitHub Release URL。

## 4. 更新器依赖补丁与签名发布

`tauri-plugin-updater` 已切换到 crates.io 正式版 `2.14.1`，临时
`[patch.crates-io]` 与 GitHub commit 依赖已移除。锁定结果仍为 `zip 9.1.2`；所有 Cargo
命令继续使用 `--locked`，离线构建不再需要缓存 updater 的 git 源。

发布构建由 `.github/workflows/release.yml` 执行：

```powershell
npm run tauri:build:release -- --config "$env:TAURI_RELEASE_CONFIG"
```

- `tauri:build:release` 实际执行 `tauri build --ci --bundles msi,nsis`。`createUpdaterArtifacts = "v1Compatible"` 会自动在 `bundle/msi/` 生成 `*.msi.zip` 与 `.sig`，在 `bundle/nsis/` 生成 `*-setup.nsis.zip` 与 `.sig`；不要再传 `--bundles updater`。
- 发布步骤要求 `TAURI_PUBLIC_KEY` 与 `TAURI_SIGNING_PRIVATE_KEY` 非空，缺失即失败；签名密码使用 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`。仓库 secrets 仍保留历史名称 `TAURI_PRIVATE_KEY` / `TAURI_KEY_PASSWORD`，workflow 负责映射到 Tauri 2 的 `TAURI_SIGNING_*` 变量。
- 发布配置把真实公钥写入 `plugins.updater.pubkey`，并按通道覆盖端点；`requireSignedVersion: true` 要求签名 trusted comment 绑定当前清单版本。
- `scripts/release/select-release-artifacts.mjs` 只接受 `msi` / `nsis` 目标与 `v1Compatible`，按精确文件名选取，不递归扫描，避免误取 `msi-updater` 重建副本或旧版本安装包；随后校验 ZIP 是单条目、未压缩、条目名与所选安装包一致，且大小 / CRC 匹配，并校验 `.sig` 版本绑定。
- `scripts/release/build-release-manifest.mjs` 生成单一 `windows-x86_64` 平台条目的 `latest.json`。Tauri 1 客户端与 Tauri 2 updater 插件读取同一静态清单；另写 `release.json` 与 `rollback.json` 记录摘要、通道和回滚安装包。MSI 继续作为已有安装的更新源，NSIS `*-setup.exe` 作为面向用户的安装器。
- 依赖审计保持失败关闭：`.github/workflows/security.yml` 运行 `npm audit --omit=dev --audit-level=high` 与不带 `--ignore` 的 `cargo audit`。Tauri 1 时期针对 `reqwest 0.11` / `h2 0.3` 链的忽略项已随 Tauri 2 迁移移除。

## 5. DeepSeek 载体与解包

`npm run dsh:assets` 会把当前只读 Gateway 的 SHA-256 写入载体 `VERSION_MATRIX.json.gatewaySha256` 与 `bin/gateway-sha256.txt`，后者由 `build.rs` 编入当前 EXE。复用旧的 `src-tauri/bin/dsh-runtime.zip` 时会刷新其中的 Gateway，两个构建分支都验证实际打包的独立解压脚本。应用在 AppData `dsh-runtime` 入口拒绝缺失、损坏或不匹配当前 EXE 的 Gateway；解压脚本还会对照当前归档的提交、运行时及 Gateway 哈希，暂存验证成功后才替换旧副本，失败保留旧载荷。这样避免旧 Gateway 返回没有 `contextCoverage` 的读取结果并触发 `DSH_CONTEXT_INCOMPLETE`，不放宽候选的完整性门禁。

解包中断恢复还会校验整个 Junction manifest 的相对路径与关键运行入口的实际目标，拒绝链接越界或搬移后仍指向暂存目录的载体。原生恢复不直接搬入带 Junction 的暂存载体，而由独立解包器重新建立最终位置链接；无链接暂存载体通过备份与回滚完成恢复。此校验不是全量第三方依赖包内容的完整性证明。

准备脚本保留已通过独立解包验证的 `src-tauri/.payload-verify/dsh-runtime`。标准隔离写章故障 runner 的运行目录与前置哈希校验统一使用该副本，而不再使用可能未随 ZIP 回退刷新而更新的组装目录 `.payload-staging`。这条显式复用载体的门禁与无路径覆盖的默认 AppData 解包验收分别记录，不能互相冒充。

## 6. 验证边界

本文档记录的是当前配置、命令和发布流水线事实。以下边界仍不作为已通过结论：

- 使用正式发布密钥和正式 GitHub 渠道的签名更新；
- 浏览器开发模式的 LocalStorage 回退与 SQLite 跨存储一致性；

完整 27 个 Windows 桌面规格已于 2026-10-29 全部通过。独立测试产品已完成真实签名下载、
错误签名拒绝、3.7.0 → 3.7.1 安装/自动重启，以及保留
3.7.0 安装包回滚；临时密钥、测试安装与产物已清理。v1 LocalStorage 迁移和原生
dialog/FS/notification 覆盖见 [迁移遗漏收口报告](../../reports/tauri2-migration-completion-2026-10-29.md)。

完整发布仍以 `scripts/agent-workflow/verify_project.ps1` 的门禁结果为准；本机 fixture、
测试产品或代码审阅都不能替代正式渠道验收。

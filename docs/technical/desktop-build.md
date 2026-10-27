# 桌面端构建指南

> 当前状态：🚧 占位文档

## Tauri 构建

```powershell
# 前端构建
npm run build

# 桌面 EXE / 安装包构建：先准备固定 DSH assets，再执行 Tauri 打包
npm run tauri:build
```

默认构建产物位于 `src-tauri/target/release/`；若设置了 `CARGO_TARGET_DIR`，以实际输出为准。日常任务要刷新用户打开的 EXE 时，按根 [AGENTS.md](../../AGENTS.md) 第 7.6 节：清除 `CARGO_TARGET_DIR` 后执行 `npm run dsh:assets` 与 `npx tauri build --bundles none`，产物为 `src-tauri/target/release/AI Novel Studio.exe`。不要把该步骤当成 `npm run tauri:build` 发布打包。构建不等于获准发布；分层验证见根 AGENTS，完整发布门禁与载体/Gateway 准备顺序见 [测试策略](testing.md)。

`npm run dsh:assets` 会把当前只读 Gateway 的 SHA-256 写入载体 `VERSION_MATRIX.json.gatewaySha256` 与 `bin/gateway-sha256.txt`，后者由 `build.rs` 编入当前 EXE。复用旧的 `src-tauri/bin/dsh-runtime.zip` 时会刷新其中的 Gateway，两个构建分支都验证实际打包的独立解压脚本。应用在 AppData `dsh-runtime` 入口拒绝缺失、损坏或不匹配当前 EXE 的 Gateway；解压脚本还会对照当前归档的提交、运行时及 Gateway 哈希，暂存验证成功后才替换旧副本，失败保留旧载荷。这样避免旧 Gateway 返回没有 `contextCoverage` 的读取结果并触发 `DSH_CONTEXT_INCOMPLETE`，不放宽候选的完整性门禁。

解包中断恢复还会校验整个 Junction manifest 的相对路径与关键运行入口的实际目标，拒绝链接越界或搬移后仍指向暂存目录的载体。原生恢复不直接搬入带 Junction 的暂存载体，而由独立解包器重新建立最终位置链接；无链接暂存载体通过备份与回滚完成恢复。此校验不是全量第三方依赖包内容的完整性证明。

准备脚本保留已通过独立解包验证的 `src-tauri/.payload-verify/dsh-runtime`。标准隔离写章故障 runner 的运行目录与前置哈希校验统一使用该副本，而不再使用可能未随 ZIP 回退刷新而更新的组装目录 `.payload-staging`。这条显式复用载体的门禁与无路径覆盖的默认 AppData 解包验收分别记录，不能互相冒充。

## 环境配置

- 需要安装 Rust 工具链
- 需要 Windows 10/11 SDK

## 窗口配置

当前配置见 `src-tauri/tauri.conf.json`

## 后续补充方向

- 完整构建环境搭建指南
- 签名与分发说明
- 多平台构建指南
- 构建问题排查

> 文档基线：v1.7.11（当前应用版本见 `../version-roadmap.md`）
> 本文档不表示功能已完成，仅标记文档位置。

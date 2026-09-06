# 桌面端构建指南

> 当前状态：🚧 占位文档

## Tauri 构建

```powershell
# 前端构建
npm run build

# 桌面 EXE / 安装包构建：先准备固定 DSH assets，再执行 Tauri 打包
npm run tauri:build
```

默认构建产物位于 `src-tauri/target/release/`；若设置了 `CARGO_TARGET_DIR`，以实际输出为准。构建不等于获准发布；分层验证见根 [AGENTS.md](../../AGENTS.md)，完整发布门禁与载体/Gateway 准备顺序见 [测试策略](testing.md)。

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

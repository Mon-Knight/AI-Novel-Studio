# 桌面端构建指南

> 当前状态：🚧 占位文档

## Tauri 构建

```powershell
# 前端构建
npm run build

# 桌面 EXE 构建
npm run tauri build
```

构建产物位于 `src-tauri/target/release/`

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

> 当前版本：v1.7.10
> 本文档不表示功能已完成，仅标记文档位置。

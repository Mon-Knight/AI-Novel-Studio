---
name: tauri-desktop-build
description: 仅在用户明确要求 Tauri 构建、打包、安装包、窗口配置或图标更新时使用；普通前端/服务修改由 npm run verify:change 选择检查，不触发完整安装包构建。
---

# Skill: tauri-desktop-build

> **Skill 名称**：Tauri 桌面构建
> **触发条件**：用户明确要求 Tauri 构建、打包、安装包生成、窗口配置或图标更新；普通前端/服务修改不触发完整安装包构建
> **Skill 类型**：多步骤工作流

---

## 概述

`tauri-desktop-build` 处理 Tauri 桌面端的构建、打包和调试全流程。遵循根 [AGENTS.md](../../../AGENTS.md)；打包配置、依赖图或发布任务才运行完整构建，日常修改由 `npm run verify:change` 选择检查。

---

## 使用场景

- 首次构建 Tauri 项目
- 生成 Windows 安装包
- 构建失败排查
- 窗口尺寸/行为调整
- 应用图标更新
- 系统能力（通知/对话框/托盘）开发

---

## 输入信息

- Tauri 构建命令（dev / build）
- 错误日志（如有）
- 目标平台（当前：Windows）

---

## 必须读取的文件

- `src-tauri/Cargo.toml` — Rust 依赖
- `src-tauri/tauri.conf.json` — Tauri 配置
- `.github/instructions/tauri.instructions.md` — Tauri 开发规则
- `src-tauri/src/main.rs` — Rust 入口

---

## 必须关联的 Checklist

```
.github/checklists/tauri-build.checklist.md
```

---

## 执行步骤

### 步骤 1：环境检查

```powershell
rustc --version
cargo --version
node --version
npm --version
```

### 步骤 2：开发模式验证（窗口/图标/系统能力任务时）

```powershell
npm run tauri dev
```

检查：

- [ ] 窗口是否正常打开
- [ ] 窗口尺寸是否符合 `tauri.conf.json`（默认 1280×820，最小 1024×700）
- [ ] 最大化是否正常
- [ ] 应用标题是否为 "AI Novel Studio"
- [ ] 前端页面是否正常加载
- [ ] 控制台是否有报错

### 步骤 3：构建前检查

对照 `tauri-build.checklist.md`：

- [ ] `cargo check --locked --manifest-path src-tauri/Cargo.toml` 通过
- [ ] 图标资源存在（`src-tauri/icons/`）
- [ ] `tauri.conf.json` 配置正确
- [ ] 固定 DSH 载体可由 `npm run dsh:assets` 准备

### 步骤 4：完整构建

```powershell
npm run tauri:build
```

该入口先准备 DSH assets 再生成 MSI 与 NSIS，并已包含前端构建，不必提前重复 `npm run build`。检查：

- [ ] 编译是否成功
- [ ] 安装包路径
- [ ] EXE 是否可启动
- [ ] 安装包大小是否合理

### 步骤 5：构建失败处理

如果构建失败：

1. 完整记录错误输出
2. 定位失败步骤（Rust 编译 / 前端打包 / 签名）
3. 分析原因
4. 修复后重新构建

---

## 输出格式

```markdown
## Tauri 构建报告

### 环境

- Rust：vX.X
- Node：vX.X

### 开发模式

- 窗口打开：✅ / ❌
- 页面加载：✅ / ❌

### 构建结果

- `cargo check --locked`：✅ / ❌
- `npm run tauri:build`：✅ / ❌

### 产物

- EXE 路径：
- 安装包路径：
- 大小：

### 失败详情（如有）

...
```

---

## 禁止事项

- ❌ 不要在构建失败时忽略错误
- ❌ 不要在 `tauri.conf.json` 中使用不安全 CSP
- ❌ 不要提交 `src-tauri/target/` 到 Git
- ❌ 不要在 Rust 代码中硬编码前端逻辑

---

## 关键路径

```
src-tauri/Cargo.toml          # Rust 依赖
src-tauri/tauri.conf.json     # 窗口 / 打包配置
src-tauri/icons/              # 应用图标
src-tauri/src/main.rs         # Rust 入口
target/release/               # 构建产物
```

---

## 核心原则

> **桌面端稳定优先。构建失败必须明确输出原因，不允许静默失败。**

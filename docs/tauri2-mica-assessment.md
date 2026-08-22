# Tauri 2.x 升级评估与 Mica / Acrylic 可行性分析

> 评估日期：2026-05-26
> 项目：AI Novel Studio
> 当前分支：main
> 当前 Tauri：1.8.3 (Cargo.toml 声明 1.7)

---

## 1. 当前项目结构总览

### 1.1 前端依赖

| 包                | 当前版本    | Tauri 2 对应版本      |
| ----------------- | ----------- | --------------------- |
| `@tauri-apps/api` | 1.6.0       | `@tauri-apps/api` 2.x |
| `@tauri-apps/cli` | 1.6.3 (dev) | `@tauri-apps/cli` 2.x |
| react             | 18.3.1      | 不变                  |
| react-router-dom  | 6.23.1      | 不变                  |
| vite              | 5.4.21      | 不变                  |

### 1.2 Rust 依赖

| crate                | 当前版本                | Tauri 2 对应版本 |
| -------------------- | ----------------------- | ---------------- |
| tauri                | 1.8.3 (resolved)        | tauri 2.x        |
| tauri-build          | 1.5                     | tauri-build 2.x  |
| rusqlite             | 0.31 (bundled)          | 不变             |
| serde / serde_json   | 1.0                     | 不变             |
| reqwest              | 0.11 (blocking, rustls) | 不变             |
| uuid / chrono / sha2 | 各版本                  | 不变             |

### 1.3 Rust 模块结构（8 个源文件）

| 文件                  | 功能                              | Tauri 2 兼容风险                                                     |
| --------------------- | --------------------------------- | -------------------------------------------------------------------- |
| `main.rs`             | Tauri Builder + 窗口管理 + 单实例 | 🔴 高 — `tauri::Builder` API 变化                                    |
| `commands.rs`         | 所有 CRUD commands                | 🟡 中 — `#[tauri::command]` 签名不变，但 invoke handler 注册方式变化 |
| `ai.rs`               | AI 调用（reqwest + blocking）     | 🟢 低 — 纯逻辑，无 Tauri API 依赖                                    |
| `db.rs`               | SQLite 初始化                     | 🟢 低 — 纯 `rusqlite`，无 Tauri API                                  |
| `large_text_save.rs`  | 大文本分片存储                    | 🟢 低 — 纯逻辑 + 文件系统                                            |
| `outline_commands.rs` | 大纲 CRUD                         | 🟡 中 — command 注册方式变化                                         |
| `window_state.rs`     | 窗口状态持久化 + 单实例锁         | 🔴 高 — 依赖 `tauri::Window` API                                     |
| `system_accent.rs`    | Windows 注册表 Accent 读取        | 🟢 低 — 纯 `std::process::Command`，无 Tauri API                     |

---

## 2. Tauri 1.7 → Tauri 2.x 迁移变更点

### 2.1 Cargo.toml

```diff
- tauri = { version = "1.7", features = ["shell-open"] }
+ tauri = { version = "2", features = [] }

- tauri-build = { version = "1.5", features = [] }
+ tauri-build = { version = "2", features = [] }
```

Tauri 2 的 feature 体系重做：

- `shell-open` → 通过 `tauri-plugin-shell` 提供
- 插件系统全面独立

### 2.2 tauri.conf.json

**重大变更：** Tauri 2 使用全新的配置格式

```diff
- "tauri": {
-   "allowlist": { ... },
-   "windows": [ { ... } ],
-   "bundle": { ... },
-   "security": { ... }
- }
+ "app": {
+   "windows": [ { ... } ],
+   "security": { ... }
+ },
+ "bundle": { ... },
+ "plugins": { ... }
```

`allowlist` 完全移除，改为插件白名单。

### 2.3 main.rs

```diff
- tauri::Builder::default()
-   .invoke_handler(tauri::generate_handler![...])
-   .setup(...)
-   .on_window_event(...)
-   .run(tauri::generate_context!())
+ tauri::Builder::default()
+   .invoke_handler(tauri::generate_handler![...])  // 注册方式变化
+   .setup(...)                                       // 签名变化
+   .on_window_event(...)                             // 类型变化
+   .run(tauri::generate_context!())                  // 不变
```

核心变更：

- `App` → `AppHandle` 类型变化
- `Manager` trait 方法调整
- `Window::scale_factor()` / `outer_position()` → 可能变化
- `WindowEvent::Destroyed` → 可能重命名

### 2.4 window_state.rs 影响

此文件是本项目最依赖 Tauri API 的模块。API 调查：

| 当前 API                                         | Tauri 2 状态 | 风险 |
| ------------------------------------------------ | ------------ | ---- |
| `window.scale_factor()`                          | 保留         | 🟢   |
| `window.outer_position()`                        | 保留         | 🟢   |
| `window.outer_size()`                            | 保留         | 🟢   |
| `window.is_maximized()`                          | 保留         | 🟢   |
| `window.is_minimized()`                          | 保留         | 🟢   |
| `window.set_position(Physical(...))`             | 保留         | 🟢   |
| `window.set_size(Logical(...))`                  | 保留         | 🟢   |
| `window.maximize()`                              | 保留         | 🟢   |
| `window.unminimize()`                            | 保留         | 🟢   |
| `window.set_focus()`                             | 保留         | 🟢   |
| `tauri::Size::Logical`                           | 路径可能变化 | 🟡   |
| `tauri::Position::Physical`                      | 路径可能变化 | 🟡   |
| `tauri::LogicalSize` / `tauri::PhysicalPosition` | 路径可能变化 | 🟡   |

### 2.5 前端 @tauri-apps/api 变更

当前前端仅用到：

- `import { invoke } from '@tauri-apps/api'` — 用于 Accent Color 读取

Tauri 2 中：

- `invoke` 路径保持不变
- 但需要在 `Cargo.toml` 中显式启用核心插件

### 2.6 build.rs

```rust
fn main() {
    tauri_build::build()
}
```

在 Tauri 2 中保持不变。

---

## 3. 现有功能 Tauri 2 兼容风险评估

| #   | 功能                        | 风险  | 详情                                                                |
| --- | --------------------------- | ----- | ------------------------------------------------------------------- |
| 1   | SQLite 数据库初始化         | 🟢 零 | `rusqlite`，与 Tauri 无关                                           |
| 2   | AI API 调用                 | 🟢 零 | `reqwest`，纯网络                                                   |
| 3   | 系统 Accent Color           | 🟢 零 | `std::process::Command`，无 Tauri API                               |
| 4   | 右键菜单禁用                | 🟢 零 | 纯 DOM 事件                                                         |
| 5   | 暗色模式变量                | 🟢 零 | 纯 CSS                                                              |
| 6   | LoadingModal                | 🟢 零 | 纯 React 组件                                                       |
| 7   | 窗口状态持久化              | 🟡 中 | 依赖多个 `Window` API，但 Tauri 2 基本保留                          |
| 8   | 单实例锁+聚焦               | 🟡 中 | `window.unminimize()` / `set_focus()` 保留；`app.handle()` 路径变化 |
| 9   | 文件导入导出                | 🟢 零 | 纯前端 + Rust 文件系统                                              |
| 10  | `tauri dev` / `tauri build` | 🟡 中 | CLI 命令保持不变，但配置格式需迁移                                  |

**总体风险：🟡 中 — 可迁移，但需 1-2 天适配。**

---

## 4. Mica / Acrylic 可行性分析

### 4.1 Tauri 2.x 原生能力

Tauri 2.x 对窗口背景材质的支持：

- `tauri::window::WindowBuilder::transparent(true)` — 更稳定的透明窗口
- `tauri::webview::WebviewBuilder::transparent(true)` — WebView 透明
- 社区插件 `tauri-plugin-window-effects`（非官方，需验证）
- 官方暂无直接 Mica API（截至 2025 年初）

### 4.2 Win32 API 路线

无论是 Tauri 1.7 还是 Tauri 2.x，Mica 最终都需要 Win32 API：

```c
// Windows 11 22000+
DwmSetWindowAttribute(hwnd, DWMWA_SYSTEMBACKDROP_TYPE, &DWMSBT_MAINWINDOW, sizeof(DWORD));

// Windows 10 1803+
DwmSetWindowAttribute(hwnd, DWMWA_MICA, &enable, sizeof(BOOL));
```

实现要点：

1. 获取 WebView2 的父窗口 HWND
2. 调用 `DwmSetWindowAttribute`
3. 检测 Windows 版本决定用 Mica (Win11) 还是 Acrylic (Win10) 还是回退纯色
4. 前端 `body { background: transparent }`
5. CSS 变量 `--color-bg-app` 设为半透明

### 4.3 Windows 10/11 兼容

| Windows 版本      | 支持       | 方案                                        |
| ----------------- | ---------- | ------------------------------------------- |
| Windows 11 22H2+  | ✅ Mica    | `DWMSBT_MAINWINDOW`                         |
| Windows 10 1803+  | ✅ Acrylic | `DWMWA_MICA` 或 `DwmEnableBlurBehindWindow` |
| Windows 10 1709-  | ❌ 不支持  | 回退静态背景                                |
| 远程桌面 / 虚拟机 | ⚠️ 部分    | 自动检测回退                                |

### 4.4 WebView 透明陷阱

- WebView2 透明时文字渲染可能模糊（ClearType 失效）
- `-webkit-font-smoothing: antialiased` 可缓解
- 窗口拖动区域可能与 WebView 不匹配
- 暗色模式下窗口边框可能异常

---

## 5. 三条路线对比

### 路线 A：继续 Tauri 1.7 + Win32 API

| 维度           | 评价                                                  |
| -------------- | ----------------------------------------------------- |
| 开发成本       | 🟡 中 — 需接入 `windows` crate，HWND 获取路径需探索   |
| 风险           | 🟡 中 — Win32 API 稳定但 `windows` crate 版本兼容复杂 |
| 对现有功能影响 | 🟢 低 — 不修改架构，只在 main.rs 增加初始化逻辑       |
| Mica 效果      | ⚠️ 依赖 Win32 API 正确调用                            |
| 推荐度         | 🟡 可行但不最优                                       |

**Cargo.toml 新增依赖：**

```toml
windows = { version = "0.58", features = ["Win32_UI_Controls", "Win32_Graphics_Dwm", "Win32_Foundation"] }
```

约 2-3MB 新增编译产物。

### 路线 B：升级 Tauri 2.x + 未来 Mica

| 维度           | 评价                                           |
| -------------- | ---------------------------------------------- |
| 开发成本       | 🔴 高 — 1-2 天迁移 + 回归测试                  |
| 风险           | 🟡 中 — API 破坏性变化可控但需全量回归         |
| 对现有功能影响 | 🔴 中 — 8 个命令注册、窗口状态、单实例均需适配 |
| Mica 效果      | 🟡 需配合 Win32 API，Tauri 2 无内建 Mica       |
| 推荐度         | 🟢 长期最优                                    |

### 路线 C：暂缓 Mica，优化 CSS 原生感

| 维度           | 评价                |
| -------------- | ------------------- |
| 开发成本       | 🟢 低 — 纯 CSS 调整 |
| 风险           | 🟢 零               |
| 对现有功能影响 | 🟢 无               |
| Mica 效果      | ❌ 无               |
| 推荐度         | 🟢 当前推荐         |

---

## 6. 结论与推荐

### 核心发现

1. **Mica 是锦上添花，不是雪中送炭。** 当前静态背景 + 暗色模式已提供良好的基本体验。
2. **Tauri 2.x 即使升级了，Mica 仍需 Win32 API。** Tauri 2 没有内建 `enableMica()` 开关。
3. **本次升级的最大收益不是 Mica，而是 Tauri 2 生态。** 更好的插件系统、更稳定的 WebView 管理、官方 `tauri-plugin-window-state`。

### 推荐决策

```text
✅ 推荐：暂缓 Tauri 2.x 升级，不立即实现 Mica。

原因：
1. Tauri 2 升级成本（1-2 天）在当前版本周期中收益不明显
2. 当前 P0-P2 已完成的功能在 Tauri 1.7 下运行稳定
3. Mica 在 Tauri 1.7 和 Tauri 2.x 下都需要相同的 Win32 API 工作量
4. 过早引入 Win32 API 依赖会增加 `cargo build` 时间

推荐路线：
→ 当前版本 v1.0.x 保持 Tauri 1.7
→ v1.1.0 或 v2.0.0 规划中纳入 Tauri 2.x 迁移
→ 迁移时一并将 Mica/Acrylic 作为第一批新能力落地
```

### 实验分支

```text
已评估，但代码迁移不在本次范围。
如果后续需要迁移，参考本评估文档执行以下步骤：
1. git checkout -b experiment/tauri2-mica
2. 按本文第 2 节变更清单逐项迁移
3. 每完成一项执行 cargo build + npm run tauri dev 验证
```

---

## 7. 后续建议

### P2.2 建议（下一阶段）

在暂缓 Tauri 2.x 的前提下，建议下一阶段进入：

```text
Native Feel P2.2：原生 Dialog 与通知最小落地
```

内容：

1. 用 `tauri::api::dialog::ask()` 替换 1-2 个危险操作确认框
2. 封装 `nativeDialog.ts` 工具
3. 评估 `tauri-plugin-notification`（Tauri 1.x 兼容）

这些改动不涉及 Tauri 版本升级，风险低，对原生感提升明显。

---

## 8. 参考资料

- [Tauri 2.x Migration Guide](https://v2.tauri.app/start/migrate/from-tauri-1/)
- [Tauri 2.x Configuration](https://v2.tauri.app/reference/config/)
- [DWM Mica Documentation](https://learn.microsoft.com/en-us/windows/apps/design/style/mica)
- [WebView2 Transparency Issues](https://github.com/tauri-apps/tauri/discussions/2744)

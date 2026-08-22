# Native Feel P2 — Windows 原生外观增强技术评估

> 评估日期：2026-05-26
> 项目：AI Novel Studio
> 当前 Tauri 版本：1.7
> 目标平台：Windows 10/11

---

## 1. 当前 Tauri 版本与能力

| 项目         | 值                                                  |
| ------------ | --------------------------------------------------- |
| Tauri        | 1.7                                                 |
| WebView 引擎 | WebView2 (Edge Chromium)                            |
| Rust edition | 2021                                                |
| 窗口装饰     | 系统原生（`decorations: true`，默认）               |
| 背景材质     | 静态色 `--color-bg-app: #f5f6f8`（无 Mica/Acrylic） |
| 暗色模式     | CSS `prefers-color-scheme` 变量覆盖                 |
| 单实例       | PID 文件锁 + focus.request 信号                     |
| 安装包       | NSIS（`targets: "all"`）                            |

---

## 2. 当前 Windows 原生能力缺口

| 能力                    | 状态                | 影响                                               |
| ----------------------- | ------------------- | -------------------------------------------------- |
| Mica / Acrylic 窗口背景 | ❌ 未实现           | 窗口看起来像普通网页容器，不像 Windows 11 原生应用 |
| 系统 Accent Color       | ❌ 硬编码 `#4a7cf7` | 用户换了系统强调色不会生效                         |
| 原生 Dialog             | ❌ DOM 模拟         | 确认/警告弹窗看起来像网页，不像 Windows MessageBox |
| 原生通知                | ❌ 未接入           | 长任务完成无系统通知                               |
| 文件关联                | ❌ 未配置           | 双击文件不会打开应用                               |
| 自动更新                | ❌ 无机制           | 用户需手动下载新版本                               |
| 系统托盘                | ❌ 未实现           | 关闭窗口即退出，无后台驻留                         |

---

## 3. Mica / Acrylic 可行性分析

### 路线 A：Tauri 1.7 + Win32 API

**技术方案：**

- `DwmSetWindowAttribute(hwnd, DWMWA_SYSTEMBACKDROP_TYPE, ...)` 设置 Mica
- `DWMWA_USE_IMMERSIVE_DARK_MODE` 适配暗色模式
- 需要获取 WebView2 的 HWND

**优点：**

- 不需要升级 Tauri 版本
- 改动集中在 Rust 侧

**缺点：**

- 需要接入 `windows` crate（Win32 API）或直接 FFI
- Windows 10 不支持 Mica（需回退 Acrylic 或纯色）
- WebView2 背景透明可能有渲染问题（文字模糊、内容穿透）
- Tauri 1.7 窗口创建后修改属性有时序问题

**风险等级：🟡 中**

### 路线 B：Tauri 2.x 升级

**Tauri 2.x 相关能力：**

- 内置 `tauri-plugin-window-state`（无需手写）
- 更好的窗口背景控制 API
- `WindowBuilder::transparent` + `WindowBuilder::decorations` 更稳定

**升级成本：**

- API 破坏性变化（`tauri::Builder` → `tauri::AppBuilder`，command 注册方式变化）
- 插件系统重写（`tauri::plugin` 接口变化）
- Cargo.toml 依赖调整（`tauri` crate 路径变化）
- 前端 `@tauri-apps/api` 也需要升级到 v2
- 预计工作量：2-3 天（含测试）

**风险等级：🟡 中（可控但量不小）**

### 本次结论

**暂不实现 Mica/Acrylic。**

原因：

1. Tauri 1.7 下 Win32 API 接入复杂，WebView 透明兼容风险较高
2. 建议在 Tauri 2.x 升级后作为第一批新能力实现
3. 当前静态背景 + 暗色模式已能满足 v1.0 基本体验要求

**推荐下一步：** 先完成系统 Accent Color（低风险），再规划 Tauri 2.x 升级专项。

---

## 4. 系统 Accent Color 方案

### 已实现方案（本次）

**技术路线：** `reg query HKCU\Software\Microsoft\Windows\DWM /v AccentColor`

- Rust 侧：`std::process::Command` 读取注册表，零新依赖
- 前端：启动时调用 Tauri command，写入 `--color-primary` / `--color-focus-ring` / `--color-accent` CSS 变量
- 失败时静默回退默认色 `#4a7cf7`

**风险等级：🟢 低**

**踩坑点：**

- 注册表值格式为 DWORD ABGR (`0xAABBGGRR`)，需转换为 hex `#RRGGBB`
- Windows 10/11 均支持此注册表路径
- 不依赖 `dwmapi.dll` / `UISettings` Runtime API

---

## 5. 原生 Dialog 替换方案

### 评估

| 方案               | 复杂度 | 风险                                          |
| ------------------ | ------ | --------------------------------------------- |
| Tauri `dialog` API | 低     | Tauri 1.7 的 `tauri::api::dialog::ask()` 可用 |
| 后端 command 封装  | 中     | 封装 `MessageBoxW` 需要 `windows` crate       |
| 继续 DOM 模态框    | 低     | 当前够用，只是不够原生                        |

### 本次结论

**暂不实现，仅记录后续方案。**

当前 DOM 模态框（`modal-overlay` / `LoadingModal`）功能完整。替换为原生 dialog 是"锦上添花"而非"雪中送炭"。建议在 Tauri 2.x 升级后统一处理。

---

## 6. 原生通知方案

### 评估

| 方案                        | 复杂度 | 风险                                       |
| --------------------------- | ------ | ------------------------------------------ |
| `tauri-plugin-notification` | 中     | Tauri 1.7 有社区插件，但维护状态需确认     |
| `winrt-notification` crate  | 中     | Windows Toast 通知，需 `windows` crate     |
| 后端 command + PowerShell   | 低     | 用 `New-BurntToastNotification` 但体验较差 |
| 继续 DOM Toast              | 低     | 当前无 Toast 组件，需先建基础              |

### 本次结论

**暂不实现，仅记录后续方案。**

当前项目没有完整的 Toast/通知组件。先建 DOM Toast 基础（比原生通知更可控），后续再用原生通知替换。建议顺序：DOM Toast → 原生通知。

---

## 7. 安装包体验现状

### 当前状态

| 检查项               | 状态                                                   |
| -------------------- | ------------------------------------------------------ |
| 应用名称             | ✅ `AI Novel Studio`                                   |
| 图标                 | ✅ 多尺寸 ico/icns/png                                 |
| Identifier           | ✅ `com.ainovelstudio.app`                             |
| 安装包类型           | NSIS（`targets: "all"`）                               |
| 数据库路径           | `%LOCALAPPDATA%\AI Novel Studio\ai-novel-studio.db` ✅ |
| 窗口状态路径         | `%APPDATA%\com.ainovelstudio.app\window-state.json` ✅ |
| 自动创建桌面快捷方式 | ⬜ 待确认（NSIS 默认否）                               |
| 开始菜单快捷方式     | ⬜ 待确认                                              |
| 卸载是否清理用户数据 | ⚠️ 需确认（NSIS 默认不会删除 AppData）                 |

### 建议

- 安装包当前基本合格
- 后续版本可考虑添加 `tauri.conf.json > tauri > bundle > windows > wix` 配置以使用 MSI
- 快捷方式策略可在正式分发前再定

---

## 8. 推荐落地顺序

```text
✅ P2.0 — 本次完成：
  1. 系统 Accent Color 读取与 CSS 变量同步

⬜ P2.1 — 下次建议：
  2. Tauri 2.x 升级评估与迁移
  3. Mica / Acrylic 背景（依赖 Tauri 2.x）

⬜ P2.2 — 后续：
  4. 原生 Dialog 替换
  5. DOM Toast 基础组件
  6. 原生通知接入

⬜ P3 — 发布前：
  7. 安装包快捷方式策略
  8. 自动更新机制
  9. 文件关联
  10. 系统托盘
```

---

## 9. 不建议当前实现的内容与原因

| 内容                 | 原因                                             |
| -------------------- | ------------------------------------------------ |
| Mica / Acrylic       | Tauri 1.7 限制；建议先升级 Tauri 2.x             |
| 全量原生 Dialog 替换 | DOM 模态框当前功能完整，替换收益不明显           |
| 原生通知             | 项目尚无 Toast 基础组件，建议先生态后升级        |
| 自动更新             | 版本尚在快速迭代，过早接入自动更新会增加维护负担 |
| 文件关联             | 应用功能尚未覆盖"双击打开文件"的使用场景         |
| 系统托盘             | 当前写作软件不需要后台驻留                       |

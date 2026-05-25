# Native Feel P2.4 — 安装包体验与分发检查报告

> 日期：2026-05-26
> 项目：AI Novel Studio v1.0.41

## 1. 构建环境

| 项目 | 信息 |
|------|------|
| OS | Windows |
| Node | npm |
| Rust | 1.60+ (edition 2021) |
| Tauri | 1.8.3 (resolved) |
| WebView2 | Edge Chromium (系统内置) |
| 构建命令 | `npm run tauri build` |

## 2. 构建结果

| 命令 | 结果 | 说明 |
|------|:---:|------|
| `npm run build` | ✅ | Vite 1.45s，181 modules |
| `npm run tauri build` | ✅ | Rust release 35.24s；2 bundles |

## 3. 生成产物

| 产物 | 路径 | 类型 |
|------|------|------|
| Release EXE | `src-tauri/target/release/ai-novel-studio.exe` | 独立可执行 |
| MSI 安装包 | `src-tauri/target/release/bundle/msi/AI Novel Studio_1.0.41_x64_en-US.msi` | Windows MSI |
| NSIS 安装包 | `src-tauri/target/release/bundle/nsis/AI Novel Studio_1.0.41_x64-setup.exe` | NSIS 安装器 |

## 4. Tauri 配置检查

| 配置项 | 当前值 | 状态 |
|--------|--------|:---:|
| productName | `AI Novel Studio` | ✅ |
| identifier | `com.ainovelstudio.app` | ✅ |
| version | `1.0.41` | ✅ |
| icon | 32/128/256 ico + icns + png | ✅ |
| bundle.active | `true` | ✅ |
| bundle.targets | `all` (NSIS + MSI) | ✅ |
| allowlist.dialog | `all: true` | ✅ |
| allowlist.notification | `all: true` | ✅ |
| allowlist.shell | `open: true` | ✅ |
| security.csp | `null` | ⚠️ 无 CSP，开发便利但生产建议配置 |

## 5. 安装验证（待用户手动确认）

| 验证项 | 预期 |
|--------|------|
| 安装包可打开 | NSIS/MSI 双击启动安装向导 |
| 应用名称正确 | AI Novel Studio |
| 安装路径合理 | 默认 `%LOCALAPPDATA%\AI Novel Studio` 或用户选择 |
| 桌面快捷方式 | NSIS 默认有，MSI 默认无 |
| 开始菜单快捷方式 | 有 |
| 图标显示 | 正式图标 |
| 安装后启动 | 窗口正常打开 |

## 6. 用户数据路径

| 数据 | 路径 | 安全 |
|------|------|:---:|
| SQLite 数据库 | `%LOCALAPPDATA%\AI Novel Studio\ai-novel-studio.db` | ✅ 用户目录 |
| 窗口状态 | `%APPDATA%\com.ainovelstudio.app\window-state.json` | ✅ 用户目录 |
| 单实例锁 | `%APPDATA%\com.ainovelstudio.app\instance.lock` | ✅ 用户目录 |
| 安装目录 | 由安装器管理 | ✅ 不写入用户数据 |

## 7. 卸载与重装

| 验证项 | 预期 |
|--------|------|
| 卸载入口 | 开始菜单 / 设置 → 应用 |
| NSIS 卸载 | 程序文件移除，用户数据默认保留（AppData 不在安装目录） |
| MSI 卸载 | 同上 |
| 覆盖安装 | 不重置数据库 |

> ⚠️ 未实际执行卸载测试，需用户手动确认。

## 8. 发现的问题

| 问题 | 严重度 | 说明 |
|------|:---:|------|
| security.csp = null | 🟡 中 | 生产环境建议设置 CSP 限制 |
| NSIS 安装器无代码签名 | 🟡 中 | SmartScreen 可能提示"未知发布者" |
| MSI 未签名 | 🟡 中 | 同上 |
| 无自动更新机制 | 🟢 低 | 后续版本规划 |

## 9. 后续建议

| 优先级 | 内容 |
|--------|------|
| 短期 | 添加代码签名证书（消除 SmartScreen 警告） |
| 短期 | 设置 CSP header |
| 中期 | Tauri 2.x 升级后重新打包 |
| 中期 | 自动更新机制 |
| 长期 | 多语言安装器 |

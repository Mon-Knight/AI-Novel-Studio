# Tauri Development Instructions

> 适用于：所有 `src-tauri/` 下 Rust 代码的开发和修改
> 优先级：高
> 适用范围：Tauri 桌面壳、系统能力调用、打包构建

---

## 1. 总体原则

### 1.1 桌面端稳定优先

Tauri 层是 AI Novel Studio 的桌面壳，核心职责：

- 提供原生窗口
- 管理系统对话框（打开/保存文件）
- 管理 SQLite 数据库连接
- 管理系统通知
- 打包 Windows 安装包

稳定性 > 性能 > 新功能。

### 1.2 不引入不必要的 Rust 依赖

除非确实需要，否则不新增 `Cargo.toml` 依赖。

---

## 2. 窗口管理

### 2.1 窗口配置

- 默认窗口大小：1440×900
- 最小窗口大小：1280×720
- 支持最大化
- 支持最小化到系统托盘（后续版本）
- 窗口标题：`AI Novel Studio`

### 2.2 窗口行为

- 关闭按钮行为：最小化到托盘（后续版本）/ 直接退出
- 启动时居中显示
- 记住上次窗口位置和大小（后续版本）

---

## 3. 构建要求

### 3.1 构建命令

```powershell
# 开发模式
cargo tauri dev

# 生产构建
cargo tauri build

# Rust 编译检查（快速验证）
cargo check
```

### 3.2 构建失败处理

如果构建失败，必须：

1. 完整输出错误信息
2. 定位到具体文件/行号
3. 分析失败原因
4. 修复后重新构建

不得忽略构建错误。

---

## 4. 文件结构

```
src-tauri/
├── Cargo.toml          # Rust 依赖配置
├── tauri.conf.json     # Tauri 窗口与打包配置
├── build.rs            # 构建脚本
├── icons/              # 应用图标
├── src/
│   └── main.rs         # Rust 入口（Tauri 命令注册）
└── target/             # 构建输出（不提交 Git）
```

---

## 5. Tauri 命令规范

### 5.1 命令命名

使用 snake_case 命名，语义清晰：

```rust
#[tauri::command]
fn save_novel_data(novel_id: String, data: String) -> Result<(), String> {
    // ...
}
```

### 5.2 错误处理

所有 Tauri 命令必须返回 `Result<T, String>`，前端可获取错误信息。

不得使用 `unwrap()` 在生产代码中。

---

## 6. 安全要求

### 6.1 CSP（内容安全策略）

- 生产构建中必须配置合理的 CSP
- 开发模式下可适当放宽

### 6.2 文件系统访问

- 使用 Tauri Dialog API 让用户选择文件
- 不硬编码文件路径
- 不访问用户未授权的目录

### 6.3 API Key 安全

- 不在 Rust 代码中硬编码任何 Key
- 不在日志中打印完整 Key
- 配置文件不提交到 Git

---

## 7. 日志规范

- 使用 `log` crate 或 `println!` 输出关键操作日志
- 日志必须包含时间戳或可定位的上下文
- 错误日志必须包含足够的调试信息
- 构建日志必须明确输出成功/失败状态

---

## 8. 禁止事项

- ❌ 在 Rust 代码中硬编码前端逻辑
- ❌ 不必要地增加 native 依赖
- ❌ 忽略编译警告
- ❌ 提交 `target/` 目录
- ❌ 在 Tauri 命令中直接操作前端 DOM
- ❌ 使用 `unsafe` 代码（除非有充分理由并注释）

---

> **本文件是 AI Novel Studio Tauri 桌面壳开发的权威指令。**

# 本地构建产物清理说明

> 适用于：AI Novel Studio v1.7.11+  
> 背景：多次 `npm run tauri build` 后，`src-tauri/target/` 可能积累 60GB+ 历史构建产物  
> 原则：先报告 → 再归档 → 最后删除

---

## 1. 为什么本地版本会越来越大

每次 `npm run tauri build` 都会在 `src-tauri/target/` 下生成新的编译产物：

```text
src-tauri/target/
├── debug/          ← debug 构建（通常最大）
├── release/
│   ├── deps/       ← Rust 依赖编译中间文件
│   ├── build/      ← build script 输出
│   ├── incremental/ ← 增量编译缓存
│   └── bundle/     ← 安装包（NSIS/MSI）
│       ├── nsis/
│       └── msi/
└── ...
```

Rust 编译器保留增量编译缓存以加速后续构建，但长期积累会占用大量空间。

---

## 2. 空间占用分析

| 目录                        | 典型大小   | 说明                                     |
| --------------------------- | ---------- | ---------------------------------------- |
| `node_modules/`             | 300-600 MB | npm 依赖，可通过 `npm install` 重建      |
| `src-tauri/target/`         | 3-10 GB+   | Rust 编译输出，可通过 `cargo build` 重建 |
| 其中 `target/debug/`        | 2-6 GB     | Debug 构建，一般不需要                   |
| 其中 `target/release/deps/` | 1-3 GB     | 依赖库编译缓存                           |
| `dist/`                     | 1-5 MB     | 前端构建输出，很小                       |

---

## 3. 清理流程

### 第 1 步：扫描

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\maintenance\report_large_files.ps1
```

查看 `reports/local-storage-report.md` 了解当前空间分布。

### 第 2 步：归档旧安装包（推荐）

```powershell
# 预览
powershell -ExecutionPolicy Bypass -File .\scripts\maintenance\archive_old_builds.ps1 -DryRun

# 执行归档
powershell -ExecutionPolicy Bypass -File .\scripts\maintenance\archive_old_builds.ps1 -Apply
```

将旧版本安装包移动到 `E:\AI-Novel-Studio-Archive\`（或其他外部存储）。

### 第 3 步：预览清理

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\maintenance\clean_old_builds.ps1 -DryRun
```

### 第 4 步：执行清理

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\maintenance\clean_old_builds.ps1 -Apply
```

需要两次确认输入（`YES` → `DELETE`）。

### 第 5 步：验证可重建

```powershell
npm install
npm run build
cargo check
npm run tauri build
```

---

## 4. 哪些可以安全删除

| 项目                                               | 可以删？ | 重建方式                |
| -------------------------------------------------- | -------- | ----------------------- |
| `node_modules/`                                    | ✅       | `npm install`           |
| `src-tauri/target/debug/`                          | ✅       | `cargo build`           |
| `src-tauri/target/release/` (除 bundle 中的安装包) | ✅       | `cargo build --release` |
| Rust incremental 缓存                              | ✅       | 自动重建                |
| `dist/`                                            | ✅       | `npm run build`         |
| Vite 缓存                                          | ✅       | 自动重建                |

---

## 5. 哪些绝对不要删除

| 项目                                 | 原因                     |
| ------------------------------------ | ------------------------ |
| `.git/`                              | 版本历史，删除后无法恢复 |
| `src/`、`src-tauri/src/`             | 源代码                   |
| `docs/`、`README.md`、`CHANGELOG.md` | 项目文档                 |
| `package.json`、`Cargo.toml`         | 项目配置                 |
| `*.db`、`*.sqlite`                   | 用户数据                 |
| 用户导出的 `.json`、`.txt`、`.md`    | 用户备份                 |
| 当前稳定版本安装包 (.exe/.msi)       | 发布产物                 |

---

## 6. 推荐保留策略

```text
✅ 保留：
   - 当前 v1.7.10 NSIS 安装包 + MSI 安装包
   - 最近 2～3 个版本安装包
   - Git 仓库源码、文档、配置
   - 用户数据和导出备份

📦 可归档（移动到外部存储）：
   - 更早的安装包 (.exe, .msi)
   - 历史 zip 备份

🗑️ 可删除（重建后恢复）：
   - src-tauri/target（归档安装包后）
   - node_modules（保留 package-lock.json）
   - dist / build
   - Vite 缓存
   - Rust 编译缓存
```

---

## 7. 相关脚本

| 脚本                     | 功能             | 默认模式     |
| ------------------------ | ---------------- | ------------ |
| `report_large_files.ps1` | 扫描报告空间占用 | 只读         |
| `archive_old_builds.ps1` | 归档旧安装包     | 默认 dry-run |
| `clean_old_builds.ps1`   | 清理构建缓存     | 默认 dry-run |

---

> 最后更新：2026-06-08 (v1.7.11)  
> 如有疑问，先运行报告脚本，不要直接删除。

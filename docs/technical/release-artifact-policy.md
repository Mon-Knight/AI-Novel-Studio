# 发布产物保留策略

> 适用于：AI Novel Studio v1.7.11+  
> 目的：明确安装包保留规则、构建缓存清理策略、版本归档流程

---

## 1. 当前版本安装包

| 包类型 | 路径                                                                        | 用途                               |
| ------ | --------------------------------------------------------------------------- | ---------------------------------- |
| NSIS   | `src-tauri/target/release/bundle/nsis/AI Novel Studio_1.7.10_x64-setup.exe` | Windows 安装向导，推荐普通用户使用 |
| MSI    | `src-tauri/target/release/bundle/msi/AI Novel Studio_1.7.10_x64_en-US.msi`  | Windows 企业部署 / 静默安装        |

安装包由 `npm run tauri build` 生成，位于 `src-tauri/target/release/bundle/` 下。

---

## 2. 保留策略

### 2.1 始终保留

- **当前稳定基线版本安装包**（NSIS + MSI）：v1.7.10
- 所有源代码（`src/`、`src-tauri/src/`）
- 所有文档（`docs/`、`README.md`、`CHANGELOG.md`）
- Git 仓库（`.git/`）
- 配置文件（`package.json`、`Cargo.toml`、`vite.config.ts`、`tsconfig.json`）

### 2.2 保留最近版本

- 保留最近 **3 个版本** 的安装包
- 每个 **大阶段**（如 v1.7.x → v1.8.0）保留一个稳定安装包

### 2.3 归档旧版本

- 更早的安装包建议移动到 `E:\AI-Novel-Studio-Archive\` 等外部目录
- 使用 `scripts/maintenance/archive_old_builds.ps1` 执行归档

---

## 3. 可重建的构建缓存

以下目录可以安全删除，因为它们可以通过构建命令重建：

| 目录                | 大小估算    | 重建命令        |
| ------------------- | ----------- | --------------- |
| `node_modules/`     | ~300-600 MB | `npm install`   |
| `src-tauri/target/` | ~3-10 GB    | `cargo build`   |
| `dist/`             | ~1-5 MB     | `npm run build` |

**注意**：删除 `src-tauri/target/` 会同时删除已构建的安装包。删除前请先归档当前版本安装包。

---

## 4. 清理工作流程

```text
1. 运行 report_large_files.ps1      → 了解当前磁盘占用
2. 运行 archive_old_builds.ps1      → 归档旧安装包到外部存储
3. 运行 clean_old_builds.ps1 -Apply → 删除可重建的编译缓存
4. 运行 npm install && npm run build && cargo check → 验证可重建
```

**永远先 dry-run，确认后再执行。**

---

## 5. 不应该删除的内容

- `.git/` — 版本历史不可恢复
- `src/`、`src-tauri/src/` — 源代码
- `docs/` — 项目文档
- `*.db`、`*.sqlite` — 用户数据库
- 用户导出的 `.json`、`.txt`、`.md` 备份文件
- `package.json`、`Cargo.toml` — 项目配置

---

## 6. 相关脚本

| 脚本                                         | 用途           | 是否修改文件 |
| -------------------------------------------- | -------------- | ------------ |
| `scripts/maintenance/report_large_files.ps1` | 扫描报告大文件 | ❌ 只读      |
| `scripts/maintenance/archive_old_builds.ps1` | 归档旧安装包   | 默认 DRY-RUN |
| `scripts/maintenance/clean_old_builds.ps1`   | 清理构建缓存   | 默认 DRY-RUN |

---

> 最后更新：2026-06-08 (v1.7.11)

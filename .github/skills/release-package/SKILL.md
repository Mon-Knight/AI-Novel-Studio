# Skill: release-package

> **技能名称**：版本发布与收尾
> **触发条件**：版本开发完成后，用户要求发布版本
> **技能类型**：多步骤工作流

---

## 概述

`release-package` 是 AI Novel Studio 的版本发布收尾技能。它负责版本号更新、CHANGELOG 更新、Git 提交和 Tag 创建。

---

## 工作流

### 步骤 1：验证构建

在发布前，**必须先运行完整验证**：

可调用 `verify-build` Skill 或手动执行：

```powershell
cargo check
npm run build
npm run tauri build
git status
```

如果任何一步失败，**停止发布流程**。

### 步骤 2：更新版本号

确认版本号（按语义化版本规则）：

需要更新的文件：

1. `package.json` → `"version": "X.X.X"`
2. `src-tauri/Cargo.toml` → `version = "X.X.X"`
3. `src-tauri/tauri.conf.json` → `"version": "X.X.X"`
4. `src/constants/version.ts`（如果存在）

### 步骤 3：更新 CHANGELOG.md

在 `CHANGELOG.md` 开头新增版本记录：

```markdown
## vX.X.X (YYYY-MM-DD)

### 新增

- 功能/文件描述

### 修改

- 修改内容描述

### 修复

- 修复内容描述

### 开发者备注

- 技术相关备注
```

### 步骤 4：校验 Release Notes 来源

Release Notes 只维护在 `CHANGELOG.md` 的当前版本段落中。运行：

```powershell
npm run test:version-sync
node scripts/release/extract-release-notes.mjs --version X.Y.Z --output dist-release/release-notes-vX.Y.Z.md
```

检查提取结果包含版本号、日期、变更、验证、已知限制与回滚边界。不要新增
`docs/release-notes-vX.Y.Z.md`；旧版本快照统一保存在 `docs/project/release-history.md`。

### 步骤 5：更新 README

如果版本新增了重要功能，更新 `README.md`：

- 功能概览
- 版本路线表
- 当前版本号

### 步骤 6：更新版本路线图

在 `docs/version-roadmap.md` 中：

- 标记当前版本为 ✅ 已完成
- 如有调整，更新后续版本计划

### 步骤 7：Git 操作

执行以下 Git 操作：

```powershell
# 1. 在版本分支确认状态
git status

# 2. 添加所有变更
git add .

# 3. 提交
git commit -m "feat: complete vX.X.X - 版本描述"

# 4. 推送版本分支并创建 PR
git push -u origin codex/vX.Y.Z-release

# 5. 审查和门禁通过、PR 合并后，从 main 创建 Tag
git switch main
git pull --ff-only origin main
git tag vX.X.X
git push origin vX.X.X
```

不得绕过 `docs/project/git-workflow.md` 中的 `main` 保护和审查要求，也不得移动已发布 tag。

### 步骤 8：最终确认

输出发布确认报告：

```markdown
## 🚀 vX.X.X 发布完成

### 版本信息

- 版本号：vX.X.X
- Commit：
- Tag：vX.X.X ✅

### 发布内容

- 新增：X 项
- 修改：X 项
- 修复：X 项

### Git 操作

- commit：✅
- push：✅
- tag：✅

### 下一步

- 下一版本目标：...
```

---

## 输入信息

- 当前版本号
- 发布类型（正式版 / 预览版）
- 是否需要创建 tag

## 禁止事项

- ❌ 禁止未经构建验证就发布
- ❌ 禁止自动 push（必须人工确认）
- ❌ 禁止自动创建 tag（默认不自动 tag，除非任务书明确要求）
- ❌ 禁止未经确认覆盖安装包
- ❌ 禁止自动删除文件
- ❌ 禁止自动修改版本号

## 验证方式

- `verify_project.ps1` 全部通过
- 版本号在所有位置一致
- CHANGELOG 已更新

## 失败处理

- 如果构建验证失败，必须修复后才能继续
- 如果文档未同步，先运行 docs-sync Skill

## 关联资源

- 关联脚本：`scripts/agent-workflow/release_workflow.ps1`
- 关联 Checklist：`.github/checklists/release.checklist.md`
- 关联 Skill：`docs-sync`（发布前先同步文档）

## 约束

- 必须先验证构建，再发布
- 版本号必须在所有位置一致
- push 和 tag 必须人工确认（默认不自动执行）
- 必须推送到 GitHub

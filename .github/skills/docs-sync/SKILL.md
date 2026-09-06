# Skill: docs-sync

> **Skill 名称**：文档同步
> **触发条件**：版本完成后、功能修改后、发布前
> **Skill 类型**：多步骤工作流

---

## 概述

`docs-sync` 用于文档修订、功能变更和发布前的真实性/一致性检查。遵循根 [AGENTS.md](../../../AGENTS.md)；它不授权修改业务代码、升级版本或执行 Git/发布动作。

---

## 使用场景

- 版本开发完成后
- 发布前最后检查
- 发现文档与代码不一致时

---

## 输入信息

- 当前版本号
- 本次变更内容

---

## 按范围读取/检查的入口

先读取根规则和本次修改文档。下列清单用于定位相关权威入口，发布任务再逐项核对，不要求每次纯文档任务通读全部资料：

- `README.md`
- `CHANGELOG.md`
- `docs/version-roadmap.md`
- `docs/agent-runtime.md`
- `docs/development-skills.md`
- `docs/project/git-workflow.md`
- `docs/project/release-history.md`
- `docs/technical/diagnostics.md`
- `AGENTS.md`
- `.github/copilot-instructions.md`

---

## 必须关联的脚本

```
scripts/agent-workflow/check_docs_sync.ps1
```

---

## 必须关联的 Checklist

```
.github/checklists/docs-sync.checklist.md
```

---

## 执行步骤

### 步骤 1：运行文档检查脚本

```powershell
powershell -ExecutionPolicy Bypass -File scripts/agent-workflow/check_docs_sync.ps1
```

### 步骤 2：逐项检查

对照 `docs-sync.checklist.md` 逐项检查：

- [ ] `README.md` 版本号已同步
- [ ] `README.md` 当前阶段描述已更新
- [ ] `CHANGELOG.md` 已记录本次变更；非发布任务写入 `Unreleased`，不新增虚构版本
- [ ] `docs/version-roadmap.md` 已标记当前版本
- [ ] `docs/agent-runtime.md` 已更新（如涉及 Agent Runtime）
- [ ] `CHANGELOG.md` 是唯一活动发布入口，`docs/` 下没有逐版本发布说明碎片
- [ ] Git / PR / Release 治理文件和工作流均存在
- [ ] `AGENTS.md` 无需更新或已更新
- [ ] 当前版本声明与机器清单一致；历史版本、审计日期与已发布记录保持原语义

### 步骤 3：检查文档真实性

- 文档是否声称了未完成的功能？
- 文档是否包含了过时信息？
- 文档是否与代码实际行为一致？

### 步骤 4：输出同步报告

---

## 输出格式

```markdown
## 文档同步报告

### 已同步

- ✅ README.md — vX.X.X 已更新
- ✅ CHANGELOG.md — 新增版本条目

### 需要更新

- ⚠️ docs/version-roadmap.md — 需要标记当前版本

### 缺失

- ❌ docs/agent-runtime.md — 不存在

### 版本号一致性

- package.json: X.X.X
- Cargo.toml: X.X.X
- tauri.conf.json: X.X.X
- README: X.X.X
- CHANGELOG: X.X.X

### 建议

- 是否需要人工确认：
```

---

## 禁止事项

- ❌ 未获版本任务授权就升级应用版本；已获准升级却不同步相关版本声明
- ❌ 声明未完成的功能为已完成
- ❌ 多个文档描述同一件事但互相矛盾
- ❌ 文档中存在过时信息

---

## 验证方式

- `npm run test:docs-sync`（包含 live 仓库检查和失败关闭回归）
- 涉及版本、路线或发布口径时运行 `npm run test:version-sync`
- 只对改动文件执行 `npx prettier --check`，并运行 `git diff --check`、`git status --short`
- 人工核查相关实现、路径/链接与能力证据；脚本通过不代表所有文档事实均已自动验证

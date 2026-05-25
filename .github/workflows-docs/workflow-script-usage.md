# Workflow Script Usage

> 文件：`.github/workflows-docs/workflow-script-usage.md`
> 版本：v1.0.44
> 用途：说明 4 个 Agent Workflow PowerShell 脚本的用途和使用方法

---

## 1. 脚本列表

```text
scripts/agent-workflow/
├── verify_project.ps1       # 统一项目验证入口
├── check_docs_sync.ps1      # 检查关键文档是否存在和同步
├── run_feature_workflow.ps1 # Agent 功能开发前后引导
└── release_workflow.ps1     # 发布前检查（不自动发布）
```

---

## 2. verify_project.ps1

### 用途
一次运行所有构建和验证步骤，输出统一摘要。

### 运行
```powershell
powershell -ExecutionPolicy Bypass -File scripts/agent-workflow/verify_project.ps1
```

### 输出格式
```
[verify_project] cargo check: PASS
[verify_project] npm run build: PASS
[verify_project] npm run tauri build: PASS
[verify_project] pytest: SKIPPED (not configured)
[verify_project] git status: CLEAN
```

### 说明
- 每一步输出 `PASS / FAIL / SKIPPED`
- 失败步骤显示具体命令
- 最终输出验证摘要

---

## 3. check_docs_sync.ps1

### 用途
检查关键文档是否存在、版本号是否同步。

### 运行
```powershell
powershell -ExecutionPolicy Bypass -File scripts/agent-workflow/check_docs_sync.ps1
```

### 检查项
- `AGENTS.md` 是否存在
- `.github/copilot-instructions.md` 是否存在
- `docs/development-rules.md` 是否存在
- `docs/agent-workflow.md` 是否存在
- `docs/version-roadmap.md` 是否存在
- `README.md` 是否存在
- `CHANGELOG.md` 是否包含当前版本号

---

## 4. run_feature_workflow.ps1

### 用途
Agent 执行功能开发前后的引导脚本。不自动修改代码。

### 运行
```powershell
powershell -ExecutionPolicy Bypass -File scripts/agent-workflow/run_feature_workflow.ps1
```

### 流程
1. 检查 `git status`
2. 检查 `AGENTS.md` 是否存在
3. 检查 `docs/development-rules.md` 是否存在
4. 检查 `.github/checklists/feature-development.checklist.md` 是否存在
5. 运行 `verify_project.ps1`
6. 运行 `check_docs_sync.ps1`
7. 输出下一步建议

### 禁止
- 不自动修改代码
- 不自动 commit
- 不自动 tag
- 不调用危险命令

---

## 5. release_workflow.ps1

### 用途
发布前检查，不负责强制发布。

### 运行
```powershell
powershell -ExecutionPolicy Bypass -File scripts/agent-workflow/release_workflow.ps1
```

### 流程
1. 检查 `CHANGELOG.md` 是否包含当前版本
2. 检查 `README.md` 是否更新
3. 运行 `verify_project.ps1`
4. 检查 `git status`
5. 输出是否可以创建 tag 的建议

### 禁止
- 不自动创建 tag
- 不自动 push
- 不自动删除文件
- 不自动修改版本号

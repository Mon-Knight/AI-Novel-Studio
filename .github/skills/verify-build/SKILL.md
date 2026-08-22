# Skill: verify-build

> **技能名称**：构建验证
> **触发条件**：用户要求验证项目构建状态、版本发布前检查
> **技能类型**：多步骤工作流

---

## 概述

`verify-build` 是 AI Novel Studio 的自动化构建验证技能。它对项目执行完整的构建验证流程，确保代码可以成功编译和打包。

---

## 工作流

### 步骤 1：环境检查

验证开发环境是否满足构建要求：

```powershell
node --version    # 必须 >= 18
npm --version
rustc --version   # 必须已安装
cargo --version
```

如果环境不满足要求，报告缺失项并停止。

### 步骤 2：依赖检查

确认依赖已安装：

```powershell
# 检查 node_modules 是否存在
Test-Path node_modules

# 如果不存在，安装
npm install
```

### 步骤 3：Rust 编译检查

进入 `src-tauri/` 目录执行：

```powershell
cargo check
```

记录：

- 编译是否成功
- 警告数量
- 错误详情（如有）

如果 `cargo check` 失败，**立即停止并报告**，不继续后续步骤。

### 步骤 4：前端 TypeScript 编译 + 构建

```powershell
npm run build
```

记录：

- TypeScript 编译是否通过
- Vite 打包是否成功
- 输出文件大小
- 错误详情（如有）

如果 `npm run build` 失败，**立即停止并报告**。

### 步骤 5：Tauri 完整构建

```powershell
npm run tauri build
```

记录：

- 完整构建是否成功
- 产物路径
- 安装包大小
- 错误详情（如有）

### 步骤 6：Git 状态检查

```powershell
git status
```

记录：

- Working tree 是否 clean
- 未跟踪的文件
- 未提交的修改

### 步骤 7：生成验证报告

汇总所有步骤的结果，输出结构化验证报告：

```markdown
## 🔍 vX.X.X 构建验证报告

### 环境

| 组件    | 版本 | 状态 |
| ------- | ---- | ---- |
| Node.js | vXX  | ✅   |
| npm     | vXX  | ✅   |
| Rust    | vXX  | ✅   |
| Cargo   | vXX  | ✅   |

### 构建结果

| 步骤                | 状态          | 备注 |
| ------------------- | ------------- | ---- |
| cargo check         | ✅ / ❌       |      |
| npm run build       | ✅ / ❌       |      |
| npm run tauri build | ✅ / ❌       |      |
| git status          | clean / dirty |      |

### 总体判定

✅ 全部通过 —— 可以发布
❌ 存在问题 —— 需要修复后重新验证

### 失败详情（如有）

...
```

---

## 输入信息

- 无（自动检测项目状态）

## 禁止事项

- ❌ 不跳过任何步骤（即使某步之前通过过）
- ❌ 不隐藏错误输出
- ❌ 不在失败时继续下一步

## 验证方式

- 所有步骤状态为 PASS 或 SKIPPED（无 FAIL）

## 失败处理

- 失败步骤必须输出完整命令和错误摘要
- 定位失败文件和行号
- 给出修复建议

## 关联资源

- 关联脚本：`scripts/agent-workflow/verify_project.ps1`（必须调用）
- 关联 Checklist：`.github/checklists/verification.checklist.md`

## 约束

- 必须按顺序执行，前一步失败不继续
- 必须如实报告结果
- 失败时提供完整的错误输出
- 不跳过任何步骤

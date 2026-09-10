# Bug Fix Prompt

> 用途：让 AI Agent 系统性地分析和修复 Bug
> 使用方法：将此 Prompt 与 Bug 描述一起提供给 Agent

---

## 任务

你是 AI Novel Studio 的 Bug 修复 Agent。请系统性地分析并修复以下 Bug。

## 输入

Bug 描述：{{BUG_DESCRIPTION}}

请先执行以下调研步骤：

1. 阅读 `AGENTS.md` 了解项目约束
2. 阅读相关 `docs/` 了解功能设计
3. 定位 Bug 相关的源文件
4. 分析根因

## 分析要求

在动手修改前，先输出：

```markdown
## Bug 分析报告

### 现象

- 用户看到什么？

### 根因

- 代码哪里出了问题？
- 为什么会出问题？

### 影响范围

- 影响哪些页面/功能？
- 是否有数据风险？

### 修复方案

- 修改哪个文件？
- 怎么修改？
- 是否会影响其他功能？

### 验证方案

- 如何验证修复成功？
```

## 修复约束

- 最小改动原则：只修改必要的代码
- 不顺手重构无关代码
- 不新增功能
- 为修复的行为补回归；用户交互变化对应真实桌面场景
- 修复后运行变更选择器选出的检查，只复测受影响项；不因“修 Bug”运行完整发布矩阵或生产安装包构建

## 验证命令

```powershell
npm run verify:change -- --dry-run   # 查看选择理由与命令
npm run verify:change
git diff --check
git status --short
```

Rust/SQLite 修复由选择器加入 `cargo check --locked` 与相关 Rust 测试；migration、共享持久化或 DSH 变化扩大到对应完整领域门禁。任何检查失败都要如实报告，不用“其他测试通过”抵消。

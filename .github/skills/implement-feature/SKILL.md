# Skill: implement-feature

> **技能名称**：功能实现
> **触发条件**：用户要求实现某个版本或功能
> **技能类型**：多步骤工作流

---

## 概述

`implement-feature` 是 AI Novel Studio 的核心开发执行技能。它确保 Agent 按照项目规范、在正确范围内、以正确的流程实现功能。

---

## 工作流

### 步骤 1：阅读约束

在执行任何修改之前，**强制**阅读：

1. `AGENTS.md` —— 了解 Agent 行为总约束
2. `.github/instructions/agent-behavior.instructions.md` —— 行为规范
3. 相关领域的 instruction 文件（如 `frontend.instructions.md`）
4. `.cursor/rules/agent-safety.mdc` —— 安全规则

### 步骤 2：阅读设计文档

理解功能背景：

1. `docs/product-design.md` —— 产品定位
2. `docs/ui-reference.md` —— UI 标准
3. `docs/data-model.md` —— 数据边界
4. `docs/module-boundaries.md` —— 模块边界

### 步骤 3：分析影响范围

在修改代码前，先回答：

1. 这个功能属于哪个模块？
2. 需要新增哪些文件？
3. 需要修改哪些文件？
4. 会影响哪些已有页面/功能？
5. 有没有风险破坏已有功能？

输出一个修改计划清单。

### 步骤 4：执行修改

严格按计划执行：

1. 一次只修改一个文件
2. 每修改完一个文件，检查是否引入错误
3. 不顺手修改无关代码
4. 不扩展需求范围
5. 不删除已有功能

### 步骤 5：验证

每完成一批修改后：

1. 运行 `cargo check`（如果修改了 Rust 代码）
2. 运行 `npm run build`（如果修改了前端代码）
3. 检查控制台是否有错误
4. `git status` 确认修改范围

### 步骤 6：文档同步

修改完成后：

1. 更新 `CHANGELOG.md`
2. 如果涉及架构变更，更新相关 docs
3. 如果涉及新功能，更新 `README.md`

### 步骤 7：完成汇报

输出完成汇报，格式如下：

```markdown
# ✅ 完成汇报

## 一、当前版本
- 版本号：
- 分支：

## 二、本次目标
- ...

## 三、已完成内容
- ...

## 四、新增 / 修改文件
- ...

## 五、运行与验证
- cargo check：
- npm run build：
- npm run tauri build：
- git status：

## 六、后续建议
- ...
```

---

## 约束

- 必须先读 AGENTS.md，不允许跳过
- 禁止跨模块乱改
- 禁止自动扩展需求
- 必须运行验证
- 必须更新 CHANGELOG

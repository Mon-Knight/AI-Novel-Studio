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

1. 运行与修改模块直接相关的动态测试
2. 修改前端时运行 `npm run lint:ci` 与 `npm run build`
3. 修改 Rust/SQLite 时运行 `cargo check` 与相关测试
4. 修改 Tauri/DSH payload 或执行发布时运行对应桌面 E2E、生产构建或统一发布验证入口
5. 纯文档任务运行 docs/version sync、Prettier 和 diff 检查
6. `git status --short` 确认修改范围

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

- 相关动态测试：
- lint/build（如适用）：
- Rust/SQLite（如适用）：
- Tauri/DSH/发布门禁（如适用）：
- 文档与范围检查：
- git status：

## 六、后续建议

- ...
```

---

## 输入信息

- 用户提供的任务书（自包含的 Markdown 文档）
- 或：版本号 + 功能描述 + 修改范围

## 禁止事项

- ❌ 禁止顺手重构与任务无关的代码
- ❌ 禁止扩展任务书中没有的未来功能
- ❌ 禁止删除任务书中未要求删除的旧功能
- ❌ 禁止修改数据库 schema（除非任务书明确要求）
- ❌ 禁止不读 AGENTS.md 就直接修改
- ❌ 禁止跳过验证步骤

## 验证方式

- 修改后的文件是否在任务书范围内？
- 与修改范围相匹配的测试、lint、构建或文档门禁是否通过？
- 已有功能是否正常？

## 失败处理

- 如果 `npm run build` 失败，先修复再继续
- 如果修改引起了其他模块报错，评估是否在自己的修改范围内
- 如果是预存错误（修改前就存在），在汇报中说明

## 关联资源

- 关联 Checklist：`.github/checklists/feature-development.checklist.md`
- 关联脚本：`scripts/agent-workflow/run_feature_workflow.ps1`

## 约束

- 必须先读 AGENTS.md，不允许跳过
- 禁止跨模块乱改
- 禁止自动扩展需求
- 必须运行验证
- 必须更新 CHANGELOG

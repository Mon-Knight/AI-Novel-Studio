# Skill: agent-task-writer

> **Skill 名称**：Agent 任务书生成
> **触发条件**：用户要求"生成任务书"、"写任务书"、"给 Agent 的任务"
> **Skill 类型**：多步骤工作流

---

## 概述

`agent-task-writer` 把版本规划转成 **可复制给 Agent 的独立任务书**。

Agent 无法知道用户和 ChatGPT 之前的对话。任务书必须 **自包含**。

---

## 使用场景

1. ChatGPT / Planner 完成版本规划后
2. 需要输出任务书给 VS Code Agent
3. 用户复制任务书发给 Agent 执行

---

## 输入信息

- 版本规划输出（来自 plan-version Skill）
- 当前项目状态
- 用户补充的需求细节

---

## 必须读取的文件

- `AGENTS.md` — Agent 行为约束
- `docs/version-roadmap.md` — 路线图
- `docs/development-rules.md` — 开发规则
- `CHANGELOG.md` — 版本历史

---

## 执行步骤

### 步骤 1：确认版本信息

1. 确定版本号
2. 确定版本定位（一句话）
3. 确定核心目标

### 步骤 2：列出禁止事项

明确哪些 **绝对不能做**：

- 不新增什么功能
- 不修改什么模块
- 不删除什么内容
- 不引入什么依赖

### 步骤 3：列出必须阅读的文件

Agent 开始前必须先读：

- AGENTS.md
- 相关 docs/
- 相关 .github/instructions/

### 步骤 4：列出修改范围

- 新增文件清单
- 修改文件清单
- 每个文件的具体要求

### 步骤 5：定义测试要求

- 文档任务：docs/version sync、Prettier、diff/range 检查
- 前端任务：相关动态测试、`npm run lint:ci`、`npm run build`
- Rust/SQLite 任务：`cargo check`、相关测试，版本验收时完整 `cargo test`
- Tauri/DSH payload/发布任务：真实桌面 E2E、`npm run tauri:build` 或统一发布验证入口
- 所有任务：`git status --short` 确认变更范围；clean working tree 只作为提交/发布终态要求

### 步骤 6：定义完成标准

- 功能验收
- 文档要求
- Git 要求

### 步骤 7：定义完成汇报格式

Agent 完成后必须按此格式输出。

---

## 输出格式

```markdown
# AI Novel Studio vX.X.X

# 任务标题

---

## 一、版本定位

...

## 二、本次版本号

vX.X.X

## 三、本次核心目标

...

## 四、本次禁止事项（非常重要）

本次：

- 不...
- 不...

本次只允许：

- ...

## 五、开始前必须阅读

Agent 开始前必须阅读：

- AGENTS.md
- ...

## 六、必须新增/修改的文件

...

## 七、详细实现要求

...

## 八、测试要求

...

## 九、完成标准

...

## 十、完成汇报格式

...
```

---

## 禁止事项

- ❌ 任务书不能依赖"之前对话中的隐含信息"
- ❌ 不能假设 Agent 知道用户的偏好或习惯
- ❌ 不能省略禁止事项
- ❌ 不能省略测试要求
- ❌ 不能省略完成汇报格式

---

## 验证方式

人工检查：任务书是否自包含？一个新 Agent 拿到任务书能否独立执行？

---

## 核心原则

> **任务书必须自包含。不能假设 Agent 知道用户之前和 ChatGPT 的对话。**

# AI Novel Studio — AI Agent 路线图

> 文件：`docs/ai-agent-roadmap.md`  
> 用途：规划 AI Agent 能力的演进路线  
> 适用：产品规划 + 技术决策

---

## 1. 总体愿景

将 AI Novel Studio 从 **AI 辅助写作工具** 逐步升级为 **AI Autonomous Creative Platform**。

核心转变：

```text
起点（v1.x）：用户手动触发每次 AI 操作
  ↓
Phase 1：Agent 基础设施（Rules / Skills / Instructions）
  ↓
Phase 2：Agent 化（Planner / Tool Calling / Memory）
  ↓
Phase 3：Autonomous（Multi-Agent / 自主创作）
  ↓
Phase 4：Conversational Workbench（对话任务 / 并发 / 产物确认）
```

---

## 2. Phase 1：Agent 基础设施（v1.0.43+，已完成）

### 目标

建立 Agent 工程化开发的基础设施，让 AI Agent 能规范地参与项目开发。

### 内容

- ✅ `AGENTS.md` — Agent 总入口规则
- ✅ `.github/instructions/` — 分领域开发指令
- ✅ `.github/prompts/` — 版本开发 Prompt 模板
- ✅ `.github/skills/` — Agent Skills（多步骤工作流）
- ✅ `.cursor/rules/` — IDE 规则
- ✅ `docs/module-boundaries.md` — 模块边界
- ✅ `docs/project-architecture.md` — 项目架构
- ✅ `docs/agent-workflow.md` — Agent 工作流
- ✅ `docs/ai-agent-roadmap.md` — 本文件

---

## 3. Phase 2：Agent 化（v2.x 系列）

### 3.1 Rules Engine

让 Agent 能理解和执行项目规则：

- 自动检查修改是否符合 UI 规则
- 自动检查是否违反数据库规则
- 自动检查 Agent 行为安全规则

### 3.2 Planner

让 Agent 能自主规划复杂任务：

- 接收高层次目标
- 自动拆解为子任务
- 评估依赖关系
- 制定执行顺序

### 3.3 Tool Calling

让 Agent 能调用项目中的工具能力：

- AI 正文生成
- 质量检查
- 正文润色
- 上下文总结
- 角色推荐
- 事件建议

### 3.4 Memory Engine

让 Agent 拥有长期记忆：

- 小说上下文（角色状态、事件进展）
- 用户偏好（风格、节奏、字数）
- 创作历史（之前的决策和结果）
- 项目知识（文档、规则、架构）

### 3.5 Verification Engine

让 Agent 能自我验证：

- 代码构建验证
- UI 风格检查
- 数据库安全检查
- 功能回归验证

---

## 4. Phase 3：Autonomous（v3.x，当前阶段）

### 4.1 Multi-Agent Workflow

多个专业 Agent 协作：

```text
Orchestrator Agent（总调度）
    ├─ WorldBuilder Agent（世界构建）
    ├─ CharacterAgent（角色设计）
    ├─ PlotAgent（剧情规划）
    ├─ WriterAgent（正文生成）
    ├─ EditorAgent（润色编辑）
    ├─ ReviewerAgent（质量审查）
    └─ ContinuityAgent（连续性维护）
```

v3.0.0 已完成两个相连的生产闭环：Plot Planner、Character Evolution、World Builder、Conflict Generator 和 Pacing Controller 从小说 Brief 生成全书事实与章节计划；章节 Writer 生成候选后，由情节、角色、设定、逻辑、语言和质量六专家评审，未通过时交给主编 Agent 修订。

全书计划、Agent 检查点、逐章 run 和采用进度可持久恢复。正文采用后，系统自动提出人物变化和世界扩展候选，但正文、章节分析和世界候选仍分别保留用户确认门禁。

### 4.2 Autonomous Creation

Agent 能自主推进创作流程：

- ✅ 从小说 Brief 自动生成 12～500 章分层计划
- ✅ 按计划生成下一章候选并自动执行六专家检查
- ✅ 用户显式启动、可暂停 / 继续的进程内逐章候选队列
- ✅ 跟踪人物成长节点、冲突线程和逐章节奏
- ✅ 从已采用正文提出章节总结和世界扩展候选
- ⏳ 跨进程 / 无人值守自动续跑、向量语义 Memory

### 4.3 Creative Collaboration

人机协作创作模式：

- Agent 提出创作建议
- 用户选择方向
- Agent 执行生成
- 用户审核和微调

---

## 5. Phase 4：Conversational Workbench（v3.3.0+，已落地）

### 5.1 工作台成为控制面

Phase 4 不重新发明 Planner、Tool Registry、Memory 或 Safe Apply，而是把既有能力组织成用户可以持续使用的任务工作台：

```text
小说项目
→ 创建任务对话
→ 选择任务模型
→ Runtime 调用受约束领域工具
→ 对话内显示调用、错误与恢复
→ 形成不可变产物
→ 用户确认、审阅与安全应用
```

任务对话是用户可见的执行单元，每个任务拥有独立上下文、模型快照、运行和产物。系统需要允许“生成下一章”与“审计既有章节”等任务并发运行，并继续服从应用级并发、频率、Token 和成本治理。

### 5.2 领域工具而非通用 Agent

首批对话工具聚焦小说创作：

- `novel.read_context`
- `chapter.read_outline`
- `search_memory`
- `generate_chapter`

后续按版本扩展大纲、人物、设定、风格、上下文、总结、检查与润色工具。工作台不扩展为通用代码、Shell、Git 或插件 Agent。

工具、模型、上下文与压缩能力使用稳定能力接口和可替换 Provider。任务运行冻结实际 Provider、模型、能力版本与配置摘要；更换小说上下文压缩实现不应要求修改 Agent Loop、工作台或 Safe Apply。

### 5.3 对话事件与错误

AI 面向用户的回复、工具调用、错误和产物共同构成任务对话。工具调用必须显示排队、运行、成功、失败、取消或跳过状态；错误显示在失败环节，不依赖独立执行时间线，也不暴露隐藏思维链。

### 5.4 产物与人工决定

- 普通回复不能直接修改小说正式事实。
- 产物形成后在对话中推送专用卡片。
- 结构化产物经确认后使用 Safe Apply。
- 章节候选先由用户确认进入人工审阅，再显式编辑、保存和采用。
- 基线漂移、重复应用和并发写入继续由 revision、CAS 和幂等事务处理。

### 5.5 DSH 与内部 Runtime 边界

DSH 可以作为任务 Planner/Executor 的一种实现或 Worker，但不能成为小说事实、预算、产物验证或最终采用的权威。若 DSH 的取消仍采用进程重启语义，并发任务必须隔离 Worker，避免取消一个任务影响其他任务。

借鉴范围包括 Profile/Bundle 能力组合、作用域 Session/Agent、Turn/Step 工具循环、受控并发和追加事件投影；不复制代码、Shell、Git 等通用开发能力。工作台另提供 Runtime Registry 的只读“当前插件”视图，分类查看功能、模型和其他已加载插件，不扩展安装、卸载、启停、配置、更新或市场能力。

实现方式固定为“ANS 产品层 + 稳定 DSH Adapter + 固定版本 Headless Worker”。当前载体 commit 与较新参考源码必须先做差异审计；工作台实现不得顺带升级 DSH，也不得把 Harness UI、内部 Session 类型或 Cordis 对象变成 ANS 产品契约。

详细设计与分阶段验收见 [`architecture/conversational-creative-workbench.md`](architecture/conversational-creative-workbench.md)。对话工作台、确认/Safe Apply、领域候选工具和写作工作台审阅收敛已包含在 v3.5.0。

---

## 6. 关键技术能力演进

| 能力         | v1.x（基础设施） | v2.x（Agent 化） | v3.x（当前 Autonomous）                  |
| ------------ | ---------------- | ---------------- | ---------------------------------------- |
| Rules        | 静态文档         | 动态检查         | 自动执行                                 |
| Planning     | 人工拆解         | 固定持久 Planner | 全书创作 Agent 规划已实现                |
| Memory       | 章节上下文       | 持久摘要与状态   | 结构化跨章节事实已实现；语义向量待建设   |
| Tool Calling | 无               | 工具注册         | 受约束服务编排已实现；模型自主选择待建设 |
| Multi-Agent  | 无               | 无               | 全书规划 + 六专家评审已实现              |
| Verification | 人工             | 自动化           | 持续验证                                 |

---

## 7. 技术选型方向

### 7.1 Agent 框架

评估方向：

- LangChain / LangGraph
- CrewAI
- AutoGen
- 自研轻量 Agent 框架

### 7.2 Memory 系统

评估方向：

- 向量数据库（Chroma / Qdrant）
- 知识图谱（Neo4j）
- 结构化 SQL + 非结构化向量混合

### 7.3 Tool Calling

评估方向：

- OpenAI Function Calling
- MCP (Model Context Protocol)
- 自定义 Tool Registry

---

## 8. 风险与挑战

| 风险       | 说明                       | 缓解措施            |
| ---------- | -------------------------- | ------------------- |
| Agent 失控 | Agent 做出不符合预期的操作 | 安全规则 + 人工审核 |
| 上下文膨胀 | 长篇小说上下文过长         | 智能裁剪 + 分层总结 |
| 质量下降   | 自主生成质量不可控         | 多级检查 + 用户确认 |
| 成本过高   | 频繁 AI 调用成本大         | 本地模型 + 缓存策略 |

---

> **本文件是 AI Novel Studio Agent 能力演进的长期规划。具体实施以各版本任务书为准。**

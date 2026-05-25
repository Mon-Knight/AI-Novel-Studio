# AI Novel Studio — AI Agent 路线图

> 文件：`docs/ai-agent-roadmap.md`  
> 用途：规划 AI Agent 能力的演进路线  
> 适用：产品规划 + 技术决策

---

## 1. 总体愿景

将 AI Novel Studio 从 **AI 辅助写作工具** 逐步升级为 **AI Autonomous Creative Platform**。

核心转变：

```text
当前：用户手动触发每次 AI 操作
  ↓
Phase 1：Agent 基础设施（Rules / Skills / Instructions）
  ↓
Phase 2：Agent 化（Planner / Tool Calling / Memory）
  ↓
Phase 3：Autonomous（Multi-Agent / 自主创作）
```

---

## 2. Phase 1：Agent 基础设施（v1.0.43+，当前阶段）

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

## 4. Phase 3：Autonomous（v3.x 系列）

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

### 4.2 Autonomous Creation

Agent 能自主推进创作流程：
- 根据大纲自动生成章节
- 自动检查连贯性
- 自动维护角色一致性
- 用户只需审核和调整方向

### 4.3 Creative Collaboration

人机协作创作模式：
- Agent 提出创作建议
- 用户选择方向
- Agent 执行生成
- 用户审核和微调

---

## 5. 关键技术能力演进

| 能力 | v1.x（当前） | v2.x（Agent 化） | v3.x（Autonomous） |
|------|------------|-----------------|-------------------|
| Rules | 静态文档 | 动态检查 | 自动执行 |
| Planning | 人工拆解 | Agent 辅助 | Agent 自主 |
| Memory | 章节上下文 | 长期记忆 | 语义记忆 |
| Tool Calling | 无 | 工具注册 | 自主选择 |
| Multi-Agent | 无 | 无 | 协作网络 |
| Verification | 人工 | 自动化 | 持续验证 |

---

## 6. 技术选型方向

### 6.1 Agent 框架

评估方向：
- LangChain / LangGraph
- CrewAI
- AutoGen
- 自研轻量 Agent 框架

### 6.2 Memory 系统

评估方向：
- 向量数据库（Chroma / Qdrant）
- 知识图谱（Neo4j）
- 结构化 SQL + 非结构化向量混合

### 6.3 Tool Calling

评估方向：
- OpenAI Function Calling
- MCP (Model Context Protocol)
- 自定义 Tool Registry

---

## 7. 风险与挑战

| 风险 | 说明 | 缓解措施 |
|------|------|----------|
| Agent 失控 | Agent 做出不符合预期的操作 | 安全规则 + 人工审核 |
| 上下文膨胀 | 长篇小说上下文过长 | 智能裁剪 + 分层总结 |
| 质量下降 | 自主生成质量不可控 | 多级检查 + 用户确认 |
| 成本过高 | 频繁 AI 调用成本大 | 本地模型 + 缓存策略 |

---

> **本文件是 AI Novel Studio Agent 能力演进的长期规划。具体实施以各版本任务书为准。**

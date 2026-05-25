# Agent Runtime Overview

> 文件：`.github/workflows-docs/agent-runtime-overview.md`
> 版本：v1.0.44
> 用途：说明 AI Novel Studio 的 Agent Workflow Runtime 最小闭环架构

---

## 1. 什么是 Agent Workflow Runtime？

Agent Workflow Runtime 是 AI Novel Studio 在 v1.0.44 引入的最小可执行工作流系统。

它不是完整的 Autonomous Agent，而是：

```text
读取规则 → 确认任务边界 → 执行修改 → 运行验证 → 检查文档同步 → 输出完成汇报
```

---

## 2. 架构概览

```text
┌──────────────────────────────────────────────┐
│            Agent Workflow Runtime             │
│                                               │
│  ┌─────────────┐  ┌──────────────────┐       │
│  │  Checklists  │  │  Workflow Scripts │       │
│  │ (.github/)   │  │ (scripts/agent-   │       │
│  │              │  │  workflow/)       │       │
│  └──────┬───────┘  └────────┬─────────┘       │
│         │                   │                  │
│  ┌──────┴───────────────────┴─────────┐       │
│  │        Agent Core (src/agent/)      │       │
│  │  types.ts / planner-lite.ts         │       │
│  │  workflow-runner.ts                 │       │
│  └──────┬──────────────────────────────┘       │
│         │                                      │
│  ┌──────┴──────────────────────────────┐       │
│  │    Agent Tools (src/agent-tools/)    │       │
│  │  tool-types / project-tools         │       │
│  │  chapter-tools / verification-tools │       │
│  └──────┬──────────────────────────────┘       │
│         │                                      │
│  ┌──────┴──────────────────────────────┐       │
│  │  Prompt Pipeline (src/prompts/)      │       │
│  │  system / chapter / style            │       │
│  │  / verification                      │       │
│  └─────────────────────────────────────┘       │
└──────────────────────────────────────────────┘
```

---

## 3. 当前阶段（v1.0.44）

本版本建立了最小闭环，各组件状态：

| 组件 | 状态 | 说明 |
|------|------|------|
| Checklists | ✅ 可用 | 4 个执行清单 |
| Workflow Scripts | ✅ 可用 | 4 个 PowerShell 脚本 |
| Agent Types | ✅ 可用 | 最小类型定义 |
| Planner Lite | ✅ 占位 | 返回固定 workflow |
| Workflow Runner | ✅ 可用 | 摘要统计能力 |
| Tool Layer | ⚠️ 占位 | 返回 `not implemented` |
| Prompt Pipeline | ⚠️ 结构 | 目录就绪，函数占位 |

---

## 4. 后续扩展方向

- **v1.0.45**：Tool Layer 接入真实项目读取
- **v1.0.46**：Verification Engine 基础版
- **v1.0.47**：Prompt Pipeline 接入现有正文生成链路
- **v1.1.0**：Agent Workflow 稳定版

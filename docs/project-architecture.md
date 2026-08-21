# AI Novel Studio — 项目架构文档

> 文件：`docs/project-architecture.md`  
> 用途：描述项目整体架构、技术选型理由、系统分层  
> 适用：所有开发者 + AI Agent

---

## 1. 项目概述

AI Novel Studio 是一个面向长篇小说创作的 **Windows 桌面端 AI 工作台**。

它不是：

- 普通码字软件
- 网页后台管理系统
- 一次性生成整本小说的工具

它是：

- AI 长篇小说创作工程系统
- AI Autonomous Creative Platform
- 逐章辅助完成长篇创作的桌面应用

---

## 2. 技术架构

```text
┌─────────────────────────────────────────┐
│              UI 层（React）              │
│  pages/ ← components/ ← common/        │
├─────────────────────────────────────────┤
│         业务逻辑层（features/）          │
│  novels / chapters / characters / ...  │
├─────────────────────────────────────────┤
│          服务层（services/）             │
│  AI / Database / Prompt / Import/Export│
├─────────────────────────────────────────┤
│         数据层（SQLite / Store）         │
│  Repository → SQLite / LocalStorage     │
├─────────────────────────────────────────┤
│       桌面壳（Tauri / Rust）            │
│  窗口管理 / 系统调用 / 文件系统 / 通知   │
└─────────────────────────────────────────┘
```

---

## 3. 技术选型理由

| 技术           | 理由                                                   |
| -------------- | ------------------------------------------------------ |
| **Tauri**      | 轻量级桌面壳（vs Electron），Rust 后端性能好，安装包小 |
| **React 18**   | 组件化 UI，生态成熟，适合复杂交互                      |
| **TypeScript** | 类型安全，长周期项目的可维护性保障                     |
| **Vite 5**     | 快速构建，开发体验好                                   |
| **SQLite**     | 嵌入式数据库，无需额外服务，适合本地桌面应用           |
| **HashRouter** | 桌面端路径稳定，不依赖服务器配置                       |

---

## 4. 数据流

```text
用户操作 → React 组件
    ↓
features/ 业务逻辑处理
    ↓
services/ai/ 调用 AI API（或 Mock）
    ↓
services/database/ 持久化数据
    ↓
store/ 更新全局状态
    ↓
React 组件重新渲染
```

---

## 5. 核心概念

### 5.1 小说工程

```text
Novel（小说作品）
  ├─ WorldSetting（世界背景）
  ├─ RuleSystem（规则体系）
  ├─ Protagonist（主角设定）
  ├─ Volume（分卷）
  │   └─ Chapter（章节）
  │       └─ ChapterDraft（草稿）
  ├─ Character（角色库）
  ├─ ChapterEvent（剧情事件）
  ├─ StyleProfile（风格方案）
  └─ OutputProfile（输出控制方案）
```

### 5.2 AI 创作流程

```text
用户选择：章节 + 角色 + 事件 + 风格 + 输出控制
    ↓
AI 服务层构建 Prompt（结合上下文）
    ↓
调用 AI API 生成正文
    ↓
正文输出到编辑区（草稿状态）
    ↓
用户修改 / 重生成 / 润色 / 检查
    ↓
确认采用 → 总结上下文 → 继续下一章
```

### 5.3 上下文系统

```text
ChapterSummary（章节总结）
    ↓
ContextRecord（上下文记录）
    ↓
后续章节 Prompt 构建时自动注入
```

---

## 6. 路由架构

```text
/                          → Home（作品管理首页）
/novels/:novelId           → NovelDetail（作品详情）
/novels/:novelId/workspace → WritingWorkspace（写作工作台）
/styles                    → StyleProfiles（风格方案管理）
/settings                  → Settings（设置中心）
/coming-soon               → ComingSoon（未开放功能提示）
```

---

## 7. Agent 架构（预留）

```text
┌─────────────────────────────────────────┐
│           Agent OS（未来）              │
│                                         │
│  ┌─────────┐  ┌──────────┐             │
│  │ Planner │  │ Executor │             │
│  └────┬────┘  └────┬─────┘             │
│       │            │                    │
│  ┌────┴────────────┴─────┐             │
│  │    Tool Calling        │             │
│  │  (AI生成/检查/润色等)   │             │
│  └────────┬──────────────┘             │
│           │                             │
│  ┌────────┴──────────────┐             │
│  │   Long-term Memory     │             │
│  │   (上下文/角色/事件)    │             │
│  └───────────────────────┘             │
└─────────────────────────────────────────┘
```

---

## 8. 文件结构总览

```
ai-novel-studio/
├── AGENTS.md                    # Agent 总入口规则
├── CHANGELOG.md                 # 变更日志
├── README.md                    # 项目说明
├── package.json                 # 前端依赖
├── vite.config.ts               # Vite 配置
├── tsconfig.json                # TypeScript 配置
│
├── .github/                     # GitHub Agent 基础设施
│   ├── copilot-instructions.md
│   ├── instructions/            # 分领域开发指令
│   ├── prompts/                 # 版本开发 Prompt 模板
│   └── skills/                  # Agent Skills
│
├── .cursor/rules/               # Cursor IDE 规则
│
├── docs/                        # 项目文档
│   ├── product-design.md
│   ├── ui-reference.md
│   ├── data-model.md
│   ├── development-rules.md
│   ├── version-roadmap.md
│   ├── module-boundaries.md
│   ├── project-architecture.md
│   ├── agent-workflow.md
│   └── ai-agent-roadmap.md
│
├── prompts/                     # AI 提示词模板
│   ├── chapter_generate.md
│   ├── chapter_polish.md
│   └── ...
│
├── src/                         # 前端源代码
│   ├── pages/
│   ├── components/
│   ├── features/
│   ├── services/
│   ├── store/
│   ├── styles/
│   └── types/
│
├── src-tauri/                   # Tauri Rust 后端
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   └── src/
│
└── public/                      # 静态资源
```

---

## 12. v2.3.0 执行事实层扩展

Rust 后端新增三组明确边界：

```text
domain/       状态枚举、合法状态边、Task / Artifact 类型白名单
repositories/ 参数化 SQLite 读写与 CAS，不包含 UI 或 Provider 调用
services/     canonical hash、归属验证、事务、重放、校验与脱敏
commands/     受控 Tauri IPC，仅负责锁定连接和映射稳定 AppError
```

前端只新增 `types/ai-task.ts`、`types/result-artifact.ts` 与 `services/ai-tasks/aiTaskRuntimeService.ts` 薄 facade。M1 不修改任何现有 AI 面板或生产 Provider 入口，不引入浏览器 LocalStorage 假持久化。

完整设计见 [`architecture/ai-execution-facts.md`](architecture/ai-execution-facts.md)。

---

## 13. v2.3.1 Provider 执行管线

首批生产入口使用同一前端服务层编排：

```text
业务入口
→ executeAiTask
→ Task + 三 Snapshot
→ queue / claim Attempt
→ ProviderAdapter（Mock 或现有 Tauri HTTP）
→ response hash / length / metadata
→ ResultArtifact + ValidationIssue
→ 只读候选返回 UI
```

API Key 与 Base URL 只传给 Adapter，不进入事实层。桌面端使用 SQLite 事实；浏览器开发模式只返回明确的 ephemeral 结果。设置候选与正式设定写入仍由独立用户确认动作隔离。

完整设计见 [`architecture/provider-execution-pipeline.md`](architecture/provider-execution-pipeline.md)。

---

## 14. v2.3.2 Safe Apply

设定候选从只读 Artifact 进入受控业务写入：

```text
setting_candidates Artifact
→ PlacementProposal（候选与目标前置条件）
→ ApplyPlan（单个 create world_setting effect）
→ 用户显式确认
→ SQLite 单事务：world_setting + ArtifactTargetLink + Plan applied
```

Proposal 与 Plan 内容由 canonical SHA-256 绑定且不可原地修改。目标不存在以 version 0/hash 表示；应用后链接保存 version 1/hash。相同 operationId 可安全重放，碰撞和已应用目标漂移失败关闭。浏览器回退不伪造持久应用事实。

完整设计见 [`architecture/safe-apply.md`](architecture/safe-apply.md)。

---

## 15. v2.4.0 Context / Constraint Compiler 与 Tool Registry

首批生产入口改为从来源事实编译执行契约：

```text
SQLite / request 来源
→ Context Compiler（manifest + budget + compiled context）
→ Constraint Compiler（template + constraints + provider + tool policy）
→ compiled_ai_execution_v1（Provider messages + request/compilation hash）
→ Rust 创建 Task 前权威复算
→ schema v2 Input / Context / Constraint Snapshot
```

Context 使用固定 `utf8_bytes_div3_v1` 估算器、稳定代码点顺序和确定性截断。Constraint 将预期 Artifact、response schema、Prompt hash、Provider identity 与 `tool_registry_v1` hash 冻结。连接测试与设定补充的模板正文独立保存在 `prompts/`，Context 不再混入模板 Snapshot。

Tool Registry 当前注册八个真实只读/本地验证工具。每个工具具有版本、input/output schema、权限、novel/chapter/draft scope、超时、sideEffect 与 confirmation policy；生产 Provider 策略本版仍为 `allowedTools=[]`。Rust 冻结当前 Registry hash 并拒绝通过改写 Artifact 契约绕过正式编译。

完整设计见 [`architecture/context-constraint-tool-registry.md`](architecture/context-constraint-tool-registry.md)。

---

## Autonomous creation governance

Autonomous creation and the main chapter-generation path now use the shared execution compiler for seven governed task types. The planning/apply boundary also captures a persisted baseline and performs a compare-and-swap check before continuation plans are written, so existing volumes and chapters are never silently overwritten. The scope, compatibility boundary, and continuation protocol are documented in [`project/ai-generation-governance.md`](project/ai-generation-governance.md).

---

## 16. v2.5.0 Chapter Readiness Planner Runtime

v2.5.0 在 Compiler / Registry 之上增加第一个正式持久 Planner：

```text
Writing Workspace
  → TypeScript Planner Executor（只按持久 DAG 调度）
  → Rust Plan State Machine + execution lease
  → production Tool Registry（六个只读步骤）
  → SQLite Plan / Step / Attempt / Lease / Checkpoint
```

Rust 构造并冻结 `chapter_readiness_plan_v1`，前端不能提交任意计划；Executor 每次 claim 前复验 Registry、schema、权限、scope、参数 hash 和依赖。应用重启时 running Attempt 被标记 `abandoned`，Plan/Step 进入 `waiting_retry`，不自动重放 Tool。浏览器模式不伪造持久计划。

完整设计见 [`architecture/chapter-readiness-planner-runtime.md`](architecture/chapter-readiness-planner-runtime.md)。

---

## 17. v3.0.0 Scheduler 启动与生产分包治理

跨进程 Autonomous Scheduler 的持久事实继续由 Rust / SQLite 管理，前端执行 Worker 的启动所有权固定在应用入口：

```text
main.tsx
→ 安装全局错误处理
→ autonomousSchedulerWorker.recoverStartup()（进程内幂等）
→ Rust 收敛中断 run / lease / attempt
→ 仅 attach 后端确认 queued / running 的 run
```

规划页 Hook 只订阅和刷新当前计划，不负责进程启动恢复。Rust 初始化会先收敛过期 lease 与中断 run；恢复命令随后仍返回全部持久 `queued` run，确保 WebView 入口可以为它们获取新 owner/epoch，而不会因初始化阶段已执行过同一恢复事务而丢失接管列表。桌面 Worker 还以 15 秒间隔串行执行恢复扫描：若应用在旧 lease 的 TTL 内重启，旧 lease 到期后的下一轮扫描会完成 fenced recovery 和新 epoch 接管。Worker 已取得 lease 后若在 claim 前遇到计划读取或其他未处理异常，会先 heartbeat 复验 owner/epoch，再以最新 revision 暂停 run；pause 事务同时释放 active lease。heartbeat 或 CAS 失败表示 Worker 已被 fencing，此时不触碰替代 owner 的状态。浏览器 capability 返回非持久模式时，启动调用直接结束，不创建伪造 run。章节生成运行时通过 `autonomousChapterRuntimeLoader` 延迟加载；AI 设置的读取/规范化/保存位于不依赖执行管线的 `aiSettingsStore`，价格快照因此不形成 `aiTaskService → aiSettingsService → aiExecutionPipeline` 循环。

Vite 生产输出固定拆分 `vendor-react / vendor-router / vendor-zustand / vendor-tauri`，并生成 manifest。`scripts/quality/check-bundle-size.mjs` 从 manifest 确认唯一入口、全部 JS 归属和 vendor 身份，再按真实字节与 gzip-9 执行入口和单 chunk 双预算；缺文件、额外 JS、路径逃逸或身份歧义均失败关闭。快速 CI、Windows 桌面质量工作流和签名发布共享该门禁，`release.yml` 必须等待可复用的完整 Windows 桌面 E2E 成功后才进入签名构建。

---

## 18. migration 029 全局 AI 请求治理

桌面端真实 Provider 在网络派发前先经过 `aiRequestPolicyService → Tauri IPC → SQLite`。单例策略、滚动分钟窗口、跨进程 active reservation 与每日 Token/成本聚合均由 Rust `IMMEDIATE` 事务裁决；snapshot 不隐式创建策略，设置页把首次观察的 revision 固定为 CAS 基线。输入预留采用 UTF-8 字节上界与 chat envelope，WebView 只持有 owner 与原始 lease proof。Rust `ai_chat_completion(_stream)` 再复验 request-bound proof 并原子标记单次派发，直接 IPC 不能绕过预算门禁。

完成、失败、取消和 TTL 回收都进入同一幂等结算协议。缺失 usage 与中断 owner 使用预留上限保守计量，实际 usage 高于预留时仍全量入账；派发与终态计量字段由 trigger 冻结。冻结价格来自 SQLite 策略，未定价成本保持显式未知。浏览器开发模式继续使用 LocalStorage ledger，并对失败/过期执行同样的保守计量；桌面 IPC 失败时不会降级到该回退。

完整协议见 [`project/ai-generation-governance.md`](project/ai-generation-governance.md)。

---

## 19. v3.3.0+ 对话式并发创作工作台目标架构（首阶段已实现）

v3.3.0 及后续版本计划增加面向小说任务的对话控制面，不替换现有领域事实层：

```text
Workbench Shell
  ├─ 小说项目 / 任务树
  └─ 对话、工具事件、错误、产物卡片
        ↓
Task Conversation Service
  ├─ 消息 / 回合
  ├─ 任务级模型快照
  └─ 持久状态投影
        ↓
Task Runtime / Worker Pool
  ├─ Planner
  ├─ Plugin / Capability Registry
  │  ├─ 功能插件 / Tool Registry
  │  ├─ 模型插件 / Provider Pipeline
  │  └─ 上下文与其他 Runtime Provider
  └─ 取消 / 恢复 / 全局请求治理
        ↓ ANS DSH Adapter
DSH Headless Worker（固定源码基线）
  ├─ Session / Agent Loop
  ├─ Tool Pipeline / Scheduler
  ├─ Model Provider / Compaction
  └─ Plugin Graph
        ↓
Artifact + Decision Bridge
  ├─ ResultArtifact
  ├─ 验证 / 基线 / 用户决定
  └─ Review Authorization / Safe Apply
        ↓
Novel Domain Services + SQLite
```

架构边界：

- 工作台是 UI 聚合层，小说仍是领域数据最高级对象；
- 任务对话之间隔离消息、模型、运行、取消与产物，允许受治理并发；
- 工具调用和错误作为持久执行事实投影到对话，不建立第二套真相源；
- 普通回复不写正式事实，只有不可变产物经过用户决定和领域事务后才可应用；
- 章节候选还需要单次审阅授权，在人工审阅/编辑器中显式采用；
- DSH 可承担 Planner/Executor/Worker 职责，但 SQLite、预算门禁、验证与最终采用权继续留在 ANS；
- Runtime 借鉴 DSH 的 Profile/Bundle 组合、作用域 Session/Agent、`turn → step → tool result → next step` 循环和追加事件投影，但不复制通用代码、Shell、Git 等能力；
- 固定版本 DSH 作为 Headless Worker，ANS DSH Adapter 隔离其内部 API；不完整 Fork Harness，不嵌入 Harness Web UI，不把 DSH Session Log 当作小说事实源；
- 能力采用“稳定定义 → 可替换 Provider → Runtime 消费”边界，小说上下文压缩等实现可以替换而不改写工作台和 Safe Apply；
- “当前插件”页面只是 Plugin/Capability Registry 的只读投影，按功能、模型和其他插件显示名称、版本、状态与能力，不提供插件管理；
- 原写作工作台在功能等价迁移后收敛为人工审阅/编辑器，底层服务不随 UI 一起删除。

当前实施分支已将 `/` 指向创作工作台，并将旧作品管理保留为 `/novels` 回退入口；旧章节写作工作台和功能入口继续保留。完整设计与后续收敛边界见 [`architecture/conversational-creative-workbench.md`](architecture/conversational-creative-workbench.md)。

---

> **本文件是 AI Novel Studio 项目架构的概要描述。详细模块边界见 `docs/module-boundaries.md`。**

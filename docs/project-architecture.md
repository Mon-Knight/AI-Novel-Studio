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

| 技术 | 理由 |
|------|------|
| **Tauri** | 轻量级桌面壳（vs Electron），Rust 后端性能好，安装包小 |
| **React 18** | 组件化 UI，生态成熟，适合复杂交互 |
| **TypeScript** | 类型安全，长周期项目的可维护性保障 |
| **Vite 5** | 快速构建，开发体验好 |
| **SQLite** | 嵌入式数据库，无需额外服务，适合本地桌面应用 |
| **HashRouter** | 桌面端路径稳定，不依赖服务器配置 |

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

> **本文件是 AI Novel Studio 项目架构的概要描述。详细模块边界见 `docs/module-boundaries.md`。**

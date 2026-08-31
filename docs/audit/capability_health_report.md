# AI Novel Studio 功能实际可用性审计报告 (Capability Health Report)

> **审计基准**：严格遵循「禁止猜测、代码与动态测试双重交叉核验」原则。  
> **审计结论概要**：软件核心数据层（SQLite 36 项 Migration、大文本引擎、原子保存、记忆检索、作业状态机、治理策略）**极其坚固（88 项 WORKING）**；但存在 **5 项双轨重复原型（PARTIAL）**、**1 项早期孤立废弃代码（BROKEN）** 及 **1 项路由占位（SHELL）**。最核心的断层在于：**对话工作台中的 `generate_chapter` 实际上是结构校验槽而非生成器，导致主路径用户意图与底层调度存在严重语义错位**。

---

## 一、可用性分类总览

```text
┌──────────────────────────────────────────────────────────────┐
│                    全量 96 项能力健康状态分布                   │
├──────────────────────────────┬───────────────────────────────┤
│ WORKING   (完全验证可用)      │  88 项 (91.7%)  ■■■■■■■■■■■■■ │
│ PARTIAL   (部分链路/双轨原型) │   6 项 (6.2%)   ■               │
│ BROKEN    (完全断链/孤立废弃) │   1 项 (1.0%)   ▫               │
│ SHELL     (纯 UI 占位壳子)    │   1 项 (1.0%)   ▫               │
│ UNKNOWN   (无法判定)          │   0 项 (0.0%)   -               │
└──────────────────────────────┴───────────────────────────────┘
```

---

## 二、各模块深入健康评估

### 1. 项目、卷章与正文保存链路 (评分: 9.8 / 10 - WORKING)

- **UI 操作真实性**：HomePage、NovelDetailPage、WritingWorkspace 编辑器所有新建、重命名、删除、字数统计均实时响应。
- **数据持久化验证**：
  - 正文保存走 `save_chapter_draft_atomic`，采用 SHA-256 CAS 校验（`DOCUMENT_HASH_MISMATCH` 阻断并发写冲突）。
  - 超长文本自动通过 `large_text_documents` / `large_text_chunks` 进行分片哈希校验与流式存取，断电/重启后 100% 完整。
  - 草稿采用（`adopt_chapter_draft`）严格绑定章节，并在数据库事务中自动使关联旧记忆向量失效。
- **失败点与防护**：若底层大文本分片被篡改，`read_large_text_content` 立即 `fail-closed` 拒绝静默损坏。

### 2. 创作工作台 (Workbench) 与 DSH 任务调度 (评分: 6.5 / 10 - PARTIAL / DESIGN MISMATCH)

- **当前运行状态**：
  - 任务会话（`task_conversations`）、消息轮次（`conversation_turns`）、任务运行（`task_runs`）、工具调用事件（`tool_call_events`）均可靠持久化在 SQLite 中（Migration 032-035）。
  - 产物卡片（`conversation_artifact_cards`）采用 Migration 036 的决策与审阅授权流（`issue_review_authorization`），审阅通过后可跳写作工作台或结构化应用（`artifactApply.ts`）。
- **重大设计断层与根因分析**：
  - ⚠️ **`generate_chapter` 并非正文生成器**：在 `productionToolRegistry.ts` 及 Rust Gateway 中，`generate_chapter` 的真实定义是「接收并验证模型已经生成好的 `candidateText`」。当模型理解为「执行写正文」而发出空调用或简单参数时，立即报错 `candidateText must be a non-empty string`。
  - ⚠️ **章节绑定静默降级**：工作台输入区没有章节切换器，`chapterId` 隐式继承自作品第一章；如果未选章节，模型调用写章工具直接因缺少必填项而中断。

### 3. 写作工作台与传统生成管线 (评分: 9.0 / 10 - WORKING)

- **当前运行状态**：
  - `ChapterEngineeringPanel`（分镜卡、Beat 序列、生成约束、质量规则）与 `AiGeneratePanel` 拥有完整的步骤状态机（`generationJobService`）和分段流式生成（`chapterProseOrchestrator`）。
  - 生成完成后直接触发 `qualityGateRunner`（要求分数 >= 80 且无 Critical/High 问题），若未通过则调用 `qualityFixService` 进行范围闭环修复。
- **与工作台的关系**：这套成熟的高质量生成链路目前只挂在 `WritingWorkspacePage` 的右侧抽屉，**尚未暴露给 Workbench 作为 Tool / SubAgent**。

### 4. 质量审查、润色与闭环修复 (评分: 9.5 / 10 - WORKING)

- **当前运行状态**：
  - `qualityCheckService` 针对正文执行多维度规则与 AI 质检，生成不可变的 `quality_check_reports` 与 `quality_check_items`。
  - `qualityFixService` 实现了基于局部特征文本的模糊匹配消歧与区间替换算法（`qualityFixRangeApplication.ts`），杜绝了「AI 修复导致全文字数坍塌或格式崩坏」的风险。
  - 润色（`polishService`）支持流畅、描写、对白等 5 种模式。

### 5. 记忆系统与知识沉淀 (评分: 8.5 / 10 - WORKING / DUAL TRACK)

- **当前运行状态**：
  - **SQLite 生产轨 (`memoryService.ts` / Migration 026)**：支持 FTS5 全文搜索、多维向量余弦距离计算、Token 预算动态截断、草稿采用联动失效。全部通过 Rust 原生集成测试。
  - **内存测试轨 (`novelMemoryManager.ts`)**：提供基于内存 Map 的状态快照与 Delta 演进（用于 `CreativeAgentHarness` 原型测试）。
- **问题**：两套 Memory 体系未完成物理合并，前者是持久化的生产底座，后者是原型工具。

### 6. 创作资产与跨章事务 (评分: 9.2 / 10 - WORKING)

- **当前运行状态**：
  - `StoryAssetsPage` 支持势力（`story_factions`）、地点（`story_locations`）及层级关系的维护。
  - 跨章批量修改支持 CAS 多目标事务（`contentTransactionService` / Migration 028），具备 All-or-Nothing 的原子提交与回滚能力。

### 7. 辅助模块与离线能力 (评分: 5.0 / 10 - PARTIAL / ISOLATED)

- **模板中心 (`TemplatesPage`)**：
  - ❌ **严重脱节**：所有用户模板保存在 `localStorage`，未入 SQLite；且 `prompts/` 下的真实提示词模板由 `promptTemplateRegistry.ts` 独立管理，模板中心无法被 AI 引用。
- **创作资产门户 (`AssetsPage`)**：
  - 只是统计聚合展示板，点击卡片跳转到对应独立页面。
- **施工中页面 (`ComingSoonPage`)**：
  - 纯 UI 占位路由，已无主动导航链接指向。

---

## 三、双轨与重复实现明细

| 领域                 | 轨道 A (生产/持久化)                                                   | 轨道 B (内存/早期原型)                                                | 现状与建议                                                                                                                     |
| :------------------- | :--------------------------------------------------------------------- | :-------------------------------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------- |
| **Agent 对话与调度** | `taskConversationService` + `WorkbenchPage` (SQLite Migration 032-036) | `CreativeAgentHarness` + `AgentChatWorkspace` (`src/services/agent/`) | 生产轨具备完善卡片与审阅流；测试轨具备优秀 Observe-Plan-Act 闭环思想。后续将轨道 B 的调度能力下沉为轨道 A 的 SubAgent 执行核。 |
| **工具注册表**       | `productionToolRegistry.ts` (`src/services/agent-tools/`)              | `AgentToolRegistry.ts` (`src/services/agent/`)                        | 生产轨定义了 15 个确定性校验/检索/候选槽；测试轨定义了 10 个直接调用业务的工具。后续统一合并入 Tool Registry。                 |
| **记忆与世界状态**   | `memoryService.ts` (SQLite FTS5 + 向量检索)                            | `novelMemoryManager.ts` (内存 Map + 动态状态)                         | 统一以 SQLite `memoryService` 和 `character_states` / `context_records` 为准。                                                 |
| **产物应用协议**     | `artifactApply.ts` + `artifactDecisionService` (Migration 036)         | `placementRuntimeService.ts` (Migration 012-014)                      | Migration 036 是推荐标准，v2.0 Placement 仅作为单实体历史兼容。                                                                |
| **提示词系统**       | `promptBuilder.ts` (代码化装配管线)                                    | `promptTemplateRegistry.ts` (Markdown 模板加载) + `prompts/*.md`      | `promptBuilder` 负责生产调度，`prompts/*.md` 负责模板沉淀。                                                                    |

---

## 四、断链与 UI 假象排查

1. **`src/agent/planner-lite.ts` (完全断链)**
   - 代码行数：154 行。
   - 内部包含 `createChapterGenerationWorkflow` 和 `createChapterReadinessWorkflow`。
   - **排查结果**：全工程 0 处 import，属于 1.0 时代残留的 Mock 任务图生成器。
2. **`TemplatesPage.tsx` (假象存储)**
   - 用户在页面上新建/修改模板，提示「保存成功」，但实际写入的是 `localStorage['ai_novel_studio_user_templates']`。
   - 在 Tauri 桌面多窗口或清除缓存时存在丢失风险，且生成的正文根本不调用此处模板。
3. **`AgentChatWorkspace.tsx` (无路由入口)**
   - 包含完整的用户输入、CurrentThinking 思考展开、工具流展示和确认交互，但未在 `App.tsx` 注册路由，仅存在于单元测试中。

---

## 五、直接阻塞第一阶段 Agent Harness 的关键问题

在进入下一步 Agent 工具化改造前，必须警惕以下关键阻塞点：

1. **工具契约理解偏差**：现存 `generate_chapter` 只是一个校验参数的槽位，它**不能直接拿来当做生成工具**。Main Agent 如果需要写正文，必须调用真正的 `chapterProseOrchestrator` 或委托给 `Writing SubAgent`。
2. **上下文装配与章节 ID 丢失**：Workbench 发送任务时若未显式携带当前有效 `chapterId`，会导致正文读取、大纲检索、角色绑定全链路失效。
3. **模型输入 Token 爆炸**：若未经过 `generationContextCompiler` 的 Token 预算裁剪与 FTS5 过滤，直接把整书设定塞入 Prompt，会导致小模型报错或截断。
4. **正文覆写的安全确认**：模型生成的候选章节正文**绝对不能直接覆盖数据库当前草稿**，必须经过 `publish_structured_candidate` 签发 Artifact 卡片，由人工点击「确认采纳」后调用 `draftVersionService.adoptDraft()` 落地。

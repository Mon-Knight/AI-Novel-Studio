# AI Novel Studio Agent Tool / SubAgent 映射规划 (Agent Capability Mapping)

> **规划目标**：基于全量审计结果，将经过验证的 `WORKING` 软件能力精确分类，划定确定性 Tool 与智能 SubAgent 的边界，建立第一版可靠的 Agent 工具注册体系。

---

## 一、能力分类总览 (7 类划分)

```text
┌────────────────────────────────────────────────────────────────────────┐
│                   AI Novel Studio 能力分类体系 (96 项)                  │
├────────────────────────────────────────────────────────────────────────┤
│ A. 确定性普通 Tool 候选 (Deterministic Tools)      ── 32 项 (无幻觉写/读) │
│ B. 智能 SubAgent 候选 (LLM Involved SubAgents)     ── 16 项 (生成/评审)   │
│ C. 纯 UI 交互能力 (Pure UI Capabilities)           ── 14 项 (弹窗/高亮)   │
│ D. 系统基础设施与存储 (System Foundations)         ── 26 项 (SQLite/加密) │
│ E. 重复与并轨过渡能力 (Duplicated / Superseded)    ──  5 项 (双轨原型)    │
│ F. 断链与仅局部能力 (Broken / Partial)             ──  2 项 (LS/孤立)     │
│ G. 占位能力 (Shell)                                ──  1 项 (施工中)      │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 二、详细能力分类明细

### Category A: 确定性普通 Tool 候选 (Deterministic Software Tools)

_特征：输入输出明确，不经过 LLM 幻觉直接执行确定性查询、格式校验、状态机转换或原子写库。_

1. `search_memory` (CAP-MEM-009) - 在长期记忆中执行 FTS5 + 向量检索已采用事实。
2. `read_novel_summary` (CAP-NOV-003) - 读取作品设定、世界背景、规则体系与主角信息。
3. `read_chapter_context` (CAP-CHAP-007) - 读取章节大纲、上一章已采用正文及本章出场人物。
4. `read_outline_hierarchy` (CAP-OUT-004) - 读取作品总大纲、分卷大纲与当前章节大纲。
5. `read_style_profile` (CAP-STY-001) - 读取当前激活的文风配置与字数/节奏控制参数。
6. `check_chapter_readiness` (CAP-WKB-005) - 确定性检查章节生成前置要素（大纲/角色/设定）是否完备。
7. `verify_outline_compliance` (CAP-OUT-003) - 检查候选正文与大纲关键事件的覆盖度。
8. `verify_style_compliance` (CAP-STY-004) - 检查候选正文的对白比例、段落长度与禁忌词。
9. `list_characters` (CAP-MEM-004) - 查询当前作品角色库列表及其当前动态心境与伤势。
10. `get_character_state` (CAP-MEM-004) - 查询指定角色的当前位置、目标与关系。
11. `list_chapter_events` (CAP-MEM-006) - 查询当前章节规划的候选与已执行事件。
12. `list_factions_and_locations` (CAP-AST-001, CAP-AST-002) - 查询当前作品已确认的势力组织与地理架构。
13. `save_draft_candidate` (CAP-CHAP-009) - 将生成的正文以候选草稿形式写入草稿库（非正式采纳）。
14. `publish_artifact_card` (CAP-WKB-003) - 向 Workbench 对话流签发结构化产物卡片。
15. `apply_artifact_candidate` (CAP-WKB-004) - 在用户确认后，将候选数据正式提交至领域服务。
16. `update_character_state` (CAP-MEM-004) - 更新指定角色在某章节后的心境/目标/伤势变化。
17. `bind_chapter_characters` (CAP-MEM-005) - 确定性登记本章登场角色及强制出场要求。
18. `mark_event_status` (CAP-MEM-006) - 将剧情事件标记为已发生/已解决。
19. `invalidate_memory` (CAP-MEM-009) - 草稿发生重大修订时使关联旧记忆向量失效。
20. `compress_context_records` (CAP-MEM-010) - 对前文冗余上下文记录执行摘要收敛与归档。
21. `get_ai_budget_status` (CAP-SYS-003) - 查询今日 Token 消耗与并发配额状态。
22. `inspect_duplicate_assets` (CAP-REF-002) - 导入资料前检查哈希重复度。

---

### Category B: 智能 SubAgent 候选 (LLM-Involved SubAgents)

_特征：需要模型深度参与创作、推理、多轮改写、多维度裁判或专家会审，具备内部自愈与反思循环。_

| SubAgent 标识               | 名称与职责                                                                              | 底层支撑能力 / 复用代码                                                                                        | 输入                                | 输出                                           |
| :-------------------------- | :-------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------- | :---------------------------------- | :--------------------------------------------- |
| **Writing SubAgent**        | **章节正文创作专家**<br>根据上下文装配、分镜 Beat、风格画像分段执行正文生成与流式装配   | `chapterProseOrchestrator.ts`<br>`chapterSceneGenerationExecutionService.ts`<br>`generationContextCompiler.ts` | 章节ID、分镜Beats、风格ID、记忆切片 | 章节候选正文 (`candidateText`)、Token 消耗统计 |
| **ScenePlanning SubAgent**  | **分镜与节奏编排专家**<br>将章节总大纲与核心冲突拆解为可执行的 Scene 列表与 Beat 序列   | `chapterScenePlanService.ts`<br>`chapterScenePlanPolicy.ts`                                                    | 章节目标、人物设定、前文钩子        | 结构化 ScenePlan (包含 3~5 个 Beat)            |
| **QualityJudge SubAgent**   | **质量把关与合规裁判**<br>执行错别字、大纲偏离、战力崩坏、人物 OOC 审查并给出评分       | `chapterQualityGateService.ts`<br>`qualityCheckAiService.ts`<br>`AgentQualityJudge.ts`                         | 候选正文、大纲约束、人物性格        | 质量报告 (Score 0-100, Issues 列表)            |
| **QualityFix SubAgent**     | **正文精准闭环修复专家**<br>针对质量裁判提出的具体问题，进行局部消歧与安全区间替换      | `qualityFixService.ts`<br>`qualityFixRangeApplication.ts`                                                      | 待修复正文、问题定位与修改建议      | 修复后正文 (含变更区间审计日志)                |
| **Summarize SubAgent**      | **章节总结与伏笔提炼专家**<br>提炼已采用正文的事件摘要、人物变化、伏笔埋设与回收        | `chapterSummarizeService.ts`<br>`volumeSummaryService.ts`                                                      | 已采用草稿正文、前文摘要            | 结构化 ChapterSummary、状态增量 Delta          |
| **MultiAgent Review Panel** | **多专家委员会评审团**<br>剧情、人物、文风、世界观 4 位专家并行审阅并计算 Quorum 共识   | `multiAgentService.ts`<br>`multiAgentRuntime.ts`<br>`expertRegistry.ts`                                        | 候选正文、专家阵容、评审轮次        | 评审共识决议 (Accept / Revise / Regenerate)    |
| **OutlinePlanner SubAgent** | **长篇大纲推演架构师**<br>推演百万字多卷主线结构、卷冲突及章节递进节拍                  | `autonomousStoryService.ts`<br>`outlineGenerateService.ts`                                                     | 题材、主角金手指、核心悬念          | 全书分卷分章故事大纲方案                       |
| **StyleExtractor SubAgent** | **文风画像逆向分析专家**<br>从参考书或样本文本中逆向提炼叙事视角、描写/对白比、节奏特征 | `styleAnalyzeService.ts`<br>`layeredStyleAnalyzer.ts`                                                          | 参考文本切片                        | 结构化 StyleProfile (含风格参数)               |

---

### Category C: 纯 UI 交互能力 (Pure UI Capabilities)

1. `useEditorLocateTarget` (CAP-QLT-003) - 质量问题在正文编辑器中的光标高亮定位。
2. `VolumeTree` 拖拽与树展开折叠交互。
3. `RightToolbar` 侧边栏工具切换与动画状态。
4. `GlobalAiTaskModal` / `LoadingModal` 全局操作进度弹窗。
5. `StartupRecoveryDialog` 启动崩溃恢复弹窗。
6. `ThemeRuntime` Windows 系统主题色实时同步。
7. `AssetsPage` 统计看板卡片路由跳转。
8. `MarkdownView` / `E2eDialogHost` 调试与展示组件。

---

### Category D: 系统基础设施与底层存储 (System Foundations)

1. `SQLite 36 项 Migration` 与 Ledger 校验 (Rust `migrations.rs`).
2. `large_text_save` (分片哈希校验、流式写入与完整性防篡改).
3. `draft_service` (CAS `save_chapter_draft_atomic` 事务保证).
4. `ai_request_policy` (全局并发、Token 配额与每日成本预留/结算).
5. `localChapterModelHealthService` (Ollama/vLLM Loopback 端口健康探测).
6. `projectBackupService` (全书项目 SQLite + 大文本无损打包与全量恢复).
7. `nativeCrashReportService` (原生崩溃拦截与敏感信息脱敏).
8. `window_state` (单实例锁与窗口尺寸记忆).

---

### Category E & F: 重复、降级与断链能力处理建议

| 标识            | 能力项                                    | 现状分析                                        | 建议处置策略 (后续阶段)                              |
| :-------------- | :---------------------------------------- | :---------------------------------------------- | :--------------------------------------------------- |
| **CAP-LEG-001** | `TemplatesPage` (仅 LocalStorage)         | 模板数据保存在浏览器缓存中，未入库也未连 AI     | 保持现状，未来迁入 SQLite 或作为用户提示词库         |
| **CAP-LEG-004** | `planner-lite.ts` (早期孤立文件)          | 全工程 0 引用，包含写死 mock 任务               | 确认无用，后续重构时清理                             |
| **CAP-LEG-005** | `CreativeAgentHarness` (内存级原型)       | 调度思想优秀但未入主路由，内存状态重启丢失      | 将其 Observe-Plan-Act 闭环调度提取为 SubAgent 执行核 |
| **CAP-LEG-006** | `placement_proposals_v1` (v2.0 Placement) | 单实体提议协议，已被 Migration 036 产物卡片替代 | 维持只读降级兼容，新增统一走 Migration 036           |
| **CAP-LEG-008** | `novelMemoryManager.ts` (内存记忆管理器)  | 内存测试 Map，与 SQLite `memoryService` 并存    | 统一将检索请求桥接到底层 SQLite `memoryService`      |

---

## 三、第一阶段最少能力闭环集合 (Phase 1 Minimal Tool Set)

为跑通 `Workbench 对话 → Main Agent 决策 → Writing SubAgent 生产 → 产物卡片返回 → 用户确认采纳 → 正文原子落盘` 的黄金创作链路，第一阶段仅需以下 **7 项最核心能力**：

```text
┌────────────────────────────────────────────────────────────────────────┐
│               第一阶段 Agent Harness 最少必要能力集合 (7 项)              │
├────────────────────────────────────────────────────────────────────────┤
│ 1. [Tool] read_chapter_context        ── 读取章节设定、上一章正文与出场角色 │
│ 2. [Tool] search_memory               ── 检索相关世界观与长期设定事实     │
│ 3. [SubAgent] ScenePlanning SubAgent  ── 将大纲分解为 3~5 个 Beat 节奏     │
│ 4. [SubAgent] Writing SubAgent        ── 执行分段流式正文生成与风格注入    │
│ 5. [SubAgent] QualityGate & Fix       ── 自动质检 (Score>=80) 与区间微调   │
│ 6. [Tool] publish_candidate_artifact  ── 向 Workbench 会话签发产物卡片   │
│ 7. [Tool] adopt_chapter_draft         ── 用户确认后触发 CAS 正文落盘与记忆失效│
└────────────────────────────────────────────────────────────────────────┘
```

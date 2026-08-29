# AI Novel Studio 第二次全量能力审计：Capability Health

> 历史与当前口径：本文主体保留 2026-08-24 第二次全量审计快照；其中的能力数量、入口和阶段判断不得直接改写为 2026-08-27 的当前事实。v3.6.0 发布候选校正如下，候选状态不代表已经发布。

## 0. v3.6.0 发布候选校正

- 生产写作工作台的旧生成类 AI 面板、独立实验面板和草稿历史入口已经移除；底层草稿表、历史草稿、领域服务与 E2E-only 组件仍可作为审计/回归事实存在。因此第 5.4 节与问答中“隐藏面板”“草稿历史可用”只描述审计当日代码或测试证据，不能解释为当前生产入口。
- 章节候选已经具备 `ReviewAuthorization + adopt_review_authorized_draft` 的单一 Rust/SQLite 原子采用链路；通用结构化 `request_apply` 仍失败关闭且不产生领域写入。
- Canonical 1A-A/B/C/D 已完成，但四个只读 identity 仍为 `catalog_only + partial`，模型可见数为 `0`。必须先关闭四项 Facade blocker，再完成独立 exposure；之后才进入 R4 真实 Main Agent Runtime 验证。
- 本校正不重算 2026-08-24 的 21/37/3/11/3 健康数量，也不授权 exposure、R4、SubAgent、新版本或发布。

## 1. 结论先行

本次审计没有把“代码存在”“命令已注册”或“单元测试通过”直接当成用户可用。按 [capability_inventory.md](./capability_inventory.md) 的 75 个能力族计数：

| 状态      | 数量 | 当前含义                                                           |
| --------- | ---: | ------------------------------------------------------------------ |
| `WORKING` |   21 | 有生产消费者和当前环境动态证据                                     |
| `PARTIAL` |   37 | 链路部分可用，但有 Mock/fallback、未验证分支、外部依赖或覆盖面风险 |
| `BROKEN`  |    3 | 生产入口行为明确错误/误导                                          |
| `LEGACY`  |   11 | 旧、隐藏、E2E-only 或无生产消费者                                  |
| `UNKNOWN` |    3 | 证据不足，不能开放                                                 |

严格意义上可交付给普通用户的能力是 **21 个 WORKING 能力族**；**37 个 PARTIAL** 只能在明确限制下使用。当前不应继续扩展 Agent Tool 面，应该先修复 3 个 `BROKEN` 并清理/隔离 11 个 `LEGACY`。

## 2. 健康判定方法

每个能力按四层证据交叉核对：

1. 用户入口或生产消费者是否存在。
2. TypeScript Hook/Service 是否真正被该入口调用。
3. Tauri command → Rust service/repository → SQLite 是否闭合，或 AI → model/DSH 是否闭合。
4. 当前环境是否有动态证据，且动态证据是否使用真实 SQLite/IPC，而非纯 Mock。

动态证据只证明它实际跑过的边界。例如 `agent-production-closed-loop` 证明了 SQLite、Artifact、审阅授权、CAS 采用和重启恢复；它不证明外部模型质量，也不证明 LLM 自主选 Tool。

## 3. 按领域的健康摘要

| 领域                 | 相关能力                 | 健康判断                                                          | 主要证据/问题                                                                                                                                  |
| -------------------- | ------------------------ | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| 作品、卷章、草稿     | PRJ-01、PRJ-07～16       | 核心保存/采用链健康；入口级 CRUD 多为 PARTIAL                     | 五轮 Windows E2E 实际创建章节、生成候选、保存、采用并重启读取；大文本/CAS/恢复有 SQLite 套件。删除语义另见 BROKEN。                            |
| 设定、角色、事件     | PRJ-03～06、PRJ-21       | 作品级设定/角色有链；章节角色/事件入口已退休                      | DB 与 Service 存在不能替代生产入口；首次使用指南仍宣称可操作退休面板。                                                                         |
| 大纲                 | PRJ-09、PRJ-17、AI-04    | 持久化存在，归属校验和入口分裂                                    | `outline_commands.rs` 直接 SQL；表缺少足够外键归属校验；隐藏 OutlineEditor 和旧 AI 生成路径绕过 Artifact 协议。                                |
| 记忆与上下文         | PRJ-18～20、AI-10、AI-13 | 词法/确定性链较稳，模型总结/向量分支 PARTIAL                      | `search_memory` 有 production handler；Embedding、章节总结和向量分支仍未用真实模型验证；本轮真实 DSH smoke 只覆盖 preparation 提案。           |
| 资产与事务           | PRJ-22～24               | 可见 faction/location 链 PARTIAL；后端泛化 target 超过 UI         | 后端支持额外关系类型，但无生产 UI builder/view；不能把通用 transaction schema 原样给 Agent。                                                   |
| 参考资料、导入导出   | PRJ-27～32               | 真实服务存在，文件和事务边界仍需限制                              | 参考库 Rust 测试和项目备份 round-trip 通过；TXT 导入逐章写入，无总事务/补偿；完整备份恢复有真实 Rust 动态证据。                                |
| 模板/资产中心        | PRJ-26、PRJ-33～34       | LocalStorage/导航型能力，存在假指标                               | 模板未接 Prompt Registry；导入资产卡硬编码 0；资产卡不定位具体管理区。                                                                         |
| AI 设置/治理         | SYS-01～05、AI-01        | 治理和安全边界较稳；真实 Provider 仅在 DSH preparation smoke 验证 | `aiSettingsStore` 默认 mock；`test:dsh:real` 已验证固定 DSH payload 的 Provider/工具调用，但普通 AI client 与章节链仍未验证。                  |
| Workbench            | AG-01～03、AG-07～10     | 持久化和候选审阅链 WORKING；完整自主模型决策未证实                | 生产闭环仍是 `plannerToolSelection=deterministic orchestration`、`externalLlmDecision=NOT RUN`；DSH preparation smoke 不覆盖 `chapter_write`。 |
| 旧生成/自主/多 Agent | AI-14～18、AG-12～14     | LEGACY                                                            | 生产 toolbar 隐藏生成/工程/检查/设定面板；自主规划和 Multi-Agent 仍有页面，但与权威对话工作台路线冲突。                                        |

## 4. 三个 BROKEN 入口（阻断后续 Tool 化）

### 4.1 作品“级联删除”是假级联

实际桌面链：

```text
HomePage.handleDeleteNovel
  → novelService.deleteNovelCascade
  → novelRepository.deleteCascade
  → novelRepository.remove
  → invoke('delete_novel')
  → project_service::delete_novel
  → novel_repository::soft_delete
  → UPDATE novels SET deleted_at = ...
```

`deleteCascade` 清理的是浏览器 LocalStorage keys；Tauri 分支只软删除 `novels` 主行。子表（卷、章节、草稿、设定、事件、AI 事实等）没有按确认文案执行级联清除，也没有可恢复/回收站 UI。当前应标 `BROKEN`，不能包装成 `novel.delete_cascade` Tool。

### 4.2 “扫描并修复数据库”不碰 SQLite

```text
Settings → DataStorageSettingsCard
  → novelRepository.repairData()
  → lsGet/lsSet('ai_novel_studio_novels')
```

该方法没有 `dbCall`、没有 Tauri command、没有 SQLite repository。桌面用户点击后得到“修复完成”提示，但权威数据源未扫描。当前应标 `BROKEN`，错误结果可能造成用户误以为数据已修复。

### 4.3 资产中心“导入资产”是假指标

卡片直接写入 `count: '0'`，没有读取 `imported_assets` 或参考资料导入记录。真实导入中心存在，但该卡片不是其统计投影。当前单独标 `BROKEN`，避免 Agent 从统计数字推导能力缺失或存在。

## 5. 关键 PARTIAL 边界

### 5.1 Mock 通过不等于所有外部模型能力可用

- `aiSettingsStore.getAiSettings()` 在 E2E 环境强制返回默认 `runtimeMode: mock`。
- DSH Rust 集成测试启动 `scripts/dsh/mock-workbench-upstream.mjs`。
- `npm run test:dsh:real` 已用真实 `deepseek-official/deepseek-v4-flash` 完成固定 DSH preparation smoke（本次 3 次请求；模型校验修复可能产生 3–4 次请求，工具调用与 Proposal schema 均通过）。
- 因此“固定 DSH preparation / real provider”可记为受限已验证；章节生成、润色、总结、质量、风格、独立 Writing SubAgent 和完整 DSH Main Agent 仍只保留 PARTIAL/UNKNOWN。

### 5.2 `generate_*` 名称与真实职责不一致

当前 `productionToolRegistry` 和 Rust gateway 中的 `generate_chapter`、`generate_outline` 等函数都要求模型先提供 `candidateText`，然后只做 schema/范围校验并返回 candidate-only 结构；它们不是生成器。真正章节生成发生在 `workbenchChapterWriter` → `executeChapterGeneration`，再把正文交给验证槽。模型若把名称理解为“请帮我生成”，会得到缺少 `candidateText` 的错误。

### 5.3 章节写作路径不是统一的 DSH Main Agent

`taskSessionAdapter` 明确规定：章节写作走 TypeScript ANS writer；只有非 conversational 的 structured/audit/read 任务在 Tauri 上尝试 DSH。章节写作的步骤由 `taskGoalRouting` 的正则匹配和 `taskRuntimeAdapter` 固定装配。它是可测试的 fallback orchestration，不是 LLM 自主规划。

### 5.4 生产 UI 已主动隐藏旧 AI 面板

生产 `RightToolbar` 只提供：保存、草稿、准备、总结、排版、采用。`ai-generate`、`engineering`、`setting`、`check` 只在 `VITE_AI_NOVEL_STUDIO_E2E=1` 出现；outline、characters、events、style、polish、multi-agent、context-view 等没有生产触发方。它们的 Service 和测试不能升级能力健康状态。

## 6. 动态验证记录

本轮执行/复核的关键结果：

| 验证                                         | 结果                               | 能证明什么                                                          | 不能证明什么                                                |
| -------------------------------------------- | ---------------------------------- | ------------------------------------------------------------------- | ----------------------------------------------------------- |
| `npm run test:workbench`                     | PASS（47 项）                      | Workbench fallback、Artifact、候选审阅协议、任务并发/恢复的 TS 行为 | 外部 LLM 自主决策、真实 Provider 质量                       |
| `npm run test:project-backup`                | PASS（15 项 Rust）                 | 完整项目备份、篡改拒绝、重启 round-trip                             | 用户逐项点击体验                                            |
| `npm run test:ai-tasks-delete`               | PASS（3 项 Rust）                  | 旧 AI 记录删除/子表清理约束                                         | 旧页面是否应继续作为 Agent 能力                             |
| `npm run test:workspace-recovery`            | PASS（前端 12 项；Rust 套件通过）  | 恢复快照与 SQLite 事务边界                                          | 所有桌面异常组合                                            |
| `npm run test:large-text-integrity` 并发运行 | 首次出现 DSH restart 断言失败      | 暴露并发测试/运行时存在时序敏感性                                   | 不能据此单独判产品永久 BROKEN                               |
| 同一 DSH restart 测试隔离重跑                | PASS                               | 失败具有环境/时序特征，需记录为 flaky 风险                          | 不能宣称完整 Workbench 外部模型已验证                       |
| 真实 Windows closed-loop E2E                 | PASS（5 轮、2 作品、重启）         | SQLite/Conversation/Artifact/Review/CAS/采用/重启闭环               | `externalLlmDecision` 未运行，写作使用 mock                 |
| `npm run test:dsh:real`                      | PASS（真实 Provider，本次 3 请求） | 固定 DSH preparation 的真实工具调用、Proposal schema 和凭据隔离     | `chapter_write`、完整 Registry、Writing SubAgent 和模型质量 |

## 7. 健康风险排序

### P0：必须先处理

1. 删除文案与桌面行为不一致。
2. 桌面数据修复按钮对错误存储层操作。
3. Tool 名称把 candidate validator 伪装成 generator，可能诱发错误调用。
4. 不得把固定 DSH preparation smoke 或 Mock E2E 外推成 `chapter_write`/完整 LLM autonomous pass。

### P1：进入下一 Agent 阶段前处理

1. 统一 TS Registry、DSH Gateway、Runtime projection 的单一能力来源。
2. 给模型可见的 Tool 契约补齐 permission/scope/sideEffect/confirmation 语义，或在 gateway 层强制一致投影。
3. 为候选应用、采用、导入、事务写入建立显式确认/版本/CAS facade。
4. 隔离或移除旧 Outline、Setting Suggestions、Autonomous Planning、Multi-Agent 生产入口。
5. 为 `chapter_write`/Writing SubAgent 增加真实 Provider smoke（不提交凭据），并把网络失败、超时、预算拒绝与候选落盘分别记录；现有 DSH preparation smoke 证据需保留。

### P2：能力清理与体验修复

1. TXT 导入增加事务/补偿。
2. 模板接入 SQLite 与 Prompt/Workbench，或明确降级为剪贴板工具。
3. 修复资产中心统计和卡片定位。
4. 补齐 outline ownership/foreign-key 校验。
5. 处理 DSH restart 时序敏感测试，避免健康门禁被并发污染。

## 8. 最终九问九答

### 1. 当前软件真实拥有多少能力？

本审计识别 **75 个独立能力族**。其中当前生产能力候选是 **58 个**（21 WORKING + 37 PARTIAL）；其余是 3 BROKEN、11 LEGACY、3 UNKNOWN。90 张表、262 个 command 定义和 18 个 TS Tool 描述符都不是能力数量。

### 2. 多少能力真正可用？

严格按本审计口径为 **21 个 WORKING**。另有 37 个 PARTIAL 只能在文档列明的限制下使用，不能向 Main Agent 宣告为无条件可用。

### 3. 哪些功能用户可以正常使用？

有当前动态证据的主功能包括：作品创建/打开/基础编辑；卷章树；草稿历史；正文编辑、排版、原子保存和采用；未保存内容恢复；Workbench 会话；候选 Artifact 卡片；人工审阅授权；跨作品五轮采用与重启恢复；完整项目备份/恢复；章节准备度检查；确定性上下文压缩。大文本、记忆、请求治理、AI Task/Artifact 事实和计划租约是这些用户能力背后的健康内部设施。

### 4. 哪些功能是假入口？

确定的 BROKEN 是：作品“级联删除”（实际只软删除主记录）、“扫描并修复数据库”（只修 LocalStorage）、资产中心“导入资产”计数（硬编码 0）。此外有误导但按 PARTIAL/LEGACY 处理的入口：模板“使用”只复制剪贴板、TXT 风格分析实际是粘贴文本且丢来源、AI 任务页不是正式 Workbench Run、E2E-only AI 面板、过时首次指南和无导航 hidden routes。

### 5. 哪些能力可以直接 Tool 化？

只读/确定性候选包括：novel/volume/chapter/draft 读取，设置、角色、总结、风格、输出控制读取，memory.search，reference list/read section，story asset list，content transaction prepare，以及带用户文件确认的 export/backup。大纲读取必须先修 ownership 校验；写操作不能“直接” Tool 化为静默执行。

### 6. 哪些必须 SubAgent 化？

正文生成与改写、润色、大纲规划、角色/事件/设定候选、质量审查、章节总结/模型压缩、风格分析、剧情规划、多意见综合。SubAgent 只能交付 ResultArtifact/报告，不得采用正式正文或写入正式事实。

### 7. 当前 Tool Registry 是否遗漏？

**是。** TS Registry 的 7 个安全读/检查描述符未进入 DSH allowlist；同时 chapter/draft/summary/reference/story asset 等真实领域 facade 未注册。更严重的是现有 8 个 `generate/polish/check/summarize` 名称其实是 candidate validator，且 TS、gateway、runtime 是三份并行定义。

### 8. 当前 Main Agent 是否看到正确能力？

**否。** 章节路径没有让 LLM 看/选完整 Registry，而是正则分流和固定步骤；DSH preparation 分支已用真实模型验证过 11 个 MCP canonical Tool 的局部调用，但完整 Workbench 仍看不到统一 Registry，且会被 `generate_*` 的误导名称影响。

### 9. 第一阶段 Harness 是否建立在真实能力之上？

**部分是。** SQLite、Conversation、ResultArtifact、ReviewAuthorization、CAS 保存/采用和重启隔离是真实生产能力；固定 DSH preparation 的真实 Provider 也有证据，但 LLM 自主选 Tool 的完整 Workbench 路径、正确完整 Registry、独立 Writing SubAgent 和真实章节生成仍未验证。第一阶段基础设施可保留，但不能直接放行 Context Agent 扩展。

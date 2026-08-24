# AI Novel Studio 第二次全量能力审计：Capability Inventory

审计日期：2026-08-24  
基准版本：`v3.6.0`（工作树包含本轮前置修复，未在本审计中修改产品代码）

## 1. 计数口径

本清单的“能力”不是文件、表或命令的同义词，而是一个用户可识别、或一个可独立授权的领域动作。相邻 CRUD 会合并为一个能力族；内部迁移、租约、缓存和测试夹具不单独计数。每一行都必须有入口/消费者、真实调用链和健康判断。

状态定义：

- `WORKING`：有生产入口或生产消费者，调用链闭合，并有当前环境的真实动态证据（真实 SQLite/IPC 或生产 E2E）；不把模型质量等同于数据链成功。
- `PARTIAL`：入口和主要链路存在，但只验证了局部、Mock/fallback、非事务分支、目标外部模型路径未验证，或能力覆盖面小于名称承诺。
- `BROKEN`：生产入口可见，但行为与文案/契约矛盾，或调用链明确断在错误的数据源/命令。
- `LEGACY`：旧架构、E2E-only、无生产消费者或已被权威架构替代；代码存在不代表当前产品能力。
- `UNKNOWN`：静态证据不足以确认可用，也没有足够的生产动态证据；不得开放给 Agent。

## 2. 原始扫描规模（不是能力数量）

| 扫描对象                                   | 实测数量 | 解释                                                              |
| ------------------------------------------ | -------: | ----------------------------------------------------------------- |
| SQLite 不同表                              |       90 | 来自基础 schema 与 36 个迁移；其中含内部事实表、旧表和双存储镜像  |
| `#[tauri::command]` 定义                   |      262 | 命令定义数量，不等于用户入口                                      |
| 普通构建注册命令                           |      254 | 另有 3 个只在 E2E feature 注册的诊断命令                          |
| 全构建未注册命令定义                       |        5 | 旧大文本草稿命令、旧章节草稿创建、两个旧 engineering 单条读取命令 |
| TypeScript `productionToolRegistry` 描述符 |       18 | 有 schema/权限等元数据，但不是 DSH 模型直接看到的唯一注册表       |
| Workbench/DSH canonical allowlist          |       11 | 7 个 TS 描述符未进入当前 allowlist                                |
| Gateway `tools/list` 默认条目              |       14 | 11 个 canonical 条目 + 3 个 legacy alias                          |
| 本审计独立能力族                           |   **75** | 下表的计数单位                                                    |

## 3. 能力总表

### A. 作品与创作数据能力（36）

| ID     | 能力                                | 生产入口/消费者                       | 真实调用链（压缩表示）                                                                                          | 状态    | Agent 结论                                         |
| ------ | ----------------------------------- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ------- | -------------------------------------------------- |
| PRJ-01 | 作品列表、创建、打开、基础编辑      | `/novels`、作品详情                   | `HomePage` → `novelRepository` → `dbCall` → project command/repository → `novels`                               | WORKING | 读/创建可做确定性 Tool；更新需显式输入             |
| PRJ-02 | 删除作品（用户文案称级联）          | 首页删除按钮                          | `HomePage` → `deleteNovelCascade` → `delete_novel` → `soft_delete` → 只更新 `novels.deleted_at`                 | BROKEN  | 禁止开放；先修语义或改文案                         |
| PRJ-03 | 世界背景设定生命周期                | 作品详情世界设定卡                    | 详情页 → `settingRepository` → world command/service → `world_settings`                                         | PARTIAL | 查询 Tool；写入需确认                              |
| PRJ-04 | 规则体系生命周期                    | 作品详情规则卡                        | 详情页 → rule repository → world command/service → `rule_systems`                                               | PARTIAL | 查询 Tool；写入需确认                              |
| PRJ-05 | 主角设定与角色库同步                | 作品详情主角卡                        | 主角表单 → `novelService.updateNovelProtagonists` → Rust world/project commands → `protagonists` + `characters` | PARTIAL | 读 Tool；同步写入只能由领域服务执行                |
| PRJ-06 | 作品级角色库 CRUD                   | 作品详情角色库                        | `CharacterLibraryCard` → `characterService` → world commands/repository → `characters`                          | PARTIAL | 列表/读取 Tool；写入需确认                         |
| PRJ-07 | 分卷生命周期                        | Writing Workspace 卷树                | `VolumeTree` → `volumeService/repository` → writing command → `volumes`                                         | WORKING | `volume.list/get` 可开放                           |
| PRJ-08 | 章节树、创建、切换与基础生命周期    | Workbench 章节选择、Writing Workspace | `VolumeTree`/章节选择 → chapter service/repository → writing command → `chapters`                               | WORKING | `chapter.list/get` 可开放；删除需保护              |
| PRJ-09 | 手工编辑章节大纲                    | 章节编辑区/作品详情                   | editor → `chapterRepository.update` → `update_chapter` → `chapters.outline`                                     | PARTIAL | 读可 Tool；写入需 CAS/确认                         |
| PRJ-10 | 草稿历史与版本浏览                  | 草稿面板                              | `DraftHistoryPanel` → `draftVersionService` → draft commands/repository → `chapter_drafts`                      | WORKING | `draft.read_version/list` 可开放                   |
| PRJ-11 | 正文原子保存与 CAS                  | 编辑器保存                            | editor controller → `saveDraftAtomic` → `save_chapter_draft_atomic` → large-text/draft service → SQLite         | WORKING | 只能作为受控写 facade；不可让模型绕过 CAS          |
| PRJ-12 | 手工草稿采用                        | 编辑器“采用”                          | editor controller → `draftVersionService.adopt` → `adopt_chapter_draft` → chapter/draft transaction             | WORKING | 必须保留人工确认                                   |
| PRJ-13 | Agent 候选的审阅授权与采用          | ArtifactCard →审阅工作台              | card → `artifactDecisionService` → review authorization → `adopt_review_authorized_draft` → SQLite              | WORKING | 这是唯一正式候选落地门；不可静默调用               |
| PRJ-14 | 正文编辑与排版                      | Writing Workspace                     | editor → document controller/format command → draft controller                                                  | WORKING | 人工 UI 能力；不开放为模型 Tool                    |
| PRJ-15 | 未保存正文恢复                      | 工作台恢复提示                        | editor/recovery hook → `workspaceRecoveryService` → recovery commands → recovery snapshot 表                    | WORKING | 内部恢复设施，不开放                               |
| PRJ-16 | 大文本分片、哈希与 fail-closed 读取 | 长正文保存                            | large-text facade → create/append/finalize/read → large-text repository → document/chunks                       | WORKING | 内部完整性设施，不开放                             |
| PRJ-17 | 总纲/卷纲/章纲版本持久化            | 大纲编辑器与上下文编译                | outline UI/service → `outline_commands`（直接 SQL）→ `master/volume/chapter_outlines`                           | PARTIAL | 读取需先补归属校验；生成不能直接写                 |
| PRJ-18 | 章节总结、上下文记录与启停          | Writing Workspace“总结”               | summary panel → summary/context services → context commands → `chapter_summaries/context_records`               | PARTIAL | 读取 Tool；总结是 SubAgent 候选                    |
| PRJ-19 | 已采用正文记忆文档、FTS/词法检索    | Workbench `search_memory`、采用后沉淀 | adoption → memory lifecycle → `memoryService.retrieve` → memory tables/FTS5                                     | WORKING | `memory.search` 是确定性只读 Tool                  |
| PRJ-20 | Embedding 与混合向量检索            | 记忆检索内部                          | memory service → embedding provider/fallback → embeddings + retrieval log                                       | PARTIAL | 不把向量实现细节暴露给模型；先做统一 search facade |
| PRJ-21 | 章节出场角色绑定与章节事件管理      | 旧 Characters/Events 面板             | retired panel → character/event services → `chapter_characters/chapter_events`                                  | LEGACY  | 当前生产无入口；禁止开放                           |
| PRJ-22 | 势力、地点及可见故事资产            | `/story-assets`                       | Story Assets → content transaction service → content commands → faction/location tables                         | PARTIAL | `story_asset.list` 可做 Tool；写入需确认           |
| PRJ-23 | 跨章节内容事务与 CAS 应用           | 资产事务面板                          | transaction UI → prepare/apply service → content transaction commands → targets/revisions                       | PARTIAL | `prepare` 可受控开放；`apply` 必须人工确认         |
| PRJ-24 | 后端额外关系/关联目标               | 仅 Rust transaction schema            | transaction service → SQL target handlers → relation/link tables；无生产 UI builder/view                        | UNKNOWN | 不计为可用用户能力，不开放                         |
| PRJ-25 | 风格方案与输出控制 CRUD/激活        | `/styles`、JSON 导入                  | style/output pages → services → style/output commands → `style_profiles/output_profiles`                        | PARTIAL | 读取 Tool；写入需确认                              |
| PRJ-26 | 用户模板库                          | `/templates`                          | TemplatesPage → `templateService` → LocalStorage                                                                | PARTIAL | 只能视为本地剪贴板工具；不开放为 Agent 模板 Tool   |
| PRJ-27 | 参考资料导入、浏览、激活、删除      | 作品参考资料页                        | Reference UI → reference service → reference commands → works/imports/sections + large text                     | PARTIAL | 元数据/章节读取可 Tool；文件写操作需权限           |
| PRJ-28 | 从参考资料提取风格                  | 参考资料“提取风格”                    | reference page → layered style analyzer → model client → style profile form                                     | PARTIAL | SubAgent 候选；未证明真实外部模型                  |
| PRJ-29 | TXT 小说导入                        | 导入中心/首页                         | TXT dialog → parser → create novel/volume/chapter/draft 循环 → SQLite/LocalStorage fallback                     | PARTIAL | 确定性文件 Tool 需事务/补偿后再开放                |
| PRJ-30 | JSON 导入（旧项目、风格、输出）     | 导入中心                              | JSON dialog → detector → domain services → project/style/output stores                                          | PARTIAL | 需显式文件权限；不能静默覆盖                       |
| PRJ-31 | 完整项目备份导出与恢复              | 导入导出、设置                        | `projectBackupService` → backup commands/Rust serializer → all project facts → restore transaction              | WORKING | 可做用户确认后的确定性 Tool，不可静默导入          |
| PRJ-32 | 采用章节 TXT/Markdown 导出          | 导入导出中心                          | export page → `exportService` → repositories → Tauri save dialog/FS                                             | PARTIAL | 可做文件 Tool（需路径/确认）                       |
| PRJ-33 | 创作资产聚合导航                    | `/assets`                             | AssetsPage → parallel stats services → cards/navigation                                                         | PARTIAL | 仅导航/摘要，不是领域 Tool                         |
| PRJ-34 | “导入资产”计数卡                    | 资产中心卡片                          | AssetsPage → `count: '0'`（未查询 imported assets）                                                             | BROKEN  | 删除/修复入口后再评估                              |
| PRJ-35 | `/ai-tasks` 历史记录页              | 侧栏 AI 任务                          | AiTasksPage → legacy `aiTaskService` → `ai_task_records`                                                        | LEGACY  | 不代表正式 Agent Run；禁止开放                     |
| PRJ-36 | “扫描并修复数据库”                  | 设置数据存储卡                        | settings button → `novelRepository.repairData` → `lsGet/lsSet`；无 dbCall/SQLite command                        | BROKEN  | P0 阻断；禁止开放                                  |

### B. 系统与桌面能力（7）

| ID     | 能力                             | 生产入口/消费者    | 真实调用链                                                                     | 状态    | Agent 结论                     |
| ------ | -------------------------------- | ------------------ | ------------------------------------------------------------------------------ | ------- | ------------------------------ |
| SYS-01 | Provider/API 设置与连接测试      | 设置中心           | settings cards → `aiSettingsStore/aiClient` → provider policy/client           | PARTIAL | 只给运行时，不给模型修改权限   |
| SYS-02 | 本地模型健康与 Loopback 安全检查 | 设置中心           | local model card → health service → Tauri HTTP health command                  | PARTIAL | 内部运行时能力                 |
| SYS-03 | AI 请求并发、Token、成本治理     | 设置中心/AI client | request policy service → governance commands → policy/usage/reservation tables | WORKING | 内部门禁，不开放               |
| SYS-04 | 诊断日志、崩溃报告导出/清空      | 设置中心           | diagnostics card → logger/crash service → Tauri file/Rust hook                 | PARTIAL | 内部运维能力                   |
| SYS-05 | 应用更新检查、安装、回滚入口     | 设置中心           | update card → updater service → Tauri updater                                  | UNKNOWN | 本次未执行真实发布通道；不开放 |
| SYS-06 | 主题、窗口状态、单实例与重启     | 设置/桌面启动      | theme store + Rust runtime/window state + process lock                         | WORKING | 桌面设施，不开放               |
| SYS-07 | “安全与合规提醒”                 | 设置静态卡片       | `SecuritySettingsCard` 仅渲染文字，无状态/检测/服务                            | LEGACY  | 不是能力，不进入 Registry      |

### C. AI 与生成能力（18）

| ID    | 能力                           | 生产入口/消费者                           | 真实调用链                                                                                                   | 状态    | Agent 结论                                                                                        |
| ----- | ------------------------------ | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ------- | ------------------------------------------------------------------------------------------------- |
| AI-01 | 模型请求、流式输出、取消与超时 | AI client/Workbench/生成服务              | client → request policy → provider/DSH runtime → stream/cancel                                               | PARTIAL | 固定 DSH preparation 已有真实 Provider smoke；普通 AI client、章节生成和取消/超时外部路径仍未验证 |
| AI-02 | Prompt/context 编译与模型快照  | Workbench 写章、传统生成                  | context compiler → prompt orchestrator → frozen `TaskModelSnapshot` → execution request                      | WORKING | 内部 SubAgent 前置编译，不是模型 Tool                                                             |
| AI-03 | Workbench 章节正文生成/改写    | Workbench 生成/修改任务                   | task adapter → `workbenchChapterWriter` → context compiler → `executeChapterGeneration` → candidate artifact | PARTIAL | 必须是 Writing SubAgent；当前 E2E 使用 Mock                                                       |
| AI-04 | 大纲候选生成                   | Workbench 候选路径/旧 Outline UI          | DSH/TS routing → candidate validator 或旧 outline generator → outline result                                 | PARTIAL | SubAgent；现有 `generate_outline` 只是验证槽                                                      |
| AI-05 | 角色候选生成                   | Workbench candidate path                  | DSH/TS → candidate validator → `character_candidates` artifact                                               | PARTIAL | SubAgent；不能直接写角色库                                                                        |
| AI-06 | 事件候选生成                   | Workbench candidate path                  | DSH/TS → candidate validator → `event_candidates` artifact                                                   | PARTIAL | SubAgent；不能直接写事件                                                                          |
| AI-07 | 设定候选扩展                   | Workbench candidate path/旧 setting panel | DSH/TS → candidate validator → setting artifact → placement/apply                                            | PARTIAL | SubAgent + Safe Apply；当前 apply 覆盖面有限                                                      |
| AI-08 | 正文润色/重写候选              | Workbench修改任务/旧 Polish 面板          | task adapter → writer(mode=polish) → candidate validator → artifact                                          | PARTIAL | SubAgent；源正文和版本必须显式绑定                                                                |
| AI-09 | 质量检查候选报告               | Workbench/旧 Check 面板                   | quality service/model → candidate validator or quality tables                                                | PARTIAL | SubAgent；报告不可直接应用                                                                        |
| AI-10 | 章节总结候选                   | Workbench/总结面板                        | summarizer → candidate validator → summary/context apply                                                     | PARTIAL | SubAgent；需人工采用或显式 apply                                                                  |
| AI-11 | 风格分析/风格画像              | StyleProfiles/Reference                   | style analyzer → model client → profile form/service                                                         | PARTIAL | SubAgent；未证明外部真实模型                                                                      |
| AI-12 | 章节准备度确定性计划           | Writing Workspace“准备”                   | readiness card → agent plan runtime → fixed six-step DAG → SQLite plan tables                                | WORKING | 确定性内部 workflow，不是自主 Agent                                                               |
| AI-13 | 确定性上下文压缩候选           | Workbench压缩按钮                         | compression hook → extractive provider → ResultArtifact → context record apply                               | WORKING | 可做内部 Tool；不是模型总结                                                                       |
| AI-14 | DSH 章节准备实验提案           | E2E-only `AiGeneratePanel` 中的 DSH card  | DSH card → `dsh_prepare_chapter` → DSH planner/ledger                                                        | LEGACY  | E2E/实验入口，禁止进入生产 Tool                                                                   |
| AI-15 | 场景/Beat 计划 AI 生成         | E2E-only engineering panel                | engineering panel → scene plan service → AI pipeline → engineering tables                                    | LEGACY  | 生产工具栏已退休                                                                                  |
| AI-16 | 质量失败后的自动修复循环       | E2E-only generation/check panels          | quality gate → fix range application → old generation UI                                                     | LEGACY  | 旧生成链，不作为当前 Agent 能力                                                                   |
| AI-17 | 自主剧情规划与调度             | 作品详情“自主创作规划”                    | autonomous page → story service → scheduler/leases → plans/runs                                              | LEGACY  | 与对话唯一入口冲突，暂不开放                                                                      |
| AI-18 | Multi-Agent 意见/共识          | 旧 Multi-Agent panel/runtime              | panel → multi-agent service → sessions/rounds/opinions                                                       | LEGACY  | 无生产主入口；不可暴露                                                                            |

### D. Agent Runtime、Tool 与内部编排（14）

| ID    | 能力                                                | 生产入口/消费者                  | 真实调用链                                                                              | 状态    | Agent 结论                                                                                                           |
| ----- | --------------------------------------------------- | -------------------------------- | --------------------------------------------------------------------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------- |
| AG-01 | Workbench 会话、轮次、Run、ToolEvent 持久化         | `/` Workbench                    | Workbench hooks → `taskConversationService` → conversation commands/repository → SQLite | WORKING | 内部事实链；不能当用户 Tool                                                                                          |
| AG-02 | TypeScript fallback 的任务编排                      | 浏览器 fallback、章节写作路径    | goal → regex `taskGoalRouting` → fixed steps → `productionToolRegistry.invoke`          | PARTIAL | 可靠 fallback，但不是 LLM Main Agent                                                                                 |
| AG-03 | DSH 外部 LLM 自主选 Tool                            | Tauri structured/audit/read path | task session → DSH child → MCP gateway → model followup → tool/call                     | UNKNOWN | 固定 DSH preparation 已有真实工具调用证据，但完整 Workbench/统一 Registry 的自主选 Tool 仍未证实；不得宣称已全面工作 |
| AG-04 | TypeScript production Tool Registry                 | TS runtime/plugin projection     | 18 descriptors → `ToolRegistry.invoke` → handlers/validators                            | PARTIAL | 有契约但不是唯一权威 Registry；候选名语义错误                                                                        |
| AG-05 | Rust DSH MCP gateway Registry                       | DSH child                        | gateway `tools/list` → allowlist → read/candidate handlers → read-only SQLite           | PARTIAL | 11 canonical 可见；缺权限字段/写入 facade                                                                            |
| AG-06 | Plugin/runtime health 投影                          | Workbench当前插件                | `currentPluginService` → DSH health/list projection → UI rows                           | PARTIAL | 健康只证明目录/组合，不证明每个 Tool 可调用                                                                          |
| AG-07 | ResultArtifact、Card、Decision、ReviewAuthorization | Workbench候选卡片                | writer/validator → artifact service → card/decision/auth commands → SQLite              | WORKING | 正式候选真相；保留人工确认                                                                                           |
| AG-08 | 结构化候选应用                                      | ArtifactCard角色/事件/设定/摘要  | `artifactApply` → domain service/placement/context → DB                                 | PARTIAL | 各 artifact type 不能统称已可用；apply 需显式授权                                                                    |
| AG-09 | 正式 AI Task/Attempt/Snapshot/Artifact 事实         | AI execution pipeline            | execution pipeline → AI task/artifact commands → immutable facts                        | WORKING | 内部审计事实，不开放给模型                                                                                           |
| AG-10 | Agent Plan 租约、步骤、checkpoint                   | Readiness runtime                | plan hook → persistence/runtime → agent plan commands → plan tables                     | WORKING | 固定编排内部设施，不是自主规划 Tool                                                                                  |
| AG-11 | Placement proposal/apply runtime                    | 旧 setting apply/Artifact apply  | placement service → placement commands → proposal/apply tables                          | PARTIAL | 只能暴露受限 `prepare`；apply 需人工确认，覆盖面不是通用 Apply                                                       |
| AG-12 | Generation job/engineering 快照与 checkpoint        | 退休生成面板/内部 pipeline       | generation services → AI commands → generation tables                                   | LEGACY  | 当前生产 Workbench 不把它作为主入口                                                                                  |
| AG-13 | 旧 Agent Harness/AgentToolRegistry                  | 无生产路由，仅测试/旧 feature    | `AgentChatWorkspace` → legacy loop/planner → legacy registry → in-memory state          | LEGACY  | 禁止与 production registry 合并                                                                                      |
| AG-14 | 旧内存 MemoryManager 与 LocalStorage 双轨           | 旧 Harness/本地服务              | `novelMemoryManager`/template/setting/polish local services → Maps/LocalStorage         | LEGACY  | 以 SQLite 正式事实为准，不开放                                                                                       |

## 4. 计数结果

| 状态     |   数量 | 解释                                                                                    |
| -------- | -----: | --------------------------------------------------------------------------------------- |
| WORKING  | **21** | 当前有动态证据的生产能力族                                                              |
| PARTIAL  | **37** | 可走部分链路或依赖未验证外部模型/分支                                                   |
| BROKEN   |  **3** | 删除、导入资产统计、桌面数据库修复                                                      |
| LEGACY   | **11** | 退休/E2E-only/无生产消费者/双轨旧实现                                                   |
| UNKNOWN  |  **3** | 额外关系目标、更新通道、完整外部 LLM 自主选 Tool（仅局部 DSH preparation smoke 已验证） |
| **总计** | **75** | 计数口径见第 1 节                                                                       |

因此，“当前真正可用”严格按 `WORKING` 计为 **21 个能力族**；另有 **37 个条件可用**，不能在 Agent 规划中当作无条件可用。底层 90 张表和 254 个注册命令不改变这个结论。

## 5. 明确的假入口/误导入口

- 作品删除文案声称不可恢复级联删除，桌面链只 `UPDATE novels SET deleted_at`。
- 设置“扫描并修复数据库”只修 LocalStorage，未触达 SQLite。
- 资产中心“导入资产”数量硬编码为 `0`。
- 模板“使用”只复制剪贴板，不会应用到 Workbench、Prompt Registry 或 Agent。
- 资产中心多张卡片只回到作品详情，不能定位对应资产区。
- “TXT 风格分析”实际是粘贴文本，保存时强制变成 `manual` 来源。
- `/ai-tasks` 是旧 `ai_task_records` 页面，不是正式 Workbench Run/Artifact 历史。
- 首次指南仍指导用户使用已退休的角色/事件面板。
- `VITE_AI_NOVEL_STUDIO_E2E=1` 才出现的 AI 生成、工程、设定、检查面板不能算生产入口。
- `/novels/:novelId/outline`、`/coming-soon`、旧 lore alias 无生产导航消费者，不能按路由存在推导能力。

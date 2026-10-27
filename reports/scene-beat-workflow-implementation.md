# Scene／Beat 分阶段写章实施记录

> 非版本任务，实施中。目标为当前会话 P0–P5 全部完成；本记录不是生产功能、桌面或云端验收报告。

## 授权与工作区边界

- 工作目录：`F:\ai-novel-studio-hotfix-v321`，分支 `codex/v3.7.0-writing-subagent`；开工时 ahead 2 且有大量用户既有修改，未 reset/clean/commit/push/tag。
- 应用版本保持 3.7.0，不新增依赖、不升级固定 DSH 载体、不操作正式用户库、不调用真实计费模型。
- 用户已明确授权新增兼容迁移及必要备份支持（问答选择“允许新增兼容迁移”）。当前新迁移为 040，001–039 发布定义保持；备份 schema 12。
- 原整章 Writer、旧合并 Scene/Beat 计划和旧失败任务不得被静默升级或切换模型。

## 2026-10-20 后续进展（本段覆盖下方早期“尚未完成”描述）

已额外落地并通过限定测试，但仍未完成生产写章闭环：

- 阶段来源绑定 `contracts/chapter-writing-stage/v1.json` 会进入规划/状态请求的完整消息，不只写 metadata。
- Gateway `submit_chapter_stage` 仅在显式 allowlist 且绑定章节时接受，不写库、不生成候选。
- 原生阶段完成要求真实 request messages 中的绑定标记，Run 必须处于 running；总结人物引用对新 coverage 版本失败关闭。
- Rust 体积回退已抽出 helper，`check-rust-file-size` 在该轮收口后通过。
- 只读进度树已挂到创作工作台任务头下方；没有 SQLite 阶段记录时不显示，因此旧整章任务界面不变。候选完成仍要求同会话、同用户回合的有效 `chapter_text` 卡片。
- DSH `chapter_stage_write` 已能在工具回执与绑定一致时写入阶段表；定向宿主测试 2 项通过。默认 `chapter_write` 未切换。
- **仍未接入**：工作台 Writer 按 Scene/Beat 调度、最终章节候选顺序复验、真实桌面重启/采用闭环、本地 release EXE。

## 当前实际状态

| 工作包 | 已完成部分 | 尚未完成 |
| --- | --- | --- |
| P0 契约与兼容 | ScenePlanItem.planVersion=2 显式分流，旧 v1 不变；Beat startState/targetCharacters 元数据；新任务类型跨 TS/Rust 注册 | 阶段原生服务收口、全量跨层回归 |
| P1 规划拆分 | Scene-only v2 与按当前 Scene 规划 Beats；SHA-256 来源绑定；动态可行字数包络；真实基线 required/requireFull | 工作台生产路由消费 |
| P2 执行内核 | 串行 Scene→Beat→正文→实际变化→Scene 收束；强哈希/引用复验；显式恢复；单次正文最多两次逻辑尝试；取消/时限/逻辑调用预算 | Provider/local queue 与原生阶段服务适配；默认生产入口未接 |
| P3 工作台／DSH | 现状审计、权威阶段表接口已确定 | 新受限 stage taskKind/tool、阶段宿主校验、最终候选准入、取消与重试接线 |
| P4 进度与恢复 | 只读进度树、纯投影与组件行为测试；040 阶段存储／只读 IPC／启动恢复基础 | 页面查询与定位接线、实际阶段顺序与跨重启闭环 |
| P5 采用后沉淀 | summaryCoverageVersion=1、缺失与空数组分流、新版 characterChanges 为唯一状态源、原子应用回归 | 全流程桌面验证；新写章流采用与总结闭环 |

### 已落代码索引

- [共享工作流类型](../src/types/chapterWritingWorkflow.ts)
- [Scene-only 服务](../src/services/ai/chapterSceneOnlyPlanService.ts)、[Beat 规划服务](../src/services/ai/chapterSceneBeatPlanService.ts)、[字数策略](../src/services/ai/chapterBeatPlanPolicy.ts)
- [规划编译定义](../src/services/ai/compilation/chapterPlanningCompilationDefinitions.ts)、[Scene 归一化](../src/services/engineering/chapterScenePlanNormalization.ts)
- [状态提取](../src/services/ai/chapterBeatStateService.ts)、[状态来源校验](../src/services/generation/chapterWritingState.ts)
- [串行内核](../src/services/generation/chapterWritingWorkflow.ts)、[会话与预算](../src/services/generation/chapterWritingWorkflowSession.ts)、[阶段提交](../src/services/generation/chapterWritingWorkflowStages.ts)、[断点复验](../src/services/generation/chapterWritingWorkflowValidation.ts)
- [上下文与四字段](../src/services/generation/chapterWritingWorkflowContext.ts)、[宿主端口](../src/services/generation/chapterWritingWorkflowPorts.ts)
- [Mock 规划与状态响应](../src/services/ai/mockChapterStagedResponses.ts)
- [只读投影](../src/features/workbench/chapterStageProjection.ts)、[进度树](../src/pages/Workbench/WorkbenchChapterStageTree.tsx)
- [阶段 DTO](../src/types/chapterWorkflowStage.ts)、[阶段原生服务](../src-tauri/src/services/chapter_workflow_stage_service.rs)、[阶段迁移](../src-tauri/src/migrations_chapter_workflow_stages.rs)
- [采用后覆盖契约](../src-tauri/src/services/summary_coverage.rs)

## 已确定的实施决定

1. 工作流身份使用原用户 `turnId`；`runId` 是某次尝试，不能复活已终结 Run。
2. Scene-only v2 保留空 beats，禁止 legacy 的 result/transition 等自动补 Beat。
3. `stateChange` 是计划变化；`ActualBeatState` 是有原文引用的候选归纳，`semanticValidation` 始终 `not_checked`。
4. 状态提取 Context 只包含实际 Beat 正文和此前实际状态；不传计划预期结果或未来 Scene。
5. 运行内核的 `maxCalls` 统计逻辑阶段调用，Provider 的传输重试／实际请求治理独立存在，不将此值描述为真实模型请求总数。
6. 原生阶段成功只能由内部宿主服务写入；公开 tool_call_events 和 generation_steps 不是权威证明。不注册任意“写 stage succeeded”的 Tauri 命令。
7. Stage 模型快照哈希由原生从真实 Run 快照重算。恢复必须复验来源、计划、预算和正文，重启不自动请求模型。
8. 树中 sceneNo/beatOrder 来自已校验的计划 ID 映射，不能从 stageKey／时间戳猜；resultDocumentId 不是 Artifact ID，不能伪装成 artifact 定位锚点。
9. `chapter_assemble` 完成不等于章节候选已准入。只有有效 chapter_text Artifact／卡片才可显示可审阅候选；ReviewAuthorization 与采用链不变。
10. 新总结的 contextRecords 空数组表示“无额外长期记录”，仍会派生一条正式章节摘要 ContextRecord；characterChanges 空数组不得通过 legacy 描述字段偷偷写人物状态。

## 下一轮优先任务

1. 父任务接手原生收口：Rust 文件体积、verified Artifact 正向 Mock 领域测试、实际 request.messages 绑定检查、已终结 Run 的迟到完成拒绝。原生收口子任务及重启后的两次独立子任务均在未完成时执行失败，没有最终报告；不能假设其后续改动已实现。当前 stage service 仍 829 行；另有 372 行 stage contract 副本尚未接入模块。不能仅递归扫描 manifest 元数据当作模型真正收到材料。
2. 为三个新规划／状态任务增加工作流绑定元数据与原生来源复验。真实请求应包含明确的工作流绑定和所需输入，不只声明哈希。
3. 接入分阶段 Provider 执行与 DSH 新阶段契约：不循环 generate_chapter 冒充 Beat，不静默关闭默认 DSH；宿主校验当前阶段和顺序，不能让模型自选任意 stageKey 跳过依赖。
4. 处理最终章节 Artifact 来源：既有 Artifact 要求真实 Provider responseHash，不能把宿主拼接文本伪造为 Provider 返回。优先独立的一次严格序列化候选请求，宿主在准入前核对完整阶段正文及顺序；若改为 host-composed，必须新增明确验证来源路径，不能放松通用创建入口。
5. 工作台 Writer 接入时避免复用旧 Beat executor 的未采用 NovelMemory applyStateDelta 副作用；临时状态必须只留本工作流，正式入库仍在采用后。
6. Native complete/cancel/retry 与实际 TaskRun 生命周期接线，浏览器回退明确非 SQLite 权威，不以 LocalStorage 测试冒充原生事务。
7. 按显式计划映射 UI、匹配工作流查询、已有 run/tool/artifact 锚点定位；无权威记录不画完成、不展示假百分比；旧任务不强制显示新进度树。
8. P5 还需核查新 coverage 版本的人物引用：现有 resolver 找不到活跃角色会静默跳过；新版应对未知／歧义／跨作品引用明确拒绝或公开未完成，不能把非空 characterChanges 零写入误标为完整。旧版兼容行为另行保留并补正反例。
9. 同步 README／用户工作流／架构／测试归属，做 scoped gates、完整相关 Rust/SQLite、真实 Tauri 隔离桌面和故障注入；最终再构建本地 release EXE。

## 本轮实际验证（截至当前记录）

### 父任务

- `npx tsx --test src/services/generation/chapterWritingWorkflow.test.ts src/services/generation/chapterWritingState.test.ts`：16/16 通过，覆盖顺序、实际状态、显式恢复、丢失保存回执、预算、时钟回拨、取消、来源漂移及 JSON 往返。
- `npx vitest run src/test/chapter-planning --reporter=dot`：19/19 通过。
- `node --experimental-strip-types --test src/services/backup/projectBackupService.test.mjs`：38/38 通过。父复核发现前端仍只接受 schema 11，已同步到 12、要求阶段表且兼容 2～11，新增缺表与跨版本集合拒绝用例；README 的迁移范围与备份版本同步。
- `npx tsc --noEmit --pretty false`：通过（后台 job pwsh-654、pwsh-726 已收集，exit 0；后者同时包含定向 ESLint 与 git diff --check）。
- `npm run test:docs-sync`：通过（job pwsh-728 已收集；Canonical 只读工具仍为 4，live Provider 仍 NOT_VERIFIED）。README 与数据模型的当前迁移／备份口径已同步，报告与 CHANGELOG 按既有 Prettier ignore 规则排除，未冒充其格式验证。
- 只对相关新文件执行 Prettier 与 ESLint：通过；后续小改需做最终复测。
- 验证归属新增 3 项行为测试，与现有选择器测试合计 19/19 通过；`verify:change -- --dry-run` 修复新 repository 未映射后通过（当前整个脏工作树 204 路径，计划 19 个命令；仅选择，不是这些门禁已运行）。
- `check-component-size.mjs`：738 production sources 通过。
- `check-rust-file-size.mjs`：**失败，待修复**。本批引入：project_backup 5185>5157、structured_artifact_apply_service 4959>4936、commands 3790>3789、db 1931>1921、ai_task_record_service 812>809、新 stage service 829>500；不放宽基线，应提取必要新增逻辑。

### 子任务已报告的限定证据

- 规划拆分：17 项早期规划测试；父任务后续增为 19 项。旧 engineering/scene-plan、AI client、routeDecision、compilation/cancellation 定向回归通过。
- State service + Mock：19 项通过；旧 AI client 5 项通过；Gateway locked check 通过。
- 进度树：纯投影 6 项 + 组件 5 项通过；仅 jsdom，未接生产页面。
- 总结：summary coverage／grounding／chapter_summary 等 Rust 定向组及 TS 总结解析、相邻自主写章测试通过；不是新写章全链路验收。
- 阶段原生基础：前次报告 chapter_workflow 9 项、migrations 25 passed/1 ignored、project_backup 31 项通过；正在收口的来源校验改动需要重新验证。
- 生产 TS 大小门禁已通过：规划 registry 476 行、engineering 373 行、mockAiClient 1228 行，未增豁免／放宽阈值。

## 尚未运行／不能宣称

- 新分阶段流程的真实 DSH／Tauri 端到端、重启恢复和候选采用闭环：未运行。
- 真实云端 Provider：未授权、未运行；不宣称 R4 live VERIFIED。
- 本地 release EXE：未重建，目标尚在实施，最终交付前必须重建并验证。
- 未提交／推送／打 tag，用户已有修改保留。

## 并行任务追踪

- 规划与类型：`dd2849c3-e6f2-43f2-8fc3-6116fc644004`，已完成。
- 总结覆盖：`120bb17a-1f2a-47e5-b417-b5d202f2240d`，已完成。
- 持久化审计：`a6642090-e386-4720-8908-5a34accdc472`，已完成。
- 进度树及必要体积收口：`d146d784-076f-4250-98cf-99ed0905b20c`，已完成。
- Mock 与状态服务：`6f7a921c-8219-44c1-af17-a272c568b8d2`，已完成。
- 原生 040 与阶段服务：`741eabd7-4484-45da-83f6-3e5fb745c1e3`，已交初版报告；后续收口两次执行失败，无最终报告，当前 inactive。
- 原生来源安全收口重试：`9b76ace5-ab12-4faf-b5e4-5773cb422518`，执行失败，无结果，当前 inactive。
- Rust 大小回退收口重试：`76575602-d757-4d7b-9ea8-02b0c5dbfb86`，执行失败，无结果，当前 inactive。
- 父任务没有未收集的相关后台作业；`pwsh-654`、`pwsh-726`、`pwsh-728` 已完成并收集。不得把这些子任务的未完成内容算作已通过，后续父任务可以直接接手。

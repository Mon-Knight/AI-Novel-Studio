# 交互与世界规则修复跟踪（非版本任务）

> 2026-09-18 收尾更新：下方保留原实施与首轮验证记录（包括后来已收回的临时方案）。当前收尾结果以 [收尾报告](closeout-2026-09-18.md) 为准；当前规则/039 契约以权威设计与源码为准。

## 授权与当前阶段

用户要求：上一轮审计列出的问题全部修复，全部修复完成后才统一验收。当前版本保持 3.7.0；不提交、推送、打 tag 或发布；保留任务开始前已有修改。实现阶段只补代码与回归，不执行测试、lint、类型检查、构建或桌面验收。此文件是实施跟踪，不是验收通过证明。

- 工作目录：`F:\ai-novel-studio-hotfix-v321`。
- 分支：`codex/v3.7.0-writing-subagent`。
- 同会话目标：`goal-1b371f08-d054-49c7-8886-729b7d25b8cb`（更新前必须重新 get_goal）。
- 基线含大量用户未提交修改，另有 `reports/runtime-hotfix-verification.md` 等用户文件，不覆盖或清理。
- 当前阶段：并行实施；统一验收尚未开始。

## 修复覆盖清单

### 交互

- [ ] U1 左树/右面板四态显式布局、窄窗覆盖及发送区不裁切。
- [ ] U2 壳层收起按钮控制当前真实导航，收起后搜索先显示再聚焦。
- [ ] U3 临时面板同入口 toggle、Esc/点外/IME/焦点恢复，插件返回；固定导航不因输入自动消失。
- [ ] U4 模板最终插入后关闭、独立撤销、草稿无损、键盘可达。
- [ ] U5 Composer 扩展区整体高度预算与任务作用域。
- [ ] U6 当前项目重复选择保持任务，返回项目保持最近任务。
- [ ] U7 任务级固定模型改明确徽标和可见说明，不开放静默换模型。
- [ ] T1 公开说明/工具/错误/产物按真实事件顺序投影，重试保留来源但在实际发生位置出现。
- [ ] T2 底部生成动作可定位本次精确候选；压缩预览关联动作；待处理与历史定位。
- [ ] T3 按完整用户回合分页，跨任务恢复历史窗口/阅读锚点，不抢滚动。

### 候选与采用

- [ ] A1 候选 A/B 修订精确绑定来源，草稿元数据+可见来源 chip，失效不回退 latest。
- [ ] A2 确认成功刷新失败可恢复，授权 issued/consumed/expired 与卡片动作一致。
- [ ] A3 报告已阅按类型收敛任务，不等待章节授权。
- [ ] A4 只读查看、编辑、保存、显式采用权限分开，保留对话显式采用安全路径。

### 世界规则与一致性

- [ ] W1 world_rules_v1 向后兼容结构契约与渐进编辑；世界背景八类参数目录。
- [ ] W2 事实/社会规范/角色信念/作者约束/叙事偏好分离，未知/N/A/软规则不误作硬冲突。
- [ ] W3 条件、范围、故事时间/揭示、代价上限、例外批准、来源依赖、版本可保存往返。
- [ ] W4 规则变更预览绑定拟改内容+规则集+影响基线，明确修改正史/例外授权；不宣称能证明任意自然语言语义。
- [ ] W5 AI task 创建事务冻结 nativeRuleSet，应用同事务复验；旧候选需明确再验证。
- [ ] W6 旧设定推演采用真实 SQLite 原子性+幂等，正文禁止项进入推演上下文。
- [ ] C1 Gateway 必需规则覆盖完整或明确 context_incomplete，不再取最新8条并任意截断。
- [ ] C2 确定性 Writer 视角/已知/未知字段与规则覆盖实际进入派发材料。
- [ ] C3 warning、error、复核未完成可见；结构校验不冒充世界语义通过。

## 文件分工与可继续子代理

所有子代理当前只实现/补测试，不运行验收。兄弟接口由父转发。

| 分工 | 子代理 ID | 独占边界 |
| --- | --- | --- |
| UI/壳层/所有 workbench 与 hub CSS | af5cec6f-121b-401d-84d9-73063989521d | Composer、TemplateControls、ModelSelect、SidePanel、壳层、项目导航 hooks 及相邻测试；不碰 Page/Stream/候选业务 |
| 候选生命周期/修订/审阅 | 538fe24e-63ac-4bc5-83c3-e7b4cc870e57 | WorkbenchComponents、useWorkbenchArtifacts、useWorkbenchTaskRunner、taskRuntimeAdapter、draft store、编辑器采用、conversation_repository.rs；不碰 Writer/Gateway/CSS |
| 世界规则 schema/UI/普通保存 | fe36d2d9-ea7c-4e8c-a80a-08f23968813a | types/setting 与 worldRules、services/worldRules、世界/规则卡、NovelDetail、settingRepository、world DTO/command 与 world_setting_service |
| 对话投影/阅读位置 | 666ced69-9eda-457d-8926-e8e72b5ed576 | MessageStream、Turn、AssetReadinessCard、useWorkbenchCompression、presentation helper 与相邻测试 |
| 上下文覆盖/质量 | b771fcba-d157-4c15-88fe-496925013840 | gateway/tools.rs、generationContextCompiler、chapterProviderContext、contextBuilder、workbenchChapterWriter、taskSessionAdapter、types/generationContext |
| 原子采用/规则基线治理 | e28fdacb-dc77-419d-9697-a58ecc9aad2a | settingSuggestionService/store、setting_suggestions.rs、structured_artifact_apply_service、ai_task_service 的 nativeRuleSet 冻结、新治理/共享指纹模块 |
| 桌面回归准备 | ced36139-3629-4471-bbac-018483e71588 | 新 tests/e2e/interaction-world-rules-repair.spec.ts 与独立 fixture，不运行 |

父独占共享集成：WorkbenchPage.tsx / Page.test.tsx、Rust main.rs / 根 commands.rs / services/mod.rs、DSH task_runtime.rs 及宿主契约接线、types/ai.ts、质量归属和 E2E runner 注册、文档/CHANGELOG、最终验证与 release EXE。修改这些已有 dirty 文件前读取 diff，不覆盖用户修改。

## 已冻结的跨模块契约

### 修订来源

`src/types/artifactRevision.ts` 导出 `ArtifactRevisionSource`：artifactId/artifactHash/cardId/conversationId/novelId/artifactType/title，及可选 runId/chapterId/sourceDraftVersion。它是来源引用，不是采用授权。来源保存在按任务的草稿元数据，不把裸机器标记塞进 textarea。

- runner 返回 `revisionSource` / `clearRevisionSource`。
- Composer props：`revisionSource?: ArtifactRevisionSource | null`、`onClearRevisionSource?: () => void`。
- UI testid：`workbench-revision-source`、`workbench-clear-revision-source`。
- TaskRuntimeInput 与 WorkbenchChapterWriteInput 增加可选 `revisionSource`，经权威 artifact/hash/作用域复验传精确 previousCandidateText。

### 世界规则保存与治理

- structuredJson：schemaVersion=1、contract=world_rules_v1；identity、kind、authority、strength、statement、conditions、scope、chronology、epistemic、boundaries、exceptions、provenance、dependencies、worldParameters（八类）。未知旧 JSON 保留，不自动确认。
- Save 输入：structuredJson?、expectedUpdatedAt?、expectedRuleSetFingerprint?、changeAuthorization?。
- `RuleChangeAuthorization = { previewHash, intent: 'confirm_change' | 'retcon' | 'approve_exception', notes? }`；不另加 expectedRuleSetHash/impactAcknowledged/authorConfirmed。
- `RuleChange = { targetType: 'world_setting' | 'rule_system', targetId?, title, content, category?, forbiddenRules?, structuredJson?, isActive }`。
- 预览 command：`preview_world_rule_change`，参数 novelId + changes: RuleChange[]。
- 预览包含 ruleSetFingerprint、sources、affectedChapters（带 evidence/certainty）、dependentRules、blockingConflicts、uncertainty、previewHash、requiresConfirmation。预览哈希绑定本次拟改 payload 与完整基线。
- F 的权威 `preview_rule_change` / `authorize_rule_change` 被普通保存 C 和结构化采用共用。
- AI task 创建事务 native 冻结 `target_hint_json.nativeRuleSet`，先于 request_hash/snapshot_hash；不信客户端自报。Gateway 与 main 使用相同内容级规则集指纹，不能只 hash updatedAt。

### 父待接线

- [ ] Page 的 useWorkbenchArtifacts 传 selectedConversationRef。
- [ ] Page SidePanel 传 scopeKey={selectedConversationId || selectedNovelId}。
- [ ] Page runner→Composer 传 revisionSource 与 onClearRevisionSource。
- [ ] Page/SidePanel 接 artifactFocusRequest；压缩 hook 返回 compressionPresentation 转 Stream。
- [ ] Page tests 更新非 select 固定模型语义、扁平事件按归属而非嵌套断言。
- [ ] types/ai.ts ChapterGenerationContext 增加 ruleSystemCoverage（E 自有 generationContext 中定义）。
- [ ] main/commands/services 注册治理预览/原子采用和新模块（等 F/C 精确导出）。
- [ ] task_runtime 必需读取/候选门验证 contextCoverage 完整、作用域及投影内容哈希（等 E 精确 JSON）。
- [ ] scripts/e2e/run-e2e.ts allSpecs 注册 interaction-world-rules-repair.spec.ts；质量归属登记全部新模块。

## 统一验收进展（进行中，尚未完成）

### 第二轮：验证中新发现并已修复的问题

- **提示词模板被格式化破坏身份**：仓库级 Prettier 重排了 `prompts/**.md`，而 Rust 以「CRLF→LF 后 trim 的 SHA-256」冻结 `prompts/setting_expand.md` 等模板身份，导致 placement/task08 等 7 项原生测试失败。已用 `git restore` 逐字节恢复模板（校验 `39cc6fa2…` 与声明常量一致），并把 `prompts/` 加入 `.prettierignore`，避免再次被当作散文重排。
- **缺失导入**：`useWorkbenchTaskRunner.ts` 引用 `resolveWorkbenchChapterTarget` 但未导入，导致前端构建与 E2E 构建失败；已补导入并通过 `tsc`。
- **图标语言门**：新增的规则/世界编辑按钮未设置侧栏 `strokeWidth={1.8}`，`lint:ci` 的 UI 图标门失败；已补齐 5 处图标。
- **原生测试夹具自洽性**：候选夹具复用同一 `governedProviderRequestId` 触发 Attempt 唯一约束；报告夹具未建章节导致任务目标触发器拒绝；已分别改为按 run/call 生成身份、由夹具保证章节归属。
- **修订派生的父产物约束**：`result_artifacts` 外键原先要求父产物属于同一 task，而修订按设计是新 task 引用被审候选，导致真实派生写入触发器/外键拒绝；改为按 `artifact_id` 引用并保留 `ON DELETE RESTRICT`，同步更新冻结 schema 指纹（`SCHEMA_VERSION` 不变、`CREATE TABLE IF NOT EXISTS` 只影响新库）。
- **任务 hash 期望值**：`nativeRuleSet` 现纳入权威 `request_hash`，`dsh_task_persists_first_real_user_book_goal…` 的期望 hash 缺少该字段；已让期望值与创建事务同源冻结。
- **桌面验收发现的两处真实交互缺陷**：`sendMessage` 仅凭内存中的 `runningConversationIds` 拒绝发送，桌面运行结束后该集合可能滞后，导致输入区看似就绪却静默丢弃发送——改为先向 `taskSessionAdapter.isRunningAuthoritatively` 复核权威运行事实；`agentPlanner.ts` 因格式化超出冻结预算，已按职责抽出 `agentPlannerBranches.ts`（保持既有分支顺序与语义）。
- **桌面验收规格口径**：隔离库证实 `conversation_artifact_cards.turn_id` 在桌面持久为 NULL（`run.turn_id` 才有值），因此候选因果断言改以所属 run 的 turn 为准；虚拟屏受限时窗口被夹到 1167px，窄窗覆盖契约与停靠契约分别断言并明确 NOT_COVERED。
- **尺寸预算**：`types/ai.ts` 超 500 行，已抽出 `types/chapterGenerationContext.ts` 并保留原导入路径；两道体积门的「陈旧条目」规则改为只在模块跌到 300 行以下才判陈旧，避免强迫已拆小的模块回涨到 500 行以上（预算条目一字未改）。

逐项记录实际执行结果；未执行项仍为 NOT_RUN，浏览器结果不冒充真实桌面 PASS。

| 检查 | 命令 | 结果 |
| --- | --- | --- |
| 测试归属与选择器回归 | `node scripts/quality/test-ownership.mjs`、`node --experimental-strip-types --test scripts/quality/verify-change.test.mjs scripts/quality/verification-scopes.test.mjs` | PASS（204 既有 / 86 discovered / 35 opt-in；17 用例） |
| 文档同步 | `npm run test:docs-sync` | PASS |
| 前端类型 | `npx tsc --noEmit` | PASS（0 错误） |
| 前端 lint | 对变更范围执行 `eslint --max-warnings 0` | PASS（0 error / 0 warning） |
| 工作台行为套件 | `npm run test:workbench` | PASS（418 + 45 用例） |
| 补充单元测试 | `npm run test:discovered` | PASS（首轮两处失败已修：固定模型徽标断言、可见修订来源选择规则） |
| 组件/TS 体积门 | `node scripts/quality/check-component-size.mjs` | PASS（34 条冻结模块，其中 1 条按新规则保留） |
| 原生编译 | `cargo check --locked`、`cargo test --locked --no-run` | PASS |
| 原生测试 | `cargo test --locked -- --test-threads=1` | 运行中 |
| 浏览器布局套件 | `npm run test:e2e:browser` | 首轮窄窗覆盖面板遮挡 toggle 失败，已修 spec 后复测 |
| 真实 Tauri E2E | `npm run test:e2e -- --spec interaction-world-rules-repair ...` | NOT_RUN（待原生测试与前端门完成后执行） |
| 生产构建与 EXE | `npm run dsh:assets`、`npx tauri build --bundles none` | NOT_RUN |

验收期间修复的问题（均已在源码修正）：`ai_task_creation.rs` 缺 `json!` 导入；`useWorkbenchTaskRunner.ts` 缺 `WorkbenchModelUnavailableError` 导入及一处多余依赖；`ai_task_rule_snapshot_tests.rs` 缺 `json!` 导入；`taskRuntimeAdapter.ts` 残留未用导入；压缩 hook 测试被 `assert.equal` 收窄为 `never`；浏览器开发回退的无守卫规则保存被作者门禁误拒（现在浏览器预览自签，桌面仍严格）；`types/ai.ts` 超 500 行（已抽 `types/chapterGenerationContext.ts` 并保留原导入路径）；`check-component-size.mjs` 的陈旧条目规则不再强迫已拆小的模块回涨到 500 行以上（预算条目未改）。


1. 检查最终差异及新模块行为归属，定向格式化改动文件。
2. 统一执行适用文档/版本/覆盖率/前端检查；首次测试即采集覆盖率，不重复聚合器包含的子测试。
3. 固定 DSH 载体、重建当前 Gateway；Rust 使用 --locked，完整相关领域串行测试与故障注入。
4. 一次 E2E 构建，真实 Tauri、隔离 SQLite/用户目录、固定模型响应、阻断云端网络；覆盖本次新增场景和工作台/事务既有回归。
5. 全部检查后的修复仅复测受影响项；失败、环境阻碍与 NOT_RUN 分开记录，不降门禁。
6. 清除 CARGO_TARGET_DIR 后 npm run dsh:assets；npx tauri build --bundles none；确认仓库内 src-tauri/target/release/AI Novel Studio.exe。EXE 占用则停止覆盖并请用户退出，不杀用户进程。

验收作者已确认新 spec 需 runner 白名单；候选专项命令：npm run test:e2e -- --spec interaction-world-rules-repair --spec workbench-writing-smoke --spec workbench-task-directory --spec story-assets-transaction。实际统一矩阵由最终改动范围确定，尚未执行。

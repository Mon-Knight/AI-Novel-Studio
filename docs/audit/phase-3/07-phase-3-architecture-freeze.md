# 07 — Phase 3 架构冻结报告

> 阶段：v2.3.0 + v2.4.0 第一阶段（基线审计与架构冻结）
>
> 基线：feat/v2.2.0-workspace-reliability，package/Cargo 2.2.0
>
> 日期：2026-07-12
>
> 本阶段只新增文档并更新 CHANGELOG；未修改生产代码、数据库或版本号

## 16.1 实际审计范围

已检查：src/components、src/pages、src/hooks、src/services、src/store、src/types、src/utils、prompts、src-tauri/src、package.json、Cargo.toml、AGENTS.md、必读产品/UI/数据文档、版本/架构/模块/Agent 路线文档、phase-1/phase-2 审计报告和 CHANGELOG。

沿 27 个生产触发入口逐条追踪到组件/页面 → Service/Prompt → createAiClient → browser fetch 或 Tauri ai_chat_completion → 解析 → local state/localStorage/SQLite → 编辑器或业务对象。额外审计了工程 job 的隐式质检、修稿后的隐式复检、正文 atomic save/adopt、大文本完整性、恢复/leave guard、legacy localStorage keys 和 migration ledger。

未调用真实付费 AI，未读取/修改用户真实数据库，未运行正式安装包构建。未逐行审计与 AI 管线无关的导入导出、封面、普通 CRUD 样式；它们不影响本阶段结论。ChapterEngineering mock job 无 Provider 调用，未计入生产 AI 入口。

## 16.2 当前主要问题

### P0

1. AiGeneratePanel 的“确认采用”重新查询章节 latest 草稿，可能采用与当前预览不同的另一任务结果。
2. OutlinePanel 章纲、EventsPanel 事件和 ChapterSummaryPanel 结果未绑定生成时 chapter；保持面板打开切章后可写入新章。
3. AI 修稿在用户正式采用前已把 fixRun 标 adopted、旧问题标 resolved、上下文标 expired，并加载候选；多表操作可部分成功。
4. ChapterSummaryPanel 的 summary/context/character state/chapter status 多步写入非事务，且部分错误被吞。

### P1

1. 桌面 draftVersionService.create 调用 save_chapter_draft_atomic 时不传 aiTaskId/note，Rust input/DTO 也无字段；浏览器与 Tauri 来源追踪不一致。
2. ai_task_records 与 generation_jobs 是两套不兼容任务状态；无后端统一状态机、Attempt、正式取消/重试和迟到响应隔离。
3. 部分直接组件调用失败后 task 永留 running；polish record 失败后可永留 pending。
4. 多个全文任务截断 8k/10k 后仍要求完整章节，长正文尾部可能丢失。
5. setting suggestions 的正式写入与 localStorage 候选状态非事务；失败可能重复采纳。
6. 当前幂等 guard 只在页面会话，adopt/业务对象写入无 operationId/expected V/H/target link。

### P2

1. loading/result/error/progress 分散，右栏 toolStates 未接通；面板切换/刷新丢候选。
2. 相同大纲任务在三个 UI 的预览/保存语义不同。
3. Prompt/上下文 source/hash/版本/预算记录不统一；task 的 promptSnapshot 只是截断摘要。
4. chapter/volume summary 都记录为 context_summarize，历史类型不可区分。

## 16.3 AI 调用入口总表

共 **27 个生产触发入口、17 个业务任务族**：

| 分类 | 入口数 | 任务族 |
|---|---:|---|
| 系统连接 | 1 | connection_test |
| 正文生产/加工 | 4 | 章节生成、按大纲修正、工程生成、润色 |
| 质量闭环（含隐式） | 4 | 手动质检、工程后质检、修稿、修稿后复检 |
| 大纲（3 UI × 3 类型） | 9 | 小说/卷/章大纲 |
| 角色/事件/设定 | 4 | 角色、事件、章节设定、设定库候选 |
| 风格 | 2 | 右栏/风格管理分析 |
| 上下文总结 | 3 | 右栏章总结、采用后章总结、卷总结 |

逐入口字段、文件、状态、安全属性与迁移优先级见 00-ai-entrypoint-inventory.md。

## 16.4 当前数据流

~~~text
表单/当前 props/编辑器正文
→ 分散的 contextBuilder 或 Service 内联 Prompt
→ createAiClient
→ Mock / browser fetch / Tauri blocking reqwest
→ 完整字符串
→ 各 Service 自行容错解析
→ panel local state / localStorage / 草稿 / 质量表 / job step
→ 复制、候选草稿、编辑器替换或直接业务 Repository 写入
~~~

主要断点是：Task 不拥有不可变输入与目标；Provider response 与候选/正式对象无统一 Artifact；用户确认没有持久 ApplyPlan；非正文多写入缺 transaction/operation；来源 link 不完整。

## 16.5 建议目标架构

~~~text
AiTask（用户意图与作用域）
→ AiInputSnapshot + AiContextSnapshot + AiConstraintSnapshot
→ AiTaskAttempt
→ Provider Adapter（取消、错误、metadata）
→ ResultArtifact（不可变内容）
→ Artifact Validation
→ PlacementProposal（非权威建议经本地解析）
→ ApplyPlan（不可变操作、V/H、依赖、operationId）
→ Rust authoritative transaction
→ ArtifactTargetLink
~~~

React 只创建/订阅/确认；Task Store 只存摘要和 ID；完整正文/Prompt/上下文使用 large_text_documents/chunks。详细契约见 docs/architecture 下五份文档。

## 16.6 状态机

后端 compare-and-swap 是权威；非法转换统一 AI_TASK_ILLEGAL_TRANSITION。

| 当前状态 | 允许进入 | 触发者 | 持久化 | 非法码 |
|---|---|---|---|---|
| created | preparing_context、cancelled、failed | Task service/用户 | ai_tasks | AI_TASK_ILLEGAL_TRANSITION |
| preparing_context | ready、cancel_requested、failed | Context service/用户 | ai_tasks | AI_TASK_ILLEGAL_TRANSITION |
| ready | queued、cancelled、failed | Scheduler/用户 | ai_tasks | AI_TASK_ILLEGAL_TRANSITION |
| queued | running、cancelled、failed | Worker/用户 | ai_tasks + attempts | AI_TASK_ILLEGAL_TRANSITION |
| running | validating、cancel_requested、failed | Adapter/用户 | ai_tasks + attempts | AI_TASK_ILLEGAL_TRANSITION |
| validating | completed、cancel_requested、failed | Artifact service/用户 | ai_tasks + artifacts | AI_TASK_ILLEGAL_TRANSITION |
| completed | applying | 用户确认/Apply service | ai_tasks + plans | AI_TASK_ILLEGAL_TRANSITION |
| applying | applied、completed | Apply service/reconciler | ai_tasks + plans | AI_TASK_ILLEGAL_TRANSITION |
| applied | 无；幂等读首次结果 | Apply service | tasks + links | AI_TASK_TERMINAL_STATE |
| failed | preparing_context、queued | 显式 retry | tasks + 新 attempt | AI_TASK_RETRY_NOT_ALLOWED |
| cancel_requested | cancelled | Worker/reconciler | tasks + attempts | AI_TASK_ILLEGAL_TRANSITION |
| cancelled | 无 | — | ai_tasks | AI_TASK_TERMINAL_STATE |

Applying 已知回滚时 Plan=failed/blocked、Task 回 completed，保留可重新规划的 Artifact；commit unknown 时 Plan=commit_unknown、Task 暂留 applying，先按 operationId 对账。cancelled/completed 的重新生成创建新 Task；同快照的可重试 Provider 失败在原 Task 下创建新 Attempt。

Artifact 仅持久 processing_status=raw/parsing/valid/valid_with_warnings/invalid；ready_for_placement/partially_applied/applied 从 Proposal/Plan/TargetLink 推导。ApplyPlan 状态为 draft→validated/blocked→ready→applying→completed/failed/commit_unknown，取消只允许 applying 前。

## 16.7 数据库设计

建议序号相对任务书扩展到 016，因为 PlacementProposal 和 TextRangeLock 都是冻结的一等模型，不能塞进万能 JSON。005–015 随 v2.3.0 实施，016 随 v2.4.0 实施；每项进入现有 ledger 并使用固定 checksum。

| Migration / 表 | 职责与 PK/FK | UNIQUE/索引/状态/时间 | 长文本/JSON/幂等 | 删除与 legacy |
|---|---|---|---|---|
| 005_ai_tasks / ai_tasks | Task；task_id PK；逻辑/显式 FK novel/chapter/draft、snapshot、artifact | operation_id UNIQUE；(novel,status,created)、(chapter,created)；完整 Task status；created/started/completed/applied | target_hint/error 版本化 JSON；operation_id + request_hash | RESTRICT/保留；旧 ai_task_records 不回填 |
| 006_ai_task_attempts / ai_task_attempts | Attempt；attempt_id PK；FK task | UNIQUE(task_id,attempt_number)；provider request/status 索引；started/finished | response_metadata/error JSON，无正文；provider request ID 非幂等键 | RESTRICT；generation_jobs 只读映射 |
| 007_ai_input_snapshots | 输入快照；snapshot_id PK；FK task/large-text | UNIQUE(task_id)；source draft/version/hash 索引；created | payload JSON + body_ref；content_hash | 不可变/RESTRICT；legacy 缺失保持 unknown |
| 008_ai_context_snapshots | 上下文快照；snapshot_id PK；FK task/large-text | UNIQUE(task_id)；hash/compiler version；created | source_manifest/budget JSON + compiled_context_ref | 不可变；旧 generation snapshot 不自动转换 |
| 009_ai_constraint_snapshots | 约束/模板；snapshot_id PK；FK task/large-text | UNIQUE(task_id)；template id/version/hash；created | payload/provider_options JSON，无 API Key | 不可变；不伪造旧模板 |
| 010_result_artifacts | Artifact；artifact_id PK；FK task/attempt/raw/display doc/parent | (task,created)、content_hash、processing_status；created | structured_payload 版本化 JSON；正文仅 ref | RESTRICT；旧结果只作 legacy |
| 011_artifact_validation_issues | 校验 issue；issue_id PK；FK artifact | (artifact,severity/code)、validation_run；created | details JSON，无全文 | append-only；无旧数据回填 |
| 012_artifact_placement_proposals | Proposal 头；proposal_id PK；FK artifact/parent proposal | (artifact,created) 索引；无 mutable status，stale 由项目 revision 推导；created | reasons/warnings/unresolved 版本 JSON；project_revision_hash | 不可变/RESTRICT；旧候选不回填，用户改目标建新 Proposal |
| 012_artifact_placement_targets | Proposal 目标；(proposal_id,target_index) 复合 PK；FK proposal | target_type/target_id、novel/chapter、expected V/H 索引；无状态/时间继承 Proposal | target metadata 小型版本 JSON，无长文本/幂等写 | 随 Proposal 审计保留；AI targetId 不能直接迁入权威目标 |
| 013_artifact_apply_plans | Plan；plan_id PK；FK artifact/proposal/parent | operation_id UNIQUE、request_hash、status/created/completed | dependencies/conflicts/expected map 版本 JSON；op+hash 幂等 | RESTRICT；旧 UI guard 不回填 |
| 014_artifact_apply_operations | 具体操作；apply_operation_id PK；FK plan/range lock | UNIQUE(plan_id,operation_index)；target/状态索引；created/completed | payload JSON 只含小字段/ref、payload_hash | 随 Plan 保留；不物理级联审计历史 |
| 015_artifact_target_links | 已提交来源链接；link_id PK；FK artifact/plan/operation | UNIQUE(apply_operation_id,target_type,target_id)；target/committed 索引 | target version/hash/result metadata；operation_id | 审计保留；目标删除不删 link |
| 016_text_range_locks | 正文范围锁；lock_id PK；FK novel/chapter/draft | lock_hash UNIQUE；draft/version/hash 索引；created，无 mutable status | 无正文；仅 hash/UTF-16 indices/anchor config | 不可变；quality offset/recovery selection 不回填 |

删除策略默认审计保留/RESTRICT；用户删除 Task 应先定义归档/软删除，不级联删除 Artifact/target links。关键 ID、状态、V/H 都是独立列，JSON 只承载版本化结构。

## 16.8 事务设计

### 单目标（v2.3）

- chapter_text Artifact 必须调用 save_chapter_draft_atomic 的事务内核心创建新候选；扩展 aiTaskId/artifactId/note/target link，不新写 chapter_drafts SQL。
- 其他目标经对应 Service/Repository，在 Immediate transaction 中校验 novel/target/expected V/H、affected rows，写业务对象、target link 和 operation result。

### 多目标（v2.4）

外层 transaction 不能再调用会自行 begin 的 save_chapter_draft_atomic。抽取 save_chapter_draft_in_transaction；所有 Repository 不拥有 commit。长文本 documents/chunks、业务对象、links、operation result 同一 transaction；ID 在 Plan 中预分配；依赖拓扑排序；任一 zero-row/错误整体回滚。

commit unknown 用新连接按 operationId/requestHash/links 对账；缓存清理在 commit 后，失败只记 warning/强制重读，不把已提交业务误报失败。十项答案见 multi-target-transaction.md。

## 16.9 正文范围锁

索引冻结为 UTF-16 code unit、半开区间。锁包含 draftId/version、baseContentHash、start/end、selectedContentHash、64-unit 前后锚点 hash 和 encoding。Rust 实现显式 UTF-16→byte 边界转换；CJK/Emoji/组合字符共享测试向量。

默认不自动模糊写入。只在选区 hash 唯一命中且双锚点于有界窗口匹配时提供“重定位建议”；用户确认后创建新 lock/Proposal/Plan。任何冲突不得降级为整章覆盖。

## 16.10 兼容策略

- v2.1.1/v2.2.0 业务表和正文历史原样保留；005+ 只增表/索引。
- ai_task_records、generation_jobs/steps/snapshots 通过 Legacy 只读投影展示，不伪造三类快照/trace/op/hash。
- quality/polish/fix/outline context 等保留原语义；旧 fix status=adopted 不推断正式 adopt。
- localStorage 两个 AI task key 继续兼容合并；setting suggestions 保持 legacy，不自动转 Artifact。
- 任务中心双读期间 legacy 行不提供 retry/cancel/replay/apply。

## 16.11 v2.3.0 和 v2.4.0 边界

### v2.3.0

统一 AI Task、Provider Adapter、不可变输入/上下文/约束快照、Result Artifact 与校验、取消/重试/迟到隔离、任务中心、单目标 Proposal/ApplyPlan/安全应用、来源追踪基础。先迁移高风险正文/质量入口，再迁移其他入口。

### v2.4.0

Context Builder 与全局预算、Constraint Builder、Target Resolver、TextRangeLock、多目标 Proposal/ApplyPlan、依赖排序、多目标 SQLite 原子事务、多目标幂等、完整来源追踪和应用 diff 预览。

### 明确排除

知识图谱可视化、全自动整本连续生成、无确认多目标静默写入、向量数据库、云同步、多用户协同、Prompt 市场、模型评测平台、全面重构历史 Rust command、清零无关 warning、无关 UI 大改。

## 16.12 文件实施计划

### 预计新增（后续阶段）

- 前端类型：src/types/ai-task.ts、result-artifact.ts、artifact-placement.ts、apply-plan.ts、text-range-lock.ts。
- 前端 Service/Store/Hook：src/services/ai-tasks、artifacts、context、placement、apply；src/store/aiTaskStore.ts；src/hooks/useAiTask.ts/useArtifactPlacement.ts。
- Rust：commands/ai_tasks.rs、artifacts.rs、artifact_apply.rs；services/ai_task_service.rs、artifact_service.rs、artifact_apply_service.rs；对应 repositories/domain。
- 测试：状态机、Artifact parser、Provider delay/cancel、SQLite apply、UTF-16 parity、migration fixtures。

### 预计修改

- migrations.rs/db 初始化（仅账本接入）、main.rs command 注册；RealAiClient/ai.rs Provider Adapter；draft_service/draftVersionService 来源字段与事务内核心。
- 27 个入口按 P0→P1→P2 小步迁移；每次只迁一个任务族并保留 legacy 读。

### 保留

现有业务 repositories、save_chapter_draft_atomic、large-text、workspace safety/recovery、旧表/旧 Service/路由；不做全量 command 重构。

## 16.13 测试计划

06-v2.3-v2.4-test-matrix.md 冻结 73 个用例，覆盖前端、Rust、SQLite 和集成层：Task 合法/非法转换、取消迟到/Attempt、Artifact malformed/大文本/不可变、目标伪造/过期、单/多目标回滚/幂等/commit unknown、UTF-16 CJK/Emoji/组合字符，以及空库/v2.1.1/v2.2.0/browser/Tauri 兼容。

新增专项入口必须拒绝零测试假绿，并继续运行现有 lint/build/test/workspace/large-text/migration/cargo 回归。

## 16.14 主要风险

| 风险 | 冻结控制 |
|---|---|
| 任务状态并发 | 后端 CAS + affected rows=1 + Task/Attempt 分离 |
| Provider 迟到响应 | cancel_requested、Adapter abort、late_response_ignored，不建可应用 Artifact |
| 旧面板迁移 | 双读、逐任务族迁移、未迁移入口不由占位 Store 接管 |
| 嵌套 transaction | 仅最外层 Service begin/commit；抽取 draft transaction 内核心 |
| 多目标幂等 | operationId UNIQUE + canonical requestHash + 首次 result/links 重放 |
| 选区索引语义 | UTF-16 明确定义 + TS/Rust 共享向量 + hash/anchors |
| 旧数据兼容 | A/B/C/D 分类；unknown 不回填；新表只增不改正文 |
| 大文本完整性 | 复用 documents/chunks，所有分片/引用同一 transaction，fail-closed |
| 前端 optimistic success | 仅 Plan completed + target links 后成功；commit_unknown 显式对账 |
| Prompt 隐私 | 完整内容只进受控大文本，不进 console/Store/AppError；API Key 永不持久 |
| 来源 FK 不一致 | 不再把 generation job ID 塞进 ai_task FK；统一 ArtifactTargetLink |
| P0 旧行为存续期 | v2.3 首个里程碑先加结果目标绑定和禁用提前副作用，再开放新 Task Center |

## 16.15 是否可以进入第二阶段

**可以进入 v2.3.0 实施**

依据：27 个生产入口及隐式调用已追到 Provider 和最终应用；当前状态、Prompt/上下文、数据库、legacy、领域模型、状态机、事务、迁移、版本边界与测试矩阵均已冻结；基线构建和独立顺序回归通过。P0/P1 已转化为明确的首批实施门槛，不存在需要继续猜测的架构空白。

进入实施的第一顺序必须是：结果绑定生成时目标 → 禁止质量修复提前产生正式副作用 → 修复 Tauri 草稿来源丢失 → 落后端 Task/Attempt 状态机与测试。不得先做完整任务中心 UI 或多目标写入。

## 附录 A：开始前基线真实结果

| 命令 | 结果 |
|---|---|
| npm run lint | exit 0；0 error，1 warning：ChapterEngineeringPanel.tsx:325 React Hook 缺 chapter 依赖 |
| npm run build | exit 0；tsc/Vite 成功，197 modules；6 组 dynamic/static import warning，1 个 >500 KiB chunk warning；主 JS 794 kB（gzip 244.94 kB） |
| npm run test | 5/5 通过 |
| npm run test:workspace-reliability | 3 files，10/10 通过；stderr 为预期注入错误/React Router future flag |
| npm run test:workspace-recovery | 与 reliability 并发的首次运行 7/8，T11 等待 in-flight snapshot write 时序失败；单独顺序重跑前端 8/8、Rust 29/29 通过，判定为并发测试干扰，已保留记录 |
| npm run test:large-text-integrity | 前端 4/4、Rust 29/29 通过；DATABASE_BUSY 为预期故障注入日志 |
| npm run test:migrations | 前端 1/1、Rust 29/29 通过 |
| cargo test --manifest-path src-tauri/Cargo.toml | 29/29 通过；10 条既有 Rust warning |
| cargo check --manifest-path src-tauri/Cargo.toml | 通过；同 10 条既有 warning（unused mut 与未使用类型/字段/函数） |
| git diff --check | 通过；开始审计时 worktree clean |

并发抖动不是通过修改测试消除的；最终回归必须按任务书顺序单独执行 recovery，以确认文档变更没有改变运行行为。

## 附录 B：文档完成后的最终回归

| 命令 | 最终结果 |
|---|---|
| npm run lint | exit 0；0 error，1 条同一既有 Hook warning |
| npm run build | exit 0；197 modules；同 6 组 mixed-import 和 1 个 chunk-size warning |
| npm run test | 5/5 通过 |
| npm run test:workspace-reliability | 3 files、10/10 通过 |
| npm run test:workspace-recovery | 串行执行：前端 3 files、8/8；Rust 29/29 通过 |
| npm run test:large-text-integrity | 前端 2 files、4/4；Rust 29/29 通过；注入日志符合预期 |
| npm run test:migrations | 前端 1 file、1/1；Rust 29/29 通过 |
| cargo test --manifest-path src-tauri/Cargo.toml | 29/29 通过，10 条既有 warning |
| cargo check --manifest-path src-tauri/Cargo.toml | exit 0，10 条同一既有 warning |
| git diff --check | 通过；新增文档另做行尾空白/EOF 检查，均通过 |
| git status | 仅 CHANGELOG.md 和指定 docs 新文件；未创建分支、未提交、未推送 |

本阶段未修改 Cargo/Tauri command/migration 启动路径，按任务书无需运行 npm run tauri build。

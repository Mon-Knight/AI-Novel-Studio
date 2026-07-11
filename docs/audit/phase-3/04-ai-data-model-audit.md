# 04 — AI 数据模型与迁移审计

## 1. 初始化与迁移事实

数据库启动顺序是：create_base_tables → db.rs 中的 imperative ensure-column migrations → create_indexes → outline_commands::create_outline_tables → migrations::run_migrations。

v2.2.0 正式账本只有四项：001_schema_migrations、002_workspace_recovery_snapshots、003_draft_save_operations、004_large_text_integrity；每项固定 definition checksum 并在独立 transaction 中登记。更早的大部分表演进仍由 db.rs 的列存在检查完成，outline 表也在账本外创建。

PRAGMA journal_mode=WAL 和 foreign_keys=ON 在生产连接初始化时启用。新 v2.3+ 表必须全部进入正式 ledger，不再扩展账本外的 ensure-column 路径。

## 2. 当前 AI/生成/质量表

| 表 | 职责；PK/归属 | 版本/hash/status | 大文本 | FK/唯一 | 可复用性与迁移风险 |
|---|---|---|---|---|---|
| ai_task_records | 旧 AI 历史；PK TEXT UUID；novel_id/chapter_id 可空 | 无 task version/hash；status pending/running/succeeded/failed/cancelled | prompt/result 均 inline 且 Service 截300–500 | FK novel/chapter；无业务唯一/operation | **部分**：legacy 列表投影；缺 Attempt、Snapshot、trace/op、target/artifact，不可升级原地冒充新 Task |
| generation_jobs | 章节工程 job；PK UUID；novel/chapter/volume | retry_count；status/progress；无 payload hash | 无正文列 | FK novel/volume/chapter；无 operation 唯一 | **部分**：迁为 legacy Task 投影；状态 update 任意 patch，取消不 abort |
| generation_step_results | job step；PK UUID；job_id | step status；无 version/hash | input/output JSON 和 output_text inline | FK job；无 UNIQUE(job,step) | **部分**：可作 legacy attempt/step 证据；完整输出不应继续 inline |
| chapter_generation_snapshots | 工程编译快照；PK UUID；novel/chapter/volume | context_hash；无 schema/source version/base draft | compiled prompt/context inline | FK novel/volume/chapter/engineering；无 job FK/唯一 | **部分**：内容线索可保留；不能当三类正式 Snapshot，长 Prompt 需大文本引用 |
| chapter_engineering_states | 章节工程配置；PK UUID；novel/chapter/volume | draft_version/active_version/status | JSON inline | FK novel/volume/chapter；无 chapter+version 唯一 | **部分**：Constraint Builder 来源；需要 source version/hash 引用，不复制为万能 snapshot |
| quality_check_reports | 质检报告；PK UUID；novel/chapter/draft | draft_version/content_hash/content_length/status | summary inline | FK novel/chapter/draft/ai_task；无 request/operation 唯一 | **部分到完全**：正式业务对象可保留；补 Artifact link 和幂等，不回填未知 task |
| quality_check_items | 报告问题；PK UUID；novel/chapter/draft | status、issue_key；offset 无正文锁 | evidence/suggestion/quote inline | FK report/novel/chapter/draft；issue_key 仅 index | **部分**：质量 Artifact payload/目标；旧 offset 只定位，不能作 TextRangeLock |
| polish_records | 润色过程；PK UUID；novel/chapter/source/result draft | status；无 source version/hash | instruction inline | FK novel/chapter/drafts/ai_task | **部分**：legacy 来源证据；失败路径可留 pending，不能当 ApplyPlan |
| quality_fix_runs | 修稿比较；PK UUID；novel/chapter | source/target draft version 与 content hash、status | changed_ranges/warnings/IDs JSON inline | 仅 FK novel/chapter；draft/report 无 FK/唯一 | **部分**：legacy 审计；status=adopted 与正式 adopt 不同，hash 实现需验证 |
| context_read_logs | 上下文读取摘要；PK UUID；novel/chapter/volume | 无 source version/hash；无状态 | IDs/warnings JSON inline | 无声明 FK/唯一 | **部分**：审计线索；used IDs 不完整，不能重建请求 |

## 3. 正文、上下文与业务目标表

| 表 | 职责；PK/归属 | 版本/hash/status | 大文本 | FK/唯一 | 可复用性与迁移风险 |
|---|---|---|---|---|---|
| chapter_drafts | 正文版本；PK UUID；novel/chapter | version_no、content_hash、is_adopted、source | inline 或 large_text_ref_id | FK novel/chapter/ai_task；只有 chapter index，无 UNIQUE(chapter,version) | **完全复用写入边界**；必须继续走 atomic service。当前 Tauri 原子 create 丢 ai_task_id/note |
| chapters | 章节目标与正式采用指针；PK UUID；novel/volume | status、adopted_draft_id；无行 version/hash | outline inline | FK novel/volume；无 adopted draft FK | **部分**：权威目标；Apply 需 expected revision/hash 或独立 revision 方案 |
| chapter_summaries | 章节上下文；PK UUID；novel/chapter/volume/draft | draft_version/content_hash/is_expired/validation_status/enabled | summary inline 或 large_text ref | FK novel/chapter/adopted draft；ai_task_id 列无明确新增 FK 迁移风险 | **完全保留业务数据，部分复用应用**；来源/operation link 缺失 |
| context_records | 手动/卷/章上下文；PK UUID；novel，可选 chapter/volume | draft_version/content_hash/is_expired/is_active | inline 或 large_text ref | FK novel/chapter；volume 无声明 FK；无唯一 | **部分**：Context Builder 来源；多条重复和版本语义需明确 |
| characters | 正式角色；PK UUID；novel | active/source/source_type；无行 version/hash | 多字段 inline | FK novel；UNIQUE(novel,protagonist_key) 条件索引 | **完全保留，部分复用 Apply**；需 expected revision、artifact link |
| character_states | 角色章节状态；PK UUID；novel/character/可选 chapter | 无 version/hash/status | inline | FK novel/character；chapter 无 FK、无唯一 | **部分**：多目标 summary Apply；易重复，需幂等键 |
| chapter_characters | 章-角色关系；PK UUID；novel/chapter/character | must_appear，无 version/hash | inline | FK 三者；UNIQUE(chapter,character) | **完全复用领域关系**；Apply 检查 affected rows |
| chapter_events | 章节事件；PK UUID；novel/chapter | status/source；无 version/hash | description inline | FK novel/chapter；ai_task_id 无 FK；无唯一 | **部分**：正式目标；补来源 link/expected revision |
| world_settings | 世界设定；PK UUID；novel | is_active；无 version/hash | inline 或 large_text ref | FK novel；无唯一 | **部分**：正式目标；需重复/版本/来源策略 |
| rule_systems | 规则体系；PK UUID；novel | is_active；无 version/hash | inline 或 large_text ref | FK novel；无唯一 | **部分**：同上 |
| protagonists | 旧/单主角结构；PK UUID；novel | 无 version/hash/status | inline | FK novel；无唯一 | **legacy/上下文来源**：与 characters/novels JSON 并存，不在本阶段合并 |
| style_profiles | 风格方案；PK UUID；novel 可空 | is_active/source_type；无 version/hash | inline 或 large_text ref | FK novel；无唯一 | **部分**：Artifact 单目标；需 Task scope/link |
| output_profiles | 输出方案；PK UUID；novel 可空 | is_default；无 version/hash | inline 或 large_text ref | FK novel；无唯一 | **上下文来源**；不是 AI 结果表 |
| master_outlines | 作品总纲；PK UUID；project_id | version/status/is_active | inline/context_snapshot 或 large_text ref | **无 FK**；无 project+version 唯一 | **部分**：保留历史；表在 migration ledger 外，context_snapshot 截断/来源可能不准 |
| volume_outlines | 分卷纲；PK UUID；project/volume/master | version/status/is_active | 同上 | 无 FK/唯一 | **部分**：同上 |
| chapter_outlines | 章节纲；PK UUID；project/chapter/volume outline | version/status/is_active | 同上 | 无 FK/唯一 | **部分**：同上 |
| novels / volumes | 作品与卷目标 | status；无通用 row version/hash | 描述/summary inline | volumes FK novel | **权威 scope/target**；新 Apply 后端必须验证归属与 soft-delete |

## 4. v2.2.0 基础设施表

| 表 | 职责；PK | hash/status/长文本 | 约束 | 复用结论 |
|---|---|---|---|---|
| schema_migrations | 迁移账本；migration_id PK | checksum/version/applied_at | 每 ID 唯一 | **完全复用**；005+ 固定 definition checksum |
| draft_save_operations | 正文保存幂等；operation_id PK | request_hash、started/completed/failed、result_json | operation 唯一；目标索引 | **完全复用模式**；Apply 使用独立表但相同语义 |
| large_text_documents | 多态大文本头；id PK | total chars/bytes/chunks/full SHA/status/storage type | target 组合索引，无多态 FK | **完全复用**；Snapshot/Artifact/Prompt 只存 ref |
| large_text_chunks | 分片；(document_id,chunk_index) 复合 PK | char/byte/chunk SHA | FK document ON DELETE CASCADE | **完全复用**；必须加入 Apply 同一 transaction |
| workspace_recovery_snapshots | 未保存正文恢复；(novel,chapter) PK | base draft/version/hash、recovery hash、selection | 更新时间索引 | **不作为 AI Snapshot**；可借鉴范围字段，职责保持独立 |

## 5. 当前不存在的结构

| 领域 | 审计结论 |
|---|---|
| AI 消息/对话 | 无生产表；请求 messages 仅发送时存在或被工程 compiled_prompt 内联。 |
| Prompt 模板表 | 无；模板在 prompts 文件或 Service 内联。不得凭空迁移模板 ID。 |
| Result Artifact | 无统一表；草稿、质量报告、localStorage 候选和组件 local state 分散承担。 |
| Placement/Apply/Target link | 无；只有页面会话 idempotency guard 与 draft_save_operations。 |
| Text Range Lock | 无；quality offsets 和 recovery selection 不等价。 |
| 设置建议 SQLite 表 | 无；ai_novel_studio_setting_suggestions 仅 localStorage。 |
| 时间线 | 无统一 timeline 表；chapter_events 是章节事件，不是通用时间线。 |
| 来源关系 | 只有若干 ai_task_id/source 字段，未形成可查询的 ArtifactTargetLink。 |

## 6. 可复用结论

1. **必须复用**：schema_migrations、large_text_documents/chunks、save_chapter_draft_atomic、draft_save_operations 的幂等范式、AppError、章节/草稿领域表和现有 repositories。
2. **只作 legacy 输入**：ai_task_records、generation_jobs/steps/snapshots、polish_records、quality_fix_runs、outline context_snapshot。
3. **不应复用为新模型**：workspace recovery snapshot（职责不同）、quality offset（非范围锁）、rightSidebar tool state（非任务状态）。
4. **禁止**：删除/改名旧表、回填并不存在的 snapshot/hash/trace/op/target、在 React 组件中新写 SQL、建立第二套正文保存。

## 7. 数据风险

- chapter_drafts 初始 schema 声明 ai_task FK，但 create_base_tables 的表顺序先创建 drafts 后创建 ai_task_records；SQLite 允许声明，生产 foreign_keys=ON 后写入必须存在。generation job ID 并不是 ai_task_records ID，即便字段未丢也可能违反该 FK；新来源应改用 ArtifactTargetLink，不能把 jobId 假装 aiTaskId。
- chapter_drafts 没有 UNIQUE(chapter_id, version_no)；atomic service 用 Immediate transaction 规避并发，但迁移/测试需继续验证。
- outline 表和许多历史 ALTER 不在正式 ledger，v2.1.1/v2.2.0 升级测试必须从真实旧形态开始，不能只测空库。
- 多处 JSON 缺 schemaVersion；新表只接受版本化 JSON，旧 JSON 原样保留为 legacy。

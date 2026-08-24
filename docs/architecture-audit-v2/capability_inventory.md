# AI Novel Studio 能力整合版 Capability Inventory

## 1. 文档关系与计数口径

本文件是“审计结果进入整合层”后的能力清单。逐项入口、调用链和证据明细保留在 [`docs/audit-v2/capability_inventory.md`](../audit-v2/capability_inventory.md)；本文件增加 canonical Domain Capability、重复组和迁移归属，作为后续 Agent 设计入口。

计数单位仍是独立能力族，而不是文件/表/command：

- 90 张 SQLite 表（含内部表和旧表）
- 262 个 command 定义，254 个普通注册
- 18 个 TS Tool descriptor，11 个 DSH canonical Tool
- **75 个独立能力族**
- **14 组宏观重复/重叠能力**，展开为 **16 个具体冲突簇**
- 其中 **13 个具体簇可归并到 facade**，**3 个具体簇只做边界/事实源治理**

健康基线：21 `WORKING`、37 `PARTIAL`、3 `BROKEN`、11 `LEGACY`、3 `UNKNOWN`。

计数说明：DUP-15（草稿/版本事实）是 Writing lifecycle 的具体展开，DUP-16（同名 `chapter.read_outline` 语义）是 Structure/outline 的具体展开；两者不新增宏观用户领域。完整交叉表见 [`duplicate_analysis.md`](./duplicate_analysis.md)。

## 2. 整合后的 Domain Capability 目录

| Canonical Domain Capability | 核心动作                                             | 主要权威实现                                                          | 真实用户入口                             | 当前健康                      | 整合策略                             |
| --------------------------- | ---------------------------------------------------- | --------------------------------------------------------------------- | ---------------------------------------- | ----------------------------- | ------------------------------------ |
| `novel`                     | list/read/create/update/delete（删除语义待修）       | project/world/volume/chapter repositories + services                  | `/novels`、作品详情、Writing Workspace   | PARTIAL（删除 BROKEN）        | 读写 facade；删除单独 gate           |
| `structure`                 | volume/chapter/outline read/version/edit             | `volumeService`、`chapterService`、`outlineService`                   | 卷章树、手工大纲、隐藏旧大纲页           | PARTIAL                       | 统一 ownership/revision facade       |
| `writing`                   | generate/continue/rewrite、candidate publish         | `chapterGenerationExecutionService` + `workbenchChapterWriter`        | Workbench 任务；旧生成面板               | PARTIAL                       | Writer/SubAgent 唯一入口；旧面板迁移 |
| `context`                   | read/search/summary-propose/compress/activate        | `chapterSummaryService`、`contextRecordService`、compression provider | 总结面板、Workbench 压缩、Prompt context | PARTIAL（确定性压缩 WORKING） | 一个上下文 facade，多种 provider     |
| `memory`                    | ingest/search/state projection/invalidate            | SQLite `memoryService` + memory repositories                          | Workbench memory Tool、采用后沉淀        | PARTIAL（词法链 WORKING）     | SQLite 唯一事实源，旧 Map 仅 adapter |
| `quality`                   | review/gate/fix-propose                              | Rust quality services + `qualityCheckService`/range engine            | 总结/检查旧面板、生成内部                | PARTIAL                       | 报告、门禁、修复分动作               |
| `characters`                | list/read/state/candidate-propose                    | character/state repositories + services                               | 作品角色库；章节面板已退休               | PARTIAL                       | 章节绑定与事件另设可见入口后再开放   |
| `story_assets`              | faction/location list、transaction prepare/apply     | content transaction service                                           | Story Assets 页面                        | PARTIAL                       | 只暴露 UI 已支持 target 类型         |
| `style`                     | profile CRUD/read/analyze/prompt-project             | style profile service + analyzer + projection                         | `/styles`、参考资料分析                  | PARTIAL                       | 参考资料仅是输入 adapter             |
| `reference`                 | import/list/read-section/activate/delete             | reference library service/repository                                  | 作品参考资料页                           | PARTIAL                       | 文件权限和事务 facade                |
| `transfer`                  | TXT/JSON import、TXT/MD/backup export/restore        | project backup + export/import services                               | 导入导出中心、设置                       | PARTIAL（完整备份链 WORKING） | 统一文件确认与事务                   |
| `artifact_runtime`          | conversation/run/tool event/artifact/decision/review | conversation repository + Artifact service                            | Workbench、审阅工作台                    | WORKING（决策链）             | 内部事实 + canonical manifest        |

## 3. 75 个能力族的整合归属

下表用 ID 范围保留审计基线，避免整合后重复计数。`→` 表示迁移到的 canonical domain；括号为健康状态。

| 审计 ID      | 整合归属                          | 状态            | 备注                                                                                             |
| ------------ | --------------------------------- | --------------- | ------------------------------------------------------------------------------------------------ |
| PRJ-01       | `novel`                           | WORKING         | 作品列表/创建/打开/基础编辑                                                                      |
| PRJ-02       | `novel`                           | BROKEN          | 桌面只软删除主记录                                                                               |
| PRJ-03～06   | `novel`/`characters`              | PARTIAL         | 设定、规则、主角、作品角色                                                                       |
| PRJ-07～10   | `structure`                       | WORKING         | 卷章树、创建、草稿历史                                                                           |
| PRJ-11～16   | `writing`/`artifact_runtime`      | WORKING         | CAS、采用、恢复、大文本                                                                          |
| PRJ-17       | `structure`                       | PARTIAL         | 三层大纲持久化/ownership 风险                                                                    |
| PRJ-18       | `context`                         | PARTIAL         | 总结/上下文事实                                                                                  |
| PRJ-19       | `memory`                          | WORKING         | FTS/词法检索                                                                                     |
| PRJ-20       | `memory`                          | PARTIAL         | embedding/混合检索                                                                               |
| PRJ-21       | `characters`                      | LEGACY          | 章节角色/事件旧面板                                                                              |
| PRJ-22～23   | `story_assets`                    | PARTIAL         | 势力、地点、跨章事务                                                                             |
| PRJ-24       | `story_assets`                    | UNKNOWN         | 后端额外关系无生产 UI                                                                            |
| PRJ-25       | `style`                           | PARTIAL         | 风格/输出方案                                                                                    |
| PRJ-26       | `style`/`transfer`                | PARTIAL         | 用户模板 LocalStorage                                                                            |
| PRJ-27～28   | `reference`/`style`               | PARTIAL         | 资料库与风格提取                                                                                 |
| PRJ-29～32   | `transfer`                        | PARTIAL/WORKING | TXT/JSON、导出、完整备份                                                                         |
| PRJ-33       | `story_assets`                    | PARTIAL         | 资产聚合导航                                                                                     |
| PRJ-34       | `transfer`                        | BROKEN          | 导入资产统计硬编码                                                                               |
| PRJ-35       | `artifact_runtime`                | LEGACY          | 旧 ai_task_records 页面                                                                          |
| PRJ-36       | `artifact_runtime`                | BROKEN          | 数据修复只操作 LocalStorage                                                                      |
| SYS-01～02   | `artifact_runtime`（内部）        | PARTIAL         | Provider/本地模型健康                                                                            |
| SYS-03       | `artifact_runtime`（内部）        | WORKING         | 请求治理                                                                                         |
| SYS-04～06   | `artifact_runtime`（内部）        | PARTIAL/WORKING | 诊断、更新、桌面设施                                                                             |
| SYS-07       | —                                 | LEGACY          | 静态安全提醒，不是能力                                                                           |
| AI-01        | `writing`/`artifact_runtime`      | PARTIAL         | 模型请求/流式/取消                                                                               |
| AI-02        | `writing`                         | WORKING         | context/prompt/snapshot 编译                                                                     |
| AI-03        | `writing`                         | PARTIAL         | 章节正文 writer                                                                                  |
| AI-04        | `structure`                       | PARTIAL         | 大纲候选                                                                                         |
| AI-05～07    | `characters`/`story_assets`       | PARTIAL         | 角色/事件/设定候选                                                                               |
| AI-08        | `writing`                         | PARTIAL         | rewrite/polish                                                                                   |
| AI-09        | `quality`                         | PARTIAL         | 质量报告候选                                                                                     |
| AI-10、AI-13 | `context`                         | PARTIAL/WORKING | 总结候选、确定性压缩                                                                             |
| AI-11        | `style`                           | PARTIAL         | 风格分析                                                                                         |
| AI-12        | `artifact_runtime`（内部）        | WORKING         | 固定 readiness DAG                                                                               |
| AI-14～18    | —                                 | LEGACY          | DSH 实验、旧 scene/fix/autonomous/multi-agent                                                    |
| AG-01        | `artifact_runtime`                | WORKING         | 对话/Run/ToolEvent 持久化                                                                        |
| AG-02        | `artifact_runtime`                | PARTIAL         | 固定 TS fallback orchestration                                                                   |
| AG-03        | `artifact_runtime`                | UNKNOWN         | 固定 DSH preparation 已有真实工具调用证据；完整 Workbench 的外部 DSH LLM tool selection 仍未验证 |
| AG-04～06    | `artifact_runtime`                | PARTIAL         | 三份 Registry/health projection                                                                  |
| AG-07        | `artifact_runtime`                | WORKING         | Artifact/Card/Decision/Authorization                                                             |
| AG-08        | `artifact_runtime` + 各 domain    | PARTIAL         | structured apply                                                                                 |
| AG-09～10    | `artifact_runtime`（内部）        | WORKING         | AI facts、Plan runtime                                                                           |
| AG-11        | `story_assets`/`artifact_runtime` | PARTIAL         | placement adapter                                                                                |
| AG-12～14    | —                                 | LEGACY          | 旧 generation、旧 Agent、旧 memory Map                                                           |

## 4. 归并后的核心动作面

同一能力只在 Agent manifest 中出现一次，动作通过稳定的 verb 区分：

```text
novel.read
structure.read
structure.edit (user-confirmed)
writing.generate
writing.continue
writing.rewrite
context.read
context.search
context.propose_summary
context.propose_compression
memory.search
characters.read
story_assets.read
story_assets.prepare
quality.review
style.read
style.analyze
reference.read
transfer.export
transfer.backup
artifact.review
artifact.apply_approved
```

其中 `writing.*`、`context.propose_*`、`quality.review`、`style.analyze` 是 SubAgent 结果，不是直接 database Tool；`*.edit/apply/export` 带用户确认或文件权限。

本节列的是整合后的完整动作候选面；首期给 Main Agent 的稳定 public manifest 再收敛为 18 个动作，具体以 [`tool_mapping.md`](./tool_mapping.md) 为准。

## 5. 当前应保留/迁移/废弃的能力

### 保留为生产权威

- SQLite project/structure/draft/adoption services。
- `chapterGenerationExecutionService` 与 context compiler。
- `workbenchChapterWriter`（过渡期 writer adapter）。
- SQLite memory service、chapter summary/context service。
- ResultArtifact、artifact decision、review authorization、CAS adopt。
- project backup serializer/export service。
- canonical DSH task session作为运行时适配层（待 manifest 统一）。

### 迁移到 facade

- 旧 generation/outline/quality/style/reference UI。
- `useWorkspaceSummary`、volume summary、scene/beat orchestration。
- placement/content transaction 与 setting suggestion 的 proposal/apply。
- legacy Agent 的只读领域查询。
- LocalStorage templates/settings/import/suggestions（先双读单写，后迁移）。

### 先隔离、后决定是否废弃

- Autonomous Planning/scheduler。
- Multi-Agent runtime。
- `AgentChatWorkspace`/legacy `agentLoop`。
- E2E-only right-dock AI panels。
- hidden Outline route 和 ComingSoon route。

整合层不直接删除任何上述代码；删除需另立版本任务并具备回滚证据。

## 6. 反向扫描发现的事实源阻断

以下项目属于能力清单中的 `PARTIAL/BLOCKED` 细节，不能仅凭 service 或 command 存在就计为可用：

- Outline 新版本与 active pointer 可能分离；`structure.read` 必须能读回刚保存且已激活的版本。
- Summary candidate 的人工 bundle 保存和 Workbench artifact apply 不是同一语义；无真实 adopted draft 时不能使用占位 ID 通过 FK/ownership 校验。
- 草稿事实必须以 SQLite `draftVersionService`/`chapters.adopted_draft_id` 为准，旧 LocalStorage 与内存 revision 只允许带来源标记的兼容读取。
- 角色数据存在 `novels` JSON、`protagonists`、`characters` 三轨；Agent 只能看到统一 `characters.read` projection。
- `ai_tasks`、旧 `ai_task_records` 和 generation jobs 不能在 Tool 层被当作同一执行状态；必须以 task/trace 映射统一观测。
- 多套 context compiler 和多源 Registry 在完成 hash/drift gate 前，不得把 Main Agent 或 SubAgent 标为 ready。

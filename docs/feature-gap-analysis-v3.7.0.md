# AI Novel Studio v3.7.0 功能缺口与口径对照

> 审计日期：2026-09-09
> 审计基线：`v3.7.0`（`package.json` / `src-tauri/Cargo.toml`）、React 18 + TypeScript + Tauri 1.x + Rust + SQLite
> 文档性质：对照当前可执行代码的缺口清单与文档口径校正。**不授权下一版本开发，不宣称 R4 VERIFIED。**
> 历史快照：[`feature-gap-analysis-v3.0.0.md`](feature-gap-analysis-v3.0.0.md)（2026-07-28）、[`audit-v2/`](audit-v2/)、[`architecture-audit-v2/`](architecture-audit-v2/) 保留原文，不得把旧表改写成当前状态。
>
> **2026-09-27 补充**：第 2～5 节保留 2026-09-09 截面；后续修复、证据变化与总体处置见[第 6 节](#gap-review-20260927)。特别是有界字数自动修正已实现，不能继续按下方旧清单认定完全没有自动修正。下一版统一规划见 [v3.8.0 完整计划](version-roadmap.md#v380-integrated-plan)。

---

## 1. 审计方法与结论口径

证据优先级：

1. 当前可执行代码、migration、共享 Manifest 与宿主 allowlist；
2. 自动化测试与已记录的真实/故障注入验收；
3. 当前权威文档（README、版本路线、工作台架构、Writing SubAgent 契约）；
4. 带日期的历史审计，只用于解释演进，不作为当前待办。

状态定义：

- **已关闭**：用户或宿主入口与持久事实已对齐，且有对应测试或验收记录。
- **部分具备**：主路径可用，但覆盖面、真实模型或并行入口仍有限制。
- **仍开放**：没有完整协议、未验收，或文档曾误写成未放行。

优先级只表示建议顺序，不构成已授权任务。

---

## 2. 执行摘要

v3.7.0 已开放 Writing SubAgent（桌面端 + 真实 API 模型的 `chapter_write` 默认经 DSH 提交 candidate-only 正文）与 ZCode 工作台。四项 Canonical 只读工具已是 `stable + working`；R4 live 云端仍 **NOT VERIFIED**。2026-08 审计列出的三个 BROKEN 入口，以及 GAP-09 / 10 / 11 / 15 / 16 / 18 / 19，代码侧已收口。多份“当前”文档仍把写章写成未接管 DSH，或把级联删除 / 数据修复 / 资产计数写成假入口——那是文档漂移，不是当前代码。

写章双路径：

- 桌面端 + `runtimeMode=api`：默认 `writing-subagent`（`localStorage['ai_novel_studio_writing_subagent_dsh']='0'` 可关闭）。
- mock / 本地模型 / 浏览器：`deterministic-writer`。

---

## 3. 已关闭项（对照代码）

| 条目                      | 历史说法                       | v3.7.0 代码事实                                                   | 证据                                                                     |
| ------------------------- | ------------------------------ | ----------------------------------------------------------------- | ------------------------------------------------------------------------ |
| GAP-09 / Writing SubAgent | Writer 服务不是独立 SubAgent   | 桌面 + 真实 API 默认走 DSH `chapter_write`，candidate-only        | `writing-subagent-contract.md` E-0～E-4；E-4a / E-4b PASS                |
| GAP-10                    | 通用 apply 覆盖面过大          | 前端单一策略源 `structuredApplyPolicy`；Rust 白名单仍是最终权威   | `structuredApplyPolicy.ts`；CHANGELOG v3.7.0                             |
| GAP-11                    | 大纲 ownership 弱              | `save_*_outline` 事务内校验作品/卷/章/上级纲要，不匹配零写入      | `outline_commands.rs`                                                    |
| GAP-15                    | 模板/建议/导入/润色双真相      | 桌面以 SQLite 为事实源（设置仍为本机 LocalStorage/DPAPI，按设计） | migration 037；`user_templates` / `setting_suggestions` / `local_assets` |
| GAP-16                    | TXT 导入非原子                 | `import_txt_novel` 单一 Immediate 事务                            | `txt_import_service.rs`                                                  |
| GAP-18                    | 失败运行无法重试章节目标       | `task_runs.chapter_id`（migration 038）                           | `038_task_runs_chapter_binding`                                          |
| GAP-19                    | 重试沿用旧读取被拒             | 用户重试提示要求本回合重新完成必需读取                            | `task_runtime` 重试说明                                                  |
| BROKEN：假级联删除        | `delete_novel` 只软删主行      | 用户入口走 `delete_novel_cascade` → `purge_project_in_tx`         | `project_service.rs`                                                     |
| BROKEN：修复不碰 SQLite   | `repairData` 只改 LocalStorage | 桌面调用 `repair_database`                                        | `novelRepository.repairData`                                             |
| BROKEN：导入资产假计数    | 卡片写死 `0`                   | `useAssetStatistics` 读 `importedAssets`                          | `AssetsPage.tsx`                                                         |

Writing SubAgent 的当前生产门禁已在本轮补齐：桌面 API 写章先 draft、原生复验前章/预算/模型/哈希，再由宿主有限完整性检查决定 admit；仍不自动采用正文。字数与完整性修复有界，warning 留作者判断；完整学习闭环仍未实施。

---

## 4. 仍开放项（建议优先级，未授权）

### P0 — 口径与验收边界

- **R4 live 云端只读验收**：受控 opt-in cloud profile 已实现固定载体/网关哈希、provider/model/endpoint 冻结、最多 6 次实际发送、取消/超时、凭据隔离和脱敏证据；本轮未调用真实云端，R4 仍 **NOT VERIFIED**。
- **文档与代码一致**：本轮只收口权威文档与用户指南；历史审计只加校正头。

### P1 — 进入下一 Agent 阶段前

- **GAP-02**：`generate_*` 对模型仍是 candidate validator，名称与生成语义相反。
- **GAP-04**：TypeScript Registry、DSH allowlist、Gateway 三份清单并行。
- **GAP-06 / GAP-07 / GAP-08**：部分只读 TS Tool 未进 DSH；更细领域 facade 与模型可见 permission/confirmation 未齐。
- **GAP-12**：自主创作、设定推演、大纲页与工作台并存，用户可见双入口（不是双事实源伪造，但是并行主路径）。
- **GAP-13**：章节绑定已持久化；跨任务并发冲突投影仍需按会话事实加强。
- **SubAgent 预算内自动修正**：当前不自动重跑完整性失败。
- **Context / Quality SubAgent**：未开始设计，NOT READY。

### P2 — 产品增强与清理

- **GAP-14**：插件健康只证明目录/组合，不是逐 Tool 可调用。
- **GAP-17**：完整 Rust 套件并发时 DSH restart 测试有时序敏感性。
- EPUB / PDF / Markdown / DOCX 参考导入（需新依赖，另议）。
- 全书分析 UI、关系图 / 地图 / 时间线、自动 embedding、出版导出、系统托盘常驻。
- Provider 账单对账、流式能力协商降级。

---

## 5. 明确不宣称

- 不宣称 R4 VERIFIED。
- 不宣称全部生产写章都走 DSH；mock / 本地 / 浏览器仍是确定性 Writer。
- 不宣称 Main Agent 对所有意图做 LLM 工具选择；问候与部分路由仍是宿主分流。
- 不把历史 `catalog_only` 或三个 BROKEN 入口写成当前代码状态。
- 本文不授权实现上表任何仍开放项。

---

<a id="gap-review-20260927"></a>

## 6. 2026-09-27 总体复核与处置规划

> 后续执行校正：本节保留该次规划截面。用户已授权先修复 v3.7.0 当前缺陷并明确将生产持续学习另项实施。R4 的受控 cloud 入口、备份授权/请求身份映射、遗漏子事实清理、warning 采用分级、DSH 前章/两阶段候选、检索排序/截断、工作台窗口/多任务反馈和验证接线已进入本次实现；不再用下表“只跑 loopback”“未接 CI”等旧状态描述当前代码。实现、局部回归和最终验收分开，当前记录见 [审计修复进度](../reports/audit-repair-progress.md)。本次不宣称学习闭环、自动 embedding 或 R4 live VERIFIED。

### 6.1 复核范围与结论等级

本次为版本规划所做的**定向源码、配置和文档核对**，不是整仓动态审计，也未重新执行真实桌面、Rust 全套或云端模型验收。不将旧审计、TODO、文件体积或接口计数直接认定为用户可复现故障。原始审计编号保持，新增 G38 编号用于同一 v3.8.0 计划的跨模块追踪。

- **确认缺口**：指定入口或新需求缺少完整实现；不等于所有相关功能不可用。
- **部分具备**：已有主路径/安全门，尚有契约、覆盖或产品收敛工作。
- **待复现风险**：有架构或旧报告线索，但本次没有当前用户故障证据；必须先复现再修复。
- **已修需回归**：有当前实现与历史收尾证据，不重复开发，不冒充本次重测通过。
- **产品扩展**：尚未承诺支持的新能力，不能统计为已有功能损坏。

P0 指数据安全、授权或生产准入阻断；P1 指核心创作流程与本版完整学习闭环；P2 指可维护性和非阻断体验。它们是版内执行顺序，不是拆成多个版本。W0～W7 的唯一交付定义在[版本路线](version-roadmap.md#v380-integrated-plan)，本台账负责事实、证据与关闭标准。

### 6.2 必须先校正的旧结论

| 旧结论或容易误读的说法                                          | 2026-09-27 核对结果                                                                                                                                                                            | 本版处置                                                             |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Writing SubAgent 完全没有自动修正                               | [Unreleased](../CHANGELOG.md) 已记录最多两次有界字数修正；不是通用语义修复或跨章学习                                                                                                           | 复用长度修正，增加语义闭环的总预算和回归                             |
| 本批本地/桌面/039 迁移仍全部待验收                              | [收尾报告](../reports/closeout-2026-09-18.md) 最近复核为 2026-09-26，记录适用前端、Rust、SQLite、桌面与 EXE 完成；有忽略/复测边界                                                              | 引用报告原范围，不重复报“全部未测”，也不宣称一次全绿或未来改动已通过 |
| R4 只缺一次云端执行                                             | [现有脚本](../scripts/dsh/test-agent-runtime-real.mjs) 对非回环地址 NOT_RUN 或失败关闭，没有执行 cloud profile                                                                                 | 先补安全执行路径，再取得授权执行；目前仍 NOT VERIFIED                |
| 假级联删除、假数据库修复、导入资产零计数、模板/建议双真相仍未修 | 第 3 节已有关闭证据；039 和候选/规则门禁又有后续收尾记录                                                                                                                                       | 转为防回归，不重建数据模型或重做已发布 migration                     |
| 三个 UI 组件仍直接构建 AI 客户端、TS/Rust 没有体积门禁          | [Unreleased](../CHANGELOG.md) 已记录客户端下沉和双语言体积非回退门禁                                                                                                                           | 保留已完成改动；剩余编排职责另按影响面处理                           |
| PR 完全不检查 Rust、项目没有 coverage                           | [Windows 工作流](../.github/workflows/windows-desktop-e2e.yml) 有 scoped native lane；[验证选择器](../scripts/quality/verify-change.mjs) 和 [package.json](../package.json) 有覆盖率及核心门禁 | 核查选择覆盖、平台差异与关键行为，不把旧报告照搬为当前故障           |
| 有 Memory / 六专家 / 质量报告，就已具备写作自学习               | 正式故事 Memory、已有语义质检和协作服务可复用，但不证明评审模型独立、策略学习或后续消费                                                                                                        | 新增完整学习链，不能只修改实验 Harness                               |

### 6.3 项目级问题与处置台账

以下是规划入口而非“已修复列表”。每项实施前补最小复现/用例、环境、责任模块、实际/期望结果和证据，关闭后再记录测试与剩余限制。

| 编号 / 优先级      | 状态、用户影响与证据                                                                                                                                                                                                                                                                                     | 本版处置 / 关闭条件                                                                                                                                              |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G38-01 / P0        | **部分具备：R4 cloud 执行与证据入口已补齐，真实执行未验证**。[受控载体](../tests/real-acceptance/r4-canonical-read-carrier.mjs)固定身份、6次实际发送上限、隔离数据库和脱敏证据；本轮没有真实云调用，因此不能证明真实模型使用Canonical只读工具                                                            | W0/W7：经明确授权运行一次冻结身份的cloud profile；零产物/零采用/零越权，未运行不算通过                                                                           |
| G38-02 / P1        | **部分具备：独立诊断与语义修订**。[六专家 Provider](../src/services/multi-agent/multiAgentProvider.ts) 读全局配置；[完整性审查](../src/services/generation/chapterCandidateIntegrityReview.ts) 标记 `semanticRules=not_checked`。已有质量服务不等于独立评审                                              | W3：角色模型单独冻结，专项证据/弃权/校准，修订新候选后复核；覆盖 DSH、确定性 Writer 与自主队列，不让规则分代替文学效果                                           |
| G38-03 / P1        | **确认缺口：本次要求的持续学习闭环**。[实验反馈记忆](../src/services/agent/qualityFeedbackMemory.ts) 是 Map，不能作为跨重启的策略事实；尚无该闭环的生产交付证据                                                                                                                                          | W4～W6：联网知识候选、策略版本、实验/留出、晋升/回滚、持久化、下次生成消费及成本授权完整交付                                                                     |
| G38-04 / P1        | **部分具备：工具命名、清单与权限表达**（GAP-02/04/06/07/08）。[Gateway](../src-tauri/gateway/src/tools.rs)、[TS Registry](../src/services/agent-tools/productionToolRegistry.ts) 与宿主仍有 legacy 边界；`generate_*` 实际接收并校验候选                                                                 | W2：建立身份/schema/scope/side-effect/confirmation 的权威契约及投影检查，兼容旧名，模型说明不暗示执行生成或正式写入；四项已放行 Canonical 不重开                 |
| G38-05 / P1        | **已修需统一回归：Gateway 读取与应用检索已共享词法范围/排序接缝**。[shared memory lexical scope](../src-tauri/shared/memory_lexical_scope.rs)在LIMIT前应用active、章节、时间、来源与重要度过滤；空命中、截断和省略候选公开为不完整证据。仍需统一主包/桌面回归，不把隔离Gateway通过写成全部长篇效果已证实 | W2：同一隔离SQLite语料对照、应用检索回归和真实桌面证据；保留合法embedding路径差异                                                                                |
| G38-06 / P1        | **部分具备、效果待验证：上下文和长篇召回**。[采用稿 Memory](../src/services/memory/adoptedDraftMemory.ts) 与 [memoryService](../src/services/memory/memoryService.ts) 已有正式入库/检索和显式向量接口；不等于自动 embedding 或高质量长篇召回                                                             | W2/W3：评估关键事实召回、时序/视角、引用与失效，暴露缺失/截断而非猜测；Context 为诊断提供证据，不直接改正式事实。自动向量化按收益另评估                          |
| G38-07 / P1        | **部分具备：并行产品入口**（GAP-12）。[路由](../src/App.tsx) 仍保留工作台、自主创作、设定推演和大纲；入口存在本身不是 bug，但易形成不同的任务/错误/候选体验                                                                                                                                              | W1：逐能力核对等价性、参数和状态，接到共同任务/候选/策略服务；保留必要人工管理，未获授权不删路由                                                                 |
| G38-08 / P1        | **待复现风险：跨任务冲突与恢复投影**（GAP-13）。[工作台编排](../src/pages/Workbench/hooks/useWorkbenchTaskRunner.ts) 已有任务预约/重试，不能说没有并发保护；旧审计仍提示跨任务反馈覆盖有限                                                                                                               | W1：复现同章双任务、改规则、取消后完成、成功后刷新失败、强杀重启；冲突定位到相关任务与基线，明确继续/新任务路径，不丢输入、不静默切最新候选                      |
| G38-09 / P0 防回归 | **已修需回归：保存、采用、作用域与备份**。第 3 节和[收尾报告](../reports/closeout-2026-09-18.md) 已有事务、作用域、039、规则指纹等证据；本次未发现新的可复现数据丢失缺陷                                                                                                                                 | W1/W6/W7：新增诊断/学习不能破坏 dirty 文本、精确候选、授权/CAS、改采失效、导入原子性与备份恢复；新学习数据补备份方案及身份/授权恢复门禁                          |
| G38-10 / P2        | **部分具备：插件与模型健康解释**（GAP-14）。[currentPluginService](../src/services/conversation/currentPluginService.ts) 仍以 `WORKBENCH_TOOLS` 静态列表映射 Runtime；[原生状态](../src-tauri/src/services/dsh/commands.rs) 区分 composition/模型/工具证据                                               | W2：列表与实际 Registry/exposure 对齐；“已加载”“已初始化”“可调用”“未验证”按证据表达，不能为了展示绿灯额外偷发付费探针；继续只读，不做插件管理                    |
| G38-11 / P1        | **待复现风险：Provider 故障与预算联动**。已有[请求治理](project/ai-generation-governance.md)、冻结模型和原生探针；多个评审/研究/修订链叠加后有超额、取消传播与重复派发风险                                                                                                                               | W2/W6：复验精确模型/凭据、429/超时/断流/非结构化响应、预算不足及迟到结果；统一总预算，模型不可用不暗换 Writer/Mock。只对已支持协议承诺兼容                       |
| G38-12 / P2        | **技术债、不是已复现故障：编排与 IPC 边界**。[大型工作台 hook](../src/pages/Workbench/hooks/useWorkbenchTaskRunner.ts) 仍承载业务流程；[dbCall](../src/services/database/db.ts) 接受字符串命令，存在静态契约盲区                                                                                         | W1/W2：按本版触及的职责下沉 Feature/Service，补 TS↔Rust 命令存在/参数/错误的契约回归；不根据两侧计数直接宣布命令缺失，不全仓重写                                 |
| G38-13 / P1        | **部分具备：回归接线与测试稳定性**。[故障注入规格](../tests/real-acceptance/wdio.fault-injection.conf.ts) 有独立入口及历史 8/8 证据，但当前 CI/选择器未直接接入该套；GAP-17 是历史并发时序风险，最近串行 Rust 已通过                                                                                     | W7：将零凭据回环故障规格接入适用门禁，核对关键分支/场景覆盖与 Windows coverage 归属；串行隔离共享 DSH，若时序风险复现则修生命周期同步，不靠扩大 sleep 或降低阈值 |
| G38-14 / P2        | **确认口径漂移：当前状态与历史说明**。部分入口仍写“待统一验收”，[Catalog](../src/services/capabilities/capabilityCatalog.ts) 仍有旧兼容路径说明，而收尾报告/迁移已有更新                                                                                                                                 | W0/W7：按能力和时间区分实现、实测、未验证；更新活动文档/元数据，保留历史日期。源码备注不能推翻当前持久化证据，也不能据此重做已修功能                             |
| G38-15 / P1 验收   | **待验证覆盖：长篇规模与桌面操作**。当前已有分页/布局/恢复测试和[收尾证据](../reports/closeout-2026-09-18.md)，没有本次全场景性能与体验测量                                                                                                                                                              | W1/W7：按下表验证长任务史、多卷章、大正文、资产 CRUD/撤销、键盘/IME、缩放/2K和恢复；复现的核心阻断归入本版修复，不因没有用户逐条提报而漏掉                       |

Mock 客户端静态导入可在本版接缝调整时检查包体和路由隔离，但 mock/local/browser 是既有声明能力，不能直接删掉。全仓覆盖率地板目前为 34/34/44/64，同时已有更高核心门禁；[最近报告](../reports/closeout-2026-09-18.md) 的实测覆盖高于地板。计划应提升新关键模块的行为覆盖与非回退预算，不能把“门槛偏低”当成某个功能必坏，也不靠单纯提高数字宣称质量改善。

<a id="core-journey-matrix"></a>

### 6.4 不遗漏现有功能的用户旅程矩阵

实施时给每条旅程绑定具体规格和 G38 缺陷编号；当前表是待执行验收范围，不是本轮测试结果。现有用例已覆盖的部分直接复用，只补缺失场景。

| 用户旅程                   | 必验正常路径                                                         | 必验异常与数据边界                                                                             |
| -------------------------- | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| 安装后启动、模型配置       | 冷启动/重开、API 来源与精确模型、凭据恢复、本地模型选择              | 无凭据/错模型/模型下线、Worker 重启、目录刷新；历史任务身份不漂移，不读真实用户库做测试        |
| 作品与创作资产             | 新建作品、卷章、大纲、角色/事件/设定/规则、风格/输出方案、模板       | 空项目、归属不符、编辑冲突、规则依赖删除/停用、未知/N/A、失败后输入保留                        |
| TXT 导入、导出与备份恢复   | 当前已支持格式、长正文/多卷章、已有导出、项目备份与重开              | 非法内容/取消/写失败、损坏附件、跨作品数据、ID 重映射；旧 migration 不改写                     |
| 新任务与多任务操作         | 搜索/分页/归档恢复、目标章绑定、切换时草稿与运行状态                 | 同章并发、运行中换目标/改规则、模型失效、刷新失败、取消后迟到结果                              |
| 两条路径写章与旧队列       | DSH / 确定性 Writer、Scene/Beat、本地模型、自主队列暂停继续          | 缺上下文、工具失败、越界字数、断网/429/超时、重复/跨章候选；不串用模型或隐式采用               |
| 候选审阅、修订、保存、采用 | 精确 source chip、修订新版本、打开审阅、显式编辑/保存/采用           | 旧基线/过期授权、重复点击、保存失败、dirty 离开、迟到新候选、改采后上下文失效                  |
| 总结、角色状态与 Memory    | 采用稿派生、作者确认、继续下一章、相关前文和规则引用                 | 旧分析/未采用稿/未来章节混入、来源失效、材料超过预算、检索无结果；明确未检查                   |
| 自我迭代全过程             | 诊断、联网、知识、实验、晋升、后续消费、作品复盘                     | 同模型降级、伪造引用、网页注入、无收益、退化、无授权/超预算、知识过期                          |
| 重启、撤销与恢复           | 运行终态、候选、策略与使用记录重开可查；有效授权内恢复               | 强杀/租约过期、重复派发、重复晋升/写入、备份恢复后误恢复授权、取消后费用结算                   |
| Windows 长篇日常操作       | 大作品/长对话的有界加载、明暗主题、2K/缩放、键盘/IME、焦点与阅读位置 | 空态/加载态/失败态、宽窄窗面板遮挡、隐藏控件抢焦点、未保存退出、长内容卡顿；记录实测条件和阈值 |

### 6.5 执行与范围收口规则

1. 先按风险和用户旅程建立可复现基线，优先关闭数据/授权风险和主流程阻断；诊断、研究、实验、持续优化在同一版本中接通，不再拆成四次发布。
2. 旧风险若已修或无法在当前条件复现，记录证据与复现范围，不能凭历史报告要求重写；已修项转入回归保护。
3. 本版新增学习能力必须共享既有候选/正式事实边界、模型治理与持久化协议；需要 migration、新依赖、模型/搜索预算或删除入口时先取得相应授权。
4. EPUB/PDF/DOCX 新格式、出版工具、地图/关系图/时间线、独立分析大屏、系统托盘属于无版本号扩展池；现有格式/入口的损坏不属于扩展，发现后仍修。自动 embedding、账单对账和 SSE 协商按基准与已支持范围判断必要性。
5. 实施验收不得以“未联网”“没有真实模型资源”把完整闭环悄悄缩成知识记录功能；不足时如实标记版本未完成。发布范围变更需要用户决定，具体测试和交付条件见[统一版本计划](version-roadmap.md#v380-integrated-plan)。

### 6.6 后续定向源码复核：当前缺陷汇总

> 本节记录后续只读源码复核得到的**缺陷台账**，用于问题治理和回归。P0～P4 的当前状态见下方日期核对；其余条目仍是待处理风险，不授权自动进入下一版本。证据来自当前工作区代码；静态检查不能替代桌面/Rust/云端动态验收。P0/P1 优先处理数据一致性、正式采用、正文保存、删除清理、文件安全和任务终态问题；P2 主要为状态展示、入口和可维护性问题。

| 编号 / 优先级 | 当前确认问题、触发条件与影响                                                                                                                                                                                                                             | 主要证据                                                                                                                                                                                                                                                                                                                                                                                                                    | 关闭口径                                                                                                                   |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| FUP-01 / P0   | 浏览器草稿 `create/update` 没有 CAS；并发窗口/标签页读改写会丢稿、重复版本或覆盖整份草稿列表。桌面保存期间继续编辑还会让前端保留旧 hash，下一次保存持续触发 CAS 冲突。                                                                                   | [`draftVersionService.ts`](../src/services/database/draftVersionService.ts)；[`useEditorDocumentController.ts`](../src/components/workspace/editor-area/useEditorDocumentController.ts)                                                                                                                                                                                                                                     | 浏览器与 SQLite 均使用 revision/hash 冲突保护；保存期间继续编辑后仍能继续保存且不丢正文。                                  |
| FUP-02 / P0   | 浏览器采用只改草稿 `isAdopted`，不更新章节正式 `adoptedDraftId/status/wordCount`；审阅采用的草稿事务和授权消费也不是原子操作，可能留下“正式正文已采用、授权仍 issued”的双真相。                                                                          | [`draftVersionService.ts`](../src/services/database/draftVersionService.ts)；[`artifactDecisionService.ts`](../src/services/conversation/artifactDecisionService.ts)；[`taskConversationService.ts`](../src/services/conversation/taskConversationService.ts)                                                                                                                                                               | 采用、授权、章节指针和上下文失效具备同一事务/补偿边界；异常注入后不能出现半完成事实。                                      |
| FUP-03 / P0   | 正式采用事务成功后，后置自主调度提升失败会被 UI 显示为“采用失败”；数据库已采用但前端仍显示未采用，摘要入口可能被错误阻断。                                                                                                                               | [`draftVersionService.ts`](../src/services/database/draftVersionService.ts)；[`autonomousSchedulerWorker.ts`](../src/services/autonomous-creation/autonomousSchedulerWorker.ts)；[`editorReviewAdoption.ts`](../src/components/workspace/editor-area/editorReviewAdoption.ts)                                                                                                                                               | 后置投影失败与正式采用结果分离；UI 能显示真实采用事实并提供收束重试。                                                      |
| FUP-04 / P0   | 删除作品不完整：SQLite 未清理 `workspace_recovery_snapshots`、恢复正文引用和 `draft_save_operations`；浏览器未清理恢复动态键、参考资料缓存和新的 `ai_novel_studio_ai_tasks`。                                                                            | [`project_backup.rs`](../src-tauri/src/project_backup.rs)；[`migrations.rs`](../src-tauri/src/migrations.rs)；[`novelRepository.ts`](../src/services/database/novelRepository.ts)；[`workspaceRecoveryService.ts`](../src/services/workspace/workspaceRecoveryService.ts)；[`referenceLibraryService.ts`](../src/services/references/referenceLibraryService.ts)；[`aiTaskService.ts`](../src/services/ai/aiTaskService.ts) | 删除、导入失败回滚和跨存储补偿后，所有项目作用域正文、恢复区、幂等记录、参考资料和任务记录均不可再读；补充清理有删除回归。 |
| FUP-05 / P1   | 章节总结结果未绑定目标章节；切章后可把旧章总结保存到新章。弹窗重新生成也不刷新本地编辑字段，旧摘要/事件/伏笔会覆盖新结果。                                                                                                                               | [`useWorkspaceSummary.ts`](../src/features/workspace/useWorkspaceSummary.ts)；[`WritingWorkspaceView.tsx`](../src/pages/WritingWorkspace/WritingWorkspaceView.tsx)；[`ChapterSummaryDialog.tsx`](../src/components/chapter-summary/ChapterSummaryDialog.tsx)                                                                                                                                                                | 结果携带 chapter/draft identity；切章、重生成、迟到结果均失败关闭或清空，不得跨章写入。                                    |
| FUP-06 / P1   | 整本导出遇到已采用章节正文读取失败会静默漏章，底部总字数仍统计缺失章节。                                                                                                                                                                                 | [`exportService.ts`](../src/services/export/exportService.ts)                                                                                                                                                                                                                                                                                                                                                               | 缺失正文时导出失败关闭或明确列出缺失章节，文件内容与统计一致。                                                             |
| FUP-07 / P1   | 旧版 JSON 导入先创建后更新，更新失败留下半成品；缺标题 JSON 会先报错又进入成功态并自动关闭。浏览器 TXT 失败补偿遗漏动态草稿键；普通 TXT 强制 UTF-8，其他编码可能静默乱码。                                                                               | [`ImportJsonDialog.tsx`](../src/components/import/ImportJsonDialog.tsx)；[`txtImportService.ts`](../src/services/import/txtImportService.ts)；[`ImportTxtDialog.tsx`](../src/components/import/ImportTxtDialog.tsx)                                                                                                                                                                                                         | 旧版 JSON 具备事务/补偿；非法输入不能进入成功态；TXT 编码可检测或明确拒绝；浏览器补偿清理完整。                            |
| FUP-08 / P1   | 章节工程面板加载未应用 draft 后把 `dirty` 清为 false，编译器却默认取旧 active state；元数据变化又会无提示覆盖正在编辑的工程。Mock Job 的 `save_version` 为 skipped，但循环显示“版本已保存”。                                                             | [`ChapterEngineeringPanel.tsx`](../src/components/right-dock/panels/ChapterEngineeringPanel.tsx)；[`generationContextCompiler.ts`](../src/services/generation/generationContextCompiler.ts)；[`chapterEngineeringLoop.ts`](../src/components/right-dock/panels/chapterEngineeringLoop.ts)；[`chapterGenerationPipeline.ts`](../src/services/generation/chapterGenerationPipeline.ts)                                        | 明确 active/draft 事实；未应用草稿不能伪装已编译；dirty 编辑有冲突保护；Mock 跳过保存时 UI 明确显示未持久化。              |
| FUP-09 / P1   | Scene/Beat Memory 读取和状态写入失败被静默吞掉；Memory 管理器主要使用进程内 Map，重启会丢失状态；语义检索在 cosine 前按重要度/顺序提前截断候选。                                                                                                         | [`chapterSceneGenerationExecutionService.ts`](../src/services/ai/chapterSceneGenerationExecutionService.ts)；[`novelMemoryManager.ts`](../src/services/memory/novelMemoryManager.ts)；[`novelMemoryStateUpdater.ts`](../src/services/memory/update/novelMemoryStateUpdater.ts)；[`memory_retrieval_apply.rs`](../src-tauri/src/services/memory_retrieval_apply.rs)                                                          | 失败明确投影为降级/失败；正式 Memory 可跨重启恢复；候选窗口不会在语义评分前丢弃有效事实，或明确暴露截断证据。              |
| FUP-10 / P1   | 直接保存 ContextRecord 不同步 Memory；章节上下文重保存不会失效本次省略的旧事实；删除章节总结不会清理伴生 ContextRecord 及其 Memory。                                                                                                                     | [`context_record_service.rs`](../src-tauri/src/services/context_record_service.rs)；[`chapter_context_bundle_service.rs`](../src-tauri/src/services/chapter_context_bundle_service.rs)；[`chapter_summary_service.rs`](../src-tauri/src/services/chapter_summary_service.rs)                                                                                                                                                | ContextRecord、总结和 Memory 的新增、替换、删除、失效保持一致，并有同章重总结和删除回归。                                  |
| FUP-11 / P1   | 质量检查结果持久化缺少分数、严重度、问题类型、偏移和必填字段校验，异常 Provider JSON 可能被标为 completed。                                                                                                                                              | [`quality_check_service.rs`](../src-tauri/src/services/quality_check_service.rs)；[`ai.rs`](../src-tauri/src/domain/ai.rs)                                                                                                                                                                                                                                                                                                  | 非法报告失败关闭，不进入 completed；UI 统计和正文定位只基于通过 schema/范围校验的结果。                                    |
| FUP-12 / P1   | Cloud 路由不检查 API Key；Mock→API 往返可能丢失原 Provider/model/key；Gateway 测试使用旧配置而非未保存 draft；同 Provider/model 不同 Base URL 共享生命周期/健康状态；Native Key 恢复失败后 rejected Promise 永久缓存；测试完成可能覆盖测试期间的新输入。 | [`modelCatalog.ts`](../src/services/ai/runtime/modelCatalog.ts)；[`SettingsPage.tsx`](../src/pages/Settings/SettingsPage.tsx)；[`AiGatewaySettingsCard.tsx`](../src/components/settings/AiGatewaySettingsCard.tsx)；[`modelLifecycle.ts`](../src/services/ai/runtime/modelLifecycle.ts)；[`aiSettingsStore.ts`](../src/services/ai/aiSettingsStore.ts)                                                                      | 模型身份包含完整端点；配置草稿、测试请求和保存请求使用同一快照；凭据恢复可重试；路由在派发前失败关闭。                     |
| FUP-13 / P1   | 桌面 AI Task 终态耗时从错误的 LocalStorage 来源计算；启动不恢复 pending/running AI Task；Generation Job 可在未完成进度下进入 completed。                                                                                                                 | [`aiTaskService.ts`](../src/services/ai/aiTaskService.ts)；[`startupCoordinator.ts`](../src/services/startup/startupCoordinator.ts)；[`generation_job_service.rs`](../src-tauri/src/services/generation_job_service.rs)                                                                                                                                                                                                     | 终态记录有权威耗时；重启能回收中断任务；completed 必须满足进度、步骤和 finishedAt 约束。                                   |
| FUP-14 / P1   | 作品详情切换作品时残留旧作品状态；设定推演页只在首次渲染读取 route novelId，路由切换后仍加载/生成/采纳旧作品。                                                                                                                                           | [`NovelDetailPage.tsx`](../src/pages/NovelDetail/NovelDetailPage.tsx)；[`SettingSuggestionsPage.tsx`](../src/pages/SettingSuggestions/SettingSuggestionsPage.tsx)                                                                                                                                                                                                                                                           | 路由作用域变化先清空旧状态并取消旧请求；读取、生成、保存、采纳全部绑定当前 novelId。                                       |
| FUP-15 / P1   | 参考资料新版本不会使旧风格画像标记 outdated；删除参考作品不会把绑定画像标记 missing，浏览器与桌面行为分叉。                                                                                                                                              | [`referenceLibraryService.ts`](../src/services/references/referenceLibraryService.ts)；[`reference_library_service.rs`](../src-tauri/src/services/reference_library_service.rs)                                                                                                                                                                                                                                             | 版本切换、参考作品删除和画像来源状态在两种存储模式一致；过期/缺失来源不得继续按 available 投影。                           |
| FUP-16 / P1   | 参考资料导入命令接受 Renderer 任意 `sourceFilePath`，Rust 直接 `metadata/read`，可绕过文件对话框动态 scope；生产包还暴露未门控 AI Task debug 命令。                                                                                                      | [`reference_library.rs`](../src-tauri/src/commands/reference_library.rs)；[`reference_library_service.rs`](../src-tauri/src/services/reference_library_service.rs)；[`main.rs`](../src-tauri/src/main.rs)；[`ai.rs`](../src-tauri/src/commands/ai.rs)                                                                                                                                                                       | 后端复验 dialog grant/允许路径；生产命令移除或门控 debug 返回；安全回归覆盖任意路径、错误路径和信息泄露。                  |
| FUP-17 / P1   | `errorMessage` 等 AI 失败信息未完全纳入日志脱敏；错误展示还可能直接暴露底层数据库路径。                                                                                                                                                                  | [`db.ts`](../src/services/database/db.ts)；[`aiTaskService.ts`](../src/services/ai/aiTaskService.ts)；[`AiTasksPage.tsx`](../src/pages/AiTasks/AiTasksPage.tsx)                                                                                                                                                                                                                                                             | 日志、LocalStorage 诊断和页面错误统一脱敏；用户界面不显示路径、SQL、凭据或上游原始响应。                                   |
| FUP-18 / P2   | AI Task 类型筛选漏项；分页只按时间排序导致同时间戳记录跨页重复/跳过；Diagnostics 原生报告读取失败误显示为 0；更新事件订阅失败会阻断整个更新能力。                                                                                                        | [`aiTasksPresentation.ts`](../src/pages/AiTasks/aiTasksPresentation.ts)；[`ai_task_record_repository.rs`](../src-tauri/src/repositories/ai_task_record_repository.rs)；[`DiagnosticsSettingsCard.tsx`](../src/components/settings/DiagnosticsSettingsCard.tsx)；[`AppUpdateSettingsCard.tsx`](../src/components/settings/AppUpdateSettingsCard.tsx)                                                                         | 筛选覆盖实际任务类型；分页有稳定 tie-break；诊断失败态可见且可重试；更新能力读取与事件订阅分别降级。                       |
| FUP-19 / P2   | 设定推演“加载已有世界设定与规则”开关只屏蔽世界设定，规则仍无条件进入 Prompt；候选迁移单条失败后却永久标记迁移完成；跨章节批处理无变更时同步抛错但无 UI 提示。                                                                                            | [`settingSuggestionPrompt.ts`](../src/services/settingSuggestions/settingSuggestionPrompt.ts)；[`settingSuggestionService.ts`](../src/services/settingSuggestions/settingSuggestionService.ts)；[`CrossChapterBatchPanel.tsx`](../src/pages/StoryAssets/CrossChapterBatchPanel.tsx)                                                                                                                                         | 开关真正控制全部对应上下文；迁移失败可重试并保留可见性；表单在提交前校验并显示缺少变更原因。                               |
| FUP-20 / P2   | 模板迁移失败后永久停止重试；编辑态切换/上传会静默丢失未保存表单；上传模板丢失 source/fileName；Prompt Registry strict 模式不检查正文中的未声明变量。                                                                                                     | [`templateService.ts`](../src/services/templates/templateService.ts)；[`TemplatesPage.tsx`](../src/pages/Templates/TemplatesPage.tsx)；[`promptTemplateRegistry.ts`](../src/services/prompt/promptTemplateRegistry.ts)                                                                                                                                                                                                      | 模板迁移可重试；表单切换有确认；导入来源和文件名可追溯；strict 渲染拒绝未声明占位符。                                      |
| FUP-21 / P2   | 章节大纲编辑不进入 dirty/离开保护；输出方案编辑把百分比当作 0–1；编辑风格强制改成 manual，破坏系统默认/来源保护；角色库缺少更新入口。                                                                                                                    | [`useChapterOutlineEditor.ts`](../src/components/workspace/editor-area/useChapterOutlineEditor.ts)；[`StyleProfilesPage.tsx`](../src/pages/StyleProfiles/StyleProfilesPage.tsx)；[`StyleProfilesContent.tsx`](../src/pages/StyleProfiles/StyleProfilesContent.tsx)；[`CharacterLibraryCard.tsx`](../src/components/novel-card/CharacterLibraryCard.tsx)                                                                     | 未保存编辑可保护；比例单位统一；来源字段和删除保护不被编辑破坏；角色 CRUD 完整。                                           |
| FUP-22 / P2   | 自主创作顶部进度把计划生成/应用显示成章节完成；相同 operationId 并发请求未比较载荷；浏览器软删除卷章仍会阻断 greenfield 计划。                                                                                                                           | [`AutonomousPlanProgress.tsx`](../src/pages/AutonomousPlanning/AutonomousPlanProgress.tsx)；[`autonomousStoryService.ts`](../src/services/autonomous-creation/autonomousStoryService.ts)；[`autonomousPersistence.ts`](../src/services/autonomous-creation/autonomousPersistence.ts)                                                                                                                                        | 计划进度与采用进度分开；operationId 不同载荷 fail-closed；浏览器与 SQLite 对软删除语义一致。                               |
| FUP-23 / P2   | 工作台目录并发刷新可能由旧请求覆盖 loading/error；Runtime projection 按 conversationId 忽略 runId；章节树卷/章读取失败仍进入 ready；参考作品快速切换可能详情错配。                                                                                       | [`useWorkbenchConversations.ts`](../src/pages/Workbench/hooks/useWorkbenchConversations.ts)；[`useWorkbenchRuntimeHeartbeat.ts`](../src/pages/Workbench/hooks/useWorkbenchRuntimeHeartbeat.ts)；[`useWorkspaceChapterLoader.ts`](../src/features/workspace/useWorkspaceChapterLoader.ts)；[`ReferenceLibraryPage.tsx`](../src/pages/ReferenceLibrary/ReferenceLibraryPage.tsx)                                              | 所有异步结果绑定请求代际、runId 和作用域；失败状态不进入 ready；快速切换保持列表与详情一致。                               |
| FUP-24 / P2   | HashRouter 返回按钮以全局 history length 判断回退；设置 query tab 不进入壳层标题；浏览器故事资产页切换作品时保留上一作品势力/地点。                                                                                                                      | [`BackButton.tsx`](../src/components/common/BackButton.tsx)；[`AppShell.tsx`](../src/components/layout/AppShell.tsx)；[`StoryAssetsPage.tsx`](../src/pages/StoryAssets/StoryAssetsPage.tsx)                                                                                                                                                                                                                                 | 返回路径按应用内路由判断；页面标题读取 query；作用域变化清空旧资产状态。                                                   |

#### 2026-10-12 P0 修复核对

- FUP-01 已补齐浏览器草稿的 revision/CAS、正文哈希冲突保护和可用时的 Web Locks 串行化；桌面编辑器已有保存结果代际与实时正文检查，保存期间继续输入会保留未保存状态并要求再次保存。
- FUP-02 已补齐浏览器章节采用的 `adoptedDraftId`、`status`、`wordCount/currentWords` 投影。上下文失效、授权消费失败会恢复草稿、章节和上下文快照，避免正式正文与授权状态分裂；桌面仍由 SQLite 原子采用事务负责指针更新。
- FUP-03 已将自主调度提升视为采用后的可重试投影，投影告警不再反报正式采用失败。
- FUP-04 已补齐浏览器 AI Task、章节/恢复动态缓存和参考资料作品链清理，并保留其他作品数据；删除级联回归覆盖隔离。

本批局部回归已覆盖草稿并发/陈旧哈希、保存期间继续编辑、浏览器采用指针与补偿、后置投影失败和删除隔离。完整桌面/R4 live 云端证据仍按统一验收矩阵单独记录；React Router 已升级到 v7.18.4，当前 `npm audit --omit=dev` 不再报告生产依赖漏洞。

上述 FUP 条目是当前问题台账，不等于已授权修复计划。修复前仍需为 P0/P1 补最小复现和行为测试；涉及 migration、删除清理、文件权限或模型预算的变更，按 `AGENTS.md` 和对应设计文档单独取得授权。浏览器 fallback、Mock、loopback 与真实桌面/云端证据必须分开记录。

# AI Novel Studio - CHANGELOG

### v2.3.0-M6：桌面实机验收修复

- 使用 Windows 桌面发布构建实测 M4–M6 主链路，修复 Tauri/SQLite 纳秒级 `updated_at` 被前端 `Date` 截断为毫秒后，首次提交共创总纲即被 Rust 来源 guard 误判为版本变化的问题；作品日期规范化现在保留可验证的权威时间戳原文，真实并发变化仍会被精确阻断。
- 修复同一 Artifact 的多条建议在逐项采用第一条后，因草案 revision/hash 合法推进而把兄弟建议误判为 stale 的问题；同源建议会在一次作者决策后共同 rebase 到新的审查上下文，手工编辑、正式数据变化和跨 Artifact 批量仍保持失败关闭。
- 桌面 Mock 共创不再只返回空结构，而会生成带 `ai_inference` 来源、置信度和可编辑值的阶段建议，能够离线验收逐项采用、拒绝、批量采用和正式 ApplyPlan；Mock 仍不直接写入 Canon，也不自动生成或采用正文。
- 共创 Prompt 明确限定 `stageCompletion.status` 的五个精确枚举，避免兼容模型把 `complete` 输出为 `completed` 后触发安全终止；协议解析器继续严格拒绝未声明状态。
- 桌面复测已覆盖十阶段与会话恢复、只补空白、编辑/拒绝/逐项/批量采用、正式写入与结构化页同步、反向 ApplyPlan、真实 stale 阻断、总纲 Artifact、章节计划 handoff、精确章节预填和正文 Leave Guard；未进入 M7，未新增 migration，正式应用版本仍为 2.2.0。
- 修复后共创专项 Vitest 104/104、全量 Vitest 299/299、Node 正文安全 5/5、Rust 203/203；TypeScript、ESLint、cargo fmt/check、生产构建与 Tauri MSI/NSIS 构建全部通过。保留基线已有 1 条 ESLint warning、10 条 Rust warning 与 Vite 动静态导入提示，未新增 warning。

### v2.3.0-M6：共创大纲任务、章节生成交接与双向深链

- AI 共创右栏新增受限生成任务卡，只接受作品总纲、指定卷纲、章节大纲和章节正文工作台交接四类请求；请求记录固定 scope、作者附加要求、`baseContextHash/compiledInputHash`、来源草案、稳定 `operationId/requestHash` 和不可变回执，普通字段编辑不会丢失历史 turn 或任务回执。
- 总纲、卷纲和章纲先以最新权威会话严格编译最终 Prompt、input body/payload、排序来源 manifest、scope/steps 与非密钥 Provider 参数，再比较双 hash 并通过既有 `submitPrepared` 冻结提交；提交阶段不再读取作品业务数据。结果仍是待审查 Artifact/PlacementProposal，不直接写入大纲 Canon。
- Rust 后台 Workflow 增加稳定 operationId 恢复、同 operation 不同冻结 payload 冲突拒绝、作品/分卷/章节范围校验和 `chapterCount=1..20` 上限；首次创建还会校验 session CAS、集合 hash、活动大纲/风格、来源版本/hash 与同 session 归属，未知、重复或非标量来源失败关闭。已存在 operation 的完整/部分图重放继续使用原冻结输入，不受后续 Canon 变化阻断，也不会重排 DAG、重新排队或复制 Task。
- `chapter_generation` 只创建可追溯 handoff；工作台按精确作品/章节/分卷和最新 context hash 恢复，打开现有 `ai-generate` 面板并预填章节计划，仍由作者手动触发 `compileChapterGeneration → unifiedAiPipeline → chapter_text Artifact → 约束/差异/Proposal → CandidateReviewPane`，未新建正文 Worker，也不自动生成或采用正文。
- 工作台 → AI 共创通过 `location.state` 交接当前章节、对象与可选选区；选区落入共创草案前按最新完整正文复核 SHA-256、UTF-16 offset 和选区 hash，dirty 正文被放弃或正文已变化时只保留章节定位，正文内容不进入 URL。
- AI 共创 → 工作台支持精确章节、`panel=ai-generate&handoffId=...` 和 `review=candidate&artifactId=...&taskId=...` 深链；无效章节、跨作品 handoff 或候选身份不一致时失败关闭，不再静默回退第一章。
- 跨界面跳转继续复用现有正文 Leave Guard 的保存/放弃/取消/保存失败门禁，并单独保护未保存章节目标；浏览器开发模式明确禁用后台大纲 Workflow，但仍可验证共创草案和安全工作台 handoff。
- generation 状态写入使用按 request/status 稳定的 mutation identity 与请求创建时间；Task 已创建但状态回执丢失时先重开权威会话并幂等对账，不把成功 Workflow 误记为 failed。默认空主角使用作品级确定性身份，连续编译不会产生随机 stale。
- M6 不新增 migration，不修改正式应用版本 2.2.0，不实现导演治理、Story State、Multi-Agent、连续多章或自动 Apply；大纲 Artifact 的正式大纲表采用仍由现有任务中心人工审查记录，未扩展为 Canon 写入。
- M6 验收通过：共创专项 Vitest 102/102、全量 Vitest 297/297、Node 正文安全 5/5、Rust 203/203；TypeScript、ESLint、cargo fmt/check、生产构建与 Tauri MSI/NSIS 构建全部通过。保留基线已有 1 条 ESLint warning、10 条 Rust warning 与 Vite 动静态导入提示，未新增 warning。

### v2.3.0-M5：AI 共创正式采用、冲突保护与反向撤销

- AI 共创右栏新增“准备正式写入 → 审查影响 → 确认执行 ApplyPlan”交互；只有已经逐项采用到草案的建议才能进入正式管线，覆盖作者字段和阻断冲突仍需分别明确确认。
- 新增 `co_creation_canon_apply_v1` 契约与两条 Tauri 准备命令；正式建议继续引用原 `ResultArtifact`，创建不可变子 `PlacementProposal` 和现有 `ApplyPlan/ApplyOperation/ArtifactTargetLink`，没有引入第二套生成或应用系统。
- 支持创作意图、世界背景、规则体系和主角的创建或更新；主角写入在同一事务内同步角色库与作品主角投影，结构化页面和下一轮共创上下文读取同一份正式数据。
- 准备与执行阶段均复核 Artifact、候选 hash、作者确认状态、草案 revision/hash、目标版本和内容 hash；过期建议或并发修改会阻断，批量写入任一目标失败时整体回滚。
- ApplyPlan 执行保持 operationId/requestHash 幂等；完成后记录逐目标来源链，并将同作品全部既有共创 Artifact（含本次来源的剩余建议）标记过期，后续采用必须重新生成或 rebase。正式采用状态写回不可变共创草案 revision，重启后仍可定位已写入批次。
- 新增 `co_creation_canon_undo_v1` 反向 Proposal/ApplyPlan；撤销前再次校验当前 TargetLink 版本/hash，创建项删除、更新项恢复、创作意图追加语义撤销 revision，历史 Proposal、Plan 和 Link 全部保留。
- 补齐二次采用安全：结构化工作台修改过的世界/规则正文不会被旧共创 base 覆盖；主角快照包含全部作品投影列并按精确 ID 同步；更新已有角色不再改写手工来源。
- Artifact 建议在 Rust 侧按与 TypeScript 相同的 trim/白名单形状重算 candidate hash，并拒绝跨语言无法精确表示的整数；正式准备前再次比对完整 `baseContextHash`。
- 本里程碑不新增数据库 migration，复用 012/013/020 既有表；浏览器开发模式继续允许讨论和草案审查，跨 Canon 原子事务仅以 Tauri/SQLite 桌面端为权威实现。
- M5 验收通过：共创专项 Vitest 60/60、全量 Vitest 253/253、Rust 共创 Apply 15/15、Rust 全量 194/194；TypeScript、ESLint、cargo fmt/check、生产构建与 Tauri MSI/NSIS 构建全部通过。保留基线已有 1 条 ESLint warning、10 条 Rust warning 与 Vite 动静态导入提示，未新增 warning。

### v2.3.0-M4：AI 共创工作区、结构化协议与可恢复会话

- 新增作品级 AI 共创工作区 `/novels/:novelId/co-creation`，采用左侧十阶段导航、中部对话、右侧工作草案与待确认建议的桌面三栏布局；可从作品详情进入，也可从写作工作台携带当前章节上下文进入。
- 固定 `story_seed` 到 `chapter_generation` 的十阶段最低完备字段与推进规则；正式作品数据优先于待确认草案、会话摘要和最近消息，AI 补全只能标记为建议、推断、临时假设或冲突，不能伪装成作者确认。
- 新增 `CoCreationTurnOutputV1` 与独立 Markdown Prompt，要求 Provider 返回包含自然语言回复、意图、提取信息、来源引用、待确认项、下一高价值问题、快捷回答、变更建议、阶段完成度和 `dataRevision` 的结构化 JSON；非法字段路径、旧 revision、凭据文本和不匹配来源均失败关闭。
- 共创轮次复用既有后台 `AiTask/DAG → generic_json ResultArtifact → artifact_review PlacementProposal` 管线；完整结构化响应由 Artifact 权威保存，界面只展示自然语言回复并将建议写入可审校草案。M4 不创建 ApplyPlan、TargetLink 或 Canon 写入，也不自动采用任何 AI 建议。
- 新增前向 migration `020_co_creation_workspace`，建立 session、message、阶段草案 revision 和 operation 四张表；消息正文复用 `large_text_documents/chunks`，会话使用 revision/stateHash CAS，阶段草案增加独立 revision/contentHash CAS，operationId/requestHash 提供持久幂等。
- 新增 Rust repository/service/command 闭环，支持打开或恢复会话、读取工作区、追加用户消息、绑定后台 Task、完成/失败/取消 turn 以及保存不可变阶段草案；Task、Artifact、Message 和 Draft 的作品范围及来源关系在事务内复检，凭据、跨作品来源、失效 Artifact 和损坏大文本均失败关闭。
- 补齐 submitted、running 以及 assistant 已落库但草案尚未投影三类中断恢复；冻结 turnContext 允许重启后继续轮询，terminal operation 不受并行合法草案编辑的旧 CAS 阻塞，非法协议与 stale Artifact 会安全结束本轮而非永久卡住。
- 浏览器开发模式提供按作品隔离的 LocalStorage 回退、作品级串行锁、写后回读与损坏数据失败关闭；桌面 SQLite 仍是正式权威来源。
- 新增共创页面、阶段机、上下文优先级、结构化协议、草案采用、摘要窗口、浏览器恢复及 Rust 持久化/迁移测试；补齐 Task 创建/绑定/完成各崩溃窗口、非法协议、stale 跨 revision、正式数据变化阻断和失败消息脱敏回归。M4 专项前端 50/50、全量 Vitest 243/243、Rust 179/179、生产构建与 Tauri 安装包构建通过。正式应用版本继续保持 2.2.0；正式 Canon 采纳、章节生成交接和 Multi-Agent 留待 M5/M6。

### v2.3.0-M3：创作意图作者审校与冻结闭环

- 作品详情新增创作意图入口与独立桌面编辑页，支持新增、编辑、删除、确认和拒绝陈述；知识分类保持只读，修改已确认或已拒绝内容会自动回到 pending。
- 作者显式输入必须逐项确认后才能冻结；推断偏好和待确认信息必须保留证据，pending 明确不等于作者确认。页面业务规则与异步读取编排位于 `features/creative-intent`，作品路由切换会隔离迟到响应。
- 新增 Rust 权威读取与冻结命令；冻结在单一 SQLite `BEGIN IMMEDIATE` 事务中创建不可变 revision、父版本链接、Rust 权威 ID/时间和 statement/content SHA-256。
- 使用 `expectedRevision + expectedContentHash` CAS、确定性 `creative-intent:{novelId}:revision:{n}` operation、request hash 和幂等重放；相同 revision 的不同 payload 会被拒绝。
- 桌面端复用现有 `AiTask + local-author Attempt + Input/Context/Constraint Snapshot`，Task 最终为 completed，Provider 调用、token、费用和时长预算均为零；浏览器开发模式提供按作品锁定的 LocalStorage 恢复、严格版本链校验和损坏数据失败关闭。
- TypeScript 与 Rust 共用稳定 hash 向量，并补充大整数防碰撞、ECMAScript 数字格式和 UTF-16 对象键排序；凭据文本、空内容和自洽但语义无效的快照均会失败关闭。
- 新增 r1/r2、重启恢复、确认失效、防双击、并发冲突、跨作品迟到读取、事务回滚、存储失败、推断隔离及 hash 兼容测试；专项前端 20/20、全量 Vitest 193/193、Rust 166/166、Node 安全门 5/5 通过。
- 正式应用版本保持 2.2.0；未新增或修改 migration/schema，未调用或修改 Provider/Worker，未创建 Artifact、PlacementProposal、ApplyPlan、TargetLink 或 Canon 写入。

### 冷启动首屏与作品读取修复

- 首页保持首屏代码优先加载，其余页面改为按路由加载；生产构建的首屏 JavaScript 从约 919.30 KB 降至 326.65 KB，降低 WebView 冷启动解析开销。
- 作品查询完成前显示明确的“正在读取本地作品”状态，查询失败时显示错误和重试入口，不再把等待或失败伪装成空作品库。
- 全局任务条的审计投影改用独立只读 SQLite 连接，不再用昂贵任务查询占住主连接并阻塞作品列表；Rust AI Worker 首次扫描在首屏完成后启动，不改变恢复、认领或持续运行语义。
- 新增冷启动作品水合测试，并通过前端全量测试、Rust 全量测试、lint、build、cargo check 和桌面冷启动验证；未新增 migration，未修改版本号或 Provider 参数。

### 导入弹窗与桌面文件读取链路修复

- 修复 TXT / JSON 导入弹窗遮罩固定但内容进入页面文档流、控件落到窗口下方的问题；弹窗内容现在始终位于固定遮罩内居中显示。
- 系统文件选择后的桌面读取改由受控 Rust 命令执行，不再受 Tauri 前端 `$HOME`、文档、下载和桌面目录 scope 限制，可读取用户明确选择的其他盘符文件。
- Rust 读取器仅接受 `.txt` / `.json` 普通文件，限制最大 64 MB，并对无效格式、不可读文件和非 UTF-8 文本返回可展示的结构化错误；读取在后台阻塞线程执行。
- 增加弹窗层级、Tauri command 调用、结构化错误、错误扩展名、非 UTF-8 与超大文件测试；未新增 migration，未修改版本号或 Provider 参数。

### 作品详情保存与已采用正文统计修复

- 修复作品创建、保存持有全局 SQLite 锁后再次进入查询命令导致的不可重入死锁；改为在同一数据库连接中回读，并对不存在或已删除作品返回明确错误。
- 作品信息编辑增加同步防重锁，保存期间禁用输入、取消和保存操作；失败后恢复编辑并展示真实错误，成功后关闭编辑区并从数据库重新读取最新作品信息。
- 作品总字数改为只聚合当前章节指向且已标记采用的正文草稿，不再信任或由元数据保存覆盖 `novels.total_word_count`；浏览器 LocalStorage 回退采用同一规则。
- 新增重复点击、连续保存、保存异常、保存后权威刷新、已采用正文筛选、重新采用、撤销关系及 SQLite 重启持久化测试；校准既有大候选性能用例的外层超时以匹配其内部 10 秒门槛；未新增 migration，未修改版本号或 Provider 参数。

### 导入流程改为系统文件选择与确认预览

- TXT 与 JSON 导入改用 Tauri 系统文件选择器，只开放现有 `.txt` / `.json` 格式；选择后展示文件名、完整路径和等待解析、解析中、解析完成或解析失败状态。
- 文件选择、文本读取与解析、导入预览、正式写入拆分为独立阶段；用户取消文件窗口保持静默，重新选择会清空旧预览、错误和解析状态。
- TXT 预览展示字符数、字数、章节切分和警告；JSON 预览展示项目备份、风格方案或输出控制方案的类型、名称与摘要，只有用户确认后才正式导入。
- 正式导入增加同步防重锁，重复点击只执行一次；导入期间禁用关闭、重选和确认操作。
- 桌面端新增仅用于失败导入的 SQLite Immediate transaction 清理命令，回收新建作品、分卷、章节、草稿、长文本、方案及保存操作；清理本身失败时整体回滚，不留下“清理一半”的状态。
- 新增系统选择取消、错误扩展名、解析失败、重选清理、重复点击、成功确认、导入失败补偿和事务回滚测试；未新增 migration，未修改版本号或 Provider 参数。

### AI 任务记录删除与项目导入导出修复

- AI 任务中心为已完成、待确认、失败、取消和过期记录增加删除入口；运行中任务必须先取消。新 `ai_tasks` 使用 019 归档字段从普通视图隐藏，保留 Task、Attempt、Artifact、Proposal 与 ApplyPlan 审计证据；旧任务记录继续走兼容删除。
- 工作流根记录按整个工作流归档，子步骤不提供独立删除，避免留下重复或残缺的任务投影；浏览器开发模式同步提供持久隐藏回退。
- TXT 作品导入会逐章创建并采用正文版本，导入后可直接阅读与导出；中途失败会清理本次新建作品，避免留下半成品。
- JSON 项目备份升级为 schema v2，包含已采用章节正文；导入时重建作品、分卷、章节、已采用正文及作品级风格/输出方案，并为旧的纯元数据备份明确报告缺失正文。
- TXT/Markdown 导出改为依据实际已采用草稿而非章节状态字段；正文不可完整读取时停止导出，取消保存不再显示为失败。
- 新增任务归档、工作流整体归档、运行中禁止删除、旧生成记录清理、migration 幂等、TXT 采用及 JSON 往返测试；保持版本号和 Provider 参数不变。

### AI 候选审查：结构化结果规范化与安全采用

- 新增统一 `NormalizedCandidate`，将定向修复和全文改写规范化为完整小说正文、修改摘要、差异项、内部定位信息与原始响应；全文改写缺少结构化差异时自动生成段落差异。
- 定向修复可依据冻结正文、段落位置和唯一片段安全重建完整章节；无法定位、修改片段重叠、异常 JSON 或正文仍为结构化数据时按失败关闭并禁止采用。
- 工作台和统一任务中心复用同一候选审查组件：普通视图只展示正文、修改摘要和逐项原文/修改后对照，原始响应、ID、hash 与定位字段仅保留在折叠的高级工程区域。
- 约束检查、结果过期、复检状态和格式校验统一进入候选标题与采用门禁；吸底操作栏提供放弃、重新生成、查看差异和审查采用，长正文使用单层滚动与适合阅读的正文排版。
- 浏览器与 Rust Apply 路径均重新验证候选正文；任何原始或嵌套 JSON 都不能作为章节正文写入，且不自动采用候选。
- 补充定向修复、全文改写、异常 JSON、片段重建、禁止采用、结构化审查和长正文滚动测试；未新增 migration，未修改 Provider 参数或版本号。

### 阶段 3 前置：创作意图、初始化确认与多 Canon 事务边界

- 冻结 `CreativeIntentSnapshotV1`：按 revision、parentIntentId 和 SHA-256 固化创作意图，明确区分作者事实、推断偏好和必须人工确认的信息；推断信息不得伪装为作者确认。
- 新增 `InitializationCandidateBundleV1`：每个初始化候选必须携带证据、生成解释、冲突说明、独立 hash 和逐项确认状态，候选包变化后旧确认自动失效。
- 新增未来导演治理契约：冻结 Provider 调用、token、成本和时长预算，限定可提交 Task/可提议 Canon 目标，禁止自动 Apply、修改 Provider 配置，并以可持久化 Artifact 记录决策、备选、理由和证据。
- 复用现有 Snapshot、ResultArtifact、AiTask/DAG 与 ApplyPlan，不新增任务体系或 migration；意图写入 input snapshot，预算写入 context snapshot，权限写入 constraint snapshot，初始化候选和决策审计写入 Artifact。
- 新增初始化多目标 ApplyPlan：只接受已持久化 Artifact 中经作者逐项确认的世界设定、规则系统和角色创建候选；后端预分配目标 ID，按依赖拓扑排序，并在同一 SQLite Immediate transaction 中写 Canon、TargetLink 和完成结果。
- 多目标 Apply 任一 hash、跨作品、循环依赖、未确认冲突、重复业务键或 affected rows 校验失败时整体回滚；幂等重放只返回首次结果。浏览器 LocalStorage 模式明确拒绝多 Canon 原子写入。
- 保持应用版本 2.2.0；未实现正式创作导演、Story State、多 Agent 或自动 Apply，未修改 Provider 参数。

### 阶段 2E：组合工作流试点与阶段 2 收口

- 新增“章节冻结快照 → 质量检查 → 修复候选 → 修复复检 → 汇总审查包”五步工作流；一个父 Task 通过现有 DAG 管理五个独立子 Task、Attempt 和 Artifact，不新增 migration 或任务体系。
- 工作台增加非阻塞组合审查入口，提交冻结正文和 Prompt 后立即返回；页面切换、组件卸载或 WebView 刷新不持有执行生命周期。
- Rust Worker 增加冻结快照与审查汇总两个本地节点，复用现有质量检查、修复和复检 Provider 节点；最终审查包唯一引用修复候选、初检和复检 Artifact，只进入等待确认。
- 任务中心增加五步作者文案，并可从最终审查包直接打开修复正文候选；只有用户确认修复候选后才执行现有 ApplyPlan，汇总包确认只记录审查证据。
- stale 检测增加 Worker 持久化前复检，正文变化后已在途的迟到响应会失败关闭且不产生 Artifact；未认领节点继续由 DAG 阻止执行。
- 新增五步 DAG 规格、完整 Mock 执行、失败节点局部重试、迟到响应丢弃、最终 Artifact 唯一和无自动 Canon/Apply 动态测试。
- 普通任务条和任务中心统一使用作者文案，未知任务类型不再回退显示内部类型名；高级详情继续保留完整审计字段。
- 使用既有真实 API 配置完成一次 release 桌面五步冒烟：运行中可切换章节，最终 5/5 进入等待确认，未采用时正文版本和字数保持不变。

### 阶段 2D：阻塞式 AI 入口迁移

- 在 017 Worker 与 018 编排结构上增加通用后台工作流提交命令；冻结 Prompt、输入正文、来源清单、目标范围和非密钥 Provider 参数，不新增 migration 或任务表。
- 质量修复改为“修复候选 → 复检”两步依赖 DAG；质量检查继续复用 2B Worker。润色、章节/卷摘要、作品总纲、分卷大纲和章节大纲改为单步待审查工作流。
- 右栏、作品大纲页、独立大纲编辑器和正文采用后总结入口提交后立即返回；Provider、Attempt、取消、重试、恢复、进度和 Artifact 全部由 Rust Worker 管理，不再挂接 AI 全屏 Loading。
- Worker 按任务规格写 `chapter_text / quality_report / chapter_summary / volume_summary / outline_text / volume_outline / chapter_outlines` Artifact；待审查输出自动建立 PlacementProposal，只有任务中心的用户确认才创建并执行 ApplyPlan。正文计划可写新草稿，摘要/大纲计划只记录审查 TargetLink，不写 Canon。
- Mock Provider 覆盖全部迁移类型；新增质量修复依赖、每步单 Artifact、正文 Proposal、无自动 Canon 写入和未迁移任务拒绝测试。
- 旧 AI Service 方法仅保留给未迁移兼容代码；本阶段生产 UI 已关闭对应 WebView Provider 执行链。

### 阶段 2C：父子任务编排与依赖 DAG

- 新增 `018_ai_task_orchestration`：扩展现有 `ai_tasks` 的 workflow/root/parent/role/step/priority/concurrency/stale 字段，新增任务依赖表与 append-only Artifact stale 事件，不建立第三套任务系统。
- DAG 依赖在 SQLite 和 Rust 服务双重校验，禁止自依赖、循环依赖和跨作品/章节/工作流关联；Worker 认领时再次验证所有必需上游已完成。
- 父 Task 只聚合子节点状态和进度，不创建 Attempt、不调用 Provider；`waiting_dependency`、`waiting_user`、`interrupted` 与 `stale` 映射到现有状态和持久化关系。
- 现有 Worker 扩为两个并发槽，支持依赖释放、有限并行、局部重试、级联取消、重启恢复和单并发组互斥；已成功节点与有效 Artifact 不重复执行。
- stale 可由上游任务显式传播，并在章节采用草稿/version/hash 变化时自动传播；过期 Artifact 无法创建或执行 ApplyPlan。
- 新增“资料准备 → 摘要候选 → 一致性检查 → 审查汇总”四步 Mock/Provider 试点；每步独立 Attempt/Artifact，父任务只链接最终审查候选，不写正文、Canon、Story State 或正式章节总结。
- 任务中心新增工作流进度、当前步骤、展开子任务、局部重试/取消、失败与过期原因展示；工程 ID 与 Provider 元数据仍只在高级详情中出现。

### 阶段 2A：统一 AI 任务中心

- 新增以 `ai_tasks` 为权威来源的只读任务投影，聚合最新 Attempt、主 Artifact、PlacementProposal、ApplyPlan、TargetLink、作品/章节范围、错误与待审查状态。
- `ai_task_records` 与 `generation_jobs` 仅作为 Legacy 兼容投影；按 `ai_tasks > ai_task_records > generation_jobs` 和稳定 ID 去重，不推断或伪造历史关联。
- AI 任务中心按正在运行、等待确认、最近完成、失败任务分区；普通视图使用作者文案，高级详情保留 Task/Attempt/hash/trace 等完整审计信息。
- 新增应用级非阻塞任务条，位于正常布局流内，不覆盖正文、不阻止编辑或导航、不自动跳页；完成候选提示进入任务中心审查。
- 任务 Store 可从 SQLite 重新水合并接收管线实时摘要；查询失败显示明确错误而不是伪装为空列表。
- 移除写作工作台对遮挡式 `GlobalAiTaskModal` 的挂载；旧入口仍保留兼容链路，不批量迁移。

### 阶段 2B：单任务 Rust 后台 Worker 试点

- 仅将手动“章节质量检查”迁移为应用进程内 Rust Worker；质量修复、润色、大纲、章节生成和其他入口保持原链路。
- 新增 `017_ai_task_worker_runtime` migration；`016` 继续保留给 TextRangeLock。Task/Attempt 增加 worker owner、lease、heartbeat、持久进度、取消请求、重试、可执行时间和中断记录，不建立第三套任务表。
- Worker 启动扫描 queued 与 lease 过期任务，使用 `BEGIN IMMEDIATE` 事务认领、同 Task 新 Attempt 重试、重复认领保护和 Artifact 唯一保护。
- Provider 改由 Rust 异步请求执行；API Key 只进入应用进程内 Worker 配置，不写入 Snapshot、Task、日志或 SQLite。Mock Provider 提供可控自动化路径。
- 取消请求先持久化 `cancel_requested`，再通过 Rust CancellationToken 中断 reqwest；最终持久化 `cancelled`，取消响应不会创建 Artifact。
- Worker 进度同时写入 SQLite 并通过 `ai-task-progress` Tauri Event 推送；React 提交后立即返回工作台，只负责任务条、任务中心、取消、重试和读取最终 Artifact。
- 成功仅写不可变 `quality_report` Artifact，不创建或采用正文，不自动修改 Canon；无效响应保存 invalid Artifact 并令任务失败。

### 任务 8C：候选生命周期与工作台可靠性加固

- 新增统一候选生命周期派生逻辑，集中校验候选、Task、Artifact、章节、冻结基线、约束、差异和 Proposal 身份，所有采用入口共享同一门禁。
- 生成任务增加 requestId/taskId/candidateId/chapterId 多层竞态校验；章节切换和重新生成时，旧异步结果不会覆盖新任务，失败或取消也不会污染已有候选。
- 正文发生变化时明确显示旧基线提示并禁止静默覆盖；已采用、失效、阻断、空正文、读取失败和差异失败均提供明确原因与下一步操作。
- 候选采用增加候选级并发合并、采用前权威复检和采用后权威重读，双击或并发调用只执行一次 ApplyPlan。
- 基于现有 Task、Artifact、Proposal、TargetLink 和草稿表增加只读候选恢复；重启后已采用候选不会恢复为待采用，取消或中断任务不会恢复为生成中。
- 新增 16 项候选生命周期、隔离、幂等、恢复与大文本测试；覆盖 15,198 字基线、24,198 字候选、600 处差异、20 次视图/章节切换和 10 次连续生成状态合并。
- 未修改数据库 migration/schema、Provider、版本号、路由和 AI 核心状态机。

## 未发布 - v2.3.0 / v2.4.0 第一阶段架构冻结（2026-07-12）

### 任务 8B：工作台 UI/UX 收敛

- 新增正文区 AI 候选全文审查模式，支持完整正文阅读、段落差异切换、约束提醒和明确绑定候选的采用操作。
- 章节生成改为右侧面板内的非阻塞进度与取消入口，生成期间可关闭面板并继续阅读当前正文。
- 右侧工具栏由 15 个常驻入口收敛为保存、版本、AI 创作、规划、审查和“更多工具”，移除无对象说明的常驻采用入口。
- 工程、上下文、总结等低频能力收进“更多工具”，Artifact、PlacementProposal、Constraint validation 和 Chapter diff 等普通视图文案改为面向作者的中文表达。
- 写作工作台不再常驻全局导航，正文舒适宽度收敛至 920px，并新增隐藏卷章树与右侧工具栏的专注写作模式。
- 保持应用版本 2.2.0，不修改数据库 schema、Provider 参数、统一 Task/Artifact 状态机、路由或正式正文写入事务。

### 新增

- 新增 Phase 3 基线审计文档，形成 27 个生产 AI 触发入口、17 个业务任务族及其 Provider、状态、Prompt、结果落位和迁移优先级清单。
- 新增 AI 状态所有权、Prompt/上下文、结果应用、SQLite 数据模型和 legacy 兼容审计，明确 P0/P1/P2 风险与可复用的 v2.2.0 原子保存/大文本/迁移账本边界。
- 冻结 AiTask、AiTaskAttempt、三类不可变 Snapshot、ResultArtifact、PlacementProposal、ApplyPlan 和 TextRangeLock 的字段语义与职责。
- 冻结后端权威状态机、单目标/多目标事务边界、commit unknown 对账、持久化幂等、UTF-16 正文范围锁及 005～016 拟新增迁移职责。
- 新增 v2.3.0 / v2.4.0 测试矩阵，覆盖 Task/Attempt、Artifact、Placement、Apply、范围锁、迁移和 browser/Tauri 兼容。

### 本阶段边界

- 本阶段只新增审计与架构文档，不修改生产 AI 行为、数据库 schema、版本号、Provider、路由或正式正文写入方式。
- v2.3.0 冻结为统一 Task/Artifact 与单目标安全应用；v2.4.0 冻结为 Context/Constraint/Target Builder、正文范围锁和多目标原子事务。
- 未执行 commit、push、tag、发布或正式 Tauri 安装包构建。

### v2.3.0-M1：AI 结果目标安全收口与统一管线基础设施

- 修复正文采用误取 latest 草稿、章节候选跨章写入、质量修稿确认前产生正式副作用，以及章节总结多表部分成功四项 P0 风险。
- 扩展浏览器与 Tauri 原子草稿保存来源字段，并新增按 novel/chapter/version/hash 校验、operationId/requestHash 幂等的精确采用命令。
- 落地 005～011 migration：AiTask、Attempt、三类不可变 Snapshot、ResultArtifact、Artifact Validation Issue，以及必要索引、外键和不可变 trigger。
- 新增 Rust 权威 Task 状态机、Attempt 重试/取消/迟到响应隔离、Provider Adapter 错误归一与可控中止，并区分可重试超时和用户取消。
- 新增 ResultArtifact raw/display 分离、大文本完整保存、结构化校验、来源基线校验和浏览器/Tauri 一致的 invalid Artifact 保留策略。
- 将设置连接测试、章节正文生成和手动质量检查迁移到统一管线；未迁移 AI 入口继续使用原有链路。
- 新增 `test:ai-task-pipeline`、`test:ai-artifacts`、`test:ai-p0-safety` 专项脚本；正式应用版本仍保持 2.2.0。
- 完成 M1 验收收口：逐项审查 44 个非文档改动文件，确认 `commands.rs` 实际语义差异仅为命令注册与模块接入，并清理换行/编码噪声。
- 补齐 Attempt 跨 Task 身份校验、取消与成功响应竞态、三类 Snapshot/ResultArtifact 删除保护，以及日志与外部取消路径的隐私和状态约束。
- 建立冻结测试编号到实际测试函数的映射，固定 001～011 精确 checksum，并补充真空库、v2.2 升级、重启幂等、三个迁移入口和四项 P0 的动态回归测试。
- 新增 `docs/audit/phase-3/08-v2.3.0-m1-acceptance.md`，集中记录文件必要性、迁移约束、动态证据、最终验证与 M2 准入结论。

### v2.3.0-M2 第一阶段：PlacementProposal、ApplyPlan 与单目标安全应用

- 新增 012～014 migration，持久化不可变 PlacementProposal/Target、ApplyPlan/Operation/Dependency 和 ArtifactTargetLink；固定 checksum、外键、索引及更新/删除保护 trigger。
- 新增 Proposal 创建、用户目标优先级、stale 校验与 rebuild；章节、草稿版本/hash、目标删除或项目 revision 变化后旧 Proposal 不再可应用。
- 新增不可变单目标 ApplyPlan、规范化 `requestHash`、持久 `operationId`、状态 CAS、幂等重放和 payload 冲突校验。
- 抽取 `save_chapter_draft_in_transaction` 与 `adopt_chapter_draft_in_transaction`，原子草稿门面和 ApplyExecutor 共用唯一正文 INSERT/采用核心。
- 新增 Rust `ApplyExecutor`：`BEGIN IMMEDIATE` 内再次校验目标和 Artifact，写正文、采用状态、修稿质量状态/上下文失效、ArtifactTargetLink 与 operation result 后统一提交；任一 affected rows 不符整体回滚。
- 正文生成候选在确认前只持久化为 Artifact/PlacementProposal；AI 修稿确认前不再创建候选草稿或候选质量报告，正式副作用只在 ApplyPlan 事务成功后发生。
- 新增 `test:placement`（10 个 Vitest 用例）与 `test:apply-plan`（12 个 Vitest 用例）防零专项；Rust 新增 24 个 M2 迁移/Placement/Apply/回滚/重放动态用例。
- 正式应用版本继续保持 2.2.0；未迁移入口、Task Center UI、TextRangeLock、多目标事务与 Legacy 清理仍不在本阶段范围。

### v2.3.0-M2 数据库兼容修复

- 为 pre-acceptance M1 数据库增加 007～010 已知历史 checksum 的受限兼容：仅在四条账本记录、001～006/011 前置账本和已审计历史结构完整匹配时放行，未知、伪造、不完整或新旧混合状态继续 fail-closed。
- 新增 `015_snapshot_delete_guards` 前向 migration，在保留历史 checksum 的前提下补齐三类 Snapshot 与 ResultArtifact 的四个 DELETE 不可变触发器，并继续执行 012～014。
- 增加旧库升级、迁移幂等、DELETE 保护、未知 checksum、混合账本、缺失前置账本和伪造结构的 Rust / SQLite 回归测试。
- 数据库启动初始化改为显式错误传播，移除目录创建、连接、PRAGMA、建表/迁移和全局连接注册阶段的未处理 panic；继续保持初始化失败即停止启动的 fail-closed 行为。
- 开发构建输出仅含白名单诊断字段；Release/安装版使用原生错误对话框区分 checksum、历史兼容、数据库损坏、migration、占用和一般初始化故障，不展示作品内容、SQL、数据库路径或实际 checksum。

### 真实 Provider 质量检查兼容修复

- 质量检查统一管线现在解析 fenced JSON、snake_case 字段和受限中文枚举；首次请求即附加 JSON-only 合约，普通正文响应最多再纠正一次，保持兼容服务要求的原消息角色顺序，并完整保留原有 Provider、模型、温度和 Token 参数。
- 修复后复检会将字符串型 Provider 失败归一为脱敏、可理解的错误，不再退化成无原因的“AI 修稿失败”。
- 修复 Tauri 质量修稿记录参数封装和异步落库：`quality_fix_runs` 在候选展示前必须写入 SQLite 并进入 `validated`，持久化失败不再静默降级到 LocalStorage，ApplyPlan 因而能原子更新唯一修稿记录。
- 两次响应仍不满足质量报告结构时继续生成 invalid Artifact 并 fail-closed，不创建伪造 issue，也不进入质量修复 ApplyPlan。

### 章节生成 Context / Constraint Compiler 第一阶段

- 新增确定性章节生成编译器，在 Provider 调用前收集并验证当前 novel / volume / chapter / draft 基线、采用正文、近期章节状态、前文摘要、未解决线索、角色、世界规则、章节事件、质量问题和工程约束。
- Context Snapshot 现在保存有来源 hash、章节隔离身份、编译版本、24,000 Unicode 字符预算和裁剪统计的受预算上下文；Constraint Snapshot 保存固定顺序的 `must` / `should` / `forbid` 约束、12,000 Unicode 字符预算、稳定 hash 和实际模板 hash。
- 章节生成预览与正式生成共用同一编译链路；编译失败、基线不一致、跨作品/跨章节请求或疑似凭据都会在创建 Provider 客户端和 Attempt 前 fail-closed。
- Prompt 模板增加已编译约束和当前采用正文的受控区块；未改变 Provider、模型、温度、Token、应用版本或任何 migration。
- 新增编译稳定性、章节/作品隔离、预算裁剪、缺失数据降级、凭据排除、入口 Snapshot 绑定、Provider fail-closed 与 Snapshot 事务回滚测试；`task18` 确认 Context Snapshot 写入失败时 Task、三类 Snapshot 和 Attempt 全部回滚。

### 章节约束验证与正文差异预览

- 新增确定性章节 Artifact 约束验证器，完全使用冻结的 Task、Input/Context/Constraint Snapshot 和 Artifact 正文；不发起额外 Provider 调用。
- 按 `must`、`should`、`forbid` 输出稳定验证结果。`must`/`forbid` 的失败或未知会阻止 PlacementProposal/ApplyPlan，`should` 保留为用户可见的确认前警告。
- 验证结果追加写入现有 `artifact_validation_issues`：每次运行具有独立 `validationRunId`，保留原始 Artifact，不保存正文、Prompt 或凭据到问题消息或诊断。
- 新增 Rust 权威 gate 与浏览器回退服务复检：章节生成 Artifact 必须具有最新可用验证结果；Proposal 校验、创建 ApplyPlan 和首次 Apply 均会拒绝已阻断或缺少验证的候选，已完成结果仍按原 operation 幂等重放。
- 新增冻结 source draft 与 Artifact 正文之间的段落级差异摘要与可展开预览；差异不写入数据库或 LocalStorage，基线 ID、版本、hash、作品或章节不一致时 fail-closed。
- 新增 `test:constraint-validation` 与 `test:chapter-diff`，覆盖验证规则、隔离、敏感信息脱敏、差异稳定性、长正文及 Rust 追加账本/authority gate；未修改 migration、应用版本或 Provider 参数。

## v2.2.0 (2026-07-11) - 工作区可靠性与基础设施收口

### 新增

- 建立带固定顺序、checksum 和事务记录的 `schema_migrations`，新增恢复快照、草稿保存幂等和大文本完整性迁移。
- 新增可序列化 `AppError`、稳定错误码、`traceId` / `operationId` 和正文脱敏结构化日志。
- 新增 `save_chapter_draft_atomic`：正文、分片、草稿引用和 operation 结果在单一 SQLite 事务内提交，相同 operation 重试返回原结果。
- 新增长正文 fail-closed 读取状态，校验分片数量、顺序、字符/字节长度、分片/全文哈希、document 状态和草稿引用。
- 新增独立 `workspace_recovery_snapshots`，支持 debounce 写入、长内容分片、精确清理、匹配恢复和冲突另存候选。
- 新增统一工作区 Leave Guard，覆盖章节切换/创建、草稿恢复/采用、Hash 路由、程序/历史导航和 Tauri 窗口关闭。
- 接入 Vitest 3、React Testing Library、user-event 和 jsdom，新增 T01～T12 与 DB01～DB16 动态测试及防假绿脚本。

### 修改

- Hash 路由切换为 `createHashRouter + RouterProvider`，保留现有路径和桌面 Hash URL，同时支持统一导航阻断。
- 已采用草稿保持不可变；后续编辑保存为新候选版本。
- 正文不可用时不挂载 textarea，禁止保存、采用、生成、润色、质检、重写和覆盖，预览不进入 AI 上下文。
- 正式保存成功后精确清理当前章节恢复快照；提交后的临时缓存清理失败只记录维护 warning，不误报保存失败。
- Tauri 关闭权限收敛为最小 `window-close` allowlist，关闭确认采用一次性 bypass 防止递归。

### 兼容性

- 保留旧基线初始化和普通草稿读取；旧大文本 draft/chapter/null target 形式通过草稿引用做兼容校验。
- 旧草稿写命令代码暂时保留但不再暴露为 Tauri 保存入口，避免绕过原子保存边界。

## v2.1.1 (2026-07-11) - 正文变更安全门

> 状态：实施完成。Node / Rust 安全测试与静态契约检查已通过；当前工作区未安装 `node_modules`，前端类型检查、Vite 构建和 Tauri 完整打包待在依赖齐备环境复验。

### 新增

- 为 AI 生成、润色、质量修复和历史草稿等正文结果建立统一变更请求，固定记录作品、章节、来源草稿、基础版本、基础正文哈希与结果 ID。
- 新增正文变更冲突检查：目标章节已经切换、基础正文已经变化或同一结果已经应用时，拒绝静默覆盖当前编辑内容。
- 补充 Node 动态安全原语测试，使用可控延迟验证章节切换后的迟到加载 token 会在 commit 前被 guard 拒绝。
- 补充 Rust / SQLite 安全测试，覆盖不存在草稿、跨章节草稿、零行更新、正式采用事务回滚等故障路径。

### 修改

- 统一章节加载和 AI 结果回调的目标校验，隔离快速切换章节时的乱序异步响应。
- 工作台按钮导航、章节切换、草稿恢复 / 采用和新建章节共用未保存正文保护；保存失败时保持 dirty，不继续切换。
- 草稿更新在零行受影响时返回明确冲突；正式采用在单一 SQLite 事务中验证草稿归属并原子切换正式版本。
- 使用结果 ID、目标章节和基础版本 / 哈希提供当前工作区会话内的最小幂等保护，避免重复点击重复写入正文。
- 修复 AI 任务删除运行时测试的临时 Schema 和退出码传播，使 Rust 测试失败能够正确阻断 npm / CI。
- 质量修复只在 report 的 draft ID、draft version 和 content hash 同时匹配时放行；旧报告缺少 hash / version 时要求重新检查。
- 应用版本号、前端常量、Tauri / Cargo 和包元数据统一为 `v2.1.1`，Node.js 最低版本调整为 22.6。

### 本版本边界

- 不实现流式输出、通用多目标自动放置、正文锁定模型、任务队列全面重构或状态管理库替换。
- 大文本端到端事务、面板结果跨重启恢复、人物知识图谱和完整桌面 E2E 继续作为后续专项。

### 验证结果

- `npm run test`：通过，5 / 5。
- `npm run test:workspace-safety`：通过，5 / 5。
- `cargo test`：通过，11 / 11（验证时用临时 `TAURI_CONFIG` 指向现有 `src/`，仅绕过未生成的 `dist/`）。
- `cargo test commands::tests -- --nocapture`：通过，9 / 9。
- `npm run test:ai-tasks-delete`：通过，静态契约和 1 个完整临时 SQLite 运行时用例均通过。
- `npm run test:setting-suggestions` / `npm run test:quality-workspace`：通过。
- `cargo check`：通过，保留 10 条既有 warning。
- `npm run lint`：未进入检查，当前环境缺少 `node_modules` / `eslint`。
- `npm run build`：未进入编译，当前环境缺少 `node_modules` / `tsc` / `vite`。
- `npm run tauri build`：未进入打包，当前环境缺少前端依赖与 Tauri CLI。

## v2.1.0 (2026-06-27) - 单章质量闭环稳定版

### 新增

- 章节工程面板新增“工程 / 快照 / 生成 / 版本 / 质检 / 修复”闭环摘要，集中展示单章正文生产链路状态。
- 质检页新增最新结构化质量报告摘要、待处理问题列表与风险分布，生成完成后会自动刷新。
- 任务页新增局部修复建议、低风险数量、自动应用数量与待确认数量汇总。

### 修改

- AI 生成草稿与自动修复草稿写入来源 `generation_job` ID，正文版本可回溯到具体任务。
- 应用版本号更新为 `v2.1.0`。

### 修复

- 修复右侧草稿历史面板无法像其他右侧面板一样点击外部关闭的问题。
- 修复草稿历史中“采用”草稿后未同步回写作工作台当前正文状态的问题。
- 修复右侧普通面板收起时被卸载，导致面板内部临时状态无法保留的问题。
- 右侧工具栏入口改为原生按钮，补齐键盘触发与焦点反馈。
- 修复导出服务误用最新草稿判断已采用正文，导致采用后继续生成新草稿时 TXT / Markdown 导出失败的问题。
- 修复整本 Markdown 导出中无分卷章节只写入占位提示、未写入正文的问题。
- 导入导出中心补齐完整 JSON 备份入口，并在导入弹窗关闭后刷新作品与章节状态。

## v2.0.3 (2026-06-27) - 正文版本管理增强

### 新增

- 草稿历史面板显示与当前草稿匹配的最新质量检查评分。
- 草稿历史面板新增“废弃”操作，非正式草稿可直接从版本列表移除。

### 修改

- 草稿历史“载入”文案调整为“恢复”，明确其作用是恢复到当前编辑区；“采用”继续作为正式正文入口。
- 应用版本号更新为 `v2.0.3`。

## v2.0.2 (2026-06-27) - 局部修复 Patch

### 新增

- 正文生成任务在质量检查后新增 `patch_generation` 与 `patch_apply` step，基于结构化问题生成局部修复建议。
- 低风险且能精确命中原文 quote 的 patch 会自动应用，并保存为新的 AI 局部修复草稿版本；中高风险或无法精确命中的 patch 仅记录在 step 输出中。

### 修改

- 应用版本号更新为 `v2.0.2`。

## v2.0.1 (2026-06-27) - 生成后结构化质量检查

### 新增

- 正文初稿生成任务在保存草稿后自动执行 `quality_check` step，调用现有 AI 质量检查服务并保存结构化报告与问题列表。
- 生成任务 step 输出新增质量评分、问题数量、待处理数量和报告 ID，工程面板任务页可直接查看本次生成的质检摘要。

### 修改

- 应用版本号更新为 `v2.0.1`。

## v2.0.0 (2026-06-27) - 基于工程面板的正文初稿生成

### 新增

- `GenerationJobService` 新增真实正文初稿任务：编译 `generation_context_snapshot` 后调用当前 AI 设置的正文模型，并将结果保存为章节草稿版本。
- 章节工程面板“任务”页签新增“生成本章初稿”入口，展示任务进度与 step 输出，生成成功后同步回写作台草稿流。
- 正文生成请求改为基于已编译快照构造 prompt，记录 context hash、模型信息与 token 返回摘要。

### 修改

- 应用版本号更新为 `v2.0.0`。

## v1.9.7 (2026-06-27) - API 任务队列与 Mock Runner

### 新增

- 新增 `generation_jobs` 与 `generation_step_results` SQLite 表、迁移和 Tauri 命令，支持创建、查询、更新、取消生成任务，并记录每一步结果。
- 新增 `GenerationJobService`，支持 `chapter_generation_mock` 任务从预检、上下文编译、章节卡、场景计划到 mock draft / skipped 后续步骤的完整跑通。
- 章节工程面板新增“任务”页签，可启动 Mock 任务、查看任务进度、step 输出和取消正在运行的任务。

### 修改

- 应用版本号更新为 `v1.9.7`。

## v1.9.6 (2026-06-27) - 生成上下文编译器

### 新增

- 新增 `GenerationContextCompiler`，将旧式章节上下文、active 章节工程状态、风格/输出控制、当前正文修改编译为统一 `generation_context_snapshot`。
- 新增 `chapter_generation_snapshots` SQLite 表、迁移与 Tauri 读写命令，保存 `compiled_context_json`、`compiled_prompt_text`、`prompt_summary`、`context_hash` 与上下文来源列表。
- 章节工程面板新增“快照”页签，支持手动编译上下文快照、查看来源状态、摘要、hash 与 prompt 预览。

### 修改

- 应用版本号更新为 `v1.9.6`。

## v1.9.5 (2026-06-27) - 章节工程面板

### 新增

- 新增右侧“章节工程”面板，支持维护章节卡、场景计划、生成约束、质量规则与工程版本状态。
- 新增章节工程草稿保存与“保存并应用”流程，区分 draft / active / archived 状态，为后续正文生成上下文编译提供 active 工程输入。
- 新增 `chapter_engineering_states` SQLite 表、迁移与 Tauri 命令，同时保留浏览器开发环境 localStorage 回退。

### 修改

- 写作工作台右侧工具栏新增“工程”入口，保持原有 AI 生成、大纲、角色、事件、设定、风格、上下文、总结、检查、润色等入口不变。
- 应用版本号更新为 `v1.9.5`。

## v1.7.20 (2026-06-24) - 写作台启动、布局与质量检测链路修复

### 修复

- 追加修复质量检测工作台链路：`quality_check_reports` 持久化 `content_hash` / `content_length` / `checked_at`，确保重启或重新打开面板后仍能判断报告是否对应当前正文；AI 修稿复检未明显变好时不再把候选草稿同步覆盖到写作工作台正文。
- 修复写作工作台正文工具栏入口点击后右侧面板被父级点击事件立即关闭的问题，确保“AI 生成 / 质量检测 / 草稿历史”等工作台内入口可以真正展开对应面板。
- 修复启动加载页过早被移除导致开机动画不明显的问题，确保 React 首屏挂载后仍保留最短展示时间再淡出。
- 修复写作工作台首次进入偶发误判“作品不存在”，现在会在判定前进行短重试和作品列表反查。
- 修复质量检测保存失败时桌面端错误被 localStorage 兜底改写成“报告不存在”的问题，并在报告占位缺失时自动重建一次后重试保存。
- 修复桌面端质量检测保存结果传参错误，`save_quality_check_result` 现在按 Tauri 命令要求传入 `{ input }`，不再出现 missing required key input。
- 修复 AI 修稿复检读取 `revised_content` / `fixed_issue_keys` 等 snake_case 返回字段失败的问题，避免正确返回的修订版正文被误判为空。
- 移除正文编辑区内“保存草稿 / 查看大纲 / 草稿历史 / AI 生成 / 质量检测 / 一键排版 / 确认采用”旧按钮条，并将保存、草稿、排版、采用入口收纳到右侧功能栏。
- 启动阶段不再等待系统强调色读取后才挂载 React，降低冷启动白屏风险。
- 新增静态启动加载页与前端/后端启动耗时日志，启动时不再显示纯白无反馈页面。
- 质量检查改为基于当前编辑器正文快照；未保存正文会先保存为检查快照草稿，再绑定检查报告。
- 修复质量检查报告只在 localStorage 创建、Tauri 保存结果时找不到报告的问题。
- 质量检查结果新增正文 hash/长度/检查时间快照，正文变更后显示过期提示。
- 质量检查面板折叠/展开保留当前章节结果，切换章节时不显示错误章节的检查结果。
- AI 修稿和润色链路使用当前编辑器正文快照，生成的新草稿会同步回正文编辑区。

### 修改

- 写作台顶部工具栏按“草稿与章节 / AI 与排版 / 确认采用”分组。
- 正文编辑区减少外层留白，扩大可用编辑宽度，同时保留阅读宽度上限。
- 右侧质量面板打开时正文区域让出面板空间，大窗口下分栏更稳定。
- 质量检查 prompt 增加“只分析当前正文快照”的硬性约束，并要求证据来源于正文。

## v1.7.13 (2026-06-24) - 章节总结升级为章节上下文，打通上下文入库

### 新增

- **章节总结 → 章节上下文升级**：
  - 章节总结不再是临时文本，而是绑定章节、绑定正文版本的**章节上下文**。
  - 生成后自动进行一致性校验（本地算法），检测编造、遗漏、角色错误、设定错误、推测等问题。
  - 校验通过后自动启用并写入上下文记录，供后续 AI 生成调用。

- **一致性校验** (`summaryValidator.ts`)：
  - 本地关键词匹配算法，快速检测总结与正文的明显矛盾。
  - 校验结果分 `passed`/`failed`，score 低于 70 不自动启用。
  - 导出 `hashContent()` 用于正文版本绑定。

- **卷自动归类**：
  - 章节上下文根据 `chapter.volume_id` 自动归类到所属卷。
  - 章节未归属卷时阻止生成，提示用户先归类。

- **过期机制**：
  - 章节上下文绑定 `content_hash` 和 `draft_version`。
  - 正文版本变化后自动标记上下文为已过期。
  - 过期上下文默认不参与 AI 生成。

- **上下文记录面板升级** (ContextViewPanel)：
  - 新增分类标签：全部 / 章节上下文 / 手动上下文。
  - 过期记录计数和标记。

- **Tauri 后端命令** (新增 9 个)：
  - `save_chapter_summary` — 创建/更新章节总结。
  - `get_chapter_summary` — 按章节 ID 获取。
  - `mark_chapter_summaries_expired` — 标记过期（含关联 context_records）。
  - `update_chapter_summary_enabled` — 启用/停用。
  - `save_context_records` — 批量保存上下文记录。
  - `get_context_records` — 获取作品全部上下文。
  - `update_context_record_active` — 切换启用。
  - `delete_context_record` — 删除。

### 数据库迁移

- `chapter_summaries`：新增 `volume_id`、`enabled`、`content_hash`、`draft_version`、`is_expired`、`validation_status`、`validation_result`、`core_events`、`protagonist_state_change`、`important_character_changes`、`setting_changes`、`new_locations`、`new_items_or_abilities`、`foreshadowing`、`unresolved_questions`、`facts_must_remember`、`next_chapter_hook`。
- `context_records`：新增 `volume_id`、`is_expired`、`content_hash`、`draft_version`。

### 修改

- `src/types/chapterSummary.ts`：新增 `ChapterSummaryValidation`、`ValidateSummaryInput`；`ChapterSummary` 扩展结构化字段 + 校验/过期/启用字段。
- `src/types/context.ts`：`ContextRecord` 新增 `volumeId`/`isExpired`/`contentHash`/`draftVersion`；新增 `ContextCategory` 分类类型。
- `src/services/ai/summaryValidator.ts`：新增一致性校验 + 正文哈希工具。
- `src/services/context/chapterSummaryService.ts`：升级为 Tauri + localStorage 双模。
- `src/services/context/contextRecordService.ts`：升级为 Tauri + localStorage 双模，新增 `createBatch`。
- `src/components/right-dock/panels/ChapterSummaryPanel.tsx`：增加校验流程、过期提示、卷归属检查、启用/停用按钮。
- `src/components/right-dock/panels/ContextViewPanel.tsx`：增加分类标签、过期计数。
- `src-tauri/src/commands.rs`：新增 ChapterSummary + ContextRecord 相关 DTOs 和 9 个命令。
- `src-tauri/src/db.rs`：新增 `migrate_chapter_summaries_table` 和 `migrate_context_records_table`。
- `src-tauri/src/main.rs`：注册 9 个新命令。

## v1.7.12 (2026-06-24) - 修复 AI 任务记录删除 FOREIGN KEY 约束失败 + 质量检查问题处理闭环

### 修复

- **修复 AI 任务记录删除 FOREIGN KEY constraint failed 问题**（根因修复）：
  - `ai_task_records` 被 3 个子表通过外键引用：`chapter_drafts.ai_task_id`、`quality_check_reports.ai_task_id`、`polish_records.ai_task_id`。
  - 原删除逻辑直接 `DELETE FROM ai_task_records`，未先清理子表引用，导致 SQLite 外键约束阻止删除。
  - 修复后：单条删除、多选删除、清空全部均**先清理子表 `ai_task_id` 引用，再删除父表记录**。
  - 所有删除操作均包裹在显式事务中（`BEGIN TRANSACTION` / `COMMIT` / `ROLLBACK`）。
  - 额外清理 `chapter_events` 和 `chapter_summaries` 中的 `ai_task_id` 引用以保持数据整洁。
- Rust `DeleteAiTaskRecordsResult` 新增 `deleted_child_rows` 字段，记录各子表清理行数。
- 前端 `DeleteAiTaskRecordsResult` 类型同步新增 `deletedChildRows` 字段。

### 新增：质量检查「问题处理闭环」正式可用化

- **数据库迁移**：
  - `quality_check_reports` 新增 `draft_version`、`model` 字段。
  - `quality_check_items` 新增 `status`（pending/resolved/ignored）、`issue_key`、`resolution_note`、`resolved_at`、`paragraph_index`、`category`、`quote` 字段；弃用旧 `is_resolved` 布尔值。
  - 新增索引：`idx_quality_check_items_issue_key`、`idx_quality_check_items_status`、`idx_quality_check_items_chapter_id_status`。

- **Tauri 后端命令**（新增 4 个）：
  - `get_quality_check_issues(chapter_id)` — 获取最新报告 + 问题列表 + 统计。
  - `update_quality_issue_status(issue_id, status, resolution_note?)` — 更新单条问题状态。
  - `batch_update_quality_issue_status(issue_ids, status)` — 批量更新。
  - `save_quality_check_result(input)` — 保存 AI 检查结果，自动根据 `issue_key` 合并历史问题，保留用户 ignored 状态。

- **前端服务层重构**：
  - `qualityCheckService` 从纯 localStorage 升级为 Tauri SQLite + localStorage 回退双模式。
  - 新增 `generateIssueKey()` — 基于章节 ID + 类别 + 标题 + 引用 + 描述生成稳定 hash，用于重新检测时去重。
  - 新增 `computeStatistics()` — 统一计算 pending/resolved/ignored/critical/high/medium/low 统计。

- **质量检查面板 UI 重构** (CheckPanel.tsx)：
  - 问题状态从布尔 `isResolved` 改为三态：待处理 / 已处理 / 已忽略。
  - 新增筛选按钮：全部 / 待处理 / 已处理 / 已忽略，带数量显示。
  - 统计区显示：总问题、待处理、已处理、已忽略、严重程度分布。
  - 问题卡片增加状态标签和操作按钮：定位、标记已处理、忽略、重新打开。
  - 乐观更新 + 失败回滚，确保 UI 状态与数据库一致。

- **正文定位功能**：
  - EditorArea 新增 `locateTarget` prop：支持按 offset 或文本搜索定位。
  - CheckPanel 新增「📍 定位」按钮，点击后滚动到正文对应位置并短暂高亮。
  - WritingWorkspacePage 中转 `onLocateText` 回调贯穿 RightPanel → CheckPanel → EditorArea。

### 修改

- `src-tauri/src/commands.rs`：新增 quality check 命令 + DTOs + `OptionalExt` trait。
- `src-tauri/src/db.rs`：新增 `migrate_quality_check_tables` 迁移函数。
- `src-tauri/src/main.rs`：注册 4 个新质量检查命令。
- `src/types/qualityCheck.ts`：新增 `QualityIssueStatus`、`QualityIssueFilter`、`QualityCheckStatistics`、`GetQualityCheckIssuesResult` 等类型。
- `src/services/quality/qualityCheckService.ts`：完全重写。
- `src/components/right-dock/panels/CheckPanel.tsx`：完全重写。
- `src/components/right-dock/RightPanel.tsx`：新增 `onLocateText` prop。
- `src/components/workspace/EditorArea.tsx`：新增 `locateTarget` 定位功能。
- `src/pages/WritingWorkspace/WritingWorkspacePage.tsx`：新增定位状态管理和回调。

### 修改（续）

- `src-tauri/src/commands.rs`：
  - `delete_ai_task_records_by_ids_internal`：新增事务 + 子表清理逻辑。
  - `clear_ai_task_records_internal`：新增事务 + 子表清理逻辑。
  - `DeleteAiTaskRecordsResult` 结构体新增 `deleted_child_rows` 字段。
- `src/services/ai/aiTaskService.ts`：`DeleteAiTaskRecordsResult` 接口新增 `deletedChildRows`。

### 备注

- 未使用 `PRAGMA foreign_keys = OFF` 或 `ON DELETE CASCADE`，保持外键约束完整性。
- 不影响作品、章节、草稿、大纲、角色、设定库等无关业务数据。

## v1.7.11 (2026-06-08) - 发布收尾、本地构建产物清理与安装包验证

### 新增

- 新增本地大文件扫描脚本 `scripts/maintenance/report_large_files.ps1`。
- 新增旧构建产物归档脚本 `scripts/maintenance/archive_old_builds.ps1`，默认 dry-run。
- 新增旧构建产物清理脚本 `scripts/maintenance/clean_old_builds.ps1`，默认 dry-run。
- 新增安装包验证清单文档 `docs/technical/installer-verification.md`。
- 新增发布产物保留策略文档 `docs/technical/release-artifact-policy.md`。
- 新增本地构建清理说明文档 `docs/technical/local-build-cleanup.md`。

### 修改

- 版本号统一更新至 `1.7.11` / `v1.7.11`。
- 同步 README 当前版本与阶段说明。
- 同步版本路线图，新增 v1.7.11 节点。
- v1.7.10 NSIS/MSI 安装包标记为稳定基线保留。

### 修复

- 修复 AI 任务记录多选删除、筛选删除和清空全部只删除浏览器本地缓存、不删除 SQLite `ai_task_records` 数据的问题。
- 新增 AI 任务记录删除静态回归检查脚本，覆盖后端命令、Tauri 注册、服务层调用和页面刷新反馈。
- 二次加固 AI 任务记录删除链路：Tauri 环境下移除 `getAll` 等读取接口的错误 localStorage fallback，删除命令返回 SQLite 路径、删除前后计数和命中计数。
- 新增 AI 任务记录运行时删除验证脚本，使用临时 SQLite 文件执行插入、按 ID 删除、重新计数、清空和最终计数校验。
- 三次修复 AI 任务记录清空失败显示“未知错误”的问题：Tauri 字符串错误会被规范化为真实错误摘要，页面和 `dbCall` 均打印完整错误对象，Rust 清空命令补充表存在性、数据库路径和删除前后计数日志。

### 备注

- 本版本不新增业务功能。
- 本版本不修改数据库 schema。
- 本版本不开发分卷、章节、正文生成。
- 本版本不自动删除任何文件。
- 本版本不自动 commit / tag / push。

---

## v1.7.10 (2026-06-08) - 候选设定采纳与测试补齐

### 新增

- 新增设定候选采纳流程，支持角色、势力、地点、规则候选的采纳、编辑后采纳与废弃。
- 新增候选状态流转：`pending`、`adopted`、`edited_adopted`、`discarded`。
- 新增重复采纳保护，已处理候选不能再次写入正式资产。
- 新增 `npm run test:setting-suggestions` 静态回归脚本，检查路由、状态、Mock 支持、采纳入口与重复采纳保护。

### 修改

- 版本号统一更新至 `1.7.10` / `v1.7.10`。
- 同步 README、路线图、设定推演设计、导入导出说明与测试文档。

### 验证

- 覆盖设定候选生成、列表展示、状态过滤、采纳、编辑后采纳与废弃的静态回归检查。

### 开发者备注

- 本版本不修改数据库结构。
- 角色候选采纳进入角色库。
- 规则候选采纳进入规则体系。
- 势力、地点候选在当前正式资产模块尚未独立拆分前，采纳为世界设定条目。
- 本版本不实现 v1.8.0+ 的分卷大纲生成、章节大纲生成或正文生成新链路。

---

## v1.7.9 (2026-06-08) - 设定库 AI 推演基础版

### 新增

- 新增 `/novels/:id/setting-suggestions` 页面，用于生成设定库候选。
- 新增 `/worlds/:worldId/lore/suggestions` 兼容入口。
- 新增 `settingSuggestionService`，统一封装候选生成、解析、保存、采纳和废弃。
- 新增设定候选类型定义：角色、势力、地点、规则。
- 新增 Mock AI 输出，支持无 API Key 测试设定推演流程。
- 新增 AI 任务类型 `setting_suggestion_generate`，候选生成会进入 AI 任务记录。

### 修改

- 作品详情页和创作资产页增加“设定库 AI 推演”入口。
- 顶部栏识别设定推演页面标题。

### 开发者备注

- AI 只生成候选，不自动写入正式数据。
- 候选池保存在本地 LocalStorage，不新增 SQLite 表。

---

## v1.7.8 (2026-06-08) - 导出文件位置选择与导出体验优化

### 新增

- 桌面模式下通过 Tauri 保存对话框选择导出位置。
- 导出成功后在 UI 中展示保存路径。
- JSON 备份使用统一保存服务，不再依赖未定义的浏览器下载函数。

### 修改

- 章节 TXT / Markdown、整本 TXT / Markdown、JSON 备份导出接口统一返回保存路径。
- 扩展 Tauri 文件系统写入权限到用户主目录、文档、下载和桌面目录。

### 修复

- 修复 `exportNovelToMarkdown` 返回类型与调用方不一致的问题。
- 修复 `exportNovelBackupJson` 调用未定义 `downloadBlob` 的问题。
- 修复 Tauri 配置 JSON 结构错误。

---

## v1.7.7 (2026-06-08) - 桌面端窗口与 2K 适配

### 新增

- 首页、作品详情页、创作资产页、导入导出页增加更适合桌面端和 2K 分辨率的响应式布局约束。
- 设定推演页面采用桌面工作台式双栏布局，并在窄窗口下自动收敛为单栏。

### 修改

- 卡片网格改为自适应列宽，避免 2K 屏幕上表单和卡片被无限拉伸。
- 作品详情页基础信息卡片改为响应式网格。

---

## v1.7.6 (2026-06-08) - 阶段性整理、文档体系重整与 EXE 验证

### 新增

- 新增 `docs/README.md` 文档索引。
- 新增 `docs/user/` 用户指南分组。
- 新增 `docs/project/` 项目管理文档分组。
- 新增 `docs/technical/` 技术文档分组。
- 新增 `docs/design/` 设计文档分组。

### 修改

- 重构 `README.md` 结构，使其更适合使用者和开发者阅读。
- 将过长说明拆分到 docs 子文档。
- 统一版本路线说明，README 与 version-roadmap 同步。
- 更新 Tauri 默认窗口尺寸为 1280 × 820，最小窗口高度为 700。

### 验证

- 前端构建通过。
- 现有路由不受影响。

### 开发者备注

- 本版本不新增核心业务功能。
- 本版本不修改数据库结构。
- 本版本用于完成 v1.7.x 应用化阶段的文档与结构收口。

---

## v1.0.46 (2026-05-26) - Tool Layer 接入真实项目读取

### 新增

- `src/agent-tools/style-tools.ts`：风格方案只读 Tool。
- `src/agent-tools/context-tools.ts`：Agent 可读上下文聚合 Tool。
- `src/agent/context-summary.ts`：上下文摘要格式化器。
- `createChapterReadinessWorkflow()`：章节准备度检查 Workflow。
- `validateWorkflow()`：Workflow 结构校验器。

### 修改

- `project-tools.ts`、`chapter-tools.ts`、`verification-tools.ts` 从占位升级为读取真实项目数据的基础接口。
- `planner-lite.ts` 新增 Chapter Readiness Workflow。
- `workflow-runner.ts` 新增 Workflow 结构校验。

### 开发者备注

- Tool Layer 只读，不写数据库、不自动写正文、不调用外部 AI。
- 不修改数据库 schema。

---

## v1.0.45 (2026-05-26) - 项目开发辅助 Skills 增强版

### 新增

- 新增开发辅助 Skills、Checklists、Cursor Rules 与 `docs/development-skills.md`。

### 修改

- 完善 Agent 任务书、Bug 修复、文档同步、发布与验证工作流规则。

---

## v1.0.44 (2026-05-26) - Agent Workflow Runtime 最小闭环

### 新增

- 新增 Agent Workflow Scripts、Agent Checklists、Workflow Docs、Agent Core、Agent Tools 与 Prompt Pipeline 基础文件。

### 开发者备注

- 不新增小说业务功能。
- 不修改数据库 schema。
- 不替换现有正文生成链路。

---

## v1.0.43 (2026-05-26) - Agent 基础设施建设

### 新增

- 新增 `AGENTS.md`、GitHub instructions、prompts、skills、Cursor Rules 与基础架构文档。

### 开发者备注

- 建立 Agent 工程化开发约束，为 v2.x Agent 化阶段打基础。

---

## v1.0.41

- 早期基础版本。

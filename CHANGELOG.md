# AI Novel Studio - CHANGELOG

> 当前版本：v3.6.0。本节记录对话式创作工作台、能力资产化、运行时边界与桌面发布基线。

## v3.6.0 (2026-08-31) - 智能体创作平台与长篇小说记忆层

### 新增

- **UI 动效与交互反馈收敛**：建立 80/120/180/220/260ms 的统一 CSS 动效与 easing Token，清理 `transition: all`、全局侧栏尺寸动画和审阅面板造成的正文占位重排；写作工作台右侧面板改为覆盖式开合并在关闭后保持不可点击、不可聚焦，正文宽度、换行、选区和滚动不再参与动画。创作工作台新增真实 `preparing` 反馈，运行工具只保留单一 Spinner，自动跟随保持即时滚动且历史产物不重播高亮；正文与章节大纲保存改为内联 `saving/saved/error` 状态，正式保存与恢复快照继续明确区分，并补齐章节树轻量进入反馈及 reduced-motion 静态终态。
- **统一桌面线性图标语言与双层门禁**：保留创作工作台左侧导航的 8 个既有 Lucide 图标，以显式尺寸与 `strokeWidth={1.8}` 为全局基准，将页面、设置、小说详情、导入导出、章节审阅、Agent 轨迹和 legacy 右侧工具中的 Emoji、字符按钮、状态图标与业务填充统一为语义化 `lucide-react` 线性图标；静态门禁覆盖生产 TS/TSX/JS/JSX/MJS 与 CSS，拒绝 Unicode/字符图标、手写 SVG、图片或其他图标库、自绘 spinner、非 1.8 描边、缺失尺寸和业务填充，并以真实 Edge DOM 契约覆盖主要路由、关键弹窗和章节审阅面板。
- **真实对话 3 万字完成前缀分析**：新增可复现 checkpoint 分析器，在完整运行于目标后失败时只接受从第 1 章开始连续通过且达到目标字数的章节；独立输出正文与分析报告，重算每章字数、正文哈希、候选采用链、Session、Context 和 Memory 证据，并明确保留原运行失败状态与未纳入章节。
- **设置中心 API 模型卡片**：全局 Cloud Provider、专用本地正文模型和外部模型网关的已保存项都以卡片展示（名称与绑定/测试状态），不显示密钥、地址或采样参数；支持各保存多份并切换当前使用项，Key 仍只留在本次应用会话内存。
- **创作工作台核心主路径闭环**：创作工作台接入真实写章管线 `workbenchChapterWriter` 与精准意图路由（`taskGoalRouting`），彻底分离只读/检索意图与写章意图；增加顶部显式目标章节下拉选择与无章节空状态安全引导；失败按参数/数据/服务/模型分层精准诊断。
- **草稿采用与长程记忆自动沉淀**：章节草稿采用（Adopt）后自动进行正文切片，并持久化写入 SQLite `memory_documents`（浏览器环境写入本地持久化存储），使后续长篇创作 `search_memory` 能真实召回已采用的正文与实体上下文。
- **产物决定与迭代修改增强**：产物卡片「要求修改」操作与输入框深度联动，自动带上修改提示前缀与上下文；左侧各二级功能模块（资产中心、风格方案、模板中心、AI任务记录）统一导航回创作工作台（`/`）。
- **模型无关 Creative Runtime 与双模型架构（Phase 5.1）**：`RouteDecision` 纯函数按 Role 智能选择云端导演或本地作家；本地作家生命周期（AVAILABLE / TRAINING / TESTING / FAILED / DISABLED）为进程内状态；`chapter_scene_generate` 在本地训练、失败、不健康或超限时自动使用云端代写**同一 Beat 契约**；新增无本地模型的正式云端正文模式与外部模型网关（AI Model Gateway）。
- **三层 Novel Memory 实验算法（Phase 1-3）**：提供长期/中期/短期片段的场景召回、角色/世界状态增量演进和 `MemoryVersionSnapshot` A/B 评测能力；这些片段、状态与快照当前由 TypeScript 进程内 `Map` 管理，不具备跨重启持久化语义。它与章节采用后写入 SQLite `memory_documents` 的正式持久化记忆链是两套边界，不能互相替代或合并宣称。
- **小说作家 5 维评测体系（Novel Writer Benchmark Evaluation Phase 4）**：建立包含人物一致性、世界观、情节连贯性、伏笔留存与文风一致性的 5 大维度评测算法；支持无 Memory 的 Baseline 与启用 Novel Memory Layer 的 Enhanced 模式 A/B 对照实验。
- **章节版本演进与全链路创作溯源系统（Chapter Revision & Provenance System）**：提供 Git 式章节多版本管理；自动沉淀生成模型、提供商、路由原因、提示词快照与记忆版本；内置轻量 Diff 比对引擎与安全历史回滚。
- **提示词模板注册与多模型动态适配引擎（Prompt Template Registry）**：声明式管理分镜、Beat推进、专家评审、记忆演化抽取与质量诊断等 5 大官方基准模板；按目标模型家族（Qwen / DeepSeek / Claude / OpenAI-Compatible）动态注入专属指令前缀与格式约束。
- **创作反馈与微调数据闭环采集系统（Human Feedback & SFT/DPO Dataset Collector）**：在作家修改、审阅及采用时自动沉淀高质量数据对；支持标准 JSONL、ShareGPT 与 OpenAI Chat 导出 SFT 与 DPO 数据集。
- **Creative Agent Harness（非生产 / legacy 实验底座）**：保留 9 个实验领域工具、ReAct 五阶段循环（Observe -> Plan -> Act -> Evaluate -> Retry）、Decision Trace、Quality Review 与工具经验算法，用于测试和能力研究；它未接入当前生产 Workbench。生产章节路径仍由 `taskGoalRouting` 与 `workbenchChapterWriter` 确定性编排，Canonical 模型可见数量保持为 0，真实 Main Agent 尚未放行。
- **Phase 1A-D 共享 Canonical Manifest 与宿主门禁**：新增 `contracts/agent/canonical-tool-manifest.v1.json`，固定 `context.read / memory.search / novel.read / structure.read` 四个 portable contract；TypeScript、Rust 与 DSH/Node 独立验证同一 canonical SHA-256、identity、排序和 exposure，TypeScript 另做递归 schema/Catalog/binding 漂移门禁，Windows SQLite E2E 比对 TS/Rust attestation。Canonical 执行入口新增 exact version、projection hash、固定入口 exposure、单次 allowlist、权限、输入/输出 schema、timeout/cancellation 与 adapter 二次 scope 复验；公开入口固定按 Agent 可见集合失败关闭，四项仍为 `catalog_only + partial`，模型可见集合保持为空，未替换 legacy Workbench/DSH Tool 链。
- **桌面级分类设置中心（Desktop Settings Center Architecture）**：重构为「左侧分类导航 + 右侧精细配置」架构，支持常规、模型、网关、存储及诊断分类看板。

### 修复

- **正文快速保存状态投影稳定化**：正文保存通过全部 guard 后立即把 `saving` 原子发布到工作台状态栏与右侧保存控件，再进入本地持久化；避免快速浏览器把子编辑器的开始态与完成态合并为 `editing → saved`，不增加固定等待，也不改变草稿事务或失败保留语义。
- **桌面闭环 E2E 修订契约修复**：修订候选触发 `chapter_opening_rollback` 完整性修复后不再要求全文包含初版正文；继续验证初版与修订产物的 ID、哈希、章节范围、Run/Card 归属、授权、采用及重启后的持久化来源链。
- **浏览器大纲保存断言稳定化**：Browser E2E 在章节大纲保存反馈可见后继续等待 `data-save-state="saved"` 稳定终态，避免把正常的短暂 `saving` 过程误报为保存失败；生产保存行为与状态契约保持不变。
- **Windows 发布门禁固定 DSH 与 Gateway 构建顺序**：Windows 桌面 CI 与签名 Release workflow 先检出固定 DSH 提交、构建 host libraries 并导出 `DSH_CHECKOUT`，随后清理缓存中的 `novel-domain-gateway` 并从当前源码锁定重建，再运行串行 Rust 全测；本地发布矩阵、PR 模板和 docs-sync 失败关闭夹具同步同一顺序，避免旧 `target` 缓存或未准备载体被误报为 9 项产品回归。
- **DSH Rust 测试串行化**：固定发布 workflow 与本地 `verify_project` 使用 `-- --test-threads=1`，隔离共享 persistent carrier、Worker 和 session 状态；PR 验证模板与 docs-sync 同步拒绝并行参数或缺失串行参数，避免远端 Runner 将测试间状态污染误报为产品失败。
- **跨任务迟到结算隔离**：资产应用和章节采用完成后，只有发起时的作品与任务仍为当前作用域才刷新章节、选择章节或更新当前 Bundle；后台任务继续完成 recovery/settle，但不能让旧任务的迟到回调覆盖新任务的章节、标题或加载状态。手动产物卡、对话式资产决定和正文采用均补齐跨作品 deferred 回归。
- **冻结模型凭据与项目上下文收口**：非 API（尤其 Mock）模型快照在同步和异步路径都不再读取会话凭据或原生 vault；项目上下文只补充当前章节 `adoptedDraftId` 指针，继续排除草稿正文与历史版本。桌面 Registry hash 同步到当前 `82672d83...`，并把 readiness E2E 纳入 TypeScript/Rust 跨文件漂移门禁。
- **桌面闭环 E2E 夹具真实性修复**：闭环用例通过仅 E2E 构建可达、生产 Bundle 明确禁入的 SQLite 夹具补齐活动世界、规则、主角和章纲，并把章节目标与确定性 Mock 契约对齐；Mock 同步识别真实编译后的修订稿、完整性修复和换行章纲区块，不再把结构化资产误认作章节正文，也不放宽生产 DSH、字数或完整性门禁。
- **任务路由正则拒绝指数回溯**：移除章节大纲与规则候选路由中可被拆成相邻短前缀的冗余礼貌语分支，保持“请帮我”等自然指令及重复前缀语义不变，同时让恶意长前缀按线性复杂度处理；补充重复前缀的专用路由与拒绝回归。
- **当前插件 SSR 测试资源收敛**：当前插件 E2E 投影的 Vite SSR 夹具禁用依赖自动发现与文件监听，避免大型发布候选工作树在 Workbench 门禁中持续扫描并线性占用内存。
- **最终全量门禁夹具与异步断言收口**：同步 Rust 手写章节上下文测试 schema 的 Draft、Memory 与章节排序字段，项目备份清理断言按作品作用域排除 3 条内置全局风格，DSH 并发取消测试改用与只读意图一致的专用 `delayed-text` 上游模式，生产候选门禁保持不变；工作台跨任务压缩候选用例同时等待目标任务、迟到错误与候选卡重新投影，消除只等到 Composer 错误便提前断言 Bundle 内容的偶发竞态。
- **真实长测瞬时 Provider 错误重试**：工作台把明确的 `HTTP 408/429/5xx`、标准化中文 429/5xx 与 `overloaded_error` 归为服务暂时失败，提示在原冻结模型上重试；真实对话验收同步识别这些产品错误文本并在同一 Turn 内执行最多 2 次有界重试，不再因一次 502 误判为不可重试或建议换模。
- **稀疏指令跨章恢复竞态**：持久 Bundle 的异步资产恢复现在冻结并复验会话级 mutation revision，且每个会话在同一 Hook 生命周期内只执行一次有效持久化 hydration；当正常 readiness 检查已确认资产齐全并清理 recovery 时，旧检查结果或随后到达的新 Bundle 对象都不能重新写入 `resuming`。自动恢复正文在启动前还会读取最新任务事实，同一源 Turn 已有任意 Run 时按幂等完成清理恢复态并刷新投影，不再重复启动 Writer；显式失败重试仍沿用原 Turn 的独立路径。真实验收超时证据同步增加活动 Run 的身份、模型类别、Turn 来源、工具名与产物引用，仍不保存提示词、正文、路径或凭据。
- **极简创意资产预检同回合恢复**：空白项目资产卡明确区分“你的原始创作要求”和“系统自动准备”，不再让内部资产契约看起来像用户必须填写的详细提示词。自动世界/规则、主角与全书规划若在创建 Run 前精确失败为 `MODEL_TOOL_CALLING_NOT_VERIFIED`，显式重试会复验任务、Turn、来源、资产、完整目标与零 Run 后复用原自动准备 Turn；缺失或错配证据失败关闭，不追加重复消息。已创建 Run 若遇到明确的 Provider `HTTP_408/429/5xx`，通用“重试此回合”会复用同一自动 Turn 与完整冻结模型，并把资产状态从 `failed` 恢复为 `generating`，形成唯一结构化候选后进入 `awaiting_apply`。真实验收对 pre-Run 与 post-Run 两类恢复分别限制为最多 2 次，并留存不含正文或凭据的尝试证据。
- **真实长测驱动版本与崩溃证据收口**：真实对话 runner 默认使用仓库内经安装清单验证的 `tauri-driver 0.1.5`，保留显式环境变量覆盖但拒绝版本漂移，避免 Tauri 1 载体误用 PATH 中的 2.x driver。运行结束或失败时只把脱敏、有界的 Rust 阶段日志与 native panic 信封保存到 evidence/diagnostics；不复制 SQLite、WebView2、密钥、正文或完整本地路径。
- **真实长测跨工作台任务恢复**：章节 Run 允许在写作审阅页等其他界面继续后台执行；真实验收在权威 Run 完成后会显式返回原小说与原连续任务，再检查对话等待状态。仅明确可重试的失败会先恢复原任务再点击同回合重试，取消、非可重试失败和恢复错配仍直接失败关闭。
- **真实长测 WebDriver 失效快速终止**：章节生成与自动总结的长轮询现在会识别 `invalid session`、浏览器连接关闭、session 删除和 DevTools 断连等不可恢复错误，并在首次异常时立即终止；普通临时 Bridge 读取错误仍按原有有界策略重试，避免失效 session 被吞到章节级超时。
- **稀疏创意路由与活动世界选择**：不带“生成/写作”关键词的普通叙事 premise 可进入空项目资产准备，问答、查看和分析请求仍保持只读；世界设定统一按活动状态、更新时间和 ID 稳定选取最新正式项，资产范围展示与 Writer 使用同一选择规则。
- **长章节生成进度可见性**：`generate_chapter` / `polish_chapter` 运行时在原工具行内持续显示上下文整理、初稿生成、长度/完整性修复和最终校验阶段，并展示安全的修复次数与字数区间；进度事实不包含提示词、正文或凭据，终态仍由既有生成证据覆盖。
- **DSH 载体完整性校验补齐 jsonrpc-demo 依赖 junction**：解包完成条件除 `bin.js` 外还要求 `dsh-app-boot` 等运行入口存在，避免 Worker 因 `ERR_MODULE_NOT_FOUND` 在刷新模型目录时以 `DSH_WORKER_FRAME_CHANNEL_DISCONNECTED` 失败关闭。
- **旧任务模型快照缺少 baseUrl 时不再打挂 Runtime 目录**：插件探针匹配已有 Worker 时，不完整冻结快照改为跳过而不是失败关闭；前端用当前设置补齐缺失 `baseUrl`/`adapterProtocol`。任务模型锁只比较 provider/model/runtimeMode（及双方都有的 baseUrl），避免补字段后误报模型不一致。
- **旧任务模型快照缺少 adapterProtocol 时仍可刷新目录**：DSH 对缺失的 `runtime.adapterProtocol` / `adapterProvider` 按 `ans_task_session_v2` 补齐默认值，目录探针失败时回退到无快照探测，避免工作台把旧冻结快照误报为「Runtime 模型目录不可用」。
- **会话级 API Key 与新任务模型回退边界**：API Key 只写入当前应用进程内存，模型卡片、设置 JSON、SQLite、LocalStorage 与项目备份均不保存密钥；应用退出后必须重新填写。本地模型不在 Runtime 目录时，只允许在新任务创建并冻结身份前改用当前 API 模型，既有任务、重试、资产准备与自动总结不会静默换模。
- **DSH 结构化上下文与 Writer 生成方案对齐**：`novel.read_context` 按作品级 active/default 优先、全局默认回退解析唯一风格与输出方案，并以更新时间和 ID 稳定排序；严格排除其他作品方案，避免空白作品漏读全局配置或 DSH 与正文 Writer 使用不同生成约束。
- **桌面 Provider Tool Registry hash 漂移**：将 Rust `PRODUCTION_TOOL_REGISTRY_HASH` 与当前 TypeScript 生产 Tool Registry manifest（`82672d83…`）对齐，并增加 TS/Rust 漂移门禁；修复设置中心「测试连接」因 `AI_CONSTRAINT_POLICY_INVALID` 被误报为连接失败。
- **短提示长篇写作收敛与连续性门禁**：Writer 字数控制补齐 80% 硬下限，偏短候选会在不新增剧情事实、场景、角色、线索或尾部续写的前提下进行最多 3 次完整扩写，偏长候选继续执行有界压缩，最终仍越界则失败关闭。存在前章采用稿、ContextRecord、Memory、人物状态或地点资产时，生成快照追加仅供 Writer 使用的连续性账本，冻结 `storyNow / deadlineAt` 及地点、物件、伤势和系统状态；章节切换不再允许把“次日/明天”重新起算，内部规则不进入公开摘要或正文。
- **启动通知与运行中草稿体验**：启动恢复和旧上下文迁移通知改为去重串行队列，同时就绪时先显示恢复结果，后到通知不会抢占当前弹窗；工作台壳和 Composer 始终先挂载。任务运行期间输入框继续可编辑并按任务保存下一条草稿，停止按钮仍是唯一可执行动作，不会并发发送或改变冻结模型。
- **章节自动总结协议恢复**：保留 DSH 必需上下文读取必须早于候选工具一个 step 的严格门禁；章节采用后的自动总结若精确命中 `DSH_REQUIRED_CONTEXT_READ_MISSING`，会在同一自动回合与冻结模型下最多追加 2 个不可变 Run，重新完成全部读取后再生成候选。重试预算由同回合失败事实持久计算，且在继续前拒绝已有有效总结 Artifact/卡片或同采用稿正式总结，避免重复候选与重复应用。
- **章节自动总结启动调度修复**：对话内采用章节正文后立即刷新章节投影，使新的 `adoptedDraftId` 能触发自动总结编排；自动总结回合从 `ensure_turn` 持久化为 `ready_to_start` 后会在互斥操作释放时可靠重调度。Renderer 外 Runtime 占用释放另有同回合单次 1.5 秒保底重查，避免章节已采用且总结 Turn 已落库，却因旧章节状态或瞬时 guard 后没有新 React 事件而长期停在零 Run。真实验收只允许对同一零 Run 总结 Turn 执行一次显式恢复，并以 `real_conversation_acceptance_evidence_v5` 留存冻结模型、恢复前状态和首个持久 Run 的脱敏证据。
- **长篇上下文正式写章闭环**：修复只有手动 `ContextRecord` 时未进入 Writer Prompt 的条件遗漏；正式写章快照现按章节顺序读取本章关联人物与主角在当前章之前的最新动态状态，并以独立 `character_state` 分区和脱敏来源回执冻结。全书规划或人物候选应用后会按章纲、章节目标和主角语义证据保守建立章级角色关系；能够确认主角出场时写入 `main / mustAppear=true`，没有出场证据时不再凭空创建 `hidden / mustAppear=false` 关系，读取旧错误投影时也会按现有证据修正，既有人工关系不被覆盖。章节正文原子采用后不静默写入 AI 总结，而是在原任务中持久化“总结本章”待办；总结仍须生成候选并由用户确认应用后才成为正式上下文。
- **工作台自动回合与上下文证据闭环**：自动补齐世界设定、主角和章纲的内部 Turn 继续兼容既有 `user` Run 绑定，但通过版本化内容信封明确投影为“工作台自动准备”，信封同时向桌面权威执行说明它不是用户的新消息，界面与前端重试均只呈现解码后的纯目标。缺失资产卡完整展示有序清单，仅开放当前项并在执行 handler 二次拒绝越序触发；Writer 显示后端显式的“已使用/缺失/已降级”来源，DSH 优先显示后端显式回执，兼容路径仅依据同 Run 成功只读事件显示“已读取”，缺少证据时明确标注未提供而不伪造使用。当前插件面板同步区分加载、失败与真实空目录，并补齐 `get_character_states` 的人物状态语义标签。
- **工作台上下文回执语义与可读性**：成功的 Memory 检索仅在明确召回条目时显示“已读取”，0 条结果改为“本轮无来源”并展示召回数量；工具行收敛为世界、规则、主角、大纲和 Memory 五类紧凑摘要，完整脱敏回执移至展开详情顶部，并提高回执说明、分组与状态字号。
- **短指令正文任务的核心资产准备闭环**：工作台在正文 Run 创建前使用与正式 Writer 一致的规则只读检查世界设定、主角设定和章节大纲；缺失时保留原正文目标并在对话内显示逐项状态，可通过自然语言任务生成既有结构化候选或跳转人工编辑。候选仍须在产物卡片显式确认并经既有原子应用写入，应用后重新检查即可恢复原回合，且未提交目标在本次应用会话内跨页面保留；不新增数据库写入口，也不绕过审阅或应用门禁。
- **极简输入资产恢复与证据收口**：空白项目收到普通整书目标后，会按世界与规则、主角、全书规划的固定顺序生成候选并等待显式应用；世界与规则成套候选不会再重复排入独立规则步骤，仅在已有世界但正式规则确实缺失时单独补规则。规划应用后原子创建卷章并恢复原始目标，后续只需“继续写”即可沿采用稿与自动总结推进。真实验收新增对刚落库世界、规则和主角正文的冻结快照反查，并要求清洗后的证据继续保留安全的 Prompt SHA-256、世界/规则等 Provider 来源状态，避免只凭详细测试提示词或 UI 标签判定接入。
- **稀疏创意真实验收通用化**：真实对话验收默认改为 `sparse-idea`，主用户输入只描述约 6 万字的普通故事创意，不再指定 15 章或粘贴世界、人物和章纲。Full 先从已校验并正式应用的 `story_plan` 产物推导卷章顺序、章节数和目标字数，再向同一任务逐章发送“继续写”；Gate 现执行规划前 4 章，覆盖至少三次跨章承接。`prepared-assets` 保留为显式独立场景，固定 4/15 章夹具不再冒充主验收产品行为。
- **全局内置风格桌面事实源修复**：新建 SQLite 数据库幂等写入 3 个固定身份的 `system_default` 风格，并仅激活“默认小说风格”；全局风格统一以 `novel_id = NULL` 保存、读取、激活和删除，按作品读取时同时返回全局与作品风格且优先作品当前项。前端不再把 Tauri 空结果静默替换为 LocalStorage 随机 ID，冻结快照中的默认风格现在可由 SQLite 与真实验收 bridge 反查为同一记录。
- **稀疏整书规划字数契约**：从首个非自动用户回合解析并冻结整书目标、容差与来源 hash；Story Plan 回合要求根目标和逐章目标经末章校正一致，Gateway 在 Artifact 形成前复验根值与章节合计，Safe Apply 再按原始回合/hash 原子复验且不放宽冲突门禁。真实验收失败证据仅追加 root、章节合计、冻结上下界和来源身份等安全标量，不保存候选正文或凭据。
- **对话工作台领域上下文接入**：桌面 DSH 结构化任务的只读链路补齐活动世界设定、规则体系、总纲/卷纲/章纲、章节字段、角色状态与章节角色，并通过 `search_memory` 保留按需 Memory 检索；`chapter.read_outline` 现可返回带 SHA-256、原始字符数和 12 万字符暴露上限的当前已采用正文，分片缺失、顺序/长度/哈希异常均失败关闭。质量检查与章节总结在没有有效已采用正文时拒绝候选；Runtime allowlist、公开工具身份、健康检查与 Mock 上游同步加入 `get_character_states`。候选 Artifact 的 ContextSnapshot 仅冻结实际成功读取工具的事件 ID、参数哈希、结果引用、内容哈希与长度，不复制正文、提示词或凭据。
- **会话级模型凭据固定绑定与防泄漏**：API Key 改为仅在当前应用进程内按 `scope + providerId + baseUrl + modelId` 精确注册；默认 DeepSeek 快照统一冻结为 Runtime 使用的 `deepseek-official` 身份。设置切换不再把已加载 Key 带到另一模型，旧任务与冻结 Run 只解析同一身份凭据，错配时失败关闭。保存既有 API、本地或网关模型卡时保留自定义显示名；旧任务快照缺少 `baseUrl` 时允许同 Provider/模型的运行时补全，已经冻结端点的新快照仍严格拒绝不同端点。TypeScript、Rust、Novel Gateway 与项目备份导入/导出边界递归拒绝 `apiKey`、`x-api-key`、`openaiApiKey`、`credentials` 等凭据形态，短 Key 也始终脱敏；Key 不进入 SQLite、LocalStorage、项目备份、Git 或应用自有同步，真实鉴权仅发往精确绑定的 Provider Endpoint。
- **真实模型工作台链路修复**：冻结的 `provider / model / baseUrl` 现在贯穿 Workbench、DSH 模型目录、Worker 与 governed proxy，`openai_compatible` 不再因缺失其他预设模型中断。Runtime 目录查询改为非阻塞、单航复用并与请求读取隔离；代理补齐 SSE 结束、reasoning/累计正文 JSON 回退和 Windows 路径兼容。显式写章指令不再被提示词中间的“改写”误分类，长文本与连续新建任务的受控表单写入也已稳定收口。
- **章节采用字数账本修复**：草稿采用与章节软删除现在于同一 SQLite 事务内重算非删除章节字数并更新 `novels.total_word_count`；同章重新采用、授权回滚与幂等重放不再重复累加或留下过期小说总字数。
- **启动等待与创作工作台体验优化**：React 壳层不再串行等待会话恢复、旧上下文迁移和生成任务恢复，也移除固定 700ms 启动画面；三项恢复转为后台并行，并分别约束会话读取、上下文依赖与生成入口。根路由同步收敛为 56px 导航轨、稳定任务树、同轴对话流与 Composer，补齐内联工具详情、原子任务切换、加载骨架、2K 阅读宽度和 `prefers-reduced-motion` 降级。上下文整理和模型目录刷新现在只是局部准备状态：Composer 和新建弹窗保持可编辑/可关闭，仅禁用真正依赖未就绪资源的提交动作。
- **审阅工作台命令门禁与插件状态本地化**：对话确认后的默认只读审阅现在同时禁用排版、保存和采用命令；显式进入编辑后按未保存修改、保存中、采用中、草稿及已采用状态启用对应动作，控制器同步拒绝锁定命令和相同已采用正文的重复保存/采用。当前插件继续保留原始诊断状态属性，界面状态改为中文显示。
- **创作与写作工作台视觉精修**：全局导航、任务操作、写作工具与章节审阅改用统一的 Lucide 线性图标；任务树补充任务数、最近活动、可键盘操作的 Portal 菜单，新建任务对话框补齐焦点闭环和背景隔离。写作工作台保留 240px 卷章目录、48px 审阅工具轨和 920px 正文纸张，载入时使用与最终布局同尺寸的局部骨架，不再以全屏遮罩阻断进入；1024、1440 与 2K 档保持稳定阅读宽度和无横向溢出。
- **消息流最新进展停靠**：用户离开消息底部时，“查看最新进展”改为消息区独立底部停靠行，动态占用布局高度，不再以绝对定位覆盖工具详情、上下文回执或产物卡片；自动跟随和减少动态效果偏好保持不变。
- **工作台任务连续性与运行证据门禁**：恢复最近有效任务，补齐搜索、重命名、归档/恢复和带目标/章节范围/初始模型的新任务流程；新任务与首个用户回合在同一 SQLite 事务中创建，失败不留下空任务。Composer 与新建入口只接受当前 Runtime 目录中精确匹配且已加载的模型，发送前再次刷新重验，失败保留草稿且不追加回合或启动 Run；模型目录不可用时提供原位重试与模型设置入口，本地确定性问候/能力回复仍可发送，并以 `ans-local` 快照记录真实来源，新建入口中的同类本地目标也不再被模型目录阻断。带章节的新任务会先原子同步当前作品与章节选择，再创建首轮 Run；跨作品章节引用失败关闭且不残留任务。目录门禁本身不冒充网络或 tool-calling attestation。失败重试绑定原失败回合目标；产物卡显示持久化来源、生成基线和校验问题，未通过契约校验的响应不会形成可确认/可应用卡片。
- **工作台任务状态与同回合重试闭环**：候选卡片与 `waiting_user` 在同一 SQLite 事务内写入，Run 完成、失败、取消或重启恢复不再覆盖未决候选；拒绝/要求修改、章节确认、真实采用和应用冲突按持久事实归约。重试直接在原 user Turn 下创建新 Run，不追加重复用户消息，并逐次保留模型快照、工具事件、错误和产物；同任务的草稿、Composer 错误、压缩候选与忙碌状态按 `conversationId` 隔离，后台迟到结果不会污染当前任务。浏览器 LocalStorage fallback 同步持久化 append-only 决定与审阅授权，但仍不伪造 ResultArtifact 或结构化领域写入。
- **DSH 模型工具调用真实性门禁**：桌面 DSH 模型任务在创建 Run 前，经同一 governed proxy 对精确 `provider/model` 执行一次无副作用原生 tool-call nonce 探针；Rust 仅接受协议、身份、时效、finish 与唯一调用均严格匹配的正证据。失败零 Run 且不缓存；成功证据精简冻结进 `model_snapshot_json`，不含 nonce、usage、原始错误或凭据，同 Worker 最多缓存 10 分钟并在 Worker 重启后复探。`attesting` 可取消并终止专属 Worker，请求治理 active lease 会结算为 0；仅保留 governed proxy 必需的 `ai_request_reservations` 预留/结算审计，不写 TaskRun/Turn/Tool/Artifact/Session 领域事实。
- **对话式工作台界面收敛**：移除独立 Trace 页签与画布，工具调用、错误和候选产物统一在任务对话中内联展示；写作工作台继续聚焦章节审阅、显式编辑、保存与采用，同时保留可达的草稿历史、章节准备与总结能力。
- **结构化产物应用失败关闭**：在领域写入与 `ArtifactDecision` 尚未纳入同一 Rust/SQLite 事务前，桌面端与浏览器端的 `request_apply` 均以稳定冲突拒绝，且不产生任何领域写入；章节正文继续使用既有审阅授权与原子采用链路，修改和拒绝决定不受影响。
- **前端组件体积门禁恢复**：按既有页面、视图和业务边界拆分模板页、工作台消息流、写作工作台及右侧面板；收尾阶段把 `WorkbenchPage` / `WorkbenchMessageStream` 再拆为状态、任务头、进度条和压缩卡片，生产 TSX 重新回到 500 行上限内，不改变原有交互契约。
- **Schema 原型键严格校验**：Tool Registry 与 Canonical Runtime 的 JSON Schema 校验改为只接受 schema 自有属性，拒绝 `constructor`、`toString`、`__proto__` 等原型链命中及继承的必填字段，避免 `additionalProperties:false` 被绕过。
- **浏览器测试与暗色设置页修复**：Browser E2E 的 Vite 服务关闭依赖自动发现并显式预打包 React 启动入口，消除首屏导航及 WebDriver session 回收超时；同步当前首页路由与设置页语义面，修复设置页使用不存在的背景 token 导致暗色主题出现白底浅字。
- **覆盖率测试进程回收**：`EditorArea` 的 Vite SSR 测试关闭依赖自动发现与文件监听，避免 Windows 覆盖率运行完成断言后仍持有 esbuild 子进程。
- **Mock 上游随机端口稳定性**：Workbench 测试上游不再直接接受可能被 WHATWG Fetch 禁止的系统随机端口；`port: 0` 命中禁止端口时有限重试，显式配置禁止端口则在启动前失败关闭，消除 Windows 动态端口范围与 Node `fetch` 禁止表交叉导致的偶发 `bad port` 发布门禁失败。
- **工作台异步隔离测试收口**：延迟完成的发送与上下文压缩回调统一在 React `act(...)` 边界内结算，清除跨任务草稿、错误和忙碌状态测试中的异步刷新警告，不改变生产工作台行为。
- **DSH 权威任务作用域、取消与进程隔离**：DSH 启动路径在创建 Run 或 Worker 前，通过 SQLite 将 `conversationId`、用户 `turnId`、`novelId` 与可选 `chapterId` 绑定到权威任务事实，并以该 user turn 的持久正文覆盖调用方传入的 `goal`；跨对话、跨作品、跨章节或非用户回合均失败关闭。宿主把已验证的小说/章节 scope 注入只读 Novel Gateway，Gateway 在每次工具调用时重新读取并复验参数 scope；缺失、错配、越权或非 Unicode `ANS_ALLOWED_TOOLS` 均失败关闭，且错误不回显敏感 ID。同步修复 Worker/Provider 建立阶段的早期取消竞态，取消不再假等待 480 秒 session timeout；本地模型代理也纳入 Windows `KILL_ON_JOB_CLOSE` Job Object，创建隔离失败即终止进程并失败关闭。
- **DSH carrier 新鲜度失败关闭**：打包准备阶段始终从当前源码编译 Novel Gateway，并对新建或复用的 carrier ZIP 同时校验固定 `VERSION_MATRIX` commit 与内嵌 Gateway 精确 SHA-256；旧 Gateway、commit 漂移或缺失 Gateway 的缓存均拒绝复用，避免安装包静默携带过期运行载体。
- **生产 E2E bridge 构建隔离**：普通生产构建通过 Vite 别名把 E2E bridge 替换为空模块，仅显式 E2E 构建装载真实 bridge；bundle 门禁扫描 `runDomainFacadeSqliteSmoke` 与 `e2eDomainFacadeProbe` 标记，防止测试入口和诊断依赖进入正式前端。
- **第一阶段生产链路二次纠偏与 Mock 伪造彻底移除**：彻底移除 `workbenchChapterWriter` 中发生异常时吞咽错误伪造 `mock-task-` / `mock-art-` 候选卡片的绕行逻辑，执行失败一律 Fail-Closed 向上抛出；修复模型快照穿透，严格从 `TaskRun.modelSnapshot` 派生执行参数，杜绝全局设置修改影响任务运行。
- **两阶段审阅采用协议与无草稿候选载入**：路由携带 `authorizationId` 与 `artifactId` 进入审阅工作台时，若当前章节尚无草稿，自动从权威 `ResultArtifact` 载入候选正文；首次保存创建真实草稿，确认采用在同一 SQLite 事务内完成授权/决定/作用域/版本/正文哈希校验、草稿采用、章节指针更新、授权消费与会话完成，失败全部回滚且重放幂等。
- **章节总结应用链路采用真实已采纳草稿**：`chapter_summary` 应用不再接受占位 `workbench-unadopted`，改为回查当前章节已采用草稿并在错配时拒绝写入，确保 summary/context bundle 与正式草稿同源。
- **审计阻断入口修复**：桌面作品删除新增事务级 `delete_novel_cascade`，复用项目备份清理顺序真实清除 SQLite 所有权威关联记录；设置中的数据修复按钮接入 SQLite 基础字段规范化与 `integrity_check/foreign_key_check`；资产中心导入资产数量改为读取真实服务数据，不再硬编码 `0`。
- **大纲版本指针修复**：`set_active_master/volume/chapter_outline` 改为目标存在校验、事务更新，并按卷/章作用域清理旧 active 指针；候选大纲采用后显式激活，修正写入成功但后续读取不到的问题。
- **真实 DSH 测试入口收口**：新增显式 `test:dsh:real` smoke profile；真实凭据仅在当前进程环境中传递，支持通过回环限定的 `DSH_E2E_BASE_URL/DSH_E2E_MODEL` 让本地 OpenAI-compatible 模型复用同一 DSH 协议，不改变默认 Mock E2E 或生产路由。显式参数优先于环境变量，回环 profile 默认使用无凭据哨兵；代理补充 `/v1` 路径与只读 `/v1/models` 投影，避免本地模型身份预检误报；Windows PowerShell 5 的 cargo stderr 证据捕获也已去除 `NativeCommandError` 噪声。最新真实 smoke 通过（本次 3 次上游请求；模型修复回合通常为 3–4 次）。
- **审阅编辑防覆盖与 E2E 证据收敛**：审阅来源使用稳定键只装载一次，避免父组件重复渲染覆盖未保存正文；E2E IPC 保持显式 allowlist，本次仅增加闭环只读查询而不暴露原子采用命令，证据只保存计数、ID、正文哈希和授权指纹，并从持久化卡片关系读取运行 ID。
- **生产链路收敛与并行 Harness 清理**：彻底移除未接入生产的 `src/services/agent-harness/` 与非权威文档 `docs/agent/`，收敛为唯一生产链路（`Workbench -> useWorkbenchTaskRunner -> taskConversationService -> taskSessionAdapter -> DSH Task Worker / Production Tool Registry -> ResultArtifact -> ArtifactDecision -> ReviewAuthorization -> Writing Workspace -> Safe Apply / SQLite`）。
- **工具失败严格阻断**：修复工具抛错时被错误吞咽包装为成功的缺陷，工具失败时严格标记 `ToolCallEvent` 为 `failed` 并阻断后续工具链执行，防止 SQLite 脏写入。
- **长程记忆穿透与上一版候选正文继承**：`search_memory` 事实检索切片可靠注入写章服务提示词；多轮重写与润色自动从会话历史提取上一版候选正文并注入修改提示词。
- **已采用前章连续性基线**：工作台写章现在按卷序与卷内章序读取紧邻前章的权威采用稿，将来源章节、草稿和正文 SHA-256 冻结进持久化 generation context snapshot；长正文分区同时保留开头与结尾，避免截断最终时间、人物、物件和系统状态。工具事件只投影上下文哈希与来源章节，真实验收必须从生产事件反查连续性，不能由测试侧自行回填。
- **写章上下文脱敏回执**：工作台写章工具事件现在从真实 generation context snapshot 投影本轮资产来源，并按“已使用 / 缺失 / 已降级”显示世界设定、大纲、角色、记忆、风格等类别；回执不展示完整提示词、正文、来源 ID、内部摘要或上下文哈希，短指令测试无需再人工复述项目资产。
- **连续性与运行证据失败关闭**：写章服务区分真正首章、前章未采用和采用稿正文不可读取，后两者在编译 Prompt 与调用模型前阻断；工具事件保留原 `ToolResult` 顶层契约并仅追加 generation context 哈希。公开 Tauri 对话命令与浏览器写入口拒绝客户端伪造 `toolCallingAttestation`，DSH 经严格 nonce 探针后的 Rust 内部注入路径保持不变；Web Crypto 不可用时耐久哈希明确失败，不再用 FNV 短值冒充 SHA-256。同步修正真实验收分析脚本把文件末尾换行排除在 `novelSha256` 之外的口径错误，现有正文文件未改写。
- **产物校验语义纠偏**：对话产物卡把笼统的“校验通过”收窄为“结构与来源校验通过”，警告、失败和禁用原因使用同一口径，避免把 ResultArtifact 结构、来源与哈希有效误解为小说连续性或内容质量合格。
- 修复创作工作台只读与检索查询误入 `generate_chapter` 校验槽导致无章节绑定时秒崩的缺陷。
- 修复左侧子页面 Back 按钮跳回旧首页文案错位的问题，统一规范为「返回工作台」。
- 修复风格方案与输出控制未深度注入写章编译层的断层，确保选定文风与篇幅设定在工作台生成正文中真实生效。
- 全面对齐 `user-guide.md`、`quick-start.md` 与应用内首次引导（`FirstTimeGuide`）至工作台创作心智。

### 验证

- **全应用图标语言最终验证**：`npm run test:ui-icons` 为 9/9，通过 552 个生产源文件与 16 个样式表扫描；真实 Edge Browser E2E 为 5/5 specs、32/32 cases，新增图标契约逐页覆盖工作台、小说、资产、风格、模板、AI 任务、导入导出、设置、占位页、404、新建任务弹窗和章节总结面板。`npm run lint:ci` 零警告，`npm run build`、`npm run test:all` 全部通过；本项未运行 `tauri:build`、MSI、NSIS 或其他安装包构建。
- **真实 3 万字与最终无安装包全量验收**：稀疏用户输入仅为“写个六万字左右的悬疑故事。”及后续“继续写”，同一任务连续完成并闭环前 10 章，采用稿合计 30,833 字；每章候选/采用正文哈希一致，世界、规则、主角、三级大纲、风格、输出控制、前章采用稿、Context 与 Memory 均有真实 Provider 来源证据。原 Full evidence 继续诚实保留 `failed`，第 11 章因自动总结未闭环被严格排除，独立 checkpoint 正文与分析不冒充 6 万字全书完成。最终 `npm run test:all` 为 1,151/1,151 通过；真实 Edge Browser E2E 为 4/4 specs、22/22 cases；`lint:ci`、171 个生产 TSX 图标/组件体积门禁、TypeScript/Vite 构建和 117 个 JavaScript chunk 包体门禁通过。Rust 全量为 458 passed、0 failed、2 ignored，`cargo check --locked` 与 `cargo fmt --all -- --check` 通过。本项未运行 `tauri:build`、MSI、NSIS 或其他安装包构建。
- **稀疏指令重复 Writer 恢复专项验证**：WorkbenchPage 64/64、资产恢复与任务运行相邻测试 32/32 通过，覆盖清理后旧 Bundle 新对象重渲染、同源 Turn 已有 Run 时零新增启动、合法显式同 Turn 重试与自动总结恢复；目标 ESLint、TypeScript 与 Prettier 通过。未运行 Tauri、MSI 或 NSIS 打包。
- **极简创意资产预检恢复专项验证**：资产恢复服务 13/13、WorkbenchPage 59/59、真实对话 profile/runner/support/安全清洗/失效快速终止 44/44 与 real-acceptance TypeScript 检查通过；覆盖同一自动 Turn 复用、零 Run、缺 ID、会话/来源/目标/既有 Run 错配失败关闭和证据账本负例。未运行 Tauri、MSI 或 NSIS 打包。
- **真实长测驱动与故障证据专项验证**：real-conversation profile、驱动解析、诊断白名单、安全清洗与 WebDriver fail-fast 共 39/39 项通过；真实工作区静态解析确认仓库内 `tauri-driver 0.1.5` 被选中，PATH 中的 `2.0.6` 被版本门禁拒绝。目标 ESLint、TypeScript、Prettier 与差异空白检查通过；未运行真实长测、Tauri、MSI 或 NSIS 打包。
- **真实长测跨工作台恢复专项验证**：连续任务界面保持、从其他界面恢复以及恢复错配失败关闭共 3/3 项通过；合并 real-conversation profile、runner support、凭据清洗及 fail-fast 后为 42/42，TypeScript、目标 ESLint、Prettier 与差异空白检查通过。未运行真实长测、Tauri 或 MSI/NSIS 打包。
- **真实长测失效快速终止专项验证**：real-conversation profile、安全清洗与 fail-fast 共 36/36 项通过，WebDriver session 与 browser connection 两类终止场景均只执行 1 次条件检查；runner driver-liveness 4/4、TypeScript、目标 ESLint、Prettier 与差异空白检查通过。未运行真实长测、Tauri 或 MSI/NSIS 打包。
- **工作台上下文回执专项验证**：回执模型、消息流、任务运行适配与章节资产准备共 78/78 项定向测试通过；目标文件 ESLint、Vite 生产构建、文档同步、Prettier 与差异空白检查通过。全仓 `lint:ci` 和 `npm run build` 分别被本次范围外的启动弹窗既有 warning/type error 阻断；未修改这些无关文件，也未运行 Tauri、MSI 或 NSIS 打包。
- **工作台 UI 闭环定向验证**：Workbench 页面 30/30、任务运行与内联组件 41/41、自动回合信封 2/2 通过，覆盖稀疏创意触发的完整资产队列、越序门禁、自动来源身份、Writer/DSH 上下文回执及插件三态；TypeScript、目标 ESLint、Prettier 与差异空白检查通过。本项未运行 MSI/NSIS 或其他安装包构建。
- **会话级模型凭据专项定向验证**：会话注册表、设置页切换、冻结写章、DSH 解析、模型目录身份、对话持久化与工作台旧任务切换共 75/75 项通过；Rust 应用、Novel Gateway 与项目备份安全门禁 8/8 项通过，`lint:ci`、TypeScript/Vite 生产构建、`cargo check --locked`、文档同步与格式检查通过。本项未运行全量发布矩阵或 MSI/NSIS 打包。
- **真实 UI 对话 6 万字验收纠偏**：回环 OpenAI-compatible Endpoint 固定使用 `gpt-5.6-luna`，真实 UI 完成 15/15 章的生成、确认入审、保存与采用；采用稿独立计数、章节表合计与小说缓存总字数均为 61,396，总耗时 1,181,369ms，工程闭环通过。复核确认原运行实际为 15 个独立任务，并非单任务连续 15 回合；当前主验收已改为 1 个稀疏创意任务，先从正式 `story_plan` 产物推导章节数，再按该数量逐章追加 user turn，并逐项核对 turn/run/artifact/决定/授权和上一章采用哈希连续。新的稀疏 Gate 已以“写个六万字左右的悬疑故事。”加三次“继续写”在同一任务内完成前 4 章：空项目自动准备并应用世界与规则、主角和 16 章/60,000 字全书规划，4 章采用稿合计 15,470 字，世界、规则、主角、三级大纲、风格、输出控制及后续章连续性来源均有 Provider 注入证据；完整规划的 Full 仍未通过。原 61,396 字采用稿人工审读不通过：第 12～14 章存在倒计时回跳、沈砚告别与归还重复、全城归还和分批释放两套互斥高潮，且陆惟川问责未闭环。因此本项结论为“旧独立任务工程闭环通过、稀疏单任务四章 Gate 通过、完整 Full 与内容质量未通过”，不得记为最终验收通过；详见 `docs/audit-v2/real_conversation_ui_acceptance.md`。证据摘要不含 API Key；当前修复阶段未再次执行 MSI/NSIS 打包。
- **修复后的最终无安装包全量门禁**：`npm test` 共 518 项通过；`npm run test:workbench` 为 Node 27/27 + TypeScript 111/111；覆盖率总体 statements/lines 52.66%、branches 71.48%、functions 60.39%，核心专项 87.67%，关键组件覆盖率 90.96%。148 个生产 TSX 文件和 114 个 JavaScript chunk 通过体积门禁，入口 gzip-9 21.48 KiB、最大 chunk gzip-9 44.49 KiB；真实 Edge Browser E2E 为 4/4 specs、21/21 cases。Rust workspace 共 382 passed、0 failed、2 ignored，`cargo fmt --check` 与 `cargo check --workspace --all-targets` 通过；最终 Windows Tauri + WebView2 + SQLite 为 18/18 specs、21/21 cases。ESLint、TypeScript/Vite 生产构建、版本/文档同步、真实验收安全 profile 11/11、AI 任务删除 3/3 与项目备份 17/17 均通过。桌面测试载体显式使用 `--bundles none --ci`；本次修复后的最终验证未运行 `verify_project.ps1`、`tauri:build`，也未再次运行 MSI/NSIS 打包。
- **启动与工作台阶段性定向验证**：启动协调器、生成恢复门禁、自主调度入口和 Workbench 组件共 32/32 项测试通过；TypeScript 类型检查通过；真实 Edge 浏览器在 1024x700、1440x900、2560x1440 三档窗口及非工作台路由共 4/4 项布局检查通过；前端构建与包体门禁通过，主入口为 61.62 KiB raw / 21.31 KiB gzip-9。本项不包含最终全量发布矩阵或 MSI/NSIS 打包。
- **UI 精修最终前端验收**：Workbench 24/24、RightToolbar/WritingWorkspaceView/WorkspaceAuxiliaryPanels/EditorArea 17/17 项组件测试通过；真实 Edge Browser E2E 共 4/4 specs、21/21 cases，覆盖 1024x700、1440x900、2560x1440、右侧审阅面板、新建任务初始焦点与任务菜单键盘操作。`lint:ci`、TypeScript/Vite 生产构建、组件体积、Bundle 体积、文档同步、Prettier 与差异空白检查通过；本项未运行 Tauri、MSI 或 NSIS 打包。
- **真实桌面冷启动预算**：`cold-start.spec.ts` 在全新隔离 SQLite 和 WebView2 profile 下 1/1 通过；窗口 617ms 可见、数据库 219ms 就绪、Tauri setup 1258ms，从进程创建到 React 壳层/工作台/内容就绪分别约为 1839/1927/1946ms；HTML 到 React 壳层 182ms、壳层到工作台 89ms、工作台到内容 19ms，全部低于 2500/1500/4000ms 分段预算和 8000ms 总预算。SQLite `integrity_check=ok`，console/未处理异常/外网请求均为 0；Tauri 构建显式使用 `--bundles none`，未生成 MSI/NSIS。
- **工作台连续性第二阶段定向验证**：选择恢复、模型目录门禁、任务运行投影和 Workbench 页面共 50/50 项通过，TypeScript 与目标 ESLint 通过；真实 Edge 在 1024x700、1440x900、2560x1440 下验证任务树/消息流/Composer，并在最小桌面视口验证新建任务弹窗和标准路由壳层，共 5/5 项通过。真实 Windows Tauri/WebView2 隔离 SQLite 验证无 Runtime 模型时保留目标、禁用创建、重启后仍不产生空任务及插件只读投影，共 1/1 项通过；Rust 产物候选门禁定向测试 1/1 通过。桌面规格使用 `--bundles none`，本项未运行最终全量发布矩阵或 MSI/NSIS 打包。
- **模型目录恢复专项定向验证**：Workbench 页面与模型可用性 21/21 项通过，覆盖目录不可用时保留未发送目标、原位刷新、进入模型设置、继续编辑，以及问候/能力询问使用本地确定性回复并显示真实可用性；TypeScript 与目标 ESLint 通过。真实 Edge 工作台布局 6/6 项通过，覆盖 1024x700、1440x900、2560x1440、新建弹窗、恢复提示与非工作台路由，无溢出或布局跳动。本项未运行全量发布矩阵或 MSI/NSIS 打包。
- **DSH 模型探针专项定向验证**：Bridge 6/6、model proxy 6/6、Rust attestation 生命周期 4/4、TypeScript 快照 1/1 与当前插件投影 6/6 通过；Worker 重启、10 分钟成功缓存、失败不缓存、冻结证据和取消零 Run 连续 5/5 通过。未运行外部真实模型验收、全量发布矩阵或 MSI/NSIS 打包。
- **工作台状态一致性专项定向验证**：Rust conversation repository 11/11、Workbench 服务链 95/95、Workbench 页面与模型投影 31/31 通过，覆盖未决候选优先级、多候选决定、章节授权采用、同回合重试、双击防重、跨任务临时状态隔离、本地目标离线创建与首轮章节同步；`lint:ci`、TypeScript、生产前端构建通过。真实 Edge 在 1024x700、1440x900、2560x1440 及新建弹窗、模型恢复、标准路由共 6/6 通过，验证两次 Run、失败证据和待处理候选无横向溢出或控件重叠。本项未运行最终全量发布矩阵或 MSI/NSIS 打包。
- **第二次全量能力审计**：新增 `docs/audit-v2/` 六份权威审计，按真实入口、调用链、SQLite/模型反查重建 75 个能力族地图；结论为 21 WORKING、37 PARTIAL、3 BROKEN、11 LEGACY、3 UNKNOWN，并确认当前阶段不得直接扩展 Context Agent。审计同时识别桌面“级联删除”只软删除主记录、“扫描并修复数据库”只操作 LocalStorage、资产导入计数硬编码等真实性缺口。
- **第二次能力整合与 Agent 重构准备**：新增 `docs/architecture-audit-v2/` 七份整合文档，明确 14 个宏观重复组、16 个具体冲突簇（13 个可归并、3 个边界治理）、12 个 canonical Domain Capability 和 18 个目标 Agent 动作；补充草稿多事实源、outline active/version、summary/context bundle、角色事实、AI task ledger 与 Registry 漂移风险。本轮仅冻结事实与迁移计划，不删除旧实现、不扩展 Agent。
- **第一阶段生产闭环验收结论**：`CONDITIONAL`（阶段二准入：`NO`；真实外部模型在线决策：`NOT RUN`）。
- **真实模型补充验证**：固定 DSH payload 通过真实 `deepseek-v4-flash` Provider smoke（3 次请求、工具调用、Proposal schema 校验通过）；该证据仅覆盖 DSH preparation，Workbench `chapter_write`/独立 Writing SubAgent 仍保持未验证。
- **阶段判断重分类**：将当前成果标记为 `Phase 0.5 — Model / Provider Infrastructure Verified`；新增 [Phase 1A 真实 Agent Runtime 接入验证任务书](docs/audit-v2/phase1a_real_agent_taskbook.md)，明确真实 Main Agent、Tool Call 事件、candidate-only Artifact 和负向边界的独立准入条件，不提前宣称 Harness 或 Writing SubAgent 完成。
- **阶段顺序再次纠偏为能力资产化优先**：确认 DSH 真实模型层只是基础设施，现有业务能力尚未形成可靠 Capability Registry；新增只读 `Capability Catalog v1` 与 [Phase 1A-A 能力资产化任务书](docs/audit-v2/phase1a_capability_assetization_taskbook.md)，18 个 canonical action 全部保持 `catalog_only`，Main Agent Runtime、Tool Projection、Writing SubAgent 和 Context Agent 均后置。
- **能力资产目录（catalog-only）**：新增 `src/services/capabilities/capabilityCatalog.ts` 及定向测试，登记领域入口、调用链、事实源、健康状态、旧别名、副作用和迁移阻断；不复用或替换现有 TS/Rust/DSH Tool Registry，不新增数据库结构或生产工具。
- **Phase 1A-B Domain Facade**：新增 `src/services/capabilities/domain/` 五个领域 Facade、统一 `DomainRequest/DomainResult`、公开 DTO/source/hash 契约及真实浏览器生产链验证；Facade 仍保持 `catalog_only`，未接入 Canonical Tool Projection、Main Agent 或 Writing SubAgent。
- **Domain Facade SQLite 生产链收口**：新增仅 E2E 构建启用的 `runDomainFacadeSqliteSmoke` 验证入口与 `domain-facade-sqlite.spec.ts`，在真实 Windows Tauri/WebView2 隔离 SQLite 中验证 Project/Context/Conversation、候选发布、用户审阅授权、CAS 采用、重放冲突和重载读回（1/1 PASS）；该入口不进入生产 Tool Registry 或模型 prompt。
- **Phase 1A-C Canonical Tool Projection**：新增独立 `src/services/capabilities/canonical/`，将 `novel.read`、`structure.read`、`context.read`、`memory.search` 通过固定函数映射接入已验证 Domain Facade；统一严格输入 schema、公开 `DomainResult` 输出 envelope、宿主 scope 复验和稳定 manifest hash。四项仍为 `catalog_only`，模型可见 manifest 为 0，未改动 production Registry、DSH allowlist、Main Agent 或 Writing SubAgent。
- **Facade 作用域与来源修复**：生产只读 handler 现在区分 `sqlite` 与 `localstorage` 来源；章节读取复验分卷、角色关联和事件关联的作品归属，跨作品和损坏关系 fail-closed。
- **Canonical 只读链路副作用收口**：风格与输出控制的 Facade 读取改用 `initialize:false` 纯读模式，不再因首次读取隐式播种 LocalStorage/SQLite 默认方案；Canonical `context.read` 的 `sideEffect=none` 现在有真实存储快照证据。
- **章节候选作用域修复**：结构化章节候选现在显式携带 `chapterId`，SQLite 服务端复验章节归属并写入 AI task scope，避免合法候选在审阅阶段因 `sourceChapterId` 丢失而被拒绝；非章节候选保持作品级 scope。
- **已完成 Tool 工作性门禁**：新增隔离 fixture 的 `productionToolRuntime.test.ts`，真实调用全部 18 个 TypeScript production handler（含 `novel.read_context`、`chapter.read_outline`、`search_memory`、style/verification 与 candidate validator），并验证跨作品 scope 与缺少 authoritative scope 时 fail-closed；候选 validator 仍只计为 schema 验证，不计为正文生成能力。
- `npm run test:workbench`：Node DSH/代理 27/27 + TypeScript Workbench 111/111 通过，0 失败；新增闭环测试覆盖模型快照、失败关闭、修改稿来源、授权作用域、结构化应用零副作用、Schema 原型键拒绝、生产 Tool handler、Canonical Manifest、carrier freshness、Domain Facade、浏览器协议边界、显式 E2E 模型投影与 Fetch 禁止端口防护。
- `productionToolRuntime.test.ts`：18/18 个现有 TypeScript production handler 在隔离 fixture 中合法调用返回 `ok=true`；`cargo test --locked -p novel-domain-gateway`：16 个 Gateway unit tests 与 1 个真实子进程 integration test 全部通过，覆盖 schema、权威 scope、非 Unicode allowlist 失败关闭、candidate-only、MCP error 与进程边界。
- DSH 定向动态测试 10/10 通过：正向启动固定 DSH 真实载体并验证 user turn 权威 goal、小说/章节 scope 进入 Gateway 和合法工具调用成功，同时覆盖同进程 follow-up、模型切换、恢复、并发隔离与早期取消；测试结束后 DSH Worker、Novel Gateway、本地模型代理及其 Job Object 子进程残留均为 0。
- `domainFacade.test.ts`：6/6 定向 Domain Facade 真实浏览器回退链测试通过，覆盖 Project/Context/Memory/Conversation/Artifact/Writing 边界、跨作品负例、候选审阅授权、重复采用阻断和存储重启读回；该结果明确标记为 `browser_fallback`，不冒充 SQLite E2E。
- `canonicalToolProjection.test.ts` 与 `domain-facade-sqlite.spec.ts`：四个 Canonical adapter 在 Browser fixture 与真实 Windows Tauri/SQLite E2E 中均通过公开 DTO、来源/hash、权限/scope、旧 alias 拒绝和只读快照验证；Canonical Agent manifest 仍为 0。
- `npm run test:e2e -- --spec agent-production-closed-loop.spec.ts`：受控 Mock 下的真实 Windows Tauri + WebView2 + SQLite 五轮闭环与进程重启验收通过（2 作品、5 独立章节、10 TaskRun、10 ResultArtifact、10 ArtifactDecision，其中 5 次要求修改、5 次确认并消费授权，最终采用 5 个章节）；机器证据记录于 `test-results/e2e/agent-production-closed-loop/closed-loop-evidence.json`。该结果不等同于外部 LLM 或 DSH 自主 Planner 验收。
- `npm run lint:ci`：0 errors, 0 warnings。
- `npm run build` 与 `npm run test:bundle-size`：TypeScript/Vite 生产构建成功，114 个 JavaScript chunk 通过包体门禁；入口 gzip-9 21.48 KiB、最大 chunk gzip-9 44.49 KiB，生产 `dist` 对 `runDomainFacadeSqliteSmoke` 与 `e2eDomainFacadeProbe` 均为 0 命中。
- `npm test`：共 518 项通过，0 失败。
- `npm run test:coverage`：通过；整体 statements/lines 52.66%、branches 71.48%、functions 60.39%，核心专项 87.67%，关键组件覆盖率 90.96%。
- `npm run test:e2e:browser`：4/4 specs、21/21 cases 通过，WebDriver/Edge 进程与端口正常回收。
- `npm run test:e2e`：真实 Windows Tauri + WebView2 + SQLite 完整串行套件 18/18 specs、21/21 cases 通过；18 轮均无前端未处理错误、console error、外网请求、超时、清理错误或残留进程，SQLite `integrity_check` 全部为 `ok`。
- `npm run test:component-size`：148 个生产 TSX 文件通过，最大文件 500 行。
- `cargo check --locked`（`src-tauri`）：通过，0 error（4 个 dead-code warning）。
- `cargo test --locked`（`src-tauri`）：382 passed，0 failed，2 ignored。
- **安装包时间线纠正**：工作区中的 `AI Novel Studio_3.6.0_x64_en-US.msi` 与 `AI Novel Studio_3.6.0_x64-setup.exe` 是早于本次 6 万字验收和连续性修复生成的本地候选，不能作为当前修复后最终产物；本次修复后的桌面全链路仅使用 `--bundles none --ci`，没有再次执行 MSI/NSIS。固定 DSH commit、carrier 内嵌 Gateway 与当前 release Gateway 的匹配及陈旧 carrier 失败关闭由独立门禁验证。
- `npm audit --omit=dev --audit-level=high`：通过；无 high/critical，保留 React Router 6.30.4 的 2 个 moderate 公告待独立依赖修补。
- `npm run test:docs-sync` 与 `npm run test:version-sync`：通过。

## v3.5.0 (2026-08-21) - 对话式创作工作台与审阅收敛

本版本包含原规划的 v3.3.0 工作台最小闭环、v3.4.0 产物确认/审阅授权，以及 v3.5.0 领域任务与旧 AI 面板收敛。

### 工作台最小闭环

### 新增

- 默认 `/` 进入创作工作台；`/novels` 保留原作品管理首页，旧章节写作工作台路由继续可用。
- 新增任务对话、回合、运行、工具调用事件和候选产物卡片的 SQLite migration 032、Rust repository/service/commands，以及浏览器 LocalStorage 开发回退；migration 033 补充活动运行唯一性、跨任务作用域、状态边和终态不可变保护。
- 工作台支持同一小说下创建并切换多个任务；每个任务冻结独立 Provider/模型快照，运行拥有独立 Worker、状态和取消边界。
- 首批对话内联工具为 `novel.read_context`、`chapter.read_outline`、`search_memory`、`generate_chapter`；生成结果只形成候选产物卡片，不直接写入正式正文。
- 新增 Runtime Registry 只读“当前插件”视图，分类显示功能、模型与 DSH Adapter projection，不提供插件管理动作。
- 新增固定 DSH 发布 commit `47f943859bef60e4160492346772ded9b24f765a` 的真实 Headless Task Worker：每个活动任务独立 child/Job Object，工作目录固定在 `dsh-task-workers`，idle 后保留进程；后续回合走同一 Session 的 `session/prompt`（`lifecycle=continued`），进程退出后从 JSONL 调用公开 `ctx.agents.resume`（`lifecycle=resumed`）。`dsh_start_task_turn` 动态测试覆盖 follow-up/resume 与两 Worker 取消隔离。
- `describe_runtime` 不再把载体文件存在写成 `loaded`；当前插件健康来自 idle Worker 或显式 probe，打开“当前插件”时才启动探测。
- 工作台左侧同时列出全部小说下的任务；工具行显示语义中文名与技术名；运行状态轮询 Rust Worker 映射。
- 新增 `taskSessionAdapter` 的桌面 DSH IPC bridge 与浏览器 fallback 边界，将 Session/Agent/Worker 映射为 ANS 稳定标识；参考快照差异记录见 `docs/audit/dsh-baseline-diff-2026-08-20.md`。
- migration 034 将新的对话产物卡片限制为已校验 `ResultArtifact` 的 `artifactId` 投影；旧 032/033 卡片保留可读兼容，桌面 UI 从 Artifact Service 读取正文，不再保存第二份候选正文。
- DSH novel gateway 增加 `novel.read_context`、`chapter.read_outline`、`search_memory`、`generate_chapter` 任务 allowlist 与候选生成工具；旧章节准备别名保持回退兼容。
- 任务执行状态改为按 conversation 独立跟踪：用户切换任务不会锁住或覆盖当前对话，已运行任务可继续在后台推进并单独取消；动态章节 Prompt 在真正执行生成步骤时读取前序工具证据。
- 应用 bootstrap 时把重启前遗留的 queued/running/cancel_requested 运行恢复为可审计失败事实，并把未完成工具事件收敛为 cancelled，避免从深链路启动或刷新后永久显示“运行中”。

### 修复

- 修复 `generationJobService.test.ts` 的 Vite SSR 测试服务器持续执行依赖自动发现、导致断言全部通过后进程仍不退出并持续占用内存的问题；测试现在关闭文件监听与依赖发现。
- 项目清理事务同步清除所属任务对话、回合、运行、工具事件和产物卡片，并在维护删除后恢复回合 append-only trigger；浏览器开发回退删除小说时也同步清理对应任务 bundle。

### 验证

- `npm run test:workbench`：49 项通过（含 11 个工作台工具投影、按目标选择领域候选工具、跨任务冲突提示、角色/事件 Safe Apply、上下文压缩版本与回滚）。
- `npm run lint:ci`、`npm run build`、`npm run test:docs-sync`、`npm run test:version-sync` 通过。
- `cargo test --locked start_path_followup_reuses_session_and_resumes_after_child_exit` 通过。
- `cargo test --locked start_path_two_conversations_cancel_one_without_stopping_the_other` 通过。
- `cargo test --locked available_carrier_is_not_reported_loaded_before_runtime_health` 通过。
- `npm test`：303 项通过。
- 全量 `cargo test --locked`：294 项通过（含备份 schema 11 与 compaction-basic health 投影）；2 项 ignored。
- 桌面 E2E 仍需在真实 Tauri 会话中回归；本版本不打包 MSI/NSIS。

### 产物确认与章节审阅

### 新增

- migration 036：append-only `artifact_decisions` 与 `review_authorizations`；备份 schema 11。
- 对话产物卡片提供确认进入审阅 / 要求修改 / 拒绝；章节确认会签发审阅授权并打开写作工作台审阅模式。
- 写作工作台在 `authorizationId` 下默认只读，显式“进入编辑”后才可改；采用前消费审阅授权。重复决定与重复消费幂等。
- `setting_candidates` 的「确认并申请应用」走既有 Placement Safe Apply；质量报告不能直接应用。
- `outline`、`character_candidates`、`event_candidates`、`chapter_summary` 的申请应用走对应领域服务；章节正文仍必须确认进入审阅，不能直接 Safe Apply。

### 领域任务与旧工作台收敛

### 新增

- 对话 allowlist 增加 candidate-only 工具：`generate_outline`、`generate_characters`、`suggest_events`、`expand_settings`、`polish_chapter`、`check_quality`、`summarize_chapter`。
- Gateway / Tool Registry / DSH Worker 同步暴露这些工具；结果仍只形成 ResultArtifact 卡片，正式写入继续走确认协议。
- 新增 `ans.novel-context.extractive-v1` 小说上下文压缩 Provider：读取当前作品 revision、生成带覆盖率证据的压缩候选，校验通过后才可应用；旧压缩版本保留并可回滚。
- 任务模型快照冻结压缩 Provider/version；DSH Cordis 组合挂接 `compaction-basic`（`auto: true`）作为 Session 输入压缩 seam，不改写 Agent Loop。
- 写作工作台默认只保留保存、草稿、章节准备、总结、排版和采用；生成/大纲/角色/事件/风格/润色等 AI 入口迁入创作工作台。桌面 E2E 仍可打开工程/设定/检查/生成以回归既有作业链路。

### 修复

- 章节事件采用改为写入 SQLite（`create_chapter_event` / `list_chapter_events`），桌面不再只落 LocalStorage。
- 候选工具拒绝无结构文本：角色/事件/设定必须含 name 或 title；质量报告必须含 summary 或 issues。
- 统一 Planner / AI Task / 桌面 E2E 的生产 Tool Registry 哈希为 `6eebed8c…`；DSH 测试 allowlist 与 Cordis composition 计数同步到 11 个工具和 compaction-basic。
- `runtime/health` 投影补上 `compaction-basic`；项目备份 schema 11 的测试断言与 `artifact_decisions` / `review_authorizations` 对齐。
- 工作台增加「压缩上下文」预览与确认应用入口。
- 压缩候选在对话中发布为 `generic_json` ResultArtifact 卡片（桌面）或浏览器投影卡片，确认后走既有 `request_apply` / Safe Apply 路径。浏览器结构化应用不再一律 `BROWSER_APPLY_UNSUPPORTED`。
- 浏览器 fallback 按任务目标选择领域候选工具（大纲/角色/事件/设定/润色/质量/总结），并输出可通过候选校验的结构化预览；无章节绑定时仍只做只读检索，不伪造 DSH 或 ResultArtifact。
- 工作台输入区提供快捷模板，并在同一小说已有写入类任务运行时给出跨任务目标冲突提示（不阻断并发）。
- 风格分析/伏笔审计走质量报告候选，风格润色走 `polish_chapter`；伏笔候选映射为事件候选。
- 修复前端完整备份校验仍停在 schema 9、会拒绝桌面导出的 schema 11 备份的问题；同步 README、路线图和导入导出文档的工作台完成态与备份 schema 11。
- 修复对话工作台桌面 E2E：消除重复变量声明，按 WebdriverIO 元素集合读取插件行，并接受输入区「任务启动失败」与运行卡片中的 DSH 载体失败并存。
- 修复工作台把「你好」「你能做什么」等问候/能力询问默认跑成 `generate_chapter` 并因缺少 `candidateText` 瞬时失败的问题；这类消息现在直接回复能力说明，不再空调用生成工具。
- 修复桌面端打开工作台时并发解包 DSH 载体互相覆盖、最终 `dsh-runtime` 装不上导致无法使用的问题；解包改为单飞并回收已解压完整的残留目录。

### 架构重构与工程治理

- **后端领域分层（Phase 2）**：解耦万行单体 `commands.rs`，全面建立 `domain/`（纯业务规则与验证）、`repositories/`（持久化抽象与 SQLite 实现）、`services/`（应用服务与事务协调）与 `commands/`（薄命令入口）分层体系，318 项 Rust 测试全量保持通过。
- **前端业务解耦（Phase 3）**：
  - 将 2,200+ 行的 `chapterProseOrchestrator.ts` 拆分为 `scenePlanParser`、`beatContextAssembler`、`beatTextValidator`、`beatRepairService` 与 `proseGenerationPipeline` 等单一职责模块；
  - 将 1,700+ 行的 `generationJobService` 拆分为状态机流转控制、多端存储、断点续生、质检门禁与章节生成主管线；
  - 将 770+ 行的 `WorkbenchPage.tsx` 消除 15 个散落状态，抽离出 5 大专职 Custom Hook，页面聚焦纯布局与视图装配；
  - 关键链路测试加固：新增 14 个场景解析、状态机与质检门禁测试，前端自动化测试总数增至 322 项全绿通过；
  - 完善基于 `variables.css` 的全局 Design Token 体系与标准组件工具类。
- **运行时加固与桌面交互（Phase 4）**：
  - 消除 Rust 生产代码路径中的潜在 panic 隐患，加固 DSH 进程生命周期容错；
  - 在 AI 侧边 Dock 面板、正文编辑区与作品详情页全景接入 `PanelErrorBoundary` 局部隔离与重试机制，杜绝渲染白屏；
  - 引入跨平台桌面快捷键 Hook `useKeyboardShortcuts`，支持防误触机制与快捷键映射。

## v3.2.1 (2026-08-19) - 发布资产 URL 热修复

### 修复

- 修复 Tauri 生成的 Windows 安装包文件名包含空格时，GitHub Release 将空格规范化为点号、而 Stable updater manifest 仍发布 `%20` URL，导致自动更新下载返回 404 的问题。
- `latest.json`、`release.json` 现在统一记录 GitHub 实际发布的 updater、签名和 MSI 资产名；其他不受支持的资产名字符继续失败关闭。
- 已修复 `v3.2.0` 与 `updates-stable` 的在线 manifest，未移动既有 tag，也未替换安装包、updater 或签名文件。

### 验证

- `node --test scripts/release/build-release-manifest.test.mjs`
- `npm run test:version-sync`
- 对修复后的 `updates-stable/latest.json` updater URL 执行真实 HTTP HEAD，返回 `200` 并重定向到 `release-assets.githubusercontent.com`。

## v3.2.0 (2026-08-19) - 本地章节正文流水线与 DSH 稳定整合

### 修复

- 修复 v3.2.0 发布门禁：同步 README 阶段与 Agent Runtime 版本，统一使用 Web Crypto 生成业务/追踪 ID；API Key 不再写入 LocalStorage，旧持久化密钥会在首次读取时迁入当前会话内存并从持久存储移除。
- 将 Chapter Card 的“保留悬念”内部字段改为非凭据语义名称并兼容读取旧字段，消除安全扫描对小说情节数据的误判而不丢失旧草稿。
- 将应用 Provider 的直接 `reqwest` 升级到 0.12，并更新可独立升级的 Rust 传递依赖；安全审计限定 Windows 目标，只对 Tauri 1.8.3 updater 固定的 reqwest 0.11/h2 0.3 advisory 保留具名例外。
- 删除三份只匹配源码字符串、会随换行和封装调整误报的 PowerShell 伪测试；AI Task 删除保留真实 Rust 运行时回归，设定建议与质量工作台继续由现有 React/Node/Rust 动态测试覆盖。桌面启动 E2E 改为验证 migration 至少完整到 031，不再因未来新增迁移而修改写死计数。
- 将 migration 030/031 纳入正式迁移账本；输出控制方案字段迁移现在兼容缺失基础表、旧版精简表、空数据库和重复启动，并补充动态回归测试。
- DSH preparation 运行记录改为显式失败关闭：成功提案或失败事实无法写入 SQLite 时不再吞掉错误；相同运行身份可幂等重放，冲突事实会被拒绝。
- 新增 DSH preparation 用量汇总 IPC，按作品和章节聚合已完成运行的输入 Token、输出 Token 与耗时，失败运行保留审计但不混入成功汇总。
- DSH preparation 用量账本只提供运行观测，不替代 migration 029 的全局 AI 预算预留、派发与结算门禁。
- DSH 启动进程和调用 Provider 前，由 Rust 对大纲、章节工程、风格、输出控制、人物状态和 Memory 六类 SQLite 权威修订号重新取值；任一来源读取失败、缺失或发生漂移都会失败关闭。
- 输出控制方案在 Tauri 桌面端改用 SQLite CRUD，并以一次性、可重试的幂等桥接迁移现有 LocalStorage 数据；浏览器开发模式保持原有 LocalStorage 行为，DSH 网关和前端不再读取不同事实源。
- DSH 安装载体改为带 `JUNCTIONS.json` 的可重定位 zip：安装后在可写应用数据目录原子解包、重建 pnpm junction 并校验 runtime hash；release 构建拒绝空资源，debug 构建使用 Git 忽略的占位资源。
- Windows release、PR 质量门和桌面 E2E CI 固定检出 DSH commit `47f943859bef60e4160492346772ded9b24f765a`，冻结安装依赖并构建 host libraries 后才执行 Tauri release profile 构建；空载体继续失败关闭，本地 MSI/NSIS 已验证包含真实 runtime zip 与解包器。


## v3.1.0 (2026-08-14) - DSH 进程外大脑接入

> 当前条目包含尚未提交和发布的工作树增量；最终发布状态以完整门禁、提交和版本标签为准。

### 新增

- 新增 DSH（DeepSeek Harness）进程外大脑接入：DSH 只经只读 MCP 工具产出可验证的 `ChapterPreparationProposal`，与现有章节准备 Planner 双源并行；事实解释、策略否决、预算、执行、事务与最终采用权全部留在 ANS（设计文档 `docs/architecture/dsh-feasibility-spike.md`，可行性证据 `reports/dsh-spike/spike-report.md`：12 案例六项门槛全过、盲评胜率 100%）。
- 新增 Rust DSH Supervisor（`src-tauri/src/services/dsh/`）：stdio JSON-RPC 帧编解码、initialize/prompt/shutdown、崩溃检测、取消=重启语义，子进程树纳入 Windows Job Object（`KILL_ON_JOB_CLOSE`，含 MCP 网关后代）；会话遥测（工具调用、文本/推理、token usage）随事件流记录。
- 新增 `novel-domain-gateway`（workspace 成员 crate）：MCP stdio 只读网关，暴露 `get_metadata / get_chapter_context / search_memory / get_character_states` 四个只读工具；`SQLITE_OPEN_READONLY`、参数校验、camel/snake 双名兼容、2 MiB 输出上限，输入与输出均拒绝疑似凭据（镜像 `ai_fact_security` 规则并带漂移测试）。
- 新增 Rust 权威 Proposal Validator：schemaVersion/顶层键/目标章节/baseline 回显/revision 漂移/写动作拒绝全量校验；planner 枚举支持唯一近邻归一（Levenshtein ≤2，写入 `metrics.plannerCoerced`，绝不静默）。
- 新增 `dsh_prepare_chapter` 命令：驱动 Supervisor 完成 initialize→MCP settle→规划回合，解析失败或校验失败时执行最多 3 次修复回合（回喂校验错误并逐字符拼写枚举），adapter 注入运行时 metrics 后返回类型化提案。
- 新增本地 OpenAI 兼容模型网关代理（`scripts/dsh/model-proxy.mjs`）：流式透传 + usage 记账日志（预算网关挂钩点）；上游 Key 只存在于代理进程，DSH 侧使用隔离的下游假 Key；命令自动分配空闲端口并管理代理生命周期。
- 新增 TS 端口：`src/types/chapterPreparation.ts` 类型层与 `ChapterPreparationPlannerPort`；`CurrentPlannerAdapter`（编排现有 readiness 计划并确定性映射，零模型成本）与 `DshPlannerAdapter`（invoke 薄 facade，浏览器模式明确不可用）；TS 镜像校验器与 13 项单测。
- 写作工作台 AI 生成面板新增“章节准备提案（DSH 融合实验）”卡片：双源切换（当前 Planner 零成本 / DSH 真实 API）、运行计时、提案摘要（目标/场景/人物约束/风险分级/未决问题/建议动作）、度量展示与枚举归一标记；提案不自动采用。
- 新增章节准备规划 persona 提示词（`prompts/dsh_chapter_preparation.md`）与生产 cordis 组合模板（`scripts/dsh/cordis-template.yml`，六插件、stdout 纯净、零 Key 落盘）。
- 新增自包含运行时载体：`scripts/dsh/build-runtime-payload.mjs` 把固定版本 harness 运行时装配为 `dsh-runtime/` 载荷（全部包 lib + package.json + node_modules junction 农场 + `VERSION_MATRIX.json`；junction 感知拷贝器 + 构建期目标存在性门禁）；启动解析链 `DSH_RUNTIME_ROOT` → 应用目录 `dsh-runtime/`（或 `resources/dsh-runtime/`）→ `DSH_CHECKOUT`，载荷完整性五判据不足时回退，载荷载体 e2e 实测通过（无 `DSH_CHECKOUT`，真实 API 66s）。
- 新增逐来源基线修订号接线：六来源真实修订号（大纲 version / 工程 activeVersion / 风格·输出·角色状态·记忆 updatedAt→unix 毫秒）在发起提案前加载并原样回显校验；修订号与章节身份原子绑定防竞态，单来源读取失败降级不阻断（结构化告警），记忆源只取 active 文档。
- 修复网关只读查询两处语义：工程状态按 `status='active'` 选取（原 `active_version=1` 误把版本号当布尔，真实库上下文 2386B→7300B）；角色状态修订号改读 `MAX(created_at)`（表无 updated_at）。

### 安全与一致性

- API Key 全程零落盘：只经环境变量注入 DSH 子进程；启用本地代理时上游 Key 仅存在于代理进程，DSH 进程拿到的是隔离假 Key。
- 提案校验失败、越权写动作、revision 漂移、超长文档一律整体拒绝；修复回合成本如实计入 metrics 与代理记账日志。
- 网关以只读模式打开小说库，不执行迁移/恢复/写入；DSH 会话（推理轨迹）与小说事实分离，可整目录删除重建。
- Supervisor 崩溃/取消通过 Job Object 整树回收；测试与端到端运行后零残留进程、代理端口释放。

### 工程质量

- `cargo test dsh::` 13 项全绿（Supervisor 生命周期/强杀重启续会话、Validator 全量规则含 spike 失败样本归一、网关漂移与凭据检测）；`cargo check` 零警告。
- 真实 API 端到端（`deepseek-v4-flash`）：Rust 命令 → DSH 运行时 → MCP 网关（真实开发库只读）→ 本地代理 → DeepSeek → 校验通过的提案，单案例约 20.6k tokens，断言全过（`#[ignore]` e2e 测试，显式运行）。
- TS 侧新增 18 项单测（镜像校验器 9 + 确定性映射 3 + 卡片行为 5 + 既有配套）；`tsc` 零错误、`eslint` 零告警、`npm run build` 通过。
- 统一版本为 `3.1.0`（npm、Tauri、Cargo、应用常量、路线图与发布文档）。


## v3.0.0 (2026-07-28) - Multi-Agent 自主创作闭环

> 当前条目包含尚未提交和发布的工作树增量；最终发布状态以完整门禁、提交和版本标签为准。

### 新增

- 增加本地逐 Beat 正文的手动重跑断点：用户重新启动失败章节时，只复用同一冻结上下文哈希、同一本地模型路线和同一 Scene/Beat 顺序下持久化的最长连续合格前缀；每个候选 Beat 必须先按当前字数、required 事件、重复与跨 Scene 连续性门禁重新验证，首个不匹配处及其后全部重新生成，并在新作业步骤中记录来源 job，不自动重发中断请求。
- 扩展手动重跑断点到旧 failed 作业的不可变外部 Beat 修稿 Artifact：仅当正式 Task 已完成、Artifact 有效、`generationJobId/contextHash/Scene/Beat` 身份一致且 `finish_reason=stop` 时，才按当前安全边界裁剪并交给编排器完整复验；校验规则修正后可零 Token 接管曾被误判的正文，`length` 截断、兼容投影摘要或来源漂移均失败关闭。
- 增加独立的本地章节 Scene 正文生成路由：可配置本地 OpenAI-Compatible 模型，仅接管章节首次生成与 Autonomous 候选正文，不自动回退到外部 Provider。
- 增加 `chapter_scene_generate` 编译契约、`scene_text` 候选产物类型，以及 qwen35-9b-novel-v3 的单 user / 4096 context / 1024 output 协议。
- 本地章节请求支持并审计 `top_p`、`top_k`、`repeat_penalty`、`seed` 采样参数；本地模型成本保持未定价状态。
- 新增有序 `SceneBeat[]` 数据契约与旧 ScenePlan 字段归一化；章节工程支持全局 Provider 生成 `chapter_scene_plan_generate` JSON 候选，用户确认保存或应用后才写入工程状态。
- 新增统一 Chapter Prose Orchestrator：常规生成、章节工程任务和 Autonomous 候选共享逐 Scene 串行编排、前一场景状态胶囊、每 Scene 任务审计、required Beat 覆盖/连续性/截断校验及合并草稿边界。
- 设置中心新增本地模型 `/health`、`/v1/models` 与短场景 smoke 检查；本地模型使用独立串行队列，服务不可用时不静默回退外部 Provider。

### 修复

- 修复 required Beat 语义门禁与超长外部修稿的两个真实误判边界：分句有序覆盖现在通用识别“并成/并表/整理成结构化集合”、稳定口径，以及外部角色的制止/审视/追问等警觉反应，同时不会把主角自身观察误作对手警觉；`finish_reason=stop` 的超长修稿在前缀或逐段删减无法安全收束时，会按原顺序搜索有界的完整句/段子集（最多 120,000 个状态，优先保留首尾），每个候选都重新执行 required Beat 完整动作、篇幅、重复与跨 Scene 连续性门禁，无合法候选仍失败关闭。
- 修复跨进程自主调度的质量门禁越过用户确认直接采用正文：`draft_night` 与 `quality_gate` 现在都只产生未采用的 `candidate_ready`，后者即使六专家指标达标也必须携带 `userConfirmed` 显式晋级；只有 `full_auto` 在冻结质量、预算与目标复验通过后才自动采用并确认章节分析。

- 修复外部章节质量修稿返回完整 `revised_content`、但某个局部 `before` 因标点或措辞轻微偏差而整轮失败的问题：精确替换无法应用时，仅允许依据唯一质量问题锚点和同段落结构的完整修订见证恢复确定性局部补丁；无完整见证、问题锚点不唯一、段落结构变化或改动越出问题段落时继续失败关闭，并新增真实失败形态回归测试。
- 修复本地 Beat 两次校验失败后外部定点修稿遇到可重试的 429/5xx/超时就直接终止整章的问题：同一逻辑修复轮现在最多进行 2 次传输尝试并复用任务身份，成功后才进入 Beat 校验，不重复本地 Beat 调用；同时修复真实章节生成链路遗漏传递前一章未采用候选上下文的问题，保证断点续跑和跨章连续性。
- 为真实章节生成增加无正文消耗的本地模型预检：正式编译上下文和逐 Beat 请求前只调用 `/health` 与 `/v1/models`，不执行 smoke 生成；服务离线或模型身份不匹配时在 preflight 阶段显式失败，避免等待到首个 Beat 才发现配置不可用。

- 将章节生成任务与检查面板的整章质量闭环收敛到同一服务：已有未采用草稿和首次评分报告可直接进入“问题绑定修稿 → 保存未采用候选 → 复评”，不再为了重试质量阶段重新生成 Beat、复制同文草稿或重复首评。Provider 已完成并持久化 `changed_ranges`、但进程在候选保存前中断时，可从源草稿确定性重建补丁，不再次调用外部修稿；目标草稿与复评报告均使用稳定身份保存，仍失败则保留候选并转人工处理。复评结果无论是否提高都会进入不可变质量历史，质量修稿候选不会提前过期正式采用稿的章节/分卷上下文，也不会自动采用。
- 将外部整章评分和质量修稿的结构化输出治理改为紧凑预算：DeepSeek V4 flash/pro 的这两类 JSON 任务均关闭高成本 thinking；评分上限由 20000 收敛为 8192，修稿按 1～8 个问题动态预留 2048～7168（硬上限仍为 8192），减少 32K 路由上的预留冲突与等待时间，不改变本地 Beat 的 1024 output 训练契约。
- 修复本地正文整章评分未达标后的唯一外部质量修稿仍为 DeepSeek V4 启用高思考、并以约 17k 输入叠加 16k 输出预算越过常见 32k 上下文边界的问题：质量修稿现显式关闭该模型的 thinking，紧凑 `changed_ranges` JSON 输出预算收敛为 8192；同时修正 `quality_fix_runs` Tauri 参数封装并取消桌面端静默降级，确保修稿轮次、失败原因和唯一轮次门禁可靠写入 SQLite。
- 修复最新真实诊所修稿用“录了下来”“脉冲节律”完成接口取证，却因词形未覆盖而被误判缺少记频的问题；同时收紧“目光落在备用监测口”的警觉归一化，避免把主角观察接口误当作技师起疑并跨段吞掉真实触碰、记录与离场事件。新增完整 Artifact、跨 Scene 连续性、安全裁剪和明确未获数据的负向回归。
- 修复最新真实诊所 Artifact 已写出“跟随技师进入检查室并贴电极启动、指尖按在备用接口、把频率数字记在收据、技师审视挡门、下楼推开临街铁门”，却被误判缺少检查、触口记频和警觉离场的问题；新增高置信等价动作与明确否定触口回归，模型真实未触碰或未记录时仍不能通过。
- 修复断点续跑后的新真实诊所 Artifact 中，“摸到松动插孔。随后记下接口旁频率”被跨句触口正则错误合并、吞掉“记下”动作，导致有序事件游标被后文重复频率推进到离场之后的问题；触口与否定触口现在都只在同一句内关联监测口/接口，并补充“具名技师小周引导检查、看到缩回的手后制止、林舟下楼离场”的完整回归，未触碰、未记录或技师未察觉仍不能通过。
- 修复最新真实 Scene 2 / Beat 1 外部修稿已完成“以失眠为由入诊、坐到仪器前并戴电极启动检查、技师抬头制止和皱眉后立即离开诊所”，却因只写“椅子”且未直说“警觉”而被误判、无法在 500–750 有效字内安全收束的问题；新增的高置信等价规则同时要求医护引导就位、电极启动，以及医护明确制止后人物真实离场，仅在门外、未接受检查或无人察觉时仍失败关闭。
- 修复真实外部 Beat 修稿已经完成“敲门、孙婶开门邀请、林舟进屋落座”，却因“进来坐”没有显式宾语而被误判缺少走访的问题；新等价规则同时要求计数敲门、被访者邀请进入和主角实际落座，只停在门外或门链未解仍失败关闭。
- 修复章节真实重跑在后续 Beat 失败后总是丢弃 `generation_step_results` 中已经通过的前置 Beat、从 Beat 1 重做全部本地/外部调用的问题；同上下文同模型的显式重跑现在从首个问题 Beat 继续，真实第二章现有历史可安全复用前两个连续 Beat。
- 修复第三章实际前的 Scene 2 / Beat 1 外部修稿虽已写出“躺上诊床、贴电极、摸向备用监测口、录下脉冲、发现干扰、推开玻璃门离开”，却因训练分布中的动作表达未进入等价词表而被全部判缺的问题；新增患者检查、物理触口、脉冲记录、仪器异常警觉和玻璃门离开映射，并以完整真实 artifact 增加回归测试，仍保留“仅远观接口、无警觉或不离开”失败门禁。
- 修复真实 Beat 2 外部修稿已写出“决定明天亲自去一趟，以患者身份混进去看看”，并在下一段实际换装进入海葵记忆诊所，却因决定句省略重复出现的诊所名称而被误判缺少“次日伪装成患者进诊所调查”的问题；有序门禁现在识别“未来时间 + 患者身份 + 混入意图”这一高置信决定表达，仍要求此前分句已经按序建立海葵诊所、封存与维稳证据，只有路过或明确不进入仍不能通过。
- 修复最新真实外部 Beat 修稿已经收到 v4 的 700–750 有效字、700–930 原始字符与 8 段合同，仍以 `finish_reason=stop` 在 565 原始字符 / 483 有效字 / 7 段提前结束的问题：v5 合同把有效字目标推到动态硬上限，把原始字符脚手架提高为 800–1050，并严格要求 10 个至少含两个完整句子的实质自然段；计数不确定时允许正常结束地轻微超写，再由既有完整句边界裁剪回 500–750 字。外部定点修稿仍最多调用一次，短稿、截断或裁剪后语义不完整继续失败关闭。
- 修复真实外部单 Beat 定点修稿虽在完整 Artifact 中写全 required Beat、却把末尾“技师警觉后离开诊所”拖到 750 字裁剪线之外的问题：最终合同现在要求在动态上限 65% 前完成全部事件与终态、开场铺垫不超过 80 个有效字，并把请求区间收紧为动态上限前 50 字至动态上限，同时为标点换行预留 180 个原始字符；最终编译 user 指令也使用同一 700–750 有效字目标与 930 原始字符上限，不再回落到 625/500/830；写完终态后仍必须用当前 Beat 内动作阻力、现场感官、即时反应或短对白补足最低字数，不能在 500 字前提前结束；“接触备用监测口 + 记下频率”同时加入高置信有序语义锚点，只有远观接口或只记频率仍不能通过。
- 修复最新真实外部 Beat Artifact 已明确写出“明天一早去海葵诊所、以长期失眠为由挂号进去调查”，却因该决定跨句表达而被误判为缺少次日伪装潜入的问题；高置信等价动作现在同时要求未来时间、目标诊所、患者借口以及挂号/进入意图，只有门外路过或明确不进入仍不能通过。
- 修复 DeepSeek 外部 Beat 修稿虽收到 700–750 有效字要求、仍以 `finish_reason=stop` 在 322 有效字结束的问题：最终合同增加 700–930 原始字符双门槛和 8 个实质自然段的可执行篇幅脚手架，并去除已接受前文与上一 Beat 的重复注入；仍只允许一次外部修稿，低于 500 有效字继续失败关闭。
- 修复真实外部 Beat 修稿以“孙婶家窗户正对货运巷、她给林舟倒水”直接建立屋内走访场景时被误判缺少“走访孙婶”的问题；句首人物住处的窗户现在可作为高置信场景锚点，并先消除“没有/未/不曾登门”等否定表达，再应用正向拜访等价词，因此在巷口远望窗户并明确未登门仍不能通过。
- 修复复合 required Beat 分句门禁把“影响稳定”误判为缺少“维稳”、把技师检查异常接口后主角推门脱身误判为缺少“警觉/离开”、把填写日期地点等结构化事件信息误判为未“补录”，以及开场用“孙婶家的门”建立拜访场景时把走访游标错误推到证词之后的问题：覆盖比较会先归一化受限的高置信语义等价动作，并把 required 分句中的关键概念设为强制有序锚点；真实诊所修稿中的“递病历卡、坐检查椅、贴电极”“默记脉冲周期”“辅助通道波动后挡路”“推门走进夜风”也分别识别为患者检查、记频、警觉与离开，“第二天换装、练习失眠说辞并实际推门进入诊所”识别为次日潜入决定；只有“封存”而没有稳定口径、只有离开而没有警觉、只有警觉而未离开，或仅提到记录但未执行填写/提交动作的正文仍会失败关闭。
- 修复复合 required Beat 仅命中任意两个短语就被误判为完整覆盖的问题：覆盖门禁现在按逗号/分号拆分有序事件与终态分句，逐句要求正文锚点；真实测试中“多户并表、海葵诊所、市政封存、维稳”已出现但“次日伪装潜入”被收束裁掉的候选将明确失败，不再进入整章评分。
- 修复外部单 Beat 定点修稿虽完整生成必需事件、却因最终 user 指令未重复动态硬上限而扩写超长，随后前缀自然收束裁掉 Beat 终态的问题：最终指令现在直接携带 500 字下限、动态上限和完整 required Beat，并将该任务温度上限收紧到 0.35（保留更低用户值）；仍只调用外部 AI 一次，收束后语义不完整仍失败关闭。
- 修复真实外部单 Beat 修稿在 DeepSeek V4 默认 high thinking 下耗尽 32k 输出 Token、约 270 秒后仍以 `finish_reason=length` 失败的问题：仅对 `deepseek-v4-flash/pro` 的 `chapter_beat_repair` 治理合同显式发送 `thinking: { type: "disabled" }`，并把只输出 500–900 字正文的最终预算收回 4k；`thinkingMode` 同步进入不可变 Provider 选项快照，其他 OpenAI-Compatible 模型不接收 DeepSeek 专用字段。
- 修复外部单 Beat 定点修稿正常结束但越过动态篇幅上限时整章直接失败的问题：提示目标为硬上限预留 50 个有效叙事字，且仅对 `finish_reason=stop` 的超长结果按最后一个安全句末或段落末收束；收束后重新执行最低字数、required Beat、重复和跨 Scene 连续性门禁，无安全边界、关键内容被裁掉或 `finish_reason=length` 时仍失败关闭，不增加外部调用次数。
- 为外部 AI 单 Beat 定点修稿增加独立执行合同与最低 300 秒任务级超时，避免误用整章生成的 12k 输出预算或继承全局 120 秒导致推理模型截断/超时；最终正文仍按动态 Beat 字数上下限校验。
- 统一外部单 Beat 修稿的字数口径：汉字与字母数字计入有效叙事字数，标点和空白不计；提示目标在 500 字硬下限上预留 100 字缓冲，避免外部模型按含标点字符数提前结束后被门禁拒绝。
- 修复真实本地 Beat 只校验 500 字下限、未执行 900 字上限而把 2500 字章节膨胀到 3739 字的问题：按章节目标和 Beat 数计算 500–900 字内的动态上限（2500 字 / 4 Beat 为 750 字），过长正文与提前出现的“本章完/全文完”均触发同一 Beat 的有界完整重写。
- 修复首 Beat 只读取过度简化 Scene 胶囊导致主角职业身份漂移的问题：在 4096 context 内同时注入场景胶囊和冻结章节上下文的头尾压缩片段；Scene 规划候选也必须把主要角色身份、开场状态和不可变事实写入 contextCapsule。
- 修复真实 Scene/Beat 规划在推理型外部模型上连续出现空内容或 6000-token 截断的问题：规划契约改为紧凑 JSON、输出预算提高到 12000 tokens，并对空响应、截断和无效候选执行最多 3 次有界安全重试；重试仍只产生待确认候选，不直接修改章节工程。
- 优化逐 Beat 连续性输入与采纳门禁：本地模型在 4096 context 内读取本章已接受正文的紧凑前缀和明确的 500–900 字目标，外部定点修稿读取完整已接受前缀并检查事实冲突、同类信息重复和节奏堆叠；当前 Beat 若大段复述已接受前文或把 Beat 规划句原样夹入正文，会先触发本地完整重写，避免跨 Beat 重复引入秘密、证据或摘要残留。
- 修复真实逐 Beat 生成中仅把 500–900 字写入提示词、却未在采纳校验中执行最低 500 字门槛的问题；短 Beat 现在会触发且最多触发一次本地完整重写。
- 补齐本地 Beat 两次仍未通过后的外部 AI 定点修稿：每个问题 Beat 最多外部重写一次，并复用 500 字、截断、覆盖与连续性校验；该合并前救援不再错误占用已保存源草稿的唯一质量修稿轮，整章首轮评分失败后仍可执行一次问题绑定的局部修稿并重新评分。
- 将外部质量评分的独立输出预算从 12000 提高到 20000 tokens，并把评分请求最低超时提高到 300 秒，避免推理模型在 JSON 评分输出前因 `finish_reason=length` 被截断。
- 修复作品详情页一次请求 6 个章节大纲时容易触发 `finish_reason=length` 的问题：默认批次缩为 3 章，单章大纲和总响应增加明确输出预算，目标字数改为 2500，并在生成后自动定位候选结果。
- 修复章节工程刷新时旧草稿版本优先于较新 active 版本加载的问题，避免后续保存把已应用的 Scene/Beat 回退为过期内容。
- 修复章节工程应用 Scene/Beat 候选后仍显示“待确认候选”的状态残留，避免用户误以为候选尚未应用并重复提交。
- 修复推理型外部模型在质检/定点修稿 JSON 输出前耗尽预算的问题：质检和修稿分别使用 12000/16000 output token，定点修稿最低超时提高为 300 秒，并限制质检最多 8 个合并问题、修稿返回紧凑 JSON；本地 Scene 模型仍保持 1024 output token 训练契约。
- 修复外部质量修稿虽然返回 `changed_ranges`、实际却仍以完整重写正文落地的问题：现在只接受绑定待处理问题的唯一 `before → after` 替换，并在不可变源草稿上确定性合成；歧义、重复、未绑定或重叠替换全部失败关闭。质量面板与章节生成任务共用同一范围门禁和 300 秒超时，每个源草稿持久限制为最多一轮外部修稿。
- 修复桌面端访问 loopback 本地模型时继承系统代理导致健康检查 502 的问题，并兼容 llama.cpp `/v1/models` 的 `models[].name` / `model` 返回形状。
- 修复本地模型达到 1024 输出上限后的 Scene 响应 metadata 归一化；`finish_reason=length` 直接判定为未完成，单个生成单元最多执行“首次生成 + 1 次完整重写”。
- 修复本地正文生成偏离训练粒度的问题：外部候选按 2000–3000 字章节规划总计 3–5 个有序 Beat，每个 Beat 目标 500–900 字并独立执行一次单 user / 4096 context / 1024 output 本地调用；单 Beat 首次失败最多完整重写一次。
- 新增本地正文质量门禁：外部 Provider 评分须达到 80 且 pending critical/high 为 0；不通过时最多执行一轮外部定点修稿并重新评分，仍不通过则保留候选并转人工处理，不自动采用。
- 修复 Tauri 返回的 camelCase 工程 JSON 字段未归一化的问题，避免已保存的 Chapter Card、Scene Plan、约束和质检规则退回通用占位 Beat。

- 新增情节、角色、设定、逻辑、语言和整体质量六类专家，使用当前 Mock 或真实 API Provider 并行评审章节草稿。
- 新增确定性共识算法：最小成功专家数、接受率和平均分共同决定 `accept / revise / regenerate`，Rust 在持久化前根据专家意见独立复算。
- 新增主编 Agent 候选修订链路。未通过时生成新的未采用草稿版本，下一轮评审真实的新正文；达到最大轮数后明确保留未接受状态。
- 新增 migration 021～023，持久化 `multi_agent_sessions`、`multi_agent_rounds` 和 `multi_agent_opinions`，支持 operation 重放、顺序约束、草稿归属校验和终态重放。
- 写作工作台新增“协作”面板，可选择专家、轮数和阈值，启动或取消评审，查看历史 session、逐轮共识和专家意见，并显式载入候选草稿。
- 新增八份独立 Markdown Prompt 模板、确定性编排/解析测试、React 面板测试和 Rust 事务测试。
- 新增 Plot Planner、Character Evolution、World Builder、Conflict Generator 和 Pacing Controller，从小说 Brief 生成 12～500 章的故事圣经、人物弧、世界、冲突、节奏、分卷和连续章节计划。
- 新增自主创作规划工作台。世界/冲突/节奏三类 Agent 并行执行；Chapter Batch Planner 将每卷拆成最多 5 章的子批次，每批成功后立即保存章节与 CAS 检查点，失败后从连续已保存范围继续，不重复调用成功批次。
- 新增受审核逐章执行：生成下一章候选、六专家评审、最多三轮修订、用户工作台采用、计划进度推进和下一章选择。
- 新增用户显式启动的全书候选队列，按章节串行生成，支持暂停 / 继续，跳过已有 `candidate_ready / adopted` 章节，并显示已有候选数 / 总章节数。
- 全书队列将前一章候选作为临时连续性上下文，同时保存前序草稿 ID 与正文 hash；临时上下文不写入正式章节事实。
- 自主规划候选使用 `chapterId + draftId` 精确打开写作工作台；工作台定时刷新卷章状态，当前空章节在后台生成完成后自动载入，存在未保存正文时保持编辑器原状。
- 长章节润色与质量检查改为最多 7,000 字符分段处理，携带前后 400 字衔接参考；润色按原顺序合并，质检按段长加权并将 offset / 段落索引还原为全文位置。
- 长章节质量修稿按问题位置只处理命中的连续分段，未命中正文逐字符保留；章节总结改为完整正文 map-reduce，并移除工作台 3,000 字符与 Autonomous 12,000 字符的上游截断；章节改写与卷总结也不再静默丢弃后半部分。
- 新增章节收束候选：从已采用正文提取章节总结、人物变化、新地点与世界规则候选；用户确认前不写正式上下文，世界条目继续保持待确认候选。
- 新增 migration 024 `autonomous_story_plans`，保存 request hash、revision、计划 JSON/hash、阶段、进度、Agent 运行和逐章运行状态。
- 新增统一 `AiStreamEvent` 与 OpenAI-compatible SSE 管线：浏览器 `ReadableStream` 和 Tauri Rust 均支持跨 chunk UTF-8、按 requestId 有序 delta、最终 usage/finish reason 聚合及取消；正文生成在请求结束前显示临时候选预览。
- 新增 AI usage 成本估算：设置中心可配置输入/输出 USD / 百万 Token 单价，任务创建时冻结价格；`ai_task_records`、正式 Provider response metadata 和章节生成 step 保存 `complete / mock / unpriced / usage_missing` 状态，AI 任务页展示单项成本与当前列表已计价合计。
- 新增独立 TXT 参考资料库：migration 025 持久化 `reference_works / reference_imports / reference_sections`，记录原始字节 hash、解码正文 hash、编码、解析器版本、UTF-16 章节边界与显式重复导入决策；参考作品不进入小说卷章树。
- 新增长文本分层风格画像：确定性覆盖开篇、发展、对话密集、描写密集、高潮和收束，保存模型、Prompt 版本、来源 hash、采样范围及字段置信度；生成侧只读取抽象画像，不持久化或注入参考原文片段。
- 作品详情新增“参考资料库”入口和独立桌面工作区，支持版本切换、CAS 冲突保护、来源删除、可取消的画像分析及画像来源状态展示。
- 新增 migration 026 混合语义 Memory：`memory_documents / memory_chunks / memory_embeddings / memory_retrieval_logs` 保存带版本和 hash 的采用稿来源、结构化片段、显式真实向量及不可变检索审计；采用稿改变时旧 Memory 与正文改采在同一事务内失效。
- Memory 检索支持小说作用域内的 FTS5 / substring、实体与时间过滤、真实向量余弦重排、importance / recency 综合评分、分页和硬 Token 预算；没有向量或 FTS5 时显式降级，不生成伪 embedding。
- 设置中心新增每分钟请求数、并发数、每日 Token / 估算成本硬预算和预警阈值；请求派发前先做保守预留，超限请求不会进入 Provider，缺少完整单价时不能启用成本硬预算。
- 写作工作台新增 Zustand 会话状态，统一持有作品、卷章、当前草稿、编辑器、质量检查和 AI 弹窗状态；切换作品时原子重置会话归属，避免跨作品残留。
- 新增 migration 027 跨进程 Autonomous Scheduler：持久 `book_run / lease / attempt / checkpoint`，使用 owner、单调 epoch、heartbeat、CAS、重试、熔断、预算和时间窗恢复中断任务，并提供夜间草稿、质量门禁、全自动三档策略。
- 新增 migration 028 多目标事务与正式故事资产：冻结目标集合、base revision/hash 与 candidate hash，在单个 `IMMEDIATE` 事务中执行 `all_or_nothing / reviewed_partial` CAS；跨章节批处理只更新受限 metadata，不绕过正文草稿和采用指针。
- 新增自主创作续写协议：读取卷章、角色和世界设定基线，按最终章节号生成增量计划，支持新建分卷或接续最后一卷；应用前复验基线 hash、卷序、章节 ID 和引用，既有卷章不会被覆盖。
- 自主创作六类 Agent 统一接入 `executeAiTask` 与生产编译注册表；直接绕过治理边界的自主任务请求会失败关闭，并新增架构说明 `docs/project/ai-generation-governance.md`。
- 主章节生成路径统一接入 `executeChapterGeneration` 与生产编译注册表；写作工作台和 generation job 共享编译、取消、流式事件和候选 Artifact 边界，历史直接 Provider 调用对 `chapter_generate` 失败关闭。
- 修复风格分析 Prompt 的构建期加载与字段契约校验，避免运行时静默回退到不完整 Prompt。
- 新增势力、地点、势力关系、地点连接，以及角色/章节/章节事件与势力或地点的正式关系表；地点父子图按拓扑顺序写入并拒绝环。
- 作品资产中心新增“势力与地点”工作区，可创建和审核正式资产候选、显式选择跨章节批处理子集，并查看事务历史；浏览器开发模式明确保持只读，不伪造 SQLite 事务。
- 完整项目备份升级至 schema 9：schema 8 加入调度运行事实，恢复时把 `running / active / claimed` 分别收敛为 `queued / expired / abandoned` 并重算身份与 hash；schema 9 加入全部正式故事资产及关系，按父子拓扑恢复地点。
- 设置中心新增 Stable/Beta 更新通道、显式检查、签名安装进度和回滚入口；Tauri 1 updater 在安装前重新核对通道与版本，发布流水线注入 minisign 公钥/私钥并生成静态 updater、release 与 rollback manifest。

### 安全与一致性

- 修复真实 OpenAI-compatible API 调用的三处边界：连接测试的 TypeScript 编译器与 Rust 持久化校验共同读取冻结策略，统一使用 `temperature = 0`、128-token 输出预算，以兼容推理型模型并避免旧 8-token policy 被误用；章节规划保留至少 600 秒客户端超时，同时将原先可能一次请求 30 章的长响应降为最多 5 章、2,100～4,500 token 的子批次；自主创作与 Multi-Agent 每次网络尝试使用经清理、限长并带摘要的唯一传输 ID，避免继续操作命中 `AI_REQUEST_ID_RECENTLY_SETTLED`。API Key 与持久设置保持不变。
- Rust 与浏览器路径在响应正文读取阶段保留 timeout 分类；非超时正文中断会明确报告“上游服务在响应完成前中断连接”，任何 `finish_reason=length` 响应（包括非空部分正文）都会被判定为未完成并丢弃。错误路径不暴露 Provider 正文或推理内容。
- Chapter Batch Planner 不再固定截取首个 Markdown fence 或首尾大括号：解析器会逐一检查字符串与转义感知的平衡 JSON 候选，优先选择包含 `chapters` 的最完整对象，并仅受控修复字符串外的尾逗号；章节数量、连续编号和引用校验继续严格失败关闭。解析失败只记录 finish reason、响应字符数和输出 Token 数，不持久化 Provider 正文。
- 修复 `update_volume` 与 `update_chapter` IPC 将 `id`、`status` 和 `volume_id` 拼接进 SQL 的注入风险；改为固定 SQL 与参数绑定，并在 Rust 边界验证分卷/章节状态白名单。
- 新增恶意 `id`、`status`、`volume_id` 回归测试，证明构造输入不会修改其他分卷或章节，同时保留含单引号合法文本的更新能力。
- 草稿不存在、版本变化、完整正文不可用、正文为空或超限时失败关闭，不再使用占位正文。
- 单专家失败被记录为失败意见；未达到 quorum 时不能接受。空专家、零轮次和伪造共识均被拒绝。
- 候选只保存为草稿，不自动采用；载入候选前经过工作区离开保护，当前编辑器不会被后台结果静默覆盖。
- 完整项目备份先以 schema 6 加入参考作品，以 schema 7 加入四张 Memory 表，现升级为 schema 9 并纳入跨进程调度和势力/地点正式资产；恢复会重映射身份、复验来源与 hash，并继续兼容 schema 2～8 的历史能力边界。
- 应用全书计划必须由用户确认；桌面端在一个事务内创建卷、章、角色、世界设定、必需冲突事件和章节角色关系，重放时复验全部物化目标。
- 页面恢复会按权威采用稿修复计划进度并重启缺失的章节分析；改采不同草稿会清除旧分析和已确认人物节点，避免旧结论继续生效。
- 章节正文生成成功后立即把源草稿 ID 和 generation job 写入自主计划检查点；后续质量检查、专家评审或进程中断时可复用已保存正文，不重复生成。
- 写作工作台按章节与草稿双重身份读取候选，并继续复用大文本原子协议：正文超过 100 KiB 时写入 `large_text_documents / large_text_chunks`，完整正文校验失败时不以预览替代。
- 移除润色和质量检查对正文前 8,000 字符的静默截断；分段缺失、空结果、异常短结果或全文位置映射异常时失败关闭。
- 全局 `runWithLoading` 现在以 operationId 持有真实 `AbortController`；大纲、设定、角色、事件、风格、润色、质检、修稿和总结等独立 AI 入口统一传播 signal、请求 owner 与取消结算。AI 任务中心可停止当前进程持有的运行任务；自持 controller 的面板会在卸载/目标变化时中止，其他全局 operation 在完成时复验原始目标，迟到结果不能污染新目标，`cancelled` 终态也不被迟到成功复活。
- 正式 `ai_tasks` 以相同 task ID 幂等投影到兼容任务中心 `ai_task_records`，使候选草稿外键、任务可见性、停止 owner 和成本结算保持同一身份；系统级任务不写伪造作品外键，同 ID 不同归属失败关闭，重复投影不替换终态父记录。Provider 停止后完成两阶段取消，同任务的全部进程内 owner 都会收到停止信号，失败任务重试时兼容投影恢复运行态；迟到响应与无效 Artifact 会同步结算为取消或失败。任务中心和 Rust 删除命令共同保护等待/运行记录，避免执行期间清空草稿 provenance。
- 流式 delta 仅进入瞬时预览缓冲；无完成标记 EOF、非法帧、`finish_reason=length`、取消或空正文均不创建成功草稿/Artifact，只有完整最终响应可沿既有原子协议保存未采用候选。
- 成本快照使用用户配置价格而非 Provider 自报价格；缺价格或缺 usage 时保持显式未知，Mock 才固定为零。Rust 校验币种、来源、状态组合和数值范围，篡改或不一致 metadata 在 Artifact 写入前失败关闭。
- 新增 migration 029 桌面全局 AI 请求治理：单例 revision 策略、滚动分钟窗口、跨进程并发、每日 Token/定点成本与 owner/TTL reservation 全部由 SQLite `IMMEDIATE` 事务裁决；Rust Provider command 强制复验 request-bound 哈希 lease 并只允许一次派发。snapshot 不隐式建策略，设置页固定首次观察的 CAS revision；UTF-8 字节上界与 chat envelope 避免输入低估，实际 usage 超预留仍全量入账。结算可幂等重放，派发和终态计量字段由 trigger 冻结；失败、取消、缺失 usage 和 TTL 回收保守计量，未定价成本保持显式未知。浏览器开发继续使用 LocalStorage 回退并对失败/过期执行相同保守计量，桌面 IPC 错误不降级。
- 统一 npm、Tauri、Cargo、应用常量、路线图、测试说明和发布文档版本为 `3.0.0`。

### 工程质量

- Autonomous Scheduler 的执行接管固定在应用入口：`main.tsx` 在全局错误处理就绪后幂等接管后端确认可恢复的 run，规划页 Hook 只刷新当前计划；Rust 数据库初始化与前端入口连续执行恢复扫描时，后端会重新返回全部持久 `queued` run，避免首轮恢复结果被初始化阶段消费后无人获取新 lease。桌面 Worker 每 15 秒执行一次互斥恢复扫描，使应用在旧进程 lease 尚未到期时重启，也能在 lease 到期后自动获取更高 epoch；已持 lease 的 Worker 若在 claim 前发生未处理异常，会先 heartbeat 复验 owner/epoch，再以 CAS 暂停 run 并释放 lease，已被新 epoch fencing 的旧 Worker 不会暂停替代 owner。新增 SQLite 回归同时断言 claim 前失败后的 run 为 `paused`、lease 为 `released`、最新 checkpoint 为 `run_pause`，且 Attempt、AI Task 与 generation job 均保持 0。浏览器模式继续保持零持久化调用。
- 抽离无执行管线依赖的 AI 设置持久化模块，任务价格快照不再通过动态导入重建 `aiTaskService → aiSettingsService → aiExecutionPipeline` 循环；统一清理 Tool Registry、Repository 与 Scheduler 的无效静态/动态重复导入，生产构建相关告警归零，同时保留 Autonomous 章节运行时按需加载。
- Vite 新增稳定的 React、Router、Zustand、Tauri vendor chunk 和构建 manifest；`test:bundle-size` 以真实文件字节和 gzip-9 双门槛失败关闭，并校验单一入口、全部 JS 归属和稳定 vendor 名称。入口由 527,482 B / 171,797 B gzip 降至 324,172 B / 104,328 B gzip-9；快速 CI、Windows 质量门和签名发布均执行该门禁，签名发布还显式依赖可复用的完整 Windows 桌面 E2E。
- 新增生产 AI 请求静态门禁：使用 TypeScript AST 扫描全部非测试 TS/TSX，`client.generate` 与 `createAiClient(...).generate` 必须显式传递非空 `AiGenerateOptions`；零命中、缺参、`undefined` 或 `null` 都失败关闭，并以负向夹具防止门禁退化。
- 编辑器高频输入改为单次 `setEditorActivity` 原子 Store 更新；卷树和 AI 任务卡使用稳定 memo 边界，任务轮询 reconciliation 保留未变化对象引用，并以渲染身份预算测试防止无关卡片/树节点重复渲染。
- 大纲加载/采用、AI 草稿采用和工作区刷新失败统一进入脱敏诊断与桌面错误呈现；Provider 失败后的 reservation 结算异常只记录次级诊断并保留原始 Provider 错误，Provider 成功但结算失败则扣留结果、保持失败关闭。
- 浏览器 Light/Dark E2E 在 Splash 移除后解析真实 WebDriver PNG，校验亮度分位数、不透明率、颜色桶和每页明暗均值差，不再只以 DOM 属性或 computed style 代替像素证据。
- Rust 原始 `println!/eprintln!/dbg!` 已收敛到唯一结构化 stderr sink；任务删除、读取、质量检查和启动日志不再输出数据库路径或原始实体 ID，`test:rust-logging` 及负向夹具阻止新增旁路日志。
- 新增 `docs/feature-gap-analysis-v3.0.0.md`，以当前代码和 schema 逐项核验流式输出、参考小说、风格画像、无人值守、语义 Memory、跨章节检索、多目标放置、可靠取消及势力/地点资产九类缺口；校正“风格画像完全缺失”“取消仅覆盖 generation_jobs”“只存在简单全文检索”和“每章均需单独触发生成”等过时结论，并给出依赖、验收门禁和建议版本顺序。
- 开启 TypeScript `noUnusedLocals`、`noUnusedParameters` 与 `noImplicitReturns`，同时收紧 `tsconfig.node.json`；修复严格检查发现的风格方案和输出方案删除未实际执行的问题。
- ESLint 已将显式 `any` 提升为 error，并以 `--max-warnings 0` 运行 CI；生产源码散落的 `console.*` 已收敛到统一、脱敏的 `appLogger` sink，Rust 编译 warning 同步清零。
- 新增 Prettier、Husky、lint-staged 与 Commitlint，提交时增量格式化变更文件并校验 Conventional Commit 信息，避免对历史文件进行一次性大规模格式化。
- 新增 `test:all`、`test:vitest`、`test:performance` 与 C8 `test:coverage`，把 Node/tsx、独立 AI 面板、44 个 Vitest 文件和性能基准纳入统一入口；650 条 AI 任务分页回归也已进入标准门禁。当前全局非回退阈值为 lines/statements 34%、functions 44%、branches 64%；核心逻辑集合阈值为 lines/statements 85%、functions/branches 80%。最新干净实测全局为 35.14% / 47.34% / 66.41%，核心集合为 87.90% / 85.89% / 82.01%，关键组件集合为 91.67% / 90.00% / 78.74%（依次为 lines、functions、branches）。
- 新增 120 万字符分段、500 章索引窗口和重复长文本堆增长基准；当前分段和索引实测约 5 ms / 0.6 ms，并以 1.5 s、100 ms 和 96 MiB 堆增长作为稳定门禁。
- 新增 AI P50 / P95 延迟与成功、失败、取消计量；设置中心可导出或清理本机脱敏诊断，前端错误最多保存 50 条、性能样本最多 500 条，正文、Prompt、API Key 和 Provider 原始响应不进入报告。
- 新增桌面原生 panic 最小信封：在数据库与窗口初始化前安装 Rust panic hook，只保存时间、应用版本和源码文件名 / 行列号，排除 panic payload、堆栈、绝对路径与用户内容；设置中心统一展示、导出和清理最近 50 条原生报告，默认不上传。
- GitHub Actions 新增快速浏览器 CI、定期依赖审计 / CodeQL 和 Windows Beta / Stable 发布工作流；发布产物包含安装包、通道与回滚 manifest，并保留既有真实 Tauri 桌面 E2E。npm/Cargo Dependabot 继续提供依赖更新入口。
- 新增 `docs/project/git-workflow.md`，明确 `main` 保护、`codex/` 任务分支、PR 审查 / required checks、hotfix、tag、回滚和禁止 force push 的治理边界；远端保护规则由仓库管理员配置，不把文档声明冒充为已启用设置。
- 将 40 份 `docs/release-notes-v*.md` 合并为带源文件 SHA-256 的单一 `docs/project/release-history.md` 只读归档；`CHANGELOG.md` 成为唯一活动版本入口，版本脚本不再生成碎片，发布工作流按目标版本失败关闭提取 GitHub Release 与 updater notes。
- 拆分本地安装包与签名发布入口：`tauri:build` 只生成 MSI/NSIS，普通开发机不再因缺少 updater 私钥而在产物生成后返回失败；`tauri:build:release` 仅供 release workflow 注入密钥并生成签名 MSI updater。
- 真实浏览器开发模式 E2E 使用 Vite + WebdriverIO 驱动 Chromium/Edge，覆盖懒加载 StoryAssets 路由、无 Tauri bridge 的持久化边界，以及手动 Light/Dark 主题的真实 computed style；Windows 桌面 E2E 新增正式势力创建和 reviewed-partial 跨章节事务场景。
- 所有生产 React/TSX 文件已控制在 500 行以内；自主规划、主角卡和 Multi-Agent 面板进一步拆为 controller、字段、展示和 presentation 模块。补齐缺失 CSS 语义 token，移除会覆盖手动浅色选择的组件级系统暗色媒体查询。
- AI 任务页与卷树继续拆分为 controller / view / card / dialog 模块，并新增对应渲染回归；`npm run test:component-size` 已纳入 `verify_project.ps1`、发布 Checklist 与 PR 模板，当前 109 个生产 TSX 文件全部不超过 500 行。
- 修复浏览器主题矩阵在 localStorage 写入后未刷新页面的问题，补齐系统主题测试的存储键传递，并为首页容器补上主题语义背景色；启动 Splash 还会在首屏绘制前同步读取手动主题，截图门禁等待 Splash 真正移除后再采集目标页面。
- 更新 Store 状态所有权与模块边界文档，明确 Zustand 只保存当前 WebView 的运行时投影，组件局部状态保持局部，Service / Tauri IPC / SQLite 继续持有业务事实与跨进程事务。
- Vitest 从存在 critical advisory 的 3.2.4 升级至 3.2.7，并通过非破坏性 `npm audit fix` 更新 Babel、PostCSS、js-yaml、brace-expansion 等可兼容传递依赖；生产审计继续以 high 为失败阈值。
- 浏览器开发回退的 LocalStorage 写入失败改为失败关闭，并保留恢复快照的可重试错误契约；自主计划多集合应用使用原始快照补偿，任一写入失败时恢复全部集合并显式报告回滚失败，不再返回部分写入的伪成功。
- 文档同步检查改为失败关闭：必需文档、Checklist、Skill、工作流脚本、重复或错版的权威声明及过期“当前”标记都会返回非零状态；新增临时夹具负向回归并同步修正旧阶段表述。
- 同步自主续写数据模型：明确 schema 1 可选 baseline、最终章节号、两类分卷物化策略及应用前 compare-and-swap；生成治理文档区分全产品传输/请求治理与分阶段编译 Artifact 治理，并统一新增续写错误提示语言。
- 补充 Chapter Batch Planner 子批次 / 恢复测试、全书候选队列与临时连续性测试、长章节分段测试、规划页执行面板测试和 Rust 响应正文中断测试。
- 补充浏览器与 Rust SSE 顺序/UTF-8/usage/无标记 EOF 回归，新增独立 AI 面板停止与卸载测试、LocalStorage/SQLite 冻结单价结算测试，以及正式 Provider 成本 metadata 篡改与重放复验；`test:ai-panels` 将三个 Vite SSR 重用例拆为独立进程，`test:all` 串联 Node/tsx、面板和 Vitest 入口。
- Windows release 使用既有本地 API 配置真实续跑原失败计划：当前解析修复构建从第 156 章检查点连续完成 6 个五章 Chapter Batch（第 156～185 章），每批均成功解析并立即保存；随后受控取消第 186～190 章请求。生产 SQLite 已核验 1～185 章连续且无重复、成功任务 6/6、取消任务不写入章节、`quick_check=ok` 且外键检查为空，API 设置未改写。
- 同一 release 使用既有本地 API 配置执行连接测试，界面显示“连接成功！（2577ms）”；测试期间未编辑、读取或输出 API Key，也未保存设置。
- 同一 release 继续完成真实流式正文验收：工作台“实时候选预览”从等待首段增长到 2,170 字符，并以“已完成 · 3,514 字符”结束；`chapter_generate` 任务成功（输入 2,914 / 输出 2,349 Token），原子保存为未采用的 `AI 初稿 v21`（2,867 字）并自动载入中央编辑器。草稿正文 SHA-256 与 SQLite `content_hash` 完全一致，编辑、保存、润色、检查和采用入口继续可用，未覆盖既有采用稿。
- 关键工作台视图测试中的 `EditorArea` mock 现与生产组件一致地转发 ref，移除 React 的 ref 噪声，同时保留编辑器、目录、历史和右侧面板的行为覆盖。

### 版本边界

- v3.0.0 工作树已完成长篇自主规划、六专家评审、跨进程三档调度、可靠取消 / 流式安全预览 / 成本硬预算、参考资料 / 分层风格 / 混合语义 Memory、多目标事务、跨章节受审核批处理和势力 / 地点正式资产。夜间草稿与质量门禁不自动采用；`full_auto` 仅在冻结策略、预算、专家阈值和采用前复验全部通过时采用。
- 自动 embedding/增量向量化/模型重建、召回评估集、EPUB/PDF/OCR/Markdown/DOCX 参考资料、全书分析/项目驾驶舱、系统级无人值守、正文级批处理、资产图谱、受控模型 Tool Calling 与出版交付属于后续独立版本目标；成本仍是冻结单价的 USD 估算，不等同 Provider 账单对账。
- 当前工作树的动态测试、真实浏览器 10/10、完整 Tauri 桌面 E2E 14/14 与独立 Windows EXE 已完成；本轮按测试顺序只使用 `--bundles none` 刷新 EXE，既有 MSI/NSIS 保留为较早产物，待独立 EXE 验收后再进入安装包阶段。签名 updater、正式 GitHub Release 与线上回滚仍由 release workflow 在注入仓库密钥后执行。

---

## v2.6.1 (2026-07-27) - 文档规范化与版本统一

### 说明

本版本为 v2.6.0 Memory Facts 系统的文档更新版本，主要完成项目文档规范化和版本号统一工作。

### 变更

- 统一所有配置文件版本号为 `2.6.1`（package.json、Cargo.toml、tauri.conf.json）
- 更新 README.md 版本描述和功能列表
- 补充 CHANGELOG 历史记录
- 规范化发布历史文档

### 技术栈

- React 18 + TypeScript
- Tauri 1.x + Rust  
- SQLite + Migrations (001-020)
- Chapter Readiness Planner
- Memory Snapshot System

### 版本边界

本版本不包含自主生成（Autonomous Generation）功能，该功能规划在 v3.0。

---

## v2.5.0 (2026-07-26) - Chapter Readiness Planner Runtime

### 新增

- 新增正式 `chapter_readiness_plan_v1` 六步只读 DAG：作品上下文、章节大纲、章节上下文、风格方案、输出控制与确定性准备度检查。
- 新增 015～020 六条独立 migration，持久化 Agent Plan、Step、依赖、append-only Step Attempt、execution lease 与 append-only Checkpoint。
- 新增 Rust 权威计划状态机和 11 个 Tauri 命令，覆盖幂等创建、读取、列表、租约获取/释放、claim、完成、失败、显式重试、取消和中断恢复。
- 新增 `verification.check_readiness@1` 本地工具；输出冻结 `ready/score/missing/warnings/summary`，不调用 Provider、不生成或修改正文。
- 写作工作台 AI 生成面板新增“章节准备计划”卡片，可创建、运行、查看六步状态、展示准备度结果并显式继续中断步骤。
- 新增 Planner Runtime TypeScript 动态测试、Rust 状态机/迁移测试和真实 Windows Tauri E2E 场景。

### 安全与可靠性

- 每个 Step 冻结 Tool Registry identity、input/output schema hash、权限、scope、canonical 参数与参数 hash；前端每次 claim 前复验完整契约。
- Rust lease 使用单 Plan 单活动 epoch；明文 token 只瞬时返回执行器，SQLite 仅保存 SHA-256，过期、owner、epoch 和 token 均在状态变更前验证。
- 工具失败只追加一个 failed Attempt，不自动重试；显式 `authorize_retry` 记录 `confirmedBy=user` checkpoint 后才把步骤恢复为 pending。
- 应用启动时把所有中断 running Plan 恢复为 `waiting_retry`，running Attempt 标记 `abandoned`、活动 lease 标记 expired，绝不静默重放工具。
- 浏览器开发模式不使用 LocalStorage 伪造持久 Planner；Plan Runtime 只在桌面 SQLite 模式开放。
- 工具输出只在本地持久化并记录 canonical hash，拒绝疑似凭据；普通日志不输出工具参数、结果正文或 lease token。

### 变更

- 生产 Tool Registry 从八个工具增至九个，hash 更新为 `846a38c25bba33c843b56fa6583b334bae3364073fb7f0b6290be0c405aae871`；既有生产 Provider 策略仍保持 `allowedTools=[]`。
- 版本统一更新为 `2.5.0`，同步 README、路线图、架构、数据模型、测试说明、发布说明和验收报告。

### 验证

- `npm test`：Node 16/16、tsx 67/67；Rust/SQLite 143/143，另 1 项真实隔离数据库迁移测试按设计 ignored。
- Planner/Registry 专项 8/8，TypeScript production build 通过；Windows Tauri E2E 与安装包证据记录于发布说明和验收报告。
- 本版只新增本地只读 Tool Calling，不修改 Prompt 或 Provider 请求协议，因此按用户约束不再次调用真实 API。

### 版本边界

- 本版本不实现长期 Memory、正文生成/应用副作用、自动重试/续跑、动态 Planner、Multi-Agent、Agent 自主写入或 UI 重做。

## v2.4.0 (2026-07-26) - Context / Constraint Compiler 与 Tool Registry

### 新增

- 新增 `compiled_ai_execution_v1` / `compiled_ai_request_v1` 正式执行契约，以及 schema v2 Input、Context、Constraint Snapshot 协议。
- 新增 `context_compiler_v1`：冻结来源 type/id/version/origin/hash、缺失来源、确定性顺序与截断状态，并使用 `utf8_bytes_div3_v1` 记录完整预算。
- 新增 `constraint_compiler_v1`：冻结预期 Artifact、response schema、业务约束/hash、Prompt template identity/hash、Provider options 与 Tool Registry policy。
- 新增版本化 `tool_registry_v1`，注册八个真实项目读取/本地验证工具；每个工具声明 input/output schema、权限、scope、超时、副作用与确认策略。
- 新增独立 `prompts/system_connection_test.md` 与 `prompts/setting_expand.md`；连接测试和设定补充成为首批正式编译生产入口。

### 安全与可靠性

- 受治理的 `executeAiTask` 入口不接受调用方自拼 Provider request 或三类 Snapshot；同一编译契约同时驱动实际派发与持久执行事实。普通历史任务在迁移完成前仍保留兼容入口，边界见 `docs/project/ai-generation-governance.md`。
- Rust 在创建 Task 前复算 requestBodyHash、compilationHash、Context hash/预算、Constraint hash、固定 Prompt hash、Provider messages 和冻结 Registry hash；改写 Artifact type 也不能绕过正式验证。
- 来源与 Registry 使用区域设置无关的固定排序；设定来源按 createdAt/id 稳定整理，避免不同电脑对相同事实产生不同 hash。
- Registry manifest 返回隔离副本，调用方不能篡改缓存权威值；allowlist、权限、参数/输出 schema 与 novel/chapter/draft scope 在 handler 前后动态验证。
- 副作用工具不能信任调用方自报确认，必须携带 confirmedBy/userConfirmedAt/planId/operationId/planHash，并由 ToolDefinition 权威复验；当前生产 Registry 没有副作用工具，Provider 策略固定 `allowedTools=[]`。
- 不新增数据库 migration；复用既有不可变 Snapshot 与大文本表，v2.3.2 Safe Apply 边界保持不变。

### 验证

- Compiler / Provider / Registry 专项 18/18；`npm test` Node 16/16、tsx 64/64；Rust/SQLite 139/139，另 1 项隔离数据库测试按设计 ignored。
- `npm run lint` 0 error（保留 1 条既有 React Hooks warning）；TypeScript + Vite production build 通过，231 modules。
- Rust 正式契约额外覆盖 Artifact 绕过、Registry identity 篡改、Context budget、Prompt 与来源 manifest 篡改；本版修改的 Rust 文件通过独立 rustfmt check。
- Windows Tauri E2E、单次 8-token 真实 API 尝试与 production 安装包证据记录于发布说明和验收报告。

### 版本边界

- 本版本不实现 Planner、execution lease、checkpoint、自动续跑、跨重启计划恢复、长期 Memory、新增业务副作用工具、Multi-Agent、UI 重做或 Agent 自主写入。

## v2.3.2 (2026-07-26) - Safe Apply 单目标安全应用

### 新增

- 新增 SQLite migration 012～014：`placement_proposals`、`apply_plans` 与 `artifact_target_links`，只增加安全应用事实，不修改既有业务表结构。
- `setting_candidates@1` 的每条有效候选可建立不可变 PlacementProposal 和一对一 ApplyPlan，绑定 Artifact、候选 index/hash、预分配 targetId、目标不存在 version/hash 与单个 `create_world_setting` effect。
- 用户点击确认时记录 `confirmedBy=user` 和确认时间；世界设定、ArtifactTargetLink 与 Plan applied 状态在同一个 SQLite `IMMEDIATE` 事务中提交。
- 新增受控 Tauri IPC、Rust domain/repository/service、TypeScript 类型与前端薄 facade；提交状态未知只以相同 operationId/planHash 重放。

### 安全与可靠性

- Proposal 整行不可更新或删除；Plan 身份与 effect 不可变、状态仅允许 awaiting → applying → applied/conflict；TargetLink 整行不可更新或删除。
- targetId 碰撞时记录 conflict 并保留已有目标；任一中途写入失败时确认、world_setting、Link 和状态转换整体回滚。
- applied 重放重新读取目标与 Link，并校验包含结构化数据和时间身份的完整目标 SHA-256；目标删除、修改或来源异常时返回 `PLACEMENT_TARGET_CHANGED`。
- 相同操作重放返回首次 world_setting 与 TargetLink，不重复创建副作用；不同 operationId 或 planHash 失败关闭。
- 浏览器 ephemeral 候选不伪造 Proposal/Plan/Link，也不显示正式采用按钮；桌面应用错误保留稳定结构化冲突提示。

### 验证

- `npm test`：Node 16/16、tsx 53/53；Rust/SQLite 137/137，另 1 项真实用户数据库隔离测试按设计 ignored。
- Safe Apply Rust 动态覆盖只读准备、幂等重放、用户确认、目标碰撞、事务故障回滚、不可变与目标漂移；TypeScript 覆盖 commit-unknown 相同身份重放和普通冲突不重放。
- `npm run lint` 0 error（保留 1 条既有 React Hooks warning）；TypeScript + Vite production build 通过。
- Windows Tauri 完整 E2E 12/12；Safe Apply 桌面场景证明 3 个 Proposal/Plan、确认前零正式写入、确认后仅 1 个 world_setting/TargetLink，重放不重复写入。
- Tauri production build 通过并生成 v2.3.2 MSI/NSIS；最终大小与 SHA-256 记录于发布说明和验收报告。
- 本版本没有修改 Provider 网络协议或请求参数，未再次调用真实 API；v2.3.1 的单次真实尝试结论保持不变。

### 版本边界

- 本版本只支持一条设定候选创建一条世界设定，不实现其他 Artifact 类型、批量/多目标 Apply、Planner、Memory、Tool Registry、自动续跑、Multi-Agent 或 Agent 自主写入。

## v2.3.1 (2026-07-26) - Provider Adapter 与统一执行管线

### 新增

- 新增统一 `ProviderAdapter`，在不持久化 API Key / Base URL 的前提下复用现有 Mock、OpenAI-compatible Tauri HTTP、超时和可靠取消能力。
- 新增 `executeAiTask` 管线：桌面执行固定创建 Task/Snapshots、queue/claim Attempt、单次派发 Provider、保存 response identity 并创建不可变 Artifact。
- Provider response hash 使用 SHA-256，字符长度与 Rust Unicode scalar 语义一致；token、finishReason、duration 和本地 dispatch identity 进入白名单 metadata。
- 新增完成 operation 重放：已存在结果时直接读取首次 Artifact，不重复调用 Provider；`DATABASE_COMMIT_UNKNOWN` 只重放同身份持久化步骤。

### 迁移

- 设置中心连接测试迁移到 system Task + `generic_text` Artifact，提示只允许回复 `OK`，最大输出降为 8 tokens。
- “设定补充”迁移到 `setting_candidates` Artifact；Mock/真实结果先作为候选展示，只有用户点击“确认加入设定库”才写正式设定。
- 浏览器开发回退继续允许临时 Provider 运行，但明确返回 ephemeral 结果，不创建 LocalStorage Task、Attempt、Snapshot 或 Artifact。

### 安全与兼容性

- Task 的 Input Snapshot 冻结实际 Provider messages；Context 与 Constraint 保存当前过渡期编译文本、模板身份、预算、来源清单和安全 Provider options。
- 真实凭据只存在于瞬时 Adapter 配置和既有受控 Tauri 请求参数中，不进入 Snapshot、Artifact、普通日志或 E2E 产物。
- 修复 Tauri 字符串错误被统一降级为网络错误的问题；鉴权/权限失败与请求参数拒绝现在保留安全后端消息，并分别形成稳定、不可盲重试的错误码。
- 未迁移 AI 入口继续使用 Legacy `ai_task_records`，不在本版本强行改写质量报告外键或其他业务表。

### 验证

- Provider 管线定向测试 7/7：安全快照、单次派发、提交未知重放、取消、Tauri 字符串错误分类、浏览器 ephemeral、完成结果重放与真实 Mock Adapter。
- Windows Tauri `provider-pipeline-setting.spec.ts` 1/1：Task completed、Attempt succeeded、Artifact valid，三条候选展示且正式设定行数不变。
- `npm test`：Node 16/16、tsx 51/51；Rust/SQLite 133/133；Windows Tauri E2E 12/12；`npm run lint` 0 error（保留 1 条既有 React Hooks warning）；前端与 Tauri production build 通过。
- 真实 API 按约束只执行一次 8-token 连接测试；Provider 返回失败，形成 system Task、三 Snapshot 与 failed Attempt，未创建 Artifact，未重试且未以 Mock 冒充通过。

### 版本边界

- 本版本不实现 Placement / ApplyPlan、自动正式写入、Planner、Memory、Tool Registry、自动续跑或 Multi-Agent；只迁移连接测试和一个只读候选入口。

## v2.3.0 (2026-07-26) - Agent 执行事实层 M1

### 新增

- 新增 `AiTask`、`AiTaskAttempt`、`AiInputSnapshot`、`AiContextSnapshot`、`AiConstraintSnapshot`、`ResultArtifact` 与 `ArtifactValidationIssue` 七类持久执行事实。
- 新增 SQLite migration 005～011；仅增加表、索引和触发器，不修改 `chapter_drafts`、`quality_check_reports` 或其他既有业务表，也不回填或伪造 Legacy Snapshot。
- Task 创建由 Rust 计算 canonical requestHash，完整覆盖请求契约版本、目标、预期 Artifact、三类 Snapshot schema、正文/上下文/Prompt hash、compiler/budget 与白名单 Provider 选项；`operationId + requestHash` 支持权威重放。
- Task 与三类 Snapshot、对应大文本 document/chunks 在单个 `IMMEDIATE` 事务内创建；Snapshot 及其引用的大文本建立引用后禁止更新或删除。
- Attempt 新增单 Task 单活跃执行约束、状态与 revision CAS、Provider 身份一次性绑定、重试、取消、迟到响应隔离，以及提交结果未知后的幂等重放。
- ResultArtifact 与持久 Input Snapshot、Task、Attempt、预期类型/schema 和 Provider responseHash/length 强绑定；原始、展示与结构化结果均复用大文本完整性层，解析失败仍保留完整原始响应。
- ArtifactValidationIssue 使用稳定 run/index 顺序且只追加；错误和 Provider metadata 采用字段白名单、大小限制与凭据检测，不保存完整正文、Prompt、headers 或授权数据。
- 新增受控 Tauri IPC、React/TypeScript 领域类型和桌面端薄 facade；浏览器开发模式不伪造持久 Task / Artifact。
- 新增重启读取接口，可完整读取 Task、全部 Attempt、三类 Snapshot 正文、全部 Artifact 及 ValidationIssue 历史。

### 可靠性与兼容性

- `ai_task_records`、`generation_jobs` 与所有既有业务数据保持原样并继续作为 Legacy 使用；现有生产 AI 入口尚未迁移到新执行管线。
- migration 动态覆盖空库、重复启动、旧/新 checksum 冲突、当前 migration 回滚、v2.2.1 业务表形状与行数保持、外键检查、SQLite integrity check 及真实用户数据库隔离副本升级。
- queue、claim、Provider success/failure、取消和根 Artifact 均支持提交成功但 IPC 响应丢失后的同身份重放；变更后的重放请求 fail closed。
- 普通日志不再输出新 AI Task IPC 参数，避免正文、Prompt、上下文或 Provider metadata 泄漏。

### 版本边界

- 本版本是后续 Provider Adapter、Tool Registry、Planner、Memory、恢复执行与 Multi-Agent 的执行事实基础，但不代表这些能力已经实现。
- 本版本不实现自动续跑、Placement / ApplyPlan、正式正文自动写入、UI 重做或 Multi-Agent；不修改生产 Provider Adapter，因此不调用真实 AI API。

### 验证

- Rust/SQLite 常规全量测试 133/133；另以真实用户数据库的隔离副本执行 v2.2.1 基线补齐、M1 升级、重复启动、业务行数/字段形状与完整性验证 1/1。
- `npm test` 通过：Node 16/16、tsx 44/44；`npm run lint` 0 error（保留 1 条既有 React Hooks warning）；`npm run build` 通过。
- migration、Task/Attempt、Artifact、不可变大文本、重试幂等与文件数据库重启读取专项动态测试全部通过；未调用真实 AI API。
- Windows Tauri 启动 smoke 1/1、完整桌面 E2E 11/11、生产构建与 MSI/NSIS 打包全部通过；最终产物大小和 SHA-256 记录于 v2.3.0 发布说明。

## v2.2.1 (2026-07-26) - 工作区竞态可靠性热修

### 修复

- 原子草稿保存结果新增可信 `disposition`，明确区分新建、原地更新和“采用竞态后派生新候选”；前端不再依据事务前的陈旧 `isAdopted` / draft ID 误报已提交保存失败。
- v2.2.0 已完成 operation 仅在 `disposition` 字段缺失时按请求/结果 ID 兼容升级；显式未知或伪造值直接拒绝，三种合法写入类型均有旧记录重放回归。
- 冲突恢复内容使用基于快照身份的持久 operationId，并在跨会话重试时按目标、note、完整正文与 SHA-256 识别已提交候选；completed replay 返回前重新权威读取目标，目标已删除、漂移或损坏时保持原 operation 不变并拒绝陈旧成功，恢复快照不会被误清理。
- Tauri 原生 `close()` 拒绝时立即撤销一次性 bypass；下一次关闭仍进入 Leave Guard，goal-only 预检路径也不再产生未处理 Promise rejection。

### 版本边界

- 本版本只修复 v2.2.0 发布后审查确认的三条竞态，不扩展 AI Provider、Planner、Memory、Multi-Agent 或自主写入能力。
- 本版本不调用真实 AI API；真实额度保留给实际修改 Provider、Tool Calling 或 Agent handoff 的后续里程碑。

### 验证

- `npm run lint` 通过：0 error，保留 1 条既有 React Hooks warning；`npm run build` 通过，211 modules。
- `npm test` 通过：Node 16/16、tsx 44/44；组件 5/5、工作区可靠性 15/15、恢复 12/12、长正文 7/7、正文安全门 5/5、迁移 1/1。
- Rust/SQLite 全套 111/111，包含“采用先提交”和“保存先提交”两个竞态顺序；完整 Windows Tauri E2E 11 个独立 spec 全部通过。
- `npm run tauri:build` 同时生成 v2.2.1 MSI 与 NSIS 安装包。

## v2.2.0 (2026-07-26) - 工作区可靠性与基础设施收口

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

### v2.1.8 协调修复

- 原子草稿保存完整保留 `aiTaskId` 与 `note` 溯源字段，并将二者纳入 operation 请求 hash；同一 `operationId` 携带不同来源元数据时不再误判为可幂等重放。
- 更新草稿前重新读取 SQLite 权威采用状态；目标草稿已采用时只读且创建新候选版本，采用事务在途期间产生的新编辑不会被迟到的采用回调覆盖。
- 旧 `commit_large_text_draft_create` / `commit_large_text_draft_update` 写 IPC 从 Tauri 注册表移除，遗留入口也固定 fail-closed，所有长正文草稿写入必须经过 `save_chapter_draft_atomic`。
- 损坏或无法完整读取的正文进入专用 `unavailable` 安全态，只允许重试、查看草稿历史或返回章节列表；preview 不进入编辑器与 AI 上下文。
- Leave Guard 统一为“保存并继续 / 放弃并继续 / 取消”三选项，并把章节目标 dirty 纳入同一预检、导航与原生关闭防重入流程。
- 收紧采用、创建章节与恢复快照的异步竞态：提交后的权威结果保留，但迟到回调不得切换目标、覆盖新编辑或吞掉恢复错误。
- 浏览器 recovery 写入后执行内容回读确认、删除后执行不存在确认；LocalStorage 写删失败显式返回，不再伪装成功。
- 恢复内容另存候选一旦提交即视为成功；随后快照清理失败只告警并保留可重试清理语义，不诱导用户重复创建候选。

### 验证

- `npm test`：Node 16/16、tsx 动态回归 43/43；工作区可靠性 13/13、恢复 10/10、大文本完整性 5/5，三组专项均同时通过 Rust 103/103。
- Windows Tauri 完整 E2E 共 11 个独立 spec 全部通过；`npm run tauri:build` 成功并同时生成 MSI 与 NSIS 安装包。
- 保留 1 条既有 React Hooks warning、9 条既有 Rust unused/dead-code warning，以及既有 Vite 动静态 import 与 500 KiB chunk warning；本轮没有调用真实 AI API。

### 兼容性

- 保留旧基线初始化和普通草稿读取；旧大文本 draft/chapter/null target 形式通过草稿引用做兼容校验。
- 旧草稿写命令代码暂时保留但不再暴露为 Tauri 保存入口，避免绕过原子保存边界。

## v2.1.8 (2026-07-26) - 章节上下文持久化一致性闭环

### 新增

- 新增章节上下文原子保存命令：在一个 SQLite 事务中校验作品、章节、已采用草稿与角色归属，并提交章节总结、上下文记录、角色状态、`characters.current_state` 和 `chapters.status = 'summarized'`；任一步失败整笔回滚。
- 新增上下文记录按 ID 读取、完整更新与稳定 ID 往返，章节总结支持按作品查询并以稳定规则返回每章最新记录。
- 新增旧 LocalStorage 章节总结、上下文记录和角色状态的幂等迁移；迁移结果返回 ID 映射与警告，已确认落库的缓存才会在提交后清理，歧义记录保持原样。
- 新增版本同步门禁 `npm run test:version-sync`，核对 npm、Cargo、Tauri、前端常量与当前版本文档；统一验证入口纳入 Node、Rust、静态补充检查、完整 Windows Tauri E2E 和生产构建。
- 新增章节上下文保存、真实应用重启、上下文过期及后续生成排除的桌面回归场景。

### 修改

- 桌面 Tauri 模式以 SQLite 为章节总结、上下文与角色状态的唯一事实源；IPC 失败直接向上传播，不再捕获后静默改写 LocalStorage。浏览器开发模式继续使用 LocalStorage，并在多步保存失败时执行补偿回滚。
- 总结确认流程改为一次提交完整上下文 bundle；只有事务成功后界面才报告保存完成，必需的上下文、角色状态或章节终态写入失败不再被忽略。
- 上下文过期与编辑操作改为持久化更新；后续生成仅读取 SQLite 中仍有效的记录，重启应用后保持相同选择结果。
- 发布检查从 `package.json` 读取目标版本并严格验证用户可见“当前版本”；工作树存在未提交修改时，项目验证和发布建议均以非零状态阻断。

### 修复

- 修复 Rust 创建上下文时丢弃调用方 ID，导致 LocalStorage 镜像 ID 与 SQLite ID 分裂、后续更新无法稳定命中的问题。
- 修复桌面端上下文 `update`、章节总结按作品查询和部分角色状态操作只修改 LocalStorage，应用重启后数据回退或丢失的问题。
- 修复 Tauri 调用失败后静默降级到 LocalStorage，使界面显示成功但正式 SQLite 未提交的假成功路径。
- 修复总结、上下文、角色状态与章节 `summarized` 状态分步写入且吞掉异常，任一步失败可留下半完成章节的问题。
- 修复旧双写数据重复迁移可能制造副本或误删无法确定映射的数据；迁移现在优先精确 ID，再使用确定性匹配，歧义只告警不删除。
- 修复采用新正文后必须等待总结面板打开才会使旧上下文过期的问题；正文指针切换、章节状态更新、总结与关联上下文过期现在属于同一 SQLite 事务，重采同一正文保持幂等。
- 修复旧角色状态迁移完成后 `characters.current_state` 仍可能停留在旧值的问题；迁移事务按 `created_at DESC, id DESC` 重算当前状态，幂等重跑也会完成修复。
- 修复上下文启停、删除、新增及总结启用状态在 SQLite IPC 失败时产生未处理 Promise rejection 的问题；界面现在保留原状态并显示明确错误。
- 修复存在较新但未采用的草稿时，章节总结会错误读取该草稿并在消耗一次 AI 调用后才被保存事务拒绝的问题；生成与过期判断现在都只使用当前采用稿，读取失败会在调用 AI 前直接提示。
- 修复章节总结、上下文和角色状态列表收到无效 IPC 返回值时静默伪装为空列表的问题，并让目标模块的浏览器 LocalStorage 写入失败真实向上传播。

### 版本边界

- 应用版本统一更新为 `2.1.8`；本版本不新增、删除、重命名或改变 SQLite 表字段类型，沿用现有表完成事务与迁移。
- 本版本只收敛章节总结、上下文和角色状态的持久化一致性，不增加自动续跑、Planner、Memory、v2.2 / v2.3 功能或 Agent 自主写入。

## v2.1.7 (2026-07-22) - 章节质量历史不可变快照与原子重放

### 新增

- 新增质量检查历史列表与按报告 ID 回放命令；质检面板可选择历次报告，历史模式明确只读。
- 新增 `quality_issue_states`，将可变的当前问题处理状态与不可变历史快照分离；`quality_check_items.sort_order` 保证同一报告内的稳定次序。
- 新增质量原子性、快照不可变、迟到竞态、重复 issue key、AI Task 归属、历史只读、批量状态回滚和 migration 幂等 Rust 回归。
- 新增前端 LocalStorage 快照与竞态动态测试，以及真实 Windows Tauri `quality-history-replay.spec.ts`；桌面场景通过 DOM 修改最新问题状态并在重启后证明历史快照不变，完整套件增至 10 个独立 spec。

### 修改

- 报告完成、全部问题快照、当前状态更新和 read-back 改为同一 SQLite `IMMEDIATE` 事务；第 N 条写入失败时整笔回滚。
- 复检命中同一 `issue_key` 时始终创建新 item，不再改写或迁移旧 item 的 `report_id`；历史快照的成员、字段和状态保持不变。
- 默认查询仅选择最新 `completed` 报告；较新的 pending / failed 报告不再遮挡最近完整结果。
- 新报告必须绑定归属匹配、类型为 `quality_check` 且已 `succeeded` 的 AI Task；Task 记录创建失败时不再继续调用 Provider 或保存无法追溯的报告。
- 完整项目备份协议升级为 `schemaVersion: 3`，包含质量问题处理状态；继续兼容 schema 2，并在恢复事务内从最新旧问题合成状态。

### 修复

- 修复保存报告时先写 `completed`、再逐条写问题，中途失败会留下“已完成报告 + 部分问题”的真实数据不一致缺陷。
- 修复复检时把旧问题改挂到新报告，导致旧报告成员丢失、无法稳定重放的缺陷。
- 修复旧 pending 报告迟到完成后可把较新报告已 resolved 的同 key 问题重置为 pending，以及较新但未完成的报告错误阻止当前完整报告刷新工作流状态的竞态。
- 修复省略 `aiTaskId` 可绕过 Task 归属与成功状态校验，以及 schema 2 备份恢复后质量状态取决于是否重启的问题。
- 修复浏览器 LocalStorage 回退更新当前处理状态时仍直接改写历史问题 item，导致历史回放显示后改状态而非生成时快照的问题；回退层现在也使用独立状态集合，旧数据按 item 最后更新时间合成，并纳入项目补充缓存备份。
- 修复 LocalStorage 已完成报告的幂等保存未校验原 AI Task，且最新报告重试错误返回原始状态的问题；现在同 Task 的最新重试叠加当前状态，旧报告重试保持原始快照，Task 不同则拒绝。
- 修复单删、批量删除或清空 AI Task 时会把 completed 质量报告的 `ai_task_id` 置空、永久破坏追溯的问题；被完整报告引用的 Task 现在受保护，混合批次与清空操作会在任何写入前整体拒绝。
- 修复前端完整备份校验会接受 `2.5` 等非整数 `schemaVersion`，随后才被 Rust `u32` 反序列化拒绝的问题；前端现在与 Rust 共同只接受受支持的整数版本。
- 修复 schema 2 多报告恢复时按全表累计补 `sort_order`，导致第二份报告从前一报告末尾继续编号的问题；缺失次序现在按 `report_id` 分组从 0 稳定生成。
- 修复质量检查或 AI 修稿完成后等待历史列表期间快速切换章节，旧章节的迟到列表会覆盖新章节历史选择的问题；两条异步刷新路径现在都在 Promise 返回后复核实时作品与章节目标。
- 修复桌面 E2E 在结构化写出诊断 JSON 后又按整文件文本正则脱敏，可能破坏引号和 Windows 路径转义、且最终改写发生在健康校验之后的问题；JSON 产物现在统一解析、递归脱敏并重新序列化，异常产物会安全替换并令场景失败。

### 版本边界

- 应用版本统一更新为 `2.1.7`；使用启动时幂等 schema 补齐，不改写已发布 migration 文件。
- 本版本只收敛章节质量历史、问题工作流状态和完整备份对应数据。不增加自动续跑、Planner、Memory、通用 AI 取消或 Agent 自主写入。

## v2.1.6 (2026-07-21) - 章节工程真实 AI 请求取消闭环

### 新增

- 新增可选 `requestId` 与 Rust `cancel_ai_request` IPC；章节工程正文生成和质量检查现在可以从 UI 取消一路传递到真实桌面 HTTP future。
- 新增有界活动请求注册表：最多 64 个活动请求，提前取消与近期完成 ID 各最多 128 个并使用 30 秒 TTL；注册 token、两阶段 abort attach 和 RAII 清理共同处理立即取消、重复 ID、迟到取消及 command future 被丢弃。
- 新增统一 `AbortSignal` 契约和稳定取消码 `AI_REQUEST_CANCELLED`；浏览器 fetch 能区分用户取消与请求超时，Mock pause gate 和响应延迟也可立即中断并移除 waiter。
- 新增 10 个 Rust AI 回归测试、9 个前端取消 / 脱敏测试和真实 Windows Tauri `generation-job-cancel.spec.ts`；完整桌面套件增至 9 个独立 spec，取消 spec 同时覆盖正文与质量请求。

### 修改

- 桌面 AI 调用从 `reqwest::blocking::Client` 改为异步 `reqwest::Client`，保留原超时和 OpenAI-compatible 响应契约，不新增 Tokio 直接依赖或其他大型依赖。
- `generationJobService` 按 job 持有 `AbortController`，为正文与质量请求分配不同的无业务内容 ID；取消等待当前 AI 调用收到后端中止确认或安全结算后，再沿用现有 SQLite 原子终态与唯一 checkpoint。
- 质量检查取消时，其旧 `ai_task_record` 结算为 `cancelled`；success / failed / cancelled 更新只允许从非终态进入，迟到回调不能复活终态。
- 质量报告改为 AI 成功返回后再创建，避免取消在途质量请求遗留永久 `pending` 报告；一旦草稿或报告已经提交，取消不会回滚这些既成事实。
- Rust 与浏览器 AI 错误不再携带 URL、底层 reqwest 原文、provider body 或无效响应正文，降低敏感信息进入诊断日志的风险。

### 修复

- 修复点击“取消任务”只修改 `generation_jobs`，却无法停止最长可继续等待 1800 秒的真实 HTTP 请求；请求可能继续占用连接、产生费用并触发迟到回调。
- 修复 Mock AI 暂停请求取消后仍滞留 waiter，必须 release 或结束进程才能释放的问题。
- 修复浏览器端把用户主动取消统一误报为超时，以及质量检查取消被旧任务记录成普通失败的问题。
- 修复取消 IPC 尚未确认或调用失败时前端仍立即报告成功的问题；IPC 失败会输出无敏感内容的诊断，并等待原请求结算，避免后台请求继续运行却提前提交取消终态。
- 修复浏览器收到 `2xx` 非法 JSON 时解析异常可能夹带 provider 正文片段的问题。

### 版本边界

- 应用版本统一更新为 `2.1.6`；既有 migration 与正式数据库结构不修改。
- 本版本只覆盖章节工程 `generation_jobs` 的正文生成和质量检查请求。旧 AI 面板、其他独立 AI 工具、流式输出、质量历史重放和 Agent 自主续跑仍不在本版本范围。

## v2.1.5 (2026-07-21) - 章节工程任务跨重启恢复闭环

### 新增

- 新增 `recover_interrupted_generation_jobs` 启动恢复命令：在一个 SQLite 事务中把遗留 `pending`、`running`、`retrying` 章节工程任务结算为 `failed`，写入稳定错误码 `APP_RESTART_INTERRUPTED` 并追加失败 checkpoint。
- 新增启动恢复对话框 `recovery-dialog`，明确显示安全结算数量，并告知已完成步骤和草稿已保留、没有自动重发 AI 请求。
- 新增仅限 E2E 构建的 Mock AI pause gate，以及真实 Windows Tauri `restart-task-recovery.spec.ts`，用于稳定制造在途任务并验证真实进程重启后的恢复与二次启动幂等。
- 新增 5 个 Rust 回归测试，覆盖启动恢复的原子性、回滚、幂等、终态不可复活、进度单调、取消竞态、step ID 不可覆盖及稳定排序。

### 修改

- 生成任务更新现在校验合法状态迁移和 `0..100` 单调进度；终态任务不可再被迟到回调改写。
- 生成 step 使用普通 `INSERT` 保持 ID 不可变，读取按 `created_at` 与 `id` 确定性排序；工程面板读取同名 patch 时选择最新结果。
- 章节工程面板根据 SQLite 中最新任务的持久化状态禁用新建任务，不再只依赖组件内存布尔值；恢复失败原因和步骤提供稳定 `data-testid`。
- 任务 runner 在异步 action 后及最终完成前重新读取取消状态；若恢复或取消已经写入终态，迟到回调只接受持久化结果。
- step 保存会在同一 SQLite 事务内检查父任务状态；取消操作在一个事务中同时写入 `cancelled` 终态与唯一取消 checkpoint，迟到成功结果不能再污染终态任务。

### 修复

- 修复应用退出后章节工程任务永久停留在 `pending`、`running` 或 `retrying`，重新进入页面后既无法确认结果又可能重复启动的问题。
- 修复取消后的迟到 AI 回调仍可把任务覆盖成 `completed`，以及进度可倒退的问题。
- 修复 `INSERT OR REPLACE` 可让重复 step ID 覆盖 checkpoint、同毫秒 step 顺序不稳定，以及 UI 选择最旧 patch 结果的问题。
- 修复 Tauri camelCase step DTO 中 `inputSnapshotJson` / `outputJson` 未反序列化，导致输入快照丢失和 patch 计数显示为 0 的问题。
- 修复上下文快照 Rust DTO 已成功保存，却因前端漏读 `compiledContextJson` / `sourcesJson` 而把章节工程任务误判为失败的问题。

### 版本边界

- 应用版本统一更新为 `2.1.5`；既有 migration 不修改，现有 `generation_jobs` 与 `generation_step_results` 字段足以完成安全结算。
- 本版本只覆盖章节工程 `generation_jobs`。恢复不会自动重放步骤、重发 AI 请求、采用草稿或覆盖正文；旧 `ai_task_records`、真实 HTTP 取消、质量历史重放和 Agent 自主续跑仍不在本版本范围。

## v2.1.4 (2026-07-21) - 大文本正文安全闭环

### 新增

- 新增章节草稿专用的大文本原子提交命令：缓存全文通过强校验后，在同一个 SQLite 事务中写入 `large_text_documents`、全部 chunks 和草稿创建 / 更新引用；任一步失败整笔回滚。
- 新增整文与逐片完整性验证：强制检查 SHA-256、片数、连续索引、字符数、UTF-8 字节数和最终拼接全文元数据；任一不匹配都拒绝写入或读取。
- 新增工作台正文失败关闭状态：目标章节完整正文校验成功后才切换；失败时保留原安全章节和编辑内容，显示可重试的 `error-notice`，并阻止目标正文的编辑、保存、采用和 AI 应用。
- 新增 11 个 Rust 大文本事务、完整性、生命周期与采用前复验测试，以及 3 个编辑器内容解析测试。
- 新增真实 Windows Tauri `large-text-save.spec.ts`：用 184KB、71,681 个 Unicode 字符的固定中文 / emoji / CRLF 正文验证保存、离开、重开、采用和逐值一致性；损坏一个隔离测试库分片后验证预览不会覆盖安全正文。
- 新增仅限 Cargo `e2e` feature 与隔离运行标志同时开启时可用的大文本只读状态探针和确定性损坏注入；相关命令通过编译期门控，不进入普通生产产物。

### 修改

- 前端分片上传与数据库 finalize 解耦并显式返回 session ID；所有结构体 Tauri IPC 统一使用 `{ input }`，字符统计与分片边界使用 Unicode scalar，整文及每片 SHA-256 均为必填。
- 所有带 `largeTextRefId` 的草稿列表、最新稿、创建、更新和采用结果都必须水合完整正文；读取失败直接向上返回，不再吞错或退回 500 字预览。
- 大文本更新使用完整正文计算字数，SQLite `content` 仅保存 500 字预览；大文本转小文本、连续更新和删除草稿会在事务内清理不再被引用的旧文档及级联分片。
- 数据库已经提交后，缓存清理失败只作为 `cleanupWarning` 返回，不再把已提交操作报告为可盲目重试的保存失败。
- E2E 运行器默认为每轮 suite 自动选择一组可用的 driver / native driver 端口；显式 `AI_NOVEL_STUDIO_E2E_DRIVER_PORT` 仍可覆盖，并会校验完整端口区间。

### 修复

- 修复大文本 Tauri struct command 参数被前端平铺，导致超过阈值的真实桌面保存报缺少 `input`、实际无法使用的问题。
- 修复整文 SHA-256 不匹配只记录 warning 仍继续提交，以及读取时不校验分片顺序、数量、元数据和 hash 的完整性缺陷。
- 修复完整正文读取失败后把 500 字预览装入编辑器，用户再次保存可能截断覆盖原文的问题。
- 修复大文本文档 / chunks 先提交、草稿引用后写入造成的孤儿数据，以及更新 / 删除草稿持续泄漏旧大文本文档的问题。
- 修复大文本草稿采用后的章节字数只按预览计算，以及缓存 session ID 未限制为 UUID 便参与路径拼接的问题。
- 修复候选采用测试偶然依赖上一次生成 Toast 尚未消失的问题；采用成功现在发出独立、稳定的成功提示。
- 修复连续执行桌面 E2E 时固定 `4444/5444` 端口可能仍被上一轮占用，导致 smoke 创建驱动会话失败的问题。

### 版本边界

- 应用版本统一更新为 `2.1.4`；既有 migration 不修改，现有大文本表已足以完成本版本事务与生命周期闭环。
- 本版本只收敛章节草稿正文，不扩展任务跨重启恢复、真实网络取消、质量历史重放、通用自动放置或 Agent 自主写入。

## v2.1.3 (2026-07-21) - Windows 真实桌面 E2E 与稳定性

### 新增

- 新增 WebdriverIO + `tauri-driver` + EdgeDriver 的 Windows 真实 Tauri E2E，首批覆盖应用启动、作品创建与打开、作品信息保存、卷章与正文保存、Mock AI 候选审查采用、未保存离开保护。
- 新增 `npm run test:e2e:smoke` 和 `npm run test:e2e`；每个 suite 在独立 `.e2e-tools/target` 中构建一次带 Cargo `e2e` feature 的 Tauri 应用，每个 spec 再独立启动窗口，并使用独立临时 SQLite、WebView2 用户目录、单实例状态目录和 driver 端口，不读取或修改正式用户数据库。
- 为关键业务节点增加克制的 `data-testid` 契约，并在 E2E 专用构建中把原生确认流程映射为可由 WebDriver 访问的 DOM 对话框。
- 新增仅限 E2E 构建的前端诊断桥和 Rust `get_e2e_diagnostics`，只允许数据库健康检查与必要只读查询；业务写入仍经过真实 React、Tauri IPC、Rust command 和 SQLite 事务。
- 新增失败诊断：当前路由、前端 console / 未处理异常、WebdriverIO / Tauri Driver / Rust 日志、测试数据库位置和进程清理结果；失败时在 WebDriver 会话仍可访问的前提下尽力保存 DOM 与截图，截图不参与定位或断言。
- 新增始终写出的 `frontend-diagnostics.json`，记录脱敏后的路由、DOM 摘要、console、未处理异常、Rust 诊断和 WebView 网络尝试摘要；运行器独立复核该文件，缺失、解析失败、console error、未处理异常、guard 未安装或网络尝试非零都会使 spec 失败。
- 新增作品提交只读探针：用独立 `SQLITE_OPEN_READ_ONLY | SQLITE_OPEN_NO_MUTEX` 连接读取作品行数、标题和更新时间，证明保存事务已对其他连接可见并验证没有重复写入。
- 新增 [Windows 桌面 E2E 自动化文档](docs/technical/desktop-e2e.md)，记录审计基线、Windows 前置条件、隔离与网络阻断、命令、失败产物和 stale executable 排障。
- 新增 Windows GitHub Actions 门禁：Pull Request 与 `main` 推送运行桌面 smoke，定时任务、版本 tag 和手动完整模式运行六条真实桌面流程；失败时上传脱敏诊断产物。

### 修改

- E2E 可执行文件必须同时满足 Cargo `e2e` feature 与 `AI_NOVEL_STUDIO_E2E=1`，每个 spec 还必须通过随机 run-id 与临时目录 marker 握手；Rust 会规范化路径、拒绝正式数据目录，并用 SQLite `PRAGMA database_list` 复核实际打开的数据库。
- E2E 模式隔离 SQLite、WebView2、单实例锁与窗口状态；成功后清理临时数据，失败时保留复盘目录。进程快照、残留进程或临时目录清理无法可靠完成时，运行器会 fail-closed 并停止后续 spec。
- AI 设置在 E2E 构建中强制返回本地 Mock Provider；WebView 在 `App` 加载前安装 guard，在请求发出前拦截外部 fetch / XHR / WebSocket / EventSource / beacon，Rust AI IPC 再在创建或发送 HTTP 请求前硬阻断真实 Provider。该机制不是操作系统级防火墙；当前应用没有自动更新器，测试运行不依赖互联网。
- 固定 fixtures 和显式 spec 清单让每个场景从自己的空库经 UI 建立确定性数据，不依赖执行顺序；新增 `npm run test:e2e -- --spec <name>` 定向运行入口。
- E2E 运行器只按本轮 WebdriverIO 进程树、唯一 staged `ai-novel-studio-e2e.exe` 和隔离数据 / WebView2 路径识别并清理归属进程，不按通用进程名终止用户已有进程；超时、清理不可验证或残留 PID 都会使测试失败。

### 修复

- 修复 `create_novel` / `update_novel` 持有全局 SQLite Mutex 后递归调用再次加锁的查询命令，导致作品创建或保存 IPC 永久挂起的问题。命令现在复用已持有的连接完成 read-back，并由 300 ms Rust 超时回归测试和真实桌面保存流程覆盖。
- 修复 Windows 系统强调色 IPC 同步等待 `reg query` 时可能阻塞 Tauri command 的问题：生产路径改为后台阻塞任务并以 750 ms 为硬上限，超时会终止子进程；E2E 模式直接跳过注册表查询，避免污染测试进程与时序。
- 修复 Windows 运行器通过 `npm.cmd` 启动产生 `EINVAL` 的问题，改为由当前 Node 进程直接启动 Tauri CLI / WebdriverIO 入口。
- 默认在 `.e2e-tools/target/release` 中从 Cargo 包名与 Tauri `productName` 两种候选里选择最新产物，创建本轮唯一 staged 应用副本并校验文件大小 / 副本时间，避免覆盖生产 target 或误启旧 bundle EXE；同时补充 `AI_NOVEL_STUDIO_E2E_SKIP_BUILD=1` 与 stale executable 排障说明。
- 修复 Rust 草稿计字把部分标点计入字数、与编辑器“每个中日韩字符 + 每个连续 ASCII 字母数字词”语义不一致的问题，并增加中英文、Markdown 分隔符和纯标点回归测试。
- 修复健康门禁暴露的风格与上下文 IPC 错误：为旧 `style_profiles` 表幂等迁移 `description` 列并保留空库内建风格，使 `list_style_profiles` 接受可选项目参数，并把 `save_context_read_log` 调用按 Rust DTO 正确包装为 `{ input }`。
- 修复首次 GitHub Windows 运行暴露的驱动校验错误：`tauri-driver 0.1.5` 不支持 `--version`，现改为读取 Cargo 安装清单并兼容 Windows CRLF，避免把成功安装误判为失败。
- 修复候选采用 E2E 在 Windows checkout 下把 SQLite CRLF 与 HTML textarea 标准化 LF 误判为正文差异的问题；断言现只统一换行编码，其他字符差异仍会失败。

### 版本说明

- 应用版本统一更新为 `2.1.3`；既有 `v2.1.2` tag 保持指向完整备份与恢复版本，不移动、不覆盖。
- 产品当前没有崩溃恢复对话框，因此不伪造 `recovery-dialog`；安装程序、原生文件选择器、托盘、Windows 通知、多显示器和视觉识别也不在首批范围。
- 当前产品没有名为 `Artifact`、`PlacementProposal` 或 `ApplyPlan` 的持久化实体；候选采用测试覆盖现有草稿、AI 任务、目标与基础正文绑定、采用状态、页面字数同步和重复采用幂等，不把等价约束描述成不存在的实体状态。
- 本版本不扩展 AI 自动写入范围，不修改既有 migration，只发布桌面 E2E 基础设施及真实测试暴露的稳定性修复。

## v2.1.2 (2026-07-20) - 完整备份与恢复闭环

### 新增

- 新增版本化项目备份协议（`schemaVersion: 2`），覆盖 SQLite 中归属作品的卷、章、全部草稿、角色、事件、上下文、大纲版本、工程状态、生成与质量记录，以及大文本分片。
- 新增 SQLite 单事务恢复：导入始终创建新作品并重写关联 ID，恢复过程出现任意错误时整笔事务回滚，不覆盖现有作品。
- 新增大文本分片数量、顺序与 SHA-256 校验，以及外键一致性校验。
- 将仍由项目使用的浏览器本地缓存作为补充项目数据打包；其恢复失败时，前端会撤销刚导入的 SQLite 作品。
- 新增 `npm run test:project-backup`：在同一临时 SQLite 项目库执行“导出 -> 清空临时项目库 -> 导入 -> 按重写后的 ID 全量比对”，并验证无效备份不会留下部分写入。

### 修改

- “完整 JSON”导出改为桌面 SQLite 的完整项目备份；应用级设置、API Key 和本机文件路径不会写入备份。
- JSON 导入会区分完整备份与旧版项目 JSON；旧版文件仅恢复基础作品资料，并明确提示不能作为灾备。
- 项目验证、文档同步和发布检查脚本改为从 `package.json` 读取当前版本，不再硬编码旧版本号。
- 应用版本统一更新为 `v2.1.2`。

### 版本边界

- 完整备份与恢复仅在桌面 SQLite 环境提供；浏览器开发模式不会将 JSON 声明为灾备。
- SQLite 与 LocalStorage 仍是两个存储层。补充缓存已经纳入备份，恢复失败会由前端补偿撤销导入作品；这不是跨存储 ACID 事务，单一事实源迁移留待后续数据可靠性版本。
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

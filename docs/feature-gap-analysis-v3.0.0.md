# AI Novel Studio v3.0.0 功能不足与演进优先级分析

> 审计日期：2026-07-28
> 审计基线：`v3.0.0` 当前工作树、React 18 + TypeScript + Tauri 1.x + Rust + SQLite
> 文档性质：现状审计与后续版本建议，不代表对应功能已经进入开发或发布承诺。

---

## 1. 审计方法与结论口径

本报告逐项检查 README、产品设计、数据模型、前端入口、AI 服务、Rust 命令、SQLite schema 与现有测试。证据优先级如下：

1. 当前可执行代码与数据库 schema；
2. 当前自动化测试和真实运行边界；
3. v3.0.0 架构、路线图和 README；
4. 历史审计与旧版本发布说明，仅用于解释演进过程。

状态定义：

- **缺失**：当前没有可执行入口、持久模型或完整协议。
- **部分具备**：已有相邻能力或专用流程，但没有覆盖报告所述完整场景。
- **基础版已实现**：用户已经能完成核心动作，后续缺口属于规模、自动化、来源追踪或质量增强。

优先级定义：

- **P0**：扩大长篇生成规模前应先完成的通用可靠性基础。
- **P1**：下一阶段直接提升长篇创作效率或连续性的核心能力。
- **P2**：重要增强；应建立在 P0/P1 的统一协议与数据基础之上。

---

## 2. 执行摘要

原始功能不足清单的方向基本成立，但八项现状描述已经落后于当前代码：

1. **参考资料与自动风格画像已形成代码闭环**：migration 025 提供独立 TXT 版本库、分页章节 metadata 和来源追踪；六层长文本采样只保存抽象画像、范围、hash 与置信度。
2. **跨进程全书调度与三档策略已经实现**：migration 027 以 SQLite 保存 run、lease、attempt 和 append-only checkpoint，支持 `draft_night / quality_gate / full_auto`、重启恢复、预算、时间窗、重试与熔断；桌面入口会在启动时幂等接管可恢复 run，不依赖进入规划页，应用完全退出后的系统后台常驻仍是后续增强。
3. **可靠取消已覆盖当前生产 AI 入口**：生产 `client.generate` 调用点已统一接受并传递 `AiGenerateOptions`；旧独立面板也具备停止/卸载 owner 与迟到结果隔离。任务中心 owner 仍是当前前端进程内事实，不等于跨进程 lease。
4. **“只有 SQLite 简单全文检索”不准确**：migration 026 已提供 FTS5 / substring、结构化过滤与显式真实向量余弦重排，并记录检索模式、评分原因与 Token 预算；缺口已转为自动 embedding、召回评估和全书分析 UI。
5. **真实流式正文不再缺失**：浏览器与 Tauri 已解析 OpenAI-compatible SSE，并通过统一事件把正文 delta 送入临时预览；只有最终完整响应可以创建未采用草稿。
6. **成本计量与桌面全局请求治理已实现**：migration 029 以 SQLite 单例策略和 `IMMEDIATE` reservation 事务执行跨进程速率、并发、每日 Token / 成本硬预算；Rust Provider command 复验 request-bound lease 并只允许一次派发。Provider 账单导入与动态组织额度仍缺失。
7. **通用多目标事务基础已经实现**：migration 028 冻结有序目标集合和逐目标 base revision/hash，提供 `all_or_nothing / reviewed_partial`、SQLite CAS、失败回滚和幂等重放；当前跨章节批处理限定为安全的章节 metadata 字段。
8. **势力与地点已成为正式故事资产**：migration 028 建立势力、地点、关系、连接及角色/章节/事件关联九张表，Story Assets 页面通过预览事务创建资产，备份 schema 9 覆盖恢复与 ID 重映射；关系图、地图和时间线仍待增强。

| #   | 能力                | 经代码核实的状态             | 建议优先级     | 主要理由                                                  |
| --- | ------------------- | ---------------------------- | -------------- | --------------------------------------------------------- |
| 1   | 流式输出            | **正文基础版已实现**         | **P0/P1 收口** | 已有真实 SSE 与安全预览，仍需兼容降级和更广测试           |
| 2   | 参考小说导入        | **独立 TXT 版本库已实现**    | **P1 收口**    | 代码、动态测试与桌面门禁完成；EPUB/PDF 属于后续格式扩展   |
| 3   | 自动风格画像        | **六层长文本画像已实现**     | **P1 收口**    | 来源、采样范围、hash、置信度及安装包 / E2E 已完成         |
| 4   | 无人值守连续运行    | **跨进程基础版已实现**       | **P1 收口**    | SQLite scheduler 与三档策略已落地，系统后台常驻仍待增强   |
| 5   | 向量语义 Memory     | **SQLite 混合检索已实现**    | **P1 收口**    | 代码、动态测试与桌面门禁完成；自动 embedding 后续增强     |
| 6   | 跨章节智能检索/分析 | 检索后端已实现，分析 UI 缺失 | **P1/P2**      | 已有混合检索证据；角色 / 冲突 / 伏笔 / 节奏视图仍待建设   |
| 7   | 通用多目标放置      | **事务基础版已实现**         | **P2 收口**    | CAS、回滚与幂等重放已落地，正文级批处理仍待建设           |
| 8   | 全产品可靠取消      | **当前进程基础版已实现**     | **P0 收口**    | 生产入口已统一；跨进程 owner 属于后续 scheduler           |
| 9   | 独立势力库/地点库   | **正式实体基础版已实现**     | **P2 收口**    | 九张正式表与事务 UI 已落地，关系图、地图和迁移体验待增强  |
| 10  | AI usage / 成本计量 | **桌面全局硬门禁已实现**     | **P0 收口**    | migration 029 已统一跨进程额度；Provider 账单对账仍待增强 |

当前工作树已完成取消、真实流式事件、成本估算与桌面全局硬门禁、参考资料 / 分层风格、混合语义 Memory、跨进程 Autonomous Scheduler、通用多目标事务、章节 metadata 批处理和正式势力 / 地点资产的主要代码链路；独立 EXE、真实浏览器 E2E 与 14 套 Windows 桌面 E2E 已通过，MSI/NSIS 按当前验收顺序保留旧产物并延后刷新。下一步增强 Provider 兼容、系统后台常驻、正文级批处理、全书分析和资产可视化；签名 updater 继续由 release workflow 注入密钥生成。

---

## 3. 逐项分析

## 3.1 流式输出

### 结论校正：真实正文流与安全预览已经实现

当前工作树已经具备：

- `AiStreamEvent` 定义 `started / delta(sequence,text) / usage / completed / error`，`AiGenerateOptions` 可显式请求 `stream` 并注册观察器。
- 浏览器开发路径使用 `ReadableStream` 和增量 UTF-8/SSE decoder；Tauri 路径由 Rust 逐 chunk 解析 SSE，再按 `requestId` 发出有序 `ai-stream-event`。
- 两条路径均聚合并返回最终 `AiGenerateResponse`，Provider usage 和 finish reason 保持在最终响应中；观察器异常与传输生命周期隔离。
- `AiGeneratePanel` 和章节工程正文生成已请求真实 streaming。写作工作台只把 delta 放入“实时候选预览”缓冲；最终响应完整返回并再次检查取消后，才通过既有原子草稿协议保存未采用候选。
- 无完成标记的 EOF、非法 UTF-8/JSON、非字符串 delta、输出 Token 截断和空最终正文均失败关闭；取消后部分预览不会成为权威草稿。

证据：

- `src/types/ai.ts`
- `src/services/ai/aiStreamProtocol.ts`
- `src/services/ai/realAiClient.ts`
- `src-tauri/src/ai.rs`
- `src/components/right-dock/panels/AiGeneratePanel.tsx`
- `src/services/generation/generationJobService.ts`
- `src/services/ai/aiCancellation.test.ts`
- `docs/technical/testing.md`

浏览器内存流和 Rust loopback 动态测试已经覆盖跨 chunk 多字节字符、有序 delta、usage、精确聚合和无标记 EOF；Windows release 的受控真实 Provider 验收还证明了预览先增长、最终草稿后提交且旧采用稿不被覆盖。

### 尚待收口

- 当前没有 Provider capability negotiation。调用方请求 streaming 而兼容端点不支持 SSE 时会明确失败，不会自动重派发非流式请求；因此不能宣称已经具备透明降级。
- 可见预览优先覆盖正文生成。结构化 JSON Agent 仍可在完整响应后整体解析，尚无通用的逐工具/逐推理阶段 UI。
- stream event 当前是瞬时进程内事件，不是可跨重启恢复的 append-only 持久事实；也没有 Provider resume token 协议。
- 自动化证明集中在浏览器协议、Rust loopback 和取消边界；真实 Provider 是手动证据，逐 Provider 兼容矩阵和完整 UI 自动化仍需补齐。

### 后续验收门禁

- 对明确不支持 streaming 的 Provider，必须由能力探测或受控策略选择非流式路径，而不是在收到部分响应后盲目重试。
- sequence 重复、乱序、跨 requestId 和取消后的迟到事件不得重复正文或写入错误章节。
- streaming 与非 streaming 必须共用相同的最终完整性、费用、取消和草稿原子提交语义。
- 继续保持推理内容不进入正文预览，缺 resume token 时不伪装成无缝续传。

---

## 3.2 参考小说导入

### 当前实现状态：TXT 阶段已完成

- migration 025 已建立独立 `reference_works / reference_imports / reference_sections`，与作品卷章树严格分离。
- TXT 导入记录原始字节 hash、解码正文 hash、编码来源、解析器/章节计划版本、码点数和 UTF-16 来源区间。
- 重复 hash 必须由用户显式选择跳过、新建参考作品或创建新版本；版本切换使用 revision CAS，旧版本继续保留。
- SQLite、浏览器 LocalStorage、项目备份 schema 9（含 schema 7 Memory 基线、schema 8 Scheduler 与 schema 9 故事资产）、ID 重映射、机器路径清理和篡改失败关闭已经形成闭环。
- EPUB、PDF、Markdown 与 DOCX 文本提取仍属于后续格式扩展。

证据：

- `src/services/references/referenceTextParser.ts`
- `src/services/references/referenceLibraryService.ts`
- `src/components/references/ReferenceImportCard.tsx`
- `src-tauri/src/services/reference_library_service.rs`

### 后续格式扩展

**第一阶段：TXT 参考资料库（已完成）**

- 新增 `reference_works / reference_sections / reference_imports`。
- 导入时保存来源文件 hash、编码、章节边界、字符数、用户定义用途和导入时间。
- 参考资料与当前作品章节严格分开；导入不会污染卷章树或正式上下文。
- 支持 UTF-8、UTF-16、GB18030 检测与用户纠正。

**第二阶段：EPUB**

- 读取 manifest/spine、章节标题与 XHTML 纯文本。
- 丢弃脚本、样式和导航噪声，保留章节顺序与来源定位。

**第三阶段：PDF**

- 先支持有文本层的 PDF；扫描 PDF 的 OCR 作为独立可选能力。
- 保存页码映射与提取质量警告，通过跨页重复模式清理页眉/页脚，不把低质量提取静默当作正文。

**第四阶段：常见写作资料**

- Markdown 保留标题层级、列表和来源行区间，过滤无关 front matter 时必须保留原始 hash。
- DOCX 解析标题样式、段落、分页与批注边界；表格、文本框或损坏关系无法提取时给出明确覆盖率警告。

### 风格与 Prompt 边界

- 全本原文先分段抽样、分析和归并成抽象画像。
- 正文生成默认只读取抽象风格画像，不把整本参考原文塞入 Prompt。
- 如允许有限示例，必须有字符预算、来源定位、用户开关和相似片段重复检测。
- 原始参考文本仅保存在本地项目数据中，并纳入删除、备份和隐私说明。

### 验收标准

- 同一文件重复导入可按 hash 识别，并允许用户选择跳过或创建新版本。
- 参考作品不会出现在当前小说卷章树，也不会被误采用为正文。
- 长篇参考文本按全书代表性采样，不固定只分析开头。
- 删除参考作品同时删除其分段与衍生分析；已保存风格画像保留明确的来源失效状态。
- EPUB 章节顺序稳定；PDF/OCR/DOCX 提取质量不足时向用户显示明确警告；任一片段都可回到章节、页码或文档段落来源。

---

## 3.3 自动风格画像分析

### 结论校正：分层版已经实现

当前用户已经可以：

- 在风格方案管理页粘贴参考文本并调用 AI 分析；
- 在写作工作台使用当前章节正文作为样本；
- 获得视角、语气、节奏、句式、对话/描写比例和风格摘要；
- 将结果保存为可供正文生成使用的风格方案。
- 对 20 万字以上资料按开篇、发展、对话密集、描写密集、高潮和收束进行确定性分层抽样；
- 保存 `sourceHash / model / promptVersion / sampleRanges / confidence`，并在来源切换或删除后标记 `outdated / missing`；
- 保证保存的画像 metadata 和正文 Prompt 只包含抽象画像，不包含参考资料原文。

证据：

- `src/services/references/layeredStyleAnalyzer.ts`
- `src/services/references/referenceStyleProfileService.ts`
- `src/services/styles/styleProfilePromptProjection.ts`
- `src/pages/StyleProfiles/StyleProfilesPage.tsx`
- `src/components/right-dock/panels/StylePanel.tsx`
- `prompts/style_analyze.md`

### 仍需补齐

- 多份参考作品的加权合并、画像差异比较与随章节变化的风格漂移分析。
- 冻结样本集上的画像稳定性 / 置信度校准，以及不同 Provider / 模型的回归阈值。
- EPUB / PDF 等新来源格式的章节定位与提取质量语义。

### 建议增强

1. 提供两份或多份画像比较、权重预览和“应用到当前小说”的显式确认。
2. 增加固定样本 / Prompt / 模型组合的稳定性评估，区分分析置信度与模型一致性。
3. 为 EPUB / PDF 保存章节 / 页码来源定位和提取质量警告，继续复用现有抽象画像边界。

### 验收标准

- 20 万字以上参考作品可通过分段归并生成稳定画像。
- 同一来源和同一分析版本重放结果具备确定身份，不重复产生匿名画像。
- 用户可看到采样范围、指标置信度和来源文件。
- 保存后的画像在正文 Prompt 编译结果中可追溯，参考原文不随画像整段进入 Prompt。

---

## 3.4 无人值守连续运行

### 结论校正：SQLite 权威调度与三档策略已经实现

migration 027 已把原先的进程内循环升级为可在应用重启后恢复、可由 lease 仲裁的持久调度：

- `autonomous_book_runs` 保存运行状态、冻结策略、每日/整书预算、时间窗、失败熔断和进度；
- `autonomous_run_leases` 保存 owner、单调 epoch、token hash、heartbeat 与过期状态，同一 run 同时只允许一个 active lease；
- `autonomous_run_attempts` 保存逐章 claim、候选草稿、评审、采用、分析确认、usage、成本和终态；
- `autonomous_run_checkpoints` 以 append-only 方式保存状态与决策，并对 canonical payload 计算 hash。

创建 run 时会冻结最大章节数、六专家质量阈值、每日/整书 Token 与 USD 预算、每章重试上限、连续失败上限和允许运行时段。claim、heartbeat、finish、pause、resume、stop 与恢复均使用 revision/CAS；相同 `operationId` 可重放并复验权威状态。

三档产品策略也已经接入工作台与 worker：

1. **`draft_night` / 夜间草稿**：连续生成候选并保留给人工审阅，不自动采用。
2. **`quality_gate` / 质量门禁**：最小成功专家数、平均分与接受率全部达标后仍只保存未采用候选，等待用户显式确认；未达标同样暂停复核。
3. **`full_auto` / 全自动**：质量、预算、目标归属与采用前正文复验全部通过后，才采用正文并确认章节分析、推进正式上下文。

应用启动时会把中断的 `running` run 收敛为 `queued`、active lease 收敛为 `expired`、claimed attempt 收敛为 `abandoned`；恢复命令每次都会返回全部持久 `queued` run，因此 Rust 初始化先执行恢复后，`main.tsx` 仍能在全局错误处理就绪后幂等调用 Scheduler Worker、获取新 lease/epoch 并接管队列。若重启发生在旧 lease 到期前，桌面 Worker 的 15 秒互斥恢复扫描会在 TTL 到期后完成接管。已持 lease 的 Worker 若在 claim 前异常，会先 heartbeat 复验 owner/epoch，再以 CAS 暂停 run 并释放 lease；已被 fencing 的旧 Worker 不改写替代 owner。规划页 Hook 仅刷新当前计划。旧 epoch 不会复活，也不会静默重放状态不明的 Provider 请求。

证据：

- `src-tauri/src/services/autonomous_scheduler_service.rs`
- `src-tauri/src/services/autonomous_scheduler_service_tests.rs`
- `src/services/autonomous-creation/autonomousSchedulerService.ts`
- `src/services/autonomous-creation/autonomousSchedulerWorker.ts`
- `src/pages/AutonomousPlanning/AutonomousSchedulerControls.tsx`
- `docs/data-model.md` 的 migration 027

### 已验证门禁

- 两个连接竞争同一 run 时只有一个 owner 获得有效 lease，过期恢复会提升 epoch。
- 夜间草稿和质量门禁都停在 `candidate_ready`；只有全自动模式可在全部冻结门禁通过后采用并确认，采用稿身份和章节分析在完成前再次复验。
- 日/整书预算、运行时段、每章重试和连续失败熔断会在派发边界阻断后续工作并保存状态。
- 提交状态未知时可用相同 operation 重放；run 状态变化和 attempt 终结保持 CAS 与幂等。
- 用户可显式暂停、继续和停止；默认模式仍是保留人工审核的 `draft_night`。

### 当前边界与剩余增强

- 当前 worker 随桌面应用进程运行；应用完全退出后不会作为 Windows 服务或托盘守护进程继续调用 Provider。系统托盘常驻、Windows 定时唤醒、锁屏/睡眠恢复、网络断开退避和凭据解锁生命周期仍需单独设计。
- migration 027 负责单个 run 的跨进程 owner、恢复和冻结预算；migration 029 另在所有真实 Provider 派发前执行应用级跨进程额度仲裁。Scheduler 请求必须同时通过两层约束，run 预算不能放宽全局策略。
- Windows 通知、失败摘要、次日审核队列、远程 Provider 账单对账和跨设备接管仍属运营增强。
- Rust 与前端动态测试已覆盖 lease、恢复、三档决策、预算和幂等；安装包内的强制退出/重启、双进程竞争和长时间夜间运行仍应继续纳入桌面 E2E 与耐久性基准。

---

## 3.5 混合语义 Memory

### 当前实现状态：SQLite 权威混合检索已完成

当前工作树已新增 migration 026，并形成以下正式事实：

```text
memory_documents
  id, novel_id, source_type, source_id, source_version/hash,
  adopted_draft_id, status, created_at, invalidated_at

memory_chunks
  id, document_id, chapter_number, ordinal, text/large_text_ref,
  token_count, importance, temporal_start/end, metadata_json, content_hash

memory_embeddings
  chunk_id, provider/model, dimension, vector_blob,
  embedding_hash, created_at

memory_retrieval_logs
  request_id, query_hash, filters, selected_chunk_ids,
  scores, budget, created_at
```

实现边界：

- 只接受 `adopted_draft / chapter_summary / context_record` 三类、带版本与 SHA-256 的来源；采用稿变化时，旧 Memory 与正文采用在同一事务内失效。
- FTS5 可用时优先建立 trigram/unicode61 派生索引；短中文或缺少 FTS5 时继续使用受小说作用域约束的 substring/结构化候选。
- embedding 必须由调用方显式传入真实有限非零向量；Rust 绑定 provider/model/dimension 和 chunk hash，不生成伪向量。
- Rust 对最多 500 个候选计算余弦并综合 semantic、lexical、importance、recency；结果返回 `matchedBy` 与逐项评分原因。
- `topK / candidateLimit / page / tokenBudget` 均有硬上限，选中证据总 Token 不超过预算；每次检索写入安全日志。
- 项目备份 schema 9 覆盖四张 Memory 表、ID 重映射、向量 hash/norm/model dimension 与 retrieval log 引用校验，并继续携带 schema 8 Scheduler 与 schema 9 故事资产；schema 2～6 兼容为空集合。

动态证据：TypeScript facade 校验、5 个 Rust Memory 服务测试、采用稿事务成功/回滚测试、迁移测试与完整备份往返测试均已通过。

仍属后续增强：自动 embedding Provider、采用新正文后的增量向量化、模型/维度更换后的可恢复重建、冻结召回评估集、准确率/遗漏率与覆盖率分析、HNSW/SQLite vector 扩展和全书分析 UI；这些增强不得改变当前“无向量则明确降级、SQLite 为权威、旧采用稿失效”的契约。

---

## 3.6 跨章节智能检索与全书分析

### 已确认现状

- 章节摘要、上下文、人物状态和 `chapter_characters` 可支持部分确定性统计。
- Autonomous 计划包含冲突线、人物节点和逐章节奏值。
- 章节工程已有单章情绪曲线字段，章节总结已有伏笔字段。
- 当前已有小说作用域内的 FTS / substring、显式向量余弦与结构化过滤后端，但没有全书检索中心、角色出场与长期消失提醒、关系变化图、冲突 / 伏笔生命周期、视角分布、设定/时间线矛盾、全书质量趋势、剧情线章节集合或节奏热力图页面。

### 建议先后顺序

**先做无需向量的确定性分析：**

- 角色出场次数、连续缺席章数、视角占比和人物关系变化次数；
- 冲突线首次出现、升级、高潮和解决章节；
- 伏笔新增/回收清单、存续章数和逾期提醒；
- 计划 tension 与实际章节质量/情绪指标对照；
- 章节字数、对话比例、质量分和修订次数热力图。

**再把既有混合检索接入分析体验：**

- 自然语言检索相似事件、人物行为和世界规则；
- 重复桥段检测；
- 基于证据的矛盾候选，而非无来源的模型判断。

### UI 建议

维持桌面写作软件风格，在作品详情新增“全书分析”入口：

- 左侧筛选人物/冲突/伏笔/卷；
- 中间时间线、关系图或热力图；
- 右侧证据章节与跳转工作台操作；
- 点击任何统计结果都能回到具体章节和采用稿。

### 验收标准

- 所有统计只读取权威采用稿与有效上下文。
- 缺失章节分析时显示覆盖率，不把缺数据当作零事件。
- 伏笔生命周期和冲突线可跳转到来源章节。
- 大于 300 章时查询和可视化保持有界加载。

---

## 3.7 通用多目标放置与跨章节批处理

### 结论校正：通用事务基础与安全 metadata 批处理已经实现

migration 028 已建立 `content_transactions / content_transaction_targets`，不再依赖页面循环调用单目标 Safe Apply：

- prepare 冻结有序目标集合、`targetSetHash`、每目标 base revision/hash、候选 payload/hash 和整个 `transactionHash`；
- 目标身份统一为 `novelId + targetType + targetId`，同一事务内不允许重复目标或跨作品引用；
- apply 在单个 SQLite `IMMEDIATE` 事务中重新读取 live target，并执行作品归属、revision/hash CAS、写入和结果提交；
- `all_or_nothing` 要求批准完整目标集合，任一冲突或写入失败都会回滚全部效果；
- `reviewed_partial` 只应用用户从冻结集合中显式批准的目标，不会暗含批准未勾选目标；
- 相同 operation/request 可幂等重放；已应用事务重放时仍会复验应用目标，漂移后不会返回陈旧成功。

当前协议支持势力、地点、势力关系、地点连接、角色/章节/事件关联，以及 `chapter_metadata`。跨章节 metadata 批处理已经接入 Story Assets 页面，字段被限制为标题、大纲、目标和受控章节状态，不修改正文、草稿、采用指针或大文本引用。事务预览、逐目标审核和正式应用保持分离。

证据：

- `src-tauri/src/services/content_transaction_service.rs`
- `src-tauri/src/services/content_transaction_service_tests.rs`
- `src/services/content-transactions/contentTransactionService.ts`
- `src/pages/StoryAssets/TransactionReview.tsx`
- `src/pages/StoryAssets/CrossChapterBatchPanel.tsx`
- `docs/data-model.md` 的 migration 028

### 已验证门禁

- 任一 base revision/hash 漂移都会阻止覆盖新数据，`all_or_nothing` 不留下部分写入。
- `reviewed_partial` 只提交显式批准项；批准集合不能加入 prepare 时不存在的目标。
- 提交后的幂等重放复验权威结果，operation 冲突和 target 漂移失败关闭。
- 章节 metadata 批处理保留正文与每章草稿历史，正式资产关系也在同一事务中验证端点归属。
- Rust 服务测试覆盖事务回滚、部分批准、幂等重放、关系端点与地点层级；前端服务和 Story Assets 组件测试覆盖预览与审核流程。

### 当前边界与剩余增强

- 当前跨章节批处理只写安全 metadata；批量质检、逐章润色候选、差异审核和批量采用尚未接到该协议上。
- 已实现的是失败前的事务回滚；已提交事务的用户可见 undo manifest、反向事务和跨会话撤销历史仍待建设。
- 正文级批处理必须继续保留逐章独立草稿、采用身份和 Memory 失效语义，不能把多章正文压成一个无来源 payload。
- 超大批次仍需分页 prepare、受控子批和进度 checkpoint，避免单个长事务占用 SQLite；事务历史筛选与更完整的 diff UI 也可继续增强。

---

## 3.8 全产品 AI 任务可靠取消

### 结论校正：当前进程内的生产入口已经统一

当前工作树已经完成以下基础闭环：

- 仓库现有生产 `client.generate` 调用点均传递 `AiGenerateOptions`，或由接受该 options 的服务封装；大纲、设定、角色、事件、风格、润色、质检、修稿、章节/卷总结、Autonomous、Multi-Agent 和 Provider Pipeline 均可传播 `AbortSignal`。
- `runWithLoading` 为每个 operation 建立唯一 `AbortController` 和可查找 cancel handler；全局 LoadingModal 的停止操作会真正中止该 signal，而不是只关闭弹窗。
- 设定、角色、事件、风格和质量检查等自持 controller 的面板阻止重复启动，并在用户停止或面板/目标生命周期结束时中止请求；使用 `runWithLoading` 的入口由全局 operation 继续持有，完成时复验 signal 和原始目标身份，不能把迟到结果写入新目标。
- Legacy `ai_task_records` 在请求期间把 task ID 绑定到当前进程 active execution；AI 任务中心只对持有运行句柄的任务显示“停止”，并等待传输与任务终态结算。
- Tauri request registry 继续提供 requestId 预取消、活动取消、重复 ID 拒绝、近期完成隔离、future-drop abort 和 socket 关闭；取消 IPC 失败时前端等待原请求结算，避免提前报告终态。
- `settleAiTaskError` 统一区分取消与失败；`cancelled` 终态不会被迟到 success/failure 复活。正式管线取消不创建 Artifact，正文/质检面板的迟到结果也不创建草稿或报告。

证据：

- `src/types/ai.ts`
- `src/lib/runWithLoading.ts`
- `src/services/ai/aiTaskCancellation.ts`
- `src/services/ai/aiTaskService.ts`
- `src/services/ai/realAiClient.ts`
- `src-tauri/src/ai.rs`
- `src/pages/AiTasks/AiTasksPage.tsx`
- `src/components/right-dock/panels/IndependentAiPanelsCancellation.test.tsx`
- `src/components/right-dock/panels/CheckPanel.test.tsx`
- `src/components/right-dock/panels/StylePanel.test.tsx`

### 仍然存在的边界

- active execution map、loading operation 和组件 controller 都属于当前 WebView/前端进程；应用重启后不能从旧 Map 接管请求。跨进程 owner、lease 与无人值守恢复属于持久 scheduler，而不是本 P0 进程内 owner 的伪扩展。
- Legacy AI Task、正式 Task/Attempt 和 `generation_jobs` 仍是三类持久事实；它们已各自保持取消终态，但还没有合并成单一跨产品持久队列表。
- 动态 UI 测试已经覆盖设定、事件、角色、风格、质量检查和卸载/迟到结果，Rust 测试覆盖真实 socket；其余入口主要由共享服务测试和代码审计证明，仍需逐入口补齐页面切换、窗口关闭与 stop UI 回归。
- 取消完成前 Provider 可能已经计算 token 或计费。当前成本模型不会把 cancelled 任务的空估算误写成零，但尚未提供 Provider 对账。

### 后续验收门禁

- 新增任何生产 AI 入口都必须显式声明 owner、signal、requestId/operationId、终态结算和迟到副作用策略；绕过统一 options 的调用应由静态检查阻断。
- 持久后台调度必须把 owner/lease、epoch、checkpoint 和 policy snapshot 写入 SQLite，不能复用进程内 Map 冒充跨进程所有权。
- 每个可写入口继续证明取消后不创建成功 Artifact、草稿、报告或正式业务副作用，并覆盖超时、IPC 取消失败、窗口关闭和迟到完成。

---

## 3.9 独立势力库与地点库

### 结论校正：正式实体、关系与备份模型已经实现

migration 028 已在旧 `world_settings` 之外建立九张正式故事资产表：

```text
factions                  势力实体
locations                 地点实体与 parent_location_id 层级
faction_relations         势力间有向关系
location_links            地点间有向连接
character_factions        角色—势力关系
chapter_factions          章节—势力关系
chapter_locations         章节—地点关系
chapter_event_factions    章节事件—势力关系
chapter_event_locations   章节事件—地点关系
```

资产 identity、novel scope 和创建时间不可变，更新必须提交 expected revision。所有关系端点必须属于同一作品；地点层级拒绝自身父级和环，事务应用会按父子拓扑排序，因此冻结目标中子地点先于父地点出现也能安全写入。

Story Assets 页面已经提供正式势力、地点、势力关系和地点连接的创建、事务预览、逐目标审核与列表展示；Rust 协议同时支持角色、章节和章节事件关联。浏览器模式不会伪造 SQLite 正式资产。

项目备份已升级到 schema 9：恢复时先按拓扑写入地点，再恢复关系和章节关联，覆盖 ID 重映射、完整性复验和项目清理；旧 schema 8 仍可在没有故事资产集合时兼容导入。

证据：

- `src-tauri/src/migrations.rs`
- `src-tauri/src/services/content_transaction_service.rs`
- `src-tauri/src/services/content_transaction_service_tests.rs`
- `src-tauri/src/project_backup.rs`
- `src/pages/StoryAssets/StoryAssetsPage.tsx`
- `src/pages/StoryAssets/StoryAssetForms.tsx`
- `src/services/backup/projectBackupSchema.ts`
- `docs/data-model.md` 的 migration 028 与备份 schema 9

### 已验证门禁

- 关系两端、地点父级和所有角色/章节/事件关联都受同作品归属约束，跨作品引用失败关闭。
- 地点自身父级、循环层级和不存在的端点被拒绝；批量父子地点按拓扑应用。
- 资产创建与更新复用多目标事务的冻结候选、revision/hash CAS、显式审核和幂等重放。
- 完整项目备份、删除、恢复、ID 重映射和动态恢复后的 trigger 重建覆盖九张正式资产表。

### 当前边界与剩余增强

- 当前势力字段以名称、类型、描述和目标为核心；地点以名称、类型、描述和父级为核心。别名、资源、成员、控制区域、坐标、进入条件、状态时间线和历史快照仍需扩展。
- Story Assets 已提供关系/连接录入和实体列表，但关系图、地点树、平面地图、时间切片以及到人物、章节和冲突线的可视化跳转尚未建设。
- 旧 `world_settings` 中 faction/location 条目的迁移候选、来源 Link、别名去重/合并和 Prompt 双读去重仍需产品化，现有正式表不会自动猜测迁移旧自由文本。
- 角色/章节/事件关联的完整编辑 UI、资产专项 Agent 和基于正式资产的全书分析属于后续增强；这些能力应继续以九张正式表为权威来源。

---

## 3.10 AI usage 与成本计量

### 结论校正：计量、限流、并发与预算 reservation 已经实现

当前工作树已经具备：

- 设置中心可分别配置输入、输出价格（USD / 百万 Token）；API 模式要求两项都有效才形成 `user_configured` 价格快照，Mock 固定为零价格。
- `createAiClient` 为 Mock 与真实 Provider 的最终响应统一附加 `usageCost`。状态明确区分 `complete / mock / unpriced / usage_missing`，未知成本不会显示为零。
- Legacy `ai_task_records` 新增冻结输入/输出单价、估算值、币种、状态和来源字段。价格在任务创建时写入，SQLite 与 LocalStorage 在成功结算时使用实际 token 计算八位小数 USD 估算。
- 正式 Provider Pipeline 将同一成本事实写入 response metadata 白名单；Rust 验证状态、币种、来源、数值范围及 Mock 零成本组合，完成重放时也复验持久事实。
- `generation_jobs` 保存正文生成的估算值，step metadata 同时记录成本状态；AI 任务页展示单任务状态和当前筛选列表中已计价任务的合计。
- 通过 `createAiClient` 发出的真实 Provider 前台请求在派发前经过 `aiRequestPolicyService`：按每分钟请求上限、最大并发、每日 Token 硬预算和每日估算 USD 硬预算预留最坏情况额度；完成后使用 Provider 实际 usage 结算并释放差额。
- migration 029 把桌面策略、滚动窗口、active reservation 与每日聚合统一为 SQLite 权威事实；设置用 revision CAS 更新，Rust Provider command 要求 request-bound 哈希 lease，并原子标记单次派发。桌面 IPC 失败不降级到 LocalStorage。
- 设置中心展示今日已用与运行中预留 Token/成本、最近一分钟请求数、活动并发、usage 缺失数和预算预警；成本预算在缺少有效输入/输出单价时失败关闭。
- migration 027 为 Autonomous run 另行冻结每日/整书 Token 与成本预算，并在逐章 claim 前检查 reservation，在 attempt 完成时累计实际 usage；预算、运行时段、重试与熔断共同约束无人值守派发。

证据：

- `src/services/ai/aiCost.ts`
- `src/services/ai/aiClient.ts`
- `src/services/ai/providerAdapter.ts`
- `src/services/ai/aiTaskService.ts`
- `src/services/ai/aiExecutionPipeline.ts`
- `src/services/ai/aiRequestPolicyService.ts`
- `src/components/settings/AiGovernanceSettingsCard.tsx`
- `src-tauri/src/db.rs`
- `src-tauri/src/commands.rs`
- `src-tauri/src/services/ai_fact_security.rs`
- `src-tauri/src/services/ai_request_policy_service.rs`
- `src-tauri/src/commands/ai_request_policy.rs`
- `src-tauri/src/migrations.rs`
- `src-tauri/src/services/autonomous_scheduler_service.rs`
- `src/pages/Settings/SettingsPage.tsx`
- `src/pages/AiTasks/AiTasksPage.tsx`

### 已验证门禁

- 本次请求的保守 Token/成本预估连同活动 reservation 超过日预算时，请求在到达 Provider 前失败关闭。
- 每分钟频率与并发配额分别产生稳定错误；双连接和双进程竞争只允许一个请求占用最后的并发/预算额度。
- 过期 owner 会释放并发并保守计量；成功响应按真实 usage 结算，相同结算可幂等重放，不同 owner/token/usage 失败关闭。
- 缺失 usage、失败和取消采用保守额度；未配置价格时保留独立未定价计数，不把未知成本显示为零。
- 价格快照随任务冻结，历史任务不会因设置页修改单价而被静默重算。
- Scheduler 的日/整书预算和逐章估算由 SQLite 权威 run/attempt 记录，应用重启后仍可复验。

### 当前边界与剩余增强

- 估算值来自用户配置单价，不是 Provider 账单；当前只定义 USD，也没有按 Provider/model 生效日期管理价目版本。
- cancelled/failed 请求可能已经产生 Provider 费用；全局 ledger 以冻结 reservation 保守计量，但单任务在缺少 Provider usage 时仍不能伪造精确账单。当前没有服务端账单导入或差异对账。
- migration 029 是全产品真实 Provider 的跨窗口、跨进程基础额度账本；Scheduler 仍保留单个 run 的附加冻结预算，两层都必须通过，不能互相放宽。
- 当前限流是用户配置的固定每分钟/并发门禁；Provider `Retry-After`、动态 429 退避、组织级配额同步、月度/项目聚合、超额审批和成本趋势告警仍待增强。
- 当前列表合计只累加已经 `complete` 的可见任务，不能解释为项目总支出。

### 后续增强门禁

- 后续月度/项目/组织聚合必须复用“预估预留 → 实际 usage 结算 → 保守缺失计量”，并保持 operation/task/attempt 可追溯，不能削弱现有全局与 scheduler 硬门禁。
- `unpriced`、`usage_missing`、失败和取消必须单独统计，任何聚合报表都应显示未知覆盖率。
- 后台无人值守策略继续同时读取全局策略与 run 冻结预算；未来的 Provider 组织级动态配额也必须由共享权威 ledger 仲裁，UI 自报额度不能授权 worker 越过硬门禁。
- Provider 价目更新只影响新任务，历史任务继续使用创建时快照；账单对账应另存来源和时间区间，不改写历史执行事实。

---

## 3.11 模型自主 Tool Calling

### 当前实现状态：持久 Planner 与固定 Tool 编排已具备，开放式调用未闭环

- Tool Registry、schema、权限、scope、参数 hash、lease 与 checkpoint 已用于持久 Planner；每个计划步骤只能调用冻结身份的工具。
- 生产 Compilation Registry 的真实 Provider 任务仍固定 `allowedTools=[]`，模型响应不会在运行中动态扩展工具集合。
- `src/agent-tools/chapter-tools.ts` 的 `saveCandidateDraft()` 仍明确返回 `notImplemented`；副作用写入主要由应用在固定工作流中编排，而不是模型自主选择。

后续产品化必须先定义只读/候选写入/正式副作用三级权限、每次调用的 schema 与结果 Artifact、循环次数和预算、用户确认策略、重放身份以及取消/恢复语义。模型自报 tool name 或确认字段不能直接授权 SQL、草稿采用或正式资产写入。

### 验收边界

- Provider 只能看到冻结 allowlist，未知或版本漂移工具在执行前失败关闭。
- 副作用工具先生成候选和差异；正式采用继续通过现有 CAS / transaction / Artifact 边界。
- 每次 tool call、结果 hash、Token/成本、owner 与终态可审计；重启后不静默重放状态不明调用。
- `saveCandidateDraft()` 等占位入口在进入 allowlist 前必须具备真实实现和故障注入测试。

---

## 3.12 作品创作驾驶舱与学习成本

当前页面已经覆盖作品详情、工作台、参考资料、故事资产、设定推演、自主规划、AI 任务、风格、模板、导入导出和设置，但缺少面向普通作者的统一进度模型。用户难以判断 Brief 需要多完整、角色/世界/计划的先后关系、普通生成与自主创作差异、Multi-Agent 与质量检查分工、候选采用状态，以及 readiness / 预算 / Memory 阻断原因。

建议在作品详情建立桌面写作软件风格的项目驾驶舱，而不是继续堆叠独立入口：

```text
作品设定 → 故事资产 → 全书计划 → 当前章节 → 候选审核 → 总结 / Memory 沉淀
```

- 每阶段只汇总现有权威事实和下一项可执行操作，不复制业务状态到新的前端 Store。
- 阻断卡明确显示缺失输入、来源章节、预算、readiness、Memory 覆盖率和修复入口。
- 候选、已采用稿、待确认分析和失败任务使用统一状态语言，并可跳转到原页面继续处理。
- 新手向导可隐藏高级入口，但不能绕过草稿确认、成本门禁或正式事务。

---

## 3.13 出版、投稿与最终校对

当前 TXT、Markdown 与 JSON 项目备份足以进行基础导出，但还不是完整出版链路。后续范围包括：

- DOCX、EPUB 与 PDF 排版导出，按卷/选择章节导出；
- 自定义章节标题、前言、后记、作者说明和投稿格式模板；
- 全书查找替换预览、最终校对报告、敏感词统计、总字数与章节长度分布；
- 导出 manifest 固定采用稿 ID/version/hash、模板版本和资源清单，避免后台变化产生不可重现文件。

DOCX/EPUB/PDF 必须读取完整采用稿而非预览列；超长正文沿用 large-text 完整性校验。查找替换先生成逐章候选 diff，再复用多目标事务审核，不能直接循环覆盖正文。PDF/EPUB 需在真实阅读器中验证目录、中文字体、分页与资源引用；JSON 备份继续服务恢复，不与面向读者的出版格式混为一谈。

---

## 4. 跨能力依赖关系

```text
取消 / 当前进程 request owner / 安全流事件 / usage 成本估算与硬门禁（已实现）
                 │
                 ├── 流兼容降级与逐入口证据
                 └── SQLite Scheduler / lease / 三档策略 / run 预算（migration 027，已实现）
                                      │
                                      └── 系统后台常驻、动态组织额度 / 账单对账与通知（增强）

参考资料库（已实现）──> 分层风格画像（已实现）──> 正文 Prompt 风格约束

结构化 Memory ──> 向量/混合检索（已实现）──> 全书分析与连续性检查
                                      │
                                      └── 质量门禁自动采用

多目标 Plan/事务（migration 028，已实现）──> 跨章节 metadata 批处理（已实现）
                                      │
                                      └── 正文级质检/润色/采用与提交后 undo（增强）

正式势力/地点实体与关系（migration 028 / backup schema 9，已实现）
                                      │
                                      └── 关系图、地点树/地图与资产专项 Agent（增强）

持久 Planner / Tool Registry（已实现）──> 冻结 Provider allowlist 与候选工具
                                      │
                                      └── 模型自主 Tool Calling / 副作用确认（增强）

现有页面与权威事实 ──> 项目驾驶舱 / 阻断解释 ──> 出版与最终校对（增强）
```

关键决策：

- 三档无人值守策略、lease、checkpoint、冻结质量阈值与 run 预算已经落地；应用完全退出后的系统后台常驻不得绕过相同的取消、预算、评审证据和恢复协议。
- migration 029 的共享 reservation/CAS ledger 已统一所有真实 Provider 的跨进程额度；scheduler run ledger 继续承担单次自动化计划的附加冻结预算，二者事实域分离但派发门禁叠加。
- 流式正文已经保持临时预览与权威草稿分离；后续兼容降级也必须复用相同提交边界。
- 向量 Memory 已绑定 adopted draft/version 并在改采事务内失效；自动 embedding 与全书分析不得绕过该协议。
- 多目标事务已提供冻结 target set、base hash、冲突、回滚和重放语义；正文级跨章节批处理必须直接复用该协议并补齐逐章草稿/Memory 语义，不能退回 UI 循环保存。
- 势力、地点及其关系已是 SQLite 权威资产；后续关系图、地图与 Agent 必须读取正式实体和关联表，不能重新以自由文本冒充资产事实。

---

## 5. 推荐版本顺序

| 阶段            | 建议范围                                                                                                        | 交付结果                             | 规模 |
| --------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------ | ---- |
| v3.0.x 基础收口 | 已实现取消、真实正文流、成本硬门禁、参考 / 风格、混合 Memory、Scheduler、多目标事务与正式资产；完成全量发布门禁 | 固化可靠性、长期上下文与安全写入边界 | M    |
| v3.1.0          | Provider 能力探测、非流式受控路径、逐入口流 / 取消 UI 回归、召回评估                                            | 从基础版进入可运营的兼容与质量控制   | L    |
| v3.1.x          | 自动 embedding、增量向量化、召回评估/重建，以及 EPUB/PDF/Markdown/DOCX 参考资料                                 | 100+ 章语义回忆与常见资料导入闭环    | L/XL |
| v3.1.x 后段     | 角色/冲突/伏笔/节奏确定性分析、热力图与项目驾驶舱                                                               | 全书分析与统一创作进度入口           | L/XL |
| v3.2.x          | Windows 后台常驻、Provider 动态组织额度 / 账单对账、凭据生命周期、通知、次日收件箱与长时间耐久验证              | 从可恢复调度进入系统级夜间运行       | XL   |
| v3.3.x          | 基于现有多目标事务扩展跨章节质检/润色/采用、正文 diff 与提交后 undo                                             | 正文级安全批处理闭环                 | XL   |
| v3.3.x 后段     | 旧世界条目迁移、别名合并、关系图、地点树/地图与资产专项 Agent                                                   | 正式世界资产可视化与智能化           | L/XL |
| v3.4.x          | 冻结 allowlist 的模型自主 Tool Calling、DOCX/EPUB/PDF 出版、最终校对与投稿模板                                  | 开放式受控 Agent 与交付出版闭环      | XL   |

`M/L/XL` 表示相对工程规模，不代表固定日历承诺。

---

## 6. 优先级评分矩阵

评分：用户价值、长篇连续性和风险降低为 1～5；实施风险越高分值越高。

| 能力              | 用户价值 | 连续性收益 | 风险降低 | 实施风险 | 建议                                       |
| ----------------- | -------- | ---------- | -------- | -------- | ------------------------------------------ |
| 全产品可靠取消    | 4        | 2          | 5        | 2        | 当前进程基础已实现，完成发布收口           |
| 流式输出          | 5        | 2          | 4        | 4        | 正文基础已实现，补兼容降级                 |
| usage / 成本计量  | 4        | 2          | 5        | 3        | 桌面全局硬预算已实现，继续做账单对账       |
| 参考小说库        | 4        | 3          | 2        | 3        | TXT 闭环完成，后续扩展格式                 |
| 风格画像增强      | 3        | 3          | 2        | 2        | 六层画像完成，后续多样本评估               |
| 混合语义 Memory   | 5        | 5          | 4        | 5        | SQLite 基础完成，后续自动 embedding / 评估 |
| 全书分析          | 4        | 5          | 3        | 3        | 先 SQL 指标，后语义分析                    |
| 无人值守运行      | 5        | 4          | 1        | 5        | Scheduler 与三档策略已实现，补系统后台常驻 |
| 多目标批处理      | 4        | 3          | 3        | 5        | 事务与 metadata 批处理已实现，扩正文级流程 |
| 势力/地点资产     | 3        | 4          | 2        | 4        | 正式 schema 9 已实现，增强迁移与可视化     |
| 项目驾驶舱        | 5        | 3          | 3        | 3        | 汇总权威进度与阻断，不复制业务事实         |
| 自主 Tool Calling | 3        | 3          | 2        | 5        | 先冻结 allowlist / 候选工具，再开放副作用  |
| 出版与最终校对    | 4        | 1          | 2        | 4        | 从 DOCX/分卷与统计起步，再做 EPUB/PDF      |

---

## 7. 不建议的捷径

- 把“逐字显示”做成前端定时动画，而网络仍等待完整响应；这不是真实 streaming。
- 将流式 delta 直接写入当前采用稿或覆盖编辑器未保存内容。
- 把整本参考小说全文放入每次生成 Prompt。
- 仅增加向量数据库而不绑定来源 draft/version 和失效状态。
- 用页面循环调用单章保存来冒充跨章节事务。
- 让无人值守模式绕过预算、失败熔断、质量证据和回滚。
- 把 `unpriced`、`usage_missing`、failed 或 cancelled 的空成本当作零加入“总支出”。
- 将势力/地点继续作为自由文本字段，同时宣称已具备关系图或地图事实模型。
- 让模型返回任意 tool name 或自报确认字段就直接执行副作用。
- 让“项目驾驶舱”复制一套前端业务状态，或用它绕过原页面的审核与预算门禁。
- 从正文预览列或未采用候选直接生成出版文件，或用循环查找替换覆盖多章采用稿。

---

## 8. 后续任务书应包含的统一验收门禁

每个后续版本任务书至少应明确：

1. 目标版本与唯一版本目标；
2. 数据模型、migration、备份 schema 和旧数据兼容；
3. Task/Attempt/Artifact/operationId/requestId 身份；
4. 取消、超时、重试、迟到完成和提交状态未知；
5. base hash/version、目标归属、幂等和冲突；
6. API Key、参考原文、Provider raw/reasoning 的持久化边界；
7. Mock、前端、Rust、Windows Tauri 和真实 API 验证范围；
8. 2K 桌面布局、键盘操作、长列表虚拟化和无障碍名称；
9. CHANGELOG、README、路线图和用户指南同步；
10. 明确不在本版本实现的相邻能力。

---

## 9. 最终判断

AI Novel Studio v3.0.0 已形成“规划全书 → 逐章生成候选 → Multi-Agent 评审 → 工作台采用 → 章节分析确认”的受审核闭环。当前最主要的不足不再是缺少基本 AI 生成功能，而是：

1. **真实正文流、可靠取消、成本估算与 migration 029 桌面跨进程硬预算已统一到基础协议；独立 EXE、真实浏览器与完整桌面 E2E 已收口，安装包按验收顺序延后刷新，后续继续扩展 Provider 兼容降级、账单对账和逐入口 UI 证据；**
2. **参考资料、分层风格画像和 SQLite 混合语义 Memory 已形成代码、动态测试、安装包与桌面 E2E 闭环，并可继续增强自动 embedding、评估集与全书分析 UI；**
3. **migration 027 已建立跨进程调度、持久 owner/lease、run 预算、恢复和三档自动决策，migration 029 已补齐全产品 Provider 额度账本；剩余缺口是应用完全退出后的 Windows 后台常驻、动态组织额度、通知与耐久性验证；**
4. **migration 028 已建立多目标事务、跨章节 metadata 批处理和势力/地点正式实体模型；剩余缺口是正文级批处理、提交后 undo、旧条目迁移及关系图/地点地图体验。**
5. **生产流程仍以预先编排的 Agent 为主；项目驾驶舱、冻结 allowlist 的模型自主 Tool Calling，以及 DOCX/EPUB/PDF 出版与最终校对属于后续独立版本目标，不能在 v3.0.0 收口中混做。**

因此，下一阶段不再重复建设已经落地的 Scheduler、事务、正式资产 schema 或本地桌面门禁，而应按单版本目标依次补齐 Provider 兼容、自动语义化、常见资料导入、全书分析/项目驾驶舱、系统后台常驻、正文级批处理、势力/地点可视化、受控 Tool Calling 和出版交付；所有增强继续保持草稿安全、预算门禁与用户控制。

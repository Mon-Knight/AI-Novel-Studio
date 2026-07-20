# AI Novel Studio - CHANGELOG

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

# AI Novel Studio 版本路线图

> 项目仓库：`AI-Novel-Studio`
> 技术路线：Tauri + React + TypeScript + SQLite
> 目标平台：Windows 桌面端
> 当前版本：v3.7.0（Writing SubAgent 开放与 ZCode 工作台）
> 当前状态：v3.7.0 开放 Writing SubAgent（桌面 + 真实 API 模型默认经 DSH 提交 candidate-only 正文）、ZCode 形态工作台、双真相收敛与运行章节目标持久化；v3.6.0 保持为功能基线

> 路线演进说明：v3.2.1 以前的章节工程与 Autonomous 路线作为历史基线保留；v3.3.0 起的方向是“工作台 → 小说项目 → 任务对话”，v3.5.0 完成工作台与旧 UI 收敛，v3.6.0 继续收敛 Canonical 能力契约。

---

## 1. 项目总体目标

AI Novel Studio 的目标不是普通码字软件，也不是一次性生成整本小说的网站，而是一个面向长篇小说创作的 Windows 桌面软件。

核心目标：

1. 用户创建小说作品。
2. 用户维护世界背景、主角信息、规则体系、分卷大纲、章节大纲、角色、事件、风格方案。
3. 系统通过不同提示词调用 AI API，让 AI 分别承担设定整理、角色生成、剧情事件推理、正文生成、润色、质量检查、章节总结等任务。
4. 用户在写作工作台中选择本章要调用的设定、角色、事件、风格方案和输出控制方案。
5. AI 生成候选内容，用户编辑并确认采用。
6. 用户确认后，系统沉淀上下文、角色状态和剧情进度，为下一章生成提供连续性支持。

最终形态：

```text
作品管理首页
↓
作品详情 / 创作资产管理
↓
章节写作工作台
↓
AI 生成候选
↓
用户修改 / 重生成 / 润色
↓
确认采用
↓
自动总结上下文
↓
继续下一章
```

---

## 2. 版本规划原则

### 2.1 先 UI 框架，后 AI 能力

前期优先完成桌面软件结构和写作工作台布局，不在基础不稳时接入复杂 AI 逻辑。

推荐顺序：

```text
项目壳 → 首页 UI → 工作台 UI → 本地数据 → AI 设置 → AI 生成闭环 → 风格/角色/事件 → 上下文总结 → 质量检查
```

### 2.2 交互中心从资产页面迁移到任务工作台

截至 v3.2.1，主界面 / 作品详情页负责资产准备，章节写作工作台调用资产。该分工是历史实现基线。

从 v3.3.0 规划开始：

- 对话式创作工作台成为默认首界面；
- 小说是工作台内的项目，也是领域事实最高级对象；
- 项目下的任务对话负责调用资产、生成候选、显示工具/错误并推送产物；
- 不同任务可以选择不同模型并并发运行；
- 作品详情保留正式资产的人工管理，不再承担待确认中心；
- 原写作工作台收敛为章节人工审阅、编辑、保存和采用界面。

迁移必须按功能等价和回退验证分阶段进行，不能先删除旧入口再补任务能力。

### 2.3 AI 功能必须围绕“逐章完成小说”

所有 AI 功能都应服务于正文生成和上下文沉淀。优先级最高的是：

```text
章节正文生成
章节重生成
章节润色
章节质量检查
章节总结
上下文延续
```

### 2.4 每个版本必须可运行、可回退、可备份

每个版本完成后必须：

1. 能正常启动桌面开发环境。
2. 不能破坏已有页面。
3. 不能提交 `node_modules`、API Key、`.env.local`。
4. 必须运行验证命令。
5. 提交、tag、push 由用户明确确认后执行。

---

## 3. 总体版本路线

```text
v0.1.0  桌面壳与作品管理首页
v0.2.0  作品详情与基础设定
v0.3.0  分卷与章节管理
v0.4.0  写作工作台 UI
v0.5.0  本地数据持久化与草稿版本
v0.6.0  AI 设置与提示词调度中心
v0.7.0  AI 正文生成闭环
v0.8.0  风格方案与输出控制方案
v0.9.0  角色候选与剧情事件推荐
v0.10.0 上下文总结与连续生成
v0.11.0 质量检查与润色建议
v0.12.0 导入导出与备份恢复
v1.0.0  可正式用于长篇小说创作的基础版
v1.0.43 Agent 基础设施建设
v1.0.44 Agent Workflow Runtime 最小闭环
v1.0.45 项目开发辅助 Skills 增强版
v1.0.46 Tool Layer 接入真实项目读取
v1.7.6～v1.7.20 应用化、上下文与质量链路增强
v1.8.x  旧规划节点，未形成独立 CHANGELOG 发布记录
v1.9.5  章节工程面板
v1.9.6  生成上下文编译器
v1.9.7  API 任务队列与 Mock Runner
v2.0.0  基于工程面板的正文初稿生成
v2.0.1  生成后结构化质量检查
v2.0.2  局部修复 Patch
v2.0.3  正文版本管理增强
v2.1.0  单章质量闭环稳定版
v2.1.1  正文变更安全门
v2.1.2  完整备份与恢复闭环
v2.1.3  Windows 真实桌面 E2E 与稳定性
v2.1.4  大文本正文安全闭环
v2.1.5  章节工程任务跨重启恢复闭环
v2.1.6  章节工程真实 AI 请求取消闭环
v2.1.7  章节质量历史不可变快照与原子重放
v2.1.8  章节上下文持久化一致性闭环
v2.2.0  工作区可靠性与基础设施收口
v2.2.1  工作区竞态可靠性热修
v2.3.0  Agent 执行事实层
v2.3.1  Provider Adapter 与统一执行管线
v2.3.2  Safe Apply 单目标安全应用
v2.4.0  Context / Constraint Compiler 与 Tool Registry
v2.5.0  Chapter Readiness Planner Runtime
v2.6.1  文档规范化与版本统一
v3.0.0  Multi-Agent 自主创作闭环
v3.1.0  DSH 进程外大脑接入
v3.2.0  本地章节正文流水线与 DSH 稳定整合
v3.2.1  发布资产 URL 热修复
v3.5.0  对话式创作工作台与审阅收敛
v3.6.0  智能体创作平台与长篇小说记忆层功能基线
v3.6.1  SQLite 安全与 Runtime 固定模型恢复补丁
v3.6.2  Canonical 只读链路与桌面体验收口补丁
v3.7.0  Writing SubAgent 开放与 ZCode 工作台（当前）
```

---

## 4. 应用化优化阶段：v1.7.x

```text
v1.7.6  阶段性整理、文档体系重整与 EXE 验证 ✅
v1.7.7  桌面端窗口大小控制、响应式 UI 与 2K 适配 ✅
v1.7.8  导出文件位置选择与导出体验优化 ✅
v1.7.9  设定库 AI 推演基础版 ✅
v1.7.10 候选设定采纳与测试补齐 ✅
v1.7.11 发布收尾、本地构建产物清理与安装包验证 ✅
v1.7.12 AI 任务删除与质量问题处理闭环 ✅
v1.7.13 章节总结升级为章节上下文 ✅
v1.7.20 写作台启动、布局与质量检测链路修复 ✅
```

### v1.7.6 阶段性整理

- 整理 README 与 docs 文档分组。
- 明确当前阶段边界。
- 验证 Tauri EXE 构建入口。

### v1.7.7 桌面窗口与 2K 适配

- 收敛首页、作品详情、创作资产、导入导出等页面的桌面布局。
- 避免 2K 屏幕上表单、卡片和编辑区域无限拉伸。
- 保持桌面写作软件风格，不改成后台管理系统。

### v1.7.8 导出体验优化

- 导出时在桌面模式使用 Tauri 保存对话框选择文件位置。
- 导出成功后显示保存路径。
- 支持章节 / 整本 TXT、Markdown，以及 JSON 备份导出。

### v1.7.9 设定库 AI 推演基础版

- 新增设定候选生成入口。
- 支持生成角色、势力、地点、规则候选。
- 候选进入本地候选池，不自动写入正式数据。
- Mock 模式可测试完整候选生成流程。

### v1.7.10 候选采纳与测试补齐

- 支持采纳、编辑后采纳、废弃。
- 已处理候选不可重复采纳。
- 角色采纳进入角色库，规则采纳进入规则体系。
- 势力、地点在当前正式模块尚未独立拆分前，采纳为世界设定条目。
- 新增设定推演静态回归检查脚本。

### v1.7.11 发布收尾

- 发布收尾版本，不新增业务功能。
- 新增本地大文件扫描脚本 `report_large_files.ps1`。
- 新增旧构建产物归档脚本 `archive_old_builds.ps1`，默认 dry-run。
- 新增旧构建产物清理脚本 `clean_old_builds.ps1`，默认 dry-run。
- 新增安装包验证文档、发布产物保留策略文档、本地构建清理说明文档。
- 同步 README、CHANGELOG、版本路线图。
- v1.7.10 作为稳定基线保留。

### v1.7.12～v1.7.20 上下文与质量链路增强

- 修复 AI 任务记录删除时的外键清理链路，补充质量问题状态管理和正文定位。
- 将章节总结升级为绑定正文版本的章节上下文，增加一致性校验、过期机制与上下文入库。
- 持续收敛工作台启动、右侧面板、当前编辑器快照、质量报告哈希与 AI 修稿复检链路。
- 本阶段具体发布节点以 `CHANGELOG.md` 为准；未在 CHANGELOG 中单独记录的中间版本不补写为正式发布。

---

## 5. 章节工程与正文闭环：v1.8.x～v2.2.1

| 版本   | 状态   | 版本主题                         | 核心结果                                                                                                           |
| ------ | ------ | -------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| v1.8.x | 旧规划 | 大纲能力阶段                     | 未形成独立 CHANGELOG 发布记录；不将旧计划误写为已发布功能                                                          |
| v1.9.5 | 已完成 | 章节工程面板                     | 章节卡、场景计划、生成约束、质量规则与工程状态持久化                                                               |
| v1.9.6 | 已完成 | 生成上下文编译器                 | 统一上下文快照、prompt 摘要、来源列表与 context hash                                                               |
| v1.9.7 | 已完成 | API 任务队列与 Mock Runner       | `generation_jobs`、step 结果、进度、取消和 Mock 闭环                                                               |
| v2.0.0 | 已完成 | 正文初稿生成                     | 基于工程快照生成章节候选草稿并回写草稿版本流                                                                       |
| v2.0.1 | 已完成 | 结构化质量检查                   | 生成后质量 step、报告与问题摘要                                                                                    |
| v2.0.2 | 已完成 | 局部修复 Patch                   | 生成局部修复建议，低风险精确命中时形成新候选草稿                                                                   |
| v2.0.3 | 已完成 | 正文版本管理增强                 | 质量评分、草稿恢复 / 采用语义与非正式草稿废弃                                                                      |
| v2.1.0 | 已完成 | 单章质量闭环稳定版               | 工程、快照、生成、版本、质检、修复状态集中展示与链路修复                                                           |
| v2.1.1 | 已完成 | 正文变更安全门                   | 固定目标与基础版本、隔离迟到响应、冲突拒绝、原子采用、会话级幂等应用                                               |
| v2.1.2 | 已完成 | 完整备份与恢复闭环               | 版本化完整项目备份、SQLite 单事务恢复、ID 重写、外键和大文本完整性校验，以及本地缓存恢复失败后的前端补偿           |
| v2.1.3 | 已完成 | Windows 真实桌面 E2E 与稳定性    | WebdriverIO 驱动真实 Tauri 窗口，隔离 SQLite / WebView2 / 进程，阻断真实 AI 与外部网络，并修复测试暴露的稳定性缺陷 |
| v2.1.4 | 已完成 | 大文本正文安全闭环               | 全文与逐片强校验、document/chunks/draft 同事务、失败关闭读取、旧文档回收和长正文真实桌面 E2E                       |
| v2.1.5 | 已完成 | 章节工程任务跨重启恢复闭环       | 遗留非终态任务原子结算、稳定错误码、checkpoint 保留、状态机收紧和真实进程重启 E2E                                  |
| v2.1.6 | 已完成 | 章节工程真实 AI 请求取消闭环     | async HTTP、AbortSignal、活动请求注册表、质量任务取消结算和真实桌面取消 E2E                                        |
| v2.1.7 | 已完成 | 章节质量历史不可变快照与原子重放 | report/items/state 单事务、历史只读回放、迟到竞态保护、AI Task 强绑定、schema 3 备份和真实桌面重启 E2E             |
| v2.1.8 | 已完成 | 章节上下文持久化一致性闭环       | SQLite 桌面单一事实源、稳定上下文 ID、总结 / 上下文 / 角色状态 / 章节终态原子提交、旧缓存幂等迁移与重启 E2E        |
| v2.2.0 | 已完成 | 工作区可靠性与基础设施收口       | 迁移账本、结构化错误、长正文原子保存与完整性读取、恢复快照、全局 Leave Guard、React/SQLite 故障测试                |
| v2.2.1 | 已完成 | 工作区竞态可靠性热修             | 采用/保存 TOCTOU、恢复候选跨会话幂等、原生关闭 bypass 失败回滚                                                     |

### v2.1.1 单一版本目标（已完成）

本版本不增加新的 AI 自动写入范围，只收紧现有正文变更边界：

1. 正文结果携带作品、章节、来源草稿、基础版本 / 哈希和结果 ID。
2. 章节加载与 AI 回调消费前验证目标；乱序或迟到响应不得改写当前编辑器。
3. 工作台可控导航、章节切换、恢复 / 采用与覆盖入口共用未保存正文保护；保存失败不得清除 dirty 状态。
4. 草稿更新将零行受影响返回为冲突；正式采用验证草稿归属并在单一事务内切换。
5. Node 安全原语测试与完整临时 SQLite 测试覆盖关键 guard 和事务故障路径；React 组件并发集成仍列为后续门槛，静态文本检查不作为行为通过证据。

明确不在本版本处理：流式输出、任务队列全面重构、通用多目标自动放置、正文锁定模型、人物知识图谱、全部 prompt 重写、状态管理库替换和 UI 重做。

### v2.1.2 单一版本目标

本版本只解决作品备份和恢复的可信闭环：

1. 定义带独立 `schemaVersion` 的完整项目备份协议，覆盖作品、卷章、全部草稿、连续性资产、大纲、任务和质量记录。
2. 桌面端恢复始终作为新作品写入，在单个 SQLite 事务中重写关联 ID，并校验外键和大文本 SHA-256。
3. 不导出应用设置、API Key 和本机绝对路径；旧版 JSON 只能作为基础作品导入，不能标记为完整恢复。
4. 增加“导出 -> 清空临时项目库 -> 导入 -> 全量比对”和无效数据回滚的 SQLite 动态测试。
5. 将必要的项目级 LocalStorage 作为补充数据恢复；该步骤失败时由前端撤销刚导入的 SQLite 作品。

明确不在本版本处理：跨 SQLite 与 LocalStorage 的统一 ACID 事务、全量状态迁移到 SQLite、大文本保存管线的端到端修复、任务跨重启恢复，以及 Agent 自动化能力扩展。前端补偿不等同于跨存储 ACID。

### v2.1.3 单一版本目标

本版本只发布 Windows 真实桌面 E2E 基础设施及其稳定性修复：

1. 使用 WebdriverIO、`tauri-driver` 与匹配 WebView2 的 EdgeDriver 操作真实 Tauri 窗口，所有核心定位基于 DOM、`data-testid` 和受限 IPC。
2. 每个测试使用独立临时 SQLite、WebView2 profile、单实例状态和进程树；Rust 校验临时路径与 run-id marker，拒绝正式数据目录。
3. E2E 构建强制 Mock Provider，并在 WebView 请求前和 Rust AI IPC 两层阻断真实外部调用。
4. 覆盖应用启动、作品创建与打开、作品保存、卷章正文、候选采用和未保存离开六条独立流程，发布前连续运行三次。
5. 修复 E2E 稳定复现的 SQLite 递归锁、Windows 强调色查询阻塞、前后端计字不一致，以及旧风格表 / IPC 参数兼容问题。
6. Windows CI 在 Pull Request 与 `main` 推送运行 smoke，在定时、版本 tag 或手动完整模式运行全部桌面流程。

明确不在本版本处理：崩溃恢复产品流程、安装程序 UI、原生文件选择器、`Artifact` / `PlacementProposal` / `ApplyPlan` 新领域模型、大文本事务扩展、任务跨重启恢复和 Agent 自主写入。

### v2.1.4 单一版本目标

本版本只收敛章节草稿大文本正文的可靠性边界：

1. 所有 struct IPC 使用 `{ input }`，缓存 session 限制为 UUID；整文和每片的 SHA-256、片数、顺序、字符数与 UTF-8 字节数均由 Rust 重新验证。
2. document、chunks 与 draft create/update 在一个 SQLite 事务内提交；失败整体回滚，成功后的缓存清理失败只返回 warning。
3. 使用完整正文计算字数；连续更新、大文本转小文本和删除草稿会事务化清理不再被引用的旧 document。
4. 所有 `largeTextRefId` 都必须成功读取全文；失败时不返回预览，章节切换保留原安全正文并阻止目标写入。
5. Rust 故障测试覆盖 hash、缺片、事务回滚、生命周期和 Unicode；真实 Tauri E2E 覆盖 184KB 正文往返、采用及损坏分片失败关闭。
6. E2E 运行继续保持隔离 SQLite、Mock Provider、外网零请求和进程零残留，并自动选择空闲 driver 端口以支持连续执行。

明确不在本版本处理：其他实体的通用大文本原子提交、任务跨重启恢复、真实网络取消、质量历史稳定重放、新领域模型和 Agent 自主写入。

### v2.1.5 单一版本目标

本版本只收敛章节工程 `generation_jobs` 的跨重启安全边界：

1. 启动时在一个 SQLite 事务中把遗留 `pending` / `running` / `retrying` 任务结算为 `failed`，错误码固定为 `APP_RESTART_INTERRUPTED`。
2. 保留 current step、进度、已完成 checkpoint、草稿、质量报告和 patch 结果，并追加一个失败恢复 checkpoint。
3. 恢复可重复执行，第二次启动不再修改终态任务或增加 checkpoint。
4. 终态任务不可复活，进度不可倒退，step ID 不可覆盖；同时间戳结果使用稳定次序。
5. 工作台根据持久化 active 状态禁用重复启动，并用 `recovery-dialog` 明确告知没有自动重发 AI 请求。
6. 真实 Windows Tauri E2E 通过受控 Mock AI pause gate 创建在途任务，重启真实应用后验证同一隔离 SQLite 的恢复、幂等、零外网和零残留进程。

明确不在本版本处理：不确定步骤自动续跑、旧 `ai_task_records` 恢复、真实 HTTP 取消、质量历史重放、新 migration 和 Agent 自主写入。

### v2.1.6 单一版本目标

本版本只收敛章节工程 `generation_jobs` 的在途 AI 请求取消边界：

1. 桌面 API 模式使用异步 `reqwest`；带 request ID 的请求可由独立 IPC 中止，用户取消稳定返回 `AI_REQUEST_CANCELLED`。
2. 活动请求、提前取消和近期完成 ID 均有容量与 TTL；两阶段注册、token 与 RAII 清理覆盖立即取消、重复 ID、future drop 和迟到取消。
3. `AiClient` 统一接受 `AbortSignal`；浏览器 fetch 区分用户取消与超时，Mock gate / delay 取消后立即移除 waiter。
4. 章节工程正文与质量检查共用 job controller、使用不同请求 ID；任务取消仍原子写入唯一 checkpoint，迟到响应不能完成任务。
5. 质量 AI 任务取消结算为 `cancelled`，终态不可被迟到 success / failure 覆盖；取消不会回滚已经提交的草稿或报告。
6. Rust loopback、前端动态测试和真实 Windows Tauri E2E 分别证明 socket 关闭、信号传播、SQLite 终态、无迟到副作用、零外网和零残留进程。

明确不在本版本处理：旧 AI 面板与其他独立 AI 工具的通用取消、流式输出、不确定步骤自动续跑、质量历史重放、新 migration 和 Agent 自主写入。

### v2.1.7 单一版本目标

本版本只收敛章节质量历史的不可变事实、当前工作流状态和可追溯重放：

1. 每次 completed 报告保有独立 item；相同 `issue_key` 不得搬移、覆盖或改写旧快照。
2. report、全部 items、当前 states 和 completed 终态使用同一 SQLite 事务；第 N 条失败整笔回滚。
3. 当前状态以 `(chapter_id, issue_key)` 独立存储；历史 item 只读，旧报告迟到不得覆盖较新 completed 报告的状态。
4. 新报告必须绑定归属匹配、类型正确且已成功的质量 AI Task；重复 key、错误目标或错误 Task 整笔拒绝。
5. 质检面板可列出 completed 历史并按 report ID 只读回放；默认查询不受 pending / failed 报告遮挡。
6. 完整备份升级 schema 3 保存质量 states，同时在恢复事务中兼容 schema 2；Rust、前端和真实 Windows Tauri 动态测试共同证明原子性、迟到竞态、应用重启重放、零外网和零残留。

明确不在本版本处理：不确定步骤自动续跑、execution lease / operation ID、旧 AI 面板与其他工具的通用取消、Planner、Memory、新领域模型和 Agent 自主写入。

### v2.1.8 单一版本目标

本版本只收敛章节总结、上下文和角色状态在桌面端的持久化一致性：

1. 桌面 Tauri 模式以 SQLite 为唯一事实源；总结、上下文和角色状态的 IPC 失败必须显式返回，禁止静默降级到 LocalStorage。
2. 上下文记录保留调用方生成的稳定 ID，并提供按 ID 读取、完整更新、过期和删除；章节总结支持按作品稳定查询每章最新记录。
3. 总结确认将章节总结、上下文记录、角色状态、角色当前状态和章节 `summarized` 终态放入同一 SQLite 事务；作品、章节、已采用草稿和角色归属不一致时整笔拒绝。
4. 旧 LocalStorage 总结、上下文和角色状态按精确 ID 或确定性镜像匹配幂等迁移；歧义数据保留并告警，只有已确认提交并映射的记录才在事务后清理。
5. 浏览器开发模式继续使用 LocalStorage，但多步保存失败必须补偿回滚；该回退不作为桌面发布行为或 SQLite 事务的替代证据。
6. Node、Rust 和真实 Windows Tauri 动态测试分别证明桌面失败不写缓存、浏览器补偿、事务回滚、ID 稳定、迁移幂等，以及保存 / 重启 / 过期 / 再重启后的生成排除。
7. 版本同步、完整验证和发布脚本共同阻断元数据漂移、测试失败、桌面 E2E 失败、生产构建失败或脏工作树发布。

明确不在本版本处理：数据库结构变更、跨 SQLite / LocalStorage 的分布式事务、自动续跑、Planner、Memory、v2.2 / v2.3 功能、新领域模型和 Agent 自主写入。

### v2.2.0 单一版本目标

本版本不扩展 AI 创作能力，只完成写作工作区可靠性闭环：

1. v2.2.0 新结构全部通过带 checksum 的正式迁移账本升级，旧数据库和旧正文保持兼容。
2. 长正文 document、chunks、草稿引用和 operation 记录进入同一事务；重试复用 `operationId`。
3. 完整正文读取进行分片、长度、哈希、状态和引用校验，失败时进入 `unavailable`，预览不得编辑。
4. dirty 正文形成与作品、章节和基础草稿绑定的恢复快照；恢复冲突不得覆盖新版本。
5. 章节操作、Hash 路由、程序导航、历史导航和 Tauri 关闭共用一个可防重入的 Leave Guard。
6. Vitest / React Testing Library 与临时 SQLite 故障注入覆盖 T01～T12、DB01～DB16。

明确不在本版本处理：AI 创作能力扩展、统一 AI Task / Artifact、自动续跑、Planner、Memory、Multi-Agent、自主写入和 v2.3 功能。

### v2.2.1 单一版本目标

本版本不扩展 v2.2.0 功能范围，只关闭发布后竞态审查确认的三条可靠性缺口：

1. 原子保存事务必须返回可信写入类型；只有后端明确报告 `forked_from_adopted` 时，更新请求才允许返回新的候选草稿 ID。
2. 恢复候选使用跨会话稳定的 operationId，并在再次操作前识别相同目标、note、正文与 hash 的已提交候选；completed replay 必须权威复验目标，失效时保持首次 operation 与恢复快照不变，清理失败不得制造副本或误报成功。
3. 原生关闭调用失败必须撤销一次性 bypass；第二次关闭仍需阻断并重新执行正文/章节目标保护。
4. 动态测试必须覆盖两个采用顺序、恢复清理失败后重进，以及 close reject 后再次关闭；发布前执行完整 Windows Tauri E2E 和安装包构建。

明确不在本版本处理：Provider 协议、真实 AI 调用、统一 Task / Artifact、自动续跑、Planner、Memory、Multi-Agent 和自主写入。

### v2.3.0 单一版本目标

本版本只建立后续 Agent 化能力共同依赖的统一执行事实层：

1. 新增 AiTask、AiTaskAttempt、三类 Snapshot、ResultArtifact 和 ArtifactValidationIssue 七类持久模型；Legacy AI 记录原样保留且不伪造新事实。
2. Task 与三类 Snapshot 在一个 SQLite 事务中创建；Rust canonical requestHash 完整覆盖目标、schema、正文/上下文/Prompt hash、compiler/budget 与预期 Artifact 契约。
3. Attempt 通过联合身份、state revision CAS、单 Task 单 live Attempt、一次性 Provider 身份和稳定重放隔离并发、重试、取消与迟到响应。
4. Artifact 来源由持久 Task / Input Snapshot 派生，raw hash/length 与 Provider response identity 强绑定；解析失败仍保存完整原始结果。
5. Snapshot、Artifact、ValidationIssue 以及它们引用的大文本建立引用后不可篡改；普通 JSON 和日志不保存正文、Prompt、Provider raw body 或凭据。
6. 受控 IPC 和前端薄 facade 支持应用重启后读取 Task、全部 Attempts、三类 Snapshot、全部 Artifacts 与 Issues；浏览器模式不伪造 SQLite 持久层。
7. 空库、v2.2.1、真实用户数据库隔离副本、重复启动、checksum 冲突、事务回滚、并发、重放、不可变和重启读取均由动态测试证明。

明确不在本版本处理：生产 Provider Adapter 迁移、真实 AI 调用、Planner、Memory、Tool Registry、自动续跑、Placement / ApplyPlan、Multi-Agent、UI 重做和 Agent 自主写入。

### v2.3.1 单一版本目标

本版本只把第一批生产 AI 调用接到 v2.3.0 执行事实层：

1. 新增统一 Provider Adapter，继续复用现有 Tauri HTTP、超时和可靠取消实现；API Key 与 Base URL 只作为瞬时配置，不进入 Task、Snapshot、Artifact、metadata 或日志。
2. 桌面执行固定经过 create Task/Snapshots → queue → claim → Provider → response identity → Artifact；提交未知只重放幂等持久化步骤，不自动重复 Provider 网络调用。
3. 相同 operationId 已完成时直接读取首次 Artifact，不再次调用 Provider；浏览器开发回退明确标记为 ephemeral，不伪造 SQLite 事实。
4. 设置中心连接测试迁移到 system Task + `generic_text` Artifact，输出预算限制为 8 tokens。
5. “设定补充”迁移为只读 `setting_candidates` Artifact；候选不会自动写入正式设定，仍由用户显式确认采用。
6. Mock 桌面 E2E 必须证明 Task、Attempt、三 Snapshot、response metadata、Artifact 与候选未采用边界；真实 API 只执行一次低输出连接验收。

明确不在本版本处理：其他生产 AI 入口迁移、业务对象来源链接、Placement / ApplyPlan、Planner、Memory、Tool Registry、自动续跑、Multi-Agent、UI 重做或 Agent 自主写入。

### v2.3.2 单一版本目标

本版本只建立 `setting_candidates` Artifact 到一条正式世界设定的安全应用边界：

1. 每条可用候选建立不可变 `PlacementProposal`，绑定 Artifact、候选 index/hash、预分配目标和目标不存在的 version/hash 前置条件。
2. 每个 Proposal 建立一个只包含 `create world_setting` 副作用的 `ApplyPlan`；计划内容不可变，状态只能按合法边推进。
3. 用户点击确认时记录 `confirmedBy=user` 与确认时间；世界设定、`ArtifactTargetLink` 和 Plan applied 状态在同一 SQLite 事务中提交。
4. 相同 operationId 重放返回首次目标和链接，不重复创建业务对象；目标 ID 碰撞记录 conflict，不覆盖已有数据。
5. 已应用目标重放时重新校验完整业务对象 hash；目标被修改、删除或来源链接异常时返回稳定错误并失败关闭。
6. 浏览器 ephemeral 候选不伪造 Proposal、Plan 或 TargetLink，也不能进入正式采用路径。

明确不在本版本处理：其他 Artifact 类型或 AI 入口迁移、批量/多目标 Apply、Planner、Memory、Tool Registry、自动续跑、Multi-Agent、UI 重做或 Agent 自主写入。

### v2.4.0 单一版本目标

本版本只建立可复现 AI 编译协议与受控工具注册边界：

1. 正式 `Context Compiler` 冻结来源 type/id/version/origin/hash、稳定顺序、缺失来源、截断状态和 UTF-8 bytes/3 预算；同一输入必须跨调用得到相同 Context 与 manifest hash。
2. 正式 `Constraint Compiler` 冻结 Artifact/response schema、业务约束、Prompt template identity/hash、Provider options 与 Tool Registry policy。
3. `compiled_ai_execution_v1` 把实际 Provider messages、三类 schema v2 Snapshot、requestBodyHash 与 compilationHash 绑定为一个契约；API Key 和 Base URL 不得进入契约。
4. 连接测试和“设定补充”迁移到正式编译策略；后端创建 Task 前复算 Context、Constraint、Input、模板、消息、预算和 Registry identity，篡改失败关闭。
5. 版本化 `tool_registry_v1` 注册八个真实读取/本地验证工具，验证 name/version、input/output schema、allowlist、权限、scope、超时与副作用策略。
6. 当前生产 Provider 任务固定 `allowedTools=[]`；副作用工具必须声明用户确认策略并由权威持久计划复验确认字段，调用方自报不能直接授权执行。
7. 不新增数据库 migration，复用三类 Snapshot 的 `schemaVersion=2` 和既有不可变大文本存储。

明确不在本版本处理：Planner、execution lease、checkpoint、自动重试/续跑、跨重启计划恢复、长期 Memory、新增业务副作用工具、Multi-Agent、UI 重做或 Agent 自主写入。

### v3.0.0 单一版本目标

本版本完成受审核的长篇 Multi-Agent 自主创作闭环：

1. Orchestrator 同时调度情节、角色、设定、逻辑、语言和整体质量六类专家；生产 API 模式调用真实 Provider，Mock 模式返回确定性协议结果。
2. 每个专家输出受校验的 score、accepted、summary、issues 与 suggestions；格式错误形成失败意见，不伪造低分成功结果。
3. 共识由最小成功专家数、接受率和平均分共同决定。Rust 持久化服务根据原始意见独立复算 `accept / revise / regenerate`，拒绝客户端伪造。
4. `revise / regenerate` 调用主编 Agent 生成新的未采用草稿，下一轮读取该草稿的完整正文；最多三轮，达到上限后明确返回未接受状态。
5. migration 021～023 保存 session、round 与 opinion。operationId 重放、轮次单调、草稿归属、token 汇总和终态均在 SQLite 事务中校验。
6. 工作台“协作”面板支持专家组合、轮数、阈值、取消、历史回放、逐轮意见与显式候选载入。
7. Plot Planner、Character Evolution、World Builder、Conflict Generator 和 Pacing Controller 从小说 Brief 建立故事圣经、人物弧、世界、冲突和逐章节奏；Chapter Batch Planner 按卷生成 12～500 章计划。
8. 用户确认计划后，Rust 原子物化卷、章、角色、世界设定、冲突事件和章节角色关系；重复应用会复验全部目标。
9. 逐章执行将章节工程生成与六专家评审串成未采用候选；用户采用后推进下一章，并生成待确认章节总结、人物变化和世界扩展候选。
10. migration 024 持久化自主计划、检查点和逐章状态；项目备份 schema 5 同时包含 Multi-Agent 事实和自主计划，schema 2/3/4 保持兼容。
11. 所有创作 Agent、专家与主编 Prompt 独立保存在 `prompts/`，代码只负责组装上下文和验证结构化返回。

v3.0.0 初始单一目标已支持用户显式启动、可暂停 / 继续的进程内逐章候选队列；该目标当时明确不处理候选自动采用、跨进程 / 无人值守自动续跑、向量语义 Memory、模型自主 Tool Calling 或世界候选自动采纳。后续集成收口新增的 Scheduler 与 SQLite 混合语义 Memory 以本节后面的现状表为准。

### v2.5.0 历史版本目标

本版本只建立正式、持久、可恢复的章节准备度计划：

1. Rust 权威构造 `chapter_readiness_plan_v1` 六步稳定 DAG；Plan 创建以 operationId + canonical requestHash 幂等，前端不能提交任意计划。
2. migration 015～020 持久化 Plan、Step、依赖、append-only Attempt、execution lease 与 append-only Checkpoint，身份和合法状态边由 SQLite 约束与 trigger 保护。
3. 每个 Step 绑定生产 Registry hash、Tool identity、input/output schema hash、权限、scope、arguments/hash；TypeScript Executor 在每次 claim 前复验完整契约。
4. Rust lease 保存 owner、单调 epoch、expiresAt 与 token SHA-256；原始 token 只瞬时交给 Executor，同 Plan 同时最多一个 active lease。
5. 工具失败形成单个 failed Attempt 并进入 `waiting_retry`，不自动重试；只有显式用户 retry operation 才创建后续 Attempt。
6. 应用启动把中断 Attempt 标为 abandoned、Plan/Step 标为 waiting_retry、lease 标为 expired，并记录 `automaticReplay=false` checkpoint，不静默重放 Tool。
7. 新增 `verification.check_readiness@1`，生产 Registry 共九个只读/本地验证工具；工作台卡片可创建、运行、查看和显式继续计划。
8. 浏览器开发模式不伪造持久 Plan；本地只读链路不改 Prompt/Provider 协议，因此本版不调用真实 API。

明确不在本版本处理：长期 Memory、正文副作用、动态 Planner、自动重试/续跑、Multi-Agent、Agent 自主写入或 UI 重做。

### v3.0.0 之后

#### 当前工作树中的 v3.0.0 集成收口（尚未发布）

下表描述 v3.0.0 发布候选工作树的实际状态；正式完成仍以全量门禁、Windows 安装包和真实桌面 E2E 为准：

| 优先级 | 版本目标                                     | 当前状态                                                                                                                                                                        | 尚需发布证明 / 后续边界                                                             |
| ------ | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| P0     | 全产品可靠取消、请求所有权、usage 与成本计量 | **已实现**：所有生产生成入口传播 signal/owner，迟到响应隔离；migration 029 以 SQLite 全局 reservation、request-bound lease 和幂等结算统一跨进程速率/并发及每日 Token/成本硬预算 | 成本是冻结单价的 USD 估算，不等同 Provider 最终账单                                 |
| P0/P1  | 真实 Provider 流式事件与安全预览             | **已实现**：浏览器与 Tauri 解析真实 SSE，校验 sequence/UTF-8/usage/完成标记；delta 只进入瞬时预览，完整响应后才原子保存候选                                                     | Provider 不支持 SSE 时使用受控非流式路径；更多 Provider capability 元数据可继续增强 |
| P1     | 参考资料库、分层风格画像、混合语义 Memory    | **已实现**：TXT 版本库、六层采样、画像来源、adopted draft 绑定、同事务失效、FTS + 显式向量混合检索和审计均已完成                                                                | EPUB/PDF/OCR/Markdown/DOCX、自动 embedding、增量向量化、模型重建与召回评估后续增强  |
| P1     | 跨进程无人值守调度与三档自动化策略           | **已实现**：migration 027 持久 run/lease/attempt/checkpoint、heartbeat、CAS、恢复、预算/熔断，以及 `draft_night / quality_gate / full_auto`                                     | 发布前继续以故障注入和桌面 E2E 证明重启、采用前复验与停止边界                       |
| P2     | 多目标事务、跨章节批处理、势力与地点正式资产 | **已实现**：migration 028 提供目标集合 hash、base CAS、事务回滚、幂等重放、reviewed-partial 批处理和九张正式资产/关系表                                                         | 正文批量改写仍遵守候选/草稿/采用边界；更多资产种类后续扩展                          |

- v3.1.x：自动 embedding Provider、采用后增量向量化、模型/维度迁移重建、固定召回评估集，以及 EPUB/PDF/OCR/Markdown/DOCX 参考资料。
- v3.1.x 后段：角色/关系/冲突/伏笔/节奏/视角/时间线/质量趋势的全书分析工作台，并以项目驾驶舱统一显示创作阶段、候选状态和 readiness/预算/Memory 阻断。
- v3.2.x：Windows 托盘/定时唤醒、锁屏/睡眠/断网恢复、凭据生命周期、次日审核收件箱、失败摘要、通知与长时间耐久验证。
- v3.3.x：正文候选批处理编排、逐章 diff/审核/事务采用/undo，以及势力关系图、地点图/地图、时间线和旧世界设定迁移向导。
- v3.4.x：冻结 allowlist 与确认协议下的模型自主 Tool Calling；DOCX/EPUB/PDF 出版、分卷导出、投稿模板、最终校对和全书统计。

---

## 6. Agent Runtime 阶段

```text
v1.0.44 Agent Workflow Runtime 最小闭环 ✅
v1.0.45 项目开发辅助 Skills 增强版 ✅
v1.0.46 Tool Layer 接入真实项目读取 ✅
v2.5.0 持久 Planner / Tool Calling / lease / checkpoint ✅
v2.6.1 文档规范化（未形成独立 Memory 实现）
v3.0.0 全书自主规划 / 六专家评审 / 受审核逐章推进 ✅
v3.0.0 P0 取消 / 请求 owner / 流式安全预览 / 成本硬预算 ✅
v3.0.0 参考资料 / 分层风格 / 混合语义 Memory ✅
v3.0.0 migration 027 持久后台调度 / 三档无人值守策略 ✅
v3.0.0 migration 028 多目标事务 / 跨章节批处理 / 势力与地点正式资产 ✅
v3.6.0 Phase 1A-A/B/C/D Catalog / Facade / Projection / Manifest ✅
Canonical Agent exposure：4 项只读 Tool 放行（health: working, exposure: stable）✅
R4 真实 Main Agent Runtime：仓内只读闭环已证明；live 云端验收 IN PROGRESS（NOT VERIFIED）
```

v3.0.0 默认边界仍是“Agent 自动规划和生成候选，正式副作用由用户审核”。只有用户显式选择 `full_auto` 且冻结预算、专家阈值、lease/CAS 和采用前目标复验全部通过时，调度器才可正式采用；夜间草稿和质量门禁策略不越过确认边界。多目标事务同样要求冻结候选与显式批准集合。

这里的“混合语义 Memory”专指 migration 026 建立的 SQLite 长期事实：`memory_documents / memory_chunks / memory_embeddings / memory_retrieval_logs`。`NovelMemoryManager` 与 `NovelMemoryStateUpdater` 使用进程内 `Map`，重启即丢失，只是兼容/实验运行态，不能作为长期 Memory、重启恢复或 Canonical `memory.search` 已稳定放行的证据。

---

## 7. v3.3.0+ 对话式并发创作工作台路线（当前版本：v3.7.0；功能基线：v3.6.0）

v3.3.0、v3.4.0 与 v3.5.0 的工作台、审阅和 UI 收敛已经落地；v3.6.0 版本基线完成 Agent 能力契约校准，同时保留后续放行门禁。

### v3.3.0：工作台最小闭环 ✅

**单一版本目标：建立可真实使用的任务对话与并发候选生成闭环，不删除旧工作台能力。**

- 创作工作台成为默认首界面；
- 小说项目 / 任务树与持久任务对话；
- 任务级模型选择和运行时模型快照；
- 至少两个任务可独立并发、切换和取消；
- `novel.read_context`、`chapter.read_outline`、`search_memory`、`generate_chapter` 内联显示；
- 工具失败在发生位置报错；
- 通用产物卡片形成、持久化与查看；
- 当前插件只读视图：从 Runtime Registry 分类显示功能、模型和其他已加载插件及其能力；
- 审计当前固定 DSH commit 与参考源码的 Agent Loop、Session、Tools、Compaction 和 Plugin API 差异；
- 建立 ANS DSH Adapter、最小 Headless Bundle、任务 Session/Agent 映射和至少两个活动任务的 Worker 隔离；
- 旧写作工作台和旧功能入口保留为回退路径。

**版本边界：** 不在 v3.3.0 同时删除旧 AI 面板，不扩展所有领域任务，不建设通用软件工程 Agent；当前插件只读显示不扩展为安装、卸载、启停、配置、更新或插件市场；不完整 Fork 或嵌入 Harness UI，也不在本版本顺带升级固定 DSH commit。

### v3.4.0：确认、应用与章节审阅闭环（章节链路完成；通用结构化应用当时未开放，v3.6.0 起按白名单开放）

**单一版本目标：让对话产物通过可审计决定进入正式小说事实。**

- 产物确认、拒绝、修订与 append-only 决定事实已落地；
- 章节候选通过 `ReviewAuthorization` 进入审阅，并由单一 Rust/SQLite 事务消费授权、复验草稿版本/hash、采用正文和收敛任务状态；
- 本版本内通用结构化 `request_apply` 尚未开放（桌面端固定返回 `STRUCTURED_APPLY_ATOMIC_UNAVAILABLE`，浏览器返回 `BROWSER_APPLY_UNSUPPORTED`）。该限制已在 v3.6.0 基线解除：桌面端对白名单 `outline / character_candidates / event_candidates / setting_candidates / chapter_summary` 与精确 `generic_json`+`context_compression` 在同一 Rust/SQLite 事务内执行“领域写入 + `ArtifactDecision`”，其余类型与浏览器回退继续失败关闭且零领域写入；
- 基线 revision 漂移和同目标并发冲突提示；
- 审计报告转后续修复任务；
- 任务恢复、失败重试、Provider 与预算反馈；
- 等价验证完成后，移除导航和作品详情中的重复“待确认”入口。

**版本边界：** 不把确认简化为前端状态，不允许 AI 候选绕过人工审阅直接成为正式正文。

### v3.5.0：领域任务扩展与旧工作台收敛 ✅

**单一版本目标：迁移剩余小说 AI 能力，并把原写作工作台稳定收敛为人工审阅/编辑器。**

- 扩展大纲、人物、设定、风格、输出控制、上下文、总结、检查和润色任务；
- 通过稳定能力接口增加或替换领域 Provider，包括小说上下文压缩实现；
- 增强同项目并发、目标锁、任务恢复与跨任务冲突处理；
- 删除已经由任务工作台稳定替代的旧 AI 面板和草稿版本查看入口；
- 保留卷章树、正文阅读、必要章节信息、显式人工编辑、保存和采用；
- 使用迁移清单、回退测试与用户可发现性检查确认没有能力丢失。

**版本边界：** 底层领域服务、审计事实和历史草稿不因 UI 删减而自动删除。

### v3.6.0：Canonical 只读契约与准入状态（功能基线）

- Phase 1A-A Capability Catalog、1A-B Domain Facade、1A-C Canonical Projection、1A-D 共享 portable Manifest/跨语言漂移门禁均已完成；
- `novel.read / structure.read / context.read / memory.search` 仍全部是 `catalog_only + partial`，`modelVisibleToolIdentities=[]`，公开 Agent 执行入口失败关闭；
- 下一门禁是分别关闭四项 Facade blocker：作品设定/主角/JSON 与表事实源、结构 version/active/CAS、summary/context bundle 来源协议、Memory embedding/混合检索证据；
- 四项 blocker 关闭后，必须以独立 exposure 变更和回归证据放行只读 Tool，不能把 legacy DSH allowlist 改名冒充迁移；
- exposure 门禁通过后才进入 **R4：真实 Main Agent Runtime 验证**；Writing SubAgent 与其他 SubAgent 继续后置。

### v3.6.1：SQLite 安全与 Runtime 固定模型恢复补丁

- bundled SQLite 升级到 3.51.3，并固定 WAL、外键、5000ms busy timeout 与 `synchronous=FULL`；
- 历史任务继续冻结原模型身份，显式无效快照不再改探默认模型；
- 新任务捕获当前设置模型，旧任务不可用时保留草稿并提供安全的新任务恢复路径；
- 后台按冻结模型刷新 Runtime 目录时不得覆盖新任务创建器的前台模型投影；远程模型缺失本次应用会话凭据时探测与发送失败关闭并保留恢复入口，loopback 无密钥模型仍可用；
- 结构化产物决定后的章节刷新与资产结算位于 `src/features/workbench/`，生产页面满足 500 行门禁；
- Release tag 的复用工作流必须执行完整 Windows 桌面 E2E，补丁不放行 Canonical 或 Main Agent 新能力。

### v3.6.2：Canonical 只读链路与桌面体验收口补丁（已完成）

- 会话模型凭据 DPAPI 持久化、产物卡片候选选项解析、中心页面与作品详情 UI 风格统一、AI 任务清空外键修复、作品详情新建异常修复；
- Canonical catalog/manifest 四项只读 Tool 放行 `stable` + `working`；DSH `read` 回合在 start 契约、Worker 环境与工具授权三处一致注入 Canonical-only allowlist，Gateway `tools/list` 随之列出四项 Canonical 名；
- 仓内 loopback E2E 证明只读回合零产物、零采用、章节字数不变、零凭据泄漏；R4 文档口径同步收口，live 云端验收仍 NOT VERIFIED，判定标准见架构文档 §14.5；
- 不放行 Writing SubAgent / `chapter_write` 走 DSH；结构化写入维持 Safe Apply 失败关闭与显式审核不变式。

### v3.7.0：Writing SubAgent 开放与 ZCode 工作台（当前版本）

- 桌面 Agent 工作台重构为 ZCode 形态（深色优先中性令牌、常驻标签栏与自绘标题栏、分组侧栏、悬浮输入卡、右侧可内联打开的创作上下文 / 本任务产物 / 运行日志面板），资源中心五页、设置卡片、作品详情卡片统一为类驱动规格，浏览器布局基线重标；
- Writing SubAgent 正式开放：桌面端 + 真实 API 模型的 `chapter_write` 默认经 DSH `chapter_write / chapter_polish` 任务类型执行，allowlist 收窄为四个只读工具 + 唯一候选工具，宿主校验章节绑定、必需读取、字数硬区间与 candidate-only 契约；mock / 本地模型、浏览器模式走确定性 Writer，`localStorage` 置 `0` 可关闭。放行依据：E-4a 客户端 Gemini 卡片正向真实验收、E-4b 六个负例/恢复故障注入场景（越权工具、跨书候选、上游瞬时/持续失败、字数越界、进程强杀后重启恢复）全部通过；
- 审计缺口收口：GAP-10（apply 策略单一来源）、GAP-11（大纲 ownership 校验）、GAP-15（migration 037：用户模板/设定建议 SQLite 事实源，导入资产/润色记录命令化）、GAP-16（TXT 导入单事务）、GAP-18（migration 038：任务运行持久化章节目标，失败运行可安全重试）、GAP-19（重试提示显式要求本回合重读）；
- 新增 opt-in 生产载体：真实配置验收（复用客户端模型卡片与 DPAPI 保管库，密钥不出应用）与隔离配置故障注入验收（回环脚本上游，零网络零凭据）；
- 仍未放行：R4 live 云端只读验收（NOT VERIFIED）、SubAgent 预算内自动修正回合（完整性问题目前以助手回合提示 + 人工「要求修改」处理）、需要新依赖的 EPUB/PDF 参考格式、系统托盘与出版导出。

### Next / R4：Canonical Catalog 已放行；仓内只读闭环已证明，live 云端验收进行中

- **Canonical catalog/manifest exposure（已完成）**：4 项只读能力（`novel.read@1`, `structure.read@1`, `context.read@1`, `memory.search@1`）健康度 `working`，exposure `stable`，共享 Manifest 的 `modelVisibleToolIdentities` 长度为 4。v3.6.0 基线当时仍是 `catalog_only` + 可见数为 0，那是历史状态。
- **R4 仓内只读闭环（已证明）**：`read` intent 请求 Canonical-only allowlist；宿主 `dsh_start_task_turn` 在 start 契约 `allowedTools`、Worker 环境 `ANS_ALLOWED_TOOLS` 与工具授权三处一致注入 Canonical 名，Gateway `tools/list` 随之列出 `novel.read / structure.read / context.read / memory.search`；Rust loopback E2E 经真实 Worker 启动链证明模型自主调用四个 Canonical 只读工具、零产物、零采用、章节字数不变、零凭据泄漏。候选与审计回合保持 legacy `ALLOWED_TOOLS` 不变；`mainAgentRuntimeService` 启发式脚手架不是 R4 证据。
- **R4 live 云端验收（进行中，NOT VERIFIED）**：真实云端 Provider 只读回合尚未验收；判定标准（前置凭据、opt-in cloud profile 执行、通过条件与脱敏证据要求）见 `docs/architecture/conversational-creative-workbench.md` §14.5。标准满足前不得宣称 R4 VERIFIED。
- **后续规划**：Writing SubAgent 与桌面 + 真实 API 的 `chapter_write` 已于 v3.7.0 开放；Context / Quality 等其余状态变更 SubAgent 继续后置。结构化写入继续维持 Safe Apply 失败关闭与显式审核不变式。
- **结构化写入边界加固（已随 v3.7.0 落地，审计 GAP-10/11）**：前端“可应用类型 / 章节作用域 / 目标解析”收敛为单一策略源 `src/services/conversation/structuredApplyPolicy.ts`，与 Rust `validate_static_scope` 的白名单和 `expected_target` 一一对应；大纲写命令 `save_master/volume/chapter_outline` 改为事务内校验作品存在且未删除、卷/章节/上级纲要属于同一作品，不匹配返回 `OUTLINE_SCOPE_MISMATCH` 且零写入。

详细产品、UI、运行时和数据边界见 [`architecture/conversational-creative-workbench.md`](architecture/conversational-creative-workbench.md)。当前文档记录 v3.7.0 Writing SubAgent 与 ZCode 工作台、v3.6.0 功能基线、Canonical catalog exposure、R4 仓内只读闭环证据，以及 live 云端验收仍未完成的真实边界。当前缺口对照见 [`feature-gap-analysis-v3.7.0.md`](feature-gap-analysis-v3.7.0.md)。

<a id="next-version-proposals"></a>

### 下一版本总体规划（2026-09-27，规划／未实施）

> 本轮执行范围校正：用户随后明确选择先完整修复 v3.7.0 的现有缺陷，生产持续学习另项实施；下方 v3.8.0 的完整学习规划保留，不据此扩大本次开发。R4 受控 cloud 执行入口已在本次修复中补齐，但实现和离线测试不代表 live VERIFIED；本轮实际验收以审计修复报告为准。

按用户最新要求，撤销将独立诊断、联网研究、策略实验、持续优化拆成四个版本的建议，**统一纳入一个建议版本 v3.8.0**，同时治理现有核心创作流程的功能缺陷。下文 W0～W7 是同一版本内部的工作包，不是分期发布；只交付诊断或知识库不能算本版本完成。不预排其他版本号，也不为本次规划另设过渡补丁。

应用仍为 v3.7.0；本次仅修订规划，不授权功能开发、真实模型/搜索服务调用、数据库迁移或发布。机制与研究依据见 [AI Agent 路线图第 9 节](ai-agent-roadmap.md#writing-self-improvement)，缺陷状态和证据统一维护在 [2026-09-27 总体复核台账](feature-gap-analysis-v3.7.0.md#gap-review-20260927)。

#### 一、目标、基线与范围

**单一版本目标：让现有长篇创作主流程稳定可用，并让生成后的诊断、联网学习和验证过的策略真正改善后续写作，形成可恢复、可回滚的完整闭环。**

- **现有能力优先保住**：作品/资产准备 → 任务生成 → 候选修订 → 审阅/保存/采用 → 总结与 Memory → 下一章，以及导入、备份恢复和模型配置。总体规划不能只增加新的 Agent 而留下原有入口断链。
- **本版完整新增闭环**：精确候选 → 独立专项诊断 → 问题聚合 → 联网研究 → 条件化知识卡 → 策略实验 → 盲评/留出/非退化验证 → 晋升或淘汰 → 下次生成使用 → 观察与回滚。章节和作品复盘均可触发，但不要求每次生成都搜索、不承诺每次都变好。
- **证据基线**：2026-09-09 缺口表是历史截面；[收尾报告](../reports/closeout-2026-09-18.md) 已于 2026-09-26 记录适用本地、Rust、桌面和无安装包 EXE 验收完成。旧“待统一验收”文字不能用来重开已修复问题，也不能拿历史通过覆盖未来改动。
- **R4 是本版准入门禁，不是另一个版本**：当前 live 云端仍 NOT VERIFIED；`test-agent-runtime-real.mjs` 只执行 loopback，cloud profile 执行路径还要实现，再经授权完成真实只读验收。不能把 Writing SubAgent 的历史写章证据替代 R4，也不能在 R4 未满足时放行新的生产 Agent 能力。
- **已有自动修正不重做**：有界字数修正已存在；本版补的是独立语义诊断、受限修订和跨章节学习。实验 Harness 规则评分、六个角色和进程内 Map 都不等于生产学习闭环。

范围分三类：确认的核心缺口列为必须完成；旧报告风险先复现再决定修复，不能凭 TODO 或文件行数宣称功能损坏；未承诺的产品扩展单列候选池，不伪装成已存在功能的 bug。台账中的 P0/P1/P2 是版内优先级，不是后续版本分割。

<a id="v380-independent-diagnosis"></a>
<a id="v380-integrated-plan"></a>

#### 二、v3.8.0 内部工作包与交付物

| 工作包                  | 必须完成的内容                                                                                                                     | 关闭证据                                                                               |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| W0 基线、契约与准入     | 冻结核心用户旅程、缺陷复现、角色/学习资产/授权契约、评价基准；补 R4 opt-in cloud profile 的安全执行路径                            | 每项有状态、责任模块、复现或非缺陷理由、对应测试；cloud 的未配置/拒绝/执行结果不混淆   |
| W1 现有功能与桌面体验   | 统一现有生成入口的任务、候选和采用语义；收口跨任务冲突反馈、失败重试与恢复；核对资产 CRUD、编辑保存、导入/备份和长篇使用体验       | 既有用户旅程贯通，冲突可理解可恢复，零正文丢失/串章/静默覆盖；已修项保留回归，不删功能 |
| W2 上下文与运行时可靠性 | 对齐 TS/DSH/Gateway 工具契约、候选工具命名语义与权限；核对读模型的来源/时序/范围，补 Gateway 与主程序语义对照、模型/插件可用性证据 | 两条 Writer 路径读到正确且可追溯的材料；清单漂移失败关闭；缺失/过期材料不伪装完整      |
| W3 独立诊断与修订       | Writer/Critic/Verifier 独立冻结配置；专项证据、覆盖/弃权、中文校准；受限修订后复核原问题和新增问题                                 | 独立性可见、候选/hash 精确绑定、主要问题可检出且误报受控；诊断没有正式写入权           |
| W4 联网研究与知识资产   | 从重复问题或明显知识缺口形成研究任务；受治理搜索/取证、来源追踪、去重、冲突/适用条件/反例、隐私与注入防护                          | 研究形成可追溯知识候选；断网/无结果可恢复；外部观点不直接变成生效规则或小说事实        |
| W5 策略实验与生产消费   | 版本化写作策略，固定基线/候选对照、独立盲评、留出集、非退化与成本判断；晋升/拒绝/回滚，并接入实际 Prompt/上下文编译                | 后续运行能证明用了哪一活动策略、哪些知识和为什么；无收益不晋升；两条 Writer 路径均接通 |
| W6 持久化与持续优化     | 诊断、知识、策略、实验、使用记录持久化并纳入备份；授权内自动触发、去重、预算、取消、重启恢复和过期策略治理                         | 重启不丢学习结果，本地结算与晋升幂等，外部结果不明不自动重发；停止与撤销授权有效       |
| W7 系统回归与效果验收   | 核心旅程真实桌面回归、故障注入接入适用门禁、受影响模块行为覆盖；授权后的 R4 live 与文学效果验证，文档和本地 EXE 收口               | 核心缺陷关闭、工程与真实效果证据分别达标；未验证项不标通过，不以隐藏新功能冒充完整交付 |

执行顺序是 W0 先冻结契约与基准；W1/W2 修复基础能力，W6 从一开始提供持久化/预算接缝；功能集成按 W3 → W4 → W5 → W6 的闭环验收，W7 贯穿回归并最终统一收口。可分支、小步提交和内部演示，但上述完整链路都属于同一发布单元，不自动开启下一版本。

#### 三、必须落地的实现约束

**现有功能治理（W0～W2）**

- [ ] 用缺陷台账的 G38 编号追踪问题：复现条件、环境/路径、用户影响、实际/期望结果、证据、修复位置、测试、关闭依据；未复现项写待核实，不提前宣称已坏或已修。
- [ ] 对工作台、自主创作、设定推演、大纲等现有入口建立能力等价表，统一底层任务身份、候选/正式状态和失败恢复。先接通再讨论导航收敛；任何删除另获明确授权并具备迁移/回退证据。
- [ ] 强化同章多任务、生成中修改规则/正文、保存成功刷新失败、取消后迟到结果、强杀重启等跨层场景；沿用既有 CAS/事务/幂等，不以 UI 禁用代替原生安全门。
- [ ] Canonical 四项只读能力已放行，不重做已关闭的准入；本版对新增或迁移的工具补单一契约及跨语言投影检查。旧工具名用兼容映射迁移，不直接破坏冻结任务、历史消息或扩大 allowlist。
- [ ] Gateway 与应用 Repository 先建立同一隔离 SQLite 数据集的语义对照，覆盖删除/active/version/章节顺序/时间范围/大文本；只抽取确实相同的只读逻辑，保留合法投影差异，不做全仓重构。
- [ ] 上下文评估使用关键事实召回、引用准确、未来信息泄漏与来源失效指标，不拿压缩率或向量数量当质量。现有结构/词法检索可作为基线；自动 embedding 仅在证实能改善基准且模型、费用和权限明确时引入，不作为伪造语义覆盖的捷径。

**自我迭代完整链（W3～W6）**

- [ ] 写作 A、诊断 B、按需复核 C 使用各自冻结的 Provider/模型/参数/作用域，优先不同模型家族；同模型窄范围检查须标记降级，不能是自动晋升的唯一证据。模型故障显示未检查，不静默让 Writer 自评顶替。
- [ ] 两条 Writer 路径、既有自主候选队列都进入共同诊断/策略接口；按人物因果、连续性、节奏对白、语言视角等检查，提供原文位置、依据、影响、优先级、保留项与不确定性。硬错误、叙事风险、审美建议和上下文缺失分开，允许无问题和弃权。
- [ ] 诊断和修订绑定 novel/chapter、artifact/hash、上下文及规则版本；原候选保留，修订产生新候选并复核。现有字数修正与新增语义修订共享明确的总轮数/时间/成本约束，不能多层重试放大调用量。
- [ ] 联网能力经独立受限研究接缝提供，复用请求治理，不把广泛网络权限交给 Writer。搜索服务、访问范围、费用、外发字段先明确；查询默认抽象化，不外发未公开全文/私有剧情。网页是资料而非指令，抓取/重试有界，防重定向越权和任意本机访问。
- [ ] 知识卡区分写作方法、现实事实和虚构设定，记录 URL/作者/日期、适用条件、反例与冲突；提炼方法而不复制作品。研究失败不伪造来源，不将知识候选直接注入生效规则。
- [ ] 实验固定模型、素材、上下文、题材目标与近似篇幅/成本，只改变少量策略；开发集、留出集和回归集隔离，盲评随机/交换顺序，必要时独立复核。先定指标、样本量与通过阈值，再跑实验，未冻结标准禁止自动晋升，不因结果不好改裁判或门槛。
- [ ] 策略状态至少区分候选、试验中、活动、停用/回滚；晋升绑定父版本、证据、作用域和有效授权，CAS/幂等处理并发。Prompt/上下文编译记录策略版本与使用回执，必须用后续章节实证，而非仅在策略列表展示成功。
- [ ] 生成后可自动诊断并累计问题；重复问题/知识缺口触发研究，作品阶段性或完结复盘聚合跨章节问题。用户一次授权可约束作品、主题、模型、搜索服务、金额/调用/轮数和自动晋升条件，无需每次手工反馈；普通写作和学习开关分离。
- [ ] 复用持久任务/产物和 Scheduler 的恢复语义，不把 Map/Store 当事实源。恢复前复验授权、预算、模型、基线与 lease/epoch，不能启动即无条件重发；外部请求结果不明时保守结算并等待核对，不承诺供应商账单的 exactly-once。备份恢复后旧活动策略须重新校验身份与兼容性，不迁移凭据或隐式恢复自动执行授权。

#### 四、拟修改落点与技术边界

以下是实施任务的候选落点，不是本次已创建或修改的代码：

| 文件或模块                                                                                                                      | 计划职责                                                                                  |
| ------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `src/types/qualityDiagnosis.ts`、`src/types/writingLearning.ts`（拟新增）及既有 conversation 类型                               | 诊断/知识/策略/实验/授权与版本绑定契约，旧任务兼容                                        |
| `src/services/quality/chapterDiagnosisService.ts`（拟新增）、`src/services/multi-agent/`                                        | 独立专项诊断、复核、校准，复用既有质量服务而非另造无关裁判                                |
| `src/services/research/`、`src/services/writing-learning/`（拟新增模块）                                                        | 受控联网取证、知识卡、策略候选、实验、晋升与生产策略解析；具体文件在契约冻结后细化        |
| `src/services/conversation/`、`src/services/dsh/taskSessionAdapter.ts`、`src/services/autonomous-creation/`、`src/services/ai/` | 双 Writer 路径及旧队列的统一接缝、角色模型、预算/取消/错误和任务恢复                      |
| `src/services/context/`、`src/services/memory/`、`src/services/prompt/`、`prompts/`                                             | 来源/召回、条件化策略检索、模板注册与编译、活动版本使用回执                               |
| `src/services/agent-tools/`、`src/services/capabilities/`、`contracts/`、`src-tauri/gateway/`、原生 DSH 服务                    | 工具单一契约、权限/exposure、只读语义对照、真实 Runtime 健康与准入                        |
| `src/features/workbench/`、既有工作台 hooks/报告卡片与设置组件                                                                  | 原入口故障收口；内联展示诊断/研究/实验/策略状态，来源定位、暂停与回滚，不新增后台式控制台 |
| `src-tauri/src/services/`、对应命令/Repository、任务调度与备份模块                                                              | 学习持久化、原生预算与幂等、恢复/备份；按受影响职责提取代码，不向超限文件继续堆叠         |
| `scripts/dsh/test-agent-runtime-real.mjs`、`scripts/quality/verification-scopes.mjs`、测试与 CI                                 | R4 cloud profile、变更归属、故障注入、命令/工具漂移回归、双路径与全流程验收               |

默认保持技术栈与固定 DSH，先复用已有依赖和服务；不预选新的搜索/向量库。持久化方案必须在 W0 评审：能复用的用既有正式契约，确需新增 migration/备份 schema 时取得明确授权，保留已发布定义/checksum；不能塞进任意 `generic_json` 或本机缓存来绕过持久化与写入白名单。模型/搜索服务选择、真实调用预算和新增依赖属于实施前决策，当前规划不替用户作付费承诺。

#### 五、系统验收与版本完成标准

| 验收面           | 最低要求                                                                                                                                                                                                    |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 现有核心旅程     | 按[缺陷台账的旅程矩阵](feature-gap-analysis-v3.7.0.md#core-journey-matrix)覆盖正常、拒绝、失败、恢复和重开；所有确认的 P0/P1 缺陷关闭，风险项有复现结果与处置，不以“新功能可用”代替旧功能验收               |
| 工具与数据安全   | 跨作品/章/候选、过期基线、重复晋升/采用、伪造引用、未知类型、取消/迟到结果均失败关闭；研究/诊断/实验对正式正文与设定零写入，采用保留独立授权                                                                |
| 完整学习闭环     | 双 Writer 路径各有“生成 → 诊断 → 联网知识 → 对照实验 → 晋升 → 下一章实际消费”的证据，并覆盖无收益拒绝、策略回滚、模型版本变化、断网及预算耗尽；不能用录制搜索结果冒充真实联网                               |
| 持久化与恢复     | 诊断/知识/策略/实验/使用记录跨重启可查；任务不重复派发，备份恢复身份一致，活动版本与授权重新校验；涉及 migration 时验证新旧库升级、回滚与重开                                                               |
| 文学效果         | 中文分题材基准，含正常/缺陷/证据不足/有意留白；报告主要问题检出、误报、引用正确、原问题修复、新增问题、盲评胜/平/负、跨章节退化、延迟与成本。冻结阈值与留出集，真实模型校准另获授权；证据不足不宣称质量提升 |
| 桌面与运行可靠性 | 真实 Tauri + 隔离 SQLite + 固定 DSH/当前 Gateway；长篇数据、任务切换并发、强杀恢复、窗口缩放/2K、主题、键盘/IME、未保存离开均有适用证据；浏览器仅验证其声明回退能力                                         |
| 工程与准入       | 文档/版本同步、行为覆盖、lint/类型/构建、locked Rust 与适用完整领域检查；R4 live 和真实效果验证不得记为 NOT_RUN 后仍宣称完整版本达成                                                                        |

开发期间按 `npm run verify:change -- --dry-run` 选择范围，先运行直接行为测试、改动文件 ESLint/Prettier、一次类型检查；涉及 Rust 执行 locked check 和有非零匹配证明的测试，涉及共享持久化/DSH 则依[测试策略](technical/testing.md)运行完整相关 Rust 串行检查和真实 SQLite/桌面场景。覆盖率针对诊断、策略晋升、恢复等关键路径制定更强门禁，不仅提高一个全仓百分比；保留现有非回退约束。

关闭缺陷必须有对应行为或真实桌面证据；疑似旧问题若不能复现，保留环境/尝试范围，不假记为修复。搜索/真实模型资源不足时可以继续做本地工程验证，但完整交付应保持“未完成”，不能偷偷缩为只有知识库或评审器的版本。

最终同步 README、用户指南、Runtime/工作台、AI 治理/提示词、数据与备份契约、缺陷台账和 CHANGELOG。发布须另获授权并执行 `scripts/agent-workflow/verify_project.ps1` 完整矩阵，所有失败/跳过分开报告；开发交付按 AGENTS §7.6 更新本地 `AI Novel Studio.exe`。commit / push / PR / tag 仅依对应授权执行，普通文档规划不要求干净工作树或重建 EXE。

#### 六、不混入本版的扩展与禁止范围

- EPUB/PDF/DOCX 等新增导入格式、出版排版导出、独立全书分析大屏、地图/关系图/时间线和系统托盘常驻列为**无版本号候选池**；已有 TXT/备份/导出入口的真实故障仍必须修。作品复盘和必要诊断不依赖新增大屏。
- 自动 embedding 和 Provider 账单对账/SSE 能力协商按实测收益及是否阻断已支持模型评估；已有支持范围内的失败恢复属于修复，不以“未来增强”搁置。插件市场/管理不属于当前只读插件产品边界。
- 不训练模型权重、不无限后台运行、不默认跨作品推广私有策略，不让研究模型修改作者方向、世界规则、预算或正式采用权限。
- 不升级技术栈/固定 DSH，不批量重构历史大文件，不因入口收敛删除旧功能，不把所有审美问题升级为必须改写的硬错误。

若实施时必须调整上述完整闭环或核心缺陷范围，先向用户说明影响并取得决定；不能在工作包未完成时自动将剩余能力挪到下一版本。

---

## 8. 发布规则

稳定版本发布推荐命令：

```powershell
git status
git switch -c codex/vX.Y.Z-release
git add .
git commit -m "feat: complete vX.X.X ..."
git push -u origin codex/vX.Y.Z-release

# PR 审查和门禁通过并合并后
git switch main
git pull --ff-only origin main
git tag vX.X.X
git push origin vX.X.X
```

Agent 不应在用户未明确要求时自动提交、打 tag 或推送。
日常开发不得直接提交到 `main`，详细规则见 [`docs/project/git-workflow.md`](project/git-workflow.md)。

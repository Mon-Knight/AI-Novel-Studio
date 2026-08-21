# AI Novel Studio

> Windows 桌面端 AI 长篇小说创作工作台。用户控制方向，AI 分工生成，章节逐步采用，上下文持续沉淀。

---

## 1. 项目简介

AI Novel Studio 是面向长篇小说创作的 **Windows 桌面端 AI 写作工作台**。

它不是普通聊天机器人，不是网页后台管理系统，也不是一次性生成整本小说的工具。它的核心形态是：

```text
作品管理
→ 世界观 / 角色 / 规则 / 风格 / 事件资产准备
→ 章节写作工作台
→ AI 生成候选
→ 用户编辑、采纳、沉淀上下文
→ 继续下一章
```

长期愿景：**AI Autonomous Creative Platform（AI 自主创作平台）**。

---

## 2. 当前版本与定位

**当前版本：v3.5.0**

**阶段：对话式创作工作台与审阅收敛**

v3.0.0 从“单章协作评审”扩展为受审核的长篇自主创作系统：用户提交小说 Brief 后，Plot Planner、Character Evolution、World Builder、Conflict Generator 和 Pacing Controller 协作生成 12～500 章全书计划；计划确认后，用户可以显式启动、暂停和继续全书候选队列，系统按章生成候选、执行六专家评审，并在用户采用正文后提取人物变化与世界扩展候选。

应用默认进入创作工作台：小说项目下可创建持久任务对话；任务拥有独立模型快照、运行与取消状态，领域候选工具和产物卡片以内联方式显示。写作工作台保留为章节审阅、编辑、保存和采用入口。

**核心能力：**

- ✅ Multi-Agent Orchestrator 与六专家并行评审（v3.0.0）
- ✅ 共识、候选修订、SQLite 历史与工作台可视化（v3.0.0）
- ✅ 五类自主创作 Agent 与 12～500 章分层规划（v3.0.0）
- ✅ 逐章生成、评审、采用对账与章节收束确认（v3.0.0）
- ✅ 可暂停 / 继续的全书候选队列与工作台逐章二次编辑（v3.0.0）
- ✅ Chapter Readiness Planner Runtime（v2.5.0）
- ✅ AI Execution Facts & Compiler（v2.4.0）
- ✅ Provider Pipeline & Safe Apply（v2.3.x）

**技术栈稳定：**

- React 18 + TypeScript
- Tauri 1.x + Rust
- SQLite + Migrations（001-029）
- HashRouter + Vite 5

系统不会自动应用全书计划；夜间草稿与质量门禁模式也不会自动采用正文或沉淀章节分析，这些正式副作用继续保留用户确认。全书候选队列必须由用户显式启动，可暂停 / 继续，并由 SQLite Scheduler 通过持久 lease/epoch 在应用重启后接管；只有用户明确选择 `full_auto` 且冻结预算、专家阈值和采用前复验全部通过时，才允许自动采用与确认分析。

---

## 3. 当前核心能力

- **作品管理**：创建、编辑、删除小说作品，维护封面与基础元数据。
- **世界设定**：维护世界背景、规则体系、主角特殊能力。
- **分卷章节**：管理多卷结构、章节大纲与目标字数。
- **写作工作台**：左侧卷章节树、中间正文编辑区、右侧 AI 控制面板。
- **AI 正文生成**：基于世界设定、角色、事件、风格和上下文逐章生成候选正文；既可生成下一章，也可由用户启动全书候选队列。
- **独立本地章节模型**：可在设置中心配置 OpenAI-Compatible llama-server，仅将章节首次生成与 Autonomous 候选正文路由到本地 Scene 协议；改写、润色、质检等任务继续使用全局 Provider，服务不可用时不自动回退。
- **Scene/Beat 工程编排**：章节工程可用全局 Provider 生成待确认的 Scene/Beat JSON 候选；应用后，首次正文与 Autonomous 候选通过统一编排器按 Beat 串行生成，每个 Beat 独立执行一次单 user 本地调用并携带前一 Beat 状态胶囊，合并前执行连续性与 required Beat 校验；用户显式重跑失败章节时，可在冻结上下文和模型路线未变且当前门禁复验通过的前提下复用最长连续 Beat 前缀，从首个问题 Beat 继续。若旧作业因校验规则误判而失败，已正常完成的外部 Beat 修稿 Artifact 也会按当前规则重新裁剪、复验后参与该前缀，不重复调用模型。
- **多版本草稿**：AI 初稿、重生成稿、用户编辑稿、润色稿互不覆盖。
- **正文变更安全门**：AI 结果携带固定目标、来源草稿、基础版本 / 哈希与结果 ID；目标或基础正文变化时拒绝静默应用。
- **安全保存与采用**：草稿零行更新视为冲突；正式采用验证草稿归属，并在同一 SQLite 事务中原子切换正文及过期旧章节上下文。
- **大文本正文安全**：超过 100 KiB（100 × 1024 UTF-8 字节）的章节草稿进入 `large_text_documents / large_text_chunks` 分片保存，全文与逐片强校验；分片文档和草稿引用同事务提交，损坏读取失败关闭且不会用预览覆盖正文。
- **任务重启恢复**：章节工程任务重启后原子结算并保留已提交结果；恢复幂等、终态不可复活，也不会自动重发 AI 请求。
- **章节工程请求取消**：正文生成与质量检查可中止在途 Mock、浏览器 fetch 或桌面 HTTP 请求；取消、超时和迟到完成具有明确边界。
- **质量历史重放**：历次报告与问题保持不可变快照，支持只读回放、稳定排序、AI Task 追溯和当前处理状态分离。
- **长正文原子保存**：正文、分片、草稿引用与 `operationId` 幂等记录在同一事务中提交，已采用版本保持不可变。
- **完整性失败关闭**：分片数量、顺序、长度、哈希、状态或引用异常时，预览不会进入编辑器或 AI 上下文。
- **异常恢复快照**：dirty 正文按章节 debounce 持久化，恢复内容不占草稿版本，基线冲突时只能对比、复制、导出或另存候选。
- **统一离开保护**：章节操作、Hash 路由、历史导航、程序导航和 Tauri 关闭统一提供保存、放弃、取消决策并防重入。
- **可追踪基础设施**：正式 `schema_migrations` 账本、checksum 校验、结构化 `AppError`、`traceId` 与脱敏本地日志。
- **AI 候选安全应用**：设定候选通过不可变 Proposal/Plan、显式用户确认、目标 version/hash、单事务副作用和 Artifact 来源链接进入正式设定库。
- **正式 Context / Constraint Compiler**：按稳定来源身份、固定 UTF-8 预算、Prompt hash、Provider identity 和 canonical compilation hash 生成可复现请求，并由 Rust 在 Task 创建前失败关闭验证。
- **版本化 Tool Registry**：九个真实读取/本地验证工具具备冻结 schema、权限、novel/chapter/draft scope、超时和副作用声明；当前生产 Provider 请求尚不允许模型调用工具。
- **持久章节准备计划**：固定六步 DAG 由 SQLite 保存并在执行前复验 Registry/schema/权限/scope/参数 hash；Attempt 与 Checkpoint 可追踪，租约防止并发执行。
- **显式恢复与重试**：中断运行在启动时进入 `waiting_retry`，原 Attempt 标记 `abandoned`；只有用户明确点击继续才创建新 Attempt，不自动重放工具。
- **Multi-Agent 协作评审**：情节、角色、设定、逻辑、语言和质量专家并行评审同一草稿；单个专家失败不会阻塞其他结果，最小 quorum、防伪共识和最多三轮迭代由服务端约束。
- **候选修订闭环**：未通过共识时，主编 Agent 根据合并问题执行定向修订或重写，保存为新的未采用草稿；下一轮实际评审新正文，用户可在协作面板显式载入候选。
- **自主全书规划**：Plot Planner 先生成故事圣经、故事弧和分卷；人物、世界、冲突与节奏 Agent 形成可引用事实，Chapter Batch Planner 再把每卷切成最多 5 章的子批次。每批成功后立即保存章节计划与 CAS 检查点，继续时跳过已保存范围。300 章计划会形成 5 个故事弧、10 卷和连续第 1～300 章。
- **全书候选队列与人工采用**：用户可启动、暂停或继续按章节串行执行的候选队列；已有 `candidate_ready / adopted` 的章节会被跳过。每章先生成正文，再进行质量检查、六专家评审和最多三轮修订，候选始终保持未采用；只有用户在工作台采用后，正式章节进度才推进。
- **候选精确进入工作台**：自主规划页使用 `chapterId + draftId` 打开指定候选，工作台严格校验作品、章节和草稿归属，不再用“最新草稿”猜测目标；后台完成的新草稿会刷新到卷章树，未保存正文不会被覆盖。
- **长章节分段二次处理**：润色与质量检查按最多 7,000 字符分段，携带前后 400 字衔接参考；润色逐段合并为新草稿，质检分数按段长加权并把问题位置映射回全文，不再静默只处理正文前缀。
- **人物与世界演化**：已采用正文会生成待确认章节总结、人物状态变化和地点/规则候选；只有用户确认后才写入正式上下文，世界扩展仍停留在设定候选库等待处理。
- **恢复与身份失效**：页面会用权威采用稿对账计划进度；改采另一草稿时旧分析和已确认人物节点失效，既有章节上下文按正文采用协议过期。
- **协作事实与备份**：session、round、opinion 持久化到 migration 021～023，自主计划持久化到 migration 024；参考资料、混合语义 Memory、跨进程调度和正式故事资产分别由 migration 025～029 提供。完整项目备份当前为 schema 9（schema 7 的 Memory 基线、schema 8 的 Scheduler 表和 schema 9 的故事资产均可恢复），并重映射全部身份。
- **角色库**：创建角色、AI 候选推荐、本章出场角色管理。
- **事件辅助**：章节事件规划、AI 推荐事件、必需 / 禁止事件标记。
- **风格控制**：风格方案与输出控制方案管理。
- **参考资料与分层风格**：独立 TXT 参考作品版本库不进入卷章树；长文本按六类语义层有界采样，只把抽象画像、来源 hash、范围与置信度投影到生成 Prompt。
- **混合语义 Memory**：migration 026 绑定正式采用稿、来源版本和 hash，提供 FTS / substring、实体 / 时间过滤与显式真实向量余弦重排；改采正文时旧 Memory 在同一事务中失效。
- **请求治理与诊断**：桌面端由 SQLite 全局策略与 `IMMEDIATE` reservation 事务在派发前执行跨进程速率、并发、每日 Token / 估算成本硬预算；Rust Provider command 复验 request-bound lease。浏览器开发保留 LocalStorage 回退。本地诊断采集脱敏前端异常和原生 Rust panic 元数据，并提供 AI P50 / P95、失败和取消计量。报告仅在用户主动导出时离开本机。
- **上下文总结**：章节采用后将总结、上下文、角色状态与章节终态原子沉淀；桌面重启后继续使用同一 SQLite 数据，过期记录不会再注入后续生成。
- **质量检查**：逻辑、设定、角色、连续性、语言、节奏多维度检查。
- **正文润色**：多种润色模式，结果保存为新草稿。
- **导出功能**：章节 / 整本作品导出为 TXT、Markdown；项目 JSON 备份。
- **完整项目备份与恢复**：桌面 SQLite 导出带 `schemaVersion` 的完整项目 JSON；导入为新作品，不覆盖现有作品。
- **设定库 AI 推演**：生成角色、势力、地点、规则候选，用户确认后才写入正式资产。
- **AI 设置**：Mock 模式、API Key 本地管理、模型参数配置。
- **DSH 进程外大脑（v3.1.0 实验）**：DeepSeek Harness 经只读 MCP 工具产出可验证的章节准备提案，与现有 Planner 双源并行；事实解释、预算、执行、事务与最终采用权全部留在本应用，提案不自动采用。含 Rust Supervisor（Windows Job Object 整树清理）、只读 novel-domain-gateway、权威 Proposal Validator（枚举归一不静默）、本地模型网关代理（usage 记账 + 上游 Key 隔离）、逐来源基线修订号接线（六来源真实修订号回显校验）与工作台双源提案卡片。
- **DSH 运行载体（自包含载荷）**：`scripts/dsh/build-runtime-payload.mjs <checkout> <payloadDir> [commit]` 把固定版本的 harness 运行时装配为自包含载荷（镜像 checkout 布局：全部包 lib + package.json + node_modules junction 农场 + VERSION_MATRIX.json），并校验每个 junction 目标存在；启动解析链 `DSH_RUNTIME_ROOT` → 应用目录 `dsh-runtime/`（或 `resources/dsh-runtime/`）→ `DSH_CHECKOUT`，载荷完整性不足时不会遮蔽可用的 checkout。
- **真实桌面自动化**：在 Windows Tauri 窗口中验证 React、Rust IPC、SQLite 事务、Mock AI、网络阻断与进程清理。

### 百万字作品的生成、写入与二次编辑

“生成百万字全书”在本项目中表示卷章树中的数百个章节草稿，而不是一次 Provider 响应，也不是把百万字塞进一个编辑框：

```text
全书计划
→ 每卷最多 5 章的规划子批次与即时检查点
→ 用户启动全书候选队列
→ 逐章生成 / 质检 / 六专家评审
→ 每章正文写入 chapter_drafts
→ 工作台按卷章树打开指定 chapterId + draftId
→ 用户修改、润色、复检、比较版本并确认采用
```

- 全书队列每完成一章就持久化结果；暂停、失败或后续评审中断后，继续时复用已经安全保存的章节和源草稿。
- `autonomous_story_plans.plan_json` 保存规划、运行状态和草稿引用，不承载整本正文；章节正文的权威位置始终是 `chapter_drafts`。
- 单章超过 100 KiB 时自动分块，工作台校验并水合完整正文后才允许编辑；分片预览不会冒充全文。
- 工作台仍以“当前章节”为编辑单位。用户可通过左侧卷章树浏览整本作品，并对任一候选执行人工修改、保存、润色、质量检查、版本恢复和采用。
- 质量修稿会按全文位置只处理命中问题的分段，外部 AI 仅返回绑定问题的精确 `before → after` 替换，由应用在原草稿上确定性合成；歧义、重叠或越界替换失败关闭，每个源草稿最多使用一轮外部修稿。已有草稿和初评报告可直接从质量阶段继续，不重新生成 Beat 或复制同文草稿；若外部补丁已经持久化但候选保存中断，应用只恢复本地合成和复评，不再次调用修稿。修稿版与复评结果始终保存为未采用候选，只有用户确认采用后才影响正式上下文。章节总结会覆盖完整正文并分层归并，章节改写与卷总结也会接收完整来源，不再只读取正文或章节列表前缀。

---

## 4. 快速开始

### 环境要求

- Node.js >= 22.6（`node:test` 需要 Node 内建 TypeScript 类型剔除）
- Rust（仅 Tauri 桌面模式需要）
- Windows 10/11

运行真实桌面 E2E 还需要 `tauri-driver 0.1.5`、Microsoft Edge WebView2 Runtime，以及与 WebView2 主版本一致的 `msedgedriver.exe`。详细安装与版本匹配见 [Windows 桌面 E2E 自动化](docs/technical/desktop-e2e.md)。

### 安装与启动

```powershell
npm install

# 浏览器开发模式
npm run dev

# Tauri 桌面开发模式
npm run tauri dev

# 前端生产构建
npm run build
```

### 构建 EXE

```powershell
npm run tauri:build
```

构建产物位于 `src-tauri/target/release/`。

---

## 5. Windows 桌面规格

| 项目     | 规格                                             |
| -------- | ------------------------------------------------ |
| 默认窗口 | 1280 × 820                                       |
| 最小窗口 | 1024 × 700                                       |
| 最大化   | 支持，UI 自适应                                  |
| 2K 适配  | 内容宽度受控，阅读 / 表单 / 卡片布局不会无限拉伸 |
| 数据存储 | 桌面模式 SQLite；浏览器开发模式 LocalStorage     |

API Key 仅保存在本地，不提交到 Git，也不上传到任何服务端。

---

## 6. 页面与功能入口

| 路径                                | 页面                   | 说明                                      |
| ----------------------------------- | ---------------------- | ----------------------------------------- |
| `/`                                 | 作品管理首页           | 作品卡片列表与快捷入口                    |
| `/novels/:id`                       | 作品详情               | 基础设定、大纲、角色、风格、设定推演入口  |
| `/novels/:id/autonomous-planning`   | 自主创作规划           | 从小说 Brief 生成、确认并逐章执行全书计划 |
| `/novels/:id/workspace`             | 写作工作台             | AI 逐章创作核心工作区                     |
| `/novels/:id/outline`               | 大纲编辑器             | 分卷与章节大纲编辑                        |
| `/novels/:id/setting-suggestions`   | 设定库 AI 推演         | 生成并采纳角色、势力、地点、规则候选      |
| `/worlds/:worldId/lore/suggestions` | 设定库 AI 推演兼容入口 | 面向世界设定 ID 的候选推演入口            |
| `/styles`                           | 风格方案               | 风格方案与输出控制方案管理                |
| `/assets`                           | 创作资产               | 角色库、设定库与设定推演入口              |
| `/templates`                        | 模板中心               | 提示词模板管理                            |
| `/ai-tasks`                         | AI 任务记录            | AI 任务历史与状态追踪                     |
| `/import-export`                    | 导入导出               | TXT / Markdown 导入导出与 JSON 备份       |
| `/settings`                         | 设置中心               | AI 模式、API Key、模型参数                |
| `/coming-soon`                      | 即将开放               | 未完成能力的统一占位入口                  |

---

## 7. AI 模式与模型配置

1. 打开设置中心（`/#/settings`）。
2. 使用 **Mock 模式** 可以在无 API Key 的情况下测试完整工作流。
3. 关闭 Mock 模式后，配置 OpenAI 兼容 API：
   - API Base URL，例如 `https://api.openai.com/v1`
   - API Key，仅保存到本地
   - 模型名称，例如 `gpt-4`、`deepseek-chat`
4. 如需启用本地章节 Scene 模型，在“本地章节场景模型”卡片中配置：
   - Base URL 默认 `http://127.0.0.1:8080/v1`，模型默认 `qwen35-9b-novel-v3`
   - 启用后只接管章节首次生成与 Autonomous 候选正文；协议固定为 4096 context / 1024 max output，并透传 `top_p`、`top_k`、`repeat_penalty`、`seed`
   - 「检查本地模型」会验证 `/health`、`/v1/models` 和单 Beat smoke；本地服务不可用时不会自动切换到全局外部 Provider，本地调用成本保持未定价

详细说明见 [docs/user/ai-settings.md](docs/user/ai-settings.md)。

---

## 8. 核心安全规则

- AI 只生成候选、建议或草稿，不自动写入正式数据。
- 用户确认后内容才成为正式数据。
- 所有正文变更必须绑定目标作品、目标章节和基础正文版本 / 哈希。
- 迟到响应、目标切换、版本冲突和当前会话内的重复结果必须被隔离或拒绝，不得重定向到当前编辑器。
- 保存失败不得清除未保存状态；正式采用必须验证草稿归属并保持事务原子性。
- 桌面模式的章节总结、上下文和角色状态只以 SQLite 为准；IPC 失败必须显式返回，不得静默降级到 LocalStorage。
- 候选状态必须清晰：待处理、已采纳、编辑后采纳、已废弃。
- AI 不得自动覆盖正文、正稿或用户已确认资产。
- API Key 不得写死进代码或提交到 Git。
- 已有路由和功能必须保留。
- 不在 UI 组件中直接写 SQL 或大量提示词。

---

## 9. 当前版本路线

| 版本                      | 内容                                                                                                                                                                           |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| v1.7.10                   | 已完成：候选设定采纳与测试补齐                                                                                                                                                 |
| v1.7.11                   | 已完成：发布收尾、构建产物清理                                                                                                                                                 |
| v1.7.12、v1.7.13、v1.7.20 | 已完成：任务删除、上下文与质量检查链路增强                                                                                                                                     |
| v1.8.x                    | 旧规划节点，未形成独立 CHANGELOG 发布记录                                                                                                                                      |
| v1.9.5～v1.9.7            | 已完成：章节工程、上下文编译与生成任务                                                                                                                                         |
| v2.0.0～v2.0.3            | 已完成：正文初稿、结构化质检、局部修复与版本管理                                                                                                                               |
| v2.1.0                    | 已完成：单章质量闭环稳定版                                                                                                                                                     |
| v2.1.1                    | 已完成：正文变更安全门                                                                                                                                                         |
| v2.1.2                    | 已完成：完整备份与恢复闭环                                                                                                                                                     |
| v2.1.3                    | 已完成：Windows 真实桌面 E2E 与稳定性                                                                                                                                          |
| v2.1.4                    | 已完成：大文本正文安全闭环                                                                                                                                                     |
| v2.1.5                    | 已完成：章节工程任务跨重启恢复闭环                                                                                                                                             |
| v2.1.6                    | 已完成：章节工程真实 AI 请求取消闭环                                                                                                                                           |
| v2.1.7                    | 已完成：章节质量历史不可变快照与原子重放                                                                                                                                       |
| v2.1.8                    | 已完成：章节上下文持久化一致性闭环                                                                                                                                             |
| v2.2.0                    | 已完成：工作区可靠性与基础设施收口                                                                                                                                             |
| v2.2.1～v2.4.0            | 已完成：可靠性热修、执行事实、Provider、Safe Apply、Compiler 与 Tool Registry                                                                                                  |
| v2.5.0                    | 已完成：持久 Chapter Readiness Planner、lease/checkpoint、显式重试与重启恢复                                                                                                   |
| v2.6.1                    | 文档规范化版本；未形成独立 Memory 实现                                                                                                                                         |
| v3.0.0                    | **当前：全书自主规划、六专家评审、跨进程三档调度、可靠取消 / 流式预览 / 成本硬预算、参考资料 / 分层风格 / 混合语义 Memory，以及多目标事务、跨章节批处理和势力 / 地点正式资产** |
| v3.x 后续                 | 自动语义化与召回评估、常见资料格式、全书分析/项目驾驶舱、系统级无人值守、正文批处理、资产可视化、受控 Tool Calling 与出版交付                                                  |

完整历史见 [docs/version-roadmap.md](docs/version-roadmap.md)。

---

## 10. 项目结构

```text
ai-novel-studio/
├─ src/
│  ├─ pages/            # 页面级组件
│  ├─ components/       # 通用 UI 组件
│  ├─ features/         # 业务功能模块
│  ├─ services/         # AI / 数据 / 提示词 / 导出服务
│  ├─ store/            # 状态管理
│  ├─ styles/           # 样式文件
│  ├─ types/            # TypeScript 类型定义
│  ├─ agent/            # Agent Runtime
│  └─ agent-tools/      # Agent Tool Layer
├─ src-tauri/           # Tauri Rust 桌面壳
├─ prompts/             # AI 提示词模板
├─ tests/e2e/           # WebdriverIO Windows 真实桌面 E2E
├─ tests/browser/       # 真实 Chromium/Edge 浏览器开发模式 E2E
├─ docs/                # 项目文档
├─ .github/             # GitHub 配置与开发辅助系统
└─ scripts/             # 构建、E2E 运行与验证脚本
```

---

## 11. 测试与构建

```powershell
# 版本号与用户可见文档同步门禁
npm run test:version-sync

# Windows 真实 Tauri 启动冒烟测试
npm run test:e2e:smoke

# Windows 真实 Tauri 全部核心 E2E 流程
npm run test:e2e

# 真实浏览器开发模式路由、持久化边界与手动明暗主题
npm run test:e2e:browser

# 定向复测一个独立桌面场景
npm run test:e2e -- --spec candidate-review-apply

# 定向复测章节上下文保存、重启、过期与生成排除
npm run test:e2e -- --spec chapter-context-persistence

# v2.1.8 及此前 Node / tsx 动态回归
npm run test

# 正文变更安全门动态测试
npm run test:workspace-safety

# v2.2.x 定向 Vitest；后三项同时执行全量 Rust 回归
npm run test:components
npm run test:workspace-reliability
npm run test:workspace-recovery
npm run test:large-text-integrity
npm run test:migrations

# Rust / SQLite 命令安全测试
cd src-tauri
cargo test
cargo test commands::tests -- --nocapture
cd ..

# TypeScript 类型检查 + 前端构建
npm run build

# 校验入口、任一 chunk 的真实字节/gzip 预算与稳定 vendor 分包
npm run test:bundle-size

# Node/tsx 与 Vitest 统一测试入口
npm run test:all

# 全量生产源码覆盖率与非回退门禁
npm run test:coverage

# AI Task 删除与项目备份的真实 Rust 运行时回归
npm run test:ai-tasks-delete
npm run test:project-backup

# ESLint 与显式 any 非回退预算
npm run lint:ci

# Rust 编译检查
cd src-tauri
cargo check
cd ..

# Windows MSI 与桌面 EXE 完整构建
npm run tauri:build

# 项目验证脚本
powershell -ExecutionPolicy Bypass -File scripts/agent-workflow/verify_project.ps1
```

桌面 E2E 每个 suite 先在独立的 `.e2e-tools/target` 中构建一次带 Cargo `e2e` feature 的 Tauri 应用，再为每个 spec 独立启动真实窗口，并分配独立临时 SQLite、WebView2 用户目录和自动探测的空闲 driver 端口。固定 fixtures 从空库经 UI 建立场景数据，支持 `--spec` 独立复测；长正文规格还逐值核对全文、SQLite 元数据与 SHA-256，并通过仅限 E2E 的损坏注入证明读取失败不会覆盖安全正文。

测试通过 DOM、`data-testid` 和受限 Tauri IPC 操作，不依赖中文文本、屏幕坐标或截图识别。E2E 构建强制使用 Mock Provider，WebView 在请求前阻断外部网络，Rust AI IPC 再做后端阻断；运行器必须从 `frontend-diagnostics.json` 证明无 console error、未处理异常和外部网络尝试。失败截图只用于诊断，且仅在 WebDriver 会话仍可访问时尽力生成。

详细分层、覆盖范围与静态检查边界见 [docs/technical/testing.md](docs/technical/testing.md)，桌面环境、隔离、失败产物和排障见 [docs/technical/desktop-e2e.md](docs/technical/desktop-e2e.md)。

正式签名发布先调用可复用的完整 Windows 桌面质量/E2E 工作流，只有该门禁成功后才构建安装包、签名 updater 和回滚清单；本地独立 EXE 验证使用 `tauri build --bundles none`，与安装包阶段分离。

---

## 12. 当前限制

- migration 028 的通用多目标事务当前覆盖章节 metadata、势力、地点及其正式关系；跨章节正文批量改写仍必须先生成候选、逐目标审核，不能绕过草稿与采用边界。
- SQLite 与 LocalStorage 无法构成跨存储 ACID 事务。v2.1.8 的旧上下文迁移先原子提交 SQLite，再清理已映射缓存；清理失败会返回警告并允许幂等重试，歧义记录会保留在本地。浏览器 LocalStorage 仅用于开发回退。
- OpenAI-compatible 正文链路已使用真实 SSE 流；不支持流式的 Provider 仍按受控非流式协议返回完整结果。任何无完成标记、截断、取消或非法帧都不会创建成功草稿。
- v2.1.4 已收敛章节草稿的大文本事务与失败关闭读取；其他实体类型尚未接入通用大文本原子提交协议。
- Windows Tauri E2E 与真实浏览器 E2E 已形成双门禁；macOS/Linux 仍不是当前产品发布目标。
- 章节操作、HashRouter 导航与 Tauri 原生窗口关闭已共用可恢复 Leave Guard，但其他非正文工作流尚未统一接入。
- `recovery-dialog` 当前只覆盖章节工程 `generation_jobs` 的应用重启中断；旧 `ai_task_records` 和其他异步业务尚未纳入同一恢复协议。
- 参考资料库当前支持独立 TXT 版本导入、来源 hash、六层采样与置信度画像；EPUB/PDF/OCR/Markdown/DOCX 和自动 embedding、增量向量化、模型重建与召回评估仍属于后续增强。
- migration 027 的跨进程调度提供夜间草稿、质量门禁与全自动三档策略。`full_auto` 只有在冻结预算、lease/epoch、六专家阈值和采用前复验全部通过时才可正式采用；其他策略继续保留人工确认。
- Scheduler Worker 仍依附桌面应用进程；系统托盘/定时唤醒、锁屏/睡眠/断网恢复、次日审核收件箱和凭据解锁生命周期尚未形成系统级无人值守体验。
- 生产 Provider 任务仍使用冻结工具 allowlist，开放式模型 Tool Calling、项目驾驶舱、关系图/地图，以及 DOCX/EPUB/PDF 出版与最终校对属于后续独立版本目标。
- Mock 模式用于确定性流程验收，不代表真实模型的文学质量；真实 API 模式复用用户当前 Provider 配置，发布自动化不会读取 API Key 或产生外部调用费用。
- 势力、地点和关系现为 SQLite 正式资产；浏览器开发模式只展示持久化边界，不伪造这些桌面事务记录。
- 应用内更新仅在签名发布流水线注入公钥后启用；普通本地构建保留显式未配置状态。Stable/Beta 索引、minisign 校验和上一版本回滚目标由 release workflow 生成。
- React Router 6 与 Vite 5 受技术栈约束继续保留；应用使用 HashRouter、固定内部路由和仅回环地址的开发服务器，不把外部输入直接交给导航或暴露开发服务器到公网。生产依赖审计以 high 级别失败关闭。

---

## 13. 文档索引

| 分类             | 入口                                                               |
| ---------------- | ------------------------------------------------------------------ |
| 用户指南         | [docs/user/](docs/user/)                                           |
| 项目管理         | [docs/project/](docs/project/)                                     |
| 技术文档         | [docs/technical/](docs/technical/)                                 |
| Windows 桌面 E2E | [docs/technical/desktop-e2e.md](docs/technical/desktop-e2e.md)     |
| 当前变更记录     | [CHANGELOG.md](CHANGELOG.md)                                       |
| 历史发布归档     | [docs/project/release-history.md](docs/project/release-history.md) |
| Git / PR 策略    | [docs/project/git-workflow.md](docs/project/git-workflow.md)       |
| 诊断与崩溃报告   | [docs/technical/diagnostics.md](docs/technical/diagnostics.md)     |
| 设计文档         | [docs/design/](docs/design/)                                       |
| 总索引           | [docs/README.md](docs/README.md)                                   |

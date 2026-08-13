# AI Novel Studio v3.1.0
# 任务书：DSH 进程外大脑接入（ChapterPreparationPlannerPort 落地版）

> 本任务书自包含，执行 Agent 不依赖任何此前对话。
> 权威设计依据：`docs/architecture/dsh-feasibility-spike.md`（权限边界、三通道协议、接口与校验规则）。
> 验证证据：`reports/dsh-spike/spike-report.md`（六项门槛 12/12 全过、模型网关选项 A 实测、版本固定矩阵）。

---

## 一、版本定位

在已封闭的 v3.0.0（commit `f1388fb`）基础上，把 DeepSeek Harness（DSH）作为**进程外大脑**接入 AI Novel Studio 生产代码：DSH 只经只读 MCP 工具产出可验证的 `ChapterPreparationProposal`，与现有 Planner 并行比较；**事实解释、策略否决、预算、执行、事务、最终采用权全部留在 ANS**。本版本是 spike 验证结论的产品化落地，不重复 spike 实验。

## 二、本次版本号

`v3.1.0`（DSH 融合版）。

- 版本号沿用 3.0.0 之后的下一版本惯例（package.json / Cargo.toml / tauri.conf.json 当前均为 3.0.0）。
- 注意：路线图中 v3.1.x 原列的 embedding Provider 等规划属另一条功能线，本版本不含；发布流程按 `docs/project/git-workflow.md`。

## 三、本次核心目标

1. **Rust DSH Supervisor 移植入 `src-tauri`**：spawn/kill（Windows Job Object 进程树清理）、stdio JSON-RPC 帧编解码、`initialize`/`session/prompt`/`shutdown`、崩溃检测重启、**取消=重启语义**、MCP 工具同步 settle。
2. **novel-domain-gateway 作为 `src-tauri` 独立 bin**：MCP stdio（JSON-RPC 2.0），4 个只读工具（`get_metadata` / `get_chapter_context` / `search_memory` / `get_character_states`），`SQLITE_OPEN_READONLY`，参数/revision 校验，复用 `ai_fact_security` 规则，返回体 ≤ 2 MiB。
3. **Rust 权威 Proposal Validator**：设计文档 6.3 全量规则 + **planner 枚举归一**（Levenshtein 唯一近邻 ≤2 才归一，写入 `metrics.plannerCoerced`，绝不静默——spike Gate 1 修复实验结论）。
4. **TS 端口落地**：`src/types/chapterPreparation.ts` + `CurrentPlannerAdapter`（编排现有计划命令，确定性映射，无模型调用）/ `DshPlannerAdapter`（`invoke('dsh_prepare_chapter')`）+ TS 镜像校验器与单测。
5. **模型网关（选项 A 已实测）**：本地 OpenAI 兼容代理（透传 + usage 记账日志），Supervisor 以 `DEEPSEEK_BASE_URL` 注入 DSH 子进程；上游 Key 只存在于代理进程。
6. **UI 采用流**：章节准备提案双源展示（DSH / 现有 Planner）、校验结果与度量（含归一标记）、建议动作执行（`read_tool` / `ask_user`），桌面写作软件风格，遵守右栏与浅色约束。
7. **Node sidecar 交付载体**：`DshRuntimeLauncher` trait + 系统 Node 版本检测（`^22.19 || >=24`）+ runtime 产物定位（`DSH_RUNTIME_BIN` / `DSH_CHECKOUT`，不硬编码）。

## 四、本次禁止事项（非常重要）

本次**绝对不得**：

- ❌ 修改数据库 schema、新增任何 migration
- ❌ 删除、折叠、重构现有 Planner / Multi-Agent / Autonomous / 章节生成链路（只允许只读调用其现有命令与服务）
- ❌ 修改现有 AI 执行管线、事实层、预算账本逻辑
- ❌ 修改 UI 整体布局、主题、路由结构；新面板不得超出右栏 320–380px 与浅色克制风格
- ❌ 引入任务书未列明的依赖（确需新依赖必须先报告）
- ❌ 把 API Key 写进代码、cordis.yml、日志、fixture 或 git 历史
- ❌ 基于 dirty 工作树开发或混入其他版本未提交变更
- ❌ 修改现有文档（除版本完成时按规则更新 README / CHANGELOG）

本次**只允许**：任务书第六节列明的新增文件 + 对 `src-tauri/Cargo.toml`、`src-tauri/src/main.rs` 的最小改动（挂载模块与命令、注册 `[[bin]]`）+ 只读复用现有服务。

## 五、开始前必须阅读

AI Novel Studio 侧：

- `AGENTS.md`、`docs/product-design.md`、`docs/ui-reference.md`、`docs/data-model.md`、`docs/module-boundaries.md`、`docs/project-architecture.md`
- `docs/architecture/dsh-feasibility-spike.md`（权威边界）、`reports/dsh-spike/spike-report.md`（六项门槛证据、版本固定矩阵、Gate 1 修复与代理验证）
- `docs/architecture/chapter-readiness-planner-runtime.md`（现有 Planner 事实）
- `src-tauri/src/services/agent_plan_service.rs`、`src-tauri/src/commands/agent_plans.rs`（现有计划服务/命令，adapter 编排对象）
- `src/services/agent-planner/*`、`src/components/workspace/agent-planner/*`（现有 readiness 运行时与 UI，新 UI 遵循其 View/presentation 拆分模式）
- `src-tauri/src/services/ai_fact_security.rs`（凭据与安全规则，网关必须复用）
- spike 实现参照（**只读参照，移植时按 src-tauri 规范改造，不整文件照搬**）：`F:\ai-novel-studio-spike\spike\dsh-p1`（supervisor/launcher/config）、`spike\dsh-gateway`（MCP 帧与 4 工具 SQL）、`spike\dsh-ab\lib`（enumCoercion/planning/validator/currentPlanner/runtime 的 .mjs 语义）

DSH 侧（`F:\DeepSeek Harness` checkout，只读使用）：

- `packages/sdk/protocol/README.md`（Wire 协议权威：无取消/无关闭/Server→Client 请求为死能力）
- `packages/mcp/mcp-client/README.md`（MCP 配置权威）
- `packages/examples/jsonrpc-demo/lib/bin.js`（runtime 启动入口）

## 六、必须新增/修改的文件

### 6.1 新增（Rust，`src-tauri/`）

| 文件 | 职责 |
|---|---|
| `src/services/dsh/mod.rs` | 模块入口（services/mod.rs 注册） |
| `src/services/dsh/models.rs` | serde 类型：`ChapterPreparationInput` / `ChapterPreparationProposal` / 全部子类型（与 TS 类型逐字段镜像） |
| `src/services/dsh/runtime_launcher.rs` | `DshRuntimeLauncher` trait + 唯一实现 `NodeDshRuntime`：系统 Node 版本检测（`^22.19 \|\| >=24`，不满足返回结构化错误）；runtime 产物经 `DSH_RUNTIME_BIN` 或 `DSH_CHECKOUT` 定位 |
| `src/services/dsh/config.rs` | cordis 模板渲染：file:// URL、空格 %20 编码、路径占位替换；产出写入 runtime 工作目录 |
| `src/services/dsh/supervisor.rs` | 进程生命周期：spawn、**Windows Job Object kill-tree**（JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE）、stdio JSON-RPC 行帧编解码、`initialize`/`session/prompt`/`shutdown`、`session.event`/`session.status` 通知处理、崩溃检测与重启、**取消=kill 进程树+重启**、MCP settle（默认 3s，可配置；注释标注 v3.1.0 后等待 SDK 确定性就绪信号） |
| `src/services/dsh/proposal_validator.rs` | Rust 权威校验：schemaVersion=1；planner 枚举合法或**唯一近邻归一**（≤2，记录 `metrics.plannerCoerced`）；targetChapter 与输入一致；baselineRevisions 原样回显；retrievedEvidence 的 revision 与 baseline 严格一致；recommendedActions 仅 `read_tool`/`ask_user`（越权→整体丢弃并计数）；全字段长度上限；拒绝超大文档 |
| `src/services/dsh/commands.rs` | 唯一对外命令 `dsh_prepare_chapter`：输入 `ChapterPreparationInput` → 驱动 Supervisor → 解析模型输出（text→reasoning 回退）→ 注入 adapter metrics → **修复回合（≤3，回喂校验错误，提示词逐字符拼写枚举）** → Validator → 输出校验后 Proposal 或结构化错误（含归一标记） |
| `src/bin/novel-domain-gateway.rs` | 独立 bin：MCP stdio（JSON-RPC 2.0：`initialize` / `tools/list` / `tools/call`），`SQLITE_OPEN_READONLY` 打开 DB，`--db <path>` 与 `--smoke`（冒烟含负向拒绝） |
| `src/services/dsh/gateway/tools.rs` | 4 只读工具实现：SQL 语义镜像 spike 版并复用 `ai_fact_security`；参数校验（id/topK 范围）、camelCase/snake_case 双名兼容、输出携带来源 revision、≤2 MiB、长文本裁剪 |

### 6.2 修改（Rust，仅 2 个入口文件）

| 文件 | 改动 |
|---|---|
| `src-tauri/Cargo.toml` | 新增 `[[bin]] name = "novel-domain-gateway"`；注册 dsh 模块所需项（预期无新增外部依赖；rusqlite/serde 已存在） |
| `src-tauri/src/main.rs` | 挂载 `services::dsh` 与 `dsh_prepare_chapter` 命令（最小改动） |

### 6.3 新增（TypeScript，`src/`）

| 文件 | 职责 |
|---|---|
| `src/types/chapterPreparation.ts` | 类型层：`ChapterPreparationInput` / `ChapterPreparationProposal` / 全部子类型 / `ChapterPreparationPlannerPort`（零逻辑） |
| `src/services/dsh/currentPlannerAdapter.ts` | 编排现有 `create_agent_plan` / `claim_agent_plan_step` / `complete_agent_plan_step` 等命令与工具输出，**确定性映射**为 Proposal（`planner: current_chapter_readiness_v1`，无模型调用，成本 0） |
| `src/services/dsh/dshPlannerAdapter.ts` | `invoke('dsh_prepare_chapter', …)` 薄 facade；浏览器开发模式返回"仅 Tauri 可用"结构化错误，不伪造结果 |
| `src/services/dsh/proposalValidator.ts` | Rust 规则的 TS 镜像（含枚举归一、越权拒绝、revision 漂移拒绝） |
| `src/services/dsh/proposalValidator.test.ts` | 校验器单测：合法提案、越权写动作拒绝、revision 漂移拒绝、枚举归一记录（dsp→dsh）、二义/过远不归一 |
| `src/services/dsh/currentPlannerAdapter.test.ts` | 映射确定性单测 |
| `src/components/workspace/agent-planner/DshPreparationCard.tsx`（+ View/presentation 拆分，遵循现有 agent-planner 组件模式） | 提案展示：planner 标识、校验状态、度量（延迟/token/工具次数）、归一标记（⚠）、建议动作列表 |
| `src/components/workspace/agent-planner/useDshPreparation.ts` | 状态钩子：调用两个 adapter、校验、loading/error/cancel 状态 |

### 6.4 新增（提示词 / 脚本 / 资产）

| 文件 | 职责 |
|---|---|
| `prompts/dsh_chapter_preparation.md` | 章节准备规划 persona：只产 Proposal JSON、禁写工具、事实以工具返回为准、JSON 硬规则（中文引号、逗号、planner 枚举逐字符拼写）、revision 不得编造 |
| `scripts/dsh/cordis-template.yml` | 生产组合模板（spike 实测 6 插件：sdk-jsonrpc-server / llm-deepseek(thinking: enabled, reasoningEffort: max) / agent-spine(persona 指向上述模板) / sessions / token-meter / mcp-novel(stdio spawn 网关)）；stdout 纯净；无 API Key；占位符渲染时替换 |
| `scripts/dsh/model-proxy.mjs` | 本地 OpenAI 兼容代理（选项 A，spike 附录 F 已实测）：`POST /chat/completions` 流式透传上游 + usage 记账日志（预算网关挂钩点）；上游 Key 只经环境变量；由 Supervisor 管理生命周期，`DEEPSEEK_BASE_URL` 指向它 |
| `docs/architecture/dsh-v3.1.0-taskbook.md` | 本任务书 |

### 6.5 已在分支的参考文档（非新增改动）

- `docs/architecture/dsh-feasibility-spike.md`、`docs/architecture/dsh-feasibility-spike-taskbook.md`、`reports/dsh-spike/spike-report.md`（自 spike 分支复制，作为设计依据与证据，不得修改内容）

## 7. 详细实现要求

按顺序实现，每阶段结束必须运行第八节验证：

### P1 Rust 三件套（Supervisor / Launcher / Config）

1. 以 spike `dsh-p1` 的协议语义为参照移植；**新增 Job Object kill-tree**（spike 缺失，见 spike 报告偏差 6）：子进程放入 Job Object 并设 `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`，Supervisor Drop / 取消时关闭句柄即可清理整棵树（DSH + 网关）。
2. 单测（自备 mock LLM，无需 API Key）：场景 A 正常生命周期（initialize→prompt→running→idle→shutdown→exit 0）；场景 C 流中途强杀→重启→同 session 续跑→idle→exit 0；版本检查；config 渲染（file:// URL + %20）。测试后零残留 node.exe。
3. `DSH_CHECKOUT` / `DSH_RUNTIME_BIN` 环境变量契约与 spike 一致，不硬编码本机路径。

### P2 网关 bin

1. 手写 MCP stdio 最小子集（`initialize` / `tools/list` / `tools/call`，行帧）；4 工具 SQL 语义从 spike `gateway/tools.rs` 移植并按 src-tauri 现有 repository/schema 校准（先读 db.rs / migrations 相关表再落 SQL）。
2. 冒烟：`--smoke` 4 工具全通 + 负向拒绝（未知工具/缺参/未知 id）；对真实只读副本 DB 与 fixtures DB 各跑一次。
3. 输出携带来源 revision；拒绝疑似凭据（复用 `ai_fact_security`）。

### P3 Rust Validator + 命令

1. Validator 全量规则 + 枚举归一（唯一近邻 ≤2；归一写 `metrics.plannerCoerced` = `{original, distance}`；二义/过远拒绝）。单测覆盖 spike 全部失败样本（dsp_spike_v0 归一等）。
2. `dsh_prepare_chapter`：修复回合 ≤3（回喂校验错误 + 逐字符枚举拼写）；模型最终输出 text→reasoning 回退解析；adapter 注入 metrics（durationMs/promptTokens/completionTokens/toolCallCount/processRestarts）；一切失败返回结构化错误（不 panic）。

### P4 TS 端口 + 测试

1. 类型与 Rust serde 逐字段镜像（字段名/枚举完全一致）。
2. `currentPlannerAdapter`：只编排现有命令（先读 agent_plan_service/commands 的实际签名），确定性映射，无模型调用；映射不完整时以 ask_user 建议兜底并注明。
3. 测试全绿且不触发真实 AI 调用（mock invoke）。

### P5 模型网关代理

1. `scripts/dsh/model-proxy.mjs`：spike 附录 F 语义（流式透传、usage 日志、健康检查）；Supervisor 负责 spawn/关闭，`DEEPSEEK_BASE_URL=http://127.0.0.1:<port>` 注入 DSH 子进程，代理上游 Key 只经 `DSH_PROXY_UPSTREAM_KEY` 环境变量。
2. 验证：真实 `deepseek-v4-flash` 单案例经代理全链路（DSH→代理→上游）成功且 usage 有记录。

### P6 UI 采用流

1. 先读现有 `agent-planner` 组件与右栏面板模式，按同样 View/presentation 拆分新增；不改现有面板行为。
2. 展示：提案 JSON 摘要（目标/场景计划/风险/建议动作）+ planner 来源标识 + 校验状态 + 度量 + 归一标记。
3. 建议动作执行：`read_tool` → 打开对应只读面板；`ask_user` → 未决问题列表呈交用户；**任何写动作不存在**（Validator 已拒绝）。
4. 双源切换：CurrentPlanner（默认，零成本）与 DSH（显式触发，展示成本预估）。

### P7 提示词与组合收尾

1. `prompts/dsh_chapter_preparation.md` 从 spike PLANNING_PERSONA 整理（含 JSON 硬规则与枚举逐字符拼写）。
2. cordis-template.yml 固定 6 插件组合；渲染后 stdout 纯净（无 logger）；无任何 Key。

## 8. 测试要求

每次修改后必须：

```powershell
cargo check                 # Rust 编译检查
cargo test                  # dsh 模块新单测 + 现有测试零回归
npm run build               # 前端构建
npm test                    # 现有测试零回归（含新增 dsh 单测）
git status                  # 确认变更范围只在本任务书清单内
```

版本专项：

```powershell
# P1：Supervisor 载体验证（自备 mock LLM）
cargo test dsh::
# P2：网关冒烟（只读 DB）
cargo run --bin novel-domain-gateway -- --db <只读DB路径> --smoke
# P5/P6：真实 API 单案例端到端（deepseek-v4-flash）
# 经 Tauri 命令 dsh_prepare_chapter 产出并校验 Proposal（记录 usage/延迟/归一标记）
```

## 9. 完成标准

1. 第三节七项目标全部可用且第八节全部验证通过；
2. 真实 API 端到端单案例（`deepseek-v4-flash`）经 `dsh_prepare_chapter` 产出校验通过的 Proposal，UI 展示与建议动作可用；
3. 全部新增文件有对应测试或冒烟证据；现有测试零回归；
4. 工作树只含任务书清单内文件；无 API Key、无数据库改动、无未列明 UI 改动；
5. README / CHANGELOG 按仓库规则更新（功能与版本条目）；
6. 分支 `codex/v3.1.0-dsh-brain` 干净提交（发布合并流程按 `docs/project/git-workflow.md`，本版本不自行打 tag）。

## 10. 完成汇报格式

```markdown
# v3.1.0 DSH 进程外大脑接入 完成汇报

## 1. 结论
（一句话定性）

## 2. 七项目标逐项结果
| # | 目标 | 结果 | 证据 |

## 3. 关键度量摘要
（端到端单案例：延迟 / token / 工具次数 / 修复回合 / 归一标记 / 进程重启）

## 4. 实现清单
- 新增文件列表（含测试）
- 修改文件列表（仅 Cargo.toml / main.rs，注明 diff 摘要）

## 5. 验证执行记录
- cargo check / cargo test / npm run build / npm test / git status 结果
- 网关冒烟与端到端结果

## 6. 未决问题与后续建议
- 预算账本接入（v3.2 候选）、MCP 就绪信号、Windows 打包交付、剩余 8 案例补跑
```

---

> 本任务书与 `docs/architecture/dsh-feasibility-spike.md` 冲突时以设计文档为准；设计文档未覆盖的实现细节，先报告再动手，禁止自行扩展范围。

# AI Novel Studio spike/dsh-feasibility

# 任务书：DSH Feasibility Spike（进程外大脑验证）

> 本任务书自包含。执行 Agent 不依赖任何此前对话。
> 配套设计文档：`docs/architecture/dsh-feasibility-spike.md`（先读它，再读本任务书）。

---

## 一、版本定位

在 **不立项 v3.1.0、不改动任何现有功能** 的前提下，验证"DeepSeek Harness（DSH）作为进程外大脑"在 Windows 上的可行性：DSH 只经只读工具产出 `ChapterPreparationProposal`，与现有 Planner 做 20 案例盲评对比。

这是一个 **Spike（验证实验）**：不是版本开发，不打 tag，不进 main，不更新 CHANGELOG。

## 二、本次版本号

```text
spike/dsh-feasibility（非发布版本）
分支建议：codex/spike-dsh-feasibility（基于封闭后的 v3.0.0，绝不基于 dirty 工作树）
```

## 三、本次核心目标

1. 验证 Windows Node Runtime + Rust JSON-RPC Supervisor（spawn / 崩溃恢复 / 取消=重启）。
2. 验证 Rust Novel Domain Gateway（MCP stdio，4 个只读工具）能被 DSH 实际调用。
3. 实现 `ChapterPreparationPlannerPort` 的两个实现（`CurrentPlannerAdapter` / `DshPlannerAdapter`）。
4. 20 个固定案例 Shadow A/B，六项验收门槛全部通过后输出 Spike 报告。

## 四、本次禁止事项（非常重要）

本次**绝对不得**：

- ❌ 生成正文、写 SQLite、执行 Apply、触发任何 business.write 工具或副作用
- ❌ 修改现有 Planner / Multi-Agent / Autonomous / 章节生成链路代码（只允许只读调用其现有命令与服务）
- ❌ 修改数据库 schema 或任何 migration
- ❌ 修改现有 UI 组件、路由、面板（Spike 无 UI 产出）
- ❌ 更换或引入未在任务书列明的技术栈/依赖
- ❌ 把 API Key 写进代码、cordis.yml、fixture、日志或 git 历史
- ❌ 把 harness checkout 的 node_modules 复制进本仓库
- ❌ 把 Spike 文件混入当前 v3.0.0 未提交变更中提交
- ❌ 删除、折叠、重构任何现有模块（AGENTS.md 第 3.2 节红线全部适用）

本次**只允许**：

- 新增任务书第六节列明的文件；修改仅限第七节列明的 2 个 Rust 入口文件的最小改动
- 只读打开 SQLite；只读调用现有 domain 服务与 Tauri 命令

## 五、开始前必须阅读

AI Novel Studio 侧：

- `AGENTS.md`
- `docs/architecture/dsh-feasibility-spike.md`（权威边界）
- `docs/architecture/chapter-readiness-planner-runtime.md`（现有 Planner 事实）
- `docs/module-boundaries.md`
- `docs/agent-workflow.md`
- `src/types/agentPlan.ts`、`src/types/toolRegistry.ts`（现有接口事实）
- `src/services/agent-planner/chapterReadinessPlanner.ts`、`agentPlanRuntimeService.ts`
- `src/services/agent-tools/productionToolRegistry.ts`
- `tests/browser/wdio.conf.ts` 与 `scripts/e2e/`（A/B runner 复用基建）

DSH 侧（`F:\DeepSeek Harness` checkout，只读使用）：

- `AGENTS.md`、`docs/architecture.md`
- `packages/sdk/protocol/README.md`、`packages/sdk/server/README.md`（Wire 协议权威）
- `packages/mcp/mcp-client/README.md`（MCP 配置权威）
- `examples/jsonrpc-agent/cordis.yml`（组合参照）
- `apps/cli/README.md`（启动命令权威）

## 六、必须新增/修改的文件

### 6.1 新增（Rust，`src-tauri/`）

| 文件                                             | 职责                                                                                                                                                                               |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src-tauri/src/services/dsh/mod.rs`              | 模块入口                                                                                                                                                                           |
| `src-tauri/src/services/dsh/runtime_launcher.rs` | `DshRuntimeLauncher` trait + 唯一实现 `NodeDshRuntime`（spawn 系统 Node + 构建产物；版本检测 `^22.19 \|\| >=24`，不满足即报错退出）                                                |
| `src-tauri/src/services/dsh/supervisor.rs`       | 进程生命周期：spawn/kill-tree（Windows Job Object）、stdio JSON-RPC 帧编解码、`initialize` 握手、`session/prompt`、`shutdown`、崩溃检测与重启、取消=重启语义                       |
| `src-tauri/src/services/dsh/commands.rs`         | 唯一对外命令 `dsh_spike_prepare`（输入 `ChapterPreparationInput`，输出校验后的 `ChapterPreparationProposal` 或结构化错误）                                                         |
| `src-tauri/src/bin/novel-domain-gateway.rs`      | 独立 bin：MCP stdio（JSON-RPC 2.0：`initialize` / `tools/list` / `tools/call`），4 个只读工具，参数与 revision 校验，`SQLITE_OPEN_READONLY` 打开 DB；测试构建支持 fixture provider |

### 6.2 新增（TypeScript，`src/`）

| 文件                                                   | 职责                                                                                                                                                     |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/types/chapterPreparation.ts`                      | `ChapterPreparationInput` / `ChapterPreparationProposal` / 全部子类型 / `ChapterPreparationPlannerPort`（类型层，零逻辑）                                |
| `src/services/dsh-spike/currentPlannerAdapter.ts`      | 编排现有 `create_agent_plan` / `claim_agent_plan_step` / `complete_agent_plan_step` 等命令，将 readiness 结果与工具输出确定性映射为 Proposal；无模型调用 |
| `src/services/dsh-spike/dshPlannerAdapter.ts`          | `invoke('dsh_spike_prepare', …)` 薄 facade；浏览器模式返回"仅 Tauri 可用"错误，不伪造结果                                                                |
| `src/services/dsh-spike/proposalValidator.ts`          | 设计文档 6.3 的 TS 镜像校验（Rust 为权威）                                                                                                               |
| `src/services/dsh-spike/proposalValidator.test.ts`     | 校验器单测（含越权写动作拒绝、revision 漂移拒绝）                                                                                                        |
| `src/services/dsh-spike/currentPlannerAdapter.test.ts` | 映射确定性单测                                                                                                                                           |

### 6.3 新增（脚本 / 资产）

| 文件                                                            | 职责                                                                                               |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `scripts/dsh-spike/cordis.yml`                                  | 设计文档第 7 节组合，引用真实插件 id；stdout 纯净；API Key 只经环境变量                            |
| `scripts/dsh-spike/persona.md`                                  | 章节准备规划 persona：只产 Proposal、禁写工具、事实以工具返回为准                                  |
| `scripts/dsh-spike/README.md`                                   | 启动/运行/清理手册 + 版本固定矩阵填写处                                                            |
| `tests/dsh-spike/cases/*.json`                                  | 20 个固定案例（novelId/chapterId/baselineRevisions/rubric）+ `cases-manifest.json`（整体 SHA-256） |
| `tests/dsh-spike/run-ab.ts`（或 `tests/browser/` 下 wdio spec） | A/B runner：逐案例跑两个 adapter → Validator → 脱敏盲评文档 → 度量记录                             |
| `reports/dsh-spike/`                                            | 输出目录（gitignore 或仅报告模板入库，原始报告不入库）                                             |

### 6.4 修改（仅 2 个文件，最小改动）

| 文件                    | 改动                                                                                                          |
| ----------------------- | ------------------------------------------------------------------------------------------------------------- |
| `src-tauri/Cargo.toml`  | 新增 `[[bin]] name = "novel-domain-gateway"`；注册 dsh 模块所需的最小项（若有新依赖必须先报告，不得擅自引入） |
| `src-tauri/src/main.rs` | 挂载 dsh 模块与 `dsh_spike_prepare` 命令                                                                      |

## 7. 详细实现要求

按阶段实现，每阶段结束必须运行第八节验证并汇报：

### P1 载体验证（先做，风险最高）

1. `runtime_launcher.rs`：定位 harness checkout（路径经环境变量 `DSH_CHECKOUT` 传入，不硬编码）、检测 Node 版本。
2. `supervisor.rs`：实现 4.1 节全部 Wire 行为；**不实现协议里不存在的取消/关闭**（取消=kill 进程树）；stdout 只解析 JSON-RPC 帧。
3. 单测覆盖：正常握手→prompt→收事件→idle；进程被杀→检测→重启→再次握手成功；退出码与延迟记录。
4. 出口：`cargo test` 全绿，无残留 node.exe。

### P2 领域通道

1. `novel-domain-gateway.rs`：手写最小 MCP stdio 子集（`initialize`、`tools/list`、`tools/call`，JSON-RPC 2.0 行帧）。若确需 MCP 库依赖，必须先提交理由评审。
2. 4 个工具严格只读；输入携带 novelId/chapterId；输出携带来源 revision；返回体 ≤ 2 MiB；拒绝疑似凭据（复用现有 `ai_fact_security` 规则）。
3. 对只读副本 DB 冒烟：4 工具全部可用；非法参数、越权输入被明确拒绝。
4. 以 `scripts/dsh-spike/cordis.yml` 起 DSH，确认模型实际可见并调用 `mcp__novel__*`（日志与 session.event 验证）。

### P3 Shadow A/B

1. 案例集：先固化 20 案例与 manifest 哈希；优先真实只读 DB 副本，不足用 fixture。
2. 两个 adapter 按第六节实现；`CurrentPlannerAdapter` 输出 `planner: 'current_chapter_readiness_v1'`，`DshPlannerAdapter` 输出 `planner: 'dsh_spike_v0'`。
3. Runner 复用 e2e 基建（真实 Tauri 模式），逐案例执行、脱敏、归档度量：延迟 / token / 工具调用次数 / 进程重启次数 / 退出码。
4. 盲评材料不含 planner 身份；按固定 rubric 评分；平局计 0.5。
5. 按设计文档第 9 节填写版本固定矩阵（六字段 + Node 版本）。

## 8. 测试要求

每次修改后必须：

```powershell
cargo check                 # Rust 编译检查
cargo test                  # 新模块单测（supervisor / gateway / validator）
npm run build               # 前端构建
npm test                    # 现有测试零回归（Spike 不得破坏已有功能）
git status                  # 确认变更范围只在本任务书清单内
```

Spike 专项：

```powershell
# P1：Supervisor 载体验证
cargo test dsh::
# P2：网关冒烟（对只读副本 DB）
cargo run --bin novel-domain-gateway -- --smoke <只读DB路径>
# P3：A/B 全量（Tauri 模式）
npm run spike:ab -- --cases tests/dsh-spike/cases
```

## 9. 完成标准

1. 六项验收门槛**全部**通过（设计文档 8.3；成本口径按 8.4 修正版）；
2. `reports/dsh-spike/spike-report.md` 包含：门槛逐项结论、每案例度量表、版本固定矩阵、失败恢复与进程退出记录、未决问题清单；
3. 全部新增文件有对应测试或冒烟证据；现有测试零回归；
4. 工作树只含任务书清单内文件；无 API Key、无数据库改动、无 UI 改动；
5. 分支 `codex/spike-dsh-feasibility` 干净提交（不合并 main、不打 tag、不更新 CHANGELOG）。

## 10. 完成汇报格式

执行完成后按以下格式输出汇报（这是唯一被接受的汇报格式）：

```markdown
# DSH Feasibility Spike 完成汇报

## 1. 结论

Spike 成功 / 失败 / 部分通过（一句话定性）

## 2. 六项门槛逐项结果

| #   | 门槛 | 结果 | 证据 |
| --- | ---- | ---- | ---- |

## 3. 关键度量摘要

- 每案例平均延迟 / token / 工具次数（DSH 侧）
- 进程重启与退出码记录摘要

## 4. 版本固定矩阵

（六字段 + NODE_VERSION 实际值）

## 5. 实现清单

- 新增文件列表（含测试）
- 修改文件列表（仅 Cargo.toml / main.rs，注明 diff 摘要）

## 6. 验证执行记录

- cargo check / cargo test / npm run build / npm test / git status 结果

## 7. 未决问题与后续建议

- 模型网关方向、Windows 交付载体、v3.1.0 立项建议
```

---

> 本任务书与 `docs/architecture/dsh-feasibility-spike.md` 冲突时，以设计文档为准；设计文档未覆盖的实现细节，先报告再动手，禁止自行扩展范围。

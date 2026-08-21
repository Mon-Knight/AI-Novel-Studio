# 完整对话工作台 Phase 0 接管盘点

> 快照时间：2026-08-21 02:37:33 +08:00（Asia/Shanghai）  
> 盘点范围：`F:\ai-novel-studio-hotfix-v321`、固定 DSH checkout `F:\dsh-v320-clean`、本机开发数据库与已生成 payload 证据  
> Phase 0 原则：只盘点和冻结边界，不修改应用行为，不提升版本，不打包

## 1. 快照结论

| 项目 | 盘点结果 |
| --- | --- |
| 分支 | `codex/v3.3.0-conversational-workbench` |
| HEAD | `babf9c7497ad187bc8ac8c1714c13a3d1414fb1f` |
| `package.json` 版本 | `3.2.1` |
| tracked diff | `61 files changed, 3366 insertions(+), 599 deletions(-)` |
| `git status --short` | 61 个 tracked 修改条目，19 个未跟踪条目；未跟踪目录在 status 中按目录折叠 |
| DSH 固定 checkout | `47f943859bef60e4160492346772ded9b24f765a`，工作树干净 |
| DSH commit subject | `Merge pull request #2519 from deepseek-harness/feat/npm-public` |
| 本机开发数据库 | 存在；migration 032 已应用，033–035 尚未应用 |
| 已生成 payload staging | `VERSION_MATRIX.sourceCommit` 为固定提交；当前环境没有活动 runtime root 证据 |
| Phase 0 总判定 | 可进入针对 P0 缺口的 Phase 1 实现；当前不能声明 v3.3.0、持续多轮 Worker、真实完整插件投影或完整桌面 E2E 已完成 |

`git diff --stat` 不包含未跟踪文件内容，因此上表的增删行只描述 tracked diff，不能用来估算整个脏工作树规模。

## 2. 脏工作树全量分类

下面逐项覆盖快照中的 80 个 `git status --short` 条目。`M` 表示 tracked 修改，`??` 表示未跟踪；目录条目同时列出当前目录内文件，便于后续显式 pathspec 分阶段暂存。

### 2.1 Workbench / v3.3.0 主线

路由、布局、对话领域、SQLite 投影、backup 和 E2E 接线：

- `M package.json`
- `M scripts/e2e/run-e2e.ts`
- `M src-tauri/src/commands.rs`
- `M src-tauri/src/main.rs`
- `M src-tauri/src/migrations.rs`
- `M src-tauri/src/project_backup.rs`
- `M src-tauri/src/repositories/mod.rs`
- `M src-tauri/src/services/mod.rs`
- `M src/App.tsx`
- `M src/components/sidebar/Sidebar.tsx`
- `M src/components/topbar/TopBar.tsx`
- `M src/main.tsx`
- `M tests/e2e/app-start.spec.ts`
- `?? src-tauri/src/commands/conversations.rs`
- `?? src-tauri/src/repositories/conversation_repository.rs`
- `?? src-tauri/src/services/conversation_service.rs`
- `?? src/pages/Workbench/`
  - `src/pages/Workbench/WorkbenchComponents.tsx`
  - `src/pages/Workbench/WorkbenchPage.tsx`
- `?? src/services/conversation/`
  - `src/services/conversation/currentPluginService.ts`
  - `src/services/conversation/taskConversationService.ts`
  - `src/services/conversation/taskModelSnapshot.ts`
  - `src/services/conversation/taskRuntimeAdapter.test.ts`
  - `src/services/conversation/taskRuntimeAdapter.ts`
- `?? src/services/dsh/taskRuntimeService.ts`
- `?? src/services/dsh/taskSessionAdapter.ts`
- `?? src/styles/workbench.css`
- `?? src/types/conversation.ts`
- `?? tests/e2e/conversational-workbench.spec.ts`

说明：`migrations.rs` 和 `project_backup.rs` 同时影响既有数据与所有项目备份，属于高风险共享文件；虽然归在 Workbench 主线，后续提交和回滚必须单独审查。

### 2.2 DSH / gateway / payload 与请求治理

- `M scripts/dsh/cordis-template.yml`
- `M scripts/dsh/model-proxy.mjs`
- `M src-tauri/build.rs`
- `M src-tauri/gateway/src/main.rs`
- `M src-tauri/gateway/src/tools.rs`
- `M src-tauri/src/services/dsh/commands.rs`
- `M src-tauri/src/services/dsh/config.rs`
- `M src-tauri/src/services/dsh/launcher.rs`
- `M src-tauri/src/services/dsh/mod.rs`
- `M src-tauri/src/services/dsh/supervisor.rs`
- `M src-tauri/src/services/dsh/tests.rs`
- `?? src-tauri/src/services/dsh/governed_proxy.rs`
- `?? src-tauri/src/services/dsh/task_runtime.rs`

这些文件包含固定 commit 校验、Cordis composition、SDK JSON-RPC child、Windows Job Object、四个小说工具、请求治理代理和事件投影。它们不能与纯 UI 改动混成一个不可回滚提交。

### 2.3 共享旧能力集成

- `M src/services/agent-tools/productionToolRegistry.ts`
- `M src/services/agent-tools/toolRegistry.test.ts`
- `M src/services/agent-tools/toolRegistry.ts`
- `M src/services/database/novelRepository.ts`
- `M src/services/generation/generationJobService.test.ts`
- `M src/types/toolRegistry.ts`
- `M tests/e2e/chapter-readiness-planner.spec.ts`

这些是旧工作台和既有 Agent/生成能力共用边界。Phase 1 只能做对话工作台所需的等价接线，不能顺手改造或删除旧能力；旧 `/novels`、作品详情、章节编辑与旧 AI 功能仍需回归。

### 2.4 规则、文档与任务书

- `M .cursor/rules/agent-safety.mdc`
- `M .cursor/rules/project-architecture.mdc`
- `M .cursor/rules/task-writing-rules.mdc`
- `M .cursor/rules/testing-rules.mdc`
- `M .cursor/rules/ui-rules.mdc`
- `M .github/checklists/feature-development.checklist.md`
- `M .github/checklists/ui-review.checklist.md`
- `M .github/checklists/verification.checklist.md`
- `M .github/copilot-instructions.md`
- `M .github/instructions/agent-behavior.instructions.md`
- `M .github/instructions/frontend.instructions.md`
- `M .github/instructions/testing.instructions.md`
- `M .github/skills/agent-task-writer/SKILL.md`
- `M .github/skills/implement-feature/SKILL.md`
- `M .github/skills/plan-version/SKILL.md`
- `M .github/skills/review-ui/SKILL.md`
- `M AGENTS.md`
- `M CHANGELOG.md`
- `M README.md`
- `M docs/README.md`
- `M docs/agent-runtime.md`
- `M docs/agent-workflow.md`
- `M docs/ai-agent-roadmap.md`
- `M docs/data-model.md`
- `M docs/development-rules.md`
- `M docs/development-skills.md`
- `M docs/product-design.md`
- `M docs/project-architecture.md`
- `M docs/ui-reference.md`
- `M docs/version-roadmap.md`
- `?? docs/architecture/conversational-creative-workbench.md`
- `?? docs/architecture/conversational-workbench-complete-taskbook.md`
- `?? docs/architecture/v3.3.0-conversational-workbench-taskbook.md`
- `?? docs/audit/agent-requirements-review-2026-08-20.md`
- `?? docs/audit/dsh-baseline-diff-2026-08-20.md`

这些改动同时包含仓库规则更新、架构规划、审计和版本文档。任务书是执行依据，不等于功能已经实现；后续提交必须避免用文档中的目标描述冒充当前 3.2.1 能力。

### 2.5 无关 / 既有报告资产

- `?? reports/cleanup-other-projects-20260820/`
  - `DIFF_FILE.patch`
  - `MODIFIED_FILE.json`
  - `recovery-local-state-unique.zip`
  - `recovery-small-projects.zip`
  - `ROLLBACK.sh`
  - `VERIFICATION.txt`
- `?? reports/v3.3.0-workbench-transaction/`
  - `DIFF_FILE`
  - `MODIFIED_FILE`
  - `ROLLBACK_TEST_COPY`
  - `ROLLBACK.sh`
  - `VERIFICATION.txt`

处置：保留原样，不纳入 Phase 0 报告提交或后续功能提交，除非主任务明确要求更新其中的实际验证证据。`reports/v3.3.0-workbench-transaction/VERIFICATION.txt` 中已有的 3.2.1 MSI/NSIS 记录只是历史中间证据；不得把它当成当前验收，也不得重复执行打包。

## 3. 本机 conversation migrations 核验

### 3.1 数据库位置与只读结果

`src-tauri/src/db.rs` 在 Windows 优先使用 `%LOCALAPPDATA%\AI Novel Studio\ai-novel-studio.db`。盘点时文件存在：

- 路径：`C:\Users\17735\AppData\Local\AI Novel Studio\ai-novel-studio.db`
- 大小：24,317,952 bytes
- 文件最后修改时间：2026-08-09 06:47:32（文件系统时间）

使用 SQLite `mode=ro` 只读查询，没有启动应用或执行迁移：

| migration | 源码是否存在 | 本机开发库 | 证据 |
| --- | --- | --- | --- |
| 029 `global_ai_request_policy` | 是 | 已应用 | checksum `cc2caf7c…`，applied at `2026-08-02T12:04:38.536130900+00:00` |
| 030 `output_profile_fields` | 是 | 已应用 | checksum `b3b5f675…` |
| 031 `dsh_preparation_runs` | 是 | 已应用 | checksum `4ebb60ca…` |
| 032 `conversation_workbench` | 是 | 已应用 | checksum `76bb0950…`，applied at `2026-08-20T17:32:07.593712300+00:00` |
| 033 `conversation_workbench_guards` | 是 | **未应用** | `schema_migrations` 无记录 |
| 034 `conversation_artifact_projection` | 是 | **未应用** | `schema_migrations` 无记录 |
| 035 `conversation_tool_call_identity` | 是 | **未应用** | `schema_migrations` 无记录 |

本机表形状也与该结果一致：

- `conversation_artifact_cards` 仍包含 032 的 `artifact_id` 与 `content` 列；
- `tool_call_events` 尚无 035 的 `call_id` 列；
- migration 034 的新 projection trigger 尚未在本机库安装。

结论：只能证明 032 已在本机开发库运行；不能声称 033–035 已经在真实开发库升级成功。后续首次运行当前分支前，应先备份该数据库，并用可丢弃副本动态验证 032 → 035 升级、旧卡片兼容读取、trigger 约束和回滚/重开；Phase 0 不主动改变用户开发库。

## 4. 固定 DSH checkout 与 payload 核验

### 4.1 固定源码

- `F:\dsh-v320-clean` HEAD：`47f943859bef60e4160492346772ded9b24f765a`；
- checkout 干净；
- 已有构建后的 `packages/examples/jsonrpc-demo/lib/bin.js`、`packages/sdk/server/lib/index.js`、`packages/sdk/protocol/lib/index.js`；
- checkout 根目录没有 `VERSION_MATRIX.json` 或 `JUNCTIONS.json`，因为它是源码/构建 checkout，不是 ANS payload 根。

### 4.2 已生成载体证据

忽略目录 `src-tauri/.payload-staging/dsh-runtime` 存在，关键文件齐全：

- `VERSION_MATRIX.json`
- `JUNCTIONS.json`
- 三个 JSON-RPC runtime `lib` 入口
- `node_modules/.pnpm`

其 matrix 为：

| 字段 | 值 |
| --- | --- |
| `builtAt` | `2026-08-20T15:38:44.135Z` |
| `sourceCommit` | `47f943859bef60e4160492346772ded9b24f765a` |
| `nodeVersion` | `v24.15.0` |
| `runtimeBinSha256` | `569c08372f3fb9770a044f5bb616dbcc0bf4d2bb46bdb70997cc78ebc70d9320` |
| `packageLockSha256` | `6177ec61bdb8194eb5a606813a62ffb0ab2cc7fdfe2cd6e0249dcbfe4bce58e0` |

忽略目录 `src-tauri/bin/` 还有一个 464,867,387-byte 的 `dsh-runtime.zip`（2026-08-20 23:50:42）和 unpacker。它们是盘点前已有的生成物，不纳入 Git，也不等于用户授权了可分发打包。

### 4.3 当前活动 runtime 不能由 staging 推断

盘点时：

- `DSH_RUNTIME_ROOT` 未设置；
- `DSH_CHECKOUT` 未设置；
- `%LOCALAPPDATA%\AI Novel Studio\dsh-runtime` 不存在；
- staging 目录不是 `config.rs::runtime_root()` 的自动开发解析项。

所以可以证明“已生成的 payload staging 来自固定 commit”，不能证明“当前桌面进程已加载该 payload”。Phase 1 的动态测试必须显式设置固定 runtime root 或使用未打包主程序旁的受控载体，并让 `describe_runtime()` 返回真实 `loaded`；源 checkout 自身缺 matrix 时不能被 payload 校验误判为 loaded。

## 5. 关键能力入口盘点

| 能力 | 当前入口 | 已有事实 | 仍需处理 |
| --- | --- | --- | --- |
| ResultArtifact | migration 010；`src-tauri/src/services/artifact_service.rs`；`commands/artifacts.rs`；`task_runtime.rs::create_artifact_projection` | 桌面 `generate_chapter` 结果先经过大文本引用/哈希/结构/小说章节归属校验，再创建 AI Task → Attempt → ResultArtifact；新 repository 拒绝无 `artifactId` 或带正文的新卡片 | 本机 migration 034 未应用；旧 032 卡片正文需兼容但不能作为新事实；浏览器 fallback 仍直接以 `content` 创建卡片；真实 DSH 成功链尚无 E2E |
| Conversation Artifact projection | migration 034；`conversation_repository.rs::create_artifact_card` | 新桌面写入只保存 `artifactId`，数据库 content 写空串；读取仍保留 legacy 字段 | 明确区分 legacy 032/033 行与新 projection；UI 内容必须通过 Artifact Service 读取，不能回退到卡片正文 |
| Safe Apply | migrations 012–014；`placement_repository.rs`；`placement_service.rs::prepare_placement/apply_placement`；`src/services/placements/placementRuntimeService.test.ts`；`tests/e2e/candidate-review-apply.spec.ts` | 既有设定候选具备 proposal、显式计划、冲突检测、事务应用和回滚测试 | 对话确认、章节候选 Safe Apply 与采用属于 Phase 2；Phase 1 不新增，也不能让模型直接写正式正文 |
| AI request ledger | migration 029；`ai_request_policy_service.rs::{reserve_request,verify_provider_dispatch,settle_request}`；`governed_proxy.rs`；`model-proxy.mjs` | 本机库已应用 029；当前 DSH proxy 在 upstream 前 reserve/verify，完成后 settle，失败/缺 usage 保守结算；guard drop 处理 outstanding | 补真实 Worker 的并发、取消、崩溃、无 usage 和代理失败测试；凭据、lease token 和原始响应不得写入日志/Session |
| Project backup | `src-tauri/src/project_backup.rs`，backup schema 10 | 包含 conversation、run、tool、AI Task、ResultArtifact、验证问题和引用的大文本；已有 `project_backup_round_trips_workbench_result_artifact_graph` 与非法行无部分写入测试 | 在 migration 035 形状下再次验证 `call_id` 与 legacy null；真实本机升级前先用副本验证备份/恢复 |
| Browser fallback | `src/services/conversation/taskRuntimeAdapter.ts` | 可在非 Tauri 开发环境演示 UI 和工具事件 | 固定四步工具顺序不是 DSH；仍创建 content card，语义与桌面目标不一致。必须显式标注 fallback，绝不能在桌面 DSH 失败后静默使用 |
| 当前插件 | `currentPluginService.ts`；`productionToolRegistry.ts`；Rust `list_current_plugins` 命令 | 功能工具来自真实 production manifest；UI 是只读 | 模型只来自单一 settings，其他项是合成 runtime；未投影实际 Cordis composition、Loader/mount health 和 Provider/Model directory |
| E2E 入口 | `scripts/e2e/run-e2e.ts` 已注册 `conversational-workbench.spec.ts` | 源码覆盖默认路由、旧路由、只读插件、DSH 明确失败、retry 新 run、重启后失败事实恢复和无静默 fallback | 没有两个成功真实 Worker、取消隔离、四工具成功/错误、真实 ResultArtifact、活动 run 重启 resume；本机 EdgeDriver 环境仍是门禁风险 |

## 6. 当前实现可复用部分

以下代码可在 Phase 1 小步修正，不需要推倒重写：

- Workbench 默认路由、项目/任务树、对话区、模型选择和只读插件 UI；
- SQLite conversation / turn / run / tool / card repository 与 migrations 032–035；
- `supervisor.rs` 的 JSON-RPC framing、observer-before-snapshot、stderr 尾部、Windows Job Object；
- DSH gateway 四个小说工具与双层 allowlist；
- `generate_chapter` → 大文本 → ResultArtifact → card reference 的桌面管线；
- migration 029 请求治理和 governed proxy；
- backup schema 10 的 Workbench + Artifact graph；
- E2E runner 的隔离数据目录、日志脱敏和规格注册。

复用不等于当前已完成。特别是 supervisor 可以保留进程管理，但持续 Session 必须改为公开 Agent handle / resume 语义；现有固定流水线 fallback、合成插件 projection 和失败路径 E2E 不能冒充真实能力。

## 7. 风险矩阵

| 优先级 | 风险 | 当前证据 | Phase 1 继续策略 |
| --- | --- | --- | --- |
| P0 | 当前 run 是一次性临时 Worker，不是持续 Harness Session | 新 `workerId`、`%TEMP%\ans-task-*\sessions`、一次 prompt、idle 后 shutdown | 采用长存 handle 或固定 persistence root + `ctx.agents.resume`；第二回合和应用重启动态证明历史连续 |
| P0 | SDK wire 无 resume/cancel，server 重启只会走 `agents.create` | 固定源码 protocol 只有 initialize/prompt/shutdown；`createSession()` 调 `ctx.agents.create` | 在固定载体内增加窄 Adapter，内部只委托公开 Agent/Session API；不得复制私有 driver |
| P0 | Runtime/Provider/Plugin projection 不完整 | 功能 manifest 真实；模型单一 settings；其他插件为合成 runtime 项 | 从实际 Cordis composition、Loader/mount health、LLM Provider/Model directory 生成稳定只读 projection |
| P0 | 真实多 Worker、task-scoped cancel/crash、工具终态测试不足 | 现有 Rust 场景只覆盖单 runtime 与新进程 prompt；E2E 主要是失败路径 | 增加两个真实 Worker 同时运行、取消/崩溃隔离、四工具任意顺序与全部终态测试 |
| P0 | 桌面成功路径 E2E 不足 | `conversational-workbench.spec.ts` 无成功固定载体 fixture | 用 Mock Provider、隔离 DB、固定 payload、外网阻断建立可重复成功 fixture；匹配 EdgeDriver 后运行 |
| P1 | 本机开发库只到 migration 032 | 033–035 无 ledger 行，表缺 `call_id` | 先备份，再在副本执行 032 → 035；验证旧行兼容、新 trigger、重开和 backup round-trip |
| P1 | 浏览器 fallback 与桌面目标语义分叉 | 固定 steps；直接保存 card content | 将其保持为明确的非桌面开发 fixture，或改用同一 reference-only projection；桌面失败不得切换 |
| P1 | legacy 卡片仍可能携带正文 | 032 schema 和兼容读取保留 content | 只允许读 legacy；所有新写入强制有效 ResultArtifact reference + 空 content；UI 标识 legacy 来源 |
| P1 | source checkout 与 payload matrix 是不同对象 | checkout 无 matrix；staging matrix 正确 | 构建/运行命令显式传 payload root；校验 source commit、required files 和 hash，不以 checkout 目录存在代替 |
| P1 | 工作树混合规则、文档、旧功能和主线代码 | 80 个 status 条目，两个既有 reports 目录 | 每阶段使用显式 pathspec；提交前逐项复核 status；不执行 `git add .`，不吞入既有报告 |
| P1 | 版本仍是 3.2.1 | package 实际值为 3.2.1 | 保持不变，直到 Phase 1 实现验收与全部非打包门禁通过 |
| P1 | 历史打包证据可能被误用 | 既有 `VERIFICATION.txt` 含 3.2.1 MSI/NSIS | 标记为历史；用户明确要求前不运行任何 MSI/NSIS/Tauri 分发打包 |

## 8. Phase 1 继续顺序

1. 以 `dsh-source-map.md` 为约束冻结公开 API：先确定长存 Worker / 重启 resume 的薄 Adapter 方案；
2. 建立固定每任务 Session root、Agent handle 生命周期、flush、cancel 与崩溃 terminalization；
3. 保留现有 observer 和领域投影，补齐 call/result、turn reason、幂等与所有工具终态；
4. 将 runtime、Provider/model、Cordis composition 和健康结果投影为只读稳定 DTO；
5. 在 Mock Provider + 固定 payload 下先完成 Rust 动态测试，再完成 Windows Tauri E2E 成功路径；
6. 在数据库副本验证 032 → 035 与 backup schema 10；确认后才允许开发库自然升级；
7. 运行 Phase 1 全部非打包门禁；只有第 1–15 项实现验收全部通过后才同步版本到 3.3.0；
8. 未打包 Release 主程序测试通过后仍需等待用户明确要求，才允许任何可分发打包。

## 9. Phase 0 边界判定

Phase 0 的两份报告已经把固定源码、脏工作树、数据库、payload、领域能力和风险边界落盘。它们不改变应用行为，也不消除上表 P0/P1。

当前允许的下一步是修复 Phase 1 P0，并持续运行非打包测试；当前不允许：

- 宣称完整改造或 v3.3.0 完成；
- 提升版本；
- 实现 Phase 2 的确认/Safe Apply 或 Phase 3 的压缩/旧 UI 删除；
- 删除旧路由、旧 AI 面板或既有数据服务；
- push、PR、tag 或 Release；
- 运行 `npm run tauri:build`、MSI、NSIS、updater 或任何可分发打包命令。

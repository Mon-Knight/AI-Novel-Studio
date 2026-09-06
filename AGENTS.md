# AGENTS.md — AI Novel Studio

> 仓库开发 Agent 的唯一主入口，适用于 Copilot、Cursor 及其他编码 Agent。本文约束**如何修改仓库**，不代表产品内 Agent Runtime 的能力或授权。
> 详细文档从 [文档索引](docs/README.md) 按任务查阅；不要另建 `agent.md` 等平行规则入口。

## 1. 开工检查

1. 读取用户最新明确需求和本文件，确认目标、禁止事项及交付范围；一个任务只处理一个明确目标，不自动进入下一版本。
2. 确认真实工作目录、分支与已有修改，不根据文档中的示例路径或目录名推断：

   ```powershell
   pwd
   git status --short --branch
   ```

3. 保留用户已有修改。与目标文件重叠时先读取差异；遇到无法判断归属的冲突先询问，不执行覆盖、重置或清理。
4. 从 `package.json` 查看版本、依赖和可用脚本；版本交叉核对 `src-tauri/Cargo.toml`，完整镜像由 `npm run test:version-sync` 检查。
5. 首次进入仓库先读产品、UI、数据模型文档的开头和当前版本覆盖章节，再按下表深入任务相关部分；不要求每次通读整个 `docs/`。
6. 修改前说明影响范围和验证计划。明确、低风险的任务可直接执行；需求含糊、需要架构决策、破坏性操作或扩大范围时先确认。

## 2. 文档查阅与冲突处理

本文件及仓库规则不能覆盖运行平台的系统/开发者指令或用户最新明确需求。子目录规则只细化其适用范围；IDE 指令、Skills 和任务书不能自行扩大用户授权。

| 任务                           | 优先查阅                                                                                                                                                        |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 所有任务                       | 本文件、[文档索引](docs/README.md)、目标文件及相邻测试                                                                                                          |
| 产品/交互                      | [产品设计](docs/product-design.md)（第 21 节起）、[UI 标准](docs/ui-reference.md)（第 18 节起）                                                                 |
| 对话工作台、DSH、Agent Runtime | [对话工作台架构](docs/architecture/conversational-creative-workbench.md)、[运行时说明](docs/agent-runtime.md)                                                   |
| 模块调整/状态管理              | [项目架构](docs/project-architecture.md)、[模块边界](docs/module-boundaries.md)                                                                                 |
| SQLite、保存/采用、备份/恢复   | [数据模型](docs/data-model.md)、[数据库入口](docs/technical/database.md)、[Safe Apply](docs/architecture/safe-apply.md)                                         |
| AI 请求/提示词/工具            | [AI 请求治理](docs/project/ai-generation-governance.md)、[Provider 管线](docs/architecture/provider-execution-pipeline.md)、[提示词系统](docs/prompt-system.md) |
| 测试/桌面载体/打包             | [测试策略](docs/technical/testing.md)、[桌面构建](docs/technical/desktop-build.md)、[桌面 E2E](docs/technical/desktop-e2e.md)                                   |
| 文档/开发指令                  | [Agent 工作流](docs/agent-workflow.md)、[开发规则](docs/development-rules.md)、[开发 Skills](docs/development-skills.md)                                        |
| 版本/发布                      | [版本路线](docs/version-roadmap.md)、[Git 治理](docs/project/git-workflow.md)、[CHANGELOG](CHANGELOG.md)                                                        |

按需读取 `.github/instructions/`、`.github/skills/`、`.github/prompts/` 和 `.cursor/rules/` 中与目标匹配的文件；使用 Skill 前读取其 `SKILL.md`。Skills 是开发辅助，不是软件已实现功能，也不授权开启下一阶段。

判断文档冲突时：

- **工作方式**以本文件为仓库总入口，`docs/agent-workflow.md` 细化执行过程，Git/发布细则以 `docs/project/git-workflow.md` 为准。
- **产品与架构**按适用版本解释；v3.3.0+ 对话工作台以专门架构文档为准，旧三栏设计不能覆盖新主流程。
- **实现事实**核查源代码、配置、migration、manifest 和测试；路线图、任务书、审计快照不等于已实现或已验收。
- **历史资料**保留原有版本和验证时间，不把旧记录批量替换成当前版本。无法确认的差异明确报告，不猜测、不顺手改变实现。

## 3. 项目定位与技术边界

AI Novel Studio 是 **Windows 桌面端 AI 长篇小说创作工程系统**，不是普通聊天机器人、网页管理后台或一次生成整本小说的工具。

```text
用户控制方向 → AI 分工生成 → 章节逐步采用 → 上下文持续沉淀
```

| 层级      | 既有技术/职责                                                  |
| --------- | -------------------------------------------------------------- |
| 桌面壳    | Tauri 1.x + Rust                                               |
| 前端      | React 18 + TypeScript 5 + Vite 5                               |
| 路由/状态 | React Router 6（HashRouter）+ Zustand                          |
| 持久化    | 桌面 SQLite；浏览器开发由 Service 提供 LocalStorage 回退       |
| AI/运行时 | 统一服务层、受治理的 Provider 请求、固定版本 DSH Headless 载体 |
| 提示词    | 独立 Markdown 模板与既有模板注册/编译服务                      |

具体依赖以清单与锁文件为准。未经明确讨论不得更换技术栈、引入依赖、升级 DSH 载体或完整 Fork/嵌入 Harness Web UI。

### 当前产品边界

- 默认 `/` 是**创作工作台**：小说项目/任务树 + 独立任务对话；模型选择靠近输入区，工具调用、错误与产物卡片在对话内显示，不展示隐藏推理。
- **写作工作台**用于章节人工审阅、显式编辑、保存、采用及章节准备/总结，不恢复旧生成类 AI 面板为主流程。
- **当前插件**只读展示 Runtime Registry 实际加载的功能、模型与其他插件，不扩展成管理、市场或独立工具执行面板。
- 生产写章继续由确定性 Writer 编排；Canonical 只读链路、实验 Harness、Writing SubAgent 与 live Provider 验收是不同边界。当前准入和证据查阅对话工作台架构第 13～14 节，不凭目录存在或 Mock 通过宣称 R4 VERIFIED。
- 保持 Windows 桌面写作体验、既有主题和样式 Token、轻量边框、克制阴影、2K 可用性与正文舒适阅读；不做移动优先、无限宽表单、大面积渐变或表格后台风格。

## 4. 修改范围与安全底线

- 只修改目标及必要联动文件，不大规模随意重构，不顺手修复无关模块，不自行新增未来版本功能。
- 不删除用户未明确要求的旧路由或功能；获准删除也必须具备等价迁移与回退验证。
- 数据库结构、migration 和备份 schema 只在任务明确要求时调整；不改写已发布 migration，不操作真实用户库做测试。
- 不硬编码或提交 API Key、会话凭据、`.env.local`、用户正文、正式数据库；日志与验证证据必须脱敏。真实模型调用需明确授权，并遵守冻结模型身份、预算、取消与错误边界。
- 生成成功不等于正式采用。候选、用户决定、审阅授权、保存、采用和上下文沉淀不可混淆；不得绕过既有显式确认或已授权自动模式的复验门禁。
- 正式写入保留作品/章节/草稿作用域、版本或哈希基线、revision/CAS、事务与幂等检查。冲突、未知类型、缺失授权或失效基线必须失败关闭，不能静默覆盖正文。
- 浏览器回退不能冒充桌面 SQLite 事务或真实 Tauri/DSH 验收；Store 更新也不等于持久化成功。

## 5. 模块落点

| 位置                       | 应放内容                                              | 不应放内容                            |
| -------------------------- | ----------------------------------------------------- | ------------------------------------- |
| `src/pages/`               | 路由级布局、组件组合、窄 Store selector 与同步 action | AI/SQL、复杂业务编排                  |
| `src/components/`          | 通用 UI、局部交互与展示                               | 直接 AI/数据库调用、复杂业务逻辑      |
| `src/features/`            | 业务流程、Feature hooks、跨服务协调                   | 直接 DOM 操作                         |
| `src/services/`            | AI、Runtime、数据库、提示词、导入导出服务             | UI 组件                               |
| `src/store/`               | 可订阅运行时状态、同步 action                         | 数据库/AI/文件/网络/计时器/DOM 副作用 |
| `src/types/`               | 类型与契约定义                                        | 运行时业务逻辑                        |
| `src-tauri/`               | 原生能力、SQLite 事务、Gateway/DSH 宿主边界           | 前端 UI 逻辑                          |
| `prompts/`、`src/prompts/` | 既有模板与注册资产（按现有职责选择落点）              | 在组件内复制大段提示词                |
| `contracts/`               | 跨 TypeScript/Rust/DSH 的共享契约                     | 仅为绕过漂移门禁而改 hash 或 exposure |

不把所有逻辑塞进 `App.tsx`。完整依赖关系以 [模块边界](docs/module-boundaries.md) 为准；遇到 legacy 例外先限制新增耦合，不借规则整改之名扩大本次任务。

## 6. 验证矩阵

先运行直接覆盖变更的检查，再叠加适用层级；命令以 `package.json` 和 [测试策略](docs/technical/testing.md) 为准。

| 变更范围               | 必要验证                                                                                                                  |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| 纯文档                 | `npm run test:docs-sync`；改动文件的 Prettier；`git diff --check`；涉及版本/路线/发布口径时加 `npm run test:version-sync` |
| 前端/TypeScript        | 相关动态测试 + `npm run lint:ci` + `npm run build`；交互变化加相关 UI/E2E                                                 |
| Rust/SQLite            | `cargo check --locked --manifest-path src-tauri/Cargo.toml` + 相关测试；版本验收运行完整串行 Rust 测试                    |
| Tauri/DSH payload/打包 | 相关动态测试、真实 Windows Tauri E2E、`npm run tauri:build`                                                               |
| 发布                   | `scripts/agent-workflow/verify_project.ps1` 完整矩阵与 clean working tree                                                 |

文档任务示例（将路径替换为本次实际修改的文件，不运行全仓库格式化）：

```powershell
npm run test:docs-sync
npm run test:version-sync  # 涉及版本、路线或发布口径时
npx prettier --check AGENTS.md docs/agent-workflow.md
git diff --check
git status --short
```

Rust 测试保留 `--locked`；共享 DSH 状态的测试及完整 Rust 验收使用串行参数：

```powershell
cargo test --locked --manifest-path src-tauri/Cargo.toml -- --test-threads=1
```

涉及 DSH 的完整验收应先按测试文档准备固定载体并重建当前 Gateway，不能复用不明来源缓存。发布统一入口：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/agent-workflow/verify_project.ps1
```

发布矩阵包含版本/文档同步、覆盖率、lint、前端构建、Rust、真实 Windows Tauri E2E 与生产构建；定向测试不能替代它。纯文档任务不要求无关的完整 Tauri 发布构建。

任何检查失败都要定位原因：修复本次引入的问题；既有问题或环境阻碍记录命令、现象和影响，不放宽门禁、不伪造通过。跳过、`NOT_RUN`、Mock、浏览器与真实桌面/云端证据分别报告。

## 7. 文档同步、Git 与交付

1. 随修改同步相关文档，**在最终验证前**更新 `CHANGELOG.md`。不因纯文档任务自动升级应用版本，不新增逐版本 release-notes 碎片。
2. 功能/用户流程变化更新 README 和用户指南；架构/数据变化更新对应权威设计；只修正文档时不声称实现了新功能。
3. `commit`、`push`、创建 PR、合并、`tag` 和发布仅在用户或已确认任务明确授权相应动作时执行。小步修改不等于自动提交；普通任务不要求工作树干净。
4. 获准提交时只暂存本次相关文件并检查暂存差异，不使用无差别 `git add .` 混入用户修改。日常开发不直接提交到 `main`，不 force push，不移动既有 tag。
5. 发布严格按 [Git 治理](docs/project/git-workflow.md)：分支/PR → 适用门禁和审查 → 合入并同步 `main` → 不可移动的发布 tag。不要把示例命令视为自动执行授权。

完成汇报至少包含：

- **完成内容**：做了什么、未扩展哪些边界；
- **文件**：主要修改/新增文件及其用途；
- **验证**：实际执行的命令、结果，未执行项及原因；
- **风险**：剩余问题、限制和需用户决策的事项；
- **Git 状态**：是否提交/推送/打 tag，以及是否保留用户已有修改。

复杂版本任务可使用自包含任务书，注明目标、版本或“非版本任务”、禁止事项、实现要求、测试和汇报格式；同一会话内的明确任务不强制重复生成任务书。详细过程见 [Agent 工作流](docs/agent-workflow.md)。

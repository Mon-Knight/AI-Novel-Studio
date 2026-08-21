# Agent 要求时效审计（2026-08-20）

> 审计对象：`AGENTS.md`、Copilot instructions、`.github/instructions/`、`.github/skills/`、`.github/checklists/`、`.cursor/rules/` 与 Agent 开发文档  
> 当前发布基线：v3.2.1  
> 目标规划：v3.3.0+ 对话式并发创作工作台  
> 结论：发现过期要求并已在本次文档更新中修正；未修改应用代码、数据库 schema、版本号或发布行为

---

## 1. 审计结论

旧要求的安全、技术栈、领域权威和发布治理大部分仍有效；过期内容主要集中在 UI 目标、测试基线、Agent 系统状态、文件数量和协作形式。若不修正，后续 Agent 会被要求继续建设旧首页/右侧 AI 面板，或对纯文档任务执行完整 Tauri 发布构建，与已确认方向冲突。

| 类别           | 审计前问题                                                                  | 严重度 | 处理结果                                                                                                   |
| -------------- | --------------------------------------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------- |
| 主界面/UI      | 多个最高优先级规则无条件要求“作品首页 + 左树/中编辑/右工具栏”               | 高     | 改为按版本解释；v3.3.0+ 以项目/任务树 + 对话为主，旧布局只描述 v3.2.1 现状和回退路径                       |
| Harness 集成   | 没有明确源码复用方式，可能导致完整 Fork、嵌入 Web UI 或直接耦合内部 API     | 高     | 固定为 Harness Headless Worker + ANS DSH Adapter；当前 commit 不在工作台版本中顺带升级                     |
| 测试           | `testing.instructions.md` 仍标记 v2.1.8；多处要求每次修改都完整 Tauri build | 高     | 改为文档/前端/Rust/Tauri/发布分层验证；完整桌面与 clean tree 保留为发布门禁                                |
| Agent 系统状态 | Cursor 架构规则仍写“Agent 系统（预留）”                                     | 中     | 改为“已有基础，v3.3.0+ 演进”，列明现有 Planner、Registry、Artifact、Safe Apply、Memory、Multi-Agent 与 DSH |
| 规则数量       | 开发规则记录 5 个 Skills、5 个 Cursor rules                                 | 中     | 修正为实测 10 个 Skills、8 个 Cursor rules                                                                 |
| 协作形式       | 规则假定必须在 ChatGPT 与 VS Code 之间复制任务书，并要求每次任务 commit     | 中     | 保留用户主导原则；任务书按复杂度使用；commit/push/tag 只在用户或版本/发布任务明确要求时执行                |
| 删除规则       | “绝不删除旧功能”与用户已确认的分阶段 UI 收敛存在表面冲突                    | 中     | 改为不得删除用户未要求或尚未完成等价迁移、回退验证的功能                                                   |
| 当前插件       | 容易被扩展为插件管理系统                                                    | 中     | 固定为 Runtime Registry 只读投影，不含安装、卸载、启停、配置、更新、权限、市场或项目绑定                   |

---

## 2. 仍然有效、必须保留的要求

- Tauri + React 18 + TypeScript 5 + Vite 5 + HashRouter + SQLite 技术栈；
- 小说是领域最高级对象，SQLite 和领域服务是正式事实权威；
- 页面、组件、业务、服务、Store、类型和 Rust 模块边界；
- 用户控制方向和最终采用，普通模型回复不能直接写正式小说；
- Result Artifact、Decision、revision/CAS、Safe Apply 和审计边界；
- 不自动扩展需求、不顺手重构、不提交凭据、不直接在 UI 写 SQL/Prompt；
- 数据库 migration、备份、幂等、失败关闭与隔离测试要求；
- 日常分支、PR 门禁、main 合并和不可移动发布 tag 流程；
- Windows 桌面创作软件风格、2K 适配和禁止后台管理系统风格。

---

## 3. UI 规则的版本解释

```text
v3.2.1 当前行为
作品管理首页
→ 作品详情
→ 左卷章树 + 中编辑区 + 右侧 AI 面板

v3.3.0+ 目标
创作工作台（默认）
→ 小说项目
→ 独立任务对话
→ 内联工具 / 错误 / 产物
→ 确认、审阅、Safe Apply
```

旧页面说明没有被删除，因为它们仍描述 v3.2.1 当前行为和迁移期回退路径；新增的版本覆盖规则阻止 Agent 把旧布局继续当作 v3.3.0+ 目标。

---

## 4. Harness 源码复用要求

- 当前发布载体继续固定 `47f943859bef60e4160492346772ded9b24f765a`；
- `141eb6fef83422698aef7a981029e843e8161534` 仅作为 2026-08-20 架构分析快照；
- 实现前先审计两个提交的 Boot、Agent Loop、Tools、Session、Compaction 和 Plugin API 差异；
- 推荐固定版本 Headless Worker，通过 ANS Adapter 映射 Task/Run/Event/Tool/Artifact；
- 不完整 Fork Harness、不嵌入 Harness Web UI、不让 Cordis/DSH 内部对象成为 React 或 SQLite 契约；
- DSH Session Log 负责执行重放，ANS SQLite 继续负责小说正式事实；
- 当前插件视图读取 Adapter 输出的稳定只读 Projection。

---

## 5. 验证规则

| 变更范围               | 最低验证                                                                 |
| ---------------------- | ------------------------------------------------------------------------ |
| 纯文档                 | docs sync；涉及版本时 version sync；Prettier；diff/range check           |
| 前端/TypeScript        | 相关动态测试；`npm run lint:ci`；`npm run build`                         |
| Rust/SQLite            | `cargo check`；相关动态测试；版本验收完整 `cargo test`                   |
| Tauri/DSH payload/打包 | 相关桌面 E2E；生产构建                                                   |
| 发布                   | `scripts/agent-workflow/verify_project.ps1` 完整矩阵；clean working tree |

验证分层不降低发布要求，只移除了“所有小任务都执行所有发布门禁”的过期表述。

---

## 6. 已同步的高优先级规则

- `AGENTS.md`
- `.github/copilot-instructions.md`
- `.github/instructions/agent-behavior.instructions.md`
- `.github/instructions/frontend.instructions.md`
- `.github/instructions/testing.instructions.md`
- `.cursor/rules/agent-safety.mdc`
- `.cursor/rules/project-architecture.mdc`
- `.cursor/rules/ui-rules.mdc`
- `.cursor/rules/testing-rules.mdc`
- `.cursor/rules/task-writing-rules.mdc`
- `.github/skills/agent-task-writer/SKILL.md`
- `.github/skills/implement-feature/SKILL.md`
- `.github/skills/plan-version/SKILL.md`
- `.github/skills/review-ui/SKILL.md`
- `.github/checklists/feature-development.checklist.md`
- `.github/checklists/ui-review.checklist.md`
- `.github/checklists/verification.checklist.md`
- `docs/agent-workflow.md`
- `docs/development-rules.md`
- `docs/development-skills.md`

---

## 7. 后续审计规则

每次改变主工作流、技术栈、发布门禁或 Agent 协作方式时，应重新执行以下检查：

1. `AGENTS.md` 与 Copilot/Cursor 规则是否仍指向同一个目标版本；
2. UI Skill/Checklist 是否错误地把历史页面当作未来强制布局；
3. 测试指令是否与 `package.json` 和 `verify_project.ps1` 的真实命令一致；
4. Skills、instructions、rules 数量是否仍与实际目录一致；
5. 当前已实现、已确认规划和未来设想是否被明确区分；
6. Harness 固定源码 commit、参考源码和 Adapter 协议是否可追溯。

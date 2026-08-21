# AI Novel Studio 完整对话式创作工作台改造总任务书

> 交付对象：Codex  
> 任务性质：分阶段完成完整改造，阶段独立验收，可中断、可恢复、可回滚  
> 当前仓库：F:\ai-novel-studio-hotfix-v321  
> 当前分支：codex/v3.3.0-conversational-workbench  
> 当前基线：babf9c7497ad187bc8ac8c1714c13a3d1414fb1f（v3.2.1）  
> DSH 固定载体：47f943859bef60e4160492346772ded9b24f765a  
> 当前日期：2026-08-21

---

## 0. 任务总则

这是一份完整改造总任务书，不要求一次性修改完所有内容。Codex 必须按 Phase 0～4 顺序推进，每个阶段完成后执行阶段门禁，并保留独立提交点。

```text
Phase 0：接管、盘点、冻结边界
    ↓
Phase 1 / v3.3.0：真实 Harness Headless 任务工作台
    ↓
Phase 2 / v3.4.0：产物确认、Safe Apply、章节审阅采用
    ↓
Phase 3 / v3.5.0：能力迁移、上下文 Provider、旧 UI 收敛
    ↓
Phase 4：全量回归、完整实现确认、未打包 Release 主程序测试
```

阶段之间不得跳过门禁。任一阶段未完成时：

- 不得宣称“完整改造完成”；
- 不得进入下一阶段的代码删除或数据迁移；
  - 不得执行任何 Tauri/Windows/Release 可分发打包；
- 不得把 Mock、前端 fallback 或静态 UI 演示写成真实 Harness 能力。

**绝对硬门禁：在用户明确要求前，任何阶段都不得运行 `npm run tauri:build`、`npm run package:windows`、MSI/NSIS/updater 打包或 Release workflow。即使完整实现已完成，也只能先构建并测试未打包的 Release 主程序；可分发打包必须在完整实现、全部非打包验收、桌面 E2E 和未打包 Release 主程序测试通过后，等待用户明确要求再执行。**

---

## 1. 最终产品目标

最终产品交互必须稳定为：

```text
创作工作台（默认首界面）
└─ 小说项目
   └─ 任务对话
      ├─ 用户目标与引导
      ├─ 每任务独立模型
      ├─ AI 回复
      ├─ Harness 工具调用与错误
      ├─ 候选产物卡片
      ├─ 用户确认/退回/修改
      └─ Safe Apply / 章节人工审阅与采用
```

### 最终必须具备

1. 工作台是默认入口；小说是项目；对话是任务。
2. 同一小说下可以同时运行生成、审计、整理等独立任务。
3. 每任务拥有独立 Session、模型、运行、取消和产物。
4. DeepSeek Harness 作为固定版本 Headless Runtime，通过 ANS Adapter 接入。
5. AI 根据目标在 allowlist 中决定调用工具，而不是 ANS 硬编码固定流程。
6. 工具、错误、运行状态和产物从持久事实投影到对话。
7. 产物统一使用既有 ResultArtifact，不能出现第二套正文真相。
8. 章节候选必须经过确认、人工审阅、编辑/保存和显式采用。
9. 正式写入必须经过 Safe Apply、revision CAS、幂等和审计。
10. 可以查看当前实际加载的功能插件、模型插件和其他插件，但插件视图只读。
11. 上下文压缩可以通过 Provider 替换；正式小说上下文必须版本化并确认后应用。
12. 旧 UI 只有在等价迁移和回退验证完成后才删除。
13. 最终 Windows 安装包包含真实运行载体，并经过完整 E2E 与构建验证。

---

## 2. 当前状态与接管规则

开始前运行：

```powershell
Set-Location F:\ai-novel-studio-hotfix-v321
git branch --show-current
git rev-parse HEAD
git status --short
git diff --stat
node -e "console.log(require('./package.json').version)"
```

当前工作树已经包含部分 v3.3.0 文档、迁移、Rust 对话服务、Workbench UI、工具 Registry 和 DSH Adapter 改动。不得重置、清理或覆盖这些改动。

截至 2026-08-21，旧路径 F:\ai-novel-studio 已不存在且不在 git worktree list 中；不要重建该路径，也不要把它当作执行前置条件。

当前实现中的以下内容不能直接视为完成：

- taskSessionAdapter 的桌面路径已经委托 Rust DSH Runtime，但当前仍是每个 run 新建临时 Worker/Session Root、执行一次 prompt 后关闭，不能证明 follow-up 恢复同一 Harness Agent/Session；
- taskRuntimeAdapter 目前仍按固定顺序调用工具；
- conversation_artifact_cards 目前保存独立正文，尚未完全并入 ResultArtifact；
- 当前插件 Projection 仍有合成状态，必须接入真实 Runtime/Registry 健康结果；
- 现有并发测试主要证明前端 Promise 隔离，尚需真实 Worker/Job 隔离；
- 当前 package 仍为 3.2.1，未完成前不得提前改成最终发布状态。

---

## 3. 权威设计与源码阅读

开始任何 Phase 前必须阅读：

```text
docs/architecture/conversational-creative-workbench.md
docs/architecture/v3.3.0-conversational-workbench-taskbook.md
docs/audit/dsh-baseline-diff-2026-08-20.md
docs/product-design.md
docs/ui-reference.md
docs/data-model.md
docs/project-architecture.md
docs/agent-runtime.md
docs/version-roadmap.md
```

Harness 源码只读对照：

```text
F:\dsh-v320-clean
F:\deepseek-harness-source-analysis-20260820
```

必须重点核对 Profile/Bundle/Cordis composition、Agent Loop、Tool Pipeline、Session event、Compaction seam、Model snapshot 和 UI 投影边界。参考快照只用于理解实现，不得替换固定载体。

### 3.1 GitHub 固定源码复用原则

官方仓库 `https://github.com/deepseek-ai/deepseek-harness` 与固定提交 `47f943859bef60e4160492346772ded9b24f765a` 是 Harness 底层逻辑的实现依据。Codex 不得凭通用 Agent 经验重写 Agent Loop、Session、Tool Pipeline、inbox/cancel、Profile/Bundle 或 Compaction；必须先在 `reports/full-workbench/dsh-source-map.md` 建立源码映射。

源码映射至少包含：

| 目标                 | 固定提交源码                                                                          | ANS 使用方式                                                           |
| -------------------- | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| 多轮 Turn/Step       | `packages/core/agent-loop/src/agent.ts`、`tool-calls.ts`                              | 复用 `ctx.agents.create/resume` 和 Agent handle，不复制私有 driver     |
| 后续消息、取消、收敛 | `packages/core/agent/src/types.ts`、`inbox.ts`、`dispatch.ts`                         | 复用 follow-up/steer/inject/cancel/whenIdle 语义                       |
| 持久会话事实         | `packages/core/session/src/index.ts`、`types.ts`、`surface.ts`                        | 从 append-only `session/event` 投影 ANS SQLite，DSH log 不取代小说事实 |
| 工具能力             | `packages/core/tools/`、`packages/core/agent-loop/src/tool-calls.ts`                  | 四个小说工具按 scoped allowlist 注册，走既有工具管线，不固定顺序调用   |
| 模型路由             | `packages/core/agent/src/model-selection.ts`                                          | 任务级冻结并映射公开模型选择机制                                       |
| Runtime/插件组合     | `docs/architecture.md`、`packages/bundle/headless/`、`packages/preset/agent-presets/` | 使用 Profile/Bundle/Cordis composition 与真实加载健康结果              |
| 对话压缩             | `packages/compaction/compaction/`、`compaction-basic/`                                | Phase 3 复用 capability seam；小说上下文 Provider 保持独立             |

固定提交的 `dsh-headless` 是 one-shot runner，只提交一次任务并在 Agent idle 后退出，不能直接满足多轮工作台。ANS 应借鉴它的无 Web Server 组合与启动方式，但通过 Harness Core 的公开 Agent/Session/Tools API 建立持久 Worker Adapter。若 DSH 已提供公开机制则优先直接复用或薄适配；只有 DSH 不拥有的小说领域逻辑允许新增。所有偏离必须记录上游文件/符号、原因、ANS 文件和动态测试，不能只写“参考 Harness”。

---

## 4. 总禁止清单

所有阶段均禁止：

1. 升级、移动或替换固定 DSH commit。
2. 完整 Fork Harness 或嵌入 Harness Web UI。
3. 把 Cordis/DSH 内部类型暴露给 React、SQLite 或长期领域模型。
4. 把 DSH Session Log 当作小说事实源。
5. 让模型或插件绕过 ANS Safe Apply 写正式小说。
6. 把普通 assistant 文本当作正式 Artifact。
7. 创建第二套 Artifact 正文、验证、确认或应用真相。
8. 绕过全局 Provider 并发、Token、成本、凭据和 request lease 治理。
9. 将 API Key、完整 prompt、reasoning 或 Provider raw body 写入普通日志、事件或 UI。
10. 添加插件安装、卸载、启停、更新、配置、权限、项目绑定或插件市场。
11. 添加独立执行时间线、任务计划、工具详情或产物详情主面板。
12. 将软件改造成通用代码、Shell、Git 或 MCP Agent。
13. 在功能等价迁移前删除旧页面、旧路由、旧 AI 面板或旧数据服务。
14. 在完整实现前执行任何打包命令。
15. 使用一次手动演示、静态字符串检查或前端 Mock 代替动态测试。
16. 未建立固定提交 source map 就自制 Agent Loop、Session 状态机、工具调度、取消恢复或压缩逻辑，或复制 Harness 包内私有 driver 绕过公开 API。

---

# Phase 0：接管、盘点与冻结

## 0.1 目标

确认当前脏工作树的真实范围、现有实现可复用部分和每阶段边界，不修改应用行为。

## 0.2 操作

1. 记录 branch、HEAD、package version、status 和 diff stat。
2. 列出已修改/未跟踪文件，标注属于 workbench、DSH、旧功能或无关改动。
3. 检查 conversation migrations 是否已在本机开发数据库运行过。
4. 检查当前 DSH payload 是否为固定 commit。
5. 检查 ResultArtifact、Safe Apply、AI request ledger、backup 和 E2E 入口。
6. 生成 `reports/full-workbench/dsh-source-map.md`，逐项记录固定提交源码路径/符号、复用 API/事件、ANS Adapter、必要差异和测试。
7. 生成 reports/full-workbench/phase-0-inventory.md，记录文件、风险和继续策略。

## 0.3 Phase 0 门禁

```powershell
npm run test:docs-sync
npm run test:version-sync
npx prettier --check <changed-docs>
git diff --check
```

Phase 0 只允许盘点报告和文档改动，不允许打包。

---

# Phase 1 / v3.3.0：真实 Harness Headless 任务工作台

详细实现以 v3.3.0-conversational-workbench-taskbook.md 为准。

## 1.1 Runtime

实现固定 DSH Headless Worker + ANS Adapter：

```text
TaskConversation
→ stable sessionId / agentId
→ one active Worker per task
→ initialize
→ real session/prompt
→ Harness Turn/Step
→ session.event
→ persisted ANS events
→ next step / turn end
```

要求：

- 以固定提交的 Core Agent/Session/Tools 公开接口为底层，不另写一套循环；
- 官方 headless one-shot 只作为无 Web Server 的组合参考，持续对话必须由持久 Agent/Session Worker Adapter 承载；
- 首轮和 follow-up 复用同一 SessionId，通过 Agent inbox 进入真实 Turn/Step；
- 不再由 taskRuntimeAdapter 硬编码工具顺序；
- Harness 根据用户目标选择 allowlist 工具；
- 两个不同任务真实并发；
- 取消一个 Worker 不影响另一个；
- Worker crash、超时、restart 都有持久终态；
- DSH 失败不能静默降级为前端固定流水线；
- 浏览器 fallback 必须显式标记为 fallback。

## 1.2 首批工具

仅开放：

```text
novel.read_context@1
chapter.read_outline@1
search_memory@1
generate_chapter@1
```

读取工具只读；generate_chapter 只生成候选。

## 1.3 任务模型与事件

- 每个 run 冻结 Provider、modelId、参数、价格、runtime commit 和 Adapter protocol；
- UI 切换任务不取消后台；
- 事件先持久化再通知前端；
- 刷新/重启从 SQLite 重建；
- 错误附着在具体工具或运行节点；
- 重试创建新 run，不覆盖旧 run。

## 1.4 ResultArtifact

generate_chapter 必须接入既有 AI Task/Attempt/ResultArtifact 管线。对话卡片只保存 artifactId 和投影元数据，不保存第二份正文。

## 1.5 当前插件视图

只读显示：

- 功能插件：真实 Tool Registry；
- 模型插件：可用 Provider/Model directory；
- 其他插件：固定 DSH payload/Profile/Bundle 与初始化健康状态；
- loaded/failed/unavailable 必须真实，不以 isTauri() 猜测。

## 1.6 Phase 1 禁止

- 不实现确认、Safe Apply 或章节采用；
- 不删除旧 UI；
- 不实现上下文压缩 Provider；
- 不实现插件管理；
- 不打包。

## 1.7 Phase 1 门禁

```powershell
npm run test:workbench
npm test
npm run test:vitest
npm run test:performance
npm run lint:ci
npm run build
Set-Location src-tauri
cargo check --locked
cargo test --locked
Set-Location ..
npm run test:e2e
npm run test:docs-sync
npm run test:version-sync
git diff --check
```

Phase 1 完成后创建本地阶段提交，版本进入 3.3.0；不 push、不 tag、不打包。

---

# Phase 2 / v3.4.0：产物确认、Safe Apply 与章节审阅

只有 Phase 1 全部门禁通过并保留阶段提交后开始。

## 2.1 结构化产物决定

复用或扩展不可变决定事实：

```text
candidate
→ request_revision
→ confirm / reject / request_revision
→ request_apply
→ applied / conflict / expired
```

要求：

- 决定引用 artifactId、artifact hash、目标和 base revision；
- 重复决定使用幂等键；
- 冲突不得最后写入覆盖；
- 旧 artifact、决定和应用事务可追溯；
- 普通消息不能改变决定状态。

## 2.2 Safe Apply

- 只允许领域服务执行正式写入；
- 通过 revision CAS、目标归属和内容 hash；
- 成功返回事务 ID 和新 revision；
- 明确区分冲突、过期、校验失败、权限失败和重复应用；
- 失败不得修改正式小说事实；
- 应用状态从持久事实投影到对话。

## 2.3 章节双阶段采用

```text
章节候选
→ 对话确认进入审阅
→ 原写作工作台默认只读
→ 用户显式编辑
→ 用户保存人工修改
→ 用户显式采用
→ Safe Apply
```

打开审阅不等于保存，保存不等于采用，采用不等于自动继续生成。

## 2.4 页面变化

能力等价验证后：

- 删除导航“待确认”；
- 删除作品详情“待确认产物”；
- 把待处理状态迁入任务树和对话卡片；
- 旧写作工作台保留为审阅/编辑器；
- 不删除旧 AI 面板，直到 Phase 3。

## 2.5 Phase 2 门禁

必须动态验证 confirm/reject/revision/apply 状态边、同目标冲突、CAS 失败、重复点击幂等、章节审阅授权、人工编辑保存后采用和旧 pending 入口迁移。完整前端、Rust、备份和桌面 E2E 必须通过，仍不得打包。

Phase 2 完成后创建本地阶段提交，版本进入 3.4.0；不 push、不 tag、不打包。

---

# Phase 3 / v3.5.0：领域能力迁移与旧 UI 收敛

只有 Phase 2 的 Safe Apply 和章节采用闭环稳定后开始。

## 3.1 迁移为任务工具/工作流

逐项迁移并验证：

- 大纲生成/扩展；
- 人物一致性与人物候选；
- 世界设定/事件候选；
- 伏笔和剧情审计；
- 风格分析/润色；
- 章节总结；
- 质量检查与修复建议；
- 上下文整理和记忆检索。

每项必须遵循：

```text
任务对话
→ 领域工具
→ 验证
→ ResultArtifact
→ 用户决定
→ Safe Apply（需要正式写入时）
```

## 3.2 上下文 Provider

### 对话压缩

- 只压缩任务 Session 输入表面；
- 可使用 Harness Compaction seam；
- 不改变小说正式知识。

### 小说上下文压缩

- Provider 读取固定小说 revision；
- 生成压缩候选和覆盖率证据；
- 校验人物、剧情、伏笔、时间线、规则和目标 token；
- 形成 ResultArtifact；
- 用户确认后 Safe Apply；
- 保留旧上下文版本；
- 任务绑定 Provider/version/config 必须冻结。

## 3.3 旧 UI 收敛

只有以下条件全部满足才允许删除旧 UI：

1. 新任务工具能力等价；
2. 产物确认和 Safe Apply 已覆盖原操作；
3. 旧数据可以由新任务读取；
4. 有回退路径和迁移测试；
5. UI 审查确认用户仍能发现能力；
6. 旧功能调用方和 E2E 已迁移；
7. 用户明确同意进入删除阶段。

允许收敛：

- 旧右侧 AI 生成、大纲、角色、事件、设定、风格、检查、润色面板；
- 草稿版本查看入口；
- 重复的作品详情 AI 入口。

必须保留：

- 小说/卷/章目录；
- 正文阅读；
- 章节审阅；
- 显式人工编辑、保存和采用；
- 必要阅读设置；
- 底层审计、历史 Artifact 和领域服务。

## 3.4 Phase 3 门禁

- 每个旧 AI 能力都有新任务替代验收；
- 旧入口删除后没有功能丢失；
- 章节编辑器默认只读，编辑/保存/采用明确可区分；
- Context compression Provider 有候选、验证、确认、应用和回滚测试；
- 多任务并发和目标冲突继续有效；
- 全部旧面板 E2E 迁移完成；
- 文档和 Agent 要求不再把旧 UI 描述为未来目标。

Phase 3 完成后创建本地阶段提交，版本进入 3.5.0；不 push、不 tag、不打包。

---

# Phase 4：完整实现确认与最终桌面发布

## 4.1 全量实现验收

必须确认：

- Phase 0～3 的阶段提交和报告存在；
- 工作台、并发 Runtime、Artifact、确认、章节采用、Context Provider 和旧 UI 收敛全部完成；
- 没有未决 P0/P1 阻断问题；
- 没有伪 DSH、第二 Artifact 真相源或静默 fallback；
- `dsh-source-map.md` 已证明核心实现来自固定提交公开机制，所有必要偏离均有源码引用和动态测试；
- 当前插件只读视图与实际 Runtime 一致；
- 备份恢复、重启恢复、错误恢复、取消和冲突都已动态证明；
- 版本文档与代码一致。

## 4.2 最后一次非打包门禁

```powershell
npm run test:version-sync
npm run test:docs-sync
npm run test:all
npm run lint:ci
npm run build
Set-Location src-tauri
cargo check --locked
cargo test --locked
Set-Location ..
npm run test:e2e
git diff --check
```

这一步全部通过前禁止打包。

## 4.3 未打包 Release 主程序测试

只有 4.2 全部通过后才允许构建和测试未打包的 Release 主程序：

```powershell
$env:DSH_CHECKOUT='F:\dsh-v320-clean'
npm run build
Set-Location src-tauri
cargo build --release --locked
Set-Location ..
```

运行 `src-tauri/target/release/AI Novel Studio.exe` 完成桌面测试，确认工作台启动、对话、多任务并发、错误恢复和固定 DSH payload 均正常。此步骤不生成 MSI、NSIS、updater 或其他可分发安装包。

## 4.4 用户明确要求后的可分发打包

只有用户明确要求，并且 4.2 与 4.3 全部通过后，才允许执行：

```powershell
$env:DSH_CHECKOUT='F:\dsh-v320-clean'
npm run tauri:build
```

此时才验证 MSI、NSIS/EXE、所需 updater 资产、固定 DSH payload、安装启动工作台和打包版本 E2E。

## 4.5 发布动作

本任务书只要求本地阶段提交和最终本地构建。push、PR、tag、GitHub Release 和 updater 发布需要用户另行明确指令。

---

## 5. 跨阶段数据与版本原则

### 5.1 数据

- 不直接删除旧表；
- 新 migration 必须可重复、可升级、可回滚诊断；
- 备份 schema 和恢复测试同步演进；
- ResultArtifact 是候选真相源；
- 任务事件是执行事实，不是小说事实；
- SQLite 是桌面权威，LocalStorage 只是浏览器 fallback。

### 5.2 版本

```text
Phase 1 → v3.3.0
Phase 2 → v3.4.0
Phase 3 → v3.5.0
Phase 4 → 用户批准的最终发布版本
```

每个版本只能实现本阶段目标。不得在 v3.3.0 直接删除 v3.5.0 旧 UI，也不得在 v3.4.0 预先替换全部 Context Provider。

### 5.3 阶段提交

每阶段完成后：

```powershell
git status --short
git diff --check
git add <该阶段实际文件>
git commit -m "feat: complete vX.Y.Z <phase description>"
```

提交前不得包含临时数据库、密钥、payload 临时目录、target、node_modules、原始工作树内容或无关改动。

---

## 6. 总体验收矩阵

| 能力                        | Phase 1 | Phase 2   | Phase 3       | 最终           |
| --------------------------- | ------- | --------- | ------------- | -------------- |
| 工作台默认入口              | 完成    | 保持      | 保持          | 通过           |
| 小说项目/任务对话           | 完成    | 保持      | 扩展          | 通过           |
| 真实 Harness Headless       | 完成    | 保持      | 扩展 Provider | 通过           |
| 四个基础工具                | 完成    | 保持      | 扩展          | 通过           |
| 任务并发/取消/恢复          | 完成    | 保持      | 增强冲突      | 通过           |
| 当前插件只读显示            | 完成    | 保持      | 保持          | 通过           |
| ResultArtifact 卡片         | 完成    | 决定/应用 | 扩展类型      | 通过           |
| Safe Apply                  | 不做    | 完成      | 扩展          | 通过           |
| 章节审阅/显式采用           | 不做    | 完成      | 保持          | 通过           |
| 上下文压缩 Provider         | 不做    | 不做      | 完成          | 通过           |
| 删除旧 AI 面板              | 不做    | 不做      | 完成          | 通过           |
| 未打包 Release 主程序       | 禁止    | 禁止      | 禁止          | Phase 4 测试   |
| MSI/NSIS/updater 可分发打包 | 禁止    | 禁止      | 禁止          | 用户明确要求后 |

---

## 7. 完整失败标准

以下任一项存在，必须停止并报告未完成：

- 任一阶段只完成 UI，没有持久事实和动态测试；
- DSH 仍被前端固定流水线冒充；
- 没有固定提交 source map，或自行编写 Harness 已有的 Agent/Session/Tools 底层机制；
- 把 one-shot headless runner 每轮重启包装成持续对话；
- DSH 失败后静默执行 fallback；
- 并发只有 Promise 测试，没有真实 Worker/Job 隔离；
- 产物卡片保存第二份正文；
- 确认/应用绕过 revision CAS 或 Safe Apply；
- 章节打开审阅即自动保存或采用；
- 上下文压缩直接覆盖旧正式事实；
- 当前插件状态由硬编码或 isTauri() 推断；
- 删除旧 UI 后能力无法发现或无回退；
- 任何打包早于完整实现验收；
- 用户未明确要求时执行可分发打包；
- 只运行 build，未运行动态测试、Rust 测试和桌面 E2E。

---

## 8. Codex 总完成汇报格式

```markdown
# AI Novel Studio 完整改造完成汇报

## 一、阶段状态

- Phase 0：
- v3.3.0：
- v3.4.0：
- v3.5.0：
- Phase 4：

## 二、分阶段提交

- Phase 0 commit：
- v3.3.0 commit：
- v3.4.0 commit：
- v3.5.0 commit：
- 最终发布 commit：

## 三、Harness

- 固定 DSH commit：
- Headless Worker：
- Session/Agent/Turn/Step：
- 工具事件：
- Worker 并发/取消/恢复：
- 请求治理：

## 四、工作台

- 项目/任务树：
- 任务级模型：
- 当前插件只读视图：
- 对话工具/错误/产物：

## 五、产物与正式写入

- ResultArtifact：
- 确认协议：
- Safe Apply：
- 章节审阅/编辑/保存/采用：
- Context compression Provider：

## 六、旧 UI 迁移

- 待确认入口：
- 作品详情待确认产物：
- 草稿版本查看：
- 旧 AI 面板：
- 回退与迁移测试：

## 七、验证

- Phase 0 门禁：
- Phase 1 门禁：
- Phase 2 门禁：
- Phase 3 门禁：
- 最终非打包门禁：
- 未打包 Release 主程序门禁：
- 可分发打包门禁：仅在用户明确要求后填写；

## 八、构建与打包顺序证明

- 完整实现确认时间：
- 最后一个非打包测试时间：
- 未打包 Release 主程序构建和测试时间：
- 用户明确要求可分发打包的时间（没有则写“未要求”）：
- Tauri/Windows 可分发打包开始时间（没有则写“未执行”）：
- DSH payload commit：
- 未打包 Release 主程序路径和 hash：
- MSI/NSIS/EXE 路径和 hash（没有则写“未生成”）：

## 九、未完成项

- 没有则写“无”。
- 任何未完成项都不得把总体状态写成完成。
```

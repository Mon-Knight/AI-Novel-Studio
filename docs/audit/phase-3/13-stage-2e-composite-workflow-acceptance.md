# 阶段 2E — 组合工作流试点与阶段 2 收口验收报告

## 结论

阶段 2E 代码、Mock 动态测试、自动化验收与真实桌面低成本冒烟均已完成。试点只组合阶段 2D 已迁移的质量能力，继续使用 `AiTask + Rust Worker + 018 DAG`；没有新增 migration、任务表、Provider 参数、版本号或自动 Apply。阶段 2A～2E 的既定验收边界完整通过。

## 工作流节点与依赖

```text
quality_revision_workflow（父任务，不调用 Provider）
└─ freeze_chapter：workflow_freeze_chapter / generic_json
   └─ quality_check：quality_check / quality_report
      └─ quality_fix：quality_fix / chapter_text
         └─ quality_recheck：quality_recheck / quality_report
            └─ review_bundle：workflow_quality_review_bundle / generic_json / waiting_user
```

汇总节点同时显式依赖初检、修复和复检节点，因此最终审查包可验证并保存三类上游 Artifact 身份。每个子节点只创建自己的 Attempt 与 Artifact；父任务不创建 Attempt。

## Worker 执行链

React 在提交前保存当前编辑内容为冻结草稿，编译质量检查 Prompt 和五步规格，通过 `create_background_ai_workflow` 原子写入父子 Task、Snapshot 与依赖。提交完成后 UI 立即恢复正常工作台。

Rust Worker 事务认领可执行子节点。冻结与汇总节点在 Worker 内本地执行，质量检查、修复和复检走统一异步 Provider/Mock Provider；进度写 SQLite 并推送 Tauri Event。最终汇总 Artifact 保存初检、复检、修复 Artifact ID、`automaticApply=false` 和 `reviewStatus=waiting_user`。

WebView 不等待 Provider Promise，也不拥有取消令牌、重试、恢复或 Artifact 保存生命周期。

## 取消、重试、恢复与 stale

- 父任务取消继续复用 2C 级联取消，已完成 Artifact 保留，未完成子节点进入取消流程。
- 子节点失败只对该 Task 创建新 Attempt；已成功节点及其 Artifact 不重复执行。
- queued 与 lease 过期任务继续由 2B 启动扫描恢复；已完成 Artifact 和最终待审查状态保持不变。
- latest draft/version/hash 变化会将整条工作流及已有 Artifact 标记 stale；queued 节点不可认领。
- Worker 在持久化响应前再次检查 `stale_at`，在途迟到响应以 `AI_WORKFLOW_STALE` 失败关闭且不创建 Artifact。

## 任务中心与确认边界

任务中心显示工作流总进度、当前步骤、完成/失败/等待/stale 节点，并沿用局部重试、局部取消和父任务取消。普通视图使用“冻结章节快照、质量检查、质量修复候选、修复结果复检、汇总审查包”等作者文案。

最终汇总包只生成一个有效 Artifact，并提供打开关联修复正文候选的入口。汇总包确认只记录审查 TargetLink；修复正文只有在用户单独确认其 Proposal 后才可创建 ApplyPlan。未确认时章节正文、采用指针和 Canon 均不变化。

## 自动化证据

- 前端：2E 工作流规格与提交 2/2；AI Worker 前端套件 7/7；AI Task pipeline 26/26；任务中心与工作流视图 6/6，包含普通任务条不泄露内部任务类型名。
- Rust：全量 139/139；新增完整五步成功、失败节点局部重试和 stale 迟到响应不落 Artifact 三项动态测试。
- 既有 Worker 的双认领保护、真实取消令牌、lease 恢复、父任务级联取消、重启图恢复、Artifact 唯一和 ApplyPlan stale 门禁继续通过。
- lint：0 error，仅保留仓库原有 1 条 Hook dependency warning。

- 前端 build、cargo check、完整 Tauri MSI/NSIS build、migration 动态升级和 `git diff --check` 通过。

## 真实桌面低成本冒烟

在 release 桌面应用中沿用既有“真实 API / deepseek-v4-flash”配置完成一次五步工作流，未修改 Provider 参数。测试对象为《僵尸先生》第 1 章《夜色诡影》，提交前正文为草稿 v7、2,583 字。

- 提交后立即返回正常工作台，任务条显示后台状态，没有全屏遮罩或自动跳转。
- 任务运行期间成功切换到第 2 章《山魈魅影》，编辑器和导航保持可用。
- 任务中心先后显示 20%（冻结快照完成）、40%（进入修复候选）和 100%（5/5）；最终父任务进入“等待确认”。
- 展开后五个节点均为已完成：冻结章节快照、质量检查、质量修复候选、修复结果复检、汇总审查包。
- 最终汇总审查包可打开，并提供“查看并决定是否采用修复候选”入口；冒烟没有点击采用。
- 返回正文后仍为草稿 v7、2,583 字、已采用状态不变，证明未确认结果没有修改正文或 Canon。
- 关闭并重新启动最新 release 后，SQLite 中的工作流仍恢复为“等待确认”，顶部任务条继续显示作品和章节范围。

冒烟发现顶部任务条曾回退显示内部任务类型名。显示层随后改为统一作者文案映射，未知类型也只显示“AI 创作任务”；对应任务中心测试已覆盖，工程标识仍只保留在高级详情。

## 阶段 2 边界结论

阶段 2 基础设施已经通过代码、Mock 动态测试、SQLite/Rust 测试和真实桌面冒烟证明可支持应用进程内、非阻塞、持久化、可恢复的组合 AI 工作流：Task/Attempt/Artifact 统一可见，Rust Worker 拥有执行生命周期，DAG 支持依赖、局部重试、级联取消与 stale，最终写入仍由用户确认控制。阶段 2 在任务书定义的应用进程内边界内完整验收通过。

阶段 2 不包含应用退出后继续运行的系统服务、正式创作导演、多 Agent、Story State、滚动规划、偏好引擎或自动 Apply。

## 进入阶段 3 前仍需解决

- 冻结“创作意图”的版本化输入 contract，区分作者显式目标、可推断偏好和禁止自动确认的事实。
- 定义初始化产物的候选 schema、来源证据、冲突解释和用户逐项确认边界。
- 为未来导演增加决策审计与预算边界，但继续复用现有 AiTask/DAG，避免建立新的调度或状态体系。
- 在引入人物、世界观或规划 Agent 前，先明确跨目标 ApplyPlan 的事务与回滚策略；当前阶段仍只具备安全的单目标应用边界。

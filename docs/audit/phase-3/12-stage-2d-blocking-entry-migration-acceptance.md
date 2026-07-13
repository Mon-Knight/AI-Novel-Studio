# 阶段 2D — 阻塞式 AI 入口迁移验收报告

## 结论

阶段 2D 代码与自动化验收完成。迁移继续使用 `ai_tasks / ai_task_attempts / ai_*_snapshots / result_artifacts`、017 Worker 和 018 DAG，没有新增 migration、任务表或 Provider 参数。

## 已迁移入口

- 质量：手动检查沿用 2B；质量修复与复检迁为 `quality_fix → quality_recheck` 两步 DAG。
- 润色：右栏正文润色迁为单步 `chapter_polish` 工作流。
- 摘要：右栏章节摘要、正文采用后章节摘要、卷摘要迁为后台工作流。
- 大纲：右栏、作品大纲管理和独立大纲编辑器的主纲、卷纲、章纲生成均迁为后台工作流。

上述生产 UI 已不再调用对应 Service 的同步 Provider 方法。旧方法保留为未迁移兼容边界，不再由这些入口执行。

## 统一执行链

```text
React 编译 Prompt 与目标基线
→ create_background_ai_workflow
→ AiTask + immutable Snapshots + DAG
→ Rust Worker transaction claim + Attempt
→ async Provider / Mock Provider
→ persisted progress + Tauri Event
→ validated Artifact
→ 任务中心等待审查
```

父 Task 不调用 Provider。质量复检只能在修复 Artifact 完成后入队；单步任务也使用父子工作流，以复用取消、重试、恢复、stale 和任务中心步骤视图。

## 结果与确认

- Worker 支持 `chapter_text`、`quality_report`、`chapter_summary`、`volume_summary`、`outline_text`、`volume_outline` 和 `chapter_outlines`。
- 每个节点写一个有效 Artifact；认领前已有有效 Artifact 时不重复调用或保存。
- 所有最终待审查 Artifact 完成时建立 PlacementProposal。任务中心明确确认后才创建/执行 ApplyPlan；未确认不产生 TargetLink。
- `chapter_text` 计划可创建并采用新草稿；摘要与大纲计划只写 `artifact_review` TargetLink 作为审查证据，不自动写章节总结、卷上下文、正式规划、Story State 或 Canon。

## 自动化证据

- Rust 全量：136/136；包含全部 2D Mock 类型、质量修复依赖顺序、正文 Proposal、审查型 ApplyPlan/TargetLink、单 Artifact 和无自动 Canon 写入。
- 前端后台提交：5/5；工作流视图：5/5；组件：9/9；P0 安全：8/8。
- AI Task pipeline：26/26；Artifacts：2/2；Placement：13/13；ApplyPlan：12/12；Constraint：8/8；Candidate lifecycle：16/16；Workspace reliability：10/10；Migration：2/2。
- lint：0 error，仅保留仓库原有 1 条 Hook dependency warning。
- 前端 build、cargo check、质量工作台静态检查、完整 Tauri MSI/NSIS 打包和 `git diff --check` 通过。

## 桌面验收限制

调试桌面程序可以构建并启动，但验收时 Windows 处于锁屏界面。遵循桌面自动化安全边界，没有继续点击、没有读取或修改 Provider 配置，也没有发送真实请求。因此“每类入口一次真实桌面 Provider 冒烟”未宣称通过；Mock Provider 动态覆盖全部迁移类型。

## 未迁移入口

章节正文生成/重写、章节工程生成、角色候选、事件建议、章节设定补充、设定库候选、风格分析和连接测试之外的低频 AI 功能仍保持原边界。

## 阶段 2E 建议边界

2E 应只组合已经迁移的 2D 节点，定义一个明确的候选工作流模板；不要迁移新入口、不要引入正式创作导演或多 Agent，也不要扩大 ApplyPlan 到未经单独审计的多目标业务写入。

# 阶段 2A — 统一 AI 任务中心验收报告

## 结论

阶段 2A 已完成。新 `ai_tasks` 是权威来源，旧任务只作为只读兼容投影，没有新建任务表或第三套状态系统。

## 实施结果

- Rust `list_ai_task_views` 聚合 Task、最新 Attempt、Artifact 校验摘要、最新 Proposal/ApplyPlan、TargetLink、作品和章节名称。
- 同 ID 按 `ai_tasks > ai_task_records > generation_jobs` 去重；不同 ID 不依靠相似度猜测为同一任务。
- React Store 启动读取 SQLite，管线事件可增量更新；读取失败保留显式错误状态。
- 任务中心提供正在运行、等待确认、最近完成和失败分区。普通视图隐藏工程标识，高级详情完整展示审计字段。
- AppShell 任务条在正常布局流中，不使用 overlay、modal 或自动跳转。
- 工作台不再挂载旧 `GlobalAiTaskModal`。

## 状态文案

`准备中 / 工作中 / 检查结果 / 等待确认 / 已完成 / 已失败 / 已取消 / 结果已过期` 已成为统一用户状态。

## 验收证据

- 前端专项：4/4（含页面切换后任务条仍可见）。
- Rust 投影专项：4/4（含关闭并重新打开 SQLite 后恢复任务）。
- 查询失败不会显示空列表；候选完成进入等待确认；Legacy 精确去重与新来源优先均有动态测试。

## 限制

未迁移的 Legacy 入口仍可使用旧加载 UI；本阶段只保证新任务条自身非阻塞，不批量改写旧入口。

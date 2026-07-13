# 阶段 2C — 父子任务编排与依赖 DAG 验收报告

## 结论

阶段 2C 已完成编排基础。实现继续使用 `ai_tasks / ai_task_attempts / result_artifacts`，没有第三套任务系统；父任务不执行 Provider，只聚合子任务。

## 数据模型

- Migration：`018_ai_task_orchestration`，不占用保留的 `016`，不修改 001～017。
- `ai_tasks`：workflow、root、parent、agent role、step、priority、concurrency group、required 与 stale 字段。
- `ai_task_dependencies`：下游 Task、上游 Task、required、创建时间；双外键、同作品隔离和循环检测。
- `ai_artifact_stale_events`：append-only Artifact 过期来源、原因和触发时间，不修改不可变 Artifact 内容表。

## 调度与聚合

- 必需依赖全部完成后，ready 节点自动 queued；Worker 认领时再次验证依赖。
- 两个固定 Worker 槽允许有限并行；相同非空并发组互斥。
- 父任务按子任务等待、运行、失败、取消、完成与 stale 聚合状态和百分比，不创建 Attempt 或 lease。
- 局部重试只重置失败节点；成功节点和有效 Artifact 保留。Snapshot/stale 变化要求创建新节点或新工作流。
- 父取消级联到所有未终止子节点，运行请求通过 CancellationToken 中断；完成 Artifact 保留。

## stale

显式上游变更沿 DAG 递归写入下游 Task 与 Artifact stale 事件；章节采用草稿或正文 hash 变化会自动将整个试点工作流标记过期。ApplyPlan 创建和执行均拒绝 stale Artifact。

## 组合工作流

```text
准备章节资料
→ 生成章节摘要候选
→ 执行摘要一致性检查
→ 汇总为待审查 Artifact
```

每个步骤有独立 Attempt 和 Artifact。最终父任务只链接一个审查汇总候选；不写章节正文、Canon、Story State 或正式章节总结。

## 状态映射

- waiting_dependency：ready + 未完成依赖
- queued/running/cancel_requested/cancelled/failed/completed：复用现有 Task 状态
- waiting_user：completed + 父任务 requiresReview
- interrupted：Attempt interrupted 留痕，Task queued 或 failed
- stale：Task stale 字段 / Artifact stale event，UI 显示结果已过期

## 限制

- 当前最大并发固定为 2，不提供用户级并发配置。
- 仅章节摘要审查试点接入 DAG；旧摘要生成和其他 AI 入口仍保留原链路。
- Worker 只在应用进程存活期间运行，应用关闭后依靠 SQLite 和 lease 恢复。
- 本阶段不实现创作导演、多 Agent、自动 Apply 或 Story State 更新。

## 自动化证据

- Rust 全量：130/130。
- 2C 专项：父子关系、跨项目隔离、循环检测、依赖阻断/释放、有限并行、局部 Attempt 重试、级联取消、Artifact 保留、stale、Apply 门禁、重启恢复、父状态聚合和四步 Mock 工作流全部通过。
- 相关前端回归：20 个文件、98/98；工作流视图专项：5/5；工作区安全：5/5。
- lint：0 error；保留仓库原有 1 个 Hook dependency warning。
- `npm run build`、`cargo check --offline`、`npm run tauri:build` 和 `git diff --check` 通过；MSI/NSIS 均成功生成。

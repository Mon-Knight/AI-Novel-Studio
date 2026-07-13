# 阶段 3 前置待办验收

日期：2026-07-13

## 1. 验收结论

五项阶段 3 前置待办已经形成可执行 V1 契约和安全门禁：创作意图可冻结版本；作者事实、推断偏好和待确认信息严格分级；初始化候选具备证据、冲突解释和逐项确认；世界设定、规则系统、角色可通过现有 ApplyPlan 原子创建；未来导演具备预算、权限与决策审计契约。

本次未进入阶段 3 正式功能，没有实现导演运行时、Story State、多 Agent 或自动 Apply。

## 2. 数据与 migration

- 新增数据库表：无；
- 新增 migration：无；
- 修改历史 migration/checksum：无；
- 任务权威来源：继续为 `ai_tasks`；
- 编排：继续使用现有父子 Task 与 DAG；
- 冻结输入：现有三类 Snapshot；
- 候选和决策审计：现有 ResultArtifact；
- 正式写入：现有 Proposal / ApplyPlan / Operation / Dependency / TargetLink。

## 3. 动态证据

- TypeScript 前置契约专项：4/4 通过；
- Rust 多目标事务专项：4/4 通过；
- 前端 Vitest 全量：34 个文件、140/140 通过（大候选性能用例使用 15 秒预算，实际约 8.1 秒）；
- Rust 全量：143/143 通过；
- Node 正文安全门：5/5 通过；
- migration 专项：前端 2/2、Rust 143/143 通过，018 仍为最新 migration；
- `lint`：0 error，保留 1 条既有 React Hook warning；
- `npm run build`、`cargo check`、`cargo fmt --check`、`npm run tauri build`、`git diff --check`：通过；
- 覆盖：版本/hash、知识分类、推断不可自动确认、证据与冲突确认、预算/权限门禁、多目标依赖、原子提交、失败回滚、幂等重放、未确认拒绝和循环依赖拒绝。

## 4. Canon 与权限边界

- 候选生成或确认本身不写 Canon；
- 只有作者逐项确认后创建的 ApplyPlan 能请求正式写入；
- 首版只允许创建世界设定、规则系统和角色；
- 不支持更新或删除既有 Canon；
- 任一节点失败不保留部分正式结果；
- Provider 参数、应用版本和现有 Worker 状态机未改变。

# v2.1.5 发布说明 - 章节工程任务跨重启恢复闭环

## 版本信息

- 版本号：v2.1.5
- 发布日期：2026-07-21
- 单一目标：让章节工程生成任务在应用重启后得到确定、可审计且幂等的安全结算
- 数据库迁移：无
- 新增第三方依赖：无

## 用户获得的保护

应用重启后，章节工程任务不会再永久显示为运行中。启动流程会检查 `generation_jobs`，把上次退出前仍处于 `pending`、`running` 或 `retrying` 的任务原子结算为 `failed`，并显示恢复对话框。已完成步骤、进度、草稿、质量报告和 patch 结果均保留。

系统不会猜测一个 AI 步骤是否已经产生外部副作用，也不会自动重发请求、续跑步骤、采用草稿或覆盖正文。用户检查保留结果后，可以显式启动一个新任务。

## 恢复契约

- 恢复错误码固定为 `APP_RESTART_INTERRUPTED`，错误文案不包含提示词、密钥或账户信息。
- 一个 SQLite 事务同时完成任务终结和恢复 checkpoint；checkpoint 插入失败时任务更新整体回滚。
- current step、progress、既有 step outputs、草稿和报告不被改写。
- 第二次执行恢复返回 0，不重复修改终态任务，也不追加重复 checkpoint。
- `completed`、`failed`、`cancelled` 都是不可复活终态；进度限制在 `0..100` 且不能倒退。
- step ID 不再使用 `INSERT OR REPLACE` 覆盖旧记录；相同时间戳按 ID 稳定排序。
- step 保存会在同一事务内检查父任务状态；取消会原子写入终态和唯一取消 checkpoint，迟到成功结果无法再写入已取消任务。

## 桌面体验

- `recovery-dialog` 在启动检查发现中断任务时出现，显示结算数量并明确告知没有自动重发 AI 请求。
- 章节工程面板显示稳定恢复提示和 checkpoint 状态。
- 新任务按钮同时检查组件运行状态和 SQLite 中最新任务状态，避免重新打开面板后重复启动。
- runner 在每个异步 action 后及最终完成前复核取消状态；迟到完成回调不能覆盖取消或恢复写入的终态。

## 自动化验证

Rust 测试覆盖：

- `pending` / `running` / `retrying` 一次性恢复，终态任务保持不变。
- 二次恢复返回 0 且不增加 checkpoint。
- checkpoint 插入失败时整个事务回滚。
- 终态复活、非法状态跳转和进度倒退被拒绝。
- 重复 step ID 不可覆盖，等时间戳读取顺序稳定。
- 取消与迟到 step 写入竞争时，取消 checkpoint 只写一次，迟到 `succeeded` step 被拒绝。

真实 Windows Tauri E2E 使用仅限测试构建的 Mock AI pause gate，把任务稳定停在 AI 生成步骤，然后执行真实应用进程重启并复用同一个隔离 SQLite。测试验证恢复对话框、同一任务的错误码与保留进度、唯一恢复 checkpoint、第二次重启幂等、外部网络请求为 0，以及测试后应用与驱动进程无残留。截图只在失败后保存，不参与定位或断言。

## 为什么不自动续跑

当前 schema 没有 execution lease、attempt / operation ID、基础正文 revision / hash 和跨副作用幂等键。崩溃可能发生在 AI、草稿或报告已经提交，但 checkpoint 尚未写入的窗口；自动续跑会带来重复计费、重复草稿或重复报告风险。

因此 v2.1.5 选择“安全终结并保留事实”，不把不确定执行伪装成可恢复执行。真正的自动续跑需要在后续独立版本先补齐上述协议。

## 测试发现并修复的产品缺陷

真实桌面重启用例首次运行时稳定复现：Rust 已保存章节生成上下文快照，但前端归一化器没有读取 serde 返回的 `compiledContextJson` / `sourcesJson`，任务因此在 `compile_context` 24% 被误判为失败。补齐 camelCase DTO 兼容后，同一真实测试才能继续到暂停 AI 和进程重启阶段。

最终差异审查还发现 step DTO 的 `inputSnapshotJson` / `outputJson` 没有在生产服务层反序列化，以及取消后的迟到回调仍可能追加成功 checkpoint。现已补齐 JSON 归一化、父任务终态事务检查和原子取消 checkpoint，并增加动态竞态回归测试。

## 版本边界

本版本只覆盖具有持久化步骤的章节工程 `generation_jobs`。旧 `ai_task_records`、真实 HTTP 取消、质量历史不可变重放、安装程序 UI、原生文件选择器、托盘、通知和 Agent 自主写入均未扩展。

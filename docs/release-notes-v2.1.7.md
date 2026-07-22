# v2.1.7 发布说明 - 章节质量历史不可变快照与原子重放

## 版本信息

- 版本号：v2.1.7
- 发布日期：2026-07-22
- 单一目标：让章节质量检查的每次结果可追溯、不可变、可稳定回放
- 数据库调整：启动时幂等补齐 `quality_check_items.sort_order` 与 `quality_issue_states`
- 完整备份：`schemaVersion: 3`，兼容导入 schema 2
- 新增第三方依赖：无

## 对用户的帮助

过去对同一章节重新质检时，重复出现的问题会被改挂到新报告，旧报告因此丢失当时的问题集合。v2.1.7 后，每次检查都拥有独立报告和独立问题行，不会因后续检查被改写。用户可在右侧质检面板选择历次报告，核对当时的评分、摘要、问题次序和原始证据。

“问题快照”与“当前处理状态”现在分开保存。历史报告始终只读；当前报告仍可标记待处理、已解决或已忽略。稍后才返回的旧请求可以保存自身历史，但不能把较新报告已处理的问题“复活”。

浏览器开发模式的 LocalStorage 回退也采用同一分离契约。状态修改只写独立的 `quality_issue_states` 回退集合，新报告的历史 item 保持生成时快照；升级前已经存在的 item 原样保留并合成当前状态。该集合会随项目补充缓存一起备份和恢复。

## 原子保存与追溯

一次质检的报告结果、所有问题行、当前问题状态和 `completed` 终态在同一 SQLite `IMMEDIATE` 事务中提交。如果第 N 条问题写入失败，报告仍保持 pending，已写入的问题和状态全部回滚，不再出现“报告显示完成，内容只有一部分”。

每份新报告必须绑定真正产生结果的 AI Task。Rust 会校验 Task 存在、作品和章节归属匹配、类型为 `quality_check` 且状态为 `succeeded`。缺少、运行中、错误类型或错误目标的 Task 都会整笔拒绝；幂等重试必须使用原报告已绑定的同一 Task。

已被 completed 质量报告引用的 AI Task 会作为追溯证据保留。单条删除、混合批量删除和清空任务在命中这类记录时都会在任何写入前整体拒绝，不会再把报告的 Task 绑定静默清空。

## 历史读取契约

- `list_quality_check_reports` 只列出 completed 报告，按 `created_at DESC, id DESC` 稳定排序。
- `get_quality_check_report_snapshot` 返回原始不可变问题，按 `sort_order, id` 稳定排序，不覆盖当前工作流状态。
- `get_quality_check_issues` 只选取最新 completed 报告，并把 `quality_issue_states` 覆盖到当前问题上。
- 对历史 item 执行单条或批量状态修改会返回 `quality_issue_history_read_only`。
- pending / failed 报告不遮挡最近完整报告；只有比当前保存目标更新的 completed 报告才能阻止它更新工作流状态。

## 备份兼容

schema 3 完整备份新增 `quality_issue_states`，因此恢复后的 ignored / resolved 状态不依赖再次启动 migration。schema 2 备份仍可导入；恢复事务会按每个 `(chapter_id, issue_key)` 的 item `updated_at DESC, rowid DESC` 合成旧模型最后保存的可变状态，并按报告分别补齐从 0 开始的 `sort_order`，再与其他项目数据一起提交。

## 自动化验证

Rust / SQLite 回归覆盖：

- 两次出现同 issue key 时，两份报告保有不同 item ID，旧快照完全不变。
- 第 N 条 item 和第 N 条状态写入的 trigger 故障都会整体回滚。
- pending / failed 不遮挡 completed，同时间戳仍按 ID 稳定选择。
- 旧报告迟到、新报告已 resolved、以及仅存在更新未完成报告的两种竞态。
- 重复保存幂等、重复 issue key 整笔拒绝、批量状态事务、AI Task 强绑定、migration 幂等和 schema 2 恢复。

前端动态测试使 LocalStorage 回退与桌面契约保持一致。真实 Windows Tauri `quality-history-replay.spec.ts` 通过 DOM 创建作品、卷章和正文，连续执行两次固定 Mock 质检，重启真实应用后分别回放两份报告，校验 report / draft / content hash / AI Task / item ID 与只读状态，并要求外部网络、console error、未处理异常和残留进程全部为 0。

## 测试发现并修复的真实缺陷

原实现分三步写入：先把报告改为 completed，再逐条 upsert 问题，同 issue key 还会把旧 item 的 `report_id` 改为新报告。结果是中途失败可留下部分数据，而成功复检又会让旧报告丢失成员。另外，查询不过滤 completed，新 pending 可遮挡旧完整结果。

发布复审还稳定复现了两个竞态：旧请求迟到会把新报告已 resolved 的同 key 问题重置；反过来，一份更新但始终 pending / failed 的报告又会错误阻止真正最新 completed 报告刷新状态。同时，省略 `aiTaskId` 可绕过追溯校验，删除任务会清空 completed 报告绑定，LocalStorage 状态操作会改写历史 item，完成后的迟到历史列表可在快速切章时串章，schema 2 多报告恢复则会跨报告累计次序。本版本均先补失败动态回归，再修复并通过真实桌面状态修改与重启回放。

## 版本边界

本版本只收敛现有章节质量链路、质量状态与对应备份数据。不自动续跑不确定步骤，不扩展旧 AI 面板和其他工具的通用取消，不新增 Planner、Memory、通用自动放置或 Agent 自主写入。

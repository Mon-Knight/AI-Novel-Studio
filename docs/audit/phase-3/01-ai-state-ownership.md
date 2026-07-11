# 01 — AI 状态所有权审计

## 1. 当前所有权图

| 状态 | 创建位置 | 更新位置 | 消费位置 | 销毁/失效时机 | 迁入统一 Task Store |
|---|---|---|---|---|---|
| loading | 每个 AI 面板/页面 useState；runWithLoading 全局事件 | 各 handler try/finally；全局单例事件 | 按钮、LoadingModal | 面板切换/卸载；全局下一任务可覆盖 | 是，只存 taskId→摘要；UI 可保留派生 loading |
| streaming | 无生产实现 | — | — | — | 否；未来由 Attempt event 单独设计 |
| progress | ChapterEngineeringPanel local；generation_jobs.progress_percent；CheckPanel fixProgress；全局 modal | generationJobService/各 handler | 工程面板、modal | local 卸载；job 行持久 | 是，权威来自 Task/Attempt event |
| result | 各面板 useState；少数 domain 候选/草稿 | Provider 回调与解析器 | 当前面板/编辑器 | 切换不同面板或页面卸载；部分刷新丢失 | Store 只存 artifactId/摘要，完整内容不进 Store |
| error | 各面板 string；ai_task_records.error_message；generation_jobs.error_* | 各 catch，格式不统一 | 面板、modal、任务页 | local 卸载；历史摘要保留 | 是，统一 AppError 摘要与 Attempt 历史 |
| abort controller | RealAiClient browser fetch 内部超时；useLoadingTask 自有 controller | timeout/useLoadingTask.cancel | 仅内部 | 请求结束/Hook 卸载 | 否；取消句柄由 Provider Adapter/worker 管理 |
| retry state | generation_jobs.retry_count；大部分入口无正式 retry | job patch 或用户重新点击 | 工程面板/任务列表 | 记录持久但无 Attempt 语义 | 是，retry 创建 Attempt，不在组件计数 |
| selected model | aiSettingsService localStorage key ai_novel_studio_ai_settings | SettingsPage | 所有 Service 请求时读取 | localStorage 清除/设置变更 | 否；Task Snapshot 复制实际 provider options（无密钥） |
| task input | 表单与 panel props；generation snapshot 部分保存 | 用户编辑/章节 prop 变化 | handler/Prompt builder | 组件卸载或输入覆盖 | 只存 snapshotId；完整输入进入 immutable snapshot |
| current target | panel props chapter/novel；部分 handler 捕获 request IDs | 工作台章节切换/路由 | handler 与保存回调 | 切章即变化 | 是，Task scope 与 source snapshot 固定创建时目标 |
| generated content | panel local；chapter_drafts；generation_step_results.output_text；setting suggestions localStorage | Provider/Parser/保存 Service | 预览、编辑器、确认按钮 | local 结果易丢；持久候选保留 | Store 仅 artifactId；正文走 Artifact/large-text |
| apply state | handler boolean/message；DocumentApplyIdempotencyGuard（内存）；fixRun.status | UI handler、EditorArea、服务 | 按钮和提示 | 页面刷新丢会话 guard；fixRun 持久 | 是，权威 ApplyPlan/operation/target link；UI 只订阅 |
| quality report state | WritingWorkspace props + CheckPanel local + SQLite/localStorage | qualityCheckService/CheckPanel | CheckPanel/历史 | 章节切换会重载 | 保留在领域 Service；Task Store 只关联 artifactId |
| engineering job state | generation_jobs/steps + panel local | generationJobService 与 Rust commands | ChapterEngineeringPanel | DB 持久；local 视图卸载 | 迁入统一 Task/Attempt 后 legacy 只读 |

## 2. 右侧栏生命周期事实

- 关闭当前面板时 RightPanel 记住 lastPanelType，并用 display:none 保留该面板实例和 local state。
- 从一种面板切到另一种面板时 React 渲染不同 component type，旧面板实例卸载；其未持久 result/error/input 消失。
- 切换章节并不会卸载当前面板；没有显式 reset/bind 的候选仍留在内存。OutlinePanel、EventsPanel、ChapterSummaryPanel 因此存在把旧结果应用到新 chapter prop 的风险。
- 页面离开或应用重启会清空全部面板状态；只有草稿、任务摘要、质量数据、工程 job、设定库候选等持久数据仍在。

## 3. rightSidebarStore 审计

src/store/rightSidebarStore.ts 定义 toolStates、output/error/loading 和 relatedContentHash，RightPanel 也计算 stale warning；但生产面板没有调用 onUpdateToolState。当前 toolStates 实际保持空，正文变化后的 stale warning 基本不会被激活。

结论：它是未接通的 UI 状态草案，不能直接升级为生产 Task Store，也不能让它保存完整正文。后续保留侧栏偏好，另建 aiTaskStore 并只存任务/Artifact 摘要。

## 4. 并发与迟到响应

| 场景 | 当前行为 | 风险 |
|---|---|---|
| 快速双击 | 多数按钮用 local loading 阻止；StrictMode effect 未主动发 AI | 同一事件跨组件/刷新仍无 operationId |
| 切换章节 | AiGenerate/Polish/Check 部分捕获 request IDs 并检查 live ref | 其他面板直接用最新 prop，旧候选可串章 |
| 组件卸载 | HTTP/Tauri 请求继续 | 任务仍执行，local result 丢失；部分 DB 仍写入 |
| 用户取消工程 job | DB 立即 status=cancelled；Provider 不 abort | 迟到 response 仍可进入 step；下一 step 才可能看到取消 |
| 全局 LoadingModal 并发 | 单一 window event state | 后启动任务可覆盖前一任务标题/进度/关闭事件 |
| DB 完成前 UI success | 部分流程等 await；部分 localStorage lsSet 吞异常；多步总结/修稿逐项 catch | 可能显示成功但来源/副作用未完整提交 |

## 5. 错误格式

- Provider 抛普通 Error 文案；Rust ai command 返回 String；workspace 原子保存使用结构化 AppError；多数 AI 服务把错误再转为 string。
- ai_task_records 只存 error_message，无法区分 retryable、traceId、operationId、Provider 失败与校验失败。
- generation_jobs 有 error_code/error_message，但 command 不权威验证状态。

冻结方案要求所有 Task/Attempt/Apply 错误使用 AppError；UI 可渲染 message，但重试与状态机必须读 code/retryable，而不是解析中文文案。

## 6. 目标所有权

创建 Task 时的 novelId/chapterId/draftId/scope 与三类 Snapshot 是唯一权威目标来源。组件当前 props、Provider 返回 targetId、列表 latest 行和剪贴板内容都不是权威。

PlacementProposal 可以在项目现状上重新解析目标；ApplyPlan 固定最终目标、expectedVersion/hash 和 range lock。切换章节只影响 UI 当前视图，不改变已创建 Task/Artifact；旧 Artifact 被标 stale 或仍可在任务中心查看，但不能自动应用到新章节。

## 7. 迁移优先级

1. P0：先统一 Task/Attempt 权威状态与目标捕获，修复 old-result→new-chapter 和 latest-draft 采用。
2. P0：把质量修复的 resolved/expired/“adopted”副作用移到 Apply transaction。
3. P1：修复 aiTaskId/note 在桌面原子草稿保存中的丢失，建立 ArtifactTargetLink。
4. P1：迁移 generation_jobs 为 legacy 投影；正式取消走 Provider Adapter。
5. P2：接通右栏任务摘要订阅、统一 Loading/Error；清理只在所有旧面板迁移后进行。

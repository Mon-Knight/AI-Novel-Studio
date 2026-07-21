# v2.1.6 发布说明 - 章节工程真实 AI 请求取消闭环

## 版本信息

- 版本号：v2.1.6
- 发布日期：2026-07-21
- 单一目标：让章节工程任务的在途正文生成与质量检查请求可以真正停止
- 数据库迁移：无
- 新增第三方依赖：无

## 对用户的帮助

点击章节工程的“取消任务”后，应用不再只是把数据库状态改成 `cancelled`。仍在等待的真实 AI HTTP 请求、浏览器 fetch 或 Mock 请求会同步中止，连接和等待资源及时释放，也避免一个已经取消的请求继续产生费用或迟到结果。

取消终态仍由 SQLite 事务保护：任务状态与唯一取消 checkpoint 一起提交，迟到回调不能写入成功 step、生成草稿或把任务改回完成。已经成功提交的草稿或质量报告属于既成事实，不会因为稍后的取消而被删除。

## 请求取消契约

- `AiClient.generate` 接受可选 `AbortSignal` 与无业务内容的 request ID。
- 章节正文生成和质量检查共享 job controller，但各自使用独立 request ID。
- 桌面 API 模式使用异步 `reqwest`，Rust `cancel_ai_request` 通过 abort handle 丢弃整个发送与响应读取 future。
- 任务终态等待取消 IPC 确认；若 IPC 控制调用失败，前端只记录固定脱敏诊断并等待原请求结算。若取消 IPC 卡住但原命令已经安全结算，则调用方可以结束，不会被控制 Promise 永久阻塞。
- 用户取消固定为 `AI_REQUEST_CANCELLED`；网络超时保留原超时语义。
- 浏览器开发模式取消内部 fetch；Mock pause gate 和延迟会清除 timer、listener 与 waiter。
- 质量检查对应的旧 `ai_task_record` 结算为 `cancelled`，终态不会被迟到 success / failure 覆盖。
- 质量报告在 AI 成功返回后才创建，取消在途请求不会留下永久 `pending` 报告。

## 并发与资源保护

Rust 侧活动注册表最多保存 64 个请求；提前取消和近期完成 ID 各最多 128 个，并在 30 秒后清理。注册 token 防止旧请求误删复用 ID，两阶段 reserve / attach 处理取消先于 abort handle 建立的窗口，RAII guard 则在 command future 被丢弃时主动中止网络并移除注册。

请求 ID 只允许最长 128 字节的 ASCII 字母、数字、`-`、`_`、`.` 和 `:`。Rust 与浏览器错误路径都不记录 API URL、密钥、Authorization、provider body、完整 prompt、原始响应正文或底层 reqwest 错误；`2xx` 非法 JSON 也只返回固定解析错误。

## 自动化验证

Rust loopback 测试证明：

- 慢请求取消后快速返回稳定错误码，服务端观察到连接 EOF / reset。
- 提前取消不产生网络连接，重复活动 ID 不会发出第二个请求。
- 正常 JSON / usage 与超时语义保持，取消和超时不混淆。
- command future 被丢弃时仍会 abort，并清理活动注册。
- E2E 网络阻断先于 client 创建与 dispatch；tombstone 与 recently-settled 容量都有硬上限。
- 非法成功响应只返回固定错误，不泄露 provider body。

前端动态测试覆盖 Tauri 取消 IPC 的延迟确认、失败降级与永不 settle 边界，浏览器 caller abort / timeout 分类、错误和非法成功响应正文脱敏、Mock gate 与 delay 清理，以及质量旧任务的 `cancelled` 终态。

真实 Windows Tauri `generation-job-cancel.spec.ts` 从 UI 创建作品、卷、章，分别暂停正文生成和质量检查后点击取消。正文场景验证不新增草稿；质量场景验证已提交草稿保留、旧 AI task 为 `cancelled` 且不创建 pending 报告。两者都要求 5 秒内 waiter 归零、SQLite 只有一个取消 checkpoint、release gate 后没有迟到 step 或 completed 状态，且外部网络请求、console error、未处理异常和归属进程残留全部为 0。

## 测试发现并修复的真实缺陷

原实现使用同步 `reqwest::blocking::Client`。`generationJobService.cancel` 只写入持久化状态，无法触达正在执行的 HTTP 请求；请求可继续等待到配置上限 1800 秒。Mock pause gate 同样没有 abort listener，取消后 waiter 会一直保留到显式 release 或进程退出；浏览器端还会把所有 `AbortError` 误报为超时。发布审阅进一步发现，取消 IPC 曾被 fire-and-forget 且失败被吞掉，`2xx` 非法 JSON 的浏览器解析异常也可能夹带敏感正文片段；两条回归均已补齐并修复。

本版本把 transport、任务状态机和旧质量任务记录连接成同一个取消闭环，并用真实 socket、前端信号与桌面 SQLite 三层动态测试分别证明。

## 版本边界

本版本只覆盖章节工程 `generation_jobs` 中的正文生成和质量检查。旧 `AiGeneratePanel` 及其他独立 AI 工具仍按各自原有流程运行；本版本不宣称全产品 AI 均可取消，也不增加流式输出、自动续跑、质量历史重放、新 migration 或 Agent 自主写入。

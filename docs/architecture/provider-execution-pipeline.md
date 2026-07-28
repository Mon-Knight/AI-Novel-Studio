# v2.3.1 Provider Adapter 与统一执行管线

> 状态：首批入口已实现
> 适用版本：v2.3.1
> 边界：连接测试与只读设定候选，不包含 Apply、Planner、Memory 或 Multi-Agent

## 1. 目标

v2.3.0 已经能保存可信 Task、Attempt、Snapshot 和 Artifact，但生产 AI 入口仍直接调用旧 Client 并写 Legacy 记录。v2.3.1 的目标是让第一批真实调用经过同一事实管线，同时保持现有 Provider、取消和桌面网络实现稳定。

## 2. 执行顺序

桌面端固定顺序：

```text
build request
→ create Task + Input/Context/Constraint Snapshot
→ queue Attempt
→ claim Attempt(provider/model/local dispatch id)
→ ProviderAdapter.execute（只派发一次）
→ SHA-256 + Unicode response length
→ mark Provider succeeded
→ create ResultArtifact
→ return candidate/result to caller
```

网络调用不在 SQLite 事务内。Provider 返回后，response identity 与 Artifact 使用现有幂等服务写入；提交结果未知时相同参数只重放 IPC，不再次派发 Provider。

## 3. Provider Adapter

`ProviderAdapter` 只暴露：

```text
providerId
modelId
execute(request, AbortSignal, requestId)
```

当前实现复用：

- `MockAiClient`：本地确定性测试和开发模式；
- `RealAiClient`：OpenAI-compatible 请求；Tauri 中继续由 Rust `ai_chat_completion` 执行 HTTP；
- 既有 `cancel_ai_request` 注册表：AbortSignal 触发时关闭在途 Rust HTTP 请求并隔离迟到响应。

Adapter 返回正文、token、finishReason 和 duration；不会把 API Key、Base URL、headers 或完整 HTTP raw JSON复制到普通 metadata。

## 4. Snapshot 过渡契约

在 v2.4 Context / Constraint Compiler 之前，v2.3.1 使用明确的过渡契约：

- Input body：实际发送给 Provider 的 messages JSON；
- Input payload：消息数量与入口安全元数据；
- Context compiled text：当前 system/context 编译文本；
- Context manifest：Novel、Chapter、WorldSetting、RuleSystem 等来源 ID；
- Constraint template：当前 system prompt 文本、模板 ID/version/hash；
- Provider options：仅 providerId、model、temperature、maxTokens。

Input、Context 与 Constraint 可能保存部分重复文本，以换取当前阶段对实际 Provider 请求的完整证明。v2.4 将由正式 Compiler 分离模板、来源与编译结果，不在 v2.3.1 提前伪造未来模型。

## 5. 幂等与失败

- 相同 operationId 已完成且存在 Artifact：直接读取首次结果，Provider 调用次数为 0。
- `DATABASE_COMMIT_UNKNOWN`：最多重放一次相同持久化操作，不重放网络请求。
- Provider 失败：映射为稳定 timeout / cancelled / authentication / request-rejected / rate-limited / server / network / malformed AppError，再安全终结 Attempt；Tauri 1.x 的纯字符串拒绝会保留已脱敏的后端消息，输出 Token 截断归为可重试 malformed response 而不是网络错误。
- 取消：同时触发现有 HTTP Abort 和持久 Task cancel；取消后到达的响应不能创建 Artifact。
- Artifact 校验失败：完整模型正文仍保存在 invalid Artifact，入口可以展示原始候选，但不会把它当作正式业务数据。

如果进程恰好在 Provider 返回后、事实写入前崩溃，当前 Attempt 可能保持 running；跨重启 lease/checkpoint 与自动恢复属于 v2.5，v2.3.1 不把该能力描述为已经完成。

## 6. 凭据边界

```text
AI settings.apiKey / baseUrl
→ 瞬时 ProviderAdapter config
→ 受控 Tauri ai_chat_completion request
→ 不进入 Task/Snapshot/Artifact/Issue/log
```

单元测试直接扫描 Task 创建参数，证明 API Key 与 Base URL 不存在。E2E 仍强制 Mock、阻断 WebView 与 Rust 外网；真实 API 只在人工验收中调用一次，输出预算 128 tokens，不打印或导出凭据。

## 7. 首批入口

### 连接测试

- system scope；
- expected Artifact：`generic_text@1`；
- 模型必须只返回 `OK`；
- `temperature = 0`，不继承正文创作的随机性设置；
- `maxTokens = 128`，避免推理型兼容模型在形成最终 `OK` 前耗尽预算；
- valid Artifact 才报告连接成功。

### 设定补充

- Novel 或 Chapter scope；
- expected Artifact：`setting_candidates@1`；
- Provider JSON 作为候选 Artifact；
- UI 展示候选不会写正式设定；
- 用户点击“确认加入设定库”后才执行既有业务写入。

质量检查没有在本版本迁移，因为现有 `quality_check_reports.ai_task_id` 仍权威绑定 Legacy Task。修改该外键或双写会扩展版本边界，留待 ArtifactTargetLink / Apply 版本统一处理。

## 8. 浏览器开发模式

浏览器模式仍可运行 Mock 或显式配置的 API Client，返回 `ephemeral_browser`：

- 不调用 Task/Artifact IPC；
- 不在 LocalStorage 伪造执行事实；
- 仅接受字符串 final content；content-parts 等未支持结构失败关闭且不回显 Provider 正文；
- 不作为桌面发布证据；
- 真实持久行为由 Rust/SQLite 与 Windows Tauri E2E 证明。

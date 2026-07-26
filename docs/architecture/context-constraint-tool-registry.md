# v2.4.0 Context / Constraint Compiler 与 Tool Registry

> 适用版本：v2.4.0
> 协议：`compiled_ai_execution_v1`、`context_compiler_v1`、`constraint_compiler_v1`、`tool_registry_v1`

## 1. 目标与边界

v2.4.0 把“调用方拼接 Prompt 后直接调用 Provider”改为“来源事实经过版本化编译，再由同一契约驱动 Provider 与持久 Snapshot”。目标是让一次 AI 请求可解释、可重放核对、可失败关闭，并为后续 Planner/Tool Calling 提供稳定边界。

本版只迁移连接测试与设定补充，不实现 Planner、lease、checkpoint、自动恢复、Memory、Multi-Agent 或模型自主工具调用。没有数据库 migration，复用 v2.3.0 三类 Snapshot 的 `schemaVersion` 字段和不可变大文本存储。

## 2. 权威数据流

```text
生产入口
→ 读取 SQLite / request 来源
→ compileProductionAiExecution(taskType, scope, sources, settings, Provider identity)
   ├─ Context Compiler
   ├─ Constraint Compiler
   └─ Tool Registry manifest
→ compiled_ai_execution_v1
   ├─ 实际 Provider request
   ├─ schema v2 Input Snapshot
   ├─ schema v2 Context Snapshot
   └─ schema v2 Constraint Snapshot
→ Rust validate_formal_compilation
→ Task + 三 Snapshot 单事务创建
→ queue / claim / 单次 Provider 派发 / Artifact
```

浏览器开发回退使用同一编译器和 Provider request，但仍明确返回 ephemeral 结果，不伪造 SQLite Task、Snapshot 或 Artifact。

## 3. Context Compiler

### 3.1 来源输入

每个来源声明：

- `sourceType`、`sourceId`、`sourceVersion`；
- `origin = sqlite | request | system`；
- 显示 label、稳定 order、priority、required；
- 原始 content 与可选单来源 `maxTokens`。

来源身份 `(sourceType, sourceId)` 在一次编译中必须唯一。当前设定补充只允许 Novel、Chapter、WorldSetting、RuleSystem 与 RequestContext；Novel 必需，chapter scope 还必须包含同一 Chapter。

### 3.2 规范化与排序

换行统一为 LF，首尾空白移除。来源依次按 `order`、required、priority、sourceType、sourceId 排序；文本比较使用固定代码点次序，不依赖 Windows 区域设置。设定入口在进入编译器前还会按 `createdAt + id` 稳定排序规则来源。

### 3.3 预算与截断

估算器固定为：

```text
utf8_bytes_div3_v1 = ceil(UTF-8 byte length / 3)
```

预算关系：

```text
availableContextTokens
= modelContextTokens - reservedOutputTokens - fixedMessageTokens
```

固定消息预算包括模板、用户消息、JSON envelope 与安全余量。来源按稳定顺序进入 Context；完整来源超出剩余预算时进行 Unicode 字符边界二分截断并追加固定截断标记。必需来源连最小有效片段都无法容纳时失败关闭。

### 3.4 `context_manifest_v1`

manifest 保存完整 compiledContextHash、缺失来源类型，以及每个来源的原文 hash/字符/字节/token、includedHash、最终长度与状态：

```text
included | truncated | omitted_empty | omitted_budget
```

`context_budget_v1` 保存模型、输出、固定消息、可用 Context、最终 Context 与 included/truncated/omitted 计数。完整 Context 单独进入不可变大文本，模板不得混入该字段。

## 4. Constraint Compiler

`constraint_compiler_v1` 冻结：

- taskType 与预期 Artifact type/schema；
- response schema；
- 业务 constraints 与 canonical SHA-256；
- Prompt template id/version/hash 与完整模板正文；
- Provider id/model/temperature/maxTokens；
- `tool_registry_v1` hash 与 allowedTools。

连接测试固定输出 `OK`、最大 8 tokens；设定补充固定输出 `setting_candidates@1`，只生成候选且不得直接写业务数据。Prompt 模板位于 `prompts/`，模板、Context 和用户消息彼此分离。

## 5. 执行契约与 hash

`compiled_ai_request_v1` 的 Input Snapshot 大文本就是实际派发的 `{ messages }`，payload 保存 requestBodyHash、messageCount、taskInput 与 compilationHash。

compilationHash canonical 覆盖：

```text
contractVersion + taskType + scope
+ expected Artifact contract
+ requestBodyHash + taskInput
+ Context manifest + budget
+ Constraint payload + Prompt hash + Provider options
```

API Key、Base URL、Authorization header 和 Provider raw response 不进入任何编译结构。

## 6. Rust 失败关闭验证

Rust 在打开 Task 创建事务前验证：

1. 生产 taskType 必须使用 schema v2 编译协议，不能通过改写 Artifact type 跳过。
2. Context manifest/hash/budget/count 与完整 Context 相同，来源类型和 scope 合法。
3. Constraint 的 Artifact、response schema、constraints hash、Provider options 与任务策略相同。
4. Prompt template id/version/hash 必须等于仓库冻结模板。
5. 实际两条 Provider messages 必须等于模板 + Context + 固定用户消息。
6. requestBodyHash 与 compilationHash 必须复算一致。
7. Registry version/hash 必须等于 v2.4.0 生产 Registry，当前 allowedTools 必须为空。

任一失败不创建 Task、Snapshot 或大文本引用。现有 v2.3.0 requestHash 继续覆盖三类 Snapshot hash，提供第二层 operationId 重放保护。

## 7. Tool Registry

### 7.1 当前生产工具

| identity | scope | 权限 | 副作用 |
|----------|-------|------|--------|
| `novel.read_context@1` | novel | novel.read | none |
| `novel.read_settings@1` | novel | novel.read | none |
| `chapter.read_outline@1` | chapter | novel.read, chapter.read | none |
| `chapter.read_context@1` | chapter | novel.read, chapter.read | none |
| `style.read_profile@1` | novel | novel.read, style.read | none |
| `style.read_output_control@1` | novel | novel.read, style.read | none |
| `verification.check_outline@1` | chapter | novel.read, chapter.read, verification.execute | none |
| `verification.check_style@1` | novel | novel.read, style.read, verification.execute | none |

生产 Registry hash：

```text
c03ae58009cfb47b84f85dbb907b427cd1d659149af0a6133ec6898e8de4a0a5
```

### 7.2 调用门禁

调用前依次验证精确 name/version、allowedTools、全部权限、input schema、权威 scope 与调用参数中的 novel/chapter/draft 一致性。handler 带超时执行；返回结果必须能安全 JSON 序列化并满足 output schema。Registry manifest 按 identity 稳定排序且每次返回隔离副本，外部修改不影响缓存权威值。

### 7.3 副作用确认

任何 `create/update/delete/external` 工具必须声明 `user_confirmation`，并提供 `verifyConfirmation`。调用上下文至少包含：

```text
confirmedBy=user
userConfirmedAt
planId
operationId
planHash
```

字段形状只表示“存在证据”，不能授权执行；定义方必须从权威持久事实复验 Plan、operation 和 hash。当前生产 Registry 没有副作用工具，Safe Apply 仍通过既有受控服务执行。

## 8. 后续演进

v2.5.x 才允许 Planner 生成版本化 Plan，并在 execution lease/checkpoint/重启恢复边界下选择 Registry 工具。开放任何工具前必须把 Registry manifest/调用事实和 Plan step 形成可持久审计关系；v2.4.0 的 `allowedTools=[]` 不能被解释为 Tool Calling 已开放。

# Phase 5.1 Dual Model Creative Runtime

> 基线：v3.5.0
> 协议：`model_route_decision_v1`（TS 类型为 `RouteDecision`）、`local_model_lifecycle_v1`
> 边界：不新增 SQLite migration、不新增 Tauri IPC、不修改 DSH 载体、不允许模型直接采用正文

## 1. 职责分层

`CreativeRole` 与 Provider 厂商解耦：

```text
全局云端 endpoint
  director.world / character / plot / scene_plan / repair
  critic.quality / review
  writer.chapter_fallback
  writer.beat_prose（未启用专用本地作家时为主路由；本地不可用时为 Fallback）

可选本地 endpoint
  writer.scene_prose / writer.beat_prose
```

本地 Qwen、Llama 或其他微调模型统一注册为 `local_openai_compatible`，必须使用回环地址。Router 不允许本地 endpoint 获得导演能力。

## 2. 路由与审计

每个 Beat 在发送前形成不可变 `RouteDecision`：

1. Director / Critic 固定走全局云端 Provider。
2. 未启用或未配置专用本地作家时，`writer.beat_prose` 直接以全局云端 Provider 为主路由（`cloud_writer_primary`），不把它伪装成本地故障降级。
3. 只有本地 sidecar 明确授权 `AVAILABLE`、Benchmark 通过、健康未失败且 Context 可容纳时，`writer.beat_prose` 才走本地。
4. 本地处于 `TRAINING / TESTING / FAILED / DISABLED`、健康失败或 Context 超限时，按设置使用云端代写同一 `chapter_scene_generate` 契约。
5. Fallback 不允许切换成整章 `chapter_generate`，也不修改 Scene、Beat、风格或 Context；没有已确认 Scene 计划时则继续使用原有云端整章候选流程。
6. 路由结果进入 `taskInput.routeDecision` 和 compilation hash；Adapter 必须复验所选 endpoint 与当前设置身份一致，实际 Provider / Model 继续进入 Attempt 与 Constraint Snapshot。

## 3. 生命周期 sidecar

桌面端在每个 Beat 路由前读取：

```text
%USERPROFILE%\.ai-novel-studio-local-model-lifecycle.json
```

浏览器开发回退使用 `ai_novel_studio_local_model_lifecycle_v1` LocalStorage 项，不冒充桌面文件。

sidecar 只允许：endpoint/model/provider 身份、生命周期、更新时间、Benchmark 摘要和稳定失败码。未知字段整体拒绝，因此 API Key、Base URL 和模型输出不能进入该文件。

`AVAILABLE` 必须同时携带：

- `benchmark.status = passed`；
- 案例通过率不低于 threshold；
- 完成时间；
- 64 位 SHA-256 report hash。

缺少任一证据时，应用将其按 `TESTING` 处理。sidecar 文件不存在也按 `TESTING` 处理，不再以旧版乐观默认值向未训练模型发送生产流量。坏 JSON 或非法字段按 `FAILED` 处理。sidecar 身份与当前设置 endpoint 不一致时不会污染当前模型。

## 4. 训练与上线命令

训练开始前标记 `TRAINING`：

```powershell
npm run model:lifecycle:local -- --model qwen35-9b-novel-v4 --lifecycle TRAINING
```

生命周期工具不接受 `AVAILABLE`；只有 Benchmark 可以授权上线。

训练完成后运行本机 Scene-to-Prose 基准：

```powershell
$env:LOCAL_MODEL_API_KEY = "local-no-key-required"
npm run model:benchmark:local -- --base-url http://127.0.0.1:8080/v1 --model qwen35-9b-novel-v4 --cases 10 --threshold 0.9
```

生产验收建议使用 `--cases 100`。CLI 先写 `TESTING`，逐案串行调用本地 OpenAI-compatible API，通过后写 `AVAILABLE`；失败或中断时不会使新模型获得流量。

固定基准检查：

- Scene / Beat 必需事实词覆盖；
- 正文长度边界；
- `finish_reason=length` 拒绝；
- thinking、JSON、Markdown 围栏泄漏拒绝；
- 重复长段拒绝。

API Key 只存在于进程环境或命令参数，不写入 sidecar 和报告摘要。

## 5. 云端与远程 Writer 部署

### 5.1 全局 Cloud Provider（默认与兜底）
模型尚未训练完成时，用户只需配置设置中心的 **全局 Cloud Provider**（DeepSeek 或 OpenAI-Compatible API），并保持专用本地/远程模型关闭：

```text
Director / Critic ─┐
                   ├─ 全局 Cloud Provider
Scene/Beat Writer ─┘
```

如果已有确认的 Scene/Beat 计划，云端模型继续按同一 `scene-beat-prose-v1` 单 Beat 契约生成；没有 Scene 计划时使用原有整章候选流程。两条路径都只产生 Artifact / 草稿候选，继续经过 Quality Gate、人工审核和 Safe Apply。

### 5.2 专用远程作家（Remote Writer）
支持将微调模型部署在独立云 GPU 服务器、自建私有云或 VPC 网络：

- **网络策略**：
  - **公网访问**：强制使用 `https://` 协议，拒绝明文 HTTP。
  - **内网 / VPC 访问**：允许 `http://` 或 `https://`（覆盖 10.x / 172.16-31.x / 192.168.x / 100.64-127.x 等 RFC 1918 / CGNAT / Link-Local / 回环地址）。
- **鉴权要求**：
  - 不论公网或内网，**强制要求配置 API Key / Token**，不允许匿名 Writer 调用。
  - API Key 遵循会话凭据治理，不持久化到明文 LocalStorage。
- **路由与降级策略**：
  - `local (AVAILABLE)` 优先；
  - 本地处于 `TRAINING / TESTING / FAILED / DISABLED / UNHEALTHY / CONTEXT_TOO_LARGE` 且允许 Fallback 时，优先转交已启用的 `remote` Writer，未启用时再转交 `cloud` Provider；
  - 未配置本地 Writer 时，若启用了 `remote` Writer，则以 `remote_writer_primary` 为主路由。

### 5.3 端点边界对比
- `local`：强制回环地址（127.0.0.1 / localhost），受本机 sidecar 与基准测试约束；
- `remote`：支持公网 HTTPS 与 VPC 内网，独立会话凭据，支持自定义上下文和输出 Token 预算；
- `cloud`：全局导演/评论与全流程兜底。
- 三者共享 Context Compiler、RouteDecision、ResultArtifact 和人工采用边界。

## 6. 恢复语义

```text
TRAINING  -> Router 使用 Remote Writer 或 Cloud Writer Fallback
TESTING   -> 新权重不接用户流量
FAILED    -> Router 使用 Remote Writer 或 Cloud Writer Fallback
AVAILABLE -> 下一个 Beat 自动切回本地
DISABLED  -> Router 使用 Remote/Cloud 或按用户策略失败关闭
```

应用不在一个已发出的 Attempt 中间换模型。sidecar 变化只影响下一个 Beat，因此 Provider identity、编译契约和成本事实保持一致。重复读取同一份 `AVAILABLE` 证据不会覆盖之后观测到的实时故障；下一次章节 preflight 会执行无生成健康检查，服务恢复后再重新进入本地路由。

## 7. 验证

```powershell
node --test scripts/models/local-model-benchmark.test.mjs scripts/models/local-model-benchmark.integration.test.mjs
npx tsx --test --test-concurrency=1 src/services/ai/runtime/modelLifecycleSidecar.test.ts src/services/ai/runtime/routeDecision.test.ts src/services/ai/compilation/executionContractCompiler.test.ts src/services/ai/aiExecutionPipeline.test.ts
```

集成测试使用回环 HTTP 模型夹具，证明通过模型写入 `AVAILABLE`、失败模型保持 `FAILED`、生命周期 CLI 不能自行授权 `AVAILABLE`，并验证凭据不进入 sidecar。

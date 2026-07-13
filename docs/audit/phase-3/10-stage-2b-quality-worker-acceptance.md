# 阶段 2B — 章节质量检查 Rust Worker 验收报告

## 结论

阶段 2B 已完成试点。仅手动章节质量检查迁移到应用进程内 Rust Worker；自动修复及其他 AI 入口未迁移。

## 新调用链

```text
React 编译质量检查请求
→ 创建 AiTask 与三类冻结 Snapshot
→ queued
→ Rust Worker BEGIN IMMEDIATE 认领并创建 Attempt
→ 异步 Provider / Mock Provider
→ ResultArtifact
→ 任务中心等待审查
```

React 不等待 Provider Promise，不自动保存正式质量报告或修改正文。

## Worker 机制

- 12 秒 lease，2 秒 heartbeat；owner + 条件 UPDATE + Immediate transaction 防止重复认领。
- queued 启动扫描；running/validating lease 过期时记录 interrupted，并按 `max_attempts` 决定重新 queued 或 failed。
- 临时网络、超时、限流错误在同一 Task 下创建新 Attempt；非重试错误终止。
- 取消先写 `cancel_requested`，CancellationToken 中断异步 reqwest，最终 Attempt/Task 进入 cancelled。
- 当前进度持久化在 ai_tasks，同时发送 `ai-task-progress` Tauri Event。
- Artifact 写入前查询既有结果；重放不会生成第二个 Artifact。

## Migration

新增 `017_ai_task_worker_runtime`，固定 definition checksum。只增加 Worker 必要列和索引；没有改写 001～015，也没有占用预留的 016。

## 自动化证据

- Worker Rust 动态用例：8/8。
- Worker 前端契约：1/1。
- Rust 当前全套：115/115。
- 相关前端回归：20 个文件、97/97；工作区安全：5/5；质量工作台静态检查通过。
- `npm run build`、`cargo check --offline`、lint（0 error）和完整 `npm run tauri:build` 通过；MSI 与 NSIS 均成功生成。
- 覆盖重复认领、持久进度、lease 恢复、真实取消令牌、临时错误重试、单 Artifact、失败状态和不写 Canon。

## 已知限制

- Worker 仅在应用进程运行，不是 Windows Service。
- AppShell 启动时会把本地 Provider 配置重新注册到 Worker 内存；凭据不会持久化到 Task，配置不可用时 queued 任务保持等待。
- 浏览器开发模式没有 Rust Worker，继续使用明确的 WebView 回退。
- 自动质量修复与修复后的复检仍由现有 WebView 链路驱动。
- 本轮真实 Provider 桌面冒烟因 Windows 处于锁屏、无法安全核验现有 Provider 是否可用而跳过；未修改 Provider 参数，未发送真实请求。

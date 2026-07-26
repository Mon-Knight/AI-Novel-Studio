# AI Novel Studio v2.4.0 发布说明

发布日期：2026-07-26
主题：Context / Constraint Compiler 与 Tool Registry

## 核心变化

v2.4.0 将首批生产 AI 请求升级为正式编译协议。连接测试和“设定补充”从 SQLite/request 来源、独立 Prompt 模板、固定预算、Provider identity 与工具策略生成同一份 `compiled_ai_execution_v1`；实际 Provider messages 与三类 Snapshot 不再由调用方分别拼接。

Context Snapshot 现在记录稳定来源 manifest、缺失来源、原文与包含片段 hash、确定性截断状态和完整预算。Constraint Snapshot 记录 Artifact/response schema、业务约束、Prompt identity、Provider options 和 Tool Registry identity。Rust 在 Task 创建前复算这些关系，任何篡改都失败关闭。

## Tool Registry

本版注册八个真实工具：作品上下文/设定、章节大纲/上下文、风格/输出控制读取，以及大纲/风格本地验证。所有生产工具都是只读或本地验证，具备冻结 schema、权限、scope、超时与 side-effect 声明。

当前连接测试和设定补充的 `allowedTools=[]`，模型不能调用工具。未来副作用工具即使携带调用方确认字段，也必须由定义方复验持久 ApplyPlan；本版没有新增业务写入工具。

## 安全与兼容性

- API Key 与 Base URL 仍只存在于瞬时 Provider Adapter 配置，不进入 Snapshot、Artifact 或普通日志。
- Rust 按生产 taskType 强制正式编译，不能通过改写预期 Artifact 绕过。
- Prompt 模板 hash 与 Registry hash 在 TypeScript/Rust 两侧冻结。
- 跨电脑排序不依赖区域设置；规则来源用 `createdAt + id` 稳定排序。
- 没有数据库 migration；既有 schema v1 Snapshot 仍可读，新入口创建 schema v2 Snapshot。
- v2.3.2 Safe Apply 的显式用户确认、事务副作用和重放边界保持不变。

## 验证摘要

- Compiler / Provider / Registry 专项：18/18。
- `npm test`：Node 16/16，tsx 64/64。
- Rust / SQLite：139/139，另 1 项真实隔离数据库迁移测试按设计 ignored。
- ESLint：0 error，保留 1 条既有 React Hooks warning。
- TypeScript + Vite production build：通过，231 modules。
- Windows Tauri 完整 E2E：12/12 独立桌面场景通过。
- 单次 8-token 真实 API 连接测试：Provider 返回空内容，形成一个不可重试 failed Attempt 和零 Artifact；没有重试，也没有用 Mock 替代。

## 安装包

| 产物 | 大小 | SHA-256 |
|------|------|---------|
| `AI Novel Studio_2.4.0_x64_en-US.msi` | 6,529,024 bytes（6.23 MiB） | `a56538eaf7bf37b03b84c6e96e07f96893511e1cf3078254788fa5354fe1f8fe` |
| `AI Novel Studio_2.4.0_x64-setup.exe` | 4,684,329 bytes（4.47 MiB） | `d3c289a5a178d5bf868ee2c4b0ae5eb440681f1465d260094442ae222a40c981` |

完整证据见 [`audit/phase-3/11-v2.4.0-compiler-tool-registry-acceptance.md`](audit/phase-3/11-v2.4.0-compiler-tool-registry-acceptance.md)。

## 版本边界

v2.4.0 不实现 Planner、execution lease、checkpoint、自动续跑、跨重启计划恢复、长期 Memory、Agent Tool Calling、Multi-Agent 或 Agent 自主写入。下一阶段按独立 v2.5.x 版本进入 Planner 与可靠恢复链路。

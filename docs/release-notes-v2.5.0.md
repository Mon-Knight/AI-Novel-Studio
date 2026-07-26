# AI Novel Studio v2.5.0 发布说明

发布日期：2026-07-26
主题：Chapter Readiness Planner Runtime

## 核心变化

v2.5.0 交付首个正式、持久、可恢复的产品内 Planner：`chapter_readiness_plan_v1`。它在写作工作台中依次读取作品上下文、章节大纲、章节上下文、风格方案与输出控制，最后通过 `verification.check_readiness@1` 输出准备度、缺失项与建议摘要。

整个计划只调用本地只读工具，不调用 AI Provider，不生成或修改正文。用户仍决定是否补齐信息以及何时进入正文生成。

## 持久执行与恢复

- Plan、六个 Step、八条依赖、每次 Attempt、execution lease 与 Checkpoint 全部保存到 SQLite。
- Plan 创建使用 `operationId + requestHash` 幂等；Step 冻结 Registry/schema/权限/scope/参数 hash。
- 每个 Plan 同时最多一个活动 lease；明文 token 只存在于 Executor 内存，SQLite 仅保存 SHA-256。
- 工具失败形成一个 failed Attempt 并进入 `waiting_retry`，不自动重试。
- 应用重启把 running Attempt 标为 `abandoned`，Plan/Step 恢复为 `waiting_retry`，活动 lease 标为 `expired`；用户必须明确点击继续。
- 浏览器开发模式不使用 LocalStorage 伪造持久 Planner。

## Tool Registry

生产 Registry 新增 `verification.check_readiness@1`，工具总数从八个增至九个，当前 hash 为：

```text
846a38c25bba33c843b56fa6583b334bae3364073fb7f0b6290be0c405aae871
```

所有工具仍为只读或本地验证；生产 Provider 策略继续保持 `allowedTools=[]`，模型不能自主调用工具。

## 工作台体验

AI 生成面板顶部新增紧凑“章节准备计划”卡片：

- 创建并检查；
- 展示六步进度与持久状态；
- completed 后显示准备度分数、摘要和缺失项；
- waiting_retry 时解释不会自动重放，并提供明确继续按钮；
- 终态可重新创建一次独立检查。

## 验证摘要

- Planner / Registry 专项：8/8。
- `npm test`：Node 16/16，tsx 67/67。
- Rust / SQLite：143/143，另 1 项真实隔离数据库迁移测试按设计 ignored。
- TypeScript + Vite production build：通过，236 modules。
- Windows Tauri E2E：13/13 独立桌面 spec 通过；Planner 2/2，既证明六个本地 Tool 各执行一次、SQLite 事实可读且外网请求为 0，也证明真实重启后不自动重放、显式继续产生 Attempt 2、再次重启不新增历史。
- 本版没有修改 Prompt、Provider messages 或 Provider Adapter，因此未调用真实 API。

## 安装包

| 产物 | 大小 | SHA-256 |
|------|------|---------|
| `AI Novel Studio_2.5.0_x64_en-US.msi` | 6,656,000 bytes（6.35 MiB） | `2c83cf3cabf391e63b00385430331ad3a43380473e5a62ebd317bede038ad9ba` |
| `AI Novel Studio_2.5.0_x64-setup.exe` | 4,771,641 bytes（4.55 MiB） | `639e6feb8ec7c86bae41c04fb0d9614ffc4be6eafbc380a7aecaf163ceabf19f` |

## 版本边界

v2.5.0 不实现长期 Memory、正文生成/应用副作用、动态 Planner、自动重试/续跑、Multi-Agent 或 Agent 自主写入。下一阶段按独立 v2.6.x 版本进入 Memory、连续性与受审核单 Agent 章节闭环。

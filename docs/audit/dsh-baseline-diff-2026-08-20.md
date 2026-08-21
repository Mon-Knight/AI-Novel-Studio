# DSH 固定基线差异审计（v3.3.0）

日期：2026-08-20  
发布载体：`47f943859bef60e4160492346772ded9b24f765a`  
参考快照：`141eb6fef83422698aef7a981029e843e8161534`

## 审计方法

在本机只读 checkout `F:\dsh-v320-clean` 与 `F:\deepseek-harness-source-analysis-20260820` 上执行：

```powershell
git diff --numstat 47f943859bef60e4160492346772ded9b24f765a 141eb6fef83422698aef7a981029e843e8161534 -- `
  packages/core/agent-loop/src/agent.ts `
  packages/core/tools/src/index.ts `
  packages/core/session/src/index.ts `
  packages/compaction/compaction-basic/src/region.ts `
  packages/sdk/server/src/index.ts
```

本次没有把参考快照升级为应用发布载体，也没有将 Harness 内部类型暴露给 React 或 SQLite。

## 差异结论

| 区域               | 47f9438 → 141eb6f 结果                                                                                                 | ANS 处理                                                                                                    |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Agent Loop         | 流式输出增加逐 chunk abort 检查；取消时追加带 `interrupted` 标记的 assistant/message，并保留 source event seq 与 usage | ANS 通过 `TaskRun` 的取消终态和 `tool_call_events` 投影承载可见事实，不依赖 DSH session JSONL               |
| SDK Server Boot    | `initialize` 在有 Loader 时等待 Loader settle，再返回 ready                                                            | `taskSessionAdapter` 将 Session/Agent/Worker 映射为 ANS 稳定 ID；Runtime Registry 只读取 Adapter projection |
| Tools API          | 关键目标路径没有差异输出                                                                                               | 继续使用固定 carrier 的工具策略；小说工具仍由 ANS `ToolRegistry` 白名单控制                                 |
| Session API        | 关键目标路径没有差异输出                                                                                               | Session 事实由 ANS `task_conversations`、`conversation_turns` 和 `task_runs` 持久化                         |
| Compaction         | 关键目标路径没有差异输出                                                                                               | v3.3.0 仅冻结任务运行边界，不把小说上下文压缩实现并入工作台                                                 |
| Plugin/Profile API | 关键目标路径没有差异输出                                                                                               | “当前插件”由 ANS Tool Registry + DSH Adapter projection 只读聚合                                            |

## 集成决定

1. v3.3.0 继续固定 `47f943859bef60e4160492346772ded9b24f765a`，参考快照只用于差异审计。
2. ANS DSH Adapter 使用 Headless Worker 边界；取消或故障不跨任务传播。
3. React 只消费 `CurrentPluginProjection`、任务运行和事件卡片，不消费 Cordis/DSH 内部对象。
4. DSH 运行日志用于执行重放参考；SQLite 中的小说事实、任务事实和产物卡片仍由 ANS 持久层权威承载。

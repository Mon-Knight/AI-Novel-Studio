# AI Novel Studio v2.12.0

v2.12.0 完成自主生成 Phase 0-5 的可运行闭环：任务调度、质量门槛、多章生成、连续性检查和专家协作均通过统一 Provider 适配层执行，并将迁移 023-026 的事实写入 SQLite。

- 新增自主生成控制面板和 `/novels/:id/autonomous-monitor` 路由。
- 修复旧版 `chapter_summaries` 迁移兼容、任务状态时间戳和进度 IPC 契约。
- 自动大纲、总结、润色、质量检查、连续性检查和专家评审支持 Mock/API Provider。
- E2E 诊断现在验证 026 迁移和七张自主生成相关表。

验证：`npm run build`、`npm test`、`cargo test --locked`。

---
name: verify-build
description: 验证 AI Novel Studio 的指定构建目标、当前变更或明确要求的完整发布矩阵；不把普通开发检查自动升级为发布验收。
---

# 构建与变更验证

以 [AGENTS.md](../../../AGENTS.md) 的适用范围为准。读取 package.json 的 engines、scripts 和锁文件；当前 Node 要求 >=22.6.0，后续以清单为准。只检查所需工具；依赖已有且有效时不重复安装，不为诊断升级依赖。

| 用户要求       | 入口与证据                                                      |
| -------------- | --------------------------------------------------------------- |
| 验证当前修改   | `npm run verify:change -- --dry-run`，随后执行所选检查          |
| 指定前端构建   | `npm run build`，证明类型检查和 Vite 构建                       |
| 指定 Rust 编译 | `cargo check --locked --manifest-path src-tauri/Cargo.toml`     |
| 指定桌面产物   | `npm run tauri:build`，准备固定载体并完成生产构建               |
| 完整发布验收   | `scripts/agent-workflow/verify_project.ps1`，聚合矩阵只调用一次 |

没有文件变化但用户要求一般构建检查时，运行前端 build 并说明其证明范围。Tauri 构建已包含前端构建，不为相同产物再提前执行一次。DSH 完整验收前仍须准备固定载体和当前 Gateway，不能复用不明缓存。

失败后定位本次引入的问题并定向修复；记录既有失败和环境缺项，继续独立检查。失败的前置构建、Gateway 或隔离环境不能供依赖步骤使用。不隐藏错误，不把缺工具、零匹配、SKIPPED 或 NOT_RUN 写成 PASS。

通过的检查仅在所覆盖代码/配置变化或有具体新风险时复测。日常工作树可以保留未提交修改；clean working tree 仅适用于完整发布终态。构建通过不能直接宣称“可以发布”，还需发布任务要求的完整门禁和相应授权。

汇报命令、结果、测试数量/耗时（工具实际提供时）、产物及局限。[测试策略](../../../docs/technical/testing.md) 维护环境与证据要求，[验证清单](../../checklists/verification.checklist.md) 按适用项使用。

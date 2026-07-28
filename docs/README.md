# AI Novel Studio 文档索引

> 本文档是 AI Novel Studio 项目文档总索引，按使用者角色分为用户指南、项目管理、技术文档和设计文档。

---

## user/ - 用户使用指南

| 文档                                                | 说明                               | 状态                |
| --------------------------------------------------- | ---------------------------------- | ------------------- |
| [quick-start.md](user/quick-start.md)               | 快速开始指南                       | ✅ 已整理           |
| [desktop-usage.md](user/desktop-usage.md)           | Windows 桌面端使用说明             | ✅ 已整理           |
| [ai-settings.md](user/ai-settings.md)               | AI 模式与模型配置                  | ✅ 已整理           |
| [data-import-export.md](user/data-import-export.md) | 数据导入导出与完整项目备份恢复说明 | ✅ v2.1.7 已同步    |
| [workflow-guide.md](user/workflow-guide.md)         | 创作工作流指南                     | 🚧 占位，待后续细化 |

## project/ - 项目管理文档

| 文档                                                             | 说明                                        | 状态                 |
| ---------------------------------------------------------------- | ------------------------------------------- | -------------------- |
| [version-roadmap.md](version-roadmap.md)                         | 当前权威版本路线图                          | ✅ v3.0.0 已同步     |
| [module-boundaries.md](module-boundaries.md)                     | 模块边界定义                                | ✅ 已有              |
| [development-rules.md](development-rules.md)                     | 开发规则总览                                | ✅ 已有              |
| [feature-gap-analysis-v3.0.0.md](feature-gap-analysis-v3.0.0.md) | v3.0.0 九类功能缺口、证据校正与建议演进顺序 | ✅ 2026-07-28 已审计 |
| [agent-task-rules.md](project/agent-task-rules.md)               | Agent 任务执行规则                          | 🚧 占位，待后续细化  |
| [git-workflow.md](project/git-workflow.md)                       | 分支策略、PR 门禁、发布与紧急修复流程       | ✅ v3.0.0 已明确     |
| [release-history.md](project/release-history.md)                 | 40 份历史发布说明的单一只读归档             | ✅ v3.0.0 已合并     |

## technical/ - 技术文档

| 文档                                                                                                | 说明                                                  | 状态                |
| --------------------------------------------------------------------------------------------------- | ----------------------------------------------------- | ------------------- |
| [architecture.md](technical/architecture.md)                                                        | 项目架构总览                                          | 🚧 占位，待后续细化 |
| [database.md](technical/database.md)                                                                | 数据库设计与迁移                                      | 🚧 占位，待后续细化 |
| [desktop-build.md](technical/desktop-build.md)                                                      | 桌面端构建指南                                        | 🚧 占位，待后续细化 |
| [testing.md](technical/testing.md)                                                                  | 测试策略与用例                                        | ✅ v3.0.0 已补充    |
| [diagnostics.md](technical/diagnostics.md)                                                          | 前端异常、原生 panic、本地脱敏导出与隐私边界          | ✅ v3.0.0 已实现    |
| [ai-execution-facts.md](architecture/ai-execution-facts.md)                                         | v2.3.0 Task / Snapshot / Artifact 执行事实架构        | ✅ 已冻结并实现     |
| [provider-execution-pipeline.md](architecture/provider-execution-pipeline.md)                       | v2.3.1 Provider Adapter 与首批入口迁移                | ✅ 已实现           |
| [safe-apply.md](architecture/safe-apply.md)                                                         | v2.3.2 Proposal / Plan / TargetLink 单目标安全应用    | ✅ 已实现           |
| [context-constraint-tool-registry.md](architecture/context-constraint-tool-registry.md)             | v2.4.0 正式编译协议、预算与工具注册边界               | ✅ 已实现           |
| [chapter-readiness-planner-runtime.md](architecture/chapter-readiness-planner-runtime.md)           | v2.5.0 持久 Planner、lease/checkpoint、显式重试与恢复 | ✅ 已实现           |
| [multi-agent-collaboration.md](architecture/multi-agent-collaboration.md)                           | v3.0.0 全书自主规划、六专家评审、逐章推进与持久事实   | ✅ 已实现           |
| [desktop-e2e.md](technical/desktop-e2e.md)                                                          | Windows 真实 Tauri E2E、隔离与排障                    | ✅ v2.1.7+ 持续适用 |
| [v2.3.1 Provider 管线验收报告](audit/phase-3/09-v2.3.1-provider-pipeline-acceptance.md)             | Provider 发布门禁、真实 API 尝试与安装包证据          | ✅ 已记录           |
| [v2.3.2 Safe Apply 验收报告](audit/phase-3/10-v2.3.2-safe-apply-acceptance.md)                      | 安全应用不变量、桌面 E2E 与安装包证据                 | ✅ 已记录           |
| [v2.4.0 Compiler / Registry 验收报告](audit/phase-3/11-v2.4.0-compiler-tool-registry-acceptance.md) | 编译确定性、后端失败关闭、真实 API 与安装包证据       | ✅ 已记录           |
| [v2.5.0 Planner Runtime 验收报告](audit/phase-3/12-v2.5.0-planner-runtime-acceptance.md)            | 持久 DAG、lease、显式重试、恢复与桌面 E2E 证据        | ✅ 已记录           |
| [v2.3.0 M1 验收报告](audit/phase-3/08-v2.3.0-m1-acceptance.md)                                      | 执行事实层发布门禁与安装包证据                        | ✅ 通过             |
| [api-routes.md](technical/api-routes.md)                                                            | API 路由说明                                          | 🚧 占位，待后续细化 |
| [deployment.md](technical/deployment.md)                                                            | 部署说明                                              | 🚧 占位，待后续细化 |

## design/ - 设计文档

| 文档                                                              | 说明               | 状态                            |
| ----------------------------------------------------------------- | ------------------ | ------------------------------- |
| [novel-engineering.md](design/novel-engineering.md)               | 小说工程化设计     | 🚧 占位，待后续细化             |
| [context-assets.md](design/context-assets.md)                     | 上下文资产管理设计 | 🚧 占位，待后续细化             |
| [setting-suggestions.md](design/setting-suggestions.md)           | 设定库 AI 推演设计 | ✅ v1.7.9～v1.7.10 已实现基础版 |
| [future-interactive-story.md](design/future-interactive-story.md) | 未来交互式叙事设计 | 🚧 占位，待后续细化             |

---

## 根级参考文档

| 文档                                               | 说明                               |
| -------------------------------------------------- | ---------------------------------- |
| [product-design.md](product-design.md)             | 产品设计总纲                       |
| [ui-reference.md](ui-reference.md)                 | UI 参考标准                        |
| [data-model.md](data-model.md)                     | 数据模型边界                       |
| [user-guide.md](user-guide.md)                     | 用户使用手册                       |
| [prompt-system.md](prompt-system.md)               | 提示词系统设计                     |
| [agent-workflow.md](agent-workflow.md)             | Agent 工作流                       |
| [agent-runtime.md](agent-runtime.md)               | Agent 运行时说明                   |
| [ai-agent-roadmap.md](ai-agent-roadmap.md)         | AI Agent 路线图                    |
| [project-architecture.md](project-architecture.md) | 项目架构文档                       |
| [module-boundaries.md](module-boundaries.md)       | 模块边界文档                       |
| [development-rules.md](development-rules.md)       | 开发规则                           |
| [development-skills.md](development-skills.md)     | 开发辅助 Skills 总览               |
| [CHANGELOG.md](../CHANGELOG.md)                    | 唯一持续维护的版本变更记录         |
| [release-history.md](project/release-history.md)   | 历史发布说明单文件归档与源文件哈希 |

原 40 份逐版本发布说明已合并到 `project/release-history.md`。新增变更只写入根目录
`CHANGELOG.md`；发布流水线按版本提取对应段落，不再创建文档碎片。

> 标记说明：✅ 已整理 / 🚧 占位，待后续补充。

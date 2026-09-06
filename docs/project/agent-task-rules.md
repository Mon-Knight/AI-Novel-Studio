# Agent 任务执行速查

> 此页是项目管理目录中的导航入口，不复制或覆盖根 [AGENTS.md](../../AGENTS.md)。详细过程见 [Agent 开发工作流](../agent-workflow.md)。

## 接到任务后

1. 读取最新用户需求和根规则，运行 `pwd`、`git status --short --branch`，确认工作区并保护已有修改。
2. 从 [文档索引](../README.md) 按任务读取权威设计、当前实现和直接相关测试。
3. 说明目标、文件范围、不做事项和验证计划；明确的低风险任务可直接执行，歧义、架构决策、破坏性操作或扩大范围先确认。
4. 小步修改，同步相关文档和根 `CHANGELOG.md`，再按根验证矩阵检查；非发布变更记录在 `Unreleased`，不自动升级版本。
5. 汇报主要文件、实际命令/结果、未验证项和 Git 状态；没有相应授权就不提交、推送或发布。

## 何时需要任务书

跨会话/工具交接、复杂版本目标或用户明确要求时使用自包含任务书，包含目标、版本或“非版本任务”、禁止事项、实现要求、测试与完成格式。明确的同会话任务不强制重复生成任务书。

编写前读取 [agent-task-writer/SKILL.md](../../.github/skills/agent-task-writer/SKILL.md)。任务模板中的命令不是自动提交、真实模型调用或下一版本开发的授权。

## 相关入口

- [开发辅助 Skills](../development-skills.md)：选择并读取本次需要的 Skill，不把它当作产品已实现功能。
- [模块边界](../module-boundaries.md)：找到代码落点与持久化权威。
- [测试策略](../technical/testing.md)：区分定向、浏览器、桌面、Mock 与 live Provider 证据。
- [Git 治理](git-workflow.md)：获准提交或发布后遵守 PR、审查与不可移动 tag 规则。

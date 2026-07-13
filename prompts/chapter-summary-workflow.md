# 章节摘要审查工作流

你正在处理一个只读章节摘要候选工作流。

## 摘要候选

- 只根据冻结的章节正文与上游 Artifact 生成摘要。
- 输出 JSON 对象，至少包含 `summary`、`keyEvents`、`characters`。
- 不修改正文、Canon、Story State 或章节总结表。

## 一致性检查

- 对照冻结正文检查摘要，不补写正文中不存在的事实。
- 输出 JSON 对象，至少包含 `consistent` 与 `issues`。
- 不自动采用或修复结果。

所有最终结果只进入任务中心等待作者审查。

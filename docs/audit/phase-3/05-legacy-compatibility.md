# 05 — Legacy AI 数据兼容策略

## 1. 分类规则

- A：现有业务数据可原样保留并由新链路引用，无需伪造字段。
- B：可建立只读兼容映射或来源链接，但明确显示 unknown/missing。
- C：只能作为 legacy 记录展示；不能转成可重放/可应用的新对象。
- D：确认没有生产持久使用，可停止新增但本阶段不删除。

任何转换都不得根据时间相邻、文本相似、latest 行或 UI 文案猜测 taskId、traceId、operationId、输入/上下文/约束快照、目标版本或正文 hash。

## 2. 兼容分类表

| 数据形态 | 位置 | 分类 | 策略 |
|---|---|---|---|
| 正式章节、卷、人物、设定、规则、大纲、上下文 | SQLite 业务表 | A | 原样保留；新 Artifact 通过 target link 关联，绝不重写历史正文/版本 |
| 旧草稿及 adopted 状态 | chapter_drafts/chapters | A | 保留 ID/version/content/hash（存在时）；没有 ai_task_id 的草稿仍是合法 legacy 草稿 |
| v2.1.1/v2.2.0 正文安全 metadata | 当前候选草稿和前端请求结构 | A/B | 新请求直接采纳；历史会话 guard 不可持久恢复，标为无 Apply operation |
| 旧质量报告/items | quality_check_reports/items | A（业务）+B（来源） | 报告继续可读；有 draftVersion/hash 可校验，没有 Artifact/task link 不回填 |
| polish_records | SQLite/localStorage | B | 展示旧润色来源/结果 draft；pending 不等于正在运行，迁移 UI 标 legacy_unknown |
| quality_fix_runs | SQLite/localStorage | B | 保留比较记录；status=adopted 只表示旧流程判定，不推断正式草稿 adopted |
| ai_task_records | SQLite | B | 映射到 LegacyTaskView；保留原 status/provider/model/token/摘要。不得直接插入新 ai_tasks 假装有 Snapshot |
| localStorage ai_novel_studio_ai_tasks | 浏览器开发态 | B | 继续由 aiTaskService 读取；未来可导入 LegacyTaskView，保留原 ID |
| localStorage ai_novel_studio_ai_task_records | 更旧浏览器键 | B | 当前 Service 已按 ID 合并并迁到新键；保持兼容直到明确清理版本 |
| generation_jobs | SQLite/localStorage | B | 映射 LegacyGenerationTaskView；job status/retry_count 保留，不当成新 Task 状态机已验证 |
| generation_step_results | SQLite/localStorage | B/C | 作为 job 证据；input/output JSON 没 schemaVersion，完整 output_text 不自动转 Artifact |
| chapter_generation_snapshots | SQLite/localStorage | B | 可显示 contextHash/source 摘要；缺 schemaVersion/source versions/base draft，不能直接成为 AiContextSnapshot |
| context_read_logs | SQLite + 当前会话内存 | B | 保留 used/skipped IDs；明确 chapter summary IDs 可能缺失，不能回放 |
| outline context_snapshot | outline tables | C | 原样显示 legacy snapshot；已截断且 source_type 可能 manual，不转正式 Snapshot |
| setting suggestions 候选 | localStorage ai_novel_studio_setting_suggestions | C | 保留现有页面读取/采纳；因无可靠 Task 关联，不批量转 Artifact。新链路启用后旧记录标 legacy |
| 组件内未保存 AI 结果 | React local state | D | 页面已卸载后不存在持久数据，无迁移对象；不能声称已恢复 |
| Prompt/message 历史 | 无统一持久表 | D | 不存在；不得从 result 摘要反推 Prompt/messages |
| 声明但无生产调用的 task types | setting_structure、rule_structure、protagonist_structure、volume_outline_expand、chapter_summarize、context_update | D | 保留 enum 兼容，不生成虚假历史；待实际入口迁移时重新审查 |
| old source/ai_task_id 空值 | 多个业务表 | B/C | 空值保持空；只在用户明确选择/新事务有证据时建立新 target link |

## 3. 新旧并存读取

v2.3.0 迁移期任务中心采用双源只读投影：

1. 新 ai_tasks/attempts/artifacts 使用完整新状态。
2. ai_task_records 和 generation_jobs 显示“Legacy”徽标及原始状态。
3. Legacy 行不提供 retry、cancel、replay 或 Apply 按钮；仅允许查看已有业务目标（若有明确 ID）。
4. 排序可统一按 createdAt，但不能合并两个不相同 ID 的行。
5. 新入口迁移后停止为该入口新增旧行；旧 Service 暂留给未迁移入口。

## 4. v2.1.1 / v2.2.0 直接升级

- 005+ migration 只 CREATE 新表/索引和必要的安全约束，不改写原正文/草稿历史。
- v2.1.1 可能没有 schema_migrations；启动时先由现有 001–004 建账本，再顺序应用 005+。
- v2.2.0 已有账本必须校验 001–004 checksum；新 migration 也使用固定 definition checksum。
- 空库、普通正文、长正文/分片、adopted 草稿都要升级测试。
- outline 表的账本外历史形态要通过 schema introspection 测试，但本阶段不搬表。

## 5. 浏览器开发模式

浏览器 localStorage 是开发回退，不与桌面 SQLite 自动双向同步。新 Repository 必须继续提供等价的浏览器实现，但测试要明确：

- AI 设置仍在 ai_novel_studio_ai_settings；不得写入 Snapshot/API Key。
- draft、quality、context 等已有 key 保持可读。
- 新 Task/Artifact localStorage schema 带 schemaVersion、hash、operationId，并复用与桌面相同状态纯函数。
- localStorage quota/写失败必须抛权威错误；不能沿用 lsSet 吞异常后显示成功的行为。

## 6. 删除策略

本联合任务内不删除 ai_task_records、generation_jobs、generation_step_results、chapter_generation_snapshots、旧 localStorage keys 或任何业务数据。未来废弃需要：生产写入计数为零、双读期结束、可逆备份/导出、专门 migration 和用户确认；不属于 v2.3/v2.4 范围。

## 7. 兼容性验收

- legacy 行原字段逐项保持；unknown 明确可见。
- 升级前后草稿数量、版本、adopted 指针、全文 hash 不变。
- 无 taskId/snapshot/hash 的数据不会获得虚构值。
- 新 Apply 不会把 legacy offset 当 TextRangeLock。
- 新任务中心不会对 legacy running 行误发取消或自动重试。

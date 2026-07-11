# 多目标事务边界冻结

> v2.3.0 实现单目标安全应用；v2.4.0 实现本文件的完整多目标事务。

## 1. 总原则

SQLite 是应用结果的权威状态。一次 ApplyPlan 的业务写入、长文本引用、ArtifactTargetLink 和幂等结果必须在同一 Immediate transaction 中完成。React 状态、localStorage 和缓存都不是提交依据。

~~~text
读取全部目标
→ 校验作品归属和目标存在性
→ 校验版本/hash/adopted/range lock
→ 校验依赖图并预分配 ID
→ BEGIN IMMEDIATE
→ 再次读取并校验权威状态
→ 按拓扑序写入业务对象和大文本
→ 检查每项 affected rows
→ 写 ArtifactTargetLink
→ 写 operation 权威结果
→ COMMIT
→ 提交后缓存失效
~~~

## 2. 单目标事务复用

### 2.1 章节正文

唯一合法路径：

~~~text
chapter_text Artifact
→ 新候选草稿
→ save_chapter_draft_atomic 的事务内核心
~~~

不得新增第二条 INSERT chapter_drafts 路径。实施前必须扩展现有原子保存输入/输出，使 Tauri 与浏览器一致保留 aiTaskId、artifactId、note，并在同一事务创建 ArtifactTargetLink。已采用草稿仍不可变；基于 adopted 编辑时创建新候选。

### 2.2 其他单目标

| 目标 | Service / Repository | 必须校验 | 事务内附带写入 |
|---|---|---|---|
| master/volume/chapter outline | outline service/repository | novel、目标、version/hash、active 约束 | target link、operation result |
| character / chapter_event | character/event service | novel/chapter 归属、重复键、expected version | target link、来源字段 |
| world_setting / rule_system | setting service | novel、类型白名单、version/hash | target link、来源字段 |
| quality report/items | quality service | draft/version/hash、item 数量 | report+items+target link |
| chapter/volume summary | context service | adopted draft/version/hash、volume 归属 | summary/context/link；相关多写入延后 v2.4 |
| style profile | style service | novel 可空规则、schema | profile+target link |

每项 UPDATE/DELETE 必须检查 affected rows。新建操作预期 1 行；批量子项应检查总数和唯一键，不允许零行仍返回成功。

## 3. 不允许嵌套 transaction

当前 save_chapter_draft_atomic_with_cleanup 在 Connection 上自行开启 transaction。多目标 Apply 不允许在它外层再开 transaction，也不允许 SAVEPOINT 模拟两个互不知情的提交边界。

需要抽取：

~~~rust
fn save_chapter_draft_in_transaction(
    tx: &Transaction<'_>,
    input: &ValidatedDraftWrite,
) -> Result<SavedDraft, AppError>
~~~

外层单目标 command 和多目标 Apply service 都调用这一内部函数。只有最外层 Service 负责 begin/commit/rollback；Repository 函数接收 Transaction 或兼容的 Connection 引用，但绝不自行 commit。

## 4. 十项冻结答案

1. **能否在 save_chapter_draft_atomic 外层再开 transaction？**不能。必须抽取事务内核心。
2. **如何复用？**保留现有 command 作为单目标门面；门面开启 Immediate transaction 后调用同一个内部函数。多目标 Service 在自己的 transaction 中直接调用内部函数。
3. **如何避免嵌套？**commands 不调用其他 commands；Service 声明事务所有权；Repository 不开启事务。代码评审和测试注入嵌套场景并要求失败。
4. **大文本 chunks 如何加入同一事务？**large_text_documents、large_text_chunks、目标引用和正文预览都使用同一个 Transaction 写入。分片 hash/总 hash 校验完成前不更新目标引用；失败整体回滚。
5. **业务对象 ID 如何生成？**ApplyPlan 固化前由后端预分配 UUID，并写入操作 payloadHash；事务内按该 ID 插入。幂等重放复用相同 ID。
6. **依赖如何排序？**以 operationIndex 为稳定次序执行拓扑排序；同层按 operationIndex；缺失节点或环路返回 DEPENDENCY_CYCLE，事务不开始。
7. **commit unknown 如何处理？**commit 返回异常后用新连接按 operationId 查询 operation 表和 target links。completed+同 requestHash 返回成功；已知无提交返回 failed；无法判定保持 commit_unknown，禁止盲重试。
8. **提交后缓存清理失败怎么办？**提交仍算成功；记录 CACHE_INVALIDATION_FAILED warning，将作用域写入待刷新队列并强制下次读取绕过缓存。不能向用户谎报数据库失败。
9. **多目标 operationId 存哪里？**artifact_apply_plans.operation_id 唯一；artifact_apply_operations 引用 plan；operation 结果与首次 target links 同事务持久化。
10. **幂等重放如何返回首次结果？**先比对 operationId/requestHash，再直接反序列化首次 resultJson 或查询已提交 target links；不得再次执行业务 SQL。

## 5. 事务内校验

事务前预检改善 UX，事务内必须重新做全部权威校验：

- novelId 与每个目标的真实归属；
- 目标未软删除；
- expectedVersion 和 expectedHash；
- draftId/chapterId 组合；
- adopted 草稿不可变；
- TextRangeLock 的版本、全文 hash、选区 hash、边界；
- Artifact 有效且 Plan 未过期；
- operationId/requestHash 未冲突；
- 依赖目标已经由本事务创建或原本存在。

任何校验失败都不得产生部分 target link 或 optimistic success。

## 6. 长文本处理

- 大文本继续复用 v2.2.0 large_text_documents/chunks，不在 Apply 表内联完整正文/Prompt。
- 每个长文本先计算 UTF-8 byte length、Unicode scalar count、chunk SHA-256 和全文 SHA-256。
- 文档行初始 status=staging，只能在所有 chunks 验证后于同一事务改 ready 并写目标引用。
- 回滚后不应留下 ready 文档或孤儿 chunk；测试必须故障注入每个 chunk 和引用更新点。
- 读取失败 fail-closed；preview 不可参与 hash、AI 上下文或 Apply。

## 7. commit unknown 对账状态

| 数据观察 | 结论 | 动作 |
|---|---|---|
| operation completed 且 requestHash 匹配 | 已提交 | 返回首次结果并将 Plan completed |
| operation absent，且无任何预分配 target/link | 未提交 | Plan failed，可基于新 operationId 生成新 Plan |
| operation started 或目标/link 不完整 | 未知/异常 | Plan commit_unknown，阻止再写并提示恢复 |
| operationId 存在但 requestHash 不同 | 冲突 | OPERATION_PAYLOAD_CONFLICT，人工检查 |

reconciler 只读对账，不通过猜测补齐业务对象。

## 8. 必测故障点

- 第一个和中间业务 INSERT 失败；
- affected rows=0；
- 大文本第 N 个 chunk 失败/哈希不符；
- target link 失败；
- operation result 写入失败；
- commit 返回错误但实际提交；
- 提交成功后缓存清理失败；
- 同 operation 并发两次；
- 同 operation 不同 payload；
- adopted、跨作品、版本/hash、范围锁冲突。

# Phase 1 回归测试矩阵

## 1. 测试基线结论

- 当前没有 React 单元测试框架、组件测试或桌面 E2E 测试。
- `test:setting-suggestions`、`test:quality-workspace`、`test:ai-tasks-delete:static` 是 PowerShell 文本契约检查，只能证明代码包含某些字符串/结构。
- Rust 当前 3 个单测中 1 个失败；AI task runtime 脚本没有传播 cargo 失败退出码，能产生假绿。证据：`scripts/agent-workflow/runtime_check_ai_task_delete.ps1:12-16`。
- 下列 R01-R20 均没有能够动态证明预期行为的现有自动化测试；“当前推测”基于静态真实链路，不作为通过结论。

建议测试层（仅设计，不在 Phase 1 实现）：

```text
React component/integration（可控 deferred Promise + fake repositories）
→ Tauri command integration（临时完整 Schema + 故障注入）
→ Windows desktop E2E（真实 WebView，Mock AI，不访问真实数据）
```

## 2. R01-R20

### R01 生成中收起侧栏

- 前置条件：章节 A 已打开；Mock AI 使用可控延迟；AI Generate 面板已开始生成。
- 操作步骤：开始生成 → 立即点击同一工具按钮收起 → 等响应完成 → 展开同一面板。
- 预期结果：任务不取消；目标仍为 A；结果可恢复；不会重复创建草稿；进度/错误属于该 task。
- 当前实现推测：`display:none` 保留同一面板实例，通常能继续并显示 local 结果；但任务没有持久 target revision，页面卸载后不能保证。
- 已有自动化：无；静态脚本只验证部分侧栏结构。
- 缺失测试位置：`src/components/right-dock/__tests__/RightPanel.lifecycle.test.tsx`；桌面 E2E `tests/e2e/sidebar-generation.spec.ts`。
- 风险等级：P1。

### R02 生成完成后切换面板

- 前置条件：A 生成完成，候选草稿与面板结果可见。
- 操作步骤：切到润色/大纲面板 → 再切回 AI Generate。
- 预期结果：结果从持久 task/result 恢复，并明确目标 A、基础版本与应用状态。
- 当前实现推测：切换组件类型会卸载 AiGeneratePanel，`latestGeneratedDraft` 丢失；候选草稿仍在 DB，可从草稿历史找回，但面板结果语义/校验状态丢失。
- 已有自动化：无。
- 缺失测试位置：`src/components/right-dock/__tests__/panel-result-persistence.test.tsx`。
- 风险等级：P1。

### R03 生成中切换章节

- 前置条件：A 生成请求 pending，B 已存在正文。
- 操作步骤：A 点击生成 → 切到 B → A 响应返回。
- 预期结果：A 结果只保存/显示在 A；B editor/currentDraft 不变化；通知可指向 A。
- 当前实现推测：草稿正确写入 A，但 `onGenerated(A)` 无 guard，会把 A 草稿装入 B 当前 UI。
- 已有自动化：无。
- 缺失测试位置：`src/pages/WritingWorkspace/__tests__/generation-target-binding.test.tsx`。
- 风险等级：P0。

### R04 生成中快速连续切换章节

- 前置条件：A/B/C 均有不同文本；可控制各 `getLatest` 和 AI response 顺序。
- 操作步骤：A 生成 → A→B→C 快速切换 → 让 B load 最后返回 → 让 A AI 再返回。
- 预期结果：C 始终显示 C；所有旧响应被隔离；无错误保存/采用。
- 当前实现推测：`loadChapterDraft` 和 AI callback 都无 request generation；最后返回者可覆盖 C 的 `currentDraft/editor`。
- 已有自动化：无。
- 缺失测试位置：同 R03，增加 deferred load ordering cases。
- 风险等级：P0。

### R05 生成中切换项目

- 前置条件：项目 P1/A 生成 pending；项目 P2/B 有不同正文。
- 操作步骤：开始 P1/A 生成 → 导航 P2/B → 响应返回 → 检查两项目 DB/UI/task 列表。
- 预期结果：结果只属于 P1/A；P2 UI 不更新；P1 task 可恢复；无跨项目通知误导。
- 当前实现推测：DB create 使用闭包 P1/A，通常不会直接写 P2；但旧面板 Promise 无取消/页面 generation guard，页面重用/卸载后的 UI 行为未验证，旧 task 也没有全局恢复入口。
- 已有自动化：无。
- 缺失测试位置：`tests/e2e/project-switch-inflight-ai.spec.ts`。
- 风险等级：P0（需证明不存在多项目串线）。

### R06 同时生成两个章节

- 前置条件：A、B；两次可控延迟 AI。
- 操作步骤：A 开始生成 → 切 B 开始生成 → 依次/逆序完成。
- 预期结果：两个独立 task、结果、进度和目标；当前编辑器只展示用户当前选择；可分别应用。
- 当前实现推测：不同面板实例/闭包能分别向 DB 写 A/B，但页面共享单个 `currentDraft` 与面板 local result，迟到顺序决定当前 UI。
- 已有自动化：无。
- 缺失测试位置：`src/pages/WritingWorkspace/__tests__/parallel-chapter-generation.test.tsx`。
- 风险等级：P0。

### R07 生成和质量检测同时运行

- 前置条件：A 有正文；生成与质量 AI 均可延迟。
- 操作步骤：启动生成 → 切质量面板并启动检测 → 交错完成。
- 预期结果：任务互不覆盖；质量报告绑定其 source snapshot；生成候选不改变正在检测的 base；modal 独立。
- 当前实现推测：quality snapshot/hash 较完整，但生成/质量都可调用 `onGenerated` 更新页面，且共享单个 global AI modal，完成顺序可能改变 `currentDraft` 和报告 UI。
- 已有自动化：无；`test:quality-workspace` 仅静态。
- 缺失测试位置：`src/components/right-dock/__tests__/parallel-generate-quality.test.tsx`。
- 风险等级：P0。

### R08 生成后修改原正文

- 前置条件：基于正文 v1 生成结果 R；生成后用户把 editor 改为 v1+。
- 操作步骤：修改正文并保持 dirty → 对 R 点击 replace/append。
- 预期结果：检测 base revision/hash 冲突；展示 diff，要求重新生成或显式冲突决策。
- 当前实现推测：replace 只提示当前 dirty，用户确认即可覆盖；append 不提示；无 base hash。
- 已有自动化：无。
- 缺失测试位置：`src/components/workspace/__tests__/apply-version-conflict.test.tsx`。
- 风险等级：P0。

### R09 生成后关闭并重启软件

- 前置条件：一种情况为结果已落草稿，另一种为 AI 仍在途；generation job 也各测一次。
- 操作步骤：关闭应用 → 重启 → 打开项目/章节/任务记录。
- 预期结果：已完成结果可恢复并标记未应用；在途任务明确 cancelled/interrupted 或可恢复；不永远 running。
- 当前实现推测：已落库草稿/job step 可查；面板 local 结果丢失；旧在途 HTTP 随进程终止且 task 可能停在 running；未见启动恢复 worker。
- 已有自动化：无。
- 缺失测试位置：`tests/e2e/restart-task-recovery.spec.ts`。
- 风险等级：P1。

### R10 质量检测后修改正文

- 前置条件：A/v1 有 completed report/hash。
- 操作步骤：修改一个字符 → 观察 warning → 点击定位 → 点击 AI 修复。
- 预期结果：报告明确 stale；禁止修复/应用；定位也应按 quote 重新确认或禁用。
- 当前实现推测：hash mismatch 会标 stale 并阻止 AI fix；旧定位按钮仍可用，offset 可能过期。
- 已有自动化：无；仅静态断言 hash 字段存在。
- 缺失测试位置：`src/components/right-dock/panels/__tests__/quality-stale-report.test.tsx`。
- 风险等级：P1。

### R11 应用 AI 结果时切换章节

- 前置条件：A 的 result 可应用；B 有正文。
- 操作步骤：点击 apply 与章节切换交错（在 confirm dialog 前后分别测试）。
- 预期结果：apply 固定 A；如果当前不再是 A，操作拒绝并导航/提示；B 不变。
- 当前实现推测：payload 无 chapter；`setApplyTextRequest`/Editor effect 面向当时当前 editor，可能作用 B。
- 已有自动化：无。
- 缺失测试位置：`src/pages/WritingWorkspace/__tests__/apply-during-navigation.test.tsx`。
- 风险等级：P0。

### R12 重复点击应用

- 前置条件：同一个 append/replace result。
- 操作步骤：双击、快速两次点击、关闭/重开后再点。
- 预期结果：同 result+target+base 的 apply 幂等；第二次明确提示已应用。
- 当前实现推测：每次点击生成新 request id；append 可重复插入。AiGenerate 的一个 append 按钮有局部 disabled，但 replace 与 Polish 无通用保护。
- 已有自动化：无。
- 缺失测试位置：`src/components/workspace/__tests__/apply-idempotency.test.tsx`。
- 风险等级：P1。

### R13 目标章节已被删除

- 前置条件：A AI pending；随后 soft delete A。
- 操作步骤：删除 A → 返回 AI 响应 → 检查草稿、任务、目录、错误。
- 预期结果：任务进入 target_missing/cancelled；不创建不可见草稿；结果仍可导出/转移。
- 当前实现推测：章节 soft-delete 行仍在，FK 不阻止向 A 创建草稿；结果可能成为目录不可见的孤立候选并回写当前 UI。
- 已有自动化：无。
- 缺失测试位置：Tauri integration `src-tauri/tests/ai_target_deleted.rs` + UI test。
- 风险等级：P1（UI 回写组合路径可升 P0）。

### R14 用户存在未保存正文

- 前置条件：A editor dirty。
- 操作步骤：切章节、切项目、关闭页面、replace AI、采用当前版本分别测试。
- 预期结果：所有离开/覆盖路径统一确认保存/丢弃/取消；保存失败不得离开；可崩溃恢复。
- 当前实现推测：章节切换只检查 chapter goal，不检查正文 dirty，A 未保存正文被新草稿 effect 覆盖；replace 只警告可继续。
- 已有自动化：无。
- 缺失测试位置：`src/pages/WritingWorkspace/__tests__/unsaved-body-guard.test.tsx` + restart E2E。
- 风险等级：P0。

### R15 数据库写入中途失败

- 前置条件：可在 adopt 第二 UPDATE、quality item 第 N 条、大文本 draft link、3 秒后提交处注入失败/延迟。
- 操作步骤：分别执行采用、质量保存、大文本保存、task save；重试并检查所有表。
- 预期结果：事务整体回滚或返回可识别 committed 状态；重试幂等；无 0 adopted、半报告、孤儿文本。
- 当前实现推测：adopt/quality/跨 command 大文本非整体事务；3 秒 race 可先报错后提交；会产生部分状态。
- 已有自动化：无。
- 缺失测试位置：`src-tauri/tests/transaction_boundaries.rs`、`large_text_failure_injection.rs`。
- 风险等级：P0。

### R16 取消任务后收到迟到响应

- 前置条件：generation job 在 AI step；另对旧 AiGeneratePanel 验证无 cancel。
- 操作步骤：点击 cancel → 让 AI 返回 → 检查 step、draft、job、UI。
- 预期结果：响应被丢弃或隔离为 cancelled artifact；不得创建/apply 草稿；状态一致。
- 当前实现推测：旧任务无取消；job 只在 step 开始前检查，迟到全文仍可保存进 step output，到下一 step 才停止。
- 已有自动化：无。
- 缺失测试位置：`src/services/generation/__tests__/job-cancellation.test.ts` + Tauri/HTTP mock integration。
- 风险等级：P1。

### R17 流式响应乱序或重复

- 前置条件：未来启用 SSE/token streaming；构造重复 sequence、乱序 delta、断线重连。
- 操作步骤：发送 1,2,2,4,3 / reconnect replay → finalize。
- 预期结果：按 task+sequence 去重排序；final hash 校验；未完成流不应用。
- 当前实现推测：当前没有流式实现，场景不可执行；若直接加入 streaming，现有 task/应用模型无 sequence/delta store。
- 已有自动化：无。
- 缺失测试位置：未来 `src/services/ai/__tests__/stream-assembler.test.ts`。
- 风险等级：P2（当前不适用；启用流式前为必测门槛）。

### R18 自动放置多个目标时部分失败

- 前置条件：placement plan 含多个 world/character/chapter target；第二项注入 DB 失败。
- 操作步骤：执行 plan → 检查所有目标与 plan status → 重试。
- 预期结果：同一事务整体回滚，或明确补偿且可幂等恢复；不能静默部分成功。
- 当前实现推测：通用多目标 plan 不存在；设定候选逐条采纳、无跨目标事务；无法满足预期。
- 已有自动化：无。
- 缺失测试位置：未来 Tauri `placement_plan_transaction.rs` 和 UI E2E。
- 风险等级：P1（若允许自动正式写入则升 P0）。

### R19 自动放置触碰锁定内容

- 前置条件：正文一段被锁；patch/replace 覆盖该段。
- 操作步骤：生成包含锁区变更的 plan → preview/apply。
- 预期结果：程序基于 lock range+base hash 拒绝；不能靠 prompt。
- 当前实现推测：没有锁模型；`forbiddenChanges` 仅 prompt，low-risk patch 只检查 quote/risk，通用 replace 可覆盖全文。
- 已有自动化：无。
- 缺失测试位置：未来 `src/services/placement/__tests__/locked-range.test.ts` + Rust transaction test。
- 风险等级：P0。

### R20 旧质量报告尝试修复新版本正文

- 前置条件：report 绑定 v1/hash1；当前 editor 为 v2/hash2。
- 操作步骤：直接点击 AI fix；再模拟缺 hash 的 legacy report；再模拟跨章节 load race。
- 预期结果：所有情况都必须比较 draft/version/hash；legacy 报告要求重检；不调用 AI。
- 当前实现推测：有 hash 时会阻止；legacy 用 dirty/currentDraftId fallback，强度较弱；跨章节状态混合可能使比较对象不可靠。
- 已有自动化：无；`test:quality-workspace` 只检查静态字段。
- 缺失测试位置：`src/components/right-dock/panels/__tests__/quality-fix-version-gate.test.tsx`。
- 风险等级：P1。

## 3. 数据库专项回归补充

除 R01-R20 外，Phase 2 前的最小安全门还应包含：

| 编号 | 场景 | 预期 |
|---|---|---|
| DB01 | adopt 传入不存在 draft | 原 adopted 不变，事务返回 target_not_found |
| DB02 | adopt 传入别章 draft | 两章均不变，返回 target_mismatch |
| DB03 | update 0 affected rows | 返回明确 conflict/not_found，前端保持 dirty |
| DB04 | 大文本全文 hash mismatch | finalize 回滚，不创建 document |
| DB05 | 大文本 commit 后缓存清理失败 | 返回 committed-with-cleanup-warning，不允许盲重试 |
| DB06 | 大文本 document 成功、draft link 失败 | 同事务回滚或可恢复 journal，不留孤儿 |
| DB07 | quality 第 N item 失败 | report/items 整体回滚 |
| DB08 | dbCall 超过 3 秒后 Rust 成功 | 前端能查询 operation id，不重复写 |

当前均无自动化覆盖。

## 4. 通过标准

R03、R04、R05、R06、R07、R08、R11、R14、R15、R19 和 DB01-DB08 在安全写入继续扩展前必须具备可重复自动化证据。静态文本断言、编译通过、手工正常路径演示均不能替代这些竞争/故障注入测试。


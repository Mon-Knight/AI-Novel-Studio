# v2.3.0-M3 — 创作意图作者审校与冻结闭环验收报告

日期：2026-07-13

## 1. 验收结论

v2.3.0-M3 已完成作品级创作意图的作者审校、不可变冻结、重启恢复与版本递进闭环。正式应用版本继续保持 2.2.0；M3 是内部里程碑，不是正式应用发版。

本里程碑只处理创作意图输入。没有扩展到初始化候选生成、正式创作导演、Story State、Multi-Agent 或自动 Apply。

## 2. 作者审校闭环

- 作品详情提供 `/novels/:novelId/creative-intent` 入口；
- 作者可新增、编辑、删除、确认和拒绝陈述；
- `knowledgeClass` 以只读信任标签展示，UI 不能把推断改写为作者事实；
- 作者显式输入必须逐项确认后才能冻结；
- 推断或待确认信息必须保留证据，pending 明确不等于作者确认；
- 修改已确认或已拒绝的内容/类型会回到 pending，旧决定不能复用于新内容；
- 保存使用同步防重锁；并发冲突提供权威重新读取，不静默覆盖；
- 路由参数变化使用读取世代隔离，上一作品的迟到响应不能出现在新作品页面。

页面只组织布局；门禁、dirty/CAS 输入与异步工作区编排位于 `src/features/creative-intent/`，持久化位于服务层。

## 3. Rust 权威事务与审计

新增命令：

- `get_latest_creative_intent(novelId)`；
- `freeze_creative_intent(input)`。

冻结在单一 SQLite `BEGIN IMMEDIATE` 中完成：

1. 校验作品、请求结构、凭据排除和 `expectedRevision + expectedContentHash`；
2. 以 `creative-intent:{novelId}:revision:{n}` 作为确定性 operation，并固定 request hash；
3. 由 Rust 生成 intent/statement 身份、权威时间、父版本链接和 hash；
4. 创建 `creative_intent_freeze` AiTask、`local-author` Attempt 与 Input/Context/Constraint Snapshot；
5. Context 的 Provider/token/费用/时长预算均为零，Constraint 禁止 Canon 和 Provider 配置权限；
6. Attempt 记为 succeeded，Task 走完合法状态并提交为 completed。

相同 operation 和 request hash 返回首次结果；同 revision 的不同 payload 失败关闭。Snapshot 任一步写入失败会回滚 Task、Attempt 和全部 Snapshot，不留下半套审计记录。读取只接受同作品、已完成任务，并重新验证协议、语义、statement hash 和 content hash。

## 4. 浏览器开发兼容回退

LocalStorage 按 novel 隔离，并提供：

- r1/r2 不可变版本链与重启读取；
- Web Locks（可用时）或当前上下文作品级串行锁；
- 与桌面相同的 expected revision/hash、确定性 operation 和不同 payload 冲突语义；
- 写入后权威回读，配额失败不误报成功；
- 严格 JSON、revision、parent、operation 和 hash 校验；损坏历史失败关闭，不覆盖为新 r1。

浏览器回退只服务开发兼容，不替代桌面 SQLite 权威来源。

## 5. Hash 与安全边界

- TypeScript 与 Rust 共享 statement/content 固定向量；
- Rust 对 i64/u64 保持精确，不将大整数先压缩为 f64；
- JSON number 遵循 ECMAScript 的 `-0`、`1e-6` 与 `1e+21` 格式边界；
- 对象键按 UTF-16 code unit 排序，与 JavaScript 默认排序一致；
- 大整数防碰撞、指数格式和非 BMP 键均有动态测试；
- 对象密钥名及自由文本中的 API Key、Authorization、Bearer、`sk-` 凭据模式均拒绝持久化；
- 空内容、非法 confidence、缺失推断证据及自洽重算 hash 的语义非法快照均失败关闭。

## 6. 自动化证据

- `npm run test:creative-intent`：3 个文件、20/20 通过；
- Rust 创作意图专项：8/8 通过；
- Vitest 全量：44 个文件、193/193 通过；
- Rust 全量：166/166 通过；
- `npm run test`：Node 正文安全门 5/5 通过；
- migration 专项：前端 2/2 及 Rust migration/全量回归通过；
- AI Task pipeline 与任务中心专项通过；
- `npm run lint`：0 error，保留 1 条既有 React Hook warning；
- `npm run build`、`cargo test`、`npm run tauri build` 通过；MSI 与 NSIS 安装包生成成功；
- 最终格式、编译、仓库工作流、文档同步与 diff 门禁在本报告交付前再次执行。

## 7. 发布态桌面验收

使用 release EXE 和隔离的临时 LOCALAPPDATA/APPDATA 完成真实 Windows WebView 验收，没有读取或修改现有用户作品库。

验收作品：`M3 创作意图验收`。

1. 新增并确认目标“写一部克制而连贯的长篇东方奇幻小说”，冻结为 r1；
2. 关闭并重新启动 release 应用，页面恢复 r1、原内容、作者确认与同一 content hash；
3. 编辑为“写一部克制、连贯且重视代价的长篇东方奇幻小说”，UI 自动回到 pending 并禁用 r2 冻结；
4. 作者重新确认后冻结为 r2；
5. SQLite 中 r1/r2 均保留，r2 的 `parentIntentId` 精确指向 r1 `intentId`，两个确定性 operation 均为 completed；
6. 最终 Task、Attempt、Input/Context/Constraint Snapshot 各 2 条；
7. `world_settings`、`rule_systems`、`characters`、`result_artifacts`、`artifact_placement_proposals`、`artifact_apply_plans`、`artifact_target_links` 在验收前后均为 0。

## 8. 数据、版本与交付边界

- 新增 migration：无；
- 修改历史 migration/checksum：无；
- 最新 migration 继续为 `019_ai_task_archival`；
- Provider 配置与 Worker 状态机：未修改；
- ResultArtifact、PlacementProposal、ApplyPlan、TargetLink、Canon 写入：无；
- `package.json`、`Cargo.toml`、Tauri 配置：继续为 2.2.0；
- 本报告随 M3 本地提交交付，`v2.3.0-M3` tag 指向该提交；不执行 push。

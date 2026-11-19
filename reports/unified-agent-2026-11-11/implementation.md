# 统一 Agent 内核与任务级预授权：实施记录

> 非版本任务；基线版本 3.7.0；2026-11-11 用户明确启动五阶段实施。
> 本文记录本批事实与未完成项，不替代历史验收，也不声称 live 或文学效果通过。

## 1. 冻结的工作区基线

- 实际工作目录：`F:\ai-novel-studio-hotfix-v321`。
- 分支：`feat/tauri-2-migration`；HEAD：`ce4452fb3b2a1c968b4671d4825395c5fce3ae33`。
- npm / Cargo 版本均为 3.7.0；不自动升级版本、依赖或固定 DSH 载体。
- 实施前已有 114 个 tracked 文件修改，另有历史报告、Tauri 2 兼容入口等 untracked 文件；基线共记录 213 个已有变更文件的 SHA-256。
- 开工前的状态、原始工作树补丁和文件哈希清单仅保留在本地，不随源码提交。历史证据未重置、清理或覆盖。
- 必须保留的重叠差异：Tauri 2 插件/IPC/配置/LocalStorage 迁移、provider/model 身份规范化与凭据匹配、模型选择/恢复 UI、总结 advisories 与 semanticValidation 区分、当前工作台布局与输入行为。

## 2. 桌面入口与现有分流

| 入口 | 实施前实际链路 | 收敛要求与边界 |
| --- | --- | --- |
| 创作工作台对话 | `useWorkbenchTaskRunner` → `taskSessionAdapter.startTurn`；API 先 `creative_dialogue`，完成后 renderer 递归启动动作 | 由原生宿主验证工具回执并推进阶段；普通 assistant 文本不执行 |
| 规划/角色/设定/事件候选 | 同一入口选择 DSH structured task；浏览器另有受限预览 | 共享宿主事实与阶段能力；应用仍是独立领域授权 |
| 写章/润色/精确修订 | `selectChapterWriteHost` 在 Writing SubAgent 与 TS Writer 间切换 | 所有桌面模式同一宿主；确定性编译/校验复用为能力 |
| 已应用 Scene-only 计划 | `chapterWriteRoute` 强制进入 deterministic Writer | 计划只作为阶段输入，不更换顶层生命周期 |
| 检查/总结 | DSH 候选；采用后总结与继续创作还有 React effect 驱动 | 移至宿主调度；界面展示和显式命令，不拥有后台循环 |
| 自主规划页面 | 生产路由 `/novels/:novelId/autonomous-planning` → `autonomousStoryService` / scheduler / post-chapter | 不能当作死代码排除；保留功能并适配统一宿主 |
| 写作工作台准备 | `ChapterReadinessPlanCard` → `agentPlanRuntimeService` | 保留计划与人工审阅，作为受控能力而非独立顶层执行 |
| 写作工作台总结 | 正常模式为总结工作流通知与工作台交接；旧生成面板仅兼容性用途 | 保留显式重新总结、启用/禁用、来源及过期展示 |
| 浏览器开发 | LocalStorage 与确定性预览 | 保持受限兼容，不新增真实共享服务，不声称桌面等价 |

入口清单由代码只读核对得到。迁移完成证据与动态测试结果须在后续补入，不以本清单代替验收。

## 3. 模型与契约映射

- 根任务：既有 `TaskConversation.conversationId`。
- 用户目标：既有不可变用户 `ConversationTurn`。
- 运行/阶段执行：既有 `TaskRun`，保留冻结模型、作用域与状态边界。
- 步骤/受控子任务：既有 `ToolCallEvent` 与宿主 execution contract 承载 root/parent/phase/scope/budget 证据；不另建平行 Task 状态表。
- Provider 请求、上下文快照、候选：继续使用 `AiTask / Attempt / Snapshot / ResultArtifact`。
- 正式写入：既有领域事务、`ArtifactDecision` 与新增有限任务授权/幂等回执；新增授权不是第二套运行生命周期。
- 原生 DSH Task Runtime 是唯一桌面宿主；未接入生产的启发式 `mainAgentRuntimeService` 不作为目标内核。
- 现有 `agent_plans` 和 `chapter_workflow_stages` 都是窄领域 schema，不能直接宣称支持所有任务阶段。
- Mock 只适配结构化模型响应；本地模型能力不足明确拒绝，不偷偷换模型/Writer/框架。

## 4. 必须保留的人工行为

1. 正文生成只产生候选；确认进入审阅，作者可编辑保存，采用仍经过原生完整正文/hash/version 校验。
2. 拒绝、精确来源修订、显式重试、字数设置、前章连续性与已应用计划复用均保留。
3. 已过期审阅授权不会静默重签；任务切换不串改导航或未发送内容。
4. 已提交但刷新失败准确报告为提交成功/刷新失败，不错误报告为未写入。
5. 总结保留来源/实际模型、未采用/生成中/待应用/拒绝/失败/应用/禁用/过期状态与明确重新总结动作。
6. 结构与证据校验不等于内容语义正确；普通提醒、语义未核验、具体人工要求与阻断错误分别表达。
7. 自动采用使用 `task_preauthorized` 权威记录，不伪造 `authorReviewed = true` 或人工 `confirm`。

## 5. 安全发现与实施决策

### 总结一致性

静态可构造：有完整 grounding 的总结，仅将人物变更中的姓名改成不存在的人名；`character_error` 导致 `passed=false`，连同语义未核验提醒后评分仍为 76，旧条件仍令 `safeToContext=true`。这是需要动态回归的明确条件，不把尚未运行的测试写成通过。

原生人工总结历史另有 `passed=false / safeToContext=true / authorReviewed=true / semanticValidation=not_checked` 记录，表示不宣称语义证明，不等同阻断错误。修复不得简单对所有历史记录采用 `safeToContext = passed`。原生总结、context bundle、人物状态和 Memory 必须共享资格策略。

### 采用基线

首次消费旧审阅授权的所检查链路未见当前采用指针/章节 revision 与签发基线比较；已消费授权重放则有当前指针检查。现阶段仅报告静态缺口，**不预先认定端到端丢写缺陷**。实施先动态覆盖同章 A/B 授权、先后采用、人工改采、中途编辑与迟到重复回调。

预授权基线必须在原生签发/任务输入冻结，不能以候选发布时重新读取的当前快照代替原始基线；自身写入只凭权威回执推进。

### 授权及恢复

动作分别为规划应用、正文采用、总结应用；作用域为明确作品/任务/章节，创建章节还需明确卷和数量。每次写入同一原子事务复验授权有效性、撤销、有效期、模型、基线、范围、数量和确定性规则。撤销只阻止新写入，已提交回执保真；恢复不复制可执行的活动权限。

## 6. 实施分工与验证计划

- 原生运行时：阶段/子任务、有限根预算、取消、工具门禁、离线模型适配、恢复。
- TS 入口：移除桌面顶层分流、迁移所有生产入口与 UI 内循环，保留浏览器受限路径。
- 原生授权：兼容迁移、签发/查询/撤销、领域同事务应用、采用竞态、备份恢复及 TS IPC 契约。
- 总结与 UI：统一总结策略及回归、任务授权对话框/状态/异步可访问性。
- 父任务集成：归属映射、文档/CHANGELOG、现有页面集成、统一验证及本地 EXE。

禁止真实收费模型、外部搜索、真实用户库/正文测试、提交/推送/PR/tag/发布、DSH 升级及未经评估新依赖。

### 当前实际执行的检查

| 命令 | 结果 | 说明 |
| --- | --- | --- |
| `pwd; git status --short --branch; git diff --stat; git diff --cached --stat` | 完成 | 确认基线；无 staged 差异 |
| `npm run verify:change -- --dry-run`（首次） | FAIL | 既有 `legacy-storage-migration.html` 未声明行为归属 |
| 补齐归属后同一 dry-run | PASS | 218 个变更路径，20 个选定命令；这不是测试通过 |
| `git diff --check` | PASS | 当前差异无 whitespace 错误；有既有 CRLF 提示 |

旧迁移入口现映射到真实 startup 单测、`legacy_local_storage::tests::` 和 `tauri2-migration-regression` 桌面场景；未知范围仍失败关闭。

后续：直接相关行为回归与 lint/types；受影响完整 Rust 领域；隔离 SQLite、真实 Tauri、离线/回环模型；最终适用完整矩阵与 `--no-bundle` 生产 EXE。避免重复执行聚合器已覆盖的测试；不运行会访问真实云模型的 opt-in 项。完整矩阵的安装包步骤需使用明确本地 EXE 模式，不能越权生成发布安装包。

## 7. 状态与未验证事项（11 月 13 日截面）

- 阶段一盘点完成；阶段二～四源码已落地（含 041～043 迁移、Scene/Beat 原生阶段链、原生基线首消费 guard、staged assembly evidence 复验与装配恢复），阶段五完整验收未开始；动态/真实桌面证据待回填。
- R4 live：保持 NOT VERIFIED；文学效果：未验证。
- 本地 release EXE：本批尚未重建，旧产物不能作为本批实现证据。
- Git：未提交、未推送、未创建 PR/tag 或发布。

## 8. 2026-11-13 文档同步的源码核对（不含测试结果）

- 迁移总数为 001～043：041 `task_authorizations`、042 `library_task_scope`（nullable novel identity 安全重建）、043 `host_terminal_native_facts`；001～040 定义/checksum 保持，041/042 已落地定义不改写，本批仅 043 新增 trigger。备份 schema 仍为 13。
- 043 仅重建 `tool_call_events` insert trigger：普通工具事件仍只接受活动 Run；`dsh.*` 原生控制事实可在所属 Run 终态后 append，状态限 `succeeded / failed / cancelled`。
- Scene/Beat 原生阶段链源码已落地：`scene_plan → 每 Scene beat_plan → 每 Beat beat_write/beat_state → scene_close → chapter_assemble`；有隔离 SQLite 单测。真实 Windows Tauri 逐阶段、跨重启仍 `NOT_VERIFIED`。
- `review_authorizations.native_baseline_hash` 首消费 guard 已接入主采用路径 `adopt_review_authorized_draft` 与旧 `consume_review_authorization` IPC，并有隔离 SQLite 回归。
- 人工采用与预授权采用都复验 staged assembly evidence；装配恢复只复用完全匹配候选，并在缺少 `dsh.candidate_admission` 时按同一准入规则补齐。
- 本节只记录源码事实；测试、桌面与 live 的实际命令和结果仍待父任务在本记录中回填，不能据本节宣称通过。

<a id="closeout-20261118"></a>

## 9. 2026-11-18～19 工作区续验（非发布）

**接续范围。** 当前分支仍为 `feat/tauri-2-migration`，HEAD 与本地跟踪的上游均为 `ce4452f`。开工时按文件展开有 269 个已跟踪修改、270 个未跟踪文件，暂存和未合并条目均为零。未跟踪文件不只包含新源码、迁移和回归，还包含历史补丁、索引备份和截图；本次不清理，也不将它们整体加入 Git。机器版本仍为 3.7.0。

**上次停点。** 当日 16:29 的汇总仅覆盖三个桌面规格；其后一次批跑在 UX 规格中留下截图，却没有该批终态。分别通过的规格、11 月 13 日的旧日志与本地目录时间均不作为整套通过。原 release EXE 为 10 月 29 日产物。

**已核对的桌面事实。** `workbench-staged-recovery` 在真实 Windows Tauri、隔离 SQLite、确定性 Mock 下于 `beat_state` 中断；两次进程重启后无启动重放，用户显式重试复用三个已完成阶段，六类阶段均完成且未正式采用正文。该场景不验证所有模型/中断点。此前的授权规格则验证默认一次额度耗尽、回执与采用稿跨重启一致，不足以证明用户实际操作了撤销按钮。

**验证口径。** 新运行日志位于本地 `test-results/closeout-2026-11-18/`（忽略目录）。下面只记录已取得的终态。未调用真实云模型，R4 live 仍为 `NOT_VERIFIED`，不评价文学效果。未升级依赖或 DSH，不签名、不出安装包、不发布。

### 原生授权收尾修复

同一规划候选分别在授权之前、之后到达，原先走两套收尾逻辑：等待期间补签的授权在完成写入后会被留下。隔离 SQLite 用真实候选与回执复现：总额度 2、用掉 1 次，根目标已结束，状态却仍为 `active`（`grant-terminal-red.log`）。现在两条路径共用回执推进逻辑：只有无下一阶段才按会话和根目标收回余额；有后续总结、仍在等待决定或另一个独立目标时不受影响。已核实的人工结构化应用也在根结束时收回余量。既不重写已交付的正文，也不补造人工决定。

| 检查 | 本批结果 |
| --- | --- |
| `npm run dsh:assets` | 固定 DSH commit `47f943859bef60e4160492346772ded9b24f765a`，重建并核对 Gateway SHA-256 `85aa609cd80e02762fdc2df49a1a47d5a8da0ae0abd2cadbdb7712a11233ef5f`，通过解包验证。 |
| `cargo check --locked --manifest-path src-tauri/Cargo.toml` | 通过，有编译警告。另以 `cargo build --locked -p novel-domain-gateway` 准备调试 Gateway。 |
| `cargo test --locked --workspace --manifest-path src-tauri/Cargo.toml -- --test-threads=1` | 修复后 914 通过（主程序 826、Gateway 80、进程集成 7 + 1），0 失败、5 忽略。新增回归验证余量收回、另一个根及后续总结不受影响、已提交回执幂等且只有一条。忽略的外部数据库、真实 API、载体延时等项不计为通过。 |
| `npm run test:docs-sync`、`npm run test:version-sync` | 通过。 |
| `npm run lint:ci`、`npm run test:component-size`、`npm run test:rust-file-size` | 通过。体积门禁包含 788 个前端、252 个原生生产源文件。 |
| `npm run test:bundle-size` | 旧 `dist` 为 E2E 产物，探针检查按预期报错。正式 `tsc + vite build` 后对生产目录重验通过（113 个 chunks）；未删除或放宽探针检查。 |
| `npm run test:coverage` | 退出 0。全量行/语句 61.61%、分支 80.67%、函数 65.24%；核心模块 87.77% / 82.27% / 82.14%。关键组件 11 文件、40 用例，行/语句 90.69%、分支 79.56%、函数 87.50%，七组门槛通过。已包含工作台事件显示及新建任务并发回归；不是桌面或 live 证据。 |
| 真实桌面授权（固定 Mock） | 新构建的 E2E EXE、两个独立作品。一个授权默认用尽 1/1；另一个用掉 1/2 后由作者在工作台点击撤销。SQLite 及重启后的工作台均显示已撤销，既有回执和采用稿保留，没有第二次写入。不是手工改库或用“额度耗尽”代替撤销操作。 |
| `npm run test:e2e` 及同一载体的 `--spec` 续跑 | 29/29 个桌面规格各自取得通过终态，共 47 用例；分别来自 `desktop-final` 11 项、`desktop-continued` 9 项、`desktop-remaining` 8 项、`desktop-directory` 1 项。失败尝试保留，没有一次不间断的全套通过记录。独立 E2E EXE SHA-256 `6160C2B3A814150B11B83BC8980CC55249B74131ABD86E599007EAF8C94238A0`；成功规格无清理错误或遗留隔离库。这不是生产 EXE 上的回环故障矩阵。 |
| 本地生产 EXE | 清除 `CARGO_TARGET_DIR`，按仓库约定准备载体后执行 `npx --no-install tauri build --no-bundle`。仓库内 `src-tauri/target/release/AI Novel Studio.exe`：v3.7.0，38,177,280 字节，2026-11-18 20:51:19（UTC+8），SHA-256 `E9CB26392A7EB8CF9E83213EC722310D63E5BADA242484E96A0F3DA53049E63A`。与旧产物哈希不同；不是带 E2E bridge 的测试载体，未生成安装包。 |

**桌面失败及处置。** 第一次完整运行中，目录规格通过 UI 为分页准备 101 条会话，连问候也进入运行时，八分钟耗尽。保留一次真实新建与命名，用现有备份恢复流程为另一份隔离作品准备 100 行；不加测试 IPC，不提高超时。修复后等待导入成功弹窗正常退出，再操作列表；按最终规格复测通过（35.5 秒），验证了独立作品、跨页定位、搜索选择和进程重启恢复。章节上下文规格另一次在重启期间超过 120 秒；隔离库显示总结已按预期过期，启动日志中一次 Tauri setup 超过 40 秒。相同代码与时限重测通过，两次重启均完成；保留该次失败，不把超时根因归于 SQLite。

### 11 月 19 日：生产 EXE 回环测试

11 月 18 日的回环测试先后卡在过时的模型目录状态、以及首启时 WebDriver 绑定即将关闭的迁移窗口。验收夹具现在要求确切的回环模型身份，并在正式 HTTPS 主窗口可见后才操作；不关闭迁移、不允许其他模型替代。11 月 19 日已进入实际业务。S6 在隔离库中复现纯字数设置一直是 `queued`：合同已写入，但宿主尝试以终态直接插入普通工具事件，被现有 043 触发器拒绝；运行也不能从排队直接进入完成。这是产品本地命令缺陷，不是应调长测试超时的环境问题。

本地字数设置现按 `queued → running → completed` 执行，按正常工具事件生命周期持久化回执；异常结束该运行并保留错误。只给这一回合记录 `ans-local` 身份，不改变任务默认 API 模型。可见回执报告目标及硬区间，不把重复的宿主事实展示为模型调用。原生定向 SQLite 测试先以数据库错误复现旧实现，再运行 4 项通过，覆盖正常终态、默认模型保留、无请求及故障结算。未修改迁移、权限或外部模型配置。

修复后再次执行 `cargo check --locked --manifest-path src-tauri/Cargo.toml` 与串行 Rust workspace 测试：918 通过（830 + 80 + 7 + 1）、0 失败、5 忽略；取代上表 11 月 18 日的 914 项基线。字数设置事件投影与回环用例证据分类的定向 TypeScript 回归共 21 项通过，相关 ESLint、Prettier 与验收 TS 类型检查通过。上表 29 个桌面规格使用 11 月 18 日的隔离测试 EXE；本次字数设置修复另外用最新生产 EXE 的回环场景验证，不将旧产物结果算作新产物复测。

S7 原实现已生成候选，故障规格却把继续等待作者决定的 `waiting_decision` 误当作仍未结束。验收现在分别要求拒收耗尽后 `idle`、修复成功后 `waiting_decision`，之后仍逐项核对修复次数、SQLite 候选、模型身份和未采用。初测取得 6 通过、2 失败（S6、S7）；其中强制终止隔离进程、重启恢复及显式重试通过。失败保留在 `writing-faults-2026-11-19.log`，不纳入最终通过计数。

修复后的生产 EXE 已于 11 月 19 日 12:48:13（UTC+8）通过 `npm run dsh:assets` 和 `npx tauri build --no-bundle` 刷新，取代上表 11 月 18 日的构建。路径仍为 `src-tauri/target/release/AI Novel Studio.exe`，v3.7.0，38,282,752 字节，SHA-256 `5B51FFA911BD8ADE2B0E54FE457772A487D809312BD2842BD08EA7A824612BBE`。最新生产前端包 113 个 JS 分块全部符合 `test:bundle-size`，未嵌入 E2E 探针或生成安装包。

以该指纹的生产 EXE 运行 `npm run test:e2e:writing-faults -- --skip-build --app <生产 EXE>`，8/8 通过，退出 0。S6 确认设置 3200 字时收到 2560～3680 的区间回执，设置回合补全文本请求为零；重新加载后同任务仍选原 API 身份，写章沿用设置，正式章节目标仍为 1000。S7 确认超长候选只修复一次，最后只有一个待审阅候选。证据：`test-results/closeout-2026-11-18/writing-faults-final-2026-11-19.log` 及 `test-results/fault-injection/2026-11-19T04-48-19-255Z/writing-subagent-fault-injection.json`。测试使用隔离本地回环响应，不是云端或文学质量验收。

**交付前 Git 复核。** 当前有 277 个已跟踪修改与 271 个未跟踪文件，暂存区为空，无未合并条目，HEAD 仍为 `ce4452f`；不提交、推送、打 tag 或发布。后续若获准提交，应区分 Tauri 迁移、统一运行时及 SQLite、前端工作台、测试与文档，逐组核对；不要把 87 个未跟踪报告文件里的历史 Git 索引/引用备份、原始工作树补丁、截图和覆盖率快照整体暂存。生产 EXE、测试载体和本次运行日志均在 Git 忽略目录。

这不是干净工作树上的正式发布验收；不因已有未提交修改而重置或提交。仓库中历史的 R4、截图、原始日志和 EXE 证明各自保留原日期与适用范围。

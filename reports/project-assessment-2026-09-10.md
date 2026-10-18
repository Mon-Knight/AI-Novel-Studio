# AI Novel Studio 项目评估报告

> 评估日期：2026-09-10  
> 评估对象：`F:\ai-novel-studio-hotfix-v321`  
> 评估基线：`package.json` / `src-tauri/Cargo.toml` = **v3.7.0**  
> 评估性质：**只读评估**。未修改任何代码或文件，不构成下一版本开发授权。  
> 评估方式：主理人实地勘察 + 架构师（高见远）架构与工程质量评估 + QA 工程师（严过关）测试与验证成熟度评估

---

## 一、TL;DR

这是一个**工程质量远高于同类的桌面端 AI 应用**：生产代码 0 处 `any`、0 处 `console.log`、仅 1 处 TODO，契约漂移门禁、测试归属追踪、体积预算都是真实运行的硬化设施，而非文档宣称。

它的问题不是「乱」，而是**同一份事实被复制到 5～7 个真相源，靠人工 + 测试兜底同步**——这是规模化的天花板。综合评级 **B（B- ～ B）**。

---

## 二、项目概况（已核实事实）

| 维度   | 事实                                                                                                 |
| ---- | -------------------------------------------------------------------------------------------------- |
| 产品形态 | Windows 桌面端 AI 长篇小说创作工程系统（非网页后台、非一次性生成整本小说）                                                        |
| 技术栈  | Tauri 1.x + Rust / React 18 + TS 5 + Vite 5 / Zustand 5 / HashRouter 6 / SQLite                    |
| 代码规模 | `src/` 854 个 ts·tsx ≈ **18.96 万行**；`src-tauri/src/` 126 个 rs ≈ **9.29 万行**                         |
| 测试规模 | 230 个测试文件；`test-ownership` 实测 **202 existing / 68 discovered / 34 E2E·opt-in**                     |
| 文档规模 | 113 个 md（2.1MB），含权威缺口清单与带日期审计快照                                                                    |
| 数据层  | SQLite migration 已到 **038**；备份 schema 11                                                           |
| 活跃度  | 近 30 天 51 次提交；近 200 次中 feat 78 / fix 68（≈1:1，功能与修复并重）                                              |
| 仓库卫生 | `.git` 160MB；`dist / coverage / test-results / release_output* / node_modules / target` **均已正确忽略** |



---

## 三、评分卡

| 维度       | 评级     | 一句话依据                                                  |
| -------- | ------ | ------------------------------------------------------ |
| 代码纪律     | **A**  | 生产代码 `any` 0、`console.log` 0、`eslint-disable` 3、TODO 1 |
| 分层与模块边界  | **B**  | store/features 边界真实成立；pages/components 存在系统性越界         |
| 跨语言契约一致性 | **C**  | canonical 名/SQL/命令名在 5～7 处并行人肉同步                       |
| 技术债成本    | **C**  | 超大文件集中于 Rust 与工作台编排，拆分风险高                              |
| 测试保护强度   | **B**  | *230 测试文件 + ownership 追踪；热点模块保护偏弱*                     |
| 验证成熟度    | **B**  | 多层金字塔扎实、证据分级诚实；live 云端未证、opt-in 验收不进 CI                |
| 文档成熟度    | **A-** | 索引/权威边界/口径校正清晰；存量长文与实现存在漂移                             |
| 发布与流程    | **B+** | tag 触发的签名发布 + 前置全矩阵；PR 门禁偏轻                            |
| **综合**   | **B**  | 优秀工程底子 + 系统性同步债务                                       |

---

## 四、工程强项（值得保持的资产）

1. **契约漂移门禁是真实存在的**。`contracts/agent/canonical-tool-manifest.v1.json` 为 TS 与 Rust 共享 artifact（`canonicalToolManifest.ts` 与 `dsh/canonical_manifest.rs:20` 经 `include_str!` 同源），TS 侧校验 hash + Catalog/bindings/IDS 漂移，Node 侧 `canonical-tool-manifest-contract.test.mjs:49-102` 独立复核 hash。
2. **测试归属与变更选择器闭合**。`test-ownership.mjs:36-156` 拦截孤儿测试/未知 runner/重复归属；`verification-scopes.mjs` + `verify-change.mjs:123-126` 做「变更 → 行为归属」，未映射路径或零用例成功一律记 FAIL。
3. **文档事实块与代码交叉校验**。`check-capability-docs.mjs:5-106` 对 5 份文档事实块 ↔ Manifest ↔ Rust allowlist 做交叉校验（含负向样本），能拦截虚假「live VERIFIED」声明。
4. **失败关闭与安全底线落到实处**。`AGENTS.md` §4 的「正式写入保留 revision/CAS/事务/幂等，冲突必须失败关闭」在 Rust 侧有对应实现（`structured_artifact_apply_service.rs` 等）。
5. **证据脱敏做得好**。`scripts/e2e/artifact-sanitizer.ts:1-45` 只放行 sha256 哈希与 `adoptedContent`，其余 key/token/路径/prompt 全 REDACTED。
6. **可重现性被认真对待**。新增 `rust-toolchain.toml` 钉定 `channel = "1.95.0"`，避免本地与 CI 落到不同 stable 快照。

---

## 五、主要风险与债务（按严重度）

| #       | 风险                              | 证据                                                                                                                                        | 触发条件                            | 建议动作                              |
| ------- | ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- | --------------------------------- |
| **R1**  | Gateway 与主仓储 **SQL 语义漂移**       | `gateway/src/tools.rs:1-13` 代码自述「mirror the app's Rust schema… v3.2 should extract a shared read-only crate to remove the SQL drift risk」 | 被读取的表结构变更                       | 抽 **read-only 共享 crate**，消除复刻     |
| **R2**  | **命令名无编译期契约**                   | 实测 TS 侧 **167 个**命令字符串字面量 vs Rust **33 个** `#[tauri::command]` 模块；无 bindings 生成、无漂移门禁                                                     | 重命名/删除任一命令                      | 生成式 bindings 或清单门禁                |
| **R3**  | `generate_*` 语义与实现相反            | `task_runtime.rs:47-50,56`；GAP-02                                                                                                         | 误判为「直接写章」                       | 语义重命名 + 兼容别名                      |
| **R4**  | **R4 live 云端只读验收 NOT VERIFIED** | `feature-gap-analysis-v3.7.0.md` §4/§5                                                                                                    | 把 Mock/loopback 说成已验收           | 授权后做脱敏 live 验收                    |
| **R5**  | 真实验收不进 CI                       | `package.json` 中 `test:real-profile:*` / `test:fault-injection:*` 均 opt-in，任何 CI 都不跑                                                      | Writing SubAgent 最高风险新路径回归只能靠人工 | 把 fault-injection（回环、零网络）加入定时 job |
| **R6**  | 大文件回归面                          | `project_backup.rs` 5157 行、`structured_artifact_apply_service.rs` 4936 行、`useWorkbenchTaskRunner.ts` 1834 行、`qualityFixService.ts` 1418 行 | 改备份/应用/编排                       | 分层抽离 + 契约测试，按风险排序                 |
| **R7**  | Mock 进入生产依赖图                    | `aiClient.ts` → `mockAiClient.ts`（1246 行）                                                                                                 | 包体膨胀 / 误用                       | tree-shake 隔离出包                   |
| **R8**  | PR 门禁偏轻                         | `ci.yml` PR 仅 frontend lane；Rust 全量仅在 `FULL_MATRIX`（`windows-desktop-e2e.yml:173`）跑；PR 无覆盖率门禁                                             | 共享 Rust 模块回归可溜进 main            | 补定时全量 + PR 覆盖率门禁                  |
| **R9**  | GAP-17 Rust 并发时序敏感              | `feature-gap-analysis-v3.7.0.md` §4                                                                                                       | 完整 Rust 套件并发运行                  | 消除 DSH restart 测试时序依赖             |
| **R10** | 覆盖率地板偏低                         | 全局 lines/statements 34、functions 44、branches 64；仅 **8 个模块**享 85 门槛                                                                        | 约 2/3 代码可无测试通过                  | 单调提高阈值并纳入 PR                      |

### 边界说明（不宣称）

- 不宣称 R4 VERIFIED；不宣称全部生产写章都走 DSH（mock/本地/浏览器仍走确定性 Writer）。
- R2 的「167 vs 33」证明的是**缺少自动门禁**，逐条映射未比对，属推断级结论。
- 桌面 E2E 是否阻塞合并取决于平台分支保护，仓内无法取证。

---

## 六、分层与边界的真实情况

**真实成立**（抽查无违规）：

- `src/store/*` 无副作用——`themeStore.ts:60-79` 把 localStorage/matchMedia 下沉到 `services/theme/themeRuntimeService`；store 目录全局无 fetch/invoke/setTimeout/localStorage 命中。
- `src/pages/*` 无直连原生——`invoke(` / `@tauri-apps/api` / `fetch(` 零命中。
- `src/features/*` 边界干净，仅 `useWorkspaceChapterLoader.ts:62,404` 使用 window 计时器（合理）。

**真实越界**（集中在 Workbench 栈）：

- `pages/Workbench/hooks/useWorkbenchTaskRunner.ts`（1834 行）导入 **17 个 services**，承担 sendMessage(:572) / generateMissingAsset(:910) / resumeChapterGoal(:1163) / reconcilePersistedAssetOrchestration(:1280)，违反 `AGENTS.md` §5「pages 不放复杂业务编排」。
- **33 个组件**引用 `services/ai`、**23 个**引用 `services/database`；其中 **3 个组件直接构造 AI 客户端**：`components/outline/OutlineEditor.tsx:13,14`、`right-dock/panels/AiGeneratePanel.tsx:4,9`、`settings/AiGatewaySettingsCard.tsx`。

**判定**：属**系统性倾向**而非个别 legacy（约 20% 组件、6% 页面），但重越界高度集中在工作台栈，收敛点明确。

---

## 七、技术债 Top 5（真实成本）

| 文件                                                            | 行数   | 职责           | 建议       | 风险/收益                             |
| ------------------------------------------------------------- | ---- | ------------ | -------- | --------------------------------- |
| `src-tauri/src/project_backup.rs`                             | 5157 | 备份/恢复        | 应拆       | 收益大；涉数据安全需完整回归                    |
| `src/pages/Workbench/hooks/useWorkbenchTaskRunner.ts`         | 1834 | 回合总编排（17 服务） | 应拆       | 可测性↑；闭包耦合易回归                      |
| `src-tauri/src/services/structured_artifact_apply_service.rs` | 4936 | 产物应用/事务/CAS  | **谨慎拆**  | 涉失败关闭，拆错 = 数据风险                   |
| `src/services/ai/mockAiClient.ts`                             | 1246 | Mock 客户端     | 隔离出生产依赖图 | 包体↓，低风险                           |
| `src/services/ai/qualityFixService.ts`                        | 1418 | 质量修复工作流      | 应拆       | 被 `CheckPanel.tsx` 组件直引，边界 + 体积双债 |

补充：`migrations.rs`(4546) / `conversation_repository.rs`(4693) / `task_runtime.rs`(4311) / `commands.rs`(3789) 同属超大文件，其中 `task_runtime.rs` 是 DSH 时序核心，拆分化风险高，不建议优先动。

---

## 八、改进优先级（评估建议，非授权任务）

| 优先级    | 动作                                            | 预期收益         | 代价         |
| ------ | --------------------------------------------- | ------------ | ---------- |
| **P0** | 抽 read-only 共享 crate，消除 Gateway SQL 复刻（R1）    | 消除最脆弱的漂移点    | 中：需读语义回归   |
| **P0** | 明确 R4 live 验收口径并（获授权后）执行脱敏 live 验收（R4）        | 消除最大「宣称风险」   | 中：需真实凭据与预算 |
| **P1** | 命令名/契约名生成式或清单门禁（R2/R3）                        | 编译期拦截跨语言漂移   | 中：一次性脚手架   |
| **P1** | 拆分 `useWorkbenchTaskRunner`，编排下沉 features（R6） | 可测性↑，边界回归    | 中：闭包重接线    |
| **P1** | fault-injection 回环验收加入定时 CI（R5）               | 最高风险路径获得自动回归 | 低：已有载体     |
| **P2** | `mockAiClient` 移出生产依赖图（R7）                    | 包体↓          | 低          |
| **P2** | 双命名空间收敛 + `generate_*` 重命名（R3）                | 认知负担↓        | 中：需兼容迁移    |
| **P2** | 覆盖率地板单调提高并纳入 PR（R10）                          | 回归保护↑        | 低          |

---

## 九、工作树与流程状态（主理人勘察）

| 项      | 状态                              | 说明                                                                              |
| ------ | ------------------------------- | ------------------------------------------------------------------------------- |
| 当前分支   | `codex/v3.7.0-writing-subagent` | **领先远端 8 个提交**，未推送                                                              |
| 未提交改动  | **23 个文件，+1000 / -256**         | 在途能力：设置页「API 模型按来源分组」                                                           |
| 未跟踪新文件 | **6 个**                         | 含 `cloudModelCatalog.ts`、`savedApiSources.ts` 及对应测试                             |
| 本地分支   | **20 个**                        | 含 `archive/workbuddy-v3.6.2-broken-lineage`、`backup/v2.12-autonomous-wip` 等历史分支 |

**评价**：`.gitignore` 纪律良好，无产物误提交。主要流程风险是**未收口的工作树**——存在未提交改动与未推送提交叠加，建议在进入下一阶段前先收敛为干净的提交状态，避免与后续变更交织。

---

## 十、结论

**综合评级：B（B- ～ B）——优秀工程底子，系统性同步债务。**

这个项目在**工程纪律、契约治理、测试归属、证据分级**上做到了多数商业项目做不到的程度，属于「知道自己要什么」的仓库。它下一阶段的天花板不在于功能，而在于**收敛并行真相源**：Gateway SQL 复刻、命令名无编译期契约、`generate_*` 语义反转这三条是同一根病根，吃掉它们能显著降低变更影响面。

同时必须守住一条口径底线：**R4 live 云端仍未验收，不得以 Mock / loopback 结果替代**。

---

*本报告为只读评估结论，不代表任何已授权的开发任务。*

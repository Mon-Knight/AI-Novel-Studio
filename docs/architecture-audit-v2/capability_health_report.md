# AI Novel Studio 能力整合版 Health Report

## 1. 总体健康

| 项目                                          | 数量/判断 |
| --------------------------------------------- | --------: |
| 独立能力族                                    |        75 |
| WORKING                                       |        21 |
| PARTIAL                                       |        37 |
| BROKEN                                        |         3 |
| LEGACY                                        |        11 |
| UNKNOWN                                       |         3 |
| 宏观重复/重叠组                               |        14 |
| 具体冲突簇                                    |        16 |
| 可直接归并的具体簇                            |        13 |
| 不应强行合并、只需边界治理的具体簇            |         3 |
| Agent 当前可见 canonical 核心动作（目标设计） |        18 |

严格可用数仍是 **21**。整合计划不会把 PARTIAL 自动升级为 WORKING；它只减少重复入口和事实源。

## 2. 整合前后的风险变化

| 风险        | 整合前表现                                                                  | 归并后的目标                                                                   |
| ----------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| 正文生成    | 多个 writer、scene pipeline、旧 Agent tool、autonomous runtime              | 一个 `WritingCapability`，内部可有执行算法，外部只有 generate/continue/rewrite |
| 大纲        | 多个 UI/直接写入/候选 validator                                             | 一个 `StructureCapability`，AI 只提案，ownership/CAS 统一                      |
| 总结/上下文 | summary panel、workspace hook、volume summary、compression、context records | 一个 `ContextCapability`，事实和候选分开                                       |
| 质量        | report、gate、fix、旧 Agent judge 多套状态                                  | 一个 `QualityCapability`，report/gate/fix 明确子动作                           |
| 记忆        | SQLite、Map、LocalStorage、scene memory                                     | SQLite 唯一生产真相，fallback 明示 dev-only                                    |
| 应用写入    | Artifact、Placement、Content Transaction 各自叫 apply                       | 统一 proposal/authorization envelope，领域事务不混合                           |
| Registry    | TS 18、DSH 11、gateway 14                                                   | 一个 manifest，生成三种投影并做 drift gate                                     |
| 状态        | Zustand、URL、conversation DB、recovery、panel output 并存                  | durable facts / UI projections / recovery facts ownership matrix               |

## 3. WORKING 能力的可信边界

当前有真实动态证据的能力主要集中在：

- 作品/卷章基础创建读取与跨作品隔离。
- 草稿历史、CAS 原子保存、采用、授权消费。
- 编辑器正文与重启恢复、大文本完整性。
- Workbench 会话/Run/Artifact/Card/Decision 持久化。
- 完整项目备份 round-trip 和篡改拒绝。
- SQLite memory 词法检索及采用后失效。
- 确定性 readiness plan、context compression、AI request governance。

这些能力适合作为 Domain Capability 的底座，但仍需在 facade 迁移后重新跑入口级回归。

## 4. PARTIAL 的主要原因

### 外部依赖未验证（审计初始判断，已由第 10 节修正）

审计初始快照时，真实 Provider、真实 DSH 主 Agent、风格分析、AI 大纲/质量/总结等都没有外部模型证据；E2E 默认 mock，真实 API 测试显式 ignored。随后本轮补充的 `npm run test:dsh:real` 已验证固定 DSH preparation 的真实 Provider 工具调用和 Proposal schema，但不改变章节写作、完整 DSH Main Agent、风格分析、AI 大纲/质量/总结仍为 PARTIAL/UNKNOWN 的判断。

### 生产入口不完整

角色事件面板、生成/工程/检查旧面板在生产环境不可见；服务存在不能提升健康级别。

### 语义覆盖小于名称

泛化 content transaction、placement apply、artifact apply 实际支持的 target/type 小于名称暗示的全量能力。整合后必须按动作和 artifact type 拆开。

### 非事务或双存储

TXT 导入逐条写入；模板、设定建议、polish、AI 设置等存在 LocalStorage/SQLite 双轨。它们不能被无条件开放给 Agent。

## 5. BROKEN 与 LEGACY 对整合的影响

### BROKEN（必须先处理）

1. 桌面作品删除只软删除 `novels` 主记录，却显示级联不可恢复文案。
2. 数据库修复按钮只修 LocalStorage，不触达 SQLite。
3. 资产中心导入资产计数硬编码为 0。

这些入口在修复前不能被 facade 包装成“可靠能力”。

### LEGACY（必须隔离）

- 旧 Agent Harness/AgentToolRegistry/MemoryManager。
- E2E-only right-dock AI panels。
- Autonomous Planning、Multi-Agent、旧 Outline route、AI task records page。
- LocalStorage formal-fact mirrors。

整合不是立即删除；但新 Domain Capability、Tool manifest 和 Agent prompt 都不得引用这些旧名。

### 整合阻断风险（不改变上面的 3 个 BROKEN 基线）

反向扫描还发现几条会让“看起来成功”的 Agent 操作失去事实一致性的路径。它们的能力健康状态仍记为 `PARTIAL`，但在整合门禁中标记为 `BLOCKED`；不能因为已有单元测试就升级为 `WORKING`：

1. **Outline active/version**：artifact apply 保存新版本后不一定激活，而 `chapter.read_outline` 的 DSH 读取只看 active row；必须先统一 `structure.read` 的 version/active/revision 契约。
2. **Summary/context bundle**：人工总结通过 `chapterContextPersistenceService` 原子保存 summary、context records 和 character states；Workbench artifact apply 只写 summary，并在无来源草稿时使用 `workbench-unadopted`。SQLite 外键和 current-adopted ownership 校验可能拒绝该写入，故该 Apply 路径不能作为稳定能力。
3. **Draft facts**：SQLite canonical draft、LocalStorage draft 和内存 revision 并存。若旧写路径继续双写，重启或跨作品切换会产生不同正文事实；迁移前 Agent 只能读取 canonical adapter。
4. **Registry/decision drift**：TS、Rust、DSH 和 legacy registry 的集合/语义仍不完全一致，且 Main Agent 仍有固定 orchestration 与 heuristic fallback。固定 DSH preparation 已有真实工具调用证据，但当前没有足够证据证明完整 Workbench 的 LLM 自主选 Tool。
5. **Context/character/task source drift**：多套 context compiler、角色事实表和 AI task ledger 需要 source revision、taskId/traceId 映射后，才能进入 facade 稳定面。

## 6. 验证证据与门禁

本轮审计复用并复核以下证据：

| 证据                      | 结果                               | 健康含义                                                    |
| ------------------------- | ---------------------------------- | ----------------------------------------------------------- |
| `npm run test:workbench`  | PASS（47）                         | Workbench fallback/Artifact 协议行为                        |
| 项目备份 Rust runtime     | PASS（15）                         | 完整备份/恢复和篡改拒绝                                     |
| AI task delete runtime    | PASS（3）                          | 旧事实清理边界                                              |
| workspace recovery suite  | PASS                               | 恢复快照和 SQLite 约束                                      |
| isolated DSH restart test | PASS                               | 时序失败并非稳定产品失败，但存在 flaky 风险                 |
| Windows closed-loop E2E   | PASS（5 轮、2 作品、重启）         | 数据/Artifact/审阅/CAS 闭环                                 |
| `npm run test:dsh:real`   | PASS（真实 Provider，本次 3 请求） | 固定 DSH preparation 的工具调用、Proposal schema 与凭据隔离 |

不能用这些结果证明：外部模型生成质量、完整 Workbench 的 LLM 自主 Tool selection、独立 SubAgent、完整 Registry；`test:dsh:real` 只证明固定 DSH preparation 的局部真实链路。

## 7. 整合后的健康门禁

每个 canonical facade 在升级为 WORKING 前必须有：

1. 至少一个真实生产入口。
2. 单一 durable source。
3. 入口到 DB/Model 的完整 trace。
4. 跨作品/跨章节 ownership 负例。
5. 重启、重试、CAS 或幂等验证。
6. 对外 schema 与权限/确认策略。
7. 旧实现调用者迁移清单。

只有 `WORKING` facade 才能进入下一阶段 Agent allowlist；PARTIAL 只能作为受限 fallback 或实验能力。

## 8. 当前阶段结论

当前阶段应重分类为 **Phase 0.5 — Model / Provider Infrastructure Verified**：SQLite/Artifact/审阅授权/CAS/重启基础设施和固定 DSH Provider 有真实证据，但完整 `Workbench → Main Agent → Tool Registry → Writing SubAgent` 闭环尚未验证。更重要的是，业务能力还没有先完成唯一事实源和 Capability facade 资产化。因此 Main Agent Tool projection、Writing SubAgent 与 Context Agent 的放行结论均为 **NOT READY**；下一步是 Phase 1A-A 能力资产化，而不是直接做真实 Agent Runtime 验证。

## 9. 本轮修复进度

上面的 3 个 `BROKEN` 是审计时的历史基线；本轮已提交实现修复，但在完成真实 Windows/Tauri 入口回归前，不把基线数字直接改成 `WORKING`：

| 入口/风险              | 当前实现                                                                                             | 已有证据                                  | 尚未宣称                                               |
| ---------------------- | ---------------------------------------------------------------------------------------------------- | ----------------------------------------- | ------------------------------------------------------ |
| 作品级联删除           | 新增 SQLite 事务级 `delete_novel_cascade`，复用项目清理顺序                                          | Rust `project_service` cascade test PASS  | 真实桌面进程重启后的全表计数 E2E                       |
| 数据诊断/修复          | 桌面端规范化 `novels` 基础 JSON/时间字段并执行 SQLite 完整性检查；浏览器仍保留 LocalStorage fallback | Rust repair test PASS、`cargo check` PASS | “修复全部 90 张表”的能力；当前只修复确定性作品基础字段 |
| 资产中心计数           | 改为读取 `importedAssetService.getAll(novelId)`                                                      | TypeScript build/lint PASS                | 导入资产创建入口；该能力仍为 `PARTIAL`                 |
| Summary apply          | 缺少 adopted draft 或来源错配时 fail-closed                                                          | `artifactApply.test.ts` PASS              | 完整 context/character bundle 的候选字段自动抽取       |
| Outline active/version | 激活目标校验、卷/章作用域事务、候选采用后显式激活；修正 DTO 时间列索引                               | Rust outline scope test PASS              | 真实 DSH 写后读 E2E                                    |

因此当前仍不能放行 Context Agent；剩余工作先是 Capability Catalog/facade、入口级桌面回归和事实源治理，之后才是统一 Registry 与 `chapter_write`/Writing SubAgent 的真实模型 smoke，而不是继续增加新的 Agent 能力。

## 10. 真实模型 smoke 后的状态修正

2026-08-24 已通过固定 DSH payload 执行真实 Provider smoke（详见 [`docs/audit-v2/real_model_validation.md`](../audit-v2/real_model_validation.md)）：本次真实模型完成 3 次请求、只读工具调用和 `ChapterPreparationProposal` schema 校验（模型修复回合可能使请求数在 3–4 次之间变化）。该证据将 DSH preparation 能力从 `UNKNOWN` 收敛为“真实 Provider 已验证的 PARTIAL/受限能力”。

它不升级以下能力：Workbench `chapter_write` 的 DSH 自主编排、Local/Gateway 设置自动接入 DSH、统一 Tool Registry、独立 Writing SubAgent 或 Context Agent。默认 Windows E2E 仍是 Mock + 外网阻断；本地模型只能通过显式 `DSH_E2E_BASE_URL` / `DSH_E2E_MODEL` smoke profile 暂时复用同一协议。

## 11. Phase 1A-A 能力资产化准入

Phase 1A-A 只登记和整理真实能力，不启动 Main Agent，也不改变 DSH/Workbench 路由。只读资产目录见 [`capability_registry_v1.md`](./capability_registry_v1.md)，可复制任务书见 [`phase1a_capability_assetization_taskbook.md`](../audit-v2/phase1a_capability_assetization_taskbook.md)。

必须先满足：

1. 75 个审计能力族都有 canonical domain 归属、健康状态、入口/调用链和事实源引用。
2. 18 个目标 action 只存在于 `catalog_only` 资产目录；TS、Rust、DSH 三份旧清单的差异继续被记录，不互相覆盖。
3. `novel.read`、`structure.read`、`memory.search` 至少完成薄 facade 的 ownership、DTO、来源 hash 和跨作品负例设计；PARTIAL/BROKEN/LEGACY/UNKNOWN 不得进入 stable Tool。
4. `writing.*`、`context.propose_*`、`quality.review` 只登记为 SubAgent 候选；`artifact.*` 保持宿主确认/CAS 协议。
5. Catalog 静态测试通过且 `listAgentExposedCapabilities()` 为空。

Phase 1A-A 通过后，才另立 Phase 1A-B（canonical Tool Registry 投影与真实 Runtime 验证）；之后才评估 Phase 1B Writing SubAgent。

## 12. 已有 Tool 的工作性门禁

本轮新增 `src/services/agent-tools/productionToolRuntime.test.ts`，在隔离浏览器存储 fixture 中实际调用现有生产 handler，覆盖：

- `novel.read_context` 的作品事实读取；
- `chapter.read_outline` 的章节/卷/草稿读取与跨作品 fail-closed；
- `search_memory` 的作品 scope 与本地记忆结果；
- Tool Registry 缺少 authoritative scope 时的前置拒绝。

因此这些 handler 有“可执行证据”，但不自动升级为 stable Agent Tool：`novel.read`、`structure.read`、`memory.search` 仍因多事实源、版本/混合检索等整体阻断保持 `PARTIAL + catalog_only`。候选 validator 测试只证明 schema 校验，不证明正文生成；`artifact.*` 仍是宿主确认协议。

## 13. Phase 1A-B Domain Facade 收口（最新状态）

2026-08-24 已完成五个薄层 Domain Facade 的第一版实现和真实浏览器生产链验证：

```text
ProjectCapability
ContextCapability
WritingCapability（candidate-only adapter）
ConversationCapability（internal runtime projection）
ArtifactCapability（user authorization / CAS host protocol）
```

本次浏览器验证共 6/6 定向测试通过，覆盖公开 DTO、来源标识、hash 稳定性、跨作品 fail-closed、损坏关系、候选审阅授权、重复采用阻断和存储重启读回；结果明确标记 `localstorage / browser_fallback`。另有真实 Windows Tauri SQLite E2E 1/1 通过，覆盖 Facade 读链、候选→授权→CAS、重放冲突和 WebView 重载读回。

因此阶段路线修正为：

```text
Phase 0.5 DSH真实模型基础设施         VERIFIED
Phase 1A-A Capability Catalog         VERIFIED
Phase 1A-B Domain Facade              VERIFIED (BROWSER + SQLITE E2E)
Phase 1A-C Canonical Tool Projection  NOT STARTED
Phase 1B Main Agent                   NOT RELEASED
Phase 1C Writing SubAgent             NOT RELEASED
```

本阶段没有把任何 catalog 条目升级为 `stable`，没有把 Facade 接入 Main Agent，也没有宣称章节写作真实模型闭环完成。详情见 [`domain_facade_validation.md`](./domain_facade_validation.md)。

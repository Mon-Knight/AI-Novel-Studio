# Capability Catalog v1（能力资产化登记）

## 1. 这是什么

`src/services/capabilities/capabilityCatalog.ts` 是能力资产目录，不是可执行 Tool Registry。它把审计得到的用户能力压缩成稳定的 canonical action 视图，同时保留健康、调用链、事实源和迁移阻断信息。

```text
75 个审计能力族（事实清单）
        ↓ 归并
18 个 canonical action（资产目录）
        ↓ 通过 facade / evidence gate 后才允许
ToolDescriptor / SubAgent adapter / Host protocol projection
```

本版本所有条目的 `exposure` 都是 `catalog_only`，因此不会进入：

- `productionToolRegistry` 的可执行 handler；
- Rust Gateway `tools/list` 或 DSH allowlist；
- Main Agent prompt；
- Workbench 的模型可见能力投影。

Phase 1A-C 已为其中四个只读 Facade 建立独立的内部 descriptor/adapter/hash 投影，但没有改变上述 exposure 门禁。详见 [`canonical_tool_projection.md`](./canonical_tool_projection.md)。

## 2. 与旧 Registry 的边界

现有 `productionToolRegistry` 是“已经可执行的参数/权限/副作用契约”，只能描述有 handler 的动作；它不能承载 BROKEN、LEGACY、UNKNOWN 和 PARTIAL 能力的审计事实。`WORKBENCH_TOOLS`、Rust `ALLOWED_TOOLS` 和 Gateway 工具列表仍作为 drift 证据保留，暂不互相覆盖。

能力资产化期间，依赖关系固定为：

```text
UI / Hook
  → 现有 Domain Service / Tauri Command / Repository
  → Capability Facade（首批已完成）
  → Capability Catalog（本文件与 TS 资产）
  → Canonical Tool 内部 projection（首批 4 项已完成，仍 catalog-only）
  → 模型 Tool / SubAgent projection（后续 G2/G3）
```

Catalog 只声明和审计，不执行数据库操作，也不拥有新的事实源。

## 3. v1 资产字段

每项 `CapabilityDefinition` 都必须提供：

| 字段                            | 约束                                                   |
| ------------------------------- | ------------------------------------------------------ |
| `id/version`                    | canonical `domain.action`，版本固定为 `1`              |
| `kind`                          | `tool`、`subagent` 或 `host_protocol`                  |
| `evidence.health`               | 只记录已审计的 `working/partial/broken/legacy/unknown` |
| `evidence.callChain`            | 至少包含入口、服务和持久化/运行时边界                  |
| `evidence.sourceOfTruth`        | 明确 SQLite、运行时事实或兼容来源                      |
| `legacyAliases`                 | 只用于迁移兼容，不得进入模型名称                       |
| `sideEffect/confirmationPolicy` | 与实际宿主事务一致；写操作必须用户确认                 |
| `exposure`                      | 本阶段固定 `catalog_only`                              |
| `blockers/references`           | 没有证据或存在阻断时不可晋级                           |

健康状态与 Agent 暴露状态是两个不同维度：`WORKING` 也不自动等于 `stable`，只有通过后续 facade、ownership、重启和负例门禁才可投影。

## 4. 首批 canonical action

当前资产目录登记 18 个动作：

```text
novel.read
structure.read
draft.read
context.read
memory.search
characters.read
story_assets.read
reference.read
style.read
transfer.export
writing.generate
writing.continue
writing.rewrite
structure.propose_outline
context.propose_summary
quality.review
artifact.review
artifact.apply_approved
```

这不是最终 Agent allowlist。`writing.*`、`structure.propose_outline`、`context.propose_summary` 和 `quality.review` 当前只代表 SubAgent 候选契约；`artifact.*` 是宿主审阅协议；`transfer.export` 需要文件选择与权限确认。

## 5. G1 facade 顺序

先从低风险只读能力建立薄 facade，不迁移 UI，不切换 Agent：

1. `novel.read`
2. `structure.read`
3. `memory.search`

每个 facade 需补齐：显式作品/章节 ownership、稳定 DTO、source/revision/hash、跨作品负例、重启读回和失败收敛。`draft.read`、`context.read`、角色/资产/风格/参考资料在事实源治理完成前保持 `catalog_only`。

## 6. 机器校验

```powershell
npx tsx --test src/services/capabilities/capabilityCatalog.test.ts
npx tsx --test src/services/agent-tools/productionToolRuntime.test.ts
```

校验内容：

- canonical ID 无重复；
- 每项都有调用链、实现入口、事实源和审计引用；
- `writing.generate` 等候选能力仍为 `partial + catalog_only`；
- `artifact.apply_approved` 保留 `write + user_required`；
- 当前 `listAgentExposedCapabilities()` 必须为空。

生产 Tool 的工作性证据由 `productionToolRuntime.test.ts` 提供；catalog 测试本身只验证资产完整性，不能替代 handler 运行。候选 validator 的通过只表示输入/输出 schema 合法，不表示模型生成或正式写入已经完成。

任何条目从 `catalog_only` 晋级，都必须另有迁移任务、动态证据和 manifest drift gate；不得直接编辑该选择器绕过准入。

## 7. Phase 1A-B Facade 状态（2026-08-24）

薄层 Domain Facade 已建立，但仍保持 `catalog_only`：

| 领域         | Facade                                                                           | 动态证据                                                                    |
| ------------ | -------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Project      | `projectCapability.readCurrentProject` / `readChapterPosition`                   | `domainFacade.test.ts` 浏览器链 + `domain-facade-sqlite.spec.ts` SQLite E2E |
| Context      | `contextCapability.readCurrentStoryContext` / `searchMemory`                     | 浏览器链 + SQLite 故事上下文 E2E；混合检索仍受限                            |
| Writing      | `writingCapability.generateCandidate` / `continueCandidate` / `rewriteCandidate` | 输入、快照、candidate-only 边界；真实外部模型未晋级                         |
| Conversation | `conversationCapability.listTaskSummaries` / `readRuntimeSnapshot`               | 运行事实 DTO 过滤                                                           |
| Artifact     | `artifactCapability.publishCandidate` / `requestReview` / `applyAuthorizedDraft` | 浏览器与 SQLite 候选→用户授权→CAS；重放冲突 PASS                            |

完整设计、映射和验证边界见：

- [`domain_facade_design.md`](./domain_facade_design.md)
- [`domain_capability_mapping.md`](./domain_capability_mapping.md)
- [`domain_facade_validation.md`](./domain_facade_validation.md)

Facade 路径不会自动改变 `listAgentExposedCapabilities()`；Canonical Tool Projection、Main Agent 和 Writing SubAgent 仍未放行。

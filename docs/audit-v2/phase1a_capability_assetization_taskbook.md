# AI Novel Studio Phase 1A：能力资产化实施任务书

版本：v3.6.0 / Phase 1A-A（Capability Assetization）  
状态：**当前执行阶段**  
前置阶段：`Phase 0.5 — Model / Provider Infrastructure Verified`

## 1. 阶段定位

当前已验证的是 DSH Provider、真实模型请求和 Tool Calling 协议；已有部分 Harness/Workbench 框架，但软件业务能力尚未形成可靠的、单一来源的 Capability Registry。因此本阶段不验收 Main Agent，也不接入 Writing SubAgent。

本阶段要把“页面和旧 Service 中散落的功能”整理成可审计的能力资产：

```text
真实用户入口
  ↓
Domain Capability（能力事实与唯一执行者）
  ↓
Capability Catalog（声明、健康、调用链、事实源、迁移信息）
  ↓  [通过 gate 后]
Tool/SubAgent Adapter
  ↓
Main Agent
```

`Capability Catalog` 与可执行 `Tool Registry` 必须分开。登记一项能力不等于模型可以调用它。

## 2. 本阶段目标

1. 重新从 UI、Hook、Service、Tauri command、Repository、SQLite 表和模型调用反查能力。
2. 给每项能力分配稳定 canonical ID、版本、领域、健康状态和唯一事实源。
3. 记录完整调用链、用户入口、实现入口、旧别名、重复组和迁移计划。
4. 明确每项能力属于普通 Tool、SubAgent 候选、Host protocol 或 Internal。
5. 建立只读的 Capability Catalog v1，并让静态测试阻止重复 ID、缺证据和误暴露。
6. 为后续 facade 和统一 Tool manifest 提供唯一输入，但本阶段不改变生产 Agent allowlist。

“已完成”只能表示通过了真实执行验收，不能表示目录中存在一条记录。任何标记为 `WORKING` 或继续保留在生产 Registry 的 Tool，都必须有可重复的 handler 调用、有效输出、scope/ownership 负例和事实源读回；否则必须降为 `PARTIAL`/`catalog_only`。

## 3. 明确不做

- 不把 `productionToolRegistry`、`WORKBENCH_TOOLS` 或 Rust `ALLOWED_TOOLS` 直接宣布为权威 Registry。
- 不把 `generate_*` candidate validator 伪装成正文/大纲生成器。
- 不将 `chapter_write` 切换到 DSH，不实现 Main Agent 自主选择。
- 不新增 `invoke_writing_agent`、`adopt_artifact`、`save_draft` 等假 Tool。
- 不实现 Writing SubAgent、Context Agent、多 Agent 或自主调度。
- 不删除旧 Service、旧路由、LocalStorage fallback 或 legacy Registry；只标记 alias/迁移计划。
- 不修改数据库 schema，不新增 migration。
- 不把 `catalog_only` 条目投影到模型 prompt、DSH tools/list 或生产 Tool Registry。
- 不记录 API Key、完整 Prompt、候选正文或隐藏推理。

## 4. 资产模型

每条能力资产至少包含：

```ts
{
  id, version, domain, kind, description,
  scope, inputSchema, outputSchema,
  permissions, sideEffect, confirmationPolicy,
  executor, legacyAliases, exposure,
  evidence: {
    health, callChain, userEntrypoints,
    implementationEntrypoints, sourceOfTruth,
    references, blockers
  }
}
```

字段语义必须分离：

- `health`：代码和真实链路目前是否可用（`working/partial/broken/legacy/unknown`）。
- `exposure`：是否允许后续 Agent 看到（本阶段全部为 `catalog_only`）。
- `sideEffect/confirmationPolicy`：描述真实副作用和宿主确认边界，不能按旧 Tool 名称猜测。
- `sourceOfTruth`：SQLite、运行时事实或明确的兼容来源；不能把 UI store 当正式事实。

## 5. 分阶段实施

### G0：全量登记（必须完成）

以以下审计为事实基线，逐项核对而不是按文件名计数：

- [`capability_inventory.md`](./capability_inventory.md)
- [`capability_call_graph.md`](./capability_call_graph.md)
- [`../architecture-audit-v2/duplicate_analysis.md`](../architecture-audit-v2/duplicate_analysis.md)
- [`../architecture-audit-v2/capability_merge_plan.md`](../architecture-audit-v2/capability_merge_plan.md)

登记 12 个 canonical domain 与 18 个目标动作；保留 75 个能力族的审计 ID 映射。所有条目必须有至少一个静态路径、一个事实源和一个阻断/验证结论。

### G1：只读 facade 准备（本阶段可实施的唯一代码增量）

先只做不改变 UI/Agent 行为的 adapter 设计和测试，优先顺序：

1. `novel.read`
2. `structure.read`
3. `memory.search`

`draft.read`、`context.read`、角色、资产、风格和参考资料在事实源/ownership 负例完成前保持 `catalog_only`。Facade 必须接收显式 `novelId/chapterId`，返回来源、revision/hash 和可序列化 DTO。

首批已有生产 Tool 的工作验收至少覆盖：

- `novel.read_context`：有效作品返回真实作品事实；不存在作品返回可解释错误；
- `chapter.read_outline`：有效作品/章节返回真实章节事实；跨作品章节必须 fail-closed；
- `search_memory`：只返回当前作品 scope 的已采用记忆；无结果不伪造正文；
- `generate_*`/`polish_chapter`/`check_quality`/`summarize_chapter`：只能验证合法 candidate schema，不得声称它们负责生成或写正式事实；
- `artifact.review`/`artifact.apply_approved`：必须有宿主授权、CAS、重启和重复消费证据，不能作为无确认模型 Tool。

### G2：候选与宿主协议登记

将 `writing.*`、`structure.propose_outline`、`context.propose_summary`、`quality.review` 登记为 SubAgent 候选；将 `artifact.review`、`artifact.apply_approved` 登记为 Host protocol。它们只引用现有 ResultArtifact/ReviewAuthorization 事实，不新增写入通道。

### G3：后置 Registry 投影（本阶段禁止执行）

只有当 facade、ownership、重启、失败/取消和跨作品负例具备证据后，才允许从 catalog 生成：

```text
TS ToolDescriptor
Rust Gateway tools/list + tools/call
DSH scoped projection
Current Plugin read-only projection
```

G3 另立任务书，不得在本阶段通过手工复制列表完成。

## 6. 验证要求

代码变更：

```powershell
npx prettier --check "src/services/capabilities/*.ts" "docs/audit-v2/*.md" "docs/architecture-audit-v2/*.md" CHANGELOG.md
npx tsx --test src/services/capabilities/capabilityCatalog.test.ts
npm run lint:ci
npm run build
```

文档/版本门禁：

```powershell
npm run test:docs-sync
npm run test:version-sync
git diff --check
```

必须额外确认：

- `listAgentExposedCapabilities()` 在本阶段为空；
- 默认 `npm run test:workbench` 不联网、不继承真实凭据，且行为不变；
- DSH preparation smoke 的真实证据仍标为 Phase 0.5，不改写为 Main Agent 通过。

## 7. 完成汇报格式

```text
阶段：Phase 1A-A Capability Assetization
资产目录版本：capability_catalog_v1
登记能力数：__
canonical domain 数：__
重复/归并组：__
catalog-only 条目：__
Agent 可见条目：0（本阶段固定）
新增 facade：__（若无则写 NONE）
生产行为变更：NONE / 列出范围
验证命令与结果：...
未完成/阻断：...
下一阶段准入：G1 facade / NOT READY
```

只有 G0 清单完整、G1 首批 facade 的真实调用链和负例证据齐全，才能单独启动 Phase 1A-B（canonical Tool Registry 投影）；之后才评估 Main Agent 和 Writing SubAgent。

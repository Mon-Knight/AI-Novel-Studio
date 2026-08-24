# Phase 1A-C Canonical Tool Projection

## 状态

`IMPLEMENTED / CATALOG-ONLY`

本阶段建立了独立的 Canonical Tool Projection 描述与固定 Facade adapter。它是能力目录与未来 Agent manifest 之间的审查层，不是当前生产 Tool Registry 的替换品，也不代表 Main Agent 已放行。

当前链路：

```text
Capability Catalog
    ↓（固定 ID + Facade 契约核对）
Canonical Projection（内部 manifest + hash）
    ↓（当前 gate 为空）
Model-visible tools: 0
```

## 首批投影候选

| canonical id     | 固定 Facade                                 | scope     | 当前状态       |
| ---------------- | ------------------------------------------- | --------- | -------------- |
| `novel.read`     | `projectCapability.readCurrentProject`      | `novel`   | `catalog_only` |
| `structure.read` | `projectCapability.readChapterPosition`     | `chapter` | `catalog_only` |
| `context.read`   | `contextCapability.readCurrentStoryContext` | `chapter` | `catalog_only` |
| `memory.search`  | `contextCapability.searchMemory`            | `novel`   | `catalog_only` |

这四项虽然已有真实 Browser/SQLite Facade 证据，但 catalog 健康仍包含 `PARTIAL` 阻断（作品事实源、outline active pointer、context bundle、混合记忆检索等）。因此本轮只生成候选描述，不将其作为模型能力。

## 实现边界

代码位于 `src/services/capabilities/canonical/`：

- `canonicalToolTypes.ts`：Canonical descriptor、内部证据、manifest 和宿主 scope 类型。
- `canonicalToolAdapters.ts`：四个显式函数绑定。每个 adapter 解析 JSON 参数、拒绝未知字段、复验宿主作品/章节 scope，再调用对应 Domain Facade。
- `canonicalToolProjection.ts`：从固定绑定与 Catalog 元数据生成排序稳定的内部 manifest，并使用 canonical SHA-256 生成 projection hash。
- `canonicalToolProjection.test.ts`：描述、schema、hash、真实 Facade 调用和负向边界测试。

固定绑定是唯一执行入口；禁止从 Catalog 的字符串 `facade` 字段做反射调用，也不接受 `serviceName/methodName`、Repository、SQL、LocalStorage key 或 legacy alias。

内部 descriptor 包含 `evidence` 与 `projectionState`，用于审计和 drift 检查。未来模型描述必须经过公开投影，剥离这些内部字段；当前 `listCanonicalToolsForAgent()` 和 Agent manifest 均为空。

## 明确未做的事情

本阶段没有：

- 修改 `listAgentExposedCapabilities()`；
- 接入或替换 `productionToolRegistry`、`WORKBENCH_TOOLS`、Rust DSH allowlist 或 `tools/list`；
- 修改 Main Agent prompt/loop；
- 暴露 `writing.*`、`artifact.*`、`conversation.*`；
- 放行 Writing SubAgent、Context Agent 或真实模型章节生成；
- 修改数据库 schema/migration 或删除 legacy 实现。

## 下一阶段准入条件

只有在四个 Facade 的 partial blockers、TS/Rust/DSH manifest drift、权限/重启/负例证据收口后，才能把某个 descriptor 的 `exposure` 从 `catalog_only` 提升为 `stable`。提升必须是独立变更，并同时增加模型可见 schema、宿主权限门禁和真实桌面回归证据。

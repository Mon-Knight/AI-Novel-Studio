# Phase 1A-D Shared Canonical Manifest Contract

## 状态

`VERIFIED / EXECUTION WIRING DISABLED`

Phase 1A-D 将首批 Canonical Tool 的跨运行时契约固定为唯一仓库 artifact：

```text
contracts/agent/canonical-tool-manifest.v1.json
```

该文件同时由 TypeScript、Rust 和 DSH/Node 契约测试读取。它不是旧 `productionToolRegistry`、`WORKBENCH_TOOLS` 或 DSH legacy allowlist 的替换，也不会把任何能力放进 Main Agent prompt。

当前事实：

```text
Portable descriptors                 4
Canonical model-visible identities   0
Projection hash                      36023c1b7e573dddc8b741c6a383e47ff72a7ead67d43b2f0159fd32c43d140c
Main Agent                            NOT RELEASED
Writing SubAgent                      NOT RELEASED
```

## 共享契约

顶层字段固定为：

- `contractVersion=canonical_tool_manifest_v1`
- `projectionVersion=1`
- `canonicalization=ans_canonical_json_v1`
- `projectionHash`
- `modelVisibleToolIdentities`
- `tools`

每个 Tool 仅携带跨运行时需要的 portable contract：identity、描述、输入/输出 schema、scope、permissions、side effect、confirmation、timeout、exposure、projection state 和 health。Facade 名、executor、Repository、审计路径和 legacy alias 不进入该 artifact。

首批 identity 按 ordinal 排序：

```text
context.read@1
memory.search@1
novel.read@1
structure.read@1
```

四项当前均为 `catalog_only + catalog_only + partial`。`modelVisibleToolIdentities` 必须精确等于 `exposure=stable && projectionState=stable && health=working && sideEffect=none && confirmationPolicy=never` 的只读派生集合，因此本阶段只能为空。

## Canonical JSON 与 hash

`projectionHash` 不参与自身 hash。其余顶层内容执行：

1. 对象 key 递归按 ordinal 排序；
2. 数组保持声明顺序；
3. 数值必须是 JavaScript safe integer，禁止 float、`-0` 和非 JSON 值；
4. 以 UTF-8 紧凑 JSON 计算 SHA-256；
5. 输出 64 位小写十六进制。

该算法命名为 `ans_canonical_json_v1`，不宣称实现完整 RFC 8785/JCS。

## TypeScript 宿主门禁

`canonicalToolRuntime.execute` 是公开 Canonical 执行入口。调用必须提供：

```text
name + version + argumentsJson + expectedProjectionHash
invocationId + allowedTools + permissions + host scope
```

门禁顺序：

```text
artifact shape/hash/drift
→ exact name@version
→ fixed entry-point exposure
→ per-run allowlist
→ permissions
→ input schema / JSON portability
→ fixed adapter
→ adapter 再次复验 scope/permissions
→ timeout/cancellation
→ output JSON/schema
```

公开 `executeCanonicalTool` 固定按 Agent exposure 校验，只能调用 `modelVisibleToolIdentities`；当前四项都会返回 `PERMISSION_DENIED`。测试与 E2E 必须深导入独立的 `executeCanonicalToolForHostValidation` 来验证真实 Facade 链，调用方不能通过上下文字段把公开入口切换成宿主验证模式。

## Rust/DSH 只读 attestation

Rust 通过 `include_str!` 编译嵌入同一 JSON，独立严格反序列化并复算 hash。它只生成 identity-only attestation，不提供 Tauri 产品命令、DSH protocol method、Tool schema 注册或执行 dispatch。

现有 DSH Workbench 仍保留 11 个 legacy Tool 名；本阶段仅证明四个 Canonical identity 与该 allowlist 不相交。准确口径是“Canonical model-visible 为 0”，不是“DSH 全部模型工具为 0”。

## 修改规则

任何 ID、schema、权限、scope、timeout、exposure 或可见集合变更都必须同时：

1. 更新 Capability Catalog 与固定 adapter；
2. 更新共享 artifact 并重算 hash；
3. 通过 TS、Rust、DSH/Node 三端漂移门禁；
4. 为新 exposure 单独提供权限、负例、桌面和真实模型证据。

Phase 1A-D 不允许从旧 Registry 自动生成 Canonical exposure，也不允许把共享 artifact 与 legacy allowlist 做 union。

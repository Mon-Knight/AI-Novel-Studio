# Canonical Tool Projection 验证报告

## 结论

Phase 1A-C 的“描述与固定适配器层”通过定向验证；模型可见能力仍为 `0`，Main Agent 和 Writing SubAgent 均未放行。

```text
Canonical descriptors generated       PASS（4）
Fixed Domain Facade bindings           PASS（4）
Manifest hash                          PASS
Legacy alias rejection                 PASS
Authoritative host scope               PASS
Browser production chain               PASS
Windows SQLite adapter chain            PASS
Model-visible tools                    0
Production/DSH registries              UNCHANGED
```

## 已验证契约

### 描述与 manifest

- 只包含 `novel.read`、`structure.read`、`context.read`、`memory.search`。
- `name === id`、版本固定为 `1`，全部是 `sideEffect=none`、`confirmationPolicy=never`。
- 输入 schema 使用明确 required 字段并设置 `additionalProperties=false`；`context.read.query` 明确为可选字段，`memory.search.query` 为必填且限制为 1～1000 字符。
- 输出统一为公开 `DomainResult` envelope：`ok/source/storageMode/warnings/revision/contentHash/data/error`，不直接返回 Repository 类型。
- manifest 先按 canonical id 排序，再对可序列化内容生成 SHA-256；重复生成 hash 一致。
- internal manifest 的证据与 exposure 不进入未来公开模型描述；当前 Agent manifest 为空。

### 固定适配器

- 四个 canonical id 各自直接引用一个确定的 Domain Facade 函数。
- 未使用字符串反射或任意 `service/method` 分发。
- adapter 在 Facade 之前拒绝非对象参数、未知字段、缺少宿主 scope 和参数/宿主 scope 不一致。
- Facade 在生产 handler/repository 层继续执行作品、章节和数据关系归属复验。
- `context.read` 依赖的风格/输出控制读取使用 `initialize:false`，不会因为只读调用首次播种兼容默认方案；Browser fixture 的 LocalStorage 快照在四个 adapter 调用前后保持一致。
- `chapter.read_outline` 等旧技术名和任何未投影名称均返回 `NOT_FOUND`，不会退回旧 Registry。

### 动态链路

隔离 Browser fixture 实际执行：

```text
Canonical adapter
  → Domain Facade
  → production handler/service
  → browser fallback repository
```

验证了作品读取、章节定位、故事上下文和记忆检索的公开 DTO、来源标记与 content hash，以及跨作品章节、缺少宿主 scope、未知字段和 legacy alias 负例。真实 Windows Tauri/WebView2 + SQLite E2E 也在 `tests/e2e/domain-facade-sqlite.spec.ts` 的 E2E-only probe 中直接执行四个 Canonical adapter，验证 Project/Structure/Context 的 `source=sqlite`、稳定 DTO、记忆检索的允许来源（当前实现可能为 `runtime`）、旧 alias 拒绝和 Agent visible count 为 0；该 bridge 仍受 E2E flag、后端诊断和显式 mutation 门禁保护，没有把 Canonical Tool 进入生产模型路径。

## 验证命令

```powershell
npx tsx --test --test-concurrency=1 src/services/capabilities/canonical/canonicalToolProjection.test.ts
npm run test:workbench
npm run lint:ci
npm run build
npm run test:e2e -- --spec domain-facade-sqlite.spec.ts
npm run test:docs-sync
npm run test:version-sync
npx prettier --check "src/services/capabilities/canonical/*.ts" "docs/architecture-audit-v2/canonical_tool_projection*.md"
git diff --check
```

## 未被本报告证明的能力

- 真实 Main Agent 自主选择 canonical Tool；
- Canonical manifest 与 TS/Rust/DSH allowlist 已统一；
- `writing.generate/continue/rewrite` 是独立 SubAgent；
- 真实模型生成章节候选并进入 Artifact 闭环；
- Context Agent、Memory Agent、Quality Agent 或多 Agent 已放行。

下一阶段仍应先解决 Registry projection 与宿主执行门禁，不应把本报告解释为 Harness 闭环完成。

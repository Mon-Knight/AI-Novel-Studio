# Phase 1A-D Canonical Manifest 验证报告

> 当前版本：v3.6.0 发布候选；本报告证明共享契约和宿主门禁，不代表 Canonical Agent exposure 或正式发布

## 结论

共享 Manifest、TypeScript 宿主执行门禁和 Rust/DSH 只读 attestation 已通过验证；Canonical 模型可见能力仍为 `0`，现有 legacy Workbench 工具链保持不变。

```text
Shared portable artifact             PASS
TS shape/hash/catalog/binding drift  PASS
Version/hash/allowlist/permission    PASS
Input/output schema gate             PASS
Rust independent hash attestation    PASS
DSH legacy isolation                 PASS
Windows SQLite TS/Rust hash parity   PASS
Canonical model-visible identities   0
Main Agent / SubAgent release        NO
```

## 自动化证据

### 跨语言专项

```powershell
npm run test:canonical-manifest
```

结果：

- DSH/Node portable contract：2/2 PASS；
- TypeScript Manifest、Projection 与 Runtime：16/16 PASS；
- Rust embedded attestation：4/4 PASS。

负例覆盖 hash 篡改、未知字段、非 ordinal 排序、非安全整数、Catalog/binding drift、伪造可见集合、错误版本、过期 hash、公开 Agent 入口失败关闭、单次 allowlist、权限、未知参数、legacy alias 和取消。

### Workbench 回归

```powershell
npm run test:workbench
```

结果：Node/DSH 17/17、TypeScript 82/82 PASS。新增测试证明伪造的 `tool:novel.read@1 loaded` runtime row 不能进入“当前插件”的已加载 function 投影；结构化产物应用在原子事务迁移前保持失败关闭且不写入正式领域事实。

### 编译与静态门禁

```powershell
npm run lint:ci
npm run build
cargo check --locked -p ai-novel-studio
```

全部 PASS。Rust 仅报告仓库既有 dead-code warning，没有新增 Canonical Manifest warning。

### 真实 Windows Tauri / WebView2 / SQLite

```powershell
npm run test:e2e -- --spec domain-facade-sqlite.spec.ts
```

结果：1/1 PASS。真实桌面进程验证：

- TS 与 Rust attestation 的 canonicalization、projection hash、4 个 versioned identity 完全一致；
- 两端 `modelVisibleToolIdentities=[]`；
- 四个 Canonical 调用经版本化、hash 绑定和 host-validation allowlist 进入真实 Facade/SQLite 链；
- Project/Structure/Context 来源为 SQLite；Memory envelope 如实保留当前 adapter 的 SQLite-backed service 或 runtime 来源标记，不把进程内 `NovelMemoryManager` 冒充 SQLite 长期事实；
- `chapter.read_outline` 仍返回 `NOT_FOUND`；
- WebView 重启后会话、Artifact、授权和 adopted draft 持久化不变。

## 未被证明的事项

- Main Agent 已看到或自主选择 Canonical Tool；
- Canonical Tool 已进入 DSH `tools/list/tools.call`；
- 11 个 legacy Workbench Tool 已被替换或删除；
- Writing/Context/Quality SubAgent 已放行；
- 真实模型章节生成闭环已完成。

## 下一准入门禁

四个 Canonical identity 当前都继承 Capability Catalog 的 `partial` 健康状态。进入 exposure 前必须分别关闭：

| Canonical Tool     | 当前 blocker                                                             |
| ------------------ | ------------------------------------------------------------------------ |
| `novel.read@1`     | 作品、设定、主角 JSON/表事实源尚未完全统一                               |
| `structure.read@1` | version、active pointer、写后读与 CAS 证据仍需闭环                       |
| `context.read@1`   | summary apply 与完整 context bundle 的 adopted-draft/source 协议仍需统一 |
| `memory.search@1`  | 真实 embedding、混合检索、明确降级与重启证据仍不完整；进程内 Map 不计入  |

四项 blocker 关闭后，必须另做一次独立 exposure 变更，验证 scoped model manifest、DSH `tools/list/tools.call`、权限、负向 scope/schema/cancel 和重启行为。不得直接改名或复用 legacy allowlist 后宣称迁移完成。该 exposure 门禁通过后才进入 **R4：真实 Main Agent Runtime 验证**；Canonical Registry/Projection 不再排到 Main Agent 或 Writing SubAgent 之后。

因此阶段标签是：

```text
Phase 1A-D Shared Manifest / Drift Gate VERIFIED
Canonical Agent execution wiring DISABLED
R4 Real Main Agent Runtime NOT RELEASED
```

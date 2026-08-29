# Domain Facade 真实链路验证报告

验证日期：2026-08-24  
测试入口：`src/services/capabilities/domain/domainFacade.test.ts`（浏览器回退）与 `tests/e2e/domain-facade-sqlite.spec.ts`（真实桌面）  
运行方式：`npx tsx --test --test-concurrency=1 ...`

## 1. 证据边界

本报告使用真实的浏览器开发存储链，不使用 fake Repository、fake handler、`vi.mock` 或覆盖生产执行器：

```text
Domain Facade
  → 现有 Production Handler / Runtime Service
  → Repository / Task Service
  → db.ts LocalStorage fallback
```

因此 `source: localstorage`、`storageMode: browser_fallback` 是预期结果。这证明浏览器开发模式的真实调用链，不等同于 Windows Tauri/SQLite 证据。SQLite 证据由独立的真实 Windows Tauri E2E 补充，二者不混写。

## 2. 动态结果

| 验证组                  | 覆盖内容                                                              | 结果                    |
| ----------------------- | --------------------------------------------------------------------- | ----------------------- |
| Project / Structure     | 作品、设定、主角、卷章读取；章节定位；重复读取 hash 稳定              | PASS                    |
| Context / Memory        | 章节上下文聚合；记忆来源、作品隔离；空结果不伪造正文                  | PASS                    |
| Ownership negative path | 缺 novel/chapter、未知目标、A 作品+B 章节、损坏分卷关系               | PASS                    |
| Conversation            | 任务列表、运行快照、移除消息正文和工具参数正文                        | PASS                    |
| Artifact review         | 候选卡片 → 用户确认 → ReviewAuthorization → 草稿版本/hash 校验 → 采用 | PASS（浏览器 fallback） |
| Artifact replay         | 同一授权二次采用被拒绝为 `CONFLICT`                                   | PASS                    |
| Writing boundary        | 缺冻结 model snapshot、重写缺上一版候选时 fail-closed                 | PASS（边界）            |

当前定向测试共 **6/6 PASS**。

Writing 的“有效请求 → 外部模型 → 候选”不在这组 Node 测试中冒充 PASS：Node runner 无法直接加载 Vite 的 Markdown prompt 资产，且本阶段没有把真实 DSH/Provider 章节写作路径接入 Facade。该路径保留为 `PARTIAL / candidate adapter`，需要后续桌面运行时 smoke。

## 3. 负例与不变量

- 缺失或空白 `novelId` / `chapterId` 不会从其它上下文推断；返回 `INVALID_SCOPE`。
- 章节存在但属于其它作品时，先由生产章节 handler 返回 ownership 错误，Facade 不返回章节标题、大纲或分卷 DTO。
- 章节引用不存在或其它作品的分卷时，Facade 返回 `INTEGRITY_ERROR` 或 scope 错误，不生成混合作品上下文。
- Memory 查询只返回当前作品的 `sourceId`、`chapterId` 和 `adoptedDraftId`；没有命中时返回 `ok: true, items: []`。
- Artifact apply 必须同时提供一次性授权、目标草稿版本和正文 hash；授权消费后重放失败。
- Writing Facade 的所有成功结果都带 `candidateOnly: true`，不调用正式采用接口。

## 4. 来源与 hash

浏览器回退结果明确标记：

```json
{
  "source": "localstorage",
  "storageMode": "browser_fallback",
  "revision": null,
  "contentHash": "sha256(canonical-public-dto)"
}
```

`contentHash` 用于重复读取稳定性和候选/DTO 身份，不宣称 SQLite revision。桌面 E2E 同时验证写后读、重启和 CAS 负例，但这仍不等于 Canonical Tool 已获准向模型暴露。

## 5. 真实 Windows Tauri / SQLite 验证

新增 E2E-only bridge wrapper `runDomainFacadeSqliteSmoke`，仅在 `VITE_AI_NOVEL_STUDIO_E2E=1`、后端诊断健康且显式传入 `allowMutation=true` 时动态加载。它不是生产命令、不会进入 Tool Registry，也不绕过现有 IPC command allowlist；普通生产构建不会打包该探针 chunk。

运行：

```powershell
npm run test:e2e -- --spec domain-facade-sqlite
```

2026-08-24 实测：**1/1 PASS（真实 Windows Tauri + WebView2 + 隔离 SQLite）**。

覆盖证据：

- `projectCapability.readCurrentProject`、`readChapterPosition` 和 `contextCapability.readCurrentStoryContext` 返回 `source=sqlite`、`storageMode=sqlite`；
- 四个 Canonical adapter 通过版本/hash/固定 host-validation 入口/allowlist 门禁在同一隔离桌面链路执行；Project/Structure/Context 返回 SQLite 来源，Memory 保留当前 `runtime/sqlite` 来源语义，旧 alias 被拒绝，TS/Rust manifest attestation 一致且 Canonical Agent visible count 为 0；
- 作品/卷/章节/设定/主角通过真实 repository 和 Tauri IPC 建立，跨作品章节访问返回 `SCOPE_MISMATCH`；
- `conversationCapability` 从 SQLite 读回任务、回合和安全运行投影；
- `artifactCapability` 完成结构化章节候选 → 用户确认 → `ReviewAuthorization` → 草稿版本/hash CAS 采用；授权重放返回 `CONFLICT`；
- 重载 WebView 后，章节采用指针、任务卡片、授权消费状态和草稿仍可从 SQLite 读回；
- `writingCapability` 在缺少冻结 `modelSnapshot` 时返回 `MODEL_SNAPSHOT_REQUIRED`，未冒充真实模型生成通过。

同时修复了章节结构化候选未携带 `chapterId` 的生产缺陷：SQLite `publish_structured_candidate` 现在校验章节归属并将章节作用域写入 AI task，避免后续审阅因 `sourceChapterId=null` 被错误拒绝。非章节结构化候选仍保持作品级作用域。

## 6. 门禁命令

```powershell
npx tsx --test --test-concurrency=1 src/services/capabilities/domain/domainFacade.test.ts
npm run test:e2e -- --spec domain-facade-sqlite
npm run test:workbench
npm run lint:ci
npm run build
npm run test:docs-sync
npm run test:version-sync
npx prettier --check "docs/architecture-audit-v2/*.md"
git diff --check
```

## 7. 阶段结论

```text
Phase 0.5 DSH真实模型基础设施         VERIFIED
Phase 1A-A Capability Catalog         VERIFIED
Phase 1A-B Domain Facade              VERIFIED (BROWSER + SQLITE E2E)
Phase 1A-C Canonical Tool Projection  VERIFIED (CATALOG-ONLY / MODEL VISIBLE 0)
Phase 1A-D Shared Manifest/Gate       VERIFIED (EXECUTION WIRING DISABLED)
Phase 1B Main Agent                   NOT RELEASED
Phase 1C Writing SubAgent             NOT RELEASED
```

本报告不授权 Main Agent，不把 Facade 自动加入 Tool Registry，也不把 candidate-only 边界或缺快照 guard 升级为真实模型/独立 Writing SubAgent 证据。

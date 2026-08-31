# Phase 1A-B Domain Facade 设计

更新时间：2026-08-24  
状态：**已实现薄层 Facade，浏览器与真实 SQLite E2E 已验证；尚未放行 Canonical Tool Projection**

## 1. 阶段定位

本阶段把已经通过生产 handler 工作性检查的能力整理成稳定的领域接口。它不是新的 Agent Runtime，也不是新的 Tool Registry。

```text
UI / 既有 Workbench
        ↓
Production Handler
        ↓
Domain Facade（本阶段）
        ↓
Canonical Tool Projection（后续阶段）
        ↓
Main Agent（未放行）
```

所有 Facade 当前都由宿主代码显式调用；`capabilityCatalog.ts` 中的 `exposure` 仍全部为 `catalog_only`，因此模型、DSH `tools/list` 和 Main Agent 看不到这些新接口。

## 2. 统一协议

入口统一使用 `DomainRequest`：

```ts
interface DomainRequest {
  novelId: string;
  chapterId?: string;
  conversationId?: string;
  artifactId?: string;
  authorizationId?: string;
  draftId?: string;
  query?: string;
  instruction?: string;
  modelSnapshot?: TaskModelSnapshot;
  signal?: AbortSignal;
}
```

返回统一使用 `DomainResult<T>`：

```ts
interface DomainResult<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string; retryable: boolean };
  source: 'sqlite' | 'localstorage' | 'runtime' | 'artifact';
  storageMode: 'sqlite' | 'browser_fallback' | 'runtime' | 'artifact';
  warnings: string[];
  revision?: string | null;
  contentHash?: string;
}
```

浏览器回退没有 SQLite revision，Facade 明确返回 `revision: null`，并把来源标记为 `localstorage / browser_fallback`。它不会把 LocalStorage hash 伪装成数据库 revision。

Facade DTO 只包含领域字段，例如作品标题、章节大纲、来源 hash 和候选状态；不返回 Repository 对象、SQL 字段、LocalStorage key、隐藏 Prompt、API Key 或候选卡片正文的内部投影。

## 3. Facade 分层

### ProjectCapability

文件：`src/services/capabilities/domain/projectCapability.ts`

公开动作：

- `readCurrentProject`：作品、设定、主角和卷章结构的公开快照。
- `readSettings`：只读作品设定和主角摘要。
- `readChapterPosition`：定位作品 → 分卷 → 章节，并复验三者归属。

底层真实链：

```text
projectCapability
  → readProjectContext / readProjectSettings / readChapterOutline
  → novel/volume/chapter/setting/protagonist repositories
  → SQLite（桌面）或明确标注的 LocalStorage（浏览器开发）
```

### ContextCapability

文件：`src/services/capabilities/domain/contextCapability.ts`

公开动作：

- `readCurrentStoryContext`：聚合作品、章节、分卷、设定、角色关联、事件关联、风格和输出控制。
- `searchMemory`：通过生产 `search_memory@1` handler 检索带来源的记忆片段。

底层真实链：

```text
contextCapability
  → chapter/project/style production handlers
  → productionToolRegistry（仅作为现有 handler 的宿主适配，不是新模型投影）
  → context/memory service
  → SQLite 或 LocalStorage fallback
```

### WritingCapability

文件：`src/services/capabilities/domain/writingCapability.ts`

公开动作：

- `generateCandidate`
- `continueCandidate`
- `rewriteCandidate`

三者都调用既有 `workbenchChapterWriter.generate`，只返回 `candidateOnly: true` 的候选 DTO。没有 `draftVersionService.create`、`adopt` 或正式正文覆盖路径。重写必须显式携带上一版候选和冻结 `modelSnapshot`。

本阶段只证明输入边界和候选安全契约；真实外部模型质量、独立 Writing SubAgent Prompt/模型隔离仍是后续 Phase 1C 门禁。

### ConversationCapability

文件：`src/services/capabilities/domain/conversationCapability.ts`

公开动作：

- `listTaskSummaries`
- `readRuntimeSnapshot`

它是宿主运行事实聚合，不是模型 Tool。输出会去除回合正文、工具参数摘要和工具结果正文，只保留任务、运行、工具状态和产物元数据。

### ArtifactCapability

文件：`src/services/capabilities/domain/artifactCapability.ts`

公开动作：

- `publishCandidate`：发布候选卡片投影，不等于正式写入。
- `requestReview`：要求用户确认后签发 `ReviewAuthorization`。
- `applyAuthorizedDraft`：复验作品/章节/授权/草稿版本/hash 后，调用既有 CAS 采用协议。

```text
candidate
  → user confirmation
  → ReviewAuthorization
  → expected version/hash check
  → adopt_review_authorized_draft
```

Facade 不新增 `adopt_artifact` 自由写 Tool，也不允许模型绕过用户授权直接写 `chapter_drafts`。

章节结构化候选在桌面链路中显式携带 `chapterId`：生产命令会复验章节与作品归属，并把章节作用域写入候选 AI task，保证后续 `ReviewAuthorization` 的 `sourceChapterId` 校验不会因作用域丢失而拒绝合法候选。非章节结构化候选仍使用作品级作用域。

真实 Windows Tauri / SQLite 验证由 E2E-only 的 `runDomainFacadeSqliteSmoke` wrapper 覆盖，证据包括读 DTO 来源、跨作品负例、候选→授权→CAS 采用、重放冲突和 WebView 重载读回。wrapper 不进入生产 Tool Registry 或模型 prompt。

## 4. 安全与边界修复

本阶段同时修正了两个会污染能力证据的生产 handler 问题：

1. `project-tools`、`chapter-tools`、`style-tools` 和 `verification-tools` 不再把浏览器 LocalStorage fallback 固定报告成 `database`，而是依据真实运行模式返回 `localstorage` 或 `sqlite`。
2. `chapter.read_outline` 现在复验所属分卷的作品归属；`chapter.read_context` 复验章节角色和事件关联的作品/章节归属。跨作品或损坏关系会 fail-closed。

## 5. 明确未做事项

- 未修改数据库 schema 或 migration。
- 未迁移 UI、Workbench 路由或旧 handler 调用者。
- 未把 Facade 注册进 DSH、TS Tool Registry 或 Main Agent prompt。
- 未实现 Context Agent、Quality Agent 或独立 Writing SubAgent。
- 未把 PARTIAL 能力升级为 `WORKING`；`capabilityCatalog` 仍以审计健康和证据门禁为准。

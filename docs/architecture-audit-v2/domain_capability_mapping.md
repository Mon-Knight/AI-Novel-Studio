# Domain Capability 映射表

更新时间：2026-08-24

## 1. 归并结果

本阶段将 18 个 catalog action 归并到 5 个领域 Facade。归并是接口收敛，不代表 18 个 action 已经可以作为模型 Tool 暴露。

| Domain Facade            | 公开 Facade 动作                                             | 当前证据状态                                                    | Agent 暴露                     |
| ------------------------ | ------------------------------------------------------------ | --------------------------------------------------------------- | ------------------------------ |
| `ProjectCapability`      | `readCurrentProject`、`readSettings`、`readChapterPosition`  | 浏览器真实生产链 PASS；桌面 SQLite 读/写后读/重启 PASS          | `catalog_only`                 |
| `ContextCapability`      | `readCurrentStoryContext`、`searchMemory`                    | 故事上下文浏览器与 SQLite PASS；混合/向量检索仍 PARTIAL         | `catalog_only`                 |
| `WritingCapability`      | `generateCandidate`、`continueCandidate`、`rewriteCandidate` | 安全边界与生产 writer 委托契约；独立模型/SubAgent 未验证        | `catalog_only`                 |
| `ConversationCapability` | `listTaskSummaries`、`readRuntimeSnapshot`                   | 浏览器运行事实读取 PASS                                         | Internal（不作为模型 Tool）    |
| `ArtifactCapability`     | `publishCandidate`、`requestReview`、`applyAuthorizedDraft`  | 浏览器与桌面 SQLite 候选→确认→授权→CAS 采用 PASS；重放冲突 PASS | `catalog_only` / host protocol |

## 2. 18 action 到 Facade

| Catalog action              | Facade           | 具体适配器                                  | 备注                                                           |
| --------------------------- | ---------------- | ------------------------------------------- | -------------------------------------------------------------- |
| `novel.read`                | Project          | `projectCapability.readCurrentProject`      | 只返回公开作品/设定/结构 DTO                                   |
| `structure.read`            | Project          | `projectCapability.readChapterPosition`     | 章节、分卷、作品 ownership 二次校验                            |
| `draft.read`                | —                | —                                           | 草稿事实源仍有 SQLite/LocalStorage/内存多轨，保持 catalog-only |
| `context.read`              | Context          | `contextCapability.readCurrentStoryContext` | summary/adopted draft bundle 语义仍需统一                      |
| `memory.search`             | Context          | `contextCapability.searchMemory`            | 现有生产 handler 负责 SQLite/LocalStorage fallback             |
| `characters.read`           | —                | —                                           | 角色事实源治理未完成                                           |
| `story_assets.read`         | —                | —                                           | 资产导入/关系链仍 PARTIAL                                      |
| `reference.read`            | —                | —                                           | 文件权限和激活事务未统一                                       |
| `style.read`                | Context 内部材料 | 现有 `style-tools` handler                  | 不单独作为模型可见 Facade action                               |
| `transfer.export`           | —                | —                                           | 文件选择和权限确认尚未形成 Facade                              |
| `writing.generate`          | Writing          | `writingCapability.generateCandidate`       | 候选-only；不是 SubAgent 放行证据                              |
| `writing.continue`          | Writing          | `writingCapability.continueCandidate`       | 候选-only；不采用正文                                          |
| `writing.rewrite`           | Writing          | `writingCapability.rewriteCandidate`        | 必须提供上一版候选和快照                                       |
| `structure.propose_outline` | —                | —                                           | 大纲 active/version 协议待统一                                 |
| `context.propose_summary`   | —                | —                                           | adopted draft/source bundle 待统一                             |
| `quality.review`            | —                | —                                           | report/gate/fix 尚未拆成稳定领域协议                           |
| `artifact.review`           | Artifact         | `artifactCapability.requestReview`          | 必须有用户确认时间和候选卡片                                   |
| `artifact.apply_approved`   | Artifact         | `artifactCapability.applyAuthorizedDraft`   | 复验授权、版本、正文 hash 后调用 CAS                           |

## 3. 底层生产调用链

### 读取链

```text
Project Facade
  → project-tools / chapter-tools
  → Repository
  → dbCall
  → SQLite 或 browser LocalStorage fallback
```

### 记忆检索链

```text
Context Facade
  → productionToolRegistry.search_memory@1
  → memoryService.retrieve
  → SQLite
  ↘ browser fallback → retrieveLocalMemory
```

### 候选写作链

```text
Writing Facade
  → workbenchChapterWriter
  → generationContextCompiler
  → executeChapterGeneration
  → Provider / DSH-compatible runtime
  → ResultArtifact candidate reference
```

该链不包含正式 draft save/adopt。

### 审阅采用链

```text
Artifact Facade
  → taskConversationService card projection
  → artifactDecisionService.record(confirm)
  → ReviewAuthorization
  → draftVersionService + adopt_review_authorized_draft
  → chapter_drafts / adopted pointer（CAS）
```

## 4. 后续 Canonical Tool Projection 输入

只有满足以下条件的 Facade action 才能进入下一阶段 projection：

1. Facade DTO 和错误码冻结；
2. 桌面 SQLite 入口有真实写后读/重启证据；
3. 负例覆盖跨作品、缺身份、版本冲突；
4. 对写入动作有宿主确认协议；
5. Catalog、TS、Rust、DSH manifest drift 检查通过。

当前没有任何 action 满足全部条件，因此 `listAgentExposedCapabilities()` 必须继续返回空数组。

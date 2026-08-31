# AI Novel Studio 第二次全量能力审计：Agent Gap Report

## 阶段重分类（2026-08-24）

本轮真实 DSH smoke 只把模型接入层提升为：

```text
Phase 0.5 — Model / Provider Infrastructure Verified
```

它不等于 Harness Agent 闭环完成。当前仍需单独验证：

```text
Workbench → Main Agent → Tool Registry → Writing SubAgent → Artifact
```

当前下一步是 Phase 1A-A 能力资产化，任务书见 [`phase1a_capability_assetization_taskbook.md`](./phase1a_capability_assetization_taskbook.md)。真实 Runtime 验证已改为后置 Phase 1A-B，任务书见 [`phase1a_real_agent_taskbook.md`](./phase1a_real_agent_taskbook.md)，设计稿见 [`phase1a_runtime_validation_plan.md`](./phase1a_runtime_validation_plan.md)。

## 1. 总体判断

当前 Agent 层已经有可靠的“会话事实 + 候选 Artifact + 人工审阅 + CAS 采用”骨架，但还没有形成可靠的“真实能力地图 → 单一 Tool Registry → Main Agent → 独立 SubAgent”体系。

最关键的问题不是缺更多 Tool，而是能力事实和 Agent 所见能力不一致：

- 用户真实软件能力远多于当前 11 个 DSH canonical Tool。
- 11 个 Tool 中的 8 个“生成/润色/检查/总结”实际上是 candidate validator。
- TypeScript Registry、Rust gateway、DSH runtime allowlist 是三份并行定义。
- 章节写作走正则路由和固定步骤，不是 Main Agent 的模型决策。
- 第一阶段生产 E2E 仍未执行外部真实 LLM；本轮已用固定 DSH preparation payload 完成一次真实 Provider tool-calling smoke，但这不覆盖 Workbench `chapter_write`。
- 当前 writer 是独立服务边界，但不是已证实的独立 SubAgent。

在这些缺口关闭前，不应进入 Context Agent 或继续扩充 Agent 生态。

## 2. Gap 总表

| Gap ID | 严重度 | 缺口                                           | 证据                                                                                                                                            | 风险                                   | 建议顺序                   |
| ------ | ------ | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- | -------------------------- |
| GAP-01 | P0     | Main Agent 章节写作不做 LLM Tool 选择          | `taskSessionAdapter` 将 `chapter_write` 送入 TS adapter；`taskGoalRouting` 正则选工具；固定三步读取                                             | 对外报告“自主选择”失真                 | Catalog/manifest 前置      |
| GAP-02 | P0     | `generate_*` 命名与 handler 语义相反           | TS/Rust handler 必须收到 `candidateText`，只验证 candidate-only                                                                                 | 模型空调用或错误规划                   | Catalog/manifest 前置      |
| GAP-03 | P0     | 外部模型验证范围不足                           | `npm run test:dsh:real` 已验证 DSH preparation 的真实 Provider、工具调用和 Proposal schema；Workbench E2E 仍强制 mock，`chapter_write` 未走 DSH | 无法把局部 smoke 外推为完整 Agent 能力 | 第 2 个修复                |
| GAP-04 | P0     | 三份 Registry 并行                             | TS 18、DSH allowlist 11、gateway default 14                                                                                                     | 漂移、权限/描述不一致                  | Catalog 后置统一           |
| GAP-05 | P0     | 产品有 BROKEN 数据入口                         | 假级联删除、LocalStorage 数据修复、硬编码资产统计                                                                                               | Agent 若 Tool 化会放大损害/误判        | Agent 前置修复             |
| GAP-06 | P1     | 7 个安全 TS Tool 不在 DSH allowlist            | settings/context/style/verification 描述符存在但不可见                                                                                          | Main Agent 上下文不完整                | Registry 统一后补齐        |
| GAP-07 | P1     | 缺少一组真实只读领域 facade                    | chapter/draft/summary/reference/assets 等有真实服务但未映射                                                                                     | Agent 只能靠粗粒度上下文 Tool          | 分批设计                   |
| GAP-08 | P1     | permission/confirmation 未完整进入模型可见契约 | 模型看到 MCP schema，TS 权限元数据只在内部                                                                                                      | 模型不能正确预判可执行性               | Registry 协议升级          |
| GAP-09 | P1     | Writing SubAgent 身份不成立                    | `workbenchChapterWriter` 复用 TaskModelSnapshot/生成管线，没有独立 Agent loop/model config                                                      | 隔离、预算、错误责任边界模糊           | 明确定义 SubAgent contract |
| GAP-10 | P1     | Artifact Apply 覆盖面名称过大                  | setting 走 limited placement；outline ownership 弱；不同 artifact 分支证据不同                                                                  | “通用 apply”可能越权或串书             | 按 artifact type 验证      |
| GAP-11 | P1     | 大纲 ownership 校验不足                        | outline commands 直接 SQL，缺少足够 foreign-key/scope 验证                                                                                      | 跨书污染                               | 开放 Tool 前修复           |
| GAP-12 | P1     | 旧 UI/旧事实源仍公开                           | AI Tasks、Setting Suggestions、Autonomous Planning、隐藏 Outline route                                                                          | 用户与 Agent 同时看到双真相            | 迁移/隔离                  |
| GAP-13 | P1     | 章节绑定/并发冲突投影不够可靠                  | target 持久化失败被吞；并发 peer 使用当前 chapterId 代替各会话事实                                                                              | 错章节写作/误报冲突                    | 加强冻结作用域             |
| GAP-14 | P2     | Plugin health 只证明目录/组合                  | runtime health 没有逐 Tool call probe，bootstrap 只要求核心少数身份                                                                             | UI 显示 loaded 不等于可调用            | 加逐 Tool 只读 probe       |
| GAP-15 | P2     | LocalStorage/SQLite 双真相                     | templates/settings/imported_assets/polish/suggestions 分散                                                                                      | Agent 能力扫描误报、备份语义复杂       | 明确正式事实源             |
| GAP-16 | P2     | TXT 导入非原子                                 | 作品、卷、章节、草稿逐条写入，无总事务/补偿                                                                                                     | 半导入                                 | 先做 transaction facade    |
| GAP-17 | P2     | DSH restart 测试有并发时序敏感性               | 两个完整 Rust 套件并发时一次断言失败，隔离重跑通过                                                                                              | 门禁 flaky/运行时状态污染              | 隔离临时 root/端口         |

## 3. 当前 Main Agent 的真实决策结构

```text
用户输入
  ├─ greeting/capability question
  │    → fixed canned reply（无模型）
  ├─ chapter_write / polish
  │    → regex classify/select
  │    → fixed context/outline/memory steps
  │    → workbenchChapterWriter
  │    → candidate validator
  └─ Tauri structured_write / audit / read
       → DSH model followup
       → model may choose one of 11 MCP tools（仅固定 DSH preparation smoke 已由真实 Provider 验证）
```

因此不能把整个 Workbench 概括为：

```text
自然语言 → LLM 判断 → Tool Call
```

准确描述应是：

```text
自然语言 → 硬编码意图分流
  → 章节路径：固定编排 + Writer 服务
  → 部分非章节路径：DSH LLM + MCP（DSH preparation 已真实验证；完整 Workbench 仍未验证）
```

## 4. Registry 差异

### 4.1 TypeScript Registry（18）

```text
search_memory
generate_chapter
generate_outline
generate_characters
suggest_events
expand_settings
polish_chapter
check_quality
summarize_chapter
verification.check_readiness
novel.read_context
novel.read_settings
chapter.read_outline
chapter.read_context
style.read_profile
style.read_output_control
verification.check_outline
verification.check_style
```

### 4.2 当前 DSH canonical allowlist（11）

```text
novel.read_context
chapter.read_outline
search_memory
generate_chapter
generate_outline
generate_characters
suggest_events
expand_settings
polish_chapter
check_quality
summarize_chapter
```

### 4.3 Legacy Registry（禁止合并）

```text
query_world_state
query_character_state
query_chapter_info
generate_outline
generate_scene_plan
generate_prose
quality_check
update_memory
save_chapter_version
```

Legacy registry 不提供等价的现代 result schema/permission/confirmation 协议，且只被无生产路由的旧 Harness 消费。

## 5. SubAgent 隔离审计

### 5.1 当前 writer 做到了什么

- 有单独 `workbenchChapterWriter` 服务边界。
- 重新编译小说/章节上下文并冻结 `TaskModelSnapshot`。
- 通过标准 AI execution pipeline 产生 AI Task/ResultArtifact。
- 返回 candidate text，不直接更新正式 `chapters.adopted_draft_id`。
- 修改/润色会显式引用上一候选或已采用正文。

### 5.2 没做到什么

- 没有独立 Agent 身份/会话/loop。
- 没有独立于任务模型的模型选择或配置；复用同一 `TaskModelSnapshot`。
- 没有独立 SubAgent tool allowlist；它调用内部服务，而非受约束 Tool runtime。
- Workbench E2E 使用 Mock，未证明章节 Writer 的真实模型 prompt 隔离、上下文服从和越权抵抗；固定 DSH preparation 的真实 smoke 仅覆盖只读工具和提案校验。
- 会写 AI Task/ResultArtifact 等执行事实；“数据库写入为 0”只能理解为“不写正式小说事实”，不能表述为完全不写数据库。

结论：当前应叫“Writing service/orchestrator”，健康状态 `PARTIAL`；不能据此宣布 Writing SubAgent 已完成。

## 6. 第一阶段报告中的高风险错误声明

当前生产代码和 E2E 证据无法支持以下声明：

1. `read_current_context`、`invoke_writing_agent`、`save_candidate_artifact`、`publish_candidate`、`adopt_artifact` 是生产 Tool。全仓扫描没有这些 canonical 工具；当前名字是 `novel.read_context`、`chapter.read_outline`、`search_memory` 和 candidate validators，保存/采用由 UI/Artifact 协议完成。
2. Main Agent 对章节任务通过 LLM 自主决定工具顺序。当前章节路径是正则 + 固定步骤。
3. 完整 Workbench 的真实外部 LLM 决策已验证。第一阶段 E2E 证据明确为 `NOT RUN`；本轮只补充了固定 DSH preparation 的真实 Provider smoke。
4. Writing SubAgent 使用独立模型配置。当前复用任务冻结模型快照。
5. 五轮 E2E 的初版内容证明模型理解不同作品。五轮初版 Artifact hash 完全相同，符合 Mock 输出，不能证明语义隔离或内容质量。
6. `adopt_artifact` Tool 执行了 CAS。实际是卡片确认签发 review authorization，用户进入编辑器保存并调用 `adopt_review_authorized_draft`。

## 7. 能力资产化后的修复顺序

### Gate A：能力事实与 Catalog（当前阶段）

1. 以 75 个审计能力族和 12 个 canonical domain 建立唯一能力资产目录。
2. 每项资产补齐用户入口、完整调用链、事实源、owner、输入/输出 schema、健康状态和阻断。
3. 将旧/E2E-only/隐藏入口标记为 alias/legacy；本阶段不删除、不改变生产行为。
4. 所有 canonical action 固定为 `catalog_only`，不得进入模型 prompt。

### Gate B：首批 Domain facade

1. 先实现 `novel.read`、`structure.read`、`memory.search` 的薄只读 facade。
2. 重复验证 ownership、revision/hash、跨作品负例、重启读回和错误收敛。
3. `draft.read`、`context.read`、角色/资产/风格/参考资料在事实源治理完成前保持 `PARTIAL/catalog_only`。

### Gate C：Canonical Tool projection（后置）

1. 由通过 Gate B 的 catalog 条目生成 TS descriptor、Rust gateway schema 和 DSH projection。
2. 用 canonical name/version/schema/permission hash 阻止三份清单漂移。
3. 将 `generate_*` validator 内部化为 `submit_*_candidate`，不改变候选/审阅/CAS 边界。

### Gate D：真实 Agent Runtime（更后置）

1. 只对通过 facade/manifest gate 的只读与候选能力运行真实 DSH profile。
2. 记录模型自主 `tool/call`、scope/schema、终态事件和 candidate Artifact；不记录 prompt、正文或密钥。
3. 明确区分 LLM decision 与宿主固定 orchestration。

### Gate E：Writing SubAgent

1. 独立 prompt、模型快照、上下文 DTO、预算、取消和只读 allowlist。
2. 只交付 ResultArtifact，不写正式小说事实。
3. 完成真实模型跨书、重启、失败重试和越权负例后再放行。

只有 Gate A～E 通过后，才适合进入 Context Agent；当前 Gate A 正在建立，Context Agent 仍 NOT READY。

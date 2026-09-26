# 世界规则结构与变更契约

> 适用：当前 v3.7.0 工作区的交互、候选与世界规则修复，不升级版本。本文说明已落源码契约，供产品、前端与原生服务共同核对；集成和统一验收尚未完成。没有新增测试、桌面或 live 通过结论，R4 live 云端仍 **NOT VERIFIED**。
> 本文不替代作者判断，不授予模型正式写入权限；历史设定推演设计见 [setting-suggestions.md](setting-suggestions.md)，数据落点见 [数据模型第 43 节](../data-model.md#43-v370-修复中的规则与候选持久契约)。

## 1. 存储与渐进填写

`WorldRuleDocument` 存入既有 `world_settings.structured_json` 或 `rule_systems.structured_json`（TS 为 `structuredJson`），与原 `content`、`forbiddenRules`、`isActive` 并存。本次不新增表、migration 或备份 schema，不能把结构化说明写成独立的规则数据库。

每个文档描述一条带稳定身份的规则或设定说明：`contract = world_rules_v1`、`schemaVersion = 1`。新建默认 `identity.revision=1`、`authority=draft`、`strength=descriptive`、`epistemic.status=uncertain`。界面提交确认版前会构造拟改版本并取得作者预览授权，而不是由 AI 写一个 `confirmed` 字段就生效。

正文与标题是编辑入口的必需内容，其余参数可逐步补充；允许空字符串、空数组及在自由文本中注明“未知 / 不适用（N/A）”。这不是新增的 enum 值，尤其不能把 `unknown` 填进只接受既定值的 `epistemic.status`。不要求先写完整百科再开始创作。

卡片首屏只展示标题、正文摘要与分组事实：性质（kind）、范围、限制/代价（limitations / cost / ceiling）、角色知道（epistemic.status 与 knownBy）和八类参数进度；来源与依赖、故事时间与揭示、例外在编辑区分组展开，八类参数附填写示例。未填项以中性缺口提示呈现，是待补缺口而不是校验失败，也不表示世界事实缺失。

读取器区分 `absent / legacy / unsupported / invalid / valid`。旧格式、未知版本与不可解释的原 JSON 保留，不自动升级、丢弃或解释为可信正史；编辑既有记录时未提供 `structuredJson` 会保留旧值。新写入的结构化文档必须合法，既有未知材料只能原样保留，不能借旧格式绕过确认门禁。

## 2. 三个独立维度与六种性质

| 维度               | 实际值                                        | 含义与边界                                           |
| ------------------ | --------------------------------------------- | ---------------------------------------------------- |
| `kind`             | 见下表                                        | 内容是什么性质，不是可信度                           |
| `authority`        | `draft / candidate / confirmed / superseded`  | 草拟、候选、作者确认、被替代；与条目 `isActive` 分开 |
| `epistemic.status` | `established / uncertain / disputed / belief` | 世界内认知或证据状态，不因作者确认自动变成确定事实   |
| `strength`         | `hard / soft / descriptive`                   | 约束强度，不代表物理定律或语义检查通过               |

| `kind`                 | 解释                                               |
| ---------------------- | -------------------------------------------------- |
| `world_fact`           | 世界事实                                           |
| `causal_rule`          | 因果、能力与运行规律                               |
| `social_norm`          | 法律、习俗或组织规范；人物可以违反，需处理制度后果 |
| `character_belief`     | 某角色的信念或误解，不自动等于客观事实             |
| `author_constraint`    | 作者明确承诺的创作约束                             |
| `narrative_preference` | 叙事偏好，不自动升级为硬规则                       |

例如，“法律禁止夜间排水”不等于“夜间排水在剧情中物理上不可能”。即使作者确认且标为 `hard`，仍须结合 `kind`、条件、范围和后果理解。参考作品只可提供抽象风格方向，不复制名著的人名、地名、组织、专有规则或标志性情节。

## 3. 实际字段

| 字段                      | 结构 / 用途                                                                                                                  |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `identity`                | `{id, revision, supersedesRevision?}`；正整数修订号，修改已识别文档时身份不变、revision 加一且 `supersedesRevision` 指向前版 |
| `statement`、`conditions` | 陈述正文、条件字符串数组                                                                                                     |
| `scope`                   | `{summary, chapterIds, places, groups, characters}`；除 summary 外为字符串数组                                               |
| `chronology`              | `{effectiveFrom, effectiveUntil, revealAt}`；故事生效时间与读者揭示时间分离，不把章号当故事日期                              |
| `epistemic`               | `{status, knownBy, learnedAt, evidence}`；知情者、获知时点和证据                                                             |
| `boundaries`              | `{limitations, cost, ceiling}`；适用限制、代价与能力上限                                                                     |
| `exceptions`              | `[{condition, effect, approval, reason}]`；approval 仅 `proposed / author_approved`                                          |
| `provenance`              | `{origin, sourceRefs}`；origin 为 `user / ai_candidate / adopted_text / legacy`，sourceRefs 为来源引用字符串数组             |
| `dependencies`            | 显式依赖资产 ID 的字符串数组；缺失或跨作品引用是确定阻断，不是模糊文本相似度                                                 |
| `worldParameters`         | 八类目录的可选文本映射，按需填写                                                                                             |

八类目录：`time_history`（时代与历史）、`space_environment`（空间与环境）、`institutions_power`（制度与权力）、`economy_resources`（经济与资源）、`technology_infrastructure`（技术与基础设施）、`culture_daily_life`（文化与日常）、`information_knowledge`（信息与认知）、`conflict_boundaries`（冲突与边界）。

来源引用、显式依赖、逻辑修订号与整条记录 hash 一起说明版本关系；当前不是自动推导任意自然语言因果或完整版本依赖图。Schema 对文本和数组有长度上限（单文本 20,000 个 Unicode 字符，字符串列表和例外最多 128 项），这些是输入边界，不是模型可用上下文预算。

## 4. 保存、停用与永久删除

手动背景/规则编辑、旧设定推演采用与工作台规则候选应用共享作者变更门禁。保存守卫为：

```ts
{
  expectedUpdatedAt?: string;
  expectedRuleSetFingerprint?: string;
  changeAuthorization?: {
    previewHash: string;
    intent: 'confirm_change' | 'retcon' | 'approve_exception';
    notes?: string;
  };
}
```

类型上的可选不代表可跳过门禁：更新既有记录须精确 `expectedUpdatedAt`；创建不能携带旧记录时间。实际变更须匹配当前规则集指纹及本次作者确认；`retcon` 和 `approve_exception` 必须说明理由，新批准或修改的例外还须明确条件、效果与理由。作者确认不能覆盖确定的缺失依赖等阻断。

`WorldRuleChange` 包含 `operation?: upsert | delete`（省略按 upsert）、`targetType`、`targetId?`、标题、全文、可选 category / forbiddenRules / structuredJson 与 isActive。预览绑定**整份拟改内容**、作品、目标、实际 source 基线、采用章潜在影响、候选身份和阻断；候选采用路径还绑定 card/artifact 或 suggestion ID、候选 hash、编辑后内容 hash。编辑、切换候选或影响基线变化后必须重新预览，不能复用旧勾选。

- 停用是 `isActive=false` 的受治理保存，推荐用于保留来源与历史。
- `rule_system` 的永久删除仍保留，走 `operation=delete` 与同样的记录/规则集/作者守卫；存在明确依赖时阻断，不能把“推荐停用”写成已取消删除功能。当前不由此开放其他类型的删除。
- 桌面端在单个 `IMMEDIATE` 事务中重新读取并校验后写入；前端预检不是授权事实。并发变更失败关闭，保留用户未保存草稿。
- 影响预览保守列出已有采用章和可能失效候选，标为 `potential_impact` 等不确定性；这不证明这些章节矛盾，也不自动重写正文。

## 5. 冻结规则集与采用复验

原生 AI Task 创建由 SQLite 权威数据生成 `targetHintJson.nativeRuleSet = {novelId, fingerprint, sources}`。客户端自报 `nativeRuleSet` 被拒绝；宿主冻结后计算持久 `request_hash`，原 caller hash 校验仍保留。精确重放复用原冻结快照，不能借重试换成更新基线；system 连接探针不取得作品规则权威。

DSH 从本回合实际持久读取的覆盖凭据取得 `expectedRuleSetFingerprint`，新 Task 冻结必须与读时基线一致。共享 `src-tauri/shared/world_rule_fingerprint.rs` 对桌面与 Gateway 的完整 camelCase 记录、空值、停用项、原 JSON 和禁止项统一计算来源/记录 hash；不是仅对时间戳或最近启用条目取 hash。

规则变化在同一写事务内将依赖旧规则集的 `issued` 审阅授权置 `expired`；`consumed`、已采用草稿和旧决定保持历史，不重新打开、不删除。签发/消费授权及首次正式采用再次复验任务的 `nativeRuleSet`，旧候选不能靠仍显示的确认按钮绕过失效。

### 5.1 两类采用回执

- **工作台结构化规则应用**：领域写入与 append-only `ArtifactDecision` 同事务。`applyTransactionId` 在该路径引用 `large_text_documents` 的 `world_rule_apply_receipt` 文档，target 为 `artifact` / 当前候选 ID；正文记录 scope、候选/card/hash、作者 guard/notes、应用后规则集指纹及目标 ID/hash。重放复验文档归属、完整 hash、原确认和正式目标，目标漂移或换授权失败关闭。这不是新增的通用事务表。
- **旧设定推演**：`adopt_setting_suggestion` 在一次 `IMMEDIATE` 事务中校验候选及编辑内容 hash、规则基线与作者预览，写目标、更新候选 CAS 并记录 `result_json` 内的采用回执。重放只读回同一次请求和未漂移目标，不再次新建。无生成时快照的旧候选明确要求重新审查，不把当前快照冒充生成时已检查。旧入口的角色仍进 character，规则进 rule_system，势力/地点候选仍映射 world_setting；不因项目另有正式故事资产模块而擅自改变旧入口映射。

两类回执都复用现有持久结构；“没有新 migration / 备份 schema”不等于忽略现有引用、删除与备份恢复兼容性，它们仍属统一验收边界。

## 6. 读取完整性不是语义证明

Gateway 的 `novel.read_context` 全量投影当前作品所有启用世界设定和规则，不再按最近 6/8 条或字段截断选取：**世界与规则各 128 KiB**；`chapter.read_outline` 的章节工程投影（chapterCard / scenePlan / generationConstraints）**64 KiB**。完整容纳才返回 complete，超预算返回 `ok=false` / `context_incomplete`，不把部分材料当成功上下文；既有响应总包络仍为 2 MiB，其他上下文域并非因此全部无限量。

原生 `task_runtime_context_coverage` 在候选准入前核对实际 `tool_call_events` 成功结果及 `largeTextRefId` 的目标归属、持久全文 hash/字符数、root `ok=true`、协议与 scope、sourceIds/数量、每项 content / forbiddenRules / structuredJson 原文字段 hash、投影字节与 hash、真实规则集指纹。只出现 `complete` 标签、旧回合读取、root 失败或仅有 manifest 都不能放行。零规则项目可证明“确实为零”的覆盖，不等于语义检查通过。

确定性 TS 链路的 `generationContextCompiler` 将工程视角角色、已知/未知信息实际编入上下文；`chapterProviderContext` 将世界/规则和工程等必需材料设为 `required + requireFull` 交给 Provider 编译预算，不能只存在于 UI 或日志。DSH 候选后公开复核保留 error / warning / not_checked 及来源不可读等原因；`semanticRules` 始终 `not_checked`。结构、字数、有限正文启发式和上下文完整覆盖不等于自动证明全书世界规则一致。

## 7. 浏览器回退与验收边界

浏览器仅使用明确标注的本机规则快照、hash/CAS 守卫、同步失效及补偿回滚；旧建议采用用本机恢复 journal 保持精确目标与请求身份。它们不能形成跨 LocalStorage/SQLite 的 ACID，也不冒充真实 Tauri/DSH 或云端验证。工作台通用结构化应用在浏览器仍失败关闭，不因旧建议有本机恢复能力而开放。

本机保存守卫严格失败关闭：`expectedRuleSetFingerprint`、`changeAuthorization.previewHash` 与 `intent` 缺任一项即抛 `RULE_CHANGE_CONFIRMATION_REQUIRED`，不按本机状态自动补签作者确认；指纹不匹配为 `RULE_SET_BASE_CONFLICT`，预览 hash 不匹配回到确认要求，显式依赖冲突为 `RULE_CHANGE_BLOCKED` / `RULE_DELETE_DEPENDENCY`。章节审阅的浏览器规则基线同样要求 `mode=browser-chapter-rule-baseline-v1`、`novelId` 与 `fingerprint` 齐全，缺任一项按 `RULE_SET_SNAPSHOT_REQUIRED` 拒绝并提示重新生成候选，不自行签署新基线。

本批代码仍在集成，文档同步只核源码，不执行测试、lint、格式检查、build、服务器、桌面或模型调用。既有历史验证记录不回填成本批证据；全部修复完成后由父任务统一验收并写证据报告，R4 live 云端 NOT VERIFIED 不变。

## 8. 事实核对入口

- 类型与 UI：`src/types/worldRules.ts`、`src/services/worldRules/*`、`WorldSettingCard` / `RuleSystemCard` / `SettingEditForm` / `WorldRuleChangeConfirmation`。
- 保存与原生治理：`src/services/database/settingRepository.ts`、`src-tauri/src/services/world_rule_schema.rs`、`world_rule_governance.rs`、`world_setting_service.rs`。
- 采用事实：`setting_suggestion_adoption_service.rs`、`structured_artifact_apply_service.rs`、`structured_rule_apply_receipt.rs`、`conversation_repository.rs`；浏览器为 `settingSuggestionLocalStore.ts`、`browserChapterReviewBaseline.ts`。
- 生成/读取：`ai_task_service.rs`、Gateway `tools.rs`、共享 `world_rule_fingerprint.rs`、`task_runtime_context_coverage.rs`、`generationContextCompiler.ts`、`chapterProviderContext.ts`、`taskSessionAdapter.ts`。

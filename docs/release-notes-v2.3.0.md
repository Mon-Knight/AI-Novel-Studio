# AI Novel Studio v2.3.0 发布说明

发布日期：2026-07-26
阶段：Agent 执行事实层 M1

## 本版完成

v2.3.0 建立后续 Agent 化与 Multi-Agent 共用的持久执行事实基础。新增 Task、Attempt、三类 Snapshot、ResultArtifact 和 ValidationIssue，使一次 AI 执行的目标、输入、上下文、约束、Provider 响应和校验结果在应用重启后仍可完整追踪和验证。

核心能力：

- Task + Input / Context / Constraint Snapshot 单事务创建。
- Rust canonical requestHash 与 operationId 幂等重放。
- Attempt 联合身份、state revision CAS、单 Task 单 live Attempt。
- queue / claim / success / failure / cancel / late response 的提交未知安全重放。
- Artifact 与 Task 预期契约、Attempt responseHash/length、持久 Input Snapshot 强绑定。
- 完整 raw / display / structured 结果使用大文本分片和 SHA-256 完整性层。
- Snapshot、Artifact、ValidationIssue 及其引用的大文本建立引用后不可篡改。
- Provider options / response metadata 白名单、凭据检测和普通日志正文脱敏。
- 关闭文件数据库后重新打开，可读取完整 Task、Attempts、Snapshots、Artifacts 和 Issues。

## 数据库升级

新增正式 migration：

```text
005_ai_tasks
006_ai_task_attempts
007_ai_input_snapshots
008_ai_context_snapshots
009_ai_constraint_snapshots
010_result_artifacts
011_artifact_validation_issues
```

升级只新增表、索引和触发器：

- 不删除、重命名或改变既有字段类型。
- 不修改 `chapter_drafts` 或 `quality_check_reports` 表形状。
- 不迁移、删除或伪造 `ai_task_records` / `generation_jobs`。
- 旧业务行数、采用指针和完整正文保持不变。
- 重复启动幂等，migration checksum 漂移时拒绝继续。

回退到 v2.2.1 时，旧程序会忽略新表；若需要物理移除新 schema，应恢复升级前数据库备份，不在生产库手工执行 `DROP`。

## 版本边界

本版本没有把现有 AI 面板迁移到新管线，也不包含：

- 生产 Provider Adapter 改造或真实 AI 调用；
- Planner、Memory、Tool Registry、execution lease / checkpoint；
- 自动续跑、Placement / ApplyPlan 或正式正文自动写入；
- Multi-Agent 编排、专业 Agent 或自主逐章创作；
- UI 重做。

因此 v2.3.0 代表“执行事实地基完成”，不代表 Autonomous 或 Multi-Agent 已完成。

## 主要实现文件

- `src-tauri/src/migrations.rs`
- `src-tauri/src/domain/`
- `src-tauri/src/repositories/ai_task_repository.rs`
- `src-tauri/src/repositories/artifact_repository.rs`
- `src-tauri/src/services/ai_fact_security.rs`
- `src-tauri/src/services/ai_task_service.rs`
- `src-tauri/src/services/artifact_service.rs`
- `src-tauri/src/commands/ai_tasks.rs`
- `src-tauri/src/commands/artifacts.rs`
- `src/types/ai-task.ts`
- `src/types/result-artifact.ts`
- `src/services/ai-tasks/aiTaskRuntimeService.ts`
- `docs/architecture/ai-execution-facts.md`

## 验证

- Rust / SQLite 常规全量：133/133。
- 真实用户数据库隔离副本升级：1/1；业务表行数/形状、外键错误数和 integrity 均保持。
- Node：16/16；tsx：44/44。
- ESLint：0 error，保留 1 条既有 React Hooks warning。
- TypeScript + Vite production build：通过。
- Windows Tauri 启动 smoke：1/1；隔离空库迁移到 `011_artifact_validation_issues`，M1 Task / Artifact 初始计数均为 0。
- Windows Tauri 完整 E2E：11/11；全部使用隔离 SQLite、Mock Provider、外网阻断和进程清理。
- Tauri production build：通过，同时生成 MSI 与 NSIS。
- 真实 API：未调用；Provider Adapter 本版本未修改。

安装包：

| 产物 | 大小 | SHA-256 |
|------|------|---------|
| `AI Novel Studio_2.3.0_x64_en-US.msi` | 6,434,816 bytes（6.14 MiB） | `74e584638ba888a69e8ac490b2049d39215f18e56e8842c810c23462e841ab68` |
| `AI Novel Studio_2.3.0_x64-setup.exe` | 4,612,694 bytes（4.40 MiB） | `c2b645b00239bafebb84d0c17b33b264fac560f8ea9d3b8309c45e02e7126ef8` |

完整验收证据见 [`audit/phase-3/08-v2.3.0-m1-acceptance.md`](audit/phase-3/08-v2.3.0-m1-acceptance.md)。

## 下一阶段

v2.3.1 将接入统一 Provider Adapter：先迁移连接测试和一个只读 AI 入口，并只执行一次低输出真实 API 验收。随后再实现安全 Placement / Apply 边界。

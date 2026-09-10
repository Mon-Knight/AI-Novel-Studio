# AI Novel Studio v3.7.0 功能缺口与口径对照

> 审计日期：2026-09-09
> 审计基线：`v3.7.0`（`package.json` / `src-tauri/Cargo.toml`）、React 18 + TypeScript + Tauri 1.x + Rust + SQLite
> 文档性质：对照当前可执行代码的缺口清单与文档口径校正。**不授权下一版本开发，不宣称 R4 VERIFIED。**
> 历史快照：[`feature-gap-analysis-v3.0.0.md`](feature-gap-analysis-v3.0.0.md)（2026-07-28）、[`audit-v2/`](audit-v2/)、[`architecture-audit-v2/`](architecture-audit-v2/) 保留原文，不得把旧表改写成当前状态。

---

## 1. 审计方法与结论口径

证据优先级：

1. 当前可执行代码、migration、共享 Manifest 与宿主 allowlist；
2. 自动化测试与已记录的真实/故障注入验收；
3. 当前权威文档（README、版本路线、工作台架构、Writing SubAgent 契约）；
4. 带日期的历史审计，只用于解释演进，不作为当前待办。

状态定义：

- **已关闭**：用户或宿主入口与持久事实已对齐，且有对应测试或验收记录。
- **部分具备**：主路径可用，但覆盖面、真实模型或并行入口仍有限制。
- **仍开放**：没有完整协议、未验收，或文档曾误写成未放行。

优先级只表示建议顺序，不构成已授权任务。

---

## 2. 执行摘要

v3.7.0 已开放 Writing SubAgent（桌面端 + 真实 API 模型的 `chapter_write` 默认经 DSH 提交 candidate-only 正文）与 ZCode 工作台。四项 Canonical 只读工具已是 `stable + working`；R4 live 云端仍 **NOT VERIFIED**。2026-08 审计列出的三个 BROKEN 入口，以及 GAP-09 / 10 / 11 / 15 / 16 / 18 / 19，代码侧已收口。多份“当前”文档仍把写章写成未接管 DSH，或把级联删除 / 数据修复 / 资产计数写成假入口——那是文档漂移，不是当前代码。

写章双路径：

- 桌面端 + `runtimeMode=api`：默认 `writing-subagent`（`localStorage['ai_novel_studio_writing_subagent_dsh']='0'` 可关闭）。
- mock / 本地模型 / 浏览器：`deterministic-writer`。

---

## 3. 已关闭项（对照代码）

| 条目                      | 历史说法                       | v3.7.0 代码事实                                                   | 证据                                                                     |
| ------------------------- | ------------------------------ | ----------------------------------------------------------------- | ------------------------------------------------------------------------ |
| GAP-09 / Writing SubAgent | Writer 服务不是独立 SubAgent   | 桌面 + 真实 API 默认走 DSH `chapter_write`，candidate-only        | `writing-subagent-contract.md` E-0～E-4；E-4a / E-4b PASS                |
| GAP-10                    | 通用 apply 覆盖面过大          | 前端单一策略源 `structuredApplyPolicy`；Rust 白名单仍是最终权威   | `structuredApplyPolicy.ts`；CHANGELOG v3.7.0                             |
| GAP-11                    | 大纲 ownership 弱              | `save_*_outline` 事务内校验作品/卷/章/上级纲要，不匹配零写入      | `outline_commands.rs`                                                    |
| GAP-15                    | 模板/建议/导入/润色双真相      | 桌面以 SQLite 为事实源（设置仍为本机 LocalStorage/DPAPI，按设计） | migration 037；`user_templates` / `setting_suggestions` / `local_assets` |
| GAP-16                    | TXT 导入非原子                 | `import_txt_novel` 单一 Immediate 事务                            | `txt_import_service.rs`                                                  |
| GAP-18                    | 失败运行无法重试章节目标       | `task_runs.chapter_id`（migration 038）                           | `038_task_runs_chapter_binding`                                          |
| GAP-19                    | 重试沿用旧读取被拒             | 用户重试提示要求本回合重新完成必需读取                            | `task_runtime` 重试说明                                                  |
| BROKEN：假级联删除        | `delete_novel` 只软删主行      | 用户入口走 `delete_novel_cascade` → `purge_project_in_tx`         | `project_service.rs`                                                     |
| BROKEN：修复不碰 SQLite   | `repairData` 只改 LocalStorage | 桌面调用 `repair_database`                                        | `novelRepository.repairData`                                             |
| BROKEN：导入资产假计数    | 卡片写死 `0`                   | `useAssetStatistics` 读 `importedAssets`                          | `AssetsPage.tsx`                                                         |

Writing SubAgent 仍不自动采用正文；完整性问题以助手回合提示 + 人工「要求修改」处理，预算内自动修正未做。

---

## 4. 仍开放项（建议优先级，未授权）

### P0 — 口径与验收边界

- **R4 live 云端只读验收**：仓内 loopback 已证明 Canonical-only 读取零产物、零采用。真实云端 Provider 仍 NOT VERIFIED，标准见工作台架构 §14.5。不得把 Manifest exposure 或 Mock 说成 R4 VERIFIED。
- **文档与代码一致**：本轮只收口权威文档与用户指南；历史审计只加校正头。

### P1 — 进入下一 Agent 阶段前

- **GAP-02**：`generate_*` 对模型仍是 candidate validator，名称与生成语义相反。
- **GAP-04**：TypeScript Registry、DSH allowlist、Gateway 三份清单并行。
- **GAP-06 / GAP-07 / GAP-08**：部分只读 TS Tool 未进 DSH；更细领域 facade 与模型可见 permission/confirmation 未齐。
- **GAP-12**：自主创作、设定推演、大纲页与工作台并存，用户可见双入口（不是双事实源伪造，但是并行主路径）。
- **GAP-13**：章节绑定已持久化；跨任务并发冲突投影仍需按会话事实加强。
- **SubAgent 预算内自动修正**：当前不自动重跑完整性失败。
- **Context / Quality SubAgent**：未开始设计，NOT READY。

### P2 — 产品增强与清理

- **GAP-14**：插件健康只证明目录/组合，不是逐 Tool 可调用。
- **GAP-17**：完整 Rust 套件并发时 DSH restart 测试有时序敏感性。
- EPUB / PDF / Markdown / DOCX 参考导入（需新依赖，另议）。
- 全书分析 UI、关系图 / 地图 / 时间线、自动 embedding、出版导出、系统托盘常驻。
- Provider 账单对账、流式能力协商降级。

---

## 5. 明确不宣称

- 不宣称 R4 VERIFIED。
- 不宣称全部生产写章都走 DSH；mock / 本地 / 浏览器仍是确定性 Writer。
- 不宣称 Main Agent 对所有意图做 LLM 工具选择；问候与部分路由仍是宿主分流。
- 不把历史 `catalog_only` 或三个 BROKEN 入口写成当前代码状态。
- 本文不授权实现上表任何仍开放项。

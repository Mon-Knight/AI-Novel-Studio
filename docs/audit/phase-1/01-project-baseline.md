# Phase 1 项目与运行基线

> 审计日期：2026-07-10（Asia/Shanghai）  
> 审计对象：`D:\ztp\work\AI-Novel-Studio-main`  
> 远端仓库：`Mon-Knight/AI-Novel-Studio`  
> 审计性质：只读架构与行为基线；除本目录八份报告外未修改业务源码、Schema、迁移或依赖文件。

## 1. 结论摘要

- 项目是 React 18 + TypeScript + Vite 5 的 Tauri 1 桌面应用，Rust 后端通过 `rusqlite` 操作单机 SQLite，通过阻塞式 `reqwest` 调用 OpenAI-compatible Chat Completions。
- 当前前端生产构建在同一源码快照上曾完整成功；本阶段的隔离环境复跑在 TypeScript 完成后，因 Vite 无权在项目根目录创建临时配置文件而失败，属于本次执行环境写权限问题，不能视为源码编译失败。
- `cargo check` 成功并产生 10 条 warning；`cargo test` 为 2 通过、1 失败。失败测试的临时库只创建 `ai_task_records`，而删除逻辑还访问 `chapter_drafts` 等子表。
- 仓库提供的运行时测试脚本会在内部 Rust 测试失败时仍向 npm 返回退出码 0，是确定的“假绿”测试缺口。
- 本地交付物是无 `.git` 的 ZIP 解压目录。因此无法证明工作区是否干净，也无法把本地文件精确映射到某一提交。历史复审使用 GitHub 只读提交数据补充，但本地与远端提交的对应关系标记为“待验证”。

## 2. 证据等级

| 等级     | 本报告中的含义                                 |
| -------- | ---------------------------------------------- |
| 已确认   | 静态代码与本阶段运行结果共同支持               |
| 代码确认 | 当前本地代码可直接证明，但未做对应动态场景验证 |
| 高度可能 | 证据链完整但缺真实 UI/故障注入验证             |
| 待验证   | 当前交付物或环境不足以确认                     |

## 3. 仓库身份与可追溯性

| 项目             | 结果                                             | 证据                                                                       | 置信度           |
| ---------------- | ------------------------------------------------ | -------------------------------------------------------------------------- | ---------------- |
| 本地 Git 工作区  | 不是 Git 工作区；`.git` 不存在                   | 在项目根目录执行 `git status` / `git log` 均返回 `not a git repository`    | 已确认           |
| 工作区是否干净   | 无法判断                                         | 缺失 index、HEAD、对象库与基线提交                                         | 待验证           |
| 本地版本         | `2.1.0`                                          | `package.json:3`、`src-tauri/Cargo.toml:3`、`src-tauri/tauri.conf.json:12` | 代码确认         |
| 远端最近提交     | `a9bcf7a80f6a...`，提交说明 `1.7.22`，2026-06-27 | GitHub 只读提交记录                                                        | 已确认（仅远端） |
| 本地对应远端 SHA | 无法证明                                         | ZIP 无 Git 元数据；仅能看到本地包含该提交涉及的状态模型等实现              | 待验证           |

注意：提交说明和 CHANGELOG 只作为“曾经尝试修复”的证据；修复状态最终以当前代码链路为准。

## 4. 技术栈基线

| 类别       | 当前实现                                                                              | 关键证据                                                                                     | 置信度   |
| ---------- | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | -------- |
| 前端框架   | React 18.3.1、React DOM 18.3.1                                                        | `package.json:14-16`；`npm ls --depth=0`                                                     | 已确认   |
| 语言       | TypeScript 5.9.3（锁定解析版本）                                                      | `package.json:27`；`npm ls --depth=0`                                                        | 已确认   |
| 构建工具   | Vite 5.4.21、`@vitejs/plugin-react`                                                   | `package.json:6-8,24,28`；锁文件/安装树                                                      | 已确认   |
| 包管理器   | npm；`package-lock.json` lockfileVersion 3                                            | `package.json` scripts、`package-lock.json:1-8`                                              | 已确认   |
| 路由       | `react-router-dom`，HashRouter                                                        | `src/main.tsx:3,78-86`                                                                       | 代码确认 |
| 状态管理   | React `useState` / props / service；无 Redux/Zustand                                  | `src/pages/WritingWorkspace/WritingWorkspacePage.tsx:84-150`；依赖树                         | 代码确认 |
| 正文编辑器 | 原生 `<textarea>`，非富文本框架                                                       | `src/components/workspace/EditorArea.tsx:71-99,240-279`                                      | 代码确认 |
| 桌面框架   | Tauri v1；前端 API 1.6.0，CLI 1.6.3；Rust 解析 `tauri 1.8.3`                          | `package.json:13,23`；`Cargo.toml:15`；构建日志                                              | 已确认   |
| Rust 要求  | manifest 最低 1.60；本机 1.97.0                                                       | `src-tauri/Cargo.toml:9`；`rustc --version`                                                  | 已确认   |
| SQLite 库  | `rusqlite 0.31`，bundled SQLite                                                       | `src-tauri/Cargo.toml:18`                                                                    | 代码确认 |
| 数据库迁移 | 启动时 `CREATE TABLE IF NOT EXISTS` + `ensure_column`；无版本迁移账本                 | `src-tauri/src/db.rs:76-645,696-1271`                                                        | 代码确认 |
| WAL / 外键 | 启动启用 `journal_mode=WAL` 与 `foreign_keys=ON`                                      | `src-tauri/src/db.rs:49`                                                                     | 代码确认 |
| AI 客户端  | `createAiClient` 选择 mock/real；桌面调用 `ai_chat_completion`                        | `src/services/ai/aiClient.ts:9-25`、`realAiClient.ts:103-156`、`src-tauri/src/ai.rs:108-203` | 代码确认 |
| HTTP       | `reqwest 0.11` blocking + JSON + rustls                                               | `src-tauri/Cargo.toml:23`、`src-tauri/src/ai.rs:1,154-173`                                   | 代码确认 |
| 流式输出   | 未实现；客户端等待完整 JSON 响应                                                      | `realAiClient.ts:137-194`、`src-tauri/src/ai.rs:147-203`                                     | 代码确认 |
| 测试框架   | 3 个 Rust `#[test]` + PowerShell 静态/运行时检查；无前端单元/E2E 框架                 | `src-tauri/src/db.rs:1282`、`commands.rs:4372`、`system_accent.rs:63`、`package.json:13-17`  | 已确认   |
| 日志       | `console.*`、`println!`、`eprintln!`；无结构化日志框架                                | `src/services/database/db.ts:84-123`、`src-tauri/src/ai.rs:119-145`                          | 代码确认 |
| 错误处理   | Rust 主要为 `Result<_, String>`；前端 try/catch + UI 文案；浏览器态 localStorage 降级 | `src-tauri/src/commands.rs`、`src/services/database/db.ts:77-137`                            | 代码确认 |

## 5. 主要目录树与职责

```text
AI-Novel-Studio-main/
├─ .agents/、.cursor/            开发代理/编辑器规则
├─ .github/                     GitHub 配置
├─ docs/                        产品、设计、技术、用户文档；本审计位于 docs/audit/phase-1
├─ prompts/                     可外置的生成提示词模板
├─ public/                      静态资源
├─ reports/                     既有验证/发布报告
├─ scripts/agent-workflow/      PowerShell 静态检查和运行时检查
├─ src/
│  ├─ agent/、agent-tools/      代理工作流与项目只读工具
│  ├─ app/                      应用级辅助
│  ├─ components/               工作台、右栏、编辑器、业务组件
│  ├─ pages/                    路由页面
│  ├─ prompts/                  前端提示词/模板辅助
│  ├─ services/                 AI、数据库、上下文、生成任务、质量、导入导出
│  ├─ store/                    右侧栏纯状态变换函数（非全局持久 Store）
│  ├─ types/                    领域 DTO/接口
│  └─ utils/                    Hash、上下文、对话框、格式化等
└─ src-tauri/
   ├─ src/ai.rs                 OpenAI-compatible 非流式请求
   ├─ src/commands.rs           大量 Tauri command、业务规则和 SQL
   ├─ src/db.rs                 SQLite 初始化与增量列迁移
   ├─ src/large_text_save.rs    大文本缓存、分片、事务落库与读取
   ├─ src/outline_commands.rs   大纲相关 command/SQL
   └─ src/main.rs               Tauri command 注册与应用启动
```

源码文件分布显示职责集中在 `src/services`（约 60 个文件）和 `src-tauri/src/commands.rs`。后者同时承担 Tauri 参数接收、部分业务校验、SQL、DTO 映射和错误转换；这是当前事实，不在第一阶段重构。

## 6. 依赖一致性

| 检查                          | 结果                                                                | 证据              | 置信度   |
| ----------------------------- | ------------------------------------------------------------------- | ----------------- | -------- |
| `package.json` 与 lock 根版本 | 均为 `2.1.0`                                                        | 两文件根节点      | 代码确认 |
| 安装树                        | `npm ls --depth=0` 退出 0，无 missing/invalid                       | 本阶段运行记录    | 已确认   |
| 关键解析版本                  | React 18.3.1、Router 6.30.3、Vite 5.4.21、TS 5.9.3、Tauri CLI 1.6.3 | npm 输出          | 已确认   |
| 锁文件是否相对原始提交未变    | 无法判断                                                            | 本地无 Git 元数据 | 待验证   |

本阶段未执行依赖更新、自动修复或 lockfile 写入。

## 7. 构建与测试命令基线

时间为墙钟近似值；warning/error 仅统计该命令直接报告的诊断。

| 命令                                                        | 退出状态 | 成功         |           持续时间 | warning |     error | 失败位置/说明                                                                                                 |
| ----------------------------------------------------------- | -------: | ------------ | -----------------: | ------: | --------: | ------------------------------------------------------------------------------------------------------------- |
| `npm ls --depth=0`                                          |        0 | 是           |               < 5s |       0 |         0 | 依赖树一致                                                                                                    |
| `npm run lint`                                              |        0 | 是           |              约 5s |       1 |         0 | `ChapterEngineeringPanel.tsx:310` 的 `useEffect` 缺 `chapter` 依赖                                            |
| `npm run build`（先前同快照完整运行）                       |        0 | 是           | 6.60s（Vite 阶段） |    2 类 |         0 | 186 modules；主 JS 697.66 kB / gzip 213.93 kB；动态/静态混合导入与 >500k chunk 提示                           |
| `npm run build`（本阶段隔离复跑）                           |        1 | 否（环境）   |              < 10s |       0 |         1 | `tsc` 完成；Vite 创建 `vite.config.ts.timestamp-*.mjs` 时 `EPERM`                                             |
| `cargo fmt --check`                                         |        1 | 否           |               < 5s |     n/a | 多处 diff | `ai.rs`、`commands.rs`、`db.rs`、`large_text_save.rs`、`outline_commands.rs`、`window_state.rs`；未执行格式化 |
| `cargo check`（临时 target）                                |        0 | 是           |              2m44s |      10 |         0 | 4 个 `unused_mut`、6 个 dead/unread 项                                                                        |
| `cargo test`（临时 target）                                 |      101 | 否           |              4m34s |      10 |    1 test | 3 项中 2 通过、1 失败；`chapter_drafts` 表不存在                                                              |
| `npm run test:setting-suggestions`                          |        0 | 是           |               < 5s |       0 |         0 | PowerShell 静态契约检查                                                                                       |
| `npm run test:quality-workspace`                            |        0 | 是           |               < 5s |       0 |         0 | PowerShell 静态契约检查                                                                                       |
| `npm run test:ai-tasks-delete:static`                       |        0 | 是           |               < 5s |       0 |         0 | PowerShell 静态契约检查                                                                                       |
| `npm run test:ai-tasks-delete:runtime`（cargo 未加入 PATH） |        1 | 否（环境）   |                10s |       0 |         1 | 脚本找不到 `cargo`                                                                                            |
| 同上（补齐 PATH、临时 target）                              |    **0** | **否，假绿** |              2m57s |      10 |    1 test | 内部 cargo 测试明确 FAILED，但脚本未传播 `$LASTEXITCODE`                                                      |

### 7.1 前端构建提示

- Vite 报告部分数据库/repository 模块同时被静态和动态导入，因此动态导入不能形成独立 chunk。
- 主 chunk 超过 500 kB。属于 P2 性能/可维护性基线，不证明启动或功能错误。
- 本阶段复跑中的 `EPERM` 是审计沙箱对项目根目录临时文件的限制；同一源码快照的完整构建成功记录仍可证明 TypeScript 与 Vite 构建链可运行。

### 7.2 Rust warning 清单

| 类型              | 位置                                                            |
| ----------------- | --------------------------------------------------------------- |
| `unused_mut`（4） | `src-tauri/src/outline_commands.rs:448,489,509,530`             |
| 从未构造的结构体  | `commands.rs:2461` `UpdateStyleProfileInput`                    |
| 未读取字段        | `commands.rs:4092` `SaveContextRecordInput.id`                  |
| 未读取字段        | `large_text_save.rs:31` `CreateLargeTextSaveSessionInput.title` |
| 从未构造的 DTO    | `large_text_save.rs:88` `LargeTextDocumentDto`                  |
| 未使用函数        | `large_text_save.rs:466` `get_large_text_document_id`           |
| 未读取字段        | `large_text_save.rs:523` `UpdateLargeTextRefInput.target_type`  |

这些项可能是旧链路残留、新链路未接通或预留接口；第一阶段不删除、不修 warning。

### 7.3 Rust 测试结果

| 测试                                                                   | 结果 | 证据                                                                                              |
| ---------------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------- |
| `db::tests::migrates_legacy_characters_table_before_protagonist_index` | 通过 | `cargo test` 输出                                                                                 |
| `system_accent::tests::test_parse_accent_color`                        | 通过 | `cargo test` 输出                                                                                 |
| `commands::tests::ai_task_delete_runtime_insert_list_delete_clear`     | 失败 | `commands.rs:4351-4362` 只建 `ai_task_records`；删除实现访问 `chapter_drafts`，报 `no such table` |

`scripts/agent-workflow/runtime_check_ai_task_delete.ps1:12-16` 直接运行 `cargo test`，但没有在 native command 失败后 `exit $LASTEXITCODE`，所以 npm 外层显示 0。结论置信度：已确认。

## 8. Tauri Release 构建入口

- npm 入口：`package.json:10` 的 `tauri:build -> tauri build`。
- Tauri 会先执行：`src-tauri/tauri.conf.json:6` 的 `beforeBuildCommand: npm run build`。
- 产物来源：`distDir: ../dist`，bundle `targets: all`，Windows 最小窗口 1024×700。
- 本阶段检查了入口与前置链，未执行完整安装包打包；`cargo check`、`cargo test` 和前端生产构建分别建立编译基线。Release 安装/升级/签名仍为待验证。

## 9. SQLite 基线

### 9.1 表清单

| 领域       | 表                                                                                                                                     |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| 项目结构   | `novels`, `volumes`, `chapters`                                                                                                        |
| 世界与人物 | `world_settings`, `rule_systems`, `protagonists`, `settings`, `characters`, `character_states`, `chapter_characters`, `chapter_events` |
| 正文与版本 | `chapter_drafts`                                                                                                                       |
| 章节工程   | `chapter_engineering_states`, `chapter_generation_snapshots`, `generation_jobs`, `generation_step_results`                             |
| AI 旧任务  | `ai_task_records`                                                                                                                      |
| 风格与导入 | `style_profiles`, `output_profiles`, `imported_assets`                                                                                 |
| 上下文     | `chapter_summaries`, `context_records`, `context_read_logs`                                                                            |
| 质量与润色 | `quality_check_reports`, `quality_check_items`, `polish_records`, `quality_fix_runs`                                                   |
| 大文本     | `large_text_documents`, `large_text_chunks`                                                                                            |

证据：`src-tauri/src/db.rs:76-645`、`src-tauri/src/large_text_save.rs:601-639`。主要外键已声明并在启动时启用；未看到数据库迁移版本表或“正文应用操作/撤销”表。

### 9.2 迁移方式

`init_database` 每次启动执行建表语句，再由 `ensure_column` 检查 `PRAGMA table_info` 并补列（`db.rs:696-1271`）。优点是简单、可兼容旧表；缺点是无法回答“某个用户库执行到哪一版迁移”，也没有可回放/可回滚的迁移账本。置信度：代码确认。

## 10. 日志和错误处理基线

- 前端数据库适配层在 Tauri 模式对所有调用加 3 秒 `Promise.race` 超时，超时只结束 JS 等待，不会取消已经进入 Rust 的命令：`src/services/database/db.ts:77-124`。
- Tauri 模式数据库失败不会静默降级到 localStorage；浏览器开发态才走 fallback：`db.ts:84-136`。这是正确的存储隔离方向。
- AI 桌面请求使用阻塞式 `reqwest`，只在 HTTP 完成后返回整段文本：`src-tauri/src/ai.rs:108-203`。
- 错误主要转换为字符串，日志没有 request/task/chapter/revision 的统一关联 ID；生成任务系统有 job id，但旧 `ai_task_records` 与 UI 日志未形成端到端 trace。

## 11. 基线限制

1. 未调用真实 AI、未使用真实用户库、未启动带真实数据的桌面 UI。
2. 没有 `.git`，无法做本地 blame、工作树差异和提交级二分；历史部分使用远端只读信息。
3. 现有“前端测试”实为文本模式静态断言，不会挂载 React、触发异步竞争或操作 SQLite。
4. 未执行 Tauri Release 安装包和应用升级/恢复测试。
5. 构建成功只证明编译链，不证明章节切换、异步任务、正文应用或事务安全。

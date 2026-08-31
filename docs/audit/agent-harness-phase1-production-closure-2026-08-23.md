# AI Novel Studio v3.6.0 第一阶段生产闭环纠偏验收报告

> 验收日期：2026-08-24  
> 工作区：`F:\ai-novel-studio-hotfix-v321`  
> 验收边界：真实 Windows Tauri + WebView2 + SQLite，生成端使用受控 Mock  
> 机器证据：`test-results/e2e/agent-production-closed-loop/closed-loop-evidence.json`

## 一、结论

| 项目                            | 结论                            | 说明                                                                                                |
| :------------------------------ | :------------------------------ | :-------------------------------------------------------------------------------------------------- |
| 第一阶段总体结论                | **CONDITIONAL**                 | 受控桌面闭环、原子采用、失败关闭、模型快照和重启持久化已通过；外部真实模型与自主 Planner 尚未实测。 |
| 受控 Tauri + SQLite + Mock 闭环 | **PASS**                        | 2 部作品、5 个独立章节完成生成、修改、确认审阅、编辑、保存、采用和进程重启校验。                    |
| 外部真实 LLM 决策/生成          | **NOT RUN**                     | 本次未使用真实 API Key，也未产生商业模型调用成本。                                                  |
| Planner / Tool Selection        | **DETERMINISTIC ORCHESTRATION** | 本次证据只能证明确定性生产编排，不证明 LLM 自主规划或自主选工具。                                   |
| DSH 自主 Agent 闭环             | **NOT PROVEN**                  | DSH 协议及 Rust 测试通过，但本次五轮桌面 E2E 不是外部模型驱动的自主 Agent 验收。                    |
| 第二阶段准入                    | **NO**                          | 在真实模型、真实 DSH 自主决策和重复稳定性验收完成前，不进入 Context Agent 等第二阶段工作。          |

本报告不把“真实桌面载体”与“真实外部模型”混为一谈，也不以受控 Mock 的通过结果替代在线模型能力证明。

## 二、本次修复范围

### 2.1 ResultArtifact 与修改稿链路

- 候选正文继续以 `ResultArtifact` 为唯一权威事实，不创建 `candidate-*` 假草稿。
- 修改任务必须绑定同一会话中、同一作品与章节的上一版 `ResultArtifact`；缺少来源时失败关闭。
- 用户指令、上一版候选、检索记忆和目标章节上下文进入生成编译链路。
- Writer 失败不再伪造成功卡片；运行和工具事件收敛为 `failed`，且不产生候选或草稿。

### 2.2 模型快照隔离

- Writer 必须接收冻结的 `TaskModelSnapshot`。
- Provider、Model、Runtime、Base URL、Options 和 Pricing 均从任务快照派生。
- 凭据 Provider 必须与冻结快照一致；快照缺失或配置不一致时拒绝执行。

### 2.3 两阶段审阅与 SQLite 原子采用

- 对话区确认只签发 `ArtifactDecision` 与 `ReviewAuthorization`，不直接写正式正文。
- 写作工作台按授权、作品、章节、产物和内容哈希加载候选；首次保存创建真实草稿。
- `adopt_review_authorized_draft` 在一个 SQLite 事务内完成：
  1. 校验授权、决定、会话、ResultArtifact 与目标章节作用域；
  2. 校验草稿归属、版本 CAS 和完整正文 SHA-256；
  3. 采用草稿并更新 `chapters.adopted_draft_id`；
  4. 消费审阅授权；
  5. 将对应会话收敛为 `completed`。
- 任一步失败全部回滚；相同请求重放保持幂等。

### 2.4 编辑器重载安全

- 审阅候选以稳定来源键只装载一次，父组件重复渲染不再覆盖用户尚未保存的编辑内容。
- 授权已消费时，重启后直接加载已采用草稿，不重新打开旧候选。

### 2.5 E2E 桥与证据安全

- E2E IPC 继续使用显式 allowlist；本次新增的闭环命令仅开放授权、会话、产物和计数查询，原子采用及授权消费命令不暴露给测试桥。
- 证据文件只记录 ID、计数、正文哈希和审阅授权指纹，不保存正文或可复用授权值。
- 测试从 SQLite 会话事实读取“产物卡片 → 运行”关联，不依赖页面元素的偶然渲染顺序。

## 三、真实桌面五轮闭环证据

最终通过运行的时间戳、隔离数据目录和运行标识以机器证据及同目录 `run.json` 为准。

| 指标                |                                              实测值 |
| :------------------ | --------------------------------------------------: |
| 作品                |                                                   2 |
| 独立章节 / 独立会话 |                                               5 / 5 |
| 对话回合            |                                                  20 |
| TaskRun             |                                                  10 |
| ToolCallEvent       |                                        40，全部成功 |
| ResultArtifact      |                             10（5 初版 + 5 修改版） |
| ArtifactDecision    |                                                   5 |
| ReviewAuthorization |                                     5，全部原子消费 |
| 草稿记录            | 10（5 个 UI 初始化占位草稿 + 5 个真实审阅保存草稿） |
| 已采用草稿 / 章节   |                                               5 / 5 |

每一轮均验证：

- 初版与修改版 `artifactId` 不同且同时保留；
- `rawContent` 的 SHA-256 与 `ResultArtifact.contentHash` 一致；
- 修改版包含上一版正文，且两版哈希不同；
- 人工编辑后的正文哈希与采用草稿内容一致；
- 决定、授权、草稿、章节指针和会话作用域一致；
- 两部作品之间无章节、草稿、运行或产物串写。

进程重启证据：机器证据记录重启前后两个非零且不相同的 PID，证明 `browser.reloadSession()` 重新启动了桌面进程。重启后重新打开两部作品的五个章节，正文、已采用状态、会话、运行、工具事件、产物、决定和授权计数保持一致。

上述 PID 和业务 ID 只对应本次隔离 E2E 运行；后续复跑会生成新的值，应以机器证据文件为准。

## 四、门禁结果

| 命令                                                              | 结果                                               |
| :---------------------------------------------------------------- | :------------------------------------------------- |
| `npm run test:workbench`                                          | **PASS**：DSH/代理 14 项 + Workbench 47 项，0 失败 |
| `npm run lint:ci`                                                 | **PASS**：0 error，0 warning                       |
| `npm run build`                                                   | **PASS**：TypeScript 与 Vite 生产前端构建成功      |
| `cargo check --locked`                                            | **PASS**：0 error；3 个 dead-code warning          |
| `cargo test --locked`                                             | **PASS**：320 passed，0 failed，2 ignored          |
| `npm run test:e2e -- --spec agent-production-closed-loop.spec.ts` | **PASS**：1/1，五轮真实 Tauri 闭环及进程重启通过   |
| `npm run test:version-sync`                                       | **PASS**：v3.6.0 全局版本一致                      |
| `npm run test:docs-sync`                                          | **PASS**：文档同步回归门禁通过                     |

本次未执行 `npm run tauri:build`，因此不声明 MSI/NSIS 生产安装包验收通过。

## 五、未证明项与下一步门槛

以下项目不属于本次 PASS 范围：

1. 真实付费或外部 LLM 的在线生成质量、超时、限流和供应商错误行为；
2. LLM 自主 Planner 的工具选择正确性，而非确定性编排；
3. 真实 DSH Session 中由 Agent 自主完成五轮闭环；
4. 多次独立冷启动下的长期稳定性统计；
5. MSI/NSIS 安装包发布验收。

在这些项目形成独立、可审计证据前，第一阶段保持 **CONDITIONAL**，第二阶段准入保持 **NO**。

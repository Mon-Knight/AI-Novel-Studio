# AI Novel Studio v2.3.1 发布说明

发布日期：2026-07-26
阶段：Provider Adapter 与统一执行管线

## 本版完成

v2.3.1 首次把生产 AI 调用接到 v2.3.0 执行事实层。设置中心连接测试与“设定补充”现在使用同一 Provider Adapter；桌面端每次执行都会形成 Task、三类 Snapshot、Attempt、Provider 响应身份和 ResultArtifact。

关键能力：

- Provider 网络调用最多派发一次；数据库提交未知只重放幂等 IPC。
- 已完成 operation 重放直接读取首次 Artifact，不再次消耗 Provider 额度。
- 继续复用现有 Tauri HTTP 超时、Abort 与迟到响应隔离。
- API Key 与 Base URL 不进入任何持久事实、普通日志或 E2E 产物。
- Tauri 字符串形式的 Provider 失败保留已脱敏消息；鉴权/权限错误和请求参数拒绝不再误分类为可重试网络错误。
- 浏览器开发回退不伪造 LocalStorage Task / Artifact。
- 连接测试只允许 `OK`，最大输出为 8 tokens。
- 设定补充只生成候选；未点击确认前，正式设定数据保持不变。

## 版本边界

本版本只迁移两个入口，不修改 SQLite schema，也不迁移质量检查、正文生成、润色、总结或大纲 Provider 流程。未实现 Placement / ApplyPlan、自动正式写入、Planner、Memory、Tool Registry、自动续跑或 Multi-Agent。

## 主要实现文件

- `src/services/ai/providerAdapter.ts`
- `src/services/ai/aiExecutionPipeline.ts`
- `src/services/ai/aiExecutionPipeline.test.ts`
- `src/services/ai/aiSettingsService.ts`
- `src/services/ai/settingExpandService.ts`
- `tests/e2e/provider-pipeline-setting.spec.ts`
- `docs/architecture/provider-execution-pipeline.md`

## 验证

- Provider 管线定向：7/7。
- Node：16/16；tsx：51/51。
- Rust / SQLite：133/133，另 1 项隔离外部数据库测试按设计 ignored。
- ESLint：0 error，保留 1 条既有 React Hooks warning。
- TypeScript + Vite production build：通过。
- Windows Tauri Provider 管线 E2E：1/1。
- Windows Tauri 完整 E2E：12/12；全部使用隔离 SQLite、Mock Provider、外网阻断和进程清理。
- 四组补充门禁：质量工作台、设定建议、AI Task 删除 2/2、项目备份 5/5 全部通过。
- Tauri production build：通过，生成 MSI 与 NSIS。
- 版本同步、生产凭据扫描与 `git diff --check`：通过。

### 真实 API 手动验收

按约束只发起一次连接测试，没有重试：

- system Task，预期 `generic_text@1`；Constraint 记录 `maxTokens = 8`。
- 创建三类 Snapshot 和 1 个 Attempt；Provider 返回失败，Task / Attempt 均安全终结为 `failed`，Artifact 数量为 0。
- 持久事实中未出现 API Key、Authorization、Bearer、Base URL 或 DeepSeek 风格密钥标记。
- 本机 DNS/TCP 443 连通；DeepSeek 官方文档确认当前 Base URL 与 `deepseek-v4-pro` 模型标识有效。
- 本次失败暴露出旧错误字符串会丢失分类信息，代码已补充稳定鉴权/请求拒绝映射及无外网回归测试；为遵守单次调用限制，没有再次请求 Provider。

因此 PA-REAL 如实记录为**未通过**，不使用 Mock 结果替代；其余自动化与桌面 Provider 事实链路全部通过。

## Windows 发布产物

| 产物 | 大小 | SHA-256 |
|------|------|---------|
| `AI Novel Studio_2.3.1_x64_en-US.msi` | 6,443,008 bytes（6.14 MiB） | `1ce93749a9623da1145c9152e5a080deafddcd6deda7d873c61e8961403ee6c2` |
| `AI Novel Studio_2.3.1_x64-setup.exe` | 4,616,914 bytes（4.40 MiB） | `8938e4c3e5e8897311a5d7e2c93a4d16e5ab1ea40f3933a1ace18988337ce390` |

完整验收证据见 [`audit/phase-3/09-v2.3.1-provider-pipeline-acceptance.md`](audit/phase-3/09-v2.3.1-provider-pipeline-acceptance.md)。

## 下一阶段

v2.3.2 将建立 PlacementProposal、ApplyPlan 与 ArtifactTargetLink，使候选结果在用户确认、目标 version/hash 校验和幂等副作用保护下安全进入正式业务数据。

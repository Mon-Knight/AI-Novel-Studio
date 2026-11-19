# Release 运行失败诊断与修复验证

> 非版本任务；应用仍为 v3.7.0。真实云账号连通性未验证，不能将本地回归或隔离桌面结果当成 live Provider 验收。

## 已确认的问题及修复

1. **章节目标与对话要求不一致**：DSH 原先只取章节的 `targetWordCount`。新增任务对话目标解析，优先级为本回合覆盖 → 本任务独立设置 → 章节目标；任务设置从已持久化用户回合恢复，不修改章节、草稿或正式正文。纯设置使用 `ans-local` 回执，绕过凭据与模型预检，并不再在结束时刷新模型插件；无效设置在模型预检前澄清。
2. **越界后无写章修正机会**：3586 字超过 3000 字目标的默认上限 3450，原宿主拒绝本身正确；原恢复仅处理章节总结。现仅对精确宿主长度拒收追加最多两次修正，共享预检后的 480 秒截止时间，保留失败 Run 并重验模型、范围、白名单、必需读取和章节作用域。只在候选合格后创建 Artifact，绝不截断或自动采用。
3. **DSH 完整 API Endpoint 重复拼接**：直接客户端接受 `/v1/chat/completions`，代理却再次追加 `/chat/completions`。已用 loopback 实际复现修前 404，修后保留根地址、`/v1`、租户前缀、完整端点与尾斜杠；同时修正完整 Chat 端点下 Responses 请求应进入相邻 `/responses` 的边界。凭据和路由白名单未放宽。
4. **Gateway 连接测试不可靠**：旧测试复用章节 Scene 请求及 5 Token 预算，可能把截断当成功，空 Provider ID 还会发生冻结身份不一致。改为受治理的 `connection_test`、128 Token / temperature 0、禁止截断、严格 `OK` 响应，不回显异常正文，保留取消与冻结凭据。

## 使用方式

在任务对话单独发送：

```text
本任务目标字数设为3200字
```

确认本地回执给出目标 3200、默认区间 2560～3680，再发送「生成下一章」。只覆盖当前写章回合时使用「生成下一章，目标3000字」。设置页中的字数预览不是任务目标设置；原验收比例卡片保留，不通过放宽默认 80%～115% 来掩盖错误。

## 主要文件

- `src/services/conversation/taskWordTarget.ts`、`taskWritingPreferences.ts`：任务目标解析及持久回合派生。
- `src/services/dsh/taskSessionAdapter.ts`、`src/pages/Workbench/hooks/useWorkbenchTaskRunner.ts`：本地回执、发送预检边界及 DSH 目标传递。
- `src/services/conversation/workbenchChapterWriter.ts`、`src/services/generation/generationContextCompiler.ts`：确定性 Writer 与编译快照使用相同目标。
- `src-tauri/src/services/dsh/task_runtime_chapter_recovery.rs`：有界长度恢复；`task_runtime.rs` 保留调度入口及既有总结恢复。
- `scripts/dsh/model-proxy.mjs`、`src/services/ai/providerAdapter.ts`：完整端点与连接探针修复。
- `tests/real-acceptance/writing-subagent-fault-injection.spec.ts`、`scripts/dsh/mock-workbench-upstream.mjs`：隔离生产 EXE 八场景及确定性候选序列。
- `CHANGELOG.md`、README、用户设置 / 工作流指南及工作台 / Writing SubAgent 契约同步。

## 已执行验证

| 检查 | 结果 |
| --- | --- |
| `node --test scripts/dsh/model-proxy.test.mjs` | 14 passed；含修前失败的完整端点和 Chat / Responses 交叉协议回归 |
| `node --test scripts/dsh/mock-workbench-upstream.test.mjs` | 19 passed；候选序列推进、重置、耗尽及不泄露正文 |
| 对话目标、任务路由、发送 Hook、DSH Adapter、Writer、Compiler 等 8 个直接相关 TS 模块 | 已通过；发现的本地结束后探针、单独本章设置误路由问题已修复并复测 |
| `aiCancellation.test.ts`、`taskRuntimeService.test.ts`、`aiSettingsStore.test.ts` | 已通过；新增 Gateway 三项回归及既有取消 / 凭据边界 |
| `test:workbench` 剩余集合（排除本轮已通过文件，按原脚本执行） | Node 12 + TS 244 passed，0 failed，未重复运行已覆盖模块 |
| `npx vitest run src/services/agents/writingSubAgentContract.test.ts` | 7 passed |
| `cargo check --locked --manifest-path src-tauri/Cargo.toml` | 通过 |
| `node scripts/quality/run-cargo-tests.mjs --filter services::dsh::` | 发现 116 项；115 passed、0 failed、1 ignored；含新增 7 项 SQLite 长度恢复回归，串行运行。忽略项为需显式真实 API 凭据的 full DSH 测试 |
| TypeScript + Vite | `tauri build` 的 `beforeBuildCommand` 已执行 `tsc && vite build`，通过 |
| 受影响文件 ESLint / Prettier、验收目录 TypeScript | 通过 |
| `test:version-sync` / `test:docs-sync` | 通过，版本未升级 |
| `test:component-size` / `test:rust-file-size` / `test:ownership` / `test:ai-request-governance` | 通过，未抬高任何行数或安全阈值 |
| `test:bundle-size` | 通过：入口 105.29 KiB，最大 JS chunk 248.68 KiB |
| `verify:change -- --dry-run` | 最终 72 个已有及本轮变更路径均有归属；既有 CI / 发布脚本改动会选择完整发布矩阵，本任务未冒称运行该矩阵 |

辅助剩余测试执行器首次因转义解析错误在启动测试前退出，修正后上述集合全部通过；不是应用测试失败或跳过。构建仍有既有 dead-code / 动静态导入提示，非零失败没有被忽略。

## 隔离生产桌面验收

状态：**PASS，8 / 8 场景通过，0 失败，耗时 94.384 秒**。指定新生产 EXE 的 SHA-256 与构建后校验一致。首次 WebDriver 会话创建前曾出现端口绑定 `WSAEACCES 10013`：默认 native 端口 5480 落在 Windows 的 5476～5575 排除范围，八个应用场景均未开始。验证 18480 / 19480 可绑定后使用该端口对重试成功，未修改系统策略；首轮失败日志保留，不计作应用场景通过。

- 入口：`npm run test:fault-injection:writing-subagent`。
- 真实生产 EXE + Tauri / Rust / SQLite / 固定 DSH / Gateway；只替换模型为 loopback 上游。
- APPDATA、LOCALAPPDATA、WebView 数据隔离；不打开真实作品库或凭据。
- 官方 EdgeDriver 152.0.4191.66，与本机 WebView2 匹配，Microsoft Authenticode 签名有效。
- 本轮应用场景证据目录：`test-results/fault-injection/release-hotfix-port18480-2026-09-10T14-49-36-607Z/`；驱动端口失败证据仍保留于 `test-results/fault-injection/release-hotfix-2026-09-10T14-45-33-615Z/`。
- 最终脱敏摘要：`test-results/fault-injection/release-hotfix-port18480-2026-09-10T14-49-36-607Z/desktop-regression-summary.json`；细节为同目录 `writing-subagent-fault-injection.json`。

| 场景 | 生产 EXE 实测 |
| --- | --- |
| S1 越权工具 | failed、0 Artifact，PASS |
| S2 跨书候选 | failed、0 Artifact、他书零正式写，PASS |
| S3a 瞬时上游失败 | 传输恢复后 completed、唯一候选，PASS |
| S3b 持续失败与显式重试 | failed → failed → completed，故障未恢复时不误报成功，PASS |
| S5 持续过短 | 88 字候选恰好三次请求 / 三个工具事件 / 三条长度失败 Run，0 Artifact，PASS |
| S6 对话设置 | 3200 目标与 2560～3680 回执跨刷新保留；设置期全部上游请求为 0；生成 3232 字有效候选，原章节目标仍 1000，PASS |
| S7 原报错正向复现 | 目标 3000，3586 → 3009 字，两个 Run 为 failed → completed；修正重新完成四项读取，只有第二份候选有效，PASS |
| S4 中断与重启 | 终止本轮测试 EXE，恢复一条中断运行，显式重试后成功，PASS |

全部场景均验证正式正文、草稿与作品总字数零变化。51 个模型请求全部进入 loopback 完整端点。原 21 个测试进程 PID 均已消失，本 profile 标记进程为 0，driver / native driver / mock 监听均为 0；没有终止无关进程。

## 本地 EXE

已清除 `CARGO_TARGET_DIR`，执行 `npm run dsh:assets` 与 `npx tauri build --bundles none`。固定载体指纹已验证；当前 Gateway 曾清理后重建。

- 路径：`src-tauri/target/release/AI Novel Studio.exe`
- 构建时间：2026-09-10 22:43:46（本机时间）
- 大小：25,489,920 bytes
- SHA-256：`B53C4A57825F84637F6CD5C34CA8E4864C3170481AF84C64212FAA1F80224907`
- 未制作 MSI / NSIS / updater，不是发布或提交 EXE。

## 限制与未执行项

- 未使用真实密钥或真实云 API；不能证明用户当前账号权限、余额、TLS、代理或网络故障已消失。本机载体版本及脱敏日志元数据未显示明确漂移，但历史日志不能覆盖预检错误。若仍失败，需要失败时间、发生位置、脱敏错误码 / HTTP 状态及模型名称；不要提供 Key、保管库或作品库。
- 累计三次候选是回合结束后的**验收预算**，不是 Gateway 派发前硬上限；违规模型可能已进行第四次工具调用，但产物会被拒收且不再恢复。最多两次宿主修正及共享截止时间由宿主强制执行。
- 目标字数不自动扩大任务冻结的输出 Token 预算；高目标配低预算仍可能无法收敛。原正文完整性复核为 advisory，未升级为新门禁。
- 未执行完整发布矩阵、全库 Rust 或真实账号验收；本报告仅声明上述定向 / 领域 / 隔离生产验证。
- 未提交、推送或打 tag；保留开工时全部用户已有修改，未清理、重置或操作真实作品数据库。

# 第二次能力审计：真实 DSH 模型验证记录

## 验证范围

本记录只证明 DSH 真实模型与章节准备提案链路可运行，不把它扩大解释为“全部 Workbench 章节写作已经由 DSH 自主决策”。默认 Windows E2E 仍保持 Mock + 外网阻断，真实模型验证必须显式运行 `test:dsh:real`。

## 已执行结果

执行日期：2026-08-24（Asia/Shanghai）

```text
npm run test:dsh:real
```

运行时使用固定 DSH payload 与本地已构建的 `novel-domain-gateway.exe`；凭据从本机 DSH credential store 临时读取，只通过进程环境传递，未写入仓库、TaskRun 快照、日志或报告。

实测结果：

| 项目              | 结果                                       |
| ----------------- | ------------------------------------------ |
| DSH source commit | `47f943859bef60e4160492346772ded9b24f765a` |
| Provider          | `deepseek-official`                        |
| Model             | `deepseek-v4-flash`                        |
| 上游请求数        | 3（本次；模型可能因校验修复产生 3–4 次）   |
| 工具调用数        | >0（提案校验前后均经过只读工具链）         |
| 输入 Token        | 2,012 + 8,410 + 8,976                      |
| 输出 Token        | 811 + 432 + 5,947                          |
| 最终提案          | schema v1、`dsh_spike_v0`、校验通过        |
| 总耗时            | 53.52 秒                                   |
| 凭据泄露          | 0（输出已脱敏）                            |

这次结果将 GAP-03 从“没有真实模型证据”收敛为：

```text
DSH preparation / real provider smoke = VERIFIED
Workbench chapter_write through DSH = NOT VERIFIED
LLM autonomous Tool selection for the complete Workbench = NOT VERIFIED
独立 Writing SubAgent = NOT VERIFIED
```

## 本地模型暂时复用同一 DSH 协议

真实测试入口支持显式的 `DSH_E2E_BASE_URL` 与 `DSH_E2E_MODEL`：

```powershell
$env:DSH_E2E_BASE_URL = 'http://127.0.0.1:8080/v1'
$env:DSH_E2E_MODEL = 'your-local-model'
npm run test:dsh:real
```

`DSH_E2E_BASE_URL` 只接受 `localhost`、`127.0.0.0/8` 或 `::1` 回环地址；这只把指定 OpenAI-compatible 服务作为 DSH 测试上游，不把本地模型凭据自动复制到生产设置，也不改变生产路由。上游至少必须支持：

runner 的显式参数优先于同名环境变量；没有显式本地 API Key 时，回环 profile 使用 `local-no-key-required` 哨兵，不会读取或发送默认 DeepSeek credential。

- `POST /v1/chat/completions`；
- `stream=true`、SSE `data:` 帧和 `[DONE]`；
- Tool Calling 参数与结果回传；
- DSH 发送的 `stream_options`、`thinking` 和 `reasoning_effort` 字段（可忽略但不能破坏请求）。

需要让 benchmark 也经过代理时，可显式启动 `scripts/dsh/model-proxy.mjs`；代理提供只读 `/v1/models` 投影，便于执行模型身份预检。该投影不代表模型已经通过真实生成或 Tool Calling 验证。

## 仍然阻断放行的事项

- `chapter_write` 仍由 ANS Writer service/orchestrator 执行，未切换为 DSH Agent；这是有意保留的边界，不在本次测试修复中偷偷改变。
- 现有 Windows Tauri E2E 继续阻断外网并强制 Mock，不能用它冒充真实模型证据。
- Local/Gateway 设置不会自动注入 DSH；只有显式 smoke 参数才会选择替代上游。
- Context Agent、统一 Registry 和独立 Writing SubAgent 仍未达到放行条件。

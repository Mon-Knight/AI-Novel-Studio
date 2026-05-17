# AI Novel Studio v1.0.23 发布说明

## 版本主题

全局 AI API 调用链路修复：所有 AI 生成、推荐、检查、润色、总结与大纲能力统一接入设置中心配置的 OpenAI-Compatible API。

## 核心变更

- 新增 Tauri 后端 `ai_chat_completion` 命令，正式 EXE 中通过 Rust/reqwest 请求真实模型，降低 CORS 与 WebView fetch 差异风险。
- 统一 `createAiClient(settings)` 调用入口，API 模式严格校验 Base URL、API Key、模型名称、temperature、maxTokens、timeoutSeconds。
- API 请求统一使用 `/v1/chat/completions` 拼接规则，发送 `max_tokens`，不发送 `top_p`。
- AI 任务记录写入 SQLite `ai_task_records`，记录 runtime/provider/model/status/duration/tokens/error，不记录 API Key。
- 补齐章节总结、风格分析、设定补充、作品总大纲、分卷大纲、章节大纲的真实 AI 调用链路。
- 设置中心测试连接改为真实模型请求，并记录 `connection_test` 任务。

## 验证

- `npm run build` 通过。
- `npm run tauri build` 通过。
- 正式 EXE `src-tauri\target\release\AI Novel Studio.exe` 启动检查通过。

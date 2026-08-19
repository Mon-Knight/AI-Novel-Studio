# AI 模式与模型配置

> AI Novel Studio AI 设置说明

## Mock 模式

Mock 模式允许你在没有 API Key 的情况下体验完整工作流。

- **启用 Mock 模式**：AI 调用返回模拟数据，可测试所有功能
- **关闭 Mock 模式**：需要配置真实 API

## API 配置

### OpenAI 兼容 API

支持所有 OpenAI 兼容接口：

1. 进入「设置中心」
2. 关闭 Mock 模式
3. 填写以下信息：
   - **API Base URL**：如 `https://api.openai.com/v1`
   - **API Key**：你的 API 密钥
   - **模型名称**：如 `gpt-4`、`gpt-3.5-turbo`、`deepseek-chat`

### 支持的模型

- OpenAI：`gpt-4`、`gpt-4-turbo`、`gpt-3.5-turbo`
- DeepSeek：`deepseek-chat`、`deepseek-coder`
- 其他 OpenAI 兼容模型

## 本地章节场景模型

设置中心还提供独立的“本地章节场景模型”配置，不受全局 Mock/API 开关切换影响。推荐将本地
llama-server 配置为：

- Base URL：`http://127.0.0.1:8080/v1`
- 模型：`qwen35-9b-novel-v3`
- API Key：`local-no-key-required`（按本地服务实际要求填写）
- 协议预算：4096 context / 1024 max output
- 采样参数：Temperature、Top P、Top K、Repeat penalty、可选 Seed

启用后，本地路由只用于章节首次生成和 Autonomous 候选正文；章节改写、润色、质检、修稿及其他
AI 任务继续使用全局 Provider。本地服务不可用时不会自动回退到外部模型。

保存设置后可点击「检查本地模型」。桌面端会依次检查 `/health`、`/v1/models` 和单 Beat
smoke 请求，并校验返回模型 ID；检查失败只显示诊断结果，不会改变模型路由或自动改用外部模型。

章节工程面板的「AI 生成候选」使用全局 Provider 规划 Scene/Beat，只生成待确认 JSON 候选；
用户选择「保存候选草稿」或「保存并应用候选」后，才会进入章节工程状态。首次正文生成和
Autonomous 候选会读取已应用的 Scene/Beat，按 Beat 串行调用本地模型并在合并前检查空正文、
`<think>`、required Beat 覆盖和 `finish_reason=length`。

## API Key 安全

- API Key **仅保存在本地**，不会上传到任何服务器
- 设置页面 **脱敏显示**（如 `sk-****...****abc`）
- AI 任务日志 **不保存完整 Key**

## 模型参数

可在设置中调整：

- **Temperature**：生成随机性（0-2）
- **Max Tokens**：最大输出长度
- **Top P**：核采样参数

## 当前限制

- 文档基线：v1.7.11（当前应用版本见 `../version-roadmap.md`）
- 不支持多模型并行调用
- 不支持自定义请求头
- 后续版本将支持更多配置选项

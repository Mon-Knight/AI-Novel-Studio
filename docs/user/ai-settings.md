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

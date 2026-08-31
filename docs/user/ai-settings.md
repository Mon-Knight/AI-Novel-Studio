# AI 模式与模型配置

> AI Novel Studio AI 设置说明

## Mock 模式

Mock 模式允许你在没有 API Key 的情况下体验完整工作流。

- **启用 Mock 模式**：AI 调用返回模拟数据，可测试所有功能
- **关闭 Mock 模式**：需要配置真实 API

## API 配置

### OpenAI 兼容 API

支持所有 OpenAI 兼容接口：

1. 进入「设置中心」→「AI 模型配置」
2. 关闭 Mock 模式
3. 点击「添加模型」，填写显示名称、Provider、API Base URL、API Key 与模型名称
4. 点击「保存为卡片」；已保存模型只显示名称和状态，不展示密钥、地址或采样参数
5. 可继续添加多份 API 模型，用「使用」切换当前模型
6. API Key 仅保留到本次应用会话结束；不会写入 LocalStorage、SQLite、项目备份或 Git。重新打开应用后需要再次填写
7. 新任务选择的本地模型不可用时，可在任务创建并冻结模型前改用当前 API 模型；既有任务、重试和自动总结不会在后台更换冻结模型

### 支持的模型

- OpenAI：`gpt-4`、`gpt-4-turbo`、`gpt-3.5-turbo`
- DeepSeek：`deepseek-chat`、`deepseek-coder`
- 其他 OpenAI 兼容模型

## 当前临时云端正文模式

本地微调模型未训练完成时，推荐只配置“全局 Cloud Provider”，并保持“专用本地正文模型”关闭：

1. 关闭 Mock 模式；
2. 选择 `deepseek` 或 `openai_compatible`；
3. 填写云端 API Base URL、API Key 与模型名称；
4. 保存后执行连接测试。

此时全局 Cloud Provider 同时承担世界观、规划、Scene、质检等导演任务和临时正文任务。已有确认的
Scene/Beat 计划时，Runtime 仍按 `scene-beat-prose-v1` 逐 Beat 生成；没有 Scene 计划时使用原有
云端整章候选流程。两条路径都只生成候选 Artifact，继续经过质量门、人工审核和 Safe Apply。

## 外部模型网关（AI Model Gateway）

支持通过 OpenAI-Compatible API 接入外部 GPU 算力集群、私有云网关或 VPC 网络中的模型服务：

1. 进入「设置中心」→「AI 模型配置」中的外部网关区域；
2. 点击「添加网关模型」保存为卡片（卡片不显示地址、Token 或采样参数，可保存多份）；
3. 勾选「启用外部 AI Model Gateway 接入」；
4. 填写配置：
   - **Base URL**：公网访问必须使用 `https://`，局域网/VPC（如 10.x / 192.168.x / 100.64.x）支持 `http://` 或 `https://`；
   - **API Key / Token**：必填，禁止匿名访问；
   - **模型名称**：网关代理或后端部署的模型名称（如 `qwen35-32b-novel-v1`）；
   - **参数预算**：支持自定义上下文 Token 预算与单次最大输出 Token。
5. 点击「测试当前网关」确认服务可用。

启用后，Beat 正文生成在本地模型不可用或未启用时，将优先调度至外部 AI Gateway；当本地模型启用且为 `AVAILABLE` 时，本地优先；当本地与网关均不可用时，将自动平滑降级至全局云端 Provider。

## 可选本地章节场景模型

设置中心还提供独立的“专用本地正文模型”配置，同样以卡片保存、不展示地址/密钥/采样参数，并可保存多份。它不是生成正文的前置条件，仅供已完成训练、通过
Benchmark 且健康的本机模型接管 Scene/Beat 正文。推荐 llama-server 配置为：

- Base URL：`http://127.0.0.1:8080/v1`
- 模型：`qwen35-9b-novel-v3`
- API Key：`local-no-key-required`（按本地服务实际要求填写）
- 协议预算：4096 context / 1024 max output
- 采样参数：Temperature、Top P、Top K、Repeat penalty、可选 Seed

本地 endpoint 只负责章节首次生成和 Autonomous 候选正文；章节改写、润色、质检、修稿及其他 AI
任务继续使用全局 Provider。默认开启“由云端代写同一 Beat”：本地处于 TRAINING / TESTING /
FAILED、健康失败或 Context 超限时，Router 会自动选择云端且不修改 Scene、Beat 或 Prompt 约束；
若用户关闭该选项，本地不可用时则失败关闭。

保存设置后可点击「检查本地模型」。桌面端会依次检查 `/health`、`/v1/models` 和单 Beat
smoke 请求并校验模型 ID；结果会更新当前进程的健康状态，并从下一个 Beat 起影响路由。生产流量还
要求生命周期 sidecar 提供通过 Benchmark 的 `AVAILABLE` 证据；文件缺失时按 `TESTING` 处理。

章节工程面板的「AI 生成候选」使用全局 Provider 规划 Scene/Beat，只生成待确认 JSON 候选；
用户选择「保存候选草稿」或「保存并应用候选」后，才会进入章节工程状态。首次正文生成和
Autonomous 候选会读取已应用的 Scene/Beat，由 Model Router 选择云端或本地 endpoint，并在合并前
检查空正文、`<think>`、required Beat 覆盖和 `finish_reason=length`。

## API Key 安全

- API Key **仅保留在当前应用进程内存**，应用退出后自动失效
- Key 按 Provider、Base URL 与模型精确绑定，切换模型不会沿用其他模型的 Key
- Key 不写入项目、SQLite、LocalStorage、备份、Git 或应用自有同步服务
- 真实模型调用时，鉴权信息只发送到用户配置且与当前模型匹配的 Provider Endpoint
- 设置页面 **始终脱敏显示**，AI 任务日志与模型快照 **不保存完整 Key**

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

# AI Novel Studio v1.0.22 发布说明

## 版本主题
真实 API 调用端到端修复 + 正式 EXE 版本同步 + 新建作品卡死回归修复

## 一、版本概况
- 版本号：v1.0.22
- 基础版本：v1.0.21
- 技术路线：Tauri + React + TypeScript + SQLite / localStorage

## 二、用户反馈问题（已修复）

### 1. 正式 EXE 版本不正确
- 问题：用户截图显示 v1.0.8，但实际应为 v1.0.22
- 修复：统一 package.json / tauri.conf.json / version.ts / Cargo.toml 为 1.0.22

### 2. 新建作品卡在"创建中..."
- 问题：窗口显示"未响应"，弹窗永久卡在"创建中..."
- 修复：`dbCall` 已有 3 秒 Tauri 超时 + localStorage 降级机制
- 原因分析：极可能是用户运行了旧版 EXE（v1.0.8），该版本缺少降级机制
- 本次确保重新构建 EXE

### 3. Invalid Date
- 已有 `toValidDate()` / `formatDate()` 安全日期工具
- 所有 Novel 都有 `normalizeNovel` 确保日期字段合法
- 原因分析：旧版数据缺乏归一化

## 三、真实 API 调用修复（核心）

### 1. RealAiClient 重写
- URL 拼接：支持多种 Base URL 格式（`/v1`、`/v1/chat/completions`、裸域名）
- 移除 `top_p` 参数（不再发送，避免兼容性问题）
- 增强错误处理：
  - `401` → 提示检查 API Key
  - `403` → 提示检查模型权限/令牌授权
  - `429` → 提示降低频率
  - `5xx overloaded` → 提示服务过载
  - 超时 → 提示检查网络和超时时间
  - 网络失败 → 具体提示

### 2. aiSettingsService.testConnection 重写
- 使用与 RealAiClient 相同的 URL 构建逻辑
- 校验必填字段（baseUrl / apiKey / modelName）
- 详细的错误分类和可读提示
- 连接成功显示延迟和返回内容摘要

### 3. AI 任务记录增强
- AiTaskRecord 新增 `runtimeMode` 和 `provider` 字段
- 所有 AI 服务调用 `aiTaskService.create()` 时传递 runtimeMode 和 provider
- 5 个调用点全部更新：characterGenerate / eventSuggest / qualityCheck / polish / chapterGenerate

### 4. AiGeneratePanel 修复
- `mockMode` → `runtimeMode` 统一切换
- 4 处遗留引用全部修复

### 5. SettingsPage 修复
- `settings.mockMode` → `settings.runtimeMode === 'mock'` 统一
- 4 处遗留引用全部修复

## 四、新增/修改文件

| 文件 | 变更 |
|------|------|
| `package.json` | version 1.0.22 |
| `src-tauri/tauri.conf.json` | version 1.0.22 |
| `src-tauri/Cargo.toml` | version 1.0.22 |
| `src/constants/version.ts` | v1.0.22 |
| `src/types/ai.ts` | AiTaskRecord 新增 runtimeMode/provier |
| `src/services/ai/realAiClient.ts` | 重写 URL 构建、错误处理、移除 top_p |
| `src/services/ai/aiSettingsService.ts` | 重写 testConnection |
| `src/services/ai/aiTaskService.ts` | create() 新增 runtimeMode/provider |
| `src/services/ai/characterGenerateService.ts` | 传递 runtimeMode/provider |
| `src/services/ai/eventSuggestService.ts` | 传递 runtimeMode/provider |
| `src/services/ai/qualityCheckAiService.ts` | 传递 runtimeMode/provider |
| `src/services/ai/polishAiService.ts` | 传递 runtimeMode/provider |
| `src/components/right-dock/panels/AiGeneratePanel.tsx` | mockMode→runtimeMode |
| `src/pages/Settings/SettingsPage.tsx` | mockMode→runtimeMode |

## 五、API 调用策略

- 不发送 `top_p` 参数
- maxTokens 默认 8000
- 连接测试 max_tokens=100
- 所有错误信息对用户可读
- API Key 不进入日志、任务记录、错误提示

## 六、构建说明

```powershell
cd F:\ai-novel-studio
npm install
npm run build
npm run tauri build
```

正式 EXE 路径：`F:\ai-novel-studio\src-tauri\target\release\AI Novel Studio.exe`

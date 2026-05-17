# AI Novel Studio v1.0.21 发布说明

## 版本主题
工作台稳定性收口与右侧 AI 功能统一修复

## 一、版本概况
- 版本号：v1.0.21
- 发布日期：2025-07-10
- 技术路线：Tauri + React + TypeScript + SQLite / localStorage

## 二、核心更新

### 1. 统一 AI Client 架构
- 所有 AI 功能（章节生成、角色生成、事件推荐、质量检查、润色）统一走 `createAiClient()` 工厂
- 新增 `promptBuilder.ts` 统一管理所有任务类型的提示词构建
- MockAiClient 增强：根据系统提示词自动检测任务类型，返回对应的模拟数据（JSON/文本）
- RealAiClient：统一 OpenAI-Compatible Chat Completions 格式请求

### 2. AI 服务重构
- `characterGenerateService`：重写为使用统一 aiClient + 结构化 JSON 输出
- `eventSuggestService`：重写为使用统一 aiClient + 结构化 JSON 输出
- `qualityCheckAiService`：重写为使用统一 aiClient + 结构化 JSON 输出
- `polishAiService`：重写为使用统一 aiClient

### 3. 右侧 AI 面板完善
- 所有 AI 面板（角色、事件、检查、润色）新增 AI 模式状态显示（Mock/API）
- 面板显示当前模式、模型名称
- API 模式但未配置时显示警告提示

### 4. AI 设置优化
- 默认 maxTokens 从 4000 提升至 8000
- maxTokens 上限从 32000 提升至 64000
- Mock/API 互斥逻辑：切换 runtimeMode 时自动同步 mockMode
- 设置页面实时同步两种模式标记

### 5. AI 任务记录
- 所有 AI 功能调用均记录 aiTaskRecords
- 记录包含 runtimeMode / provider / modelName / taskType / status
- API Key 不进入日志和任务记录

### 6. 最小调用次数策略
- 页面加载不自动触发 AI
- 一次用户点击对应一次 API 请求
- 角色、事件、设定推荐一次返回多个候选
- Mock 模式同样走统一接口，不绕过

### 7. 版本号更新
- package.json → 1.0.21
- tauri.conf.json → 1.0.21
- version.ts → v1.0.21

## 三、新增/修改文件

### 新增
- `src/services/ai/promptBuilder.ts` — 统一 Prompt 构建器，支持 6 种任务类型

### 重要修改
- `src/services/ai/mockAiClient.ts` — 增强为支持所有任务类型
- `src/services/ai/characterGenerateService.ts` — 重构为使用统一 aiClient
- `src/services/ai/eventSuggestService.ts` — 重构为使用统一 aiClient
- `src/services/ai/qualityCheckAiService.ts` — 重构为使用统一 aiClient
- `src/services/ai/polishAiService.ts` — 重构为使用统一 aiClient
- `src/services/ai/aiSettingsService.ts` — 默认 maxTokens 提升至 8000
- `src/pages/Settings/SettingsPage.tsx` — maxTokens 上限提升，mockMode 同步
- `src/components/right-dock/panels/CharactersPanel.tsx` — 新增 AI 模式显示
- `src/components/right-dock/panels/EventsPanel.tsx` — 新增 AI 模式显示
- `src/components/right-dock/panels/CheckPanel.tsx` — 新增 AI 模式显示
- `src/components/right-dock/panels/PolishPanel.tsx` — 新增 AI 模式显示
- `src/constants/version.ts` — v1.0.21
- `package.json` — 1.0.21
- `src-tauri/tauri.conf.json` — 1.0.21

## 四、构建说明

执行以下命令构建：
```powershell
cd F:\ai-novel-studio
npm install
npm run build
npm run tauri build
```

正式 EXE 路径：`F:\ai-novel-studio\src-tauri\target\release\AI Novel Studio.exe`

## 五、Mock 模式验证

Mock 模式下所有 AI 功能可用：
1. AI 生成正文 — 返回示例章节正文
2. 角色 AI 生成 — 返回 4 个候选角色（JSON）
3. 事件 AI 推荐 — 返回 4 个候选事件（JSON）
4. 设定 AI 补充 — 返回 3 个候选设定（JSON）
5. 质量检查 — 返回检查报告（JSON）
6. 润色 — 返回润色后正文

每个功能都记录 aiTaskRecords。

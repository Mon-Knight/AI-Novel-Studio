# AI Novel Studio v1.0.26 发布说明

## 版本信息
- 版本号：v1.0.26
- 发布日期：2026-05-18
- 平台：Windows 桌面端

## 本次更新

### 🗑️ 新增：删除作品功能（级联删除）

- **首页作品卡片**：鼠标悬停时左上角显示 🗑️ 删除按钮
- **二次确认**：弹出确认框，明确告知将删除所有关联数据
- **级联删除**：删除作品同时清理分卷、章节、草稿、角色、事件、设定、上下文总结、AI 任务记录等关联数据
- **反查确认**：删除后自动验证作品是否已从列表中彻底移除
- **错误处理**：删除失败时显示明确错误信息

### 📋 新增：Novel `outline` 字段（作品总大纲独立字段）

- `Novel` 类型新增 `outline` 字段，与 `description`（作品简介）区分
- `CreateNovelInput` / `UpdateNovelInput` 新增 `outline` 可选字段
- `novelNormalizer` 支持 `outline` 的归一化和旧数据兼容
- `novelRepository.create` 默认为 `''`
- AI 生成正文优先使用 `novel.outline`（为空时降级到 `novel.description`）
- prompt 模板中区分显示「作品简介」和「作品总大纲」

### 🎨 新增：AI 生成面板风格方案与输出控制下拉选择

- AI 生成面板新增「风格方案」和「输出控制」两个下拉选择框
- 自动加载当前作品可用的风格方案和输出控制配置
- 选中后显示方案摘要（视角、基调、节奏、对话/描写比例等）
- 生成正文时将选择传入 `buildChapterContext`，注入到 prompt 中
- `ai_task_records` 的 `inputSummary` 记录所选方案名称

### 📦 修改文件清单

| 文件 | 修改 |
|------|------|
| `src/types/novel.ts` | Novel 新增 `outline`；CreateNovelInput/UpdateNovelInput 新增 `outline` |
| `src/features/novels/novelNormalizer.ts` | normalizeNovel 新增 outline 字段处理 |
| `src/services/database/novelRepository.ts` | create 包含 outline；新增 `deleteCascade` |
| `src/services/novels/novelService.ts` | 新增 `deleteNovelCascade` |
| `src/components/novel-card/NovelCard.tsx` | 新增 `onDelete` 回调 + 删除按钮 |
| `src/pages/Home/HomePage.tsx` | 集成级联删除逻辑 + 二次确认 |
| `src/styles/home.css` | `.novel-card` 增加 position:relative + 删除按钮样式 |
| `src/services/prompt/contextBuilder.ts` | 优先使用 novel.outline；传递 novelDescription |
| `src/components/right-dock/panels/AiGeneratePanel.tsx` | 新增风格/输出下拉选择 + 传入 buildChapterContext |
| `src/constants/version.ts` | v1.0.25 → v1.0.26 |

### 📦 构建
- 正式 EXE：`src-tauri\target\release\AI Novel Studio.exe`
- 大小：约 10.5 MB

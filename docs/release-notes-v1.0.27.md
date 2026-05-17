# AI Novel Studio v1.0.27 发布说明

## 版本信息
- 版本号：v1.0.27
- 发布日期：2026-05-18
- 平台：Windows 桌面端

## 本次更新

### 📋 新增：模板中心自定义上传与管理

- **上传模板**：支持 TXT / Markdown / JSON 文件上传
  - TXT/MD：文件名作为模板名，内容作为模板正文
  - JSON：自动解析 name/type/description/content/tags/variables 字段
- **新建模板**：手动创建自定义模板，支持填写名称、类型、说明、标签、正文
- **编辑模板**：支持修改自定义模板的所有字段
- **删除模板**：二次确认后删除，不可恢复
- **复制使用**：一键复制模板内容到剪贴板
- **模板类型**：支持 12 种模板分类（作品设定/总大纲/分卷大纲/章节大纲/章节正文/角色/事件/世界背景/风格方案/输出控制/润色/质量检查）
- **筛选**：按「全部」「系统内置」「我的模板」筛选
- **持久化**：自定义模板存储到本地 localStorage，重启不丢失

### 🗑️ 新增：AI 任务记录删除/清空

- **单条删除**：每条记录右侧 🗑️ 按钮，二次确认后删除
- **多选删除**：点击「多选」进入选择模式，支持全选/反选，批量删除
- **清空全部**：一键清空所有 AI 任务记录（二次确认）
- **按筛选删除**：筛选类型/状态后，「删除当前筛选的 N 条记录」
- **安全边界**：只删除 ai_task_records，不影响作品、章节、草稿、大纲、角色或设定
- **反查验证**：删除/清空后验证数据确实移除

### 📦 修改文件清单

| 文件 | 修改 |
|------|------|
| `src/services/templates/templateService.ts` | 新增用户模板服务（CRUD + 类型枚举） |
| `src/pages/Templates/TemplatesPage.tsx` | 重写：上传/新建/编辑/删除 + 我的模板列表 |
| `src/services/ai/aiTaskService.ts` | 新增 deleteOne/deleteMany/clearAll |
| `src/pages/AiTasks/AiTasksPage.tsx` | 重写：多选/批量删除/清空 + 按筛选删除 |
| `src/constants/version.ts` | v1.0.26 → v1.0.27 |

### 📦 构建
- 正式 EXE：`src-tauri\target\release\AI Novel Studio.exe`
- 大小：约 10.5 MB

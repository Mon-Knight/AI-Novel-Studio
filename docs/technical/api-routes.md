# API 路由说明

> 当前状态：🚧 占位文档

## 当前路由结构

| 路径 | 页面 | 组件 |
|------|------|------|
| `/` | 作品管理首页 | `HomePage` |
| `/novels/:novelId` | 作品详情 | `NovelDetailPage` |
| `/novels/:novelId/workspace` | 写作工作台 | `WritingWorkspacePage` |
| `/novels/:novelId/outline` | 大纲编辑器 | `OutlineEditorPage` |
| `/styles` | 风格方案管理 | `StyleProfilesPage` |
| `/settings` | 设置中心 | `SettingsPage` |
| `/assets` | 创作资产 | `AssetsPage` |
| `/templates` | 模板中心 | `TemplatesPage` |
| `/ai-tasks` | AI 任务记录 | `AiTasksPage` |
| `/import-export` | 导入导出 | `ImportExportPage` |
| `/coming-soon` | 即将开放 | `ComingSoonPage` |
| `*` | 404 | `NotFoundPage` |

## 后续补充方向

- Tauri 后端 API 接口说明
- AI 服务层接口说明
- 数据库服务接口说明

> 当前版本：v1.7.11
> 本文档不表示功能已完成，仅标记文档位置。

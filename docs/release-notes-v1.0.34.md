# AI Novel Studio v1.0.34 发布说明

## 发布时间
2026-05-18

## 版本概述
本次更新修复了风格方案的核心持久化问题：风格方案不再只停留在 localStorage 临时状态，而是真实写入 SQLite 数据库。同时新增 active 风格方案机制，确保 AI 生成正文、大纲时自动读取当前采用风格方案。

## 关键修复

| 问题 | 修复 |
|---|---|
| 风格配置离开页面后恢复默认 | ✅ 数据真实保存到 SQLite |
| 没有"当前采用"风格概念 | ✅ 新增 active 机制（唯一激活） |
| AI 生成不读取风格方案 | ✅ 正文+大纲生成均自动加载 |
| 大纲生成缺少风格约束 | ✅ outlineGenerateService + outline_commands 均已接入 |
| 风格删除/切换不同步 | ✅ 删除 active 自动激活下一个 |

## 后端新增

### 5 个新 Tauri 命令
| 命令 | 说明 |
|---|---|
| `list_style_profiles` | 列出作品所有风格方案 |
| `get_active_style_profile` | 获取当前采用方案 |
| `save_style_profile` | 保存/更新（所有字段完整写入） |
| `set_active_style_profile` | 设置为唯一当前采用 |
| `delete_style_profile` | 删除（自动转移 active） |

### 上下文增强
- `build_outline_context` (Rust) 现在读取完整风格字段（叙事人称/文风/节奏/对话比例/描写比例/禁用写法）
- `outlineGenerateService` (TS) 现在自动加载 active 风格方案

## 前端改动

### styleProfileService 全面重写
- 优先使用 Tauri/SQLite，浏览器模式 fallback 到 localStorage
- 新增 `getActive()` / `setActive()` / `remove(projectId, id)`
- DTO ↔ StyleProfile 类型转换

### AI 生成链路
| 生成类型 | 风格接入方式 |
|---|---|
| 章节正文 (AiGeneratePanel) | contextBuilder → buildStyleSummary → prompt |
| 总纲/分卷/章节大纲 (OutlineManager) | outlineGenerateService.buildOutlineContext → prompt |
| 大纲编辑器 (OutlineEditor) | 同上 |
| 章节总结 (ChapterSummaryPanel) | 间接通过 contextBuilder |

## 修改文件
```
修改:
  src-tauri/src/commands.rs         +200行 (5个新命令)
  src-tauri/src/outline_commands.rs 更新风格读取
  src-tauri/src/main.rs             注册5个新命令
  src/services/styles/styleProfileService.ts 重写 (Tauri+fallback)
  src/services/ai/outlineGenerateService.ts  接入active风格
  package.json / Cargo.toml / tauri.conf.json / version.ts → 1.0.34

新增:
  docs/release-notes-v1.0.34.md
```

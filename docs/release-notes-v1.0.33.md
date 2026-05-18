# AI Novel Studio v1.0.33 发布说明

## 发布时间
2026-05-18

## 版本概述
本次更新实现了总纲、分卷大纲、章节大纲的可编辑化与完整上下文驱动推演系统。大纲不再是 AI 一次性输出的只读文本，而是支持编辑、保存、版本管理、设置为采用版本，并且 AI 推演时会自动加载主角背景、世界设定、风格画像等完整创作上下文。

## 核心改动

### 🗄️ 数据库新增
- `master_outlines` — 作品总纲表（支持多版本、active 标记）
- `volume_outlines` — 分卷大纲表
- `chapter_outlines` — 章节大纲表
- 3个对应索引

### 🔧 后端新增（13个 Tauri 命令）
| 命令 | 说明 |
|---|---|
| `build_outline_context` | 读取完整创作上下文（主角/世界/规则/风格/已有大纲） |
| `save_master_outline` | 保存总纲（支持覆盖/新版本） |
| `get_master_outline` | 获取当前采用总纲 |
| `get_master_outline_versions` | 获取总纲历史版本列表 |
| `set_active_master_outline` | 设置为采用版本 |
| `save_volume_outline` | 保存分卷大纲 |
| `get_volume_outline` | 获取当前采用分卷大纲 |
| `get_volume_outline_versions` | 获取分卷大纲历史版本 |
| `set_active_volume_outline` | 设置为采用版本 |
| `save_chapter_outline` | 保存章节大纲 |
| `get_chapter_outline` | 获取当前采用章节大纲 |
| `get_chapter_outline_versions` | 获取章节大纲历史版本 |
| `set_active_chapter_outline` | 设置为采用版本 |

### 🎨 前端新增
- **OutlineEditor 组件** (`src/components/outline/OutlineEditor.tsx`)
  - 手动编辑大纲内容（标题 + 正文）
  - AI 生成大纲（自动加载完整上下文）
  - 保存 / 保存为新版本
  - 设为采用版本
  - 查看生成上下文摘要（主角、世界、风格）
  - 版本历史显示
  - Ctrl+S 快捷键保存
  - 未保存提醒
- **OutlineEditorPage** (`src/pages/OutlineEditor/`)
  - 三级大纲选择（总纲/分卷/章节）
  - 分卷/章节下拉选择器
  - 路由：`/novels/:novelId/outline`
- **outlineService** (`src/services/outlines/outlineService.ts`)
- **大纲类型定义** (`src/types/outline.ts`)

### 🧠 上下文驱动推演
AI 生成大纲时自动加载：
- 作品名称、题材、简介
- 世界背景设定
- 世界规则体系
- 主角名称、身份、性格、目标
- 主角特殊能力及限制
- 已采用总纲
- 已有分卷/章节列表
- 风格画像摘要
- 输出控制配置

### 🔗 加载弹窗与防重复
- AI 生成过程接入 LoadingModal（进度 + 阶段文案）
- 保存操作接入 LoadingModal
- 生成期间按钮禁用，防止重复点击

## 修改文件
```
新增:
  src-tauri/src/outline_commands.rs    - 大纲后端命令（~550行）
  src/types/outline.ts                 - 大纲类型定义
  src/services/outlines/outlineService.ts - 大纲服务层
  src/components/outline/OutlineEditor.tsx - 大纲编辑器组件
  src/pages/OutlineEditor/OutlineEditorPage.tsx - 大纲编辑器页面
  docs/release-notes-v1.0.33.md

修改:
  src-tauri/src/main.rs       - 注册 outline_commands 模块 + 14个命令
  src-tauri/src/db.rs         - 调用 create_outline_tables
  src/App.tsx                 - 添加 /novels/:novelId/outline 路由
  src/types/index.ts          - 导出 outline 类型
  package.json / Cargo.toml / tauri.conf.json / version.ts → 1.0.33
```

## 版本管理规则
| 操作 | 处理 |
|---|---|
| 第一次 AI 生成 | version = 1, status = draft |
| 用户直接保存 | 覆盖当前版本 |
| 用户保存为新版本 | version + 1 |
| 用户设为采用 | is_active = 1, 同 project 下其他版本 is_active = 0 |

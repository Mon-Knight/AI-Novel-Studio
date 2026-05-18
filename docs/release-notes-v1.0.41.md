# AI Novel Studio v1.0.41 发布说明

## 版本信息
- **版本号**: v1.0.41
- **发布日期**: 2026-05-18
- **类型**: 写作工作台链路修复

## 核心修复

### 1. 本章目标可编辑并参与生成
- 大纲查看面板中的「本章目标」改为可编辑 textarea。
- 本章目标复用 `chapters.goal` 字段，按章节独立保存。
- 保存本章目标接入全局 Loading 弹窗，保存失败保留用户输入。
- 切换章节、关闭面板或返回时会提示未保存的本章目标修改。
- 章节大纲生成和正文生成都会读取当前章节目标，并在 prompt 中明确写入【本章目标】。

### 2. 主角同步到角色库并可选本章出场
- 进入角色栏时同步作品主角到 `characters` 表，不重复创建主角。
- 右侧角色栏新增「主角快捷项」，可一键设置主角本章出场/不出场。
- 主角同时显示在角色库中，并带有「主角」标识。
- 主角加入本章后写入 `chapter_characters`，移除后本章不再强制主角出场。
- 正文生成上下文会读取主角档案、本章出场角色和主角本章出场状态。

### 3. 数据库兼容与防重复
- 旧数据库自动补齐 `chapters.goal`、`chapter_characters` 等兼容字段。
- `chapter_characters(chapter_id, character_id)` 增加唯一索引，并在建索引前清理旧重复记录。

## 修改文件
- `src/components/right-dock/panels/OutlinePanel.tsx`
- `src/components/right-dock/panels/CharactersPanel.tsx`
- `src/components/right-dock/panels/AiGeneratePanel.tsx`
- `src/components/right-dock/RightPanel.tsx`
- `src/pages/WritingWorkspace/WritingWorkspacePage.tsx`
- `src/services/ai/outlineGenerateService.ts`
- `src/services/ai/promptBuilder.ts`
- `src/services/characters/characterService.ts`
- `src/services/characters/chapterCharacterService.ts`
- `src/services/prompt/contextBuilder.ts`
- `src/services/prompt/promptOrchestrator.ts`
- `src-tauri/src/commands.rs`
- `src-tauri/src/db.rs`
- `prompts/chapter_generate.md`

## 验证结果
- `npm run build` → 通过
- `npm run lint` → 0 errors, 49 warnings
- `cd src-tauri && cargo test` → 通过
- `npm run tauri dev` → 开发模式启动成功

# AI Novel Studio v1.0.36 发布说明

## 版本信息
- **版本号**: v1.0.36
- **发布日期**: 2026-05-18
- **类型**: 功能修复

## 核心修复：主角同步角色库与本章出场角色

### 问题背景
写作工作台右侧栏"角色管理"面板中，角色库无法显示已设定的主角信息，导致：
- 角色库显示为 0
- 无法将主角加入本章出场角色
- AI 生成无法稳定读取主角档案

### 修复内容

#### 1. 数据库迁移
- `characters` 表新增 `is_protagonist` 列（INTEGER, 默认 0）
- 新增 `idx_characters_protagonist` 索引
- 自动迁移已有数据库（`ensure_character_columns`）

#### 2. Rust 后端新命令
- `sync_protagonist_to_character_library` — 从 protagonists/novels 表同步主角到 characters 表（upsert）
- `get_protagonist_character` — 从 characters 表读取主角角色
- `list_characters` — 列出作品所有角色（主角优先排列）
- `create_character` — 创建角色
- `update_character` — 更新角色
- `delete_character` — 软删除角色
- `add_chapter_character` — 添加章节出场角色（防重复）
- `list_chapter_characters` — 列出章节出场角色
- `remove_chapter_character` — 移除章节出场角色

#### 3. 前端服务层更新
- `characterService` 重写为 Tauri/SQLite 优先，localStorage 降级
- `chapterCharacterService` 重写为 Tauri/SQLite 优先，localStorage 降级
- 新增 `syncProtagonist()` 和 `getProtagonist()` 方法
- localStorage 回退支持从 novels/protagonists 同步主角

#### 4. CharactersPanel 面板优化
- 面板打开时自动同步主角到角色库
- 主角以 ⭐ 图标特殊标识
- 显示主角详细信息（身份、性格、目标、行为限制）
- "⭐ 加入本章"按钮（主角自动分配 `main` 角色）
- AI 候选角色自动过滤与主角同名角色
- 角色去重检查（已在本章的角色不再显示添加按钮）
- 章节未选择时禁用添加按钮

### 修改文件
- `src-tauri/src/db.rs` — characters 表 is_protagonist 列 + 迁移
- `src-tauri/src/commands.rs` — 9 个角色管理命令
- `src-tauri/src/main.rs` — 新命令注册
- `src/services/characters/characterService.ts` — Tauri 优先重写
- `src/services/characters/chapterCharacterService.ts` — Tauri 优先重写
- `src/components/right-dock/panels/CharactersPanel.tsx` — 主角同步与 UI
- `package.json` — 版本号 1.0.36
- `src-tauri/tauri.conf.json` — 版本号 1.0.36

### 验收标准
- ✅ 角色库不再无故显示 0
- ✅ 作品已有主角时，角色库必须显示主角
- ✅ 主角可以加入本章出场角色
- ✅ 本章出场角色区域能显示主角
- ✅ 主角不会被重复同步出多条
- ✅ AI 推荐候选角色不会覆盖主角
- ✅ 项目正常构建（npm run build + cargo check）

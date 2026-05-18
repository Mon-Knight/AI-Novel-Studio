# AI Novel Studio v1.0.38 发布说明

## 版本信息
- **版本号**: v1.0.38
- **发布日期**: 2026-05-18
- **类型**: 数据库兼容性修复

## 核心修复
- 修复旧 SQLite 数据库中的 `characters` 表缺少 `is_protagonist` 字段时，启动阶段创建 `idx_characters_protagonist` 索引导致后端崩溃的问题。
- 在创建依赖新字段的索引前，先执行 `characters` 表字段迁移。
- 补齐角色库和主角同步功能需要的兼容字段，包括 `role_type`、`source_type`、`gender`、`ability`、`relationship_notes` 等。
- 保持迁移幂等，重复启动不会重复添加字段，也不会清空旧作品、章节或角色数据。

## 修改文件
- `src-tauri/src/db.rs` - 拆分基础建表、迁移、索引创建顺序，并新增角色表迁移测试
- `package.json` - 版本号更新到 1.0.38
- `package-lock.json` - 版本号更新到 1.0.38
- `src-tauri/tauri.conf.json` - 版本号更新到 1.0.38
- `src-tauri/Cargo.toml` - 版本号更新到 1.0.38
- `src-tauri/Cargo.lock` - 版本号更新到 1.0.38
- `src/constants/version.ts` - 应用显示版本更新到 v1.0.38

## 验收重点
- 旧数据库启动时自动补齐 `characters.is_protagonist`
- `idx_characters_protagonist` 在字段迁移后创建
- 已有作品、章节、角色数据不删除、不清空
- 主角同步角色库功能继续可用

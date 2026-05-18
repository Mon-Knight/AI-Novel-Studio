# AI Novel Studio v1.0.31 发布说明

## 发布时间
2026-05-18

## 版本概述
本次更新实现了大文本异步/流式保存 + 临时 JSON 缓存 + 批量入库机制，彻底解决大文本保存时的页面卡顿、超时和数据库写入失败问题。

## 核心改动

### 🚀 新增大文本分片保存管道
- **后端 `large_text_save` 模块**：新增保存会话管理、分片接收、完整性校验、事务批量入库、缓存清理等完整能力
- **前端 `largeTextSave` 工具**：自动检测文本大小，超过 100KB 自动使用分片保存
- **临时 JSON 缓存**：大文本先写入 `save_cache/` 目录下的临时分片文件，校验通过后批量写入 SQLite
- **事务安全**：数据库写入使用 SQLite 事务，任意分片写入失败则回滚，不破坏旧数据

### 🔧 数据库新增
- `large_text_documents` 表：记录大文本文档元数据
- `large_text_chunks` 表：存储大文本分片内容
- 为 `chapter_drafts`、`chapter_summaries`、`context_records`、`style_profiles`、`output_profiles`、`world_settings`、`rule_systems` 表增加 `large_text_ref_id` 列

### 📋 新增 Tauri 命令
- `create_large_text_save_session` - 创建保存会话
- `append_large_text_chunk` - 追加文本分片
- `finalize_large_text_save` - 校验并批量写入数据库
- `abort_large_text_save` - 取消保存并清理缓存
- `cleanup_expired_large_text_save_sessions` - 清理过期缓存
- `read_large_text_content` - 从分片拼装读取完整内容
- `update_large_text_ref` - 更新记录的大文本引用

### 🔄 前端适配
- `draftVersionService` 的 `create()` 和 `update()` 已接入大文本保存
- `getByChapterId()` 和 `getLatestByChapterId()` 自动检测并加载大文本完整内容
- 保存过程支持进度回调（creating → uploading → finalizing → done）
- `AbortSignal` 支持取消保存

### 🛡️ 兼容性
- 旧数据完全兼容：小文本继续走原有保存路径
- 旧章节正常读取
- 不影响现有 UI 布局
- SQLite 数据库自动迁移（新增表和列）

## 修改文件
```
修改:
  src-tauri/Cargo.lock
  src-tauri/Cargo.toml
  src-tauri/src/commands.rs
  src-tauri/src/db.rs
  src-tauri/src/main.rs
  src/services/database/draftVersionService.ts
  src/types/ai.ts
  src/types/index.ts
  package.json
  src-tauri/tauri.conf.json
  src/constants/version.ts

新增:
  src-tauri/src/large_text_save.rs
  src/services/largeTextSave.ts
  src/types/largeTextSave.ts
```

## 技术亮点
- 分片大小：64KB（默认）
- 大文本阈值：100KB
- 过期缓存清理：24小时
- SHA-256 完整性校验
- SQLite WAL 模式 + 事务
- 前端 AbortController 支持取消

# AI Novel Studio v2.2.0 发布说明

> 版本主题：工作区可靠性与基础设施收口
> 目标平台：Windows Tauri 桌面端

## 核心结果

v2.2.0 在 v2.1.8 的正文、任务、质量历史和章节上下文安全基线上，补齐写作工作区的持久化与桌面生命周期闭环。本版本不扩展 AI 自动写入能力，重点保证长正文、未保存修改、异常退出和数据库故障场景可恢复、可验证。

## 正文原子保存与完整性读取

- 新增 `save_chapter_draft_atomic`，正文、长文本 document/chunks、草稿引用与 operation 结果在同一 SQLite `IMMEDIATE` 事务中提交。
- 相同 `operationId` 与请求哈希可安全重放；相同 operation 携带不同 payload 会被拒绝。
- 已采用草稿保持不可变，继续编辑会创建新候选版本。
- 读取完整正文时校验 document 状态、引用、分片数量和顺序、字符数、字节数、逐片及全文 SHA-256。
- 任一完整性校验失败均进入 `unavailable`，预览不会进入编辑器或 AI 上下文。

## 工作区恢复与离开保护

- 新增按作品和章节隔离的恢复快照，dirty 正文 debounce 持久化，不占用正式草稿版本。
- 基线一致时可恢复到编辑器并保持 dirty；基础草稿、版本或哈希冲突时只允许查看、复制、导出或另存候选。
- 章节切换、创建章节、草稿恢复/采用、Hash 路由、历史导航和 Tauri 窗口关闭共用可防重入的 Leave Guard。
- 保存成功后精确清理当前目标快照；保存失败、离开取消或数据库忙时保留恢复内容。

## 迁移与错误契约

- 新增带固定顺序和 checksum 的 `schema_migrations` 正式迁移账本。
- 新增恢复快照、草稿保存 operation 与长文本完整性迁移；旧数据库和旧正文继续兼容。
- Rust 与 TypeScript 共用结构化 `AppError`，包含稳定错误码、重试属性、traceId、operationId 和脱敏 details。
- checksum 冲突或迁移失败会停止后续启动写入，不伪造历史迁移，也不静默降级到 LocalStorage。

## 验证

- Vitest / React Testing Library 覆盖快速切章、Leave Guard 防重入、保存失败、正文不可用、恢复与冲突处理。
- Rust / SQLite 故障注入覆盖迁移账本、正文事务回滚、幂等重放、损坏读取和恢复快照隔离。
- 保留并通过 v2.1.8 的 Node 正文安全、项目备份、请求取消、质量历史和章节上下文动态回归。
- Windows Tauri E2E 与生产构建继续作为正式发布门禁。

## 版本边界

本版本不实现统一 AI Task / Artifact（含 ResultArtifact）、自动续跑、Planner、Memory、Verification、Multi-Agent 或 Agent 自主写入。浏览器 LocalStorage 仅用于开发回退，不替代桌面 SQLite 事务事实源。

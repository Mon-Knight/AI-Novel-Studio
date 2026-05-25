# Database Development Instructions

> 适用于：所有 SQLite 数据库 schema、迁移、查询的开发与修改
> 优先级：极高（数据安全优先）
> 适用范围：`src-tauri/src/` 中数据库相关代码、`src/services/database/`

---

## 1. 总体原则

### 1.1 数据安全第一

AI Novel Studio 存储用户的全部创作资产。数据库操作必须：

- 安全优先
- 向后兼容
- 可回退
- 有备份意识

### 1.2 技术栈

- **数据库**：SQLite（通过 `rusqlite` crate）
- **访问层**：前端通过 Tauri 命令调用 → Rust 层执行 SQL
- **浏览器开发模式**：使用 LocalStorage 模拟

---

## 2. Schema 修改规则（核心）

### 2.1 绝对禁止

| 操作 | 风险 | 替代方案 |
|------|------|----------|
| 删除字段 | 用户数据丢失 | 标记为 deprecated |
| 重命名字段 | 迁移失败 | 新增字段 + 数据迁移 |
| 修改字段类型 | 数据损坏 | 新增正确类型字段 |
| 删除表 | 数据丢失 | 标记不再使用 |

### 2.2 允许的修改

- ✅ 新增字段（`ALTER TABLE ADD COLUMN`，必须有默认值）
- ✅ 新增表（`CREATE TABLE IF NOT EXISTS`）
- ✅ 新增索引（`CREATE INDEX IF NOT EXISTS`）
- ✅ 新增视图（`CREATE VIEW IF NOT EXISTS`）

### 2.3 迁移原则

每次 schema 变更必须：

1. 版本号递增
2. 提供迁移脚本
3. 保留旧数据
4. 可回退到上一个版本

---

## 3. 为 Agent 系统预留空间

### 3.1 预留字段

现有表应考虑未来 Agent 系统的需要，预留以下类型字段：

- `agent_status`：Agent 处理状态
- `agent_metadata`：Agent 元数据（JSON 文本）
- `task_id`：关联的 Agent 任务 ID
- `version`：数据版本号

### 3.2 预留表

未来可能新增的表（不在此版本创建，但 Schema 设计时预留命名空间）：

- `agent_tasks`：Agent 任务记录
- `agent_memory`：Agent 长期记忆
- `tool_calls`：Tool Calling 记录
- `plans`：Planner 计划

---

## 4. 查询规范

### 4.1 参数化查询

所有 SQL 必须使用参数化查询，严禁字符串拼接：

```rust
// ✅ 正确
conn.execute("SELECT * FROM novels WHERE id = ?1", [&novel_id])?;

// ❌ 错误
conn.execute(format!("SELECT * FROM novels WHERE id = '{}'", novel_id))?;
```

### 4.2 事务使用

涉及多表修改的操作必须使用事务：

```rust
conn.execute("BEGIN TRANSACTION", [])?;
// ... 多步操作 ...
conn.execute("COMMIT", [])?;
// 或出错时 ROLLBACK
```

### 4.3 查询性能

- 频繁查询的列必须建立索引
- 避免 `SELECT *`，指定需要的列
- 大文本字段（正文内容）考虑分离存储

---

## 5. 数据库文件

### 5.1 存储位置

- Tauri 模式：`%APPDATA%/ai-novel-studio/`
- 浏览器模式：`localStorage`

### 5.2 文件命名

- 主数据库：`ai-novel-studio.db`
- 备份文件：`ai-novel-studio.backup.db`

---

## 6. 禁止事项

- ❌ 在 UI 组件中直接写 SQL
- ❌ 在多个位置重复数据库逻辑
- ❌ 删除字段或表
- ❌ 不使用参数化查询
- ❌ 不处理数据库错误
- ❌ 在生产代码中使用 `DROP TABLE`
- ❌ 提交 `.db` / `.sqlite` 文件到 Git

---

> **本文件是 AI Novel Studio 数据库开发的权威指令。数据安全是最高优先级。**

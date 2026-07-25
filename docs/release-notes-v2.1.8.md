# AI Novel Studio v2.1.8 发布说明

> 版本主题：章节上下文持久化一致性闭环
> 目标平台：Windows Tauri 桌面端
> 数据结构：无表或字段变更

## 核心结果

v2.1.8 解决章节总结看似保存成功、实际只落到 LocalStorage，或在应用重启后与 SQLite 不一致的问题。桌面模式现在只以 SQLite 为权威；章节总结、上下文记录、角色状态、角色当前状态和章节 `summarized` 终态作为一个业务事务提交。

```text
确认章节总结
-> 校验作品 / 章节 / 已采用草稿 / 角色归属
-> 原子写入总结、上下文和角色状态
-> 更新章节 summarized
-> 提交后返回 SQLite authoritative DTO
```

任何一步失败都会回滚，并把错误显示给调用方。桌面端不再静默改写 LocalStorage 或报告虚假成功。

## 稳定读取与编辑

- 上下文记录使用调用方生成的稳定 UUID，Rust 不再替换 ID。
- 桌面端支持上下文按 ID 读取、完整更新、启停、过期和删除。
- 章节总结支持按作品稳定查询；同章存在历史记录时使用确定性次序选择最新结果。
- 章节总结的过期判断和 AI 生成都只读取当前采用稿；较新的未采用草稿不会参与总结，采用稿读取失败会在调用 AI 前直接返回错误。
- SQLite 列表命令返回非数组等无效契约数据时会明确失败，不再伪装成“没有总结或上下文”。
- 采用另一版正文时，正文指针、章节状态、旧总结与关联上下文在同一 SQLite 事务中切换和过期；不需要先打开总结面板，应用重启后仍保持过期，后续生成不再注入该记录。

## 旧数据迁移

启动迁移会读取旧版 LocalStorage 中的章节总结、上下文和角色状态：

1. 优先匹配相同 ID。
2. 旧双写 ID 不同时，只接受唯一、确定性的镜像匹配。
3. 无唯一候选的记录保留在 LocalStorage，并返回 warning。
4. SQLite 事务提交后，只清理迁移结果中已明确映射的缓存。
5. 缓存清理失败不回滚已提交的 SQLite；再次运行迁移保持幂等，不生成副本。
6. 已插入或匹配的角色状态按稳定的最新次序同步回 `characters.current_state`，修复旧双写留下的状态分裂。

这不是跨 SQLite 与 LocalStorage 的分布式事务。安全保证是 SQLite 先提交、清理范围可证明、失败可重试。

## 浏览器开发模式

浏览器模式仍以 LocalStorage 提供开发回退。保存上下文 bundle 及采用新正文触发旧上下文过期前会保存相关集合快照，任一分步写入失败时恢复全部快照；目标模块的单次写入失败也会向上传播，不再被工具层吞掉。该补偿只用于开发，不替代桌面 SQLite 事务或真实 Tauri 验收。

## 发布门禁

新增版本同步入口：

```powershell
npm run test:version-sync
```

它核对 npm、Cargo、Tauri、前端常量和当前版本文档。统一验证脚本还会运行 Node 动态测试、ESLint、前端构建、Rust / SQLite 完整测试、Windows 真实 Tauri E2E、Tauri 生产构建及 Git 状态。任何失败或脏工作树都会阻断发布建议。

发布前验收命令：

```powershell
npm run test:version-sync
npm run test
npm run lint
npm run build
npm run test:quality-workspace
npm run test:setting-suggestions
npm run test:ai-tasks-delete
npm run test:project-backup

cd src-tauri
cargo check
cargo test
cd ..

npm run test:e2e
npm run tauri:build
git status --short
```

## 版本边界

本版本没有增加或修改数据库列，不引入新依赖，不实现自动续跑、Planner、Memory、v2.2 / v2.3 功能或 Agent 自主写入，也不把浏览器回退声明为桌面发布事实源。

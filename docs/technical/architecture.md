# 项目架构总览

> 当前状态：🚧 占位文档

## 技术栈

| 层级 | 技术 |
|------|------|
| 桌面壳 | Tauri (Rust) |
| 前端 | React 18 + TypeScript 5 |
| 构建 | Vite 5 |
| 路由 | React Router 6 (HashRouter) |
| 数据存储 | SQLite (Tauri) / LocalStorage (浏览器开发) |
| AI 调用 | 统一服务层封装 |
| 提示词 | Markdown 模板独立管理 |

## 架构概览

详见 [project-architecture.md](../project-architecture.md)。

## 后续补充方向

- 完整的架构图
- 模块间依赖关系
- 数据流向图
- 关键设计决策记录

> 当前版本：v1.7.11
> 本文档不表示功能已完成，仅标记文档位置。

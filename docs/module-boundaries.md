# AI Novel Studio — 模块边界文档

> 文件：`docs/module-boundaries.md`  
> 用途：明确各模块的职责边界、可依赖关系和禁止事项  
> 适用：所有开发者 + AI Agent

---

## 1. 模块总览

```text
AI Novel Studio
├─ 🖥️ 桌面壳（Tauri / Rust）
├─ 🎨 UI 层（React / TypeScript）
├─ 🧠 业务逻辑层（Features）
├─ 🔧 服务层（Services）
├─ 🧭 运行时状态层（Zustand Store）
├─ 💾 持久化数据层（Services / Tauri IPC / SQLite）
├─ 📝 提示词系统（Prompts）
└─ 🤖 Agent 系统（预留）
```

---

## 2. 桌面壳模块（src-tauri/）

### 职责

- 提供原生 Windows 窗口
- 管理系统对话框（打开/保存文件）
- 管理 SQLite 数据库连接
- 系统通知
- 打包 Windows 安装包

### 可依赖

- Rust 标准库
- Tauri API
- rusqlite

### 禁止

- 包含前端 UI 逻辑
- 包含 AI prompt 逻辑
- 直接操作 DOM

---

## 3. UI 层模块（src/）

### 3.1 pages/（页面组件）

**职责**：作为路由级组合根，组织页面布局、组合子组件、读取所需的 Store selector 并分发同步 action；业务流程通过 Feature hooks 编排

**禁止**：

- 写业务逻辑
- 直接调用 AI 服务
- 直接操作数据库
- 直接写 SQL
- 把 SQLite 返回前的内存状态当成持久化成功

### 3.2 components/（通用组件）

**职责**：可复用的 UI 组件；单组件表单、弹窗和瞬时反馈使用 React 局部状态，确需跨组件共享的 UI 状态可以使用窄 Store selector

**目录**：

```
components/
├─ layout/        # AppShell, Sidebar, TopBar
├─ sidebar/       # 侧边栏导航项
├─ topbar/        # 顶部状态栏组件
├─ novel-card/    # 作品卡片
├─ workspace/     # 写作工作台组件
├─ right-dock/    # 右侧工具栏与面板
├─ common/        # 通用按钮、输入框、模态框
├─ novel-detail/  # 作品详情组件
├─ chapter-summary/  # 章节总结
├─ context-records/  # 上下文记录
├─ import/        # 导入相关
└─ outline/       # 大纲相关
```

**禁止**：

- 直接调用 AI 服务
- 直接操作数据库
- 包含复杂业务逻辑

### 3.3 styles/（样式文件）

**职责**：CSS 样式

**禁止**：

- CSS-in-JS
- 在样式中定义业务逻辑

---

## 4. 业务逻辑层（src/features/）

### 职责

- 小说 CRUD 操作
- 章节管理逻辑
- 角色管理逻辑
- 大纲管理逻辑
- 风格方案管理
- AI 任务管理

### 可依赖

- services/（服务层）
- store/（状态管理）
- types/（类型定义）

### 禁止

- 直接操作 DOM
- 包含 UI 渲染逻辑
- 直接写 SQL

---

## 5. 服务层（src/services/）

### 5.1 services/ai/

**职责**：

- AI API 调用封装
- AI 任务管理
- Mock 模式支持

**禁止**：

- 包含 UI 代码
- 包含数据库操作

### 5.2 services/database/

**职责**：

- SQLite 数据访问
- Repository 模式封装
- 数据迁移

**禁止**：

- 包含 UI 代码
- 包含 AI 调用

### 5.3 services/prompt/

**职责**：

- 提示词模板管理
- 上下文构建
- Prompt Orchestrator

**禁止**：

- 包含 UI 代码
- 直接调用 AI API

### 5.4 services/import/ & services/export/

**职责**：

- TXT / JSON 导入
- TXT / Markdown 导出

---

## 6. 数据层

### 6.1 store/（状态管理）

**职责**：使用 Zustand 管理当前 WebView 中需要跨组件共享、可订阅的运行时状态

Store 不是数据库，也不是业务事务边界。当前状态所有权如下：

| 状态                                                                                   | 所有者                        | 持久化边界                                                                      |
| -------------------------------------------------------------------------------------- | ----------------------------- | ------------------------------------------------------------------------------- |
| 工作区会话投影：当前作品、卷章、活动章节、当前草稿、编辑器 dirty / 质量结果 / AI 弹窗  | `workspaceSessionStore`       | Feature / Service 读取或提交权威 DTO 后刷新；作品切换时由 `startSession()` 重置 |
| 右侧栏与各工具运行时结果：active / collapsed / output / error / loading / 正文版本关联 | `rightSidebarStore`           | 仅当前工作区运行时；不替代 AI Task、Artifact 或草稿记录                         |
| 主题偏好、有效主题与系统主题快照                                                       | `themeStore`                  | `themeRuntimeService` 负责 LocalStorage、`matchMedia` 和 DOM 副作用             |
| 单个组件的表单、弹窗、局部 loading、未提交编辑缓冲                                     | React 局部状态                | 随组件实例存在，默认不进入 Store                                                |
| 小说、卷章、草稿、AI 任务、成本 ledger、Scheduler lease / checkpoint、正式资产         | Service / Repository + SQLite | 桌面端 SQLite 为权威事实源；浏览器开发回退由对应 Service 管理                   |

**使用规则**：

- pages/ 可以通过 selector 读取 Store，并调用同步 action；这是页面组合职责，不等于页面取得业务数据所有权。
- components/ 可以订阅真正跨组件的 UI Store；只在局部使用的状态继续留在组件内。
- Feature / Service 完成加载、保存、采用或恢复后，以返回的权威 DTO 更新 Store 投影。
- Service 不反向依赖 Store；业务输入必须显式传递，避免隐藏的跨层上下文。

**禁止**：

- 在 Store 内实现数据库、AI Provider、文件、网络、计时器或 DOM 副作用
- 直接操作数据库
- 把 Store 快照当作 SQLite 提交、AI 任务终态或调度 lease 的权威记录

主题是唯一需要绑定浏览器运行时的全局 UI 设置；`themeStore` 只保存和转换状态，具体 LocalStorage / DOM / 媒体查询操作集中在 `services/theme/themeRuntimeService.ts`。

### 6.2 types/（类型定义）

**职责**：TypeScript 类型和接口定义

**禁止**：

- 包含任何运行时代码
- 包含业务逻辑

---

## 7. 提示词系统（prompts/）

### 职责

- AI 提示词模板管理
- 独立于代码的 Markdown 文件

### 禁止

- 在 React 组件中直接写大量提示词
- 在多个地方复制同一段提示词
- 在按钮点击事件中拼复杂 Prompt

---

## 8. Agent 系统

### 职责

- Autonomous Agent 调度
- Tool Calling 管理
- Planner 计划生成
- Long-term Memory 管理
- Multi-Agent 协作

### 当前状态

- v2.5.0：固定持久 Planner、lease、Attempt 与 Checkpoint
- v3.0.0：全书创作 Agent、六专家评审、用户显式启动且可暂停 / 继续的进程内逐章候选队列、采用推进、章节收束与持久恢复
- 当前工作树增量：参考资料与分层风格、SQLite 混合语义 Memory、migration 029 全局请求 owner/TTL reservation、成本硬预算与跨进程速率 / 并发限制
- 后续 v3.x：跨进程恢复与无人值守自动续跑、三档自动化、多目标事务、跨章节批处理及势力 / 地点正式资产

全书规划与逐章编排属于 `src/services/autonomous-creation/`，六专家编排属于 `src/services/multi-agent/`；Prompt 构建属于 `src/services/prompt/` 和根目录 `prompts/`。UI 只调用运行时服务，不直接调用 Provider 或 SQL。

---

## 9. 跨模块交互规则

| 调用方      | 可调用                                                     | 不可直接调用                                |
| ----------- | ---------------------------------------------------------- | ------------------------------------------- |
| pages/      | components/, features/, store/ selector 与同步 action      | AI / database services、SQL                 |
| components/ | common/, types/、共享 UI store/ selector 与同步 action     | AI / database services、复杂 features       |
| features/   | services/, store/, types/                                  | components/（返回数据不渲染）               |
| services/   | 其他 services/, types/                                     | components/, pages/, store/                 |
| store/      | types/、纯 utils/；主题 Store 可绑定 theme runtime service | database / AI services、components/、pages/ |

---

## 10. 禁止的跨模块依赖

- ❌ components → services（UI 组件不直接调 AI）
- ❌ pages → SQL（页面不写 SQL）
- ❌ store → database / AI services（运行时投影不执行持久化或 Provider 调用）
- ❌ services → store（服务输入必须显式传递，不读取隐藏的 UI 会话）
- ❌ styles → types（样式不依赖类型）
- ❌ types → 任何有运行时代码的模块
- ❌ 循环依赖（A → B → A）

---

> **本文件是 AI Novel Studio 模块边界的最权威定义。所有跨模块调用必须参考本文档。**

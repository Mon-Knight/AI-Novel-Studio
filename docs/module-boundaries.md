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
├─ 💾 数据层（SQLite / Store）
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

**职责**：组织页面布局，组合子组件

**禁止**：
- 写业务逻辑
- 直接调用 AI 服务
- 直接操作数据库
- 直接写 SQL

### 3.2 components/（通用组件）

**职责**：可复用的 UI 组件

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

**职责**：全局状态管理

**禁止**：
- 包含副作用
- 直接操作数据库

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

## 8. Agent 系统（预留）

### 未来职责
- Autonomous Agent 调度
- Tool Calling 管理
- Planner 计划生成
- Long-term Memory 管理
- Multi-Agent 协作

### 当前状态
- v1.x：基础设施建设阶段
- v2.x：Agent 化阶段
- v3.x：Autonomous 阶段

---

## 9. 跨模块交互规则

| 调用方 | 可调用 | 不可直接调用 |
|--------|--------|-------------|
| pages/ | components/, features/ | services/, store/ 直接操作 |
| components/ | common/, types/ | services/, features/ |
| features/ | services/, store/, types/ | components/（返回数据不渲染） |
| services/ | 其他 services/, types/ | components/, pages/ |

---

## 10. 禁止的跨模块依赖

- ❌ components → services（UI 组件不直接调 AI）
- ❌ pages → SQL（页面不写 SQL）
- ❌ styles → types（样式不依赖类型）
- ❌ types → 任何有运行时代码的模块
- ❌ 循环依赖（A → B → A）

---

> **本文件是 AI Novel Studio 模块边界的最权威定义。所有跨模块调用必须参考本文档。**

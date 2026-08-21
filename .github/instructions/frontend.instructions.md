# Frontend Development Instructions

> 适用于：所有前端 React/TypeScript 代码的开发和修改
> 优先级：高
> 适用范围：`src/` 下所有 `.tsx` / `.ts` / `.css` 文件
> 版本边界：v3.2.1 页面用于描述当前已发布行为；v3.3.0+ 目标以 `docs/architecture/conversational-creative-workbench.md` 为准

---

## 1. 总体原则

### 1.1 桌面应用优先

AI Novel Studio 是一个 **Windows 桌面写作软件**，不是网页应用。

所有 UI 开发必须遵循：

- 桌面软件视觉风格（非网页后台）
- 窗口化操作习惯（非浏览器标签页）
- 固定布局为主（非流式无限滚动）

### 1.2 统一应用壳

所有页面必须包裹在统一的应用壳中：

```text
AppShell
├─ Sidebar（左侧导航）
├─ TopBar（顶部状态栏）
└─ PageContent（主内容区）
```

不要在页面内部重新发明导航。

---

## 2. 布局规范

### 2.1 v3.3.0+ 创作工作台布局

```text
WorkbenchShell
├─ ProjectTaskTree（小说项目 / 任务树）
└─ TaskConversation
   ├─ TaskHeader（小说、任务、模型、状态）
   ├─ ConversationNodes（消息、工具、错误、产物卡片）
   └─ Composer（任务级模型选择、输入、发送/停止）
```

不另设执行时间线、任务计划、工具或产物详情面板。当前插件只读视图只展示 Runtime Registry，不承担任务执行或插件管理。

### 2.2 原写作工作台 / 章节审阅编辑器

v3.2.1 当前仍保留左卷章树 + 中编辑区 + 右工具栏/弹出 AI 面板。v3.3.0+ 迁移中，只有在对应能力已经进入任务对话、完成等价验证并具备回退路径后，才移除旧 AI 面板；目标编辑器保留卷章树、正文阅读、显式编辑、保存和采用。

### 2.3 作品管理页

```text
Sidebar（左侧导航，~220px）
MainContent
└─ NovelCardList（作品卡片列表）
```

作品管理继续保留，但 v3.3.0+ 不再是默认启动中心。

### 2.4 表单页面

- 表单最大宽度：`720px`
- 禁止无限拉宽
- 复杂表单分组显示，使用折叠面板

---

## 3. 视觉风格

### 3.1 色彩

- 主背景：浅灰白（`#f9fafb` / `#ffffff`）
- 侧边栏：略深灰（`#f3f4f6`）
- 主文字：深灰（`#1f2937`）
- 边框：极淡灰（`#e5e7eb`）
- 强调色：克制使用蓝色系（`#3b82f6`）

### 3.2 字体

```css
font-family: 'Microsoft YaHei', 'Segoe UI', Arial, sans-serif;
```

- 正文编辑区：优先使用等宽或衬线字体
- 字号：正文 15-16px，UI 文字 13-14px

### 3.3 阴影与边框

- 卡片阴影：`box-shadow: 0 1px 3px rgba(0,0,0,0.08)`
- 弹出面板阴影：`box-shadow: -2px 0 8px rgba(0,0,0,0.1)`
- 边框：`1px solid #e5e7eb`
- 禁止大面积炫彩渐变

---

## 4. 组件规范

### 4.1 组件目录

```
src/components/
├─ layout/        # AppShell, Sidebar, TopBar
├─ sidebar/       # 侧边栏导航项
├─ topbar/        # 顶部状态栏组件
├─ novel-card/    # 作品卡片
├─ workspace/     # 写作工作台组件
├─ task-workbench/ # v3.3.0+ 项目/任务树与对话组件
├─ plugin-view/   # 当前插件只读投影
├─ right-dock/    # 右侧工具栏与面板
├─ common/        # 通用按钮、输入框、模态框等
├─ novel-detail/  # 作品详情组件
├─ chapter-summary/ # 章节总结
├─ context-records/ # 上下文记录
├─ import/        # 导入相关
└─ outline/       # 大纲相关
```

### 4.2 组件规则

- 一个组件只负责一个明确 UI 区域
- 页面组件只负责组织布局，不写业务逻辑
- 业务逻辑放 `src/features/`
- 通用 UI 放 `src/components/common/`
- 避免单文件超过 300 行

---

## 5. 禁止事项

### 5.1 绝对禁止

- ❌ 网页后台管理布局（侧边栏 + 表格）
- ❌ 移动端优先的响应式设计
- ❌ 无限宽度页面
- ❌ 大面积炫彩渐变背景
- ❌ 把所有逻辑写在一个组件里
- ❌ 在组件中直接写 SQL 或 AI prompt
- ❌ 使用 `any` 类型（除非有充分理由）

### 5.2 需要克制

- ⚠️ 不要过度抽象（一个组件用不到 3 次就不要提取）
- ⚠️ 不要引入大型 UI 库（如 Ant Design）
- ⚠️ 不要使用 CSS-in-JS（保持样式文件独立）

---

## 6. 2K 屏幕适配

- v3.3.0+ 创作工作台在 2K（2560×1440）下完整显示项目/任务树、任务对话与输入区
- 原章节审阅/编辑器在适用版本中保证卷章树与正文区域可见
- 最小支持宽度：1280px
- 推荐窗口大小：1440×900 到 2560×1440

---

## 7. 原右侧工具栏与弹出面板

本节只约束 v3.2.1 当前页面和迁移期回退路径，不是 v3.3.0+ 创作工作台的目标主布局。

### 7.1 工具栏

- 固定在写作工作台右侧
- 宽度约 48px
- 纵向排列图标按钮
- 每项：AI生成 / 大纲 / 角色 / 事件 / 设定 / 风格 / 检查 / 润色

### 7.2 弹出面板

- 点击图标展开，再次点击收回
- 宽度 320-380px
- 打开时覆盖在正文区上方（不挤压正文区布局）
- 点击正文区自动收回
- 按 Esc 自动收回
- 切换章节自动收回

---

## 8. 路由规范

以下为 v3.2.1 当前路由，不得在规划文档阶段擅自删除：

```text
/                       → Home（作品管理首页）
/novels/:novelId        → NovelDetail（作品详情）
/novels/:novelId/workspace → WritingWorkspace（写作工作台）
/styles                 → StyleProfiles（风格方案管理）
/settings               → Settings（设置中心）
/coming-soon            → ComingSoon（未开放功能提示）
```

使用 HashRouter（`createHashRouter`），保持桌面端路径稳定。

v3.3.0+ 默认工作台路由与旧路由迁移由对应版本任务明确；在等价迁移前保留现有入口和回退路径，不根据本指令猜测具体 URL。

---

## 9. 当前插件只读视图

- 数据来自 Runtime Plugin/Capability Registry 的稳定投影，不在前端硬编码插件清单；
- 只按功能、模型和其他插件显示名称、版本、说明、状态与能力；
- 不提供安装、卸载、启停、配置、更新、权限、市场或项目绑定；
- 不把该视图变成工具管理或执行时间线页面。

---

> **本文件是 AI Novel Studio 前端开发的权威指令。所有前端代码修改必须先参考本文件。**

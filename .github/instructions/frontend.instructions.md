# Frontend Development Instructions

> 适用于：所有前端 React/TypeScript 代码的开发和修改
> 优先级：高
> 适用范围：`src/` 下所有 `.tsx` / `.ts` / `.css` 文件

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

### 2.1 写作工作台布局

```text
TopToolbar（顶部工具栏）
├─ LeftTree（左侧卷章树，~240px）
├─ CenterEditor（中间正文编辑区，flex: 1）
├─ RightToolbar（右侧竖向工具栏，~48px）
└─ RightPanel（弹出面板，320-380px，条件显示）
BottomStatusBar（底部状态栏）
```

### 2.2 首页布局

```text
Sidebar（左侧导航，~220px）
MainContent
├─ WelcomeBanner（欢迎横幅）
├─ QuickActions（快捷入口卡片）
└─ NovelCardList（作品卡片列表）
```

### 2.3 表单页面

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
font-family: "Microsoft YaHei", "Segoe UI", Arial, sans-serif;
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

- 写作工作台在 2K（2560×1440）下必须完整显示
- 左侧树 + 中间编辑区 + 右侧工具栏同时可见
- 最小支持宽度：1280px
- 推荐窗口大小：1440×900 到 2560×1440

---

## 7. 右侧工具栏与弹出面板

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

```text
/                       → Home（作品管理首页）
/novels/:novelId        → NovelDetail（作品详情）
/novels/:novelId/workspace → WritingWorkspace（写作工作台）
/styles                 → StyleProfiles（风格方案管理）
/settings               → Settings（设置中心）
/coming-soon            → ComingSoon（未开放功能提示）
```

使用 HashRouter（`createHashRouter`），保持桌面端路径稳定。

---

> **本文件是 AI Novel Studio 前端开发的权威指令。所有前端代码修改必须先参考本文件。**

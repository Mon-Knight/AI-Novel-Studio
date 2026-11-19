# AI Novel Studio UI 开发框架

> 适用版本：v3.7.0+
>
> 本文是 UI **实现与验证规范**，不是新的产品路线。产品交互语义以
> [ui-reference.md](ui-reference.md) 和对话工作台架构为准；目录职责以
> [module-boundaries.md](module-boundaries.md) 为准；测试门禁以
> [technical/testing.md](technical/testing.md) 与根 AGENTS.md 为准。

## 1. 文档目的与权威关系

本框架解决四类长期问题：

1. 页面、组件、Feature 和服务之间的职责漂移；
2. 主题令牌、状态语义和交互反馈在不同页面重复实现；
3. UI 看起来可用，但键盘、焦点、错误、空态和异步状态未形成契约；
4. 测试绑定 DOM 细节，重构后失去用户行为保障。

遇到冲突时按以下顺序判断：

1. 用户最新明确需求；
2. 根 AGENTS.md；
3. 本文的实现规则；
4. docs/ui-reference.md 的产品 UI 规则；
5. .github/instructions/frontend.instructions.md 与 .cursor/rules/ui-rules.mdc 的执行提示。

本项目继续使用 React 18 + TypeScript + Vite + Tauri 2 + 独立 CSS；本框架不引入新的 UI 库，不改变现有路由、主题 Token、IPC 或业务状态模型。

## 2. 外部优秀实践的取舍

以下项目只作为公开工程案例，不构成依赖引入授权：

| 案例                                                                                               | 本项目吸收的做法                                    | 本项目的落地方式                                                      |
| -------------------------------------------------------------------------------------------------- | --------------------------------------------------- | --------------------------------------------------------------------- |
| [Primer React](https://github.com/primer/react)                                                    | 设计令牌与基础样式分层，组件 API 和主题独立         | src/styles/variables.css、theme.css、src/components/common/           |
| [Radix Primitives](https://github.com/radix-ui/primitives/blob/main/philosophy.md)                 | 可组合、可转发 ref、显式 data-state、行为与视觉解耦 | 通用组件负责语义和交互，页面 CSS 负责局部变体                         |
| [React Spectrum / React Aria](https://github.com/adobe/react-spectrum)                             | 将键盘、焦点、ARIA 和状态行为视为组件契约           | 对话框、菜单、Tooltip、输入和面板必须有键盘与焦点测试                 |
| [Testing Library](https://github.com/testing-library/dom-testing-library)                          | 测试用户能看到和操作的行为，优先语义查询            | getByRole / getByLabelText 优先，data-testid 仅作为稳定边界           |
| [Storybook](https://github.com/storybookjs/storybook/blob/next/docs/get-started/whats-a-story.mdx) | 用“有意义状态”描述组件，而不是只展示默认状态        | 当前以现有 TSX 行为测试和 E2E 夹具承载；引入 Storybook 需另立评估任务 |
| [Material UI](https://github.com/mui/material-ui/blob/master/CONTRIBUTING.md)                      | 小范围变更、组件 API、文档、测试和 CI 同步          | UI 变更按单一目标拆分，组件行为和文档同批验证                         |
| [Tauri Architecture](https://github.com/tauri-apps/tauri/blob/dev/ARCHITECTURE.md)                 | WebView 与原生宿主通过明确消息边界协作              | React UI 不直接接触 SQLite；IPC 通过 service / feature 边界进入       |

## 3. UI 分层模型

### 3.1 三层结构

```text
Design Tokens
  ↓
Common Primitives
  ↓
Product Components / Features / Pages
```

| 层级               | 位置                                | 责任                                                                      | 禁止                                        |
| ------------------ | ----------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------- |
| Design Tokens      | src/styles/variables.css、theme.css | 颜色、间距、字号、圆角、阴影、动效、焦点环                                | 在组件内新增跨主题裸 hex、散落 magic number |
| Common Primitives  | src/components/common/              | Button、IconButton、Field、Dialog、Tooltip、Badge、Spinner、EmptyState 等 | 直接调用 AI、数据库、Router 或复杂业务服务  |
| Product Components | src/components/<domain>/            | 作品、章节、工作台、产物卡等局部展示与交互                                | 复制通用按钮、弹窗和状态样式                |
| Feature            | src/features/<domain>/              | 跨组件流程、异步协调、决策和状态转换                                      | 直接堆大段 JSX 和全局 CSS                   |
| Page               | src/pages/                          | 路由级布局、页面组合、窄 Store selector                                   | SQL、AI 请求、复杂持久化编排                |
| Service            | src/services/                       | AI、Runtime、SQLite、提示词、文件、导入导出                               | React JSX、DOM 查询、页面布局               |

### 3.2 桌面壳与业务页

所有页面使用既有壳层，不在页面内部重新发明导航：

```text
AppShell
├─ FrameBar / WindowChrome
├─ GlobalNavigation（按路由适用）
└─ PageContent

WorkbenchShell
├─ ProjectTaskTree
└─ TaskConversation
   ├─ TaskHeader
   ├─ ConversationNodes
   └─ Composer
```

主创作台保持单一目标输入入口。模型选择、上下文、工具行、错误和候选卡片围绕该入口组织；新增第二套意图表单需要单独产品决策。

## 4. 设计令牌规范

### 4.1 令牌类别

跨页面样式必须使用语义令牌：

```text
--color-bg-*
--color-text-*
--color-border-*
--color-accent-*
--color-state-*
--color-focus-ring
--space-*
--radius-*
--shadow-*
--duration-*
--font-*
```

令牌表达语义，不表达组件名称。例如使用 --color-bg-selected，不要在按钮样式里新建 --blue-button-bg。

### 4.2 主题要求

- system、light、dark 共用语义令牌名；主题只改变令牌值。
- 颜色不能作为唯一状态信号；状态同时提供文字、图标或结构差异。
- 选中、悬停、焦点、禁用、运行中、失败、待用户处理必须互相区分。
- 组件 CSS 不直接复制主题文件中的颜色值。
- 新令牌必须说明用途、适用主题和删除条件；仅单页面一次性样式优先使用局部类。

### 4.3 尺寸与密度

- 桌面默认窗口和 2K 逻辑尺寸遵循 ui-reference.md 与 src-tauri/tauri.conf.json。
- 正文阅读列保持有界宽度，工作台对话和 Composer 保持既有预算。
- 一个页面只保留一个主要纵向滚动容器；面板内滚动不与 Composer、对话流或编辑器形成无意识双滚动。
- 交互命中区优先满足 36px 高度；图标按钮、危险动作和桌面触控场景按 44px 目标验收。
- 新增布局必须同时检查标准、窄窗、2K、焦点模式和明暗主题。

## 5. 组件 API 规范

### 5.1 组件边界

每个组件在创建前先写一句职责说明：

```text
该组件负责 [一个 UI 区域] 的 [展示/交互]，不负责 [业务副作用]。
```

组件要求：

- props、回调、异步状态和可选行为全部使用 TypeScript 类型；
- 受控和非受控模式明确选一种，不能让同一状态存在两个写入源；
- 需要 DOM 操作时使用 forwardRef，不通过 querySelector 跨组件找节点；
- 视觉变体使用受限 union，例如 variant: primary | secondary | danger；
- 避免多个互相组合的布尔 props，状态超过三种时使用显式 state；
- 公开有限状态时使用 data-state、data-status 或既有 data-* 契约；
- 可访问名称、键盘行为和禁用语义属于 API，不是调用方的临时补丁；
- 组件目标体积优先控制在 300 行以内；超过现有 500 行门禁时必须拆分或记录理由。

### 5.2 通用组件最小集合

优先复用或补齐以下组件，不在页面中重新实现：

```text
Button / IconButton
Field / FieldLabel / FieldHint / FieldError
Select / Combobox
ModalFrame / ConfirmDialog
Tooltip
Badge / StatusPill
Spinner / Progress
EmptyState / ErrorNotice
PanelHeader / SectionHeader
```

新通用组件至少包含：默认态、禁用态、加载态、错误态、键盘焦点态、浅色主题、深色主题和最小尺寸测试。

### 5.3 文案与动作

- 标签和按钮使用用户理解的动作词；例如“保存草稿”“进入审阅”“采用候选”。
- 同一动作在按钮、确认对话框、Toast 和错误反馈中使用同一名称。
- Placeholder 不能替代可见 label。
- 错误说明包含发生位置、影响和下一步动作；重要错误原位保留，不自动消失。
- 空态提供下一步入口，不能只显示“暂无数据”。

## 6. 交互与可访问性契约

### 6.1 键盘与焦点

- 所有可操作控件支持 Tab、Enter/Space 或组件对应的键盘行为。
- 焦点环必须可见，且不能被固定面板、底栏或遮罩遮住。
- Dialog 打开后焦点进入首个可操作控件，关闭后回到触发源。
- Menu、Select、Tooltip、Panel 各自处理自己的 Escape；外层仅在内层未消费时关闭。
- Composer、任务菜单和对话框保留中文输入法组合态，组合输入期间不误发送、不误确认、不误关闭。
- 异步提交期间保留可识别的运行状态；停止、取消和重试的焦点目标明确。

### 6.2 ARIA 与状态反馈

- 每个输入拥有可见 label 或明确 aria-label，补充说明使用 aria-describedby。
- 错误关联到对应字段，并通过 aria-live 或状态区域提供异步结果。
- Icon-only 控件必须有可访问名称和 tooltip；装饰图标使用 aria-hidden。
- aria-expanded、aria-pressed、aria-busy、aria-disabled 与可视状态保持一致。
- 颜色、透明度和动画不能承担唯一信息。
- prefers-reduced-motion 下关闭空间位移动画和持续脉冲，保留静态状态反馈。

### 6.3 覆盖层与面板

- transient 面板、pinned 面板和窄窗覆盖层使用明确的作用域状态。
- 隐藏面板使用 hidden 或 inert，不得留在可聚焦树中。
- 外部点击关闭前先判断当前事件是否属于触发控件、原生 select 或嵌套弹窗。
- 关闭面板不清空草稿、不改变正式持久化状态、不抢占无关焦点。

## 7. 状态与数据所有权

UI 状态按生命周期分层：

| 状态层       | 示例                                   | 所有者                            |
| ------------ | -------------------------------------- | --------------------------------- |
| 瞬时组件状态 | 面板开合、焦点、Tooltip、输入法组合    | 组件或局部 hook                   |
| Feature 状态 | 发送准备、候选审阅、重试目标、当前视图 | src/features/ / feature hook      |
| 运行时投影   | Run、工具行、错误、候选卡片            | conversation/runtime service      |
| 正式事实     | 作品、章节、草稿、采用版本、摘要       | service + SQLite                  |
| 全局偏好     | 主题、窗口、侧栏偏好                   | Zustand / 专门 preference service |

规则：

1. Store 只承载可订阅状态和同步 action，不调用数据库、AI、文件或计时器。
2. UI 的“已保存”“已采用”“已加载”必须来自对应事实层，不由按钮点击本身推断。
3. 候选、用户草稿、审阅授权、正式采用和上下文沉淀保持不同状态名。
4. 组件接收 loading / error / empty / success / pending-user 等显式状态，不把 undefined 解释成成功。
5. 异步结果必须带作用域或请求序号，旧响应不得覆盖当前任务、作品或模型选择。

## 8. 工作台专用规范

### 8.1 创作工作台

- 左侧项目/任务树只负责导航和任务状态摘要。
- 对话流内联显示消息、工具、错误、运行进度和候选卡片。
- Composer 只提供目标输入、模型、上下文、模板/运行时入口和发送/停止。
- 资产预检是“发送前摘要”；Provider 上下文回执是“本轮证据”，两者不能合并成一个状态。
- 工具行显示语义名、技术名、状态和耗时；隐藏推理不进入 UI。
- 候选卡片必须显示来源、目标、基线、验证状态和下一步动作。

### 8.2 章节审阅编辑器

- 正文默认只读，进入编辑、保存、采用分步执行。
- 编辑器宽度、滚动位置和选区不参与面板动画。
- 保存状态、恢复快照状态和采用状态分开表达。
- 章节候选使用审阅授权和哈希校验，正式采用不由“已查看”推断。

## 9. 测试与验收框架

### 9.1 测试层级

| 层级         | 断言内容                                 | 入口                                          |
| ------------ | ---------------------------------------- | --------------------------------------------- |
| 组件行为     | 用户看到的文本、角色、键盘操作、状态转换 | *.test.tsx + Testing Library                  |
| Feature 行为 | 发送、重试、取消、切换作用域、决策编排   | src/features/ / hooks 测试                    |
| 视觉/布局    | 主题、尺寸、滚动、焦点、长文案           | 生产桌面 E2E 或现有视觉规格                   |
| 可访问性     | 语义树、标签、焦点、键盘、状态播报       | DOM 断言 + 桌面场景；引入 a11y 工具需单独评估 |
| 生产流程     | Tauri、SQLite、窗口、IPC、真实用户路径   | tests/e2e/、tests/real-acceptance/            |

### 9.2 查询与选择器优先级

1. getByRole + accessible name；
2. getByLabelText；
3. getByText（可见用户文案）；
4. data-testid（跨进程、重复文本、稳定 E2E 边界）；
5. CSS class、DOM 层级和实现细节只用于确有必要的布局断言。

新增 data-testid 必须说明：用户行为无法稳定表达、跨进程需要定位，或既有桌面 E2E 契约需要保持。

### 9.3 每个交互组件的最小状态矩阵

```text
default
loading / busy
empty
error
success / completed
disabled
keyboard focus
dark theme
light theme
long label / long content
reduced motion
```

有异步副作用的组件再增加：取消、重试、旧响应、作用域切换和组件卸载。

## 10. UI 变更工作流

### 10.1 修改前

写一段简短设计记录：

```text
目标：用户要完成的动作
入口：所属路由、页面或工作台区域
状态：默认/加载/空/错误/完成/待用户处理
组件：复用哪些通用组件，新增什么局部组件
令牌：是否需要新增或调整语义令牌
键盘：Tab、Enter、Escape、焦点返回和 IME 行为
持久化：仅投影、草稿、正式事实还是决策记录
验证：组件测试、Feature 测试、真实桌面场景
```

### 10.2 修改中

1. 先复用既有 Token 和 primitive；
2. 先实现静态结构，再接入 Feature 状态；
3. 先完成错误、空态和加载态，再添加装饰；
4. 组件不直接调用 service，跨层协调放 Feature；
5. 一次 PR 只处理一个用户可理解目标；
6. 页面、组件、测试、文案和文档同批更新。

### 10.3 修改后

至少运行：

```powershell
npx prettier --check <本次修改的文档与源码文件>
npm run test:docs-sync
git diff --check
git status --short
```

涉及前端行为时，再运行改动范围对应的组件/Feature 测试、改动文件 ESLint、一次类型检查和适用的真实桌面场景。完整入口仍由 npm run verify:change 选择，不以单个 UI 测试替代。

## 11. Code review 清单

### 架构

- [ ] 页面只组合布局，业务编排在 Feature。
- [ ] 组件没有直接调用 AI、SQLite、文件或 IPC。
- [ ] Store 没有副作用。
- [ ] 新状态有唯一所有者和明确生命周期。

### 视觉

- [ ] 使用既有语义 Token。
- [ ] 浅色、深色、2K、窄窗均有验证计划。
- [ ] 正文阅读宽度、滚动归属和面板层级保持稳定。
- [ ] 没有新增后台表格、无限宽表单或无目的渐变。

### 交互

- [ ] 所有操作可键盘完成。
- [ ] 焦点可见且关闭后回到触发点。
- [ ] Loading、错误、空态和成功反馈完整。
- [ ] IME、Escape、外部点击、取消和重试行为明确。

### 测试

- [ ] 测试优先使用角色、标签和用户可见文本。
- [ ] 关键状态矩阵覆盖完成。
- [ ] 交互变化有真实桌面场景。
- [ ] 证据区分浏览器、Mock、loopback、真实桌面和 live Provider。

## 12. 近期落地顺序

本框架先作为规范落地，不立即引入大型组件库或 Storybook。后续 UI 工程任务按以下顺序推进：

1. 盘点 src/styles/variables.css、theme.css 与页面 CSS 的重复 Token；
2. 补齐 Button / IconButton / Field / ModalFrame / StatusPill / EmptyState 的状态矩阵；
3. 将工作台、章节审阅和资源页的状态命名统一到 data-state / data-status；
4. 补齐对话框、菜单、Tooltip、Composer 和右侧面板的键盘/焦点回归；
5. 为高频组件增加“故事状态”测试夹具；
6. 再评估是否需要 Storybook 或专门 a11y/视觉回归工具。

任何依赖新增、主题大规模重写、路由迁移或组件库引入，均另立任务书并单独验证。

## 13. 后续具体任务书（本轮仅形成规范）

以下任务按顺序执行，每个任务单独开工、单独验证，不把后续实现默认包含在本轮文档变更中。

### UI-01：Token 盘点与语义收口

- **目标**：盘点 `src/styles/variables.css`、`theme.css` 与工作台/章节/资源页 CSS 中的颜色、间距、圆角、阴影和动效重复项。
- **产物**：Token 清单、重复项映射、保留/废弃理由；只做等价替换，不改变页面结构或业务状态。
- **禁止**：引入 CSS-in-JS、主题库或大规模重写主题；不以视觉重做替代 Token 收口。
- **验收**：浅色、深色、窄窗、2K 截图或桌面规格无明显回归；`npm run test:style-budget`、改动文件 Prettier、相关组件测试通过。

### UI-02：通用 Primitive 状态矩阵

- **目标**：按 Button、IconButton、Field、ModalFrame、StatusPill、EmptyState 的优先级，补齐 loading、error、disabled、focus、主题和长文案状态。
- **产物**：组件 API、状态矩阵、键盘行为、可访问名称和相邻 `*.test.tsx` 行为测试。
- **禁止**：在页面内复制通用控件；不增加新的 UI 库或隐式全局状态。
- **验收**：优先使用 `getByRole` / `getByLabelText`；组件尺寸门禁、ESLint、类型检查和相关工作台测试通过。

### UI-03：工作台键盘、焦点与 IME 回归

- **目标**：覆盖任务树、Composer、模型选择、Tooltip、Dialog、右侧参考面板的 Tab、Enter/Space、Escape、焦点返回和中文输入法组合态。
- **产物**：标准窗、窄窗、浅色/深色和取消/重试场景的桌面证据；问题记录只描述现象、路径和影响。
- **禁止**：通过新增输入区绕开主创作台单一入口；不把焦点修复写成业务状态变更。
- **验收**：组合输入期间不误发送、不误关闭；遮罩和固定面板不遮挡焦点环；相邻 UI 测试与适用真实桌面场景通过。

### UI-04：状态命名与候选边界统一

- **目标**：将工作台、章节编辑器和产物卡片的 `data-state` / `data-status` 对齐到 loading、error、empty、success、pending-user 等语义。
- **产物**：状态字典、来源/所有者说明、旧状态迁移表；候选、用户修改、审阅授权、保存和正式采用保持可区分。
- **禁止**：把“生成成功”直接写成正式事实；不让 UI 点击结果代替 SQLite/服务层事实。
- **验收**：切换任务、作品、模型或重试时旧响应不覆盖当前作用域；保存/采用/上下文沉淀各有可验证证据。

### UI-05：故事状态夹具与工具决策

- **目标**：为高频组件建立 default/loading/empty/error/success/disabled/focus/long-content/reduced-motion 的可复用测试夹具，并评估是否需要 Storybook 或 a11y/视觉工具。
- **产物**：夹具目录、覆盖矩阵、工具决策记录；若引入依赖，另立任务说明版本、构建、许可和桌面集成影响。
- **禁止**：仅为展示默认态引入大型工具链；不得用 Storybook 预览替代生产 Tauri 验收。
- **验收**：组件行为、可访问性、视觉/布局和生产流程四层证据分开记录；`npm run verify:change` 按变更范围选择门禁。

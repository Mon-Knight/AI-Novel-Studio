# 状态管理

`src/store/` 使用 Zustand 5 管理需要跨组件共享、可订阅的前端运行时状态。Store 是当前 WebView 中的状态投影，不是作品数据、AI 任务或调度记录的持久化事实源。

## 状态所有权矩阵

| 状态类别             | 当前所有者                                 | 典型内容                                                                                                   | 生命周期 / 持久化                                                           | 边界                                                                                                           |
| -------------------- | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| 写作工作区共享会话   | `workspaceSessionStore.ts`                 | 当前作品、卷章列表、活动章节、当前草稿投影、编辑器快照、dirty 标记、质量检查结果、AI 进度弹窗              | 随当前作品的工作区会话存在；`startSession()` 在作品切换时重置；不直接持久化 | 只保存界面协作所需的当前快照；草稿、章节和质量记录的权威版本仍由 Service / Repository 读取和写入               |
| 右侧栏跨面板状态     | `rightSidebarStore.ts`                     | 激活工具、展开/收起状态、各工具的 output / error / loading、结果关联的正文 hash 与草稿版本                 | 工作区运行时状态；进入新的工作区会话时重置；不直接持久化                    | 面板切换和结果陈旧性提示属于 UI 协调；AI 调用、结果验证和正式写入不属于 Store                                  |
| 全局主题状态         | `themeStore.ts`                            | `system` / `light` / `dark` 偏好、有效主题、系统暗色偏好、初始化状态                                       | 应用运行期共享；用户偏好由 `themeRuntimeService` 写入 LocalStorage          | Store 保存可观察快照；LocalStorage、`matchMedia` 和 DOM `data-theme` / `colorScheme` 副作用由主题 Service 负责 |
| 组件局部 UI 状态     | React `useState` / `useReducer` / `useRef` | 单个表单输入、弹窗开关、局部 loading / message、正文定位请求、未提交编辑缓冲                               | 随组件或路由实例存在；默认不持久化                                          | 只被一个组件树局部消费的状态保持局部，不为“统一”而全部提升到 Zustand                                           |
| 业务事实与跨进程状态 | `src/services/` + Tauri IPC + SQLite       | 小说、卷章、草稿版本、采用指针、AI Task / Attempt、成本 ledger、Scheduler lease / checkpoint、正式故事资产 | 桌面端持久化；浏览器开发模式的回退由对应 Service 管理                       | SQLite 是桌面端权威事实源；Store 不直接调用 SQL、不模拟事务，也不把内存快照当成提交成功                        |

## 当前 Store

### `useWorkspaceSessionStore`

- 为写作工作台页面和子视图提供单一可观察会话快照。
- 页面可以使用窄 selector / `useShallow` 订阅所需字段，并分开选择同步 action，避免无关状态导致整页重渲染。
- 编辑器输入使用 `setEditorActivity({ editorSnapshot, wordCount, isDirty })` 一次性提交同一帧的快照、字数与 dirty 状态，避免连续多个 Store set 造成中间不一致和重复渲染。
- Feature hooks 负责加载、保存、恢复、采用等业务流程；成功读取或提交权威结果后，再通过 action 刷新 Store 投影。
- `currentDraft`、`chapters` 等对象出现在 Store 中不代表 Store 取得持久化所有权。

### `useRightSidebarStore`

- 统一右侧工具的展开、切换和运行时结果状态。
- 纯状态转换函数保持可独立测试；面板关闭或切换不隐式销毁其他工具结果。
- Store 只记录结果与其正文版本的关联，不能代替 AI Task、Result Artifact 或草稿版本记录。

### `useThemeStore`

- 向设置组件和应用入口暴露主题偏好及有效主题。
- `themeStore` 负责状态转换，`services/theme/themeRuntimeService.ts` 负责读取/写入偏好、监听系统主题以及更新文档根节点。
- 主题偏好是应用 UI 设置，不属于小说业务数据；因此使用 LocalStorage，而不是复制到工作区 Store 或作品 SQLite 表。

## 统一数据流

```text
用户事件
  -> Page / Component
  -> Feature hook（业务编排）
  -> Service / Repository
  -> Tauri IPC / SQLite（权威提交）
  -> 返回权威 DTO
  -> Zustand action（刷新当前 WebView 投影）
  -> selector 驱动 UI
```

主题运行时采用独立的 UI 设置链路：

```text
AppearanceSettingsCard
  -> themeStore action
  -> themeRuntimeService
  -> LocalStorage + matchMedia + document attributes
```

## 使用规则

1. Page 是路由级组合根，可以读取 Store selector、调用同步 action，并把状态和回调传给 View；复杂业务和 I/O 继续下沉到 Feature / Service。
2. Component 可以直接订阅真正跨组件的 UI Store（例如主题），但单组件表单、弹窗和瞬时反馈优先保留为局部状态。
3. Store action 只表达同步状态转换。数据库、AI Provider、文件、网络、计时器和 DOM 等副作用由 Service / Feature 管理；主题初始化也只通过 `themeRuntimeService` 绑定这些副作用。
4. Service 不反向读取 React 或 Zustand Store。调用所需的作品、章节、请求 owner 等参数必须显式传入。
5. 桌面端只有 Service / Repository 返回成功后才能更新为“已保存”；失败时不得用 Store 或 LocalStorage 伪造成功。
6. 新增 Store 前先确认状态需要跨组件共享；若只是局部交互状态，继续使用 React 局部状态。

## 测试

- Store 的纯转换、重置和选择行为使用相邻的 `*.test.ts` 覆盖。
- 涉及 SQLite 或 Provider 的行为在对应 Service / Rust 测试中验证，不在 Store 测试中 mock 出持久化成功。

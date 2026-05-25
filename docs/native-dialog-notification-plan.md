# Native Feel P2.2 — 原生 Dialog 与通知落地规划

> 日期：2026-05-26
> 项目：AI Novel Studio

---

## 1. 当前项目 DOM Modal / Overlay 清单

| 组件 / 位置 | 类型 | 用途 | 是否适合替换 |
|------------|------|------|------------|
| `LoadingModal` | 全局 Overlay | AI 任务进度 + 成功/失败状态 | ❌ 不适合 — 需自定义 UI（进度条、阶段文案、重试按钮） |
| `modal-overlay` (ImportTxtDialog) | DOM Overlay | TXT 导入表单 | ❌ 不适合 — 含文件选择、预览、表单，不是简单确认 |
| `modal-overlay` (ImportJsonDialog) | DOM Overlay | JSON 导入表单 | ❌ 不适合 — 同上 |
| `modal-overlay` (VolumeTree) | DOM Overlay | 新建卷/章表单 | ❌ 不适合 — 含输入框 |
| `modal-overlay` (ChapterFormModal) | DOM Overlay | 章节表单 | ❌ 不适合 — 含多个表单字段 |
| `modal-overlay` (VolumeFormModal) | DOM Overlay | 分卷表单 | ❌ 不适合 — 含多个表单字段 |
| `ChapterSummaryDialog` | DOM Overlay | 章节总结编辑 | ❌ 不适合 — 含文本编辑区 |
| `window.confirm` (HomePage) | 浏览器 API | 删除作品确认 | ✅ 适合 — 本次已替换 |
| `window.confirm` (AiTasksPage) | 浏览器 API | 删除/清空任务确认 | ✅ 适合 — 本次已替换 |
| `window.confirm` (WritingWorkspace) | 浏览器 API | 未保存修改提示 | 🟡 可替换 — 适合 `confirmInfo`，后续可做 |

---

## 2. 当前项目 Toast / 状态提示清单

| 位置 | 方式 | 用途 | 是否适合替换 |
|------|------|------|------------|
| `setMsg('已保存')` (EditorArea) | 页面内状态文字 | 草稿保存完成 | 🟡 可选 — 可追加通知，不替代页面内状态 |
| `setMsg('已删除')` (AiTasksPage) | 页面内状态文字 | 删除完成 | 🟡 可选 |
| `flash()` (OutlineManager) | 页面内错误提示 | AI 生成失败 | 🟡 可选 |
| `setStatusMsg` (AiGeneratePanel) | 右侧面板状态 | 生成状态 | 🟡 可选 — 本次已追加通知 |

---

## 3. 本次 P2.2 实际完成内容

### 3.1 工具层

| 文件 | 导出 | 说明 |
|------|------|------|
| `src/utils/nativeDialog.ts` | `confirmDanger`, `confirmInfo`, `showInfo`, `showError` | Tauri dialog → window.confirm/alert 回退 |
| `src/utils/nativeNotification.ts` | `notifyNative` | Tauri notification → console 回退 |

### 3.2 Dialog 替换

| 位置 | 原实现 | 替换为 | 类型 |
|------|--------|--------|------|
| `HomePage.tsx` — `handleDeleteNovel` | `window.confirm()` | `confirmDanger()` | 危险操作 |
| `AiTasksPage.tsx` — `handleDeleteOne` | `window.confirm()` | `confirmDanger()` | 危险操作 |
| `AiTasksPage.tsx` — `handleDeleteSelected` | `window.confirm()` | `confirmDanger()` | 危险操作 |
| `AiTasksPage.tsx` — `handleClearAll` | `window.confirm()` | `confirmDanger()` | 危险操作 |

### 3.3 通知接入

| 位置 | 事件 | 通知类型 | 说明 |
|------|------|---------|------|
| `AiGeneratePanel.tsx` | 正文生成完成 | `success` | 含字数 |
| `AiGeneratePanel.tsx` | 正文生成失败 | `error` | 含错误信息 |

### 3.4 配置变更

| 文件 | 变更 |
|------|------|
| `tauri.conf.json` | `allowlist` 新增 `dialog.all: true` + `notification.all: true` |

---

## 4. 后续 P2.3 / P3 建议

### Dialog 方面

| 场景 | 建议 |
|------|------|
| WritingWorkspace 未保存提示 | 下次用 `confirmInfo` 替换 |
| 更多危险操作（删除风格、删除角色等） | 随功能开发逐步接入 `confirmDanger` |
| 全量 DOM Modal 替换 | 不建议 — 复杂表单弹窗不适合原生 dialog |

### Notification 方面

| 场景 | 建议 |
|------|------|
| 大纲生成完成 | 追加 success 通知 |
| 导入/导出完成 | 追加 success 通知 |
| AI 连接测试 | 追加 info 通知 |
| DOM Toast 基础组件 | 先建页面内轻量 Toast，再与通知互补 |

### 架构方面

| 项目 | 建议 |
|------|------|
| Tauri 2.x notification 插件 | 升级 Tauri 2.x 后迁移 |
| 通知权限管理 | 当前不强制，后续可添加设置页开关 |
| 多通知防刷 | 当前每个通知独立，后续可添加 debounce |

---

## 5. 保留到后续的问题

- Mica / Acrylic（需 Tauri 2.x + Win32 API）
- 原生通知权限设置页
- 全量危险操作 Dialog 替换
- DOM Toast 基础组件
- 文件关联
- 自动更新
- 安装包体验优化

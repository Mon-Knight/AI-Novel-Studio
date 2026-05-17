# AI Novel Studio v1.0.17 Release Notes

## 版本主题
修复工作台首章创建按钮 + 统一版本号显示

## 用户反馈问题
1. 工作台「创建第一卷并新建第一章」按钮点击后无作用
2. 右上角版本号仍显示 v1.0.13

## 根因分析
1. **版本号硬编码**：`TopBar.tsx` 和 `Sidebar.tsx` 中直接写了 `v1.0.13` 字符串，导致即使打包更新，UI 仍显示旧版本
2. **无调试日志**：按钮处理函数缺少日志，无法判断是未触发还是执行失败

## 本次修复

### 版本号统一
- 新增 `src/constants/version.ts`：统一管理 `APP_VERSION` 和 `APP_PLATFORM_LABEL`
- `TopBar.tsx`：引用 `APP_VERSION` 常量（替换硬编码 `v1.0.13`）
- `Sidebar.tsx`：引用 `APP_VERSION` 常量（替换硬编码 `v1.0.13`）
- `SettingsPage.tsx`：引用 `APP_VERSION` 常量（替换硬编码 `v1.0.16`）
- 所有版本号统一到 `v1.0.17`

### 按钮链路增强
- `handleCreateFirstChapter` 添加完整 `console.info/error` 日志链
- 可追踪：create volume → create chapter → create draft → reload tree → set state 每一步

### 版本号更新
- `package.json`: 1.0.16 → 1.0.17
- `src-tauri/tauri.conf.json`: 1.0.16 → 1.0.17

## 修改文件
- `src/constants/version.ts` — 新增
- `src/components/topbar/TopBar.tsx` — 版本号引用
- `src/components/sidebar/Sidebar.tsx` — 版本号引用
- `src/pages/Settings/SettingsPage.tsx` — 版本号引用
- `src/pages/WritingWorkspace/WritingWorkspacePage.tsx` — 调试日志
- `package.json` — 版本号
- `src-tauri/tauri.conf.json` — 版本号

## 构建验证
- `npm run build` ✅
- `npm run tauri build` ✅（清理旧 dist + EXE 后重新生成）
- Release EXE: LastWriteTime 2026/5/17 18:26:23

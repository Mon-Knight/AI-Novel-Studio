# AI Novel Studio v1.0.18 Release Notes

## 版本主题
修复首卷首章创建后数据不落库的问题

## 用户反馈
点击「创建第一卷并新建第一章」后按钮短暂显示「创建中...」然后恢复原状，但未实际创建任何分卷/章节。

## 根因分析
**VolumeTree 独立状态未刷新**：VolumeTree 组件有独立的 `useState(volumes/chapters)`，通过 `useEffect([novelId])` 加载。父组件 `handleCreateFirstChapter` 成功后虽然更新了父组件的 `chapters` 状态（使空状态 overlay 消失），但 VolumeTree 的 **useEffect 不会重新触发**（因为 `novelId` 未变），导致章节树仍显示旧的空数据。

## 本次修复

### 1. 新增 `treeRefreshKey` 刷新机制
- `WritingWorkspacePage` 新增 `treeRefreshKey` 状态
- 创建数据成功后 `setTreeRefreshKey(k => k + 1)` 递增令牌
- `VolumeTree` 接受 `refreshKey` prop，`useEffect` 监听 `[novelId, refreshKey]`
- 令牌变化时强制 VolumeTree 重新加载数据

### 2. 新增写入后验证
- `handleCreateFirstChapter` 中 create 完成后立即调用 `getByNovelId` 验证数据可读
- 验证失败抛出明确错误（「分卷/章节创建后无法读取」）
- 阻止创建"成功"但实际无数据的情况

### 3. 版本号
- 所有版本引用统一到 v1.0.18

## 修改文件
- `src/pages/WritingWorkspace/WritingWorkspacePage.tsx` — treeRefreshKey + 写入验证
- `src/components/workspace/VolumeTree.tsx` — refreshKey prop + useEffect 依赖
- `src/constants/version.ts` — v1.0.18
- `package.json` — v1.0.18
- `src-tauri/tauri.conf.json` — v1.0.18

## 构建产物
- Release EXE: `F:\ai-novel-studio\src-tauri\target\release\AI Novel Studio.exe` (18:35:58)
- MSI: `bundle\msi\AI Novel Studio_1.0.18_x64_en-US.msi`
- NSIS: `bundle\nsis\AI Novel Studio_1.0.18_x64-setup.exe`

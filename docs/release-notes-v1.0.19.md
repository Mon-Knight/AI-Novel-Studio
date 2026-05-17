# AI Novel Studio v1.0.19 Release Notes

## 版本主题
工作台单一数据源重构 — 彻底修复创建后 UI 不更新

## 根因分析
之前 VolumeTree 维护独立的 useState(volumes/chapters)，通过 useEffect 加载数据。父组件创建数据后只更新自身状态，VolumeTree 不重新渲染（即使用 refreshKey 补丁也不彻底）。

## 本次重构

### VolumeTree 改为完全受控组件
- 删除内部 `volumes`/`chapters`/`loading` 状态和 useEffect
- 所有数据由父组件通过 props 传入
- VolumeTree 只保留 UI 状态（expandedVolumes、弹窗状态）
- 创建操作通过 `onCreateVolume(title)` / `onCreateChapter(volumeId, title)` 回调父组件

### WritingWorkspacePage 单一数据源
- 新增 `volumes` 状态
- 新增 `reloadWorkspaceData()` — 统一从 service 重载所有数据
- 新增 `handleCreateVolume` / `handleCreateChapter` — 父组件执行写入+重载
- `handleCreateFirstChapter` — 创建后直接 setState（不再依赖 refreshKey）
- 初始加载同时获取 volumes、chapters、novel

### 数据流
```
用户点击创建 → 父组件写入 service → 反查验证 → setVolumes/setChapters
→ VolumeTree 通过 props 立即刷新 → 空状态消失 → 章节树显示
```

## 存储 key
- volumes: `ai_novel_studio_volumes` (localStorage)
- chapters: `ai_novel_studio_chapters` (localStorage)
- drafts: `ai_novel_studio_drafts_list_{chapterId}` (localStorage)
- 写入/读取完全一致

## 修改文件
- `src/pages/WritingWorkspace/WritingWorkspacePage.tsx` — 单一数据源
- `src/components/workspace/VolumeTree.tsx` — 完全受控组件
- `src/constants/version.ts` — v1.0.19
- `package.json` — v1.0.19
- `src-tauri/tauri.conf.json` — v1.0.19

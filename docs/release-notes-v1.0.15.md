# AI Novel Studio v1.0.15 Release Notes

## 版本主题
作品详情 → 写作工作台链路修复

## 用户反馈问题
从作品详情页点击「进入写作工作台」后无法进入、渲染失败、卡死或空白。

## 根因分析
1. **无章节作品进入工作台无保护**：当作品没有任何章节时，WorkspacePage 的 `activeChapter` 为 undefined，虽然 EditorArea 内部有 `!chapter` 保护，但整体页面结构仍可能因缺少显式空状态导致异常。
2. **novel 未找到时无保护**：`novelRepository.getById` 返回 null 时，页面缺少显式的「作品不存在」状态。
3. **版本号不一致**：`tauri.conf.json` 仍为 v1.0.13。

## 本次修复内容

### 1. WorkspacePage 加载状态机
- 新增 `WorkspaceLoadState` 类型：`'loading' | 'ready' | 'novel_not_found' | 'error'`
- 替代原来单一的 `pageLoading/pageError` 布尔组合

### 2. 无章节空状态
- 当 `loadState === 'ready' && chapters.length === 0` 时显示友好空状态
- 提示用户返回作品详情页创建章节
- 不会崩溃、不会白屏

### 3. 作品未找到状态
- 当 `novelRepository.getById` 返回 null 时显示「作品不存在或本地数据已损坏」
- 提供「返回首页」和「修复本地数据」按钮

### 4. 初始草稿加载
- 页面加载时自动加载第一个章节的草稿（如有章节）
- 避免用户手动点击章节后才加载草稿

### 5. 版本号更新
- `package.json`: 1.0.13 → 1.0.15
- `src-tauri/tauri.conf.json`: 1.0.13 → 1.0.15
- 设置中心显示: v1.0.13 → v1.0.15（已在 v1.0.14 中更新）

### 6. 路由验证
- 路由：`/novels/:novelId/workspace` ✅
- 详情页按钮跳转：`/novels/${novel.id}/workspace` ✅
- WorkspacePage 参数：`useParams<{ novelId: string }>()` ✅
- 三者完全一致

## 安全格式化验证
- `EditorArea.tsx`: 使用 `formatDateTime`、`formatNumber` ✅
- `StatusBar.tsx`: 使用 `formatNumber` ✅
- `NovelCard.tsx`: 使用 `formatDate`、`formatNumber` ✅
- 全项目 `.toLocaleString(` 搜索：仅出现在 `src/utils/` 中 ✅

## 测试建议

### 无章节作品测试
1. 新建作品（不创建章节）
2. 进入作品详情页
3. 点击「进入写作工作台」
4. 应显示「当前作品还没有章节」空状态
5. 不崩溃、不白屏

### 有章节作品测试
1. 选择有章节的作品
2. 进入作品详情页
3. 点击「进入写作工作台」
4. 应显示章节树和正文区
5. 重复进入 3 次不卡死

### 打包版验证
```bash
npm run build
npm run tauri build
# 双击最新 exe 验证
```

## 修改文件
- `src/pages/WritingWorkspace/WritingWorkspacePage.tsx` — 加载状态机、空状态
- `src-tauri/tauri.conf.json` — 版本号
- `package.json` — 版本号（v1.0.14 已更新）
- `docs/release-notes-v1.0.15.md` — 本文件

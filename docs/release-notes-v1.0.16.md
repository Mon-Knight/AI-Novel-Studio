# AI Novel Studio v1.0.16 Release Notes

## 版本主题
写作工作台内直接创建分卷与章节

## 新增功能

### 1. 无章节作品可在工作台直接开始创作
- 无章节作品进入工作台后，显示「📖 创建第一卷并新建第一章」按钮
- 点击后自动：创建第一卷 → 创建第1章 → 创建空草稿 → 进入编辑状态
- 不再需要返回作品详情页手动创建

### 2. 左侧章节树内嵌新建分卷/章节
- 章节树标题栏新增「+ 章节」「+ 分卷」按钮
- 点击「+ 分卷」弹出表单，输入分卷名称即可创建
- 点击「+ 章节」弹出表单，可选择所属分卷并输入章节标题
- 无分卷时新建章节会自动创建第一卷

### 3. 每个分卷内可新建章节
- 展开分卷后底部有「+ 在本卷新建章节」入口
- 创建后章节树立即刷新，新章节自动选中

### 4. 创建章节自动生成空草稿
- 新建章节时自动创建空草稿（content=""）
- 正文编辑区立即可用，显示空状态提示

## 修复内容
- 版本号统一更新到 v1.0.16
- 修复 TypeScript 类型错误（refreshChapters 返回类型）

## 技术实现
- `WritingWorkspacePage.tsx`：新增 `handleCreateFirstChapter`、`refreshChapters`、`handleChapterCreated`
- `VolumeTree.tsx`：重写，新增 `handleCreateVolume`、`handleCreateChapter`、`handleOpenNewChapter`、内联弹窗

## 修改文件
- `src/pages/WritingWorkspace/WritingWorkspacePage.tsx`
- `src/components/workspace/VolumeTree.tsx`
- `package.json`
- `src-tauri/tauri.conf.json`
- `src/pages/Settings/SettingsPage.tsx`

## 测试建议
1. 新建作品 → 进入工作台 → 点击「创建第一卷并新建第一章」→ 验证章节树和正文区
2. 有作品 → 进入工作台 → 点击「+ 分卷」→ 创建第二卷 → 验证
3. 展开分卷 → 点击「+ 在本卷新建章节」→ 创建→验证自动选中和刷新
4. 关闭软件重开 → 数据仍存在

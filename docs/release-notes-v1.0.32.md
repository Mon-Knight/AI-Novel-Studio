# AI Novel Studio v1.0.32 发布说明

## 发布时间
2026-05-18

## 版本概述
本次更新实现了长时间异步操作的统一加载弹窗提示与防重复点击机制。所有 AI 生成、数据保存、大文本保存、文件导入/导出等耗时操作，现在都会显示全局加载弹窗，包含阶段文案、进度条、成功/失败状态，并自动禁用重复操作。

## 核心改动

### 🎨 新增 LoadingModal 组件
- 全局居中弹窗，浅色桌面软件风格
- 三种状态：loading（旋转动画 + 进度条）、success（✅ 自动关闭）、error（❌ 可重试/关闭）
- 确定进度条与不确定进度动画
- 可取消任务支持取消按钮
- 成功自动关闭（默认 1200ms），不打断写作流

### 🔧 新增 useLoadingTask Hook
- `src/hooks/useLoadingTask.ts` - 组件级异步任务管理
- 提供 `run()` 方法自动管理 loading/success/error 状态
- `helpers` 对象：setMessage / setStage / setPercent / setCancelable

### 📦 新增 runWithLoading 全局工具
- `src/lib/runWithLoading.ts` - 全局事件驱动的异步任务包装器
- 通过 CustomEvent 机制触发 LoadingModal，组件无需直接引入弹窗
- `useGlobalLoadingModal()` hook 在 App 根组件订阅
- 支持 AbortSignal 取消机制

### ✅ 已接入功能（10个调用点）

| 功能 | 组件 | 弹窗提示 |
|---|---|---|
| AI 章节正文生成 | AiGeneratePanel | 「正在请求 AI 生成正文……」 |
| AI 正文润色 | PolishPanel | 「AI 正在润色正文……」 |
| AI 质量检查 | CheckPanel | 「AI 正在检查逻辑、设定和文笔……」 |
| AI 章节总结生成 | ChapterSummaryPanel | 「正在分析章节内容……」 |
| AI 章节总结保存 | ChapterSummaryPanel | 「正在保存总结和上下文……」 |
| AI 作品总大纲生成 | OutlineManager | 「正在分析世界观和角色……」 |
| AI 分卷大纲生成 | OutlineManager | 「正在分析分卷结构……」 |
| AI 章节大纲生成 | OutlineManager | 「AI 正在规划章节结构……」 |
| 正文保存（Ctrl+S） | EditorArea | 「正在保存草稿」 |
| TXT 导入 | ImportTxtDialog | 「正在导入章节 X/Y……」 |
| JSON 导入 | ImportJsonDialog | 「正在导入风格方案/作品……」 |

### 🛡️ 防重复点击
- 所有接入按钮在任务执行期间自动禁用
- 全局 `runWithLoading` 内部检测重复执行
- 异常情况 finally 恢复按钮状态
- 失败后保留用户输入内容，不清空表单/正文

### 🎯 与大文本保存衔接
- 大文本保存进度自动通过 `runWithLoading` helper 同步到弹窗
- 分片保存阶段显示：「正在缓存正文：3 / 20」
- finalize 阶段显示：「正在写入数据库……」

## 修改文件
```
新增:
  src/components/common/LoadingModal.tsx
  src/components/common/LoadingModal.css
  src/hooks/useLoadingTask.ts
  src/lib/runWithLoading.ts
  docs/release-notes-v1.0.32.md

修改:
  src/App.tsx                    - 集成全局 LoadingModal
  src/components/right-dock/panels/AiGeneratePanel.tsx
  src/components/right-dock/panels/PolishPanel.tsx
  src/components/right-dock/panels/CheckPanel.tsx
  src/components/right-dock/panels/ChapterSummaryPanel.tsx
  src/components/outline/OutlineManager.tsx
  src/components/workspace/EditorArea.tsx
  src/components/import/ImportTxtDialog.tsx
  src/components/import/ImportJsonDialog.tsx
  package.json
  src-tauri/Cargo.toml
  src-tauri/tauri.conf.json
  src/constants/version.ts
```

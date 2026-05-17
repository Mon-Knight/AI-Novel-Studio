# AI Novel Studio v1.0.20 Release Notes

## 版本主题
统一章节创建服务：真实落库 + 反查验证 + UI 闭环

## 用户反馈问题
- 作品详情页「创建章节」提示成功但页面空白
- 工作台「创建第一卷并新建第一章」仍不可用

## 根因分析
1. **「创建成功」提前显示**：`OutlineManager` 在 `createChapter()` 返回后立即 flash("章节创建成功")，未验证数据是否持久化
2. **无草稿创建**：详情页创建章节时只创建 chapter，不创建 draft，导致工作台打开时无正文编辑区
3. **无统一服务**：详情页和工作台各自写创建逻辑，容易出现存储 key 不一致

## 本次修复

### 新增 `chapterCreationService.ts`（统一章节创建服务）
- `createFirstVolumeAndChapter(novelId)`：创建第一卷 + 第一章 + 空草稿，每步反查验证
- `createChapterInVolume(novelId, volumeId, title)`：在已有分卷中创建章节 + 空草稿，每步反查
- 创建失败抛出明确错误，不会假成功

### OutlineManager 修复
- 创建章节时调用统一服务
- 无分卷时自动创建第一卷 + 第一章
- 创建后反查验证成功才显示「✅ 创建成功」
- 失败显示「❌ 创建失败：具体原因」

### WritingWorkspacePage 修复
- `handleCreateFirstChapter` 调用 `createFirstVolumeAndChapter`
- `handleCreateChapter` 调用 `createChapterInVolume`
- 创建后直接设置 state，不再依赖 refreshKey

## 存储 key（已验证一致）
| 数据类型 | 写入 key | 读取 key |
|---|---|---|
| volumes | `ai_novel_studio_volumes` | `ai_novel_studio_volumes` |
| chapters | `ai_novel_studio_chapters` | `ai_novel_studio_chapters` |
| drafts | `ai_novel_studio_drafts_list_{chapterId}` | `ai_novel_studio_drafts_list_{chapterId}` |

## 修改文件
- `src/services/chapters/chapterCreationService.ts` — 新增
- `src/components/outline/OutlineManager.tsx` — 使用统一服务
- `src/pages/WritingWorkspace/WritingWorkspacePage.tsx` — 使用统一服务
- `src/constants/version.ts` — v1.0.20
- `package.json` — v1.0.20
- `src-tauri/tauri.conf.json` — v1.0.20

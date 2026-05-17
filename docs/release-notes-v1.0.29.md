# AI Novel Studio v1.0.29 发布说明

## 版本信息
- 版本号：v1.0.29
- 发布日期：2026-05-18
- 平台：Windows 桌面端

## 本次更新

### 🔧 修复：主角设定保存链路

#### 根因
v1.0.28 引入双主角功能时，`handleSave` 函数末尾缺少 `}` 关闭函数体，导致 TypeScript 编译失败，主角设定无法保存。

#### 修复内容

| 修复项 | 文件 | 内容 |
|--------|------|------|
| 缺少 `}` | `NovelDetailCards.tsx` | `handleSave` 函数 `finally` 块后补充 `};` |
| 类型不匹配 | `NovelDetailCards.tsx` | `onSave` 回调中 `protagonistMode` 从 `string` 改为 `ProtagonistMode` |
| 新字段类型 | `novel.ts` | `UpdateNovelInput` 新增 `protagonistMode`、`protagonists`、`dualProtagonistRelation` |
| null→undefined | `novelRepository.ts` | `update` 函数中 `dualProtagonistRelation: null` 转为 `undefined` |
| normalizer 增强 | `novelNormalizer.ts` | 主角数组不再按 `name` 过滤，逐字段 reconstruct 确保所有属性保留 |
| 导入缺失 | `NovelDetailCards.tsx` | 新增 `ProtagonistMode` 类型导入 |
| 保存调用 | `NovelDetailPage.tsx` | 移除 `@ts-ignore` + `as any`，使用正确类型 |
| 错误提示 | `NovelDetailCards.tsx` | `catch` 显示具体错误信息而非笼统"保存失败" |

### 📦 修改文件清单

| 文件 | 修改 |
|------|------|
| `src/types/novel.ts` | `UpdateNovelInput` 新增 3 字段 |
| `src/features/novels/novelNormalizer.ts` | 主角数组 robust reconstruct |
| `src/services/database/novelRepository.ts` | `dualProtagonistRelation` null→undefined |
| `src/components/novel-detail/NovelDetailCards.tsx` | `handleSave` 缺 `}` 补全 + 类型修复 + 错误提示 |
| `src/pages/NovelDetail/NovelDetailPage.tsx` | 移除 `@ts-ignore`，try/catch 错误处理 |
| `src/constants/version.ts` | v1.0.28 → v1.0.29 |

### 📦 构建
- 正式 EXE：`src-tauri\target\release\AI Novel Studio.exe`
- npm run build：✅
- npm run tauri build：✅

# AI Novel Studio v1.0.28 发布说明

## 版本信息
- 版本号：v1.0.28
- 发布日期：2026-05-18
- 平台：Windows 桌面端

## 本次更新

### 👥 新增：小说详情页主角设定支持双主角

#### 数据模型扩展
- `Novel` 类型新增 `protagonistMode`（`single` / `dual`）
- `Novel` 类型新增 `protagonists: ProtagonistProfile[]`
- `Novel` 类型新增 `dualProtagonistRelation?: DualProtagonistRelation`
- 新增 `ProtagonistProfile` 接口：姓名、性别、身份、性格、目标、动机、特殊能力、能力限制、禁止行为、背景经历、人物成长线、备注
- 新增 `DualProtagonistRelation` 接口：关系类型（伙伴/恋爱/竞争/绑定/师徒/亲属/敌对转盟友/平行双线/自定义）、关系说明、核心冲突、合作方式、关系推进、叙事权重

#### 小说详情页 UI
- 主角设定卡片支持切换「单主角」/「双主角」模式
- 双主角模式下显示主角A表单、主角B表单、双主角关系表单
- 关系类型和叙事权重支持下拉选择
- 展示模式区分单/双主角，双主角显示两位主角摘要和关系信息
- 保存通过 `novelService.updateNovel` 持久化，重启后不丢失

#### 旧数据兼容
- 旧 `protagonistRepository` 中的单主角数据自动迁移到 `novel.protagonists`
- 旧 `protagonistName`/`mainCharacter` 字段自动构造单主角对象
- 缺少 `protagonistMode` 时默认为 `single`

#### AI Prompt 集成
- `ChapterGenerationContext` 新增 `protagonistMode`、`protagonistsSummary`、`dualProtagonistSummary`
- `contextBuilder` 自动从 `novel.protagonists` 和 `novel.dualProtagonistRelation` 构建主角摘要
- `prompts/chapter_generate.md` 新增「主角详细设定」和「双主角关系」区块
- 双主角模式下 prompt 包含：必须同时考虑两位主角、不要把第二主角写成路人、推进关系冲突或合作、叙事权重约束
- `promptBuilder.ts` 和 `promptOrchestrator.ts` 同步更新

### 📦 修改文件清单（12 个文件）

| 文件 | 修改 |
|------|------|
| `src/types/novel.ts` | 新增 ProtagonistMode、ProtagonistProfile、DualProtagonistRelation 类型；Novel 新增 3 字段 |
| `src/types/ai.ts` | ChapterGenerationContext 新增 3 字段 |
| `src/features/novels/novelNormalizer.ts` | 新增 protagonist 相关归一化 + 旧数据兼容 |
| `src/features/novels/mockNovels.ts` | 三篇 mock 添加新字段 |
| `src/services/database/novelRepository.ts` | create 新增默认 protagonist 字段 |
| `src/services/prompt/contextBuilder.ts` | 构建 protagonistsSummary + dualProtagonistSummary |
| `src/services/ai/promptBuilder.ts` | 类型 + 构建函数新增双主角提示词 + 双主角约束 |
| `src/services/prompt/promptOrchestrator.ts` | DEFAULT_TEMPLATE 新增双主角区块 |
| `prompts/chapter_generate.md` | 新增「主角详细设定」+「双主角关系」区块及约束 |
| `src/components/novel-detail/NovelDetailCards.tsx` | ProtagonistCard 重写：模式切换 + 双主角表单 + 关系表单 |
| `src/pages/NovelDetail/NovelDetailPage.tsx` | 更新 onSave 调用链 |
| `src/constants/version.ts` | v1.0.27 → v1.0.28 |

### 📦 构建
- 正式 EXE：`src-tauri\target\release\AI Novel Studio.exe`
- npm run build：✅
- npm run tauri build：✅

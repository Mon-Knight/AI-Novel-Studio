# AI Novel Studio v1.0.25 发布说明

## 版本信息
- 版本号：v1.0.25
- 发布日期：2026-05-17
- 平台：Windows 桌面端

## 本次更新

### 🔧 修复：AI 生成正文必须结合大纲、设定、角色、事件与风格配置

修复了 AI 生成正文时上下文构建不完整的问题。之前生成正文时只传入了基础信息（章节标题、大纲），未充分注入作品总大纲、分卷大纲、本章设定、风格方案、输出控制等已保存的规划数据，导致 AI 自由发挥偏离规划。

### ✨ 修改文件

| 文件 | 修改内容 |
|------|----------|
| `src/types/ai.ts` | `ChapterGenerationContext` 新增 `novelOutline`、`volumeOutline`、`novelDescription`、`chapterSettings` 字段 |
| `src/services/prompt/contextBuilder.ts` | `buildChapterContext` 新增读取作品总大纲（novel.description）、分卷大纲（volume.summary+goal）、本章可用设定（最近6条激活设定） |
| `src/services/ai/promptBuilder.ts` | `ChapterGeneratePromptContext` 同步扩展新字段；`buildChapterGeneratePrompt` 提示词新增作品总大纲、分卷大纲、本章设定区块，并增加「不得凭空新增角色」「必须体现大纲中的场景/道具」的约束 |
| `prompts/chapter_generate.md` | 提示词模板新增「作品总大纲」「分卷大纲」「本章可用设定」区块；强化核心要求为「严格围绕章节大纲展开」；新增约束禁止凭空添加角色、必须如实写入大纲中的场景/道具 |
| `src/services/prompt/promptOrchestrator.ts` | DEFAULT_TEMPLATE 同步新增所有新字段的条件渲染 |
| `src/components/right-dock/panels/AiGeneratePanel.tsx` | 新增「上下文摘要预览」功能：点击「查看上下文摘要」展示所有将传入 AI 的配置项状态；缺失章节大纲时弹出警告确认；inputSummary 记录详细上下文统计 |
| `src/constants/version.ts` | 版本号更新到 v1.0.25 |

### 📋 AI 生成正文现在会注入的完整上下文

| # | 上下文项 | 数据来源 |
|---|----------|----------|
| 1 | 作品总大纲 | `novel.description` |
| 2 | 世界背景 | `settingRepository.getWorldSettings` → 激活的世界设定 |
| 3 | 规则体系 | `settingRepository.getRuleSystems` → 激活的规则 |
| 4 | 主角 / 特殊能力 / 限制 / 禁止行为 | `protagonistRepository` |
| 5 | 分卷大纲 | `volume.summary` + `volume.goal` |
| 6 | 分卷主要冲突 | `volume.mainConflict` |
| 7 | 章节大纲 / 章节目标 | `chapter.outline` / `chapter.goal` |
| 8 | 本章可用设定 | 最近 6 条激活的世界设定 |
| 9 | 本章出场角色 + 性格/目标/限制 | `chapterCharacterService` + `characterService` |
| 10 | 本章事件建议 + 必须发生标记 | `chapterEventService` |
| 11 | 前文上下文摘要 | `contextRecordService` |
| 12 | 风格方案（叙事人称/文风/节奏/对话比/描写比/禁用写法） | `styleProfileService` |
| 13 | 输出控制（目标字数/节奏/战斗强度/情绪倾向/禁止项） | `outputProfileService` |
| 14 | 用户额外要求 | UI 输入框 |

### 🛡 降级策略

- 缺少章节大纲 → 弹出确认警告，允许继续但提醒可能偏离
- 缺少作品总大纲 → 正常生成，提示中使用 `novel.description` 替代
- 缺少分卷大纲 → 正常生成，基于章节大纲和总大纲
- 缺少角色/事件/设定 → 正常生成，提示中留空
- 缺少风格方案 → 使用默认小说风格
- 缺少前文总结 → 第一章正常，非第一章提示连续性可能下降

### ⚠ 关键约束

提示词中新增了以下约束：
1. 不得凭空添加未在出场角色列表中列出的重要角色
2. 如果章节大纲中描述了具体场景/道具/对话，必须如实写入正文
3. 严格围绕章节大纲展开正文（最高优先级）
4. 不得违反世界规则和主角能力限制

### 📦 构建
- 正式 EXE：`src-tauri\target\release\AI Novel Studio.exe`
- 大小：约 10.5 MB

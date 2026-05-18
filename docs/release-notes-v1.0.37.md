# AI Novel Studio v1.0.37 发布说明

## 版本信息
- **版本号**: v1.0.37
- **发布日期**: 2026-05-18
- **类型**: 功能修复

## 核心修复：目标字数同步与应用

### 问题背景
AI 章节生成面板中的"目标字数"始终显示 4000 字，即使用户在输出控制/章节配置中修改了目标字数也无法生效。AI 生成的 prompt 也未使用用户配置的真实目标字数。

### 根本原因
1. `chapterRepository.ts` 在规范化章节数据时，将未设置的目标字数强制默认为 4000
2. `contextBuilder.ts` 的目标字数优先级错误（输出控制 > 章节，应为章节 > 输出控制）
3. `AiGeneratePanel.tsx` 的上下文摘要显示用 `|| 4000` 兜底
4. `ChapterFormModal.tsx` 新建章节时强制默认 4000

### 修复内容

#### 1. 数据层修复（chapterRepository.ts）
- 章节未设置目标字数时不再强制默认 4000，保留 `undefined`
- 允许上层（输出控制方案/上下文构建器）按优先级链补全
- 只有显式设置且 > 0 的值才会被保留

#### 2. 上下文构建器修复（contextBuilder.ts）
- 目标字数优先级修正为：**章节单独设置 > 输出控制方案 > 系统默认 4000**
- 章节明确设置的目标字数可覆盖输出控制方案的默认值

#### 3. AI 生成面板修复（AiGeneratePanel.tsx）
- 目标字数解析器优先级修正为：章节 > 输出控制 > 4000
- 上下文摘要显示使用已解析的实际字数，不再硬编码 4000
- 当前章节区域正确显示解析后的目标字数

#### 4. 章节表单修复（ChapterFormModal.tsx）
- 新建章节目标字数默认 0（表示未设置，由输出方案决定）
- 保存时如果为 0 则传 `undefined`，不强制写入

#### 5. 大纲生成修复（outlineGenerateService.ts）
- AI 生成的章节大纲不再强制默认 4000 字目标

### 目标字数优先级
```
章节单独设置的目标字数 (最高优先级)
  ↓ 章节未设置时
输出控制方案的目标字数 (chapterWordRange.default 或 targetWordCount)
  ↓ 输出方案也未设置时
系统默认值 4000 (最终降级)
```

### 修改文件
- `src/services/database/chapterRepository.ts` — 章节目标字数规范化修复
- `src/services/prompt/contextBuilder.ts` — 优先级修正
- `src/components/right-dock/panels/AiGeneratePanel.tsx` — 显示与解析修复
- `src/components/outline/ChapterFormModal.tsx` — 默认值修复
- `src/services/ai/outlineGenerateService.ts` — 大纲生成默认值修复
- `package.json` — 版本号 1.0.37
- `src-tauri/tauri.conf.json` — 版本号 1.0.37

### 验收标准
- ✅ 输出控制中修改目标字数后，写作工作台能显示新值
- ✅ 当前章节单独设置目标字数后，优先使用章节字数
- ✅ 章节未设置时，继承输出控制方案的目标字数
- ✅ 切换章节时目标字数按配置正确变化
- ✅ contextBuilder 使用正确的优先级链
- ✅ 默认 4000 只在没有任何配置时使用
- ✅ 项目正常构建（npm run build + cargo check）

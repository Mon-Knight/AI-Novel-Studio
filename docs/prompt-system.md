# AI Novel Studio 提示词系统设计文档

> 文件名：`prompt-system.md`  
> 项目：AI Novel Studio  
> 技术路线：Tauri + React + TypeScript + SQLite  
> 项目定位：Windows 桌面端 AI 小说创作软件  
> 文档目的：定义软件中 AI 提示词分工、提示词模板结构、上下文组装方式、AI 任务记录方式，为后续 Copilot Agent 开发提供统一依据。

---

## 1. 提示词系统的核心定位

AI Novel Studio 的核心不是“一个输入框 + 一个生成按钮”，而是通过不同提示词让 AI API 在不同创作阶段承担不同职责。

本项目中的 AI API 应被视为一个可调度的创作引擎。系统根据当前任务类型、作品资料、章节状态、风格方案、输出控制方案、角色信息、剧情事件和上下文摘要，自动组合提示词，再调用 AI API 完成相应任务。

核心目标是：

```text
用户准备基础资料
↓
系统根据任务类型选择提示词模板
↓
系统自动注入当前作品上下文
↓
AI 完成对应创作分工
↓
用户选择、修改、确认
↓
系统保存结果并沉淀上下文
↓
继续辅助下一章生成
```

---

## 2. 提示词系统必须遵守的产品原则

### 2.1 用户负责方向，AI 负责扩展

用户不需要从一开始填写完整世界观、完整角色库和完整剧情细节。用户主要提供：

- 大致世界背景
- 魔法 / 科技 / 规则体系
- 主角信息
- 主角特殊能力
- 分卷大纲
- 章节大纲
- 风格参考或输出控制要求
- 本章关键选择

AI 负责：

- 整理设定
- 扩展大纲
- 生成候选角色
- 推理候选事件
- 生成正文
- 润色正文
- 检查逻辑
- 总结章节
- 更新上下文

---

### 2.2 写作工作台只调用资产，不承担复杂资产管理

风格 TXT 导入、JSON 输出配置导入、风格画像分析、完整输出控制方案编辑等功能，应主要放在主界面、作品详情页或风格方案管理页。

写作工作台中的右侧工具栏只负责调用已有资产，例如：

- 当前章节
- 目标字数
- 风格方案
- 输出控制方案
- 本章出场角色
- 本章剧情事件
- 生成 / 重生成 / 润色 / 检查 / 确认采用

工作台不应堆满复杂配置表单。

---

### 2.3 中间正文区是 AI 正文输出区

写作工作台中间区域不是传统码字软件的纯手写区，而是：

```text
AI 生成正文
用户修改正文
用户要求重生成
用户要求润色
用户确认采用
```

系统只有在用户确认采用后，才应将该章正文作为正式内容参与后续上下文总结和下一章生成。

---

### 2.4 不直接模仿导入文本

TXT 文件可以用于分析写作风格，但不应在后续正文生成中反复塞入完整原文。正确流程是：

```text
导入 TXT
↓
AI 分析抽象风格特征
↓
生成风格画像
↓
用户确认 / 修改
↓
保存为风格方案
↓
正文生成时调用风格画像
```

风格方案应约束叙事方式、节奏、描写比例、对话比例、情绪倾向等，而不是复制原文句子、角色、桥段、设定或专有名词。

---

## 3. AI 任务类型总览

系统应将 AI 调用拆分为多个任务类型，而不是所有功能共用一个通用提示词。

建议第一阶段支持以下任务类型：

| 任务类型       | 内部标识                        | 主要用途                                     | 是否进入 MVP |
| -------------- | ------------------------------- | -------------------------------------------- | ------------ |
| 世界设定整理   | `world_setting_normalize`       | 将用户大致世界背景整理成结构化资料           | 是           |
| 规则体系整理   | `rule_system_normalize`         | 整理魔法、科技、修炼、能力、战斗规则         | 是           |
| 主角设定整理   | `protagonist_normalize`         | 整理主角身份、能力、目标、限制               | 是           |
| 风格分析       | `style_analyze`                 | 从 TXT 中提取风格画像                        | v0.6.0       |
| JSON 风格读取  | `style_json_import`             | 从 JSON 配置读取风格方案                     | v0.6.0       |
| 分卷大纲扩展   | `volume_outline_expand`         | 根据粗略分卷设想扩展分卷大纲                 | v0.3.0+      |
| 章节大纲生成   | `chapter_outline_generate`      | 根据分卷大纲生成章节列表                     | v0.3.0+      |
| 候选角色生成   | `character_candidates_generate` | 根据世界背景、规则体系、章节需求生成候选角色 | v0.7.0       |
| 候选事件推理   | `event_candidates_generate`     | 根据大纲、前文、角色状态推理可选事件         | v0.7.0       |
| 章节正文生成   | `chapter_draft_generate`        | 生成一章小说正文                             | 是           |
| 章节正文重生成 | `chapter_draft_regenerate`      | 在保留设定的情况下重新生成正文               | 是           |
| 根据当前稿修改 | `chapter_draft_rewrite`         | 按用户要求修改当前稿                         | v0.5.0+      |
| 正文润色       | `chapter_polish`                | 优化文字表达，不改变剧情事实                 | v0.9.0       |
| 质量检查       | `quality_check`                 | 检查逻辑、设定、角色行为、前后文割裂         | v0.9.0       |
| 章节总结       | `chapter_summarize`             | 确认采用后总结章节内容                       | v0.8.0       |
| 上下文更新     | `context_update`                | 更新角色状态、事件记录、伏笔、下一章衔接点   | v0.8.0       |

---

## 4. 提示词模板目录结构

建议在项目根目录建立 `prompts/` 文件夹，所有提示词模板集中管理，不要散落在页面组件中。

```text
prompts/
├─ system/
│  ├─ common_rules.md
│  ├─ fiction_writing_rules.md
│  └─ json_output_rules.md
│
├─ settings/
│  ├─ world_setting_normalize.md
│  ├─ rule_system_normalize.md
│  └─ protagonist_normalize.md
│
├─ style/
│  ├─ style_analyze.md
│  └─ style_json_import.md
│
├─ outline/
│  ├─ volume_outline_expand.md
│  └─ chapter_outline_generate.md
│
├─ workspace/
│  ├─ character_candidates_generate.md
│  ├─ event_candidates_generate.md
│  ├─ chapter_draft_generate.md
│  ├─ chapter_draft_regenerate.md
│  ├─ chapter_draft_rewrite.md
│  ├─ chapter_polish.md
│  └─ quality_check.md
│
└─ context/
   ├─ chapter_summarize.md
   └─ context_update.md
```

前端代码中不应直接硬编码大段提示词。应由提示词服务读取模板，再按变量组装。

---

## 5. 提示词模板基本格式

每个提示词模板建议采用 Markdown 格式，包含：

```text
# 任务名称

## 角色定位
说明 AI 在本任务中扮演什么角色。

## 输入资料
列出系统会注入哪些变量。

## 任务要求
说明 AI 需要完成什么。

## 输出格式
说明 AI 必须按什么结构返回。

## 禁止事项
说明 AI 不能做什么。
```

示例：

```markdown
# 章节正文生成

## 角色定位

你是长篇小说章节写作助手，负责根据用户确认的世界背景、角色、剧情事件、章节大纲和风格方案生成一章小说正文。

## 输入资料

- 作品基础信息：{{novel}}
- 世界背景：{{world_setting}}
- 规则体系：{{rule_system}}
- 主角设定：{{protagonist}}
- 当前分卷大纲：{{volume_outline}}
- 当前章节大纲：{{chapter_outline}}
- 前文摘要：{{previous_context}}
- 本章出场角色：{{selected_characters}}
- 本章必须发生事件：{{selected_events}}
- 风格方案：{{style_profile}}
- 输出控制方案：{{output_profile}}
- 用户补充要求：{{user_instruction}}

## 任务要求

请生成当前章节正文。

## 输出格式

直接输出小说正文，不要输出分析过程、提纲、解释或项目符号。

## 禁止事项

- 不得违背世界规则。
- 不得让角色做出与性格和目标明显冲突的行为。
- 不得复制参考文本原句。
- 不得跳过用户选择的必须发生事件。
```

---

## 6. 核心变量设计

提示词系统需要统一变量命名，避免不同页面各自拼接。

### 6.1 作品级变量

```ts
type NovelPromptContext = {
  novelId: string;
  title: string;
  genre?: string;
  synopsis?: string;
  targetLength?: number;
  currentVolumeId?: string;
  currentChapterId?: string;
};
```

### 6.2 世界设定变量

```ts
type WorldSettingPromptContext = {
  backgroundSummary: string;
  worldType?: string;
  era?: string;
  locations?: string[];
  powerStructure?: string;
};
```

### 6.3 规则体系变量

```ts
type RuleSystemPromptContext = {
  systemType: 'magic' | 'technology' | 'cultivation' | 'mixed' | 'other';
  basicRules: string;
  limitations: string;
  costOrRisk?: string;
  forbiddenBreaks?: string[];
};
```

### 6.4 主角变量

```ts
type ProtagonistPromptContext = {
  name?: string;
  identity?: string;
  goal?: string;
  personality?: string;
  specialAbility?: string;
  abilityLimitations?: string;
  hiddenSecrets?: string[];
};
```

### 6.5 章节变量

```ts
type ChapterPromptContext = {
  volumeTitle: string;
  chapterTitle: string;
  chapterOutline: string;
  chapterGoal?: string;
  previousChapterSummary?: string;
  nextHookRequirement?: string;
};
```

### 6.6 角色变量

```ts
type CharacterPromptContext = {
  id: string;
  name: string;
  identity: string;
  relationToProtagonist?: string;
  currentGoal?: string;
  personalityLimits?: string;
  forbiddenBehaviors?: string[];
  lastKnownState?: string;
  appearedChapters?: string[];
};
```

### 6.7 风格方案变量

```ts
type StyleProfilePromptContext = {
  name: string;
  sourceType: 'manual' | 'txt_analysis' | 'json_import';
  narrativePerspective?: string;
  tone?: string;
  pace?: string;
  sentenceStyle?: string;
  dialogueStyle?: string;
  descriptionDensity?: string;
  emotionTendency?: string;
  chapterEndingStyle?: string;
  forbiddenStyles?: string[];
};
```

### 6.8 输出控制变量

```ts
type OutputProfilePromptContext = {
  name: string;
  targetWordCount: number;
  minWordCount?: number;
  maxWordCount?: number;
  dialogueRatio?: number;
  descriptionRatio?: number;
  psychologicalRatio?: number;
  battleIntensity?: 'low' | 'medium' | 'high';
  emotionTendency?: string;
  pacingRequirement?: string;
  endingHookRequired?: boolean;
};
```

---

## 7. 章节正文生成的上下文组装顺序

正文生成是本项目最核心的 AI 调用。系统应按稳定顺序组装提示词，避免遗漏关键约束。

建议顺序如下：

```text
1. 通用系统规则
2. 小说写作规则
3. 当前任务说明
4. 作品信息
5. 世界背景
6. 规则体系
7. 主角设定
8. 当前卷 / 当前章大纲
9. 前文摘要
10. 已确认角色状态
11. 本章出场角色
12. 用户选择的剧情事件
13. 风格方案
14. 输出控制方案
15. 用户临时补充要求
16. 输出格式要求
17. 禁止事项
```

注意：

- 前文摘要应优先使用系统自动生成的章节总结，而不是每次塞入完整前文。
- 若当前章节是第一章，则前文摘要可以为空。
- 风格方案应是抽象画像，不应直接塞入大量参考文本原文。
- 用户选择的事件优先级高于 AI 自行发挥。
- 世界规则优先级高于爽点和临时发挥。

---

## 8. 右侧工作台面板与 AI 任务关系

写作工作台右侧面板不直接保存复杂数据，只触发 AI 任务和选择已有资产。

| 右侧面板 | 主要功能                               | 对应 AI 任务                                                                    |
| -------- | -------------------------------------- | ------------------------------------------------------------------------------- |
| AI 生成  | 生成、重生成、根据当前稿修改、确认采用 | `chapter_draft_generate` / `chapter_draft_regenerate` / `chapter_draft_rewrite` |
| 大纲     | 查看当前分卷和章节大纲                 | `chapter_outline_generate`                                                      |
| 角色     | 推荐候选角色，选择本章出场角色         | `character_candidates_generate`                                                 |
| 事件     | 推荐候选事件，选择本章必须发生事件     | `event_candidates_generate`                                                     |
| 设定     | 查看当前调用的世界背景和规则体系       | `world_setting_normalize` / `rule_system_normalize`                             |
| 风格     | 选择已有风格方案和输出控制方案         | `style_analyze` / `style_json_import`                                           |
| 检查     | 检查正文问题                           | `quality_check`                                                                 |
| 润色     | 润色当前正文                           | `chapter_polish`                                                                |

---

## 9. 角色生成提示词规则

角色生成不应一次性生成完整庞大角色库，而应根据当前章节需求按需生成候选角色。

输入：

- 世界背景
- 规则体系
- 主角设定
- 当前分卷大纲
- 当前章节大纲
- 已有角色库
- 用户对本章角色的需求

输出应为候选角色列表：

```json
{
  "candidates": [
    {
      "name": "角色姓名",
      "identity": "身份",
      "reason_for_appearance": "为什么适合本章出现",
      "relation_to_protagonist": "与主角关系",
      "current_goal": "当前目标",
      "personality": "性格",
      "behavior_limits": ["行为限制"],
      "forbidden_behaviors": ["不能做出的行为"],
      "possible_conflict": "可能带来的冲突"
    }
  ]
}
```

规则：

- 不得与已有角色重复。
- 不得违背世界背景和规则体系。
- 候选角色被用户选择后，才进入正式角色库。
- 正式角色再次出现时，必须调用已有角色资料，不得重新随机生成。

---

## 10. 事件推荐提示词规则

事件推荐应基于大纲，而不是完全自由发挥。

输入：

- 当前分卷大纲
- 当前章节大纲
- 前文摘要
- 主角当前状态
- 本章出场角色
- 已有伏笔
- 禁止事项

输出：

```json
{
  "events": [
    {
      "title": "事件标题",
      "summary": "事件简述",
      "why_it_fits": "为什么符合当前章节大纲",
      "required_characters": ["角色名"],
      "conflict_type": "冲突类型",
      "risk": "潜在风险",
      "foreshadowing": "可埋伏笔",
      "impact_on_next_chapter": "对下一章影响"
    }
  ]
}
```

规则：

- 事件必须服务于当前章节大纲。
- 事件不能强行改变主线方向，除非用户确认。
- 用户选择的事件会被转化为“本章必须发生事件”。
- 未选择事件不得作为本章既定事实写入正文。

---

## 11. 正文生成提示词规则

正文生成时，AI 应输出完整章节正文，避免输出“分析”“提纲”“我将如何写”等内容。

正文生成必须满足：

- 符合当前章节大纲
- 覆盖用户选择的必须发生事件
- 调用本章出场角色
- 保持角色关系和行为限制
- 遵守世界规则
- 符合风格方案
- 符合目标字数和节奏要求
- 结尾根据输出控制决定是否留下钩子

正文生成不得：

- 输出项目符号式剧情概述
- 输出“以下是正文”等提示语
- 大量解释设定
- 让角色突然违背性格
- 未经用户选择擅自加入重大事件
- 复制导入参考文本
- 无视目标字数严重偏离

---

## 12. 重生成与修改提示词规则

### 12.1 重新生成

重新生成用于用户对整章不满意时。

要求：

- 保留当前已选设定、角色、事件、风格和输出控制。
- 可以改变叙事切入点、细节展开、对白设计和场景安排。
- 不得改变用户已确认的必须发生事件。

### 12.2 根据当前稿修改

修改用于用户已经接受部分内容，但希望调整细节时。

输入应包含：

- 当前正文
- 用户修改要求
- 不允许改变的事实
- 可调整范围

输出应返回修改后的完整正文，或根据用户选择返回局部重写内容。

---

## 13. 润色提示词规则

润色任务只能优化表达，不能改变剧情事实。

润色允许：

- 优化病句
- 调整句式
- 增强画面感
- 改善节奏
- 改善对白自然度
- 减少重复表达

润色禁止：

- 改变角色行为结果
- 改变事件顺序
- 删除必须发生事件
- 新增重大情节
- 改变人物关系
- 改变世界规则
- 改变章节结尾事实

---

## 14. 质量检查提示词规则

质量检查应输出问题列表和建议，不应直接改正文。

检查维度：

```text
1. 世界规则冲突
2. 角色行为不合理
3. 章节大纲偏离
4. 用户选择事件遗漏
5. 前后文割裂
6. 伏笔丢失
7. 设定解释过度
8. 节奏问题
9. 对话问题
10. 病句和重复表达
```

建议输出格式：

```json
{
  "overall_score": 82,
  "issues": [
    {
      "type": "角色行为不合理",
      "severity": "medium",
      "location": "第 12 段",
      "description": "角色在没有动机铺垫的情况下突然帮助主角。",
      "suggestion": "增加角色观察到主角能力的铺垫，或降低其帮助程度。"
    }
  ],
  "summary": "整体可用，但需要补强角色动机。"
}
```

---

## 15. 章节总结与上下文更新规则

章节只有在用户点击“确认采用”后，才触发总结和上下文更新。

章节总结应提取：

- 本章发生了什么
- 主角做了什么选择
- 出场角色状态变化
- 角色关系变化
- 已公开信息
- 未公开秘密
- 新增伏笔
- 已回收伏笔
- 下一章衔接点
- 世界规则是否有新增说明

建议输出：

```json
{
  "chapter_summary": "本章摘要",
  "protagonist_state_update": "主角状态变化",
  "character_updates": [
    {
      "character_name": "角色名",
      "state_update": "状态变化",
      "relationship_update": "关系变化",
      "new_goal": "新的目标"
    }
  ],
  "confirmed_events": ["已确认发生的事件"],
  "foreshadowing_added": ["新增伏笔"],
  "foreshadowing_resolved": ["已回收伏笔"],
  "next_chapter_hooks": ["下一章衔接点"],
  "continuity_warnings": ["需要注意的连续性问题"]
}
```

---

## 16. 风格分析提示词规则

TXT 风格分析任务应提取抽象写作特征，而不是复述原文。

分析维度：

- 叙事人称
- 叙事距离
- 文风基调
- 节奏
- 句式特点
- 段落长度
- 描写密度
- 对话比例
- 心理描写比例
- 战斗描写方式
- 信息释放方式
- 冲突推进方式
- 章节开头方式
- 章节结尾钩子
- 禁用写法

输出应保存为 `style_profiles` 中的结构化数据。

禁止：

- 提取原文专有名词作为生成素材
- 要求 AI 模仿某个作者
- 复制原文句子
- 复刻原文桥段、人物、设定

---

## 17. JSON 风格配置导入规则

JSON 导入适合用户已有标准配置。

示例结构：

```json
{
  "style_name": "黑暗奇幻稳重风",
  "narrative_perspective": "第三人称有限视角",
  "tone": "冷峻、压抑、克制",
  "pace": "中速，关键冲突处加快",
  "dialogue_ratio": 0.3,
  "description_ratio": 0.45,
  "psychological_ratio": 0.2,
  "battle_intensity": "中高",
  "emotion_tendency": "紧张、压迫、隐忍",
  "chapter_ending": "保留悬念",
  "forbidden_styles": [
    "不要使用网络梗",
    "不要突然搞笑破坏氛围",
    "不要让角色无理由解释设定",
    "不要照抄参考文本"
  ]
}
```

系统应校验字段合法性，不合法时提示用户修正。

---

## 18. AI 任务记录

每次 AI 调用都应记录到 `ai_task_records`，方便回溯和调试。

建议字段：

```ts
type AiTaskRecord = {
  id: string;
  novelId: string;
  chapterId?: string;
  taskType: string;
  modelProvider?: string;
  modelName?: string;
  inputSummary: string;
  promptSnapshot?: string;
  outputText?: string;
  outputJson?: unknown;
  status: 'pending' | 'success' | 'failed' | 'cancelled';
  errorMessage?: string;
  createdAt: string;
  completedAt?: string;
};
```

注意：

- 可以保存提示词快照用于调试。
- 不得保存 API Key。
- 失败任务也要记录错误信息。
- 后期可增加 token 用量、耗时、费用估算。

---

## 19. 提示词优先级规则

当不同输入发生冲突时，按以下优先级处理：

```text
1. 安全与合规规则
2. 用户明确要求
3. 已确认正文事实
4. 已确认世界规则
5. 已确认角色设定和角色状态
6. 当前章节大纲
7. 用户选择的本章事件
8. 风格方案
9. 输出控制方案
10. AI 自行补充细节
```

AI 不得为了风格、爽点或戏剧冲突，推翻已确认事实。

---

## 20. 上下文长度控制

长篇小说项目不能每次把全部历史正文塞入提示词。应采用摘要和结构化状态。

推荐策略：

```text
当前章节正文生成时：
- 当前卷大纲：完整加载
- 当前章大纲：完整加载
- 上一章摘要：完整加载
- 最近 3 章摘要：加载
- 已确认角色状态：按出场角色加载
- 长期世界规则：摘要加载
- 已采用全文：不默认加载
```

后期可增加“上下文包”机制，但该上下文包应由系统自动生成，不应作为开局必填项。

---

## 21. 错误处理规则

AI 调用失败时，应给用户明确反馈：

```text
1. API Key 未配置
2. 网络连接失败
3. 模型返回为空
4. JSON 解析失败
5. 结果不符合格式
6. 超出上下文长度
7. 请求被模型拒绝
```

对于 JSON 输出任务，如果解析失败，系统可以提供一次“格式修复”重试，但不得无限重试。

---

## 22. 开发实现建议

建议建立以下服务：

```text
src/services/prompt/
├─ promptTemplateLoader.ts      # 读取提示词模板
├─ promptRenderer.ts            # 替换变量并组装提示词
├─ promptContextBuilder.ts      # 构建任务上下文
└─ promptRegistry.ts            # 任务类型与模板映射

src/services/ai/
├─ aiClient.ts                  # AI API 统一客户端
├─ aiTaskRunner.ts              # 运行 AI 任务
├─ aiTaskRecordService.ts       # 保存 AI 任务记录
└─ aiResultParser.ts            # 解析文本 / JSON 结果
```

任务注册示例：

```ts
export const promptRegistry = {
  chapter_draft_generate: {
    template: 'prompts/workspace/chapter_draft_generate.md',
    outputType: 'text',
  },
  event_candidates_generate: {
    template: 'prompts/workspace/event_candidates_generate.md',
    outputType: 'json',
  },
  quality_check: {
    template: 'prompts/workspace/quality_check.md',
    outputType: 'json',
  },
};
```

---

## 23. MVP 阶段的最小提示词闭环

v0.5.0 之前，提示词系统只需要先完成最小闭环：

```text
1. 章节正文生成
2. 章节正文重生成
3. 保存 AI 任务记录
4. 保存章节草稿
5. 用户确认采用
```

最小输入：

```text
作品名称
世界背景
规则体系
主角设定
章节大纲
目标字数
风格方案
用户补充要求
```

最小输出：

```text
一章小说正文
```

不要在 MVP 第一版强行加入复杂角色状态、事件树和多轮上下文包，否则开发复杂度会快速上升。

---

## 24. 后续版本扩展顺序

建议按以下顺序扩展提示词系统：

```text
v0.5.0：章节正文生成闭环
v0.6.0：风格方案与输出控制方案
v0.7.0：候选角色生成与候选事件推理
v0.8.0：章节总结与上下文更新
v0.9.0：质量检查与润色
v1.0.0：长篇连续创作基础闭环
```

---

## 25. 对 Copilot Agent 的开发约束

后续 Agent 修改提示词系统时必须遵守：

```text
1. 不要把大段提示词硬编码在 React 组件中。
2. 不要让不同 AI 任务共用一个混乱的大提示词。
3. 不要在工作台页面塞入复杂风格导入和完整配置编辑。
4. 不要将导入 TXT 原文作为长期生成上下文反复使用。
5. 不要默认把 AI 输出直接写入正式正文。
6. AI 生成结果必须先成为草稿，用户确认后才能采用。
7. 每次 AI 任务应保存任务记录。
8. API Key 不得写入代码或提交 GitHub。
9. 所有提示词模板应放在 prompts/ 目录。
10. 工作台右侧栏只负责选择和调用，不负责复杂资产管理。
```

---

## 26. 总结

AI Novel Studio 的提示词系统应围绕“逐章生成一本小说”的核心流程设计。

最终目标不是让 AI 一次性写完整本书，而是让系统成为一个可持续工作的创作流水线：

```text
基础设定
↓
大纲
↓
风格方案
↓
角色选择
↓
事件选择
↓
正文生成
↓
用户修改
↓
确认采用
↓
章节总结
↓
上下文更新
↓
下一章继续生成
```

提示词系统是该流程的中枢。它负责把用户的方向、已有资产、当前章节需求和 AI 分工组合起来，让 AI 在正确的位置做正确的事。

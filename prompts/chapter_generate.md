# AI Novel Studio - 章节正文生成提示词模板

你是一位专业的小说作家，正在创作一部长篇小说。

## 作品信息
- 作品名称：{{novel_title}}
- 作品题材：{{novel_genre}}
{{#world_background}}
- 世界背景：{{world_background}}
{{/world_background}}
{{#rule_systems}}
- 规则体系：{{rule_systems}}
{{/rule_systems}}

## 角色信息
- 主角：{{protagonist}}
{{#special_ability}}
- 特殊能力：{{special_ability}}
{{/special_ability}}
{{#ability_limits}}
- 能力限制：{{ability_limits}}
{{/ability_limits}}
{{#forbidden_behaviors}}
- 不能做出的行为：{{forbidden_behaviors}}
{{/forbidden_behaviors}}

## 当前进度
- 分卷：{{volume_title}}
{{#volume_goal}}
- 分卷目标：{{volume_goal}}
{{/volume_goal}}

## 当前章节
- 章节标题：{{chapter_title}}
{{#chapter_outline}}
- 章节大纲：{{chapter_outline}}
{{/chapter_outline}}
{{#chapter_goal}}
- 本章目标：{{chapter_goal}}
{{/chapter_goal}}
- 目标字数：约 {{target_word_count}} 字

## 写作要求
1. 严格围绕章节大纲展开正文，不要偏离大纲方向
2. 不要违背已设定的世界规则和角色设定
3. 不要让主角做出与设定冲突的行为或说出不符合性格的话
4. 不要擅自完结整本小说——这是一部长篇作品的一个章节
5. 不要写成大纲、分点说明或总结，直接输出小说正文
6. 不要输出"以下是正文""好的"等对话式引导语
7. 字数尽量接近目标字数
8. 保持中文小说表达方式，注重场景描写和人物心理
9. 结尾自然，但可以留下适度悬念
10. 段落分明，对话与描写交替进行

{{#chapter_characters}}
## 本章出场角色
{{chapter_characters}}

写作时严格遵循上述角色的性格、目标和行为限制，不要让角色做出其禁止行为。
{{/chapter_characters}}

{{#chapter_events}}
## 本章必须发生的事件
{{chapter_events}}

写作时必须完整涵盖上述事件，尤其确保标记为「必须发生」的事件在本章中真实发生。
{{/chapter_events}}

{{#previous_context}}
## 前文上下文摘要
{{previous_context}}

写作时必须严格遵守以下原则：
1. 必须尊重前文已经发生的关键事件，不得颠倒或遗忘
2. 角色状态必须与前文最新状态一致，不得让角色状态倒退
3. 重要伏笔必须在合适时机继续推进或回收
4. 不要重复前文已经完成的情节
5. 如果当前章节与前文上下文冲突，应优先遵守用户已确认的上下文记录
{{/previous_context}}

{{#style_profile}}
## 写作风格约束
{{style_profile}}

以上是抽象风格约束，不允许复制任何参考文本中的具体句子、段落、人物、地名、组织名、特殊设定。
{{/style_profile}}

{{#output_profile}}
## 输出控制
{{output_profile}}
{{/output_profile}}

{{#user_instruction}}
## 本章特别要求
{{user_instruction}}
{{/user_instruction}}

现在，请开始写第 {{chapter_title}} 的正文。

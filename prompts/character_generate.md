# 角色生成提示词模板

你是一位资深小说角色设计师。请根据以下小说上下文，为当前章节推荐出场角色。

## 小说信息
- 小说：{{novelTitle}}
- 题材：{{genre}}
- 世界背景摘要：{{worldSummary}}

## 当前章节
- 章节标题：{{chapterTitle}}
- 章节大纲：{{chapterOutline}}

## 已有角色
{{#existingCharacters}}
- {{name}}（{{roleType}} / {{identity}}）：{{personality}}。当前状态：{{currentState}}。禁止行为：{{forbiddenBehaviors}}
{{/existingCharacters}}

## 要求
请生成 2-4 个适合本章出场的候选角色（不含已有角色），每个角色需包含：
- 名字
- 角色类型（protagonist / supporting / antagonist / neutral）
- 身份
- 阵营
- 与主角的关系
- 目标
- 性格特征
- 行为限制
- 禁止行为
- 当前状态
- 在本章功能

格式：JSON 数组。

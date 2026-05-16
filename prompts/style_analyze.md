# AI Novel Studio - 风格分析提示词模板

你是一位专业的文学风格分析师。请分析以下参考文本的写作风格。

## 分析要求
1. 只分析抽象风格特征，不复刻原文具体句子
2. 不提取专有角色名、地名、组织名、专有设定
3. 不模仿具体描述片段
4. 分析叙事人称、节奏、句式、对话比例、描写比例、心理描写、战斗写法、情绪倾向、章节结尾方式、禁用写法
5. 输出必须为合法 JSON 格式，不要输出其他内容

## 参考文本
{{reference_text}}

## 输出格式
请按以下 JSON 格式输出分析结果：

```json
{
  "name": "为风格起一个名字",
  "narrativePerspective": "叙事人称",
  "tone": "文风语气",
  "pace": "节奏（快/中等/慢）",
  "sentenceStyle": "句式特点",
  "dialogueRatio": 0.35,
  "descriptionRatio": 0.40,
  "psychologicalRatio": 0.15,
  "battleStyle": "战斗描写方式",
  "battleIntensity": "战斗强度（low/medium/high）",
  "emotionTendency": "情绪倾向",
  "chapterEnding": "章节结尾方式",
  "forbiddenStyles": ["禁用写法1", "禁用写法2"],
  "styleSummary": "整体风格总结，100字以内"
}
```

请严格输出 JSON，不要添加任何解释。

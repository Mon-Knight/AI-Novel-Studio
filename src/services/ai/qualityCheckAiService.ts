/**
 * AI Novel Studio - AI 质量检查（Mock）
 */
import type { QualityCheckResult, RunQualityCheckInput } from '../../types/qualityCheck';

function sleep(ms: number): Promise<void> { return new Promise((r) => setTimeout(r, ms)); }

export const qualityCheckAiService = {
  async runCheck(input: RunQualityCheckInput): Promise<QualityCheckResult> {
    await sleep(1200);
    const hasContent = input.draftContent.length > 50;
    return {
      overallScore: hasContent ? 78 : 50,
      summary: hasContent
        ? `本章「${input.chapterTitle}」整体质量良好，主线推进清晰，但在角色行为一致性和节奏控制上还有提升空间。共发现 5 个需要关注的问题。`
        : '正文内容过短，无法进行有效的质量检查。',
      items: hasContent ? [
        { issueType: 'character_behavior', severity: 'high', title: '角色行为与设定不符', description: `主角在关键时刻的行为与已设定性格存在偏差。${input.chapterCharacters ? '请检查本章出场角色的言行是否符合其性格设定。' : ''}`, evidence: input.draftContent.slice(0, 80) + '……', suggestion: '回顾角色设定中的性格描述和行为限制，确保关键决策符合角色立场。' },
        { issueType: 'setting_violation', severity: 'medium', title: '可能违反能力限制', description: `主角使用特殊能力时，未体现应有的代价或限制。${input.specialAbility ? '设定中的能力限制需要在本章体现。' : ''}`, evidence: input.draftContent.slice(20, 100) + '……', suggestion: '在使用能力的关键场景中加入代价描写（疲惫、副作用等）。' },
        { issueType: 'continuity', severity: 'medium', title: '与前后文衔接需注意', description: '本章某些设定与前文可能存在不一致，请核实与上一章的衔接。', evidence: '', suggestion: '对比上一章总结，确认关键信息和角色状态前后一致。' },
        { issueType: 'pacing', severity: 'low', title: '中段节奏稍显急促', description: '章节中段的冲突解决速度较快，读者可能感到进展过于突然。', evidence: '', suggestion: '在中段增加过渡段落，让情节推进更自然。' },
        { issueType: 'language', severity: 'low', title: '部分表达重复', description: '同一描述方式在短距离内重复出现，建议替换用词。', evidence: '', suggestion: '使用同义词或变换句式来避免重复。' },
      ] : [
        { issueType: 'other', severity: 'high', title: '正文内容不足', description: '当前草稿正文过短（少于 50 字），无法进行全面的质量检查。', evidence: '', suggestion: '请先生成完整的章节正文后再进行检查。' },
      ],
    };
  },
};

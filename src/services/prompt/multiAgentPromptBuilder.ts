import reviewSystemTemplate from '../../../prompts/multi_agent_review_system.md?raw';
import outlineTemplate from '../../../prompts/multi_agent_outline_review.md?raw';
import characterTemplate from '../../../prompts/multi_agent_character_review.md?raw';
import settingTemplate from '../../../prompts/multi_agent_setting_review.md?raw';
import logicTemplate from '../../../prompts/multi_agent_logic_review.md?raw';
import polishTemplate from '../../../prompts/multi_agent_polish_review.md?raw';
import qualityTemplate from '../../../prompts/multi_agent_quality_review.md?raw';
import revisionTemplate from '../../../prompts/multi_agent_revision.md?raw';
import type { AiGenerateRequest } from '../../types/ai';
import type { DraftRevisionRequest, ExpertReviewRequest, ExpertType } from '../../types/multiAgent';

const EXPERT_TEMPLATES: Record<ExpertType, string> = {
  outline: outlineTemplate,
  character: characterTemplate,
  setting: settingTemplate,
  logic: logicTemplate,
  polish: polishTemplate,
  quality: qualityTemplate,
};

function section(title: string, value: string): string {
  return `【${title}】\n${value.trim() || '（未提供）'}`;
}

export function buildMultiAgentExpertRequest(input: ExpertReviewRequest): AiGenerateRequest {
  const system = [
    `[MULTI_AGENT_EXPERT:${input.expert}]`,
    reviewSystemTemplate.trim(),
    EXPERT_TEMPLATES[input.expert].trim(),
  ].join('\n\n');

  const user = [
    `这是第 ${input.roundNumber} 轮评审。`,
    section('章节标题', input.chapterTitle),
    section('章节大纲', input.chapterOutline),
    section('章节目标', input.chapterGoal),
    section('当前草稿', input.draftContent),
  ].join('\n\n');

  return {
    taskType: 'multi_agent_review',
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    temperature: 0.2,
    maxTokens: 1800,
    promptTemplateSource: `prompts/multi_agent_${input.expert}_review.md`,
  };
}

export function buildMultiAgentRevisionRequest(input: DraftRevisionRequest): AiGenerateRequest {
  const actionLabel =
    input.action === 'regenerate' ? 'regenerate（重构重写）' : 'revise（定向修订）';
  const user = [
    `[MULTI_AGENT_REVISION:${input.action}]`,
    `这是第 ${input.roundNumber} 轮之后的候选稿生成。`,
    section('动作', actionLabel),
    section('章节标题', input.chapterTitle),
    section('章节大纲', input.chapterOutline),
    section('章节目标', input.chapterGoal),
    section(
      '主要问题',
      input.majorConcerns.map((item, index) => `${index + 1}. ${item}`).join('\n'),
    ),
    section('合并建议', input.suggestions.map((item, index) => `${index + 1}. ${item}`).join('\n')),
    section('当前草稿', input.draftContent),
  ].join('\n\n');

  return {
    taskType: 'multi_agent_revision',
    messages: [
      { role: 'system', content: revisionTemplate.trim() },
      { role: 'user', content: user },
    ],
    temperature: input.action === 'regenerate' ? 0.75 : 0.45,
    maxTokens: 12000,
    promptTemplateSource: 'prompts/multi_agent_revision.md',
  };
}

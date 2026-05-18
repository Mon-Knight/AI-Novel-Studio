import type { AiClient, AiGenerateRequest, AiGenerateResponse, ChapterCharacterContext, OutlineKeyPoint } from '../../types/ai';

export interface ReviseChapterByOutlineInput {
  originalDraft: string;
  chapterTitle?: string;
  chapterOutline?: string;
  outlineChecklistText?: string;
  missingPoints: OutlineKeyPoint[];
  requiredCharacters?: ChapterCharacterContext[];
  targetWordCount?: number;
}

function formatMissingPoints(points: OutlineKeyPoint[]): string {
  if (points.length === 0) return '无明确缺失点，但仍需重新对照章节大纲强化执行。';
  return points.map((point, index) => `${index + 1}. ${point.text}`).join('\n');
}

function formatRequiredCharacters(characters?: ChapterCharacterContext[]): string {
  const list = characters?.filter((item) => item.name) ?? [];
  if (list.length === 0) return '无必须出场角色。';
  return list
    .map((item, index) => {
      const details = [
        `${index + 1}. ${item.name}`,
        item.identity ? `身份：${item.identity}` : '',
        item.goal ? `目标：${item.goal}` : '',
        item.personality ? `性格：${item.personality}` : '',
        item.behaviorLimits ? `行为限制：${item.behaviorLimits}` : '',
      ].filter(Boolean);
      return details.join('；');
    })
    .join('\n');
}

export function buildReviseChapterByOutlineRequest(
  input: ReviseChapterByOutlineInput,
): AiGenerateRequest {
  const system = [
    '你是一位资深小说修稿编辑。你将收到一段已经生成的章节正文，但它没有完全遵循章节大纲。',
    '请在尽量保留原正文可用内容的基础上重写/修正，使正文覆盖缺失的大纲关键点。',
    '',
    `【章节标题】${input.chapterTitle || '当前章节'}`,
    '',
    '【章节大纲】',
    input.chapterOutline?.trim() || '（空）',
    '',
    '【章节大纲执行清单】',
    input.outlineChecklistText?.trim() || input.chapterOutline?.trim() || '（空）',
    '',
    '【缺失的大纲关键点】',
    formatMissingPoints(input.missingPoints),
    '',
    '【本章必须出场角色】',
    formatRequiredCharacters(input.requiredCharacters),
    '',
    '【修正要求】',
    '1. 必须补足缺失关键点。',
    '2. 必须保留本章必须出场角色，并让角色在正文中直接行动、对话、思考或参与冲突。',
    '3. 不得改变已确认的世界设定、角色姓名和前文事实。',
    '4. 尽量保留原正文中可用的场景、情绪和句子，但要重排剧情以服务章节大纲。',
    '5. 必须补足关键事件、角色行动、冲突推进和结尾安排。',
    '6. 输出完整修正版正文，不要写说明、分析或 Markdown 标记。',
    input.targetWordCount ? `7. 字数尽量接近 ${input.targetWordCount} 字。` : '',
    '',
    '【原正文】',
    input.originalDraft.slice(0, 18000),
  ].filter(Boolean).join('\n');

  return {
    taskType: 'chapter_rewrite',
    messages: [
      {
        role: 'system',
        content: '你负责把偏离大纲的小说草稿修正为可采用正文。',
      },
      {
        role: 'user',
        content: system,
      },
    ],
    maxTokens: input.targetWordCount && input.targetWordCount > 6000 ? 12000 : 8000,
  };
}

export async function reviseChapterByOutline(
  input: ReviseChapterByOutlineInput,
  client: AiClient,
): Promise<AiGenerateResponse> {
  return client.generate(buildReviseChapterByOutlineRequest(input));
}


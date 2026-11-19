import { sha256 } from './compilation/canonical';

export interface MockChapterInfo {
  chapterTitle?: string;
  targetWords?: number;
}

type JsonObject = Record<string, unknown>;

function asJsonObject(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonObject) : {};
}

function stringField(value: JsonObject, key: string, fallback = ''): string {
  const field = value[key];
  return typeof field === 'string' && field.trim() ? field : fallback;
}

export function mockChapterScenePlan(): string {
  return JSON.stringify({
    scenes: [
      {
        sceneNo: 1,
        title: '线索进入现场',
        contextCapsule: '主角刚进入当前场景，尚未确认线索来源。',
        location: '当前章节主要地点',
        characters: ['主角'],
        goal: '让主角获得一个可验证的新线索。',
        conflict: '时间压力迫使主角在信息不完整时做出选择。',
        beats: [
          { order: 1, text: '建立场景开场状态并明确当前行动目标。', required: true },
          { order: 2, text: '出现阻力，使主角必须采取具体行动。', required: true },
          { order: 3, text: '以新的线索或状态变化结束场景。', required: true },
        ],
        constraints: ['保持当前视角，不提前解释幕后真相。'],
        expectedEndState: '主角获得下一步行动依据。',
        result: '主角得到下一步行动依据。',
        transition: '转入下一场景的行动准备。',
      },
    ],
  });
}

function mockChapterScenePlanV2(info: MockChapterInfo): string {
  const chapterTitle = info.chapterTitle || '未命名章节';
  const target =
    Number.isFinite(info.targetWords) && (info.targetWords ?? 0) > 0 ? info.targetWords! : 2500;
  // At least one Beat must fit without pretending prose was already written.
  if (target < 500) {
    throw new Error(`Mock Scene 规划无法为 ${target} 字分配至少一个合法 Beat。`);
  }
  const sceneCount = target >= 1_000 ? 2 : 1;
  const firstTarget = sceneCount === 1 ? target : Math.floor(target / 2);
  const secondTarget = target - firstTarget;
  const scenes = [
    {
      sceneNo: 1,
      title: '城门盘查',
      contextCapsule: `${chapterTitle}开场：主角带着不能示人的物件抵达城门，守卫尚未放行。`,
      location: '城门',
      characters: ['主角', '守卫'],
      goal: '让主角通过盘查，同时留下可追踪的暴露风险。',
      conflict: '守卫要求出示通行凭证，主角必须在不暴露真实目的的前提下应对。',
      constraints: ['保持当前视角，不提前解释幕后真相。'],
      expectedEndState: '主角进入城门，但守卫记住了他的脸。',
      result: '主角获得进城资格。',
      transition: '转入城内与接头人接触。',
      targetCharacters: firstTarget,
    },
  ];
  if (sceneCount === 2) {
    scenes.push({
      sceneNo: 2,
      title: '客栈接头',
      contextCapsule: '主角进入城内客栈，按约定寻找接头人，但尚未确认对方身份。',
      location: '城内客栈',
      characters: ['主角', '掌柜'],
      goal: '确认接头暗号并取得下一步线索。',
      conflict: '掌柜反复试探，主角必须在信息不完整时判断是否暴露身份。',
      constraints: ['不得提前揭示接头人的真实身份。'],
      expectedEndState: '主角确认暗号有效，并得到下一步行动线索。',
      result: '主角取得下一步行动线索。',
      transition: '转入下一章的行动准备。',
      targetCharacters: secondTarget,
    });
  }
  return JSON.stringify({ scenes });
}

function balancedJsonObject(text: string, start: number): string | undefined {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const character = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') {
      inString = true;
      continue;
    }
    if (character === '{') depth += 1;
    else if (character === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(start, index + 1);
    }
  }
  return undefined;
}

function compiledContextJson(messages: { role: string; content: string }[]): JsonObject {
  for (const message of messages) {
    const compiledMarker = message.content.indexOf('【编译上下文】');
    const markerIndex = compiledMarker >= 0 ? compiledMarker : message.content.indexOf('Context：');
    if (markerIndex < 0) continue;
    const start = message.content.indexOf('{', markerIndex);
    if (start < 0) continue;
    const objectText = balancedJsonObject(message.content, start);
    if (!objectText) continue;
    try {
      const parsed = JSON.parse(objectText) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as JsonObject;
      }
    } catch {
      continue;
    }
  }
  return {};
}

function mockChapterBeatPlan(messages: { role: string; content: string }[]): string {
  const allText = messages.map((message) => message.content).join('\n');
  const countMatch = allText.match(/恰好包含\s*(\d+)\s*个有序\s*Beat/u);
  if (!countMatch) throw new Error('Mock Beat 规划缺少 targetBeatCount。');
  const count = Number(countMatch[1]);
  if (!Number.isSafeInteger(count) || count < 1) {
    throw new Error('Mock Beat 规划收到无效的 targetBeatCount。');
  }
  const sceneNo = Number(allText.match(/当前 Scene：\s*(\d+)/u)?.[1]) || 1;
  const context = compiledContextJson(messages);
  const scene = asJsonObject(context.scene);
  const actual = asJsonObject(context.actual);
  const sceneTitle = stringField(scene, 'title', `Scene ${sceneNo}`);
  const sceneGoal = stringField(scene, 'goal', '推进当前 Scene 的目标。');
  const entryState = stringField(actual, 'actualEntryState');
  if (!entryState.trim()) throw new Error('Mock Beat 规划缺少实际入口状态。');
  return JSON.stringify({
    beats: Array.from({ length: count }, (_, index) => ({
      order: index + 1,
      text: `${sceneTitle}：围绕“${sceneGoal}”完成第 ${index + 1} 个连续事件推进。`,
      required: true,
      startState: index === 0 ? entryState : `承接第 ${index} 个 Beat 的实际结尾状态。`,
      stateChange: `第 ${index + 1} 个 Beat 完成计划中的状态推进。`,
    })),
  });
}

async function mockChapterBeatStateExtract(
  messages: {
    role: string;
    content: string;
  }[],
): Promise<string> {
  const context = compiledContextJson(messages);
  const actualProse = stringField(context, 'prose');
  if (!actualProse.trim()) throw new Error('Mock 状态提取缺少当前 Beat 正文。');
  const start = actualProse.search(/\S/u);
  if (start < 0) throw new Error('Mock 状态提取收到空正文。');
  let end = Math.min(actualProse.length, start + 24);
  if (end < actualProse.length && /[\uD800-\uDBFF]/u.test(actualProse[end - 1])) end -= 1;
  if (end <= start) end = Math.min(actualProse.length, start + 1);
  const quote = actualProse.slice(start, end);
  const sourceTextHash = await sha256(actualProse);
  const fact = {
    text: `本 Beat 正文已写出：“${quote}”`,
    epistemic: 'explicit',
    evidence: [{ start, end, quote }],
  };
  return JSON.stringify({
    schemaVersion: 1,
    sourceTextHash,
    actualStateChange: [fact],
    endState: fact,
    unknowns: [],
    semanticValidation: 'not_checked',
  });
}

/**
 * Dispatch for the staged chapter task types. Unknown or legacy types fall
 * back to the caller's existing mock so this module never becomes a second
 * chapter generator.
 */
export async function mockChapterStagedResponse(
  taskType: string,
  messages: { role: string; content: string }[],
  info: MockChapterInfo,
  fallback: () => string,
): Promise<string> {
  switch (taskType) {
    case 'chapter_scene_plan_v2_generate':
      return mockChapterScenePlanV2(info);
    case 'chapter_beat_plan_generate':
      return mockChapterBeatPlan(messages);
    case 'chapter_beat_state_extract':
      return mockChapterBeatStateExtract(messages);
    default:
      return fallback();
  }
}

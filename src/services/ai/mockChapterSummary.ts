import type { ChapterSummaryGrounding } from '../../types/chapterSummary';
import { summaryAssertionTargets } from './chapterSummaryGrounding';

export interface MockChapterSummaryInfo {
  chapterTitle: string;
  protagonist: string;
  chapterOutline?: string;
}

interface MockMessage {
  role: string;
  content: string;
}

const ADOPTED_CONTENT_MARKERS = ['当前连续分段正文：', '已采用正文：'] as const;
const REDUCE_MARKER = '【按原文顺序排列的分段总结 JSON】';
const MAX_QUOTE_CODE_POINTS = 1200;

function systemContent(messages: MockMessage[]): string {
  return messages.find((message) => message.role === 'system')?.content ?? '';
}

function adoptedContent(system: string): string {
  for (const marker of ADOPTED_CONTENT_MARKERS) {
    const index = system.lastIndexOf(marker);
    if (index >= 0) return system.slice(index + marker.length).trim();
  }
  return '';
}

function sentencesOf(source: string): string[] {
  const sentences = (source.match(/[^。！？!?]+[。！？!?]?/g) ?? [])
    .map((sentence) => sentence.trim())
    .filter(Boolean);
  return sentences.length > 0 ? sentences : [source.trim()].filter(Boolean);
}

function isQualified(text: string): boolean {
  return /可能|推测|猜测|尚未|未能|未知|不知|无法|不能|计划|准备|拟|打算|将要|有待|待查|尚待|愿意|没有|并未|从未|尚无|无从|未曾|还没|未完成|未确认|并非|不曾|是否|据称|听说|声称|自称/.test(
    text,
  );
}

function boundedQuote(text: string): string {
  const characters = Array.from(text.trim());
  return characters.length > MAX_QUOTE_CODE_POINTS
    ? characters.slice(0, MAX_QUOTE_CODE_POINTS).join('')
    : characters.join('');
}

function quoteFor(statement: string, sentences: string[], source: string): string {
  const containing = sentences.find((sentence) => sentence.includes(statement));
  if (containing) return boundedQuote(containing);
  if (!isQualified(statement)) {
    const neutral = sentences.find((sentence) => !isQualified(sentence));
    if (neutral) return boundedQuote(neutral);
  }
  return boundedQuote(sentences[0] ?? source);
}

function groundingFor(
  payload: Record<string, unknown>,
  sentences: string[],
  source: string,
): ChapterSummaryGrounding {
  return {
    version: 1,
    claims: [...summaryAssertionTargets(payload)].map(([path, statement]) => ({
      path,
      status: 'confirmed' as const,
      quotes: [quoteFor(statement, sentences, source)],
    })),
  };
}

function groundedSummary(info: MockChapterSummaryInfo, source: string): Record<string, unknown> {
  const sentences = sentencesOf(source);
  const first = sentences[0] ?? source;
  const second = sentences[1] ?? first;
  const third = sentences[2] ?? second;
  const protagonist = info.protagonist.trim();
  const hasProtagonist = protagonist.length >= 2 && source.includes(protagonist);
  const chapterTitle = info.chapterTitle || '本章';
  const payload: Record<string, unknown> = {
    summaryTitle: `${chapterTitle}上下文`,
    summary: first,
    keyEvents: [...new Set([first, second, third])],
    coreEvents: [second],
    protagonistStateChange: second,
    importantCharacterChanges: [{ name: protagonist || '主角', change: second }],
    characterChanges: hasProtagonist ? [{ characterName: protagonist, stateSummary: second }] : [],
    relationshipChanges: [],
    settingChanges: [third],
    newLocations: [],
    newItemsOrAbilities: [],
    newForeshadows: [third],
    resolvedForeshadows: [],
    foreshadowing: [],
    unresolvedQuestions: [],
    factsMustRemember: [first],
    nextChapterHints: third,
    nextChapterHook: third,
    contextRecords: [
      {
        contextType: 'chapter_summary',
        title: `${chapterTitle}摘要`,
        content: first,
        importance: 4,
      },
    ],
  };
  payload.grounding = groundingFor(payload, sentences, source);
  return payload;
}

function reducedSummary(system: string): Record<string, unknown> | null {
  const markerIndex = system.indexOf(REDUCE_MARKER);
  if (markerIndex < 0) return null;
  try {
    const parsed: unknown = JSON.parse(system.slice(markerIndex + REDUCE_MARKER.length).trim());
    if (!Array.isArray(parsed)) return null;
    const summaries = parsed
      .map((item) =>
        item && typeof item === 'object' ? (item as Record<string, unknown>).summary : undefined,
      )
      .filter(
        (item): item is Record<string, unknown> =>
          Boolean(item) && typeof item === 'object' && !Array.isArray(item),
      );
    // Reduce prompts only carry partial summaries. Reusing the final partial
    // keeps every evidence quote anchored in the original adopted text.
    return summaries.length > 0 ? summaries[summaries.length - 1] : null;
  } catch {
    return null;
  }
}

function ungroundedSummary(info: MockChapterSummaryInfo): Record<string, unknown> {
  return {
    summaryTitle: `${info.chapterTitle}上下文`,
    summary: `本章《${info.chapterTitle}》推进了主线，并留下后续承接点。`,
    keyEvents: ['主角进入关键场景', '重要冲突被触发', '获得新的线索'],
    coreEvents: ['主角获得可继续追查的关键线索'],
    protagonistStateChange: '主角由被动应对转为主动追查。',
    importantCharacterChanges: [{ name: info.protagonist, change: '目标更明确，并决定继续追查。' }],
    characterChanges: [
      {
        characterName: info.protagonist,
        stateSummary: '经历本章事件后目标更明确。',
        relationshipChanges: '与同伴信任上升',
        goalChanges: '准备追查下一条线索',
      },
    ],
    relationshipChanges: [],
    settingChanges: ['关键场景受隐藏势力影响'],
    newLocations: ['关键线索所在的新场景'],
    newItemsOrAbilities: [],
    newForeshadows: ['关键线索背后仍有隐藏势力'],
    resolvedForeshadows: [],
    foreshadowing: ['隐藏势力仍未现身'],
    unresolvedQuestions: ['隐藏势力为何介入'],
    factsMustRemember: ['主角已经获得关键线索'],
    nextChapterHints: '下一章可以承接本章线索，继续推进调查和冲突。',
    nextChapterHook: '关键线索指向新的调查目标。',
    contextRecords: [
      {
        contextType: 'chapter_summary',
        title: `${info.chapterTitle}摘要`,
        content: `本章核心事件：${info.chapterOutline || '主线推进'}`,
        importance: 4,
      },
    ],
  };
}

export function mockChapterSummary(info: MockChapterSummaryInfo, messages: MockMessage[]): string {
  const system = systemContent(messages);
  const reduced = reducedSummary(system);
  if (reduced) return JSON.stringify(reduced);
  const source = adoptedContent(system);
  return JSON.stringify(source ? groundedSummary(info, source) : ungroundedSummary(info));
}

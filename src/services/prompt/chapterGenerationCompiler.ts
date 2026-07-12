import type { ChapterDraft, ChapterGenerationContext } from '../../types/ai';
import type { ChapterEvent } from '../../types/chapterEvent';
import type { ChapterSummary } from '../../types/chapterSummary';
import type {
  ChapterGenerationCompilationSource,
  ChapterGenerationConstraint,
  ChapterGenerationConstraintKind,
  ChapterGenerationConstraintSet,
  ChapterGenerationContextContract,
  ChapterGenerationContextPriority,
  ChapterGenerationContextSection,
  ChapterGenerationDraftBaseline,
  ChapterGenerationEventConstraint,
  ChapterGenerationQualityIssue,
  ChapterGenerationRecentState,
  ChapterGenerationPromptTemplate,
  ChapterGenerationSourceRef,
  ChapterGenerationSummarySource,
  ChapterGenerationTextSource,
  CompiledChapterGeneration,
} from '../../types/chapterGenerationCompilation';
import { computeContentSha256 } from '../../utils/contentIntegrity';
import { hashTextContent } from '../../utils/contentHash';
import { chapterEventService } from '../characters/chapterEventService';
import { chapterEngineeringService } from '../engineering/chapterEngineeringService';
import { chapterSummaryService } from '../context/chapterSummaryService';
import { contextRecordService } from '../context/contextRecordService';
import { chapterRepository } from '../database/chapterRepository';
import { draftVersionService } from '../database/draftVersionService';
import { novelRepository } from '../database/novelRepository';
import { settingRepository } from '../database/settingRepository';
import { volumeRepository } from '../database/volumeRepository';
import { buildFreshChapterGenerationContext } from './contextBuilder';
import { buildGenerateRequest, getChapterGeneratePromptTemplate } from './promptOrchestrator';
import { qualityCheckService } from '../quality/qualityCheckService';

export const CHAPTER_GENERATION_COMPILER_VERSION = 'chapter-context-constraint-v1';
export const CHAPTER_GENERATION_CONTEXT_BUDGET_CHARS = 24_000;
export const CHAPTER_GENERATION_CONSTRAINT_BUDGET_CHARS = 12_000;

export interface CompileChapterGenerationInput {
  novelId: string;
  volumeId?: string;
  chapterId: string;
  sourceDraftId: string;
  sourceDraftVersion: number;
  baseContentHash: string;
  userInstruction?: string;
  styleId?: string;
  outputId?: string;
  targetWordCount?: number;
  draftContent?: string;
}

interface ContextCandidate {
  key: string;
  title: string;
  priority: ChapterGenerationContextPriority;
  maxChars: number;
  content: string;
  sourceRefs: ChapterGenerationSourceRef[];
  apply: (context: ChapterGenerationContext, content: string | undefined) => void;
}

interface ConstraintCandidate {
  key: string;
  kind: ChapterGenerationConstraintKind;
  text: string;
  sourceRefs: ChapterGenerationSourceRef[];
}

interface BoundedContextResult {
  context: ChapterGenerationContext;
  sections: ChapterGenerationContextSection[];
  text: string;
  budget: ChapterGenerationContextContract['budget'];
  warnings: string[];
  sourceRefs: ChapterGenerationSourceRef[];
}

function cleanText(value?: string | null): string {
  return value?.trim() ?? '';
}

function textLength(value?: string | null): number {
  return Array.from(value ?? '').length;
}

function truncateText(value: string, maxChars: number): string {
  const chars = Array.from(value);
  if (chars.length <= maxChars) return value;
  if (maxChars <= 1) return chars.slice(0, maxChars).join('');
  return `${chars.slice(0, maxChars - 1).join('')}…`;
}

function stableCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function stableStringify(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort(stableCompare).map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
}

function createSourceRef(
  kind: string,
  sourceId: string | undefined,
  content: string,
): ChapterGenerationSourceRef {
  const originalChars = textLength(content);
  return {
    kind,
    sourceId,
    status: originalChars > 0 ? 'used' : 'missing',
    originalChars,
    includedChars: 0,
    contentHash: originalChars > 0 ? hashTextContent(content) : undefined,
  };
}

function updateSourceRefs(refs: ChapterGenerationSourceRef[], includedChars: number): void {
  for (const ref of refs) {
    ref.includedChars = Math.min(ref.originalChars, includedChars);
    if (ref.originalChars === 0) {
      ref.status = 'missing';
    } else if (ref.includedChars < ref.originalChars) {
      ref.status = 'trimmed';
    } else {
      ref.status = 'used';
    }
  }
}

function dedupeSourceRefs(refs: ChapterGenerationSourceRef[]): ChapterGenerationSourceRef[] {
  const grouped = new Map<string, ChapterGenerationSourceRef>();
  for (const ref of refs) {
    const key = `${ref.kind}:${ref.sourceId ?? ''}:${ref.contentHash ?? ''}`;
    const existing = grouped.get(key);
    if (!existing) {
      grouped.set(key, { ...ref });
      continue;
    }
    existing.originalChars = Math.max(existing.originalChars, ref.originalChars);
    existing.includedChars = Math.max(existing.includedChars, ref.includedChars);
    if (existing.status === 'missing' && ref.status !== 'missing') existing.status = ref.status;
    if (existing.status === 'trimmed' && ref.status === 'used') existing.status = 'used';
  }
  return [...grouped.values()].sort((left, right) => stableCompare(
    `${left.kind}:${left.sourceId ?? ''}`,
    `${right.kind}:${right.sourceId ?? ''}`,
  ));
}

function priorityRank(priority: ChapterGenerationContextPriority): number {
  return { critical: 0, high: 1, normal: 2, background: 3 }[priority];
}

function sectionText(sections: ChapterGenerationContextSection[]): string {
  return sections.map((section) => `## ${section.title}\n${section.content}`).join('\n\n---\n\n');
}

function buildBoundedContext(source: ChapterGenerationCompilationSource): BoundedContextResult {
  const base = source.baseContext;
  const chapterCharacterList = [...(base.chapterCharacterList ?? [])]
    .filter((item) => item.novelId === source.novelId && item.chapterId === source.chapterId)
    .sort((left, right) => stableCompare(left.id, right.id));
  const requiredCharacters = [...(base.requiredCharacters ?? [])]
    .filter((item) => item.novelId === source.novelId && item.chapterId === source.chapterId)
    .sort((left, right) => stableCompare(left.id, right.id));
  const context: ChapterGenerationContext = {
    novelTitle: base.novelTitle,
    novelGenre: base.novelGenre,
    protagonist: base.protagonist,
    protagonistMode: base.protagonistMode,
    protagonistNames: base.protagonistNames,
    volumeTitle: base.volumeTitle,
    chapterTitle: base.chapterTitle,
    targetWordCount: base.targetWordCount,
    outlineKeyPoints: base.outlineKeyPoints?.map((item) => ({ ...item })),
    chapterCharacterList,
    requiredCharacters,
    chapterOutlineSource: base.chapterOutlineSource,
    volumeOutlineSource: base.volumeOutlineSource,
    masterOutlineSource: base.masterOutlineSource,
  };

  const requiredCharacterNames = context.requiredCharacters?.map((item) => item.name).filter(Boolean) ?? [];
  context.requiredCharacterNames = requiredCharacterNames.join('、') || undefined;
  context.requiredCharactersSummary = requiredCharacterNames.length > 0
    ? requiredCharacterNames.map((name) => `- ${name}：必须直接出场并推进本章剧情`).join('\n')
    : undefined;

  const summaryText = [...source.previousSummaries]
    .sort((left, right) => right.orderIndex - left.orderIndex || stableCompare(left.id, right.id))
    .map((summary) => [
      `### ${summary.chapterTitle}`,
      summary.summary,
      summary.factsMustRemember.length ? `关键事实：${summary.factsMustRemember.join('；')}` : '',
      summary.unresolvedQuestions.length ? `未解问题：${summary.unresolvedQuestions.join('；')}` : '',
      summary.foreshadowing.length ? `伏笔：${summary.foreshadowing.join('；')}` : '',
    ].filter(Boolean).join('\n'))
    .join('\n\n');
  const unresolvedText = [...source.unresolvedThreads]
    .sort((left, right) => (right.importance ?? 0) - (left.importance ?? 0)
      || stableCompare(left.id, right.id))
    .map((item) => `- ${item.title}：${item.content}`)
    .join('\n');
  const qualityText = [...source.qualityIssues]
    .sort((left, right) => stableCompare(left.id, right.id))
    .map((issue) => `- ${issue.title}（${issue.issueType}/${issue.severity}）：${issue.suggestion || issue.description}`)
    .join('\n');
  const continuityText = [
    summaryText ? `【最近章节摘要】\n${summaryText}` : '',
    unresolvedText ? `【未解决线索】\n${unresolvedText}` : '',
  ].filter(Boolean).join('\n\n');
  const recentStateText = [...source.recentStates]
    .sort((left, right) => right.orderIndex - left.orderIndex || stableCompare(left.id, right.id))
    .map((item) => `- ${item.title}：${item.status}${item.adoptedDraftId ? '（已有采用正文）' : ''}`)
    .join('\n');
  const eventText = [...source.events]
    .filter((event) => event.status !== 'forbidden')
    .sort((left, right) => stableCompare(left.id, right.id))
    .map((event) => `- ${event.status === 'required' ? '【必须发生】' : '【已选择】'}${event.title}：${event.description}`)
    .join('\n');
  const characterStateText = context.chapterCharacterList?.map((item) => [
    `- ${item.name}`,
    item.identity ? `身份：${item.identity}` : '',
    item.goal ? `目标：${item.goal}` : '',
    item.personality ? `性格：${item.personality}` : '',
    item.behaviorLimits ? `行为限制：${item.behaviorLimits}` : '',
    item.forbiddenBehaviors ? `不得：${item.forbiddenBehaviors}` : '',
    item.note ? `本章备注：${item.note}` : '',
  ].filter(Boolean).join('；')).join('\n') ?? '';
  const protagonistStateText = [
    base.protagonist ? `主角：${base.protagonist}` : '',
    cleanText(base.protagonistsSummary),
    cleanText(base.dualProtagonistSummary),
    cleanText(base.protagonistAppearance),
  ].filter(Boolean).join('\n\n');
  const outlineChecklist = cleanText(base.outlineChecklistText);
  const chapterOutline = cleanText(base.chapterOutline);

  const candidates: ContextCandidate[] = [
    {
      key: 'chapter-goal', title: '本章硬性目标', priority: 'critical', maxChars: 1_200,
      content: cleanText(base.chapterGoal),
      sourceRefs: [createSourceRef('chapter_goal', source.chapterId, cleanText(base.chapterGoal))],
      apply: (target, value) => { target.chapterGoal = value; },
    },
    {
      key: 'outline-checklist', title: '章节大纲执行清单', priority: 'critical', maxChars: 4_800,
      content: outlineChecklist === chapterOutline ? '' : outlineChecklist,
      sourceRefs: [createSourceRef('chapter_outline_checklist', source.chapterId, outlineChecklist)],
      apply: (target, value) => { target.outlineChecklistText = value; },
    },
    {
      key: 'chapter-outline', title: '当前章节大纲', priority: 'critical', maxChars: 4_800,
      content: chapterOutline,
      sourceRefs: [createSourceRef('chapter_outline', source.chapterId, chapterOutline)],
      apply: (target, value) => { target.chapterOutline = value; },
    },
    {
      key: 'adopted-draft', title: '当前章节采用正文', priority: 'high', maxChars: 6_000,
      content: cleanText(source.adoptedDraft?.content),
      sourceRefs: [createSourceRef('adopted_draft', source.adoptedDraft?.id, cleanText(source.adoptedDraft?.content))],
      apply: (target, value) => { target.currentAdoptedContent = value; },
    },
    {
      key: 'rewrite-draft', title: '当前待改写正文', priority: 'high', maxChars: 6_000,
      content: cleanText(base.draftContent),
      sourceRefs: [createSourceRef('rewrite_draft', source.sourceDraft.id, cleanText(base.draftContent))],
      apply: (target, value) => { target.draftContent = value; },
    },
    {
      key: 'protagonist-state', title: '主角身份、关系与当前状态', priority: 'high', maxChars: 2_500,
      content: protagonistStateText,
      sourceRefs: [createSourceRef('novel_protagonists', source.novelId, protagonistStateText)],
      apply: (target, value) => {
        target.protagonistsSummary = value;
        target.dualProtagonistSummary = undefined;
        target.protagonistAppearance = undefined;
      },
    },
    {
      key: 'chapter-characters', title: '当前角色与状态', priority: 'high', maxChars: 2_500,
      content: characterStateText,
      sourceRefs: [createSourceRef('chapter_characters', source.chapterId, characterStateText)],
      apply: (target, value) => { target.chapterCharacters = value; },
    },
    {
      key: 'chapter-events', title: '本章剧情事件', priority: 'high', maxChars: 2_500,
      content: eventText,
      sourceRefs: [createSourceRef('chapter_events', source.chapterId, eventText)],
      apply: (target, value) => { target.chapterEvents = value; },
    },
    {
      key: 'volume-mainline', title: '当前卷主线', priority: 'normal', maxChars: 3_000,
      content: [cleanText(base.volumeTitle), cleanText(base.volumeGoal), cleanText(base.volumeConflict), cleanText(base.volumeOutline)]
        .filter(Boolean).join('\n'),
      sourceRefs: [createSourceRef('volume_outline', source.volumeId, cleanText(base.volumeOutline))],
      apply: (target, value) => {
        target.volumeOutline = value;
        target.volumeGoal = undefined;
        target.volumeConflict = undefined;
      },
    },
    {
      key: 'master-outline', title: '作品总纲与全局方向', priority: 'normal', maxChars: 3_000,
      content: cleanText(base.masterOutline || base.novelOutline),
      sourceRefs: [createSourceRef('master_outline', source.novelId, cleanText(base.masterOutline || base.novelOutline))],
      apply: (target, value) => {
        target.masterOutline = value;
        target.novelOutline = value;
      },
    },
    {
      key: 'novel-description', title: '作品基础信息', priority: 'normal', maxChars: 1_200,
      content: cleanText(base.novelDescription),
      sourceRefs: [createSourceRef('novel_description', source.novelId, cleanText(base.novelDescription))],
      apply: (target, value) => { target.novelDescription = value; },
    },
    {
      key: 'recent-continuity', title: '最近章节与未解决线索', priority: 'normal', maxChars: 3_500,
      content: [recentStateText ? `【最近章节状态】\n${recentStateText}` : '', continuityText].filter(Boolean).join('\n\n'),
      sourceRefs: [
        ...source.previousSummaries.map((summary) => createSourceRef('chapter_summary', summary.id, summary.summary)),
        ...source.recentStates.map((state) => createSourceRef('chapter_state', state.id, `${state.status}:${state.adoptedDraftId ?? ''}`)),
        ...source.unresolvedThreads.map((thread) => createSourceRef(thread.type, thread.id, thread.content)),
      ],
      apply: (target, value) => { target.previousContext = value; },
    },
    {
      key: 'quality-guidance', title: '当前质量问题规避', priority: 'normal', maxChars: 2_000,
      content: qualityText,
      sourceRefs: source.qualityIssues.map((issue) => createSourceRef('quality_issue', issue.id, `${issue.title}\n${issue.description}\n${issue.suggestion ?? ''}`)),
      apply: () => undefined,
    },
    {
      key: 'world-rules', title: '世界观与硬规则', priority: 'background', maxChars: 3_000,
      content: [cleanText(base.worldBackground), cleanText(base.ruleSystems), cleanText(base.chapterSettings)].filter(Boolean).join('\n\n'),
      sourceRefs: [
        createSourceRef('world_setting', source.novelId, cleanText(base.worldBackground)),
        createSourceRef('rule_system', source.novelId, cleanText(base.ruleSystems)),
      ],
      apply: (target, value) => {
        target.worldBackground = value;
        target.ruleSystems = undefined;
        target.chapterSettings = undefined;
      },
    },
    {
      key: 'style-output', title: '文风与输出控制', priority: 'background', maxChars: 2_000,
      content: [cleanText(base.styleProfile), cleanText(base.outputProfile)].filter(Boolean).join('\n\n'),
      sourceRefs: [createSourceRef('style_output', undefined, [cleanText(base.styleProfile), cleanText(base.outputProfile)].join('\n'))],
      apply: (target, value) => {
        target.styleProfile = value;
        target.outputProfile = undefined;
      },
    },
    {
      key: 'user-instruction', title: '用户本次要求', priority: 'high', maxChars: 1_200,
      content: cleanText(base.userInstruction),
      sourceRefs: [createSourceRef('user_instruction', undefined, cleanText(base.userInstruction))],
      apply: (target, value) => { target.userInstruction = value; },
    },
  ];

  const ordered = candidates
    .map((candidate, index) => ({ candidate, index }))
    .sort((left, right) => priorityRank(left.candidate.priority) - priorityRank(right.candidate.priority)
      || left.index - right.index)
    .map((item) => item.candidate);
  const sections: ChapterGenerationContextSection[] = [];
  const allRefs = [
    ...ordered.flatMap((candidate) => candidate.sourceRefs),
    createSourceRef(
      'chapter_engineering',
      source.engineeringState?.id,
      source.engineeringState ? stableStringify(source.engineeringState) : '',
    ),
  ];
  const omittedSections: string[] = [];
  const trimmedSections: string[] = [];
  let remaining = CHAPTER_GENERATION_CONTEXT_BUDGET_CHARS;
  let truncatedChars = 0;

  for (const candidate of ordered) {
    const original = cleanText(candidate.content);
    if (!original) {
      updateSourceRefs(candidate.sourceRefs, 0);
      candidate.apply(context, undefined);
      continue;
    }
    const prefix = sections.length === 0
      ? `## ${candidate.title}\n`
      : `\n\n---\n\n## ${candidate.title}\n`;
    const allowed = Math.min(
      textLength(original),
      candidate.maxChars,
      Math.max(remaining - textLength(prefix), 0),
    );
    if (allowed === 0) {
      updateSourceRefs(candidate.sourceRefs, 0);
      candidate.apply(context, undefined);
      omittedSections.push(candidate.key);
      truncatedChars += textLength(original);
      continue;
    }
    const included = truncateText(original, allowed);
    const includedChars = textLength(included);
    remaining -= textLength(prefix) + includedChars;
    if (includedChars < textLength(original)) {
      trimmedSections.push(candidate.key);
      truncatedChars += textLength(original) - includedChars;
    }
    updateSourceRefs(candidate.sourceRefs, includedChars);
    candidate.apply(context, included);
    sections.push({
      key: candidate.key,
      title: candidate.title,
      priority: candidate.priority,
      content: included,
      sourceRefs: candidate.sourceRefs,
    });
  }

  const text = sectionText(sections);
  return {
    context,
    sections,
    text,
    budget: {
      maxChars: CHAPTER_GENERATION_CONTEXT_BUDGET_CHARS,
      usedChars: textLength(text),
      truncatedChars,
      omittedSections,
      trimmedSections,
    },
    warnings: source.warnings,
    sourceRefs: dedupeSourceRefs(allRefs),
  };
}

function createConstraintCandidates(
  source: ChapterGenerationCompilationSource,
  context: ChapterGenerationContext,
  sourceRefs: ChapterGenerationSourceRef[],
): ConstraintCandidate[] {
  const candidates: ConstraintCandidate[] = [];
  const chapterRef = sourceRefs.filter((ref) => ref.kind === 'chapter_goal' || ref.kind.startsWith('chapter_outline'));
  const characterRef = sourceRefs.filter((ref) => ref.kind === 'chapter_characters');
  const eventRef = sourceRefs.filter((ref) => ref.kind === 'chapter_events');
  const ruleRef = sourceRefs.filter((ref) => ref.kind === 'rule_system');
  const qualityRef = sourceRefs.filter((ref) => ref.kind === 'quality_issue');
  const engineRef = sourceRefs.filter((ref) => ref.kind === 'chapter_engineering');

  candidates.push({
    key: 'target-only',
    kind: 'forbid',
    text: `不得覆盖、修改、采用或写入其他章节；本次只生成章节 ${source.chapterId} 的候选 Artifact。`,
    sourceRefs: [],
  });
  candidates.push({
    key: 'outline-goal',
    kind: 'must',
    text: context.chapterGoal ? `必须完成本章目标：${context.chapterGoal}` : '',
    sourceRefs: chapterRef,
  });
  for (const point of context.outlineKeyPoints ?? []) {
    candidates.push({
      key: `outline-${point.id}`,
      kind: 'must',
      text: `必须覆盖章节大纲关键点：${point.text}`,
      sourceRefs: chapterRef,
    });
  }
  for (const character of context.requiredCharacters ?? []) {
    candidates.push({
      key: `required-character-${character.id}`,
      kind: 'must',
      text: `必须让角色“${character.name}”直接出场并参与本章剧情。`,
      sourceRefs: characterRef,
    });
  }
  for (const event of [...source.events]
    .filter((item) => item.status === 'required')
    .sort((left, right) => stableCompare(left.id, right.id))) {
    candidates.push({
      key: `required-event-${event.id}`,
      kind: 'must',
      text: `必须发生事件：${event.title}。${event.description}`,
      sourceRefs: eventRef,
    });
  }
  if (context.targetWordCount && context.targetWordCount > 0) {
    candidates.push({
      key: 'target-word-count',
      kind: 'must',
      text: `正文目标字数约为 ${context.targetWordCount} 字。`,
      sourceRefs: [],
    });
  }

  const engineering = source.engineeringState;
  if (engineering) {
    const card = engineering.chapterCard;
    if (card.openingState) candidates.push({ key: 'opening-state', kind: 'must', text: `开场状态必须符合：${card.openingState}`, sourceRefs: engineRef });
    if (card.endingState) candidates.push({ key: 'ending-state', kind: 'must', text: `结尾状态必须达到：${card.endingState}`, sourceRefs: engineRef });
    if (card.primaryLocation) candidates.push({ key: 'location', kind: 'must', text: `地点约束：${card.primaryLocation}`, sourceRefs: engineRef });
    if (card.viewpointCharacter) candidates.push({ key: 'viewpoint', kind: 'must', text: `叙事视角应围绕：${card.viewpointCharacter}`, sourceRefs: engineRef });
    for (const rule of engineering.generationConstraints.mustFollow) {
      candidates.push({ key: `engine-must-${rule}`, kind: 'must', text: rule, sourceRefs: engineRef });
    }
    for (const event of card.mustHappenEvents) {
      candidates.push({ key: `engine-event-${event}`, kind: 'must', text: `必须完成工程事件：${event}`, sourceRefs: engineRef });
    }
    for (const event of card.forbiddenEvents) {
      candidates.push({ key: `engine-forbidden-event-${event}`, kind: 'forbid', text: `不得发生：${event}`, sourceRefs: engineRef });
    }
    for (const rule of engineering.generationConstraints.forbiddenChanges) {
      candidates.push({ key: `engine-forbidden-change-${rule}`, kind: 'forbid', text: `不得改变：${rule}`, sourceRefs: engineRef });
    }
    for (const rule of engineering.generationConstraints.forbiddenAdditions) {
      candidates.push({ key: `engine-forbidden-addition-${rule}`, kind: 'forbid', text: `不得新增：${rule}`, sourceRefs: engineRef });
    }
    for (const rule of engineering.generationConstraints.forbiddenEarlyEvents) {
      candidates.push({ key: `engine-forbidden-early-event-${rule}`, kind: 'forbid', text: `不得提前发生：${rule}`, sourceRefs: engineRef });
    }
    for (const rule of engineering.generationConstraints.forbiddenEarlyReveals) {
      candidates.push({ key: `engine-forbidden-reveal-${rule}`, kind: 'forbid', text: `不得提前揭示：${rule}`, sourceRefs: engineRef });
    }
    for (const rule of engineering.chapterCard.forbiddenWriting) {
      candidates.push({ key: `engine-forbidden-writing-${rule}`, kind: 'forbid', text: `不得使用写法：${rule}`, sourceRefs: engineRef });
    }
    if (engineering.generationConstraints.narrativePerson) {
      candidates.push({ key: 'engine-narrative-person', kind: 'must', text: `叙事人称：${engineering.generationConstraints.narrativePerson}`, sourceRefs: engineRef });
    }
  }

  for (const event of [...source.events]
    .filter((item) => item.status === 'forbidden')
    .sort((left, right) => stableCompare(left.id, right.id))) {
    candidates.push({ key: `forbidden-event-${event.id}`, kind: 'forbid', text: `不得发生事件：${event.title}。${event.description}`, sourceRefs: eventRef });
  }
  for (const rule of [...source.worldRuleForbids].sort(stableCompare)) {
    candidates.push({ key: `world-rule-${rule}`, kind: 'forbid', text: `不得违反世界规则：${rule}`, sourceRefs: ruleRef });
  }
  for (const character of context.chapterCharacterList ?? []) {
    if (character.forbiddenBehaviors) {
      candidates.push({ key: `character-forbidden-${character.id}`, kind: 'forbid', text: `角色“${character.name}”不得：${character.forbiddenBehaviors}`, sourceRefs: characterRef });
    }
    if (character.behaviorLimits) {
      candidates.push({ key: `character-limit-${character.id}`, kind: 'must', text: `角色“${character.name}”的行为限制：${character.behaviorLimits}`, sourceRefs: characterRef });
    }
  }
  for (const issue of [...source.qualityIssues].sort((left, right) => stableCompare(left.id, right.id))) {
    const guidance = issue.suggestion || issue.description;
    candidates.push({
      key: `quality-${issue.id}`,
      kind: 'forbid',
      text: `不得重现待解决质量问题（${issue.issueType}/${issue.severity}）：${issue.title}。规避方式：${guidance}`,
      sourceRefs: qualityRef,
    });
  }

  if (context.volumeOutline) candidates.push({ key: 'volume-mainline', kind: 'should', text: '应尽量服务当前卷主线、核心冲突与阶段目标。', sourceRefs: [] });
  if (context.previousContext) candidates.push({ key: 'continuity', kind: 'should', text: '应尽量延续最近章节的既有事实、角色状态和未解决线索。', sourceRefs: [] });
  if (context.styleProfile) candidates.push({ key: 'style', kind: 'should', text: `应尽量遵循文风要求：${context.styleProfile}`, sourceRefs: [] });
  if (context.outputProfile) candidates.push({ key: 'output-profile', kind: 'should', text: `应尽量遵循输出控制：${context.outputProfile}`, sourceRefs: [] });
  if (context.userInstruction) candidates.push({ key: 'user-instruction', kind: 'should', text: `应尽量满足用户本次要求：${context.userInstruction}`, sourceRefs: [] });
  return candidates;
}

function makeConstraintRows(candidates: ConstraintCandidate[], kind: ChapterGenerationConstraintKind): ChapterGenerationConstraint[] {
  const seen = new Set<string>();
  const rows: ChapterGenerationConstraint[] = [];
  for (const candidate of candidates.filter((item) => item.kind === kind)) {
    const text = cleanText(candidate.text);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    rows.push({
      id: `${kind}-${String(rows.length + 1).padStart(2, '0')}`,
      kind,
      text,
      sourceRefs: dedupeSourceRefs(candidate.sourceRefs),
    });
  }
  return rows;
}

function renderConstraints(
  must: ChapterGenerationConstraint[],
  should: ChapterGenerationConstraint[],
  forbid: ChapterGenerationConstraint[],
): string {
  const render = (title: string, rows: ChapterGenerationConstraint[]) => rows.length > 0
    ? `【${title}】\n${rows.map((row, index) => `${index + 1}. ${row.text}`).join('\n')}`
    : '';
  return [
    render('必须满足', must),
    render('应尽量满足', should),
    render('禁止违反', forbid),
  ].filter(Boolean).join('\n\n');
}

function buildConstraintSet(source: ChapterGenerationCompilationSource, context: ChapterGenerationContext, refs: ChapterGenerationSourceRef[]): ChapterGenerationConstraintSet {
  const candidates = createConstraintCandidates(source, context, refs);
  const must = makeConstraintRows(candidates, 'must');
  const forbid = makeConstraintRows(candidates, 'forbid');
  const shouldCandidates = makeConstraintRows(candidates, 'should');
  const hardText = renderConstraints(must, [], forbid);
  if (textLength(hardText) > CHAPTER_GENERATION_CONSTRAINT_BUDGET_CHARS) {
    throw new Error('硬性章节约束超过安全预算，已停止 Provider 调用。');
  }

  let remaining = CHAPTER_GENERATION_CONSTRAINT_BUDGET_CHARS - textLength(hardText);
  const should: ChapterGenerationConstraint[] = [];
  let omittedShouldCount = 0;
  for (const row of shouldCandidates) {
    const rowLength = textLength(row.text) + 4;
    if (rowLength > remaining) {
      omittedShouldCount += 1;
      continue;
    }
    should.push(row);
    remaining -= rowLength;
  }
  const text = renderConstraints(must, should, forbid);
  return {
    must,
    should,
    forbid,
    text,
    hash: '',
    budget: {
      maxChars: CHAPTER_GENERATION_CONSTRAINT_BUDGET_CHARS,
      usedChars: textLength(text),
      omittedShouldCount,
    },
  };
}

export async function buildChapterGenerationContextContract(
  source: ChapterGenerationCompilationSource,
): Promise<ChapterGenerationContextContract> {
  assertNoCredentialsInSnapshotValue(source);
  const bounded = buildBoundedContext(source);
  const contextHash = await computeContentSha256(stableStringify({
    novelId: source.novelId,
    volumeId: source.volumeId,
    chapterId: source.chapterId,
    sourceDraft: {
      id: source.sourceDraft.id,
      versionNo: source.sourceDraft.versionNo,
      contentHash: source.sourceDraft.contentHash,
    },
    sections: bounded.sections.map((section) => ({
      key: section.key,
      priority: section.priority,
      content: section.content,
      sources: section.sourceRefs,
    })),
    budget: bounded.budget,
  }));
  return {
    context: bounded.context,
    sections: bounded.sections,
    text: bounded.text,
    sourceManifest: {
      schemaVersion: 1,
      novelId: source.novelId,
      volumeId: source.volumeId,
      chapterId: source.chapterId,
      sourceDraft: {
        id: source.sourceDraft.id,
        versionNo: source.sourceDraft.versionNo,
        contentHash: source.sourceDraft.contentHash,
      },
      sources: bounded.sourceRefs,
      contextHash,
    },
    budget: bounded.budget,
    hash: contextHash,
    warnings: [...bounded.warnings],
  };
}

export async function buildChapterGenerationConstraintSet(
  source: ChapterGenerationCompilationSource,
  contextContract: ChapterGenerationContextContract,
): Promise<ChapterGenerationConstraintSet> {
  assertNoCredentialsInSnapshotValue(source);
  const constraints = buildConstraintSet(source, contextContract.context, contextContract.sourceManifest.sources);
  constraints.hash = await computeContentSha256(stableStringify({
    contextHash: contextContract.hash,
    must: constraints.must,
    should: constraints.should,
    forbid: constraints.forbid,
    budget: constraints.budget,
  }));
  return constraints;
}

export const chapterGenerationContextBuilder = {
  build: buildChapterGenerationContextContract,
};

export const chapterGenerationConstraintBuilder = {
  build: buildChapterGenerationConstraintSet,
};

export async function compileChapterGenerationContracts(source: ChapterGenerationCompilationSource): Promise<{
  contextContract: ChapterGenerationContextContract;
  constraints: ChapterGenerationConstraintSet;
}> {
  const contextContract = await chapterGenerationContextBuilder.build(source);
  const constraints = await chapterGenerationConstraintBuilder.build(source, contextContract);
  return { contextContract, constraints };
}

function isCredentialText(value: string): boolean {
  return /(?:api[_ -]?key\s*[:=]|authorization\s*[:=]|bearer\s+[A-Za-z0-9._-]{8,}|sk-[A-Za-z0-9_-]{8,})/i.test(value);
}

function assertNoCredentialsInSnapshotValue(value: unknown): void {
  const seen = new Set<object>();
  const visit = (candidate: unknown): void => {
    if (typeof candidate === 'string') {
      if (isCredentialText(candidate)) {
        throw new Error('上下文或约束包含疑似 Provider 凭据，已阻止写入 Snapshot 和调用 Provider。');
      }
      return;
    }
    if (!candidate || typeof candidate !== 'object') return;
    if (seen.has(candidate)) return;
    seen.add(candidate);
    if (Array.isArray(candidate)) {
      candidate.forEach(visit);
      return;
    }
    for (const [key, child] of Object.entries(candidate)) {
      if (/^(api[_-]?key|authorization|credential|secret)$/i.test(key)) {
        throw new Error('上下文或约束包含 Provider 凭据字段，已阻止写入 Snapshot 和调用 Provider。');
      }
      visit(child);
    }
  };
  visit(value);
}

function assertSafeInstruction(value?: string): void {
  if (value && isCredentialText(value)) {
    throw new Error('用户指令包含疑似 Provider 凭据，已阻止写入 Snapshot 和调用 Provider。');
  }
}

function toBaseline(draft: ChapterDraft, contentHash: string): ChapterGenerationDraftBaseline {
  return {
    id: draft.id,
    novelId: draft.novelId,
    chapterId: draft.chapterId,
    versionNo: draft.versionNo,
    content: draft.content,
    contentHash,
    isAdopted: draft.isAdopted,
  };
}

function toSummarySource(summary: ChapterSummary, title: string, orderIndex: number): ChapterGenerationSummarySource {
  return {
    id: summary.id,
    chapterId: summary.chapterId,
    chapterTitle: title,
    orderIndex,
    summary: summary.summary,
    unresolvedQuestions: summary.unresolvedQuestions ?? [],
    foreshadowing: summary.foreshadowing ?? summary.newForeshadows ?? [],
    factsMustRemember: summary.factsMustRemember ?? [],
  };
}

function toEventConstraint(event: ChapterEvent): ChapterGenerationEventConstraint | null {
  if (event.status !== 'required' && event.status !== 'selected' && event.status !== 'forbidden') return null;
  return {
    id: event.id,
    status: event.status,
    title: event.title,
    description: event.description,
  };
}

async function loadChapterGenerationSource(input: CompileChapterGenerationInput): Promise<ChapterGenerationCompilationSource> {
  assertSafeInstruction(input.userInstruction);
  const chapter = await chapterRepository.getById(input.chapterId);
  if (!chapter || chapter.novelId !== input.novelId) {
    throw new Error('章节不属于当前作品，已阻止构建上下文。');
  }
  if (input.volumeId !== undefined && input.volumeId !== chapter.volumeId) {
    throw new Error('章节与请求分卷不一致，已阻止构建上下文。');
  }
  const novel = await novelRepository.getById(input.novelId);
  if (!novel || novel.id !== input.novelId) {
    throw new Error('当前作品不存在，已停止章节生成。');
  }
  if (chapter.volumeId) {
    const volume = await volumeRepository.getById(chapter.volumeId);
    if (!volume || volume.novelId !== input.novelId) {
      throw new Error('当前分卷不属于当前作品，已阻止构建上下文。');
    }
  }

  const warnings: string[] = [];
  const [drafts, chapters, contextRecords, rules, events, engineeringBundle] = await Promise.all([
    draftVersionService.getByChapterId(chapter.id),
    chapterRepository.getByNovelId(input.novelId),
    contextRecordService.getByNovelId(input.novelId).catch(() => {
      warnings.push('未读取到上下文记录，已安全降级。');
      return [];
    }),
    settingRepository.getRuleSystems(input.novelId).catch(() => {
      warnings.push('未读取到规则体系，已安全降级。');
      return [];
    }),
    chapterEventService.getByChapterId(chapter.id).catch(() => {
      warnings.push('未读取到章节事件，已安全降级。');
      return [];
    }),
    chapterEngineeringService.getBundle(chapter.id).catch(() => {
      warnings.push('未读取到章节工程状态，已安全降级。');
      return { activeState: undefined, states: [], hasUnappliedDraft: false };
    }),
  ]);

  const sourceDraft = drafts.find((draft) => draft.id === input.sourceDraftId);
  if (!sourceDraft
    || sourceDraft.novelId !== input.novelId
    || sourceDraft.chapterId !== chapter.id
    || sourceDraft.versionNo !== input.sourceDraftVersion) {
    throw new Error('当前草稿基线与章节不一致，已阻止章节生成。');
  }
  const actualSourceHash = await computeContentSha256(sourceDraft.content);
  if (actualSourceHash !== input.baseContentHash) {
    throw new Error('当前草稿基线内容已变化，已阻止章节生成。');
  }
  const adoptedDraft = drafts.find((draft) => draft.isAdopted);
  const adoptedBaseline = adoptedDraft
    ? toBaseline(adoptedDraft, await computeContentSha256(adoptedDraft.content))
    : undefined;
  const orderedChapters = chapters
    .filter((item) => item.novelId === input.novelId)
    .sort((left, right) => left.orderIndex - right.orderIndex || stableCompare(left.id, right.id));
  const currentIndex = orderedChapters.findIndex((item) => item.id === chapter.id);
  if (currentIndex < 0) throw new Error('当前章节不在作品章节列表中，已阻止章节生成。');
  const previousChapters = orderedChapters.slice(Math.max(0, currentIndex - 2), currentIndex);
  const previousSummaries = (await Promise.all(previousChapters.map(async (previous) => {
    const summary = await chapterSummaryService.getByChapterId(previous.id).catch(() => null);
    if (!summary || summary.novelId !== input.novelId || summary.chapterId !== previous.id || !summary.enabled || summary.isExpired) return null;
    return toSummarySource(summary, previous.title, previous.orderIndex);
  }))).filter((item): item is ChapterGenerationSummarySource => item !== null);

  const recentStates: ChapterGenerationRecentState[] = orderedChapters
    .slice(Math.max(0, currentIndex - 3), currentIndex + 1)
    .map((item) => ({
      id: item.id,
      title: item.title,
      orderIndex: item.orderIndex,
      status: item.status,
      adoptedDraftId: item.adoptedDraftId,
    }));
  const unresolvedThreads: ChapterGenerationTextSource[] = contextRecords
    .filter((record) => record.novelId === input.novelId
      && record.isActive
      && !record.isExpired
      && (record.contextType === 'foreshadow' || record.contextType === 'plot_progress'))
    .map((record) => ({
      id: record.id,
      type: record.contextType,
      title: record.title,
      content: record.content,
      importance: record.importance,
    }));

  let qualityIssues: ChapterGenerationQualityIssue[] = [];
  try {
    const quality = await qualityCheckService.getChapterIssues(chapter.id);
    if (quality.report?.novelId === input.novelId
      && quality.report.chapterId === chapter.id
      && quality.report.draftId === sourceDraft.id) {
      qualityIssues = quality.items
        .filter((issue) => issue.novelId === input.novelId
          && issue.chapterId === chapter.id
          && issue.draftId === sourceDraft.id
          && issue.status === 'pending')
        .map((issue) => ({
          id: issue.id,
          issueType: issue.issueType,
          severity: issue.severity,
          title: issue.title,
          description: issue.description,
          suggestion: issue.suggestion,
        }));
    }
  } catch {
    warnings.push('未读取到当前质量问题，已安全降级。');
  }

  const baseContext = await buildFreshChapterGenerationContext({
    novelId: input.novelId,
    volumeId: chapter.volumeId,
    chapterId: chapter.id,
    userInstruction: input.userInstruction,
    styleId: input.styleId,
    outputId: input.outputId,
    targetWordCount: input.targetWordCount,
    draftContent: input.draftContent,
  });
  const engineeringState = engineeringBundle.activeState
    && engineeringBundle.activeState.novelId === input.novelId
    && engineeringBundle.activeState.chapterId === chapter.id
    ? engineeringBundle.activeState
    : undefined;
  const safeEvents = events
    .filter((event) => event.novelId === input.novelId && event.chapterId === chapter.id)
    .map(toEventConstraint)
    .filter((event): event is ChapterGenerationEventConstraint => event !== null);
  const worldRuleForbids = [...new Set(rules
    .filter((rule) => rule.novelId === input.novelId && rule.isActive)
    .flatMap((rule) => cleanText(rule.forbiddenRules).split(/[\n；;]/).map(cleanText).filter(Boolean)))]
    .sort(stableCompare);

  return {
    novelId: input.novelId,
    volumeId: chapter.volumeId,
    chapterId: chapter.id,
    baseContext,
    sourceDraft: toBaseline(sourceDraft, actualSourceHash),
    adoptedDraft: adoptedBaseline,
    previousSummaries,
    recentStates,
    unresolvedThreads,
    qualityIssues,
    events: safeEvents,
    engineeringState,
    worldRuleForbids,
    warnings,
  };
}

export async function compileChapterGeneration(input: CompileChapterGenerationInput): Promise<CompiledChapterGeneration> {
  const source = await loadChapterGenerationSource(input);
  const { contextContract, constraints } = await compileChapterGenerationContracts(source);
  const template = getChapterGeneratePromptTemplate();
  const request = await buildGenerateRequest(contextContract.context, {
    compiledConstraints: constraints.text,
  });
  const compiledPrompt = request.messages
    .map((message) => `${message.role}:\n${message.content}`)
    .join('\n\n');
  contextContract.budget.promptChars = textLength(compiledPrompt);
  const promptTemplate: ChapterGenerationPromptTemplate = {
    id: template.id,
    version: template.version,
    body: template.body,
    hash: await computeContentSha256(template.body),
  };
  return { contextContract, constraints, promptTemplate, request, compiledPrompt };
}

export function buildChapterGenerationInputSummary(source: ChapterGenerationCompilationSource): string {
  const context = source.baseContext;
  return [
    `生成：${source.novelId.slice(0, 8)}/${context.chapterTitle}`,
    `大纲：${context.chapterOutline ? '有' : '无'}`,
    `关键点：${context.outlineKeyPoints?.length ?? 0}`,
    `角色：${context.requiredCharacters?.length ?? 0}`,
    `事件：${source.events.length}`,
    `前文：${source.previousSummaries.length}`,
    `线索：${source.unresolvedThreads.length}`,
    `质量规避：${source.qualityIssues.length}`,
    `字数：${context.targetWordCount ?? 0}`,
  ].join('，');
}

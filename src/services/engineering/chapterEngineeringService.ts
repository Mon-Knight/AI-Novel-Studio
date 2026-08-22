import { dbCall, generateId, lsGet, lsSet, nowISO } from '../database/db';
import { safeJsonParse, toSafeNumber, toSafeString } from '../../utils/dataGuard';
import type { Chapter } from '../../types/chapter';
import type {
  ChapterCard,
  ChapterEngineeringBundle,
  ChapterEngineeringState,
  ChapterEngineeringStateStatus,
  GenerationConstraints,
  QualityRules,
  SaveChapterEngineeringDraftInput,
  SceneBeat,
  ScenePlanItem,
} from '../../types/chapterEngineering';

type ChapterEngineeringSeed = Partial<
  Pick<Chapter, 'title' | 'goal' | 'outline' | 'targetWordCount' | 'targetWords'>
>;

const STORAGE_KEY_PREFIX = 'ai_novel_studio_chapter_engineering_states_';
const LEGACY_RESERVED_MYSTERIES_KEY = ['reserved', 'Secrets'].join('');

interface RawChapterEngineeringState extends Partial<ChapterEngineeringState> {
  novel_id?: string;
  volume_id?: string | null;
  chapter_id?: string;
  chapterCardJson?: string;
  scenePlanJson?: string;
  generationConstraintsJson?: string;
  qualityRulesJson?: string;
  chapter_card_json?: string;
  scene_plan_json?: string;
  generation_constraints_json?: string;
  quality_rules_json?: string;
  draft_version?: number;
  active_version?: number;
  created_at?: string;
  updated_at?: string;
  activated_at?: string | null;
}

interface SaveDraftDbInput {
  novelId: string;
  volumeId?: string;
  chapterId: string;
  chapterCardJson: string;
  scenePlanJson: string;
  generationConstraintsJson: string;
  qualityRulesJson: string;
}

function storageKey(chapterId: string): string {
  return `${STORAGE_KEY_PREFIX}${chapterId}`;
}

function cleanStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => toSafeString(item).trim()).filter(Boolean);
}

function cleanNumber(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function normalizeBeat(value: unknown, index: number): SceneBeat | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Partial<SceneBeat>;
  const text = toSafeString(raw.text).trim();
  if (!text) return null;
  const order = Math.max(1, Math.round(toSafeNumber(raw.order, index + 1)));
  const characterIds = cleanStringArray(raw.characterIds);
  const stateChange = toSafeString(raw.stateChange).trim();
  return {
    id: toSafeString(raw.id, generateId()),
    order,
    text,
    required: raw.required !== false,
    ...(characterIds.length ? { characterIds } : {}),
    ...(stateChange ? { stateChange } : {}),
  };
}

function legacySceneBeatTexts(item: Partial<ScenePlanItem>): string[] {
  return [
    ...cleanStringArray(item.keyActions),
    item.keyDialogue ? `关键对白：${toSafeString(item.keyDialogue).trim()}` : '',
    ...cleanStringArray(item.informationRelease).map((value) => `释放信息：${value}`),
    item.result ? `场景结果：${toSafeString(item.result).trim()}` : '',
    item.transition ? `场景转场：${toSafeString(item.transition).trim()}` : '',
  ].filter(Boolean);
}

function normalizeSceneBeats(item: Partial<ScenePlanItem>): SceneBeat[] {
  const rawBeats = Array.isArray(item.beats) ? item.beats : [];
  const beats = rawBeats
    .map((beat, index) => normalizeBeat(beat, index))
    .filter((beat): beat is SceneBeat => beat !== null)
    .sort((left, right) => left.order - right.order)
    .map((beat, index) => ({ ...beat, order: index + 1 }));
  if (beats.length) return beats;
  return legacySceneBeatTexts(item).map((text, index) => ({
    id: generateId(),
    order: index + 1,
    text,
    required: true,
  }));
}

function parseJsonField<T>(value: unknown, fallback: T): T {
  if (typeof value === 'string') return safeJsonParse<T>(value, fallback);
  if (value && typeof value === 'object') return value as T;
  return fallback;
}

export function createDefaultChapterCard(chapter?: ChapterEngineeringSeed): ChapterCard {
  return {
    chapterTitle: chapter?.title ?? '',
    volumeTitle: '',
    chapterGoal: chapter?.goal ?? '',
    openingState: '',
    endingState: '',
    appearingCharacters: [],
    viewpointCharacter: '',
    primaryLocation: '',
    coreConflict: chapter?.outline ?? '',
    mustHappenEvents: [],
    forbiddenEvents: [],
    knownInformation: [],
    unknownInformation: [],
    releasedInformation: [],
    reservedMysteries: [],
    emotionalCurve: '',
    endingHook: '',
    targetWordCount: chapter?.targetWordCount ?? chapter?.targetWords,
    styleRequirements: [],
    forbiddenWriting: [],
  };
}

export function createDefaultScenePlan(chapter?: ChapterEngineeringSeed): ScenePlanItem[] {
  return [
    {
      id: generateId(),
      sceneNo: 1,
      title: chapter?.title ? `${chapter.title} - 场景 1` : '场景 1',
      location: '',
      characters: [],
      goal: chapter?.goal ?? '',
      conflict: '',
      keyActions: [],
      keyDialogue: '',
      informationRelease: [],
      result: '',
      transition: '',
      beats: [
        {
          id: generateId(),
          order: 1,
          text: chapter?.goal ? `推进场景目标：${chapter.goal}` : '完成当前场景的核心事件推进。',
          required: true,
        },
      ],
    },
  ];
}

export function createDefaultGenerationConstraints(
  chapter?: ChapterEngineeringSeed,
): GenerationConstraints {
  const target = chapter?.targetWordCount ?? chapter?.targetWords;
  return {
    mustFollow: [],
    forbiddenChanges: [],
    forbiddenAdditions: [],
    forbiddenEarlyEvents: [],
    forbiddenEarlyReveals: [],
    bannedWords: [],
    bannedSentencePatterns: [],
    narrativePerson: '',
    wordRange: target ? { min: Math.max(1, target - 500), max: target + 500 } : {},
    pacingRequirement: '',
    dialogueRatio: '',
    descriptionRatio: '',
    combatStyle: '',
    informationReleaseMode: '',
  };
}

export function createDefaultQualityRules(): QualityRules {
  return {
    enabledChecks: ['continuity', 'constraint', 'character', 'style', 'information_release'],
    strictness: 'normal',
    manualReviewRequired: true,
    customRules: [],
    autoFixAllowed: false,
    autoFixForbidden: [],
  };
}

function normalizeChapterCard(value: unknown, chapter?: ChapterEngineeringSeed): ChapterCard {
  const fallback = createDefaultChapterCard(chapter);
  const raw = parseJsonField<Partial<ChapterCard>>(value, fallback);
  const legacyReservedMysteries = cleanStringArray(
    (raw as unknown as Record<string, unknown>)[LEGACY_RESERVED_MYSTERIES_KEY],
  );
  return {
    ...fallback,
    ...raw,
    appearingCharacters: cleanStringArray(raw.appearingCharacters),
    mustHappenEvents: cleanStringArray(raw.mustHappenEvents),
    forbiddenEvents: cleanStringArray(raw.forbiddenEvents),
    knownInformation: cleanStringArray(raw.knownInformation),
    unknownInformation: cleanStringArray(raw.unknownInformation),
    releasedInformation: cleanStringArray(raw.releasedInformation),
    reservedMysteries:
      cleanStringArray(raw.reservedMysteries).length > 0
        ? cleanStringArray(raw.reservedMysteries)
        : legacyReservedMysteries,
    targetWordCount: cleanNumber(raw.targetWordCount),
    styleRequirements: cleanStringArray(raw.styleRequirements),
    forbiddenWriting: cleanStringArray(raw.forbiddenWriting),
  };
}

export function normalizeScenePlan(
  value: unknown,
  chapter?: ChapterEngineeringSeed,
): ScenePlanItem[] {
  const raw = parseJsonField<Partial<ScenePlanItem>[]>(value, []);
  if (!Array.isArray(raw) || raw.length === 0) return createDefaultScenePlan(chapter);
  return raw
    .map((item, index) => {
      const source = item && typeof item === 'object' ? item : {};
      return {
        id: toSafeString(source.id, generateId()),
        sceneNo: Math.max(1, Math.round(toSafeNumber(source.sceneNo, index + 1))),
        title: toSafeString(source.title, `场景 ${index + 1}`),
        location: toSafeString(source.location),
        characters: cleanStringArray(source.characters),
        goal: toSafeString(source.goal),
        conflict: toSafeString(source.conflict),
        keyActions: cleanStringArray(source.keyActions),
        keyDialogue: toSafeString(source.keyDialogue),
        informationRelease: cleanStringArray(source.informationRelease),
        result: toSafeString(source.result),
        transition: toSafeString(source.transition),
        beats: normalizeSceneBeats(source),
        contextCapsule: toSafeString(source.contextCapsule).trim() || undefined,
        constraints: cleanStringArray(source.constraints),
        expectedEndState: toSafeString(source.expectedEndState).trim() || undefined,
        targetCharacters: cleanNumber(source.targetCharacters),
        originalIndex: index,
      };
    })
    .sort((left, right) => left.sceneNo - right.sceneNo || left.originalIndex - right.originalIndex)
    .map(({ originalIndex: _originalIndex, ...item }, index) => ({ ...item, sceneNo: index + 1 }));
}

function normalizeGenerationConstraints(
  value: unknown,
  chapter?: ChapterEngineeringSeed,
): GenerationConstraints {
  const fallback = createDefaultGenerationConstraints(chapter);
  const raw = parseJsonField<Partial<GenerationConstraints>>(value, fallback);
  const rawRange = (raw.wordRange && typeof raw.wordRange === 'object' ? raw.wordRange : {}) as {
    min?: unknown;
    max?: unknown;
  };
  return {
    ...fallback,
    ...raw,
    mustFollow: cleanStringArray(raw.mustFollow),
    forbiddenChanges: cleanStringArray(raw.forbiddenChanges),
    forbiddenAdditions: cleanStringArray(raw.forbiddenAdditions),
    forbiddenEarlyEvents: cleanStringArray(raw.forbiddenEarlyEvents),
    forbiddenEarlyReveals: cleanStringArray(raw.forbiddenEarlyReveals),
    bannedWords: cleanStringArray(raw.bannedWords),
    bannedSentencePatterns: cleanStringArray(raw.bannedSentencePatterns),
    narrativePerson: toSafeString(raw.narrativePerson),
    wordRange: {
      min: cleanNumber(rawRange.min),
      max: cleanNumber(rawRange.max),
    },
    pacingRequirement: toSafeString(raw.pacingRequirement),
    dialogueRatio: toSafeString(raw.dialogueRatio),
    descriptionRatio: toSafeString(raw.descriptionRatio),
    combatStyle: toSafeString(raw.combatStyle),
    informationReleaseMode: toSafeString(raw.informationReleaseMode),
  };
}

function normalizeQualityRules(value: unknown): QualityRules {
  const fallback = createDefaultQualityRules();
  const raw = parseJsonField<Partial<QualityRules>>(value, fallback);
  const strictness =
    raw.strictness === 'relaxed' || raw.strictness === 'strict' ? raw.strictness : 'normal';
  return {
    ...fallback,
    ...raw,
    enabledChecks: cleanStringArray(raw.enabledChecks),
    strictness,
    manualReviewRequired: raw.manualReviewRequired !== false,
    customRules: cleanStringArray(raw.customRules),
    autoFixAllowed: raw.autoFixAllowed === true,
    autoFixForbidden: cleanStringArray(raw.autoFixForbidden),
  };
}

export function normalizeChapterEngineeringState(
  raw: unknown,
  chapter?: ChapterEngineeringSeed,
): ChapterEngineeringState | null {
  if (!raw || typeof raw !== 'object') return null;
  const item = raw as RawChapterEngineeringState;
  const id = toSafeString(item.id).trim();
  const novelId = toSafeString(item.novelId ?? item.novel_id).trim();
  const chapterId = toSafeString(item.chapterId ?? item.chapter_id).trim();
  if (!id || !novelId || !chapterId) return null;

  const status = toSafeString(item.status, 'draft') as ChapterEngineeringStateStatus;
  const now = nowISO();
  return {
    id,
    novelId,
    volumeId: toSafeString(item.volumeId ?? item.volume_id).trim() || undefined,
    chapterId,
    chapterCard: normalizeChapterCard(
      item.chapterCard ?? item.chapterCardJson ?? item.chapter_card_json,
      chapter,
    ),
    scenePlan: normalizeScenePlan(
      item.scenePlan ?? item.scenePlanJson ?? item.scene_plan_json,
      chapter,
    ),
    generationConstraints: normalizeGenerationConstraints(
      item.generationConstraints ??
        item.generationConstraintsJson ??
        item.generation_constraints_json,
      chapter,
    ),
    qualityRules: normalizeQualityRules(
      item.qualityRules ?? item.qualityRulesJson ?? item.quality_rules_json,
    ),
    draftVersion: toSafeNumber(item.draftVersion ?? item.draft_version, 1),
    activeVersion: toSafeNumber(item.activeVersion ?? item.active_version, 0),
    status: status === 'active' || status === 'archived' ? status : 'draft',
    createdAt: toSafeString(item.createdAt ?? item.created_at, now),
    updatedAt: toSafeString(item.updatedAt ?? item.updated_at, now),
    activatedAt: toSafeString(item.activatedAt ?? item.activated_at).trim() || undefined,
  };
}

function normalizeStates(
  raw: unknown,
  chapter?: ChapterEngineeringSeed,
): ChapterEngineeringState[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => normalizeChapterEngineeringState(item, chapter))
    .filter((item): item is ChapterEngineeringState => item !== null)
    .sort((a, b) => b.draftVersion - a.draftVersion);
}

function getLocalStates(
  chapterId: string,
  chapter?: ChapterEngineeringSeed,
): ChapterEngineeringState[] {
  const states = normalizeStates(lsGet<unknown>(storageKey(chapterId)), chapter);
  lsSet(storageKey(chapterId), states);
  return states;
}

function saveLocalStates(chapterId: string, states: ChapterEngineeringState[]): void {
  lsSet(storageKey(chapterId), states);
}

function buildBundle(states: ChapterEngineeringState[]): ChapterEngineeringBundle {
  const activeState = states.find((item) => item.status === 'active');
  const latestDraft = states.find((item) => item.status === 'draft');
  const hasUnappliedDraft = Boolean(
    latestDraft && (!activeState || latestDraft.draftVersion > activeState.draftVersion),
  );
  return { activeState, latestDraft, states, hasUnappliedDraft };
}

function toDbInput(input: SaveChapterEngineeringDraftInput): SaveDraftDbInput {
  return {
    novelId: input.novelId,
    volumeId: input.volumeId,
    chapterId: input.chapterId,
    chapterCardJson: JSON.stringify(input.chapterCard),
    scenePlanJson: JSON.stringify(input.scenePlan),
    generationConstraintsJson: JSON.stringify(input.generationConstraints),
    qualityRulesJson: JSON.stringify(input.qualityRules),
  };
}

export const chapterEngineeringService = {
  async getBundle(
    chapterId: string,
    chapter?: ChapterEngineeringSeed,
  ): Promise<ChapterEngineeringBundle> {
    const raw = await dbCall<unknown[]>('get_chapter_engineering_states', { chapterId }, () =>
      getLocalStates(chapterId, chapter),
    );
    return buildBundle(normalizeStates(raw, chapter));
  },

  async saveDraft(
    input: SaveChapterEngineeringDraftInput,
    chapter?: ChapterEngineeringSeed,
  ): Promise<ChapterEngineeringState> {
    const raw = await dbCall<unknown>(
      'save_chapter_engineering_draft',
      { input: toDbInput(input) },
      () => {
        const states = getLocalStates(input.chapterId, chapter);
        const now = nowISO();
        const maxDraftVersion = states.reduce((max, item) => Math.max(max, item.draftVersion), 0);
        const activeVersion = states.find((item) => item.status === 'active')?.draftVersion ?? 0;
        const draft: ChapterEngineeringState = {
          id: generateId(),
          novelId: input.novelId,
          volumeId: input.volumeId,
          chapterId: input.chapterId,
          chapterCard: input.chapterCard,
          scenePlan: input.scenePlan,
          generationConstraints: input.generationConstraints,
          qualityRules: input.qualityRules,
          draftVersion: maxDraftVersion + 1,
          activeVersion,
          status: 'draft',
          createdAt: now,
          updatedAt: now,
        };
        saveLocalStates(input.chapterId, [draft, ...states]);
        return draft;
      },
    );
    const normalized = normalizeChapterEngineeringState(raw, chapter);
    if (!normalized) throw new Error('章节工程草稿保存返回无效数据');
    return normalized;
  },

  async activate(
    id: string,
    chapterId: string,
    chapter?: ChapterEngineeringSeed,
  ): Promise<ChapterEngineeringState> {
    const raw = await dbCall<unknown>(
      'activate_chapter_engineering_state',
      { id, chapterId },
      () => {
        const states = getLocalStates(chapterId, chapter);
        const target = states.find((item) => item.id === id && item.chapterId === chapterId);
        if (!target) throw new Error('未找到要应用的章节工程状态');
        const now = nowISO();
        const nextStates = states.map((item) => {
          if (item.id === target.id) {
            return {
              ...item,
              status: 'active' as const,
              activeVersion: target.draftVersion,
              updatedAt: now,
              activatedAt: now,
            };
          }
          if (item.chapterId === chapterId && item.status === 'active') {
            return { ...item, status: 'archived' as const, updatedAt: now };
          }
          return item;
        });
        saveLocalStates(chapterId, nextStates);
        return nextStates.find((item) => item.id === target.id);
      },
    );
    const normalized = normalizeChapterEngineeringState(raw, chapter);
    if (!normalized) throw new Error('章节工程状态应用返回无效数据');
    return normalized;
  },
};

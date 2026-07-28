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
  ScenePlanItem,
} from '../../types/chapterEngineering';

type ChapterEngineeringSeed = Partial<
  Pick<Chapter, 'title' | 'goal' | 'outline' | 'targetWordCount' | 'targetWords'>
>;

const STORAGE_KEY_PREFIX = 'ai_novel_studio_chapter_engineering_states_';

interface RawChapterEngineeringState extends Partial<ChapterEngineeringState> {
  novel_id?: string;
  volume_id?: string | null;
  chapter_id?: string;
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
    reservedSecrets: [],
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
  return {
    ...fallback,
    ...raw,
    appearingCharacters: cleanStringArray(raw.appearingCharacters),
    mustHappenEvents: cleanStringArray(raw.mustHappenEvents),
    forbiddenEvents: cleanStringArray(raw.forbiddenEvents),
    knownInformation: cleanStringArray(raw.knownInformation),
    unknownInformation: cleanStringArray(raw.unknownInformation),
    releasedInformation: cleanStringArray(raw.releasedInformation),
    reservedSecrets: cleanStringArray(raw.reservedSecrets),
    targetWordCount: cleanNumber(raw.targetWordCount),
    styleRequirements: cleanStringArray(raw.styleRequirements),
    forbiddenWriting: cleanStringArray(raw.forbiddenWriting),
  };
}

function normalizeScenePlan(value: unknown, chapter?: ChapterEngineeringSeed): ScenePlanItem[] {
  const raw = parseJsonField<Partial<ScenePlanItem>[]>(value, []);
  if (!Array.isArray(raw) || raw.length === 0) return createDefaultScenePlan(chapter);
  return raw.map((item, index) => ({
    id: toSafeString(item.id, generateId()),
    sceneNo: toSafeNumber(item.sceneNo, index + 1),
    title: toSafeString(item.title, `场景 ${index + 1}`),
    location: toSafeString(item.location),
    characters: cleanStringArray(item.characters),
    goal: toSafeString(item.goal),
    conflict: toSafeString(item.conflict),
    keyActions: cleanStringArray(item.keyActions),
    keyDialogue: toSafeString(item.keyDialogue),
    informationRelease: cleanStringArray(item.informationRelease),
    result: toSafeString(item.result),
    transition: toSafeString(item.transition),
  }));
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

function normalizeState(
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
    chapterCard: normalizeChapterCard(item.chapterCard ?? item.chapter_card_json, chapter),
    scenePlan: normalizeScenePlan(item.scenePlan ?? item.scene_plan_json, chapter),
    generationConstraints: normalizeGenerationConstraints(
      item.generationConstraints ?? item.generation_constraints_json,
      chapter,
    ),
    qualityRules: normalizeQualityRules(item.qualityRules ?? item.quality_rules_json),
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
    .map((item) => normalizeState(item, chapter))
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
    const normalized = normalizeState(raw, chapter);
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
    const normalized = normalizeState(raw, chapter);
    if (!normalized) throw new Error('章节工程状态应用返回无效数据');
    return normalized;
  },
};

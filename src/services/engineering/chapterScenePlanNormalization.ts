import { generateId } from '../database/db';
import { safeJsonParse, toSafeNumber, toSafeString } from '../../utils/dataGuard';
import type { Chapter } from '../../types/chapter';
import {
  SCENE_PLAN_VERSION_V2,
  type SceneBeat,
  type ScenePlanItem,
} from '../../types/chapterEngineering';

export type ChapterEngineeringSeed = Partial<
  Pick<Chapter, 'title' | 'goal' | 'outline' | 'targetWordCount' | 'targetWords'>
>;

export function cleanStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => toSafeString(item).trim()).filter(Boolean);
}

export function cleanNumber(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

export function parseJsonField<T>(value: unknown, fallback: T): T {
  if (typeof value === 'string') return safeJsonParse<T>(value, fallback);
  if (value && typeof value === 'object') return value as T;
  return fallback;
}

function normalizeBeat(value: unknown, index: number): SceneBeat | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Partial<SceneBeat>;
  const text = toSafeString(raw.text).trim();
  if (!text) return null;
  const order = Math.max(1, Math.round(toSafeNumber(raw.order, index + 1)));
  const characterIds = cleanStringArray(raw.characterIds);
  const startState = toSafeString(raw.startState).trim();
  const stateChange = toSafeString(raw.stateChange).trim();
  const targetCharacters = cleanNumber(raw.targetCharacters);
  return {
    id: toSafeString(raw.id, generateId()),
    order,
    text,
    required: raw.required !== false,
    ...(characterIds.length ? { characterIds } : {}),
    ...(startState ? { startState } : {}),
    ...(stateChange ? { stateChange } : {}),
    ...(targetCharacters ? { targetCharacters } : {}),
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

export function normalizeSceneBeatList(value: unknown): SceneBeat[] {
  const rawBeats = Array.isArray(value) ? value : [];
  return rawBeats
    .map((beat, index) => normalizeBeat(beat, index))
    .filter((beat): beat is SceneBeat => beat !== null)
    .sort((left, right) => left.order - right.order)
    .map((beat, index) => ({ ...beat, order: index + 1 }));
}

function normalizeSceneBeats(
  item: Partial<ScenePlanItem>,
  planVersion: ScenePlanItem['planVersion'],
): SceneBeat[] {
  const beats = normalizeSceneBeatList(item.beats);
  if (beats.length) return beats;
  // A Scene-only v2 plan intentionally has no Beats until execution reaches the
  // Scene. Legacy field back-fill must never manufacture them.
  if (planVersion === SCENE_PLAN_VERSION_V2) return [];
  return legacySceneBeatTexts(item).map((text, index) => ({
    id: generateId(),
    order: index + 1,
    text,
    required: true,
  }));
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

export function isScenePlanV2(scene: Pick<ScenePlanItem, 'planVersion'>): boolean {
  return scene.planVersion === SCENE_PLAN_VERSION_V2;
}

/**
 * Normalizes a Scene-only v2 plan. The version marker is forced on every Scene
 * so legacy back-fill cannot turn an empty plan into a merged Scene+Beat plan.
 * Explicitly stored Beats are preserved for non-destructive reads; planning
 * services reject model output that includes them.
 */
export function normalizeScenePlanV2(
  value: unknown,
  chapter?: ChapterEngineeringSeed,
): ScenePlanItem[] {
  const raw = parseJsonField<Partial<ScenePlanItem>[]>(value, []);
  if (!Array.isArray(raw) || raw.length === 0) return [];
  return normalizeScenePlan(
    raw.map((item) =>
      item && typeof item === 'object'
        ? { ...item, planVersion: SCENE_PLAN_VERSION_V2 }
        : { planVersion: SCENE_PLAN_VERSION_V2 },
    ),
    chapter,
  );
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
      const planVersion =
        source.planVersion === SCENE_PLAN_VERSION_V2 ? SCENE_PLAN_VERSION_V2 : undefined;
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
        beats: normalizeSceneBeats(source, planVersion),
        contextCapsule: toSafeString(source.contextCapsule).trim() || undefined,
        constraints: cleanStringArray(source.constraints),
        expectedEndState: toSafeString(source.expectedEndState).trim() || undefined,
        targetCharacters: cleanNumber(source.targetCharacters),
        ...(planVersion ? { planVersion } : {}),
        originalIndex: index,
      };
    })
    .sort((left, right) => left.sceneNo - right.sceneNo || left.originalIndex - right.originalIndex)
    .map(({ originalIndex: _originalIndex, ...item }, index) => ({ ...item, sceneNo: index + 1 }));
}

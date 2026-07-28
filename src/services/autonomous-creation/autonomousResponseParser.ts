import { extractJsonCandidates, parseJsonCandidates } from '../ai/jsonUtils';
import type {
  ChapterProposal,
  CharacterProposal,
  ConflictProposal,
  PacingPhaseProposal,
  PlotFoundationProposal,
  WorldElementProposal,
} from './autonomousPlanBuilder';
import type { PacingMode, WorldElementType } from '../../types/autonomousCreation';

type JsonRecord = Record<string, unknown>;

const CHARACTER_ROLES = ['protagonist', 'supporting', 'antagonist', 'neutral'] as const;
const WORLD_TYPES = ['location', 'faction', 'rule', 'culture', 'technology', 'artifact'] as const;
const CONFLICT_TYPES = ['internal', 'interpersonal', 'faction', 'world', 'mystery'] as const;
const PACING_MODES = ['setup', 'build', 'pressure', 'climax', 'recovery', 'resolution'] as const;

function parseObject(text: string, label: string, expectedRoot: string): JsonRecord {
  const candidates = extractJsonCandidates(text);
  if (candidates.length === 0) throw new Error(`${label}返回内容不包含 JSON 对象。`);

  const objects = parseJsonCandidates(text).filter(
    (candidate): candidate is typeof candidate & { value: JsonRecord } =>
      Boolean(candidate.value) &&
      typeof candidate.value === 'object' &&
      !Array.isArray(candidate.value),
  );
  if (objects.length === 0) throw new Error(`${label}返回 JSON 无法解析。`);

  const expected = objects
    .filter((candidate) => Object.prototype.hasOwnProperty.call(candidate.value, expectedRoot))
    .sort((left, right) => right.json.length - left.json.length)[0];
  if (expected) return expected.value;

  // Preserve strict field validation when the Provider returns valid JSON with
  // the wrong schema. The largest object is normally the intended top-level one.
  return [...objects].sort((left, right) => right.json.length - left.json.length)[0].value;
}

function record(value: unknown, label: string): JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`${label}必须是对象。`);
  return value as JsonRecord;
}

function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label}必须是数组。`);
  return value;
}

function stringValue(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label}必须是非空字符串。`);
  return value.trim();
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${label}必须是数字。`);
  return value;
}

function stringArray(value: unknown, label: string): string[] {
  return array(value, label).map((item, index) => stringValue(item, `${label}[${index}]`));
}

function optionalStringArray(value: unknown, label: string): string[] | undefined {
  if (value === undefined || value === null) return undefined;
  return stringArray(value, label);
}

function numberArray(value: unknown, label: string): number[] {
  return array(value, label).map((item, index) => numberValue(item, `${label}[${index}]`));
}

function enumValue<T extends string>(value: unknown, values: readonly T[], label: string): T {
  if (typeof value !== 'string' || !values.includes(value as T)) {
    throw new Error(`${label}不是受支持的枚举值。`);
  }
  return value as T;
}

export function parsePlotFoundation(text: string): PlotFoundationProposal {
  const raw = parseObject(text, 'Plot Planner Agent', 'storyBible');
  const bible = record(raw.storyBible, 'storyBible');
  return {
    storyBible: {
      title: stringValue(bible.title, 'storyBible.title'),
      logline: stringValue(bible.logline, 'storyBible.logline'),
      themes: stringArray(bible.themes, 'storyBible.themes'),
      protagonistPromise: stringValue(bible.protagonistPromise, 'storyBible.protagonistPromise'),
      centralQuestion: stringValue(bible.centralQuestion, 'storyBible.centralQuestion'),
      endingVision: stringValue(bible.endingVision, 'storyBible.endingVision'),
      narrativeRules: stringArray(bible.narrativeRules, 'storyBible.narrativeRules'),
    },
    arcs: array(raw.arcs, 'arcs').map((value, index) => {
      const item = record(value, `arcs[${index}]`);
      return {
        title: stringValue(item.title, `arcs[${index}].title`),
        goal: stringValue(item.goal, `arcs[${index}].goal`),
        turningPoint: stringValue(item.turningPoint, `arcs[${index}].turningPoint`),
        climax: stringValue(item.climax, `arcs[${index}].climax`),
        outcome: stringValue(item.outcome, `arcs[${index}].outcome`),
      };
    }),
    volumes: array(raw.volumes, 'volumes').map((value, index) => {
      const item = record(value, `volumes[${index}]`);
      return {
        title: stringValue(item.title, `volumes[${index}].title`),
        summary: stringValue(item.summary, `volumes[${index}].summary`),
        goal: stringValue(item.goal, `volumes[${index}].goal`),
        mainConflict: stringValue(item.mainConflict, `volumes[${index}].mainConflict`),
      };
    }),
  };
}

export function parseCharacterProposals(text: string): CharacterProposal[] {
  const raw = parseObject(text, 'Character Evolution Agent', 'characters');
  return array(raw.characters, 'characters').map((value, index) => {
    const item = record(value, `characters[${index}]`);
    return {
      name: stringValue(item.name, `characters[${index}].name`),
      role: enumValue(item.role, CHARACTER_ROLES, `characters[${index}].role`),
      identity: stringValue(item.identity, `characters[${index}].identity`),
      faction: optionalString(item.faction),
      relationToProtagonist: optionalString(item.relationToProtagonist),
      personality: stringValue(item.personality, `characters[${index}].personality`),
      coreNeed: stringValue(item.coreNeed, `characters[${index}].coreNeed`),
      flaw: stringValue(item.flaw, `characters[${index}].flaw`),
      initialState: stringValue(item.initialState, `characters[${index}].initialState`),
      desiredEndState: stringValue(item.desiredEndState, `characters[${index}].desiredEndState`),
      behaviorLimits: stringArray(item.behaviorLimits, `characters[${index}].behaviorLimits`),
      forbiddenBehaviors: stringArray(
        item.forbiddenBehaviors,
        `characters[${index}].forbiddenBehaviors`,
      ),
      beats: array(item.beats, `characters[${index}].beats`).map((beatValue, beatIndex) => {
        const beat = record(beatValue, `characters[${index}].beats[${beatIndex}]`);
        return {
          chapterNumber: numberValue(
            beat.chapterNumber,
            `characters[${index}].beats[${beatIndex}].chapterNumber`,
          ),
          stage: stringValue(beat.stage, `characters[${index}].beats[${beatIndex}].stage`),
          change: stringValue(beat.change, `characters[${index}].beats[${beatIndex}].change`),
          relationshipShift: optionalString(beat.relationshipShift),
          knowledgeGain: optionalString(beat.knowledgeGain),
        };
      }),
    };
  });
}

export function parseWorldElementProposals(text: string): WorldElementProposal[] {
  const raw = parseObject(text, 'World Builder Agent', 'elements');
  return array(raw.elements, 'elements').map((value, index) => {
    const item = record(value, `elements[${index}]`);
    return {
      type: enumValue<WorldElementType>(item.type, WORLD_TYPES, `elements[${index}].type`),
      name: stringValue(item.name, `elements[${index}].name`),
      summary: stringValue(item.summary, `elements[${index}].summary`),
      firstChapter: numberValue(item.firstChapter, `elements[${index}].firstChapter`),
      dependencies: stringArray(item.dependencies, `elements[${index}].dependencies`),
      constraints: stringArray(item.constraints, `elements[${index}].constraints`),
    };
  });
}

export function parseConflictProposals(text: string): ConflictProposal[] {
  const raw = parseObject(text, 'Conflict Generator Agent', 'conflicts');
  return array(raw.conflicts, 'conflicts').map((value, index) => {
    const item = record(value, `conflicts[${index}]`);
    return {
      title: stringValue(item.title, `conflicts[${index}].title`),
      type: enumValue(item.type, CONFLICT_TYPES, `conflicts[${index}].type`),
      participants: stringArray(item.participants, `conflicts[${index}].participants`),
      stakes: stringValue(item.stakes, `conflicts[${index}].stakes`),
      summary: stringValue(item.summary, `conflicts[${index}].summary`),
      introducedChapter: numberValue(
        item.introducedChapter,
        `conflicts[${index}].introducedChapter`,
      ),
      escalationChapters: numberArray(
        item.escalationChapters,
        `conflicts[${index}].escalationChapters`,
      ),
      climaxChapter: numberValue(item.climaxChapter, `conflicts[${index}].climaxChapter`),
      resolutionChapter: numberValue(
        item.resolutionChapter,
        `conflicts[${index}].resolutionChapter`,
      ),
    };
  });
}

export function parsePacingPhaseProposals(text: string): PacingPhaseProposal[] {
  const raw = parseObject(text, 'Pacing Controller Agent', 'phases');
  return array(raw.phases, 'phases').map((value, index) => {
    const item = record(value, `phases[${index}]`);
    return {
      title: stringValue(item.title, `phases[${index}].title`),
      mode: enumValue<PacingMode>(item.mode, PACING_MODES, `phases[${index}].mode`),
      tensionStart: numberValue(item.tensionStart, `phases[${index}].tensionStart`),
      tensionEnd: numberValue(item.tensionEnd, `phases[${index}].tensionEnd`),
      purpose: stringValue(item.purpose, `phases[${index}].purpose`),
    };
  });
}

export function parseChapterProposals(text: string): ChapterProposal[] {
  const raw = parseObject(text, 'Chapter Batch Planner', 'chapters');
  return array(raw.chapters, 'chapters').map((value, index) => {
    const item = record(value, `chapters[${index}]`);
    return {
      chapterNumber: numberValue(item.chapterNumber, `chapters[${index}].chapterNumber`),
      title: stringValue(item.title, `chapters[${index}].title`),
      outline: stringValue(item.outline, `chapters[${index}].outline`),
      goal: stringValue(item.goal, `chapters[${index}].goal`),
      endingHook: stringValue(item.endingHook, `chapters[${index}].endingHook`),
      focusCharacters: optionalStringArray(
        item.focusCharacters,
        `chapters[${index}].focusCharacters`,
      ),
      conflictTitles: optionalStringArray(item.conflictTitles, `chapters[${index}].conflictTitles`),
      worldElementNames: optionalStringArray(
        item.worldElementNames,
        `chapters[${index}].worldElementNames`,
      ),
    };
  });
}

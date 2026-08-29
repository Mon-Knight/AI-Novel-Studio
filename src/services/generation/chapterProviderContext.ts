import type { AiContextSourceInput, AiContextSourceType } from '../../types/aiCompilation';
import type {
  ChapterGenerationSnapshot,
  GenerationContextSection,
  GenerationContextSourceType,
} from '../../types/generationContext';

export interface ChapterProviderCurrentDraft {
  content: string;
  sourceVersion: string;
}

export interface BuildChapterProviderContextInput {
  snapshot: ChapterGenerationSnapshot;
  requestSourceVersion: string;
  requestInstruction: string;
  currentDraft?: ChapterProviderCurrentDraft;
}

interface SectionPolicy {
  sourceType: AiContextSourceType;
  sortRank: number;
  priority: number;
  maxTokens: number;
  required?: boolean;
  requireFull?: boolean;
}

interface PendingSource extends Omit<AiContextSourceInput, 'order'> {
  sortRank: number;
  stableIndex: number;
}

const SECTION_POLICIES: Readonly<Record<string, SectionPolicy>> = {
  novel: {
    sourceType: 'novel',
    sortRank: 100,
    priority: 100,
    maxTokens: 9_000,
    required: true,
    requireFull: true,
  },
  protagonist: {
    sourceType: 'protagonist',
    sortRank: 200,
    priority: 100,
    maxTokens: 9_000,
    required: true,
    requireFull: true,
  },
  outline: {
    sourceType: 'outline',
    sortRank: 300,
    priority: 100,
    maxTokens: 13_000,
    required: true,
    requireFull: true,
  },
  cross_chapter_continuity: {
    sourceType: 'context_record',
    sortRank: 400,
    priority: 100,
    maxTokens: 9_000,
    required: true,
    requireFull: true,
  },
  adopted_previous_chapter: {
    sourceType: 'draft',
    sortRank: 600,
    priority: 98,
    maxTokens: 12_000,
    required: true,
    requireFull: true,
  },
  world_state_timeline: {
    sourceType: 'context_record',
    sortRank: 700,
    priority: 96,
    maxTokens: 8_000,
    required: true,
    requireFull: true,
  },
  world_settings: {
    sourceType: 'world_setting',
    sortRank: 800,
    priority: 94,
    maxTokens: 8_000,
  },
  character_states: {
    sourceType: 'character',
    sortRank: 900,
    priority: 94,
    maxTokens: 6_000,
    required: true,
    requireFull: true,
  },
  story_assets: {
    sourceType: 'world_setting',
    sortRank: 1_000,
    priority: 88,
    maxTokens: 6_000,
  },
  engineering: {
    sourceType: 'context_record',
    sortRank: 1_100,
    priority: 96,
    maxTokens: 10_000,
  },
  context_records: {
    sourceType: 'context_record',
    sortRank: 1_200,
    priority: 92,
    maxTokens: 8_000,
  },
  memory_context: {
    sourceType: 'memory_context',
    sortRank: 1_300,
    priority: 90,
    maxTokens: 8_000,
  },
  user_instruction: {
    sourceType: 'context_record',
    sortRank: 1_400,
    priority: 92,
    maxTokens: 4_000,
  },
  provisional_previous_chapter: {
    sourceType: 'draft',
    sortRank: 1_500,
    priority: 86,
    maxTokens: 12_000,
  },
  style_output: {
    sourceType: 'output_profile',
    sortRank: 1_600,
    priority: 84,
    maxTokens: 5_000,
  },
  reference_materials: {
    sourceType: 'context_record',
    sortRank: 1_700,
    priority: 72,
    maxTokens: 6_000,
  },
  current_editor: {
    sourceType: 'draft',
    sortRank: 1_800,
    priority: 82,
    maxTokens: 16_000,
  },
};

const GENERATION_SOURCE_TYPE_MAP: Readonly<
  Partial<Record<GenerationContextSourceType, AiContextSourceType>>
> = {
  novel: 'novel',
  world_setting: 'world_setting',
  rule_system: 'rule_system',
  protagonist: 'protagonist',
  master_outline: 'outline',
  volume_outline: 'outline',
  chapter_outline: 'outline',
  chapter_engineering: 'chapter',
  style_profile: 'style_profile',
  output_profile: 'output_profile',
  chapter_character: 'character',
  character_state: 'character',
  chapter_event: 'chapter_event',
  faction: 'world_setting',
  location: 'world_setting',
  context_record: 'context_record',
  world_state: 'context_record',
  memory_context: 'memory_context',
  user_instruction: 'context_record',
  adopted_chapter: 'draft',
  provisional_candidate: 'draft',
  current_editor: 'draft',
  reference_material: 'context_record',
};

function boundedLabel(value: string): string {
  const normalized = value.trim() || 'Frozen chapter context';
  return Array.from(normalized).slice(0, 120).join('');
}

function identitySegment(value: string): string {
  return value
    .trim()
    .replace(/[^A-Za-z0-9_.:-]+/g, '_')
    .slice(0, 48);
}

function scopedSourceId(chapterId: string, suffix: string): string {
  const normalizedSuffix = identitySegment(suffix) || 'context';
  const reserved = normalizedSuffix.length + 1;
  const prefix = Array.from(chapterId.trim() || 'chapter')
    .slice(0, Math.max(1, 160 - reserved))
    .join('');
  return `${prefix}:${normalizedSuffix}`;
}

function sectionPolicy(section: GenerationContextSection): SectionPolicy {
  const configured = SECTION_POLICIES[section.key];
  if (configured) return configured;
  const sourceType = section.sourceTypes
    .map((type) => GENERATION_SOURCE_TYPE_MAP[type])
    .find((type): type is AiContextSourceType => Boolean(type));
  return {
    sourceType:
      sourceType === 'novel' || sourceType === 'chapter'
        ? 'context_record'
        : (sourceType ?? 'context_record'),
    sortRank: 5_000,
    priority: 60,
    maxTokens: 4_000,
  };
}

function sectionSource(
  snapshot: ChapterGenerationSnapshot,
  section: GenerationContextSection,
  index: number,
): PendingSource {
  const policy = sectionPolicy(section);
  return {
    sourceType: policy.sourceType,
    sourceId:
      policy.sourceType === 'novel'
        ? snapshot.novelId
        : scopedSourceId(snapshot.chapterId, `snapshot-${index}-${section.key}`),
    sourceVersion: snapshot.contextHash || snapshot.id,
    origin: 'sqlite',
    label: boundedLabel(section.title),
    content: section.content.trim(),
    priority: policy.priority,
    required: policy.required === true,
    requireFull: policy.requireFull === true,
    maxTokens: policy.maxTokens,
    sortRank: policy.sortRank,
    stableIndex: index,
  };
}

/**
 * Projects one frozen chapter snapshot into independently budgeted Provider
 * context sources. It does not compile, merge, persist, or mutate the snapshot.
 */
export function buildChapterProviderContextSources(
  input: BuildChapterProviderContextInput,
): AiContextSourceInput[] {
  const pending: PendingSource[] = [
    {
      sourceType: 'request_context',
      sourceId: scopedSourceId(input.snapshot.chapterId, 'provider-request'),
      sourceVersion: input.requestSourceVersion,
      origin: 'request',
      label: 'Current chapter request',
      content: input.requestInstruction.trim(),
      priority: 100,
      required: true,
      requireFull: true,
      maxTokens: 3_000,
      sortRank: 0,
      stableIndex: -1,
    },
    ...input.snapshot.compiledContext.sections
      .filter((section) => section.key !== 'current_editor')
      .map((section, index) => sectionSource(input.snapshot, section, index)),
  ];

  if (input.currentDraft) {
    pending.push({
      sourceType: 'draft',
      sourceId: scopedSourceId(input.snapshot.chapterId, 'current-repair-draft'),
      sourceVersion: input.currentDraft.sourceVersion,
      origin: 'request',
      label: 'Current chapter repair draft',
      content: input.currentDraft.content.trim(),
      priority: 100,
      required: true,
      requireFull: true,
      maxTokens: 26_000,
      sortRank: 500,
      stableIndex: Number.MAX_SAFE_INTEGER,
    });
  }

  return pending
    .sort(
      (left, right) =>
        left.sortRank - right.sortRank ||
        left.stableIndex - right.stableIndex ||
        left.sourceId.localeCompare(right.sourceId),
    )
    .map(({ sortRank: _sortRank, stableIndex: _stableIndex, ...source }, index) => ({
      ...source,
      order: index * 10,
    }));
}

import type { AiContextSourceType } from '../../../types/aiCompilation';

export const CHAPTER_GENERATION_ALLOWED_SOURCE_TYPES = [
  'novel',
  'chapter',
  'draft',
  'world_setting',
  'rule_system',
  'protagonist',
  'character',
  'chapter_event',
  'outline',
  'context_record',
  'style_profile',
  'output_profile',
  'request_context',
  'memory_context',
] as const satisfies readonly AiContextSourceType[];

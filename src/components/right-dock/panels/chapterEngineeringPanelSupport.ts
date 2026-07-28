import { generateId } from '../../../services/database/db';
import type { ScenePlanItem } from '../../../types/chapterEngineering';
import type {
  GenerationJob,
  GenerationStepName,
  GenerationStepResult,
} from '../../../types/generationJob';
import type { GetQualityCheckIssuesResult, QualityCheckItem } from '../../../types/qualityCheck';

export type TabId =
  'card' | 'scenes' | 'constraints' | 'quality' | 'snapshot' | 'jobs' | 'versions';

export const TABS: Array<{ id: TabId; label: string }> = [
  { id: 'card', label: '章节卡' },
  { id: 'scenes', label: '场景' },
  { id: 'constraints', label: '约束' },
  { id: 'quality', label: '质检' },
  { id: 'snapshot', label: '快照' },
  { id: 'jobs', label: '任务' },
  { id: 'versions', label: '版本' },
];

export const QUALITY_CHECK_OPTIONS: Array<{ id: string; label: string }> = [
  { id: 'continuity', label: '连续性' },
  { id: 'constraint', label: '约束遵守' },
  { id: 'character', label: '角色一致' },
  { id: 'style', label: '文风一致' },
  { id: 'information_release', label: '信息释放' },
  { id: 'logic', label: '情节逻辑' },
];

export type LoopStatus = 'done' | 'warning' | 'pending' | 'failed';

export interface LoopItem {
  label: string;
  value: string;
  status: LoopStatus;
}
export const EMPTY_QUALITY_RESULT: GetQualityCheckIssuesResult = {
  report: null,
  items: [],
  statistics: {
    total: 0,
    pending: 0,
    resolved: 0,
    ignored: 0,
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
  },
};

export const STEP_LABELS: Record<GenerationStepName, string> = {
  preflight: '预检',
  compile_context: '上下文',
  chapter_card: '章节卡',
  scene_plan: '场景',
  draft_generation: '初稿',
  quality_check: '质检',
  patch_generation: '修复建议',
  patch_apply: '应用修复',
  save_version: '版本',
};

export function formatDate(value?: string): string {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

export function outputNumber(
  step: GenerationStepResult | undefined,
  key: string,
): number | undefined {
  const value = asRecord(step?.outputJson)[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function stepStatusClass(status: string): string {
  if (status === 'succeeded') return 'used';
  if (status === 'failed') return 'missing';
  return 'fallback';
}

export function latestStepByName(
  steps: GenerationStepResult[],
  stepName: GenerationStepName,
): GenerationStepResult | undefined {
  for (let index = steps.length - 1; index >= 0; index -= 1) {
    if (steps[index].stepName === stepName) return steps[index];
  }
  return undefined;
}

export function isActiveGenerationJob(job: GenerationJob | null | undefined): boolean {
  return job?.status === 'pending' || job?.status === 'running' || job?.status === 'retrying';
}

export function isTerminalGenerationJob(job: GenerationJob | null | undefined): boolean {
  return job?.status === 'completed' || job?.status === 'failed' || job?.status === 'cancelled';
}

export function formatQualityTitle(item: QualityCheckItem): string {
  return item.category || item.issueType || '质量问题';
}

export function renumberScenes(items: ScenePlanItem[]): ScenePlanItem[] {
  return items.map((item, index) => ({ ...item, sceneNo: index + 1 }));
}

export function createEmptyScene(sceneNo: number): ScenePlanItem {
  return {
    id: generateId(),
    sceneNo,
    title: `场景 ${sceneNo}`,
    location: '',
    characters: [],
    goal: '',
    conflict: '',
    keyActions: [],
    keyDialogue: '',
    informationRelease: [],
    result: '',
    transition: '',
  };
}

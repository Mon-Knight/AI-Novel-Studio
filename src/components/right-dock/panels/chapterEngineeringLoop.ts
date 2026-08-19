import type { ChapterEngineeringBundle } from '../../../types/chapterEngineering';
import type { ChapterGenerationSnapshot } from '../../../types/generationContext';
import type { GenerationJob, GenerationStepResult } from '../../../types/generationJob';
import type { GetQualityCheckIssuesResult } from '../../../types/qualityCheck';
import { outputNumber, type LoopItem, type LoopStatus } from './chapterEngineeringPanelSupport';

interface EngineeringLoopInput {
  bundle: ChapterEngineeringBundle | null;
  latestJob: GenerationJob | null;
  latestSnapshot: ChapterGenerationSnapshot | null;
  patchApplyStep?: GenerationStepResult;
  qualityResult: GetQualityCheckIssuesResult;
}

export function buildEngineeringLoopItems({
  bundle,
  latestJob,
  latestSnapshot,
  patchApplyStep,
  qualityResult,
}: EngineeringLoopInput): LoopItem[] {
  const jobStatus: LoopStatus = !latestJob
    ? 'pending'
    : latestJob.status === 'failed'
      ? 'failed'
      : latestJob.status === 'cancelled'
        ? 'warning'
        : latestJob.status === 'completed'
          ? 'done'
          : 'warning';
  const qualityStatus: LoopStatus = !qualityResult.report
    ? 'pending'
    : qualityResult.statistics.critical > 0 ||
        qualityResult.statistics.high > 0 ||
        qualityResult.statistics.pending > 0
      ? 'warning'
      : 'done';
  const patchStatus: LoopStatus = !patchApplyStep
    ? 'pending'
    : patchApplyStep.status === 'failed'
      ? 'failed'
      : 'done';
  const appliedCount = outputNumber(patchApplyStep, 'appliedCount') ?? 0;
  return [
    {
      label: '工程',
      value: bundle?.activeState ? `active v${bundle.activeState.draftVersion}` : '未应用',
      status: bundle?.activeState ? 'done' : 'pending',
    },
    {
      label: '快照',
      value: latestSnapshot ? latestSnapshot.contextHash.slice(0, 8) : '未编译',
      status: latestSnapshot ? 'done' : 'pending',
    },
    {
      label: '生成',
      value: latestJob ? `${latestJob.status} ${latestJob.progressPercent}%` : '未运行',
      status: jobStatus,
    },
    {
      label: '版本',
      value: qualityResult.report?.draftVersion
        ? `草稿 v${qualityResult.report.draftVersion}`
        : latestJob?.status === 'completed'
          ? '已保存'
          : '待生成',
      status: latestJob?.status === 'completed' ? 'done' : 'pending',
    },
    {
      label: '质检',
      value: qualityResult.report
        ? `${qualityResult.report.overallScore ?? '-'} 分 / ${qualityResult.statistics.pending} 待处理`
        : '未检查',
      status: qualityStatus,
    },
    {
      label: '修复',
      value: patchApplyStep
        ? appliedCount > 0
          ? `已应用 ${appliedCount}`
          : '无自动修复'
        : '未执行',
      status: patchStatus,
    },
  ];
}

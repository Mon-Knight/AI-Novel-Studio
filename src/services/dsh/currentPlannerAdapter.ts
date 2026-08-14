// CurrentPlannerAdapter：编排现有 chapter_readiness_plan_v1 链路
// （create_agent_plan / claim / complete 等命令经 agentPlanRuntimeService），把
// readiness 结果与六步只读工具输出**确定性映射**为 ChapterPreparationProposal。
// 无模型调用、成本 0，作为 DSH 提案的对照组。

import type {
  ChapterPreparationInput,
  ChapterPreparationProposal,
  RecommendedActionItem,
  ScenePlanItem,
  CharacterConstraintItem,
  ContinuityRiskItem,
} from '../../types/chapterPreparation';
import { CHAPTER_PREPARATION_SOURCES } from '../../types/chapterPreparation';
import type { AgentPlanBundle } from '../../types/agentPlan';
import type { ToolResult } from '../../types/toolRegistry';
import type { ChapterReadinessResult } from '../../types/agentPlan';
import { agentPlanRuntimeService } from '../agent-planner/agentPlanRuntimeService';
import { validateProposal } from './proposalValidator';

export interface CurrentPlannerDependencies {
  runtime: Pick<typeof agentPlanRuntimeService, 'createAndRun'>;
}

type StepOutput = ToolResult<Record<string, unknown> | ChapterReadinessResult> | undefined;

function stepOutput(bundle: AgentPlanBundle, stepKey: string): StepOutput {
  const step = bundle.steps.find((item) => item.stepKey === stepKey);
  return step?.outputJson as StepOutput | undefined;
}

function firstString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  }
  return '';
}

function evidenceSummary(source: string, text: string | undefined): string {
  return firstString(text) || '当前 Planner 未读取该来源（确定性管线无对应步骤）：' + source;
}

function toolWarnings(output: StepOutput): string[] {
  const metadata = output as unknown as { warnings?: unknown };
  if (Array.isArray(metadata?.warnings))
    return metadata.warnings.filter((item) => typeof item === 'string');
  return [];
}

/**
 * 确定性映射：completed 的 readiness bundle → Proposal。
 * 导出以便单测直接喂入构造的 bundle。
 */
export function mapBundleToProposal(
  bundle: AgentPlanBundle,
  input: ChapterPreparationInput,
  startedAt: number,
): ChapterPreparationProposal {
  if (bundle.plan.status !== 'completed') {
    throw new Error('当前 Planner 未完成（status=' + bundle.plan.status + '），无法产出提案');
  }

  const outline = stepOutput(bundle, 'read_chapter_outline');
  const chapterContext = stepOutput(bundle, 'read_chapter_context');
  const styleProfile = stepOutput(bundle, 'read_style_profile');
  const outputControl = stepOutput(bundle, 'read_output_control');
  const novelContext = stepOutput(bundle, 'read_novel_context');
  const readiness = stepOutput(bundle, 'check_readiness')?.data as
    ChapterReadinessResult | undefined;

  const outlineData = outline?.data as Record<string, unknown> | undefined;
  const chapterRecord = (outlineData?.chapter ?? {}) as Record<string, unknown>;
  const title = firstString(chapterRecord.title, '本章');
  const goal = firstString(chapterRecord.goal);
  const styleData = (styleProfile?.data ?? {}) as Record<string, unknown>;
  const activeStyle = styleData.activeStyle as Record<string, unknown> | undefined;

  const chapterGoals = [firstString(goal, readiness?.summary, title + ' 准备完成')];

  const scenePlan: ScenePlanItem[] = [
    {
      title,
      purpose: firstString(
        goal,
        readiness?.summary ?? '',
        '基于已读取大纲与章节上下文完成本章准备',
      ),
    },
  ];

  const contextData = (chapterContext?.data ?? {}) as Record<string, unknown>;
  const chapterCharacters = Array.isArray(contextData.chapterCharacters)
    ? (contextData.chapterCharacters as Record<string, unknown>[])
    : [];
  const characterConstraints: CharacterConstraintItem[] = chapterCharacters.map((item) => ({
    characterId: firstString(item.id ?? item.characterId),
    constraint: firstString(
      item.roleInChapter,
      item.mustAppear === true || item.mustAppear === 1 ? '必须出场' : '',
      '出场角色',
    ),
  }));

  const continuityRisks: ContinuityRiskItem[] = [];
  for (const missing of readiness?.missing ?? []) {
    continuityRisks.push({
      kind: 'readiness_missing',
      description: missing.label,
      severity: missing.blocking ? 'high' : 'medium',
    });
  }
  for (const warning of toolWarnings(outline)
    .concat(toolWarnings(chapterContext))
    .concat(toolWarnings(styleProfile))
    .concat(toolWarnings(outputControl))
    .concat(toolWarnings(novelContext))) {
    continuityRisks.push({ kind: 'tool_warning', description: warning, severity: 'low' });
  }

  const unresolvedQuestions = (readiness?.missing ?? [])
    .filter((item) => item.blocking)
    .map((item) => '缺失：' + item.label);
  for (const warning of readiness?.warnings ?? []) {
    unresolvedQuestions.push(warning);
  }

  const recommendedActions: RecommendedActionItem[] = [];
  for (const missing of readiness?.missing ?? []) {
    recommendedActions.push({
      type: missing.blocking ? 'ask_user' : 'read_tool',
      description: '请补全：' + missing.label,
    });
  }
  if (recommendedActions.length === 0) {
    recommendedActions.push({
      type: 'read_tool',
      target: 'chapter_context',
      description: '准备完成，可进入章节生成',
    });
  }

  const revisions = new Map<string, number>(
    input.baselineRevisions.map((entry) => [entry.source, entry.revision]),
  );
  const revisionOf = (source: string): number => revisions.get(source) ?? -1;
  const summaries = new Map<string, string | undefined>([
    ['outline', '已读取章节大纲：' + title + (goal ? '；目标：' + goal : '')],
    ['chapter_context', '已读取章节上下文（出场角色与事件）'],
    [
      'style_profile',
      activeStyle
        ? '已读取风格方案：' + firstString(activeStyle.name, '未命名')
        : '已读取风格方案：未配置激活方案',
    ],
    ['output_control', '已读取输出控制方案'],
    ['character_states', '已读取作品上下文（含主角设定，read_novel_context）'],
    ['memory_index', undefined],
  ]);

  return {
    schemaVersion: 1,
    planner: 'current_chapter_readiness_v1',
    targetChapter: { novelId: input.novelId, chapterId: input.chapterId },
    baselineRevisions: input.baselineRevisions,
    retrievedEvidence: CHAPTER_PREPARATION_SOURCES.map((source) => ({
      source,
      revision: revisionOf(source),
      summary: evidenceSummary(source, summaries.get(source)),
    })),
    chapterGoals,
    scenePlan,
    characterConstraints,
    continuityRisks,
    unresolvedQuestions,
    recommendedActions,
    producedAt: new Date().toISOString(),
    metrics: {
      planner: 'current_chapter_readiness_v1',
      durationMs: Date.now() - startedAt,
      toolCallCount: 6,
    },
  };
}

export interface CurrentPlannerAdapter {
  prepare(input: ChapterPreparationInput): Promise<ChapterPreparationProposal>;
}

export function createCurrentPlannerAdapter(
  dependencies: CurrentPlannerDependencies = { runtime: agentPlanRuntimeService },
): CurrentPlannerAdapter {
  const { runtime } = dependencies;
  return {
    async prepare(input) {
      const startedAt = Date.now();
      const bundle = await runtime.createAndRun({
        novelId: input.novelId,
        chapterId: input.chapterId,
        operationId: 'dsh-current-planner-adapter',
      });
      const proposal = mapBundleToProposal(bundle, input, startedAt);
      const report = validateProposal(proposal, input);
      if (!report.valid) {
        throw new Error('确定性映射产出未通过校验：' + report.errors.join(' | '));
      }
      return proposal;
    },
  };
}

export const currentPlannerAdapter = createCurrentPlannerAdapter();

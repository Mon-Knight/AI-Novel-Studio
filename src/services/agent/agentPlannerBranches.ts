import type { AgentContext, AgentDecision, AgentHarnessConfig } from '../../types/agentHarness';

/**
 * Pure heuristic branches of the agent planner, extracted so the planner module keeps
 * its frozen size budget. Each helper only reads the context it is handed and returns
 * `null` when its branch does not match, so the caller keeps the original branch order.
 */

interface PlannerFacts {
  context: AgentContext;
  config?: AgentHarnessConfig;
  userGoal: string;
  records: AgentContext['executionRecords'];
  lastRecord: AgentContext['executionRecords'][number] | null;
}

/** Callers keep the original branch order: "history" runs before goal-driven "intent". */
export type PlannerBranchScope = 'history' | 'intent';

function novelId(context: AgentContext): string {
  return context.novelId || 'novel-01';
}

/** Autonomous multi-step continuation for the character-modification chain. */
export function characterModificationContinuation({
  context,
  userGoal,
  records,
  lastRecord,
}: PlannerFacts): AgentDecision | null {
  const goalMentionsCharacterChange =
    (userGoal.includes('性格') || userGoal.includes('修改人物') || userGoal.includes('调整角色')) &&
    !userGoal.includes('完成') &&
    !userGoal.includes('全篇');
  if (!goalMentionsCharacterChange) return null;

  if (
    lastRecord?.toolName === 'query_character_state' &&
    !records.some((r) => r.toolName === 'generate_scene_plan')
  ) {
    return {
      thought: '参考历史成功案例[修改人物性格]，角色状态已就绪，现在规划展示性格转变的分镜节拍。',
      plan: ['查询人物状态 (已完成)', '分镜规划', '更新记忆'],
      selectedTool: {
        name: 'generate_scene_plan',
        arguments: {
          novelId: novelId(context),
          chapterId: context.chapterId || 'chap-01',
          chapterTitle: '角色性格转变篇',
          goal: userGoal,
        },
      },
      reasoningSummary: '参考历史成功经验，为性格调整编排分镜节拍',
      selectedToolReason: '已有角色状态，需要通过场景分镜呈现性格转变的戏剧冲突',
      expectedOutcome: '获得体现新性格的分镜节拍',
      confidenceScore: 0.94,
      isDone: false,
    };
  }

  if (
    lastRecord?.toolName === 'generate_scene_plan' &&
    !records.some((r) => r.toolName === 'update_memory')
  ) {
    return {
      thought: '参考历史成功案例，性格调整分镜已就绪，将新性格特征沉淀至 Novel Memory Layer。',
      plan: ['分镜规划 (已完成)', '更新记忆', '任务交付'],
      selectedTool: {
        name: 'update_memory',
        arguments: {
          novelId: novelId(context),
          characterId: 'char-protagonist',
          emotion: '果决坚毅',
          goal: '贯彻新信念并破局前行',
        },
      },
      reasoningSummary: '参考历史成功经验，持久化角色最新性格与动态心境',
      selectedToolReason: '性格调整分镜已就绪，需将新性格与心境更新至记忆层',
      expectedOutcome: '记忆层角色性格更新并生成新版本快照',
      confidenceScore: 0.96,
      isDone: false,
    };
  }

  if (lastRecord?.toolName === 'update_memory') {
    return {
      thought: '人物性格调整与记忆层更新已闭环达成，输出成果报告。',
      plan: ['全流程闭环达成'],
      selectedTool: undefined,
      reasoningSummary: '人物性格优化全流程完成',
      selectedToolReason: '目标已达成',
      expectedOutcome: '交付角色性格调整结果',
      confidenceScore: 1.0,
      finalResponse: `已根据需求“${userGoal}”成功完成主角性格与心境的动态调整，分镜节拍与记忆层快照均已妥善沉淀。`,
      isDone: true,
    };
  }

  return null;
}

/** History-driven read-only continuation: world snapshot, then role state. */
export function goalDrivenPlanningBranch(
  { context, userGoal }: PlannerFacts,
  scope: PlannerBranchScope,
): AgentDecision | null {
  if (scope === 'intent' && userGoal.includes('flaky_writer_tool')) {
    return {
      thought: '用户指定调用 flaky_writer_tool 工具进行创作任务。',
      plan: ['调用 flaky_writer_tool'],
      selectedTool: {
        name: 'flaky_writer_tool',
        arguments: { novelId: novelId(context) },
      },
      reasoningSummary: '命中显式工具调用指令',
      selectedToolReason: '用户指令明确指定调用 flaky_writer_tool',
      expectedOutcome: '执行指定工具完成特定任务',
      confidenceScore: 0.95,
      isDone: false,
    };
  }

  const asksCharacterChange =
    (userGoal.includes('性格') || userGoal.includes('修改人物') || userGoal.includes('调整角色')) &&
    !userGoal.includes('完成') &&
    !userGoal.includes('全篇');
  if (scope === 'intent' && asksCharacterChange) {
    return {
      thought:
        '参考历史成功案例[修改人物性格与心理动态]，推荐执行链：query_character_state -> generate_scene_plan -> update_memory。首先查询当前人物心境。',
      plan: ['查询人物状态', '分镜规划', '更新记忆'],
      selectedTool: {
        name: 'query_character_state',
        arguments: { novelId: novelId(context), characterId: 'char-protagonist' },
      },
      reasoningSummary: '参考历史成功经验，首先检索主角当前性格与心境基线',
      selectedToolReason: '修改人物性格需要先获取当前角色的基础设定与心理状态',
      expectedOutcome: '获取角色当前动态心境与目标',
      confidenceScore: 0.95,
      isDone: false,
    };
  }

  if (
    scope === 'history' &&
    (userGoal.includes('世界观') || userGoal.includes('世界状态') || userGoal.includes('规则'))
  ) {
    return {
      thought: '作者需要了解当前作品的世界观与状态快照，选择 query_world_state 工具。',
      plan: ['查询世界状态', '输出分析'],
      selectedTool: {
        name: 'query_world_state',
        arguments: { novelId: novelId(context) },
      },
      reasoningSummary: '作者请求查询作品世界规则与世界状态',
      selectedToolReason: '检索世界观规则库以提供精准设定信息',
      expectedOutcome: '输出世界观规则与当前状态',
      confidenceScore: 0.95,
      isDone: false,
    };
  }

  if (
    scope === 'history' &&
    (userGoal.includes('人物') || userGoal.includes('主角') || userGoal.includes('心境'))
  ) {
    return {
      thought: '作者要求检索角色动态心境与伤势状态，选择 query_character_state 工具。',
      plan: ['查询人物状态', '输出人物档案'],
      selectedTool: {
        name: 'query_character_state',
        arguments: { novelId: novelId(context), characterId: 'char-protagonist' },
      },
      reasoningSummary: '作者请求检索指定角色的心境与状态',
      selectedToolReason: '正文生成需要确认主角当前心理状态',
      expectedOutcome: '获得角色目标和情绪',
      confidenceScore: 0.92,
      isDone: false,
    };
  }

  return null;
}

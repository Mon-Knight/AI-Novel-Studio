import type { TaskConversationBundle, ToolCallEvent } from '../../types/conversation';

const PHASE_LABELS: Record<string, string> = {
  creative_dialogue: '理解目标与读取',
  read: '准备与读取',
  story_plan_generate: '全书规划',
  outline_generate: '章节规划',
  setting_expand: '设定候选',
  character_generate: '人物候选',
  event_suggest: '事件候选',
  chapter_write: '生成正文',
  chapter_polish: '修订正文',
  quality_check: '检查',
  chapter_summary: '总结与上下文沉淀',
  scene_plan: '场景规划',
  beat_plan: '节拍规划',
  beat_write: '分段生成',
  beat_state: '核对分段状态',
  scene_close: '场景收束',
  chapter_assemble: '章节汇总',
  domain_candidate: '受控领域子任务',
  domain_readiness: '章节准备',
  task_word_target: '设置任务字数',
};

function execution(event: ToolCallEvent | undefined): Record<string, unknown> | undefined {
  const value = event?.argumentsSummary.execution;
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** Public failure classes only. Never display arbitrary provider output as authorization state. */
function stopLabel(error: string | undefined): string | undefined {
  if (!error) return undefined;
  if (/BASE.*CONFLICT|BASELINE|REVISION.*CONFLICT|SOURCE.*CHANGED/u.test(error))
    return '写入基线已变化，请人工处理后重新授权';
  if (/REVOKED|AUTHORIZATION_INACTIVE/u.test(error)) return '授权已撤销或失效';
  if (/AUTHORIZATION_EXPIRED/u.test(error)) return '授权期限或执行时限已到';
  if (/HUMAN_REVIEW_REQUIRED/u.test(error)) return '此项规则需要真实人工审阅';
  if (/BUDGET|QUOTA|ATTEMPTS_EXHAUSTED/u.test(error)) return '已达到有限执行预算或写入额度';
  if (/CANCEL/u.test(error)) return '任务已取消，不再执行新的授权写入';
  if (/TIMEOUT|TIMED_OUT/u.test(error)) return '执行超时，待明确重试';
  if (/UNSUPPORTED|TOOL_NOT_AUTHORIZED/u.test(error)) return '模型能力或当前阶段工具不符合契约';
  return '运行已中断，请查看本回合错误；不会静默继续自动应用';
}

/** A read-only projection of existing native Run/tool facts, not another execution state store. */
export function projectTaskAuthorizationContext(
  bundle: TaskConversationBundle | null | undefined,
  conversationId: string,
): { sourceTurnId: string; stage?: string; stopReason?: string; refreshKey: string } {
  if (!bundle || bundle.conversation.conversationId !== conversationId)
    return { sourceTurnId: '', refreshKey: `${conversationId}:unavailable` };
  const userTurn = bundle.turns
    .filter((turn) => turn.conversationId === conversationId && turn.role === 'user')
    .reduce<(typeof bundle.turns)[number] | undefined>(
      (latest, turn) => (!latest || turn.sequence > latest.sequence ? turn : latest),
      undefined,
    );
  const run = bundle.runs
    .filter((item) => item.conversationId === conversationId)
    .reduce<(typeof bundle.runs)[number] | undefined>(
      (latest, item) => (!latest || item.createdAt > latest.createdAt ? item : latest),
      undefined,
    );
  const events = run ? bundle.toolEvents.filter((item) => item.runId === run.runId) : [];
  const contract = events.find(
    (event) => event.toolName === 'dsh.execution_contract' && event.status === 'succeeded',
  );
  const metadata = execution(contract);
  const verifiedRoot =
    userTurn &&
    run?.turnId === userTurn.turnId &&
    metadata?.version === 1 &&
    metadata.rootTaskId === conversationId &&
    typeof metadata.rootTurnId === 'string'
      ? metadata.rootTurnId
      : undefined;
  const sourceTurnId = verifiedRoot ?? userTurn?.turnId ?? '';
  if (userTurn && run?.turnId !== userTurn.turnId && metadata?.rootTurnId !== userTurn.turnId)
    return {
      sourceTurnId,
      stage: '准备接入',
      refreshKey: `${conversationId}:${sourceTurnId}:pending`,
    };
  const waiting = events.some(
    (event) => event.toolName === 'dsh.awaiting_decision' && event.status === 'succeeded',
  );
  const phase =
    metadata?.version === 1 &&
    typeof metadata.phase === 'string' &&
    Object.prototype.hasOwnProperty.call(PHASE_LABELS, metadata.phase)
      ? PHASE_LABELS[metadata.phase]
      : undefined;
  const stage = waiting
    ? '等待决定或授权应用'
    : run?.status === 'cancelled'
      ? '已中断'
      : run?.status === 'failed'
        ? '待处理'
        : (phase ?? (run?.status === 'completed' ? '本次执行已结束' : run ? '执行中' : undefined));
  return {
    sourceTurnId,
    stage,
    stopReason: stopLabel(run?.error),
    refreshKey: [
      conversationId,
      sourceTurnId,
      run?.runId ?? '',
      run?.status ?? '',
      run?.updatedAt ?? '',
      bundle.decisions?.length ?? 0,
      bundle.artifacts.length,
      events.length,
    ].join(':'),
  };
}

export type WorkbenchTurnOrigin = 'workbench_asset_preparation' | 'workbench_chapter_summary';

const WORKBENCH_TURN_ENVELOPE: Record<WorkbenchTurnOrigin, string> = {
  workbench_asset_preparation:
    '\n\n[[ANS_WORKBENCH_TURN:v1;origin=workbench_asset_preparation]]\n工作台说明：这是根据已保留正文目标发起的自动资产准备回合，不是用户的新消息。',
  workbench_chapter_summary:
    '\n\n[[ANS_WORKBENCH_TURN:v1;origin=workbench_chapter_summary]]\n工作台说明：这是章节正文采用后发起的自动总结回合，不是用户的新消息。',
};

export interface DecodedWorkbenchTurnContent {
  content: string;
  origin?: WorkbenchTurnOrigin;
}

export interface WorkbenchAutomaticTurnPresentation {
  badge: string;
  label: string;
}

const ASSET_PREPARATION_LABELS: Array<{ prefix: string; label: string }> = [
  { prefix: '生成世界与规则设定候选', label: '准备世界与规则设定' },
  { prefix: '生成世界设定候选', label: '准备世界设定' },
  { prefix: '生成规则设定候选', label: '准备规则设定' },
  { prefix: '生成主角候选', label: '准备主角设定' },
  { prefix: '生成全书规划候选', label: '准备全书规划' },
  { prefix: '生成本章大纲候选', label: '准备章节大纲' },
];

/** Stores a schema-compatible origin that both the runtime and UI can identify. */
export function encodeWorkbenchTurnContent(content: string, origin: WorkbenchTurnOrigin): string {
  return `${content}${WORKBENCH_TURN_ENVELOPE[origin]}`;
}

export function decodeWorkbenchTurnContent(
  content: string | undefined,
): DecodedWorkbenchTurnContent {
  const value = content ?? '';
  for (const [origin, envelope] of Object.entries(WORKBENCH_TURN_ENVELOPE) as Array<
    [WorkbenchTurnOrigin, string]
  >) {
    if (value.endsWith(envelope)) {
      return { content: value.slice(0, -envelope.length), origin };
    }
  }
  return { content: value };
}

/** Projects persisted automatic goals into compact UI copy without exposing their prompt body. */
export function describeWorkbenchAutomaticTurn(
  turn: DecodedWorkbenchTurnContent,
): WorkbenchAutomaticTurnPresentation | null {
  if (turn.origin === 'workbench_chapter_summary') {
    return { badge: '自动总结', label: '总结本章' };
  }
  if (turn.origin !== 'workbench_asset_preparation') return null;
  const normalized = turn.content.trim();
  const matched = ASSET_PREPARATION_LABELS.find(
    ({ prefix }) => normalized === prefix || normalized.startsWith(`${prefix}。`),
  );
  return {
    badge: '自动准备',
    label: matched?.label ?? '准备创作资产',
  };
}

export const WORKBENCH_GOAL_BRIEF_ID = 'workbench-goal-brief';

export function WorkbenchGoalBrief({ text }: { text: string }) {
  return (
    <div
      id={WORKBENCH_GOAL_BRIEF_ID}
      className="workbench-goal-brief"
      role="status"
      data-testid="workbench-word-preview"
    >
      {text}
    </div>
  );
}

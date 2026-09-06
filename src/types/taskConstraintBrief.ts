export type TaskConstraintStatus = 'included' | 'superseded' | 'omitted_budget';

export interface TaskConstraintEntry {
  turnId: string;
  sequence: number;
  segmentIndex: number;
  characterCount: number;
  dimension?: string;
  status: TaskConstraintStatus;
}

export interface TaskConstraintBrief {
  constraints: string[];
  entries: TaskConstraintEntry[];
}

/** Safe projection only; original constraint text stays in the user Turn. */
export interface TaskConstraintBriefReceipt {
  included: number;
  superseded: number;
  omittedBudget: number;
  entries: Array<Omit<TaskConstraintEntry, 'turnId'>>;
  omittedEntryCount: number;
}

/** A task/source binding is provenance metadata, never authority to apply or adopt text. */
export interface ChapterWorkflowBindingV1 {
  schemaVersion: 1;
  workflowId: string;
  stageKey: string;
  inputHash: string;
  planHash: string;
}

import type { SanitizedConversationEvidence } from './production-app-helpers';
import { WRITING_SUBAGENT_ALLOWLIST, WRITING_SUBAGENT_READ_TOOLS } from './real-profile-env';

/** Exclude only a proven planning run or an explicitly identified local command. */
export function inspectWritingFaultRuns(
  evidence: SanitizedConversationEvidence,
  expectedWritingRuns: number,
  localRunIds: string[] = [],
) {
  const failures: string[] = [];
  const planningRuns: SanitizedConversationEvidence['runs'] = [];
  const writingRuns: SanitizedConversationEvidence['runs'] = [];
  const knownIds = new Set(evidence.runs.map((run) => run.runId));
  if (knownIds.size !== evidence.runs.length) failures.push('duplicate run ids in evidence');
  if (localRunIds.some((id) => !knownIds.has(id))) failures.push('a local run is missing');
  if (evidence.artifacts.some((artifact) => !knownIds.has(String(artifact.runId ?? '')))) {
    failures.push('an artifact has no verified owning run');
  }
  if (evidence.toolEvents.some((event) => !knownIds.has(event.runId))) {
    failures.push('a tool event has no verified owning run');
  }
  for (const run of evidence.runs) {
    const events = evidence.toolEvents.filter(
      (event) => event.runId === run.runId && !event.toolName.startsWith('dsh.'),
    );
    const artifacts = evidence.artifacts.filter((artifact) => artifact.runId === run.runId);
    if (localRunIds.includes(run.runId)) {
      if (
        run.status === 'completed' &&
        run.providerId === 'ans-local' &&
        events.length === 0 &&
        artifacts.length === 0
      ) {
        continue;
      }
      failures.push('a local command was not completed without tools or artifacts');
    }
    const plans = events.filter((event) => event.toolName === 'creative.plan_action');
    if (plans.length > 0) {
      if (
        run.status === 'completed' &&
        plans.length === 1 &&
        plans[0].status === 'succeeded' &&
        artifacts.length === 0 &&
        events.every(
          (event) =>
            event.toolName === 'creative.plan_action' ||
            (WRITING_SUBAGENT_READ_TOOLS as readonly string[]).includes(event.toolName),
        )
      ) {
        planningRuns.push(run);
        continue;
      }
      failures.push('a planning run failed, submitted a candidate or used unexpected tools');
    }
    writingRuns.push(run);
    if (
      events.some(
        (event) => event.status === 'succeeded' && !WRITING_SUBAGENT_ALLOWLIST.has(event.toolName),
      )
    ) {
      failures.push('a writing run succeeded with a tool outside its allowlist');
    }
  }
  if (planningRuns.length !== 1) {
    failures.push(`expected exactly one completed planning run, found ${planningRuns.length}`);
  }
  if (writingRuns.length !== expectedWritingRuns) {
    failures.push(`expected ${expectedWritingRuns} writing runs, found ${writingRuns.length}`);
  }
  if (
    planningRuns[0] &&
    writingRuns[0] &&
    evidence.runs.indexOf(planningRuns[0]) > evidence.runs.indexOf(writingRuns[0])
  ) {
    failures.push('the writing run preceded its successful planning run');
  }
  return { planningRuns, writingRuns, failures };
}

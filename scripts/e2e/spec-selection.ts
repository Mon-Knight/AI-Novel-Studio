export const legacyPanelSpecs = new Set([
  'candidate-review-apply.spec.ts',
  'chapter-context-persistence.spec.ts',
  'generation-job-cancel.spec.ts',
  'large-text-save.spec.ts',
  'provider-pipeline-setting.spec.ts',
  'quality-history-replay.spec.ts',
  'restart-task-recovery.spec.ts',
]);

export function selectDesktopSpecs(args: string[], allSpecs: string[]): string[] {
  let smoke = false;
  const requested: string[] = [];
  for (let index = 0; index < args.length; index++) {
    if (args[index] === '--smoke') smoke = true;
    else if (args[index] === '--spec') {
      const value = args[++index];
      if (!value || value.startsWith('--')) throw new Error('--spec requires an E2E spec name.');
      requested.push(value.endsWith('.spec.ts') ? value : `${value}.spec.ts`);
    } else throw new Error(`Unknown desktop argument: ${args[index]}`);
  }
  if (smoke && requested.length) throw new Error('--smoke and --spec cannot be used together.');
  const selected = smoke
    ? ['app-start.spec.ts', 'workbench-writing-smoke.spec.ts']
    : requested.length
      ? requested
      : allSpecs;
  if (!selected.length) throw new Error('Desktop selection cannot be empty.');
  for (const spec of selected)
    if (!allSpecs.includes(spec)) throw new Error(`Unknown E2E spec: ${spec}`);
  return [...new Set(selected)];
}

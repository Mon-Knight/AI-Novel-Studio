type AutonomousChapterWorkflow =
  (typeof import('./autonomousChapterRuntime'))['autonomousChapterWorkflow'];

let runtimePromise: Promise<AutonomousChapterWorkflow> | undefined;

function loadWorkflow(): Promise<AutonomousChapterWorkflow> {
  runtimePromise ??= import('./autonomousChapterRuntime').then(
    ({ autonomousChapterWorkflow }) => autonomousChapterWorkflow,
  );
  return runtimePromise;
}

export const autonomousChapterRuntimeLoader = {
  async generateNextCandidate(
    ...args: Parameters<AutonomousChapterWorkflow['generateNextCandidate']>
  ): ReturnType<AutonomousChapterWorkflow['generateNextCandidate']> {
    return (await loadWorkflow()).generateNextCandidate(...args);
  },

  async generateAllCandidates(
    ...args: Parameters<AutonomousChapterWorkflow['generateAllCandidates']>
  ): ReturnType<AutonomousChapterWorkflow['generateAllCandidates']> {
    return (await loadWorkflow()).generateAllCandidates(...args);
  },
};

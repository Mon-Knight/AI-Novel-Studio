// E2E acceptance baseline only. This must not control production exposure.
export const E2E_CANONICAL_TOOL_IDENTITIES = Object.freeze([
  'context.read@1',
  'memory.search@1',
  'novel.read@1',
  'structure.read@1',
] as const);

interface ToolIdentity {
  id: string;
  version: string;
}

export function assertE2eCanonicalExposure(
  manifestTools: readonly ToolIdentity[],
  modelVisibleIdentities: readonly string[],
  agentTools: readonly ToolIdentity[],
): void {
  const identities = (tools: readonly ToolIdentity[]) =>
    tools.map((tool) => `${tool.id}@${tool.version}`);
  for (const actual of [
    identities(manifestTools),
    modelVisibleIdentities,
    identities(agentTools),
  ]) {
    if (
      actual.length !== E2E_CANONICAL_TOOL_IDENTITIES.length ||
      actual.some((identity, index) => identity !== E2E_CANONICAL_TOOL_IDENTITIES[index])
    ) {
      throw new Error('Canonical projection gate or stable ordering changed unexpectedly.');
    }
  }
}

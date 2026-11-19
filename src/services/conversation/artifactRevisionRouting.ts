import type { ArtifactRevisionSource } from '../../types/artifactRevision';

export type RevisionRoutingSource = Pick<ArtifactRevisionSource, 'artifactType' | 'chapterId'>;

/** Routing metadata only; callers must still verify the immutable source and its decision. */
export function boundArtifactRevision(source?: RevisionRoutingSource) {
  if (source?.artifactType === 'setting_candidates') {
    return {
      identity: 'settings' as const,
      tool: { name: 'expand_settings' as const, artifactType: 'setting_candidates' },
    };
  }
  if (source?.artifactType === 'outline') {
    return {
      identity: 'outline' as const,
      tool: { name: 'generate_outline' as const, artifactType: 'outline' },
    };
  }
  return undefined;
}

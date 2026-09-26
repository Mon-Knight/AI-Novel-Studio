export const CHAPTER_REVISION_DERIVATION_TYPE = 'revision' as const;

/** Immutable revision identity, never a permission to apply or adopt. */
export interface ArtifactRevisionSource {
  conversationId: string;
  novelId: string;
  chapterId?: string;
  cardId: string;
  artifactId: string;
  artifactHash: string;
  artifactType: string;
  runId?: string;
  title: string;
  sourceDraftVersion?: number;
}

import type { ArtifactRevisionSource } from '../../types/artifactRevision';

const PREFIX = '[[ANS_ARTIFACT_REVISION_TURN:v1]]\n';

/** Typed so the workbench can classify it as a data problem instead of a model failure. */
export class ArtifactRevisionSourceError extends Error {
  readonly code = 'WORKBENCH_REVISION_SOURCE_INVALID';

  constructor(message: string) {
    super(message);
    this.name = 'ArtifactRevisionSourceError';
  }
}
const REQUIRED = [
  'conversationId',
  'novelId',
  'cardId',
  'artifactId',
  'artifactHash',
  'artifactType',
  'title',
];
const OPTIONAL = ['chapterId', 'runId', 'sourceDraftVersion'];

function validSource(source: unknown): source is ArtifactRevisionSource {
  if (!source || typeof source !== 'object' || Array.isArray(source)) return false;
  const record = source as Record<string, unknown>;
  return (
    Object.keys(record).every((key) => REQUIRED.includes(key) || OPTIONAL.includes(key)) &&
    REQUIRED.every(
      (key) => typeof record[key] === 'string' && Boolean((record[key] as string).trim()),
    ) &&
    ['chapterId', 'runId'].every(
      (key) =>
        record[key] === undefined ||
        (typeof record[key] === 'string' && Boolean((record[key] as string).trim())),
    ) &&
    (record.sourceDraftVersion === undefined ||
      (Number.isSafeInteger(record.sourceDraftVersion) && Number(record.sourceDraftVersion) > 0))
  );
}

/** Versioned storage envelope, not prompt text. Escape literal envelopes by wrapping once. */
export function encodeArtifactRevisionTurn(
  content: string,
  source?: ArtifactRevisionSource,
): string {
  if (!source && !content.startsWith(PREFIX)) return content;
  if (source && !validSource(source))
    throw new ArtifactRevisionSourceError('修订来源身份不完整，无法作为修订依据。');
  return PREFIX + JSON.stringify({ content, revisionSource: source ?? null });
}

export function decodeArtifactRevisionTurn(content: string): {
  content: string;
  revisionSource?: ArtifactRevisionSource;
} {
  if (!content.startsWith(PREFIX)) return { content };
  try {
    const envelope = JSON.parse(content.slice(PREFIX.length));
    if (
      !envelope ||
      typeof envelope !== 'object' ||
      Array.isArray(envelope) ||
      Object.keys(envelope).sort().join(',') !== 'content,revisionSource' ||
      typeof envelope.content !== 'string' ||
      (envelope.revisionSource !== null && !validSource(envelope.revisionSource))
    ) {
      throw new Error('invalid envelope');
    }
    return {
      content: envelope.content,
      ...(envelope.revisionSource ? { revisionSource: envelope.revisionSource } : {}),
    };
  } catch {
    throw new Error('修订来源记录无效，已阻止恢复执行。');
  }
}

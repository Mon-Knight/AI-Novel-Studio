import type { ArtifactRevisionSource } from '../../types/artifactRevision';
import type { ConversationArtifactCard } from '../../types/conversation';
import { computeContentSha256 } from '../../utils/contentIntegrity';
import { aiTaskRuntimeService } from '../ai-tasks/aiTaskRuntimeService';
import { isTauri } from '../database/db';
import { taskConversationService } from './taskConversationService';
import { ArtifactRevisionSourceError } from './artifactRevisionSourceCodec';

export function captureArtifactRevisionSource(
  card: ConversationArtifactCard,
  novelId: string,
  artifactHash: string,
): ArtifactRevisionSource {
  if (!card.artifactId || !artifactHash) throw new Error('修订候选缺少不可变身份。');
  return {
    conversationId: card.conversationId,
    novelId,
    // Keep the captured source free of JSON null so the strict envelope codec stays strict.
    chapterId: card.artifactEvidence?.sourceChapterId ?? undefined,
    cardId: card.cardId,
    artifactId: card.artifactId,
    artifactHash,
    artifactType: card.artifactType,
    runId: card.runId ?? undefined,
    title: card.title,
    sourceDraftVersion: card.artifactEvidence?.sourceDraftVersion ?? undefined,
  };
}

export interface ArtifactRevisionScope {
  conversationId: string;
  novelId: string;
  chapterId?: string;
  revisionSource?: ArtifactRevisionSource;
}

/** Always re-read identities and content; a missing/stale source never falls back to latest. */
export async function verifyArtifactRevisionSource(
  input: ArtifactRevisionScope,
  dependencies: {
    getConversation?: typeof taskConversationService.get;
    getArtifact?: typeof aiTaskRuntimeService.getArtifact;
    persistent?: boolean;
  } = {},
): Promise<{ source: ArtifactRevisionSource; content: string; contentHash: string } | undefined> {
  const source = input.revisionSource;
  if (!source) return undefined;
  const fail = () =>
    new ArtifactRevisionSourceError(
      '修订来源已失效或与当前任务、作品、章节不一致；请重新选择候选，不会改用最新候选。',
    );
  if (
    source.conversationId !== input.conversationId ||
    source.novelId !== input.novelId ||
    (source.chapterId !== undefined && source.chapterId !== input.chapterId)
  )
    throw fail();
  const getConversation = dependencies.getConversation ?? taskConversationService.get;
  const bundle = await getConversation(input.conversationId, { hydrateArtifacts: false });
  const cards = bundle?.artifacts.filter((card) => card.cardId === source.cardId);
  const card = cards?.length === 1 ? cards[0] : undefined;
  if (
    !bundle ||
    bundle.conversation.novelId !== input.novelId ||
    !card ||
    card.conversationId !== input.conversationId ||
    card.artifactId !== source.artifactId ||
    card.artifactType !== source.artifactType ||
    card.runId !== source.runId
  )
    throw fail();
  if (
    source.runId &&
    !bundle.runs.some(
      (run) => run.runId === source.runId && run.conversationId === input.conversationId,
    )
  )
    throw fail();
  if (
    !bundle.decisions?.some(
      (decision) =>
        decision.conversationId === input.conversationId &&
        decision.cardId === source.cardId &&
        decision.artifactId === source.artifactId &&
        decision.artifactHash === source.artifactHash &&
        decision.decision === 'request_revision',
    )
  )
    throw fail();
  if (dependencies.persistent ?? isTauri()) {
    const getArtifact = dependencies.getArtifact ?? aiTaskRuntimeService.getArtifact;
    const { artifact, rawContent } = await getArtifact(source.artifactId);
    if (
      artifact.artifactId !== source.artifactId ||
      artifact.artifactType !== source.artifactType ||
      artifact.sourceNovelId !== input.novelId ||
      artifact.sourceChapterId !== source.chapterId ||
      !['valid', 'valid_with_warnings'].includes(artifact.processingStatus) ||
      artifact.contentHash !== source.artifactHash ||
      !rawContent.trim() ||
      (await computeContentSha256(rawContent)) !== source.artifactHash
    )
      throw fail();
    return { source, content: rawContent, contentHash: source.artifactHash };
  }
  if (!card.content || (await computeContentSha256(card.content)) !== source.artifactHash)
    throw fail();
  let content = card.content;
  if (source.artifactType === 'chapter_text') {
    let data: { novelId?: string; chapterId?: string; text?: string } | undefined;
    try {
      data = JSON.parse(content).data;
    } catch {
      throw fail();
    }
    if (data?.novelId !== input.novelId || data.chapterId !== input.chapterId || !data.text?.trim())
      throw fail();
    content = data.text;
  }
  return { source, content, contentHash: await computeContentSha256(content) };
}

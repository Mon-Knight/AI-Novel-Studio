import { isTauri } from '../database/db';
import { aiTaskRuntimeService } from '../ai-tasks/aiTaskRuntimeService';
import { taskConversationService } from './taskConversationService';

/** Compatibility reader only. Production revision execution requires an exact revisionSource. */
export async function findLatestCandidateText(
  conversationId: string,
  novelId: string,
  chapterId: string,
): Promise<string | undefined> {
  const conversation = await taskConversationService.get(conversationId);
  if (!conversation) throw new Error('修改来源任务会话不存在。');
  const cards = conversation.artifacts.filter((item) => item.artifactType === 'chapter_text');
  for (let index = cards.length - 1; index >= 0; index -= 1) {
    const card = cards[index];
    if (!isTauri()) {
      if (!card.content) throw new Error('浏览器候选卡片缺少修改来源正文。');
      let payload: { data?: { novelId?: string; chapterId?: string; text?: string } };
      try {
        payload = JSON.parse(card.content) as typeof payload;
      } catch {
        throw new Error('浏览器候选卡片无法解析修改来源正文。');
      }
      if (payload.data?.novelId !== novelId || payload.data?.chapterId !== chapterId) continue;
      if (!payload.data.text?.trim()) {
        throw new Error('浏览器候选卡片修改来源正文为空。');
      }
      return payload.data.text;
    }

    if (!card.artifactId) throw new Error('上一版章节候选缺少 ResultArtifact 引用。');
    const artifact = await aiTaskRuntimeService.getArtifact(card.artifactId);
    if (artifact.artifact.artifactType !== 'chapter_text') {
      throw new Error('上一版章节候选的 ResultArtifact 类型无效。');
    }
    if (
      artifact.artifact.sourceNovelId !== novelId ||
      artifact.artifact.sourceChapterId !== chapterId
    ) {
      continue;
    }
    if (!['valid', 'valid_with_warnings'].includes(artifact.artifact.processingStatus)) {
      throw new Error('上一版章节候选未通过 ResultArtifact 处理状态校验。');
    }
    if (!artifact.rawContent.trim()) throw new Error('上一版章节候选正文为空。');
    return artifact.rawContent;
  }
  return undefined;
}

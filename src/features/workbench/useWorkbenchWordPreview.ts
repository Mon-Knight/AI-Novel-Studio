import { useEffect, useState } from 'react';
import { taskConversationService } from '../../services/conversation/taskConversationService';
import {
  parseTaskWordTarget,
  resolveTaskWordTarget,
} from '../../services/conversation/taskWordTarget';
import {
  getChapterWordRangePercents,
  resolveChapterWordRange,
} from '../../services/conversation/chapterWordRangePolicy';

export interface WorkbenchWordPreviewContext {
  novelId: string;
  conversationId?: string;
  chapterTarget?: number;
  chapterId?: string;
  historyRevision?: number;
}

export function useWorkbenchWordPreview(
  context: WorkbenchWordPreviewContext | undefined,
  goal: string,
) {
  const { novelId, conversationId, chapterId, chapterTarget, historyRevision } = context ?? {};
  const identity = `${novelId ?? ''}:${conversationId ?? ''}:${historyRevision ?? 0}`;
  const [saved, setSaved] = useState<{ identity: string; target?: number; error?: string }>();
  useEffect(() => {
    if (!novelId || !conversationId) return;
    let active = true;
    void taskConversationService
      .get(conversationId, { hydrateArtifacts: false })
      .then((bundle) => {
        if (!bundle || bundle.conversation.novelId !== novelId) throw new Error('任务归属已变化');
        if (active) setSaved({ identity, target: resolveTaskWordTarget('', bundle.turns) });
      })
      .catch(() => {
        if (active) setSaved({ identity, error: '任务字数设置暂未读到，发送前会重新校验。' });
      });
    return () => {
      active = false;
    };
  }, [identity, novelId, conversationId]);
  if (!context) return undefined;
  try {
    const explicit = parseTaskWordTarget(goal);
    if (!chapterId && !explicit) return undefined;
    if (!explicit && conversationId && saved?.identity !== identity) return '正在读取任务字数设置…';
    if (!explicit && saved?.identity === identity && saved.error) return saved.error;
    const taskTarget = saved?.identity === identity ? saved.target : undefined;
    const target = explicit?.target ?? taskTarget ?? chapterTarget;
    const range = resolveChapterWordRange(target, getChapterWordRangePercents());
    if (!range) return '所选章节尚无目标字数，可在要求中明确本次目标。';
    const source = explicit ? '本次要求' : taskTarget ? '任务设置' : '所选章节';
    return `写章目标 ${range.target} 字（${source}）· 候选范围 ${range.hardMinimum}～${range.hardMaximum} 字。重试沿用原回合范围。`;
  } catch (error) {
    return error instanceof Error ? error.message : '请明确本次目标字数。';
  }
}

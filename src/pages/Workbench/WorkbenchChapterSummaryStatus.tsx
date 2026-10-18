import { useNavigate } from 'react-router-dom';
import type { Chapter } from '../../types/chapter';
import type { ChapterSummaryOrchestrationState } from '../../services/conversation/chapterSummaryOrchestration';
import { buildChapterSummaryRedoHandoff } from '../../services/conversation/chapterWorkflowService';

export function WorkbenchChapterSummaryStatus({
  state,
  chapters,
  conversationId,
  disabled,
  onLocate,
}: {
  state: ChapterSummaryOrchestrationState;
  chapters: Chapter[];
  conversationId: string;
  disabled?: boolean;
  onLocate(cardId: string): void;
}) {
  const navigate = useNavigate();
  const pending =
    state.pendingChapters?.filter((item) =>
      [
        'rejected',
        'revision_requested',
        'failed',
        'conflict',
        'awaiting_apply',
        'expired',
      ].includes(item.phase),
    ) ?? [];
  if (!pending.length) return null;
  return (
    <details className="workbench-readiness-hint" data-testid="workbench-pending-chapter-summaries">
      <summary>{pending.length} 章总结待处理；已采用正文保留，其他章节可继续</summary>
      <p>以下章节的总结尚未进入正式上下文；后续写作仍须读取可用的正式正文。</p>
      {pending.map((item) => {
        const chapter = chapters.find((entry) => entry.id === item.chapterId);
        if (!chapter) return null;
        const review = item.phase === 'awaiting_apply';
        return (
          <div key={item.chapterId}>
            <span>
              第{chapter.chapterNumber}章 · {review ? '总结待审阅' : '总结需重做'}{' '}
            </span>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={disabled}
              onClick={() => {
                if (review && item.cardId) onLocate(item.cardId);
                else
                  navigate('/', {
                    state: buildChapterSummaryRedoHandoff({
                      novelId: chapter.novelId,
                      chapterId: chapter.id,
                      adoptedDraftId: chapter.adoptedDraftId,
                      conversationId,
                    }),
                  });
              }}
            >
              {review ? '查看总结候选' : '重新总结本章'}
            </button>
          </div>
        );
      })}
    </details>
  );
}

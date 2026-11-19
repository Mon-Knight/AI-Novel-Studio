import { ModalFrame } from '../common/ModalFrame';
import type { ReviewRenewalPreview } from '../../types/reviewAuthorizationRenewal';
import { isComposingKeyboardEvent } from '../../utils/keyboardEvent';

export interface ReviewAuthorizationRenewalDialogProps {
  preview: ReviewRenewalPreview | null;
  savedContent: string;
  formalContent: string;
  busy: boolean;
  committing?: boolean;
  error: string;
  uncertain: boolean;
  onConfirm: () => void;
  onLookup: () => void;
  onDismiss: () => void;
}

/** Explicit new human consent. Viewing this dialog neither signs nor adopts anything. */
export function ReviewAuthorizationRenewalDialog({
  preview,
  savedContent,
  formalContent,
  busy,
  committing = false,
  error,
  uncertain,
  onConfirm,
  onLookup,
  onDismiss,
}: ReviewAuthorizationRenewalDialogProps) {
  return (
    <ModalFrame
      title="重新授权审阅当前草稿"
      onDismiss={onDismiss}
      busy={committing}
      maxWidth={680}
      initialFocusSelector="[data-review-renewal-cancel]"
      dialogProps={{
        onKeyDown: (event) => {
          if (isComposingKeyboardEvent(event)) event.stopPropagation();
          if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
            event.preventDefault();
            event.stopPropagation();
          }
        },
      }}
      footer={
        <>
          <button
            type="button"
            className="btn btn-secondary"
            data-review-renewal-cancel
            disabled={committing}
            onClick={onDismiss}
          >
            取消，保留当前草稿
          </button>
          {uncertain ? (
            <button type="button" className="btn btn-primary" disabled={busy} onClick={onLookup}>
              核对重新授权结果
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy || !preview || Boolean(error)}
              onClick={onConfirm}
            >
              确认签发新的审阅授权
            </button>
          )}
        </>
      }
    >
      <p>
        旧授权的章节基线已变化或无法核对。本次操作是你对同一候选和下列已保存草稿的新同意，不会刷新或改写旧授权记录。
      </p>
      <p>
        <strong>重新授权不会立即采用、覆盖正式稿或调用模型。</strong>
        之后仍须明确确认采用。取消不会丢弃已保存的人工编辑。
      </p>
      {busy && (
        <p role="status" aria-live="polite">
          正在核对原生审阅事实…
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      {preview && (
        <>
          <dl>
            <dt>当前目标</dt>
            <dd>
              作品 {preview.novelId} · 章节 {preview.chapterId}
            </dd>
            <dt>原候选与任务</dt>
            <dd>
              {preview.artifactId} · {preview.cardId} · {preview.conversationId}
            </dd>
            <dt>候选全文指纹</dt>
            <dd>{preview.artifactHash}</dd>
            <dt>旧授权</dt>
            <dd>{preview.authorizationId}（旧基线不自动补填）</dd>
            <dt>当前章节修订</dt>
            <dd>{preview.chapterRevision}</dd>
            <dt>当前章节基线指纹</dt>
            <dd>{preview.chapterBaselineHash}</dd>
            <dt>当前正式稿</dt>
            <dd>{preview.adoptedDraftId || '尚无正式采用稿'}</dd>
            {preview.adoptedContentHash && (
              <>
                <dt>当前正式稿全文指纹</dt>
                <dd>{preview.adoptedContentHash}</dd>
              </>
            )}
            {preview.savedDraft && (
              <>
                <dt>本次保留的编辑稿</dt>
                <dd>
                  {preview.savedDraft.draftId} · v{preview.savedDraft.draftVersion}
                </dd>
                <dt>编辑稿全文指纹</dt>
                <dd>{preview.savedDraft.contentHash}</dd>
              </>
            )}
          </dl>
          {preview.adoptedDraftId && (
            <details>
              <summary>核对当前完整正式稿（只读）</summary>
              <pre style={{ whiteSpace: 'pre-wrap' }}>{formalContent}</pre>
            </details>
          )}
          <details>
            <summary>核对本次保留的完整编辑稿</summary>
            <pre style={{ whiteSpace: 'pre-wrap' }}>{savedContent}</pre>
          </details>
        </>
      )}
    </ModalFrame>
  );
}

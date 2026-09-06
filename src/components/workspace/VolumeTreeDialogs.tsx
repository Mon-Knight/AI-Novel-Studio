import type { Volume } from '../../types/volume';
import { BookOpenText, FileText } from 'lucide-react';
import { ModalFrame } from '../common/ModalFrame';
import { isComposingKeyboardEvent } from '../../utils/keyboardEvent';

interface VolumeTreeDialogsProps {
  volumes: Volume[];
  showNewVolume: boolean;
  newVolumeTitle: string;
  showNewChapter: boolean;
  newChapterTitle: string;
  newChapterTargetWordCount: string;
  newChapterVolumeId: string;
  creating: boolean;
  volumePlaceholder: string;
  onCloseVolume: () => void;
  onCloseChapter: () => void;
  onVolumeTitleChange: (value: string) => void;
  onChapterTitleChange: (value: string) => void;
  onChapterTargetWordCountChange: (value: string) => void;
  onChapterVolumeChange: (value: string) => void;
  onCreateVolume: () => void;
  onCreateChapter: () => void;
}

export function VolumeTreeDialogs({
  volumes,
  showNewVolume,
  newVolumeTitle,
  showNewChapter,
  newChapterTitle,
  newChapterTargetWordCount,
  newChapterVolumeId,
  creating,
  volumePlaceholder,
  onCloseVolume,
  onCloseChapter,
  onVolumeTitleChange,
  onChapterTitleChange,
  onChapterTargetWordCountChange,
  onChapterVolumeChange,
  onCreateVolume,
  onCreateChapter,
}: VolumeTreeDialogsProps) {
  return (
    <>
      {showNewVolume && (
        <ModalFrame
          maxWidth={360}
          onDismiss={onCloseVolume}
          busy={creating}
          overlayProps={{ 'data-testid': 'volume-create-dialog' }}
          initialFocusSelector='[data-testid="volume-title-input"]'
          title={
            <>
              <BookOpenText aria-hidden="true" size={18} strokeWidth={1.8} />
              新建分卷
            </>
          }
          footer={
            <>
              <button
                className="btn btn-secondary btn-sm"
                onClick={onCloseVolume}
                disabled={creating}
              >
                取消
              </button>
              <button
                className="btn btn-primary btn-sm"
                data-testid="volume-save"
                onClick={onCreateVolume}
                disabled={creating || !newVolumeTitle.trim()}
              >
                {creating ? '创建中...' : '创建'}
              </button>
            </>
          }
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div>
              <label className="panel-field-label">分卷名称</label>
              <input
                type="text"
                aria-label="分卷名称"
                className="form-input"
                data-testid="volume-title-input"
                value={newVolumeTitle}
                onChange={(event) => onVolumeTitleChange(event.target.value)}
                placeholder={volumePlaceholder}
                style={{ width: '100%' }}
                autoFocus
                disabled={creating}
                onKeyDown={(event) => {
                  if (
                    event.key === 'Enter' &&
                    !isComposingKeyboardEvent(event) &&
                    !creating &&
                    newVolumeTitle.trim()
                  ) {
                    event.preventDefault();
                    onCreateVolume();
                  }
                }}
              />
            </div>
          </div>
        </ModalFrame>
      )}
      {showNewChapter && (
        <ModalFrame
          maxWidth={360}
          onDismiss={onCloseChapter}
          busy={creating}
          overlayProps={{ 'data-testid': 'chapter-create-dialog' }}
          initialFocusSelector='[data-testid="chapter-title-input"]'
          title={
            <>
              <FileText aria-hidden="true" size={18} strokeWidth={1.8} />
              新建章节
            </>
          }
          footer={
            <>
              <button
                className="btn btn-secondary btn-sm"
                onClick={onCloseChapter}
                disabled={creating}
              >
                取消
              </button>
              <button
                className="btn btn-primary btn-sm"
                data-testid="chapter-create-submit"
                onClick={onCreateChapter}
                disabled={
                  creating ||
                  !newChapterTitle.trim() ||
                  Number(newChapterTargetWordCount) < 500 ||
                  Number(newChapterTargetWordCount) > 20000
                }
              >
                {creating ? '创建中...' : '创建'}
              </button>
            </>
          }
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {volumes.length > 0 && (
              <div>
                <label className="panel-field-label">所属分卷</label>
                <select
                  aria-label="所属分卷"
                  className="form-input"
                  data-testid="chapter-volume-select"
                  value={newChapterVolumeId || volumes[0]?.id || ''}
                  onChange={(event) => onChapterVolumeChange(event.target.value)}
                  disabled={creating}
                  style={{ width: '100%' }}
                >
                  {volumes.map((volume) => (
                    <option key={volume.id} value={volume.id}>
                      {volume.title}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {volumes.length === 0 && (
              <div style={{ fontSize: 12, color: 'var(--color-text-muted)', padding: '4px 0' }}>
                当前无分卷，将自动创建"第一卷"。
              </div>
            )}
            <div>
              <label className="panel-field-label">章节标题</label>
              <input
                type="text"
                aria-label="章节标题"
                className="form-input"
                data-testid="chapter-title-input"
                value={newChapterTitle}
                onChange={(event) => onChapterTitleChange(event.target.value)}
                placeholder="例如：第1章"
                style={{ width: '100%' }}
                disabled={creating}
                autoFocus
                onKeyDown={(event) => {
                  if (
                    event.key === 'Enter' &&
                    !isComposingKeyboardEvent(event) &&
                    !creating &&
                    newChapterTitle.trim() &&
                    Number(newChapterTargetWordCount) >= 500 &&
                    Number(newChapterTargetWordCount) <= 20000
                  ) {
                    event.preventDefault();
                    onCreateChapter();
                  }
                }}
              />
            </div>
            <div>
              <label className="panel-field-label" htmlFor="chapter-target-word-count">
                目标字数
              </label>
              <input
                id="chapter-target-word-count"
                type="number"
                className="form-input"
                data-testid="chapter-target-word-count"
                value={newChapterTargetWordCount}
                min={500}
                max={20000}
                step={100}
                onChange={(event) => onChapterTargetWordCountChange(event.target.value)}
                style={{ width: '100%' }}
                disabled={creating}
              />
            </div>
          </div>
        </ModalFrame>
      )}
    </>
  );
}

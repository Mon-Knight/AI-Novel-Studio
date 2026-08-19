import type { Volume } from '../../types/volume';

interface VolumeTreeDialogsProps {
  volumes: Volume[];
  showNewVolume: boolean;
  newVolumeTitle: string;
  showNewChapter: boolean;
  newChapterTitle: string;
  newChapterVolumeId: string;
  creating: boolean;
  volumePlaceholder: string;
  onCloseVolume: () => void;
  onCloseChapter: () => void;
  onVolumeTitleChange: (value: string) => void;
  onChapterTitleChange: (value: string) => void;
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
  newChapterVolumeId,
  creating,
  volumePlaceholder,
  onCloseVolume,
  onCloseChapter,
  onVolumeTitleChange,
  onChapterTitleChange,
  onChapterVolumeChange,
  onCreateVolume,
  onCreateChapter,
}: VolumeTreeDialogsProps) {
  return (
    <>
      {showNewVolume && (
        <div className="modal-overlay" data-testid="volume-create-dialog" onClick={onCloseVolume}>
          <div
            className="modal-dialog"
            style={{ maxWidth: 360 }}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modal-title">📖 新建分卷</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div>
                <label className="panel-field-label">分卷名称</label>
                <input
                  type="text"
                  className="form-input"
                  data-testid="volume-title-input"
                  value={newVolumeTitle}
                  onChange={(event) => onVolumeTitleChange(event.target.value)}
                  placeholder={volumePlaceholder}
                  style={{ width: '100%' }}
                  autoFocus
                  onKeyDown={(event) => event.key === 'Enter' && onCreateVolume()}
                />
              </div>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button className="btn btn-secondary btn-sm" onClick={onCloseVolume}>
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
              </div>
            </div>
          </div>
        </div>
      )}
      {showNewChapter && (
        <div className="modal-overlay" data-testid="chapter-create-dialog" onClick={onCloseChapter}>
          <div
            className="modal-dialog"
            style={{ maxWidth: 360 }}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modal-title">📝 新建章节</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {volumes.length > 0 && (
                <div>
                  <label className="panel-field-label">所属分卷</label>
                  <select
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
                  className="form-input"
                  data-testid="chapter-title-input"
                  value={newChapterTitle}
                  onChange={(event) => onChapterTitleChange(event.target.value)}
                  placeholder="例如：第1章"
                  style={{ width: '100%' }}
                  disabled={creating && volumes.length > 0}
                  autoFocus
                  onKeyDown={(event) => event.key === 'Enter' && onCreateChapter()}
                />
              </div>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={onCloseChapter}
                  disabled={creating && volumes.length > 0}
                >
                  取消
                </button>
                <button
                  className="btn btn-primary btn-sm"
                  data-testid="chapter-create-submit"
                  onClick={onCreateChapter}
                  disabled={creating || !newChapterTitle.trim()}
                >
                  {creating ? '创建中...' : '创建'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

import { useState, useEffect } from 'react';
import type { Chapter, CreateChapterInput, UpdateChapterInput, ChapterStatus } from '../../types/chapter';
import type { Volume } from '../../types/volume';
import { ChapterStatusLabels } from '../../types/chapter';

interface ChapterFormModalProps {
  initial: Chapter | null;
  novelId: string;
  volumeId?: string;
  volumes: Volume[];
  onSave: (input: CreateChapterInput | UpdateChapterInput) => void;
  onClose: () => void;
}

function ChapterFormModal({ initial, volumeId: defaultVolumeId, volumes, onSave, onClose }: ChapterFormModalProps) {
  const [title, setTitle] = useState(initial?.title || '');
  const [volumeId, setVolumeId] = useState(initial?.volumeId || defaultVolumeId || '');
  const [outline, setOutline] = useState(initial?.outline || '');
  const [goal, setGoal] = useState(initial?.goal || '');
  const [targetWordCount, setTargetWordCount] = useState(initial?.targetWordCount || 0);
  const [status, setStatus] = useState<ChapterStatus>(initial?.status || 'not_started');
  const [error, setError] = useState('');

  useEffect(() => {
    if (initial) {
      setTitle(initial.title);
      setVolumeId(initial.volumeId || '');
      setOutline(initial.outline || '');
      setGoal(initial.goal || '');
      setTargetWordCount(initial.targetWordCount || 0);
      setStatus(initial.status);
    }
  }, [initial]);

  const handleSave = () => {
    if (!title.trim()) { setError('章节标题不能为空'); return; }
    if (title.trim().length > 80) { setError('章节标题不超过 80 字'); return; }
    if (targetWordCount > 0 && (targetWordCount < 500 || targetWordCount > 20000)) { setError('目标字数建议 500-20000'); return; }
    onSave({
      title: title.trim(),
      volumeId: volumeId || undefined,
      outline: outline.trim() || undefined,
      goal: goal.trim() || undefined,
      targetWordCount: targetWordCount > 0 ? targetWordCount : undefined,
      status,
    });
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-dialog" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 560 }}>
        <div className="modal-title">{initial ? '编辑章节' : '新建章节'}</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label className="panel-field-label">章节标题 *</label>
            <input type="text" value={title} onChange={(e) => setTitle(e.target.value)}
              className="form-input" placeholder="如：异乡醒来" style={{ width: '100%' }} autoFocus />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label className="panel-field-label">所属分卷</label>
              <select value={volumeId} onChange={(e) => setVolumeId(e.target.value)} className="panel-select">
                <option value="">无（独立章节）</option>
                {volumes.map((v) => (
                  <option key={v.id} value={v.id}>{v.title}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="panel-field-label">目标字数</label>
              <input type="number" value={targetWordCount} onChange={(e) => setTargetWordCount(Number(e.target.value))}
                className="form-input" min={500} max={20000} style={{ width: '100%' }} />
            </div>
          </div>
          <div>
            <label className="panel-field-label">章节大纲</label>
            <textarea value={outline} onChange={(e) => setOutline(e.target.value)}
              className="form-textarea" placeholder="描述本章的主要情节、场景和转折点..."
              style={{ width: '100%', height: 140, resize: 'vertical', fontSize: 14, lineHeight: 1.8 }} />
          </div>
          <div>
            <label className="panel-field-label">本章目标</label>
            <input type="text" value={goal} onChange={(e) => setGoal(e.target.value)}
              className="form-input" placeholder="本章要达成的创作目标" style={{ width: '100%' }} />
          </div>
          <div>
            <label className="panel-field-label">章节状态</label>
            <select value={status} onChange={(e) => setStatus(e.target.value as ChapterStatus)} className="panel-select">
              {Object.entries(ChapterStatusLabels).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </div>
          {error && <div style={{ fontSize: 13, color: 'var(--color-error)' }}>{error}</div>}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button className="btn btn-secondary" onClick={onClose}>取消</button>
            <button className="btn btn-primary" onClick={handleSave}>{initial ? '保存' : '创建章节'}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default ChapterFormModal;

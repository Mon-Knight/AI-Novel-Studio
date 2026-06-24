import { useState, useEffect } from 'react';
import type { Volume, CreateVolumeInput, UpdateVolumeInput, VolumeStatus } from '../../types/volume';

interface VolumeFormModalProps {
  initial: Volume | null;
  novelId: string;
  onSave: (input: CreateVolumeInput | UpdateVolumeInput) => void;
  onClose: () => void;
}

function VolumeFormModal({ initial, onSave, onClose }: VolumeFormModalProps) {
  const [title, setTitle] = useState(initial?.title || '');
  const [summary, setSummary] = useState(initial?.summary || '');
  const [goal, setGoal] = useState(initial?.goal || '');
  const [mainConflict, setMainConflict] = useState(initial?.mainConflict || '');
  const [status, setStatus] = useState<VolumeStatus>(initial?.status || 'planned');
  const [error, setError] = useState('');

  useEffect(() => {
    if (initial) {
      setTitle(initial.title);
      setSummary(initial.summary || '');
      setGoal(initial.goal || '');
      setMainConflict(initial.mainConflict || '');
      setStatus(initial.status || 'planned');
    }
  }, [initial]);

  const handleSave = () => {
    if (!title.trim()) { setError('分卷名称不能为空'); return; }
    if (title.trim().length > 50) { setError('分卷名称不超过 50 字'); return; }
    onSave({ title: title.trim(), summary: summary.trim() || undefined, goal: goal.trim() || undefined, mainConflict: mainConflict.trim() || undefined, status });
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-dialog" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 520 }}>
        <div className="modal-title">{initial ? '编辑分卷' : '新建分卷'}</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label className="panel-field-label">分卷名称 *</label>
            <input type="text" value={title} onChange={(e) => setTitle(e.target.value)}
              className="form-input" placeholder="如：第一卷：觉醒" style={{ width: '100%' }} autoFocus />
          </div>
          <div>
            <label className="panel-field-label">分卷简介</label>
            <textarea value={summary} onChange={(e) => setSummary(e.target.value)}
              className="form-textarea" placeholder="简要介绍本卷内容"
              style={{ width: '100%', height: 80, resize: 'vertical' }} />
          </div>
          <div>
            <label className="panel-field-label">分卷目标</label>
            <textarea value={goal} onChange={(e) => setGoal(e.target.value)}
              className="form-textarea" placeholder="本卷要达成的创作目标"
              style={{ width: '100%', height: 60, resize: 'vertical' }} />
          </div>
          <div>
            <label className="panel-field-label">主要矛盾</label>
            <input type="text" value={mainConflict} onChange={(e) => setMainConflict(e.target.value)}
              className="form-input" placeholder="本卷核心矛盾冲突" style={{ width: '100%' }} />
          </div>
          <div>
            <label className="panel-field-label">分卷状态</label>
            <select value={status} onChange={(e) => setStatus(e.target.value as VolumeStatus)} className="panel-select">
              <option value="planned">规划中</option>
              <option value="writing">创作中</option>
              <option value="completed">已完成</option>
            </select>
          </div>
          {error && <div style={{ fontSize: 13, color: 'var(--color-error)' }}>{error}</div>}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button className="btn btn-secondary" onClick={onClose}>取消</button>
            <button className="btn btn-primary" onClick={handleSave}>{initial ? '保存' : '创建分卷'}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default VolumeFormModal;

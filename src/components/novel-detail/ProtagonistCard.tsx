import { useEffect, useState } from 'react';
import type {
  Novel,
  ProtagonistProfile,
  DualProtagonistRelation,
  ProtagonistMode,
} from '../../types/novel';
import type { Protagonist } from '../../types/protagonist';
import {
  getDefaultDualProtagonistRelation,
  getDefaultProtagonistProfile,
  normalizeDualProtagonistRelation,
  normalizeProtagonistProfile,
} from '../../features/novels/novelNormalizer';
import { describeUnknownError } from '../../utils/errorMessage';
import DualProtagonistRelationFields from './DualProtagonistRelationFields';
import ProtagonistDisplay from './ProtagonistDisplay';
import ProtagonistFields from './ProtagonistFields';

interface ProtagonistCardProps {
  novelId: string;
  novel: Novel | null;
  protagonist: Protagonist | null;
  onSave: (data: {
    protagonistMode: ProtagonistMode;
    protagonists: ProtagonistProfile[];
    dualProtagonistRelation?: DualProtagonistRelation;
  }) => Promise<void>;
}

function ProtagonistCard({ novel, protagonist, onSave }: ProtagonistCardProps) {
  const [editing, setEditing] = useState(false);
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);

  // v1.0.28 双主角状态
  const [mode, setMode] = useState<'single' | 'dual'>(novel?.protagonistMode || 'single');
  const [protA, setProtA] = useState<ProtagonistProfile>(
    normalizeProtagonistProfile(novel?.protagonists?.[0], 'primary'),
  );
  const [protB, setProtB] = useState<ProtagonistProfile>(
    normalizeProtagonistProfile(novel?.protagonists?.[1], 'secondary'),
  );
  const [relation, setRelation] = useState<DualProtagonistRelation>(
    normalizeDualProtagonistRelation(novel?.dualProtagonistRelation),
  );

  useEffect(() => {
    setMode(novel?.protagonistMode || 'single');
    setProtA(normalizeProtagonistProfile(novel?.protagonists?.[0], 'primary'));
    setProtB(normalizeProtagonistProfile(novel?.protagonists?.[1], 'secondary'));
    setRelation(normalizeDualProtagonistRelation(novel?.dualProtagonistRelation));
  }, [novel]);

  // 旧数据兼容：从 protagonist 迁移到 novel.protagonists
  useEffect(() => {
    if (protagonist && (!novel?.protagonists || novel.protagonists.length === 0)) {
      setProtA({
        ...getDefaultProtagonistProfile('primary'),
        id: protagonist.id,
        label: 'primary',
        name: protagonist.name,
        identity: protagonist.identity ?? '',
        personality: protagonist.personality ?? '',
        goal: protagonist.goal ?? '',
        ability: protagonist.specialAbility ?? '',
        limitation: protagonist.abilityLimits ?? '',
        specialAbility: protagonist.specialAbility ?? '',
        abilityLimits: protagonist.abilityLimits ?? '',
        forbiddenBehaviors: protagonist.forbiddenBehaviors ?? '',
        notes: protagonist.currentState ?? '',
      });
    }
  }, [protagonist, novel]);

  const handleSave = async () => {
    setSaving(true);
    setMessage('');
    try {
      const primary = normalizeProtagonistProfile({ ...protA, label: 'primary' }, 'primary');
      const secondary = normalizeProtagonistProfile({ ...protB, label: 'secondary' }, 'secondary');
      const protagonists = mode === 'dual' ? [primary, secondary] : [primary];
      await onSave({
        protagonistMode: mode,
        protagonists,
        dualProtagonistRelation:
          mode === 'dual'
            ? normalizeDualProtagonistRelation(relation)
            : getDefaultDualProtagonistRelation(),
      });
      setMessage('保存成功');
      setEditing(false);
      setTimeout(() => setMessage(''), 2000);
    } catch (e: unknown) {
      setMessage('保存失败：' + describeUnknownError(e, '未知错误'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="detail-card">
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 12,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 18 }}>👤</span>
          <span style={{ fontSize: 16, fontWeight: 600 }}>主角设定</span>
        </div>
        {!editing && (
          <button className="btn btn-secondary btn-sm" onClick={() => setEditing(true)}>
            ✏️ 编辑
          </button>
        )}
      </div>

      {editing ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {/* 主角模式选择 */}
          <div>
            <label className="panel-field-label">主角模式</label>
            <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
              <button
                className={`btn btn-sm ${mode === 'single' ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setMode('single')}
              >
                👤 单主角
              </button>
              <button
                className={`btn btn-sm ${mode === 'dual' ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setMode('dual')}
              >
                👥 双主角
              </button>
            </div>
          </div>

          <ProtagonistFields profile={protA} onChange={setProtA} label="⭐ 主角A" />

          {mode === 'dual' && (
            <ProtagonistFields profile={protB} onChange={setProtB} label="🌟 主角B" />
          )}

          {mode === 'dual' && (
            <DualProtagonistRelationFields relation={relation} onChange={setRelation} />
          )}

          {message && (
            <div
              style={{
                fontSize: 13,
                color: message === '保存成功' ? 'var(--color-success)' : 'var(--color-error)',
              }}
            >
              {message}
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => {
                setEditing(false);
                setMessage('');
              }}
            >
              取消
            </button>
            <button className="btn btn-primary btn-sm" onClick={handleSave} disabled={saving}>
              {saving ? '保存中...' : '💾 保存'}
            </button>
          </div>
        </div>
      ) : (
        <ProtagonistDisplay novel={novel} />
      )}
    </div>
  );
}

export default ProtagonistCard;

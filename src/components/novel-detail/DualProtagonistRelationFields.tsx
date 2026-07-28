import type { DualProtagonistRelation } from '../../types/novel';
import { NARRATIVE_WEIGHT_LABELS, RELATION_TYPE_LABELS } from './protagonistPresentation';

interface DualProtagonistRelationFieldsProps {
  relation: DualProtagonistRelation;
  onChange(relation: DualProtagonistRelation): void;
}

export default function DualProtagonistRelationFields({
  relation,
  onChange,
}: DualProtagonistRelationFieldsProps) {
  const update = (patch: Partial<DualProtagonistRelation>) => onChange({ ...relation, ...patch });
  return (
    <div
      style={{
        border: '1px solid var(--color-border-light)',
        borderRadius: 8,
        padding: 12,
        marginBottom: 8,
        background: 'var(--color-bg-primary)',
      }}
    >
      <div
        style={{ fontSize: 14, fontWeight: 600, marginBottom: 10, color: 'var(--color-primary)' }}
      >
        🔗 双主角关系
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <div>
          <label className="panel-field-label">关系类型</label>
          <select
            className="panel-select"
            value={relation.type}
            onChange={(event) =>
              update({ type: event.target.value as DualProtagonistRelation['type'] })
            }
            style={{ width: '100%', fontSize: 13 }}
          >
            {Object.entries(RELATION_TYPE_LABELS).map(([key, value]) => (
              <option key={key} value={key}>
                {value}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="panel-field-label">叙事权重</label>
          <select
            className="panel-select"
            value={relation.narrativeWeight || 'balanced'}
            onChange={(event) =>
              update({
                narrativeWeight: event.target.value as DualProtagonistRelation['narrativeWeight'],
              })
            }
            style={{ width: '100%', fontSize: 13 }}
          >
            {Object.entries(NARRATIVE_WEIGHT_LABELS).map(([key, value]) => (
              <option key={key} value={key}>
                {value}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div style={{ marginTop: 8 }}>
        <label className="panel-field-label">关系说明</label>
        <textarea
          value={relation.description}
          onChange={(event) => update({ description: event.target.value })}
          className="form-textarea"
          placeholder="描述两位主角之间的关系..."
          rows={2}
          style={{ width: '100%', resize: 'vertical' }}
        />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 8 }}>
        <div>
          <label className="panel-field-label">核心冲突</label>
          <input
            type="text"
            value={relation.conflict || ''}
            onChange={(event) => update({ conflict: event.target.value })}
            className="form-input"
            placeholder="两人之间的主要冲突"
            style={{ width: '100%', fontSize: 13 }}
          />
        </div>
        <div>
          <label className="panel-field-label">合作方式</label>
          <input
            type="text"
            value={relation.cooperation || ''}
            onChange={(event) => update({ cooperation: event.target.value })}
            className="form-input"
            placeholder="合作模式"
            style={{ width: '100%', fontSize: 13 }}
          />
        </div>
      </div>
      <div style={{ marginTop: 8 }}>
        <label className="panel-field-label">关系推进</label>
        <input
          type="text"
          value={relation.emotionalProgression || ''}
          onChange={(event) => update({ emotionalProgression: event.target.value })}
          className="form-input"
          placeholder="关系发展路线"
          style={{ width: '100%', fontSize: 13 }}
        />
      </div>
    </div>
  );
}

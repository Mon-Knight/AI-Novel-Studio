import type { DualProtagonistRelation } from '../../types/novel';
import { Link2 } from 'lucide-react';
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
    <div className="detail-list-item detail-list-item--inset">
      <div className="detail-subsection-title detail-subsection-title--md">
        <Link2 aria-hidden="true" size={14} strokeWidth={1.8} />
        双主角关系
      </div>
      <div className="detail-form-grid detail-form-grid--tight">
        <div>
          <label className="panel-field-label">关系类型</label>
          <select
            className="panel-select detail-fill detail-text-sm"
            value={relation.type}
            onChange={(event) =>
              update({ type: event.target.value as DualProtagonistRelation['type'] })
            }
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
            className="panel-select detail-fill detail-text-sm"
            value={relation.narrativeWeight || 'balanced'}
            onChange={(event) =>
              update({
                narrativeWeight: event.target.value as DualProtagonistRelation['narrativeWeight'],
              })
            }
          >
            {Object.entries(NARRATIVE_WEIGHT_LABELS).map(([key, value]) => (
              <option key={key} value={key}>
                {value}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="detail-gap-top">
        <label className="panel-field-label">关系说明</label>
        <textarea
          value={relation.description}
          onChange={(event) => update({ description: event.target.value })}
          className="form-textarea detail-textarea"
          placeholder="描述两位主角之间的关系..."
          rows={2}
        />
      </div>
      <div className="detail-form-grid detail-form-grid--tight detail-form-grid--gap-top">
        <div>
          <label className="panel-field-label">核心冲突</label>
          <input
            type="text"
            value={relation.conflict || ''}
            onChange={(event) => update({ conflict: event.target.value })}
            className="form-input detail-fill detail-text-sm"
            placeholder="两人之间的主要冲突"
          />
        </div>
        <div>
          <label className="panel-field-label">合作方式</label>
          <input
            type="text"
            value={relation.cooperation || ''}
            onChange={(event) => update({ cooperation: event.target.value })}
            className="form-input detail-fill detail-text-sm"
            placeholder="合作模式"
          />
        </div>
      </div>
      <div className="detail-gap-top">
        <label className="panel-field-label">关系推进</label>
        <input
          type="text"
          value={relation.emotionalProgression || ''}
          onChange={(event) => update({ emotionalProgression: event.target.value })}
          className="form-input detail-fill detail-text-sm"
          placeholder="关系发展路线"
        />
      </div>
    </div>
  );
}

import type { ProtagonistProfile } from '../../types/novel';

interface ProtagonistFieldsProps {
  profile: ProtagonistProfile;
  label: string;
  onChange(profile: ProtagonistProfile): void;
}

export default function ProtagonistFields({ profile, label, onChange }: ProtagonistFieldsProps) {
  const update = (patch: Partial<ProtagonistProfile>) => onChange({ ...profile, ...patch });
  return (
    <div
      style={{
        border: '1px solid var(--color-border-light)',
        borderRadius: 8,
        padding: 12,
        marginBottom: 8,
      }}
    >
      <div
        style={{ fontSize: 14, fontWeight: 600, marginBottom: 10, color: 'var(--color-primary)' }}
      >
        {label}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <div>
          <label className="panel-field-label">姓名 *</label>
          <input
            type="text"
            value={profile.name}
            onChange={(event) => update({ name: event.target.value })}
            className="form-input"
            placeholder="姓名"
            style={{ width: '100%' }}
          />
        </div>
        <div>
          <label className="panel-field-label">性别</label>
          <input
            type="text"
            value={profile.gender || ''}
            onChange={(event) => update({ gender: event.target.value })}
            className="form-input"
            placeholder="男/女"
            style={{ width: '100%' }}
          />
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 8 }}>
        <div>
          <label className="panel-field-label">身份</label>
          <input
            type="text"
            value={profile.identity || ''}
            onChange={(event) => update({ identity: event.target.value })}
            className="form-input"
            placeholder="如：航天工程师"
            style={{ width: '100%' }}
          />
        </div>
        <div>
          <label className="panel-field-label">动机</label>
          <input
            type="text"
            value={profile.motivation || ''}
            onChange={(event) => update({ motivation: event.target.value })}
            className="form-input"
            placeholder="行为动机"
            style={{ width: '100%' }}
          />
        </div>
      </div>
      <div style={{ marginTop: 8 }}>
        <label className="panel-field-label">性格</label>
        <textarea
          value={profile.personality || ''}
          onChange={(event) => update({ personality: event.target.value })}
          className="form-textarea"
          placeholder="性格特点..."
          rows={2}
          style={{ width: '100%', resize: 'vertical' }}
        />
      </div>
      <div style={{ marginTop: 8 }}>
        <label className="panel-field-label">目标</label>
        <textarea
          value={profile.goal || ''}
          onChange={(event) => update({ goal: event.target.value })}
          className="form-textarea"
          placeholder="长期目标..."
          rows={2}
          style={{ width: '100%', resize: 'vertical' }}
        />
      </div>
      <div
        style={{ borderTop: '1px solid var(--color-border-light)', paddingTop: 8, marginTop: 8 }}
      >
        <div
          style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-primary)', marginBottom: 6 }}
        >
          ⚡ 能力与限制
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <div>
            <label className="panel-field-label">特殊能力</label>
            <textarea
              value={profile.specialAbility || profile.ability || ''}
              onChange={(event) =>
                update({ ability: event.target.value, specialAbility: event.target.value })
              }
              className="form-textarea"
              placeholder="特殊能力..."
              rows={2}
              style={{ width: '100%', resize: 'vertical', fontSize: 13 }}
            />
          </div>
          <div>
            <label className="panel-field-label">能力限制</label>
            <textarea
              value={profile.abilityLimits || profile.limitation || ''}
              onChange={(event) =>
                update({ limitation: event.target.value, abilityLimits: event.target.value })
              }
              className="form-textarea"
              placeholder="能力限制..."
              rows={2}
              style={{ width: '100%', resize: 'vertical', fontSize: 13 }}
            />
          </div>
        </div>
        <div style={{ marginTop: 8 }}>
          <label className="panel-field-label">禁止行为</label>
          <textarea
            value={profile.forbiddenBehaviors || ''}
            onChange={(event) => update({ forbiddenBehaviors: event.target.value })}
            className="form-textarea"
            placeholder="绝对不能做的行为..."
            rows={2}
            style={{ width: '100%', resize: 'vertical', fontSize: 13 }}
          />
        </div>
        <div style={{ marginTop: 8 }}>
          <label className="panel-field-label">背景经历</label>
          <textarea
            value={profile.background || ''}
            onChange={(event) => update({ background: event.target.value })}
            className="form-textarea"
            placeholder="人物背景..."
            rows={2}
            style={{ width: '100%', resize: 'vertical', fontSize: 13 }}
          />
        </div>
        <div style={{ marginTop: 8 }}>
          <label className="panel-field-label">人物成长线</label>
          <input
            type="text"
            value={profile.arc || ''}
            onChange={(event) => update({ arc: event.target.value })}
            className="form-input"
            placeholder="角色弧光/成长方向"
            style={{ width: '100%', fontSize: 13 }}
          />
        </div>
      </div>
    </div>
  );
}

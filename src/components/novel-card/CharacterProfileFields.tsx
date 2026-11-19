import { useId } from 'react';
import type { CharacterProfileValues } from '../../services/characters/characterProfile';

export const CHARACTER_TEXT_FIELDS = [
  { key: 'identity', label: '身份', placeholder: '角色身份' },
  { key: 'faction', label: '阵营', placeholder: '角色所属阵营' },
  { key: 'relationToProtagonist', label: '与主角关系', placeholder: '如：导师、战友' },
  { key: 'personality', label: '性格特征', placeholder: '简洁描述角色性格' },
  { key: 'goal', label: '目标', placeholder: '角色在故事中的目标' },
  { key: 'behaviorLimits', label: '行为限制（允许但不限制范围）', placeholder: '角色行为边界' },
  {
    key: 'forbiddenBehaviors',
    label: '禁止行为（绝对不能做的）',
    placeholder: '角色禁止做出的行为',
  },
] as const;

export function CharacterProfileFields({
  values,
  onChange,
  disabled,
  roleLocked,
}: {
  values: CharacterProfileValues;
  onChange: (patch: Partial<CharacterProfileValues>) => void;
  disabled?: boolean;
  roleLocked?: boolean;
}) {
  const id = useId();
  return (
    <div className="detail-form detail-form--compact">
      <div>
        <label className="detail-field-label" htmlFor={`${id}-name`}>
          角色名称 *
        </label>
        <input
          id={`${id}-name`}
          className="input detail-fill"
          value={values.name}
          onChange={(event) => onChange({ name: event.target.value })}
          placeholder="输入角色名"
          disabled={disabled}
        />
      </div>
      <div>
        <label className="detail-field-label" htmlFor={`${id}-role`}>
          角色类型
        </label>
        <select
          id={`${id}-role`}
          className="input detail-fill"
          value={values.roleType}
          onChange={(event) =>
            onChange({ roleType: event.target.value as CharacterProfileValues['roleType'] })
          }
          disabled={disabled || roleLocked}
        >
          <option value="">未分类</option>
          <option value="protagonist">主角</option>
          <option value="supporting">配角</option>
          <option value="antagonist">反派</option>
          <option value="neutral">中立</option>
        </select>
        {roleLocked && <p className="detail-card-desc">已绑定主角设定，角色类型由主角设定维护。</p>}
      </div>
      {CHARACTER_TEXT_FIELDS.map((field) => (
        <div key={field.key}>
          <label className="detail-field-label" htmlFor={`${id}-${field.key}`}>
            {field.label}
          </label>
          <textarea
            id={`${id}-${field.key}`}
            className="input detail-fill"
            value={values[field.key]}
            onChange={(event) => onChange({ [field.key]: event.target.value })}
            placeholder={field.placeholder}
            disabled={disabled}
            rows={2}
          />
        </div>
      ))}
    </div>
  );
}

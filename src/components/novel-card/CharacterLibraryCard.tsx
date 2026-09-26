/**
 * AI Novel Studio - 角色库管理卡片组件
 */
import { useState, useEffect, useCallback } from 'react';
import { CheckCircle2, Plus, UsersRound } from 'lucide-react';
import type { Character, CreateCharacterInput, CharacterRoleType } from '../../types/character';
import { CharacterRoleLabels } from '../../types/character';
import { characterService } from '../../services/characters/characterService';
import '../../styles/novel-detail.css';

interface CharacterLibraryCardProps {
  novelId: string;
}

type TextField =
  | 'identity'
  | 'faction'
  | 'relationToProtagonist'
  | 'personality'
  | 'goal'
  | 'behaviorLimits'
  | 'forbiddenBehaviors';

const TEXT_FIELDS: Array<{ key: TextField; label: string; placeholder: string }> = [
  { key: 'faction', label: '阵营', placeholder: '如：卡塞尔学院' },
  { key: 'relationToProtagonist', label: '与主角关系', placeholder: '如：导师、战友' },
  { key: 'personality', label: '性格特征', placeholder: '简洁描述角色性格' },
  { key: 'goal', label: '目标', placeholder: '角色在故事中的目标' },
  { key: 'behaviorLimits', label: '行为限制（允许但不限制范围）', placeholder: '角色行为上限' },
  {
    key: 'forbiddenBehaviors',
    label: '禁止行为（绝对不能做的）',
    placeholder: '角色禁止做出的行为',
  },
];

function CharacterLibraryCard({ novelId }: CharacterLibraryCardProps) {
  const [characters, setCharacters] = useState<Character[]>([]);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<CreateCharacterInput>({ novelId, name: '' });
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const list = await characterService.getByNovelId(novelId);
    setCharacters(list);
  }, [novelId]);

  useEffect(() => {
    load();
  }, [load]);

  const handleCreate = async () => {
    if (!form.name.trim()) return;
    const ch = await characterService.create(form);
    setCharacters((prev) => [...prev, ch]);
    setForm({ novelId, name: '' });
    setEditing(false);
  };

  const handleRemove = async (id: string) => {
    await characterService.remove(id);
    setCharacters((prev) => prev.filter((c) => c.id !== id));
  };

  return (
    <div className="detail-card">
      <div className="detail-card-header">
        <div className="detail-card-title">
          <UsersRound aria-hidden="true" size={18} strokeWidth={1.8} />
          <span>角色库（{characters.length}）</span>
        </div>
        <button className="btn btn-secondary btn-sm" onClick={() => setEditing(!editing)}>
          {editing ? (
            '取消'
          ) : (
            <>
              <Plus aria-hidden="true" size={14} strokeWidth={1.8} />
              添加角色
            </>
          )}
        </button>
      </div>

      {editing && (
        <div className="detail-list-item detail-list-item--inset">
          <div className="detail-form detail-form--compact">
            <div>
              <label className="detail-field-label">角色名称 *</label>
              <input
                className="input detail-fill"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="输入角色名"
              />
            </div>
            <div className="detail-form-grid detail-form-grid--tight">
              <div>
                <label className="detail-field-label">角色类型</label>
                <select
                  className="input detail-fill"
                  value={form.roleType || ''}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      roleType: (e.target.value || undefined) as CharacterRoleType | undefined,
                    })
                  }
                >
                  <option value="">未分类</option>
                  <option value="protagonist">主角</option>
                  <option value="supporting">配角</option>
                  <option value="antagonist">反派</option>
                  <option value="neutral">中立</option>
                </select>
              </div>
              <div>
                <label className="detail-field-label">身份</label>
                <input
                  className="input detail-fill"
                  value={form.identity || ''}
                  onChange={(e) => setForm({ ...form, identity: e.target.value })}
                  placeholder="如：航天工程师"
                />
              </div>
            </div>
            {TEXT_FIELDS.map((field) => (
              <div key={field.key}>
                <label className="detail-field-label">{field.label}</label>
                <input
                  className="input detail-fill"
                  value={form[field.key] || ''}
                  onChange={(e) => setForm({ ...form, [field.key]: e.target.value })}
                  placeholder={field.placeholder}
                />
              </div>
            ))}
            <button
              className="btn btn-primary btn-sm"
              onClick={handleCreate}
              disabled={!form.name.trim()}
            >
              <CheckCircle2 aria-hidden="true" size={14} strokeWidth={1.8} />
              确认创建
            </button>
          </div>
        </div>
      )}

      {characters.length === 0 ? (
        <div className="detail-card-desc detail-gap-top">
          暂无角色，点击上方按钮手动创建或在写作工作台通过 AI 生成
        </div>
      ) : (
        <div className="detail-list">
          {characters.map((char) => (
            <div
              key={char.id}
              className="detail-list-item detail-list-item--sm detail-character-row"
              onClick={() => setExpandedId(expandedId === char.id ? null : char.id)}
            >
              <div className="detail-list-item-header">
                <div className="detail-list-item-main">
                  <div className="detail-avatar">{char.name[0]}</div>
                  <div>
                    <div className="detail-character-name">{char.name}</div>
                    <div className="detail-character-meta">
                      {char.roleType ? CharacterRoleLabels[char.roleType] : '未分类'}
                      {char.identity ? ` · ${char.identity}` : ''}
                      {char.faction ? ` · ${char.faction}` : ''}
                    </div>
                  </div>
                </div>
                <button
                  className="btn btn-text btn-sm detail-text-error"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleRemove(char.id);
                  }}
                >
                  删除
                </button>
              </div>
              {expandedId === char.id && (
                <div className="detail-character-details">
                  {char.personality && <div>性格：{char.personality}</div>}
                  {char.goal && <div>目标：{char.goal}</div>}
                  {char.relationToProtagonist && (
                    <div>与主角关系：{char.relationToProtagonist}</div>
                  )}
                  {char.behaviorLimits && <div>行为限制：{char.behaviorLimits}</div>}
                  {char.forbiddenBehaviors && (
                    <div className="detail-text-error">禁止行为：{char.forbiddenBehaviors}</div>
                  )}
                  {char.currentState && <div>当前状态：{char.currentState}</div>}
                  <div className="detail-character-source">
                    来源：{char.source === 'manual' ? '手动创建' : 'AI 生成'}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default CharacterLibraryCard;

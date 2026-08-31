/**
 * AI Novel Studio - 角色库管理卡片组件
 */
import { useState, useEffect, useCallback } from 'react';
import { CheckCircle2, Plus, UsersRound } from 'lucide-react';
import type { Character, CreateCharacterInput, CharacterRoleType } from '../../types/character';
import { CharacterRoleLabels } from '../../types/character';
import { characterService } from '../../services/characters/characterService';

interface CharacterLibraryCardProps {
  novelId: string;
}

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
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <UsersRound aria-hidden="true" size={18} strokeWidth={1.8} />
          <span style={{ fontSize: 16, fontWeight: 600 }}>角色库（{characters.length}）</span>
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
        <div
          style={{
            marginTop: 12,
            padding: 12,
            background: 'var(--color-bg-primary)',
            borderRadius: 6,
            border: '1px solid var(--color-border-light)',
          }}
        >
          <div style={{ display: 'grid', gap: 8 }}>
            <div>
              <label style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>
                角色名称 *
              </label>
              <input
                className="input"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="输入角色名"
                style={{ width: '100%' }}
              />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <div>
                <label style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>
                  角色类型
                </label>
                <select
                  className="input"
                  value={form.roleType || ''}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      roleType: (e.target.value || undefined) as CharacterRoleType | undefined,
                    })
                  }
                  style={{ width: '100%' }}
                >
                  <option value="">未分类</option>
                  <option value="protagonist">主角</option>
                  <option value="supporting">配角</option>
                  <option value="antagonist">反派</option>
                  <option value="neutral">中立</option>
                </select>
              </div>
              <div>
                <label style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>身份</label>
                <input
                  className="input"
                  value={form.identity || ''}
                  onChange={(e) => setForm({ ...form, identity: e.target.value })}
                  placeholder="如：航天工程师"
                  style={{ width: '100%' }}
                />
              </div>
            </div>
            <div>
              <label style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>阵营</label>
              <input
                className="input"
                value={form.faction || ''}
                onChange={(e) => setForm({ ...form, faction: e.target.value })}
                placeholder="如：卡塞尔学院"
                style={{ width: '100%' }}
              />
            </div>
            <div>
              <label style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>
                与主角关系
              </label>
              <input
                className="input"
                value={form.relationToProtagonist || ''}
                onChange={(e) => setForm({ ...form, relationToProtagonist: e.target.value })}
                placeholder="如：导师、战友"
                style={{ width: '100%' }}
              />
            </div>
            <div>
              <label style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>性格特征</label>
              <input
                className="input"
                value={form.personality || ''}
                onChange={(e) => setForm({ ...form, personality: e.target.value })}
                placeholder="简洁描述角色性格"
                style={{ width: '100%' }}
              />
            </div>
            <div>
              <label style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>目标</label>
              <input
                className="input"
                value={form.goal || ''}
                onChange={(e) => setForm({ ...form, goal: e.target.value })}
                placeholder="角色在故事中的目标"
                style={{ width: '100%' }}
              />
            </div>
            <div>
              <label style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>
                行为限制（允许但不限制范围）
              </label>
              <input
                className="input"
                value={form.behaviorLimits || ''}
                onChange={(e) => setForm({ ...form, behaviorLimits: e.target.value })}
                placeholder="角色行为上限"
                style={{ width: '100%' }}
              />
            </div>
            <div>
              <label style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>
                禁止行为（绝对不能做的）
              </label>
              <input
                className="input"
                value={form.forbiddenBehaviors || ''}
                onChange={(e) => setForm({ ...form, forbiddenBehaviors: e.target.value })}
                placeholder="角色禁止做出的行为"
                style={{ width: '100%' }}
              />
            </div>
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
        <div className="detail-card-desc" style={{ marginTop: 8 }}>
          暂无角色，点击上方按钮手动创建或在写作工作台通过 AI 生成
        </div>
      ) : (
        <div style={{ marginTop: 12, display: 'grid', gap: 8 }}>
          {characters.map((char) => (
            <div
              key={char.id}
              style={{
                padding: 10,
                border: '1px solid var(--color-border-light)',
                borderRadius: 6,
                cursor: 'pointer',
              }}
              onClick={() => setExpandedId(expandedId === char.id ? null : char.id)}
            >
              <div
                style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: 16,
                      background: 'var(--color-primary)',
                      color: 'var(--color-on-primary)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontWeight: 600,
                      fontSize: 13,
                    }}
                  >
                    {char.name[0]}
                  </div>
                  <div>
                    <div style={{ fontWeight: 500, fontSize: 14 }}>{char.name}</div>
                    <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
                      {char.roleType ? CharacterRoleLabels[char.roleType] : '未分类'}
                      {char.identity ? ` · ${char.identity}` : ''}
                      {char.faction ? ` · ${char.faction}` : ''}
                    </div>
                  </div>
                </div>
                <button
                  className="btn btn-text btn-sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleRemove(char.id);
                  }}
                  style={{ color: 'var(--color-error)' }}
                >
                  删除
                </button>
              </div>
              {expandedId === char.id && (
                <div
                  style={{
                    marginTop: 8,
                    fontSize: 12,
                    color: 'var(--color-text-secondary)',
                    paddingLeft: 40,
                  }}
                >
                  {char.personality && <div>性格：{char.personality}</div>}
                  {char.goal && <div>目标：{char.goal}</div>}
                  {char.relationToProtagonist && (
                    <div>与主角关系：{char.relationToProtagonist}</div>
                  )}
                  {char.behaviorLimits && <div>行为限制：{char.behaviorLimits}</div>}
                  {char.forbiddenBehaviors && (
                    <div style={{ color: 'var(--color-error)' }}>
                      禁止行为：{char.forbiddenBehaviors}
                    </div>
                  )}
                  {char.currentState && <div>当前状态：{char.currentState}</div>}
                  <div style={{ marginTop: 4, color: 'var(--color-text-muted)' }}>
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

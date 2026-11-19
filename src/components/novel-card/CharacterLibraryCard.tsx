/**
 * AI Novel Studio - 角色库管理卡片组件
 */
import { useState, useEffect, useCallback } from 'react';
import { CheckCircle2, Plus, UsersRound } from 'lucide-react';
import type { Character, CreateCharacterInput } from '../../types/character';
import { CharacterRoleLabels } from '../../types/character';
import { characterService } from '../../services/characters/characterService';
import { characterProfileValues } from '../../services/characters/characterProfile';
import { useCharacterProfileEditor } from '../../features/characters/useCharacterProfileEditor';
import { CharacterProfileFields } from './CharacterProfileFields';
import { CharacterProfileEditor } from './CharacterProfileEditor';
import '../../styles/novel-detail.css';

interface CharacterLibraryCardProps {
  novelId: string;
}

function CharacterLibraryCard({ novelId }: CharacterLibraryCardProps) {
  const [characters, setCharacters] = useState<Character[]>([]);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<CreateCharacterInput>({ novelId, name: '' });
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const profileEditor = useCharacterProfileEditor(novelId, (saved) => {
    setCharacters((current) =>
      current.map((character) => (character.id === saved.id ? saved : character)),
    );
  });

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
      <CharacterProfileEditor editor={profileEditor} />
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
            <CharacterProfileFields
              values={characterProfileValues(form)}
              onChange={(patch) =>
                setForm({
                  ...form,
                  ...patch,
                  roleType: patch.roleType === '' ? undefined : (patch.roleType ?? form.roleType),
                })
              }
            />
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
                  type="button"
                  className="btn btn-secondary btn-sm"
                  aria-label={`编辑角色 ${char.name}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    profileEditor.begin(char);
                  }}
                >
                  编辑角色
                </button>
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

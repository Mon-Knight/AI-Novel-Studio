import { useState, useEffect, useCallback } from 'react';
import type { Chapter } from '../../../types/chapter';
import type { Character, ChapterCharacter, CharacterCandidate, ChapterCharacterRole } from '../../../types/character';
import { CharacterRoleLabels, ChapterCharacterRoleLabels } from '../../../types/character';
import { characterService } from '../../../services/characters/characterService';
import { chapterCharacterService } from '../../../services/characters/chapterCharacterService';
import { characterGenerateService } from '../../../services/ai/characterGenerateService';

interface CharactersPanelProps {
  novelId?: string;
  chapter?: Chapter;
  onGenerated?: (draft: any) => void;
  onAdopted?: () => void;
}

function CharactersPanel({ novelId, chapter, onGenerated, onAdopted }: CharactersPanelProps) {
  const [characters, setCharacters] = useState<Character[]>([]);
  const [chapterChars, setChapterChars] = useState<ChapterCharacter[]>([]);
  const [candidates, setCandidates] = useState<CharacterCandidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!novelId) return;
    const [all, cc] = await Promise.all([
      characterService.getByNovelId(novelId),
      chapterCharacterService.getByChapterId(chapter?.id || ''),
    ]);
    setCharacters(all);
    setChapterChars(cc);
  }, [novelId, chapter?.id]);

  useEffect(() => { load(); }, [load]);

  const handleGenerateCandidates = async () => {
    if (!novelId || !chapter) return;
    setLoading(true); setError('');
    try {
      const list = await characterGenerateService.generateCandidates({
        novelId, chapterId: chapter.id,
        chapterOutline: chapter.title,
        existingCharacters: characters,
      });
      setCandidates(list);
    } catch (e: any) { setError(e.message || '生成失败'); }
    finally { setLoading(false); }
  };

  const handleConfirmCandidate = async (candidate: CharacterCandidate) => {
    if (!novelId) return;
    const ch = await characterService.create({
      novelId, name: candidate.name,
      roleType: candidate.roleType as any, identity: candidate.identity,
      faction: candidate.faction, relationToProtagonist: candidate.relationToProtagonist,
      goal: candidate.goal, personality: candidate.personality,
      behaviorLimits: candidate.behaviorLimits, forbiddenBehaviors: candidate.forbiddenBehaviors,
      currentState: candidate.currentState,
    });
    setCharacters((prev) => [...prev, ch]);
    setCandidates((prev) => prev.filter((c) => c.name !== candidate.name));
  };

  const handleAddToChapter = async (characterId: string, characterName: string, roleInChapter: ChapterCharacterRole) => {
    if (!novelId || !chapter?.id) return;
    const cc = await chapterCharacterService.add({
      novelId, chapterId: chapter.id, characterId, characterName, roleInChapter, mustAppear: true,
    });
    setChapterChars((prev) => [...prev, cc]);
  };

  const handleRemoveFromChapter = async (ccId: string) => {
    await chapterCharacterService.remove(ccId);
    setChapterChars((prev) => prev.filter((c) => c.id !== ccId));
  };

  if (!novelId) return <div style={{ padding: 16, color: 'var(--color-text-muted)' }}>请先选择作品</div>;

  return (
    <div>
      {/* 本章出场角色 */}
      <div className="panel-section">
        <div className="panel-section-title">📌 本章出场角色</div>
        {chapterChars.length === 0 && (
          <div style={{ fontSize: 12, color: 'var(--color-text-muted)', padding: '8px 0' }}>尚未添加本章出场角色</div>
        )}
        {chapterChars.map((cc) => {
          const char = characters.find((c) => c.id === cc.characterId);
          return (
            <div key={cc.id} className="character-item">
              <div className="character-avatar">{(char?.name || '?')[0]}</div>
              <div className="character-info">
                <div className="character-name">{char?.name || cc.characterName || '未知'}</div>
                <div className="character-role">
                  {ChapterCharacterRoleLabels[cc.roleInChapter]}
                  {cc.mustAppear && ' · 必须出场'}
                  {cc.note && ` · ${cc.note}`}
                </div>
              </div>
              <button className="btn btn-text btn-sm" onClick={() => handleRemoveFromChapter(cc.id)}>移除</button>
            </div>
          );
        })}
      </div>

      {/* 角色库 */}
      <div className="panel-section">
        <div className="panel-section-title">📚 角色库（{characters.length}）</div>
        {characters.filter((c) => !chapterChars.some((cc) => cc.characterId === c.id)).map((char) => (
          <div key={char.id} className="character-item">
            <div className="character-avatar">{char.name[0]}</div>
            <div className="character-info">
              <div className="character-name">{char.name}</div>
              <div className="character-role">
                {char.roleType ? CharacterRoleLabels[char.roleType] : '未分类'}
                {char.identity ? ` · ${char.identity}` : ''}
              </div>
            </div>
            <button className="btn btn-secondary btn-sm" onClick={() => handleAddToChapter(char.id, char.name, 'supporting')}>
              ➕ 添加
            </button>
          </div>
        ))}
        {characters.length === 0 && (
          <div style={{ fontSize: 12, color: 'var(--color-text-muted)', padding: '8px 0' }}>暂无角色，可 AI 生成候选</div>
        )}
      </div>

      {/* AI 候选角色 */}
      <div className="panel-section">
        <div className="panel-section-title">🤖 AI 推荐候选角色</div>
        <button
          className="btn btn-primary btn-sm"
          onClick={handleGenerateCandidates}
          disabled={loading || !chapter}
          style={{ marginBottom: 8, width: '100%' }}
        >
          {loading ? '⏳  生成中...' : '✨ 生成本章候选角色'}
        </button>
        {error && <div style={{ fontSize: 12, color: 'var(--color-error)', marginBottom: 8 }}>{error}</div>}
        {candidates.map((candidate, i) => (
          <div key={i} className="character-item" style={{ borderColor: 'var(--color-primary-light)' }}>
            <div className="character-avatar" style={{ background: 'var(--color-primary)', color: '#fff' }}>{candidate.name[0]}</div>
            <div className="character-info">
              <div className="character-name">{candidate.name}</div>
              <div className="character-role">
                {candidate.roleType ? CharacterRoleLabels[candidate.roleType as keyof typeof CharacterRoleLabels] || candidate.roleType : '未知'}
                {candidate.identity ? ` · ${candidate.identity}` : ''}
              </div>
              {candidate.goal && <div style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>目标：{candidate.goal}</div>}
              {candidate.chapterFunction && <div style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>本章作用：{candidate.chapterFunction}</div>}
            </div>
            <button
              className="btn btn-primary btn-sm"
              onClick={() => handleConfirmCandidate(candidate)}
              disabled={characters.some((c) => c.name === candidate.name)}
            >
              ✅ 确认入库
            </button>
          </div>
        ))}
        {candidates.length === 0 && !loading && (
          <div style={{ fontSize: 12, color: 'var(--color-text-muted)', padding: '8px 0' }}>
            点击上方按钮，AI 将根据章节大纲推荐适合本章出场的角色
          </div>
        )}
        <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 8 }}>
          ⚠️ AI 候选角色需确认后才加入角色库，不会自动入库
        </div>
      </div>
    </div>
  );
}

export default CharactersPanel;

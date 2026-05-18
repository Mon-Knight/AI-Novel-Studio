import { useState, useEffect, useCallback } from 'react';
import type { Chapter } from '../../../types/chapter';
import type { Character, ChapterCharacter, CharacterCandidate, ChapterCharacterRole } from '../../../types/character';
import { CharacterRoleLabels, ChapterCharacterRoleLabels } from '../../../types/character';
import { characterService } from '../../../services/characters/characterService';
import { chapterCharacterService } from '../../../services/characters/chapterCharacterService';
import { characterGenerateService } from '../../../services/ai/characterGenerateService';
import { aiSettingsService } from '../../../services/ai/aiClient';
import { runWithLoading } from '../../../lib/runWithLoading';

interface CharactersPanelProps {
  novelId?: string;
  chapter?: Chapter;
  onGenerated?: (draft: any) => void;
  onAdopted?: () => void;
  onChapterCharactersChanged?: () => void;
}

function CharactersPanel({ novelId, chapter, onChapterCharactersChanged }: CharactersPanelProps) {
  const [characters, setCharacters] = useState<Character[]>([]);
  const [chapterChars, setChapterChars] = useState<ChapterCharacter[]>([]);
  const [candidates, setCandidates] = useState<CharacterCandidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [protagonists, setProtagonists] = useState<Character[]>([]);

  // 加载角色库 & 同步主角
  const load = useCallback(async () => {
    if (!novelId) return;
    let syncedProtagonists: Character[] = [];
    try {
      // 1. 同步所有主角从 protagonists/novels 表 → characters 表
      setSyncing(true);
      await runWithLoading({
        title: '正在同步主角信息',
        initialMessage: '正在读取作品主角档案并同步到角色库……',
        successMessage: '主角信息同步完成',
        errorMessage: '主角信息同步失败',
      }, async ({ setStage }) => {
        setStage('正在写入角色库……');
        syncedProtagonists = await characterService.syncProtagonists(novelId);
      });
      setProtagonists(syncedProtagonists);
      setSyncing(false);
    } catch (e: any) {
      console.warn('[CharactersPanel] 主角同步失败:', e.message);
      setError(`主角同步失败：${e.message || '未知错误'}`);
      setSyncing(false);
    }

    try {
      // 2. 加载所有角色 & 本章出场角色
      const [all, cc] = await Promise.all([
        characterService.getByNovelId(novelId),
        chapterCharacterService.getByChapterId(chapter?.id || ''),
      ]);
      setCharacters(all);
      setChapterChars(cc);

      // 从已加载的角色中补充主角（确保 protagonistKey 等字段完整）
      const loadedProtagonists = all.filter((c) => c.isProtagonist || c.roleType === 'protagonist');
      if (loadedProtagonists.length > 0 && syncedProtagonists.length === 0) {
        setProtagonists(loadedProtagonists);
      } else if (syncedProtagonists.length > 0) {
        setProtagonists(syncedProtagonists);
      }
    } catch (e: any) {
      console.error('[CharactersPanel] 加载角色失败:', e.message);
    }
  }, [novelId, chapter?.id]);

  useEffect(() => { load(); }, [load]);

  const handleGenerateCandidates = async () => {
    if (!novelId || !chapter) return;
    setLoading(true); setError('');
    try {
      const list = await characterGenerateService.generateCandidates({
        novelId, chapterId: chapter.id,
        chapterTitle: chapter.title,
        chapterOutline: chapter.outline || chapter.goal || chapter.title,
        existingCharacters: characters,
      });
      // 过滤掉与主角同名的候选角色
      const filtered = list.filter((c) => {
        const isDuplicate = characters.some(
          (existing) => existing.name === c.name && existing.roleType === 'protagonist'
        );
        return !isDuplicate;
      });
      setCandidates(filtered);
    } catch (e: any) { setError(e.message || '生成失败'); }
    finally { setLoading(false); }
  };

  const handleConfirmCandidate = async (candidate: CharacterCandidate) => {
    if (!novelId) return;
    // 防止主角重复入库（检查所有主角）
    const isDuplicateName = protagonists.some((p) => p.name === candidate.name);
    if (isDuplicateName) {
      setError('该角色与已有主角同名，已跳过入库');
      setCandidates((prev) => prev.filter((c) => c.name !== candidate.name));
      return;
    }
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

  const isProtagonistCharacter = useCallback((char?: Character | null) => {
    return !!char && (char.isProtagonist || char.roleType === 'protagonist');
  }, []);

  const upsertChapterCharacterState = useCallback((item: ChapterCharacter) => {
    setChapterChars((prev) => {
      const existing = prev.find((cc) => cc.characterId === item.characterId);
      if (existing) return prev.map((cc) => (cc.characterId === item.characterId ? item : cc));
      return [...prev, item];
    });
  }, []);

  const handleAddToChapter = async (characterId: string, characterName: string, roleInChapter: ChapterCharacterRole) => {
    if (!novelId || !chapter?.id) return;
    // 检查是否已在章节中
    if (chapterChars.some((cc) => cc.characterId === characterId)) {
      setNotice('该角色已在本章出场列表中');
      setError('');
      return;
    }
    const char = characters.find((item) => item.id === characterId);
    const isProtagonist = isProtagonistCharacter(char);
    setActionBusy(true);
    try {
      const cc = await runWithLoading({
        title: isProtagonist ? '正在添加主角到本章出场角色' : '正在添加本章出场角色',
        initialMessage: isProtagonist ? '正在写入主角本章出场状态……' : '正在写入章节角色关联……',
        successMessage: isProtagonist ? '主角已加入本章出场角色' : '角色已加入本章',
        errorMessage: isProtagonist ? '主角加入本章失败' : '角色加入本章失败',
      }, async ({ setStage }) => {
        setStage('正在保存章节角色……');
        return chapterCharacterService.add({
          novelId,
          chapterId: chapter.id,
          characterId,
          characterName,
          roleInChapter: isProtagonist ? 'main' : roleInChapter,
          mustAppear: true,
          note: isProtagonist ? '主角本章出场' : undefined,
        });
      });
      upsertChapterCharacterState(cc);
      setNotice(isProtagonist ? '主角已加入本章出场角色' : '角色已加入本章');
      setError('');
      onChapterCharactersChanged?.();
    } catch (e: any) {
      setError(e?.message || '添加本章出场角色失败');
    } finally {
      setActionBusy(false);
    }
  };

  const handleRemoveFromChapter = async (cc: ChapterCharacter) => {
    const char = characters.find((c) => c.id === cc.characterId);
    const isProtagonist = isProtagonistCharacter(char);
    setActionBusy(true);
    try {
      await runWithLoading({
        title: isProtagonist ? '正在设置主角本章不出场' : '正在移除本章出场角色',
        initialMessage: isProtagonist ? '正在更新主角本章出场状态……' : '正在更新章节角色列表……',
        successMessage: isProtagonist ? '已设置主角本章不出场' : '已移除本章出场角色',
        errorMessage: isProtagonist ? '设置主角本章出场状态失败' : '移除本章出场角色失败',
      }, async ({ setStage }) => {
        setStage('正在保存章节角色……');
        await chapterCharacterService.remove(cc);
      });
      setChapterChars((prev) => prev.filter((c) => c.id !== cc.id));
      setNotice(isProtagonist ? '已设置主角本章不出场' : '已移除本章出场角色');
      setError('');
      onChapterCharactersChanged?.();
    } catch (e: any) {
      setError(e?.message || '移除本章出场角色失败');
    } finally {
      setActionBusy(false);
    }
  };

  const handleSetProtagonistAppearance = async (protag: Character, appear: boolean) => {
    if (!novelId || !chapter?.id) return;
    const existing = chapterChars.find((cc) => cc.characterId === protag.id);
    if (appear && existing) {
      setNotice(`${protag.name} 已在本章出场角色中`);
      setError('');
      return;
    }
    if (!appear && !existing) {
      setNotice(`${protag.name} 已设置为本章不出场`);
      setError('');
      return;
    }

    if (appear) {
      await handleAddToChapter(protag.id, protag.name, 'main');
    } else if (existing) {
      await handleRemoveFromChapter(existing);
    }
  };

  if (!novelId) return <div style={{ padding: 16, color: 'var(--color-text-muted)' }}>请先选择作品</div>;

  const aiSettings = aiSettingsService.getSettings();

  // 判断角色是否已在章节中
  const isInChapter = (charId: string) => chapterChars.some((cc) => cc.characterId === charId);

  // 角色库中未加入本章的角色（按主角优先排列）
  const availableChars = characters
    .filter((c) => !isInChapter(c.id))
    .sort((a, b) => Number(isProtagonistCharacter(b)) - Number(isProtagonistCharacter(a)));

  // 判断主角是否在本章出场
  const isProtagonistInChapter = (protag: Character) =>
    chapterChars.some((cc) => cc.characterId === protag.id);

  return (
    <div>
      {/* AI 模式状态 */}
      <div className="panel-section" style={{ fontSize: 12, lineHeight: 1.8 }}>
        <div className="panel-section-title">🤖 AI 状态</div>
        <div>模式：{aiSettings.runtimeMode === 'mock' ? '🔶 Mock 模式' : '🔷 真实 API'}</div>
        {aiSettings.runtimeMode === 'api' && (
          <>
            <div>模型：{aiSettings.modelName || '未配置'}</div>
            {!aiSettings.apiKey && (
              <div style={{ color: 'var(--color-error)', marginTop: 4 }}>⚠️ 未配置 API Key，请先到设置中心配置</div>
            )}
          </>
        )}
        {syncing && (
          <div style={{ color: 'var(--color-text-muted)', marginTop: 4 }}>⏳ 正在同步主角信息...</div>
        )}
        {protagonists.length > 0 && !syncing && (
          <div style={{ color: 'var(--color-primary)', marginTop: 4 }}>
            ⭐ 已同步主角：{protagonists.map((p) => p.name).join('、')}
          </div>
        )}
        {protagonists.length === 0 && !syncing && (
          <div style={{ color: 'var(--color-warning)', marginTop: 4 }}>
            ⚠️ 未检测到主角信息，请先在作品详情中完善主角设定
          </div>
        )}
        {notice && <div style={{ color: 'var(--color-success)', marginTop: 4 }}>{notice}</div>}
        {error && <div style={{ color: 'var(--color-error)', marginTop: 4 }}>{error}</div>}
      </div>

      {/* 主角快捷项 */}
      <div className="panel-section">
        <div className="panel-section-title">⭐ 主角快捷项{protagonists.length > 1 ? `（${protagonists.length}）` : ''}</div>
        {protagonists.length > 0 ? (
          protagonists.map((protag) => {
            const protagChapterChar = chapterChars.find((cc) => cc.characterId === protag.id);
            return (
              <div key={protag.id} className="character-item" style={{ borderColor: 'var(--color-primary)', borderWidth: 1, background: 'rgba(99, 102, 241, 0.04)' }}>
                <div className="character-avatar" style={{ background: 'var(--color-primary)', color: '#fff', fontWeight: 'bold' }}>
                  ⭐
                </div>
                <div className="character-info" style={{ flex: 1 }}>
                  <div className="character-name">
                    {protag.name}
                    <span style={{ color: 'var(--color-primary)', fontSize: 11, marginLeft: 4, fontWeight: 'bold' }}>
                      {protag.protagonistLabel || '主角'}
                    </span>
                  </div>
                  <div className="character-role">
                    {protag.identity || '作品主角'}
                    {protagChapterChar?.mustAppear ? ' · 本章必须出场' : protagChapterChar ? ' · 本章出场' : ' · 本章不出场'}
                  </div>
                  {protag.goal && (
                    <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', marginTop: 2 }}>目标：{protag.goal}</div>
                  )}
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, marginTop: 6, color: 'var(--color-text-secondary)' }}>
                    <input
                      type="checkbox"
                      checked={!!protagChapterChar}
                      disabled={!chapter?.id || actionBusy}
                      onChange={(e) => handleSetProtagonistAppearance(protag, e.target.checked)}
                    />
                    {protag.name}本章出场
                  </label>
                </div>
                <button
                  className="btn btn-sm"
                  style={{ background: protagChapterChar ? 'var(--color-bg-secondary)' : 'var(--color-primary)', color: protagChapterChar ? 'var(--color-text-secondary)' : '#fff', border: 'none', whiteSpace: 'nowrap' }}
                  onClick={() => handleSetProtagonistAppearance(protag, !protagChapterChar)}
                  disabled={!chapter?.id || actionBusy}
                  title={!chapter?.id ? '请先选择章节' : protagChapterChar ? `设置${protag.name}本章不出场` : `将${protag.name}加入本章`}
                >
                  {protagChapterChar ? '本章不出场' : '加入本章'}
                </button>
              </div>
            );
          })
        ) : (
          <div style={{ fontSize: 12, color: 'var(--color-warning)', padding: '8px 0', lineHeight: 1.6 }}>
            尚未设置主角，请先在作品详情中完善主角信息。
          </div>
        )}
      </div>

      {/* 本章出场角色 */}
      <div className="panel-section">
        <div className="panel-section-title">📌 本章出场角色</div>
        {chapterChars.length === 0 && (
          <div style={{ fontSize: 12, color: 'var(--color-text-muted)', padding: '8px 0' }}>尚未添加本章出场角色</div>
        )}
        {chapterChars.map((cc) => {
          const char = characters.find((c) => c.id === cc.characterId);
          const isProtagonist = isProtagonistCharacter(char);
          return (
            <div key={cc.id} className="character-item" style={isProtagonist ? { borderColor: 'var(--color-primary)', borderWidth: 2 } : undefined}>
              <div
                className="character-avatar"
                style={isProtagonist ? { background: 'var(--color-primary)', color: '#fff', fontWeight: 'bold' } : undefined}
              >
                {isProtagonist ? '⭐' : (char?.name || cc.characterName || '?')[0]}
              </div>
              <div className="character-info">
                <div className="character-name">
                  {char?.name || cc.characterName || '未知'}
                  {isProtagonist && <span style={{ color: 'var(--color-primary)', fontSize: 11, marginLeft: 4 }}>主角</span>}
                </div>
                <div className="character-role">
                  {ChapterCharacterRoleLabels[cc.roleInChapter]}
                  {cc.mustAppear && ' · 必须出场'}
                  {cc.note && ` · ${cc.note}`}
                </div>
              </div>
              <button className="btn btn-text btn-sm" onClick={() => handleRemoveFromChapter(cc)} disabled={actionBusy}>移除</button>
            </div>
          );
        })}
      </div>

      {/* 角色库 */}
      <div className="panel-section">
        <div className="panel-section-title">📚 角色库（{characters.length}）</div>
        {availableChars.length === 0 && characters.length === 0 && (
          <div style={{ fontSize: 12, color: 'var(--color-text-muted)', padding: '8px 0' }}>暂无角色，可 AI 生成候选</div>
        )}
        {availableChars.length === 0 && characters.length > 0 && (
          <div style={{ fontSize: 12, color: 'var(--color-text-muted)', padding: '8px 0' }}>所有角色已加入本章</div>
        )}
        {availableChars.map((char) => {
          const isProtagonist = isProtagonistCharacter(char);
          return (
            <div key={char.id} className="character-item" style={isProtagonist ? { borderColor: 'var(--color-primary)', borderWidth: 1, background: 'rgba(99, 102, 241, 0.03)' } : undefined}>
              <div
                className="character-avatar"
                style={isProtagonist ? { background: 'var(--color-primary)', color: '#fff', fontWeight: 'bold' } : undefined}
              >
                {isProtagonist ? '⭐' : char.name[0]}
              </div>
              <div className="character-info" style={{ flex: 1 }}>
                <div className="character-name">
                  {char.name}
                  {isProtagonist && <span style={{ color: 'var(--color-primary)', fontSize: 11, marginLeft: 4, fontWeight: 'bold' }}>主角</span>}
                </div>
                <div className="character-role">
                  {char.roleType ? CharacterRoleLabels[char.roleType] : '未分类'}
                  {char.identity ? ` · ${char.identity}` : ''}
                </div>
                {isProtagonist && char.goal && (
                  <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', marginTop: 2 }}>目标：{char.goal}</div>
                )}
                {isProtagonist && char.personality && (
                  <div style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>性格：{char.personality.length > 40 ? char.personality.slice(0, 40) + '...' : char.personality}</div>
                )}
                {isProtagonist && char.behaviorLimits && (
                  <div style={{ fontSize: 11, color: 'var(--color-warning)' }}>限制：{char.behaviorLimits.length > 30 ? char.behaviorLimits.slice(0, 30) + '...' : char.behaviorLimits}</div>
                )}
              </div>
              <button
                className="btn btn-sm"
                style={isProtagonist ? { background: 'var(--color-primary)', color: '#fff', border: 'none', whiteSpace: 'nowrap' } : { whiteSpace: 'nowrap' }}
                onClick={() => handleAddToChapter(char.id, char.name, isProtagonist ? 'main' : 'supporting')}
                disabled={!chapter?.id || actionBusy}
                title={!chapter?.id ? '请先选择章节' : (isProtagonist ? '将主角加入本章' : '加入本章')}
              >
                {isProtagonist ? '⭐ 加入本章' : '➕ 添加'}
              </button>
            </div>
          );
        })}
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
              {candidate.rawText && <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', whiteSpace: 'pre-wrap', marginTop: 4 }}>{candidate.rawText}</div>}
            </div>
            {!candidate.rawText && (
              <button
                className="btn btn-primary btn-sm"
                onClick={() => handleConfirmCandidate(candidate)}
                disabled={characters.some((c) => c.name === candidate.name)}
              >
                ✅ 确认入库
              </button>
            )}
          </div>
        ))}
        {candidates.length === 0 && !loading && (
          <div style={{ fontSize: 12, color: 'var(--color-text-muted)', padding: '8px 0' }}>
            点击上方按钮，AI 将根据章节大纲推荐适合本章出场的角色
          </div>
        )}
        <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 8 }}>
          ⚠️ AI 候选角色需确认后才加入角色库，不会自动入库。已有主角不会被重复推荐。
        </div>
      </div>
    </div>
  );
}

export default CharactersPanel;

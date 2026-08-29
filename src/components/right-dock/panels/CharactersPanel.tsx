import { appLogger } from '../../../services/observability/appLogger';
import { useState, useEffect, useCallback, useRef } from 'react';
import type { Chapter } from '../../../types/chapter';
import type { ChapterDraft } from '../../../types/ai';
import type {
  Character,
  ChapterCharacter,
  CharacterCandidate,
  ChapterCharacterRole,
} from '../../../types/character';
import { characterService } from '../../../services/characters/characterService';
import { chapterCharacterService } from '../../../services/characters/chapterCharacterService';
import { characterGenerateService } from '../../../services/ai/characterGenerateService';
import { aiSettingsService } from '../../../services/ai/aiClient';
import { runWithLoading } from '../../../lib/runWithLoading';
import { describeUnknownError } from '../../../utils/errorMessage';
import {
  isAiRequestCancelled,
  throwIfAiRequestCancelled,
} from '../../../services/ai/aiCancellation';
import { CharactersPanelView } from './CharactersPanelView';

interface CharactersPanelProps {
  novelId?: string;
  chapter?: Chapter;
  onGenerated?: (draft: ChapterDraft) => void;
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
  const candidateAbortRef = useRef<AbortController | null>(null);

  // 加载角色库 & 同步主角
  const load = useCallback(async () => {
    if (!novelId) return;
    let syncedProtagonists: Character[] = [];
    try {
      // 1. 同步所有主角从 protagonists/novels 表 → characters 表
      setSyncing(true);
      await runWithLoading(
        {
          title: '正在同步主角信息',
          initialMessage: '正在读取作品主角档案并同步到角色库……',
          successMessage: '主角信息同步完成',
          errorMessage: '主角信息同步失败',
        },
        async ({ setStage }) => {
          setStage('正在写入角色库……');
          syncedProtagonists = await characterService.syncProtagonists(novelId);
        },
      );
      setProtagonists(syncedProtagonists);
      setSyncing(false);
    } catch (e: unknown) {
      const message = describeUnknownError(e, '未知错误');
      appLogger.warn('[CharactersPanel] 主角同步失败:', message);
      setError(`主角同步失败：${message}`);
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
    } catch (e: unknown) {
      appLogger.error('[CharactersPanel] 加载角色失败:', describeUnknownError(e, '未知错误'));
    }
  }, [novelId, chapter?.id]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(
    () => () => {
      candidateAbortRef.current?.abort();
    },
    [novelId, chapter?.id],
  );

  const handleGenerateCandidates = async () => {
    if (!novelId || !chapter || candidateAbortRef.current) return;
    const controller = new AbortController();
    candidateAbortRef.current = controller;
    setLoading(true);
    setError('');
    setNotice('正在生成本章候选角色…');
    try {
      const list = await characterGenerateService.generateCandidates(
        {
          novelId,
          chapterId: chapter.id,
          chapterTitle: chapter.title,
          chapterOutline: chapter.outline || chapter.goal || chapter.title,
          existingCharacters: characters,
        },
        { signal: controller.signal, cancel: () => controller.abort() },
      );
      throwIfAiRequestCancelled(controller.signal);
      // 过滤掉与主角同名的候选角色
      const filtered = list.filter((c) => {
        const isDuplicate = characters.some(
          (existing) => existing.name === c.name && existing.roleType === 'protagonist',
        );
        return !isDuplicate;
      });
      throwIfAiRequestCancelled(controller.signal);
      setCandidates(filtered);
      setNotice(`已生成 ${filtered.length} 个候选角色`);
    } catch (e: unknown) {
      if (controller.signal.aborted || isAiRequestCancelled(e)) {
        setNotice('已停止生成候选角色');
      } else {
        setError(describeUnknownError(e, '生成失败'));
        setNotice('');
      }
    } finally {
      if (candidateAbortRef.current === controller) {
        candidateAbortRef.current = null;
        setLoading(false);
      }
    }
  };

  const handleStopGeneratingCandidates = () => {
    const controller = candidateAbortRef.current;
    if (!controller || controller.signal.aborted) return;
    setNotice('正在停止生成候选角色…');
    controller.abort();
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
      novelId,
      name: candidate.name,
      roleType: candidate.roleType,
      identity: candidate.identity,
      faction: candidate.faction,
      relationToProtagonist: candidate.relationToProtagonist,
      goal: candidate.goal,
      personality: candidate.personality,
      behaviorLimits: candidate.behaviorLimits,
      forbiddenBehaviors: candidate.forbiddenBehaviors,
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

  const handleAddToChapter = async (
    characterId: string,
    characterName: string,
    roleInChapter: ChapterCharacterRole,
  ) => {
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
      const cc = await runWithLoading(
        {
          title: isProtagonist ? '正在添加主角到本章出场角色' : '正在添加本章出场角色',
          initialMessage: isProtagonist ? '正在写入主角本章出场状态……' : '正在写入章节角色关联……',
          successMessage: isProtagonist ? '主角已加入本章出场角色' : '角色已加入本章',
          errorMessage: isProtagonist ? '主角加入本章失败' : '角色加入本章失败',
        },
        async ({ setStage }) => {
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
        },
      );
      upsertChapterCharacterState(cc);
      setNotice(isProtagonist ? '主角已加入本章出场角色' : '角色已加入本章');
      setError('');
      onChapterCharactersChanged?.();
    } catch (e: unknown) {
      setError(describeUnknownError(e, '添加本章出场角色失败'));
    } finally {
      setActionBusy(false);
    }
  };

  const handleRemoveFromChapter = async (cc: ChapterCharacter) => {
    const char = characters.find((c) => c.id === cc.characterId);
    const isProtagonist = isProtagonistCharacter(char);
    setActionBusy(true);
    try {
      await runWithLoading(
        {
          title: isProtagonist ? '正在设置主角本章不出场' : '正在移除本章出场角色',
          initialMessage: isProtagonist ? '正在更新主角本章出场状态……' : '正在更新章节角色列表……',
          successMessage: isProtagonist ? '已设置主角本章不出场' : '已移除本章出场角色',
          errorMessage: isProtagonist ? '设置主角本章出场状态失败' : '移除本章出场角色失败',
        },
        async ({ setStage }) => {
          setStage('正在保存章节角色……');
          await chapterCharacterService.remove(cc);
        },
      );
      setChapterChars((prev) => prev.filter((c) => c.id !== cc.id));
      setNotice(isProtagonist ? '已设置主角本章不出场' : '已移除本章出场角色');
      setError('');
      onChapterCharactersChanged?.();
    } catch (e: unknown) {
      setError(describeUnknownError(e, '移除本章出场角色失败'));
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

  if (!novelId)
    return <div style={{ padding: 16, color: 'var(--color-text-muted)' }}>请先选择作品</div>;

  const aiSettings = aiSettingsService.getSettings();

  // 判断角色是否已在章节中
  const isInChapter = (charId: string) => chapterChars.some((cc) => cc.characterId === charId);

  // 角色库中未加入本章的角色（按主角优先排列）
  const availableChars = characters
    .filter((c) => !isInChapter(c.id))
    .sort((a, b) => Number(isProtagonistCharacter(b)) - Number(isProtagonistCharacter(a)));

  return (
    <CharactersPanelView
      aiSettings={aiSettings}
      chapter={chapter}
      characters={characters}
      chapterChars={chapterChars}
      candidates={candidates}
      availableChars={availableChars}
      protagonists={protagonists}
      loading={loading}
      actionBusy={actionBusy}
      syncing={syncing}
      notice={notice}
      error={error}
      isProtagonistCharacter={isProtagonistCharacter}
      onSetProtagonistAppearance={handleSetProtagonistAppearance}
      onRemoveFromChapter={handleRemoveFromChapter}
      onAddToChapter={handleAddToChapter}
      onStopGeneratingCandidates={handleStopGeneratingCandidates}
      onGenerateCandidates={handleGenerateCandidates}
      onConfirmCandidate={handleConfirmCandidate}
    />
  );
}

export default CharactersPanel;

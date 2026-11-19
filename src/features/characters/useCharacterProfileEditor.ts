import { useEffect, useRef, useState } from 'react';
import type { Character } from '../../types/character';
import { characterService } from '../../services/characters/characterService';
import {
  characterProfileValues,
  prepareCharacterProfileSave,
  type CharacterProfileValues,
} from '../../services/characters/characterProfile';
import { describeUnknownError } from '../../utils/errorMessage';

interface EditorState {
  baseline: Character;
  values: CharacterProfileValues;
  latest?: Character;
  busy: boolean;
  error: string;
  conflicted: boolean;
}

export function useCharacterProfileEditor(novelId: string, onSaved: (value: Character) => void) {
  const [state, setState] = useState<EditorState | null>(null);
  const epoch = useRef(0);
  const locked = useRef(false);
  const currentNovel = useRef(novelId);
  currentNovel.current = novelId;
  useEffect(() => {
    epoch.current += 1;
    locked.current = false;
    setState(null);
    return () => {
      epoch.current += 1;
    };
  }, [novelId]);
  const active = state?.baseline.novelId === novelId ? state : null;

  const begin = (character: Character) => {
    if (locked.current || character.novelId !== novelId || !character.isActive) return;
    epoch.current += 1;
    setState({
      baseline: character,
      values: characterProfileValues(character),
      busy: false,
      error: '',
      conflicted: false,
    });
  };
  const close = () => {
    if (locked.current) return;
    epoch.current += 1;
    setState(null);
  };
  const save = async () => {
    if (!active || locked.current || active.conflicted) return;
    const token = epoch.current;
    locked.current = true;
    setState({ ...active, busy: true, error: '' });
    try {
      const saved = await characterService.saveProfile(
        prepareCharacterProfileSave(active.baseline, active.values),
      );
      if (token !== epoch.current || currentNovel.current !== novelId) return;
      onSaved(saved);
      setState(null);
    } catch (reason) {
      if (token !== epoch.current || currentNovel.current !== novelId) return;
      const error = describeUnknownError(reason, '保存人物档案失败，请重试。');
      setState((current) =>
        current
          ? {
              ...current,
              error,
              conflicted: error.includes('CHARACTER_PROFILE_CONFLICT'),
              latest: undefined,
            }
          : null,
      );
    } finally {
      if (token === epoch.current && currentNovel.current === novelId) {
        locked.current = false;
        setState((current) => (current ? { ...current, busy: false } : null));
      }
    }
  };
  const refresh = async () => {
    if (!active || locked.current) return;
    const token = epoch.current;
    locked.current = true;
    setState({ ...active, busy: true, error: '', latest: undefined, conflicted: true });
    try {
      const characters = await characterService.getByNovelId(novelId);
      const latest = characters.find(
        (item) => item.id === active.baseline.id && item.novelId === novelId && item.isActive,
      );
      if (!latest) throw new Error('人物已停用或删除，当前输入已保留，请取消编辑并核对作品。');
      if (token === epoch.current && currentNovel.current === novelId)
        setState((current) => (current ? { ...current, latest } : null));
    } catch (reason) {
      if (token === epoch.current && currentNovel.current === novelId)
        setState((current) =>
          current
            ? { ...current, error: describeUnknownError(reason, '刷新正式人物档案失败。') }
            : null,
        );
    } finally {
      if (token === epoch.current && currentNovel.current === novelId) {
        locked.current = false;
        setState((current) => (current ? { ...current, busy: false } : null));
      }
    }
  };
  return {
    state: active,
    begin,
    close,
    save,
    refresh,
    change: (patch: Partial<CharacterProfileValues>) => {
      if (!locked.current)
        setState((current) =>
          current ? { ...current, values: { ...current.values, ...patch } } : null,
        );
    },
    useLatest: () => {
      if (!locked.current)
        setState((current) =>
          current?.latest
            ? {
                ...current,
                values: Object.fromEntries(
                  Object.entries(current.values).map(([key, value]) => [
                    key,
                    value ===
                    characterProfileValues(current.baseline)[key as keyof CharacterProfileValues]
                      ? characterProfileValues(current.latest!)[key as keyof CharacterProfileValues]
                      : value,
                  ]),
                ) as unknown as CharacterProfileValues,
                baseline: current.latest,
                latest: undefined,
                conflicted: false,
                error: '',
              }
            : current,
        );
    },
  };
}

export type CharacterProfileEditorController = ReturnType<typeof useCharacterProfileEditor>;

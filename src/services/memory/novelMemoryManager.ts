import type {
  CharacterDynamicState,
  INovelMemoryManager,
  MemoryFragment,
  MemoryRetrievalQuery,
  SceneMemoryContext,
  WorldStateSnapshot,
} from '../../types/novelMemory';

export class NovelMemoryManager implements INovelMemoryManager {
  private characterStates = new Map<string, Map<string, CharacterDynamicState>>();
  private worldStates = new Map<string, WorldStateSnapshot>();
  private fragments = new Map<string, MemoryFragment[]>();

  async retrieveContext(query: MemoryRetrievalQuery): Promise<SceneMemoryContext> {
    const novelId = query.novelId.trim();
    const novelFragments = this.fragments.get(novelId) ?? [];
    const charMap = this.characterStates.get(novelId) ?? new Map<string, CharacterDynamicState>();

    // 1. 长期记忆（世界观、核心设定、基础人设）
    const longTermMemories = novelFragments
      .filter((f) => f.tier === 'long_term')
      .sort((a, b) => b.importance - a.importance);

    // 2. 中期记忆（当前卷进展、动态状态、伏笔）
    const midTermMemories = novelFragments
      .filter((f) => f.tier === 'mid_term')
      .sort((a, b) => b.importance - a.importance);

    // 3. 短期记忆（当前场景相关）
    const shortTermMemories = novelFragments
      .filter((f) => f.tier === 'short_term')
      .sort((a, b) => b.importance - a.importance);

    // 视点角色 (POV)
    const povCharacter = query.povCharacterId
      ? {
          id: query.povCharacterId,
          name: charMap.get(query.povCharacterId)?.characterName ?? query.povCharacterId,
          dynamicState: charMap.get(query.povCharacterId),
        }
      : undefined;

    // 活跃角色
    const activeCharacters = (query.activeCharacterIds ?? []).map((id) => ({
      id,
      name: charMap.get(id)?.characterName ?? id,
      dynamicState: charMap.get(id),
    }));

    const totalBudget = query.maxMemoryTokens ?? 1500;
    const longTermUsed = Math.min(Math.round(totalBudget * 0.3), 450);
    const midTermUsed = Math.min(Math.round(totalBudget * 0.4), 600);
    const shortTermUsed = Math.min(Math.round(totalBudget * 0.3), 450);

    return {
      novelId,
      chapterId: query.chapterId,
      sceneId: query.sceneId,
      povCharacter,
      activeCharacters,
      longTermMemories,
      midTermMemories,
      shortTermMemories,
      constraints: [],
      tokenBudget: {
        totalBudget,
        longTermUsed,
        midTermUsed,
        shortTermUsed,
      },
    };
  }

  async updateCharacterState(
    novelId: string,
    characterId: string,
    patch: Partial<CharacterDynamicState>,
  ): Promise<CharacterDynamicState> {
    const nid = novelId.trim();
    const cid = characterId.trim();
    if (!this.characterStates.has(nid)) {
      this.characterStates.set(nid, new Map());
    }
    const map = this.characterStates.get(nid)!;
    const current = map.get(cid) ?? {
      characterId: cid,
      characterName: patch.characterName?.trim() || cid,
      stateVersion: 0,
      updatedAt: new Date().toISOString(),
    };

    const next: CharacterDynamicState = {
      ...current,
      ...patch,
      characterId: cid,
      stateVersion: (current.stateVersion || 0) + 1,
      updatedAt: new Date().toISOString(),
    };
    map.set(cid, next);
    return next;
  }

  async updateWorldState(
    novelId: string,
    patch: Partial<WorldStateSnapshot>,
  ): Promise<WorldStateSnapshot> {
    const nid = novelId.trim();
    const current = this.worldStates.get(nid) ?? {
      novelId: nid,
      snapshotVersion: 0,
      updatedAt: new Date().toISOString(),
    };

    const next: WorldStateSnapshot = {
      ...current,
      ...patch,
      novelId: nid,
      snapshotVersion: (current.snapshotVersion || 0) + 1,
      updatedAt: new Date().toISOString(),
    };
    this.worldStates.set(nid, next);
    return next;
  }

  async addMemoryFragment(
    novelId: string,
    fragment: Omit<MemoryFragment, 'id' | 'createdAt'>,
  ): Promise<MemoryFragment> {
    const nid = novelId.trim();
    if (!this.fragments.has(nid)) {
      this.fragments.set(nid, []);
    }
    const fullFragment: MemoryFragment = {
      ...fragment,
      id: `mem-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      createdAt: new Date().toISOString(),
    };
    this.fragments.get(nid)!.push(fullFragment);
    return fullFragment;
  }

  async createSnapshot(novelId: string): Promise<WorldStateSnapshot> {
    const nid = novelId.trim();
    const worldState = this.worldStates.get(nid) ?? {
      novelId: nid,
      snapshotVersion: 1,
      updatedAt: new Date().toISOString(),
    };
    return {
      ...worldState,
      updatedAt: new Date().toISOString(),
    };
  }

  reset(novelId?: string): void {
    if (novelId) {
      const nid = novelId.trim();
      this.characterStates.delete(nid);
      this.worldStates.delete(nid);
      this.fragments.delete(nid);
    } else {
      this.characterStates.clear();
      this.worldStates.clear();
      this.fragments.clear();
    }
  }
}

export const novelMemoryManager = new NovelMemoryManager();

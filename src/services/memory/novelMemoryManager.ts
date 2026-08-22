import type {
  CharacterDynamicState,
  INovelMemoryManager,
  MemoryFragment,
  MemoryRetrievalQuery,
  SceneMemoryContext,
  WorldStateSnapshot,
} from '../../types/novelMemory';

import { novelMemoryRetriever } from './retrieval/novelMemoryRetriever';

export class NovelMemoryManager implements INovelMemoryManager {
  private characterStates = new Map<string, Map<string, CharacterDynamicState>>();
  private worldStates = new Map<string, WorldStateSnapshot>();
  private fragments = new Map<string, MemoryFragment[]>();

  async retrieveContext(query: MemoryRetrievalQuery): Promise<SceneMemoryContext> {
    const novelId = query.novelId.trim();
    const fragments = this.fragments.get(novelId) ?? [];
    const characterStates =
      this.characterStates.get(novelId) ?? new Map<string, CharacterDynamicState>();
    const worldState = this.worldStates.get(novelId);

    return novelMemoryRetriever.retrieve(query, {
      fragments,
      characterStates,
      worldState,
    });
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

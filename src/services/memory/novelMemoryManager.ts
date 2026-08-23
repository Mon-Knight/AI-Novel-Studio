import type {
  CharacterDynamicState,
  INovelMemoryManager,
  MemoryFragment,
  MemoryRetrievalQuery,
  MemoryStateDelta,
  MemoryUpdateResult,
  MemoryVersionSnapshot,
  SceneMemoryContext,
  WorldStateSnapshot,
} from '../../types/novelMemory';

import { novelMemoryRetriever } from './retrieval/novelMemoryRetriever';
import { novelMemoryStateUpdater } from './update/novelMemoryStateUpdater';

export class NovelMemoryManager implements INovelMemoryManager {
  private fragments = new Map<string, MemoryFragment[]>();

  async retrieveContext(query: MemoryRetrievalQuery): Promise<SceneMemoryContext> {
    const novelId = query.novelId.trim();
    const fragments = this.fragments.get(novelId) ?? [];
    const characterStates = novelMemoryStateUpdater.getAllCharacterStates(novelId);
    const worldState = novelMemoryStateUpdater.getWorldState(novelId);

    return novelMemoryRetriever.retrieve(query, {
      fragments,
      characterStates,
      worldState,
    });
  }

  getCharacterState(novelId: string, characterId: string): CharacterDynamicState | undefined {
    return novelMemoryStateUpdater.getCharacterState(novelId, characterId);
  }

  getWorldState(novelId: string): WorldStateSnapshot | undefined {
    return novelMemoryStateUpdater.getWorldState(novelId);
  }

  async updateCharacterState(
    novelId: string,
    characterId: string,
    patch: Partial<CharacterDynamicState>,
  ): Promise<CharacterDynamicState> {
    return novelMemoryStateUpdater.updateCharacterState(novelId, characterId, patch);
  }

  async updateWorldState(
    novelId: string,
    patch: Partial<WorldStateSnapshot>,
  ): Promise<WorldStateSnapshot> {
    return novelMemoryStateUpdater.updateWorldSnapshot(novelId, patch);
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
    const world = novelMemoryStateUpdater.getWorldState(nid);
    if (world) return world;
    return novelMemoryStateUpdater.updateWorldSnapshot(nid, {
      novelId: nid,
      snapshotVersion: 1,
    });
  }

  async applyStateDelta(
    novelId: string,
    deltas: MemoryStateDelta[],
    description?: string,
  ): Promise<MemoryUpdateResult> {
    return novelMemoryStateUpdater.applyStateDelta(novelId, deltas, description);
  }

  async rollbackMemoryVersion(novelId: string, versionId: string): Promise<boolean> {
    return novelMemoryStateUpdater.rollbackMemoryVersion(novelId, versionId);
  }

  listMemoryVersions(novelId: string): MemoryVersionSnapshot[] {
    return novelMemoryStateUpdater.listMemoryVersions(novelId);
  }

  reset(novelId?: string): void {
    if (novelId) {
      const nid = novelId.trim();
      this.fragments.delete(nid);
      novelMemoryStateUpdater.reset(nid);
    } else {
      this.fragments.clear();
      novelMemoryStateUpdater.reset();
    }
  }
}

export const novelMemoryManager = new NovelMemoryManager();

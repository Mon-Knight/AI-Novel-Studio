import type {
  CharacterDynamicState,
  MemoryStateDelta,
  MemoryUpdateResult,
  MemoryVersionSnapshot,
  WorldStateSnapshot,
} from '../../../types/novelMemory';

export class NovelMemoryStateUpdater {
  private characterStates = new Map<string, Map<string, CharacterDynamicState>>();
  private worldStates = new Map<string, WorldStateSnapshot>();
  private versionSnapshots = new Map<string, MemoryVersionSnapshot[]>();

  /**
   * 获取某小说特定角色的当前动态状态
   */
  getCharacterState(novelId: string, characterId: string): CharacterDynamicState | undefined {
    const nid = novelId.trim();
    const cid = characterId.trim();
    return this.characterStates.get(nid)?.get(cid);
  }

  /**
   * 获取某小说的所有角色动态状态
   */
  getAllCharacterStates(novelId: string): Map<string, CharacterDynamicState> {
    const nid = novelId.trim();
    if (!this.characterStates.has(nid)) {
      this.characterStates.set(nid, new Map());
    }
    return this.characterStates.get(nid)!;
  }

  /**
   * 获取某小说的当前世界状态快照
   */
  getWorldState(novelId: string): WorldStateSnapshot | undefined {
    const nid = novelId.trim();
    return this.worldStates.get(nid);
  }

  /**
   * 演进更新特定角色的动态状态（心境/伤势/目标/阵营/关系等）
   */
  async updateCharacterState(
    novelId: string,
    characterId: string,
    patch: Partial<CharacterDynamicState>,
  ): Promise<CharacterDynamicState> {
    const nid = novelId.trim();
    const cid = characterId.trim();
    const map = this.getAllCharacterStates(nid);

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
      characterName: patch.characterName?.trim() || current.characterName,
      stateVersion: (current.stateVersion || 0) + 1,
      updatedAt: new Date().toISOString(),
    };

    map.set(cid, next);
    return next;
  }

  /**
   * 演进更新世界状态（时间线/大事件/阵营态势/世界规则等）
   */
  async updateWorldSnapshot(
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

  /**
   * 批量应用结构化状态增量 Delta，并原子创建版本快照
   */
  async applyStateDelta(
    novelId: string,
    deltas: MemoryStateDelta[],
    description = '剧情演进状态更新',
  ): Promise<MemoryUpdateResult> {
    const nid = novelId.trim();
    const updatedCharacters = new Set<string>();
    let worldUpdated = false;

    for (const delta of deltas) {
      if (delta.entityType === 'character') {
        const cid = delta.entityId.trim();
        const patch: Partial<CharacterDynamicState> = {};
        if (typeof delta.changes.characterName === 'string') patch.characterName = delta.changes.characterName;
        if (typeof delta.changes.currentEmotion === 'string') patch.currentEmotion = delta.changes.currentEmotion;
        if (typeof delta.changes.currentGoal === 'string') patch.currentGoal = delta.changes.currentGoal;
        if (typeof delta.changes.faction === 'string') patch.faction = delta.changes.faction;
        if (typeof delta.changes.lastKnownLocation === 'string') patch.lastKnownLocation = delta.changes.lastKnownLocation;

        if (Array.isArray(delta.changes.injuries)) {
          patch.injuries = delta.changes.injuries.filter((i): i is string => typeof i === 'string');
        }
        if (delta.changes.currentRelationship && typeof delta.changes.currentRelationship === 'object') {
          const current = this.getCharacterState(nid, cid)?.currentRelationship ?? {};
          patch.currentRelationship = {
            ...current,
            ...(delta.changes.currentRelationship as Record<string, string>),
          };
        }

        await this.updateCharacterState(nid, cid, patch);
        updatedCharacters.add(cid);
      } else if (delta.entityType === 'world' || delta.entityType === 'faction' || delta.entityType === 'rule' || delta.entityType === 'mystery') {
        const patch: Partial<WorldStateSnapshot> = {};
        if (typeof delta.changes.timelinePosition === 'string') patch.timelinePosition = delta.changes.timelinePosition;
        if (Array.isArray(delta.changes.activeEvents)) {
          const existing = this.getWorldState(nid)?.activeEvents ?? [];
          const newEvents = delta.changes.activeEvents.filter((e): e is string => typeof e === 'string');
          patch.activeEvents = [...new Set([...existing, ...newEvents])];
        }
        if (Array.isArray(delta.changes.worldRules)) {
          const existing = this.getWorldState(nid)?.worldRules ?? [];
          const newRules = delta.changes.worldRules.filter((r): r is string => typeof r === 'string');
          patch.worldRules = [...new Set([...existing, ...newRules])];
        }
        if (Array.isArray(delta.changes.unresolvedMysteries)) {
          const existing = this.getWorldState(nid)?.unresolvedMysteries ?? [];
          const newMysteries = delta.changes.unresolvedMysteries.filter((m): m is string => typeof m === 'string');
          patch.unresolvedMysteries = [...new Set([...existing, ...newMysteries])];
        }
        if (delta.changes.factionStatus && typeof delta.changes.factionStatus === 'object') {
          const existing = this.getWorldState(nid)?.factionStatus ?? {};
          patch.factionStatus = {
            ...existing,
            ...(delta.changes.factionStatus as Record<string, string>),
          };
        }

        await this.updateWorldSnapshot(nid, patch);
        worldUpdated = true;
      }
    }

    const versionSnapshot = await this.createMemoryVersion(nid, description);

    return {
      appliedDeltas: deltas.length,
      updatedCharacters: Array.from(updatedCharacters),
      worldUpdated,
      versionSnapshot,
    };
  }

  /**
   * 显式创建不可变记忆版本快照
   */
  async createMemoryVersion(
    novelId: string,
    description = '常规记忆版本快照',
  ): Promise<MemoryVersionSnapshot> {
    const nid = novelId.trim();
    if (!this.versionSnapshots.has(nid)) {
      this.versionSnapshots.set(nid, []);
    }
    const history = this.versionSnapshots.get(nid)!;
    const versionNumber = history.length + 1;

    // 深拷贝当前角色状态
    const charMap = this.getAllCharacterStates(nid);
    const charCopies: Record<string, CharacterDynamicState> = {};
    for (const [id, state] of charMap.entries()) {
      charCopies[id] = { ...state };
    }

    // 深拷贝当前世界状态
    const currentWorld = this.worldStates.get(nid) ?? {
      novelId: nid,
      snapshotVersion: 1,
      updatedAt: new Date().toISOString(),
    };
    const worldCopy: WorldStateSnapshot = { ...currentWorld };

    const snapshot: MemoryVersionSnapshot = {
      versionId: `mem-ver-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      novelId: nid,
      versionNumber,
      description,
      characterStates: charCopies,
      worldState: worldCopy,
      createdAt: new Date().toISOString(),
    };

    history.push(snapshot);
    return snapshot;
  }

  /**
   * 回滚记忆状态至指定的历史版本快照
   */
  async rollbackMemoryVersion(novelId: string, versionId: string): Promise<boolean> {
    const nid = novelId.trim();
    const vid = versionId.trim();
    const history = this.versionSnapshots.get(nid) ?? [];
    const targetSnapshot = history.find((s) => s.versionId === vid);
    if (!targetSnapshot) return false;

    // 1. 恢复角色状态
    const charMap = new Map<string, CharacterDynamicState>();
    for (const [id, state] of Object.entries(targetSnapshot.characterStates)) {
      charMap.set(id, {
        ...state,
        stateVersion: state.stateVersion + 1,
        updatedAt: new Date().toISOString(),
      });
    }
    this.characterStates.set(nid, charMap);

    // 2. 恢复世界状态
    const restoredWorld: WorldStateSnapshot = {
      ...targetSnapshot.worldState,
      snapshotVersion: (targetSnapshot.worldState.snapshotVersion || 0) + 1,
      updatedAt: new Date().toISOString(),
    };
    this.worldStates.set(nid, restoredWorld);

    // 3. 记录回滚动作快照
    await this.createMemoryVersion(
      nid,
      `回滚至版本 #${targetSnapshot.versionNumber} (${targetSnapshot.description})`,
    );

    return true;
  }

  /**
   * 获取小说历史版本快照列表
   */
  listMemoryVersions(novelId: string): MemoryVersionSnapshot[] {
    const nid = novelId.trim();
    return [...(this.versionSnapshots.get(nid) ?? [])];
  }

  reset(novelId?: string): void {
    if (novelId) {
      const nid = novelId.trim();
      this.characterStates.delete(nid);
      this.worldStates.delete(nid);
      this.versionSnapshots.delete(nid);
    } else {
      this.characterStates.clear();
      this.worldStates.clear();
      this.versionSnapshots.clear();
    }
  }
}

export const novelMemoryStateUpdater = new NovelMemoryStateUpdater();

/**
 * AI Novel Studio - 主角设定 Repository
 */
import type { Protagonist, SaveProtagonistInput } from '../../types/protagonist';
import { dbCall, lsGet, lsSet, generateId, nowISO } from './db';

const PROTAGONISTS_KEY = 'ai_novel_studio_protagonists';

function getLocalProtagonists(): Protagonist[] {
  return lsGet<Protagonist[]>(PROTAGONISTS_KEY) ?? [];
}

function saveLocalProtagonists(items: Protagonist[]): void {
  lsSet(PROTAGONISTS_KEY, items);
}

export const protagonistRepository = {
  async getByNovelId(novelId: string): Promise<Protagonist | null> {
    return dbCall<Protagonist | null>('get_protagonist', { novelId }, () => {
      const items = getLocalProtagonists();
      return items.find((p) => p.novelId === novelId) ?? null;
    });
  },

  async save(
    id: string | null,
    input: SaveProtagonistInput,
  ): Promise<Protagonist> {
    return dbCall<Protagonist>('save_protagonist', { id, input }, () => {
      const items = getLocalProtagonists();
      const now = nowISO();
      if (id) {
        const idx = items.findIndex((p) => p.id === id);
        if (idx !== -1) {
          items[idx] = { ...items[idx], ...input, updatedAt: now };
          saveLocalProtagonists(items);
          return items[idx];
        }
      }
      const newItem: Protagonist = {
        id: generateId(),
        novelId: input.novelId,
        name: input.name,
        identity: input.identity,
        personality: input.personality,
        goal: input.goal,
        specialAbility: input.specialAbility,
        abilityLimits: input.abilityLimits,
        forbiddenBehaviors: input.forbiddenBehaviors,
        currentState: input.currentState,
        createdAt: now,
        updatedAt: now,
      };
      items.push(newItem);
      saveLocalProtagonists(items);
      return newItem;
    });
  },
};

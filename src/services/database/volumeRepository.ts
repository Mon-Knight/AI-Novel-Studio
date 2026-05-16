/**
 * AI Novel Studio - 分卷 Repository
 */
import type { Volume, CreateVolumeInput, UpdateVolumeInput } from '../../types/volume';
import { dbCall, lsGet, lsSet, generateId, nowISO } from './db';

const VOLUMES_KEY = 'ai_novel_studio_volumes';

function getLocalVolumes(): Volume[] {
  return lsGet<Volume[]>(VOLUMES_KEY) ?? [];
}

function saveLocalVolumes(items: Volume[]): void {
  lsSet(VOLUMES_KEY, items);
}

export const volumeRepository = {
  async getByNovelId(novelId: string): Promise<Volume[]> {
    return dbCall<Volume[]>('get_volumes_by_novel_id', { novelId }, () =>
      getLocalVolumes().filter((v) => v.novelId === novelId).sort((a, b) => a.orderIndex - b.orderIndex),
    );
  },

  async getById(id: string): Promise<Volume | null> {
    return dbCall<Volume | null>('get_volume_by_id', { id }, () =>
      getLocalVolumes().find((v) => v.id === id) ?? null,
    );
  },

  async create(input: CreateVolumeInput): Promise<Volume> {
    return dbCall<Volume>('create_volume', { input }, () => {
      const items = getLocalVolumes();
      const now = nowISO();
      const maxOrder = items.filter((v) => v.novelId === input.novelId).reduce((max, v) => Math.max(max, v.orderIndex), -1);
      const volume: Volume = {
        id: generateId(),
        novelId: input.novelId,
        title: input.title,
        summary: input.summary,
        goal: input.goal,
        mainConflict: input.mainConflict,
        orderIndex: input.orderIndex ?? maxOrder + 1,
        volumeNumber: maxOrder + 2,
        sortOrder: input.orderIndex ?? maxOrder + 1,
        status: 'planned',
        createdAt: now,
        updatedAt: now,
      };
      items.push(volume);
      saveLocalVolumes(items);
      return volume;
    });
  },

  async update(id: string, input: UpdateVolumeInput): Promise<Volume | null> {
    return dbCall<Volume>('update_volume', { id, input }, () => {
      const items = getLocalVolumes();
      const idx = items.findIndex((v) => v.id === id);
      if (idx === -1) return null as unknown as Volume;
      items[idx] = { ...items[idx], ...input, updatedAt: nowISO() };
      saveLocalVolumes(items);
      return items[idx];
    });
  },

  async remove(id: string): Promise<void> {
    return dbCall<void>('delete_volume', { id }, () => {
      const items = getLocalVolumes().filter((v) => v.id !== id);
      saveLocalVolumes(items);
    });
  },
};

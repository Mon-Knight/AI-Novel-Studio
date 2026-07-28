import { appLogger } from '../observability/appLogger';
/**
 * AI Novel Studio - 分卷 Repository
 */
import type { Volume, CreateVolumeInput, UpdateVolumeInput } from '../../types/volume';
import { dbCall, lsGet, lsSet, generateId, nowISO } from './db';

const VOLUMES_KEY = 'ai_novel_studio_volumes';

type VolumeRecord = Partial<Volume> & {
  novel_id?: string;
  main_conflict?: string;
  order_index?: number;
  volume_number?: number;
  sort_order?: number;
  created_at?: string;
  updated_at?: string;
  deleted_at?: string;
  description?: string;
};

function toNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function normalizeVolume(raw: unknown): Volume | null {
  if (!raw || typeof raw !== 'object') return null;
  const item = raw as VolumeRecord;
  const id = typeof item.id === 'string' ? item.id : '';
  const novelId = typeof item.novelId === 'string' ? item.novelId : item.novel_id;
  const title = typeof item.title === 'string' ? item.title : '';
  if (!id || !novelId || !title) return null;

  const orderIndex = toNumber(item.orderIndex ?? item.order_index, 0);
  const now = nowISO();
  const summary = item.summary ?? item.description ?? '';

  return {
    id,
    novelId,
    title,
    summary,
    goal: item.goal ?? '',
    mainConflict: item.mainConflict ?? item.main_conflict ?? '',
    orderIndex,
    volumeNumber: toNumber(item.volumeNumber ?? item.volume_number, orderIndex + 1),
    sortOrder: toNumber(item.sortOrder ?? item.sort_order, orderIndex),
    status: item.status ?? 'planned',
    createdAt: item.createdAt ?? item.created_at ?? now,
    updatedAt: item.updatedAt ?? item.updated_at ?? now,
    deletedAt: item.deletedAt ?? item.deleted_at,
  };
}

function normalizeVolumes(items: unknown): Volume[] {
  if (!Array.isArray(items)) return [];
  return items
    .map(normalizeVolume)
    .filter((item): item is Volume => item !== null)
    .sort((a, b) => a.orderIndex - b.orderIndex);
}

function getLocalVolumes(): Volume[] {
  const volumes = normalizeVolumes(lsGet<unknown>(VOLUMES_KEY));
  lsSet(VOLUMES_KEY, volumes);
  return volumes;
}

function saveLocalVolumes(items: Volume[]): void {
  lsSet(VOLUMES_KEY, items);
}

export const volumeRepository = {
  async getByNovelId(novelId: string): Promise<Volume[]> {
    const items = await dbCall<unknown[]>('get_volumes_by_novel_id', { novelId }, () =>
      getLocalVolumes()
        .filter((v) => v.novelId === novelId)
        .sort((a, b) => a.orderIndex - b.orderIndex),
    );
    const volumes = normalizeVolumes(items);
    appLogger.info(
      `[volumeService] listVolumesByNovelId novelId=${novelId} count=${volumes.length}`,
    );
    return volumes;
  },

  async getById(id: string): Promise<Volume | null> {
    const item = await dbCall<unknown | null>(
      'get_volume_by_id',
      { id },
      () => getLocalVolumes().find((v) => v.id === id) ?? null,
    );
    return normalizeVolume(item);
  },

  async create(input: CreateVolumeInput): Promise<Volume> {
    appLogger.info('[volumeService] createVolume input', {
      novelId: input.novelId,
      titleLength: input.title.length,
    });
    const before = await volumeRepository.getByNovelId(input.novelId);
    const maxOrder = before.reduce((max, v) => Math.max(max, v.orderIndex), -1);
    const preparedInput = {
      ...input,
      title: input.title.trim(),
      orderIndex: input.orderIndex ?? maxOrder + 1,
    };
    appLogger.info(`[volumeService] before save count=${before.length}`);

    const createdRaw = await dbCall<unknown>('create_volume', { input: preparedInput }, () => {
      const items = getLocalVolumes();
      const now = nowISO();
      const volume: Volume = {
        id: generateId(),
        novelId: preparedInput.novelId,
        title: preparedInput.title,
        summary: preparedInput.summary ?? '',
        goal: preparedInput.goal ?? '',
        mainConflict: preparedInput.mainConflict ?? '',
        orderIndex: preparedInput.orderIndex,
        volumeNumber: preparedInput.orderIndex + 1,
        sortOrder: preparedInput.orderIndex,
        status: 'planned',
        createdAt: now,
        updatedAt: now,
      };
      items.push(volume);
      saveLocalVolumes(items);
      return volume;
    });
    const created = normalizeVolume(createdRaw);
    if (!created?.id) throw new Error('分卷创建返回无效数据');

    const after = await volumeRepository.getByNovelId(input.novelId);
    appLogger.info(`[volumeService] after save count=${after.length}`);
    appLogger.info(`[volumeService] created id=${created.id}`);
    if (!after.some((v) => v.id === created.id)) {
      throw new Error('分卷创建后无法读取，请检查存储');
    }
    return created;
  },

  async update(id: string, input: UpdateVolumeInput): Promise<Volume | null> {
    const updatedRaw = await dbCall<unknown>('update_volume', { id, input }, () => {
      const items = getLocalVolumes();
      const idx = items.findIndex((v) => v.id === id);
      if (idx === -1) return null as unknown as Volume;
      items[idx] = { ...items[idx], ...input, updatedAt: nowISO() };
      saveLocalVolumes(items);
      return items[idx];
    });
    return normalizeVolume(updatedRaw);
  },

  async remove(id: string): Promise<void> {
    return dbCall<void>('delete_volume', { id }, () => {
      const items = getLocalVolumes().filter((v) => v.id !== id);
      saveLocalVolumes(items);
    });
  },
};

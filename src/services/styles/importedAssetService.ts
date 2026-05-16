/**
 * AI Novel Studio - 导入资产服务
 */
import { lsGet, lsSet, generateId, nowISO } from '../database/db';
import type { ImportedAsset, CreateImportedAssetInput } from '../../types/importedAsset';

const ASSETS_KEY = 'ai_novel_studio_imported_assets';

function getAll(): ImportedAsset[] {
  return lsGet<ImportedAsset[]>(ASSETS_KEY) ?? [];
}

function saveAll(items: ImportedAsset[]): void {
  lsSet(ASSETS_KEY, items);
}

export const importedAssetService = {
  async getAll(novelId?: string): Promise<ImportedAsset[]> {
    const list = getAll();
    if (novelId) return list.filter((a) => a.novelId === novelId);
    return list;
  },

  async create(input: CreateImportedAssetInput): Promise<ImportedAsset> {
    const list = getAll();
    const asset: ImportedAsset = { ...input, id: generateId(), createdAt: nowISO() };
    list.unshift(asset);
    saveAll(list);
    return asset;
  },

  async remove(id: string): Promise<void> {
    saveAll(getAll().filter((a) => a.id !== id));
  },
};

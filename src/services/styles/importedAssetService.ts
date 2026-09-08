/**
 * AI Novel Studio - 导入资产服务
 *
 * 桌面端以 SQLite `imported_assets` 为事实源（审计 GAP-15）；浏览器开发模式继续使用 LocalStorage。
 * 首次在桌面端读取时，把历史 LocalStorage 记录幂等 upsert 到 SQLite，再写入迁移标记。
 */
import { dbCall, getDbMode, lsGet, lsSet, generateId, nowISO } from '../database/db';
import type { ImportedAsset, CreateImportedAssetInput } from '../../types/importedAsset';

const ASSETS_KEY = 'ai_novel_studio_imported_assets';
export const IMPORTED_ASSETS_SQLITE_MIGRATION_KEY = 'ai_novel_studio_imported_assets_sqlite_v1';

function localGetAll(): ImportedAsset[] {
  return lsGet<ImportedAsset[]>(ASSETS_KEY) ?? [];
}

function localSaveAll(items: ImportedAsset[]): void {
  lsSet(ASSETS_KEY, items);
}

function toSaveInput(asset: Partial<ImportedAsset> & CreateImportedAssetInput) {
  return {
    id: asset.id,
    novelId: asset.novelId ?? null,
    fileName: asset.fileName,
    filePath: asset.filePath ?? null,
    fileType: asset.fileType,
    assetType: asset.assetType,
    contentPreview: asset.contentPreview ?? null,
    parsedJson: asset.parsedJson ?? null,
    relatedStyleProfileId: asset.relatedStyleProfileId ?? null,
    createdAt: asset.createdAt ?? null,
  };
}

function fromDto(dto: Record<string, unknown>): ImportedAsset {
  return {
    id: String(dto.id),
    novelId: (dto.novelId as string | null) ?? undefined,
    fileName: String(dto.fileName),
    filePath: (dto.filePath as string | null) ?? undefined,
    fileType: dto.fileType as ImportedAsset['fileType'],
    assetType: dto.assetType as ImportedAsset['assetType'],
    contentPreview: (dto.contentPreview as string | null) ?? undefined,
    parsedJson: (dto.parsedJson as string | null) ?? undefined,
    relatedStyleProfileId: (dto.relatedStyleProfileId as string | null) ?? undefined,
    createdAt: String(dto.createdAt),
  };
}

async function ensureDesktopMigrated(): Promise<void> {
  if (lsGet<boolean>(IMPORTED_ASSETS_SQLITE_MIGRATION_KEY)) return;
  const local = localGetAll();
  if (local.length > 0) {
    const existing = new Set(
      (await dbCall<Record<string, unknown>[]>('list_imported_assets', { novelId: null })).map(
        (row) => String(row.id),
      ),
    );
    for (const asset of local) {
      if (existing.has(asset.id)) continue;
      try {
        await dbCall('save_imported_asset', { input: toSaveInput(asset) });
      } catch {
        // A row whose novel or style profile no longer exists cannot be re-homed; it stays
        // in LocalStorage only and never blocks the rest of the migration.
      }
    }
  }
  // The marker is written only after every idempotent upsert has been attempted.
  lsSet(IMPORTED_ASSETS_SQLITE_MIGRATION_KEY, true);
}

export const importedAssetService = {
  async getAll(novelId?: string): Promise<ImportedAsset[]> {
    if (getDbMode() === 'tauri') {
      await ensureDesktopMigrated();
      const rows = await dbCall<Record<string, unknown>[]>('list_imported_assets', {
        novelId: novelId ?? null,
      });
      return rows.map(fromDto);
    }
    const list = localGetAll();
    if (novelId) return list.filter((a) => a.novelId === novelId);
    return list;
  },

  async create(input: CreateImportedAssetInput): Promise<ImportedAsset> {
    if (getDbMode() === 'tauri') {
      await ensureDesktopMigrated();
      const dto = await dbCall<Record<string, unknown>>('save_imported_asset', {
        input: toSaveInput(input),
      });
      return fromDto(dto);
    }
    const list = localGetAll();
    const asset: ImportedAsset = { ...input, id: generateId(), createdAt: nowISO() };
    list.unshift(asset);
    localSaveAll(list);
    return asset;
  },

  async remove(id: string): Promise<void> {
    if (getDbMode() === 'tauri') {
      await dbCall<void>('delete_imported_asset', { assetId: id });
      return;
    }
    localSaveAll(localGetAll().filter((a) => a.id !== id));
  },
};

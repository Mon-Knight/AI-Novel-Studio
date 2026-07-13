import { dbCall } from '../database/db';
import { isTauriRuntime } from '../tauri/runtime';
import { novelService } from '../novels/novelService';

/**
 * Removes only a newly-created project whose import failed. Desktop cleanup is
 * one SQLite transaction; browser development uses the existing local cascade.
 */
export async function rollbackFailedProjectImport(novelId: string): Promise<void> {
  if (isTauriRuntime()) {
    await dbCall<void>('rollback_imported_novel', { novelId });
    return;
  }
  await novelService.deleteNovelCascade(novelId);
}

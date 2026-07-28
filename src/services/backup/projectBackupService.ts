import { dbCall } from '../database/db';
import { isTauriRuntime } from '../tauri/runtime';
import {
  collectLocalProjectData,
  mergeLocalStorageIdMap,
  restoreLocalProjectData,
} from './projectBackupLocalStorage';
import {
  isCompleteProjectBackup,
  type CompleteProjectBackup,
  type ProjectBackupImportResult,
} from './projectBackupSchema';

export {
  PROJECT_BACKUP_SCHEMA_VERSION,
  getProjectBackupSummary,
  isCompleteProjectBackup,
} from './projectBackupSchema';
export type {
  BackupRow,
  BackupValue,
  CompleteProjectBackup,
  LocalProjectBackupData,
  ProjectBackupImportResult,
} from './projectBackupSchema';

export async function createCompleteProjectBackup(novelId: string): Promise<CompleteProjectBackup> {
  if (!isTauriRuntime()) {
    throw new Error('完整项目备份仅支持桌面版 SQLite 数据库。浏览器开发模式请勿将 JSON 用作灾备。');
  }
  const backup = await dbCall<CompleteProjectBackup>('export_project_backup', { novelId });
  if (!isCompleteProjectBackup(backup)) {
    throw new Error('桌面端返回了无效的项目备份数据。');
  }
  const localStorageData = collectLocalProjectData(backup);
  return localStorageData ? { ...backup, localStorage: localStorageData } : backup;
}

export async function restoreCompleteProjectBackup(
  backup: CompleteProjectBackup,
): Promise<ProjectBackupImportResult> {
  if (!isCompleteProjectBackup(backup)) {
    throw new Error('备份文件不完整或版本不受支持。');
  }
  if (!isTauriRuntime()) {
    throw new Error('完整项目恢复仅支持桌面版 SQLite 数据库。');
  }

  const result = await dbCall<ProjectBackupImportResult>('import_project_backup', {
    input: { backup },
  });
  try {
    const idMap = mergeLocalStorageIdMap(backup.localStorage, result.idMap);
    await restoreLocalProjectData(backup.localStorage, idMap);
    return { ...result, idMap };
  } catch (error) {
    try {
      await dbCall<void>('discard_imported_project_backup', { novelId: result.novelId });
    } catch (discardError) {
      throw new Error(`补充项目数据恢复失败，且无法撤销已导入作品：${String(discardError)}`);
    }
    throw new Error(`补充项目数据恢复失败，已撤销本次导入：${String(error)}`);
  }
}

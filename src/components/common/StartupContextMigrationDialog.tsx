import type { LegacyChapterContextMigrationResult } from '../../services/context/legacyChapterContextMigrationService';
import { StartupDialogFrame } from './StartupDialogFrame';

export interface StartupContextMigrationState extends LegacyChapterContextMigrationResult {
  error?: string;
}

interface StartupContextMigrationDialogProps {
  migration: StartupContextMigrationState;
  onDismiss: () => void;
}

function totalMigrated(migration: StartupContextMigrationState): number {
  return (
    migration.chapterSummaries.inserted +
    migration.chapterSummaries.matched +
    migration.contextRecords.inserted +
    migration.contextRecords.matched +
    migration.characterStates.inserted +
    migration.characterStates.matched
  );
}

function StartupContextMigrationDialog({
  migration,
  onDismiss,
}: StartupContextMigrationDialogProps) {
  const migrated = totalMigrated(migration);

  const failed = Boolean(migration.error);

  return (
    <StartupDialogFrame
      role={failed ? 'alertdialog' : 'dialog'}
      labelledBy="startup-context-migration-title"
      maxWidth={520}
      onDismiss={onDismiss}
      overlayProps={{
        'data-testid': 'context-migration-dialog',
        'data-migration-status': failed
          ? 'failed'
          : migration.warnings.length > 0
            ? 'warning'
            : 'migrated',
      }}
    >
      <h2 id="startup-context-migration-title" className="startup-dialog-title">
        {failed ? '旧章节上下文迁移失败' : '章节上下文数据已核对'}
      </h2>
      <div className="startup-dialog-message">
        {failed
          ? 'SQLite 没有接管旧本地数据。原始 LocalStorage 记录仍被保留，请不要手动清理浏览器缓存，并查看诊断日志。'
          : `已将 ${migrated} 条旧章节上下文记录写入或匹配到 SQLite。只有确认映射成功的本地记录才会被清理。`}
      </div>
      {migration.warnings.length > 0 && (
        <div
          className="startup-dialog-warning"
          role="alert"
          data-testid="context-migration-warning"
        >
          {migration.warnings.map((warning) => `• ${warning}`).join('\n')}
        </div>
      )}
      <div className="startup-dialog-actions">
        <button
          type="button"
          className="btn btn-primary"
          data-testid="context-migration-dismiss"
          data-startup-dialog-dismiss
          onClick={onDismiss}
        >
          知道了
        </button>
      </div>
    </StartupDialogFrame>
  );
}

export default StartupContextMigrationDialog;

import { useEffect, useState } from 'react';
import type { LegacyChapterContextMigrationResult } from '../../services/context/legacyChapterContextMigrationService';

export interface StartupContextMigrationState extends LegacyChapterContextMigrationResult {
  error?: string;
}

interface StartupContextMigrationDialogProps {
  migration: StartupContextMigrationState;
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

function StartupContextMigrationDialog({ migration }: StartupContextMigrationDialogProps) {
  const migrated = totalMigrated(migration);
  const shouldOpen =
    Boolean(migration.error) ||
    migration.warnings.length > 0 ||
    (migration.performed && migrated > 0);
  const [open, setOpen] = useState(shouldOpen);

  useEffect(() => {
    setOpen(shouldOpen);
  }, [shouldOpen]);

  if (!open) return null;
  const failed = Boolean(migration.error);

  return (
    <div
      className="modal-overlay"
      role={failed ? 'alertdialog' : 'dialog'}
      aria-modal="true"
      aria-labelledby="startup-context-migration-title"
      data-testid="context-migration-dialog"
      data-migration-status={
        failed ? 'failed' : migration.warnings.length > 0 ? 'warning' : 'migrated'
      }
    >
      <div className="modal-dialog" style={{ maxWidth: 520 }}>
        <div id="startup-context-migration-title" className="modal-title">
          {failed ? '旧章节上下文迁移失败' : '章节上下文数据已核对'}
        </div>
        <div
          style={{ whiteSpace: 'pre-wrap', lineHeight: 1.7, color: 'var(--color-text-secondary)' }}
        >
          {failed
            ? 'SQLite 没有接管旧本地数据。原始 LocalStorage 记录仍被保留，请不要手动清理浏览器缓存，并查看诊断日志。'
            : `已将 ${migrated} 条旧章节上下文记录写入或匹配到 SQLite。只有确认映射成功的本地记录才会被清理。`}
        </div>
        {migration.warnings.length > 0 && (
          <div
            role="alert"
            data-testid="context-migration-warning"
            style={{
              marginTop: 12,
              color: 'var(--color-warning)',
              whiteSpace: 'pre-wrap',
              fontSize: 12,
            }}
          >
            {migration.warnings.map((warning) => `• ${warning}`).join('\n')}
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 20 }}>
          <button
            type="button"
            className="btn btn-primary"
            data-testid="context-migration-dismiss"
            onClick={() => setOpen(false)}
          >
            知道了
          </button>
        </div>
      </div>
    </div>
  );
}

export default StartupContextMigrationDialog;

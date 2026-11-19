//! 041 adds bounded authority and immutable application receipts, not runtime statuses.
use crate::errors::AppError;
use rusqlite::Transaction;
pub(crate) const MIGRATION_ID: &str = "041_task_authorizations";
pub(crate) const MIGRATION_DEFINITION: &str = "task_authorizations_v1(trusted_user_scope_action_model_budget_expiry_baseline,revocation_revision,atomic_write_quotas,immutable_operation_receipts,backup_nonexecuting_restore,review_native_baseline_v1,explicit_manual_review_renewal)";
pub(crate) fn apply(tx: &Transaction<'_>) -> Result<(), AppError> {
    tx.execute_batch("ALTER TABLE review_authorizations ADD COLUMN native_baseline_hash TEXT DEFAULT NULL
        CHECK(native_baseline_hash IS NULL OR (length(native_baseline_hash)=64 AND native_baseline_hash NOT GLOB '*[^0-9a-fA-F]*'));
    ALTER TABLE review_authorizations ADD COLUMN renewed_from_authorization_id TEXT DEFAULT NULL REFERENCES review_authorizations(authorization_id) ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED;
    ALTER TABLE review_authorizations ADD COLUMN renewal_preview_json TEXT DEFAULT NULL CHECK(renewal_preview_json IS NULL OR json_valid(renewal_preview_json));
    CREATE UNIQUE INDEX IF NOT EXISTS uq_manual_review_renewal_operation ON artifact_decisions(idempotency_key) WHERE idempotency_key GLOB 'manual-review-renew-v1:*';
    CREATE TRIGGER IF NOT EXISTS trg_review_authorizations_renewal_immutable BEFORE UPDATE OF renewed_from_authorization_id,renewal_preview_json ON review_authorizations
      WHEN NEW.renewed_from_authorization_id IS NOT OLD.renewed_from_authorization_id OR NEW.renewal_preview_json IS NOT OLD.renewal_preview_json
      BEGIN SELECT RAISE(ABORT,'immutable manual review renewal evidence'); END;
    CREATE TRIGGER IF NOT EXISTS trg_review_authorizations_native_baseline_immutable
      BEFORE UPDATE OF native_baseline_hash ON review_authorizations
      WHEN NEW.native_baseline_hash IS NOT OLD.native_baseline_hash
      BEGIN SELECT RAISE(ABORT,'immutable native review baseline'); END;
    CREATE TABLE IF NOT EXISTS task_authorizations (
      authorization_id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, novel_id TEXT NOT NULL,
      source_turn_id TEXT NOT NULL, spec_json TEXT NOT NULL CHECK(json_valid(spec_json)),
      spec_hash TEXT NOT NULL CHECK(length(spec_hash)=64), model_snapshot_json TEXT NOT NULL CHECK(json_valid(model_snapshot_json)),
      model_snapshot_hash TEXT NOT NULL CHECK(length(model_snapshot_hash)=64),
      baseline_json TEXT NOT NULL CHECK(json_valid(baseline_json)), baseline_hash TEXT NOT NULL CHECK(length(baseline_hash)=64),
      status TEXT NOT NULL CHECK(status IN ('active','revoked','expired','exhausted')),
      revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>=1), used_writes INTEGER NOT NULL DEFAULT 0 CHECK(used_writes>=0),
      issued_at TEXT NOT NULL, expires_at TEXT NOT NULL, revoked_at TEXT, revocation_reason TEXT,
      FOREIGN KEY(conversation_id) REFERENCES task_conversations(conversation_id) ON DELETE RESTRICT,
      FOREIGN KEY(novel_id) REFERENCES novels(id) ON DELETE RESTRICT,
      FOREIGN KEY(source_turn_id) REFERENCES conversation_turns(turn_id) ON DELETE RESTRICT
    );
    CREATE INDEX IF NOT EXISTS idx_task_authorizations_task ON task_authorizations(conversation_id,status);
    CREATE TRIGGER IF NOT EXISTS trg_task_authorizations_scope BEFORE INSERT ON task_authorizations
    WHEN NOT EXISTS(SELECT 1 FROM task_conversations c JOIN conversation_turns t ON t.conversation_id=c.conversation_id
      WHERE c.conversation_id=NEW.conversation_id AND c.novel_id=NEW.novel_id AND (NEW.status<>'active' OR c.archived_at IS NULL)
      AND t.turn_id=NEW.source_turn_id AND t.role='user')
    BEGIN SELECT RAISE(ABORT,'invalid task authorization scope'); END;
    CREATE TRIGGER IF NOT EXISTS trg_task_authorizations_identity BEFORE UPDATE ON task_authorizations
    WHEN OLD.authorization_id<>NEW.authorization_id OR OLD.conversation_id<>NEW.conversation_id
      OR OLD.novel_id<>NEW.novel_id OR OLD.source_turn_id<>NEW.source_turn_id OR OLD.spec_json<>NEW.spec_json
      OR OLD.spec_hash<>NEW.spec_hash OR OLD.model_snapshot_json<>NEW.model_snapshot_json
      OR OLD.model_snapshot_hash<>NEW.model_snapshot_hash OR OLD.issued_at<>NEW.issued_at OR OLD.expires_at<>NEW.expires_at
    BEGIN SELECT RAISE(ABORT,'immutable task authorization identity'); END;
    CREATE TRIGGER IF NOT EXISTS trg_task_authorizations_transition BEFORE UPDATE ON task_authorizations
    WHEN NEW.revision<>OLD.revision+1 OR NEW.used_writes<OLD.used_writes
      OR (OLD.status<>'active' AND NEW.status<>OLD.status)
      OR (OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS NOT OLD.revoked_at)
    BEGIN SELECT RAISE(ABORT,'illegal task authorization transition'); END;
    CREATE TABLE IF NOT EXISTS task_authorization_receipts (
      receipt_id TEXT PRIMARY KEY, authorization_id TEXT NOT NULL, operation_id TEXT NOT NULL UNIQUE,
      conversation_id TEXT NOT NULL, novel_id TEXT NOT NULL, artifact_id TEXT NOT NULL, card_id TEXT NOT NULL,
      action TEXT NOT NULL CHECK(action IN ('apply_planning','adopt_chapter_text','apply_summary')),
      request_hash TEXT NOT NULL CHECK(length(request_hash)=64), before_hash TEXT NOT NULL CHECK(length(before_hash)=64),
      after_hash TEXT NOT NULL CHECK(length(after_hash)=64), result_json TEXT NOT NULL CHECK(json_valid(result_json)),
      created_at TEXT NOT NULL,
      FOREIGN KEY(authorization_id) REFERENCES task_authorizations(authorization_id) ON DELETE RESTRICT,
      FOREIGN KEY(conversation_id) REFERENCES task_conversations(conversation_id) ON DELETE RESTRICT,
      FOREIGN KEY(novel_id) REFERENCES novels(id) ON DELETE RESTRICT,
      FOREIGN KEY(artifact_id) REFERENCES result_artifacts(artifact_id) ON DELETE RESTRICT,
      FOREIGN KEY(card_id) REFERENCES conversation_artifact_cards(card_id) ON DELETE RESTRICT
    );
    CREATE INDEX IF NOT EXISTS idx_task_authorization_receipts_grant ON task_authorization_receipts(authorization_id,created_at);
    CREATE TRIGGER IF NOT EXISTS trg_task_authorization_receipts_immutable BEFORE UPDATE ON task_authorization_receipts
    BEGIN SELECT RAISE(ABORT,'immutable task authorization receipt'); END;")
    .map_err(AppError::database)
}

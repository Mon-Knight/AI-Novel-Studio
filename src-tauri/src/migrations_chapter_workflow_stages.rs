//! 040 adds the authoritative, chapter-scoped workflow stage ledger.
//!
//! A workflow is the original user turn; a run is one execution attempt. Stage rows
//! freeze the plan inputs and compare-and-swap one revision at a time. They carry
//! candidate-processing facts only: they never grant formal adoption, replace
//! `result_artifacts`, or make a public tool event authoritative.

use crate::errors::AppError;
use rusqlite::Transaction;

pub(crate) const MIGRATION_ID: &str = "040_chapter_workflow_stages";
pub(crate) const MIGRATION_DEFINITION: &str = "chapter_workflow_stage_v1(user_turn_workflow,run_attempt,plan_version_and_hashes,stage_identity,attempt_revision_cas,pending_running_succeeded_failed_cancelled,terminal_immutable,one_succeeded_per_stage,large_text_or_bounded_json_or_verified_artifact,scoped_foreign_keys)";

pub(crate) fn apply(transaction: &Transaction<'_>) -> Result<(), AppError> {
    transaction
        .execute_batch(
            "CREATE TABLE IF NOT EXISTS chapter_workflow_stages (
                stage_id TEXT PRIMARY KEY,
                workflow_id TEXT NOT NULL,
                conversation_id TEXT NOT NULL,
                novel_id TEXT NOT NULL,
                chapter_id TEXT NOT NULL,
                run_id TEXT NOT NULL,
                stage_key TEXT NOT NULL,
                stage_kind TEXT NOT NULL,
                scene_id TEXT,
                beat_id TEXT,
                plan_version INTEGER NOT NULL,
                model_snapshot_hash TEXT NOT NULL,
                context_hash TEXT NOT NULL,
                base_hash TEXT NOT NULL,
                input_hash TEXT NOT NULL,
                plan_hash TEXT NOT NULL,
                attempt INTEGER NOT NULL,
                status TEXT NOT NULL DEFAULT 'pending',
                revision INTEGER NOT NULL DEFAULT 1,
                result_hash TEXT,
                result_document_id TEXT,
                result_json TEXT,
                verified_artifact_id TEXT,
                error_code TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                CHECK (status IN ('pending','running','succeeded','failed','cancelled')),
                CHECK (stage_kind IN ('scene_plan','beat_plan','beat_write','beat_state','scene_close','chapter_assemble')),
                CHECK (length(trim(stage_key)) > 0 AND length(stage_key) <= 200),
                CHECK (plan_version >= 1),
                CHECK (attempt >= 1 AND revision >= 1),
                CHECK (length(model_snapshot_hash) = 64
                    AND model_snapshot_hash NOT GLOB '*[^0-9a-fA-F]*'),
                CHECK (length(context_hash) = 64 AND context_hash NOT GLOB '*[^0-9a-fA-F]*'),
                CHECK (length(base_hash) = 64 AND base_hash NOT GLOB '*[^0-9a-fA-F]*'),
                CHECK (length(input_hash) = 64 AND input_hash NOT GLOB '*[^0-9a-fA-F]*'),
                CHECK (length(plan_hash) = 64 AND plan_hash NOT GLOB '*[^0-9a-fA-F]*'),
                CHECK (result_hash IS NULL OR
                    (length(result_hash) = 64 AND result_hash NOT GLOB '*[^0-9a-fA-F]*')),
                CHECK (result_json IS NULL OR
                    (json_valid(result_json) AND length(result_json) <= 16384)),
                CHECK (scene_id IS NULL OR length(trim(scene_id)) > 0),
                CHECK (beat_id IS NULL OR length(trim(beat_id)) > 0),
                CHECK (error_code IS NULL OR
                    (length(trim(error_code)) > 0 AND length(error_code) <= 128)),
                CHECK (
                    (status = 'succeeded'
                        AND result_hash IS NOT NULL
                        AND ((result_document_id IS NOT NULL)
                            + (result_json IS NOT NULL)
                            + (verified_artifact_id IS NOT NULL)) = 1)
                    OR
                    (status <> 'succeeded'
                        AND result_hash IS NULL
                        AND result_document_id IS NULL
                        AND result_json IS NULL
                        AND verified_artifact_id IS NULL)
                ),
                CHECK ((status = 'failed' AND error_code IS NOT NULL)
                    OR (status <> 'failed' AND error_code IS NULL)),
                FOREIGN KEY (workflow_id) REFERENCES conversation_turns(turn_id) ON DELETE RESTRICT,
                FOREIGN KEY (conversation_id) REFERENCES task_conversations(conversation_id) ON DELETE RESTRICT,
                FOREIGN KEY (novel_id) REFERENCES novels(id) ON DELETE RESTRICT,
                FOREIGN KEY (chapter_id) REFERENCES chapters(id) ON DELETE RESTRICT,
                FOREIGN KEY (run_id) REFERENCES task_runs(run_id) ON DELETE RESTRICT,
                FOREIGN KEY (result_document_id) REFERENCES large_text_documents(id) ON DELETE RESTRICT,
                FOREIGN KEY (verified_artifact_id) REFERENCES result_artifacts(artifact_id) ON DELETE RESTRICT
            );
            CREATE UNIQUE INDEX IF NOT EXISTS uq_chapter_workflow_stage_attempt
                ON chapter_workflow_stages(workflow_id, stage_key, attempt);
            CREATE UNIQUE INDEX IF NOT EXISTS uq_chapter_workflow_stage_succeeded
                ON chapter_workflow_stages(workflow_id, stage_key)
                WHERE status = 'succeeded';
            CREATE INDEX IF NOT EXISTS idx_chapter_workflow_stages_scope
                ON chapter_workflow_stages(novel_id, chapter_id, created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_chapter_workflow_stages_run
                ON chapter_workflow_stages(run_id, status);
            CREATE INDEX IF NOT EXISTS idx_chapter_workflow_stages_workflow
                ON chapter_workflow_stages(workflow_id, status);

            CREATE TRIGGER IF NOT EXISTS trg_chapter_workflow_stages_validate_insert
                BEFORE INSERT ON chapter_workflow_stages
                WHEN NOT EXISTS (
                    SELECT 1
                    FROM conversation_turns t
                    JOIN task_conversations c ON c.conversation_id = t.conversation_id
                    WHERE t.turn_id = NEW.workflow_id
                      AND t.conversation_id = NEW.conversation_id
                      AND t.role = 'user'
                      AND c.novel_id = NEW.novel_id
                )
                  OR NOT EXISTS (
                      SELECT 1 FROM task_runs r
                      WHERE r.run_id = NEW.run_id
                        AND r.turn_id = NEW.workflow_id
                        AND r.conversation_id = NEW.conversation_id
                        AND r.chapter_id = NEW.chapter_id
                  )
                  OR NOT EXISTS (
                      SELECT 1 FROM chapters ch
                      WHERE ch.id = NEW.chapter_id
                        AND ch.novel_id = NEW.novel_id
                        AND ch.deleted_at IS NULL
                  )
                  OR NOT EXISTS (
                      SELECT 1 FROM novels n
                      WHERE n.id = NEW.novel_id AND n.deleted_at IS NULL
                  )
                BEGIN SELECT RAISE(ABORT, 'invalid chapter workflow stage scope'); END;

            CREATE TRIGGER IF NOT EXISTS trg_chapter_workflow_stages_immutable_identity
                BEFORE UPDATE ON chapter_workflow_stages
                WHEN OLD.stage_id <> NEW.stage_id
                  OR OLD.workflow_id <> NEW.workflow_id
                  OR OLD.conversation_id <> NEW.conversation_id
                  OR OLD.novel_id <> NEW.novel_id
                  OR OLD.chapter_id <> NEW.chapter_id
                  OR OLD.run_id <> NEW.run_id
                  OR OLD.stage_key <> NEW.stage_key
                  OR OLD.stage_kind <> NEW.stage_kind
                  OR OLD.scene_id IS NOT NEW.scene_id
                  OR OLD.beat_id IS NOT NEW.beat_id
                  OR OLD.plan_version <> NEW.plan_version
                  OR OLD.model_snapshot_hash <> NEW.model_snapshot_hash
                  OR OLD.context_hash <> NEW.context_hash
                  OR OLD.base_hash <> NEW.base_hash
                  OR OLD.input_hash <> NEW.input_hash
                  OR OLD.plan_hash <> NEW.plan_hash
                  OR OLD.attempt <> NEW.attempt
                  OR OLD.created_at <> NEW.created_at
                BEGIN SELECT RAISE(ABORT, 'chapter workflow stage identity is immutable'); END;

            CREATE TRIGGER IF NOT EXISTS trg_chapter_workflow_stages_status_edges
                BEFORE UPDATE OF status ON chapter_workflow_stages
                WHEN OLD.status <> NEW.status AND NOT (
                    (OLD.status = 'pending' AND NEW.status IN ('running','cancelled')) OR
                    (OLD.status = 'running' AND NEW.status IN ('succeeded','failed','cancelled'))
                )
                BEGIN SELECT RAISE(ABORT, 'illegal chapter workflow stage transition'); END;

            CREATE TRIGGER IF NOT EXISTS trg_chapter_workflow_stages_terminal_immutable
                BEFORE UPDATE ON chapter_workflow_stages
                WHEN OLD.status IN ('succeeded','failed','cancelled')
                BEGIN SELECT RAISE(ABORT, 'terminal chapter workflow stage is immutable'); END;

            CREATE TRIGGER IF NOT EXISTS trg_chapter_workflow_stages_revision_cas
                BEFORE UPDATE ON chapter_workflow_stages
                WHEN NEW.revision <> OLD.revision + 1
                BEGIN SELECT RAISE(ABORT, 'chapter workflow stage revision must advance exactly once'); END;
            ",
        )
        .map_err(AppError::database)
}

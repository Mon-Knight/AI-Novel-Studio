use crate::errors::{codes, AppError};
use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension, Transaction};
#[cfg(test)]
use serde::Serialize;
use sha2::{Digest, Sha256};

const MIGRATION_VERSION: &str = "3.0.0";

struct Migration {
    id: &'static str,
    definition: &'static str,
    apply: fn(&Transaction<'_>) -> Result<(), AppError>,
}

#[cfg(test)]
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct AppliedMigration {
    pub migration_id: String,
    pub version: String,
    pub checksum: String,
    pub applied_at: String,
}

fn migrations() -> [Migration; 28] {
    [
        Migration {
            id: "001_schema_migrations",
            definition: "schema_migrations(migration_id,version,checksum,applied_at)",
            apply: |_| Ok(()),
        },
        Migration {
            id: "002_workspace_recovery_snapshots",
            definition: "workspace_recovery_snapshots_v1(novel_id,chapter_id,base_draft_id,base_draft_version,base_content_hash,recovery_content,recovery_content_hash,large_text_ref_id,selection_start,selection_end,created_at,updated_at)",
            apply: apply_workspace_recovery,
        },
        Migration {
            id: "003_draft_save_operations",
            definition: "draft_save_operations_v1(operation_id,trace_id,novel_id,chapter_id,draft_id,request_hash,status,result_json,created_at,completed_at)",
            apply: apply_draft_save_operations,
        },
        Migration {
            id: "004_large_text_integrity",
            definition: "large_text_integrity_v1(documents.status,documents.target,chunks.integrity,chapter_drafts.content_hash)",
            apply: apply_large_text_integrity,
        },
        Migration {
            id: "005_ai_tasks",
            definition: "ai_tasks_v2(identity,system_and_owned_scope,status,state_revision,required_snapshot_pointers,validated_current_attempt_link,validated_result_artifact_link,trace,operation,request_hash_version,canonical_request_hash,expected_artifact_contract,target,error,timestamps,indexes,immutable_identity,no_delete,status_edges,completed_requires_valid_artifact)",
            apply: apply_ai_tasks,
        },
        Migration {
            id: "006_ai_task_attempts",
            definition: "ai_task_attempts_v2(task,attempt_number,provider_once,model_once,provider_request_once,status,response_metadata,error,state_revision,timestamps,composite_identity,one_live_attempt,unique_provider_request,indexes,immutable_identity,no_delete,status_edges)",
            apply: apply_ai_task_attempts,
        },
        Migration {
            id: "007_ai_input_snapshots",
            definition: "ai_input_snapshots_v2(task,schema,input_type,valid_json_payload,unique_verified_body_ref,task_bound_source_draft_identity,base_hash,content_hash,created,composite_identity,immutable_update_delete)",
            apply: apply_ai_input_snapshots,
        },
        Migration {
            id: "008_ai_context_snapshots",
            definition: "ai_context_snapshots_v2(task,schema,valid_json_source_manifest,unique_verified_compiled_context_ref,valid_json_budget,compiler_version,content_hash,created,immutable_update_delete)",
            apply: apply_ai_context_snapshots,
        },
        Migration {
            id: "009_ai_constraint_snapshots",
            definition: "ai_constraint_snapshots_v2(task,schema,valid_json_payload,prompt_template_identity,unique_verified_prompt_template_ref,valid_object_provider_options,content_hash,created,immutable_update_delete)",
            apply: apply_ai_constraint_snapshots,
        },
        Migration {
            id: "010_result_artifacts",
            definition: "result_artifacts_v2(task_attempt_composite,input_snapshot,expected_artifact_contract,artifact_type,schema,unique_verified_raw_display_structured_refs,authoritative_snapshot_source_identity,content_hash,length,status,parent_same_task,derivation,created,one_root_per_attempt,immutable_identity_content,no_delete,status_edges,referenced_documents_and_chunks_immutable)",
            apply: apply_result_artifacts,
        },
        Migration {
            id: "011_artifact_validation_issues",
            definition: "artifact_validation_issues_v2(artifact,validation_run,stable_issue_index,severity,code,sanitized_message,path,sanitized_details,validator,created,unique_run_order,indexes,append_only)",
            apply: apply_artifact_validation_issues,
        },
        Migration {
            id: "012_placement_proposals",
            definition: "placement_proposals_v1(artifact,candidate_index,candidate_hash,create_world_setting,target_novel,target_id,expected_target_version_hash,effect_payload,proposal_hash,created,unique_candidate_target,artifact_contract,immutable_no_delete)",
            apply: apply_placement_proposals,
        },
        Migration {
            id: "013_apply_plans",
            definition: "apply_plans_v1(proposal,operation,plan_hash,single_target_precondition,effect_payload,status_revision,explicit_user_confirmation,result_error,timestamps,unique_proposal_operation,immutable_identity,status_edges,no_delete)",
            apply: apply_apply_plans,
        },
        Migration {
            id: "014_artifact_target_links",
            definition: "artifact_target_links_v1(artifact,proposal,apply_plan,world_setting_target,created_from,target_version_hash,created,unique_proposal_plan_target,validated_identity,applied_requires_link,immutable_no_delete)",
            apply: apply_artifact_target_links,
        },
        Migration {
            id: "015_agent_plans",
            definition: "agent_plans_v1(operation_request_idempotency,chapter_readiness_planner,registry_scope,status_revision,result_error,timestamps,validated_chapter_scope,immutable_identity,no_delete,status_edges)",
            apply: apply_agent_plans,
        },
        Migration {
            id: "016_agent_plan_steps",
            definition: "agent_plan_steps_v1(plan_order,tool_registry_identity,input_output_schema_hashes,permissions_scope,canonical_arguments_hash,status_revision,output_hash,error,timestamps,registry_scope_validation,immutable_identity,no_delete,status_edges)",
            apply: apply_agent_plan_steps,
        },
        Migration {
            id: "017_agent_plan_step_dependencies",
            definition: "agent_plan_step_dependencies_v1(plan_step_dependency,stable_order,same_plan_validation,append_only)",
            apply: apply_agent_plan_step_dependencies,
        },
        Migration {
            id: "018_agent_plan_step_attempts",
            definition: "agent_plan_step_attempts_v1(plan_step_attempt_number,lease_epoch,status,output_hash,error,timestamps,one_running_attempt,validated_step_identity,immutable_identity,append_only_terminalization)",
            apply: apply_agent_plan_step_attempts,
        },
        Migration {
            id: "019_agent_execution_leases",
            definition: "agent_execution_leases_v1(plan_epoch,owner,sha256_token_hash,expiry,status,timestamps,one_active_lease,monotonic_epoch,attempt_lease_validation,immutable_identity,no_delete,status_edges)",
            apply: apply_agent_execution_leases,
        },
        Migration {
            id: "020_agent_plan_checkpoints",
            definition: "agent_plan_checkpoints_v1(plan_sequence,event,optional_step_attempt,status_snapshot,payload_hash,created,monotonic_sequence,validated_identity,append_only)",
            apply: apply_agent_plan_checkpoints,
        },
        Migration {
            id: "021_multi_agent_sessions",
            definition: "multi_agent_sessions_v1(identity,operation,scope,source_draft,configuration,status,result,token_totals,timestamps,indexes)",
            apply: apply_multi_agent_sessions,
        },
        Migration {
            id: "022_multi_agent_rounds",
            definition: "multi_agent_rounds_v1(session_round,input_output_draft,consensus,concerns,suggestions,token_totals,timestamps,indexes)",
            apply: apply_multi_agent_rounds,
        },
        Migration {
            id: "023_multi_agent_opinions",
            definition: "multi_agent_opinions_v1(identity,session_round,expert,status,score,verdict,issues,suggestions,provider_task,token_totals,timing,indexes)",
            apply: apply_multi_agent_opinions,
        },
        Migration {
            id: "024_autonomous_story_plans",
            definition: "autonomous_story_plans_v1(identity,operation,novel,request_hash,schema,status,stage,revision,target_and_completed_chapters,validated_plan_json,plan_hash,error,timestamps,indexes,immutable_identity,status_edges)",
            apply: apply_autonomous_story_plans,
        },
        Migration {
            id: "025_reference_library",
            definition: "reference_library_v1(works_scope_revision,immutable_import_versions,current_version_uniqueness,operation_replay_identity,source_and_decoded_hashes,encoding_and_parser_provenance,authoritative_source_text,derived_sections_utf16_ranges,large_text_refs,indexes,foreign_keys)",
            apply: apply_reference_library,
        },
        Migration {
            id: "026_hybrid_semantic_memory",
            definition: "hybrid_semantic_memory_v1(source_version_hash_and_adopted_draft_binding,active_invalidation,scoped_chunks_with_structured_metadata,explicit_model_dimension_bound_vectors,bounded_hybrid_retrieval_logs,optional_fts5_sync,indexes,foreign_keys)",
            apply: apply_hybrid_semantic_memory,
        },
        Migration {
            id: "027_autonomous_book_scheduler",
            definition: "autonomous_book_scheduler_v1(frozen_three_mode_policy,book_and_daily_revisioned_budget_counters,cross_process_hashed_lease_epoch,chapter_attempt_reservations_decisions_and_review_promotions,append_only_checkpoints,restart_recovery,indexes,scope_foreign_keys,status_edges)",
            apply: apply_autonomous_book_scheduler,
        },
        Migration {
            id: "028_multi_target_transactions_and_story_assets",
            definition: "multi_target_transactions_and_story_assets_v1(frozen_ordered_target_set_and_hash,operation_request_idempotency,per_target_base_revision_hash,all_or_nothing_and_explicit_reviewed_partial,prepared_candidates,immediate_cas_apply,replay_target_revalidation,factions,locations,faction_relations,location_hierarchy_and_links,character_chapter_conflict_asset_relations,novel_scope,immutable_identity,revision_cas,indexes,foreign_keys)",
            apply: apply_multi_target_transactions_and_story_assets,
        },
    ]
}

fn checksum(definition: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(definition.as_bytes());
    format!("{:x}", hasher.finalize())
}

fn create_ledger(transaction: &Transaction<'_>) -> Result<(), AppError> {
    transaction
        .execute_batch(
            "CREATE TABLE IF NOT EXISTS schema_migrations (
                migration_id TEXT PRIMARY KEY,
                version TEXT NOT NULL,
                checksum TEXT NOT NULL,
                applied_at TEXT NOT NULL
            );",
        )
        .map_err(AppError::database)
}

pub fn run_migrations(connection: &mut Connection) -> Result<(), AppError> {
    for migration in migrations() {
        let transaction = connection.transaction().map_err(AppError::database)?;
        create_ledger(&transaction)?;
        let expected_checksum = checksum(migration.definition);
        let existing_checksum = transaction
            .query_row(
                "SELECT checksum FROM schema_migrations WHERE migration_id = ?1",
                params![migration.id],
                |row| row.get::<_, String>(0),
            )
            .optional()
            .map_err(AppError::database)?;

        if let Some(actual_checksum) = existing_checksum {
            if actual_checksum != expected_checksum {
                return Err(AppError::new(
                    codes::DATABASE_TRANSACTION_FAILED,
                    "数据库迁移校验失败",
                    false,
                )
                .with_details(serde_json::json!({
                    "migrationId": migration.id,
                    "expectedChecksum": expected_checksum,
                    "actualChecksum": actual_checksum,
                })));
            }
            transaction.commit().map_err(AppError::database)?;
            continue;
        }

        (migration.apply)(&transaction)?;
        transaction
            .execute(
                "INSERT INTO schema_migrations (migration_id, version, checksum, applied_at)
                 VALUES (?1, ?2, ?3, ?4)",
                params![
                    migration.id,
                    MIGRATION_VERSION,
                    expected_checksum,
                    Utc::now().to_rfc3339()
                ],
            )
            .map_err(AppError::database)?;
        transaction.commit().map_err(AppError::database)?;
    }
    Ok(())
}

#[cfg(test)]
pub fn list_applied(connection: &Connection) -> Result<Vec<AppliedMigration>, AppError> {
    let mut statement = connection
        .prepare(
            "SELECT migration_id, version, checksum, applied_at
             FROM schema_migrations ORDER BY migration_id ASC",
        )
        .map_err(AppError::database)?;
    let rows = statement
        .query_map([], |row| {
            Ok(AppliedMigration {
                migration_id: row.get(0)?,
                version: row.get(1)?,
                checksum: row.get(2)?,
                applied_at: row.get(3)?,
            })
        })
        .map_err(AppError::database)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(AppError::database)?;
    Ok(rows)
}

fn apply_workspace_recovery(transaction: &Transaction<'_>) -> Result<(), AppError> {
    transaction
        .execute_batch(
            "CREATE TABLE IF NOT EXISTS workspace_recovery_snapshots (
                novel_id TEXT NOT NULL,
                chapter_id TEXT NOT NULL,
                base_draft_id TEXT,
                base_draft_version INTEGER,
                base_content_hash TEXT,
                recovery_content TEXT NOT NULL,
                recovery_content_hash TEXT NOT NULL,
                large_text_ref_id TEXT,
                selection_start INTEGER,
                selection_end INTEGER,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                PRIMARY KEY (novel_id, chapter_id)
            );
            CREATE INDEX IF NOT EXISTS idx_workspace_recovery_updated_at
            ON workspace_recovery_snapshots(updated_at);",
        )
        .map_err(AppError::database)
}

fn apply_draft_save_operations(transaction: &Transaction<'_>) -> Result<(), AppError> {
    transaction
        .execute_batch(
            "CREATE TABLE IF NOT EXISTS draft_save_operations (
                operation_id TEXT PRIMARY KEY,
                trace_id TEXT,
                novel_id TEXT NOT NULL,
                chapter_id TEXT NOT NULL,
                draft_id TEXT,
                request_hash TEXT NOT NULL,
                status TEXT NOT NULL CHECK (status IN ('started', 'completed', 'failed')),
                result_json TEXT,
                created_at TEXT NOT NULL,
                completed_at TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_draft_save_operations_target
            ON draft_save_operations(novel_id, chapter_id, created_at);",
        )
        .map_err(AppError::database)
}

fn table_has_column(
    transaction: &Transaction<'_>,
    table_name: &str,
    column_name: &str,
) -> Result<bool, AppError> {
    let quoted = table_name.replace('"', "\"\"");
    let mut statement = transaction
        .prepare(&format!("PRAGMA table_info(\"{quoted}\")"))
        .map_err(AppError::database)?;
    let columns = statement
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(AppError::database)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(AppError::database)?;
    Ok(columns.iter().any(|column| column == column_name))
}

fn apply_large_text_integrity(transaction: &Transaction<'_>) -> Result<(), AppError> {
    transaction
        .execute_batch(
            "CREATE TABLE IF NOT EXISTS large_text_documents (
                id TEXT PRIMARY KEY,
                target_type TEXT NOT NULL,
                target_id TEXT,
                field_name TEXT NOT NULL,
                title TEXT,
                total_chars INTEGER NOT NULL DEFAULT 0,
                total_bytes INTEGER NOT NULL DEFAULT 0,
                chunk_count INTEGER NOT NULL DEFAULT 0,
                content_sha256 TEXT,
                storage_type TEXT NOT NULL DEFAULT 'chunked',
                status TEXT NOT NULL DEFAULT 'ready',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS large_text_chunks (
                document_id TEXT NOT NULL,
                chunk_index INTEGER NOT NULL,
                content TEXT NOT NULL,
                char_count INTEGER NOT NULL DEFAULT 0,
                byte_count INTEGER NOT NULL DEFAULT 0,
                chunk_sha256 TEXT,
                created_at TEXT NOT NULL,
                PRIMARY KEY (document_id, chunk_index),
                FOREIGN KEY (document_id) REFERENCES large_text_documents(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_large_text_documents_target
            ON large_text_documents(target_type, target_id, field_name);
            CREATE INDEX IF NOT EXISTS idx_large_text_chunks_document
            ON large_text_chunks(document_id, chunk_index);",
        )
        .map_err(AppError::database)?;

    if !table_has_column(transaction, "large_text_documents", "status")? {
        transaction
            .execute(
                "ALTER TABLE large_text_documents ADD COLUMN status TEXT NOT NULL DEFAULT 'ready'",
                [],
            )
            .map_err(AppError::database)?;
    }
    if !table_has_column(transaction, "chapter_drafts", "content_hash")? {
        transaction
            .execute(
                "ALTER TABLE chapter_drafts ADD COLUMN content_hash TEXT",
                [],
            )
            .map_err(AppError::database)?;
    }
    // v2.1 large-text drafts were finalized before the draft reference was written.
    // Repair only documents that are already referenced by a draft, preserving all bodies.
    transaction
        .execute_batch(
            "UPDATE large_text_documents
             SET target_type = 'draft',
                 target_id = (SELECT d.id FROM chapter_drafts d
                              WHERE d.large_text_ref_id = large_text_documents.id LIMIT 1),
                 field_name = 'content',
                 status = 'ready'
             WHERE id IN (SELECT large_text_ref_id FROM chapter_drafts
                          WHERE large_text_ref_id IS NOT NULL);",
        )
        .map_err(AppError::database)?;
    Ok(())
}

fn apply_ai_tasks(transaction: &Transaction<'_>) -> Result<(), AppError> {
    transaction
        .execute_batch(
            "CREATE TABLE IF NOT EXISTS ai_tasks (
                task_id TEXT PRIMARY KEY,
                task_type TEXT NOT NULL CHECK (length(task_type) BETWEEN 1 AND 96),
                novel_id TEXT NOT NULL,
                chapter_id TEXT,
                draft_id TEXT,
                scope_type TEXT NOT NULL CHECK (scope_type IN ('system','novel','chapter','draft','selection')),
                status TEXT NOT NULL CHECK (status IN (
                    'created','preparing_context','ready','queued','running','validating',
                    'completed','applying','applied','failed','cancel_requested','cancelled'
                )),
                state_revision INTEGER NOT NULL DEFAULT 0 CHECK (state_revision >= 0),
                input_snapshot_id TEXT NOT NULL UNIQUE,
                context_snapshot_id TEXT NOT NULL UNIQUE,
                constraint_snapshot_id TEXT NOT NULL UNIQUE,
                current_attempt_id TEXT UNIQUE,
                result_artifact_id TEXT UNIQUE,
                trace_id TEXT NOT NULL CHECK (length(trace_id) BETWEEN 1 AND 128),
                operation_id TEXT NOT NULL UNIQUE CHECK (length(operation_id) BETWEEN 1 AND 160),
                request_hash_version INTEGER NOT NULL CHECK (request_hash_version >= 1),
                request_hash TEXT NOT NULL CHECK (
                    length(request_hash) = 64 AND request_hash NOT GLOB '*[^0-9a-f]*'
                ),
                expected_artifact_type TEXT NOT NULL
                    CHECK (length(expected_artifact_type) BETWEEN 1 AND 96),
                expected_artifact_schema_version INTEGER NOT NULL
                    CHECK (expected_artifact_schema_version >= 1),
                target_hint_json TEXT,
                error_json TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                started_at TEXT,
                completed_at TEXT,
                applied_at TEXT,
                CHECK (
                    (scope_type = 'system' AND novel_id = 'system' AND chapter_id IS NULL AND draft_id IS NULL) OR
                    (scope_type = 'novel' AND chapter_id IS NULL AND draft_id IS NULL) OR
                    (scope_type = 'chapter' AND chapter_id IS NOT NULL AND draft_id IS NULL) OR
                    (scope_type IN ('draft','selection') AND chapter_id IS NOT NULL AND draft_id IS NOT NULL)
                ),
                CHECK (target_hint_json IS NULL OR json_valid(target_hint_json)),
                CHECK (error_json IS NULL OR json_valid(error_json)),
                FOREIGN KEY (input_snapshot_id) REFERENCES ai_input_snapshots(snapshot_id)
                    ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
                FOREIGN KEY (context_snapshot_id) REFERENCES ai_context_snapshots(snapshot_id)
                    ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
                FOREIGN KEY (constraint_snapshot_id) REFERENCES ai_constraint_snapshots(snapshot_id)
                    ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
                FOREIGN KEY (current_attempt_id) REFERENCES ai_task_attempts(attempt_id)
                    ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
                FOREIGN KEY (result_artifact_id) REFERENCES result_artifacts(artifact_id)
                    ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED
            );
            CREATE INDEX IF NOT EXISTS idx_ai_tasks_novel_status_created
                ON ai_tasks(novel_id, status, created_at);
            CREATE INDEX IF NOT EXISTS idx_ai_tasks_chapter_created
                ON ai_tasks(chapter_id, created_at);
            CREATE INDEX IF NOT EXISTS idx_ai_tasks_trace ON ai_tasks(trace_id);
            CREATE INDEX IF NOT EXISTS idx_ai_tasks_request_hash ON ai_tasks(request_hash);
            CREATE TRIGGER IF NOT EXISTS trg_ai_tasks_immutable_identity
                BEFORE UPDATE OF task_id, task_type, novel_id, chapter_id, draft_id, scope_type,
                    input_snapshot_id, context_snapshot_id, constraint_snapshot_id, trace_id,
                    operation_id, request_hash_version, request_hash, expected_artifact_type,
                    expected_artifact_schema_version, target_hint_json, created_at
                ON ai_tasks BEGIN SELECT RAISE(ABORT, 'immutable task identity'); END;
            CREATE TRIGGER IF NOT EXISTS trg_ai_tasks_no_delete
                BEFORE DELETE ON ai_tasks BEGIN SELECT RAISE(ABORT, 'durable task fact'); END;
            CREATE TRIGGER IF NOT EXISTS trg_ai_tasks_current_attempt_link
                BEFORE UPDATE OF current_attempt_id ON ai_tasks
                WHEN NEW.current_attempt_id IS NULL
                  OR OLD.status NOT IN ('ready','failed')
                  OR NEW.status <> 'queued'
                  OR NOT EXISTS (
                    SELECT 1 FROM ai_task_attempts a
                    WHERE a.attempt_id = NEW.current_attempt_id
                      AND a.task_id = NEW.task_id AND a.status = 'queued'
                  )
                BEGIN SELECT RAISE(ABORT, 'invalid current attempt link'); END;
            CREATE TRIGGER IF NOT EXISTS trg_ai_tasks_result_artifact_link
                BEFORE UPDATE OF result_artifact_id ON ai_tasks
                WHEN NEW.result_artifact_id IS NULL
                  OR OLD.status <> 'validating'
                  OR NEW.status NOT IN ('completed','failed')
                  OR NOT EXISTS (
                    SELECT 1 FROM result_artifacts a
                    WHERE a.artifact_id = NEW.result_artifact_id
                      AND a.task_id = NEW.task_id
                      AND a.attempt_id = NEW.current_attempt_id
                  )
                BEGIN SELECT RAISE(ABORT, 'invalid result artifact link'); END;
            CREATE TRIGGER IF NOT EXISTS trg_ai_tasks_status_edges
                BEFORE UPDATE OF status ON ai_tasks
                WHEN NOT (
                    (OLD.status = 'created' AND NEW.status IN ('preparing_context','ready','failed','cancelled')) OR
                    (OLD.status = 'preparing_context' AND NEW.status IN ('ready','cancel_requested','failed')) OR
                    (OLD.status = 'ready' AND NEW.status IN ('queued','cancelled','failed')) OR
                    (OLD.status = 'queued' AND NEW.status IN ('running','cancel_requested','cancelled','failed')) OR
                    (OLD.status = 'running' AND NEW.status IN ('validating','cancel_requested','failed')) OR
                    (OLD.status = 'validating' AND NEW.status IN ('completed','cancel_requested','failed')) OR
                    (OLD.status = 'completed' AND NEW.status = 'applying') OR
                    (OLD.status = 'applying' AND NEW.status IN ('applied','completed','failed')) OR
                    (OLD.status = 'failed' AND NEW.status = 'queued') OR
                    (OLD.status = 'cancel_requested' AND NEW.status = 'cancelled')
                )
                BEGIN SELECT RAISE(ABORT, 'illegal task status transition'); END;
            CREATE TRIGGER IF NOT EXISTS trg_ai_tasks_validate_target_insert
                BEFORE INSERT ON ai_tasks
                WHEN NEW.scope_type <> 'system' AND (
                    NOT EXISTS (SELECT 1 FROM novels n WHERE n.id = NEW.novel_id AND n.deleted_at IS NULL) OR
                    (NEW.chapter_id IS NOT NULL AND NOT EXISTS (
                        SELECT 1 FROM chapters c WHERE c.id = NEW.chapter_id
                            AND c.novel_id = NEW.novel_id AND c.deleted_at IS NULL
                    )) OR
                    (NEW.draft_id IS NOT NULL AND NOT EXISTS (
                        SELECT 1 FROM chapter_drafts d WHERE d.id = NEW.draft_id
                            AND d.novel_id = NEW.novel_id AND d.chapter_id = NEW.chapter_id
                    ))
                )
                BEGIN SELECT RAISE(ABORT, 'invalid task target ownership'); END;
            CREATE TRIGGER IF NOT EXISTS trg_ai_tasks_completed_artifact
                BEFORE UPDATE OF status ON ai_tasks
                WHEN NEW.status = 'completed' AND NOT EXISTS (
                    SELECT 1 FROM result_artifacts a
                    WHERE a.artifact_id = NEW.result_artifact_id
                      AND a.task_id = NEW.task_id
                      AND a.attempt_id = NEW.current_attempt_id
                      AND a.processing_status IN ('valid','valid_with_warnings')
                )
                BEGIN SELECT RAISE(ABORT, 'completed task requires valid artifact'); END;",
        )
        .map_err(AppError::database)
}

fn apply_ai_task_attempts(transaction: &Transaction<'_>) -> Result<(), AppError> {
    transaction
        .execute_batch(
            "CREATE TABLE IF NOT EXISTS ai_task_attempts (
                attempt_id TEXT PRIMARY KEY,
                task_id TEXT NOT NULL,
                attempt_number INTEGER NOT NULL CHECK (attempt_number >= 1),
                provider_id TEXT,
                model_id TEXT,
                provider_request_id TEXT,
                status TEXT NOT NULL CHECK (status IN (
                    'queued','running','succeeded','failed','cancel_requested','cancelled','late_response_ignored'
                )),
                state_revision INTEGER NOT NULL DEFAULT 0 CHECK (state_revision >= 0),
                response_metadata_json TEXT,
                error_json TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                started_at TEXT,
                finished_at TEXT,
                CHECK (provider_request_id IS NULL OR provider_id IS NOT NULL),
                CHECK (response_metadata_json IS NULL OR json_valid(response_metadata_json)),
                CHECK (error_json IS NULL OR json_valid(error_json)),
                CHECK (
                    status NOT IN ('succeeded','failed','cancelled','late_response_ignored')
                    OR finished_at IS NOT NULL
                ),
                CHECK (status <> 'failed' OR error_json IS NOT NULL),
                FOREIGN KEY (task_id) REFERENCES ai_tasks(task_id) ON DELETE RESTRICT,
                UNIQUE(task_id, attempt_number),
                UNIQUE(task_id, attempt_id)
            );
            CREATE INDEX IF NOT EXISTS idx_ai_task_attempts_task_status
                ON ai_task_attempts(task_id, status, attempt_number);
            CREATE INDEX IF NOT EXISTS idx_ai_task_attempts_provider_request
                ON ai_task_attempts(provider_id, provider_request_id);
            CREATE UNIQUE INDEX IF NOT EXISTS uq_ai_task_attempts_one_live
                ON ai_task_attempts(task_id)
                WHERE status IN ('queued','running','cancel_requested');
            CREATE UNIQUE INDEX IF NOT EXISTS uq_ai_task_attempts_provider_request
                ON ai_task_attempts(provider_id, provider_request_id)
                WHERE provider_id IS NOT NULL AND provider_request_id IS NOT NULL;
            CREATE TRIGGER IF NOT EXISTS trg_ai_task_attempts_immutable_identity
                BEFORE UPDATE OF attempt_id, task_id, attempt_number, created_at
                ON ai_task_attempts BEGIN SELECT RAISE(ABORT, 'immutable attempt identity'); END;
            CREATE TRIGGER IF NOT EXISTS trg_ai_task_attempts_no_delete
                BEFORE DELETE ON ai_task_attempts BEGIN SELECT RAISE(ABORT, 'durable attempt fact'); END;
            CREATE TRIGGER IF NOT EXISTS trg_ai_task_attempts_provider_once
                BEFORE UPDATE OF provider_id, model_id ON ai_task_attempts
                WHEN OLD.provider_id IS NOT NULL OR OLD.model_id IS NOT NULL
                     OR NEW.provider_id IS NULL OR NEW.model_id IS NULL
                BEGIN SELECT RAISE(ABORT, 'immutable provider identity'); END;
            CREATE TRIGGER IF NOT EXISTS trg_ai_task_attempts_provider_request_once
                BEFORE UPDATE OF provider_request_id ON ai_task_attempts
                WHEN OLD.provider_request_id IS NOT NEW.provider_request_id
                     AND (OLD.provider_request_id IS NOT NULL OR NEW.provider_request_id IS NULL)
                BEGIN SELECT RAISE(ABORT, 'immutable provider request identity'); END;
            CREATE TRIGGER IF NOT EXISTS trg_ai_task_attempts_status_edges
                BEFORE UPDATE OF status ON ai_task_attempts
                WHEN NOT (
                    (OLD.status = 'queued' AND NEW.status IN ('running','cancel_requested','cancelled','failed')) OR
                    (OLD.status = 'running' AND NEW.status IN ('succeeded','cancel_requested','failed','late_response_ignored')) OR
                    (OLD.status = 'cancel_requested' AND NEW.status IN ('cancelled','late_response_ignored')) OR
                    (OLD.status = 'cancelled' AND NEW.status = 'late_response_ignored')
                )
                BEGIN SELECT RAISE(ABORT, 'illegal attempt status transition'); END;",
        )
        .map_err(AppError::database)
}

fn apply_ai_input_snapshots(transaction: &Transaction<'_>) -> Result<(), AppError> {
    transaction
        .execute_batch(
            "CREATE TABLE IF NOT EXISTS ai_input_snapshots (
                snapshot_id TEXT PRIMARY KEY,
                task_id TEXT NOT NULL UNIQUE,
                schema_version INTEGER NOT NULL CHECK (schema_version >= 1),
                input_type TEXT NOT NULL CHECK (length(input_type) BETWEEN 1 AND 96),
                payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
                body_ref_id TEXT NOT NULL UNIQUE,
                source_draft_id TEXT,
                source_draft_version INTEGER,
                base_content_hash TEXT,
                content_hash TEXT NOT NULL CHECK (
                    length(content_hash) = 64 AND content_hash NOT GLOB '*[^0-9a-f]*'
                ),
                created_at TEXT NOT NULL,
                CHECK (
                    (source_draft_id IS NULL AND source_draft_version IS NULL AND base_content_hash IS NULL) OR
                    (source_draft_id IS NOT NULL AND source_draft_version >= 1 AND
                     length(base_content_hash) = 64 AND base_content_hash NOT GLOB '*[^0-9a-f]*')
                ),
                FOREIGN KEY (task_id) REFERENCES ai_tasks(task_id) ON DELETE RESTRICT
                    DEFERRABLE INITIALLY DEFERRED,
                FOREIGN KEY (body_ref_id) REFERENCES large_text_documents(id) ON DELETE RESTRICT,
                UNIQUE(task_id, snapshot_id)
            );
            CREATE INDEX IF NOT EXISTS idx_ai_input_snapshots_source
                ON ai_input_snapshots(source_draft_id, source_draft_version, base_content_hash);
            CREATE TRIGGER IF NOT EXISTS trg_ai_input_snapshots_immutable_update
                BEFORE UPDATE ON ai_input_snapshots BEGIN SELECT RAISE(ABORT, 'immutable snapshot'); END;
            CREATE TRIGGER IF NOT EXISTS trg_ai_input_snapshots_immutable_delete
                BEFORE DELETE ON ai_input_snapshots BEGIN SELECT RAISE(ABORT, 'immutable snapshot'); END;
            CREATE TRIGGER IF NOT EXISTS trg_ai_input_snapshots_validate_insert
                BEFORE INSERT ON ai_input_snapshots
                WHEN NOT EXISTS (
                    SELECT 1 FROM ai_tasks t
                    WHERE t.task_id = NEW.task_id
                      AND t.input_snapshot_id = NEW.snapshot_id
                      AND t.draft_id IS NEW.source_draft_id
                ) OR NOT EXISTS (
                    SELECT 1 FROM large_text_documents d
                    WHERE d.id = NEW.body_ref_id AND d.target_type = 'ai_snapshot'
                      AND d.target_id = NEW.snapshot_id AND d.field_name = 'input_body'
                      AND d.status = 'ready' AND d.content_sha256 IS NOT NULL
                )
                BEGIN SELECT RAISE(ABORT, 'invalid input snapshot identity'); END;",
        )
        .map_err(AppError::database)
}

fn apply_ai_context_snapshots(transaction: &Transaction<'_>) -> Result<(), AppError> {
    transaction
        .execute_batch(
            "CREATE TABLE IF NOT EXISTS ai_context_snapshots (
                snapshot_id TEXT PRIMARY KEY,
                task_id TEXT NOT NULL UNIQUE,
                schema_version INTEGER NOT NULL CHECK (schema_version >= 1),
                source_manifest_json TEXT NOT NULL CHECK (json_valid(source_manifest_json)),
                compiled_context_ref_id TEXT NOT NULL UNIQUE,
                budget_json TEXT NOT NULL CHECK (json_valid(budget_json)),
                compiler_version TEXT NOT NULL CHECK (length(compiler_version) BETWEEN 1 AND 96),
                content_hash TEXT NOT NULL CHECK (
                    length(content_hash) = 64 AND content_hash NOT GLOB '*[^0-9a-f]*'
                ),
                created_at TEXT NOT NULL,
                FOREIGN KEY (task_id) REFERENCES ai_tasks(task_id) ON DELETE RESTRICT
                    DEFERRABLE INITIALLY DEFERRED,
                FOREIGN KEY (compiled_context_ref_id) REFERENCES large_text_documents(id) ON DELETE RESTRICT
            );
            CREATE INDEX IF NOT EXISTS idx_ai_context_snapshots_hash
                ON ai_context_snapshots(content_hash, compiler_version);
            CREATE TRIGGER IF NOT EXISTS trg_ai_context_snapshots_immutable_update
                BEFORE UPDATE ON ai_context_snapshots BEGIN SELECT RAISE(ABORT, 'immutable snapshot'); END;
            CREATE TRIGGER IF NOT EXISTS trg_ai_context_snapshots_immutable_delete
                BEFORE DELETE ON ai_context_snapshots BEGIN SELECT RAISE(ABORT, 'immutable snapshot'); END;
            CREATE TRIGGER IF NOT EXISTS trg_ai_context_snapshots_validate_insert
                BEFORE INSERT ON ai_context_snapshots
                WHEN NOT EXISTS (
                    SELECT 1 FROM ai_tasks t
                    WHERE t.task_id = NEW.task_id AND t.context_snapshot_id = NEW.snapshot_id
                ) OR NOT EXISTS (
                    SELECT 1 FROM large_text_documents d
                    WHERE d.id = NEW.compiled_context_ref_id AND d.target_type = 'ai_snapshot'
                      AND d.target_id = NEW.snapshot_id AND d.field_name = 'compiled_context'
                      AND d.status = 'ready' AND d.content_sha256 IS NOT NULL
                )
                BEGIN SELECT RAISE(ABORT, 'invalid context snapshot identity'); END;",
        )
        .map_err(AppError::database)
}

fn apply_ai_constraint_snapshots(transaction: &Transaction<'_>) -> Result<(), AppError> {
    transaction
        .execute_batch(
            "CREATE TABLE IF NOT EXISTS ai_constraint_snapshots (
                snapshot_id TEXT PRIMARY KEY,
                task_id TEXT NOT NULL UNIQUE,
                schema_version INTEGER NOT NULL CHECK (schema_version >= 1),
                payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
                prompt_template_id TEXT NOT NULL CHECK (length(prompt_template_id) BETWEEN 1 AND 160),
                prompt_template_version TEXT NOT NULL CHECK (length(prompt_template_version) BETWEEN 1 AND 96),
                prompt_template_hash TEXT NOT NULL CHECK (
                    length(prompt_template_hash) = 64 AND prompt_template_hash NOT GLOB '*[^0-9a-f]*'
                ),
                prompt_template_ref_id TEXT NOT NULL UNIQUE,
                provider_options_json TEXT NOT NULL CHECK (
                    json_valid(provider_options_json) AND json_type(provider_options_json) = 'object'
                ),
                content_hash TEXT NOT NULL CHECK (
                    length(content_hash) = 64 AND content_hash NOT GLOB '*[^0-9a-f]*'
                ),
                created_at TEXT NOT NULL,
                FOREIGN KEY (task_id) REFERENCES ai_tasks(task_id) ON DELETE RESTRICT
                    DEFERRABLE INITIALLY DEFERRED,
                FOREIGN KEY (prompt_template_ref_id) REFERENCES large_text_documents(id) ON DELETE RESTRICT
            );
            CREATE INDEX IF NOT EXISTS idx_ai_constraint_snapshots_template
                ON ai_constraint_snapshots(prompt_template_id, prompt_template_version, prompt_template_hash);
            CREATE TRIGGER IF NOT EXISTS trg_ai_constraint_snapshots_immutable_update
                BEFORE UPDATE ON ai_constraint_snapshots BEGIN SELECT RAISE(ABORT, 'immutable snapshot'); END;
            CREATE TRIGGER IF NOT EXISTS trg_ai_constraint_snapshots_immutable_delete
                BEFORE DELETE ON ai_constraint_snapshots BEGIN SELECT RAISE(ABORT, 'immutable snapshot'); END;
            CREATE TRIGGER IF NOT EXISTS trg_ai_constraint_snapshots_validate_insert
                BEFORE INSERT ON ai_constraint_snapshots
                WHEN NOT EXISTS (
                    SELECT 1 FROM ai_tasks t
                    WHERE t.task_id = NEW.task_id AND t.constraint_snapshot_id = NEW.snapshot_id
                ) OR NOT EXISTS (
                    SELECT 1 FROM large_text_documents d
                    WHERE d.id = NEW.prompt_template_ref_id AND d.target_type = 'ai_snapshot'
                      AND d.target_id = NEW.snapshot_id AND d.field_name = 'prompt_template'
                      AND d.status = 'ready' AND d.content_sha256 = NEW.prompt_template_hash
                )
                BEGIN SELECT RAISE(ABORT, 'invalid constraint snapshot identity'); END;",
        )
        .map_err(AppError::database)
}

fn apply_result_artifacts(transaction: &Transaction<'_>) -> Result<(), AppError> {
    transaction
        .execute_batch(
            "CREATE TABLE IF NOT EXISTS result_artifacts (
                artifact_id TEXT PRIMARY KEY,
                task_id TEXT NOT NULL,
                attempt_id TEXT NOT NULL,
                source_input_snapshot_id TEXT NOT NULL,
                artifact_type TEXT NOT NULL CHECK (length(artifact_type) BETWEEN 1 AND 96),
                schema_version INTEGER NOT NULL CHECK (schema_version >= 1),
                raw_content_ref_id TEXT NOT NULL UNIQUE,
                display_content_ref_id TEXT UNIQUE,
                display_content_hash TEXT,
                structured_payload_ref_id TEXT UNIQUE,
                structured_payload_hash TEXT,
                source_novel_id TEXT NOT NULL,
                source_chapter_id TEXT,
                source_draft_id TEXT,
                source_draft_version INTEGER,
                source_base_content_hash TEXT,
                content_hash TEXT NOT NULL CHECK (
                    length(content_hash) = 64 AND content_hash NOT GLOB '*[^0-9a-f]*'
                ),
                content_length INTEGER NOT NULL CHECK (content_length >= 0),
                processing_status TEXT NOT NULL CHECK (processing_status IN (
                    'raw','parsing','valid','valid_with_warnings','invalid'
                )),
                parent_artifact_id TEXT,
                derivation_type TEXT,
                created_at TEXT NOT NULL,
                CHECK (
                    (display_content_ref_id IS NULL AND display_content_hash IS NULL) OR
                    (display_content_ref_id IS NOT NULL AND length(display_content_hash) = 64 AND
                     display_content_hash NOT GLOB '*[^0-9a-f]*')
                ),
                CHECK (
                    (structured_payload_ref_id IS NULL AND structured_payload_hash IS NULL) OR
                    (structured_payload_ref_id IS NOT NULL AND length(structured_payload_hash) = 64 AND
                     structured_payload_hash NOT GLOB '*[^0-9a-f]*')
                ),
                CHECK (
                    (source_draft_id IS NULL AND source_draft_version IS NULL AND source_base_content_hash IS NULL) OR
                    (source_draft_id IS NOT NULL AND source_draft_version >= 1 AND
                     length(source_base_content_hash) = 64 AND source_base_content_hash NOT GLOB '*[^0-9a-f]*')
                ),
                CHECK (
                    (parent_artifact_id IS NULL AND derivation_type IS NULL) OR
                    (parent_artifact_id IS NOT NULL AND length(derivation_type) BETWEEN 1 AND 96)
                ),
                CHECK (display_content_ref_id IS NULL OR display_content_ref_id <> raw_content_ref_id),
                FOREIGN KEY (task_id, attempt_id) REFERENCES ai_task_attempts(task_id, attempt_id)
                    ON DELETE RESTRICT,
                FOREIGN KEY (task_id, source_input_snapshot_id)
                    REFERENCES ai_input_snapshots(task_id, snapshot_id) ON DELETE RESTRICT,
                FOREIGN KEY (raw_content_ref_id) REFERENCES large_text_documents(id) ON DELETE RESTRICT,
                FOREIGN KEY (display_content_ref_id) REFERENCES large_text_documents(id) ON DELETE RESTRICT,
                FOREIGN KEY (structured_payload_ref_id) REFERENCES large_text_documents(id) ON DELETE RESTRICT,
                FOREIGN KEY (task_id, parent_artifact_id) REFERENCES result_artifacts(task_id, artifact_id)
                    ON DELETE RESTRICT,
                UNIQUE(task_id, artifact_id)
            );
            CREATE INDEX IF NOT EXISTS idx_result_artifacts_task_created
                ON result_artifacts(task_id, created_at);
            CREATE INDEX IF NOT EXISTS idx_result_artifacts_attempt
                ON result_artifacts(task_id, attempt_id, created_at);
            CREATE INDEX IF NOT EXISTS idx_result_artifacts_status_hash
                ON result_artifacts(processing_status, content_hash);
            CREATE UNIQUE INDEX IF NOT EXISTS uq_result_artifacts_attempt_root
                ON result_artifacts(attempt_id) WHERE parent_artifact_id IS NULL;
            CREATE TRIGGER IF NOT EXISTS trg_result_artifacts_immutable_content
                BEFORE UPDATE OF artifact_id, task_id, attempt_id, source_input_snapshot_id,
                    artifact_type, schema_version, raw_content_ref_id, display_content_ref_id,
                    display_content_hash, structured_payload_ref_id, structured_payload_hash,
                    source_novel_id, source_chapter_id, source_draft_id, source_draft_version,
                    source_base_content_hash, content_hash, content_length, parent_artifact_id,
                    derivation_type, created_at
                ON result_artifacts BEGIN SELECT RAISE(ABORT, 'immutable artifact'); END;
            CREATE TRIGGER IF NOT EXISTS trg_result_artifacts_immutable_delete
                BEFORE DELETE ON result_artifacts BEGIN SELECT RAISE(ABORT, 'immutable artifact'); END;
            CREATE TRIGGER IF NOT EXISTS trg_result_artifacts_status_edges
                BEFORE UPDATE OF processing_status ON result_artifacts
                WHEN NOT (
                    (OLD.processing_status = 'raw' AND NEW.processing_status IN (
                        'parsing','valid','valid_with_warnings','invalid'
                    )) OR
                    (OLD.processing_status = 'parsing' AND NEW.processing_status IN (
                        'valid','valid_with_warnings','invalid'
                    ))
                )
                BEGIN SELECT RAISE(ABORT, 'illegal artifact status transition'); END;
            CREATE TRIGGER IF NOT EXISTS trg_result_artifacts_validate_insert
                BEFORE INSERT ON result_artifacts
                WHEN NOT EXISTS (
                    SELECT 1 FROM ai_tasks t
                    JOIN ai_input_snapshots s ON s.task_id = t.task_id
                    WHERE t.task_id = NEW.task_id
                      AND t.current_attempt_id = NEW.attempt_id
                      AND t.status = 'validating'
                      AND t.expected_artifact_type = NEW.artifact_type
                      AND t.expected_artifact_schema_version = NEW.schema_version
                      AND s.snapshot_id = NEW.source_input_snapshot_id
                      AND t.novel_id = NEW.source_novel_id
                      AND t.chapter_id IS NEW.source_chapter_id
                      AND s.source_draft_id IS NEW.source_draft_id
                      AND s.source_draft_version IS NEW.source_draft_version
                      AND s.base_content_hash IS NEW.source_base_content_hash
                ) OR NOT EXISTS (
                    SELECT 1 FROM large_text_documents d
                    WHERE d.id = NEW.raw_content_ref_id AND d.target_type = 'result_artifact'
                      AND d.target_id = NEW.artifact_id AND d.field_name = 'raw_content'
                      AND d.status = 'ready' AND d.content_sha256 = NEW.content_hash
                      AND d.total_chars = NEW.content_length
                ) OR (
                    NEW.display_content_ref_id IS NOT NULL AND NOT EXISTS (
                        SELECT 1 FROM large_text_documents d
                        WHERE d.id = NEW.display_content_ref_id AND d.target_type = 'result_artifact'
                          AND d.target_id = NEW.artifact_id AND d.field_name = 'display_content'
                          AND d.status = 'ready' AND d.content_sha256 = NEW.display_content_hash
                    )
                ) OR (
                    NEW.structured_payload_ref_id IS NOT NULL AND NOT EXISTS (
                        SELECT 1 FROM large_text_documents d
                        WHERE d.id = NEW.structured_payload_ref_id AND d.target_type = 'result_artifact'
                          AND d.target_id = NEW.artifact_id AND d.field_name = 'structured_payload'
                          AND d.status = 'ready' AND d.content_sha256 = NEW.structured_payload_hash
                    )
                )
                BEGIN SELECT RAISE(ABORT, 'invalid artifact identity'); END;
            CREATE TRIGGER IF NOT EXISTS trg_ai_large_text_documents_immutable_update
                BEFORE UPDATE ON large_text_documents
                WHEN OLD.id IN (
                    SELECT body_ref_id FROM ai_input_snapshots
                    UNION SELECT compiled_context_ref_id FROM ai_context_snapshots
                    UNION SELECT prompt_template_ref_id FROM ai_constraint_snapshots
                    UNION SELECT raw_content_ref_id FROM result_artifacts
                    UNION SELECT display_content_ref_id FROM result_artifacts WHERE display_content_ref_id IS NOT NULL
                    UNION SELECT structured_payload_ref_id FROM result_artifacts WHERE structured_payload_ref_id IS NOT NULL
                )
                BEGIN SELECT RAISE(ABORT, 'immutable referenced AI document'); END;
            CREATE TRIGGER IF NOT EXISTS trg_ai_large_text_documents_immutable_delete
                BEFORE DELETE ON large_text_documents
                WHEN OLD.id IN (
                    SELECT body_ref_id FROM ai_input_snapshots
                    UNION SELECT compiled_context_ref_id FROM ai_context_snapshots
                    UNION SELECT prompt_template_ref_id FROM ai_constraint_snapshots
                    UNION SELECT raw_content_ref_id FROM result_artifacts
                    UNION SELECT display_content_ref_id FROM result_artifacts WHERE display_content_ref_id IS NOT NULL
                    UNION SELECT structured_payload_ref_id FROM result_artifacts WHERE structured_payload_ref_id IS NOT NULL
                )
                BEGIN SELECT RAISE(ABORT, 'immutable referenced AI document'); END;
            CREATE TRIGGER IF NOT EXISTS trg_ai_large_text_chunks_immutable_insert
                BEFORE INSERT ON large_text_chunks
                WHEN NEW.document_id IN (
                    SELECT body_ref_id FROM ai_input_snapshots
                    UNION SELECT compiled_context_ref_id FROM ai_context_snapshots
                    UNION SELECT prompt_template_ref_id FROM ai_constraint_snapshots
                    UNION SELECT raw_content_ref_id FROM result_artifacts
                    UNION SELECT display_content_ref_id FROM result_artifacts WHERE display_content_ref_id IS NOT NULL
                    UNION SELECT structured_payload_ref_id FROM result_artifacts WHERE structured_payload_ref_id IS NOT NULL
                )
                BEGIN SELECT RAISE(ABORT, 'immutable referenced AI chunks'); END;
            CREATE TRIGGER IF NOT EXISTS trg_ai_large_text_chunks_immutable_update
                BEFORE UPDATE ON large_text_chunks
                WHEN OLD.document_id IN (
                    SELECT body_ref_id FROM ai_input_snapshots
                    UNION SELECT compiled_context_ref_id FROM ai_context_snapshots
                    UNION SELECT prompt_template_ref_id FROM ai_constraint_snapshots
                    UNION SELECT raw_content_ref_id FROM result_artifacts
                    UNION SELECT display_content_ref_id FROM result_artifacts WHERE display_content_ref_id IS NOT NULL
                    UNION SELECT structured_payload_ref_id FROM result_artifacts WHERE structured_payload_ref_id IS NOT NULL
                )
                BEGIN SELECT RAISE(ABORT, 'immutable referenced AI chunks'); END;
            CREATE TRIGGER IF NOT EXISTS trg_ai_large_text_chunks_immutable_delete
                BEFORE DELETE ON large_text_chunks
                WHEN OLD.document_id IN (
                    SELECT body_ref_id FROM ai_input_snapshots
                    UNION SELECT compiled_context_ref_id FROM ai_context_snapshots
                    UNION SELECT prompt_template_ref_id FROM ai_constraint_snapshots
                    UNION SELECT raw_content_ref_id FROM result_artifacts
                    UNION SELECT display_content_ref_id FROM result_artifacts WHERE display_content_ref_id IS NOT NULL
                    UNION SELECT structured_payload_ref_id FROM result_artifacts WHERE structured_payload_ref_id IS NOT NULL
                )
                BEGIN SELECT RAISE(ABORT, 'immutable referenced AI chunks'); END;",
        )
        .map_err(AppError::database)
}

fn apply_artifact_validation_issues(transaction: &Transaction<'_>) -> Result<(), AppError> {
    transaction
        .execute_batch(
            "CREATE TABLE IF NOT EXISTS artifact_validation_issues (
                issue_id TEXT PRIMARY KEY,
                artifact_id TEXT NOT NULL,
                validation_run_id TEXT NOT NULL CHECK (length(validation_run_id) BETWEEN 1 AND 160),
                issue_index INTEGER NOT NULL CHECK (issue_index >= 0),
                severity TEXT NOT NULL CHECK (severity IN ('warning','error')),
                code TEXT NOT NULL CHECK (length(code) BETWEEN 1 AND 96),
                message TEXT NOT NULL CHECK (length(message) BETWEEN 1 AND 1024),
                json_path TEXT CHECK (json_path IS NULL OR length(json_path) <= 512),
                details_json TEXT CHECK (details_json IS NULL OR length(details_json) <= 8192),
                validator_version TEXT NOT NULL CHECK (length(validator_version) BETWEEN 1 AND 96),
                created_at TEXT NOT NULL,
                FOREIGN KEY (artifact_id) REFERENCES result_artifacts(artifact_id) ON DELETE RESTRICT,
                UNIQUE(artifact_id, validation_run_id, issue_index)
            );
            CREATE INDEX IF NOT EXISTS idx_artifact_validation_artifact
                ON artifact_validation_issues(artifact_id, validation_run_id, issue_index);
            CREATE INDEX IF NOT EXISTS idx_artifact_validation_code
                ON artifact_validation_issues(code, created_at);
            CREATE TRIGGER IF NOT EXISTS trg_artifact_validation_issues_append_only_update
                BEFORE UPDATE ON artifact_validation_issues BEGIN SELECT RAISE(ABORT, 'append-only issue'); END;
            CREATE TRIGGER IF NOT EXISTS trg_artifact_validation_issues_append_only_delete
                BEFORE DELETE ON artifact_validation_issues BEGIN SELECT RAISE(ABORT, 'append-only issue'); END;",
        )
        .map_err(AppError::database)
}

fn apply_placement_proposals(transaction: &Transaction<'_>) -> Result<(), AppError> {
    transaction
        .execute_batch(
            "CREATE TABLE IF NOT EXISTS placement_proposals (
                proposal_id TEXT PRIMARY KEY,
                artifact_id TEXT NOT NULL,
                candidate_index INTEGER NOT NULL CHECK (candidate_index >= 0),
                candidate_hash TEXT NOT NULL CHECK (
                    length(candidate_hash) = 64 AND candidate_hash NOT GLOB '*[^0-9a-f]*'
                ),
                proposal_type TEXT NOT NULL CHECK (proposal_type = 'create_world_setting'),
                target_type TEXT NOT NULL CHECK (target_type = 'world_setting'),
                target_novel_id TEXT NOT NULL CHECK (length(target_novel_id) BETWEEN 1 AND 160),
                target_id TEXT NOT NULL UNIQUE CHECK (length(target_id) BETWEEN 1 AND 160),
                expected_target_version INTEGER NOT NULL CHECK (expected_target_version = 0),
                expected_target_hash TEXT NOT NULL CHECK (
                    length(expected_target_hash) = 64
                    AND expected_target_hash NOT GLOB '*[^0-9a-f]*'
                ),
                effect_payload_json TEXT NOT NULL CHECK (
                    json_valid(effect_payload_json) AND json_type(effect_payload_json) = 'object'
                    AND length(effect_payload_json) <= 65536
                ),
                proposal_hash TEXT NOT NULL CHECK (
                    length(proposal_hash) = 64 AND proposal_hash NOT GLOB '*[^0-9a-f]*'
                ),
                created_at TEXT NOT NULL,
                FOREIGN KEY (artifact_id) REFERENCES result_artifacts(artifact_id) ON DELETE RESTRICT,
                UNIQUE(artifact_id, candidate_index)
            );
            CREATE INDEX IF NOT EXISTS idx_placement_proposals_artifact
                ON placement_proposals(artifact_id, candidate_index);
            CREATE INDEX IF NOT EXISTS idx_placement_proposals_target
                ON placement_proposals(target_type, target_id);
            CREATE TRIGGER IF NOT EXISTS trg_placement_proposals_validate_artifact
                BEFORE INSERT ON placement_proposals
                WHEN NOT EXISTS (
                    SELECT 1 FROM result_artifacts a
                    WHERE a.artifact_id = NEW.artifact_id
                      AND a.artifact_type = 'setting_candidates'
                      AND a.schema_version = 1
                      AND a.processing_status IN ('valid','valid_with_warnings')
                      AND a.source_novel_id = NEW.target_novel_id
                )
                BEGIN SELECT RAISE(ABORT, 'invalid placement artifact'); END;
            CREATE TRIGGER IF NOT EXISTS trg_placement_proposals_immutable_update
                BEFORE UPDATE ON placement_proposals
                BEGIN SELECT RAISE(ABORT, 'immutable placement proposal'); END;
            CREATE TRIGGER IF NOT EXISTS trg_placement_proposals_no_delete
                BEFORE DELETE ON placement_proposals
                BEGIN SELECT RAISE(ABORT, 'durable placement proposal'); END;",
        )
        .map_err(AppError::database)
}

fn apply_apply_plans(transaction: &Transaction<'_>) -> Result<(), AppError> {
    transaction
        .execute_batch(
            "CREATE TABLE IF NOT EXISTS apply_plans (
                plan_id TEXT PRIMARY KEY,
                proposal_id TEXT NOT NULL UNIQUE,
                operation_id TEXT NOT NULL UNIQUE CHECK (length(operation_id) BETWEEN 1 AND 160),
                plan_hash TEXT NOT NULL CHECK (
                    length(plan_hash) = 64 AND plan_hash NOT GLOB '*[^0-9a-f]*'
                ),
                target_type TEXT NOT NULL CHECK (target_type = 'world_setting'),
                target_id TEXT NOT NULL CHECK (length(target_id) BETWEEN 1 AND 160),
                expected_target_version INTEGER NOT NULL CHECK (expected_target_version = 0),
                expected_target_hash TEXT NOT NULL CHECK (
                    length(expected_target_hash) = 64
                    AND expected_target_hash NOT GLOB '*[^0-9a-f]*'
                ),
                effect_payload_json TEXT NOT NULL CHECK (
                    json_valid(effect_payload_json) AND json_type(effect_payload_json) = 'object'
                    AND length(effect_payload_json) <= 65536
                ),
                status TEXT NOT NULL CHECK (
                    status IN ('awaiting_confirmation','applying','applied','conflict')
                ),
                state_revision INTEGER NOT NULL DEFAULT 0 CHECK (state_revision >= 0),
                confirmed_by TEXT CHECK (confirmed_by IS NULL OR confirmed_by = 'user'),
                user_confirmed_at TEXT,
                result_json TEXT CHECK (result_json IS NULL OR json_valid(result_json)),
                error_json TEXT CHECK (error_json IS NULL OR json_valid(error_json)),
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                applied_at TEXT,
                CHECK (
                    (status = 'awaiting_confirmation' AND confirmed_by IS NULL
                        AND user_confirmed_at IS NULL AND applied_at IS NULL) OR
                    (status IN ('applying','conflict') AND confirmed_by = 'user'
                        AND user_confirmed_at IS NOT NULL AND applied_at IS NULL) OR
                    (status = 'applied' AND confirmed_by = 'user'
                        AND user_confirmed_at IS NOT NULL AND applied_at IS NOT NULL
                        AND result_json IS NOT NULL)
                ),
                FOREIGN KEY (proposal_id) REFERENCES placement_proposals(proposal_id)
                    ON DELETE RESTRICT
            );
            CREATE INDEX IF NOT EXISTS idx_apply_plans_status
                ON apply_plans(status, created_at);
            CREATE INDEX IF NOT EXISTS idx_apply_plans_target
                ON apply_plans(target_type, target_id);
            CREATE TRIGGER IF NOT EXISTS trg_apply_plans_validate_proposal
                BEFORE INSERT ON apply_plans
                WHEN NOT EXISTS (
                    SELECT 1 FROM placement_proposals p
                    WHERE p.proposal_id = NEW.proposal_id
                      AND p.target_type = NEW.target_type
                      AND p.target_id = NEW.target_id
                      AND p.expected_target_version = NEW.expected_target_version
                      AND p.expected_target_hash = NEW.expected_target_hash
                      AND p.effect_payload_json = NEW.effect_payload_json
                )
                BEGIN SELECT RAISE(ABORT, 'invalid apply plan proposal'); END;
            CREATE TRIGGER IF NOT EXISTS trg_apply_plans_immutable_identity
                BEFORE UPDATE OF plan_id, proposal_id, operation_id, plan_hash, target_type,
                    target_id, expected_target_version, expected_target_hash,
                    effect_payload_json, created_at
                ON apply_plans
                BEGIN SELECT RAISE(ABORT, 'immutable apply plan identity'); END;
            CREATE TRIGGER IF NOT EXISTS trg_apply_plans_confirmation_once
                BEFORE UPDATE OF confirmed_by, user_confirmed_at ON apply_plans
                WHEN OLD.confirmed_by IS NOT NULL OR OLD.user_confirmed_at IS NOT NULL
                  OR NEW.confirmed_by <> 'user' OR NEW.user_confirmed_at IS NULL
                BEGIN SELECT RAISE(ABORT, 'invalid apply confirmation'); END;
            CREATE TRIGGER IF NOT EXISTS trg_apply_plans_status_edges
                BEFORE UPDATE OF status ON apply_plans
                WHEN NOT (
                    (OLD.status = 'awaiting_confirmation' AND NEW.status = 'applying') OR
                    (OLD.status = 'applying' AND NEW.status IN ('applied','conflict'))
                )
                BEGIN SELECT RAISE(ABORT, 'illegal apply plan transition'); END;
            CREATE TRIGGER IF NOT EXISTS trg_apply_plans_no_delete
                BEFORE DELETE ON apply_plans
                BEGIN SELECT RAISE(ABORT, 'durable apply plan'); END;",
        )
        .map_err(AppError::database)
}

fn apply_artifact_target_links(transaction: &Transaction<'_>) -> Result<(), AppError> {
    transaction
        .execute_batch(
            "CREATE TABLE IF NOT EXISTS artifact_target_links (
                link_id TEXT PRIMARY KEY,
                artifact_id TEXT NOT NULL,
                proposal_id TEXT NOT NULL UNIQUE,
                apply_plan_id TEXT NOT NULL UNIQUE,
                target_type TEXT NOT NULL CHECK (target_type = 'world_setting'),
                target_id TEXT NOT NULL CHECK (length(target_id) BETWEEN 1 AND 160),
                relationship TEXT NOT NULL CHECK (relationship = 'created_from'),
                target_version INTEGER NOT NULL CHECK (target_version = 1),
                target_hash TEXT NOT NULL CHECK (
                    length(target_hash) = 64 AND target_hash NOT GLOB '*[^0-9a-f]*'
                ),
                created_at TEXT NOT NULL,
                FOREIGN KEY (artifact_id) REFERENCES result_artifacts(artifact_id) ON DELETE RESTRICT,
                FOREIGN KEY (proposal_id) REFERENCES placement_proposals(proposal_id)
                    ON DELETE RESTRICT,
                FOREIGN KEY (apply_plan_id) REFERENCES apply_plans(plan_id) ON DELETE RESTRICT,
                UNIQUE(target_type, target_id)
            );
            CREATE INDEX IF NOT EXISTS idx_artifact_target_links_artifact
                ON artifact_target_links(artifact_id, created_at);
            CREATE INDEX IF NOT EXISTS idx_artifact_target_links_target
                ON artifact_target_links(target_type, target_id);
            CREATE TRIGGER IF NOT EXISTS trg_artifact_target_links_validate_insert
                BEFORE INSERT ON artifact_target_links
                WHEN NOT EXISTS (
                    SELECT 1
                    FROM placement_proposals p
                    JOIN apply_plans ap ON ap.proposal_id = p.proposal_id
                    JOIN world_settings ws ON ws.id = NEW.target_id
                    WHERE p.proposal_id = NEW.proposal_id
                      AND p.artifact_id = NEW.artifact_id
                      AND p.target_type = NEW.target_type
                      AND p.target_id = NEW.target_id
                      AND p.target_novel_id = ws.novel_id
                      AND ap.plan_id = NEW.apply_plan_id
                      AND ap.status = 'applying'
                      AND ap.target_type = NEW.target_type
                      AND ap.target_id = NEW.target_id
                )
                BEGIN SELECT RAISE(ABORT, 'invalid artifact target link'); END;
            CREATE TRIGGER IF NOT EXISTS trg_apply_plans_applied_requires_link
                BEFORE UPDATE OF status ON apply_plans
                WHEN NEW.status = 'applied' AND NOT EXISTS (
                    SELECT 1 FROM artifact_target_links l
                    WHERE l.apply_plan_id = NEW.plan_id
                      AND l.proposal_id = NEW.proposal_id
                      AND l.target_type = NEW.target_type
                      AND l.target_id = NEW.target_id
                )
                BEGIN SELECT RAISE(ABORT, 'applied plan requires target link'); END;
            CREATE TRIGGER IF NOT EXISTS trg_artifact_target_links_immutable_update
                BEFORE UPDATE ON artifact_target_links
                BEGIN SELECT RAISE(ABORT, 'immutable artifact target link'); END;
            CREATE TRIGGER IF NOT EXISTS trg_artifact_target_links_no_delete
                BEFORE DELETE ON artifact_target_links
                BEGIN SELECT RAISE(ABORT, 'durable artifact target link'); END;",
        )
        .map_err(AppError::database)
}

fn apply_agent_plans(transaction: &Transaction<'_>) -> Result<(), AppError> {
    transaction
        .execute_batch(
            "CREATE TABLE IF NOT EXISTS agent_plans (
                plan_id TEXT PRIMARY KEY CHECK (length(plan_id) BETWEEN 1 AND 160),
                operation_id TEXT NOT NULL UNIQUE CHECK (length(operation_id) BETWEEN 1 AND 160),
                request_hash TEXT NOT NULL CHECK (
                    length(request_hash) = 64 AND request_hash NOT GLOB '*[^0-9a-f]*'
                ),
                contract_version TEXT NOT NULL CHECK (contract_version = 'agent_plan_v1'),
                planner_id TEXT NOT NULL CHECK (planner_id = 'chapter_readiness_plan_v1'),
                planner_version INTEGER NOT NULL CHECK (planner_version = 1),
                registry_hash TEXT NOT NULL CHECK (
                    length(registry_hash) = 64 AND registry_hash NOT GLOB '*[^0-9a-f]*'
                ),
                novel_id TEXT NOT NULL CHECK (length(novel_id) BETWEEN 1 AND 160),
                chapter_id TEXT NOT NULL CHECK (length(chapter_id) BETWEEN 1 AND 160),
                status TEXT NOT NULL CHECK (
                    status IN ('ready','running','waiting_retry','completed','failed','cancelled')
                ),
                state_revision INTEGER NOT NULL DEFAULT 0 CHECK (state_revision >= 0),
                result_json TEXT CHECK (
                    result_json IS NULL OR (json_valid(result_json) AND json_type(result_json) = 'object')
                ),
                error_json TEXT CHECK (
                    error_json IS NULL OR (json_valid(error_json) AND json_type(error_json) = 'object')
                ),
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                completed_at TEXT,
                CHECK (
                    (status = 'completed' AND result_json IS NOT NULL AND error_json IS NULL
                        AND completed_at IS NOT NULL) OR
                    (status = 'failed' AND result_json IS NULL AND error_json IS NOT NULL
                        AND completed_at IS NOT NULL) OR
                    (status = 'cancelled' AND result_json IS NULL AND completed_at IS NOT NULL) OR
                    (status IN ('ready','running','waiting_retry') AND result_json IS NULL
                        AND completed_at IS NULL)
                ),
                FOREIGN KEY (novel_id) REFERENCES novels(id) ON DELETE RESTRICT,
                FOREIGN KEY (chapter_id) REFERENCES chapters(id) ON DELETE RESTRICT
            );
            CREATE INDEX IF NOT EXISTS idx_agent_plans_chapter_created
                ON agent_plans(chapter_id, created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_agent_plans_status_updated
                ON agent_plans(status, updated_at);
            CREATE UNIQUE INDEX IF NOT EXISTS uq_agent_plans_operation_request
                ON agent_plans(operation_id, request_hash);
            CREATE TRIGGER IF NOT EXISTS trg_agent_plans_validate_scope
                BEFORE INSERT ON agent_plans
                WHEN NOT EXISTS (
                    SELECT 1 FROM chapters c JOIN novels n ON n.id = c.novel_id
                    WHERE c.id = NEW.chapter_id AND c.novel_id = NEW.novel_id
                      AND c.deleted_at IS NULL AND n.deleted_at IS NULL
                )
                BEGIN SELECT RAISE(ABORT, 'invalid agent plan chapter scope'); END;
            CREATE TRIGGER IF NOT EXISTS trg_agent_plans_immutable_identity
                BEFORE UPDATE OF plan_id, operation_id, request_hash, contract_version,
                    planner_id, planner_version, registry_hash, novel_id, chapter_id, created_at
                ON agent_plans
                BEGIN SELECT RAISE(ABORT, 'immutable agent plan identity'); END;
            CREATE TRIGGER IF NOT EXISTS trg_agent_plans_status_edges
                BEFORE UPDATE OF status ON agent_plans
                WHEN OLD.status <> NEW.status AND NOT (
                    (OLD.status = 'ready' AND NEW.status IN ('running','cancelled')) OR
                    (OLD.status = 'running' AND NEW.status IN
                        ('waiting_retry','completed','failed','cancelled')) OR
                    (OLD.status = 'waiting_retry' AND NEW.status IN ('running','cancelled'))
                )
                BEGIN SELECT RAISE(ABORT, 'illegal agent plan transition'); END;
            CREATE TRIGGER IF NOT EXISTS trg_agent_plans_no_delete
                BEFORE DELETE ON agent_plans
                BEGIN SELECT RAISE(ABORT, 'durable agent plan'); END;",
        )
        .map_err(AppError::database)
}

fn apply_agent_plan_steps(transaction: &Transaction<'_>) -> Result<(), AppError> {
    transaction
        .execute_batch(
            "CREATE TABLE IF NOT EXISTS agent_plan_steps (
                step_id TEXT PRIMARY KEY CHECK (length(step_id) BETWEEN 1 AND 160),
                plan_id TEXT NOT NULL,
                step_key TEXT NOT NULL CHECK (length(step_key) BETWEEN 1 AND 100),
                ordinal INTEGER NOT NULL CHECK (ordinal BETWEEN 1 AND 1000),
                title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 300),
                tool_name TEXT NOT NULL CHECK (length(tool_name) BETWEEN 2 AND 96),
                tool_version TEXT NOT NULL CHECK (length(tool_version) BETWEEN 1 AND 6),
                tool_identity TEXT NOT NULL CHECK (tool_identity = tool_name || '@' || tool_version),
                registry_hash TEXT NOT NULL CHECK (
                    length(registry_hash) = 64 AND registry_hash NOT GLOB '*[^0-9a-f]*'
                ),
                input_schema_hash TEXT NOT NULL CHECK (
                    length(input_schema_hash) = 64 AND input_schema_hash NOT GLOB '*[^0-9a-f]*'
                ),
                output_schema_hash TEXT NOT NULL CHECK (
                    length(output_schema_hash) = 64 AND output_schema_hash NOT GLOB '*[^0-9a-f]*'
                ),
                permissions_json TEXT NOT NULL CHECK (
                    json_valid(permissions_json) AND json_type(permissions_json) = 'array'
                    AND length(permissions_json) <= 4096
                ),
                scope TEXT NOT NULL CHECK (scope IN ('system','novel','chapter','draft')),
                arguments_json TEXT NOT NULL CHECK (
                    json_valid(arguments_json) AND json_type(arguments_json) = 'object'
                    AND length(arguments_json) <= 65536
                ),
                arguments_hash TEXT NOT NULL CHECK (
                    length(arguments_hash) = 64 AND arguments_hash NOT GLOB '*[^0-9a-f]*'
                ),
                status TEXT NOT NULL CHECK (
                    status IN ('pending','running','waiting_retry','completed','failed','cancelled')
                ),
                state_revision INTEGER NOT NULL DEFAULT 0 CHECK (state_revision >= 0),
                output_json TEXT CHECK (output_json IS NULL OR json_valid(output_json)),
                output_hash TEXT CHECK (
                    output_hash IS NULL OR (
                        length(output_hash) = 64 AND output_hash NOT GLOB '*[^0-9a-f]*'
                    )
                ),
                error_json TEXT CHECK (
                    error_json IS NULL OR (json_valid(error_json) AND json_type(error_json) = 'object')
                ),
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                completed_at TEXT,
                CHECK (
                    (status = 'completed' AND output_json IS NOT NULL AND output_hash IS NOT NULL
                        AND error_json IS NULL AND completed_at IS NOT NULL) OR
                    (status = 'failed' AND output_json IS NULL AND output_hash IS NULL
                        AND error_json IS NOT NULL AND completed_at IS NOT NULL) OR
                    (status = 'waiting_retry' AND output_json IS NULL AND output_hash IS NULL
                        AND error_json IS NOT NULL AND completed_at IS NULL) OR
                    (status = 'cancelled' AND output_json IS NULL AND output_hash IS NULL
                        AND completed_at IS NOT NULL) OR
                    (status IN ('pending','running') AND output_json IS NULL
                        AND output_hash IS NULL AND completed_at IS NULL)
                ),
                FOREIGN KEY (plan_id) REFERENCES agent_plans(plan_id) ON DELETE RESTRICT,
                UNIQUE(plan_id, step_key),
                UNIQUE(plan_id, ordinal)
            );
            CREATE INDEX IF NOT EXISTS idx_agent_plan_steps_plan_status
                ON agent_plan_steps(plan_id, status, ordinal);
            CREATE INDEX IF NOT EXISTS idx_agent_plan_steps_tool
                ON agent_plan_steps(tool_identity, registry_hash);
            CREATE TRIGGER IF NOT EXISTS trg_agent_plan_steps_validate_plan
                BEFORE INSERT ON agent_plan_steps
                WHEN NOT EXISTS (
                    SELECT 1 FROM agent_plans p
                    WHERE p.plan_id = NEW.plan_id AND p.registry_hash = NEW.registry_hash
                      AND json_extract(NEW.arguments_json, '$.novelId') = p.novel_id
                      AND (
                        NEW.scope = 'novel' OR
                        json_extract(NEW.arguments_json, '$.chapterId') = p.chapter_id
                      )
                )
                BEGIN SELECT RAISE(ABORT, 'invalid agent plan step scope'); END;
            CREATE TRIGGER IF NOT EXISTS trg_agent_plan_steps_immutable_identity
                BEFORE UPDATE OF step_id, plan_id, step_key, ordinal, title, tool_name,
                    tool_version, tool_identity, registry_hash, input_schema_hash,
                    output_schema_hash, permissions_json, scope, arguments_json,
                    arguments_hash, created_at
                ON agent_plan_steps
                BEGIN SELECT RAISE(ABORT, 'immutable agent plan step identity'); END;
            CREATE TRIGGER IF NOT EXISTS trg_agent_plan_steps_status_edges
                BEFORE UPDATE OF status ON agent_plan_steps
                WHEN OLD.status <> NEW.status AND NOT (
                    (OLD.status = 'pending' AND NEW.status IN
                        ('running','waiting_retry','cancelled')) OR
                    (OLD.status = 'running' AND NEW.status IN
                        ('waiting_retry','completed','failed','cancelled')) OR
                    (OLD.status = 'waiting_retry' AND NEW.status IN ('pending','cancelled'))
                )
                BEGIN SELECT RAISE(ABORT, 'illegal agent plan step transition'); END;
            CREATE TRIGGER IF NOT EXISTS trg_agent_plan_steps_no_delete
                BEFORE DELETE ON agent_plan_steps
                BEGIN SELECT RAISE(ABORT, 'durable agent plan step'); END;",
        )
        .map_err(AppError::database)
}

fn apply_agent_plan_step_dependencies(transaction: &Transaction<'_>) -> Result<(), AppError> {
    transaction
        .execute_batch(
            "CREATE TABLE IF NOT EXISTS agent_plan_step_dependencies (
                plan_id TEXT NOT NULL,
                step_id TEXT NOT NULL,
                depends_on_step_id TEXT NOT NULL,
                dependency_ordinal INTEGER NOT NULL CHECK (dependency_ordinal BETWEEN 1 AND 1000),
                created_at TEXT NOT NULL,
                PRIMARY KEY (step_id, depends_on_step_id),
                UNIQUE(step_id, dependency_ordinal),
                CHECK (step_id <> depends_on_step_id),
                FOREIGN KEY (plan_id) REFERENCES agent_plans(plan_id) ON DELETE RESTRICT,
                FOREIGN KEY (step_id) REFERENCES agent_plan_steps(step_id) ON DELETE RESTRICT,
                FOREIGN KEY (depends_on_step_id) REFERENCES agent_plan_steps(step_id) ON DELETE RESTRICT
            );
            CREATE INDEX IF NOT EXISTS idx_agent_plan_dependencies_plan
                ON agent_plan_step_dependencies(plan_id, step_id, dependency_ordinal);
            CREATE TRIGGER IF NOT EXISTS trg_agent_plan_dependencies_validate_insert
                BEFORE INSERT ON agent_plan_step_dependencies
                WHEN NOT EXISTS (
                    SELECT 1 FROM agent_plan_steps child
                    JOIN agent_plan_steps parent ON parent.step_id = NEW.depends_on_step_id
                    WHERE child.step_id = NEW.step_id
                      AND child.plan_id = NEW.plan_id AND parent.plan_id = NEW.plan_id
                      AND parent.ordinal < child.ordinal
                )
                BEGIN SELECT RAISE(ABORT, 'invalid agent plan dependency'); END;
            CREATE TRIGGER IF NOT EXISTS trg_agent_plan_dependencies_append_only_update
                BEFORE UPDATE ON agent_plan_step_dependencies
                BEGIN SELECT RAISE(ABORT, 'immutable agent plan dependency'); END;
            CREATE TRIGGER IF NOT EXISTS trg_agent_plan_dependencies_append_only_delete
                BEFORE DELETE ON agent_plan_step_dependencies
                BEGIN SELECT RAISE(ABORT, 'durable agent plan dependency'); END;",
        )
        .map_err(AppError::database)
}

fn apply_agent_plan_step_attempts(transaction: &Transaction<'_>) -> Result<(), AppError> {
    transaction
        .execute_batch(
            "CREATE TABLE IF NOT EXISTS agent_plan_step_attempts (
                attempt_id TEXT PRIMARY KEY CHECK (length(attempt_id) BETWEEN 1 AND 160),
                plan_id TEXT NOT NULL,
                step_id TEXT NOT NULL,
                attempt_number INTEGER NOT NULL CHECK (attempt_number >= 1),
                lease_id TEXT NOT NULL CHECK (length(lease_id) BETWEEN 1 AND 160),
                lease_epoch INTEGER NOT NULL CHECK (lease_epoch >= 1),
                status TEXT NOT NULL CHECK (status IN ('running','succeeded','failed','abandoned')),
                output_json TEXT CHECK (output_json IS NULL OR json_valid(output_json)),
                output_hash TEXT CHECK (
                    output_hash IS NULL OR (
                        length(output_hash) = 64 AND output_hash NOT GLOB '*[^0-9a-f]*'
                    )
                ),
                error_json TEXT CHECK (
                    error_json IS NULL OR (json_valid(error_json) AND json_type(error_json) = 'object')
                ),
                started_at TEXT NOT NULL,
                finished_at TEXT,
                CHECK (
                    (status = 'running' AND output_json IS NULL AND output_hash IS NULL
                        AND error_json IS NULL AND finished_at IS NULL) OR
                    (status = 'succeeded' AND output_json IS NOT NULL AND output_hash IS NOT NULL
                        AND error_json IS NULL AND finished_at IS NOT NULL) OR
                    (status IN ('failed','abandoned') AND output_json IS NULL
                        AND output_hash IS NULL AND error_json IS NOT NULL
                        AND finished_at IS NOT NULL)
                ),
                FOREIGN KEY (plan_id) REFERENCES agent_plans(plan_id) ON DELETE RESTRICT,
                FOREIGN KEY (step_id) REFERENCES agent_plan_steps(step_id) ON DELETE RESTRICT,
                UNIQUE(step_id, attempt_number)
            );
            CREATE UNIQUE INDEX IF NOT EXISTS uq_agent_plan_attempts_one_running
                ON agent_plan_step_attempts(step_id) WHERE status = 'running';
            CREATE INDEX IF NOT EXISTS idx_agent_plan_attempts_plan_started
                ON agent_plan_step_attempts(plan_id, started_at);
            CREATE TRIGGER IF NOT EXISTS trg_agent_plan_attempts_validate_step
                BEFORE INSERT ON agent_plan_step_attempts
                WHEN NOT EXISTS (
                    SELECT 1 FROM agent_plan_steps s
                    WHERE s.step_id = NEW.step_id AND s.plan_id = NEW.plan_id
                      AND s.status = 'running'
                ) OR NEW.attempt_number <> COALESCE((
                    SELECT MAX(a.attempt_number) + 1 FROM agent_plan_step_attempts a
                    WHERE a.step_id = NEW.step_id
                ), 1)
                BEGIN SELECT RAISE(ABORT, 'invalid agent plan attempt'); END;
            CREATE TRIGGER IF NOT EXISTS trg_agent_plan_attempts_immutable_identity
                BEFORE UPDATE OF attempt_id, plan_id, step_id, attempt_number, lease_id,
                    lease_epoch, started_at
                ON agent_plan_step_attempts
                BEGIN SELECT RAISE(ABORT, 'immutable agent plan attempt identity'); END;
            CREATE TRIGGER IF NOT EXISTS trg_agent_plan_attempts_status_edges
                BEFORE UPDATE OF status ON agent_plan_step_attempts
                WHEN OLD.status <> NEW.status AND NOT (
                    OLD.status = 'running' AND NEW.status IN ('succeeded','failed','abandoned')
                )
                BEGIN SELECT RAISE(ABORT, 'illegal agent plan attempt transition'); END;
            CREATE TRIGGER IF NOT EXISTS trg_agent_plan_attempts_no_delete
                BEFORE DELETE ON agent_plan_step_attempts
                BEGIN SELECT RAISE(ABORT, 'durable agent plan attempt'); END;",
        )
        .map_err(AppError::database)
}

fn apply_agent_execution_leases(transaction: &Transaction<'_>) -> Result<(), AppError> {
    transaction
        .execute_batch(
            "CREATE TABLE IF NOT EXISTS agent_execution_leases (
                lease_id TEXT PRIMARY KEY CHECK (length(lease_id) BETWEEN 1 AND 160),
                plan_id TEXT NOT NULL,
                epoch INTEGER NOT NULL CHECK (epoch >= 1),
                owner_id TEXT NOT NULL CHECK (length(owner_id) BETWEEN 1 AND 160),
                token_hash TEXT NOT NULL CHECK (
                    length(token_hash) = 64 AND token_hash NOT GLOB '*[^0-9a-f]*'
                ),
                expires_at TEXT NOT NULL,
                status TEXT NOT NULL CHECK (status IN ('active','released','expired')),
                acquired_at TEXT NOT NULL,
                released_at TEXT,
                CHECK (
                    (status = 'active' AND released_at IS NULL) OR
                    (status IN ('released','expired') AND released_at IS NOT NULL)
                ),
                FOREIGN KEY (plan_id) REFERENCES agent_plans(plan_id) ON DELETE RESTRICT,
                UNIQUE(plan_id, epoch)
            );
            CREATE UNIQUE INDEX IF NOT EXISTS uq_agent_execution_leases_one_active
                ON agent_execution_leases(plan_id) WHERE status = 'active';
            CREATE INDEX IF NOT EXISTS idx_agent_execution_leases_expiry
                ON agent_execution_leases(status, expires_at);
            CREATE TRIGGER IF NOT EXISTS trg_agent_execution_leases_monotonic_epoch
                BEFORE INSERT ON agent_execution_leases
                WHEN NEW.epoch <> COALESCE((
                    SELECT MAX(l.epoch) + 1 FROM agent_execution_leases l
                    WHERE l.plan_id = NEW.plan_id
                ), 1)
                BEGIN SELECT RAISE(ABORT, 'invalid agent lease epoch'); END;
            CREATE TRIGGER IF NOT EXISTS trg_agent_execution_leases_immutable_identity
                BEFORE UPDATE OF lease_id, plan_id, epoch, owner_id, token_hash,
                    expires_at, acquired_at
                ON agent_execution_leases
                BEGIN SELECT RAISE(ABORT, 'immutable agent lease identity'); END;
            CREATE TRIGGER IF NOT EXISTS trg_agent_execution_leases_status_edges
                BEFORE UPDATE OF status ON agent_execution_leases
                WHEN OLD.status <> NEW.status AND NOT (
                    OLD.status = 'active' AND NEW.status IN ('released','expired')
                )
                BEGIN SELECT RAISE(ABORT, 'illegal agent lease transition'); END;
            CREATE TRIGGER IF NOT EXISTS trg_agent_execution_leases_no_delete
                BEFORE DELETE ON agent_execution_leases
                BEGIN SELECT RAISE(ABORT, 'durable agent lease'); END;
            CREATE TRIGGER IF NOT EXISTS trg_agent_plan_attempts_validate_lease
                BEFORE INSERT ON agent_plan_step_attempts
                WHEN NOT EXISTS (
                    SELECT 1 FROM agent_execution_leases l
                    WHERE l.lease_id = NEW.lease_id AND l.plan_id = NEW.plan_id
                      AND l.epoch = NEW.lease_epoch AND l.status = 'active'
                )
                BEGIN SELECT RAISE(ABORT, 'invalid agent attempt lease'); END;",
        )
        .map_err(AppError::database)
}

fn apply_agent_plan_checkpoints(transaction: &Transaction<'_>) -> Result<(), AppError> {
    transaction
        .execute_batch(
            "CREATE TABLE IF NOT EXISTS agent_plan_checkpoints (
                checkpoint_id TEXT PRIMARY KEY CHECK (length(checkpoint_id) BETWEEN 1 AND 160),
                plan_id TEXT NOT NULL,
                sequence INTEGER NOT NULL CHECK (sequence >= 1),
                event_type TEXT NOT NULL CHECK (
                    event_type IN ('plan_created','lease_acquired','step_claimed',
                        'step_completed','step_failed','retry_authorized',
                        'lease_released','interrupted_recovered','plan_cancelled')
                ),
                step_id TEXT,
                attempt_id TEXT,
                plan_status TEXT NOT NULL CHECK (
                    plan_status IN ('ready','running','waiting_retry','completed','failed','cancelled')
                ),
                step_status TEXT CHECK (
                    step_status IS NULL OR step_status IN
                        ('pending','running','waiting_retry','completed','failed','cancelled')
                ),
                payload_json TEXT NOT NULL CHECK (
                    json_valid(payload_json) AND json_type(payload_json) = 'object'
                    AND length(payload_json) <= 65536
                ),
                payload_hash TEXT NOT NULL CHECK (
                    length(payload_hash) = 64 AND payload_hash NOT GLOB '*[^0-9a-f]*'
                ),
                created_at TEXT NOT NULL,
                FOREIGN KEY (plan_id) REFERENCES agent_plans(plan_id) ON DELETE RESTRICT,
                FOREIGN KEY (step_id) REFERENCES agent_plan_steps(step_id) ON DELETE RESTRICT,
                FOREIGN KEY (attempt_id) REFERENCES agent_plan_step_attempts(attempt_id)
                    ON DELETE RESTRICT,
                UNIQUE(plan_id, sequence)
            );
            CREATE INDEX IF NOT EXISTS idx_agent_plan_checkpoints_plan_sequence
                ON agent_plan_checkpoints(plan_id, sequence);
            CREATE TRIGGER IF NOT EXISTS trg_agent_plan_checkpoints_monotonic_sequence
                BEFORE INSERT ON agent_plan_checkpoints
                WHEN NEW.sequence <> COALESCE((
                    SELECT MAX(c.sequence) + 1 FROM agent_plan_checkpoints c
                    WHERE c.plan_id = NEW.plan_id
                ), 1)
                BEGIN SELECT RAISE(ABORT, 'invalid agent checkpoint sequence'); END;
            CREATE TRIGGER IF NOT EXISTS trg_agent_plan_checkpoints_validate_identity
                BEFORE INSERT ON agent_plan_checkpoints
                WHEN (NEW.step_id IS NOT NULL AND NOT EXISTS (
                    SELECT 1 FROM agent_plan_steps s
                    WHERE s.step_id = NEW.step_id AND s.plan_id = NEW.plan_id
                )) OR (NEW.attempt_id IS NOT NULL AND NOT EXISTS (
                    SELECT 1 FROM agent_plan_step_attempts a
                    WHERE a.attempt_id = NEW.attempt_id AND a.plan_id = NEW.plan_id
                      AND (NEW.step_id IS NULL OR a.step_id = NEW.step_id)
                ))
                BEGIN SELECT RAISE(ABORT, 'invalid agent checkpoint identity'); END;
            CREATE TRIGGER IF NOT EXISTS trg_agent_plan_checkpoints_append_only_update
                BEFORE UPDATE ON agent_plan_checkpoints
                BEGIN SELECT RAISE(ABORT, 'immutable agent checkpoint'); END;
            CREATE TRIGGER IF NOT EXISTS trg_agent_plan_checkpoints_append_only_delete
                BEFORE DELETE ON agent_plan_checkpoints
                BEGIN SELECT RAISE(ABORT, 'durable agent checkpoint'); END;",
        )
        .map_err(AppError::database)
}

fn apply_multi_agent_sessions(transaction: &Transaction<'_>) -> Result<(), AppError> {
    transaction
        .execute_batch(
            "CREATE TABLE IF NOT EXISTS multi_agent_sessions (
                session_id TEXT PRIMARY KEY CHECK (length(session_id) BETWEEN 1 AND 160),
                operation_id TEXT NOT NULL UNIQUE CHECK (length(operation_id) BETWEEN 1 AND 200),
                novel_id TEXT NOT NULL,
                chapter_id TEXT NOT NULL,
                source_draft_id TEXT NOT NULL,
                source_draft_version INTEGER NOT NULL CHECK (source_draft_version >= 1),
                source_content_hash TEXT NOT NULL CHECK (
                    length(source_content_hash) = 64
                    AND source_content_hash NOT GLOB '*[^0-9a-f]*'
                ),
                expert_types_json TEXT NOT NULL CHECK (
                    json_valid(expert_types_json) AND json_type(expert_types_json) = 'array'
                    AND json_array_length(expert_types_json) BETWEEN 1 AND 6
                ),
                max_rounds INTEGER NOT NULL CHECK (max_rounds BETWEEN 1 AND 3),
                acceptance_threshold REAL NOT NULL CHECK (
                    acceptance_threshold >= 0 AND acceptance_threshold <= 1
                ),
                minimum_average_score REAL NOT NULL CHECK (
                    minimum_average_score >= 0 AND minimum_average_score <= 100
                ),
                minimum_successful_experts INTEGER NOT NULL CHECK (
                    minimum_successful_experts BETWEEN 1 AND 6
                ),
                status TEXT NOT NULL CHECK (
                    status IN ('running','completed','failed','cancelled')
                ),
                current_round INTEGER NOT NULL DEFAULT 0 CHECK (current_round BETWEEN 0 AND 3),
                accepted INTEGER NOT NULL DEFAULT 0 CHECK (accepted IN (0,1)),
                final_action TEXT CHECK (
                    final_action IS NULL OR final_action IN ('accept','revise','regenerate')
                ),
                final_draft_id TEXT,
                total_tokens_input INTEGER NOT NULL DEFAULT 0 CHECK (total_tokens_input >= 0),
                total_tokens_output INTEGER NOT NULL DEFAULT 0 CHECK (total_tokens_output >= 0),
                total_tokens_used INTEGER NOT NULL DEFAULT 0 CHECK (total_tokens_used >= 0),
                duration_ms INTEGER NOT NULL DEFAULT 0 CHECK (duration_ms >= 0),
                error_message TEXT CHECK (error_message IS NULL OR length(error_message) <= 500),
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                completed_at TEXT,
                FOREIGN KEY (source_draft_id) REFERENCES chapter_drafts(id) ON DELETE RESTRICT,
                FOREIGN KEY (final_draft_id) REFERENCES chapter_drafts(id) ON DELETE RESTRICT
            );
            CREATE INDEX IF NOT EXISTS idx_multi_agent_sessions_chapter_created
                ON multi_agent_sessions(chapter_id, created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_multi_agent_sessions_novel_created
                ON multi_agent_sessions(novel_id, created_at DESC);",
        )
        .map_err(AppError::database)
}

fn apply_multi_agent_rounds(transaction: &Transaction<'_>) -> Result<(), AppError> {
    transaction
        .execute_batch(
            "CREATE TABLE IF NOT EXISTS multi_agent_rounds (
                session_id TEXT NOT NULL,
                round_number INTEGER NOT NULL CHECK (round_number BETWEEN 1 AND 3),
                input_draft_id TEXT NOT NULL,
                input_draft_version INTEGER NOT NULL CHECK (input_draft_version >= 1),
                input_content_hash TEXT NOT NULL CHECK (
                    length(input_content_hash) = 64
                    AND input_content_hash NOT GLOB '*[^0-9a-f]*'
                ),
                output_draft_id TEXT,
                output_draft_version INTEGER CHECK (
                    output_draft_version IS NULL OR output_draft_version >= 1
                ),
                output_content_hash TEXT CHECK (
                    output_content_hash IS NULL OR (
                        length(output_content_hash) = 64
                        AND output_content_hash NOT GLOB '*[^0-9a-f]*'
                    )
                ),
                agreed INTEGER NOT NULL CHECK (agreed IN (0,1)),
                acceptance_rate REAL NOT NULL CHECK (acceptance_rate >= 0 AND acceptance_rate <= 1),
                average_score REAL NOT NULL CHECK (average_score >= 0 AND average_score <= 100),
                successful_experts INTEGER NOT NULL CHECK (successful_experts BETWEEN 0 AND 6),
                failed_experts INTEGER NOT NULL CHECK (failed_experts BETWEEN 0 AND 6),
                required_successful_experts INTEGER NOT NULL CHECK (
                    required_successful_experts BETWEEN 1 AND 6
                ),
                action TEXT NOT NULL CHECK (action IN ('accept','revise','regenerate')),
                major_concerns_json TEXT NOT NULL CHECK (
                    json_valid(major_concerns_json) AND json_type(major_concerns_json) = 'array'
                    AND length(major_concerns_json) <= 32768
                ),
                merged_suggestions_json TEXT NOT NULL CHECK (
                    json_valid(merged_suggestions_json) AND json_type(merged_suggestions_json) = 'array'
                    AND length(merged_suggestions_json) <= 49152
                ),
                tokens_input INTEGER NOT NULL CHECK (tokens_input >= 0),
                tokens_output INTEGER NOT NULL CHECK (tokens_output >= 0),
                tokens_used INTEGER NOT NULL CHECK (tokens_used >= 0),
                duration_ms INTEGER NOT NULL CHECK (duration_ms >= 0),
                started_at TEXT NOT NULL,
                completed_at TEXT NOT NULL,
                PRIMARY KEY (session_id, round_number),
                FOREIGN KEY (session_id) REFERENCES multi_agent_sessions(session_id) ON DELETE CASCADE,
                FOREIGN KEY (input_draft_id) REFERENCES chapter_drafts(id) ON DELETE RESTRICT,
                FOREIGN KEY (output_draft_id) REFERENCES chapter_drafts(id) ON DELETE RESTRICT
            );
            CREATE INDEX IF NOT EXISTS idx_multi_agent_rounds_input_draft
                ON multi_agent_rounds(input_draft_id);
            CREATE INDEX IF NOT EXISTS idx_multi_agent_rounds_output_draft
                ON multi_agent_rounds(output_draft_id);",
        )
        .map_err(AppError::database)
}

fn apply_multi_agent_opinions(transaction: &Transaction<'_>) -> Result<(), AppError> {
    transaction
        .execute_batch(
            "CREATE TABLE IF NOT EXISTS multi_agent_opinions (
                opinion_id TEXT PRIMARY KEY CHECK (length(opinion_id) BETWEEN 1 AND 160),
                session_id TEXT NOT NULL,
                round_number INTEGER NOT NULL CHECK (round_number BETWEEN 1 AND 3),
                expert_type TEXT NOT NULL CHECK (
                    expert_type IN ('outline','character','setting','logic','polish','quality')
                ),
                status TEXT NOT NULL CHECK (status IN ('succeeded','failed')),
                score INTEGER CHECK (score IS NULL OR score BETWEEN 0 AND 100),
                accepted INTEGER NOT NULL CHECK (accepted IN (0,1)),
                summary TEXT NOT NULL CHECK (length(summary) BETWEEN 1 AND 500),
                issues_json TEXT NOT NULL CHECK (
                    json_valid(issues_json) AND json_type(issues_json) = 'array'
                    AND length(issues_json) <= 32768
                ),
                suggestions_json TEXT NOT NULL CHECK (
                    json_valid(suggestions_json) AND json_type(suggestions_json) = 'array'
                    AND length(suggestions_json) <= 32768
                ),
                provider TEXT CHECK (provider IS NULL OR length(provider) <= 120),
                model TEXT CHECK (model IS NULL OR length(model) <= 200),
                ai_task_id TEXT CHECK (ai_task_id IS NULL OR length(ai_task_id) <= 160),
                tokens_input INTEGER NOT NULL CHECK (tokens_input >= 0),
                tokens_output INTEGER NOT NULL CHECK (tokens_output >= 0),
                tokens_used INTEGER NOT NULL CHECK (tokens_used >= 0),
                duration_ms INTEGER NOT NULL CHECK (duration_ms >= 0),
                error_message TEXT CHECK (error_message IS NULL OR length(error_message) <= 500),
                FOREIGN KEY (session_id, round_number)
                    REFERENCES multi_agent_rounds(session_id, round_number) ON DELETE CASCADE,
                UNIQUE(session_id, round_number, expert_type),
                CHECK (
                    (status = 'succeeded' AND score IS NOT NULL AND error_message IS NULL)
                    OR (status = 'failed' AND score IS NULL AND accepted = 0)
                )
            );
            CREATE INDEX IF NOT EXISTS idx_multi_agent_opinions_session_round
                ON multi_agent_opinions(session_id, round_number);",
        )
        .map_err(AppError::database)
}

fn apply_autonomous_story_plans(transaction: &Transaction<'_>) -> Result<(), AppError> {
    transaction
        .execute_batch(
            "CREATE TABLE IF NOT EXISTS autonomous_story_plans (
                plan_id TEXT PRIMARY KEY CHECK (length(plan_id) BETWEEN 1 AND 160),
                operation_id TEXT NOT NULL UNIQUE CHECK (length(operation_id) BETWEEN 1 AND 200),
                novel_id TEXT NOT NULL,
                request_hash TEXT NOT NULL CHECK (
                    length(request_hash) = 64 AND request_hash NOT GLOB '*[^0-9a-f]*'
                ),
                schema_version INTEGER NOT NULL CHECK (schema_version = 1),
                status TEXT NOT NULL CHECK (
                    status IN ('running','ready','failed','cancelled','applied')
                ),
                stage TEXT NOT NULL CHECK (
                    stage IN ('foundation','creative_dimensions','chapter_batches','ready','applied')
                ),
                revision INTEGER NOT NULL CHECK (revision >= 1),
                target_chapter_count INTEGER NOT NULL CHECK (target_chapter_count BETWEEN 12 AND 500),
                completed_chapter_count INTEGER NOT NULL CHECK (
                    completed_chapter_count BETWEEN 0 AND target_chapter_count
                ),
                plan_json TEXT NOT NULL CHECK (
                    json_valid(plan_json) AND json_type(plan_json) = 'object'
                    AND length(plan_json) BETWEEN 2 AND 2000000
                ),
                plan_hash TEXT NOT NULL CHECK (
                    length(plan_hash) = 64 AND plan_hash NOT GLOB '*[^0-9a-f]*'
                ),
                error_message TEXT CHECK (error_message IS NULL OR length(error_message) <= 1000),
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                completed_at TEXT,
                applied_at TEXT,
                FOREIGN KEY (novel_id) REFERENCES novels(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_autonomous_story_plans_novel_created
                ON autonomous_story_plans(novel_id, created_at DESC, plan_id DESC);
            CREATE INDEX IF NOT EXISTS idx_autonomous_story_plans_status
                ON autonomous_story_plans(status, updated_at DESC);

            CREATE TRIGGER IF NOT EXISTS trg_autonomous_story_plans_immutable_identity
            BEFORE UPDATE OF plan_id, operation_id, novel_id, request_hash, schema_version, created_at
            ON autonomous_story_plans
            BEGIN SELECT RAISE(ABORT, 'autonomous plan identity is immutable'); END;

            CREATE TRIGGER IF NOT EXISTS trg_autonomous_story_plans_status_edges
            BEFORE UPDATE OF status ON autonomous_story_plans
            WHEN NOT (
                OLD.status = NEW.status
                OR (OLD.status = 'running' AND NEW.status IN ('ready','failed','cancelled'))
                OR (OLD.status IN ('failed','cancelled') AND NEW.status = 'running')
                OR (OLD.status = 'ready' AND NEW.status = 'applied')
            )
            BEGIN SELECT RAISE(ABORT, 'invalid autonomous plan status transition'); END;",
        )
        .map_err(AppError::database)
}

fn apply_reference_library(transaction: &Transaction<'_>) -> Result<(), AppError> {
    transaction
        .execute_batch(
            "CREATE TABLE IF NOT EXISTS reference_works (
                id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 160),
                novel_id TEXT NOT NULL,
                title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 200),
                purpose TEXT NOT NULL CHECK (purpose IN ('style','research','inspiration')),
                description TEXT CHECK (description IS NULL OR length(description) <= 2000),
                revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                UNIQUE(id, novel_id),
                FOREIGN KEY (novel_id) REFERENCES novels(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_reference_works_novel_updated
                ON reference_works(novel_id, updated_at DESC, id DESC);

            CREATE TABLE IF NOT EXISTS reference_imports (
                id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 160),
                reference_work_id TEXT NOT NULL,
                novel_id TEXT NOT NULL,
                version_no INTEGER NOT NULL CHECK (version_no >= 1),
                is_current INTEGER NOT NULL CHECK (is_current IN (0,1)),
                operation_id TEXT NOT NULL UNIQUE CHECK (length(operation_id) BETWEEN 1 AND 200),
                request_hash TEXT NOT NULL CHECK (
                    length(request_hash) = 64 AND request_hash NOT GLOB '*[^0-9a-f]*'
                ),
                file_name TEXT NOT NULL CHECK (length(trim(file_name)) BETWEEN 1 AND 255),
                source_file_path TEXT,
                source_format TEXT NOT NULL CHECK (source_format = 'txt'),
                source_sha256 TEXT NOT NULL CHECK (
                    length(source_sha256) = 64 AND source_sha256 NOT GLOB '*[^0-9a-f]*'
                ),
                source_byte_count INTEGER NOT NULL CHECK (source_byte_count BETWEEN 1 AND 67108864),
                detected_encoding TEXT CHECK (
                    detected_encoding IS NULL OR detected_encoding IN ('utf-8','utf-16le','utf-16be','gb18030')
                ),
                selected_encoding TEXT NOT NULL CHECK (
                    selected_encoding IN ('utf-8','utf-16le','utf-16be','gb18030')
                ),
                encoding_source TEXT NOT NULL CHECK (
                    encoding_source IN ('bom','utf8_valid','fallback','user_override')
                ),
                decoded_text_sha256 TEXT NOT NULL CHECK (
                    length(decoded_text_sha256) = 64 AND decoded_text_sha256 NOT GLOB '*[^0-9a-f]*'
                ),
                decoded_char_count INTEGER NOT NULL CHECK (decoded_char_count BETWEEN 1 AND 20000000),
                decoded_utf8_byte_count INTEGER NOT NULL CHECK (decoded_utf8_byte_count >= 1),
                source_text TEXT NOT NULL,
                large_text_ref_id TEXT,
                section_count INTEGER NOT NULL CHECK (section_count BETWEEN 1 AND 10000),
                parser_version TEXT NOT NULL CHECK (length(parser_version) BETWEEN 1 AND 96),
                section_plan_sha256 TEXT NOT NULL CHECK (
                    length(section_plan_sha256) = 64 AND section_plan_sha256 NOT GLOB '*[^0-9a-f]*'
                ),
                warnings_json TEXT NOT NULL CHECK (
                    json_valid(warnings_json) AND json_type(warnings_json) = 'array'
                    AND length(warnings_json) <= 32768
                ),
                imported_at TEXT NOT NULL,
                UNIQUE(reference_work_id, version_no),
                UNIQUE(id, reference_work_id, novel_id),
                FOREIGN KEY (reference_work_id, novel_id)
                    REFERENCES reference_works(id, novel_id) ON DELETE CASCADE,
                FOREIGN KEY (large_text_ref_id) REFERENCES large_text_documents(id) ON DELETE RESTRICT
            );
            CREATE UNIQUE INDEX IF NOT EXISTS idx_reference_imports_one_current
                ON reference_imports(reference_work_id) WHERE is_current = 1;
            CREATE INDEX IF NOT EXISTS idx_reference_imports_novel_source_hash
                ON reference_imports(novel_id, source_sha256, imported_at DESC);
            CREATE INDEX IF NOT EXISTS idx_reference_imports_work_version
                ON reference_imports(reference_work_id, version_no DESC);

            CREATE TABLE IF NOT EXISTS reference_sections (
                id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 160),
                reference_import_id TEXT NOT NULL,
                reference_work_id TEXT NOT NULL,
                novel_id TEXT NOT NULL,
                order_index INTEGER NOT NULL CHECK (order_index >= 1),
                section_kind TEXT NOT NULL CHECK (
                    section_kind IN ('front_matter','chapter','part','unstructured')
                ),
                title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 160),
                content TEXT NOT NULL,
                large_text_ref_id TEXT,
                content_hash TEXT NOT NULL CHECK (
                    length(content_hash) = 64 AND content_hash NOT GLOB '*[^0-9a-f]*'
                ),
                char_count INTEGER NOT NULL CHECK (char_count >= 1),
                utf8_byte_count INTEGER NOT NULL CHECK (utf8_byte_count >= 1),
                source_start_utf16 INTEGER NOT NULL CHECK (source_start_utf16 >= 0),
                source_end_utf16 INTEGER NOT NULL CHECK (source_end_utf16 > source_start_utf16),
                created_at TEXT NOT NULL,
                UNIQUE(reference_import_id, order_index),
                FOREIGN KEY (reference_import_id, reference_work_id, novel_id)
                    REFERENCES reference_imports(id, reference_work_id, novel_id) ON DELETE CASCADE,
                FOREIGN KEY (large_text_ref_id) REFERENCES large_text_documents(id) ON DELETE RESTRICT
            );
            CREATE INDEX IF NOT EXISTS idx_reference_sections_work_import_order
                ON reference_sections(reference_work_id, reference_import_id, order_index);",
        )
        .map_err(AppError::database)
}

fn install_memory_fts(transaction: &Transaction<'_>) -> Result<(), AppError> {
    let trigram = transaction.execute_batch(
        "CREATE VIRTUAL TABLE IF NOT EXISTS memory_chunks_fts
         USING fts5(chunk_id UNINDEXED, novel_id UNINDEXED, text, tokenize='trigram');",
    );
    if trigram.is_err() {
        let unicode = transaction.execute_batch(
            "CREATE VIRTUAL TABLE IF NOT EXISTS memory_chunks_fts
             USING fts5(chunk_id UNINDEXED, novel_id UNINDEXED, text, tokenize='unicode61');",
        );
        if let Err(error) = unicode {
            let message = error.to_string().to_ascii_lowercase();
            if message.contains("no such module") && message.contains("fts5") {
                return Ok(());
            }
            return Err(AppError::database(error));
        }
    }

    transaction
        .execute_batch(
            "CREATE TRIGGER IF NOT EXISTS trg_memory_chunks_fts_insert
             AFTER INSERT ON memory_chunks
             BEGIN
                 INSERT INTO memory_chunks_fts(rowid, chunk_id, novel_id, text)
                 VALUES (NEW.rowid, NEW.id, NEW.novel_id, NEW.text);
             END;

             CREATE TRIGGER IF NOT EXISTS trg_memory_chunks_fts_delete
             AFTER DELETE ON memory_chunks
             BEGIN
                 DELETE FROM memory_chunks_fts WHERE rowid = OLD.rowid;
             END;

             CREATE TRIGGER IF NOT EXISTS trg_memory_chunks_fts_update
             AFTER UPDATE OF text, novel_id ON memory_chunks
             BEGIN
                 DELETE FROM memory_chunks_fts WHERE rowid = OLD.rowid;
                 INSERT INTO memory_chunks_fts(rowid, chunk_id, novel_id, text)
                 VALUES (NEW.rowid, NEW.id, NEW.novel_id, NEW.text);
             END;

             DELETE FROM memory_chunks_fts;
             INSERT INTO memory_chunks_fts(rowid, chunk_id, novel_id, text)
             SELECT rowid, id, novel_id, text FROM memory_chunks;",
        )
        .map_err(AppError::database)
}

fn apply_hybrid_semantic_memory(transaction: &Transaction<'_>) -> Result<(), AppError> {
    transaction
        .execute_batch(
            "CREATE TABLE IF NOT EXISTS memory_documents (
                id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 200),
                novel_id TEXT NOT NULL,
                source_type TEXT NOT NULL CHECK (
                    source_type IN ('adopted_draft','chapter_summary','context_record')
                ),
                source_id TEXT NOT NULL CHECK (length(source_id) BETWEEN 1 AND 200),
                source_version INTEGER NOT NULL CHECK (source_version >= 1),
                source_hash TEXT NOT NULL CHECK (
                    length(source_hash) = 64 AND source_hash NOT GLOB '*[^0-9a-f]*'
                ),
                adopted_draft_id TEXT NOT NULL,
                chapter_id TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'active' CHECK (
                    status IN ('active','invalidated')
                ),
                metadata_json TEXT NOT NULL DEFAULT '{}' CHECK (
                    json_valid(metadata_json) AND json_type(metadata_json) = 'object'
                    AND length(metadata_json) <= 65536
                ),
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                invalidated_at TEXT,
                invalidation_reason TEXT CHECK (
                    invalidation_reason IS NULL OR length(invalidation_reason) <= 160
                ),
                UNIQUE(id, novel_id),
                CHECK (
                    (status = 'active' AND invalidated_at IS NULL AND invalidation_reason IS NULL)
                    OR
                    (status = 'invalidated' AND invalidated_at IS NOT NULL
                     AND invalidation_reason IS NOT NULL)
                ),
                FOREIGN KEY (novel_id) REFERENCES novels(id) ON DELETE CASCADE,
                FOREIGN KEY (chapter_id) REFERENCES chapters(id) ON DELETE CASCADE,
                FOREIGN KEY (adopted_draft_id) REFERENCES chapter_drafts(id) ON DELETE CASCADE
            );
            CREATE UNIQUE INDEX IF NOT EXISTS idx_memory_documents_one_active_source
                ON memory_documents(novel_id, source_type, source_id) WHERE status = 'active';
            CREATE INDEX IF NOT EXISTS idx_memory_documents_identity
                ON memory_documents(
                    novel_id, source_type, source_id, source_version, source_hash, created_at DESC
                );
            CREATE INDEX IF NOT EXISTS idx_memory_documents_chapter_status
                ON memory_documents(novel_id, chapter_id, status, updated_at DESC);

            CREATE TRIGGER IF NOT EXISTS trg_memory_documents_validate_scope_insert
            BEFORE INSERT ON memory_documents
            WHEN NOT EXISTS (
                SELECT 1
                FROM chapters c
                INNER JOIN chapter_drafts d
                    ON d.id = NEW.adopted_draft_id
                   AND d.chapter_id = c.id
                   AND d.novel_id = c.novel_id
                WHERE c.id = NEW.chapter_id AND c.novel_id = NEW.novel_id
            )
            BEGIN SELECT RAISE(ABORT, 'memory document scope mismatch'); END;

            CREATE TRIGGER IF NOT EXISTS trg_memory_documents_immutable_identity
            BEFORE UPDATE OF id, novel_id, source_type, source_id, source_version,
                             source_hash, adopted_draft_id, chapter_id, metadata_json, created_at
            ON memory_documents
            BEGIN SELECT RAISE(ABORT, 'memory document identity is immutable'); END;

            CREATE TRIGGER IF NOT EXISTS trg_memory_documents_status_edges
            BEFORE UPDATE OF status ON memory_documents
            WHEN NOT (
                OLD.status = NEW.status
                OR (OLD.status = 'active' AND NEW.status = 'invalidated')
            )
            BEGIN SELECT RAISE(ABORT, 'invalid memory document status transition'); END;

            CREATE TABLE IF NOT EXISTS memory_chunks (
                id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 200),
                document_id TEXT NOT NULL,
                novel_id TEXT NOT NULL,
                chapter_id TEXT NOT NULL,
                ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
                text TEXT NOT NULL CHECK (length(trim(text)) >= 1),
                token_count INTEGER NOT NULL CHECK (token_count BETWEEN 1 AND 100000),
                importance REAL NOT NULL CHECK (importance BETWEEN 0.0 AND 1.0),
                chapter_order_index INTEGER CHECK (chapter_order_index IS NULL OR chapter_order_index >= 0),
                temporal_start_chapter INTEGER CHECK (
                    temporal_start_chapter IS NULL OR temporal_start_chapter >= 0
                ),
                temporal_end_chapter INTEGER CHECK (
                    temporal_end_chapter IS NULL OR temporal_end_chapter >= 0
                ),
                entity_keys_json TEXT NOT NULL DEFAULT '[]' CHECK (
                    json_valid(entity_keys_json) AND json_type(entity_keys_json) = 'array'
                    AND length(entity_keys_json) <= 32768
                ),
                metadata_json TEXT NOT NULL DEFAULT '{}' CHECK (
                    json_valid(metadata_json) AND json_type(metadata_json) = 'object'
                    AND length(metadata_json) <= 32768
                ),
                content_hash TEXT NOT NULL CHECK (
                    length(content_hash) = 64 AND content_hash NOT GLOB '*[^0-9a-f]*'
                ),
                created_at TEXT NOT NULL,
                UNIQUE(document_id, ordinal),
                UNIQUE(id, novel_id),
                CHECK (
                    temporal_start_chapter IS NULL OR temporal_end_chapter IS NULL
                    OR temporal_end_chapter >= temporal_start_chapter
                ),
                FOREIGN KEY (document_id, novel_id)
                    REFERENCES memory_documents(id, novel_id) ON DELETE CASCADE,
                FOREIGN KEY (chapter_id) REFERENCES chapters(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_memory_chunks_novel_chapter
                ON memory_chunks(novel_id, chapter_order_index, chapter_id, importance DESC);
            CREATE INDEX IF NOT EXISTS idx_memory_chunks_document_ordinal
                ON memory_chunks(document_id, ordinal);

            CREATE TRIGGER IF NOT EXISTS trg_memory_chunks_validate_scope_insert
            BEFORE INSERT ON memory_chunks
            WHEN NOT EXISTS (
                SELECT 1 FROM memory_documents d
                WHERE d.id = NEW.document_id AND d.novel_id = NEW.novel_id
                  AND d.chapter_id = NEW.chapter_id
            )
            BEGIN SELECT RAISE(ABORT, 'memory chunk scope mismatch'); END;

            CREATE TRIGGER IF NOT EXISTS trg_memory_chunks_immutable_content
            BEFORE UPDATE OF id, document_id, novel_id, chapter_id, ordinal, text, token_count,
                             importance, chapter_order_index, temporal_start_chapter,
                             temporal_end_chapter, entity_keys_json, metadata_json,
                             content_hash, created_at
            ON memory_chunks
            BEGIN SELECT RAISE(ABORT, 'memory chunk is immutable'); END;

            CREATE TABLE IF NOT EXISTS memory_embeddings (
                id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 200),
                chunk_id TEXT NOT NULL,
                novel_id TEXT NOT NULL,
                provider TEXT NOT NULL CHECK (length(trim(provider)) BETWEEN 1 AND 80),
                model TEXT NOT NULL CHECK (length(trim(model)) BETWEEN 1 AND 160),
                dimension INTEGER NOT NULL CHECK (dimension BETWEEN 1 AND 8192),
                vector_json TEXT NOT NULL CHECK (
                    json_valid(vector_json) AND json_type(vector_json) = 'array'
                    AND json_array_length(vector_json) = dimension
                ),
                vector_norm REAL NOT NULL CHECK (vector_norm > 0.0),
                vector_hash TEXT NOT NULL CHECK (
                    length(vector_hash) = 64 AND vector_hash NOT GLOB '*[^0-9a-f]*'
                ),
                chunk_content_hash TEXT NOT NULL CHECK (
                    length(chunk_content_hash) = 64
                    AND chunk_content_hash NOT GLOB '*[^0-9a-f]*'
                ),
                created_at TEXT NOT NULL,
                UNIQUE(chunk_id, provider, model),
                FOREIGN KEY (chunk_id, novel_id)
                    REFERENCES memory_chunks(id, novel_id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_memory_embeddings_model_scope
                ON memory_embeddings(novel_id, provider, model, dimension, chunk_id);

            CREATE TRIGGER IF NOT EXISTS trg_memory_embeddings_validate_chunk_insert
            BEFORE INSERT ON memory_embeddings
            WHEN NOT EXISTS (
                SELECT 1 FROM memory_chunks c
                WHERE c.id = NEW.chunk_id AND c.novel_id = NEW.novel_id
                  AND c.content_hash = NEW.chunk_content_hash
            )
            BEGIN SELECT RAISE(ABORT, 'memory embedding chunk hash mismatch'); END;

            CREATE TRIGGER IF NOT EXISTS trg_memory_embeddings_validate_chunk_update
            BEFORE UPDATE OF vector_json, vector_norm, vector_hash, chunk_content_hash, created_at
            ON memory_embeddings
            WHEN NOT EXISTS (
                SELECT 1 FROM memory_chunks c
                WHERE c.id = NEW.chunk_id AND c.novel_id = NEW.novel_id
                  AND c.content_hash = NEW.chunk_content_hash
            )
            BEGIN SELECT RAISE(ABORT, 'memory embedding chunk hash mismatch'); END;

            CREATE TRIGGER IF NOT EXISTS trg_memory_embeddings_immutable_identity
            BEFORE UPDATE OF id, chunk_id, novel_id, provider, model, dimension
            ON memory_embeddings
            BEGIN SELECT RAISE(ABORT, 'memory embedding identity is immutable'); END;

            CREATE TABLE IF NOT EXISTS memory_retrieval_logs (
                id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 200),
                novel_id TEXT NOT NULL,
                query_hash TEXT NOT NULL CHECK (
                    length(query_hash) = 64 AND query_hash NOT GLOB '*[^0-9a-f]*'
                ),
                query_embedding_hash TEXT CHECK (
                    query_embedding_hash IS NULL OR (
                        length(query_embedding_hash) = 64
                        AND query_embedding_hash NOT GLOB '*[^0-9a-f]*'
                    )
                ),
                filters_json TEXT NOT NULL CHECK (
                    json_valid(filters_json) AND json_type(filters_json) = 'object'
                ),
                retrieval_mode TEXT NOT NULL CHECK (
                    retrieval_mode IN (
                        'hybrid','semantic_structured','fts_structured',
                        'lexical_structured','structured'
                    )
                ),
                embedding_provider TEXT,
                embedding_model TEXT,
                embedding_dimension INTEGER CHECK (
                    embedding_dimension IS NULL OR embedding_dimension BETWEEN 1 AND 8192
                ),
                fts_available INTEGER NOT NULL CHECK (fts_available IN (0,1)),
                candidate_count INTEGER NOT NULL CHECK (candidate_count BETWEEN 0 AND 500),
                selected_chunk_ids_json TEXT NOT NULL CHECK (
                    json_valid(selected_chunk_ids_json)
                    AND json_type(selected_chunk_ids_json) = 'array'
                ),
                score_reasons_json TEXT NOT NULL CHECK (
                    json_valid(score_reasons_json) AND json_type(score_reasons_json) = 'array'
                ),
                top_k INTEGER NOT NULL CHECK (top_k BETWEEN 1 AND 50),
                page_offset INTEGER NOT NULL CHECK (page_offset >= 0),
                token_budget INTEGER NOT NULL CHECK (token_budget BETWEEN 1 AND 100000),
                used_tokens INTEGER NOT NULL CHECK (
                    used_tokens >= 0 AND used_tokens <= token_budget
                ),
                created_at TEXT NOT NULL,
                CHECK (
                    (query_embedding_hash IS NULL AND embedding_provider IS NULL
                     AND embedding_model IS NULL AND embedding_dimension IS NULL)
                    OR
                    (query_embedding_hash IS NOT NULL AND embedding_provider IS NOT NULL
                     AND embedding_model IS NOT NULL AND embedding_dimension IS NOT NULL)
                ),
                FOREIGN KEY (novel_id) REFERENCES novels(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_memory_retrieval_logs_novel_created
                ON memory_retrieval_logs(novel_id, created_at DESC, id DESC);

            CREATE TRIGGER IF NOT EXISTS trg_memory_retrieval_logs_immutable
            BEFORE UPDATE ON memory_retrieval_logs
            BEGIN SELECT RAISE(ABORT, 'memory retrieval log is immutable'); END;",
        )
        .map_err(AppError::database)?;
    install_memory_fts(transaction)
}

fn apply_autonomous_book_scheduler(transaction: &Transaction<'_>) -> Result<(), AppError> {
    transaction
        .execute_batch(
            "CREATE TABLE IF NOT EXISTS autonomous_book_runs (
                run_id TEXT PRIMARY KEY CHECK (length(run_id) BETWEEN 1 AND 200),
                operation_id TEXT NOT NULL UNIQUE CHECK (length(operation_id) BETWEEN 1 AND 200),
                request_hash TEXT NOT NULL CHECK (
                    length(request_hash) = 64 AND request_hash NOT GLOB '*[^0-9a-f]*'
                ),
                novel_id TEXT NOT NULL,
                plan_id TEXT NOT NULL,
                mode TEXT NOT NULL CHECK (
                    mode IN ('draft_night','quality_gate','full_auto')
                ),
                policy_json TEXT NOT NULL CHECK (
                    json_valid(policy_json) AND json_type(policy_json) = 'object'
                    AND length(policy_json) <= 65536
                ),
                policy_hash TEXT NOT NULL CHECK (
                    length(policy_hash) = 64 AND policy_hash NOT GLOB '*[^0-9a-f]*'
                ),
                status TEXT NOT NULL DEFAULT 'queued' CHECK (
                    status IN ('queued','running','paused','completed','failed','stopped')
                ),
                state_revision INTEGER NOT NULL DEFAULT 1 CHECK (state_revision >= 1),
                next_chapter_number INTEGER NOT NULL CHECK (next_chapter_number >= 1),
                total_chapters INTEGER NOT NULL CHECK (total_chapters BETWEEN 1 AND 10000),
                completed_chapters INTEGER NOT NULL DEFAULT 0 CHECK (
                    completed_chapters >= 0 AND completed_chapters <= total_chapters
                ),
                token_input INTEGER NOT NULL DEFAULT 0 CHECK (token_input >= 0),
                token_output INTEGER NOT NULL DEFAULT 0 CHECK (token_output >= 0),
                cost_usd REAL NOT NULL DEFAULT 0 CHECK (cost_usd >= 0.0),
                usage_day TEXT NOT NULL,
                daily_token_input INTEGER NOT NULL DEFAULT 0 CHECK (daily_token_input >= 0),
                daily_token_output INTEGER NOT NULL DEFAULT 0 CHECK (daily_token_output >= 0),
                daily_cost_usd REAL NOT NULL DEFAULT 0 CHECK (daily_cost_usd >= 0.0),
                consecutive_failures INTEGER NOT NULL DEFAULT 0 CHECK (consecutive_failures >= 0),
                pause_reason TEXT CHECK (pause_reason IS NULL OR length(pause_reason) <= 240),
                error_json TEXT CHECK (error_json IS NULL OR json_valid(error_json)),
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                started_at TEXT,
                paused_at TEXT,
                completed_at TEXT,
                UNIQUE(run_id, novel_id),
                FOREIGN KEY (novel_id) REFERENCES novels(id) ON DELETE CASCADE,
                FOREIGN KEY (plan_id) REFERENCES autonomous_story_plans(plan_id) ON DELETE RESTRICT
            );
            CREATE UNIQUE INDEX IF NOT EXISTS uq_autonomous_book_runs_active_plan
                ON autonomous_book_runs(plan_id)
                WHERE status IN ('queued','running','paused');
            CREATE INDEX IF NOT EXISTS idx_autonomous_book_runs_novel_status
                ON autonomous_book_runs(novel_id, status, updated_at DESC, run_id DESC);

            CREATE TRIGGER IF NOT EXISTS trg_autonomous_book_runs_validate_scope_insert
            BEFORE INSERT ON autonomous_book_runs
            WHEN NOT EXISTS (
                SELECT 1 FROM autonomous_story_plans p
                WHERE p.plan_id = NEW.plan_id AND p.novel_id = NEW.novel_id
                  AND p.status = 'applied'
            )
            BEGIN SELECT RAISE(ABORT, 'autonomous book run scope mismatch'); END;

            CREATE TRIGGER IF NOT EXISTS trg_autonomous_book_runs_immutable_identity
            BEFORE UPDATE OF run_id, operation_id, request_hash, novel_id, plan_id,
                             mode, policy_json, policy_hash, total_chapters, created_at
            ON autonomous_book_runs
            BEGIN SELECT RAISE(ABORT, 'autonomous book run identity is immutable'); END;

            CREATE TRIGGER IF NOT EXISTS trg_autonomous_book_runs_status_edges
            BEFORE UPDATE OF status ON autonomous_book_runs
            WHEN NOT (
                OLD.status = NEW.status
                OR (OLD.status = 'queued' AND NEW.status IN ('running','paused','stopped','failed'))
                OR (OLD.status = 'running' AND NEW.status IN ('queued','paused','completed','failed','stopped'))
                OR (OLD.status = 'paused' AND NEW.status IN ('queued','stopped','failed'))
            )
            BEGIN SELECT RAISE(ABORT, 'invalid autonomous book run status transition'); END;

            CREATE TABLE IF NOT EXISTS autonomous_run_leases (
                lease_id TEXT PRIMARY KEY CHECK (length(lease_id) BETWEEN 1 AND 200),
                run_id TEXT NOT NULL,
                novel_id TEXT NOT NULL,
                epoch INTEGER NOT NULL CHECK (epoch >= 1),
                owner_id TEXT NOT NULL CHECK (length(owner_id) BETWEEN 1 AND 200),
                token_hash TEXT NOT NULL CHECK (
                    length(token_hash) = 64 AND token_hash NOT GLOB '*[^0-9a-f]*'
                ),
                expires_at TEXT NOT NULL,
                status TEXT NOT NULL CHECK (status IN ('active','released','expired')),
                acquired_at TEXT NOT NULL,
                renewed_at TEXT,
                released_at TEXT,
                UNIQUE(run_id, epoch),
                UNIQUE(lease_id, run_id, epoch),
                FOREIGN KEY (run_id, novel_id)
                    REFERENCES autonomous_book_runs(run_id, novel_id) ON DELETE CASCADE
            );
            CREATE UNIQUE INDEX IF NOT EXISTS uq_autonomous_run_leases_active
                ON autonomous_run_leases(run_id) WHERE status = 'active';
            CREATE INDEX IF NOT EXISTS idx_autonomous_run_leases_expiry
                ON autonomous_run_leases(status, expires_at, run_id);

            CREATE TRIGGER IF NOT EXISTS trg_autonomous_run_leases_monotonic_epoch
            BEFORE INSERT ON autonomous_run_leases
            WHEN NEW.epoch <= COALESCE((
                SELECT MAX(epoch) FROM autonomous_run_leases WHERE run_id = NEW.run_id
            ), 0)
            BEGIN SELECT RAISE(ABORT, 'autonomous run lease epoch must increase'); END;

            CREATE TRIGGER IF NOT EXISTS trg_autonomous_run_leases_immutable_identity
            BEFORE UPDATE OF lease_id, run_id, novel_id, epoch, owner_id, token_hash, acquired_at
            ON autonomous_run_leases
            BEGIN SELECT RAISE(ABORT, 'autonomous run lease identity is immutable'); END;

            CREATE TRIGGER IF NOT EXISTS trg_autonomous_run_leases_status_edges
            BEFORE UPDATE OF status ON autonomous_run_leases
            WHEN NOT (
                OLD.status = NEW.status
                OR (OLD.status = 'active' AND NEW.status IN ('released','expired'))
            )
            BEGIN SELECT RAISE(ABORT, 'invalid autonomous run lease status transition'); END;

            CREATE TABLE IF NOT EXISTS autonomous_run_chapter_attempts (
                attempt_id TEXT PRIMARY KEY CHECK (length(attempt_id) BETWEEN 1 AND 200),
                run_id TEXT NOT NULL,
                novel_id TEXT NOT NULL,
                chapter_id TEXT NOT NULL,
                chapter_number INTEGER NOT NULL CHECK (chapter_number >= 1),
                attempt_number INTEGER NOT NULL CHECK (attempt_number >= 1),
                operation_id TEXT NOT NULL UNIQUE CHECK (length(operation_id) BETWEEN 1 AND 240),
                lease_id TEXT NOT NULL,
                lease_epoch INTEGER NOT NULL CHECK (lease_epoch >= 1),
                status TEXT NOT NULL CHECK (
                    status IN (
                        'claimed','candidate_ready','adopted','confirmed',
                        'failed','cancelled','abandoned'
                    )
                ),
                estimated_tokens INTEGER NOT NULL CHECK (estimated_tokens >= 0),
                estimated_cost_usd REAL NOT NULL CHECK (estimated_cost_usd >= 0.0),
                token_input INTEGER CHECK (token_input IS NULL OR token_input >= 0),
                token_output INTEGER CHECK (token_output IS NULL OR token_output >= 0),
                cost_usd REAL CHECK (cost_usd IS NULL OR cost_usd >= 0.0),
                candidate_draft_id TEXT,
                adopted_draft_id TEXT,
                review_session_id TEXT,
                successful_experts INTEGER CHECK (
                    successful_experts IS NULL OR successful_experts BETWEEN 0 AND 64
                ),
                average_score REAL CHECK (
                    average_score IS NULL OR average_score BETWEEN 0.0 AND 100.0
                ),
                acceptance_rate REAL CHECK (
                    acceptance_rate IS NULL OR acceptance_rate BETWEEN 0.0 AND 1.0
                ),
                analysis_confirmed INTEGER NOT NULL DEFAULT 0 CHECK (analysis_confirmed IN (0,1)),
                decision_json TEXT CHECK (decision_json IS NULL OR json_valid(decision_json)),
                decision_hash TEXT CHECK (
                    decision_hash IS NULL OR (
                        length(decision_hash) = 64 AND decision_hash NOT GLOB '*[^0-9a-f]*'
                    )
                ),
                error_json TEXT CHECK (error_json IS NULL OR json_valid(error_json)),
                claimed_at TEXT NOT NULL,
                finished_at TEXT,
                UNIQUE(run_id, chapter_number, attempt_number),
                UNIQUE(attempt_id, run_id),
                FOREIGN KEY (run_id, novel_id)
                    REFERENCES autonomous_book_runs(run_id, novel_id) ON DELETE CASCADE,
                FOREIGN KEY (lease_id, run_id, lease_epoch)
                    REFERENCES autonomous_run_leases(lease_id, run_id, epoch) ON DELETE RESTRICT,
                FOREIGN KEY (chapter_id) REFERENCES chapters(id) ON DELETE RESTRICT,
                FOREIGN KEY (candidate_draft_id) REFERENCES chapter_drafts(id) ON DELETE RESTRICT,
                FOREIGN KEY (adopted_draft_id) REFERENCES chapter_drafts(id) ON DELETE RESTRICT,
                CHECK (
                    (status = 'claimed' AND finished_at IS NULL)
                    OR (status <> 'claimed' AND finished_at IS NOT NULL)
                )
            );
            CREATE UNIQUE INDEX IF NOT EXISTS uq_autonomous_run_attempts_claimed_chapter
                ON autonomous_run_chapter_attempts(run_id, chapter_number)
                WHERE status = 'claimed';
            CREATE INDEX IF NOT EXISTS idx_autonomous_run_attempts_progress
                ON autonomous_run_chapter_attempts(run_id, chapter_number, attempt_number DESC);

            CREATE TRIGGER IF NOT EXISTS trg_autonomous_run_attempts_validate_scope_insert
            BEFORE INSERT ON autonomous_run_chapter_attempts
            WHEN NOT EXISTS (
                SELECT 1 FROM autonomous_book_runs r
                JOIN chapters c ON c.id = NEW.chapter_id AND c.novel_id = r.novel_id
                WHERE r.run_id = NEW.run_id AND r.novel_id = NEW.novel_id
            )
            BEGIN SELECT RAISE(ABORT, 'autonomous run attempt scope mismatch'); END;

            CREATE TRIGGER IF NOT EXISTS trg_autonomous_run_attempts_immutable_identity
            BEFORE UPDATE OF attempt_id, run_id, novel_id, chapter_id, chapter_number,
                             attempt_number, operation_id, lease_id, lease_epoch,
                             estimated_tokens, estimated_cost_usd, claimed_at
            ON autonomous_run_chapter_attempts
            BEGIN SELECT RAISE(ABORT, 'autonomous run attempt identity is immutable'); END;

            CREATE TRIGGER IF NOT EXISTS trg_autonomous_run_attempts_status_edges
            BEFORE UPDATE OF status ON autonomous_run_chapter_attempts
            WHEN NOT (
                OLD.status = NEW.status
                OR (OLD.status = 'claimed' AND NEW.status IN (
                    'candidate_ready','adopted','confirmed','failed','cancelled','abandoned'
                ))
                OR (OLD.status = 'candidate_ready' AND NEW.status IN ('adopted','confirmed'))
                OR (OLD.status = 'adopted' AND NEW.status = 'confirmed')
            )
            BEGIN SELECT RAISE(ABORT, 'invalid autonomous run attempt status transition'); END;

            CREATE TABLE IF NOT EXISTS autonomous_run_checkpoints (
                checkpoint_id TEXT PRIMARY KEY CHECK (length(checkpoint_id) BETWEEN 1 AND 200),
                run_id TEXT NOT NULL,
                novel_id TEXT NOT NULL,
                sequence INTEGER NOT NULL CHECK (sequence >= 1),
                event_type TEXT NOT NULL CHECK (length(event_type) BETWEEN 1 AND 80),
                attempt_id TEXT,
                run_status TEXT NOT NULL,
                payload_json TEXT NOT NULL CHECK (
                    json_valid(payload_json) AND json_type(payload_json) = 'object'
                    AND length(payload_json) <= 65536
                ),
                payload_hash TEXT NOT NULL CHECK (
                    length(payload_hash) = 64 AND payload_hash NOT GLOB '*[^0-9a-f]*'
                ),
                created_at TEXT NOT NULL,
                UNIQUE(run_id, sequence),
                FOREIGN KEY (run_id, novel_id)
                    REFERENCES autonomous_book_runs(run_id, novel_id) ON DELETE CASCADE,
                FOREIGN KEY (attempt_id, run_id)
                    REFERENCES autonomous_run_chapter_attempts(attempt_id, run_id) ON DELETE RESTRICT
            );
            CREATE INDEX IF NOT EXISTS idx_autonomous_run_checkpoints_run_sequence
                ON autonomous_run_checkpoints(run_id, sequence DESC);

            CREATE TRIGGER IF NOT EXISTS trg_autonomous_run_checkpoints_monotonic_sequence
            BEFORE INSERT ON autonomous_run_checkpoints
            WHEN NEW.sequence <= COALESCE((
                SELECT MAX(sequence) FROM autonomous_run_checkpoints WHERE run_id = NEW.run_id
            ), 0)
            BEGIN SELECT RAISE(ABORT, 'autonomous run checkpoint sequence must increase'); END;

            CREATE TRIGGER IF NOT EXISTS trg_autonomous_run_checkpoints_append_only_update
            BEFORE UPDATE ON autonomous_run_checkpoints
            BEGIN SELECT RAISE(ABORT, 'autonomous run checkpoint is append only'); END;

            CREATE TRIGGER IF NOT EXISTS trg_autonomous_run_checkpoints_append_only_delete
            BEFORE DELETE ON autonomous_run_checkpoints
            BEGIN SELECT RAISE(ABORT, 'autonomous run checkpoint is append only'); END;",
        )
        .map_err(AppError::database)
}

fn apply_multi_target_transactions_and_story_assets(
    transaction: &Transaction<'_>,
) -> Result<(), AppError> {
    transaction
        .execute_batch(
            "CREATE TABLE IF NOT EXISTS factions (
                id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 200),
                novel_id TEXT NOT NULL,
                name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 240),
                kind TEXT CHECK (kind IS NULL OR length(kind) <= 120),
                description TEXT NOT NULL DEFAULT '' CHECK (length(description) <= 100000),
                goals TEXT NOT NULL DEFAULT '' CHECK (length(goals) <= 50000),
                revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                UNIQUE(id, novel_id),
                UNIQUE(novel_id, name),
                FOREIGN KEY (novel_id) REFERENCES novels(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_factions_novel_name
                ON factions(novel_id, name, id);

            CREATE TABLE IF NOT EXISTS locations (
                id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 200),
                novel_id TEXT NOT NULL,
                name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 240),
                kind TEXT CHECK (kind IS NULL OR length(kind) <= 120),
                description TEXT NOT NULL DEFAULT '' CHECK (length(description) <= 100000),
                parent_location_id TEXT,
                revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                UNIQUE(id, novel_id),
                UNIQUE(novel_id, name),
                FOREIGN KEY (novel_id) REFERENCES novels(id) ON DELETE CASCADE,
                FOREIGN KEY (parent_location_id, novel_id)
                    REFERENCES locations(id, novel_id) ON DELETE RESTRICT,
                CHECK (parent_location_id IS NULL OR parent_location_id <> id)
            );
            CREATE INDEX IF NOT EXISTS idx_locations_novel_parent
                ON locations(novel_id, parent_location_id, name, id);

            CREATE TABLE IF NOT EXISTS faction_relations (
                id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 200),
                novel_id TEXT NOT NULL,
                source_faction_id TEXT NOT NULL,
                target_faction_id TEXT NOT NULL,
                relation_type TEXT NOT NULL CHECK (length(relation_type) BETWEEN 1 AND 120),
                description TEXT NOT NULL DEFAULT '' CHECK (length(description) <= 50000),
                revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                UNIQUE(id, novel_id),
                UNIQUE(novel_id, source_faction_id, target_faction_id, relation_type),
                FOREIGN KEY (novel_id) REFERENCES novels(id) ON DELETE CASCADE,
                FOREIGN KEY (source_faction_id, novel_id)
                    REFERENCES factions(id, novel_id) ON DELETE RESTRICT,
                FOREIGN KEY (target_faction_id, novel_id)
                    REFERENCES factions(id, novel_id) ON DELETE RESTRICT,
                CHECK (source_faction_id <> target_faction_id)
            );
            CREATE INDEX IF NOT EXISTS idx_faction_relations_novel_source
                ON faction_relations(novel_id, source_faction_id, target_faction_id);

            CREATE TABLE IF NOT EXISTS location_links (
                id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 200),
                novel_id TEXT NOT NULL,
                source_location_id TEXT NOT NULL,
                target_location_id TEXT NOT NULL,
                link_type TEXT NOT NULL CHECK (length(link_type) BETWEEN 1 AND 120),
                description TEXT NOT NULL DEFAULT '' CHECK (length(description) <= 50000),
                revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                UNIQUE(id, novel_id),
                UNIQUE(novel_id, source_location_id, target_location_id, link_type),
                FOREIGN KEY (novel_id) REFERENCES novels(id) ON DELETE CASCADE,
                FOREIGN KEY (source_location_id, novel_id)
                    REFERENCES locations(id, novel_id) ON DELETE RESTRICT,
                FOREIGN KEY (target_location_id, novel_id)
                    REFERENCES locations(id, novel_id) ON DELETE RESTRICT,
                CHECK (source_location_id <> target_location_id)
            );
            CREATE INDEX IF NOT EXISTS idx_location_links_novel_source
                ON location_links(novel_id, source_location_id, target_location_id);

            CREATE TABLE IF NOT EXISTS character_factions (
                id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 200),
                novel_id TEXT NOT NULL,
                character_id TEXT NOT NULL,
                faction_id TEXT NOT NULL,
                role TEXT NOT NULL DEFAULT '' CHECK (length(role) <= 240),
                revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                UNIQUE(id, novel_id), UNIQUE(novel_id, character_id, faction_id),
                FOREIGN KEY (novel_id) REFERENCES novels(id) ON DELETE CASCADE,
                FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE RESTRICT,
                FOREIGN KEY (faction_id, novel_id) REFERENCES factions(id, novel_id) ON DELETE RESTRICT
            );
            CREATE TABLE IF NOT EXISTS chapter_factions (
                id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 200),
                novel_id TEXT NOT NULL, chapter_id TEXT NOT NULL, faction_id TEXT NOT NULL,
                role TEXT NOT NULL DEFAULT '' CHECK (length(role) <= 240),
                revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
                created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
                UNIQUE(id, novel_id), UNIQUE(novel_id, chapter_id, faction_id),
                FOREIGN KEY (novel_id) REFERENCES novels(id) ON DELETE CASCADE,
                FOREIGN KEY (chapter_id) REFERENCES chapters(id) ON DELETE RESTRICT,
                FOREIGN KEY (faction_id, novel_id) REFERENCES factions(id, novel_id) ON DELETE RESTRICT
            );
            CREATE TABLE IF NOT EXISTS chapter_locations (
                id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 200),
                novel_id TEXT NOT NULL, chapter_id TEXT NOT NULL, location_id TEXT NOT NULL,
                role TEXT NOT NULL DEFAULT '' CHECK (length(role) <= 240),
                revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
                created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
                UNIQUE(id, novel_id), UNIQUE(novel_id, chapter_id, location_id),
                FOREIGN KEY (novel_id) REFERENCES novels(id) ON DELETE CASCADE,
                FOREIGN KEY (chapter_id) REFERENCES chapters(id) ON DELETE RESTRICT,
                FOREIGN KEY (location_id, novel_id) REFERENCES locations(id, novel_id) ON DELETE RESTRICT
            );
            CREATE TABLE IF NOT EXISTS chapter_event_factions (
                id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 200),
                novel_id TEXT NOT NULL, chapter_event_id TEXT NOT NULL, faction_id TEXT NOT NULL,
                role TEXT NOT NULL DEFAULT '' CHECK (length(role) <= 240),
                revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
                created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
                UNIQUE(id, novel_id), UNIQUE(novel_id, chapter_event_id, faction_id),
                FOREIGN KEY (novel_id) REFERENCES novels(id) ON DELETE CASCADE,
                FOREIGN KEY (chapter_event_id) REFERENCES chapter_events(id) ON DELETE RESTRICT,
                FOREIGN KEY (faction_id, novel_id) REFERENCES factions(id, novel_id) ON DELETE RESTRICT
            );
            CREATE TABLE IF NOT EXISTS chapter_event_locations (
                id TEXT PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 200),
                novel_id TEXT NOT NULL, chapter_event_id TEXT NOT NULL, location_id TEXT NOT NULL,
                role TEXT NOT NULL DEFAULT '' CHECK (length(role) <= 240),
                revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
                created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
                UNIQUE(id, novel_id), UNIQUE(novel_id, chapter_event_id, location_id),
                FOREIGN KEY (novel_id) REFERENCES novels(id) ON DELETE CASCADE,
                FOREIGN KEY (chapter_event_id) REFERENCES chapter_events(id) ON DELETE RESTRICT,
                FOREIGN KEY (location_id, novel_id) REFERENCES locations(id, novel_id) ON DELETE RESTRICT
            );

            CREATE INDEX IF NOT EXISTS idx_character_factions_scope ON character_factions(novel_id, character_id);
            CREATE INDEX IF NOT EXISTS idx_chapter_factions_scope ON chapter_factions(novel_id, chapter_id);
            CREATE INDEX IF NOT EXISTS idx_chapter_locations_scope ON chapter_locations(novel_id, chapter_id);
            CREATE INDEX IF NOT EXISTS idx_event_factions_scope ON chapter_event_factions(novel_id, chapter_event_id);
            CREATE INDEX IF NOT EXISTS idx_event_locations_scope ON chapter_event_locations(novel_id, chapter_event_id);

            CREATE TABLE IF NOT EXISTS content_target_revisions (
                target_type TEXT NOT NULL,
                target_id TEXT NOT NULL,
                novel_id TEXT NOT NULL,
                revision INTEGER NOT NULL CHECK (revision >= 1),
                content_hash TEXT NOT NULL CHECK (length(content_hash)=64 AND content_hash NOT GLOB '*[^0-9a-f]*'),
                updated_at TEXT NOT NULL,
                PRIMARY KEY(target_type, target_id),
                FOREIGN KEY (novel_id) REFERENCES novels(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS content_transactions (
                transaction_id TEXT PRIMARY KEY CHECK (length(transaction_id) BETWEEN 1 AND 200),
                operation_id TEXT NOT NULL UNIQUE CHECK (length(operation_id) BETWEEN 1 AND 240),
                request_hash TEXT NOT NULL CHECK (length(request_hash)=64 AND request_hash NOT GLOB '*[^0-9a-f]*'),
                novel_id TEXT NOT NULL,
                strategy TEXT NOT NULL CHECK (strategy IN ('all_or_nothing','reviewed_partial')),
                target_set_json TEXT NOT NULL CHECK (json_valid(target_set_json) AND json_type(target_set_json)='array'),
                target_set_hash TEXT NOT NULL CHECK (length(target_set_hash)=64 AND target_set_hash NOT GLOB '*[^0-9a-f]*'),
                transaction_hash TEXT NOT NULL CHECK (length(transaction_hash)=64 AND transaction_hash NOT GLOB '*[^0-9a-f]*'),
                status TEXT NOT NULL DEFAULT 'prepared' CHECK (status IN ('prepared','applied','conflict')),
                revision INTEGER NOT NULL DEFAULT 1 CHECK (revision >= 1),
                result_json TEXT CHECK (result_json IS NULL OR json_valid(result_json)),
                created_at TEXT NOT NULL,
                applied_at TEXT,
                UNIQUE(transaction_id, novel_id),
                FOREIGN KEY (novel_id) REFERENCES novels(id) ON DELETE RESTRICT,
                CHECK ((status='prepared' AND applied_at IS NULL AND result_json IS NULL) OR
                       (status='applied' AND applied_at IS NOT NULL AND result_json IS NOT NULL) OR
                       status='conflict')
            );
            CREATE INDEX IF NOT EXISTS idx_content_transactions_novel_status
                ON content_transactions(novel_id, status, created_at DESC);

            CREATE TABLE IF NOT EXISTS content_transaction_targets (
                transaction_id TEXT NOT NULL,
                novel_id TEXT NOT NULL,
                ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
                target_type TEXT NOT NULL CHECK (target_type IN (
                    'faction','location','faction_relation','location_link',
                    'character_faction','chapter_faction','chapter_location',
                    'chapter_event_faction','chapter_event_location','chapter_metadata'
                )),
                target_id TEXT NOT NULL CHECK (length(target_id) BETWEEN 1 AND 200),
                effect_type TEXT NOT NULL CHECK (effect_type IN ('create','update')),
                base_revision INTEGER NOT NULL CHECK (base_revision >= 0),
                base_hash TEXT NOT NULL CHECK (length(base_hash)=64 AND base_hash NOT GLOB '*[^0-9a-f]*'),
                candidate_payload_json TEXT NOT NULL CHECK (json_valid(candidate_payload_json) AND json_type(candidate_payload_json)='object'),
                candidate_hash TEXT NOT NULL CHECK (length(candidate_hash)=64 AND candidate_hash NOT GLOB '*[^0-9a-f]*'),
                applied_revision INTEGER,
                applied_hash TEXT CHECK (applied_hash IS NULL OR (length(applied_hash)=64 AND applied_hash NOT GLOB '*[^0-9a-f]*')),
                applied_at TEXT,
                PRIMARY KEY(transaction_id, ordinal),
                UNIQUE(transaction_id, target_type, target_id),
                FOREIGN KEY (transaction_id, novel_id)
                    REFERENCES content_transactions(transaction_id, novel_id) ON DELETE RESTRICT,
                CHECK ((applied_revision IS NULL AND applied_hash IS NULL AND applied_at IS NULL) OR
                       (applied_revision IS NOT NULL AND applied_hash IS NOT NULL AND applied_at IS NOT NULL))
            );
            CREATE INDEX IF NOT EXISTS idx_content_transaction_targets_identity
                ON content_transaction_targets(target_type, target_id, transaction_id);

            CREATE TRIGGER IF NOT EXISTS trg_content_transactions_immutable_identity
            BEFORE UPDATE OF transaction_id, operation_id, request_hash, novel_id, strategy,
                             target_set_json, target_set_hash, transaction_hash, created_at
            ON content_transactions
            BEGIN SELECT RAISE(ABORT, 'content transaction identity is immutable'); END;
            CREATE TRIGGER IF NOT EXISTS trg_content_transactions_status_edges
            BEFORE UPDATE OF status ON content_transactions
            WHEN NOT (OLD.status=NEW.status OR (OLD.status='prepared' AND NEW.status IN ('applied','conflict')))
            BEGIN SELECT RAISE(ABORT, 'invalid content transaction status transition'); END;
            CREATE TRIGGER IF NOT EXISTS trg_content_transaction_targets_immutable_candidate
            BEFORE UPDATE OF transaction_id, novel_id, ordinal, target_type, target_id, effect_type,
                             base_revision, base_hash, candidate_payload_json, candidate_hash
            ON content_transaction_targets
            BEGIN SELECT RAISE(ABORT, 'content transaction target candidate is immutable'); END;
            CREATE TRIGGER IF NOT EXISTS trg_content_transaction_targets_no_delete
            BEFORE DELETE ON content_transaction_targets
            BEGIN SELECT RAISE(ABORT, 'content transaction target cannot be deleted'); END;

            CREATE TRIGGER IF NOT EXISTS trg_locations_no_hierarchy_cycle_insert
            BEFORE INSERT ON locations WHEN NEW.parent_location_id IS NOT NULL AND EXISTS (
                WITH RECURSIVE ancestors(id) AS (
                    SELECT NEW.parent_location_id
                    UNION ALL SELECT l.parent_location_id FROM locations l JOIN ancestors a ON l.id=a.id
                    WHERE l.parent_location_id IS NOT NULL
                ) SELECT 1 FROM ancestors WHERE id=NEW.id
            ) BEGIN SELECT RAISE(ABORT, 'location hierarchy cycle'); END;
            CREATE TRIGGER IF NOT EXISTS trg_locations_no_hierarchy_cycle_update
            BEFORE UPDATE OF parent_location_id ON locations WHEN NEW.parent_location_id IS NOT NULL AND EXISTS (
                WITH RECURSIVE ancestors(id) AS (
                    SELECT NEW.parent_location_id
                    UNION ALL SELECT l.parent_location_id FROM locations l JOIN ancestors a ON l.id=a.id
                    WHERE l.parent_location_id IS NOT NULL
                ) SELECT 1 FROM ancestors WHERE id=NEW.id
            ) BEGIN SELECT RAISE(ABORT, 'location hierarchy cycle'); END;

            CREATE TRIGGER IF NOT EXISTS trg_character_factions_scope_insert BEFORE INSERT ON character_factions
            WHEN NOT EXISTS (SELECT 1 FROM characters c WHERE c.id=NEW.character_id AND c.novel_id=NEW.novel_id)
            BEGIN SELECT RAISE(ABORT, 'character faction scope mismatch'); END;
            CREATE TRIGGER IF NOT EXISTS trg_character_factions_scope_update BEFORE UPDATE OF character_id ON character_factions
            WHEN NOT EXISTS (SELECT 1 FROM characters c WHERE c.id=NEW.character_id AND c.novel_id=NEW.novel_id)
            BEGIN SELECT RAISE(ABORT, 'character faction scope mismatch'); END;
            CREATE TRIGGER IF NOT EXISTS trg_chapter_factions_scope_insert BEFORE INSERT ON chapter_factions
            WHEN NOT EXISTS (SELECT 1 FROM chapters c WHERE c.id=NEW.chapter_id AND c.novel_id=NEW.novel_id AND c.deleted_at IS NULL)
            BEGIN SELECT RAISE(ABORT, 'chapter faction scope mismatch'); END;
            CREATE TRIGGER IF NOT EXISTS trg_chapter_factions_scope_update BEFORE UPDATE OF chapter_id ON chapter_factions
            WHEN NOT EXISTS (SELECT 1 FROM chapters c WHERE c.id=NEW.chapter_id AND c.novel_id=NEW.novel_id AND c.deleted_at IS NULL)
            BEGIN SELECT RAISE(ABORT, 'chapter faction scope mismatch'); END;
            CREATE TRIGGER IF NOT EXISTS trg_chapter_locations_scope_insert BEFORE INSERT ON chapter_locations
            WHEN NOT EXISTS (SELECT 1 FROM chapters c WHERE c.id=NEW.chapter_id AND c.novel_id=NEW.novel_id AND c.deleted_at IS NULL)
            BEGIN SELECT RAISE(ABORT, 'chapter location scope mismatch'); END;
            CREATE TRIGGER IF NOT EXISTS trg_chapter_locations_scope_update BEFORE UPDATE OF chapter_id ON chapter_locations
            WHEN NOT EXISTS (SELECT 1 FROM chapters c WHERE c.id=NEW.chapter_id AND c.novel_id=NEW.novel_id AND c.deleted_at IS NULL)
            BEGIN SELECT RAISE(ABORT, 'chapter location scope mismatch'); END;
            CREATE TRIGGER IF NOT EXISTS trg_event_factions_scope_insert BEFORE INSERT ON chapter_event_factions
            WHEN NOT EXISTS (SELECT 1 FROM chapter_events e WHERE e.id=NEW.chapter_event_id AND e.novel_id=NEW.novel_id)
            BEGIN SELECT RAISE(ABORT, 'event faction scope mismatch'); END;
            CREATE TRIGGER IF NOT EXISTS trg_event_factions_scope_update BEFORE UPDATE OF chapter_event_id ON chapter_event_factions
            WHEN NOT EXISTS (SELECT 1 FROM chapter_events e WHERE e.id=NEW.chapter_event_id AND e.novel_id=NEW.novel_id)
            BEGIN SELECT RAISE(ABORT, 'event faction scope mismatch'); END;
            CREATE TRIGGER IF NOT EXISTS trg_event_locations_scope_insert BEFORE INSERT ON chapter_event_locations
            WHEN NOT EXISTS (SELECT 1 FROM chapter_events e WHERE e.id=NEW.chapter_event_id AND e.novel_id=NEW.novel_id)
            BEGIN SELECT RAISE(ABORT, 'event location scope mismatch'); END;
            CREATE TRIGGER IF NOT EXISTS trg_event_locations_scope_update BEFORE UPDATE OF chapter_event_id ON chapter_event_locations
            WHEN NOT EXISTS (SELECT 1 FROM chapter_events e WHERE e.id=NEW.chapter_event_id AND e.novel_id=NEW.novel_id)
            BEGIN SELECT RAISE(ABORT, 'event location scope mismatch'); END;

            CREATE TRIGGER IF NOT EXISTS trg_factions_revision_cas BEFORE UPDATE ON factions
            WHEN NEW.revision<>OLD.revision+1 OR NEW.id<>OLD.id OR NEW.novel_id<>OLD.novel_id OR NEW.created_at<>OLD.created_at
            BEGIN SELECT RAISE(ABORT, 'faction revision cas or identity violation'); END;
            CREATE TRIGGER IF NOT EXISTS trg_locations_revision_cas BEFORE UPDATE ON locations
            WHEN NEW.revision<>OLD.revision+1 OR NEW.id<>OLD.id OR NEW.novel_id<>OLD.novel_id OR NEW.created_at<>OLD.created_at
            BEGIN SELECT RAISE(ABORT, 'location revision cas or identity violation'); END;
            CREATE TRIGGER IF NOT EXISTS trg_faction_relations_revision_cas BEFORE UPDATE ON faction_relations
            WHEN NEW.revision<>OLD.revision+1 OR NEW.id<>OLD.id OR NEW.novel_id<>OLD.novel_id OR NEW.created_at<>OLD.created_at
            BEGIN SELECT RAISE(ABORT, 'faction relation revision cas or identity violation'); END;
            CREATE TRIGGER IF NOT EXISTS trg_location_links_revision_cas BEFORE UPDATE ON location_links
            WHEN NEW.revision<>OLD.revision+1 OR NEW.id<>OLD.id OR NEW.novel_id<>OLD.novel_id OR NEW.created_at<>OLD.created_at
            BEGIN SELECT RAISE(ABORT, 'location link revision cas or identity violation'); END;
            CREATE TRIGGER IF NOT EXISTS trg_character_factions_revision_cas BEFORE UPDATE ON character_factions
            WHEN NEW.revision<>OLD.revision+1 OR NEW.id<>OLD.id OR NEW.novel_id<>OLD.novel_id OR NEW.created_at<>OLD.created_at
            BEGIN SELECT RAISE(ABORT, 'character faction revision cas or identity violation'); END;
            CREATE TRIGGER IF NOT EXISTS trg_chapter_factions_revision_cas BEFORE UPDATE ON chapter_factions
            WHEN NEW.revision<>OLD.revision+1 OR NEW.id<>OLD.id OR NEW.novel_id<>OLD.novel_id OR NEW.created_at<>OLD.created_at
            BEGIN SELECT RAISE(ABORT, 'chapter faction revision cas or identity violation'); END;
            CREATE TRIGGER IF NOT EXISTS trg_chapter_locations_revision_cas BEFORE UPDATE ON chapter_locations
            WHEN NEW.revision<>OLD.revision+1 OR NEW.id<>OLD.id OR NEW.novel_id<>OLD.novel_id OR NEW.created_at<>OLD.created_at
            BEGIN SELECT RAISE(ABORT, 'chapter location revision cas or identity violation'); END;
            CREATE TRIGGER IF NOT EXISTS trg_event_factions_revision_cas BEFORE UPDATE ON chapter_event_factions
            WHEN NEW.revision<>OLD.revision+1 OR NEW.id<>OLD.id OR NEW.novel_id<>OLD.novel_id OR NEW.created_at<>OLD.created_at
            BEGIN SELECT RAISE(ABORT, 'event faction revision cas or identity violation'); END;
            CREATE TRIGGER IF NOT EXISTS trg_event_locations_revision_cas BEFORE UPDATE ON chapter_event_locations
            WHEN NEW.revision<>OLD.revision+1 OR NEW.id<>OLD.id OR NEW.novel_id<>OLD.novel_id OR NEW.created_at<>OLD.created_at
            BEGIN SELECT RAISE(ABORT, 'event location revision cas or identity violation'); END;",
        )
        .map_err(AppError::database)
}

#[cfg(test)]
mod tests {
    use super::*;

    const EXPECTED_MIGRATION_CHECKSUMS: [(&str, &str); 28] = [
        (
            "001_schema_migrations",
            "65e4591cc3a707e67920683594bc839909a942cab697c15831fa1e1d1a9207b1",
        ),
        (
            "002_workspace_recovery_snapshots",
            "7b3d51eb4fedcdac62b04d427746c8990a43d1ce98a1e80ea2f4b3e2429ee739",
        ),
        (
            "003_draft_save_operations",
            "62d442e75b5bdf0fb1e1149d454cce9611f42221185bb7b5e16eab762c77e1ec",
        ),
        (
            "004_large_text_integrity",
            "6397a9245892ad2b77472f203055f9e1f13ceb90f30b60d4062f4fb007d2d15b",
        ),
        (
            "005_ai_tasks",
            "86f8285a333d77c05ff07556a7d8a35f5d6f28ad0a21ecd9ede45b03a9cb9d9f",
        ),
        (
            "006_ai_task_attempts",
            "9bf5adc5683e5e2c4384c299e30e782ca604f059df2acb244742ae329d1a7406",
        ),
        (
            "007_ai_input_snapshots",
            "096e07deccdd9c6ce202cfefd729f38cf5a6d899aece4cac7dc097028136107c",
        ),
        (
            "008_ai_context_snapshots",
            "38a009d092f26ccb6f6860f1697fdf6b1f6432293b12e975f0980b2f7d270db8",
        ),
        (
            "009_ai_constraint_snapshots",
            "20cff44a9ea326ca0bd05f3c2d1a3bb3d13692754142b6948b22051b0757398d",
        ),
        (
            "010_result_artifacts",
            "10d26a27702fb70b1a22b17bc775f1e17527bd5d431ca6fdd23276596ae79e58",
        ),
        (
            "011_artifact_validation_issues",
            "0232fec8a74c153c5f5aa0004a8a61f823e2b0b6dddf1928eda9e78fab20ec67",
        ),
        (
            "012_placement_proposals",
            "44e81ec6116531691a4e6232e1f41889e0d40328ab3df735eeb48b1c470b937a",
        ),
        (
            "013_apply_plans",
            "d4b213d255d1626648e42e672ffe50fe94793e3b027c406b397fa5a060b634e1",
        ),
        (
            "014_artifact_target_links",
            "168fb1e5d289cd1a1fd0b4fdc01e2e229c54d7634762130789412d190207a4f0",
        ),
        (
            "015_agent_plans",
            "717a12104caaded6d71f868e0ea0b67c80df5a0fea5d43962c5b1449a7895283",
        ),
        (
            "016_agent_plan_steps",
            "4893dbcbbb70025eb567ebe3d1ef6b7cb661c23013dc37b2f72e9dc0c2c57e4e",
        ),
        (
            "017_agent_plan_step_dependencies",
            "8c529cce5b3b8279d5dd20f3c289d654c4e8ff54150b42594dbdba1ef3f52e85",
        ),
        (
            "018_agent_plan_step_attempts",
            "fbd7fec3b8f47eaf0f0f0e3f03771d729d54a3b649328cd78c0fa98bb22e8506",
        ),
        (
            "019_agent_execution_leases",
            "bcf2233f99cc29a124f08d719bbb2c6311e4261e064c43e4b80085f53cafcfc1",
        ),
        (
            "020_agent_plan_checkpoints",
            "4341b1035cd13cf6dca38397377d45575363bee98ffdad746d02862764607045",
        ),
        (
            "021_multi_agent_sessions",
            "e8878c39009e7830db32d3be64dc22e387ea8e96d644ba8a16d0a56c3e705367",
        ),
        (
            "022_multi_agent_rounds",
            "f7421084435da8a403c7178f3bbedfee80fa499be21f7449ffc4cd027cc57919",
        ),
        (
            "023_multi_agent_opinions",
            "d49e6ba3cb7961c35579bd01b9c5dd7e0dda208b54fff6317f16821058e34911",
        ),
        (
            "024_autonomous_story_plans",
            "3a5e391fa6ed9c360472a71cdfd0f09a759112fba283e180d8c3cba113b3eb53",
        ),
        (
            "025_reference_library",
            "8980119b08c81d8b48d986150fa8a835390fb85594677f3c296a37dc740f9293",
        ),
        (
            "026_hybrid_semantic_memory",
            "a8622dab5bf60ec4cc7177437fe2e2c5c5da753045b339cac01b0083ce163b0b",
        ),
        (
            "027_autonomous_book_scheduler",
            "bfe8cc7dd1fbe7d9da6664b611d2f5c2aef97ace02ea768862e74b4a01d085c4",
        ),
        (
            "028_multi_target_transactions_and_story_assets",
            "57a0165d8f5e5f75db523325476a5187763c17ee7eb56c76c9faac767150d3e9",
        ),
    ];

    fn run_migrations_through(connection: &mut Connection, count: usize) -> Result<(), AppError> {
        for migration in migrations().into_iter().take(count) {
            let transaction = connection.transaction().map_err(AppError::database)?;
            create_ledger(&transaction)?;
            let expected_checksum = checksum(migration.definition);
            let existing_checksum = transaction
                .query_row(
                    "SELECT checksum FROM schema_migrations WHERE migration_id = ?1",
                    params![migration.id],
                    |row| row.get::<_, String>(0),
                )
                .optional()
                .map_err(AppError::database)?;
            if let Some(actual_checksum) = existing_checksum {
                if actual_checksum != expected_checksum {
                    return Err(AppError::new(
                        codes::DATABASE_TRANSACTION_FAILED,
                        "数据库迁移校验失败",
                        false,
                    ));
                }
            } else {
                (migration.apply)(&transaction)?;
                transaction
                    .execute(
                        "INSERT INTO schema_migrations
                            (migration_id, version, checksum, applied_at)
                         VALUES (?1, ?2, ?3, ?4)",
                        params![
                            migration.id,
                            "2.2.0",
                            expected_checksum,
                            Utc::now().to_rfc3339()
                        ],
                    )
                    .map_err(AppError::database)?;
            }
            transaction.commit().map_err(AppError::database)?;
        }
        Ok(())
    }

    fn legacy_schema(connection: &Connection) -> rusqlite::Result<()> {
        connection.execute_batch(
            "CREATE TABLE chapter_drafts (
                id TEXT PRIMARY KEY,
                novel_id TEXT NOT NULL,
                chapter_id TEXT NOT NULL,
                content TEXT NOT NULL,
                version_no INTEGER NOT NULL,
                large_text_ref_id TEXT
            );
            INSERT INTO chapter_drafts
                (id, novel_id, chapter_id, content, version_no, large_text_ref_id)
            VALUES ('legacy-draft', 'legacy-novel', 'legacy-chapter', 'legacy content', 1, NULL);",
        )
    }

    #[test]
    fn db01_initializes_ordered_migration_ledger() -> Result<(), Box<dyn std::error::Error>> {
        let mut connection = Connection::open_in_memory()?;
        legacy_schema(&connection)?;
        run_migrations(&mut connection)?;
        let migrations = list_applied(&connection)?;
        assert_eq!(migrations.len(), EXPECTED_MIGRATION_CHECKSUMS.len());
        for (applied, (expected_id, expected_checksum)) in
            migrations.iter().zip(EXPECTED_MIGRATION_CHECKSUMS)
        {
            assert_eq!(applied.migration_id, expected_id);
            assert_eq!(applied.checksum, expected_checksum);
        }
        Ok(())
    }

    #[test]
    fn db02_repeated_migration_is_idempotent() -> Result<(), Box<dyn std::error::Error>> {
        let mut connection = Connection::open_in_memory()?;
        legacy_schema(&connection)?;
        run_migrations(&mut connection)?;
        let first = list_applied(&connection)?;
        run_migrations(&mut connection)?;
        assert_eq!(list_applied(&connection)?, first);
        let content: String = connection.query_row(
            "SELECT content FROM chapter_drafts WHERE id = 'legacy-draft'",
            [],
            |row| row.get(0),
        )?;
        assert_eq!(content, "legacy content");
        Ok(())
    }

    #[test]
    fn db03_checksum_conflict_stops_migrations() -> Result<(), Box<dyn std::error::Error>> {
        let mut connection = Connection::open_in_memory()?;
        legacy_schema(&connection)?;
        run_migrations(&mut connection)?;
        connection.execute(
            "UPDATE schema_migrations SET checksum = 'tampered' WHERE migration_id = '002_workspace_recovery_snapshots'",
            [],
        )?;
        let error = run_migrations(&mut connection).expect_err("checksum mismatch must fail");
        assert_eq!(error.code, codes::DATABASE_TRANSACTION_FAILED);
        assert_eq!(
            error
                .details
                .as_ref()
                .and_then(|details| details["migrationId"].as_str()),
            Some("002_workspace_recovery_snapshots")
        );
        Ok(())
    }

    #[test]
    fn db15_upgrades_legacy_schema_and_preserves_draft() -> Result<(), Box<dyn std::error::Error>> {
        let mut connection = Connection::open_in_memory()?;
        legacy_schema(&connection)?;
        run_migrations(&mut connection)?;
        let content: String = connection.query_row(
            "SELECT content FROM chapter_drafts WHERE id = 'legacy-draft'",
            [],
            |row| row.get(0),
        )?;
        assert_eq!(content, "legacy content");
        assert!(table_has_column(
            &connection.unchecked_transaction()?,
            "chapter_drafts",
            "content_hash"
        )?);
        Ok(())
    }

    #[test]
    fn db17_m1_schema_has_all_tables_indexes_triggers_and_clean_foreign_keys(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let mut connection = Connection::open_in_memory()?;
        connection.execute_batch("PRAGMA foreign_keys=ON;")?;
        legacy_schema(&connection)?;
        run_migrations(&mut connection)?;
        for table in [
            "ai_tasks",
            "ai_task_attempts",
            "ai_input_snapshots",
            "ai_context_snapshots",
            "ai_constraint_snapshots",
            "result_artifacts",
            "artifact_validation_issues",
            "placement_proposals",
            "apply_plans",
            "artifact_target_links",
        ] {
            let exists: i64 = connection.query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?1",
                params![table],
                |row| row.get(0),
            )?;
            assert_eq!(exists, 1, "missing M1 table {table}");
        }
        for index in [
            "idx_ai_tasks_novel_status_created",
            "uq_ai_task_attempts_one_live",
            "idx_ai_input_snapshots_source",
            "idx_result_artifacts_task_created",
            "uq_result_artifacts_attempt_root",
            "idx_artifact_validation_artifact",
            "idx_placement_proposals_artifact",
            "idx_apply_plans_status",
            "idx_artifact_target_links_artifact",
        ] {
            let exists: i64 = connection.query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND name=?1",
                params![index],
                |row| row.get(0),
            )?;
            assert_eq!(exists, 1, "missing M1 index {index}");
        }
        for trigger in [
            "trg_ai_tasks_validate_target_insert",
            "trg_ai_task_attempts_status_edges",
            "trg_ai_input_snapshots_immutable_update",
            "trg_ai_context_snapshots_immutable_delete",
            "trg_ai_constraint_snapshots_validate_insert",
            "trg_result_artifacts_validate_insert",
            "trg_ai_large_text_chunks_immutable_update",
            "trg_artifact_validation_issues_append_only_delete",
            "trg_placement_proposals_immutable_update",
            "trg_apply_plans_status_edges",
            "trg_artifact_target_links_validate_insert",
        ] {
            let exists: i64 = connection.query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='trigger' AND name=?1",
                params![trigger],
                |row| row.get(0),
            )?;
            assert_eq!(exists, 1, "missing M1 trigger {trigger}");
        }
        let foreign_key_errors = connection
            .prepare("PRAGMA foreign_key_check")?
            .query_map([], |_| Ok(()))?
            .count();
        assert_eq!(foreign_key_errors, 0);
        let integrity: String =
            connection.query_row("PRAGMA integrity_check", [], |row| row.get(0))?;
        assert_eq!(integrity, "ok");
        Ok(())
    }

    #[test]
    fn db18_failed_current_migration_rolls_back_without_forging_ledger(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let mut connection = Connection::open_in_memory()?;
        legacy_schema(&connection)?;
        connection.execute_batch("CREATE TABLE ai_task_attempts (broken_column TEXT);")?;
        assert!(run_migrations(&mut connection).is_err());
        let applied = list_applied(&connection)?;
        assert_eq!(
            applied.last().map(|item| item.migration_id.as_str()),
            Some("005_ai_tasks")
        );
        assert!(applied
            .iter()
            .all(|item| item.migration_id != "006_ai_task_attempts"));
        let malformed_columns: i64 = connection.query_row(
            "SELECT COUNT(*) FROM pragma_table_info('ai_task_attempts')",
            [],
            |row| row.get(0),
        )?;
        assert_eq!(malformed_columns, 1);
        Ok(())
    }

    fn table_columns(connection: &Connection, table: &str) -> rusqlite::Result<Vec<String>> {
        let quoted = table.replace('"', "\"\"");
        let mut statement = connection.prepare(&format!("PRAGMA table_info(\"{quoted}\")"))?;
        let columns = statement
            .query_map([], |row| row.get(1))?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(columns)
    }

    #[test]
    fn db19_upgrade_preserves_legacy_rows_and_business_table_shapes(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let mut connection = Connection::open_in_memory()?;
        connection.execute_batch(
            "CREATE TABLE chapter_drafts (
                id TEXT PRIMARY KEY, novel_id TEXT NOT NULL, chapter_id TEXT NOT NULL,
                content TEXT NOT NULL, version_no INTEGER NOT NULL, is_adopted INTEGER NOT NULL,
                large_text_ref_id TEXT, content_hash TEXT
             );
             CREATE TABLE chapters (id TEXT PRIMARY KEY, adopted_draft_id TEXT);
             CREATE TABLE quality_check_reports (id TEXT PRIMARY KEY, report_json TEXT);
             CREATE TABLE ai_task_records (id TEXT PRIMARY KEY, status TEXT, result_text TEXT);
             CREATE TABLE generation_jobs (id TEXT PRIMARY KEY, status TEXT);
             INSERT INTO chapter_drafts VALUES
                ('draft-a','novel-a','chapter-a','legacy adopted body',3,1,NULL,'hash-a');
             INSERT INTO chapters VALUES ('chapter-a','draft-a');
             INSERT INTO quality_check_reports VALUES ('report-a','legacy report');
             INSERT INTO ai_task_records VALUES ('legacy-task','succeeded','legacy result');
             INSERT INTO generation_jobs VALUES ('legacy-job','completed');",
        )?;
        let draft_columns_before = table_columns(&connection, "chapter_drafts")?;
        let report_columns_before = table_columns(&connection, "quality_check_reports")?;
        run_migrations(&mut connection)?;
        assert_eq!(
            table_columns(&connection, "chapter_drafts")?,
            draft_columns_before
        );
        assert_eq!(
            table_columns(&connection, "quality_check_reports")?,
            report_columns_before
        );
        let adopted: String = connection.query_row(
            "SELECT adopted_draft_id FROM chapters WHERE id='chapter-a'",
            [],
            |row| row.get(0),
        )?;
        let legacy_result: String = connection.query_row(
            "SELECT result_text FROM ai_task_records WHERE id='legacy-task'",
            [],
            |row| row.get(0),
        )?;
        let legacy_job: String = connection.query_row(
            "SELECT status FROM generation_jobs WHERE id='legacy-job'",
            [],
            |row| row.get(0),
        )?;
        assert_eq!(adopted, "draft-a");
        assert_eq!(legacy_result, "legacy result");
        assert_eq!(legacy_job, "completed");
        Ok(())
    }

    #[test]
    fn db20_new_migration_checksum_conflict_fails_closed() -> Result<(), Box<dyn std::error::Error>>
    {
        let mut connection = Connection::open_in_memory()?;
        legacy_schema(&connection)?;
        run_migrations(&mut connection)?;
        connection.execute(
            "UPDATE schema_migrations SET checksum='tampered' WHERE migration_id='010_result_artifacts'",
            [],
        )?;
        let error = run_migrations(&mut connection).expect_err("new checksum mismatch must fail");
        assert_eq!(error.code, codes::DATABASE_TRANSACTION_FAILED);
        assert_eq!(
            error
                .details
                .as_ref()
                .and_then(|value| value["migrationId"].as_str()),
            Some("010_result_artifacts")
        );
        Ok(())
    }

    #[test]
    fn db21_full_empty_database_initializes_and_restarts_idempotently(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let mut connection = Connection::open_in_memory()?;
        connection.execute_batch("PRAGMA foreign_keys=ON;")?;
        crate::db::create_tables(&mut connection)?;
        let first = list_applied(&connection)?;
        crate::db::create_tables(&mut connection)?;
        assert_eq!(list_applied(&connection)?, first);
        assert_eq!(first.len(), migrations().len());
        Ok(())
    }

    #[test]
    fn db22_m1_sql_schema_fingerprint_is_frozen() -> Result<(), Box<dyn std::error::Error>> {
        let mut connection = Connection::open_in_memory()?;
        legacy_schema(&connection)?;
        run_migrations(&mut connection)?;
        let mut statement = connection.prepare(
            "SELECT type, name, sql FROM sqlite_master
             WHERE sql IS NOT NULL AND (
                name IN ('ai_tasks','ai_task_attempts','ai_input_snapshots',
                         'ai_context_snapshots','ai_constraint_snapshots',
                         'result_artifacts','artifact_validation_issues')
                OR name GLOB 'idx_ai_*'
                OR name GLOB 'uq_ai_*'
                OR name GLOB 'idx_result_artifacts_*'
                OR name GLOB 'uq_result_artifacts_*'
                OR name GLOB 'idx_artifact_validation_*'
                OR name GLOB 'trg_ai_*'
                OR name GLOB 'trg_result_artifacts_*'
                OR name GLOB 'trg_artifact_validation_*'
             )
             ORDER BY type ASC, name ASC",
        )?;
        let rows = statement
            .query_map([], |row| {
                Ok(format!(
                    "{}\n{}\n{}\n",
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                ))
            })?
            .collect::<Result<Vec<_>, _>>()?;
        let fingerprint = checksum(&rows.concat());
        assert_eq!(
            fingerprint,
            "8e34fe774ff2490325eab1654e5118230e77279e58beed325a5e09c4f320835e"
        );
        Ok(())
    }

    #[test]
    #[ignore = "requires AI_NOVEL_STUDIO_MIGRATION_DB to point at an isolated database copy"]
    fn db23_external_v221_copy_upgrades_without_business_row_or_shape_changes(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let path = std::env::var("AI_NOVEL_STUDIO_MIGRATION_DB")?;
        let mut connection = Connection::open(path)?;
        connection.execute_batch("PRAGMA foreign_keys=ON;")?;
        run_migrations_through(&mut connection, 4)?;
        let business_tables = [
            "novels",
            "chapters",
            "chapter_drafts",
            "quality_check_reports",
            "ai_task_records",
            "generation_jobs",
        ];
        let before = business_tables
            .iter()
            .map(|table| {
                let quoted = table.replace('"', "\"\"");
                let count = connection.query_row(
                    &format!("SELECT COUNT(*) FROM \"{quoted}\""),
                    [],
                    |row| row.get::<_, i64>(0),
                )?;
                Ok::<_, rusqlite::Error>((*table, count, table_columns(&connection, table)?))
            })
            .collect::<Result<Vec<_>, _>>()?;
        let fk_before = connection
            .prepare("PRAGMA foreign_key_check")?
            .query_map([], |_| Ok(()))?
            .count();
        run_migrations(&mut connection)?;
        let once = list_applied(&connection)?;
        run_migrations(&mut connection)?;
        assert_eq!(list_applied(&connection)?, once);
        assert_eq!(once.len(), migrations().len());
        for (table, expected_count, expected_columns) in before {
            let quoted = table.replace('"', "\"\"");
            let actual_count =
                connection.query_row(&format!("SELECT COUNT(*) FROM \"{quoted}\""), [], |row| {
                    row.get::<_, i64>(0)
                })?;
            assert_eq!(
                actual_count, expected_count,
                "row count changed for {table}"
            );
            assert_eq!(table_columns(&connection, table)?, expected_columns);
        }
        let fk_after = connection
            .prepare("PRAGMA foreign_key_check")?
            .query_map([], |_| Ok(()))?
            .count();
        assert_eq!(fk_after, fk_before);
        let integrity: String =
            connection.query_row("PRAGMA integrity_check", [], |row| row.get(0))?;
        assert_eq!(integrity, "ok");
        Ok(())
    }

    #[test]
    fn db24_planner_schema_has_durable_facts_and_no_plaintext_lease_token(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let mut connection = Connection::open_in_memory()?;
        connection.execute_batch("PRAGMA foreign_keys=ON;")?;
        crate::db::create_tables(&mut connection)?;
        for table in [
            "agent_plans",
            "agent_plan_steps",
            "agent_plan_step_dependencies",
            "agent_plan_step_attempts",
            "agent_execution_leases",
            "agent_plan_checkpoints",
        ] {
            let exists: i64 = connection.query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?1",
                params![table],
                |row| row.get(0),
            )?;
            assert_eq!(exists, 1, "missing planner table {table}");
        }
        for index in [
            "idx_agent_plans_chapter_created",
            "idx_agent_plan_steps_plan_status",
            "uq_agent_plan_attempts_one_running",
            "uq_agent_execution_leases_one_active",
            "idx_agent_plan_checkpoints_plan_sequence",
        ] {
            let exists: i64 = connection.query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND name=?1",
                params![index],
                |row| row.get(0),
            )?;
            assert_eq!(exists, 1, "missing planner index {index}");
        }
        for trigger in [
            "trg_agent_plans_status_edges",
            "trg_agent_plan_steps_immutable_identity",
            "trg_agent_plan_dependencies_append_only_delete",
            "trg_agent_plan_attempts_status_edges",
            "trg_agent_execution_leases_monotonic_epoch",
            "trg_agent_plan_checkpoints_append_only_update",
        ] {
            let exists: i64 = connection.query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='trigger' AND name=?1",
                params![trigger],
                |row| row.get(0),
            )?;
            assert_eq!(exists, 1, "missing planner trigger {trigger}");
        }
        let columns = table_columns(&connection, "agent_execution_leases")?;
        assert!(columns.iter().any(|column| column == "token_hash"));
        assert!(!columns.iter().any(|column| column == "token"));
        assert_eq!(
            connection
                .prepare("PRAGMA foreign_key_check")?
                .query_map([], |_| Ok(()))?
                .count(),
            0
        );
        Ok(())
    }
}

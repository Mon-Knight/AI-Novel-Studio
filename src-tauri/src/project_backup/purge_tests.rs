use super::super::purge_project_in_tx;
use crate::services::project_service::delete_novel_cascade;
use rusqlite::{params, Connection};
use sha2::{Digest, Sha256};

const TS: &str = "2026-08-21T00:00:00Z";
const NOVEL_A: &str = "purge-a";
const NOVEL_B: &str = "purge-b";

fn digest(value: &str) -> String {
    format!("{:x}", Sha256::digest(value.as_bytes()))
}

fn open_db() -> Connection {
    let mut conn = Connection::open_in_memory().expect("open memory database");
    conn.execute_batch("PRAGMA foreign_keys = ON;")
        .expect("enable foreign keys");
    crate::db::create_tables(&mut conn).expect("create schema");
    conn
}

fn execute(conn: &Connection, sql: &str, values: impl rusqlite::Params) {
    conn.execute(sql, values)
        .unwrap_or_else(|error| panic!("{sql}\n{error}"));
}

fn insert_document(
    conn: &Connection,
    id: &str,
    target_type: &str,
    target_id: &str,
    field: &str,
    content: &str,
) -> (String, i64) {
    let hash = digest(content);
    let chars = content.chars().count() as i64;
    let bytes = content.len() as i64;
    execute(
        conn,
        "INSERT INTO large_text_documents
            (id,target_type,target_id,field_name,total_chars,total_bytes,chunk_count,
             content_sha256,status,created_at,updated_at)
         VALUES (?1,?2,?3,?4,?5,?6,1,?7,'ready',?8,?8)",
        params![
            &id,
            &target_type,
            &target_id,
            &field,
            &chars,
            &bytes,
            &hash,
            &TS
        ],
    );
    execute(
        conn,
        "INSERT INTO large_text_chunks
            (document_id,chunk_index,content,char_count,byte_count,chunk_sha256,created_at)
         VALUES (?1,0,?2,?3,?4,?5,?6)",
        params![&id, &content, &chars, &bytes, &hash, &TS],
    );
    (hash, chars)
}

fn seed_novel(conn: &Connection, novel_id: &str) {
    let volume = format!("{novel_id}-volume");
    let chapter = format!("{novel_id}-chapter");
    let task = format!("{novel_id}-task");
    let attempt = format!("{novel_id}-attempt");
    let input = format!("{novel_id}-input");
    let context = format!("{novel_id}-context");
    let constraint = format!("{novel_id}-constraint");
    let artifact = format!("{novel_id}-artifact");
    let setting = format!("{novel_id}-setting");
    let proposal = format!("{novel_id}-proposal");
    let apply_plan = format!("{novel_id}-apply");
    let link = format!("{novel_id}-link");
    let plan = format!("{novel_id}-plan");
    let step_a = format!("{novel_id}-step-a");
    let step_b = format!("{novel_id}-step-b");
    let lease = format!("{novel_id}-lease");
    let agent_attempt = format!("{novel_id}-agent-attempt");
    let checkpoint_a = format!("{novel_id}-checkpoint-a");
    let checkpoint_b = format!("{novel_id}-checkpoint-b");
    let transaction_id = format!("{novel_id}-tx");
    let registry = digest("registry");
    let arguments = format!(r#"{{"novelId":"{novel_id}","chapterId":"{chapter}"}}"#);
    execute(
        conn,
        "INSERT INTO novels (id,title,created_at,updated_at) VALUES (?1,?1,?2,?2)",
        params![&novel_id, &TS],
    );
    execute(
        conn,
        "INSERT INTO volumes (id,novel_id,title,created_at,updated_at) VALUES (?1,?2,'卷一',?3,?3)",
        params![&volume, &novel_id, &TS],
    );
    execute(
        conn,
        "INSERT INTO chapters (id,novel_id,volume_id,title,created_at,updated_at) VALUES (?1,?2,?3,'第一章',?4,?4)",
        params![&chapter, &novel_id, &volume, &TS],
    );
    execute(
        conn,
        "INSERT INTO world_settings (id,novel_id,title,content,created_at,updated_at) VALUES (?1,?2,'设定','',?3,?3)",
        params![&setting, &novel_id, &TS],
    );
    let input_body = format!("input-{novel_id}");
    let compiled = format!("compiled-{novel_id}");
    let template = format!("template-{novel_id}");
    let body = format!("候选-{novel_id}");
    insert_document(
        conn,
        &format!("{novel_id}-doc-input"),
        "ai_snapshot",
        &input,
        "input_body",
        &input_body,
    );
    insert_document(
        conn,
        &format!("{novel_id}-doc-context"),
        "ai_snapshot",
        &context,
        "compiled_context",
        &compiled,
    );
    let template_hash = digest(&template);
    insert_document(
        conn,
        &format!("{novel_id}-doc-constraint"),
        "ai_snapshot",
        &constraint,
        "prompt_template",
        &template,
    );
    let (content_hash, content_length) = insert_document(
        conn,
        &format!("{novel_id}-doc-raw"),
        "result_artifact",
        &artifact,
        "raw_content",
        &body,
    );
    execute(
        conn,
        "INSERT INTO ai_tasks
            (task_id,task_type,novel_id,scope_type,status,input_snapshot_id,context_snapshot_id,
             constraint_snapshot_id,current_attempt_id,trace_id,operation_id,request_hash_version,
             request_hash,expected_artifact_type,expected_artifact_schema_version,created_at,updated_at)
         VALUES (?1,'setting_expand',?2,'novel','validating',?3,?4,?5,?6,?1,?7,1,?8,'setting_candidates',1,?9,?9)",
        params![
            &task,
            &novel_id,
            &input,
            &context,
            &constraint,
            &attempt,
            &format!("{novel_id}-operation"),
            &digest(&format!("request-{novel_id}")),
            &TS,
        ],
    );
    execute(
        conn,
        "INSERT INTO ai_input_snapshots
            (snapshot_id,task_id,schema_version,input_type,payload_json,body_ref_id,content_hash,created_at)
         VALUES (?1,?2,1,'compiled_provider_messages_v1','{}',?3,?4,?5)",
        params![&input, &task, &format!("{novel_id}-doc-input"), &digest(&input_body), &TS],
    );
    execute(
        conn,
        "INSERT INTO ai_context_snapshots
            (snapshot_id,task_id,schema_version,source_manifest_json,compiled_context_ref_id,budget_json,
             compiler_version,content_hash,created_at)
         VALUES (?1,?2,1,'[]',?3,'{}','context_compiler_v1',?4,?5)",
        params![&context, &task, &format!("{novel_id}-doc-context"), &digest(&compiled), &TS],
    );
    execute(
        conn,
        "INSERT INTO ai_constraint_snapshots
            (snapshot_id,task_id,schema_version,payload_json,prompt_template_id,prompt_template_version,
             prompt_template_hash,prompt_template_ref_id,provider_options_json,content_hash,created_at)
         VALUES (?1,?2,1,'{}','purge/prompt','1',?3,?4,'{}',?5,?6)",
        params![
            &constraint,
            &task,
            &template_hash,
            &format!("{novel_id}-doc-constraint"),
            &digest(&format!("constraint-{novel_id}")),
            &TS,
        ],
    );
    execute(
        conn,
        "INSERT INTO ai_task_attempts (attempt_id,task_id,attempt_number,status,created_at,updated_at)
         VALUES (?1,?2,1,'running',?3,?3)",
        params![&attempt, &task, &TS],
    );
    execute(
        conn,
        "INSERT INTO result_artifacts
            (artifact_id,task_id,attempt_id,source_input_snapshot_id,artifact_type,schema_version,
             raw_content_ref_id,source_novel_id,content_hash,content_length,processing_status,created_at)
         VALUES (?1,?2,?3,?4,'setting_candidates',1,?5,?6,?7,?8,'valid',?9)",
        params![
            &artifact,
            &task,
            &attempt,
            &input,
            &format!("{novel_id}-doc-raw"),
            &novel_id,
            &content_hash,
            &content_length,
            &TS,
        ],
    );
    let proposal_hash = digest(&format!("proposal-{novel_id}"));
    execute(
        conn,
        "INSERT INTO placement_proposals
            (proposal_id,artifact_id,candidate_index,candidate_hash,proposal_type,target_type,target_novel_id,
             target_id,expected_target_version,expected_target_hash,effect_payload_json,proposal_hash,created_at)
         VALUES (?1,?2,0,?3,'create_world_setting','world_setting',?4,?5,0,?3,'{}',?3,?6)",
        params![&proposal, &artifact, &proposal_hash, &novel_id, &setting, &TS],
    );
    execute(
        conn,
        "INSERT INTO apply_plans
            (plan_id,proposal_id,operation_id,plan_hash,target_type,target_id,expected_target_version,
             expected_target_hash,effect_payload_json,status,created_at,updated_at)
         VALUES (?1,?2,?3,?4,'world_setting',?5,0,?4,'{}','awaiting_confirmation',?6,?6)",
        params![&apply_plan, &proposal, &format!("{novel_id}-apply-op"), &proposal_hash, &setting, &TS],
    );
    execute(
        conn,
        "UPDATE apply_plans SET status='applying', confirmed_by='user', user_confirmed_at=?2, updated_at=?2 WHERE plan_id=?1",
        params![&apply_plan, &TS],
    );
    execute(
        conn,
        "INSERT INTO artifact_target_links
            (link_id,artifact_id,proposal_id,apply_plan_id,target_type,target_id,relationship,target_version,
             target_hash,created_at)
         VALUES (?1,?2,?3,?4,'world_setting',?5,'created_from',1,?6,?7)",
        params![&link, &artifact, &proposal, &apply_plan, &setting, &proposal_hash, &TS],
    );
    execute(
        conn,
        "INSERT INTO agent_plans
            (plan_id,operation_id,request_hash,contract_version,planner_id,planner_version,registry_hash,
             novel_id,chapter_id,status,created_at,updated_at)
         VALUES (?1,?2,?3,'agent_plan_v1','chapter_readiness_plan_v1',1,?4,?5,?6,'ready',?7,?7)",
        params![&plan, &format!("{novel_id}-agent-op"), &digest(&format!("agent-{novel_id}")), &registry, &novel_id, &chapter, &TS],
    );
    execute(
        conn,
        "INSERT INTO agent_plan_checkpoints
            (checkpoint_id,plan_id,sequence,event_type,plan_status,payload_json,payload_hash,created_at)
         VALUES (?1,?2,1,'plan_created','ready','{}',?3,?4)",
        params![&checkpoint_a, &plan, &digest("{}"), &TS],
    );
    for (step_id, key, ordinal) in [(&step_a, "first", 1_i64), (&step_b, "second", 2)] {
        execute(
            conn,
            "INSERT INTO agent_plan_steps
                (step_id,plan_id,step_key,ordinal,title,tool_name,tool_version,tool_identity,registry_hash,
                 input_schema_hash,output_schema_hash,permissions_json,scope,arguments_json,arguments_hash,
                 status,created_at,updated_at)
             VALUES (?1,?2,?3,?4,'检查','inspect','1','inspect@1',?5,?6,?7,'[]','chapter',?8,?9,'pending',?10,?10)",
            params![
                step_id,
                &plan,
                &key,
                &ordinal,
                &registry,
                &digest("input-schema"),
                &digest("output-schema"),
                &arguments,
                &digest(&arguments),
                &TS,
            ],
        );
    }
    execute(
        conn,
        "INSERT INTO agent_plan_step_dependencies
            (plan_id,step_id,depends_on_step_id,dependency_ordinal,created_at)
         VALUES (?1,?2,?3,1,?4)",
        params![&plan, &step_b, &step_a, &TS],
    );
    execute(
        conn,
        "INSERT INTO agent_execution_leases
            (lease_id,plan_id,epoch,owner_id,token_hash,expires_at,status,acquired_at)
         VALUES (?1,?2,1,'owner',?3,?4,'active',?4)",
        params![&lease, &plan, &digest("token"), &TS],
    );
    execute(
        conn,
        "UPDATE agent_plans SET status='running', updated_at=?2 WHERE plan_id=?1",
        params![&plan, &TS],
    );
    execute(
        conn,
        "UPDATE agent_plan_steps SET status='running', updated_at=?2 WHERE step_id=?1",
        params![&step_b, &TS],
    );
    execute(
        conn,
        "INSERT INTO agent_plan_step_attempts
            (attempt_id,plan_id,step_id,attempt_number,lease_id,lease_epoch,status,started_at)
         VALUES (?1,?2,?3,1,?4,1,'running',?5)",
        params![&agent_attempt, &plan, &step_b, &lease, &TS],
    );
    execute(
        conn,
        "INSERT INTO agent_plan_checkpoints
            (checkpoint_id,plan_id,sequence,event_type,step_id,attempt_id,plan_status,step_status,
             payload_json,payload_hash,created_at)
         VALUES (?1,?2,2,'step_claimed',?3,?4,'running','running','{}',?5,?6)",
        params![
            &checkpoint_b,
            &plan,
            &step_b,
            &agent_attempt,
            &digest("{}"),
            &TS
        ],
    );
    let tx_hash = digest(&format!("tx-{novel_id}"));
    execute(
        conn,
        "INSERT INTO content_transactions
            (transaction_id,operation_id,request_hash,novel_id,strategy,target_set_json,target_set_hash,
             transaction_hash,status,created_at)
         VALUES (?1,?2,?3,?4,'all_or_nothing','[]',?3,?3,'prepared',?5)",
        params![&transaction_id, &format!("{novel_id}-tx-op"), &tx_hash, &novel_id, &TS],
    );
    execute(
        conn,
        "INSERT INTO content_transaction_targets
            (transaction_id,novel_id,ordinal,target_type,target_id,effect_type,base_revision,base_hash,
             candidate_payload_json,candidate_hash)
         VALUES (?1,?2,0,'location',?3,'create',0,?4,'{}',?4)",
        params![&transaction_id, &novel_id, &format!("{novel_id}-location"), &tx_hash],
    );
    execute(
        conn,
        "INSERT INTO setting_suggestions (id,novel_id,suggestion_type,item_json,status,created_at,updated_at)
         VALUES (?1,?2,'location','{}','pending',?3,?3)",
        params![&format!("{novel_id}-suggestion"), &novel_id, &TS],
    );
    execute(
        conn,
        "INSERT INTO dsh_preparation_runs (id,novel_id,chapter_id,planner,status,created_at)
         VALUES (?1,?2,?3,'chapter_readiness_plan_v1','ready',?4)",
        params![&format!("{novel_id}-prep"), &novel_id, &chapter, &TS],
    );
}

fn seeded() -> Connection {
    let mut conn = open_db();
    let tx = conn.transaction().expect("seed transaction");
    seed_novel(&tx, NOVEL_A);
    seed_novel(&tx, NOVEL_B);
    tx.commit().expect("seed commit");
    conn
}

fn count(conn: &Connection, sql: &str, novel_id: &str) -> i64 {
    conn.query_row(sql, params![novel_id], |row| row.get(0))
        .unwrap_or_else(|error| panic!("{sql}\n{error}"))
}

fn owned_counts(conn: &Connection, novel_id: &str) -> Vec<(&'static str, i64)> {
    [
        ("novels", "SELECT COUNT(*) FROM novels WHERE id=?1"),
        ("suggestions", "SELECT COUNT(*) FROM setting_suggestions WHERE novel_id=?1"),
        ("preparations", "SELECT COUNT(*) FROM dsh_preparation_runs WHERE novel_id=?1"),
        ("proposals", "SELECT COUNT(*) FROM placement_proposals WHERE target_novel_id=?1"),
        ("apply_plans", "SELECT COUNT(*) FROM apply_plans WHERE proposal_id IN (SELECT proposal_id FROM placement_proposals WHERE target_novel_id=?1)"),
        ("links", "SELECT COUNT(*) FROM artifact_target_links WHERE proposal_id IN (SELECT proposal_id FROM placement_proposals WHERE target_novel_id=?1)"),
        ("agent_plans", "SELECT COUNT(*) FROM agent_plans WHERE novel_id=?1"),
        ("agent_steps", "SELECT COUNT(*) FROM agent_plan_steps WHERE plan_id IN (SELECT plan_id FROM agent_plans WHERE novel_id=?1)"),
        ("agent_dependencies", "SELECT COUNT(*) FROM agent_plan_step_dependencies WHERE plan_id IN (SELECT plan_id FROM agent_plans WHERE novel_id=?1)"),
        ("agent_attempts", "SELECT COUNT(*) FROM agent_plan_step_attempts WHERE plan_id IN (SELECT plan_id FROM agent_plans WHERE novel_id=?1)"),
        ("agent_leases", "SELECT COUNT(*) FROM agent_execution_leases WHERE plan_id IN (SELECT plan_id FROM agent_plans WHERE novel_id=?1)"),
        ("agent_checkpoints", "SELECT COUNT(*) FROM agent_plan_checkpoints WHERE plan_id IN (SELECT plan_id FROM agent_plans WHERE novel_id=?1)"),
        ("content_transactions", "SELECT COUNT(*) FROM content_transactions WHERE novel_id=?1"),
        ("content_targets", "SELECT COUNT(*) FROM content_transaction_targets WHERE novel_id=?1"),
        ("artifacts", "SELECT COUNT(*) FROM result_artifacts WHERE source_novel_id=?1"),
        ("tasks", "SELECT COUNT(*) FROM ai_tasks WHERE novel_id=?1"),
    ]
    .into_iter()
    .map(|(label, sql)| (label, count(conn, sql, novel_id)))
    .collect()
}

fn assert_guard_rejects(conn: &Connection, sql: &str, marker: &str) {
    let error = conn.execute(sql, []).expect_err(marker);
    assert!(error.to_string().contains(marker), "{error}");
}

#[test]
fn failed_purge_rolls_back_rows_and_delete_guards() {
    let mut conn = seeded();
    let before_a = owned_counts(&conn, NOVEL_A);
    let before_b = owned_counts(&conn, NOVEL_B);
    assert!(before_a.iter().all(|(_, count)| *count > 0));
    let tx = conn.transaction().expect("purge transaction");
    purge_project_in_tx(&tx, NOVEL_A).expect("purge inside transaction");
    tx.rollback().expect("rollback purge");
    assert_eq!(owned_counts(&conn, NOVEL_A), before_a);
    assert_eq!(owned_counts(&conn, NOVEL_B), before_b);
    assert_guard_rejects(
        &conn,
        "DELETE FROM placement_proposals WHERE proposal_id='purge-a-proposal'",
        "durable placement proposal",
    );
    assert_guard_rejects(
        &conn,
        "DELETE FROM agent_plans WHERE plan_id='purge-b-plan'",
        "durable agent plan",
    );
    assert_guard_rejects(
        &conn,
        "DELETE FROM content_transaction_targets WHERE transaction_id='purge-b-tx'",
        "content transaction target cannot be deleted",
    );
}

#[test]
fn cascade_delete_removes_one_projects_guarded_facts_and_is_idempotent() {
    let mut conn = seeded();
    execute(
        &conn,
        "UPDATE setting_suggestions SET status='adopted', updated_at=?2 WHERE id=?1",
        params![&format!("{NOVEL_B}-suggestion"), &TS],
    );
    let before_b = owned_counts(&conn, NOVEL_B);
    delete_novel_cascade(&mut conn, NOVEL_A).expect("delete novel A");
    for (label, count) in owned_counts(&conn, NOVEL_A) {
        assert_eq!(count, 0, "{label} of {NOVEL_A} survived cascade delete");
    }
    assert_eq!(owned_counts(&conn, NOVEL_B), before_b);
    let second = delete_novel_cascade(&mut conn, NOVEL_A).expect_err("second delete");
    assert!(second.contains("未找到"), "{second}");
    assert_eq!(owned_counts(&conn, NOVEL_B), before_b);
    assert_guard_rejects(
        &conn,
        "DELETE FROM placement_proposals WHERE proposal_id='purge-b-proposal'",
        "durable placement proposal",
    );
    assert_guard_rejects(
        &conn,
        "DELETE FROM apply_plans WHERE plan_id='purge-b-apply'",
        "durable apply plan",
    );
    assert_guard_rejects(
        &conn,
        "DELETE FROM artifact_target_links WHERE link_id='purge-b-link'",
        "durable artifact target link",
    );
    assert_guard_rejects(
        &conn,
        "DELETE FROM agent_plan_steps WHERE step_id='purge-b-step-a'",
        "durable agent plan step",
    );
    assert_guard_rejects(
        &conn,
        "DELETE FROM agent_plan_checkpoints WHERE checkpoint_id='purge-b-checkpoint-a'",
        "durable agent checkpoint",
    );
    let suggestion_error = conn
        .execute(
            "UPDATE setting_suggestions SET status='discarded', updated_at=?2 WHERE id=?1",
            params![format!("{NOVEL_B}-suggestion"), TS],
        )
        .expect_err("final suggestion status");
    assert!(
        suggestion_error
            .to_string()
            .contains("setting suggestion status is final"),
        "{suggestion_error}"
    );
    assert_eq!(
        count(
            &conn,
            "SELECT COUNT(*) FROM setting_suggestions WHERE id=?1 AND status='adopted'",
            &format!("{NOVEL_B}-suggestion")
        ),
        1
    );
}

#[test]
fn corrupt_cross_work_link_stops_purge_without_deleting_either_work() {
    let mut conn = seeded();
    conn.execute_batch(
        "DROP TRIGGER IF EXISTS trg_placement_proposals_validate_artifact;
         DROP TRIGGER IF EXISTS trg_artifact_target_links_validate_insert;",
    )
    .expect("suspend link gates for the injected row");
    let hash = digest("cross-work");
    execute(
        &conn,
        "INSERT INTO world_settings (id,novel_id,title,content,created_at,updated_at)
         VALUES ('purge-b-foreign-setting',?1,'跨书设定','',?2,?2)",
        params![&NOVEL_B, &TS],
    );
    execute(
        &conn,
        "INSERT INTO placement_proposals
            (proposal_id,artifact_id,candidate_index,candidate_hash,proposal_type,target_type,target_novel_id,
             target_id,expected_target_version,expected_target_hash,effect_payload_json,proposal_hash,created_at)
         VALUES ('purge-cross-proposal','purge-a-artifact',1,?1,'create_world_setting','world_setting',?2,
                 'purge-b-foreign-setting',0,?1,'{}',?1,?3)",
        params![&hash, &NOVEL_B, &TS],
    );
    execute(
        &conn,
        "INSERT INTO apply_plans
            (plan_id,proposal_id,operation_id,plan_hash,target_type,target_id,expected_target_version,
             expected_target_hash,effect_payload_json,status,confirmed_by,user_confirmed_at,created_at,updated_at)
         VALUES ('purge-cross-plan','purge-cross-proposal','purge-cross-op',?1,'world_setting',
                 'purge-b-foreign-setting',0,?1,'{}','applying','user',?2,?2,?2)",
        params![&hash, &TS],
    );
    execute(
        &conn,
        "INSERT INTO artifact_target_links
            (link_id,artifact_id,proposal_id,apply_plan_id,target_type,target_id,relationship,target_version,
             target_hash,created_at)
         VALUES ('purge-cross-link','purge-a-artifact','purge-cross-proposal','purge-cross-plan','world_setting',
                 'purge-b-foreign-setting','created_from',1,?1,?2)",
        params![&hash, &TS],
    );
    conn.execute_batch(
        "CREATE TRIGGER IF NOT EXISTS trg_placement_proposals_validate_artifact
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
         BEGIN SELECT RAISE(ABORT, 'invalid artifact target link'); END;",
    )
    .expect("restore link gates");
    let before_a = owned_counts(&conn, NOVEL_A);
    let before_b = owned_counts(&conn, NOVEL_B);
    let error = delete_novel_cascade(&mut conn, NOVEL_A).expect_err("cross-work link");
    assert!(error.contains("其他作品"), "{error}");
    assert_eq!(owned_counts(&conn, NOVEL_A), before_a);
    assert_eq!(owned_counts(&conn, NOVEL_B), before_b);
    assert_eq!(
        count(
            &conn,
            "SELECT COUNT(*) FROM artifact_target_links WHERE link_id=?1",
            "purge-cross-link"
        ),
        1
    );
    assert_eq!(
        count(
            &conn,
            "SELECT COUNT(*) FROM artifact_target_links WHERE link_id=?1",
            "purge-b-link"
        ),
        1
    );
}

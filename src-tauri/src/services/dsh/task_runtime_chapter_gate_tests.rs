use super::*;
use crate::repositories::large_text_repository;

fn gate_input() -> StartTaskTurnInput {
    let mut input = chapter_write_input();
    input.chapter_word_range = Some(ChapterWordRangeInput {
        target: 10,
        minimum: 1,
        maximum: 20,
    });
    input
}

fn seed_story(connection: &rusqlite::Connection, novel: &str) {
    let stamp = "2026-09-10T00:00:00+00:00";
    connection
        .execute(
            "INSERT INTO novels (id,title,created_at,updated_at) VALUES (?1,'门禁',?2,?2)",
            rusqlite::params![novel, stamp],
        )
        .expect("novel");
    for (id, order_index) in [("vol-b", 2), ("vol-a", 1)] {
        connection
            .execute(
                "INSERT INTO volumes (id,novel_id,title,order_index,status,created_at,updated_at)
                 VALUES (?1,?2,'卷',?3,'planned',?4,?4)",
                rusqlite::params![id, novel, order_index, stamp],
            )
            .expect("volume");
    }
    for (id, volume, order_index, created) in [
        ("ch-a2", "vol-a", 2, "2026-09-10T00:00:02+00:00"),
        ("ch-a1", "vol-a", 1, "2026-09-10T00:00:03+00:00"),
        ("ch-b1", "vol-b", 1, "2026-09-10T00:00:04+00:00"),
    ] {
        connection
            .execute(
                "INSERT INTO chapters (id,novel_id,volume_id,title,order_index,status,word_count,created_at,updated_at)
                 VALUES (?1,?2,?3,'章',?4,'drafted',0,?5,?5)",
                rusqlite::params![id, novel, volume, order_index, created],
            )
            .expect("chapter");
    }
}

fn adopt(connection: &rusqlite::Connection, novel: &str, chapter: &str, body: &str, hash: Option<&str>) {
    let draft = format!("draft-{chapter}");
    let stamp = "2026-09-10T00:00:05+00:00";
    connection
        .execute(
            "INSERT INTO chapter_drafts (id,novel_id,chapter_id,title,content,source,version_no,word_count,is_adopted,created_at,updated_at,content_hash)
             VALUES (?1,?2,?3,'采用',?4,'user',1,1,1,?5,?5,?6)",
            rusqlite::params![draft, novel, chapter, body, stamp, hash],
        )
        .expect("draft");
    connection
        .execute(
            "UPDATE chapters SET adopted_draft_id=?1 WHERE id=?2",
            rusqlite::params![draft, chapter],
        )
        .expect("adopt");
}

#[test]
fn previous_chapter_order_uses_volume_then_full_hash_and_ignores_unadopted_text() {
    let connection = ai_task_service::tests::connection().expect("database");
    seed_story(&connection, "novel-order");
    connection
        .execute(
            "INSERT INTO chapter_drafts (id,novel_id,chapter_id,title,content,source,version_no,word_count,is_adopted,created_at,updated_at)
             VALUES ('loose','novel-order','ch-a1','未采用','不要读到我','ai',1,1,0,'2026-09-10T00:00:06+00:00','2026-09-10T00:00:06+00:00')",
            [],
        )
        .expect("unadopted");
    let body = "上一章真正采用的全文。";
    adopt(&connection, "novel-order", "ch-a1", body, None);
    let mut input = gate_input();
    input.novel_id = "novel-order".to_string();
    input.chapter_id = Some("ch-a2".to_string());
    chapter_continuity::freeze_continuity(&connection, &mut input).expect("sibling");
    let verified = input.verified_continuity.clone().expect("adopted sibling");
    assert_eq!(verified.chapter_id, "ch-a1");
    assert_eq!(verified.content, body);
    assert_eq!(verified.source_hash, large_text_repository::sha256(body));
    assert!(chapter_continuity::material_prompt(&input).contains(&verified.source_hash));
    adopt(&connection, "novel-order", "ch-a2", "卷末采用稿", None);
    input.chapter_id = Some("ch-b1".to_string());
    input.verified_continuity = None;
    input.continuity_checked = false;
    chapter_continuity::freeze_continuity(&connection, &mut input).expect("cross volume");
    assert_eq!(
        input.verified_continuity.expect("last of previous volume").chapter_id,
        "ch-a2"
    );
}

#[test]
fn previous_chapter_rejects_unadopted_empty_stale_hash_and_cross_scope_claims() {
    let connection = ai_task_service::tests::connection().expect("database");
    seed_story(&connection, "novel-reject");
    let mut input = gate_input();
    input.novel_id = "novel-reject".to_string();
    input.chapter_id = Some("ch-a2".to_string());
    let missing = chapter_continuity::freeze_continuity(&connection, &mut input).expect_err("unadopted");
    assert!(missing.contains("DSH_PREVIOUS_CHAPTER_NOT_ADOPTED"));
    adopt(&connection, "novel-reject", "ch-a1", "   ", None);
    let empty = chapter_continuity::freeze_continuity(&connection, &mut input).expect_err("empty");
    assert!(empty.contains("DSH_PREVIOUS_CHAPTER_CONTENT_UNAVAILABLE"));
    connection
        .execute("UPDATE chapter_drafts SET content='有正文', content_hash=?1", rusqlite::params!["ab".repeat(32)])
        .expect("stale hash");
    let stale = chapter_continuity::freeze_continuity(&connection, &mut input).expect_err("hash");
    assert!(stale.contains("DSH_PREVIOUS_CHAPTER_CONTENT_UNAVAILABLE"));
    let body = "可用的上一章。";
    connection
        .execute(
            "UPDATE chapter_drafts SET content=?1, content_hash=NULL",
            rusqlite::params![body],
        )
        .expect("repair draft");
    input.continuity_claim = Some(chapter_gate::ContinuityClaim {
        previous_chapter_id: "ch-other".to_string(),
        source_hash: large_text_repository::sha256(body),
    });
    let crossed = chapter_continuity::freeze_continuity(&connection, &mut input).expect_err("scope");
    assert!(crossed.contains("DSH_PREVIOUS_CHAPTER_SCOPE_MISMATCH"));
    input.continuity_claim = Some(chapter_gate::ContinuityClaim {
        previous_chapter_id: "ch-a1".to_string(),
        source_hash: "c".repeat(64),
    });
    let changed = chapter_continuity::freeze_continuity(&connection, &mut input).expect_err("changed");
    assert!(changed.contains("DSH_PREVIOUS_CHAPTER_CHANGED"));
}

#[test]
fn readoption_change_between_freeze_and_revalidate_blocks_admission() {
    let connection = ai_task_service::tests::connection().expect("database");
    seed_story(&connection, "novel-change");
    adopt(&connection, "novel-change", "ch-a1", "冻结时的正文", None);
    let mut input = gate_input();
    input.novel_id = "novel-change".to_string();
    input.chapter_id = Some("ch-a2".to_string());
    chapter_continuity::freeze_continuity(&connection, &mut input).expect("freeze");
    connection
        .execute("UPDATE chapter_drafts SET content='改采后的正文'", [])
        .expect("readopt");
    let error = chapter_continuity::revalidate_now(&connection, &input).expect_err("changed");
    assert!(error.contains("DSH_PREVIOUS_CHAPTER_CHANGED"));
}

#[test]
fn turn_budget_counts_candidate_tools_and_length_failures_without_resetting() {
    let input = gate_input();
    let mut connection = chapter_length_connection(&input);
    for (index, run) in ["budget-1", "budget-2", "budget-3"].iter().enumerate() {
        chapter_length_run(&mut connection, &input, run, 10, true, 0, None);
        let error = if index == 0 {
            "DSH_CHAPTER_CANDIDATE_LENGTH_REJECTED: 10"
        } else {
            "fixture settled"
        };
        connection
            .execute(
                "UPDATE task_runs SET status='failed', error=?1 WHERE run_id=?2",
                rusqlite::params![error, run],
            )
            .expect("release the active run");
    }
    let usage = chapter_gate::turn_usage(&connection, &input).expect("usage");
    assert_eq!(usage.calls, 3);
    assert_eq!(usage.length_repairs, 1);
    let exhausted = chapter_gate::enforce_draft_budget(&usage).expect_err("calls");
    assert!(exhausted.contains("DSH_CHAPTER_CANDIDATE_ATTEMPTS_EXHAUSTED"));
    let mut aged_input = gate_input();
    aged_input.turn_id = "aged-turn".to_string();
    aged_input.conversation_id = input.conversation_id.clone();
    let mut aged = chapter_length_connection(&aged_input);
    chapter_length_run(&mut aged, &aged_input, "aged-run", 10, true, 0, None);
    aged.execute(
        "UPDATE task_runs SET started_at='2020-01-01T00:00:00+00:00' WHERE run_id='aged-run'",
        [],
    )
    .expect("age the turn");
    let aged_usage = chapter_gate::turn_usage(&aged, &aged_input).expect("aged");
    assert_eq!(aged_usage.calls, 1);
    assert!(aged_usage.remaining.is_zero());
    assert!(chapter_gate::enforce_draft_budget(&aged_usage)
        .expect_err("wall")
        .contains("DSH_CHAPTER_WALL_BUDGET_EXHAUSTED"));
}

#[test]
fn admit_rejects_error_severity_wrong_scope_cancel_and_hash_without_a_provider() {
    let input = gate_input();
    let mut connection = chapter_length_connection(&input);
    chapter_length_run(&mut connection, &input, "admit-run", 10, true, 0, None);
    connection
        .execute(
            "UPDATE task_runs SET error=?1 WHERE run_id='admit-run'",
            rusqlite::params![chapter_gate::WITHHELD_ERROR],
        )
        .expect("withhold");
    let mut admit_input = input.clone();
    admit_input.chapter_host_gate = Some(chapter_gate::ChapterHostGate {
        phase: "admit".to_string(),
        source_run_id: Some("admit-run".to_string()),
        content_hash: Some("d".repeat(64)),
        issue_codes: vec!["chapter_tail_pollution".to_string()],
        issue_severities: vec!["error".to_string()],
        max_integrity_repairs: Some(2),
        continues_run_id: None,
        explicit_retry: false,
    });
    admit_input.chapter_host_gate.as_mut().unwrap().issue_severities = vec!["warning".to_string()];
    let mismatch = chapter_gate::validate_host_gate(&admit_input).expect_err("severity");
    assert!(mismatch.contains("DSH_CHAPTER_INTEGRITY_ISSUES_INVALID"));
    admit_input.chapter_host_gate.as_mut().unwrap().issue_severities = vec!["error".to_string()];
    let error = chapter_gate::admit_connection(&mut connection, admit_input.clone(), None)
        .expect_err("error severity");
    assert!(error.contains("DSH_CHAPTER_INTEGRITY_ERROR_WITHHELD"));
    assert!(!error.contains("语义通过"));
    admit_input.chapter_host_gate.as_mut().unwrap().issue_codes.clear();
    admit_input.chapter_host_gate.as_mut().unwrap().issue_severities.clear();
    admit_input.turn_id = "other-turn".to_string();
    let scope = chapter_gate::admit_connection(&mut connection, admit_input.clone(), None)
        .expect_err("turn");
    assert!(scope.contains("DSH_CHAPTER_ADMISSION_SCOPE_MISMATCH"));
    admit_input.turn_id = input.turn_id.clone();
    connection
        .execute("UPDATE task_runs SET status='cancelled' WHERE run_id='admit-run'", [])
        .expect("cancel");
    let cancelled = chapter_gate::admit_connection(&mut connection, admit_input.clone(), None)
        .expect_err("cancelled");
    assert!(cancelled.contains("DSH_CHAPTER_ADMISSION_SCOPE_MISMATCH"));
    chapter_length_run(&mut connection, &input, "admit-hash", 10, true, 0, None);
    connection
        .execute(
            "UPDATE task_runs SET error=?1 WHERE run_id='admit-hash'",
            rusqlite::params![chapter_gate::WITHHELD_ERROR],
        )
        .expect("withhold hash run");
    admit_input.chapter_host_gate.as_mut().unwrap().source_run_id = Some("admit-hash".to_string());
    let hash = chapter_gate::admit_connection(&mut connection, admit_input, None).expect_err("hash");
    assert!(hash.contains("DSH_CHAPTER_ADMISSION_HASH_MISMATCH"));
    assert!(chapter_gate::is_admit(&input) == false);
    let mut ungated = input.clone();
    ungated.chapter_host_gate = None;
    assert!(chapter_gate::withholds_artifact(&ungated));
    let rejected = chapter_gate::validate_host_gate(&ungated).expect_err("missing gate");
    assert!(rejected.contains("DSH_CHAPTER_HOST_GATE_REQUIRED"));
}

#[test]
fn admit_is_idempotent_and_makes_no_provider_call() {
    let input = gate_input();
    let mut connection = chapter_length_connection(&input);
    chapter_length_run(&mut connection, &input, "admit-ok", 10, true, 0, None);
    connection
        .execute(
            "UPDATE task_runs SET error=?1 WHERE run_id='admit-ok'",
            rusqlite::params![chapter_gate::WITHHELD_ERROR],
        )
        .expect("withhold");
    let mut admit_input = input.clone();
    admit_input.chapter_host_gate = Some(chapter_gate::ChapterHostGate {
        phase: "admit".to_string(),
        source_run_id: Some("admit-ok".to_string()),
        content_hash: Some(large_text_repository::sha256(&"字".repeat(10))),
        issue_codes: Vec::new(),
        issue_severities: Vec::new(),
        max_integrity_repairs: Some(2),
        continues_run_id: None,
        explicit_retry: false,
    });
    let first = chapter_gate::admit_connection(&mut connection, admit_input.clone(), None)
        .expect("admit");
    let second = chapter_gate::admit_connection(&mut connection, admit_input, None).expect("replay");
    assert_eq!(first.artifact_id, second.artifact_id);
    assert!(first.artifact_id.is_some());
    assert_eq!(second.run.status, "completed");
    assert!(second.model_tool_attestation.is_none());
}

#[test]
fn output_tokens_cannot_exceed_the_frozen_model_cap() {
    let mut input = gate_input();
    input.chapter_word_range = Some(ChapterWordRangeInput {
        target: 3000,
        minimum: 2400,
        maximum: 3450,
    });
    assert!(chapter_gate::capped_output_tokens(&input) <= 1024);
    input.model_snapshot["options"]["maxTokens"] = serde_json::json!(9000);
    let capped = chapter_gate::capped_output_tokens(&input);
    assert!(capped < 9000);
    assert!(capped <= 32_000);
}

#[test]
fn explicit_retry_opens_a_new_epoch_and_automatic_repair_does_not_reset() {
    let input = gate_input();
    let mut connection = chapter_length_connection(&input);
    for run in ["budget-1", "budget-2", "budget-3"] {
        chapter_length_run(&mut connection, &input, run, 10, true, 0, None);
        connection
            .execute(
                "UPDATE task_runs SET status='failed', error='DSH_CHAPTER_CANDIDATE_LENGTH_REJECTED: 10', started_at='2020-01-01T00:00:00+00:00' WHERE run_id=?1",
                rusqlite::params![run],
            )
            .expect("settle exhausted attempt");
    }
    let mut automatic = input.clone();
    let exhausted =
        chapter_budget::bind_draft_attempt_connection(&connection, &mut automatic).expect_err("auto");
    assert!(exhausted.contains("DSH_CHAPTER_CANDIDATE_ATTEMPTS_EXHAUSTED"));
    let stamped = automatic
        .model_snapshot
        .pointer("/runtime/chapterBudgetEpoch")
        .and_then(|value| value.as_str())
        .expect("old epoch");
    assert!(stamped.starts_with("turn:"), "{stamped}");
    let mut continued = input.clone();
    continued
        .chapter_host_gate
        .as_mut()
        .unwrap()
        .continues_run_id = Some("budget-1".to_string());
    let still =
        chapter_budget::bind_draft_attempt_connection(&connection, &mut continued).expect_err("repair");
    assert!(still.contains("DSH_CHAPTER_CANDIDATE_ATTEMPTS_EXHAUSTED"));
    assert!(continued
        .model_snapshot
        .pointer("/runtime/chapterBudgetEpoch")
        .and_then(|value| value.as_str())
        .unwrap()
        .starts_with("turn:"));
    let mut missing = input.clone();
    missing.chapter_host_gate.as_mut().unwrap().continues_run_id = Some("not-this-turn".to_string());
    let mismatch =
        chapter_budget::bind_draft_attempt_connection(&connection, &mut missing).expect_err("foreign");
    assert!(mismatch.contains("DSH_CHAPTER_BUDGET_EPOCH_MISMATCH"));
    let mut retry = input.clone();
    retry.chapter_host_gate.as_mut().unwrap().explicit_retry = true;
    let opened = chapter_budget::bind_draft_attempt_connection(&connection, &mut retry).expect("retry");
    assert_eq!(opened.calls, 0);
    assert!(!opened.remaining.is_zero());
    let epoch = retry
        .model_snapshot
        .pointer("/runtime/chapterBudgetEpoch")
        .and_then(|value| value.as_str())
        .unwrap()
        .to_string();
    assert!(epoch.starts_with("attempt:"));
    chapter_length_run(&mut connection, &retry, "retry-1", 10, true, 0, None);
    connection
        .execute(
            "UPDATE task_runs SET status='failed', error='settled', started_at='2020-01-01T00:00:00+00:00' WHERE run_id='retry-1'",
            [],
        )
        .expect("age the explicit attempt");
    let mut restarted = input.clone();
    let blocked = chapter_budget::bind_draft_attempt_connection(&connection, &mut restarted)
        .expect_err("restart");
    assert!(blocked.contains("DSH_CHAPTER_WALL_BUDGET_EXHAUSTED"));
    assert_eq!(
        restarted
            .model_snapshot
            .pointer("/runtime/chapterBudgetEpoch")
            .and_then(|value| value.as_str()),
        Some(epoch.as_str())
    );
    let mut again = input.clone();
    again.chapter_host_gate.as_mut().unwrap().explicit_retry = true;
    let second = chapter_budget::bind_draft_attempt_connection(&connection, &mut again).expect("again");
    assert_eq!(second.calls, 0);
    assert!(!second.remaining.is_zero());
    let second_epoch = again
        .model_snapshot
        .pointer("/runtime/chapterBudgetEpoch")
        .and_then(|value| value.as_str())
        .unwrap();
    assert!(second_epoch.starts_with("attempt:") && second_epoch != epoch);
    let mut old = input.clone();
    old.chapter_host_gate.as_mut().unwrap().continues_run_id = Some("budget-1".to_string());
    let crossed = chapter_budget::bind_draft_attempt_connection(&connection, &mut old).expect_err("cross");
    assert!(crossed.contains("DSH_CHAPTER_BUDGET_EPOCH_MISMATCH"));
}

fn withheld_admit_input(input: &StartTaskTurnInput, run_id: &str) -> StartTaskTurnInput {
    let mut admit_input = input.clone();
    admit_input.chapter_host_gate = Some(chapter_gate::ChapterHostGate {
        phase: "admit".to_string(),
        source_run_id: Some(run_id.to_string()),
        content_hash: Some(large_text_repository::sha256(&"字".repeat(10))),
        issue_codes: Vec::new(),
        issue_severities: Vec::new(),
        max_integrity_repairs: Some(2),
        continues_run_id: None,
        explicit_retry: false,
    });
    admit_input
}

fn artifact_rows(connection: &rusqlite::Connection) -> i64 {
    connection
        .query_row(
            "SELECT
                (SELECT COUNT(*) FROM conversation_artifact_cards)
                + (SELECT COUNT(*) FROM result_artifacts)",
            [],
            |row| row.get(0),
        )
        .expect("count artifacts")
}

#[test]
fn admission_rechecks_source_epoch_and_rejects_late_or_rewritten_options() {
    let input = gate_input();
    let mut connection = chapter_length_connection(&input);
    chapter_length_run(&mut connection, &input, "late", 10, true, 0, None);
    connection
        .execute(
            "UPDATE task_runs SET error=?1, started_at='2020-01-01T00:00:00+00:00' WHERE run_id='late'",
            rusqlite::params![chapter_gate::WITHHELD_ERROR],
        )
        .expect("age withheld run");
    let late = chapter_gate::admit_connection(
        &mut connection,
        withheld_admit_input(&input, "late"),
        None,
    )
    .expect_err("late admit");
    assert!(late.contains("DSH_CHAPTER_WALL_BUDGET_EXHAUSTED"));
    assert_eq!(artifact_rows(&connection), 0);
    chapter_gate::fail_abandoned_withheld(&mut connection, &input.conversation_id).expect("release");
    let mut retry = input.clone();
    retry.chapter_host_gate.as_mut().unwrap().explicit_retry = true;
    let opened = chapter_budget::bind_draft_attempt_connection(&connection, &mut retry).expect("retry");
    assert_eq!(opened.calls, 0);
    assert!(!opened.remaining.is_zero());

    let mut rewritten = gate_input();
    rewritten.turn_id = "rewrite-turn".to_string();
    let mut rewrite_db = chapter_length_connection(&rewritten);
    chapter_length_run(&mut rewrite_db, &rewritten, "rewrite", 10, true, 0, None);
    rewrite_db
        .execute(
            "UPDATE task_runs SET error=?1 WHERE run_id='rewrite'",
            rusqlite::params![chapter_gate::WITHHELD_ERROR],
        )
        .expect("withhold rewrite");
    let mut changed = withheld_admit_input(&rewritten, "rewrite");
    changed.model_snapshot["options"]["temperature"] = serde_json::json!(0.9);
    changed.model_snapshot["sourceId"] = serde_json::json!("forged-source");
    let mismatch = chapter_gate::admit_connection(&mut rewrite_db, changed, None).expect_err("options");
    assert!(mismatch.contains("DSH_CHAPTER_ADMISSION_MODEL_MISMATCH"));
    assert_eq!(artifact_rows(&rewrite_db), 0);

    let mut third = gate_input();
    third.turn_id = "third-turn".to_string();
    third.model_snapshot["options"]["temperature"] = serde_json::json!(1);
    let mut third_db = chapter_length_connection(&third);
    let mut stored = third.clone();
    stored.model_snapshot["runtime"]["chapterBudgetEpoch"] = serde_json::json!("turn:third-turn");
    chapter_length_run(&mut third_db, &stored, "third", 10, true, 2, None);
    third_db
        .execute(
            "UPDATE task_runs SET error=?1 WHERE run_id='third'",
            rusqlite::params![chapter_gate::WITHHELD_ERROR],
        )
        .expect("withhold third");
    let admitted = chapter_gate::admit_connection(&mut third_db, withheld_admit_input(&third, "third"), None)
        .expect("third candidate");
    assert!(admitted.artifact_id.is_some());
    let stored_epoch: String = third_db
        .query_row(
            "SELECT json_extract(target_hint_json,'$.modelSnapshot.runtime.chapterBudgetEpoch') FROM ai_tasks",
            [],
            |row| row.get(0),
        )
        .expect("persisted snapshot");
    assert_eq!(stored_epoch, "turn:third-turn");
    let replay = chapter_gate::admit_connection(&mut third_db, withheld_admit_input(&third, "third"), None)
        .expect("replay");
    assert_eq!(replay.artifact_id, admitted.artifact_id);
    assert_eq!(
        third_db
            .query_row::<i64, _, _>("SELECT COUNT(*) FROM conversation_artifact_cards", [], |row| row.get(0))
            .expect("cards"),
        1
    );

    let mut over = gate_input();
    over.turn_id = "over-turn".to_string();
    let mut over_db = chapter_length_connection(&over);
    chapter_length_run(&mut over_db, &over, "over-extra", 10, true, 2, None);
    over_db
        .execute(
            "UPDATE task_runs SET status='failed', error='settled' WHERE run_id='over-extra'",
            [],
        )
        .expect("release extra");
    chapter_length_run(&mut over_db, &over, "over-run", 10, true, 0, None);
    over_db
        .execute(
            "UPDATE task_runs SET error=?1 WHERE run_id='over-run'",
            rusqlite::params![chapter_gate::WITHHELD_ERROR],
        )
        .expect("withhold over");
    let too_many = chapter_gate::admit_connection(&mut over_db, withheld_admit_input(&over, "over-run"), None)
        .expect_err("fourth call");
    assert!(too_many.contains("DSH_CHAPTER_CANDIDATE_ATTEMPTS_EXHAUSTED"));
    assert_eq!(artifact_rows(&over_db), 0);
}

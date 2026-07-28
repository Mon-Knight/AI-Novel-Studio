use super::*;
use rusqlite::Connection;
use serde_json::json;

struct Fixture {
    novel: String,
    plan: String,
    chapter: String,
}

fn db() -> Connection {
    let mut db = Connection::open_in_memory().unwrap();
    db.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
    crate::db::create_tables(&mut db).unwrap();
    db
}

fn fixture(db: &Connection, key: &str) -> Fixture {
    let novel = format!("novel-{key}");
    let plan = format!("plan-{key}");
    let now = Utc::now().to_rfc3339();
    db.execute(
        "INSERT INTO novels(id,title,created_at,updated_at) VALUES(?1,?2,?3,?3)",
        params![novel, key, now],
    )
    .unwrap();
    let chapters = (1..=12)
        .map(|number| {
            let id = format!("chapter-{key}-{number}");
            db.execute(
                "INSERT INTO chapters(id,novel_id,title,order_index,created_at,updated_at)
                 VALUES(?1,?2,?3,?4,?5,?5)",
                params![id, novel, format!("Chapter {number}"), number, now],
            )
            .unwrap();
            json!({"id": id, "chapterNumber": number})
        })
        .collect::<Vec<_>>();
    let value = json!({
        "planId": plan,
        "novelId": novel,
        "status": "applied",
        "chapters": chapters,
    });
    let plan_json = ai_fact_security::canonical_json(&value).unwrap();
    let plan_hash = large_text_repository::sha256(&plan_json);
    db.execute(
        "INSERT INTO autonomous_story_plans
         (plan_id,operation_id,novel_id,request_hash,schema_version,status,stage,revision,
          target_chapter_count,completed_chapter_count,plan_json,plan_hash,created_at,
          updated_at,completed_at,applied_at)
         VALUES(?1,?2,?3,?4,1,'applied','applied',1,12,12,?5,?6,?7,?7,?7,?7)",
        params![
            plan,
            format!("plan-operation-{key}"),
            novel,
            "0".repeat(64),
            plan_json,
            plan_hash,
            now
        ],
    )
    .unwrap();
    Fixture {
        novel,
        plan,
        chapter: format!("chapter-{key}-1"),
    }
}

fn policy(mode: &str) -> AutonomousAutomationPolicy {
    AutonomousAutomationPolicy {
        schema_version: 1,
        mode: mode.into(),
        max_chapters: 1,
        max_consecutive_failures: 3,
        max_retries_per_chapter: 2,
        minimum_successful_experts: 2,
        minimum_average_score: 80.0,
        minimum_acceptance_rate: 0.75,
        auto_confirm_analysis: mode == "full_auto",
        daily_token_budget: None,
        book_token_budget: None,
        daily_cost_budget_usd: None,
        book_cost_budget_usd: None,
        run_window: None,
    }
}

fn run(
    db: &mut Connection,
    f: &Fixture,
    key: &str,
    policy: AutonomousAutomationPolicy,
) -> AutonomousBookRunDto {
    create_run(
        db,
        CreateAutonomousBookRunInput {
            operation_id: format!("run-{key}"),
            novel_id: f.novel.clone(),
            plan_id: f.plan.clone(),
            policy,
        },
    )
    .unwrap()
}

fn lease(db: &mut Connection, run: &str, owner: &str) -> AutonomousRunLeaseGrant {
    acquire_lease(
        db,
        AcquireAutonomousRunLeaseInput {
            run_id: run.into(),
            owner_id: owner.into(),
            ttl_seconds: Some(90),
        },
    )
    .unwrap()
}

fn proof(grant: &AutonomousRunLeaseGrant) -> AutonomousRunLeaseProof {
    AutonomousRunLeaseProof {
        lease_id: grant.lease.lease_id.clone(),
        epoch: grant.lease.epoch,
        token: grant.token.clone(),
    }
}

fn claim(
    db: &mut Connection,
    run: &str,
    proof: AutonomousRunLeaseProof,
) -> AutonomousRunChapterClaim {
    claim_chapter(
        db,
        ClaimAutonomousRunChapterInput {
            run_id: run.into(),
            lease: proof,
            estimated_tokens: 10,
            estimated_cost_usd: 0.01,
        },
    )
    .unwrap()
}

fn draft(db: &Connection, f: &Fixture, key: &str, adopted: bool) -> String {
    let id = format!("draft-{key}");
    let now = Utc::now().to_rfc3339();
    db.execute(
        "INSERT INTO chapter_drafts
         (id,novel_id,chapter_id,content,source,version_no,word_count,is_adopted,created_at,updated_at)
         VALUES(?1,?2,?3,'candidate','ai',1,9,?4,?5,?5)",
        params![id, f.novel, f.chapter, i64::from(adopted), now],
    )
    .unwrap();
    id
}

fn finish_input(
    run: &AutonomousBookRunDto,
    claim: &AutonomousRunChapterClaim,
    lease: &AutonomousRunLeaseGrant,
    outcome: &str,
    draft: Option<&str>,
) -> FinishAutonomousRunChapterInput {
    FinishAutonomousRunChapterInput {
        run_id: run.run_id.clone(),
        attempt_id: claim.attempt.attempt_id.clone(),
        lease: proof(lease),
        outcome: outcome.into(),
        token_input: Some(5),
        token_output: Some(5),
        cost_usd: Some(0.01),
        candidate_draft_id: draft.map(str::to_owned),
        adopted_draft_id: matches!(outcome, "adopted" | "confirmed")
            .then(|| draft.unwrap().to_owned()),
        review_session_id: None,
        successful_experts: Some(2),
        average_score: Some(90.0),
        acceptance_rate: Some(1.0),
        analysis_confirmed: Some(outcome == "confirmed"),
        error: None,
    }
}

#[test]
fn lease_competition_has_one_owner() {
    let path = std::env::temp_dir().join(format!("scheduler-{}.db", Uuid::new_v4()));
    let mut first_db = Connection::open(&path).unwrap();
    first_db
        .execute_batch("PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;")
        .unwrap();
    crate::db::create_tables(&mut first_db).unwrap();
    let f = fixture(&first_db, "lease-race");
    let run = run(&mut first_db, &f, "lease-race", policy("draft_night"));
    let first = lease(&mut first_db, &run.run_id, "process-a");
    let mut second_db = Connection::open(&path).unwrap();
    second_db.execute_batch("PRAGMA foreign_keys=ON;").unwrap();
    let error = acquire_lease(
        &mut second_db,
        AcquireAutonomousRunLeaseInput {
            run_id: run.run_id,
            owner_id: "process-b".into(),
            ttl_seconds: Some(90),
        },
    )
    .unwrap_err();
    assert_eq!(error.code, codes::AUTONOMOUS_RUN_LEASE_CONFLICT);
    assert_eq!(first.lease.epoch, 1);
    drop(second_db);
    drop(first_db);
    let _ = std::fs::remove_file(&path);
    let _ = std::fs::remove_file(path.with_extension("db-wal"));
    let _ = std::fs::remove_file(path.with_extension("db-shm"));
}

#[test]
fn expired_lease_recovers_and_epoch_increases() {
    let mut db = db();
    let f = fixture(&db, "recover");
    let run = run(&mut db, &f, "recover", policy("draft_night"));
    let first = lease(&mut db, &run.run_id, "process-a");
    let attempt = claim(&mut db, &run.run_id, proof(&first));
    db.execute(
        "UPDATE autonomous_run_leases SET expires_at=?1 WHERE lease_id=?2",
        params![
            (Utc::now() - Duration::minutes(1)).to_rfc3339(),
            first.lease.lease_id
        ],
    )
    .unwrap();
    let recovered = recover_interrupted_runs(&mut db).unwrap();
    assert_eq!(recovered[0].status, "queued");
    assert_eq!(
        list_attempts(&db, &run.run_id, 10).unwrap()[0].status,
        "abandoned"
    );
    assert_eq!(attempt.attempt.attempt_number, 1);
    let second = lease(&mut db, &run.run_id, "process-b");
    assert_eq!(second.lease.epoch, first.lease.epoch + 1);
    let error = heartbeat(
        &mut db,
        HeartbeatAutonomousRunInput {
            run_id: run.run_id,
            lease: proof(&first),
            ttl_seconds: Some(90),
        },
    )
    .unwrap_err();
    assert_eq!(error.code, codes::AUTONOMOUS_RUN_LEASE_EXPIRED);
}

#[test]
fn three_modes_have_distinct_frozen_decisions() {
    assert_eq!(
        expected_success_outcome(&policy("draft_night"), true),
        "candidate_ready"
    );
    assert_eq!(
        expected_success_outcome(&policy("quality_gate"), false),
        "candidate_ready"
    );
    assert_eq!(
        expected_success_outcome(&policy("quality_gate"), true),
        "adopted"
    );
    assert_eq!(
        expected_success_outcome(&policy("full_auto"), false),
        "candidate_ready"
    );
    assert_eq!(
        expected_success_outcome(&policy("full_auto"), true),
        "confirmed"
    );
}

#[test]
fn budget_window_and_failure_breaker_are_enforced() {
    let mut db = db();
    let budget_f = fixture(&db, "budget");
    let mut p = policy("draft_night");
    p.book_token_budget = Some(9);
    let budget_run = run(&mut db, &budget_f, "budget", p);
    let budget_lease = lease(&mut db, &budget_run.run_id, "budget-owner");
    let error = claim_chapter(
        &mut db,
        ClaimAutonomousRunChapterInput {
            run_id: budget_run.run_id,
            lease: proof(&budget_lease),
            estimated_tokens: 10,
            estimated_cost_usd: 0.01,
        },
    )
    .unwrap_err();
    assert_eq!(error.code, codes::AUTONOMOUS_RUN_BUDGET_EXCEEDED);

    let window_f = fixture(&db, "window");
    let minute = Utc::now().format("%H").to_string().parse::<i64>().unwrap() * 60
        + Utc::now().format("%M").to_string().parse::<i64>().unwrap();
    let mut p = policy("draft_night");
    p.run_window = Some(AutonomousRunWindow {
        start_minute: (minute + 2) % 1440,
        end_minute: (minute + 3) % 1440,
        utc_offset_minutes: 0,
    });
    let window_run = run(&mut db, &window_f, "window", p);
    let window_lease = lease(&mut db, &window_run.run_id, "window-owner");
    let error = claim_chapter(
        &mut db,
        ClaimAutonomousRunChapterInput {
            run_id: window_run.run_id,
            lease: proof(&window_lease),
            estimated_tokens: 1,
            estimated_cost_usd: 0.0,
        },
    )
    .unwrap_err();
    assert_eq!(error.code, codes::AUTONOMOUS_RUN_WINDOW_CLOSED);

    let breaker_f = fixture(&db, "breaker");
    let mut p = policy("draft_night");
    p.max_consecutive_failures = 1;
    let breaker_run = run(&mut db, &breaker_f, "breaker", p);
    let breaker_lease = lease(&mut db, &breaker_run.run_id, "breaker-owner");
    let breaker_claim = claim(&mut db, &breaker_run.run_id, proof(&breaker_lease));
    let mut input = finish_input(&breaker_run, &breaker_claim, &breaker_lease, "failed", None);
    input.successful_experts = None;
    input.average_score = None;
    input.acceptance_rate = None;
    input.error = Some(json!({"code":"PROVIDER_TIMEOUT","retryable":true}));
    let finished = finish_chapter(&mut db, input).unwrap();
    assert_eq!(finished.run.status, "paused");
    assert_eq!(
        finished.run.pause_reason.as_deref(),
        Some("consecutive_failures")
    );
}

#[test]
fn adoption_and_confirmed_analysis_are_revalidated() {
    let mut db = db();
    let adopted_f = fixture(&db, "adopted");
    let adopted_run = run(&mut db, &adopted_f, "adopted", policy("quality_gate"));
    let adopted_lease = lease(&mut db, &adopted_run.run_id, "owner-a");
    let adopted_claim = claim(&mut db, &adopted_run.run_id, proof(&adopted_lease));
    let adopted_draft = draft(&db, &adopted_f, "adopted", false);
    let adopted_input = finish_input(
        &adopted_run,
        &adopted_claim,
        &adopted_lease,
        "adopted",
        Some(&adopted_draft),
    );
    assert_eq!(
        finish_chapter(&mut db, adopted_input.clone())
            .unwrap_err()
            .code,
        codes::AUTONOMOUS_RUN_DECISION_INVALID
    );
    db.execute(
        "UPDATE chapter_drafts SET is_adopted=1 WHERE id=?1",
        [&adopted_draft],
    )
    .unwrap();
    assert_eq!(
        finish_chapter(&mut db, adopted_input)
            .unwrap()
            .attempt
            .status,
        "adopted"
    );

    let confirmed_f = fixture(&db, "confirmed");
    let confirmed_run = run(&mut db, &confirmed_f, "confirmed", policy("full_auto"));
    let confirmed_lease = lease(&mut db, &confirmed_run.run_id, "owner-b");
    let confirmed_claim = claim(&mut db, &confirmed_run.run_id, proof(&confirmed_lease));
    let confirmed_draft = draft(&db, &confirmed_f, "confirmed", true);
    let confirmed_input = finish_input(
        &confirmed_run,
        &confirmed_claim,
        &confirmed_lease,
        "confirmed",
        Some(&confirmed_draft),
    );
    assert_eq!(
        finish_chapter(&mut db, confirmed_input.clone())
            .unwrap_err()
            .code,
        codes::AUTONOMOUS_RUN_DECISION_INVALID
    );
    let now = Utc::now().to_rfc3339();
    db.execute(
        "INSERT INTO chapter_summaries
         (id,novel_id,chapter_id,adopted_draft_id,summary,created_at,updated_at,enabled,validation_status)
         VALUES('summary-confirmed',?1,?2,?3,'summary',?4,?4,1,'passed')",
        params![confirmed_f.novel, confirmed_f.chapter, confirmed_draft, now],
    )
    .unwrap();
    assert_eq!(
        finish_chapter(&mut db, confirmed_input)
            .unwrap()
            .attempt
            .status,
        "confirmed"
    );
}

#[test]
fn operation_replay_is_idempotent_and_state_changes_use_cas() {
    let mut db = db();
    let f = fixture(&db, "replay");
    let input = CreateAutonomousBookRunInput {
        operation_id: "run-replay".into(),
        novel_id: f.novel.clone(),
        plan_id: f.plan.clone(),
        policy: policy("draft_night"),
    };
    let run = create_run(&mut db, input.clone()).unwrap();
    assert_eq!(create_run(&mut db, input).unwrap().run_id, run.run_id);
    let lease = lease(&mut db, &run.run_id, "replay-owner");
    let claim = claim(&mut db, &run.run_id, proof(&lease));
    let draft = draft(&db, &f, "replay", false);
    let finish = finish_input(&run, &claim, &lease, "candidate_ready", Some(&draft));
    let done = finish_chapter(&mut db, finish.clone()).unwrap();
    assert!(finish_chapter(&mut db, finish.clone()).unwrap().replayed);
    let mut conflicting = finish;
    conflicting.token_output = Some(6);
    assert_eq!(
        finish_chapter(&mut db, conflicting).unwrap_err().code,
        codes::AUTONOMOUS_RUN_STATE_CONFLICT
    );
    assert_eq!(
        pause_run(
            &mut db,
            ChangeAutonomousRunStateInput {
                operation_id: "stale-pause".into(),
                run_id: run.run_id.clone(),
                expected_revision: done.run.state_revision - 1,
                reason: None,
            }
        )
        .unwrap_err()
        .code,
        codes::AUTONOMOUS_RUN_STATE_CONFLICT
    );
    db.execute(
        "UPDATE chapter_drafts SET is_adopted=1 WHERE id=?1",
        [&draft],
    )
    .unwrap();
    let promote = PromoteAutonomousRunAttemptInput {
        operation_id: "promote-replay".into(),
        run_id: run.run_id,
        attempt_id: claim.attempt.attempt_id,
        expected_revision: done.run.state_revision,
        outcome: "adopted".into(),
        adopted_draft_id: draft,
        analysis_confirmed: Some(false),
        user_confirmed: true,
    };
    let before_promote = get_run(&db, &promote.run_id).unwrap().unwrap();
    let before_attempt = list_attempts(&db, &promote.run_id, 10).unwrap().remove(0);
    assert_eq!(before_promote.status, "completed");
    assert_eq!(before_promote.state_revision, promote.expected_revision);
    assert_eq!(before_attempt.status, "candidate_ready");
    assert_eq!(
        before_attempt.candidate_draft_id.as_deref(),
        Some(promote.adopted_draft_id.as_str())
    );
    assert!(!promote_attempt(&mut db, promote.clone()).unwrap().replayed);
    assert!(promote_attempt(&mut db, promote.clone()).unwrap().replayed);
    let mut wrong_operation = promote;
    wrong_operation.operation_id = "promote-other".into();
    assert_eq!(
        promote_attempt(&mut db, wrong_operation).unwrap_err().code,
        codes::AUTONOMOUS_RUN_STATE_CONFLICT
    );
}

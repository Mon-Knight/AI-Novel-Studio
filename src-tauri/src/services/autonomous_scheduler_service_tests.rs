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

fn review_fact(db: &Connection, f: &Fixture, draft_id: &str, key: &str) -> String {
    let session_id = format!("review-{key}");
    let now = Utc::now().to_rfc3339();
    db.execute(
        "INSERT INTO multi_agent_sessions
         (session_id,operation_id,novel_id,chapter_id,source_draft_id,
          source_draft_version,source_content_hash,expert_types_json,max_rounds,
          acceptance_threshold,minimum_average_score,minimum_successful_experts,
          status,current_round,accepted,final_action,final_draft_id,total_tokens_input,
          total_tokens_output,total_tokens_used,duration_ms,created_at,updated_at,completed_at)
         VALUES(?1,?2,?3,?4,?5,1,?6,'[\"plot\",\"logic\"]',1,0.75,80,2,
                'completed',1,1,'accept',?5,5,5,10,10,?7,?7,?7)",
        params![
            session_id,
            format!("review-operation-{key}"),
            f.novel,
            f.chapter,
            draft_id,
            "1".repeat(64),
            now,
        ],
    )
    .unwrap();
    db.execute(
        "INSERT INTO multi_agent_rounds
         (session_id,round_number,input_draft_id,input_draft_version,input_content_hash,
          agreed,acceptance_rate,average_score,successful_experts,failed_experts,
          required_successful_experts,action,major_concerns_json,merged_suggestions_json,
          tokens_input,tokens_output,tokens_used,duration_ms,started_at,completed_at)
         VALUES(?1,1,?2,1,?3,1,1.0,90.0,2,0,2,'accept','[]','[]',5,5,10,10,?4,?4)",
        params![session_id, draft_id, "1".repeat(64), now],
    )
    .unwrap();
    session_id
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
        authorization_id: None,
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
fn pre_claim_pause_releases_lease_and_records_no_generation_side_effects() {
    let mut db = db();
    let f = fixture(&db, "pre-claim-pause");
    let run = run(&mut db, &f, "pre-claim-pause", policy("draft_night"));
    let lease = lease(&mut db, &run.run_id, "pre-claim-owner");
    let running = get_run(&db, &run.run_id).unwrap().unwrap();
    assert_eq!(running.status, "running");

    let paused = pause_run(
        &mut db,
        ChangeAutonomousRunStateInput {
            operation_id: "pre-claim-worker-failure".into(),
            run_id: run.run_id.clone(),
            expected_revision: running.state_revision,
            reason: Some("worker_error:unexpected".into()),
        },
    )
    .unwrap();

    assert_eq!(paused.status, "paused");
    assert_eq!(
        paused.pause_reason.as_deref(),
        Some("worker_error:unexpected")
    );
    let lease_state: (String, Option<String>) = db
        .query_row(
            "SELECT status, released_at FROM autonomous_run_leases WHERE lease_id=?1",
            [&lease.lease.lease_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap();
    assert_eq!(lease_state.0, "released");
    assert!(lease_state.1.is_some());
    let latest_checkpoint: (String, String) = db
        .query_row(
            "SELECT event_type, run_status FROM autonomous_run_checkpoints
             WHERE run_id=?1 ORDER BY sequence DESC LIMIT 1",
            [&run.run_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap();
    assert_eq!(latest_checkpoint, ("run_pause".into(), "paused".into()));

    for table in [
        "autonomous_run_chapter_attempts",
        "ai_tasks",
        "ai_task_records",
        "generation_jobs",
    ] {
        let count: i64 = db
            .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(count, 0, "{table} must remain empty before claim");
    }
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
fn queued_runs_remain_discoverable_after_an_earlier_recovery_owner() {
    let mut db = db();
    let f = fixture(&db, "recovery-handoff");
    let run = run(&mut db, &f, "recovery-handoff", policy("draft_night"));

    let database_bootstrap = recover_interrupted_runs(&mut db).unwrap();
    assert_eq!(database_bootstrap.len(), 1);
    assert_eq!(database_bootstrap[0].run_id, run.run_id);
    assert_eq!(database_bootstrap[0].status, "queued");

    let frontend_bootstrap = recover_interrupted_runs(&mut db).unwrap();
    assert_eq!(frontend_bootstrap.len(), 1);
    assert_eq!(frontend_bootstrap[0].run_id, run.run_id);
    assert_eq!(frontend_bootstrap[0].status, "queued");
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
        "candidate_ready"
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
fn review_modes_cannot_finish_adopted_and_full_auto_confirmation_is_revalidated() {
    let mut db = db();
    let adopted_f = fixture(&db, "review-mode-adopted");
    let adopted_run = run(
        &mut db,
        &adopted_f,
        "review-mode-adopted",
        policy("quality_gate"),
    );
    let adopted_lease = lease(&mut db, &adopted_run.run_id, "owner-a");
    let adopted_claim = claim(&mut db, &adopted_run.run_id, proof(&adopted_lease));
    let adopted_draft = draft(&db, &adopted_f, "review-mode-adopted", false);
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
        finish_chapter(&mut db, adopted_input).unwrap_err().code,
        codes::AUTONOMOUS_RUN_DECISION_INVALID
    );
    let disguised_candidate = finish_input(
        &adopted_run,
        &adopted_claim,
        &adopted_lease,
        "candidate_ready",
        Some(&adopted_draft),
    );
    assert_eq!(
        finish_chapter(&mut db, disguised_candidate)
            .unwrap_err()
            .code,
        codes::AUTONOMOUS_RUN_DECISION_INVALID
    );

    let confirmed_f = fixture(&db, "confirmed");
    let confirmed_run = run(&mut db, &confirmed_f, "confirmed", policy("full_auto"));
    let confirmed_lease = lease(&mut db, &confirmed_run.run_id, "owner-b");
    let confirmed_claim = claim(&mut db, &confirmed_run.run_id, proof(&confirmed_lease));
    let confirmed_draft = draft(&db, &confirmed_f, "confirmed", false);
    let review_session_id = review_fact(&db, &confirmed_f, &confirmed_draft, "confirmed");
    let mut confirmed_input = finish_input(
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
    let authorization_input = AuthorizeFullAutoAttemptInput {
        operation_id: "authorize-confirmed".into(),
        run_id: confirmed_run.run_id.clone(),
        attempt_id: confirmed_claim.attempt.attempt_id.clone(),
        expected_revision: confirmed_claim.run.state_revision,
        lease: proof(&confirmed_lease),
        candidate_draft_id: confirmed_draft.clone(),
        review_session_id: review_session_id.clone(),
        token_input: Some(5),
        token_output: Some(5),
        cost_usd: Some(0.01),
    };
    let authorization = authorize_full_auto_attempt(&mut db, authorization_input.clone()).unwrap();
    assert!(!authorization.replayed);
    assert_eq!(
        authorization
            .attempt
            .decision
            .as_ref()
            .and_then(|value| value.get("phase"))
            .and_then(Value::as_str),
        Some("full_auto_authorized")
    );
    assert!(
        authorize_full_auto_attempt(&mut db, authorization_input.clone())
            .unwrap()
            .replayed
    );
    let mut conflicting_authorization = authorization_input;
    conflicting_authorization.operation_id = "authorize-conflicting".into();
    assert_eq!(
        authorize_full_auto_attempt(&mut db, conflicting_authorization)
            .unwrap_err()
            .code,
        codes::AUTONOMOUS_RUN_STATE_CONFLICT
    );
    db.execute(
        "UPDATE chapter_drafts SET is_adopted=1 WHERE id=?1",
        [&confirmed_draft],
    )
    .unwrap();
    let now = Utc::now().to_rfc3339();
    db.execute(
        "INSERT INTO chapter_summaries
         (id,novel_id,chapter_id,adopted_draft_id,summary,created_at,updated_at,enabled,validation_status)
         VALUES('summary-confirmed',?1,?2,?3,'summary',?4,?4,1,'passed')",
        params![confirmed_f.novel, confirmed_f.chapter, confirmed_draft, now],
    )
    .unwrap();
    confirmed_input.review_session_id = Some(review_session_id);
    confirmed_input.authorization_id = Some(authorization.authorization_id);
    assert_eq!(
        finish_chapter(&mut db, confirmed_input)
            .unwrap()
            .attempt
            .status,
        "confirmed"
    );
}

#[test]
fn full_auto_authorization_blocks_budget_and_target_drift_before_adoption() {
    let mut db = db();
    let budget_f = fixture(&db, "authorize-budget");
    let mut budget_policy = policy("full_auto");
    budget_policy.book_token_budget = Some(10);
    let budget_run = run(&mut db, &budget_f, "authorize-budget", budget_policy);
    let budget_lease = lease(&mut db, &budget_run.run_id, "budget-owner");
    let budget_claim = claim(&mut db, &budget_run.run_id, proof(&budget_lease));
    let budget_draft = draft(&db, &budget_f, "authorize-budget", false);
    let budget_review = review_fact(&db, &budget_f, &budget_draft, "authorize-budget");
    db.execute(
        "UPDATE autonomous_book_runs SET token_output=1 WHERE run_id=?1",
        [&budget_run.run_id],
    )
    .unwrap();
    let budget_error = authorize_full_auto_attempt(
        &mut db,
        AuthorizeFullAutoAttemptInput {
            operation_id: "authorize-budget".into(),
            run_id: budget_run.run_id.clone(),
            attempt_id: budget_claim.attempt.attempt_id,
            expected_revision: budget_claim.run.state_revision,
            lease: proof(&budget_lease),
            candidate_draft_id: budget_draft.clone(),
            review_session_id: budget_review,
            token_input: Some(5),
            token_output: Some(5),
            cost_usd: Some(0.01),
        },
    )
    .unwrap_err();
    assert_eq!(budget_error.code, codes::AUTONOMOUS_RUN_BUDGET_EXCEEDED);
    let budget_state: (i64, Option<String>) = db
        .query_row(
            "SELECT is_adopted, decision_json FROM chapter_drafts d
             JOIN autonomous_run_chapter_attempts a ON a.candidate_draft_id IS NULL
             WHERE d.id=?1 AND a.run_id=?2 LIMIT 1",
            params![budget_draft, budget_run.run_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap();
    assert_eq!(budget_state, (0, None));

    let target_f = fixture(&db, "authorize-target");
    let target_run = run(&mut db, &target_f, "authorize-target", policy("full_auto"));
    let target_lease = lease(&mut db, &target_run.run_id, "target-owner");
    let target_claim = claim(&mut db, &target_run.run_id, proof(&target_lease));
    let target_draft = draft(&db, &target_f, "authorize-target", false);
    let target_review = review_fact(&db, &target_f, &target_draft, "authorize-target");
    db.execute(
        "UPDATE autonomous_book_runs SET next_chapter_number=2 WHERE run_id=?1",
        [&target_run.run_id],
    )
    .unwrap();
    let target_error = authorize_full_auto_attempt(
        &mut db,
        AuthorizeFullAutoAttemptInput {
            operation_id: "authorize-target".into(),
            run_id: target_run.run_id,
            attempt_id: target_claim.attempt.attempt_id,
            expected_revision: target_claim.run.state_revision,
            lease: proof(&target_lease),
            candidate_draft_id: target_draft.clone(),
            review_session_id: target_review,
            token_input: Some(5),
            token_output: Some(5),
            cost_usd: Some(0.01),
        },
    )
    .unwrap_err();
    assert_eq!(target_error.code, codes::AUTONOMOUS_RUN_DECISION_INVALID);
    assert_eq!(
        db.query_row(
            "SELECT is_adopted FROM chapter_drafts WHERE id=?1",
            [&target_draft],
            |row| row.get::<_, i64>(0),
        )
        .unwrap(),
        0
    );
}

#[test]
fn recovered_full_auto_attempt_reauthorizes_only_a_previously_authorized_adoption() {
    let mut db = db();
    let f = fixture(&db, "authorize-recovery");
    let recovery_run = run(&mut db, &f, "authorize-recovery", policy("full_auto"));
    let first_lease = lease(&mut db, &recovery_run.run_id, "first-owner");
    let first_claim = claim(&mut db, &recovery_run.run_id, proof(&first_lease));
    let candidate = draft(&db, &f, "authorize-recovery", false);
    let review = review_fact(&db, &f, &candidate, "authorize-recovery");
    authorize_full_auto_attempt(
        &mut db,
        AuthorizeFullAutoAttemptInput {
            operation_id: "authorize-before-crash".into(),
            run_id: recovery_run.run_id.clone(),
            attempt_id: first_claim.attempt.attempt_id.clone(),
            expected_revision: first_claim.run.state_revision,
            lease: proof(&first_lease),
            candidate_draft_id: candidate.clone(),
            review_session_id: review.clone(),
            token_input: Some(5),
            token_output: Some(5),
            cost_usd: Some(0.01),
        },
    )
    .unwrap();
    db.execute(
        "UPDATE chapter_drafts SET is_adopted=1 WHERE id=?1",
        [&candidate],
    )
    .unwrap();
    db.execute(
        "UPDATE autonomous_run_leases SET expires_at=?1 WHERE lease_id=?2",
        params![
            (Utc::now() - Duration::minutes(1)).to_rfc3339(),
            first_lease.lease.lease_id,
        ],
    )
    .unwrap();

    assert_eq!(
        recover_interrupted_runs(&mut db).unwrap()[0].status,
        "queued"
    );
    assert_eq!(
        find_attempt(&db, &first_claim.attempt.attempt_id)
            .unwrap()
            .unwrap()
            .status,
        "abandoned"
    );
    let second_lease = lease(&mut db, &recovery_run.run_id, "second-owner");
    let second_claim = claim(&mut db, &recovery_run.run_id, proof(&second_lease));
    let recovered_authorization = authorize_full_auto_attempt(
        &mut db,
        AuthorizeFullAutoAttemptInput {
            operation_id: "authorize-after-crash".into(),
            run_id: recovery_run.run_id,
            attempt_id: second_claim.attempt.attempt_id,
            expected_revision: second_claim.run.state_revision,
            lease: proof(&second_lease),
            candidate_draft_id: candidate,
            review_session_id: review,
            token_input: Some(5),
            token_output: Some(5),
            cost_usd: Some(0.01),
        },
    )
    .unwrap();
    assert!(!recovered_authorization.replayed);
    assert_eq!(
        recovered_authorization
            .attempt
            .decision
            .as_ref()
            .and_then(|value| value.get("phase"))
            .and_then(Value::as_str),
        Some("full_auto_authorized")
    );

    let rogue_f = fixture(&db, "authorize-rogue-adoption");
    let rogue_run = run(
        &mut db,
        &rogue_f,
        "authorize-rogue-adoption",
        policy("full_auto"),
    );
    let rogue_lease = lease(&mut db, &rogue_run.run_id, "rogue-owner");
    let rogue_claim = claim(&mut db, &rogue_run.run_id, proof(&rogue_lease));
    let rogue_candidate = draft(&db, &rogue_f, "authorize-rogue-adoption", true);
    let rogue_review = review_fact(&db, &rogue_f, &rogue_candidate, "authorize-rogue-adoption");
    assert_eq!(
        authorize_full_auto_attempt(
            &mut db,
            AuthorizeFullAutoAttemptInput {
                operation_id: "authorize-rogue-adoption".into(),
                run_id: rogue_run.run_id,
                attempt_id: rogue_claim.attempt.attempt_id,
                expected_revision: rogue_claim.run.state_revision,
                lease: proof(&rogue_lease),
                candidate_draft_id: rogue_candidate,
                review_session_id: rogue_review,
                token_input: Some(5),
                token_output: Some(5),
                cost_usd: Some(0.01),
            },
        )
        .unwrap_err()
        .code,
        codes::AUTONOMOUS_RUN_DECISION_INVALID
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
        policy: policy("quality_gate"),
    };
    let run = create_run(&mut db, input.clone()).unwrap();
    assert_eq!(create_run(&mut db, input).unwrap().run_id, run.run_id);
    let lease = lease(&mut db, &run.run_id, "replay-owner");
    let claim = claim(&mut db, &run.run_id, proof(&lease));
    let draft = draft(&db, &f, "replay", false);
    let finish = finish_input(&run, &claim, &lease, "candidate_ready", Some(&draft));
    let done = finish_chapter(&mut db, finish.clone()).unwrap();
    assert_eq!(done.run.status, "paused");
    assert_eq!(done.run.pause_reason.as_deref(), Some("review_required"));
    assert_eq!(
        done.decision.get("reason").and_then(Value::as_str),
        Some("quality_gate_passed_requires_user_confirmation")
    );
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
    assert_eq!(before_promote.status, "paused");
    assert_eq!(before_promote.state_revision, promote.expected_revision);
    assert_eq!(before_attempt.status, "candidate_ready");
    assert_eq!(
        before_attempt.candidate_draft_id.as_deref(),
        Some(promote.adopted_draft_id.as_str())
    );
    let mut without_confirmation = promote.clone();
    without_confirmation.user_confirmed = false;
    assert_eq!(
        promote_attempt(&mut db, without_confirmation)
            .unwrap_err()
            .code,
        codes::AUTONOMOUS_RUN_INPUT_INVALID
    );
    let promoted = promote_attempt(&mut db, promote.clone()).unwrap();
    assert!(!promoted.replayed);
    assert_eq!(promoted.run.status, "completed");
    assert_eq!(promoted.attempt.status, "adopted");
    assert!(promote_attempt(&mut db, promote.clone()).unwrap().replayed);
    let mut wrong_operation = promote;
    wrong_operation.operation_id = "promote-other".into();
    assert_eq!(
        promote_attempt(&mut db, wrong_operation).unwrap_err().code,
        codes::AUTONOMOUS_RUN_STATE_CONFLICT
    );
}

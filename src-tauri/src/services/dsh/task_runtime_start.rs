//! Single-stage DSH execution. The native root coordinator alone dispatches stages.
use super::*;

pub(super) fn start_stage(
    mut input: StartTaskTurnInput,
    notifier: Option<TaskProjectionObserver>,
) -> Result<TaskRuntimeResult, String> {
    required(&input.conversation_id, "conversationId")?;
    input.require_novel_id()?;
    required(&input.turn_id, "turnId")?;
    required(&input.goal, "goal")?;
    if !input.model_snapshot.is_object()
        || crate::services::ai_fact_security::contains_secret_value(&input.model_snapshot)
    {
        return Err("modelSnapshot 无效或包含凭据字段".to_string());
    }
    let book_word_goal = {
        let connection = crate::db::get_connection()
            .lock()
            .map_err(|_| "数据库锁失败".to_string())?;
        conversation_service::validate_task_runtime_scope(
            &connection,
            &input.conversation_id,
            &input.turn_id,
            input.require_novel_id()?,
            input.chapter_id.as_deref(),
        )
        .map_err(|error| error.to_string())?;
        retry::validate_retry(&connection, &input)?;
        revision_source::freeze_turn_revision(&connection, &mut input)
            .map_err(|error| error.to_string())?;
        word_target::validate(&connection, &input)?;
        chapter_continuity::freeze_continuity(&connection, &mut input)?;
        let book_word_goal = if input.task_kind == "story_plan_generate" {
            ai_task_service::authoritative_book_word_goal(&connection, &input.conversation_id)
                .map_err(|error| error.to_string())?
        } else {
            None
        };
        book_word_goal
    };
    input.book_word_goal = book_word_goal;
    validate_turn_contract(&input)?;
    if chapter_gate::is_admit(&input) {
        return chapter_gate::admit(input, notifier);
    }
    if let Some(runtime) = input
        .model_snapshot
        .get_mut("runtime")
        .and_then(Value::as_object_mut)
    {
        runtime.remove("toolCallingAttestation");
    }
    {
        let mut connection = crate::db::get_connection()
            .lock()
            .map_err(|_| "数据库锁失败".to_string())?;
        chapter_gate::fail_abandoned_withheld(&mut connection, &input.conversation_id)?;
    }
    let gated_budget = if is_chapter_writing_turn(&input) {
        Some(chapter_budget::bind_draft_attempt(&mut input)?)
    } else {
        None
    };
    let summary_session_scope = if input.task_kind == "chapter_summary" {
        let connection = crate::db::get_connection()
            .lock()
            .map_err(|_| "数据库锁失败".to_string())?;
        Some(summary_scope::resolve_session_scope(&connection, &input)?)
    } else {
        None
    };
    let mut run_id = if let Some(root) = input.execution.as_ref() {
        let connection = crate::db::get_connection()
            .lock()
            .map_err(|_| "数据库锁失败".to_string())?;
        if crate::repositories::conversation_repository::get_run(&connection, &root.root_run_id)
            .map_err(|e| e.to_string())?
            .is_none()
        {
            root.root_run_id.clone()
        } else {
            uuid::Uuid::new_v4().to_string()
        }
    } else {
        uuid::Uuid::new_v4().to_string()
    };
    let identity = large_text_repository::sha256(&input.conversation_id);
    let stable_worker_id = format!("worker-{}", &identity[..32]);
    let initial_session_id = task_session_id(&input, &run_id, summary_session_scope.as_ref());
    let cancel = input
        .execution
        .as_ref()
        .map(|root| root.cancel.clone())
        .unwrap_or_else(|| Arc::new(AtomicBool::new(false)));
    let (worker_id, process, projection) = {
        let mut workers = active()
            .lock()
            .map_err(|_| "Worker 状态锁失败".to_string())?;
        if let Some(worker) = workers.get_mut(&input.conversation_id) {
            if matches!(
                worker.status.as_str(),
                "attesting" | "queued" | "running" | "cancel_requested"
            ) && !Arc::ptr_eq(&worker.cancel, &cancel)
            {
                return Err("当前任务已有活动运行".to_string());
            }
            worker.run_id = run_id.clone();
            worker.cancel = cancel.clone();
            worker.status = "queued".to_string();
            worker.error = None;
            worker.notifier = notifier.clone();
            worker.session_id = initial_session_id.clone();
            (
                worker.worker_id.clone(),
                worker.process.clone(),
                worker.projection.clone(),
            )
        } else {
            let process = Arc::new(Mutex::new(None));
            let projection = Arc::new(Mutex::new(None));
            workers.insert(
                input.conversation_id.clone(),
                ActiveWorker {
                    run_id: run_id.clone(),
                    session_id: initial_session_id.clone(),
                    worker_id: stable_worker_id.clone(),
                    cancel: cancel.clone(),
                    process: process.clone(),
                    projection: projection.clone(),
                    notifier: notifier.clone(),
                    status: "queued".to_string(),
                    error: None,
                },
            );
            (stable_worker_id, process, projection)
        }
    };
    // No capability or connectivity probe. The actual request owns the model
    // outcome, after its Run exists and can retain an actionable dialogue error.
    let mut protocol_recovery_retry = 0usize;
    let mut chapter_recovery = if let Some(usage) = gated_budget {
        let mut recovery = ChapterLengthRecovery::new_with_remaining(&input, usage.remaining);
        recovery.seed(usage.calls, usage.length_repairs);
        recovery
    } else {
        ChapterLengthRecovery::new(&input)
    };
    let history_restored = (|| {
        let connection = crate::db::get_connection()
            .lock()
            .map_err(|_| "数据库锁失败".to_string())?;
        chapter_recovery.restore_history(&connection, &input)
    })();
    if let Err(error) = history_restored {
        update_active(&input.conversation_id, "idle", Some(error.clone()));
        return Err(error);
    }
    loop {
        let run_session_id = task_session_id(&input, &run_id, summary_session_scope.as_ref());
        let run_created = (|| {
            let mut workers = active()
                .lock()
                .map_err(|_| "Worker 状态锁失败".to_string())?;
            let worker = workers
                .get_mut(&input.conversation_id)
                .ok_or_else(|| "当前任务没有活动运行".to_string())?;
            if cancel.load(Ordering::SeqCst) || worker.status == "cancel_requested" {
                worker.status = "idle".to_string();
                worker.error = Some("DSH_TASK_CANCELLED".to_string());
                return Err("DSH_TASK_CANCELLED".to_string());
            }
            worker.run_id = run_id.clone();
            worker.session_id = run_session_id.clone();
            worker.error = None;
            let mut connection = crate::db::get_connection()
                .lock()
                .map_err(|_| "数据库锁失败".to_string())?;
            if let Some(root) = input.execution.as_ref() {
                root.check_stage(&connection, &input)?;
            }
            revision_source::freeze_turn_revision(&connection, &mut input)
                .map_err(|error| error.to_string())?;
            chapter_continuity::freeze_continuity(&connection, &mut input)?;
            revision_source::revalidate_frozen(&connection, &input).map_err(|e| e.to_string())?;
            let previous_terminal_runs =
                previous_terminal_run_count(&connection, &input.conversation_id, &input.turn_id)?;
            conversation_service::create_run(
                &mut connection,
                CreateRunInput {
                    run_id: run_id.clone(),
                    conversation_id: input.conversation_id.clone(),
                    turn_id: input.turn_id.clone(),
                    model_snapshot: input.model_snapshot.clone(),
                    worker_id: worker_id.clone(),
                    chapter_id: input.chapter_id.clone(),
                    created_at: now(),
                },
            )
            .map_err(|error| error.to_string())?;
            conversation_service::update_run(
                &mut connection,
                UpdateRunInput {
                    run_id: run_id.clone(),
                    status: "running".to_string(),
                    error: None,
                    updated_at: now(),
                    started_at: Some(now()),
                    finished_at: None,
                },
            )
            .map_err(|error| error.to_string())?;
            retry::record_contract(&mut connection, &input, &run_id)?;
            domain_entry::record_context(&mut connection, &input, &run_id)?;
            staged::begin(&mut connection, &input, &run_id)?;
            chapter_recovery.record_history_notice(&mut connection, &input, &run_id)?;
            worker.status = "running".to_string();
            Ok::<usize, String>(previous_terminal_runs)
        })();
        let previous_terminal_runs = match run_created {
            Ok(count) => count,
            Err(error) => {
                update_active(&input.conversation_id, "idle", Some(error.clone()));
                return Err(error);
            }
        };
        notify_projection(notifier.as_ref(), &input.conversation_id, &run_id, "run")?;
        let result = (|| {
            let connection = crate::db::get_connection()
                .lock()
                .map_err(|_| "数据库锁失败".to_string())?;
            coordinator::validate_assets(&connection, &input)
        })()
        .and_then(|_| ensure_worker_process(&input, &worker_id, &process, projection.clone()))
        .and_then(|worker_process| {
            execute(
                input.clone(),
                run_id.clone(),
                worker_id.clone(),
                run_session_id,
                worker_process,
                projection.clone(),
                cancel.clone(),
                notifier.clone(),
                None,
                protocol_recovery_retry,
                previous_terminal_runs,
                &mut chapter_recovery,
            )
        });
        let raw_error = match result {
            Ok(outcome) => {
                update_active(
                    &input.conversation_id,
                    if input.execution.is_some() {
                        "queued"
                    } else {
                        "idle"
                    },
                    None,
                );
                return Ok(outcome);
            }
            Err(raw_error) => raw_error,
        };
        if chapter_recovery
            .remaining_at(std::time::Instant::now())
            .is_zero()
        {
            if let Ok(holder) = process.lock() {
                if let Some(worker_process) = holder.as_ref() {
                    worker_process.runtime.kill();
                }
            }
        }
        let error = runtime_error_for_persistence(&raw_error);
        let cancelled = active()
            .lock()
            .ok()
            .and_then(|workers| {
                workers
                    .get(&input.conversation_id)
                    .map(|worker| worker.cancel.load(Ordering::SeqCst))
            })
            .unwrap_or(false);
        let process_healthy = process
            .lock()
            .ok()
            .and_then(|holder| holder.as_ref().cloned())
            .is_some_and(|process| {
                chapter_recovery
                    .timeout(Duration::from_secs(3), &cancel)
                    .ok()
                    .is_some_and(|timeout| {
                        process
                            .runtime
                            .request("runtime/health", None, timeout)
                            .is_ok()
                    })
            });
        let recovery_candidate = !cancelled
            && process_healthy
            && is_automatic_protocol_recovery_candidate(&input, &raw_error);
        let terminal_status = if cancelled { "cancelled" } else { "failed" };
        let mut next_protocol_recovery_retry = None;
        let mut next_chapter_length_repair = false;
        if let Ok(mut connection) = crate::db::get_connection().lock() {
            let finished_at = now();
            let tools_terminalized = conversation_service::terminalize_open_tool_events(
                &mut connection,
                &run_id,
                if cancelled { "cancelled" } else { "failed" },
                if cancelled {
                    "DSH Worker 已取消，工具调用未完成。"
                } else {
                    "DSH Worker 故障，工具调用未完成。"
                },
                &finished_at,
            )
            .is_ok();
            let run_terminalized = conversation_service::update_run(
                &mut connection,
                UpdateRunInput {
                    run_id: run_id.clone(),
                    status: terminal_status.to_string(),
                    error: Some(error.clone()),
                    updated_at: finished_at.clone(),
                    started_at: None,
                    finished_at: Some(finished_at.clone()),
                },
            )
            .is_ok();
            if recovery_candidate && tools_terminalized && run_terminalized {
                next_protocol_recovery_retry =
                    automatic_protocol_recovery_retry_number(&connection, &input, &raw_error)
                        .ok()
                        .flatten();
            }
            if tools_terminalized && run_terminalized {
                staged::finish_failed(&mut connection, &input, &run_id)?;
                next_chapter_length_repair =
                    chapter_recovery.try_repair(&input, &raw_error, cancelled, process_healthy);
            }
            let failure_turn_id = stable_projection_id(
                "dsh-message",
                &run_id,
                if cancelled {
                    "assistant:cancelled"
                } else {
                    "assistant:failed"
                },
            );
            let failure_message = if cancelled {
                "任务已取消。".to_string()
            } else if let Some(message) =
                chapter_recovery.failure_message(&error, next_chapter_length_repair)
            {
                message
            } else if let Some(retry_number) = next_protocol_recovery_retry {
                format!(
                    "任务运行失败：{}。检测到可恢复的自动总结运行错误，正在使用同一回合与冻结模型自动重试（{}/{}）。",
                    error,
                    retry_number,
                    MAX_AUTOMATIC_PROTOCOL_RECOVERY_RETRIES
                )
            } else {
                format!("任务运行失败：{}", error)
            };
            let _ = conversation_service::append_runtime_assistant_turn(
                &mut connection,
                &failure_turn_id,
                &input.conversation_id,
                &run_id,
                &failure_message,
                &finished_at,
            );
        }
        let _ = notify_projection(
            notifier.as_ref(),
            &input.conversation_id,
            &run_id,
            "terminal",
        );
        if let Ok(mut target) = projection.lock() {
            *target = None;
        }
        if !process_healthy {
            if let Ok(mut holder) = process.lock() {
                if let Some(dead) = holder.take() {
                    dead.runtime.kill();
                }
            }
        }
        if next_chapter_length_repair {
            if let Some(root) = input.execution.as_mut() {
                root.parent_run_id = Some(run_id.clone());
                root.revision_depth = root.revision_depth.saturating_add(1);
            }
            run_id = uuid::Uuid::new_v4().to_string();
            continue;
        }
        if let Some(retry_number) = next_protocol_recovery_retry {
            protocol_recovery_retry = retry_number;
            if let Some(root) = input.execution.as_mut() {
                root.parent_run_id = Some(run_id.clone());
                root.revision_depth = root.revision_depth.saturating_add(1);
            }
            run_id = uuid::Uuid::new_v4().to_string();
            continue;
        }
        update_active(&input.conversation_id, "idle", Some(error.clone()));
        return Err(error);
    }
}

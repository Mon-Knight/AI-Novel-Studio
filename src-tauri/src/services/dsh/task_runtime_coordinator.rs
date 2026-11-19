//! The sole desktop task lifecycle. Model results can request a bounded stage;
//! only this native coordinator validates and dispatches that stage.
use super::*;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UnifiedRuntimeInput {
    pub version: u32,
    pub local_command: Option<dispatch::LocalCommand>,
    pub writing_preferences: Option<dispatch::WritingPreferences>,
    pub(crate) entry: Option<domain_entry::DomainEntryInput>,
}

#[path = "task_runtime_dispatch.rs"]
pub(super) mod dispatch;
pub(super) use dispatch::validate_assets;
#[path = "task_runtime_integrity.rs"]
pub(super) mod integrity;

static ROOTS: OnceLock<Mutex<HashMap<String, execution::RootExecution>>> = OnceLock::new();
struct RootGuard {
    conversation_id: String,
}
impl Drop for RootGuard {
    fn drop(&mut self) {
        if let Ok(mut roots) = ROOTS.get_or_init(Default::default).lock() {
            if let Some(root) = roots.remove(&self.conversation_id) {
                root.dispatch_enabled.store(false, Ordering::SeqCst);
            }
        }
        if let Ok(mut workers) = active().lock() {
            if let Some(worker) = workers.get_mut(&self.conversation_id) {
                worker.status = "idle".into();
            }
        }
    }
}
pub(super) fn request_cancel(conversation_id: &str) -> bool {
    let Ok(roots) = ROOTS.get_or_init(Default::default).lock() else {
        return false;
    };
    let Some(cancel) = roots.get(conversation_id) else {
        return false;
    };
    cancel.cancel.store(true, Ordering::SeqCst);
    true
}

pub fn start_with_observer(
    mut input: StartTaskTurnInput,
    notifier: Option<TaskProjectionObserver>,
) -> Result<TaskRuntimeResult, String> {
    required(&input.conversation_id, "conversationId")?;
    required(&input.turn_id, "turnId")?;
    required(&input.goal, "goal")?;
    if input
        .unified_runtime
        .as_ref()
        .is_some_and(|u| u.version != 1)
    {
        return Err("DSH_UNIFIED_RUNTIME_VERSION_UNSUPPORTED".into());
    }
    if !input.model_snapshot.is_object()
        || crate::services::ai_fact_security::contains_secret_value(&input.model_snapshot)
    {
        return Err("modelSnapshot 无效或包含凭据字段".into());
    }
    let root = {
        let mut connection = crate::db::get_connection()
            .lock()
            .map_err(|_| "数据库锁失败".to_string())?;
        task_scope::validate(&connection, &mut input)?;
        if input.novel_id.is_some() {
            revision_source::freeze_turn_revision(&connection, &mut input)
                .map_err(|e| e.to_string())?;
        }
        if let Some(existing) = followup::existing(&input)? {
            return Ok(existing);
        }
        if let Some(old_root) = followup::supersede(&input.conversation_id, &input.turn_id) {
            crate::services::task_authorization_service::revoke_for_root(
                &connection,
                &input.conversation_id,
                &old_root,
                "新的独立用户目标替代上一待处理目标",
            )
            .map_err(|e| e.to_string())?;
        }
        execution::RootExecution::new(&connection, &input)?
    };
    {
        let mut roots = ROOTS
            .get_or_init(Default::default)
            .lock()
            .map_err(|_| "DSH_ROOT_LOCK_FAILED".to_string())?;
        if roots.contains_key(&input.conversation_id) {
            return Err("当前任务已有活动运行".into());
        }
        root.dispatch_enabled.store(true, Ordering::SeqCst);
        roots.insert(input.conversation_id.clone(), root.clone());
    }
    let _guard = RootGuard {
        conversation_id: input.conversation_id.clone(),
    };
    input.execution = Some(root.clone());
    if input
        .unified_runtime
        .as_ref()
        .and_then(|u| u.local_command.as_ref())
        .is_some()
    {
        let result = dispatch::local_command(input.clone(), notifier);
        if result.is_ok() {
            let connection = crate::db::get_connection()
                .lock()
                .map_err(|_| "数据库锁失败".to_string())?;
            crate::services::task_authorization_service::revoke_for_root(
                &connection,
                &input.conversation_id,
                &root.root_turn_id,
                "本地设置任务已结束",
            )
            .map_err(|e| e.to_string())?;
        }
        return result;
    }
    if chapter_gate::is_admit(&input) {
        return Err("DSH_CHAPTER_ADMISSION_NATIVE_ONLY".into());
    }
    execute_root(input, notifier)
}

fn run_root(
    mut input: StartTaskTurnInput,
    notifier: Option<TaskProjectionObserver>,
) -> Result<TaskRuntimeResult, String> {
    let original_chapter = input.chapter_id.clone();
    let mut parent_run = input.retry_source_run_id.clone().or_else(|| {
        input
            .execution
            .as_ref()
            .and_then(|e| e.parent_run_id.clone())
    });
    let mut repairs = 0i64;
    loop {
        let mut root = input.execution.clone().ok_or("DSH_ROOT_CONTRACT_MISSING")?;
        root.check()?;
        root.parent_run_id = parent_run.clone();
        root.phase = input.task_kind.clone();
        input.execution = Some(root.clone());
        {
            let connection = crate::db::get_connection()
                .lock()
                .map_err(|_| "数据库锁失败".to_string())?;
            root.check_stage(&connection, &input)?;
            if is_chapter_writing_turn(&input) {
                if domain_entry::entry(&input).is_some()
                    && domain_entry::admission_policy(&input).is_none()
                {
                    return Err("DOMAIN_REVIEW_POLICY_REQUIRED".into());
                }
                dispatch::prepare_writing(&connection, &mut input)?;
                chapter_continuity::freeze_continuity(&connection, &mut input)?;
            }
            staged::prepare(&connection, &mut input)?;
            if let Some(execution) = input.execution.as_mut() {
                execution.phase = input.task_kind.clone();
            }
        }
        let mut outcome = if input.task_kind == "domain_readiness" || staged::is_local(&input) {
            local_domain(&input, notifier.clone())?
        } else {
            stage_start::start_stage(input.clone(), notifier.clone())?
        };
        root.check()?;
        {
            let mut connection = crate::db::get_connection()
                .lock()
                .map_err(|_| "数据库锁失败".to_string())?;
            staged::after_result(&mut connection, &mut input, &mut outcome)?;
            if let Some(mut next) = staged::next_stage(&connection, &input, &outcome)? {
                let mut execution = next.execution.take().ok_or("DSH_ROOT_CONTRACT_MISSING")?;
                execution.parent_run_id = Some(outcome.run.run_id.clone());
                next.execution = Some(execution);
                parent_run = Some(outcome.run.run_id);
                input = next;
                continue;
            }
        }
        if let Some(action) = outcome.planned_action.take() {
            if input.task_kind != "creative_dialogue" {
                return Err("DSH_PHASE_TRANSITION_INVALID".into());
            }
            let connection = crate::db::get_connection()
                .lock()
                .map_err(|_| "数据库锁失败".to_string())?;
            let persisted = creative_dialogue::read_persisted_action(
                &connection,
                input.require_novel_id()?,
                &outcome.run.run_id,
            )?;
            if persisted.as_ref() != Some(&action) {
                return Err("DSH_PHASE_TRANSITION_UNVERIFIED".into());
            }
            let mut next = dispatch::from_action(&input, &action, original_chapter.as_deref())?;
            let mut child = root.clone();
            child.parent_run_id = Some(outcome.run.run_id.clone());
            child.planned_instruction = Some(action.instruction);
            next.execution = Some(child);
            parent_run = Some(outcome.run.run_id);
            input = next;
            continue;
        }
        if let Some(pending) = outcome.pending_chapter_candidate.take() {
            let issues = integrity::inspect(Some(&root), &pending)?;
            let errors: Vec<_> = issues.iter().filter(|i| i.severity == "error").collect();
            if !errors.is_empty() {
                terminalize_withheld(
                    &input,
                    &pending.run_id,
                    "DSH_CHAPTER_INTEGRITY_ERROR_WITHHELD",
                )?;
                if repairs >= root.max_revisions {
                    return Err("DSH_ROOT_REVISION_BUDGET_EXHAUSTED".into());
                }
                repairs += 1;
                if let Some(execution) = input.execution.as_mut() {
                    execution.revision_depth = execution.revision_depth.saturating_add(1);
                }
                input.retry_source_run_id = None;
                input.chapter_host_gate = Some(chapter_gate::ChapterHostGate {
                    phase: "draft".into(),
                    source_run_id: None,
                    content_hash: None,
                    issue_codes: errors.iter().map(|i| i.code.clone()).collect(),
                    issue_severities: errors.iter().map(|_| "error".into()).collect(),
                    max_integrity_repairs: Some(2),
                    continues_run_id: Some(pending.run_id.clone()),
                    explicit_retry: false,
                });
                parent_run = Some(pending.run_id);
                continue;
            }
            root.check()?;
            input.chapter_host_gate = Some(chapter_gate::ChapterHostGate {
                phase: "admit".into(),
                source_run_id: Some(pending.run_id),
                content_hash: Some(pending.content_hash),
                issue_codes: issues.iter().map(|i| i.code.clone()).collect(),
                issue_severities: issues.iter().map(|i| i.severity.clone()).collect(),
                max_integrity_repairs: Some(2),
                continues_run_id: None,
                explicit_retry: false,
            });
            let mut connection = crate::db::get_connection()
                .lock()
                .map_err(|_| "数据库锁失败".to_string())?;
            outcome =
                chapter_gate::admit_connection(&mut connection, input.clone(), notifier.clone())?;
            admission::record(&mut connection, &input, &outcome, &issues)?;
        }
        {
            let mut connection = crate::db::get_connection()
                .lock()
                .map_err(|_| "数据库锁失败".to_string())?;
            domain_entry::after_candidate(&mut connection, &input, &outcome)?;
            if let Some(mut next) = domain_entry::next_stage(&mut connection, &input, &outcome)? {
                if next.conversation_id != input.conversation_id
                    || next.turn_id != input.turn_id
                    || next.novel_id != input.novel_id
                    || retry::model_identity(&next.model_snapshot)
                        != retry::model_identity(&input.model_snapshot)
                {
                    return Err("DSH_CHILD_SCOPE_EXPANSION".into());
                }
                next.execution = input.execution.clone();
                parent_run = Some(outcome.run.run_id);
                input = next;
                continue;
            }
        }
        {
            let connection = crate::db::get_connection()
                .lock()
                .map_err(|_| "数据库锁失败".to_string())?;
            if let Some((card, artifact)) =
                domain_entry::application_candidate(&connection, &input, &outcome)?
            {
                let run_id:String=connection.query_row("SELECT run_id FROM conversation_artifact_cards WHERE card_id=?1 AND artifact_id=?2 AND conversation_id=?3",rusqlite::params![card,artifact,input.conversation_id],|r|r.get(0)).map_err(|e|e.to_string())?;
                outcome.run =
                    crate::repositories::conversation_repository::get_run(&connection, &run_id)
                        .map_err(|e| e.to_string())?
                        .ok_or("DOMAIN_BODY_RUN_MISSING")?;
                outcome.artifact_id = Some(artifact);
            }
        }
        if let Some(mut next) = followup::candidate_ready(&input, &outcome, notifier.clone())? {
            {
                let mut connection = crate::db::get_connection()
                    .lock()
                    .map_err(|_| "数据库锁失败".to_string())?;
                domain_entry::prepare(&mut connection, &mut next)?;
            }
            let mut execution = next.execution.take().ok_or("DSH_ROOT_CONTRACT_MISSING")?;
            execution.parent_run_id = Some(outcome.run.run_id.clone());
            next.execution = Some(execution);
            parent_run = Some(outcome.run.run_id);
            input = next;
            continue;
        }
        return Ok(outcome);
    }
}

fn terminalize_withheld(
    input: &StartTaskTurnInput,
    run_id: &str,
    error: &str,
) -> Result<(), String> {
    let mut connection = crate::db::get_connection()
        .lock()
        .map_err(|_| "数据库锁失败".to_string())?;
    conversation_service::update_run(
        &mut connection,
        UpdateRunInput {
            run_id: run_id.into(),
            status: "failed".into(),
            error: Some(error.into()),
            updated_at: now(),
            started_at: None,
            finished_at: Some(now()),
        },
    )
    .map_err(|e| e.to_string())?;
    let _ = notify_projection(None, &input.conversation_id, run_id, "terminal");
    Ok(())
}

#[path = "task_runtime_local.rs"]
mod local;
use local::local_domain;

pub(super) fn resume(
    input: StartTaskTurnInput,
    notifier: Option<TaskProjectionObserver>,
) -> Result<TaskRuntimeResult, String> {
    let root = input
        .execution
        .as_ref()
        .ok_or("DSH_ROOT_CONTRACT_MISSING")?;
    root.check()?;
    {
        let mut roots = ROOTS
            .get_or_init(Default::default)
            .lock()
            .map_err(|_| "DSH_ROOT_LOCK_FAILED")?;
        if roots.contains_key(&input.conversation_id) {
            return Err("当前任务已有活动运行".into());
        }
        root.dispatch_enabled.store(true, Ordering::SeqCst);
        roots.insert(input.conversation_id.clone(), root.clone());
    }
    let _guard = RootGuard {
        conversation_id: input.conversation_id.clone(),
    };
    execute_root(input, notifier)
}

#[cfg(test)]
#[path = "task_runtime_unified_tests.rs"]
mod unified_tests;

pub(super) fn root_status(conversation_id: &str) -> Option<TaskRuntimeStatus> {
    let roots = ROOTS.get_or_init(Default::default).lock().ok()?;
    let root = roots.get(conversation_id)?;
    Some(TaskRuntimeStatus {
        conversation_id: conversation_id.into(),
        run_id: root.root_run_id.clone(),
        session_id: format!("root:{}", root.root_run_id),
        worker_id: format!("root:{}", root.root_run_id),
        status: if root.cancel.load(Ordering::SeqCst) {
            "cancel_requested"
        } else {
            "running"
        }
        .into(),
        runtime: "dsh-headless-persistent".into(),
        error: None,
    })
}
pub(super) fn root_statuses() -> Vec<TaskRuntimeStatus> {
    let ids = ROOTS
        .get_or_init(Default::default)
        .lock()
        .map(|r| r.keys().cloned().collect::<Vec<_>>())
        .unwrap_or_default();
    ids.iter().filter_map(|id| root_status(id)).collect()
}

fn execute_root(
    mut input: StartTaskTurnInput,
    notifier: Option<TaskProjectionObserver>,
) -> Result<TaskRuntimeResult, String> {
    let result = (|| {
        {
            let mut connection = crate::db::get_connection()
                .lock()
                .map_err(|_| "数据库锁失败".to_string())?;
            if input.novel_id.is_some() {
                domain_entry::prepare(&mut connection, &mut input)?;
            }
        }
        run_root(input.clone(), notifier.clone())
    })();
    if let Err(error) = &result {
        let mut connection = crate::db::get_connection()
            .lock()
            .map_err(|_| "数据库锁失败".to_string())?;
        root_stop::record_stop(&mut connection, &input, error)?;
        followup::mark_stopped(&input.conversation_id, error);
        domain_entry::cleanup(&mut connection, &input, error)?;
        let root = input
            .execution
            .as_ref()
            .ok_or("DSH_ROOT_CONTRACT_MISSING")?;
        crate::services::task_authorization_service::revoke_for_root(
            &connection,
            &input.conversation_id,
            &root.root_turn_id,
            "根任务已停止，后续授权失效",
        )
        .map_err(|e| e.to_string())?;
        update_active(
            &input.conversation_id,
            "idle",
            Some(safe_runtime_error(error)),
        );
        drop(connection);
        notify_projection(
            notifier.as_ref(),
            &input.conversation_id,
            &root.root_run_id,
            "terminal",
        )?;
    }
    if result.is_ok() {
        let root = input
            .execution
            .as_ref()
            .ok_or("DSH_ROOT_CONTRACT_MISSING")?;
        if !followup::has_pending(&input.conversation_id, &root.root_turn_id) {
            let connection = crate::db::get_connection()
                .lock()
                .map_err(|_| "数据库锁失败".to_string())?;
            crate::services::task_authorization_service::revoke_for_root(
                &connection,
                &input.conversation_id,
                &root.root_turn_id,
                "根任务已完成，未留下待决定权限",
            )
            .map_err(|e| e.to_string())?;
        }
    }
    result
}

//! Host-owned root execution identity, inherited cancellation and finite budgets.
//! Durable Run/ToolCallEvent/request facts remain the only lifecycle ledger.
use super::*;
use std::time::Instant;

pub(super) const MAX_REQUESTS: i64 = 24;
pub(super) const MAX_TOOLS: i64 = 64;
pub(super) const MAX_STAGES: i64 = 8;
pub(super) const MAX_REVISIONS: i64 = 2;
pub(super) const MAX_TOKENS: i64 = 256_000;
pub(super) const MAX_COST_USD: f64 = 5.0;
pub(super) const MAX_WALL_MS: i64 = 900_000;

#[derive(Debug, Clone)]
pub(crate) struct RootExecution {
    pub root_run_id: String,
    pub scope: TaskScope,
    pub internal_revision: Option<VerifiedRevisionSource>,
    pub(super) staged: Option<staged::StagedContext>,
    pub(super) writing_range: Option<ChapterWordRangeInput>,
    pub max_stages: i64,
    pub conversation_id: String,
    pub transport_epoch: String,
    pub root_turn_id: String,
    pub max_requests: i64,
    pub max_tools: i64,
    pub max_revisions: i64,
    pub revision_depth: i64,
    pub max_wall_ms: i64,
    pub parent_run_id: Option<String>,
    pub budget_epoch: String,
    pub owner_id: String,
    pub phase: String,
    pub planned_instruction: Option<String>,
    pub cancel: Arc<AtomicBool>,
    pub dispatch_enabled: Arc<AtomicBool>,
    pub started: Instant,
    pub restored_elapsed_ms: i64,
    pub started_at_ms: i64,
    pub(super) baselines: Arc<HashMap<String, ChapterBaseSnapshot>>,
    pub model_identity: Value,
    pub max_cost_usd: f64,
    pub max_tokens: i64,
}

impl RootExecution {
    pub fn new(
        connection: &rusqlite::Connection,
        input: &StartTaskTurnInput,
    ) -> Result<Self, String> {
        Self::new_inner(connection, input, true)
    }

    /// Reconstruct immutable generation facts for a later read-only application
    /// gate. A revoked/expired automatic grant must not invalidate manual review,
    /// and no dispatch budget or authorization is renewed by this constructor.
    pub fn for_application(
        connection: &rusqlite::Connection,
        input: &StartTaskTurnInput,
    ) -> Result<Self, String> {
        Self::new_inner(connection, input, false)
    }

    fn new_inner(
        connection: &rusqlite::Connection,
        input: &StartTaskTurnInput,
        require_active_authority: bool,
    ) -> Result<Self, String> {
        let scope = task_scope::from_input(input)?;
        let mut prior = connection.prepare(
            "SELECT e.arguments_summary_json FROM tool_call_events e JOIN task_runs r ON r.run_id=e.run_id
             WHERE r.conversation_id=?1 AND r.turn_id=?2 AND e.tool_name='dsh.execution_contract'
             ORDER BY r.created_at,e.sequence LIMIT 1",
        ).map_err(|e| e.to_string())?;
        let previous: Option<String> = prior
            .query_row(
                rusqlite::params![input.conversation_id, input.turn_id],
                |r| r.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?;
        let metadata = previous
            .as_deref()
            .map(serde_json::from_str::<Value>)
            .transpose()
            .map_err(|_| "DSH_ROOT_CONTRACT_UNREADABLE".to_string())?;
        let lineage = metadata.as_ref().and_then(|v| v.get("execution"));
        if metadata.is_some() && !lineage.is_some_and(Value::is_object) {
            return Err("DSH_ROOT_LEGACY_CONTRACT_REQUIRES_NEW_GOAL".into());
        }
        let root_run_id = lineage
            .and_then(|v| v.get("rootRunId"))
            .and_then(Value::as_str)
            .map(str::to_string)
            .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
        let started_at_ms = lineage
            .and_then(|v| v.get("startedAtMs"))
            .and_then(Value::as_i64)
            .unwrap_or_else(|| Utc::now().timestamp_millis());
        let baselines = match lineage.and_then(|v| v.get("chapterBaselines")) {
            Some(value) => serde_json::from_value(value.clone())
                .map_err(|_| "DSH_ROOT_BASELINE_UNREADABLE".to_string())?,
            None => {
                if let Some(novel) = scope.novel_id() {
                    freeze_baselines(connection, novel)?
                } else {
                    HashMap::new()
                }
            }
        };
        let owner_hash =
            large_text_repository::sha256(&format!("{}:{}", input.conversation_id, input.turn_id));
        let max_cost_usd = input
            .request_policy
            .daily_cost_budget_usd
            .unwrap_or(MAX_COST_USD)
            .min(MAX_COST_USD);
        let max_tokens = input
            .request_policy
            .daily_token_budget
            .unwrap_or(MAX_TOKENS)
            .min(MAX_TOKENS);
        if max_tokens <= 0 || !max_cost_usd.is_finite() || max_cost_usd <= 0.0 {
            return Err("DSH_ROOT_BUDGET_INVALID".into());
        }
        let grant = if !require_active_authority || scope.is_library() {
            None
        } else {
            crate::services::task_authorization_service::execution_authorization(
                connection,
                &input.conversation_id,
                &input.turn_id,
                &input.model_snapshot,
            )
            .map_err(|e| e.to_string())?
        };
        let budget = grant.as_ref().map(|g| &g.spec.budget);
        let previous_revision:i64=connection.query_row("SELECT COALESCE(MAX(json_extract(e.arguments_summary_json,'$.execution.revision')),0) FROM tool_call_events e JOIN task_runs r ON r.run_id=e.run_id WHERE r.conversation_id=?1 AND r.turn_id=?2 AND e.tool_name='dsh.execution_contract'",rusqlite::params![input.conversation_id,input.turn_id],|r|r.get(0)).map_err(|e|e.to_string())?;
        let staged_bounds = if !require_active_authority || scope.is_library() {
            None
        } else {
            initial_staged_bounds(connection, input, &baselines)?
        };
        let domain = input
            .unified_runtime
            .as_ref()
            .and_then(|u| u.entry.as_ref())
            .is_some();
        let default_stages = staged_bounds
            .as_ref()
            .map(|b| b.stages)
            .unwrap_or(if domain { 64 } else { MAX_STAGES });
        let default_requests = staged_bounds
            .as_ref()
            .map(|b| b.requests)
            .unwrap_or(if domain { 192 } else { MAX_REQUESTS });
        let default_tools = staged_bounds
            .as_ref()
            .map(|b| b.tools)
            .unwrap_or(if domain { 512 } else { MAX_TOOLS });
        let ceiling = |key: &str, fallback: i64| {
            lineage
                .and_then(|v| v.pointer(&format!("/limits/{key}")))
                .and_then(Value::as_i64)
                .filter(|v| *v > 0)
                .map_or(fallback, |v| v.min(fallback))
        };
        let max_stages = ceiling("stages", default_stages).min(64);
        let max_requests = ceiling("requests", default_requests).min(192);
        let max_tools = ceiling("tools", default_tools).min(512);
        let restored_range = if let Some(range) = input.chapter_word_range.clone() {
            Some(range)
        } else {
            let stored:Option<(String,String)>=connection.query_row("SELECT json_extract(e.arguments_summary_json,'$.execution.writingRange'),r.model_snapshot_json FROM tool_call_events e JOIN task_runs r ON r.run_id=e.run_id WHERE r.conversation_id=?1 AND json_extract(e.arguments_summary_json,'$.execution.rootRunId')=?2 AND json_extract(e.arguments_summary_json,'$.execution.rootTurnId')=?3 AND e.tool_name='dsh.execution_contract' AND json_type(e.arguments_summary_json,'$.execution.writingRange')='object' AND r.chapter_id IS ?4 ORDER BY r.created_at DESC,e.sequence DESC LIMIT 1",rusqlite::params![input.conversation_id,root_run_id,input.turn_id,input.chapter_id],|r|Ok((r.get(0)?,r.get(1)?))).optional().map_err(|e|e.to_string())?;
            if let Some((range, model)) = stored {
                let model: Value =
                    serde_json::from_str(&model).map_err(|_| "DSH_ROOT_RANGE_SOURCE_INVALID")?;
                if retry::model_identity(&model) != retry::model_identity(&input.model_snapshot) {
                    return Err("DSH_ROOT_MODEL_CHANGED".into());
                }
                Some(serde_json::from_str(&range).map_err(|_| "DSH_ROOT_RANGE_SOURCE_INVALID")?)
            } else {
                None
            }
        };
        Ok(Self {
            scope,
            transport_epoch: uuid::Uuid::new_v4().to_string(),
            conversation_id: input.conversation_id.clone(),
            root_turn_id: input.turn_id.clone(),
            max_requests: budget.map_or(max_requests, |b| b.max_requests.min(max_requests)),
            max_tools: budget.map_or(max_tools, |b| b.max_tool_calls.min(max_tools)),
            revision_depth: previous_revision
                .saturating_add(i64::from(input.retry_source_run_id.is_some())),
            max_revisions: budget.map_or(MAX_REVISIONS, |b| b.max_revisions.min(MAX_REVISIONS)),
            max_wall_ms: budget.map_or(MAX_WALL_MS, |b| b.max_wall_clock_ms.min(MAX_WALL_MS)),
            root_run_id,
            internal_revision: None,
            staged: None,
            writing_range: restored_range,
            max_stages,
            parent_run_id: None,
            budget_epoch: format!("turn:{}", input.turn_id),
            owner_id: format!("dsh-root:{}", &owner_hash[..40]),
            phase: input.task_kind.clone(),
            planned_instruction: None,
            cancel: Arc::new(AtomicBool::new(false)),
            dispatch_enabled: Arc::new(AtomicBool::new(false)),
            started: Instant::now(),
            restored_elapsed_ms: Utc::now()
                .timestamp_millis()
                .checked_sub(started_at_ms)
                .filter(|v| *v >= 0)
                .ok_or("DSH_ROOT_CLOCK_INVALID")?,
            started_at_ms,
            baselines: Arc::new(baselines),
            model_identity: retry::model_identity(&input.model_snapshot),
            max_cost_usd: budget.map_or(max_cost_usd, |b| b.max_cost_usd.min(max_cost_usd)),
            max_tokens: budget.map_or(max_tokens, |b| b.max_tokens.min(max_tokens)),
        })
    }

    pub fn check_dispatch(&self) -> Result<(), String> {
        self.check()?;
        if !self.dispatch_enabled.load(Ordering::SeqCst) {
            return Err("DSH_ROOT_NOT_EXECUTING".into());
        }
        Ok(())
    }
    pub fn check(&self) -> Result<(), String> {
        if self.cancel.load(Ordering::SeqCst) {
            return Err("DSH_TASK_CANCELLED".into());
        }
        if self.elapsed_ms()? >= self.max_wall_ms {
            return Err("DSH_ROOT_WALL_BUDGET_EXHAUSTED".into());
        }
        Ok(())
    }

    fn elapsed_ms(&self) -> Result<i64, String> {
        let wall = Utc::now()
            .timestamp_millis()
            .checked_sub(self.started_at_ms)
            .filter(|v| *v >= 0)
            .ok_or("DSH_ROOT_CLOCK_INVALID")?;
        Ok(wall.max(
            self.restored_elapsed_ms.saturating_add(
                i64::try_from(self.started.elapsed().as_millis()).unwrap_or(i64::MAX),
            ),
        ))
    }
    pub fn timeout(&self, cap: Duration) -> Result<Duration, String> {
        self.check()?;
        let remaining = self.max_wall_ms.saturating_sub(self.elapsed_ms()?);
        Ok(cap.min(Duration::from_millis(remaining.max(1) as u64)))
    }

    fn scope_metadata(&self, input: &StartTaskTurnInput) -> Value {
        let mut value = json!(&self.scope);
        if self.scope.novel_id().is_some() {
            value["chapterId"] = json!(input.chapter_id);
        }
        value
    }
    pub fn metadata(&self, input: &StartTaskTurnInput) -> Value {
        json!({"version":1,"rootTaskId":input.conversation_id,"rootRunId":self.root_run_id,"rootTurnId":self.root_turn_id,
            "parentRunId":self.parent_run_id,"revision":self.revision_depth,"internalRevision":self.internal_revision.as_ref().map(|v|&v.source),"requiresDomainPolicy":domain_entry::entry(input).is_some(),"domainPolicy":domain_entry::admission_policy(input),"phase":self.phase,"scope":self.scope_metadata(input),
            "budgetEpoch":self.budget_epoch,"startedAtMs":self.started_at_ms,"chapterBaselines":self.baselines.as_ref(),"writingRange":self.writing_range,
            "limits":{"requests":self.max_requests,"tools":self.max_tools,"stages":self.max_stages,"revisions":self.max_revisions,
                "tokens":self.max_tokens,"costUsd":self.max_cost_usd,"wallMs":self.max_wall_ms},
            "formalWriteAuthority":false,"contextIsolation":"stage-session"})
    }

    pub fn check_stage(
        &self,
        connection: &rusqlite::Connection,
        input: &StartTaskTurnInput,
    ) -> Result<(), String> {
        self.check()?;
        if task_scope::from_input(input)? != self.scope {
            return Err("DSH_CHILD_SCOPE_EXPANSION".into());
        }
        if retry::model_identity(&input.model_snapshot) != self.model_identity {
            return Err("DSH_ROOT_MODEL_CHANGED: 子任务不能更换冻结模型".into());
        }
        let (stages, tools): (i64,i64) = connection.query_row(
            "SELECT COUNT(DISTINCT r.run_id),COUNT(e.event_id) FROM task_runs r LEFT JOIN tool_call_events e
             ON e.run_id=r.run_id AND e.tool_name NOT LIKE 'dsh.%' WHERE r.conversation_id=?1 AND r.turn_id=?2",
            rusqlite::params![input.conversation_id,input.turn_id], |r|Ok((r.get(0)?,r.get(1)?)),
        ).map_err(|e|e.to_string())?;
        if stages >= self.max_stages {
            return Err("DSH_ROOT_STAGE_BUDGET_EXHAUSTED".into());
        }
        if tools >= self.max_tools {
            return Err("DSH_ROOT_TOOL_BUDGET_EXHAUSTED".into());
        }
        Ok(())
    }

    pub(super) fn baseline(
        &self,
        connection: &rusqlite::Connection,
        novel: &str,
        chapter: &str,
    ) -> Result<ChapterBaseSnapshot, AppError> {
        let frozen = self.baselines.get(chapter).ok_or_else(|| {
            AppError::new(
                "DSH_ROOT_SCOPE_CHANGED",
                "目标章节不在任务冻结范围内",
                false,
            )
        })?;
        let current = read_chapter_base_snapshot(connection, novel, chapter)?;
        if frozen != &current {
            return Err(AppError::new(
                "DSH_ROOT_BASELINE_CHANGED",
                "任务期间章节正文或版本已变化，停止创建候选并转人工处理",
                false,
            ));
        }
        Ok(frozen.clone())
    }
}

fn freeze_baselines(
    connection: &rusqlite::Connection,
    novel: &str,
) -> Result<HashMap<String, ChapterBaseSnapshot>, String> {
    let mut statement = connection
        .prepare("SELECT id FROM chapters WHERE novel_id=?1 AND deleted_at IS NULL")
        .map_err(|e| e.to_string())?;
    let ids = statement
        .query_map([novel], |r| r.get::<_, String>(0))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    ids.into_iter()
        .map(|id| {
            read_chapter_base_snapshot(connection, novel, &id)
                .map(|b| (id, b))
                .map_err(|e| e.to_string())
        })
        .collect()
}

pub(super) fn execution_metadata(input: &StartTaskTurnInput) -> Value {
    input
        .execution
        .as_ref()
        .map(|e| e.metadata(input))
        .unwrap_or(Value::Null)
}

fn initial_staged_bounds(
    connection: &rusqlite::Connection,
    input: &StartTaskTurnInput,
    baselines: &HashMap<String, ChapterBaseSnapshot>,
) -> Result<Option<staged::StagedBudgetBounds>, String> {
    if input.chapter_id.is_some() {
        return staged::budget_bounds(connection, input);
    }
    let mut result: Option<staged::StagedBudgetBounds> = None;
    for chapter in baselines.keys() {
        let mut scoped = input.clone();
        scoped.chapter_id = Some(chapter.clone());
        match staged::budget_bounds(connection, &scoped) {
            Ok(Some(bound)) => {
                if let Some(current) = result.as_mut() {
                    current.stages = current.stages.max(bound.stages);
                    current.requests = current.requests.max(bound.requests);
                    current.tools = current.tools.max(bound.tools);
                } else {
                    result = Some(bound)
                }
            }
            Ok(None) => {}
            Err(error) if error.starts_with("CHAPTER_STAGED_PLAN_") => {}
            Err(error) => return Err(error),
        }
    }
    Ok(result)
}

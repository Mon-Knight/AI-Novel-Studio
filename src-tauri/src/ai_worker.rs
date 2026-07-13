use crate::ai::{
    ai_chat_completion_async, AiChatCompletionRequest, AiChatCompletionResponse, AiChatMessage,
};
use crate::db::get_connection;
use crate::domain::placement::{CreatePlacementProposalInput, PlacementTargetOverride};
use crate::errors::{codes, AppError};
use crate::repositories::large_text_repository;
use crate::services::{ai_task_service, artifact_service, placement_service, workflow_service};
use chrono::{Duration as ChronoDuration, Utc};
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::{Arc, Mutex, RwLock};
use std::time::Duration;
use tauri::Manager;
use tokio_util::sync::CancellationToken;

const WORKER_KIND: &str = "quality_check";
const MAX_PARALLEL_JOBS: usize = 2;
const LEASE_SECONDS: i64 = 12;
const HEARTBEAT_SECONDS: u64 = 2;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkerProviderConfig {
    pub runtime_mode: String,
    pub provider_id: String,
    pub base_url: Option<String>,
    pub api_key: Option<String>,
    pub model_name: String,
    pub timeout_seconds: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkerProgressEvent {
    pub task_id: String,
    pub status: String,
    pub progress_stage: String,
    pub progress_percent: i64,
    pub error_message: Option<String>,
}

#[derive(Debug, Clone)]
struct ClaimedJob {
    task_id: String,
    attempt_id: String,
    attempt_number: i64,
    max_attempts: i64,
    novel_id: String,
    chapter_id: Option<String>,
    draft_id: Option<String>,
    draft_version: Option<i64>,
    base_content_hash: Option<String>,
    messages: Vec<AiChatMessage>,
    provider_options: Value,
    task_type: String,
    step_key: Option<String>,
    artifact_type: String,
    review_output: bool,
    dependencies: Vec<workflow_service::DependencyArtifact>,
}

#[derive(Debug, Clone)]
struct WorkerFailure {
    error: AppError,
}

#[derive(Clone)]
pub struct AiWorkerManager {
    owner_id: String,
    provider: Arc<RwLock<Option<WorkerProviderConfig>>>,
    cancellations: Arc<Mutex<HashMap<String, CancellationToken>>>,
}

impl AiWorkerManager {
    pub fn new() -> Self {
        Self {
            owner_id: format!("desktop-{}", uuid::Uuid::new_v4()),
            provider: Arc::new(RwLock::new(None)),
            cancellations: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub fn configure(&self, config: WorkerProviderConfig) -> Result<(), AppError> {
        if config.provider_id.trim().is_empty()
            || (config.runtime_mode != "mock"
                && (config.base_url.as_deref().unwrap_or("").trim().is_empty()
                    || config.api_key.as_deref().unwrap_or("").trim().is_empty()
                    || config.model_name.trim().is_empty()))
        {
            return Err(AppError::new(
                codes::AI_WORKER_PROVIDER_UNAVAILABLE,
                "后台质量检查缺少 Provider 运行配置",
                false,
            ));
        }
        *self
            .provider
            .write()
            .map_err(|_| AppError::poisoned_lock())? = Some(config);
        Ok(())
    }

    pub fn cancel(&self, task_id: &str) {
        if let Ok(tokens) = self.cancellations.lock() {
            if let Some(token) = tokens.get(task_id) {
                token.cancel();
            }
        }
    }

    pub fn start(&self, app: tauri::AppHandle) {
        for slot in 0..MAX_PARALLEL_JOBS {
            let manager = self.clone();
            let app = app.clone();
            let owner_id = format!("{}-{slot}", manager.owner_id);
            tauri::async_runtime::spawn(async move {
                loop {
                    if let Err(error) = manager.tick(&app, &owner_id).await {
                        eprintln!("[AI_WORKER] tick failed code={}", error.code);
                    }
                    tokio::time::sleep(Duration::from_millis(750)).await;
                }
            });
        }
    }

    async fn tick(&self, app: &tauri::AppHandle, owner_id: &str) -> Result<(), AppError> {
        {
            let mut connection = get_connection()
                .lock()
                .map_err(|_| AppError::poisoned_lock())?;
            recover_expired_leases(&mut connection)?;
            workflow_service::refresh_orchestration(&connection)?;
        }
        let provider = self
            .provider
            .read()
            .map_err(|_| AppError::poisoned_lock())?
            .clone();
        let Some(provider) = provider else {
            return Ok(());
        };
        let job = {
            let mut connection = get_connection()
                .lock()
                .map_err(|_| AppError::poisoned_lock())?;
            claim_next(&mut connection, owner_id)?
        };
        let Some(job) = job else {
            return Ok(());
        };
        let token = CancellationToken::new();
        self.cancellations
            .lock()
            .map_err(|_| AppError::poisoned_lock())?
            .insert(job.task_id.clone(), token.clone());
        let result = execute_job(app, owner_id, &provider, &job, token).await;
        self.cancellations
            .lock()
            .map_err(|_| AppError::poisoned_lock())?
            .remove(&job.task_id);
        result
    }
}

fn emit_progress(app: &tauri::AppHandle, event: WorkerProgressEvent) {
    let _ = app.emit_all("ai-task-progress", event);
}

pub fn enqueue_task(connection: &mut Connection, task_id: &str) -> Result<(), AppError> {
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(AppError::database)?;
    let affected = transaction
        .execute(
            "UPDATE ai_tasks SET status='queued', worker_kind=?1, progress_stage='已加入后台队列',
                    progress_percent=5, available_at=?2, worker_owner_id=NULL, lease_expires_at=NULL,
                    heartbeat_at=NULL, cancel_requested_at=NULL
             WHERE task_id=?3 AND task_type='quality_check' AND status='ready'",
            params![WORKER_KIND, Utc::now().to_rfc3339(), task_id],
        )
        .map_err(AppError::database)?;
    if affected != 1 {
        return Err(AppError::new(
            codes::AI_TASK_ILLEGAL_TRANSITION,
            "质量检查任务当前不能进入后台队列",
            false,
        ));
    }
    transaction.commit().map_err(AppError::database)?;
    workflow_service::refresh_orchestration(connection)
}

fn claim_next(connection: &mut Connection, owner_id: &str) -> Result<Option<ClaimedJob>, AppError> {
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(AppError::database)?;
    let now = Utc::now();
    let task_id: Option<String> = transaction
        .query_row(
            "SELECT task_id FROM ai_tasks
             WHERE worker_kind IN (?1,?2) AND status='queued' AND stale_at IS NULL
               AND (available_at IS NULL OR available_at <= ?3)
               AND NOT EXISTS (SELECT 1 FROM result_artifacts r WHERE r.task_id=ai_tasks.task_id AND r.processing_status IN ('valid','valid_with_warnings'))
               AND NOT EXISTS (
                 SELECT 1 FROM ai_task_dependencies d JOIN ai_tasks upstream ON upstream.task_id=d.depends_on_task_id
                 WHERE d.task_id=ai_tasks.task_id AND d.required=1
                   AND (upstream.status NOT IN ('completed','applied') OR upstream.stale_at IS NOT NULL)
               )
               AND NOT EXISTS (
                 SELECT 1 FROM ai_tasks active
                 WHERE active.workflow_id=ai_tasks.workflow_id AND active.status IN ('running','validating')
                   AND active.concurrency_group IS NOT NULL
                   AND active.concurrency_group=ai_tasks.concurrency_group
               )
             ORDER BY priority DESC, created_at LIMIT 1",
            params![WORKER_KIND, workflow_service::WORKFLOW_WORKER_KIND, now.to_rfc3339()],
            |row| row.get(0),
        )
        .optional()
        .map_err(AppError::database)?;
    let Some(task_id) = task_id else {
        transaction.commit().map_err(AppError::database)?;
        return Ok(None);
    };
    let attempt_number: i64 = transaction
        .query_row(
            "SELECT COALESCE(MAX(attempt_number),0)+1 FROM ai_task_attempts WHERE task_id=?1",
            params![task_id],
            |row| row.get(0),
        )
        .map_err(AppError::database)?;
    let attempt_id = uuid::Uuid::new_v4().to_string();
    let lease_expires = (now + ChronoDuration::seconds(LEASE_SECONDS)).to_rfc3339();
    let affected = transaction
        .execute(
            "UPDATE ai_tasks SET status='running', worker_owner_id=?1, lease_expires_at=?2,
                    heartbeat_at=?3, progress_stage='后台任务已认领', progress_percent=12,
                    started_at=COALESCE(started_at,?3), current_attempt_id=?4
             WHERE task_id=?5 AND status='queued' AND worker_kind IN (?6,?7)",
            params![
                owner_id,
                lease_expires,
                now.to_rfc3339(),
                attempt_id,
                task_id,
                WORKER_KIND,
                workflow_service::WORKFLOW_WORKER_KIND
            ],
        )
        .map_err(AppError::database)?;
    if affected != 1 {
        transaction.commit().map_err(AppError::database)?;
        return Ok(None);
    }
    transaction
        .execute(
            "INSERT INTO ai_task_attempts
             (attempt_id,task_id,attempt_number,status,provider_id,started_at)
             VALUES (?1,?2,?3,'running',(SELECT worker_kind FROM ai_tasks WHERE task_id=?2),?4)",
            params![attempt_id, task_id, attempt_number, now.to_rfc3339()],
        )
        .map_err(AppError::database)?;
    let (
        novel_id,
        chapter_id,
        draft_id,
        max_attempts,
        body_ref_id,
        draft_version,
        base_hash,
        context_ref_id,
        provider_options_raw,
        task_type,
        step_key,
        target_hint_raw,
    ): (
        String,
        Option<String>,
        Option<String>,
        i64,
        Option<String>,
        Option<i64>,
        Option<String>,
        Option<String>,
        String,
        String,
        Option<String>,
        Option<String>,
    ) = transaction
        .query_row(
            "SELECT t.novel_id,t.chapter_id,t.draft_id,t.max_attempts,
                i.body_ref_id,i.source_draft_version,i.base_content_hash,
                c.compiled_context_ref_id,k.provider_options_json,t.task_type,t.step_key,t.target_hint_json
         FROM ai_tasks t
         JOIN ai_input_snapshots i ON i.task_id=t.task_id
         JOIN ai_context_snapshots c ON c.task_id=t.task_id
         JOIN ai_constraint_snapshots k ON k.task_id=t.task_id
         WHERE t.task_id=?1",
            params![task_id],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                    row.get(5)?,
                    row.get(6)?,
                    row.get(7)?,
                    row.get(8)?,
                    row.get(9)?,
                    row.get(10)?,
                    row.get(11)?,
                ))
            },
        )
        .map_err(AppError::database)?;
    let context_ref_id = context_ref_id.ok_or_else(|| {
        AppError::new(
            codes::AI_CONTEXT_BUILD_FAILED,
            "后台任务缺少冻结 Prompt",
            false,
        )
    })?;
    let frozen_messages =
        large_text_repository::read_verified_document(&transaction, &context_ref_id)?.content;
    let mut messages: Vec<AiChatMessage> =
        serde_json::from_str(&frozen_messages).map_err(|_| {
            AppError::new(
                codes::AI_CONTEXT_BUILD_FAILED,
                "后台任务 Prompt 快照格式无效",
                false,
            )
        })?;
    if let Some(body_ref_id) = body_ref_id {
        let _ = large_text_repository::read_verified_document(&transaction, &body_ref_id)?;
    }
    let provider_options = serde_json::from_str(&provider_options_raw).map_err(|_| {
        AppError::new(
            codes::AI_CONTEXT_BUILD_FAILED,
            "后台任务 Provider 参数快照无效",
            false,
        )
    })?;
    let target_hint = target_hint_raw
        .as_deref()
        .and_then(|value| serde_json::from_str::<Value>(value).ok())
        .unwrap_or_else(|| json!({}));
    let artifact_type = target_hint
        .get("artifactType")
        .and_then(Value::as_str)
        .map(str::to_owned)
        .unwrap_or_else(|| match task_type.as_str() {
            "quality_check" | "quality_recheck" => "quality_report".into(),
            "workflow_generate_summary" | "chapter_summary" => "chapter_summary".into(),
            "volume_summary" => "volume_summary".into(),
            _ => "generic_json".into(),
        });
    let review_output = target_hint
        .get("reviewOutput")
        .and_then(Value::as_bool)
        .unwrap_or(task_type == "workflow_review_bundle");
    let dependencies = workflow_service::dependency_artifacts(&transaction, &task_id)?;
    for artifact in &dependencies {
        messages.push(AiChatMessage {
            role: "user".into(),
            content: format!(
                "上游 {} Artifact：\n{}",
                artifact.artifact_type, artifact.content
            ),
        });
    }
    transaction.commit().map_err(AppError::database)?;
    Ok(Some(ClaimedJob {
        task_id,
        attempt_id,
        attempt_number,
        max_attempts,
        novel_id,
        chapter_id,
        draft_id,
        draft_version,
        base_content_hash: base_hash,
        messages,
        provider_options,
        task_type,
        step_key,
        artifact_type,
        review_output,
        dependencies,
    }))
}

fn recover_expired_leases(connection: &mut Connection) -> Result<usize, AppError> {
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(AppError::database)?;
    let now = Utc::now().to_rfc3339();
    let mut statement = transaction
        .prepare(
            "SELECT task_id,current_attempt_id,retry_count,max_attempts FROM ai_tasks
         WHERE worker_kind IN (?1,?2) AND status IN ('running','validating')
           AND lease_expires_at IS NOT NULL AND lease_expires_at < ?3",
        )
        .map_err(AppError::database)?;
    let expired = statement
        .query_map(
            params![WORKER_KIND, workflow_service::WORKFLOW_WORKER_KIND, now],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, Option<String>>(1)?,
                    row.get::<_, i64>(2)?,
                    row.get::<_, i64>(3)?,
                ))
            },
        )
        .map_err(AppError::database)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(AppError::database)?;
    drop(statement);
    for (task_id, attempt_id, retry_count, max_attempts) in &expired {
        let error = AppError::new(
            codes::AI_WORKER_INTERRUPTED,
            "后台任务因应用中断而等待恢复",
            true,
        );
        let error_json = serde_json::to_string(&error).unwrap_or_else(|_| "{}".into());
        if let Some(attempt_id) = attempt_id {
            transaction.execute(
                "UPDATE ai_task_attempts SET status='failed', error_json=?1, finished_at=?2,
                        interrupted_at=?2, interruption_reason='lease_expired', retry_scheduled_at=?2
                 WHERE attempt_id=?3 AND task_id=?4 AND status IN ('running','succeeded','cancel_requested')",
                params![error_json, now, attempt_id, task_id],
            ).map_err(AppError::database)?;
        }
        let can_retry = *retry_count + 1 < *max_attempts;
        transaction
            .execute(
                "UPDATE ai_tasks SET status=?1, retry_count=retry_count+1, error_json=?2,
                    interrupted_at=?3, available_at=?3, worker_owner_id=NULL,
                    lease_expires_at=NULL, heartbeat_at=NULL,
                    progress_stage=?4, progress_percent=?5
             WHERE task_id=?6 AND status IN ('running','validating')",
                params![
                    if can_retry { "queued" } else { "failed" },
                    error_json,
                    now,
                    if can_retry {
                        "任务中断，正在恢复"
                    } else {
                        "任务中断且已达到重试上限"
                    },
                    if can_retry { 5 } else { 100 },
                    task_id
                ],
            )
            .map_err(AppError::database)?;
    }
    transaction.commit().map_err(AppError::database)?;
    Ok(expired.len())
}

fn heartbeat(task_id: &str, owner_id: &str, stage: &str, percent: i64) -> Result<bool, AppError> {
    let connection = get_connection()
        .lock()
        .map_err(|_| AppError::poisoned_lock())?;
    let now = Utc::now();
    let affected = connection.execute(
        "UPDATE ai_tasks SET heartbeat_at=?1, lease_expires_at=?2, progress_stage=?3, progress_percent=?4
         WHERE task_id=?5 AND worker_owner_id=?6 AND status='running'",
        params![now.to_rfc3339(), (now+ChronoDuration::seconds(LEASE_SECONDS)).to_rfc3339(), stage, percent, task_id, owner_id],
    ).map_err(AppError::database)?;
    if affected != 1 {
        let status: Option<String> = connection
            .query_row(
                "SELECT status FROM ai_tasks WHERE task_id=?1",
                params![task_id],
                |row| row.get(0),
            )
            .optional()
            .map_err(AppError::database)?;
        return Ok(status.as_deref() == Some("cancel_requested"));
    }
    Ok(false)
}

fn classify_provider_error(message: String) -> WorkerFailure {
    if message.contains("已取消") {
        return WorkerFailure {
            error: AppError::new(codes::AI_PROVIDER_CANCELLED, "质量检查已取消", false),
        };
    }
    if message.contains("429") || message.contains("过于频繁") || message.contains("额度") {
        return WorkerFailure {
            error: AppError::new(codes::AI_PROVIDER_RATE_LIMITED, message, true),
        };
    }
    if message.contains("超时") {
        return WorkerFailure {
            error: AppError::new(codes::AI_PROVIDER_TIMEOUT, message, true),
        };
    }
    if message.contains("网络")
        || message.contains("500")
        || message.contains("过载")
        || message.contains("服务错误")
    {
        return WorkerFailure {
            error: AppError::new(codes::AI_PROVIDER_NETWORK_ERROR, message, true),
        };
    }
    WorkerFailure {
        error: AppError::new(codes::AI_PROVIDER_MALFORMED_RESPONSE, message, false),
    }
}

fn normalized_quality_payload(text: &str) -> Option<Value> {
    let trimmed = text.trim();
    let unfenced = if trimmed.starts_with("```") {
        let first_line = trimmed.find('\n').map(|index| index + 1).unwrap_or(0);
        let end = trimmed.rfind("```").unwrap_or(trimmed.len());
        &trimmed[first_line..end]
    } else {
        trimmed
    };
    let start = unfenced.find('{')?;
    let end = unfenced.rfind('}')? + 1;
    let mut value: Value = serde_json::from_str(&unfenced[start..end]).ok()?;
    let object = value.as_object_mut()?;
    if !object.contains_key("overallScore") {
        if let Some(score) = object.remove("overall_score") {
            object.insert("overallScore".into(), score);
        }
    }
    if !object.get("overallScore").is_some_and(Value::is_number)
        || !object.get("items").is_some_and(Value::is_array)
    {
        return None;
    }
    Some(value)
}

async fn call_provider(
    config: &WorkerProviderConfig,
    job: &ClaimedJob,
    cancellation: CancellationToken,
) -> Result<AiChatCompletionResponse, WorkerFailure> {
    if job.task_type == "workflow_freeze_chapter" {
        let text = json!({
            "frozen": true,
            "draftId": job.draft_id,
            "draftVersion": job.draft_version,
            "baseContentHash": job.base_content_hash,
            "automaticApply": false,
        })
        .to_string();
        return Ok(AiChatCompletionResponse {
            text: text.clone(),
            raw: json!({"local":true,"content":text}),
            token_input: Some(0),
            token_output: Some(0),
            total_tokens: Some(0),
        });
    }
    if job.task_type == "workflow_prepare_materials" {
        let text = json!({
            "ready": true,
            "draftId": job.draft_id,
            "draftVersion": job.draft_version,
            "baseContentHash": job.base_content_hash,
        })
        .to_string();
        return Ok(AiChatCompletionResponse {
            text: text.clone(),
            raw: json!({"local":true,"content":text}),
            token_input: Some(0),
            token_output: Some(0),
            total_tokens: Some(0),
        });
    }
    if job.task_type == "workflow_review_bundle" {
        let artifacts = job
            .dependencies
            .iter()
            .map(|artifact| {
                json!({
                    "artifactId": artifact.artifact_id,
                    "artifactType": artifact.artifact_type,
                })
            })
            .collect::<Vec<_>>();
        let text = json!({
            "reviewStatus": "waiting_user",
            "workflowComplete": true,
            "artifacts": artifacts,
            "automaticApply": false,
        })
        .to_string();
        return Ok(AiChatCompletionResponse {
            text: text.clone(),
            raw: json!({"local":true,"content":text}),
            token_input: Some(0),
            token_output: Some(0),
            total_tokens: Some(0),
        });
    }
    if job.task_type == "workflow_quality_review_bundle" {
        let artifacts = job
            .dependencies
            .iter()
            .map(|artifact| {
                json!({
                    "artifactId": artifact.artifact_id,
                    "artifactType": artifact.artifact_type,
                })
            })
            .collect::<Vec<_>>();
        let repair_artifact_id = job
            .dependencies
            .iter()
            .find(|artifact| artifact.artifact_type == "chapter_text")
            .map(|artifact| artifact.artifact_id.clone());
        let reports = job
            .dependencies
            .iter()
            .filter(|artifact| artifact.artifact_type == "quality_report")
            .filter_map(|artifact| serde_json::from_str::<Value>(&artifact.content).ok())
            .collect::<Vec<_>>();
        let text = json!({
            "reviewStatus": "waiting_user",
            "workflowComplete": true,
            "initialQuality": reports.first(),
            "recheckQuality": reports.last(),
            "repairArtifactId": repair_artifact_id,
            "artifacts": artifacts,
            "automaticApply": false,
            "nextAction": "review_repair_candidate",
        })
        .to_string();
        return Ok(AiChatCompletionResponse {
            text: text.clone(),
            raw: json!({"local":true,"content":text}),
            token_input: Some(0),
            token_output: Some(0),
            total_tokens: Some(0),
        });
    }
    if config.runtime_mode == "mock" {
        if cancellation
            .run_until_cancelled(tokio::time::sleep(Duration::from_millis(180)))
            .await
            .is_none()
        {
            return Err(classify_provider_error("AI 请求已取消".into()));
        }
        let text = match job.task_type.as_str() {
            "workflow_generate_summary" => json!({
                "summary": "本章关键事件摘要候选",
                "keyEvents": [],
                "characters": [],
                "sourceVerified": true
            }).to_string(),
            "workflow_check_summary" => json!({
                "consistent": true,
                "issues": [],
                "checkedArtifactIds": job.dependencies.iter().map(|item| item.artifact_id.clone()).collect::<Vec<_>>()
            }).to_string(),
            "quality_fix" => json!({
                "mode": "targeted_fix",
                "fixed_issue_keys": [],
                "revision_summary": "后台 Mock 修复候选",
                "changed_ranges": [],
                "revised_content": "后台 Mock 修复后的完整章节正文。",
                "automaticApply": false
            }).to_string(),
            "quality_recheck" | "quality_check" => json!({
                "overallScore": 92,
                "summary": "后台 Mock 质量检查完成",
                "items": []
            }).to_string(),
            "chapter_polish" => "后台 Mock 润色后的完整章节正文。".into(),
            "chapter_summary" => json!({
                "summary": "后台 Mock 章节摘要候选",
                "keyEvents": [],
                "characterChanges": [],
                "relationshipChanges": [],
                "newForeshadows": [],
                "resolvedForeshadows": [],
                "nextChapterHints": ""
            }).to_string(),
            "volume_summary" => json!({
                "summaryTitle": "后台 Mock 卷总结",
                "volumeMainArc": "本卷主线摘要候选",
                "majorEvents": [],
                "protagonistGrowth": "",
                "characterChanges": [],
                "relationshipChanges": [],
                "factionChanges": [],
                "settingChanges": [],
                "foreshadowingCollected": [],
                "unresolvedQuestions": [],
                "factsMustRemember": [],
                "nextVolumeHook": ""
            }).to_string(),
            "outline_generate" => "后台 Mock 作品总纲候选。".into(),
            "volume_outline_generate" => json!({
                "title": "后台 Mock 分卷",
                "summary": "分卷大纲候选",
                "goal": "推进主线",
                "mainConflict": "核心冲突"
            }).to_string(),
            "chapter_outline_generate" => json!({
                "chapters": [{"title":"后台 Mock 章节","outline":"章节大纲候选","goal":"推进剧情","targetWordCount":4000}]
            }).to_string(),
            _ => json!({
                "overallScore": 92,
                "summary": "后台 Mock 质量检查完成",
                "items": []
            }).to_string(),
        };
        return Ok(AiChatCompletionResponse {
            text: text.clone(),
            raw: json!({"mock": true, "content": text}),
            token_input: Some(0),
            token_output: Some(0),
            total_tokens: Some(0),
        });
    }
    let options = job.provider_options.as_object();
    let request = AiChatCompletionRequest {
        base_url: config.base_url.clone().unwrap_or_default(),
        api_key: config.api_key.clone().unwrap_or_default(),
        model_name: options
            .and_then(|value| value.get("model"))
            .and_then(Value::as_str)
            .filter(|value| !value.is_empty() && *value != "Mock")
            .unwrap_or(&config.model_name)
            .to_string(),
        messages: job.messages.clone(),
        temperature: options
            .and_then(|value| value.get("temperature"))
            .and_then(Value::as_f64),
        max_tokens: options
            .and_then(|value| value.get("maxTokens"))
            .and_then(Value::as_u64)
            .map(|value| value as u32),
        timeout_seconds: options
            .and_then(|value| value.get("timeoutSeconds"))
            .and_then(Value::as_u64)
            .or(config.timeout_seconds),
    };
    ai_chat_completion_async(request, cancellation)
        .await
        .map_err(classify_provider_error)
}

fn finalize_cancel(job: &ClaimedJob) -> Result<(), AppError> {
    let mut connection = get_connection()
        .lock()
        .map_err(|_| AppError::poisoned_lock())?;
    finalize_cancel_in_connection(&mut connection, job)
}

fn finalize_cancel_in_connection(
    connection: &mut Connection,
    job: &ClaimedJob,
) -> Result<(), AppError> {
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(AppError::database)?;
    let now = Utc::now().to_rfc3339();
    transaction
        .execute(
            "UPDATE ai_task_attempts SET status='cancelled', finished_at=?1
         WHERE attempt_id=?2 AND task_id=?3 AND status IN ('running','cancel_requested')",
            params![now, job.attempt_id, job.task_id],
        )
        .map_err(AppError::database)?;
    transaction
        .execute(
            "UPDATE ai_tasks SET status='cancelled', progress_stage='已取消', progress_percent=100,
                worker_owner_id=NULL,lease_expires_at=NULL,heartbeat_at=NULL
         WHERE task_id=?1 AND status IN ('running','cancel_requested')",
            params![job.task_id],
        )
        .map_err(AppError::database)?;
    transaction.commit().map_err(AppError::database)?;
    workflow_service::refresh_orchestration(connection)
}

fn finalize_failure(job: &ClaimedJob, failure: WorkerFailure) -> Result<String, AppError> {
    let mut connection = get_connection()
        .lock()
        .map_err(|_| AppError::poisoned_lock())?;
    finalize_failure_in_connection(&mut connection, job, failure)
}

fn finalize_failure_in_connection(
    connection: &mut Connection,
    job: &ClaimedJob,
    failure: WorkerFailure,
) -> Result<String, AppError> {
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(AppError::database)?;
    let now = Utc::now();
    let retry = failure.error.retryable && job.attempt_number < job.max_attempts;
    let error_json = serde_json::to_string(&failure.error).unwrap_or_else(|_| "{}".into());
    transaction.execute(
        "UPDATE ai_task_attempts SET status='failed',error_json=?1,finished_at=?2,retry_scheduled_at=?3
         WHERE attempt_id=?4 AND task_id=?5 AND status IN ('running','cancel_requested')",
        params![error_json, now.to_rfc3339(), retry.then(|| (now+ChronoDuration::seconds(1)).to_rfc3339()), job.attempt_id, job.task_id],
    ).map_err(AppError::database)?;
    let next_status = if retry { "queued" } else { "failed" };
    transaction
        .execute(
            "UPDATE ai_tasks SET status=?1,error_json=?2,retry_count=retry_count+?3,
                available_at=?4,progress_stage=?5,progress_percent=?6,
                worker_owner_id=NULL,lease_expires_at=NULL,heartbeat_at=NULL
         WHERE task_id=?7 AND status IN ('running','cancel_requested')",
            params![
                next_status,
                error_json,
                if retry { 1 } else { 0 },
                retry.then(|| (now + ChronoDuration::seconds(1)).to_rfc3339()),
                if retry {
                    "临时错误，准备重试"
                } else if job.task_type == "quality_check" {
                    "质量检查失败"
                } else {
                    "工作流步骤失败"
                },
                if retry { 5 } else { 100 },
                job.task_id
            ],
        )
        .map_err(AppError::database)?;
    transaction.commit().map_err(AppError::database)?;
    workflow_service::refresh_orchestration(connection)?;
    Ok(next_status.to_string())
}

async fn execute_job(
    app: &tauri::AppHandle,
    owner_id: &str,
    config: &WorkerProviderConfig,
    job: &ClaimedJob,
    cancellation: CancellationToken,
) -> Result<(), AppError> {
    let running_stage = if job.task_type == "quality_check" {
        "正在请求 AI 检查"
    } else {
        "正在执行工作流步骤"
    };
    emit_progress(
        app,
        WorkerProgressEvent {
            task_id: job.task_id.clone(),
            status: "running".into(),
            progress_stage: running_stage.into(),
            progress_percent: 25,
            error_message: None,
        },
    );
    let heartbeat_token = cancellation.clone();
    let heartbeat_task_id = job.task_id.clone();
    let heartbeat_owner = owner_id.to_string();
    let heartbeat_stage = running_stage.to_string();
    let heartbeat_handle = tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_secs(HEARTBEAT_SECONDS)).await;
            if heartbeat_token.is_cancelled() {
                break;
            }
            match heartbeat(&heartbeat_task_id, &heartbeat_owner, &heartbeat_stage, 45) {
                Ok(true) | Err(_) => {
                    heartbeat_token.cancel();
                    break;
                }
                Ok(false) => {}
            }
        }
    });
    let response = call_provider(config, job, cancellation.clone()).await;
    heartbeat_handle.abort();
    if cancellation.is_cancelled() {
        finalize_cancel(job)?;
        emit_progress(
            app,
            WorkerProgressEvent {
                task_id: job.task_id.clone(),
                status: "cancelled".into(),
                progress_stage: "已取消".into(),
                progress_percent: 100,
                error_message: None,
            },
        );
        return Ok(());
    }
    let response = match response {
        Ok(response) => response,
        Err(failure) if failure.error.code == codes::AI_PROVIDER_CANCELLED => {
            finalize_cancel(job)?;
            emit_progress(
                app,
                WorkerProgressEvent {
                    task_id: job.task_id.clone(),
                    status: "cancelled".into(),
                    progress_stage: "已取消".into(),
                    progress_percent: 100,
                    error_message: None,
                },
            );
            return Ok(());
        }
        Err(failure) => {
            let message = failure.error.message.clone();
            let next = finalize_failure(job, failure)?;
            emit_progress(
                app,
                WorkerProgressEvent {
                    task_id: job.task_id.clone(),
                    status: next,
                    progress_stage: if job.task_type == "quality_check" {
                        "质量检查未完成".into()
                    } else {
                        "工作流步骤未完成".into()
                    },
                    progress_percent: 100,
                    error_message: Some(message),
                },
            );
            return Ok(());
        }
    };
    let status = {
        let mut connection = get_connection()
            .lock()
            .map_err(|_| AppError::poisoned_lock())?;
        persist_success(&mut connection, job, &response)?
    };
    emit_progress(
        app,
        WorkerProgressEvent {
            task_id: job.task_id.clone(),
            status: status.into(),
            progress_stage: if status == "completed" && job.task_type == "quality_check" {
                "检查完成，等待审查".into()
            } else if status == "completed" {
                "工作流步骤完成".into()
            } else {
                "结果无效".into()
            },
            progress_percent: 100,
            error_message: None,
        },
    );
    Ok(())
}

fn persist_success(
    connection: &mut Connection,
    job: &ClaimedJob,
    response: &AiChatCompletionResponse,
) -> Result<&'static str, AppError> {
    let stale_at: Option<String> = connection
        .query_row(
            "SELECT stale_at FROM ai_tasks WHERE task_id=?1",
            params![job.task_id],
            |row| row.get(0),
        )
        .map_err(AppError::database)?;
    if stale_at.is_some() {
        finalize_failure_in_connection(
            connection,
            job,
            WorkerFailure {
                error: AppError::new(
                    codes::AI_WORKFLOW_STALE,
                    "正文基线已变化，后台迟到结果已丢弃",
                    false,
                ),
            },
        )?;
        return Ok("failed");
    }
    let existing: i64 = connection.query_row(
        "SELECT COUNT(*) FROM result_artifacts WHERE task_id=?1 AND processing_status IN ('valid','valid_with_warnings')", params![job.task_id], |row| row.get(0),
    ).map_err(AppError::database)?;
    if existing > 0 {
        let status: String = connection
            .query_row(
                "SELECT status FROM ai_tasks WHERE task_id=?1",
                params![job.task_id],
                |row| row.get(0),
            )
            .map_err(AppError::database)?;
        return Ok(if status == "completed" {
            "completed"
        } else {
            "failed"
        });
    }
    let payload = if matches!(job.task_type.as_str(), "quality_check" | "quality_recheck") {
        normalized_quality_payload(&response.text)
    } else {
        serde_json::from_str::<Value>(&response.text).ok()
    };
    ai_task_service::mark_attempt_succeeded(
        connection,
        &job.task_id,
        &job.attempt_id,
        json!({
            "responseHash": large_text_repository::sha256(&response.text),
            "responseLength": response.text.chars().count(),
            "tokenInput": response.token_input,
            "tokenOutput": response.token_output,
            "tokenTotal": response.total_tokens,
            "worker": if job.task_type == "quality_check" { WORKER_KIND } else { workflow_service::WORKFLOW_WORKER_KIND },
            "stepKey": job.step_key,
        }),
    )?;
    let artifact_type = job.artifact_type.as_str();
    let parent_artifact_id = job
        .dependencies
        .iter()
        .find(|item| item.artifact_type == "chapter_summary")
        .or_else(|| job.dependencies.first())
        .map(|item| item.artifact_id.clone());
    let artifact = artifact_service::create_artifact(
        connection,
        artifact_service::CreateResultArtifactInput {
            task_id: job.task_id.clone(),
            attempt_id: job.attempt_id.clone(),
            artifact_type: artifact_type.into(),
            schema_version: 1,
            raw_content: response.text.clone(),
            parse_content: Some(response.text.clone()),
            display_content: Some(response.text.clone()),
            structured_payload_json: payload.clone(),
            source: artifact_service::ArtifactSourceInput {
                novel_id: job.novel_id.clone(),
                chapter_id: job.chapter_id.clone(),
                draft_id: job.draft_id.clone(),
                draft_version: job.draft_version,
                base_content_hash: job.base_content_hash.clone(),
            },
            expected_ok: None,
            parent_artifact_id,
            derivation_type: (job.task_type != "quality_check").then(|| "workflow_step".into()),
        },
    )?;
    if artifact_type == "chapter_text" || job.review_output {
        let target = if artifact_type == "chapter_text" {
            job.chapter_id
                .clone()
                .map(|chapter_id| PlacementTargetOverride {
                    novel_id: job.novel_id.clone(),
                    chapter_id,
                    draft_id: job.draft_id.clone(),
                })
        } else {
            None
        };
        let _ = placement_service::create_proposal(
            connection,
            CreatePlacementProposalInput {
                artifact_id: artifact.artifact_id.clone(),
                target,
                parent_proposal_id: None,
            },
        );
    }
    if job.review_output {
        connection.execute(
            "UPDATE ai_tasks SET result_artifact_id=?1 WHERE task_id=(SELECT parent_task_id FROM ai_tasks WHERE task_id=?2)",
            params![artifact.artifact_id,job.task_id],
        ).map_err(AppError::database)?;
    }
    connection
        .execute(
            "UPDATE ai_tasks SET progress_stage=?1,progress_percent=100,worker_owner_id=NULL,
                lease_expires_at=NULL,heartbeat_at=NULL WHERE task_id=?2",
            params![
                if payload.is_some()
                    || !matches!(
                        artifact_type,
                        "quality_report"
                            | "generic_json"
                            | "chapter_summary"
                            | "volume_summary"
                            | "volume_outline"
                            | "chapter_outlines"
                    )
                {
                    "检查完成，等待审查"
                } else {
                    "检查结果无效"
                },
                job.task_id
            ],
        )
        .map_err(AppError::database)?;
    workflow_service::refresh_orchestration(connection)?;
    Ok(
        if payload.is_some()
            || !matches!(
                artifact_type,
                "quality_report"
                    | "generic_json"
                    | "chapter_summary"
                    | "volume_summary"
                    | "volume_outline"
                    | "chapter_outlines"
            )
        {
            "completed"
        } else {
            "failed"
        },
    )
}

pub fn request_cancel(connection: &mut Connection, task_id: &str) -> Result<String, AppError> {
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(AppError::database)?;
    let status: String = transaction
        .query_row(
            "SELECT status FROM ai_tasks WHERE task_id=?1 AND worker_kind=?2",
            params![task_id, WORKER_KIND],
            |row| row.get(0),
        )
        .optional()
        .map_err(AppError::database)?
        .ok_or_else(|| AppError::new(codes::AI_TASK_NOT_FOUND, "后台质量检查任务不存在", false))?;
    let now = Utc::now().to_rfc3339();
    let next = match status.as_str() {
        "queued" | "ready" => "cancelled",
        "running" | "validating" => "cancel_requested",
        "cancel_requested" => "cancel_requested",
        _ => {
            return Err(AppError::new(
                codes::AI_TASK_TERMINAL_STATE,
                "任务当前不能取消",
                false,
            ))
        }
    };
    transaction
        .execute(
            "UPDATE ai_tasks SET status=?1,cancel_requested_at=?2,progress_stage=?3,
                progress_percent=CASE WHEN ?1='cancelled' THEN 100 ELSE progress_percent END
         WHERE task_id=?4 AND status=?5",
            params![
                next,
                now,
                if next == "cancelled" {
                    "已取消"
                } else {
                    "正在取消"
                },
                task_id,
                status
            ],
        )
        .map_err(AppError::database)?;
    if next == "cancel_requested" {
        transaction.execute(
            "UPDATE ai_task_attempts SET status='cancel_requested' WHERE task_id=?1 AND status='running'",
            params![task_id],
        ).map_err(AppError::database)?;
    }
    transaction.commit().map_err(AppError::database)?;
    Ok(next.into())
}

pub fn retry_task(connection: &mut Connection, task_id: &str) -> Result<(), AppError> {
    let affected = connection.execute(
        "UPDATE ai_tasks SET status='queued',available_at=?1,error_json=NULL,progress_stage='等待重试',
                progress_percent=5,worker_owner_id=NULL,lease_expires_at=NULL,heartbeat_at=NULL
         WHERE task_id=?2 AND worker_kind=?3 AND status='failed'
           AND retry_count < max_attempts-1
           AND json_extract(error_json,'$.retryable')=1
           AND NOT EXISTS (SELECT 1 FROM result_artifacts r WHERE r.task_id=ai_tasks.task_id)",
        params![Utc::now().to_rfc3339(),task_id,WORKER_KIND],
    ).map_err(AppError::database)?;
    if affected != 1 {
        return Err(AppError::new(
            codes::AI_TASK_RETRY_NOT_ALLOWED,
            "该任务当前不能重试",
            false,
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::migrations;
    use crate::services::ai_task_service::{self, CreateAiTaskInput};

    fn setup() -> Result<Connection, Box<dyn std::error::Error>> {
        let mut connection = Connection::open_in_memory()?;
        connection.execute_batch(
            "PRAGMA foreign_keys=ON;
             CREATE TABLE novels (id TEXT PRIMARY KEY,title TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,deleted_at TEXT);
             CREATE TABLE chapters (id TEXT PRIMARY KEY,novel_id TEXT NOT NULL,title TEXT NOT NULL,adopted_draft_id TEXT,status TEXT NOT NULL DEFAULT 'editing',word_count INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,deleted_at TEXT);
             CREATE TABLE chapter_drafts (id TEXT PRIMARY KEY,novel_id TEXT NOT NULL,chapter_id TEXT NOT NULL,content TEXT NOT NULL,version_no INTEGER NOT NULL,content_hash TEXT,large_text_ref_id TEXT,source TEXT NOT NULL DEFAULT 'user_edited',word_count INTEGER NOT NULL DEFAULT 0,is_adopted INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
             INSERT INTO novels VALUES ('novel-a','Novel','now','now',NULL);
             INSERT INTO chapters VALUES ('chapter-a','novel-a','Chapter','draft-a','editing',2,'now','now',NULL);
             INSERT INTO chapter_drafts VALUES ('draft-a','novel-a','chapter-a','source',1,'source-hash',NULL,'user_edited',1,1,'now','now');"
        )?;
        migrations::run_migrations(&mut connection)?;
        Ok(connection)
    }

    fn quality_input(operation_id: &str) -> CreateAiTaskInput {
        let mut input = ai_task_service::tests::task_input(operation_id);
        input.task_type = "quality_check".into();
        input.novel_id = "novel-a".into();
        input.chapter_id = Some("chapter-a".into());
        input.draft_id = Some("draft-a".into());
        input.scope_type = "draft".into();
        input.input_snapshot.input_type = "quality_check_input".into();
        input.input_snapshot.body = Some("source".into());
        input.input_snapshot.source_draft_id = Some("draft-a".into());
        input.input_snapshot.source_draft_version = Some(1);
        input.input_snapshot.base_content_hash = Some("source-hash".into());
        input.context_snapshot.compiled_context = Some(
            serde_json::to_string(&vec![AiChatMessage {
                role: "user".into(),
                content: "check".into(),
            }])
            .expect("messages"),
        );
        input.constraint_snapshot.provider_options_json = json!({
            "provider":"mock","model":"Mock","maxTokens":100,"timeoutSeconds":2
        });
        input
    }

    fn queued(connection: &mut Connection, suffix: &str) -> Result<String, AppError> {
        let task = ai_task_service::create_task(connection, quality_input(suffix))?;
        enqueue_task(connection, &task.task_id)?;
        Ok(task.task_id)
    }

    #[test]
    fn worker01_two_workers_cannot_claim_the_same_task() -> Result<(), Box<dyn std::error::Error>> {
        let mut connection = setup()?;
        let task_id = queued(&mut connection, "worker-claim")?;
        let first = claim_next(&mut connection, "owner-a")?.expect("first claim");
        assert_eq!(first.task_id, task_id);
        assert!(claim_next(&mut connection, "owner-b")?.is_none());
        assert_eq!(
            connection.query_row(
                "SELECT COUNT(*) FROM ai_task_attempts WHERE task_id=?1",
                params![task_id],
                |row| row.get::<_, i64>(0)
            )?,
            1
        );
        Ok(())
    }

    #[test]
    fn worker02_progress_and_lease_are_persisted() -> Result<(), Box<dyn std::error::Error>> {
        let mut connection = setup()?;
        let task_id = queued(&mut connection, "worker-progress")?;
        claim_next(&mut connection, "owner-a")?;
        let (status, stage, percent, owner, lease): (String,String,i64,Option<String>,Option<String>) = connection.query_row(
            "SELECT status,progress_stage,progress_percent,worker_owner_id,lease_expires_at FROM ai_tasks WHERE task_id=?1",
            params![task_id], |row| Ok((row.get(0)?,row.get(1)?,row.get(2)?,row.get(3)?,row.get(4)?)),
        )?;
        assert_eq!(status, "running");
        assert_eq!(stage, "后台任务已认领");
        assert_eq!(percent, 12);
        assert_eq!(owner.as_deref(), Some("owner-a"));
        assert!(lease.is_some());
        Ok(())
    }

    #[test]
    fn worker03_expired_lease_recovers_with_new_attempt() -> Result<(), Box<dyn std::error::Error>>
    {
        let mut connection = setup()?;
        let task_id = queued(&mut connection, "worker-recover")?;
        let first = claim_next(&mut connection, "owner-a")?.expect("claim");
        connection.execute(
            "UPDATE ai_tasks SET lease_expires_at='2000-01-01T00:00:00Z' WHERE task_id=?1",
            params![task_id],
        )?;
        assert_eq!(recover_expired_leases(&mut connection)?, 1);
        let second = claim_next(&mut connection, "owner-b")?.expect("recovered claim");
        assert_eq!(second.attempt_number, 2);
        assert_ne!(first.attempt_id, second.attempt_id);
        let interrupted: Option<String> = connection.query_row(
            "SELECT interrupted_at FROM ai_task_attempts WHERE attempt_id=?1",
            params![first.attempt_id],
            |row| row.get(0),
        )?;
        assert!(interrupted.is_some());
        Ok(())
    }

    #[test]
    fn worker04_cancel_request_reaches_terminal_cancelled() -> Result<(), Box<dyn std::error::Error>>
    {
        let mut connection = setup()?;
        let task_id = queued(&mut connection, "worker-cancel")?;
        let job = claim_next(&mut connection, "owner-a")?.expect("claim");
        assert_eq!(
            request_cancel(&mut connection, &task_id)?,
            "cancel_requested"
        );
        finalize_cancel_in_connection(&mut connection, &job)?;
        assert_eq!(
            connection.query_row(
                "SELECT status FROM ai_tasks WHERE task_id=?1",
                params![task_id],
                |row| row.get::<_, String>(0)
            )?,
            "cancelled"
        );
        Ok(())
    }

    #[test]
    fn worker05_temporary_error_queues_a_new_attempt() -> Result<(), Box<dyn std::error::Error>> {
        let mut connection = setup()?;
        queued(&mut connection, "worker-retry")?;
        let first = claim_next(&mut connection, "owner-a")?.expect("claim");
        let retryable = WorkerFailure {
            error: AppError::new(codes::AI_PROVIDER_TIMEOUT, "timeout", true),
        };
        assert_eq!(
            finalize_failure_in_connection(&mut connection, &first, retryable)?,
            "queued"
        );
        connection.execute(
            "UPDATE ai_tasks SET available_at='2000-01-01T00:00:00Z' WHERE task_id=?1",
            params![first.task_id],
        )?;
        let second = claim_next(&mut connection, "owner-b")?.expect("retry claim");
        assert_eq!(second.attempt_number, 2);
        Ok(())
    }

    #[test]
    fn worker06_success_creates_exactly_one_artifact_and_no_canon_write(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let mut connection = setup()?;
        let task_id = queued(&mut connection, "worker-success")?;
        let job = claim_next(&mut connection, "owner-a")?.expect("claim");
        let response = AiChatCompletionResponse {
            text: json!({"overallScore":88,"summary":"ok","items":[]}).to_string(),
            raw: json!({}),
            token_input: Some(1),
            token_output: Some(1),
            total_tokens: Some(2),
        };
        assert_eq!(
            persist_success(&mut connection, &job, &response)?,
            "completed"
        );
        assert_eq!(
            persist_success(&mut connection, &job, &response)?,
            "completed"
        );
        assert_eq!(
            connection.query_row(
                "SELECT COUNT(*) FROM result_artifacts WHERE task_id=?1",
                params![task_id],
                |row| row.get::<_, i64>(0)
            )?,
            1
        );
        assert_eq!(
            connection.query_row("SELECT COUNT(*) FROM chapter_drafts", [], |row| row
                .get::<_, i64>(0))?,
            1
        );
        assert_eq!(
            connection.query_row(
                "SELECT adopted_draft_id FROM chapters WHERE id='chapter-a'",
                [],
                |row| row.get::<_, String>(0)
            )?,
            "draft-a"
        );
        Ok(())
    }

    #[test]
    fn worker07_malformed_result_fails_and_is_not_reported_success(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let mut connection = setup()?;
        let task_id = queued(&mut connection, "worker-malformed")?;
        let job = claim_next(&mut connection, "owner-a")?.expect("claim");
        let response = AiChatCompletionResponse {
            text: "not-json".into(),
            raw: json!({}),
            token_input: None,
            token_output: None,
            total_tokens: None,
        };
        assert_eq!(persist_success(&mut connection, &job, &response)?, "failed");
        assert_eq!(
            connection.query_row(
                "SELECT status FROM ai_tasks WHERE task_id=?1",
                params![task_id],
                |row| row.get::<_, String>(0)
            )?,
            "failed"
        );
        assert_eq!(connection.query_row("SELECT COUNT(*) FROM result_artifacts WHERE task_id=?1 AND processing_status='invalid'", params![task_id], |row| row.get::<_, i64>(0))?, 1);
        Ok(())
    }

    #[test]
    fn worker08_mock_provider_honors_cancellation_token() -> Result<(), Box<dyn std::error::Error>>
    {
        let mut connection = setup()?;
        queued(&mut connection, "worker-token-cancel")?;
        let job = claim_next(&mut connection, "owner-a")?.expect("claim");
        let config = WorkerProviderConfig {
            runtime_mode: "mock".into(),
            provider_id: "mock".into(),
            base_url: None,
            api_key: None,
            model_name: "Mock".into(),
            timeout_seconds: Some(2),
        };
        let token = CancellationToken::new();
        token.cancel();
        let result = tauri::async_runtime::block_on(call_provider(&config, &job, token));
        assert_eq!(
            result.expect_err("cancelled").error.code,
            codes::AI_PROVIDER_CANCELLED
        );
        Ok(())
    }

    fn workflow(
        connection: &mut Connection,
    ) -> Result<workflow_service::WorkflowCreated, AppError> {
        workflow_service::create_chapter_summary_workflow(
            connection,
            workflow_service::CreateChapterSummaryWorkflowInput {
                novel_id: "novel-a".into(),
                chapter_id: "chapter-a".into(),
                draft_id: "draft-a".into(),
                workflow_name: Some("Summary workflow".into()),
                provider_options_json: json!({"provider":"mock","model":"Mock","maxTokens":100}),
            },
        )
    }

    #[test]
    fn worker09_dependency_is_rechecked_at_claim_time() -> Result<(), Box<dyn std::error::Error>> {
        let mut connection = setup()?;
        let created = workflow(&mut connection)?;
        connection.execute(
            "UPDATE ai_tasks SET status='queued' WHERE task_id=?1",
            params![created.child_task_ids[1]],
        )?;
        let first = claim_next(&mut connection, "owner-a")?.expect("first step");
        assert_eq!(first.step_key.as_deref(), Some("prepare_materials"));
        assert!(claim_next(&mut connection, "owner-b")?.is_none());
        Ok(())
    }

    #[test]
    fn worker10_parallel_nodes_are_claimed_once_each() -> Result<(), Box<dyn std::error::Error>> {
        let mut connection = setup()?;
        let created = workflow(&mut connection)?;
        connection.execute(
            "DELETE FROM ai_task_dependencies WHERE task_id IN (?1,?2)",
            params![created.child_task_ids[1], created.child_task_ids[2]],
        )?;
        connection.execute(
            "UPDATE ai_tasks SET status='queued' WHERE task_id IN (?1,?2)",
            params![created.child_task_ids[1], created.child_task_ids[2]],
        )?;
        let first = claim_next(&mut connection, "owner-a")?.expect("parallel first");
        let second = claim_next(&mut connection, "owner-b")?.expect("parallel second");
        assert_ne!(first.task_id, second.task_id);
        assert_eq!(
            connection.query_row(
                "SELECT COUNT(DISTINCT task_id) FROM ai_task_attempts WHERE task_id IN (?1,?2,?3)",
                params![
                    created.child_task_ids[0],
                    created.child_task_ids[1],
                    created.child_task_ids[2]
                ],
                |row| row.get::<_, i64>(0)
            )?,
            2
        );
        Ok(())
    }

    #[test]
    fn worker11_mock_workflow_creates_one_review_bundle_without_canon_write(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let mut connection = setup()?;
        let created = workflow(&mut connection)?;
        let config = WorkerProviderConfig {
            runtime_mode: "mock".into(),
            provider_id: "mock".into(),
            base_url: None,
            api_key: None,
            model_name: "Mock".into(),
            timeout_seconds: Some(2),
        };
        for index in 0..4 {
            workflow_service::refresh_orchestration(&connection)?;
            let job =
                claim_next(&mut connection, &format!("owner-{index}"))?.expect("workflow step");
            let response = tauri::async_runtime::block_on(call_provider(
                &config,
                &job,
                CancellationToken::new(),
            ))
            .map_err(|failure| failure.error)?;
            assert_eq!(
                persist_success(&mut connection, &job, &response)?,
                "completed"
            );
        }
        workflow_service::refresh_orchestration(&connection)?;
        assert_eq!(
            connection.query_row(
                "SELECT status FROM ai_tasks WHERE task_id=?1",
                params![created.root_task_id],
                |row| row.get::<_, String>(0)
            )?,
            "completed"
        );
        assert_eq!(
            connection.query_row(
                "SELECT progress_percent FROM ai_tasks WHERE task_id=?1",
                params![created.root_task_id],
                |row| row.get::<_, i64>(0)
            )?,
            100
        );
        assert_eq!(connection.query_row("SELECT COUNT(*) FROM ai_task_attempts a JOIN ai_tasks t ON t.task_id=a.task_id WHERE t.workflow_id=?1",params![created.workflow_id],|row| row.get::<_,i64>(0))?,4);
        assert_eq!(connection.query_row("SELECT COUNT(*) FROM result_artifacts r JOIN ai_tasks t ON t.task_id=r.task_id WHERE t.workflow_id=?1",params![created.workflow_id],|row| row.get::<_,i64>(0))?,4);
        assert_eq!(connection.query_row("SELECT COUNT(*) FROM result_artifacts r JOIN ai_tasks t ON t.task_id=r.task_id WHERE t.workflow_id=?1 AND t.step_key='review_bundle'",params![created.workflow_id],|row| row.get::<_,i64>(0))?,1);
        assert!(connection
            .query_row(
                "SELECT result_artifact_id FROM ai_tasks WHERE task_id=?1",
                params![created.root_task_id],
                |row| row.get::<_, Option<String>>(0)
            )?
            .is_some());
        assert_eq!(
            connection.query_row("SELECT COUNT(*) FROM chapter_drafts", [], |row| row
                .get::<_, i64>(0))?,
            1
        );
        assert_eq!(
            connection.query_row(
                "SELECT adopted_draft_id FROM chapters WHERE id='chapter-a'",
                [],
                |row| row.get::<_, String>(0)
            )?,
            "draft-a"
        );
        Ok(())
    }

    #[test]
    fn worker12_local_retry_creates_attempt_only_for_failed_child(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let mut connection = setup()?;
        let created = workflow(&mut connection)?;
        let first = claim_next(&mut connection, "owner-prepare")?.expect("prepare");
        let config = WorkerProviderConfig {
            runtime_mode: "mock".into(),
            provider_id: "mock".into(),
            base_url: None,
            api_key: None,
            model_name: "Mock".into(),
            timeout_seconds: Some(2),
        };
        let response = tauri::async_runtime::block_on(call_provider(
            &config,
            &first,
            CancellationToken::new(),
        ))
        .map_err(|failure| failure.error)?;
        persist_success(&mut connection, &first, &response)?;
        workflow_service::refresh_orchestration(&connection)?;
        let failed = claim_next(&mut connection, "owner-summary")?.expect("summary");
        finalize_failure_in_connection(
            &mut connection,
            &failed,
            WorkerFailure {
                error: AppError::new(codes::AI_PROVIDER_MALFORMED_RESPONSE, "invalid", false),
            },
        )?;
        workflow_service::retry_child(&connection, &failed.task_id)?;
        let retried = claim_next(&mut connection, "owner-summary-retry")?.expect("summary retry");
        assert_eq!(retried.task_id, failed.task_id);
        assert_eq!(retried.attempt_number, 2);
        assert_eq!(
            connection.query_row(
                "SELECT COUNT(*) FROM ai_task_attempts WHERE task_id=?1",
                params![created.child_task_ids[0]],
                |row| row.get::<_, i64>(0)
            )?,
            1
        );
        assert_eq!(
            connection.query_row(
                "SELECT COUNT(*) FROM ai_task_attempts WHERE task_id=?1",
                params![created.child_task_ids[2]],
                |row| row.get::<_, i64>(0)
            )?,
            0
        );
        Ok(())
    }

    #[test]
    fn worker13_stage_2d_polish_creates_one_review_artifact_and_proposal_only(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let mut connection = setup()?;
        let created = workflow_service::create_background_workflow(
            &mut connection,
            workflow_service::CreateBackgroundWorkflowInput {
                operation_id: "stage2d-polish".into(),
                workflow_name: "正文润色".into(),
                task_type: "chapter_polish".into(),
                novel_id: "novel-a".into(),
                chapter_id: Some("chapter-a".into()),
                draft_id: Some("draft-a".into()),
                scope_type: "draft".into(),
                target_hint_json: Some(json!({"staleAgainstLatest":true})),
                input_payload_json: json!({"mode":"light"}),
                input_body: Some("source".into()),
                source_manifest_json: json!([{"type":"chapter_draft","id":"draft-a"}]),
                source_draft_version: Some(1),
                base_content_hash: Some("source-hash".into()),
                provider_options_json: json!({"provider":"mock","model":"Mock"}),
                steps: vec![workflow_service::BackgroundWorkflowStepInput {
                    step_key: "polish".into(),
                    task_type: "chapter_polish".into(),
                    agent_role: "润色".into(),
                    artifact_type: "chapter_text".into(),
                    messages: json!([{"role":"user","content":"polish"}]),
                    dependencies: vec![],
                    priority: None,
                    review_output: true,
                }],
            },
        )?;
        let job = claim_next(&mut connection, "owner-polish")?.expect("polish claim");
        let config = WorkerProviderConfig {
            runtime_mode: "mock".into(),
            provider_id: "mock".into(),
            base_url: None,
            api_key: None,
            model_name: "Mock".into(),
            timeout_seconds: Some(2),
        };
        let response =
            tauri::async_runtime::block_on(call_provider(&config, &job, CancellationToken::new()))
                .map_err(|failure| failure.error)?;
        assert_eq!(
            persist_success(&mut connection, &job, &response)?,
            "completed"
        );
        assert_eq!(connection.query_row("SELECT COUNT(*) FROM result_artifacts WHERE task_id=?1 AND artifact_type='chapter_text'",params![job.task_id],|row| row.get::<_,i64>(0))?,1);
        assert_eq!(connection.query_row("SELECT COUNT(*) FROM artifact_placement_proposals p JOIN result_artifacts r ON r.artifact_id=p.artifact_id WHERE r.task_id=?1",params![job.task_id],|row| row.get::<_,i64>(0))?,1);
        assert!(connection
            .query_row(
                "SELECT result_artifact_id FROM ai_tasks WHERE task_id=?1",
                params![created.root_task_id],
                |row| row.get::<_, Option<String>>(0)
            )?
            .is_some());
        assert_eq!(
            connection.query_row("SELECT COUNT(*) FROM chapter_drafts", [], |row| row
                .get::<_, i64>(0))?,
            1
        );
        assert_eq!(
            connection.query_row(
                "SELECT adopted_draft_id FROM chapters WHERE id='chapter-a'",
                [],
                |row| row.get::<_, String>(0)
            )?,
            "draft-a"
        );
        Ok(())
    }

    #[test]
    fn worker14_stage_2d_mock_covers_summary_and_outline_artifact_contracts(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let mut connection = setup()?;
        let config = WorkerProviderConfig {
            runtime_mode: "mock".into(),
            provider_id: "mock".into(),
            base_url: None,
            api_key: None,
            model_name: "Mock".into(),
            timeout_seconds: Some(2),
        };
        let specs = [
            ("chapter_summary", "chapter_summary", true),
            ("volume_summary", "volume_summary", false),
            ("outline_generate", "outline_text", false),
            ("volume_outline_generate", "volume_outline", false),
            ("chapter_outline_generate", "chapter_outlines", false),
        ];
        for (index, (task_type, artifact_type, with_draft)) in specs.into_iter().enumerate() {
            let created = workflow_service::create_background_workflow(
                &mut connection,
                workflow_service::CreateBackgroundWorkflowInput {
                    operation_id: format!("stage2d-contract-{index}"),
                    workflow_name: format!("contract-{task_type}"),
                    task_type: task_type.into(),
                    novel_id: "novel-a".into(),
                    chapter_id: with_draft.then(|| "chapter-a".into()),
                    draft_id: with_draft.then(|| "draft-a".into()),
                    scope_type: if with_draft { "draft" } else { "novel" }.into(),
                    target_hint_json: None,
                    input_payload_json: json!({}),
                    input_body: Some("source".into()),
                    source_manifest_json: json!([]),
                    source_draft_version: with_draft.then_some(1),
                    base_content_hash: with_draft.then(|| "source-hash".into()),
                    provider_options_json: json!({"provider":"mock","model":"Mock"}),
                    steps: vec![workflow_service::BackgroundWorkflowStepInput {
                        step_key: task_type.into(),
                        task_type: task_type.into(),
                        agent_role: "contract".into(),
                        artifact_type: artifact_type.into(),
                        messages: json!([{"role":"user","content":"run"}]),
                        dependencies: vec![],
                        priority: None,
                        review_output: true,
                    }],
                },
            )?;
            let job = claim_next(&mut connection, &format!("owner-contract-{index}"))?
                .expect("contract claim");
            let response = tauri::async_runtime::block_on(call_provider(
                &config,
                &job,
                CancellationToken::new(),
            ))
            .map_err(|failure| failure.error)?;
            assert_eq!(
                persist_success(&mut connection, &job, &response)?,
                "completed"
            );
            assert_eq!(
                connection.query_row(
                    "SELECT artifact_type FROM result_artifacts WHERE task_id=?1",
                    params![job.task_id],
                    |row| row.get::<_, String>(0)
                )?,
                artifact_type
            );
            assert_eq!(connection.query_row("SELECT COUNT(*) FROM artifact_placement_proposals p JOIN result_artifacts r ON r.artifact_id=p.artifact_id WHERE r.task_id=?1",params![job.task_id],|row| row.get::<_,i64>(0))?,1);
            assert!(connection
                .query_row(
                    "SELECT result_artifact_id FROM ai_tasks WHERE task_id=?1",
                    params![created.root_task_id],
                    |row| row.get::<_, Option<String>>(0)
                )?
                .is_some());
        }
        assert_eq!(
            connection.query_row("SELECT COUNT(*) FROM chapter_drafts", [], |row| row
                .get::<_, i64>(0))?,
            1
        );
        assert_eq!(
            connection.query_row(
                "SELECT adopted_draft_id FROM chapters WHERE id='chapter-a'",
                [],
                |row| row.get::<_, String>(0)
            )?,
            "draft-a"
        );
        Ok(())
    }

    #[test]
    fn worker15_stage_2d_quality_fix_recheck_runs_in_dependency_order_without_auto_apply(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let mut connection = setup()?;
        let created = workflow_service::create_background_workflow(
            &mut connection,
            workflow_service::CreateBackgroundWorkflowInput {
                operation_id: "stage2d-fix-recheck".into(),
                workflow_name: "修复复检".into(),
                task_type: "quality_fix".into(),
                novel_id: "novel-a".into(),
                chapter_id: Some("chapter-a".into()),
                draft_id: Some("draft-a".into()),
                scope_type: "draft".into(),
                target_hint_json: Some(json!({"staleAgainstLatest":true})),
                input_payload_json: json!({}),
                input_body: Some("source".into()),
                source_manifest_json: json!([]),
                source_draft_version: Some(1),
                base_content_hash: Some("source-hash".into()),
                provider_options_json: json!({"provider":"mock","model":"Mock"}),
                steps: vec![
                    workflow_service::BackgroundWorkflowStepInput {
                        step_key: "quality_fix".into(),
                        task_type: "quality_fix".into(),
                        agent_role: "fix".into(),
                        artifact_type: "chapter_text".into(),
                        messages: json!([{"role":"user","content":"fix"}]),
                        dependencies: vec![],
                        priority: Some(10),
                        review_output: false,
                    },
                    workflow_service::BackgroundWorkflowStepInput {
                        step_key: "quality_recheck".into(),
                        task_type: "quality_recheck".into(),
                        agent_role: "review".into(),
                        artifact_type: "quality_report".into(),
                        messages: json!([{"role":"user","content":"review"}]),
                        dependencies: vec!["quality_fix".into()],
                        priority: Some(20),
                        review_output: true,
                    },
                ],
            },
        )?;
        let config = WorkerProviderConfig {
            runtime_mode: "mock".into(),
            provider_id: "mock".into(),
            base_url: None,
            api_key: None,
            model_name: "Mock".into(),
            timeout_seconds: Some(2),
        };
        let fix = claim_next(&mut connection, "owner-fix")?.expect("fix claim");
        assert_eq!(fix.task_type, "quality_fix");
        let fix_response =
            tauri::async_runtime::block_on(call_provider(&config, &fix, CancellationToken::new()))
                .map_err(|failure| failure.error)?;
        persist_success(&mut connection, &fix, &fix_response)?;
        workflow_service::refresh_orchestration(&connection)?;
        let recheck = claim_next(&mut connection, "owner-recheck")?.expect("recheck claim");
        assert_eq!(recheck.task_type, "quality_recheck");
        assert_eq!(recheck.dependencies.len(), 1);
        let recheck_response = tauri::async_runtime::block_on(call_provider(
            &config,
            &recheck,
            CancellationToken::new(),
        ))
        .map_err(|failure| failure.error)?;
        persist_success(&mut connection, &recheck, &recheck_response)?;
        assert_eq!(
            connection.query_row(
                "SELECT artifact_type FROM result_artifacts WHERE task_id=?1",
                params![recheck.task_id],
                |row| row.get::<_, String>(0)
            )?,
            "quality_report"
        );
        assert!(connection
            .query_row(
                "SELECT result_artifact_id FROM ai_tasks WHERE task_id=?1",
                params![created.root_task_id],
                |row| row.get::<_, Option<String>>(0)
            )?
            .is_some());
        assert_eq!(
            connection.query_row("SELECT COUNT(*) FROM chapter_drafts", [], |row| row
                .get::<_, i64>(0))?,
            1
        );
        assert_eq!(
            connection.query_row(
                "SELECT adopted_draft_id FROM chapters WHERE id='chapter-a'",
                [],
                |row| row.get::<_, String>(0)
            )?,
            "draft-a"
        );
        Ok(())
    }

    fn quality_revision_workflow(
        connection: &mut Connection,
        operation_id: &str,
    ) -> Result<workflow_service::WorkflowCreated, AppError> {
        workflow_service::create_background_workflow(
            connection,
            workflow_service::CreateBackgroundWorkflowInput {
                operation_id: operation_id.into(),
                workflow_name: "章节质量审查与修订候选".into(),
                task_type: "quality_revision".into(),
                novel_id: "novel-a".into(),
                chapter_id: Some("chapter-a".into()),
                draft_id: Some("draft-a".into()),
                scope_type: "draft".into(),
                target_hint_json: Some(json!({"staleAgainstLatest":true,"automaticApply":false})),
                input_payload_json: json!({"workflowKind":"chapter_quality_revision"}),
                input_body: Some("source".into()),
                source_manifest_json: json!([{"type":"chapter_draft","id":"draft-a","version":1,"hash":"source-hash"}]),
                source_draft_version: Some(1),
                base_content_hash: Some("source-hash".into()),
                provider_options_json: json!({"provider":"mock","model":"Mock","maxTokens":100}),
                steps: vec![
                    workflow_service::BackgroundWorkflowStepInput {
                        step_key: "freeze_chapter".into(),
                        task_type: "workflow_freeze_chapter".into(),
                        agent_role: "freeze".into(),
                        artifact_type: "generic_json".into(),
                        messages: json!([]),
                        dependencies: vec![],
                        priority: Some(10),
                        review_output: false,
                    },
                    workflow_service::BackgroundWorkflowStepInput {
                        step_key: "quality_check".into(),
                        task_type: "quality_check".into(),
                        agent_role: "check".into(),
                        artifact_type: "quality_report".into(),
                        messages: json!([{"role":"user","content":"check"}]),
                        dependencies: vec!["freeze_chapter".into()],
                        priority: Some(20),
                        review_output: false,
                    },
                    workflow_service::BackgroundWorkflowStepInput {
                        step_key: "quality_fix".into(),
                        task_type: "quality_fix".into(),
                        agent_role: "fix".into(),
                        artifact_type: "chapter_text".into(),
                        messages: json!([{"role":"user","content":"fix"}]),
                        dependencies: vec!["quality_check".into()],
                        priority: Some(30),
                        review_output: false,
                    },
                    workflow_service::BackgroundWorkflowStepInput {
                        step_key: "quality_recheck".into(),
                        task_type: "quality_recheck".into(),
                        agent_role: "recheck".into(),
                        artifact_type: "quality_report".into(),
                        messages: json!([{"role":"user","content":"recheck"}]),
                        dependencies: vec!["quality_fix".into()],
                        priority: Some(40),
                        review_output: false,
                    },
                    workflow_service::BackgroundWorkflowStepInput {
                        step_key: "review_bundle".into(),
                        task_type: "workflow_quality_review_bundle".into(),
                        agent_role: "review".into(),
                        artifact_type: "generic_json".into(),
                        messages: json!([]),
                        dependencies: vec![
                            "quality_check".into(),
                            "quality_fix".into(),
                            "quality_recheck".into(),
                        ],
                        priority: Some(50),
                        review_output: true,
                    },
                ],
            },
        )
    }

    #[test]
    fn worker16_stage_2e_quality_revision_completes_once_without_canon_write(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let mut connection = setup()?;
        let created = quality_revision_workflow(&mut connection, "stage2e-success")?;
        let config = WorkerProviderConfig {
            runtime_mode: "mock".into(),
            provider_id: "mock".into(),
            base_url: None,
            api_key: None,
            model_name: "Mock".into(),
            timeout_seconds: Some(2),
        };
        let mut order = Vec::new();
        for index in 0..5 {
            workflow_service::refresh_orchestration(&connection)?;
            let job = claim_next(&mut connection, &format!("owner-stage2e-{index}"))?
                .expect("quality revision step");
            order.push(job.task_type.clone());
            let response = tauri::async_runtime::block_on(call_provider(
                &config,
                &job,
                CancellationToken::new(),
            ))
            .map_err(|failure| failure.error)?;
            assert_eq!(
                persist_success(&mut connection, &job, &response)?,
                "completed"
            );
        }
        assert_eq!(
            order,
            vec![
                "workflow_freeze_chapter",
                "quality_check",
                "quality_fix",
                "quality_recheck",
                "workflow_quality_review_bundle"
            ]
        );
        assert_eq!(
            connection.query_row(
                "SELECT status FROM ai_tasks WHERE task_id=?1",
                params![created.root_task_id],
                |row| row.get::<_, String>(0)
            )?,
            "completed"
        );
        assert_eq!(connection.query_row("SELECT COUNT(*) FROM ai_task_attempts a JOIN ai_tasks t ON t.task_id=a.task_id WHERE t.workflow_id=?1",params![created.workflow_id],|row| row.get::<_,i64>(0))?,5);
        assert_eq!(connection.query_row("SELECT COUNT(*) FROM result_artifacts r JOIN ai_tasks t ON t.task_id=r.task_id WHERE t.workflow_id=?1",params![created.workflow_id],|row| row.get::<_,i64>(0))?,5);
        assert_eq!(connection.query_row("SELECT COUNT(*) FROM result_artifacts r JOIN ai_tasks t ON t.task_id=r.task_id WHERE t.workflow_id=?1 AND t.step_key='review_bundle'",params![created.workflow_id],|row| row.get::<_,i64>(0))?,1);
        let bundle_id = connection.query_row(
            "SELECT result_artifact_id FROM ai_tasks WHERE task_id=?1",
            params![created.root_task_id],
            |row| row.get::<_, String>(0),
        )?;
        let bundle: String = connection.query_row(
            "SELECT structured_payload_json FROM result_artifacts WHERE artifact_id=?1",
            params![bundle_id],
            |row| row.get(0),
        )?;
        let bundle: Value = serde_json::from_str(&bundle)?;
        assert!(bundle
            .get("repairArtifactId")
            .and_then(Value::as_str)
            .is_some());
        assert_eq!(
            connection.query_row("SELECT COUNT(*) FROM chapter_drafts", [], |row| row
                .get::<_, i64>(0))?,
            1
        );
        assert_eq!(
            connection.query_row(
                "SELECT adopted_draft_id FROM chapters WHERE id='chapter-a'",
                [],
                |row| row.get::<_, String>(0)
            )?,
            "draft-a"
        );
        assert_eq!(
            connection.query_row("SELECT COUNT(*) FROM artifact_apply_plans", [], |row| row
                .get::<_, i64>(
                0
            ))?,
            0
        );
        Ok(())
    }

    #[test]
    fn worker17_stage_2e_local_retry_only_repeats_failed_child(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let mut connection = setup()?;
        let created = quality_revision_workflow(&mut connection, "stage2e-retry")?;
        let config = WorkerProviderConfig {
            runtime_mode: "mock".into(),
            provider_id: "mock".into(),
            base_url: None,
            api_key: None,
            model_name: "Mock".into(),
            timeout_seconds: Some(2),
        };
        for owner in ["freeze", "check"] {
            workflow_service::refresh_orchestration(&connection)?;
            let job = claim_next(&mut connection, owner)?.expect("successful prerequisite");
            let response = tauri::async_runtime::block_on(call_provider(
                &config,
                &job,
                CancellationToken::new(),
            ))
            .map_err(|failure| failure.error)?;
            persist_success(&mut connection, &job, &response)?;
        }
        workflow_service::refresh_orchestration(&connection)?;
        let failed = claim_next(&mut connection, "failed-fix")?.expect("fix claim");
        assert_eq!(failed.task_type, "quality_fix");
        finalize_failure_in_connection(
            &mut connection,
            &failed,
            WorkerFailure {
                error: AppError::new(codes::AI_PROVIDER_MALFORMED_RESPONSE, "invalid", false),
            },
        )?;
        workflow_service::retry_child(&connection, &failed.task_id)?;
        let retry = claim_next(&mut connection, "retry-fix")?.expect("retry claim");
        assert_eq!(retry.task_id, failed.task_id);
        assert_eq!(retry.attempt_number, 2);
        assert_eq!(
            connection.query_row(
                "SELECT COUNT(*) FROM ai_task_attempts WHERE task_id=?1",
                params![created.child_task_ids[0]],
                |row| row.get::<_, i64>(0)
            )?,
            1
        );
        assert_eq!(
            connection.query_row(
                "SELECT COUNT(*) FROM ai_task_attempts WHERE task_id=?1",
                params![created.child_task_ids[1]],
                |row| row.get::<_, i64>(0)
            )?,
            1
        );
        Ok(())
    }

    #[test]
    fn worker18_stage_2e_stale_late_response_creates_no_artifact(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let mut connection = setup()?;
        let created = quality_revision_workflow(&mut connection, "stage2e-stale")?;
        let running = claim_next(&mut connection, "stale-freeze")?.expect("freeze claim");
        connection.execute(
            "INSERT INTO chapter_drafts(id,novel_id,chapter_id,content,version_no,content_hash,large_text_ref_id,source,word_count,is_adopted,created_at,updated_at)
             VALUES ('draft-new','novel-a','chapter-a','changed',2,'changed-hash',NULL,'user_edited',1,0,'later','later')",
            [],
        )?;
        workflow_service::refresh_orchestration(&connection)?;
        assert_eq!(
            connection.query_row(
                "SELECT COUNT(*) FROM ai_tasks WHERE workflow_id=?1 AND stale_at IS NOT NULL",
                params![created.workflow_id],
                |row| row.get::<_, i64>(0)
            )?,
            6
        );
        let config = WorkerProviderConfig {
            runtime_mode: "mock".into(),
            provider_id: "mock".into(),
            base_url: None,
            api_key: None,
            model_name: "Mock".into(),
            timeout_seconds: Some(2),
        };
        let response = tauri::async_runtime::block_on(call_provider(
            &config,
            &running,
            CancellationToken::new(),
        ))
        .map_err(|failure| failure.error)?;
        assert_eq!(
            persist_success(&mut connection, &running, &response)?,
            "failed"
        );
        assert_eq!(
            connection.query_row(
                "SELECT COUNT(*) FROM result_artifacts WHERE task_id=?1",
                params![running.task_id],
                |row| row.get::<_, i64>(0)
            )?,
            0
        );
        assert!(claim_next(&mut connection, "after-stale")?.is_none());
        Ok(())
    }
}

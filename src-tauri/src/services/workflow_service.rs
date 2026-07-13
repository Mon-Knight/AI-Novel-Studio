use crate::errors::{codes, AppError};
use crate::repositories::large_text_repository;
use crate::services::ai_task_service::{
    self, ConstraintSnapshotInput, ContextSnapshotInput, CreateAiTaskInput, InputSnapshotInput,
};
use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

pub const WORKFLOW_PARENT_TYPE: &str = "chapter_summary_workflow";
pub const WORKFLOW_WORKER_KIND: &str = "workflow_step";
const SUMMARY_WORKFLOW_TEMPLATE: &str =
    include_str!("../../../prompts/chapter-summary-workflow.md");

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateChapterSummaryWorkflowInput {
    pub novel_id: String,
    pub chapter_id: String,
    pub draft_id: String,
    pub workflow_name: Option<String>,
    pub provider_options_json: Value,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowCreated {
    pub workflow_id: String,
    pub root_task_id: String,
    pub child_task_ids: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackgroundWorkflowStepInput {
    pub step_key: String,
    pub task_type: String,
    pub agent_role: String,
    pub artifact_type: String,
    pub messages: Value,
    #[serde(default)]
    pub dependencies: Vec<String>,
    #[serde(default)]
    pub priority: Option<i64>,
    #[serde(default)]
    pub review_output: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateBackgroundWorkflowInput {
    pub operation_id: String,
    pub workflow_name: String,
    pub task_type: String,
    pub novel_id: String,
    pub chapter_id: Option<String>,
    pub draft_id: Option<String>,
    pub scope_type: String,
    pub target_hint_json: Option<Value>,
    pub input_payload_json: Value,
    pub input_body: Option<String>,
    pub source_manifest_json: Value,
    pub source_draft_version: Option<i64>,
    pub base_content_hash: Option<String>,
    pub provider_options_json: Value,
    pub steps: Vec<BackgroundWorkflowStepInput>,
}

#[derive(Debug, Clone)]
pub struct DependencyArtifact {
    pub artifact_id: String,
    pub artifact_type: String,
    pub content: String,
}

fn frozen_input(
    operation_id: String,
    task_type: &str,
    novel_id: &str,
    chapter_id: &str,
    draft_id: &str,
    draft_version: i64,
    base_hash: &str,
    body: &str,
    messages: Value,
    provider_options_json: Value,
) -> CreateAiTaskInput {
    let template_id = "chapter-summary-workflow";
    CreateAiTaskInput {
        operation_id,
        request_hash: None,
        trace_id: None,
        task_type: task_type.to_string(),
        novel_id: novel_id.to_string(),
        chapter_id: Some(chapter_id.to_string()),
        draft_id: Some(draft_id.to_string()),
        scope_type: "draft".into(),
        target_hint_json: None,
        input_snapshot: InputSnapshotInput {
            schema_version: 1,
            input_type: format!("{task_type}_input"),
            payload_json: json!({ "draftVersion": draft_version, "baseContentHash": base_hash }),
            body: Some(body.to_string()),
            source_draft_id: Some(draft_id.to_string()),
            source_draft_version: Some(draft_version),
            base_content_hash: Some(base_hash.to_string()),
        },
        context_snapshot: ContextSnapshotInput {
            schema_version: 1,
            source_manifest_json: json!([{ "type": "chapter_draft", "id": draft_id, "version": draft_version, "hash": base_hash }]),
            compiled_context: Some(messages.to_string()),
            budget_json: json!({ "maxTokens": 4000 }),
            compiler_version: "chapter-summary-workflow-v1".into(),
        },
        constraint_snapshot: ConstraintSnapshotInput {
            schema_version: 1,
            payload_json: json!({ "reviewRequired": true, "automaticApply": false }),
            prompt_template_id: template_id.into(),
            prompt_template_version: "1".into(),
            prompt_template_hash: large_text_repository::sha256(SUMMARY_WORKFLOW_TEMPLATE),
            prompt_template_body: Some(SUMMARY_WORKFLOW_TEMPLATE.into()),
            provider_options_json,
        },
    }
}

#[allow(clippy::too_many_arguments)]
fn background_frozen_input(
    operation_id: String,
    task_type: &str,
    novel_id: &str,
    chapter_id: Option<&str>,
    draft_id: Option<&str>,
    scope_type: &str,
    target_hint_json: Option<Value>,
    input_payload_json: Value,
    input_body: Option<String>,
    source_manifest_json: Value,
    source_draft_version: Option<i64>,
    base_content_hash: Option<String>,
    messages: Value,
    provider_options_json: Value,
) -> CreateAiTaskInput {
    let prompt_body = messages.to_string();
    CreateAiTaskInput {
        operation_id,
        request_hash: None,
        trace_id: None,
        task_type: task_type.to_string(),
        novel_id: novel_id.to_string(),
        chapter_id: chapter_id.map(str::to_owned),
        draft_id: draft_id.map(str::to_owned),
        scope_type: scope_type.to_string(),
        target_hint_json,
        input_snapshot: InputSnapshotInput {
            schema_version: 1,
            input_type: format!("{task_type}_input"),
            payload_json: input_payload_json,
            body: input_body,
            source_draft_id: draft_id.map(str::to_owned),
            source_draft_version,
            base_content_hash,
        },
        context_snapshot: ContextSnapshotInput {
            schema_version: 1,
            source_manifest_json,
            compiled_context: Some(prompt_body.clone()),
            budget_json: json!({ "source": "stage_2d_background_workflow" }),
            compiler_version: "stage-2d-background-v1".into(),
        },
        constraint_snapshot: ConstraintSnapshotInput {
            schema_version: 1,
            payload_json: json!({ "reviewRequired": true, "automaticApply": false }),
            prompt_template_id: format!("stage-2d-{task_type}"),
            prompt_template_version: "1".into(),
            prompt_template_hash: large_text_repository::sha256(&prompt_body),
            prompt_template_body: Some(prompt_body),
            provider_options_json,
        },
    }
}

#[allow(clippy::too_many_arguments)]
fn attach_node(
    connection: &Connection,
    task_id: &str,
    workflow_id: &str,
    workflow_name: &str,
    root_task_id: &str,
    parent_task_id: Option<&str>,
    step_key: &str,
    agent_role: &str,
    priority: i64,
    worker_kind: Option<&str>,
    queued: bool,
) -> Result<(), AppError> {
    let affected = connection
        .execute(
            "UPDATE ai_tasks SET workflow_id=?1,workflow_name=?2,root_task_id=?3,parent_task_id=?4,
                step_key=?5,agent_role=?6,priority=?7,worker_kind=?8,
                status=CASE WHEN ?9=1 THEN 'queued' ELSE status END,
                available_at=CASE WHEN ?9=1 THEN ?10 ELSE available_at END,
                progress_stage=CASE WHEN ?9=1 THEN '等待后台执行' ELSE '等待依赖' END
         WHERE task_id=?11",
            params![
                workflow_id,
                workflow_name,
                root_task_id,
                parent_task_id,
                step_key,
                agent_role,
                priority,
                worker_kind,
                if queued { 1 } else { 0 },
                Utc::now().to_rfc3339(),
                task_id
            ],
        )
        .map_err(AppError::database)?;
    if affected != 1 {
        return Err(AppError::new(
            codes::AI_TASK_NOT_FOUND,
            "工作流节点不存在",
            false,
        ));
    }
    Ok(())
}

pub fn add_dependency(
    connection: &Connection,
    task_id: &str,
    depends_on_task_id: &str,
    required: bool,
) -> Result<(), AppError> {
    let downstream: (String, Option<String>, Option<String>, Option<String>) = connection
        .query_row(
            "SELECT novel_id,chapter_id,workflow_id,root_task_id FROM ai_tasks WHERE task_id=?1",
            params![task_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .optional()
        .map_err(AppError::database)?
        .ok_or_else(|| AppError::new(codes::AI_TASK_NOT_FOUND, "下游任务不存在", false))?;
    let upstream: (String, Option<String>, Option<String>, Option<String>) = connection
        .query_row(
            "SELECT novel_id,chapter_id,workflow_id,root_task_id FROM ai_tasks WHERE task_id=?1",
            params![depends_on_task_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .optional()
        .map_err(AppError::database)?
        .ok_or_else(|| AppError::new(codes::AI_TASK_NOT_FOUND, "上游任务不存在", false))?;
    if downstream != upstream {
        return Err(AppError::new(
            codes::AI_WORKFLOW_SCOPE_MISMATCH,
            "任务依赖必须属于同一作品、章节和工作流",
            false,
        ));
    }
    let cycle: i64 = connection.query_row(
        "WITH RECURSIVE ancestors(task_id) AS (
            SELECT depends_on_task_id FROM ai_task_dependencies WHERE task_id=?1
            UNION
            SELECT d.depends_on_task_id FROM ai_task_dependencies d JOIN ancestors a ON d.task_id=a.task_id
         ) SELECT EXISTS(SELECT 1 FROM ancestors WHERE task_id=?2)",
        params![depends_on_task_id,task_id],
        |row| row.get(0),
    ).map_err(AppError::database)?;
    if task_id == depends_on_task_id || cycle != 0 {
        return Err(AppError::new(
            codes::AI_WORKFLOW_CYCLE,
            "任务依赖不能形成循环",
            false,
        ));
    }
    connection.execute(
        "INSERT INTO ai_task_dependencies(task_id,depends_on_task_id,required,created_at) VALUES (?1,?2,?3,?4)",
        params![task_id,depends_on_task_id,if required {1}else{0},Utc::now().to_rfc3339()],
    ).map_err(|error| {
        if error.to_string().contains("cyclic task dependency") {
            AppError::new(codes::AI_WORKFLOW_CYCLE, "任务依赖不能形成循环", false)
        } else if error.to_string().contains("cross novel") {
            AppError::new(codes::AI_WORKFLOW_SCOPE_MISMATCH, "任务依赖不能跨作品", false)
        } else {
            AppError::database(error)
        }
    })?;
    Ok(())
}

pub fn create_chapter_summary_workflow(
    connection: &mut Connection,
    input: CreateChapterSummaryWorkflowInput,
) -> Result<WorkflowCreated, AppError> {
    let draft: (String,String,i64,String,Option<String>,Option<String>,String) = connection.query_row(
        "SELECT d.novel_id,d.chapter_id,d.version_no,d.content,d.content_hash,d.large_text_ref_id,c.title
         FROM chapter_drafts d JOIN chapters c ON c.id=d.chapter_id
         WHERE d.id=?1 AND d.novel_id=?2 AND d.chapter_id=?3 AND c.deleted_at IS NULL
           AND c.adopted_draft_id=d.id AND d.is_adopted=1",
        params![input.draft_id,input.novel_id,input.chapter_id],
        |row| Ok((row.get(0)?,row.get(1)?,row.get(2)?,row.get(3)?,row.get(4)?,row.get(5)?,row.get(6)?)),
    ).optional().map_err(AppError::database)?
        .ok_or_else(|| AppError::new(codes::AI_WORKFLOW_SCOPE_MISMATCH,"章节摘要工作流目标不匹配",false))?;
    let content = if let Some(document_id) = draft.5.as_deref() {
        large_text_repository::read_verified_document(connection, document_id)?.content
    } else {
        draft.3.clone()
    };
    let base_hash = draft
        .4
        .unwrap_or_else(|| large_text_repository::sha256(&content));
    let workflow_id = uuid::Uuid::new_v4().to_string();
    let workflow_name = input
        .workflow_name
        .unwrap_or_else(|| format!("{} · 摘要审查", draft.6));
    let parent = ai_task_service::create_task(
        connection,
        frozen_input(
            format!("workflow:{workflow_id}:root"),
            WORKFLOW_PARENT_TYPE,
            &input.novel_id,
            &input.chapter_id,
            &input.draft_id,
            draft.2,
            &base_hash,
            "workflow root",
            json!([]),
            input.provider_options_json.clone(),
        ),
    )?;
    attach_node(
        connection,
        &parent.task_id,
        &workflow_id,
        &workflow_name,
        &parent.task_id,
        None,
        "workflow_root",
        "orchestrator",
        0,
        None,
        false,
    )?;

    let specs = [
        (
            "prepare_materials",
            "workflow_prepare_materials",
            "资料准备",
            10,
            true,
        ),
        (
            "generate_summary",
            "workflow_generate_summary",
            "摘要生成",
            20,
            false,
        ),
        (
            "check_consistency",
            "workflow_check_summary",
            "一致性检查",
            30,
            false,
        ),
        (
            "review_bundle",
            "workflow_review_bundle",
            "审查汇总",
            40,
            false,
        ),
    ];
    let mut child_ids = Vec::new();
    for (step_key, task_type, role, priority, queued) in specs {
        let prompt = match step_key {
            "generate_summary" => {
                format!("请根据以下章节正文生成结构化章节摘要候选，仅输出 JSON：\n{content}")
            }
            "check_consistency" => "检查上游章节摘要与冻结正文的一致性，仅输出 JSON。".into(),
            _ => step_key.to_string(),
        };
        let messages = json!([{ "role": "user", "content": prompt }]);
        let task = ai_task_service::create_task(
            connection,
            frozen_input(
                format!("workflow:{workflow_id}:{step_key}"),
                task_type,
                &input.novel_id,
                &input.chapter_id,
                &input.draft_id,
                draft.2,
                &base_hash,
                &content,
                messages,
                input.provider_options_json.clone(),
            ),
        )?;
        attach_node(
            connection,
            &task.task_id,
            &workflow_id,
            &workflow_name,
            &parent.task_id,
            Some(&parent.task_id),
            step_key,
            role,
            priority,
            Some(WORKFLOW_WORKER_KIND),
            queued,
        )?;
        child_ids.push(task.task_id);
    }
    add_dependency(connection, &child_ids[1], &child_ids[0], true)?;
    add_dependency(connection, &child_ids[2], &child_ids[1], true)?;
    add_dependency(connection, &child_ids[3], &child_ids[1], true)?;
    add_dependency(connection, &child_ids[3], &child_ids[2], true)?;
    aggregate_parent(connection, &parent.task_id)?;
    Ok(WorkflowCreated {
        workflow_id,
        root_task_id: parent.task_id,
        child_task_ids: child_ids,
    })
}

fn validate_background_kind(task_type: &str, artifact_type: &str) -> Result<(), AppError> {
    const TASK_TYPES: &[&str] = &[
        "quality_fix",
        "quality_check",
        "quality_recheck",
        "workflow_freeze_chapter",
        "workflow_quality_review_bundle",
        "chapter_polish",
        "chapter_summary",
        "volume_summary",
        "outline_generate",
        "volume_outline_generate",
        "chapter_outline_generate",
    ];
    const ARTIFACT_TYPES: &[&str] = &[
        "chapter_text",
        "quality_report",
        "chapter_summary",
        "volume_summary",
        "generic_json",
        "outline_text",
        "volume_outline",
        "chapter_outlines",
    ];
    if !TASK_TYPES.contains(&task_type) || !ARTIFACT_TYPES.contains(&artifact_type) {
        return Err(AppError::new(
            codes::OPERATION_PAYLOAD_CONFLICT,
            "后台工作流包含未授权的任务或结果类型",
            false,
        ));
    }
    Ok(())
}

pub fn create_background_workflow(
    connection: &mut Connection,
    input: CreateBackgroundWorkflowInput,
) -> Result<WorkflowCreated, AppError> {
    if input.operation_id.trim().is_empty()
        || input.workflow_name.trim().is_empty()
        || input.steps.is_empty()
        || input.steps.len() > 8
    {
        return Err(AppError::new(
            codes::OPERATION_PAYLOAD_CONFLICT,
            "后台工作流规格无效",
            false,
        ));
    }
    let novel_exists: i64 = connection
        .query_row(
            "SELECT COUNT(*) FROM novels WHERE id=?1 AND deleted_at IS NULL",
            params![input.novel_id],
            |row| row.get(0),
        )
        .map_err(AppError::database)?;
    if novel_exists != 1 {
        return Err(AppError::new(
            codes::AI_WORKFLOW_SCOPE_MISMATCH,
            "后台工作流作品范围无效",
            false,
        ));
    }
    if let Some(chapter_id) = input.chapter_id.as_deref() {
        let chapter_exists: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM chapters WHERE id=?1 AND novel_id=?2 AND deleted_at IS NULL",
                params![chapter_id, input.novel_id],
                |row| row.get(0),
            )
            .map_err(AppError::database)?;
        if chapter_exists != 1 {
            return Err(AppError::new(
                codes::AI_WORKFLOW_SCOPE_MISMATCH,
                "后台工作流章节范围无效",
                false,
            ));
        }
    }
    if let Some(draft_id) = input.draft_id.as_deref() {
        let draft: Option<(i64, Option<String>)> = connection
            .query_row(
                "SELECT version_no,content_hash FROM chapter_drafts
                 WHERE id=?1 AND novel_id=?2 AND chapter_id=?3",
                params![draft_id, input.novel_id, input.chapter_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()
            .map_err(AppError::database)?;
        let Some((version, hash)) = draft else {
            return Err(AppError::new(
                codes::AI_WORKFLOW_SCOPE_MISMATCH,
                "后台工作流草稿范围无效",
                false,
            ));
        };
        if input.source_draft_version != Some(version)
            || matches!((input.base_content_hash.as_deref(), hash.as_deref()), (Some(expected), Some(actual)) if expected != actual)
        {
            return Err(AppError::new(
                codes::AI_WORKFLOW_SCOPE_MISMATCH,
                "后台工作流草稿基线已变化",
                false,
            ));
        }
    }

    let mut keys = std::collections::HashSet::new();
    let mut review_outputs = 0;
    for step in &input.steps {
        validate_background_kind(&step.task_type, &step.artifact_type)?;
        if step.step_key.trim().is_empty() || !keys.insert(step.step_key.clone()) {
            return Err(AppError::new(
                codes::OPERATION_PAYLOAD_CONFLICT,
                "后台工作流步骤标识必须唯一",
                false,
            ));
        }
        if !step.messages.is_array() {
            return Err(AppError::new(
                codes::AI_CONTEXT_BUILD_FAILED,
                "后台工作流 Prompt 必须是消息数组",
                false,
            ));
        }
        if step.review_output {
            review_outputs += 1;
        }
    }
    if review_outputs != 1 {
        return Err(AppError::new(
            codes::OPERATION_PAYLOAD_CONFLICT,
            "后台工作流必须且只能有一个待审查输出",
            false,
        ));
    }
    for step in &input.steps {
        if step
            .dependencies
            .iter()
            .any(|dependency| !keys.contains(dependency) || dependency == &step.step_key)
        {
            return Err(AppError::new(
                codes::AI_WORKFLOW_CYCLE,
                "后台工作流依赖无效",
                false,
            ));
        }
    }

    let workflow_id = uuid::Uuid::new_v4().to_string();
    let root_type = format!("{}_workflow", input.task_type);
    let parent = ai_task_service::create_task(
        connection,
        background_frozen_input(
            format!("{}:root", input.operation_id),
            &root_type,
            &input.novel_id,
            input.chapter_id.as_deref(),
            input.draft_id.as_deref(),
            &input.scope_type,
            input.target_hint_json.clone(),
            input.input_payload_json.clone(),
            input.input_body.clone(),
            input.source_manifest_json.clone(),
            input.source_draft_version,
            input.base_content_hash.clone(),
            json!([]),
            input.provider_options_json.clone(),
        ),
    )?;
    attach_node(
        connection,
        &parent.task_id,
        &workflow_id,
        &input.workflow_name,
        &parent.task_id,
        None,
        "workflow_root",
        "orchestrator",
        0,
        None,
        false,
    )?;

    let mut child_ids = Vec::new();
    let mut task_by_key = std::collections::HashMap::new();
    for (index, step) in input.steps.iter().enumerate() {
        let mut target_hint = input.target_hint_json.clone().unwrap_or_else(|| json!({}));
        if !target_hint.is_object() {
            target_hint = json!({ "target": target_hint });
        }
        if let Some(object) = target_hint.as_object_mut() {
            object.insert("artifactType".into(), json!(step.artifact_type));
            object.insert("reviewOutput".into(), json!(step.review_output));
        }
        let task = ai_task_service::create_task(
            connection,
            background_frozen_input(
                format!("{}:{}", input.operation_id, step.step_key),
                &step.task_type,
                &input.novel_id,
                input.chapter_id.as_deref(),
                input.draft_id.as_deref(),
                &input.scope_type,
                Some(target_hint),
                input.input_payload_json.clone(),
                input.input_body.clone(),
                input.source_manifest_json.clone(),
                input.source_draft_version,
                input.base_content_hash.clone(),
                step.messages.clone(),
                input.provider_options_json.clone(),
            ),
        )?;
        attach_node(
            connection,
            &task.task_id,
            &workflow_id,
            &input.workflow_name,
            &parent.task_id,
            Some(&parent.task_id),
            &step.step_key,
            &step.agent_role,
            step.priority.unwrap_or((index as i64 + 1) * 10),
            Some(WORKFLOW_WORKER_KIND),
            step.dependencies.is_empty(),
        )?;
        task_by_key.insert(step.step_key.clone(), task.task_id.clone());
        child_ids.push(task.task_id);
    }
    for step in &input.steps {
        let task_id = task_by_key.get(&step.step_key).expect("validated step key");
        for dependency in &step.dependencies {
            let dependency_id = task_by_key
                .get(dependency)
                .expect("validated dependency key");
            add_dependency(connection, task_id, dependency_id, true)?;
        }
    }
    aggregate_parent(connection, &parent.task_id)?;
    Ok(WorkflowCreated {
        workflow_id,
        root_task_id: parent.task_id,
        child_task_ids: child_ids,
    })
}

pub fn release_ready_tasks(connection: &Connection) -> Result<usize, AppError> {
    let now = Utc::now().to_rfc3339();
    connection.execute(
        "UPDATE ai_tasks SET status='queued',available_at=?1,progress_stage='依赖完成，等待执行',progress_percent=5
         WHERE worker_kind=?2 AND status='ready' AND stale_at IS NULL
           AND EXISTS (SELECT 1 FROM ai_task_dependencies d WHERE d.task_id=ai_tasks.task_id)
           AND NOT EXISTS (
             SELECT 1 FROM ai_task_dependencies d JOIN ai_tasks u ON u.task_id=d.depends_on_task_id
             WHERE d.task_id=ai_tasks.task_id AND d.required=1
               AND (u.status NOT IN ('completed','applied') OR u.stale_at IS NOT NULL)
           )",
        params![now,WORKFLOW_WORKER_KIND],
    ).map_err(AppError::database)
}

pub fn aggregate_parent(connection: &Connection, parent_task_id: &str) -> Result<(), AppError> {
    let counts: (i64,i64,i64,i64,i64,i64) = connection.query_row(
        "SELECT COUNT(*),
          SUM(CASE WHEN status IN ('completed','applied') AND stale_at IS NULL THEN 1 ELSE 0 END),
          SUM(CASE WHEN status IN ('queued','running','validating','cancel_requested') THEN 1 ELSE 0 END),
          SUM(CASE WHEN status='failed' AND required_for_parent=1 THEN 1 ELSE 0 END),
          SUM(CASE WHEN status='cancelled' AND required_for_parent=1 THEN 1 ELSE 0 END),
          SUM(CASE WHEN stale_at IS NOT NULL THEN 1 ELSE 0 END)
         FROM ai_tasks WHERE parent_task_id=?1",
        params![parent_task_id],
        |row| Ok((row.get(0)?,row.get(1)?,row.get(2)?,row.get(3)?,row.get(4)?,row.get(5)?)),
    ).map_err(AppError::database)?;
    if counts.0 == 0 {
        return Ok(());
    }
    let parent_status: String = connection
        .query_row(
            "SELECT status FROM ai_tasks WHERE task_id=?1",
            params![parent_task_id],
            |row| row.get(0),
        )
        .map_err(AppError::database)?;
    let next = if parent_status == "cancel_requested" {
        if counts.2 == 0 {
            "cancelled"
        } else {
            "cancel_requested"
        }
    } else if counts.5 > 0 {
        if counts.1 + counts.5 == counts.0 {
            "completed"
        } else {
            "ready"
        }
    } else if counts.3 > 0 {
        "failed"
    } else if counts.4 > 0 {
        "cancelled"
    } else if counts.2 > 0 {
        "running"
    } else if counts.1 == counts.0 {
        "completed"
    } else {
        "ready"
    };
    let finished = counts.1 + counts.3 + counts.4 + counts.5;
    let percent = (finished * 100 / counts.0).clamp(0, 100);
    let stage = match next {
        "completed" if counts.5 > 0 => "工作流结果已过期",
        "completed" => "工作流完成，等待审查",
        "failed" => "必需步骤失败",
        "cancelled" => "工作流已取消",
        "running" => "工作流执行中",
        "cancel_requested" => "正在级联取消",
        _ => "等待依赖",
    };
    connection.execute(
        "UPDATE ai_tasks SET status=?1,progress_stage=?2,progress_percent=?3,
          completed_at=CASE WHEN ?1 IN ('completed','failed','cancelled') THEN COALESCE(completed_at,?4) ELSE completed_at END
         WHERE task_id=?5",
        params![next,stage,percent,Utc::now().to_rfc3339(),parent_task_id],
    ).map_err(AppError::database)?;
    Ok(())
}

pub fn refresh_orchestration(connection: &Connection) -> Result<(), AppError> {
    detect_source_stale(connection)?;
    release_ready_tasks(connection)?;
    let mut statement = connection
        .prepare(
            "SELECT task_id FROM ai_tasks WHERE workflow_id IS NOT NULL AND parent_task_id IS NULL",
        )
        .map_err(AppError::database)?;
    let parents = statement
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(AppError::database)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(AppError::database)?;
    drop(statement);
    for parent in parents {
        aggregate_parent(connection, &parent)?;
    }
    Ok(())
}

fn detect_source_stale(connection: &Connection) -> Result<usize, AppError> {
    let mut statement = connection.prepare(
        "SELECT root.task_id,root.workflow_id,root.draft_id,i.base_content_hash,
                CASE
                  WHEN root.task_type=?1 THEN c.adopted_draft_id
                  WHEN COALESCE(json_extract(root.target_hint_json,'$.staleAgainstLatest'),0)=1 THEN
                    (SELECT latest.id FROM chapter_drafts latest WHERE latest.chapter_id=root.chapter_id ORDER BY latest.version_no DESC LIMIT 1)
                  ELSE root.draft_id
                END AS current_draft_id,
                CASE
                  WHEN root.task_type=?1 THEN d.content_hash
                  WHEN COALESCE(json_extract(root.target_hint_json,'$.staleAgainstLatest'),0)=1 THEN
                    (SELECT latest.content_hash FROM chapter_drafts latest WHERE latest.chapter_id=root.chapter_id ORDER BY latest.version_no DESC LIMIT 1)
                  ELSE i.base_content_hash
                END AS current_hash
         FROM ai_tasks root JOIN ai_input_snapshots i ON i.task_id=root.task_id
         LEFT JOIN chapters c ON c.id=root.chapter_id
         LEFT JOIN chapter_drafts d ON d.id=c.adopted_draft_id
         WHERE root.workflow_id IS NOT NULL AND root.parent_task_id IS NULL
           AND root.draft_id IS NOT NULL AND root.stale_at IS NULL",
    ).map_err(AppError::database)?;
    let rows = statement
        .query_map(params![WORKFLOW_PARENT_TYPE], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, Option<String>>(3)?,
                row.get::<_, Option<String>>(4)?,
                row.get::<_, Option<String>>(5)?,
            ))
        })
        .map_err(AppError::database)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(AppError::database)?;
    drop(statement);
    let mut changed = 0;
    for (root_task_id, workflow_id, source_draft_id, base_hash, current_draft_id, current_hash) in
        rows
    {
        let stale = source_draft_id != current_draft_id
            || matches!((base_hash.as_deref(),current_hash.as_deref()),(Some(expected),Some(actual)) if expected!=actual);
        if !stale {
            continue;
        }
        let now = Utc::now().to_rfc3339();
        let reason = "章节正文版本或 hash 已变化";
        changed += connection.execute(
            "UPDATE ai_tasks SET stale_at=?1,stale_reason=?2,stale_source_task_id=?3,progress_stage='正文基线变化，结果已过期'
             WHERE workflow_id=?4 AND status<>'applied' AND stale_at IS NULL",
            params![now,reason,root_task_id,workflow_id],
        ).map_err(AppError::database)?;
        connection.execute(
            "INSERT OR IGNORE INTO ai_artifact_stale_events(artifact_id,source_task_id,reason,triggered_at)
             SELECT r.artifact_id,?1,?2,?3 FROM result_artifacts r JOIN ai_tasks t ON t.task_id=r.task_id WHERE t.workflow_id=?4",
            params![root_task_id,reason,now,workflow_id],
        ).map_err(AppError::database)?;
    }
    Ok(changed)
}

pub fn request_cancel(connection: &mut Connection, task_id: &str) -> Result<Vec<String>, AppError> {
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(AppError::database)?;
    let (status,parent): (String,Option<String>) = transaction.query_row(
        "SELECT status,parent_task_id FROM ai_tasks WHERE task_id=?1 AND workflow_id IS NOT NULL",
        params![task_id],|row| Ok((row.get(0)?,row.get(1)?)),
    ).optional().map_err(AppError::database)?
        .ok_or_else(|| AppError::new(codes::AI_TASK_NOT_FOUND,"工作流任务不存在",false))?;
    if matches!(status.as_str(), "applied" | "cancelled") {
        return Err(AppError::new(
            codes::AI_TASK_TERMINAL_STATE,
            "任务当前不能取消",
            false,
        ));
    }
    let now = Utc::now().to_rfc3339();
    let targets = if parent.is_none() {
        let mut statement = transaction.prepare(
            "SELECT task_id FROM ai_tasks WHERE parent_task_id=?1 AND status IN ('running','validating','cancel_requested')",
        ).map_err(AppError::database)?;
        let running = statement
            .query_map(params![task_id], |row| row.get::<_, String>(0))
            .map_err(AppError::database)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(AppError::database)?;
        drop(statement);
        transaction.execute(
            "UPDATE ai_tasks SET status=CASE WHEN status IN ('running','validating','cancel_requested') THEN 'cancel_requested' ELSE 'cancelled' END,
             cancel_requested_at=?1,progress_stage='正在级联取消'
             WHERE parent_task_id=?2 AND status NOT IN ('completed','applied','failed','cancelled')",
            params![now,task_id],
        ).map_err(AppError::database)?;
        transaction.execute("UPDATE ai_tasks SET status='cancel_requested',cancel_requested_at=?1 WHERE task_id=?2",params![now,task_id]).map_err(AppError::database)?;
        running
    } else {
        transaction.execute(
            "UPDATE ai_tasks SET status=CASE WHEN status IN ('running','validating','cancel_requested') THEN 'cancel_requested' ELSE 'cancelled' END,
             cancel_requested_at=?1,progress_stage='正在取消' WHERE task_id=?2",
            params![now,task_id],
        ).map_err(AppError::database)?;
        if matches!(
            status.as_str(),
            "running" | "validating" | "cancel_requested"
        ) {
            vec![task_id.to_string()]
        } else {
            vec![]
        }
    };
    transaction.commit().map_err(AppError::database)?;
    Ok(targets)
}

pub fn retry_child(connection: &Connection, task_id: &str) -> Result<(), AppError> {
    let affected = connection.execute(
        "UPDATE ai_tasks SET status=CASE WHEN NOT EXISTS (
             SELECT 1 FROM ai_task_dependencies d JOIN ai_tasks u ON u.task_id=d.depends_on_task_id
             WHERE d.task_id=ai_tasks.task_id AND d.required=1 AND (u.status NOT IN ('completed','applied') OR u.stale_at IS NOT NULL)
           ) THEN 'queued' ELSE 'ready' END,
           error_json=NULL,available_at=?1,progress_stage='等待局部重试',progress_percent=5,
           worker_owner_id=NULL,lease_expires_at=NULL,heartbeat_at=NULL
         WHERE task_id=?2 AND parent_task_id IS NOT NULL AND status='failed' AND stale_at IS NULL
           AND NOT EXISTS (SELECT 1 FROM result_artifacts r
             WHERE r.task_id=ai_tasks.task_id AND r.processing_status IN ('valid','valid_with_warnings')
               AND NOT EXISTS (SELECT 1 FROM ai_artifact_stale_events s WHERE s.artifact_id=r.artifact_id))",
        params![Utc::now().to_rfc3339(),task_id],
    ).map_err(AppError::database)?;
    if affected != 1 {
        return Err(AppError::new(
            codes::AI_TASK_RETRY_NOT_ALLOWED,
            "该工作流步骤不能局部重试",
            false,
        ));
    }
    Ok(())
}

pub fn propagate_stale(
    connection: &mut Connection,
    source_task_id: &str,
    reason: &str,
) -> Result<usize, AppError> {
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(AppError::database)?;
    let now = Utc::now().to_rfc3339();
    let affected = transaction.execute(
        "WITH RECURSIVE downstream(task_id) AS (
           SELECT task_id FROM ai_task_dependencies WHERE depends_on_task_id=?1
           UNION
           SELECT d.task_id FROM ai_task_dependencies d JOIN downstream x ON d.depends_on_task_id=x.task_id
         ) UPDATE ai_tasks SET stale_at=?2,stale_reason=?3,stale_source_task_id=?1,
              progress_stage='上游变化，结果已过期'
           WHERE task_id IN (SELECT task_id FROM downstream) AND status<>'applied' AND stale_at IS NULL",
        params![source_task_id,now,reason],
    ).map_err(AppError::database)?;
    transaction
        .execute(
            "UPDATE ai_tasks SET stale_at=?2,stale_reason=?3,stale_source_task_id=?1,
         progress_stage='工作流包含过期结果'
         WHERE task_id=(SELECT root_task_id FROM ai_tasks WHERE task_id=?1)
           AND task_id<>?1 AND status<>'applied'",
            params![source_task_id, now, reason],
        )
        .map_err(AppError::database)?;
    transaction.execute(
        "INSERT OR IGNORE INTO ai_artifact_stale_events(artifact_id,source_task_id,reason,triggered_at)
         SELECT artifact_id,?1,?3,?2 FROM result_artifacts WHERE task_id IN (
           WITH RECURSIVE downstream(task_id) AS (
             SELECT task_id FROM ai_task_dependencies WHERE depends_on_task_id=?1
             UNION SELECT d.task_id FROM ai_task_dependencies d JOIN downstream x ON d.depends_on_task_id=x.task_id
           ) SELECT task_id FROM downstream
         )",
        params![source_task_id,now,reason],
    ).map_err(AppError::database)?;
    transaction.commit().map_err(AppError::database)?;
    refresh_orchestration(connection)?;
    Ok(affected)
}

pub fn dependency_artifacts(
    connection: &Connection,
    task_id: &str,
) -> Result<Vec<DependencyArtifact>, AppError> {
    let mut statement = connection.prepare(
        "SELECT r.artifact_id,r.artifact_type,COALESCE(r.display_content_ref_id,r.raw_content_ref_id)
         FROM ai_task_dependencies d JOIN ai_tasks u ON u.task_id=d.depends_on_task_id
         JOIN result_artifacts r ON r.artifact_id=u.result_artifact_id
         WHERE d.task_id=?1 AND u.status IN ('completed','applied') AND u.stale_at IS NULL
           AND NOT EXISTS (SELECT 1 FROM ai_artifact_stale_events s WHERE s.artifact_id=r.artifact_id)
         ORDER BY u.priority",
    ).map_err(AppError::database)?;
    let rows = statement
        .query_map(params![task_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
            ))
        })
        .map_err(AppError::database)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(AppError::database)?;
    rows.into_iter()
        .map(|(artifact_id, artifact_type, document_id)| {
            let content =
                large_text_repository::read_verified_document(connection, &document_id)?.content;
            Ok(DependencyArtifact {
                artifact_id,
                artifact_type,
                content,
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::migrations;
    use crate::services::artifact_service;

    fn setup() -> Result<Connection, Box<dyn std::error::Error>> {
        let mut connection = Connection::open_in_memory()?;
        connection.execute_batch(
            "PRAGMA foreign_keys=ON;
             CREATE TABLE novels (id TEXT PRIMARY KEY,title TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,deleted_at TEXT);
             CREATE TABLE chapters (id TEXT PRIMARY KEY,novel_id TEXT NOT NULL,title TEXT NOT NULL,adopted_draft_id TEXT,status TEXT NOT NULL DEFAULT 'editing',word_count INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,deleted_at TEXT);
             CREATE TABLE chapter_drafts (id TEXT PRIMARY KEY,novel_id TEXT NOT NULL,chapter_id TEXT NOT NULL,content TEXT NOT NULL,version_no INTEGER NOT NULL,content_hash TEXT,large_text_ref_id TEXT,source TEXT NOT NULL DEFAULT 'user_edited',word_count INTEGER NOT NULL DEFAULT 0,is_adopted INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
             INSERT INTO novels VALUES ('novel-a','Novel A','now','now',NULL);
             INSERT INTO novels VALUES ('novel-b','Novel B','now','now',NULL);
             INSERT INTO chapters VALUES ('chapter-a','novel-a','Chapter A','draft-a','editing',2,'now','now',NULL);
             INSERT INTO chapters VALUES ('chapter-b','novel-b','Chapter B','draft-b','editing',2,'now','now',NULL);
             INSERT INTO chapter_drafts VALUES ('draft-a','novel-a','chapter-a','source A',1,'hash-a',NULL,'user_edited',2,1,'now','now');
             INSERT INTO chapter_drafts VALUES ('draft-b','novel-b','chapter-b','source B',1,'hash-b',NULL,'user_edited',2,1,'now','now');"
        )?;
        migrations::run_migrations(&mut connection)?;
        Ok(connection)
    }

    fn create(
        connection: &mut Connection,
        novel: &str,
        chapter: &str,
        draft: &str,
    ) -> Result<WorkflowCreated, AppError> {
        create_chapter_summary_workflow(
            connection,
            CreateChapterSummaryWorkflowInput {
                novel_id: novel.into(),
                chapter_id: chapter.into(),
                draft_id: draft.into(),
                workflow_name: Some("Test workflow".into()),
                provider_options_json: json!({"provider":"mock","model":"Mock"}),
            },
        )
    }

    fn complete_json(connection: &mut Connection, task_id: &str) -> Result<String, AppError> {
        connection
            .execute(
                "UPDATE ai_tasks SET status='ready' WHERE task_id=?1",
                params![task_id],
            )
            .map_err(AppError::database)?;
        let attempt = ai_task_service::start_attempt(connection, task_id, Some("mock"))?;
        ai_task_service::mark_attempt_succeeded(
            connection,
            task_id,
            &attempt.attempt_id,
            json!({"mock":true}),
        )?;
        let artifact = artifact_service::create_artifact(
            connection,
            artifact_service::CreateResultArtifactInput {
                task_id: task_id.into(),
                attempt_id: attempt.attempt_id,
                artifact_type: "generic_json".into(),
                schema_version: 1,
                raw_content: "{\"ok\":true}".into(),
                parse_content: None,
                display_content: None,
                structured_payload_json: Some(json!({"ok":true})),
                source: artifact_service::ArtifactSourceInput {
                    novel_id: "novel-a".into(),
                    chapter_id: Some("chapter-a".into()),
                    draft_id: Some("draft-a".into()),
                    draft_version: Some(1),
                    base_content_hash: Some("hash-a".into()),
                },
                expected_ok: None,
                parent_artifact_id: None,
                derivation_type: Some("workflow_step".into()),
            },
        )?;
        Ok(artifact.artifact_id)
    }

    #[test]
    fn workflow01_parent_root_children_and_dependencies_are_persisted(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let mut connection = setup()?;
        let created = create(&mut connection, "novel-a", "chapter-a", "draft-a")?;
        assert_eq!(created.child_task_ids.len(), 4);
        let root: (Option<String>, Option<String>, Option<String>) = connection.query_row(
            "SELECT workflow_id,root_task_id,parent_task_id FROM ai_tasks WHERE task_id=?1",
            params![created.root_task_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )?;
        assert_eq!(root.0.as_deref(), Some(created.workflow_id.as_str()));
        assert_eq!(root.1.as_deref(), Some(created.root_task_id.as_str()));
        assert!(root.2.is_none());
        assert_eq!(
            connection.query_row(
                "SELECT COUNT(*) FROM ai_tasks WHERE parent_task_id=?1",
                params![created.root_task_id],
                |row| row.get::<_, i64>(0)
            )?,
            4
        );
        assert_eq!(
            connection.query_row("SELECT COUNT(*) FROM ai_task_dependencies", [], |row| row
                .get::<_, i64>(
                0
            ))?,
            4
        );
        Ok(())
    }

    #[test]
    fn workflow02_cross_project_dependency_and_cycle_are_rejected(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let mut connection = setup()?;
        let first = create(&mut connection, "novel-a", "chapter-a", "draft-a")?;
        let second = create(&mut connection, "novel-b", "chapter-b", "draft-b")?;
        let scope = add_dependency(
            &connection,
            &first.child_task_ids[0],
            &second.child_task_ids[0],
            true,
        )
        .expect_err("cross project");
        assert_eq!(scope.code, codes::AI_WORKFLOW_SCOPE_MISMATCH);
        let cycle = add_dependency(
            &connection,
            &first.child_task_ids[0],
            &first.child_task_ids[3],
            true,
        )
        .expect_err("cycle");
        assert_eq!(cycle.code, codes::AI_WORKFLOW_CYCLE);
        Ok(())
    }

    #[test]
    fn workflow03_dependency_blocks_then_releases_downstream(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let mut connection = setup()?;
        let created = create(&mut connection, "novel-a", "chapter-a", "draft-a")?;
        assert_eq!(
            connection.query_row(
                "SELECT status FROM ai_tasks WHERE task_id=?1",
                params![created.child_task_ids[1]],
                |row| row.get::<_, String>(0)
            )?,
            "ready"
        );
        assert_eq!(release_ready_tasks(&connection)?, 0);
        connection.execute(
            "UPDATE ai_tasks SET status='failed' WHERE task_id=?1",
            params![created.child_task_ids[0]],
        )?;
        assert_eq!(release_ready_tasks(&connection)?, 0);
        assert_eq!(
            connection.query_row(
                "SELECT status FROM ai_tasks WHERE task_id=?1",
                params![created.child_task_ids[1]],
                |row| row.get::<_, String>(0)
            )?,
            "ready"
        );
        complete_json(&mut connection, &created.child_task_ids[0])?;
        assert_eq!(release_ready_tasks(&connection)?, 1);
        assert_eq!(
            connection.query_row(
                "SELECT status FROM ai_tasks WHERE task_id=?1",
                params![created.child_task_ids[1]],
                |row| row.get::<_, String>(0)
            )?,
            "queued"
        );
        Ok(())
    }

    #[test]
    fn workflow04_local_retry_preserves_successful_siblings(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let mut connection = setup()?;
        let created = create(&mut connection, "novel-a", "chapter-a", "draft-a")?;
        complete_json(&mut connection, &created.child_task_ids[0])?;
        connection.execute("UPDATE ai_tasks SET status='failed',error_json='{\"retryable\":true}' WHERE task_id=?1",params![created.child_task_ids[1]])?;
        retry_child(&connection, &created.child_task_ids[1])?;
        assert_eq!(
            connection.query_row(
                "SELECT status FROM ai_tasks WHERE task_id=?1",
                params![created.child_task_ids[0]],
                |row| row.get::<_, String>(0)
            )?,
            "completed"
        );
        assert_eq!(
            connection.query_row(
                "SELECT status FROM ai_tasks WHERE task_id=?1",
                params![created.child_task_ids[1]],
                |row| row.get::<_, String>(0)
            )?,
            "queued"
        );
        assert_eq!(
            connection.query_row(
                "SELECT COUNT(*) FROM ai_task_attempts WHERE task_id=?1",
                params![created.child_task_ids[0]],
                |row| row.get::<_, i64>(0)
            )?,
            1
        );
        Ok(())
    }

    #[test]
    fn workflow05_parent_cancel_cascades_and_keeps_completed_artifact(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let mut connection = setup()?;
        let created = create(&mut connection, "novel-a", "chapter-a", "draft-a")?;
        let artifact_id = complete_json(&mut connection, &created.child_task_ids[0])?;
        let running = request_cancel(&mut connection, &created.root_task_id)?;
        assert!(running.is_empty());
        assert_eq!(
            connection.query_row(
                "SELECT COUNT(*) FROM result_artifacts WHERE artifact_id=?1",
                params![artifact_id],
                |row| row.get::<_, i64>(0)
            )?,
            1
        );
        assert_eq!(
            connection.query_row(
                "SELECT COUNT(*) FROM ai_tasks WHERE parent_task_id=?1 AND status='cancelled'",
                params![created.root_task_id],
                |row| row.get::<_, i64>(0)
            )?,
            3
        );
        aggregate_parent(&connection, &created.root_task_id)?;
        assert_eq!(
            connection.query_row(
                "SELECT status FROM ai_tasks WHERE task_id=?1",
                params![created.root_task_id],
                |row| row.get::<_, String>(0)
            )?,
            "cancelled"
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
            connection.query_row("SELECT COUNT(*) FROM chapter_drafts", [], |row| row
                .get::<_, i64>(0))?,
            2
        );
        Ok(())
    }

    #[test]
    fn workflow06_stale_propagates_to_tasks_and_artifacts() -> Result<(), Box<dyn std::error::Error>>
    {
        let mut connection = setup()?;
        let created = create(&mut connection, "novel-a", "chapter-a", "draft-a")?;
        complete_json(&mut connection, &created.child_task_ids[0])?;
        release_ready_tasks(&connection)?;
        let downstream_artifact = complete_json(&mut connection, &created.child_task_ids[1])?;
        assert!(
            propagate_stale(
                &mut connection,
                &created.child_task_ids[0],
                "上游摘要被用户修改"
            )? >= 2
        );
        let stale: (Option<String>, Option<String>) = connection.query_row(
            "SELECT triggered_at,reason FROM ai_artifact_stale_events WHERE artifact_id=?1",
            params![downstream_artifact],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )?;
        assert!(stale.0.is_some());
        assert_eq!(stale.1.as_deref(), Some("上游摘要被用户修改"));
        assert!(connection
            .query_row(
                "SELECT stale_at FROM ai_tasks WHERE task_id=?1",
                params![created.root_task_id],
                |row| row.get::<_, Option<String>>(0)
            )?
            .is_some());
        Ok(())
    }

    #[test]
    fn workflow07_reopen_restores_graph_state() -> Result<(), Box<dyn std::error::Error>> {
        let path = std::env::temp_dir().join(format!("ai-workflow-{}.db", uuid::Uuid::new_v4()));
        let root_id;
        {
            let mut connection = Connection::open(&path)?;
            connection.execute_batch("PRAGMA foreign_keys=ON; CREATE TABLE novels (id TEXT PRIMARY KEY,title TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,deleted_at TEXT); CREATE TABLE chapters (id TEXT PRIMARY KEY,novel_id TEXT NOT NULL,title TEXT NOT NULL,adopted_draft_id TEXT,status TEXT NOT NULL DEFAULT 'editing',word_count INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,deleted_at TEXT); CREATE TABLE chapter_drafts (id TEXT PRIMARY KEY,novel_id TEXT NOT NULL,chapter_id TEXT NOT NULL,content TEXT NOT NULL,version_no INTEGER NOT NULL,content_hash TEXT,large_text_ref_id TEXT,source TEXT NOT NULL DEFAULT 'user_edited',word_count INTEGER NOT NULL DEFAULT 0,is_adopted INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL,updated_at TEXT NOT NULL); INSERT INTO novels VALUES ('novel-a','A','n','n',NULL); INSERT INTO chapters VALUES ('chapter-a','novel-a','A','draft-a','editing',1,'n','n',NULL); INSERT INTO chapter_drafts VALUES ('draft-a','novel-a','chapter-a','source',1,'hash-a',NULL,'user_edited',1,1,'n','n');")?;
            migrations::run_migrations(&mut connection)?;
            root_id = create(&mut connection, "novel-a", "chapter-a", "draft-a")?.root_task_id;
        }
        let reopened = Connection::open(&path)?;
        assert_eq!(
            reopened.query_row(
                "SELECT COUNT(*) FROM ai_tasks WHERE root_task_id=?1",
                params![root_id],
                |row| row.get::<_, i64>(0)
            )?,
            5
        );
        assert_eq!(
            reopened.query_row("SELECT COUNT(*) FROM ai_task_dependencies", [], |row| row
                .get::<_, i64>(
                0
            ))?,
            4
        );
        drop(reopened);
        std::fs::remove_file(path)?;
        Ok(())
    }

    #[test]
    fn workflow08_adopted_draft_change_marks_entire_workflow_stale(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let mut connection = setup()?;
        let created = create(&mut connection, "novel-a", "chapter-a", "draft-a")?;
        connection.execute(
            "UPDATE chapters SET adopted_draft_id=NULL WHERE id='chapter-a'",
            [],
        )?;
        refresh_orchestration(&connection)?;
        assert_eq!(
            connection.query_row(
                "SELECT COUNT(*) FROM ai_tasks WHERE workflow_id=?1 AND stale_at IS NOT NULL",
                params![created.workflow_id],
                |row| row.get::<_, i64>(0)
            )?,
            5
        );
        Ok(())
    }

    #[test]
    fn workflow09_parent_status_is_derived_from_required_children(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let mut connection = setup()?;
        let created = create(&mut connection, "novel-a", "chapter-a", "draft-a")?;
        connection.execute(
            "UPDATE ai_tasks SET status='ready' WHERE parent_task_id=?1",
            params![created.root_task_id],
        )?;
        aggregate_parent(&connection, &created.root_task_id)?;
        assert_eq!(
            connection.query_row(
                "SELECT status FROM ai_tasks WHERE task_id=?1",
                params![created.root_task_id],
                |row| row.get::<_, String>(0)
            )?,
            "ready"
        );
        connection.execute(
            "UPDATE ai_tasks SET status='running' WHERE task_id=?1",
            params![created.child_task_ids[0]],
        )?;
        aggregate_parent(&connection, &created.root_task_id)?;
        assert_eq!(
            connection.query_row(
                "SELECT status FROM ai_tasks WHERE task_id=?1",
                params![created.root_task_id],
                |row| row.get::<_, String>(0)
            )?,
            "running"
        );
        connection.execute(
            "UPDATE ai_tasks SET status='failed' WHERE task_id=?1",
            params![created.child_task_ids[0]],
        )?;
        aggregate_parent(&connection, &created.root_task_id)?;
        assert_eq!(
            connection.query_row(
                "SELECT status FROM ai_tasks WHERE task_id=?1",
                params![created.root_task_id],
                |row| row.get::<_, String>(0)
            )?,
            "failed"
        );
        Ok(())
    }

    #[test]
    fn workflow10_stage_2d_quality_fix_uses_existing_dag_without_canon_write(
    ) -> Result<(), Box<dyn std::error::Error>> {
        let mut connection = setup()?;
        let created = create_background_workflow(
            &mut connection,
            CreateBackgroundWorkflowInput {
                operation_id: "stage2d-quality-fix".into(),
                workflow_name: "质量修复与复检".into(),
                task_type: "quality_fix".into(),
                novel_id: "novel-a".into(),
                chapter_id: Some("chapter-a".into()),
                draft_id: Some("draft-a".into()),
                scope_type: "draft".into(),
                target_hint_json: Some(json!({"staleAgainstLatest":true})),
                input_payload_json: json!({"issues":["issue-a"]}),
                input_body: Some("source".into()),
                source_manifest_json: json!([{"type":"chapter_draft","id":"draft-a"}]),
                source_draft_version: Some(1),
                base_content_hash: Some("hash-a".into()),
                provider_options_json: json!({"provider":"mock","model":"Mock"}),
                steps: vec![
                    BackgroundWorkflowStepInput {
                        step_key: "quality_fix".into(),
                        task_type: "quality_fix".into(),
                        agent_role: "修复".into(),
                        artifact_type: "chapter_text".into(),
                        messages: json!([{"role":"user","content":"fix"}]),
                        dependencies: vec![],
                        priority: Some(10),
                        review_output: false,
                    },
                    BackgroundWorkflowStepInput {
                        step_key: "quality_recheck".into(),
                        task_type: "quality_recheck".into(),
                        agent_role: "复检".into(),
                        artifact_type: "quality_report".into(),
                        messages: json!([{"role":"user","content":"recheck"}]),
                        dependencies: vec!["quality_fix".into()],
                        priority: Some(20),
                        review_output: true,
                    },
                ],
            },
        )?;
        assert_eq!(created.child_task_ids.len(), 2);
        assert_eq!(
            connection.query_row(
                "SELECT COUNT(*) FROM ai_task_dependencies WHERE task_id=?1",
                params![created.child_task_ids[1]],
                |row| row.get::<_, i64>(0)
            )?,
            1
        );
        assert_eq!(
            connection.query_row(
                "SELECT status FROM ai_tasks WHERE task_id=?1",
                params![created.child_task_ids[0]],
                |row| row.get::<_, String>(0)
            )?,
            "queued"
        );
        assert_eq!(
            connection.query_row(
                "SELECT status FROM ai_tasks WHERE task_id=?1",
                params![created.child_task_ids[1]],
                |row| row.get::<_, String>(0)
            )?,
            "ready"
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
            connection.query_row("SELECT COUNT(*) FROM chapter_drafts", [], |row| row
                .get::<_, i64>(0))?,
            2
        );
        Ok(())
    }

    #[test]
    fn workflow11_stage_2d_rejects_unmigrated_task_types() -> Result<(), Box<dyn std::error::Error>>
    {
        let mut connection = setup()?;
        let error = create_background_workflow(
            &mut connection,
            CreateBackgroundWorkflowInput {
                operation_id: "stage2d-out-of-scope".into(),
                workflow_name: "越界任务".into(),
                task_type: "character_generate".into(),
                novel_id: "novel-a".into(),
                chapter_id: None,
                draft_id: None,
                scope_type: "novel".into(),
                target_hint_json: None,
                input_payload_json: json!({}),
                input_body: None,
                source_manifest_json: json!([]),
                source_draft_version: None,
                base_content_hash: None,
                provider_options_json: json!({"provider":"mock","model":"Mock"}),
                steps: vec![BackgroundWorkflowStepInput {
                    step_key: "character".into(),
                    task_type: "character_generate".into(),
                    agent_role: "角色".into(),
                    artifact_type: "generic_json".into(),
                    messages: json!([{"role":"user","content":"no"}]),
                    dependencies: vec![],
                    priority: None,
                    review_output: true,
                }],
            },
        )
        .expect_err("unmigrated task type must be rejected");
        assert_eq!(error.code, codes::OPERATION_PAYLOAD_CONFLICT);
        Ok(())
    }
}

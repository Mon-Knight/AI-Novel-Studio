use crate::domain::co_creation::CoCreationSessionV1;
use crate::errors::{codes, AppError};
use rusqlite::{params, Connection, OptionalExtension};

#[derive(Debug, Clone)]
pub struct CoCreationMessageRow {
    pub message_id: String,
    pub session_id: String,
    pub turn_id: String,
    pub sequence_no: i64,
    pub role: String,
    pub status: String,
    pub body_ref_id: String,
    pub content_hash: String,
    pub content_length: i64,
    pub reply_to_message_id: Option<String>,
    pub task_id: Option<String>,
    pub artifact_id: Option<String>,
    pub error_json: Option<String>,
    pub created_at: String,
    pub completed_at: Option<String>,
}

#[derive(Debug, Clone)]
pub struct CoCreationDraftRow {
    pub draft_revision_id: String,
    pub session_id: String,
    pub stage_key: String,
    pub revision_no: i64,
    pub parent_revision_id: Option<String>,
    pub schema_version: i64,
    pub payload_json: String,
    pub content_hash: String,
    pub origin: String,
    pub source_message_id: Option<String>,
    pub source_task_id: Option<String>,
    pub source_artifact_id: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone)]
pub struct CoCreationOperationRow {
    pub session_id: String,
    pub operation_type: String,
    pub request_hash: String,
    pub result_json: String,
}

#[derive(Debug, Clone)]
pub struct BackgroundTaskScopeRow {
    pub task_type: String,
    pub novel_id: String,
    pub status: String,
    pub worker_kind: Option<String>,
    pub target_hint_json: Option<String>,
    pub input_payload_json: Option<String>,
}

#[derive(Debug, Clone)]
pub struct ArtifactScopeRow {
    pub task_id: String,
    pub source_novel_id: String,
    pub artifact_type: String,
    pub schema_version: i64,
    pub raw_content_ref_id: String,
    pub display_content_ref_id: Option<String>,
    pub processing_status: String,
    pub structured_payload_json: Option<String>,
    pub stale: bool,
}

fn map_session(row: &rusqlite::Row<'_>) -> rusqlite::Result<CoCreationSessionV1> {
    Ok(CoCreationSessionV1 {
        session_id: row.get(0)?,
        novel_id: row.get(1)?,
        workspace_type: row.get(2)?,
        status: row.get(3)?,
        revision: row.get(4)?,
        state_hash: row.get(5)?,
        created_at: row.get(6)?,
        updated_at: row.get(7)?,
        archived_at: row.get(8)?,
    })
}

const SESSION_SELECT: &str = "SELECT session_id,novel_id,workspace_type,status,revision,
    state_hash,created_at,updated_at,archived_at FROM co_creation_sessions";

pub fn find_active_session(
    connection: &Connection,
    novel_id: &str,
    workspace_type: &str,
) -> Result<Option<CoCreationSessionV1>, AppError> {
    connection
        .query_row(
            &format!(
                "{SESSION_SELECT} WHERE novel_id=?1 AND workspace_type=?2 AND status='active'"
            ),
            params![novel_id, workspace_type],
            map_session,
        )
        .optional()
        .map_err(AppError::database)
}

pub fn find_session(
    connection: &Connection,
    session_id: &str,
) -> Result<Option<CoCreationSessionV1>, AppError> {
    connection
        .query_row(
            &format!("{SESSION_SELECT} WHERE session_id=?1"),
            params![session_id],
            map_session,
        )
        .optional()
        .map_err(AppError::database)
}

pub fn insert_session(
    connection: &Connection,
    session: &CoCreationSessionV1,
) -> Result<(), AppError> {
    let affected = connection
        .execute(
            "INSERT INTO co_creation_sessions
                (session_id,novel_id,workspace_type,status,revision,state_hash,
                 created_at,updated_at,archived_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)",
            params![
                session.session_id,
                session.novel_id,
                session.workspace_type,
                session.status,
                session.revision,
                session.state_hash,
                session.created_at,
                session.updated_at,
                session.archived_at,
            ],
        )
        .map_err(AppError::database)?;
    if affected != 1 {
        return Err(AppError::new(
            codes::DATABASE_TRANSACTION_FAILED,
            "共创会话未写入唯一记录",
            false,
        ));
    }
    Ok(())
}

pub fn cas_advance_session(
    connection: &Connection,
    session_id: &str,
    expected_revision: i64,
    expected_state_hash: &str,
    next_revision: i64,
    next_state_hash: &str,
    now: &str,
) -> Result<(), AppError> {
    let affected = connection
        .execute(
            "UPDATE co_creation_sessions SET revision=?1,state_hash=?2,updated_at=?3
             WHERE session_id=?4 AND status='active' AND revision=?5 AND state_hash=?6",
            params![
                next_revision,
                next_state_hash,
                now,
                session_id,
                expected_revision,
                expected_state_hash,
            ],
        )
        .map_err(AppError::database)?;
    if affected != 1 {
        return Err(AppError::new(
            codes::DOCUMENT_VERSION_CONFLICT,
            "共创工作区已在其他窗口更新，请重新读取",
            false,
        ));
    }
    Ok(())
}

fn map_message(row: &rusqlite::Row<'_>) -> rusqlite::Result<CoCreationMessageRow> {
    Ok(CoCreationMessageRow {
        message_id: row.get(0)?,
        session_id: row.get(1)?,
        turn_id: row.get(2)?,
        sequence_no: row.get(3)?,
        role: row.get(4)?,
        status: row.get(5)?,
        body_ref_id: row.get(6)?,
        content_hash: row.get(7)?,
        content_length: row.get(8)?,
        reply_to_message_id: row.get(9)?,
        task_id: row.get(10)?,
        artifact_id: row.get(11)?,
        error_json: row.get(12)?,
        created_at: row.get(13)?,
        completed_at: row.get(14)?,
    })
}

const MESSAGE_SELECT: &str = "SELECT message_id,session_id,turn_id,sequence_no,role,status,
    body_ref_id,content_hash,content_length,reply_to_message_id,task_id,artifact_id,error_json,
    created_at,completed_at FROM co_creation_messages";

pub fn find_message(
    connection: &Connection,
    message_id: &str,
) -> Result<Option<CoCreationMessageRow>, AppError> {
    connection
        .query_row(
            &format!("{MESSAGE_SELECT} WHERE message_id=?1"),
            params![message_id],
            map_message,
        )
        .optional()
        .map_err(AppError::database)
}

pub fn list_messages(
    connection: &Connection,
    session_id: &str,
) -> Result<Vec<CoCreationMessageRow>, AppError> {
    let mut statement = connection
        .prepare(&format!(
            "{MESSAGE_SELECT} WHERE session_id=?1 ORDER BY sequence_no ASC"
        ))
        .map_err(AppError::database)?;
    let rows = statement
        .query_map(params![session_id], map_message)
        .map_err(AppError::database)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(AppError::database)?;
    Ok(rows)
}

pub fn next_message_sequence(connection: &Connection, session_id: &str) -> Result<i64, AppError> {
    connection
        .query_row(
            "SELECT COALESCE(MAX(sequence_no),0)+1 FROM co_creation_messages WHERE session_id=?1",
            params![session_id],
            |row| row.get(0),
        )
        .map_err(AppError::database)
}

#[allow(clippy::too_many_arguments)]
pub fn insert_message(
    connection: &Connection,
    message_id: &str,
    session_id: &str,
    turn_id: &str,
    sequence_no: i64,
    role: &str,
    status: &str,
    body_ref_id: &str,
    content_hash: &str,
    content_length: i64,
    reply_to_message_id: Option<&str>,
    task_id: Option<&str>,
    artifact_id: Option<&str>,
    append_operation_id: &str,
    append_request_hash: &str,
    created_at: &str,
    completed_at: Option<&str>,
) -> Result<(), AppError> {
    let affected = connection
        .execute(
            "INSERT INTO co_creation_messages
                (message_id,session_id,turn_id,sequence_no,role,status,body_ref_id,
                 content_hash,content_length,reply_to_message_id,task_id,artifact_id,
                 append_operation_id,append_request_hash,created_at,completed_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16)",
            params![
                message_id,
                session_id,
                turn_id,
                sequence_no,
                role,
                status,
                body_ref_id,
                content_hash,
                content_length,
                reply_to_message_id,
                task_id,
                artifact_id,
                append_operation_id,
                append_request_hash,
                created_at,
                completed_at,
            ],
        )
        .map_err(AppError::database)?;
    if affected != 1 {
        return Err(AppError::new(
            codes::DATABASE_TRANSACTION_FAILED,
            "共创消息未写入唯一记录",
            false,
        ));
    }
    Ok(())
}

pub fn bind_message_task(
    connection: &Connection,
    message_id: &str,
    session_id: &str,
    task_id: &str,
) -> Result<(), AppError> {
    let affected = connection
        .execute(
            "UPDATE co_creation_messages SET task_id=?1,status='running'
             WHERE message_id=?2 AND session_id=?3 AND role='user'
               AND status='submitted' AND task_id IS NULL",
            params![task_id, message_id, session_id],
        )
        .map_err(AppError::database)?;
    if affected != 1 {
        return Err(AppError::new(
            codes::AI_TASK_ILLEGAL_TRANSITION,
            "共创 turn 当前不能绑定后台任务",
            false,
        ));
    }
    Ok(())
}

pub fn finish_user_turn(
    connection: &Connection,
    message_id: &str,
    session_id: &str,
    task_id: &str,
    status: &str,
    error_json: Option<&str>,
    completed_at: &str,
) -> Result<(), AppError> {
    let affected = connection
        .execute(
            "UPDATE co_creation_messages SET status=?1,error_json=?2,completed_at=?3
             WHERE message_id=?4 AND session_id=?5 AND role='user'
               AND status='running' AND task_id=?6",
            params![
                status,
                error_json,
                completed_at,
                message_id,
                session_id,
                task_id,
            ],
        )
        .map_err(AppError::database)?;
    if affected != 1 {
        return Err(AppError::new(
            codes::AI_TASK_ILLEGAL_TRANSITION,
            "共创 turn 当前不能结束",
            false,
        ));
    }
    Ok(())
}

fn map_draft(row: &rusqlite::Row<'_>) -> rusqlite::Result<CoCreationDraftRow> {
    Ok(CoCreationDraftRow {
        draft_revision_id: row.get(0)?,
        session_id: row.get(1)?,
        stage_key: row.get(2)?,
        revision_no: row.get(3)?,
        parent_revision_id: row.get(4)?,
        schema_version: row.get(5)?,
        payload_json: row.get(6)?,
        content_hash: row.get(7)?,
        origin: row.get(8)?,
        source_message_id: row.get(9)?,
        source_task_id: row.get(10)?,
        source_artifact_id: row.get(11)?,
        created_at: row.get(12)?,
    })
}

const DRAFT_SELECT: &str = "SELECT draft_revision_id,session_id,stage_key,revision_no,
    parent_revision_id,schema_version,payload_json,content_hash,origin,source_message_id,
    source_task_id,source_artifact_id,created_at FROM co_creation_draft_revisions";

pub fn list_drafts(
    connection: &Connection,
    session_id: &str,
) -> Result<Vec<CoCreationDraftRow>, AppError> {
    let mut statement = connection
        .prepare(&format!(
            "{DRAFT_SELECT} WHERE session_id=?1 ORDER BY rowid ASC"
        ))
        .map_err(AppError::database)?;
    let rows = statement
        .query_map(params![session_id], map_draft)
        .map_err(AppError::database)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(AppError::database)?;
    Ok(rows)
}

pub fn latest_draft(
    connection: &Connection,
    session_id: &str,
    stage_key: &str,
) -> Result<Option<CoCreationDraftRow>, AppError> {
    connection
        .query_row(
            &format!(
                "{DRAFT_SELECT} WHERE session_id=?1 AND stage_key=?2 ORDER BY revision_no DESC LIMIT 1"
            ),
            params![session_id, stage_key],
            map_draft,
        )
        .optional()
        .map_err(AppError::database)
}

#[allow(clippy::too_many_arguments)]
pub fn insert_draft(
    connection: &Connection,
    draft_revision_id: &str,
    session_id: &str,
    stage_key: &str,
    revision_no: i64,
    parent_revision_id: Option<&str>,
    schema_version: i64,
    payload_json: &str,
    content_hash: &str,
    origin: &str,
    source_message_id: Option<&str>,
    source_task_id: Option<&str>,
    source_artifact_id: Option<&str>,
    operation_id: &str,
    request_hash: &str,
    created_at: &str,
) -> Result<(), AppError> {
    let affected = connection
        .execute(
            "INSERT INTO co_creation_draft_revisions
                (draft_revision_id,session_id,stage_key,revision_no,parent_revision_id,
                 schema_version,payload_json,content_hash,origin,source_message_id,
                 source_task_id,source_artifact_id,operation_id,request_hash,created_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15)",
            params![
                draft_revision_id,
                session_id,
                stage_key,
                revision_no,
                parent_revision_id,
                schema_version,
                payload_json,
                content_hash,
                origin,
                source_message_id,
                source_task_id,
                source_artifact_id,
                operation_id,
                request_hash,
                created_at,
            ],
        )
        .map_err(AppError::database)?;
    if affected != 1 {
        return Err(AppError::new(
            codes::DATABASE_TRANSACTION_FAILED,
            "共创阶段草案未写入唯一 revision",
            false,
        ));
    }
    Ok(())
}

pub fn find_operation(
    connection: &Connection,
    operation_id: &str,
) -> Result<Option<CoCreationOperationRow>, AppError> {
    connection
        .query_row(
            "SELECT session_id,operation_type,request_hash,result_json
             FROM co_creation_operations WHERE operation_id=?1",
            params![operation_id],
            |row| {
                Ok(CoCreationOperationRow {
                    session_id: row.get(0)?,
                    operation_type: row.get(1)?,
                    request_hash: row.get(2)?,
                    result_json: row.get(3)?,
                })
            },
        )
        .optional()
        .map_err(AppError::database)
}

pub fn insert_operation(
    connection: &Connection,
    operation_id: &str,
    session_id: &str,
    operation_type: &str,
    request_hash: &str,
    result_json: &str,
    created_at: &str,
) -> Result<(), AppError> {
    let affected = connection
        .execute(
            "INSERT INTO co_creation_operations
                (operation_id,session_id,operation_type,request_hash,result_json,created_at)
             VALUES (?1,?2,?3,?4,?5,?6)",
            params![
                operation_id,
                session_id,
                operation_type,
                request_hash,
                result_json,
                created_at,
            ],
        )
        .map_err(AppError::database)?;
    if affected != 1 {
        return Err(AppError::new(
            codes::DATABASE_TRANSACTION_FAILED,
            "共创 operation 未写入唯一结果",
            false,
        ));
    }
    Ok(())
}

pub fn find_background_task_scope(
    connection: &Connection,
    task_id: &str,
) -> Result<Option<BackgroundTaskScopeRow>, AppError> {
    connection
        .query_row(
            "SELECT task.task_type,task.novel_id,task.status,task.worker_kind,
                    task.target_hint_json,input.payload_json
             FROM ai_tasks task
             LEFT JOIN ai_input_snapshots input ON input.snapshot_id=task.input_snapshot_id
             WHERE task.task_id=?1",
            params![task_id],
            |row| {
                Ok(BackgroundTaskScopeRow {
                    task_type: row.get(0)?,
                    novel_id: row.get(1)?,
                    status: row.get(2)?,
                    worker_kind: row.get(3)?,
                    target_hint_json: row.get(4)?,
                    input_payload_json: row.get(5)?,
                })
            },
        )
        .optional()
        .map_err(AppError::database)
}

pub fn find_task_id_by_operation(
    connection: &Connection,
    operation_id: &str,
) -> Result<Option<String>, AppError> {
    connection
        .query_row(
            "SELECT task_id FROM ai_tasks WHERE operation_id=?1",
            params![operation_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(AppError::database)
}

pub fn find_artifact_scope(
    connection: &Connection,
    artifact_id: &str,
) -> Result<Option<ArtifactScopeRow>, AppError> {
    connection
        .query_row(
            "SELECT a.task_id,a.source_novel_id,a.artifact_type,a.schema_version,
                    a.raw_content_ref_id,a.display_content_ref_id,
                    a.processing_status,a.structured_payload_json,
                    EXISTS(SELECT 1 FROM ai_artifact_stale_events s WHERE s.artifact_id=a.artifact_id)
             FROM result_artifacts a WHERE a.artifact_id=?1",
            params![artifact_id],
            |row| {
                Ok(ArtifactScopeRow {
                    task_id: row.get(0)?,
                    source_novel_id: row.get(1)?,
                    artifact_type: row.get(2)?,
                    schema_version: row.get(3)?,
                    raw_content_ref_id: row.get(4)?,
                    display_content_ref_id: row.get(5)?,
                    processing_status: row.get(6)?,
                    structured_payload_json: row.get(7)?,
                    stale: row.get::<_, i64>(8)? == 1,
                })
            },
        )
        .optional()
        .map_err(AppError::database)
}

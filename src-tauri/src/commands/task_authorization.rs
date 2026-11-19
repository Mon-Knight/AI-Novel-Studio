//! Trusted desktop UI IPC only. Not registered in the Agent/Gateway tool catalog.
use crate::{
    db::get_connection,
    errors::AppError,
    services::{task_authorization_contract::*, task_authorization_service as service},
};
#[tauri::command]
pub async fn issue_task_authorization(input: IssueInput) -> Result<Authorization, AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        let grant = {
            let mut connection = get_connection()
                .lock()
                .map_err(|_| AppError::poisoned_lock())?;
            service::issue(&mut connection, input)?
        };
        reconcile_committed(&grant.conversation_id, "任务授权");
        // Reconciliation may have committed bounded writes. A refresh is for display only,
        // never used to rebase permission or hide the original committed grant.
        let current = get_connection()
            .lock()
            .ok()
            .and_then(|conn| service::load(&conn, &grant.authorization_id).ok());
        Ok(current.unwrap_or(grant))
    })
    .await
    .map_err(|_| {
        AppError::new(
            "TASK_AUTHORIZATION_ISSUE_UNKNOWN",
            "授权签发结果未知；请先查看本任务授权记录，不要重复签发",
            true,
        )
    })?
}
#[tauri::command]
pub fn list_task_authorizations(conversation_id: String) -> Result<Vec<Authorization>, AppError> {
    let connection = get_connection()
        .lock()
        .map_err(|_| AppError::poisoned_lock())?;
    service::list(&connection, &conversation_id)
}
#[tauri::command]
pub fn revoke_task_authorization(input: RevokeInput) -> Result<Authorization, AppError> {
    let mut connection = get_connection()
        .lock()
        .map_err(|_| AppError::poisoned_lock())?;
    service::revoke(&mut connection, input)
}
#[tauri::command]
pub async fn apply_task_authorization(input: ApplyInput) -> Result<Receipt, AppError> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut receipt = {
            let mut conn = get_connection()
                .lock()
                .map_err(|_| AppError::poisoned_lock())?;
            service::apply(&mut conn, input)?
        };
        if let Some(message) = reconcile_after_commit(&receipt.conversation_id) {
            receipt.result["followUpError"] = serde_json::json!(message);
        }
        Ok(receipt)
    })
    .await
    .map_err(|_| {
        AppError::new(
            "TASK_RECONCILIATION_FAILED",
            "写入调用被中断，请按原操作身份核对回执",
            true,
        )
    })?
}
#[tauri::command]
pub fn list_task_authorization_receipts(
    authorization_id: String,
) -> Result<Vec<Receipt>, AppError> {
    let connection = get_connection()
        .lock()
        .map_err(|_| AppError::poisoned_lock())?;
    service::list_receipts(&connection, &authorization_id)
}

/// Reconciliation owns its existing root worker; never run it while holding SQLite.
/// Failure here cannot turn a committed write into an apparent failed transaction.
pub(crate) fn reconcile_after_commit(conversation_id: &str) -> Option<String> {
    reconcile_committed(conversation_id, "正式写入")
}
fn reconcile_committed(conversation_id: &str, committed: &str) -> Option<String> {
    if let Err(error) = crate::services::dsh::task_runtime::reconcile_task(conversation_id) {
        let message = format!(
            "{committed}已提交；后续任务已暂停，请检查或显式继续：{}",
            error.chars().take(800).collect::<String>()
        );
        if let Ok(mut conn) = get_connection().lock() {
            let _ = crate::services::conversation_service::append_turn(
                &mut conn,
                crate::services::conversation_service::AppendTurnInput {
                    turn_id: format!("followup-error-{}", uuid::Uuid::new_v4()),
                    conversation_id: conversation_id.into(),
                    role: "assistant".into(),
                    content: message.clone(),
                    created_at: chrono::Utc::now().to_rfc3339(),
                },
            );
        }
        Some(message)
    } else {
        None
    }
}

#[tauri::command]
pub fn preview_review_authorization_renewal(
    input: PreviewReviewRenewalInput,
) -> Result<ReviewRenewalPreview, AppError> {
    let mut conn = get_connection()
        .lock()
        .map_err(|_| AppError::poisoned_lock())?;
    service::preview_review_renewal(&mut conn, input)
}
#[tauri::command]
pub fn renew_review_authorization(
    input: RenewReviewInput,
) -> Result<crate::services::conversation_service::ReviewAuthorizationRecord, AppError> {
    let mut conn = get_connection()
        .lock()
        .map_err(|_| AppError::poisoned_lock())?;
    service::renew_review(&mut conn, input)
}

#[tauri::command]
pub fn get_review_authorization_renewal(
    authorization_id: String,
    operation_id: String,
) -> Result<Option<crate::services::conversation_service::ReviewAuthorizationRecord>, AppError> {
    let conn = get_connection()
        .lock()
        .map_err(|_| AppError::poisoned_lock())?;
    service::get_review_renewal(
        &conn,
        GetReviewRenewalInput {
            authorization_id,
            operation_id,
        },
    )
}
#[tauri::command]
pub fn get_review_authorization_resume(authorization_id: String) -> Result<ReviewResume, AppError> {
    let mut conn = get_connection()
        .lock()
        .map_err(|_| AppError::poisoned_lock())?;
    service::get_review_resume(&mut conn, &authorization_id)
}

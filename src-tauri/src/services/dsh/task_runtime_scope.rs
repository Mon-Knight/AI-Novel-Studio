//! A true library root never substitutes a novel identifier or acquires novel capabilities.
use super::*;

pub use crate::repositories::conversation_repository::TaskScope;
impl TaskScope {
    pub fn novel_id(&self) -> Option<&str> {
        match self {
            Self::Novel { novel_id } => Some(novel_id),
            Self::Library { .. } => None,
        }
    }
    pub fn is_library(&self) -> bool {
        matches!(self, Self::Library { .. })
    }
}
pub(super) fn from_input(input: &StartTaskTurnInput) -> Result<TaskScope, String> {
    let scope = match input.scope.clone() {
        Some(scope) => scope,
        None => TaskScope::Novel {
            novel_id: input.novel_id.clone().ok_or("DSH_TASK_SCOPE_REQUIRED")?,
        },
    };
    match &scope {
        TaskScope::Novel { novel_id } => {
            if novel_id.trim().is_empty()
                || input.novel_id.as_deref().is_some_and(|id| id != novel_id)
            {
                return Err("DSH_TASK_SCOPE_MISMATCH".into());
            }
        }
        TaskScope::Library {
            source_id,
            source_hash,
        } => {
            if input.novel_id.is_some()
                || input.chapter_id.is_some()
                || input.revision_source.is_some()
                || input.chapter_host_gate.is_some()
                || input.continuity_claim.is_some()
            {
                return Err("DSH_LIBRARY_SCOPE_EXPANSION".into());
            }
            if source_id.trim().is_empty()
                || source_hash.len() != 64
                || !source_hash.bytes().all(|c| c.is_ascii_hexdigit())
            {
                return Err("DSH_LIBRARY_SOURCE_INVALID".into());
            }
        }
    }
    Ok(scope)
}
pub(super) fn validate(
    connection: &rusqlite::Connection,
    input: &mut StartTaskTurnInput,
) -> Result<TaskScope, String> {
    let scope = from_input(input)?;
    match &scope {
        TaskScope::Novel { novel_id } => {
            conversation_service::validate_task_runtime_scope(
                connection,
                &input.conversation_id,
                &input.turn_id,
                novel_id,
                input.chapter_id.as_deref(),
            )
            .map_err(|e| e.to_string())?;
            input.novel_id = Some(novel_id.clone());
        }
        TaskScope::Library {
            source_id,
            source_hash,
        } => {
            input.goal = crate::services::library_task_service::validate_runtime_scope(
                connection,
                &input.conversation_id,
                &input.turn_id,
                source_id,
                source_hash,
            )
            .map_err(|e| e.to_string())?;
            input.verified_revision_source = None;
        }
    }
    input.scope = Some(scope.clone());
    Ok(scope)
}
